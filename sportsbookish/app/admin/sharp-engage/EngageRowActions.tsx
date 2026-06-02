"use client";

import { useState } from "react";

interface Props {
  tweetId: string;
  authorHandle: string;
  draftReply: string;
}

// Three actions per row:
//   1. Copy draft to clipboard + open the tweet on X — paste-and-send manually
//   2. Edit + copy (lets you tweak the draft before copying)
//   3. Skip (marks the queue row dismissed)
//
// We deliberately don't auto-post these — peer engagement should be in
// Kenny's voice, not the bot's. The system drafts; Kenny ships.
export default function EngageRowActions({ tweetId, authorHandle, draftReply }: Props) {
  const [text, setText] = useState(draftReply);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const tweetUrl = `https://x.com/${authorHandle}/status/${tweetId}`;

  const copyAndOpen = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* fallback below */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.open(tweetUrl, "_blank", "noopener");
  };

  const dismiss = async () => {
    setDismissing(true);
    try {
      await fetch(`/api/admin/sharp-engage/dismiss?tweet_id=${tweetId}`, { method: "POST" });
      setDismissed(true);
    } catch { /* leave row visible if API fails */ }
    setDismissing(false);
  };

  if (dismissed) {
    return <div className="text-xs text-muted-foreground italic">Dismissed.</div>;
  }

  return (
    <div className="space-y-2">
      {editing && (
        <textarea
          className="w-full rounded border border-border/60 bg-background p-2 text-sm font-mono"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={copyAndOpen}
          className="rounded-md bg-emerald-500 hover:bg-emerald-600 text-emerald-950 px-3 py-1.5 text-xs font-medium"
        >
          {copied ? "✓ Copied — open X tab" : "Copy + open on X →"}
        </button>
        <button
          onClick={() => setEditing(!editing)}
          className="rounded-md border border-border/60 hover:bg-muted px-3 py-1.5 text-xs"
        >
          {editing ? "Done editing" : "Edit"}
        </button>
        <button
          onClick={dismiss}
          disabled={dismissing}
          className="rounded-md border border-border/60 hover:bg-rose-500/10 hover:border-rose-500/40 px-3 py-1.5 text-xs text-muted-foreground"
        >
          {dismissing ? "..." : "Skip"}
        </button>
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener"
          className="text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          View tweet ↗
        </a>
      </div>
    </div>
  );
}
