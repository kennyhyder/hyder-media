/**
 * AG2020 dashboard auth gate (for plain HTML pages — court-presentation.html,
 * cashflow.html, 404.html). The Next.js index.html has its own gate via
 * src/components/auth/AuthGate.tsx.
 *
 * 2026-07-15: Supabase auth removed (cross-tenant magic-link incident —
 * AG2020 people no longer have Supabase accounts at all). Access is the
 * shared password gate at password.html, which sets
 * sessionStorage['ag2020_dashboard_auth'] = 'authenticated'.
 *
 * Include in <head>:
 *   <script src="auth-check.js"></script>
 * (The Supabase CDN script is no longer required; a leftover tag is harmless.)
 */
(function () {
    var AUTH_KEY = 'ag2020_dashboard_auth';
    var AUTH_VALUE = 'authenticated';

    // Hide the page until auth is confirmed
    var hideStyle = document.createElement('style');
    hideStyle.id = 'ag2020-auth-check-hide';
    hideStyle.textContent = 'html { visibility: hidden; }';
    document.head.appendChild(hideStyle);

    function buildNextParam() {
        var file = window.location.pathname.split('/').filter(Boolean).pop() || '';
        return file + window.location.search + window.location.hash;
    }

    function redirectToGate() {
        var next = encodeURIComponent(buildNextParam());
        window.location.replace('password.html?next=' + next);
    }

    // Kept for the sign-out buttons wired up when this was Supabase-based.
    window.ag2020SignOut = function () {
        try { sessionStorage.removeItem(AUTH_KEY); } catch (_) {}
        window.location.replace('password.html');
    };

    var ok = false;
    try { ok = sessionStorage.getItem(AUTH_KEY) === AUTH_VALUE; } catch (_) {}
    if (!ok) { redirectToGate(); return; }

    var el = document.getElementById('ag2020-auth-check-hide');
    if (el) el.remove();
    document.documentElement.style.visibility = 'visible';
})();
