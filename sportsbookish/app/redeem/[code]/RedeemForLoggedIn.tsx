"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function RedeemForLoggedIn({ code, email }: { code: string; email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClaim() {
    setLoading(true);
    try {
      const r = await fetch(`/api/invites/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(data.error || "Couldn't apply invite");
        return;
      }
      toast.success(`Applied — you're now on ${data.tier.toUpperCase()}!`);
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Signed in as <strong className="text-foreground">{email}</strong>. Click below to apply your invite to this account.</p>
      <Button onClick={handleClaim} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white">
        {loading ? "Applying…" : "Apply invite to my account"}
      </Button>
    </div>
  );
}
