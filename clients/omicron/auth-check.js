/**
 * Omicron dashboard auth gate.
 *
 * Verifies the user has an active Supabase session at AAL2 (MFA verified)
 * AND a membership row in omicron_users. The Supabase project is shared
 * across several products (AG2020, AutomateDojo, SportsBookISH...), so a
 * valid session alone proves nothing about Omicron access — a non-member
 * with a session is signed out and denied.
 * Redirects to login.html with a `next` param if not. Hides the page body
 * until verification completes to prevent a flash of protected content.
 *
 * Include in <head> AFTER loading the Supabase JS SDK:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="auth-check.js"></script>
 */
(function () {
    const SUPABASE_URL = 'https://ilbovwnhrowvxjdkvrln.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsYm92d25ocm93dnhqZGt2cmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MjUzMTIsImV4cCI6MjA4NDEwMTMxMn0.FKtChreOxcemcTUZqbtnk-ZkjqLHYwQFKvx_Xy35FlM';

    if (!window.supabase || !window.supabase.createClient) {
        console.error('Supabase JS SDK not loaded — auth check cannot run.');
        return;
    }

    // Hide the page until auth is confirmed
    const hideStyle = document.createElement('style');
    hideStyle.id = 'auth-check-hide';
    hideStyle.textContent = 'html { visibility: hidden; }';
    document.head.appendChild(hideStyle);

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Expose so other scripts on the page can use it (sign-out button etc.)
    window.omicronSupabase = client;
    window.omicronSignOut = async () => {
        try { await client.auth.signOut(); } catch (_) {}
        window.location.replace('login.html');
    };

    function buildNextParam() {
        const file = window.location.pathname.split('/').pop() || '';
        return file + window.location.search + window.location.hash;
    }

    function redirectToLogin(denied) {
        const next = encodeURIComponent(buildNextParam());
        window.location.replace('login.html?next=' + next + (denied ? '&denied=1' : ''));
    }

    function reveal() {
        const el = document.getElementById('auth-check-hide');
        if (el) el.remove();
        document.documentElement.style.visibility = 'visible';
    }

    (async () => {
        try {
            const { data: { session } } = await client.auth.getSession();
            if (!session) { redirectToLogin(); return; }

            // Tenant check: the session must belong to an Omicron member.
            // RLS only lets a user read their own omicron_users row, so a
            // non-member (e.g. an AG2020 user in the same auth pool) gets
            // zero rows back — sign them out entirely and deny.
            const { data: member, error: memberErr } = await client
                .from('omicron_users')
                .select('user_id')
                .eq('user_id', session.user.id)
                .maybeSingle();
            if (memberErr || !member) {
                try { await client.auth.signOut(); } catch (_) {}
                redirectToLogin(true);
                return;
            }

            const { data: aalData, error: aalErr } =
                await client.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalErr || !aalData) { redirectToLogin(); return; }

            // Require AAL2 — i.e. an MFA factor has been verified this session
            if (aalData.currentLevel !== 'aal2') { redirectToLogin(); return; }

            reveal();
        } catch (err) {
            console.error('Auth check failed:', err);
            redirectToLogin();
        }
    })();
})();
