"use client";

import { useMemo, useRef, useState } from "react";
import { CR, glass, labelStyle, mono } from "./theme";
import { STATES, StateInfo } from "@/lib/geo";

export type LayerKey = "sites" | "substations" | "lines" | "brownfields";

export interface LayerState {
  sites: boolean;
  substations: boolean;
  lines: boolean;
  brownfields: boolean;
}

const LAYER_META: {
  key: LayerKey;
  label: string;
  swatch: string;
  kind: "dot" | "line" | "diamond";
}[] = [
  { key: "sites", label: "Sites", swatch: "#A3E635", kind: "dot" },
  { key: "substations", label: "Substations", swatch: "#22D3EE", kind: "diamond" },
  { key: "lines", label: "Transmission", swatch: "#8B5CF6", kind: "line" },
  { key: "brownfields", label: "Brownfields", swatch: "#FB923C", kind: "dot" },
];

interface SearchHit {
  label: string;
  lat: number;
  lng: number;
  zoom: number;
}

export default function ControlPanel({
  layers,
  onToggleLayer,
  onJump,
}: {
  layers: LayerState;
  onToggleLayer: (k: LayerKey) => void;
  onJump: (lat: number, lng: number, zoom: number) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // State quick-match (instant).
  const stateMatches = useMemo<StateInfo[]>(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return STATES.filter(
      (st) => st.name.toLowerCase().includes(s) || st.code.toLowerCase() === s
    ).slice(0, 4);
  }, [q]);

  async function geocode() {
    const s = q.trim();
    if (!s) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q=${encodeURIComponent(
          s
        )}`,
        { signal: ctrl.signal, headers: { Accept: "application/json" } }
      );
      const data: { display_name: string; lat: string; lon: string }[] =
        await res.json();
      setHits(
        data.map((d) => ({
          label: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          zoom: 9,
        }))
      );
    } catch {
      /* aborted or network — ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        width: 300,
        maxWidth: "calc(100vw - 32px)",
        zIndex: 1200,
        ...glass,
        padding: 14,
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              color: CR.cyan,
              fontSize: 18,
              filter: "drop-shadow(0 0 6px rgba(34,211,238,0.7))",
            }}
          >
            ◆
          </span>
          <span
            style={{
              fontWeight: 700,
              letterSpacing: "0.14em",
              fontSize: 13,
              color: CR.text,
            }}
          >
            GRIDCENSUS
          </span>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse panel" : "Expand panel"}
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            border: `1px solid ${CR.border}`,
            background: "rgba(18,24,41,0.7)",
            color: CR.muted,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {open ? "–" : "+"}
        </button>
      </div>

      {open && (
        <>
          {/* Search */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (stateMatches.length) {
                const st = stateMatches[0];
                setQ(st.name);
                void geocodeState(st.name, onJump);
              } else {
                void geocode();
              }
            }}
          >
            <div style={{ position: "relative" }}>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHits([]);
                }}
                placeholder="Jump to state, city, or place…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 11px",
                  borderRadius: 9,
                  border: `1px solid ${CR.border}`,
                  background: "rgba(8,11,20,0.8)",
                  color: CR.text,
                  fontSize: 13,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              {busy && (
                <span
                  style={{
                    position: "absolute",
                    right: 10,
                    top: 9,
                    fontSize: 11,
                    color: CR.cyan,
                    fontFamily: mono,
                  }}
                >
                  …
                </span>
              )}
            </div>
          </form>

          {/* Quick state matches */}
          {stateMatches.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {stateMatches.map((st) => (
                <button
                  key={st.code}
                  onClick={() => {
                    setQ(st.name);
                    void geocodeState(st.name, onJump);
                  }}
                  style={{
                    padding: "4px 9px",
                    borderRadius: 999,
                    border: `1px solid ${CR.cyan}55`,
                    background: "rgba(34,211,238,0.1)",
                    color: CR.cyan,
                    fontSize: 11.5,
                    cursor: "pointer",
                    fontFamily: mono,
                  }}
                >
                  {st.code} · {st.name}
                </button>
              ))}
            </div>
          )}

          {/* Geocode hits */}
          {hits.length > 0 && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 160,
                overflowY: "auto",
                borderRadius: 9,
                border: `1px solid ${CR.border}`,
              }}
            >
              {hits.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onJump(h.lat, h.lng, h.zoom);
                    setHits([]);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${CR.border}`,
                    color: CR.text,
                    fontSize: 12,
                    cursor: "pointer",
                    lineHeight: 1.3,
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>
          )}

          {/* Layer toggles */}
          <div style={{ ...labelStyle, margin: "14px 0 8px" }}>Layers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {LAYER_META.map((m) => {
              const on = layers[m.key];
              return (
                <button
                  key={m.key}
                  onClick={() => onToggleLayer(m.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: `1px solid ${on ? m.swatch + "66" : CR.border}`,
                    background: on ? m.swatch + "14" : "rgba(18,24,41,0.5)",
                    color: on ? CR.text : CR.muted,
                    cursor: "pointer",
                    fontSize: 13,
                    transition: "all 160ms ease",
                  }}
                >
                  <Swatch kind={m.kind} color={m.swatch} dim={!on} />
                  <span style={{ flex: 1, textAlign: "left", fontWeight: on ? 600 : 400 }}>
                    {m.label}
                  </span>
                  <span
                    style={{
                      width: 30,
                      height: 17,
                      borderRadius: 999,
                      background: on ? m.swatch : CR.border,
                      position: "relative",
                      transition: "background 160ms ease",
                      flex: "0 0 auto",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: on ? 15 : 2,
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        background: "#0A0E1A",
                        transition: "left 160ms ease",
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Geocode a state name via Nominatim then fly the map there.
async function geocodeState(
  name: string,
  onJump: (lat: number, lng: number, zoom: number) => void
) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&state=${encodeURIComponent(
        name
      )}`,
      { headers: { Accept: "application/json" } }
    );
    const data: { lat: string; lon: string }[] = await res.json();
    if (data[0]) onJump(parseFloat(data[0].lat), parseFloat(data[0].lon), 6);
  } catch {
    /* ignore */
  }
}

function Swatch({
  kind,
  color,
  dim,
}: {
  kind: "dot" | "line" | "diamond";
  color: string;
  dim: boolean;
}) {
  const op = dim ? 0.4 : 1;
  if (kind === "line") {
    return (
      <span
        style={{
          width: 16,
          height: 3,
          borderRadius: 2,
          background: color,
          opacity: op,
          flex: "0 0 auto",
        }}
      />
    );
  }
  if (kind === "diamond") {
    return (
      <span
        style={{
          width: 11,
          height: 11,
          background: color,
          opacity: op,
          transform: "rotate(45deg)",
          borderRadius: 2,
          flex: "0 0 auto",
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: 11,
        height: 11,
        borderRadius: "50%",
        background: color,
        opacity: op,
        boxShadow: dim ? "none" : `0 0 7px ${color}`,
        flex: "0 0 auto",
      }}
    />
  );
}
