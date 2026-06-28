// Create a claim on an owned entity (datacenter / IXP / company).
// POST { entity_type, entity_id, entity_domain?, claimant_email? }
//   -> { status, verification_method }
//
// Verification tier (spec A3): if the claimant's email domain matches the
// entity website domain, grant an instant low-trust "email_verified" claim.
// Otherwise the claim stays "pending" for DNS/manual verification.

import { NextResponse } from "next/server";
import { getCurrentUser, gcWrite, gcRead } from "@/lib/auth";
import type { EntityType } from "@/lib/overrides";

const CLAIMABLE = new Set<EntityType>(["datacenter", "ixp", "company"]);

function apexDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* not a URL; treat as bare domain or email domain below */
  }
  host = host.replace(/^www\./, "");
  // if it's an email, take the part after @
  if (host.includes("@")) host = host.split("@")[1];
  return host || null;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let body: {
    entity_type?: string;
    entity_id?: string;
    entity_domain?: string;
    claimant_email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const entityType = body.entity_type as EntityType;
  const entityId = body.entity_id;
  if (!entityType || !CLAIMABLE.has(entityType) || !entityId) {
    return NextResponse.json({ error: "not_claimable" }, { status: 400 });
  }

  const claimantEmail = body.claimant_email || user.email || "";
  const claimantDomain = apexDomain(claimantEmail);
  const entityDomain = apexDomain(body.entity_domain);

  // Free public-email domains never auto-verify a claim.
  const FREE = new Set([
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "proton.me", "protonmail.com", "aol.com",
  ]);
  const emailMatch =
    !!claimantDomain &&
    !!entityDomain &&
    claimantDomain === entityDomain &&
    !FREE.has(claimantDomain);

  const status = emailMatch ? "email_verified" : "pending";
  const verificationMethod = emailMatch ? "email_domain" : null;

  // Already have a non-rejected claim? Return it (idempotent-ish).
  const existing = await gcRead<{ id: string; status: string }>("gc_entity_claims", {
    user_id: `eq.${user.id}`,
    entity_type: `eq.${entityType}`,
    entity_id: `eq.${entityId}`,
    status: "neq.rejected",
    select: "id,status",
    limit: "1",
  });
  if (existing.length) {
    return NextResponse.json({ status: existing[0].status, existing: true });
  }

  const ins = await gcWrite("gc_entity_claims", "POST", {
    entity_type: entityType,
    entity_id: entityId,
    user_id: user.id,
    status,
    verification_method: verificationMethod,
    claimant_email: claimantEmail || null,
    claimed_domain: entityDomain,
    verified_at: emailMatch ? new Date().toISOString() : null,
  });
  if (ins === null) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  // Best-effort audit log (graceful).
  await gcWrite("gc_activity_log", "POST", {
    actor_id: user.id,
    action: "claim_created",
    entity_type: entityType,
    entity_id: entityId,
    detail: { status, verification_method: verificationMethod },
  });

  return NextResponse.json({ status, verification_method: verificationMethod });
}
