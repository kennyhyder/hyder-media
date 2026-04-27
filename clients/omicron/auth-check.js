/**
 * Omicron dashboard auth gate.
 *
 * Verifies the user has an active Supabase session at AAL2 (MFA verified).
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

    function redirectToLogin() {
        const next = encodeURIComponent(buildNextParam());
        window.location.replace('login.html?next=' + next);
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
