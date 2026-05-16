"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";
import type { ApiTierKey } from "@/lib/tiers";

interface KeyRow {
  id: number;
  name: string;
  key_prefix: string;
  tier: ApiTierKey;
  monthly_quota: number;
  status: "active" | "revoked";
  last_used_at: string | null;
  created_at: string;
  current_month_usage: number;
}

export default function ApiKeysClient({
  tier,
  maxKeys,
  initialKeys,
}: {
  tier: ApiTierKey;
  maxKeys: number;
  initialKeys: KeyRow[];
}) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const activeKeys = keys.filter((k) => k.status === "active");
  const atMax = activeKeys.length >= maxKeys;

  async function createKey() {
    setCreating(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled key" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to create key");
      setRevealedKey({ name: data.key.name, plaintext: data.key.plaintext });
      setKeys([
        {
          id: data.key.id,
          name: data.key.name,
          key_prefix: data.key.key_prefix,
          tier: data.key.tier,
          monthly_quota: data.key.monthly_quota,
          status: "active",
          last_used_at: null,
          created_at: data.key.created_at,
          current_month_usage: 0,
        },
        ...keys,
      ]);
      setName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: number) {
    if (!confirm("Revoke this key? Any apps using it will start receiving 401.")) return;
    try {
      const r = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to revoke key");
      setKeys(keys.map((k) => (k.id === id ? { ...k, status: "revoked" } : k)));
      toast.success("Key revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function copyPlaintext() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Create a new key</CardTitle>
          <CardDescription>
            Label it for the app or environment it'll be used in (e.g., &quot;Production scraper&quot;).
            {atMax && ` You're at the maximum of ${maxKeys} active key${maxKeys === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Key name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating || atMax}
              className="max-w-xs"
            />
            <Button onClick={createKey} disabled={creating || atMax} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              {creating ? "Creating…" : "Create key"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {revealedKey && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="text-emerald-300">Key created — copy it now</CardTitle>
            <CardDescription>
              This is the only time you&apos;ll see the full key. Store it somewhere safe; we only keep the hash.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background border border-border px-3 py-2 text-sm font-mono break-all">
                {revealedKey.plaintext}
              </code>
              <Button size="sm" variant="outline" onClick={copyPlaintext}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setRevealedKey(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              I&apos;ve saved it — dismiss
            </button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>
            {activeKeys.length} active · {keys.length - activeKeys.length} revoked
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet. Create one above to get started.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {keys.map((k) => {
                const pct = k.monthly_quota > 0 ? Math.min(100, Math.round((k.current_month_usage / k.monthly_quota) * 100)) : 0;
                const isRevoked = k.status === "revoked";
                return (
                  <li key={k.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm">{k.name}</div>
                        {isRevoked && <Badge variant="outline" className="border-red-500/40 text-red-300 text-[10px]">REVOKED</Badge>}
                        <Badge variant="outline" className="text-[10px]">{k.tier}</Badge>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">{k.key_prefix}…</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Created {new Date(k.created_at).toLocaleDateString()} ·
                        {" "}
                        {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}
                      </div>
                      {!isRevoked && (
                        <div className="mt-1.5">
                          <div className="text-[11px] text-muted-foreground mb-0.5">
                            {k.current_month_usage.toLocaleString()} / {k.monthly_quota.toLocaleString()} requests this month ({pct}%)
                          </div>
                          <div className="h-1 w-full bg-border/40 rounded overflow-hidden">
                            <div className={`h-full ${pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                    {!isRevoked && (
                      <Button size="sm" variant="outline" onClick={() => revokeKey(k.id)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
