-- GA4 OAuth connection storage.
-- Mirrors the shape of google_ads_connections so token refresh logic is identical.
-- One row per Google account that has authorized GA4 access for this app.
CREATE TABLE IF NOT EXISTS ga4_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    scope TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ga4_connections_email ON ga4_connections (email);
CREATE INDEX IF NOT EXISTS idx_ga4_connections_active ON ga4_connections (is_active);
