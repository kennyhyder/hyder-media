/**
 * AG2020 dashboard auth gate (for plain HTML pages — court-presentation.html,
 * cashflow.html, 404.html). The Next.js index.html has its own gate via
 * src/components/auth/AuthGate.tsx.
 *
 * Verifies the user has a valid Supabase session. Does NOT enforce per-tab
 * permissions here — these standalone pages are accessible to any signed-in
 * AG2020 user.
 *
 * Include in <head> AFTER loading the Supabase JS SDK:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="auth-check.js"></script>
 */
(function () {
    var SUPABASE_URL = 'https://ilbovwnhrowvxjdkvrln.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsYm92d25ocm93dnhqZGt2cmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MjUzMTIsImV4cCI6MjA4NDEwMTMxMn0.FKtChreOxcemcTUZqbtnk-ZkjqLHYwQFKvx_Xy35FlM';

    if (!window.supabase || !window.supabase.createClient) {
        console.error('[ag2020 auth] Supabase JS SDK not loaded — auth check cannot run.');
        return;
    }

    // Hide the page until auth is confirmed
    var hideStyle = document.createElement('style');
    hideStyle.id = 'ag2020-auth-check-hide';
    hideStyle.textContent = 'html { visibility: hidden; }';
    document.head.appendChild(hideStyle);

    var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    // Expose for sign-out buttons on the page
    window.ag2020Supabase = client;
    window.ag2020SignOut = async function () {
        try { await client.auth.signOut(); } catch (_) {}
        window.location.replace('login.html');
    };

    function buildNextParam() {
        var file = window.location.pathname.split('/').filter(Boolean).pop() || '';
        return file + window.location.search + window.location.hash;
    }

    function redirectToLogin() {
        var next = encodeURIComponent(buildNextParam());
        window.location.replace('login.html?next=' + next);
    }

    function reveal() {
        var el = document.getElementById('ag2020-auth-check-hide');
        if (el) el.remove();
        document.documentElement.style.visibility = 'visible';
    }

    (async function () {
        try {
            var s = await client.auth.getSession();
            if (!s.data || !s.data.session) { redirectToLogin(); return; }
            reveal();
        } catch (err) {
            console.error('[ag2020 auth] check failed:', err);
            redirectToLogin();
        }
    })();
})();
