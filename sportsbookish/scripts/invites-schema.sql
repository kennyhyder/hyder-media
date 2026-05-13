-- Invite codes for granting free Elite (or any tier) memberships.
-- Distribute the URL  https://sportsbookish.com/redeem/<code>  to a recipient;
-- when they sign up via that URL, their sb_subscriptions row is upgraded to
-- the code's tier and the uses counter increments.

CREATE TABLE IF NOT EXISTS sb_invite_codes (
  code         TEXT PRIMARY KEY,
  tier         TEXT NOT NULL DEFAULT 'elite' CHECK (tier IN ('free','pro','elite')),
  label        TEXT,                          -- internal note ("friends", "press", etc.)
  max_uses     INT  NOT NULL DEFAULT 1,
  uses         INT  NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,
  created_by   UUID,                          -- nullable; can be your auth.users id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_sb_invite_codes_active
  ON sb_invite_codes (code)
  WHERE NOT disabled;

-- Track each redemption (one row per use) so we can audit who got what.
CREATE TABLE IF NOT EXISTS sb_invite_redemptions (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL REFERENCES sb_invite_codes(code) ON DELETE CASCADE,
  user_id     UUID NOT NULL,                  -- references auth.users(id)
  tier        TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, user_id)                      -- a user can't redeem the same code twice
);
CREATE INDEX IF NOT EXISTS idx_sb_invite_redemptions_user ON sb_invite_redemptions(user_id);

-- RLS: invite codes are read by the service role only (server-side validation).
-- Anonymous redemption goes through our API which uses the service-role client.
ALTER TABLE sb_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sb_invite_redemptions ENABLE ROW LEVEL SECURITY;
-- (No policies = no public access; service role bypasses RLS.)
