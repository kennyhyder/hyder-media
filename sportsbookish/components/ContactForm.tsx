"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";

// Spam-resistant contact form. Pairs with /api/contact route:
//   - Honeypot input (visually hidden, off-screen) — bots fill it, humans don't
//   - rendered_at timestamp — must be >= 3 seconds before submission
//   - Server-side: origin check, content heuristics, IP rate limit, Resend send
export default function ContactForm() {
  const renderedAt = useRef<number>(Date.now());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [honey, setHoney] = useState("");  // bots will fill this; humans won't see it
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    renderedAt.current = Date.now();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, honey, rendered_at: renderedAt.current }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.error || "Failed to send. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("sent");
      setName("");
      setEmail("");
      setMessage("");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
        <Check className="h-10 w-10 text-emerald-500 mx-auto mb-3" aria-hidden="true" />
        <h3 className="text-lg font-semibold mb-1">Message sent</h3>
        <p className="text-sm text-muted-foreground">Thanks — I&apos;ll respond to your email within a couple of days.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Honeypot — visually hidden, bots fill it */}
      <div className="absolute left-[-9999px] w-px h-px opacity-0 pointer-events-none" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          type="text"
          id="contact-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honey}
          onChange={(e) => setHoney(e.target.value)}
        />
      </div>

      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input
          type="text"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Your email</span>
        <input
          type="email"
          required
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Message</span>
        <textarea
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2 focus:border-emerald-500 focus:outline-none font-sans"
        />
        <span className="text-xs text-muted-foreground mt-1 block">{message.length} / 5000</span>
      </label>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      <Button type="submit" disabled={status === "sending"} className="bg-emerald-600 hover:bg-emerald-500 text-white">
        {status === "sending" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : "Send message"}
      </Button>

      <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">
        I read every message but I don&apos;t always respond same-day. For account / billing issues, please include your account email so I can look you up.
      </p>
    </form>
  );
}
