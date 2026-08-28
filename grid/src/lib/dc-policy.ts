// Datacenter regulatory-climate layer (Phase 1) — Jon De Pena's ask: which
// jurisdictions are supportive of DC development, gated by MEGAWATT size, since
// restrictions overwhelmingly kick in above a MW threshold.
//
// This is a CURATED state-level dataset (posture + incentive + MW threshold),
// seeded from a 2026 policy scan (MultiState, Good Jobs First, SEPA DELTa, law-
// firm alerts). It is a screening signal that changes frequently — surface it
// with an "as of" date, not as legal advice. Phase 2 adds the county-level
// moratorium layer (Bommar CC-BY dataset) and a MW-slider heat map.
//
// Sources: TX SB6 (McGuireWoods/Bracewell); VA electricity tax + GS-5 (Holland &
// Knight); OH AEP tariff + incentive pause; AZ/IL exemption suspensions; NY
// moratorium (Rockefeller Inst.). As of 2026-08.

export type Posture = "favorable" | "moderate" | "restrictive";

export interface StatePolicy {
  posture: Posture;
  /** one-line current posture summary */
  summary: string;
  /** has a datacenter tax incentive (sales/use-tax exemption etc.) */
  incentive: boolean;
  /** MW size at/above which extra obligations, tariffs, or scrutiny trigger */
  mwThreshold?: number;
  /** what triggers at the threshold */
  thresholdNote?: string;
}

// BUMP THIS on ANY edit to the policy dataset below — Watchtower snapshots key
// on it to detect regulatory changes and email watchers (see vet-signals.ts).
export const DC_POLICY_AS_OF = "2026-08";

// Only states with a notable, sourced posture are listed; others fall back to a
// neutral "moderate / no notable statewide restriction" default.
const DC_POLICY: Record<string, StatePolicy> = {
  TX: {
    posture: "favorable",
    summary: "No moratorium; fastest US interconnection (ERCOT). SB 6 adds large-load obligations above 75 MW.",
    incentive: true,
    mwThreshold: 75,
    thresholdNote: "SB 6: loads ≥75 MW accept ERCOT emergency curtailment + contribute to interconnection cost.",
  },
  GA: {
    posture: "favorable",
    summary: "Active incentives; Georgia Power courts large load with bring-your-own clean-energy options.",
    incentive: true,
    mwThreshold: 100,
    thresholdNote: "Georgia Power billing/contract rules apply to very large loads.",
  },
  VA: {
    posture: "moderate",
    summary: "Largest US DC market; incentive preserved but a new $0.011/kWh DC electricity tax starts Jul 2026.",
    incentive: true,
    mwThreshold: 25,
    thresholdNote: "Dominion GS-5 large-load rate (≥25 MW, ~$1.5M/MW collateral, 14-yr term) effective 2027.",
  },
  OH: {
    posture: "moderate",
    summary: "DC tax incentives paused for 2026; AEP Ohio large-load tariff in force.",
    incentive: false,
    mwThreshold: 25,
    thresholdNote: "AEP Ohio tariff: ≥25 MW, 85% take-or-pay, on-site-gen curtailment sync.",
  },
  AZ: {
    posture: "restrictive",
    summary: "Sales-tax exemption suspended Jul 2026–Jun 2029; water constraints add scrutiny.",
    incentive: false,
  },
  IL: {
    posture: "restrictive",
    summary: "New-DC state tax exemptions suspended for 2 years (from Jul 2026).",
    incentive: false,
  },
  NY: {
    posture: "restrictive",
    summary: "First statewide moratorium (2026): 1-yr hold on certain permits for large DCs + impact study.",
    incentive: false,
    mwThreshold: 50,
    thresholdNote: "Moratorium/permit hold targets large datacenters.",
  },
  TN: {
    posture: "favorable",
    summary: "TVA territory, DC-friendly; fast vertically-integrated interconnection.",
    incentive: true,
    mwThreshold: 50,
    thresholdNote: "TVA infrastructure-cost provisions apply to very large loads.",
  },
  SC: {
    posture: "favorable",
    summary: "Southeast, DC-friendly with active incentives and vertically-integrated utilities.",
    incentive: true,
  },
  AL: {
    posture: "moderate",
    summary: "Incentives available; PSC review for very large loads.",
    incentive: true,
    mwThreshold: 150,
    thresholdNote: "Alabama PSC review threshold for large loads.",
  },
  IA: { posture: "favorable", summary: "Strong incentives; utilities courting hyperscale load.", incentive: true },
  NE: { posture: "favorable", summary: "Public-power incentives; DC-friendly.", incentive: true },
  ND: { posture: "favorable", summary: "Cheap power, land, and cold climate; DC-friendly.", incentive: true },
  WY: { posture: "favorable", summary: "Low-cost power and land; DC-friendly posture.", incentive: true },
  MN: { posture: "moderate", summary: "Incentives available; large-load tariffs emerging.", incentive: true, mwThreshold: 50 },
};

const DEFAULT_POLICY: StatePolicy = {
  posture: "moderate",
  summary: "No notable statewide DC restriction on record; confirm local zoning and utility tariffs.",
  incentive: false,
};

export function statePolicy(state: string | null | undefined): StatePolicy {
  if (!state) return DEFAULT_POLICY;
  return DC_POLICY[state.toUpperCase()] ?? DEFAULT_POLICY;
}

export interface RegulatoryClimate {
  posture: Posture;
  /** effective posture after applying the MW-threshold gate */
  effective: Posture;
  label: string;
  summary: string;
  incentive: boolean;
  /** set when the target MW trips a threshold */
  gated?: string;
}

/**
 * Regulatory climate for a state at a given target build size. The MW gate can
 * escalate a favorable/moderate posture when the build exceeds a threshold that
 * triggers extra obligations (e.g. Texas SB 6 above 75 MW).
 */
export function regulatoryClimate(
  state: string | null | undefined,
  targetMw?: number | null
): RegulatoryClimate {
  const p = statePolicy(state);
  let effective = p.posture;
  let gated: string | undefined;

  if (targetMw != null && p.mwThreshold != null && targetMw >= p.mwThreshold) {
    // Escalate one step of caution when the build trips the threshold.
    effective = p.posture === "favorable" ? "moderate" : p.posture === "moderate" ? "restrictive" : "restrictive";
    gated = `At ${targetMw.toLocaleString()} MW (≥ ${p.mwThreshold} MW): ${p.thresholdNote ?? "additional large-load obligations apply."}`;
  }

  const LABEL: Record<Posture, string> = {
    favorable: "Favorable",
    moderate: "Moderate",
    restrictive: "Restrictive",
  };

  return {
    posture: p.posture,
    effective,
    label: LABEL[effective],
    summary: p.summary,
    incentive: p.incentive,
    gated,
  };
}
