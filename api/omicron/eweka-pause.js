/**
 * One-time: pause all ENABLED Eweka campaigns — cron 13:30+13:40 UTC 2026-08-20
 * (9:30am ET; second firing is the retry). Date-gated in _eweka-window.js.
 * ?validate=1 = validateOnly dry-run (no mutation, no email, bypasses date gate).
 */
import { handleWindow } from './_eweka-window.js';

export default async function handler(req, res) {
    return handleWindow(req, res, 'pause');
}
