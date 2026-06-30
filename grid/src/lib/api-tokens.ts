// GridCensus API tokens — adapted from AutomateDojo lib/api-tokens.ts.
// Prefix gck_live_; sha256-hashed at rest; raw shown once on creation.

import "server-only";
import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "gck_live_";

export interface NewToken {
  raw: string; // returned ONCE on creation
  prefix: string; // stored for display + lookup
  hash: string; // sha256, stored in token_hash
}

export function generateToken(): NewToken {
  const random = randomBytes(24).toString("base64url");
  const raw = `${TOKEN_PREFIX}${random}`;
  const prefix = raw.slice(0, TOKEN_PREFIX.length + 8);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, prefix, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function hasScope(scopes: string[], required: string): boolean {
  if (scopes.includes("*")) return true;
  return scopes.includes(required);
}

export function isGcToken(raw: string): boolean {
  return typeof raw === "string" && raw.startsWith(TOKEN_PREFIX);
}
