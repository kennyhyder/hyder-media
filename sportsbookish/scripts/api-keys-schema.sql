-- SportsBookISH API keys + usage tracking
--
-- One row per user-issued key. Keys are stored as SHA-256 hash; plaintext
-- only shown to the user on creation. tier mirrors lib/tiers.ts ApiTierKey.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS sb_api_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Unnamed key',
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'api_monthly', 'api_annual', 'enterprise')),
    monthly_quota INTEGER NOT NULL DEFAULT 1000,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sb_api_keys_user_idx ON sb_api_keys (user_id);
CREATE INDEX IF NOT EXISTS sb_api_keys_hash_idx ON sb_api_keys (key_hash);
CREATE INDEX IF NOT EXISTS sb_api_keys_sub_idx ON sb_api_keys (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sb_api_usage (
    id BIGSERIAL PRIMARY KEY,
    api_key_id BIGINT NOT NULL REFERENCES sb_api_keys(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 200,
    called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sb_api_usage_key_time_idx ON sb_api_usage (api_key_id, called_at DESC);

ALTER TABLE sb_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_api_keys_select_own ON sb_api_keys;
CREATE POLICY sb_api_keys_select_own ON sb_api_keys FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_api_usage_select_own ON sb_api_usage;
CREATE POLICY sb_api_usage_select_own ON sb_api_usage FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM sb_api_keys
            WHERE sb_api_keys.id = sb_api_usage.api_key_id
              AND sb_api_keys.user_id = auth.uid()
        )
    );

-- Demo key (shared, public, low quota) so AI tools / docs page can call the
-- API without signup. Plaintext: sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5
-- (sha256 below). user_id NULL = system-owned.
ALTER TABLE sb_api_keys ALTER COLUMN user_id DROP NOT NULL;

INSERT INTO sb_api_keys (user_id, name, key_hash, key_prefix, tier, monthly_quota)
VALUES (
    NULL,
    'Public demo key',
    encode(digest('sbi_live_84fdd6cc6a6b2df3e38a9f19a49537a5', 'sha256'), 'hex'),
    'sbi_live_84fdd6cc',
    'free',
    1000
)
ON CONFLICT (key_hash) DO NOTHING;
