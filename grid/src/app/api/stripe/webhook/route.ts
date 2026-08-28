// Stripe webhook — subscription lifecycle -> gc_users plan state.
// Signature verified manually (HMAC-SHA256 of `${t}.${rawBody}`), no SDK.
// Events: checkout.session.completed, customer.subscription.updated,
//         customer.subscription.deleted
// Role mapping: Pro subscription active -> role 'owner' (existing tier system;
// 25 watches, 5k export). Cancel/unpaid -> back to 'member'. Never touches
// enterprise/moderator/staff roles.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { gcRead, gcWrite } from "@/lib/auth";

export const dynamic = "force-dynamic";

function verify(rawBody: string, sigHeader: string | null, secret: string): boolean {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=")];
    })
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // Reject stale timestamps (>5 min) — replay protection.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

interface SubObject {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
}

async function setPlanByUserId(
  userId: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const res = await gcWrite("gc_users", "PATCH", fields, { id: `eq.${userId}` });
  return res !== null;
}

/** Upgrade only member/contributor; downgrade only owner. */
async function transitionRole(userId: string, dir: "up" | "down"): Promise<void> {
  const rows = await gcRead<{ role: string }>("gc_users", {
    id: `eq.${userId}`,
    select: "role",
    limit: "1",
  });
  const role = rows[0]?.role;
  if (dir === "up" && (role === "member" || role === "contributor")) {
    await setPlanByUserId(userId, { role: "owner" });
  } else if (dir === "down" && role === "owner") {
    await setPlanByUserId(userId, { role: "member" });
  }
}

async function userIdForSub(sub: SubObject): Promise<string | null> {
  if (sub.metadata?.gc_user_id) return sub.metadata.gc_user_id;
  const bySub = await gcRead<{ id: string }>("gc_users", {
    stripe_sub_id: `eq.${sub.id}`,
    select: "id",
    limit: "1",
  });
  if (bySub[0]) return bySub[0].id;
  const byCust = await gcRead<{ id: string }>("gc_users", {
    stripe_customer_id: `eq.${sub.customer}`,
    select: "id",
    limit: "1",
  });
  return byCust[0]?.id ?? null;
}

export async function POST(req: Request) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const rawBody = await req.text();
  if (!verify(rawBody, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as {
          client_reference_id?: string;
          customer?: string;
          subscription?: string;
          mode?: string;
        };
        if (s.mode === "subscription" && s.client_reference_id) {
          await setPlanByUserId(s.client_reference_id, {
            stripe_customer_id: s.customer ?? null,
            stripe_sub_id: s.subscription ?? null,
            plan_status: "active",
          });
          await transitionRole(s.client_reference_id, "up");
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as unknown as SubObject;
        const userId = await userIdForSub(sub);
        if (userId) {
          await setPlanByUserId(userId, { plan_status: sub.status, stripe_sub_id: sub.id });
          if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
            await transitionRole(userId, "down");
          } else if (["active", "trialing"].includes(sub.status)) {
            await transitionRole(userId, "up");
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as SubObject;
        const userId = await userIdForSub(sub);
        if (userId) {
          await setPlanByUserId(userId, { plan_status: "canceled" });
          await transitionRole(userId, "down");
        }
        break;
      }
      default:
        break; // ignore unhandled events
    }
  } catch (e) {
    console.error("[stripe] webhook handler error:", event.type, e);
    // 200 anyway — Stripe retries on non-2xx and our handlers are idempotent,
    // but a persistent bug shouldn't build an infinite retry queue.
  }

  return NextResponse.json({ received: true });
}
