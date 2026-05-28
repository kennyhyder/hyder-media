/**
 * AG2020 — GlassBiller email-ingest endpoint
 *
 * POST /api/ag2020/glassbiller-email-ingest
 *
 * Receives the scheduled GlassBiller "Sales and margin report" email (via a
 * Zapier "Email Parser" zap on the matthew@autoglass2020.com forwarded inbox)
 * with the XLSX attachment, parses it with the existing GlassBiller adapter,
 * upserts into ag2020_crm_jobs, links to journeys by phone, and re-runs the
 * financial rollup. Fully automates the manual XLSX upload path.
 *
 * Body — accepts either:
 *   - { attachment_base64: "<base64 XLSX>", filename?: "..." }
 *   - { attachment_url: "https://...xlsx", filename?: "..." }
 *
 * Zapier zap pattern: trigger on email received with .xlsx attachment →
 * upload attachment to Zapier storage → POST this endpoint with attachment_url
 * (or base64-encode + POST). See docs/lead-attribution-platform-plan.md.
 *
 * Auth: header `X-Webhook-Secret` or `?secret=` must match
 *       AG2020_AUTODIAL_SECRET.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
    parseGlassbillerBuffer, ingestRows, linkJobsToJourneys,
} from './_adapter-glassbiller-xlsx.js';

const TENANT = 'ag2020';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const expected = process.env.AG2020_AUTODIAL_SECRET || process.env.AG2020_MISSED_CALL_WEBHOOK_SECRET;
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (!expected) return res.status(503).json({ error: 'Webhook secret not configured' });
    if (provided !== expected) return res.status(401).json({ error: 'Invalid secret' });

    const body = req.body || {};
    const filename = (body.filename || 'glassbiller-email-' + new Date().toISOString().slice(0, 10) + '.xlsx').slice(0, 200);

    // Resolve attachment buffer from base64 or URL
    let xlsxBuffer = null;
    try {
        if (body.attachment_base64) {
            xlsxBuffer = Buffer.from(String(body.attachment_base64), 'base64');
        } else if (body.attachment_url) {
            const r = await fetch(String(body.attachment_url));
            if (!r.ok) return res.status(400).json({ error: `failed to fetch attachment_url (${r.status})` });
            xlsxBuffer = Buffer.from(await r.arrayBuffer());
        }
    } catch (err) {
        return res.status(400).json({ error: 'attachment decode failed: ' + err.message });
    }

    if (!xlsxBuffer || xlsxBuffer.length < 100) {
        return res.status(400).json({
            error: 'No attachment provided. Send { attachment_base64 } OR { attachment_url } in the JSON body.',
        });
    }

    let rows = [];
    try {
        rows = parseGlassbillerBuffer(xlsxBuffer);
    } catch (err) {
        return res.status(400).json({ error: 'XLSX parse failed: ' + err.message });
    }
    if (!rows.length) {
        return res.status(200).json({ status: 'success', message: 'No rows in XLSX', filename, ingested: 0 });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const uploadBatch = crypto.randomUUID();

    const ingestStats = await ingestRows(supabase, TENANT, rows, uploadBatch, filename);
    const linkStats = await linkJobsToJourneys(supabase, TENANT);

    return res.status(200).json({
        status: 'success',
        filename,
        upload_batch: uploadBatch,
        ingest: ingestStats,
        link: linkStats,
    });
}
