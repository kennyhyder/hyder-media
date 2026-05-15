"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type Source = "american" | "decimal" | "fractional" | "probability";

function americanToDecimal(a: number): number {
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}
function decimalToAmerican(d: number): number {
  if (d >= 2) return Math.round((d - 1) * 100);
  return -Math.round(100 / (d - 1));
}
function decimalToProb(d: number): number {
  return 1 / d;
}
function probToDecimal(p: number): number {
  return 1 / p;
}
function decimalToFractional(d: number): string {
  const numerator = d - 1;
  // Try to find a "nice" fraction up to denom 20
  for (let denom = 1; denom <= 20; denom++) {
    const num = numerator * denom;
    if (Math.abs(num - Math.round(num)) < 0.01) {
      return `${Math.round(num)}/${denom}`;
    }
  }
  // Fall back to two-decimal numerator over 1
  return `${(numerator).toFixed(2)}/1`;
}
function fractionalToDecimal(frac: string): number | null {
  const parts = frac.split("/").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n)) || parts[1] === 0) return null;
  return parts[0] / parts[1] + 1;
}

export default function OddsConverterClient() {
  const [american, setAmerican] = useState<string>("-110");
  const [decimal, setDecimal] = useState<string>("1.909");
  const [fractional, setFractional] = useState<string>("10/11");
  const [probability, setProbability] = useState<string>("52.38");

  function recomputeFrom(source: Source, raw: string) {
    let d: number | null = null;
    if (source === "american") {
      const a = parseFloat(raw);
      if (Number.isFinite(a) && a !== 0) d = americanToDecimal(a);
    } else if (source === "decimal") {
      const dec = parseFloat(raw);
      if (Number.isFinite(dec) && dec > 1) d = dec;
    } else if (source === "fractional") {
      d = fractionalToDecimal(raw);
    } else if (source === "probability") {
      const p = parseFloat(raw) / 100;
      if (Number.isFinite(p) && p > 0 && p < 1) d = probToDecimal(p);
    }
    if (d == null) return;

    // Always update the source field with the user's exact input
    if (source !== "american") setAmerican(decimalToAmerican(d).toString());
    if (source !== "decimal") setDecimal(d.toFixed(3));
    if (source !== "fractional") setFractional(decimalToFractional(d));
    if (source !== "probability") setProbability((decimalToProb(d) * 100).toFixed(2));
  }

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="p-6 space-y-4">
        <Row
          label="American"
          value={american}
          onChange={(v) => { setAmerican(v); recomputeFrom("american", v); }}
          placeholder="-110"
          inputMode="numeric"
        />
        <Row
          label="Decimal"
          value={decimal}
          onChange={(v) => { setDecimal(v); recomputeFrom("decimal", v); }}
          placeholder="1.91"
          inputMode="decimal"
        />
        <Row
          label="Fractional"
          value={fractional}
          onChange={(v) => { setFractional(v); recomputeFrom("fractional", v); }}
          placeholder="10/11"
          inputMode="text"
        />
        <Row
          label="Implied probability"
          value={probability}
          onChange={(v) => { setProbability(v); recomputeFrom("probability", v); }}
          placeholder="52.38"
          inputMode="decimal"
          suffix="%"
        />
        <div className="text-xs text-muted-foreground pt-2 border-t border-border/40">
          Type into any field. All four formats update automatically.
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, onChange, placeholder, inputMode, suffix }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputMode: "numeric" | "decimal" | "text";
  suffix?: string;
}) {
  return (
    <label className="grid grid-cols-[140px_1fr] items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-xl font-mono tabular-nums focus:border-emerald-500 focus:outline-none"
          placeholder={placeholder}
        />
        {suffix && <span className="absolute right-3 top-2 text-xl font-mono text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}
