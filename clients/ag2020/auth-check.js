/**
 * AG2020 dashboard auth gate (for plain HTML pages — court-presentation.html,
 * cashflow.html, 404.html). The Next.js index.html has its own gate via
 * src/components/auth/AuthGate.tsx.
 *
 * Verifies the user has a valid Supabase session AND an ag2020_users
 * membership row. The Supabase project is shared across several products
 * (Omicron, AutomateDojo, SportsBookISH...), so a session alone does NOT
 * prove AG2020 access — non-members are signed out and denied. Does NOT
 * enforce per-tab permissions here — these standalone pages are accessible
 * to any AG2020 member.
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

    function redirectToLogin(denied) {
        var next = encodeURIComponent(buildNextParam());
        window.location.replace('login.html?next=' + next + (denied ? '&denied=1' : ''));
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

            // Tenant check: shared Supabase auth pool — the session must
            // belong to an AG2020 member. RLS only exposes the user's own
            // ag2020_users row, so non-members get zero rows back.
            var m = await client
                .from('ag2020_users')
                .select('user_id')
                .eq('user_id', s.data.session.user.id)
                .maybeSingle();
            if (m.error || !m.data) {
                try { await client.auth.signOut(); } catch (_) {}
                redirectToLogin(true);
                return;
            }

            reveal();
        } catch (err) {
            console.error('[ag2020 auth] check failed:', err);
            redirectToLogin();
        }
    })();
})();
