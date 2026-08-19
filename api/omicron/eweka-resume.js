/**
 * One-time: re-enable Eweka campaigns paused by eweka-pause (label-tagged) —
 * cron 17:00+17:10 UTC 2026-08-20 (1:00pm ET; second firing is the retry).
 * Date-gated in _eweka-window.js. ?validate=1 = validateOnly dry-run.
 */
import { handleWindow } from './_eweka-window.js';

export default async function handler(req, res) {
    return handleWindow(req, res, 'resume');
}
