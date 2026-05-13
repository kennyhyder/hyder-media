-- SportsBookish core schema — users, subscriptions, tier-aware preferences.
-- Run in Supabase SQL editor or via psql.
-- All tables prefixed `sb_` to coexist with golfodds_ / solar_ etc.

CREATE TABLE IF NOT EXISTS sb_subscription_tiers (
    tier TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    price_monthly_cents INT NOT NULL,
    stripe_price_id TEXT,
    feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0
);

INSERT INTO sb_subscription_tiers (tier, display_name, price_monthly_cents, feature_flags, display_order) VALUES
    ('free',  'First Line', 0,    '{"win_only": true,  "alerts": false, "home_book": false, "book_filter": false, "props": false, "matchups": false}'::jsonb, 1),
    ('pro',   'Pro',        1900, '{"win_only": false, "alerts": false, "home_book": true,  "book_filter": true,  "props": true,  "matchups": true}'::jsonb,  2),
    ('elite', 'Elite',      3900, '{"win_only": false, "alerts": true,  "home_book": true,  "book_filter": true,  "props": true,  "matchups": true,  "custom_thresholds": true, "sms": true}'::jsonb, 3)
ON CONFLICT (tier) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    price_monthly_cents = EXCLUDED.price_monthly_cents,
    feature_flags = EXCLUDED.feature_flags,
    display_order = EXCLUDED.display_order;

CREATE TABLE IF NOT EXISTS sb_subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL DEFAULT 'free' REFERENCES sb_subscription_tiers(tier),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sb_subscriptions_status ON sb_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_sb_subscriptions_tier ON sb_subscriptions(tier);

CREATE TABLE IF NOT EXISTS sb_user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    home_book TEXT,
    excluded_books TEXT[] DEFAULT '{}',
    alert_thresholds JSONB DEFAULT '{}'::jsonb,
    notification_channels TEXT[] DEFAULT '{email}',
    sms_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sb_billing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_invoice_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT,
    amount_cents INT,
    currency TEXT DEFAULT 'usd',
    status TEXT,
    tier TEXT,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    invoice_pdf_url TEXT,
    hosted_invoice_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sb_billing_user ON sb_billing_history(user_id, created_at DESC);

-- Auto-create free subscription + preferences row on user signup
CREATE OR REPLACE FUNCTION sb_handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO sb_subscriptions (user_id, tier, status)
    VALUES (NEW.id, 'free', 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO sb_user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sb_handle_new_user();

ALTER TABLE sb_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_billing_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_sub_self_read ON sb_subscriptions;
CREATE POLICY sb_sub_self_read ON sb_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_pref_self_all ON sb_user_preferences;
CREATE POLICY sb_pref_self_all ON sb_user_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sb_bill_self_read ON sb_billing_history;
CREATE POLICY sb_bill_self_read ON sb_billing_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
