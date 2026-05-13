"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

interface Tournament {
  id: string;
  tour: string;
  name: string;
  short_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_major: boolean;
  status: string;
  kalshi_event_ticker: string | null;
  dg_event_id: number | null;
}

export default function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/golfodds/tournaments")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setTournaments(d.tournaments || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="max-w-[1800px] mx-auto px-6 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-green-400 mb-1">Active Tournaments</h1>
          <p className="text-neutral-400 text-sm">
            Pick a tournament to compare Kalshi event-contract prices against sportsbook outright lines.
          </p>
        </header>

        {loading && <div className="text-neutral-400 text-sm">Loading…</div>}
        {error && <div className="text-rose-400 text-sm">Error: {error}</div>}

        {!loading && !error && tournaments.length === 0 && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-8 text-center">
            <p className="text-neutral-300 mb-2">No tournaments in the database yet.</p>
            <p className="text-neutral-500 text-sm">
              Run <code className="text-green-400">npm run ingest:kalshi &amp;&amp; npm run ingest:datagolf</code> from{" "}
              <code className="text-green-400">golfodds/</code> to pull current PGA Tour data.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tournaments.map((t) => (
            <Link
              key={t.id}
              href={`/tournament/?id=${t.id}`}
              className="block bg-neutral-900 border border-neutral-800 rounded-lg p-5 hover:border-green-500/50 hover:bg-neutral-900/80 transition"
            >
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-lg font-semibold text-neutral-100">{t.name}</h2>
                {t.is_major && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">Major</span>
                )}
              </div>
              <div className="text-xs text-neutral-500 mb-3 space-y-0.5">
                {t.start_date && (
                  <div>
                    {t.start_date}
                    {t.end_date && t.end_date !== t.start_date ? ` → ${t.end_date}` : ""}
                  </div>
                )}
                <div>Tour: {t.tour.toUpperCase()}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                {t.kalshi_event_ticker && (
                  <span className="bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded">
                    Kalshi: {t.kalshi_event_ticker}
                  </span>
                )}
                {t.dg_event_id != null && (
                  <span className="bg-sky-500/10 text-sky-300 px-2 py-0.5 rounded">
                    DG event {t.dg_event_id}
                  </span>
                )}
                <span className="bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded">{t.status}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
