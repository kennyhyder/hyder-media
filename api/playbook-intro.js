// api/playbook-intro.js
// Lead-magnet endpoint for /playbook — accepts email, emails the user
// the intro PDF link, notifies Kenny of the signup.
//
// When ConvertKit / Mailerlite is wired up later, this endpoint can also
// POST to their API to add the subscriber to the drip sequence. For now
// it sends the PDF via plain transactional email.

import nodemailer from 'nodemailer';

const rateLimitStore = new Map();

const PLAYBOOK_INTRO_URL = 'https://hyder.me/downloads/playbook-intro-v1.pdf';
const PLAYBOOK_FULL_URL = 'https://hyder.me/playbook';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { email, website } = req.body;

    // Honeypot — bot caught, return success silently
    if (website) {
      return res.status(200).json({ success: true });
    }

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // Rate limit per IP (3 in 5 min)
    const clientIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please wait a few minutes.',
      });
    }

    // Trim env vars defensively (the env-newline pattern from §5.4 of the playbook —
    // dogfooding ourselves)
    const emailUser = process.env.EMAIL_USER?.trim();
    const emailPass = process.env.EMAIL_PASS?.trim();
    const adminEmail = (process.env.ADMIN_EMAIL || 'kenny@hyder.me').trim();

    if (!emailUser || !emailPass) {
      console.error('[playbook-intro] EMAIL_USER or EMAIL_PASS not configured');
      return res.status(500).json({
        success: false,
        message: 'Email service not configured. Email kenny@hyder.me directly.',
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass },
    });

    // 1) Send the PDF to the signup
    await transporter.sendMail({
      from: `"Kenny Hyder" <${emailUser}>`,
      to: email,
      replyTo: 'kenny@hyder.me',
      subject: 'Your free playbook + a quick note',
      text: buildIntroEmailText(),
      html: buildIntroEmailHtml(),
    });

    // 2) Notify Kenny of the signup (separate email so it doesn't show up
    //    to the subscriber as a BCC)
    await transporter.sendMail({
      from: `"Hyder Media" <${emailUser}>`,
      to: adminEmail,
      subject: `[playbook] New intro signup: ${email}`,
      text: `New playbook intro signup:\n\nEmail: ${email}\nIP: ${clientIp}\nWhen: ${new Date().toISOString()}\nSource: /playbook landing page\n\nThe intro PDF has been auto-sent.`,
    });

    return res.status(200).json({
      success: true,
      message: 'Check your inbox in the next 2 minutes for the free intro PDF.',
    });
  } catch (err) {
    console.error('[playbook-intro] error', err);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Email kenny@hyder.me directly.',
    });
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  const limit = 3;
  const windowMs = 5 * 60 * 1000;
  const list = (rateLimitStore.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  rateLimitStore.set(ip, list);
  return true;
}

function buildIntroEmailText() {
  return `Hey,

Thanks for grabbing the playbook intro. Here it is:

${PLAYBOOK_INTRO_URL}

It's 5 pages, will take you ~10 minutes. Three things I'd love you to do after reading:

1. If it changes how you'd approach your next launch, reply to this email and tell me which part. I respond personally and I'm always looking for what's missing.

2. If you spot something wrong — outdated, naive, doesn't apply to your stack — same thing, reply. v2 of this thing exists because of feedback from people like you.

3. If you want the full version (100+ pages, all templates, the Claude skill, the 12 named defensive patterns), that's at ${PLAYBOOK_FULL_URL}. $79. I'll get out of your way and stop emailing if you buy.

Over the next two weeks I'll send you four more emails — one of the named bugs each time, with a story. If they're not for you, just reply with "unsubscribe" and I'll take you off.

Talk soon,

—Kenny

P.S. I genuinely read every reply. Even one-liners. Don't be a stranger.

---
Kenny Hyder · Hyder Media
https://hyder.me · kenny@hyder.me
`;
}

function buildIntroEmailHtml() {
  return `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0 auto;padding:20px;">
<p>Hey,</p>

<p>Thanks for grabbing the playbook intro. Here it is:</p>

<p><a href="${PLAYBOOK_INTRO_URL}" style="color:#10b981;font-weight:600;">${PLAYBOOK_INTRO_URL}</a></p>

<p>It's 5 pages, will take you ~10 minutes. Three things I'd love you to do after reading:</p>

<p><strong>1.</strong> If it changes how you'd approach your next launch, reply to this email and tell me which part. I respond personally and I'm always looking for what's missing.</p>

<p><strong>2.</strong> If you spot something wrong — outdated, naive, doesn't apply to your stack — same thing, reply. v2 of this thing exists because of feedback from people like you.</p>

<p><strong>3.</strong> If you want the full version (100+ pages, all templates, the Claude skill, the 12 named defensive patterns), that's at <a href="${PLAYBOOK_FULL_URL}">${PLAYBOOK_FULL_URL}</a>. $79. I'll get out of your way and stop emailing if you buy.</p>

<p>Over the next two weeks I'll send you four more emails — one of the named bugs each time, with a story. If they're not for you, just reply with "unsubscribe" and I'll take you off.</p>

<p>Talk soon,</p>

<p>—Kenny</p>

<p style="color:#666;font-size:13px;"><em>P.S. I genuinely read every reply. Even one-liners. Don't be a stranger.</em></p>

<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">

<p style="color:#888;font-size:12px;">
Kenny Hyder · Hyder Media<br>
<a href="https://hyder.me" style="color:#666;">hyder.me</a> · <a href="mailto:kenny@hyder.me" style="color:#666;">kenny@hyder.me</a>
</p>
</body></html>`;
}
