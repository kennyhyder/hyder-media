/**
 * Microsoft Ads — Digistore24 Performance (account G1456B2Z / 187288672)
 * GET /api/digistore/ms-performance?days=30&scope=ds24|pagewheel|all
 *
 * Mirrors /api/digistore/performance's shapes for the reporting dashboard's
 * Bing platform view: returns { summary, campaigns, daily } in one call.
 * Uses the Reporting API (submit → poll → download zip → parse CSV) since
 * Microsoft has no synchronous stats query. OAuth via bing_ads_connections.
 */

import { createClient } from '@supabase/supabase-js';
import { inflateRawSync } from 'zlib';
import { guard } from './_guard.js';

export const config = { maxDuration: 90 };

const AID = '187288672';
const CID = '255007777';
const NS = 'https://bingads.microsoft.com/Reporting/v13';
const SVC = 'https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc';

async function getToken() {
  const supabase = createClient((process.env.SUPABASE_URL || '').trim(), (process.env.SUPABASE_SERVICE_KEY || '').trim());
  const { data: conn } = await supabase.from('bing_ads_connections').select('*').order('updated_at', { ascending: false }).limit(1).single();
  if (!conn) throw new Error('no bing connection');
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: (process.env.BING_ADS_CLIENT_ID || '').trim(),
      client_secret: (process.env.BING_ADS_CLIENT_SECRET || '').trim(),
      refresh_token: conn.refresh_token, grant_type: 'refresh_token',
      scope: 'https://ads.microsoft.com/msads.manage offline_access',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('bing token refresh failed');
  return j.access_token;
}

async function soap(token, action, body) {
  const envl = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="${NS}"><Action mustUnderstand="1">${action}</Action><AuthenticationToken i:nil="false">${token}</AuthenticationToken><CustomerAccountId i:nil="false">${AID}</CustomerAccountId><CustomerId i:nil="false">${CID}</CustomerId><DeveloperToken i:nil="false">${(process.env.BING_ADS_DEVELOPER_TOKEN || '').trim()}</DeveloperToken></s:Header>
  <s:Body>${body}</s:Body></s:Envelope>`;
  const r = await fetch(SVC, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action }, body: envl });
  const t = await r.text();
  if (t.includes('<s:Fault>')) throw new Error(action + ': ' + ((t.match(/<Message>([^<]+)/) || t.match(/<faultstring[^>]*>([^<]+)/) || [])[1] || 'fault'));
  return t;
}

function dstr(d) { return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }; }

// Minimal zip extractor — Microsoft report zips hold a single CSV entry.
function unzipFirst(buf) {
  const sig = buf.indexOf('PK', 0, 'binary');
  if (sig < 0) return buf.toString('utf8'); // not zipped
  const method = buf.readUInt16LE(sig + 8);
  const csize = buf.readUInt32LE(sig + 18);
  const fnLen = buf.readUInt16LE(sig + 26);
  const exLen = buf.readUInt16LE(sig + 28);
  const start = sig + 30 + fnLen + exLen;
  const data = csize > 0 ? buf.slice(start, start + csize) : buf.slice(start);
  return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const scope = ['pagewheel', 'all'].includes(req.query.scope) ? req.query.scope : 'ds24';
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const end = new Date(); const start = new Date(Date.now() - days * 86400000);
  const result = { dateRange: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }, scope, platform: 'microsoft', status: 'loading', errors: [] };
  try {
    const token = await getToken();
    const s = dstr(start), e = dstr(end);
    const cols = ['TimePeriod', 'CampaignName', 'CampaignId', 'CampaignStatus', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'Revenue'];
    const submit = await soap(token, 'SubmitGenerateReport', `<SubmitGenerateReportRequest xmlns="${NS}"><ReportRequest i:type="CampaignPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
      <ExcludeColumnHeaders>false</ExcludeColumnHeaders><ExcludeReportFooter>true</ExcludeReportFooter><ExcludeReportHeader>true</ExcludeReportHeader>
      <Format>Csv</Format><ReportName>ds24-dash</ReportName><ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
      <Aggregation>Daily</Aggregation>
      <Columns>${cols.map(c => `<CampaignPerformanceReportColumn>${c}</CampaignPerformanceReportColumn>`).join('')}</Columns>
      <Scope><AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><a:long>${AID}</a:long></AccountIds></Scope>
      <Time><CustomDateRangeEnd><Day>${e.day}</Day><Month>${e.month}</Month><Year>${e.year}</Year></CustomDateRangeEnd><CustomDateRangeStart><Day>${s.day}</Day><Month>${s.month}</Month><Year>${s.year}</Year></CustomDateRangeStart><ReportTimeZone>PacificTimeUSCanadaTijuana</ReportTimeZone></Time>
    </ReportRequest></SubmitGenerateReportRequest>`);
    const reqId = (submit.match(/<ReportRequestId>([^<]+)/) || [])[1];
    if (!reqId) throw new Error('no ReportRequestId');
    let url = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await soap(token, 'PollGenerateReport', `<PollGenerateReportRequest xmlns="${NS}"><ReportRequestId>${reqId}</ReportRequestId></PollGenerateReportRequest>`);
      const status = (poll.match(/<Status>([^<]+)/) || [])[1];
      if (status === 'Success') { url = ((poll.match(/<ReportDownloadUrl[^>]*>([^<]+)/) || [])[1] || '').replace(/&amp;/g, '&'); break; }
      if (status === 'Error') throw new Error('report generation failed');
    }
    // No URL + Success can mean an empty report (no data in range)
    let rows = [];
    if (url) {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const csv = unzipFirst(buf);
      const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
      const header = (lines[0] || '').replace(/^﻿/, '').split(',').map(h => h.replace(/^"|"$/g, ''));
      const idx = Object.fromEntries(header.map((h, i) => [h, i]));
      for (const line of lines.slice(1)) {
        const parts = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(p => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        if (!parts[idx.TimePeriod] || !/^\d{4}-\d{2}-\d{2}/.test(parts[idx.TimePeriod] || '')) continue;
        rows.push({
          date: parts[idx.TimePeriod], name: parts[idx.CampaignName], id: parts[idx.CampaignId], status: parts[idx.CampaignStatus],
          impressions: +(parts[idx.Impressions] || 0), clicks: +(parts[idx.Clicks] || 0),
          spend: +(parts[idx.Spend] || 0), conversions: +(parts[idx.Conversions] || 0), conversionValue: +(parts[idx.Revenue] || 0),
        });
      }
    }
    const inScope = (name) => scope === 'all' ? true : scope === 'pagewheel' ? /PageWheel/i.test(name) : !/PageWheel/i.test(name);
    rows = rows.filter(r => inScope(r.name || ''));
    const roll = (list) => {
      const a = list.reduce((x, r) => ({ spend: x.spend + r.spend, clicks: x.clicks + r.clicks, impressions: x.impressions + r.impressions, conversions: x.conversions + r.conversions, conversionValue: x.conversionValue + r.conversionValue }), { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 });
      return { ...a, ctr: a.impressions ? a.clicks / a.impressions : 0, cpc: a.clicks ? a.spend / a.clicks : 0, cpa: a.conversions ? a.spend / a.conversions : 0, roas: a.spend ? a.conversionValue / a.spend : 0, convRate: a.clicks ? a.conversions / a.clicks : 0 };
    };
    result.summary = roll(rows);
    const byCamp = {};
    for (const r of rows) { (byCamp[r.name] ||= []).push(r); }
    result.campaigns = Object.entries(byCamp).map(([name, list]) => ({ id: list[0].id, name, status: list[0].status === 'Active' ? 'ENABLED' : 'PAUSED', ...roll(list) })).sort((a, b) => b.spend - a.spend);
    const byDay = {};
    for (const r of rows) { (byDay[r.date] ||= []).push(r); }
    result.daily = Object.entries(byDay).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, list]) => ({ date, ...roll(list) }));
    result.status = 'success';
    return res.status(200).json(result);
  } catch (e) {
    result.status = 'error'; result.errors.push({ error: String((e && e.message) || e) });
    return res.status(200).json(result);
  }
}
