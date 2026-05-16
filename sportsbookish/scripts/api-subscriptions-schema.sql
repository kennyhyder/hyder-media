-- SportsBookISH API subscriptions
--
-- Separate from sb_subscriptions (UI tier) because a user can hold both
-- a UI subscription (free/pro/elite) AND an independent API add-on
-- (api_monthly/api_annual). Two distinct Stripe subscription IDs.

CREATE TABLE IF NOT EXISTS sb_api_subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'api_monthly', 'api_annual', 'enterprise')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    status TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sb_api_subs_sub_idx ON sb_api_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE sb_api_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_api_subs_select_own ON sb_api_subscriptions;
CREATE POLICY sb_api_subs_select_own ON sb_api_subscriptions FOR SELECT
    USING (auth.uid() = user_id);
