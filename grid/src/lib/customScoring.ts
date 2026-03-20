// Custom scoring weights for GridScout DC site re-scoring

export interface WeightProfile {
  name: string;
  weights: Record<string, number>;
}

export const SCORE_FACTOR_KEYS = [
  { key: "score_power", label: "Power Availability" },
  { key: "score_speed_to_power", label: "Speed to Power" },
  { key: "score_fiber", label: "Fiber Connectivity" },
  { key: "score_energy_cost", label: "Energy Cost" },
  { key: "score_water", label: "Water Risk" },
  { key: "score_hazard", label: "Natural Hazard" },
  { key: "score_buildability", label: "Buildability" },
  { key: "score_labor", label: "Labor Market" },
  { key: "score_existing_dc", label: "DC Cluster" },
  { key: "score_land", label: "Land / Acreage" },
  { key: "score_construction_cost", label: "Construction Cost" },
  { key: "score_gas_pipeline", label: "Gas Pipeline" },
  { key: "score_tax", label: "Tax Incentive" },
  { key: "score_climate", label: "Climate / Cooling" },
] as const;

export const DEFAULT_WEIGHTS: Record<string, number> = {
  score_power: 20,
  score_speed_to_power: 15,
  score_fiber: 12,
  score_energy_cost: 10,
  score_water: 8,
  score_hazard: 8,
  score_buildability: 7,
  score_labor: 4,
  score_existing_dc: 4,
  score_land: 3,
  score_construction_cost: 3,
  score_gas_pipeline: 2,
  score_tax: 2,
  score_climate: 2,
};

export const PRESET_PROFILES: WeightProfile[] = [
  {
    name: "Balanced",
    weights: { ...DEFAULT_WEIGHTS },
  },
  {
    name: "Power First",
    weights: {
      score_power: 40,
      score_speed_to_power: 25,
      score_fiber: 8,
      score_energy_cost: 8,
      score_water: 4,
      score_hazard: 3,
      score_buildability: 3,
      score_labor: 2,
      score_existing_dc: 2,
      score_land: 1,
      score_construction_cost: 1,
      score_gas_pipeline: 1,
      score_tax: 1,
      score_climate: 1,
    },
  },
  {
    name: "Low Risk",
    weights: {
      score_power: 10,
      score_speed_to_power: 5,
      score_fiber: 8,
      score_energy_cost: 8,
      score_water: 15,
      score_hazard: 20,
      score_buildability: 8,
      score_labor: 4,
      score_existing_dc: 4,
      score_land: 4,
      score_construction_cost: 4,
      score_gas_pipeline: 2,
      score_tax: 4,
      score_climate: 4,
    },
  },
  {
    name: "Speed to Market",
    weights: {
      score_power: 10,
      score_speed_to_power: 30,
      score_fiber: 10,
      score_energy_cost: 5,
      score_water: 3,
      score_hazard: 3,
      score_buildability: 20,
      score_labor: 5,
      score_existing_dc: 5,
      score_land: 3,
      score_construction_cost: 3,
      score_gas_pipeline: 1,
      score_tax: 1,
      score_climate: 1,
    },
  },
];

const STORAGE_KEY = "gridscout_weight_profiles";

/**
 * Recalculate a composite DC score using custom weights.
 * Normalizes weights to sum to 1.0, then computes weighted average of sub-scores.
 * Returns 0-100 composite score.
 */
export function recalcCustomScore(
  site: Record<string, number | string | null>,
  weights: Record<string, number>
): number {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return 0;

  let score = 0;
  for (const factor of SCORE_FACTOR_KEYS) {
    const subScore = Number(site[factor.key]) || 0;
    const weight = (weights[factor.key] || 0) / totalWeight;
    score += subScore * weight;
  }

  return Math.round(score * 10) / 10;
}

/**
 * Get normalized weight as a percentage string (e.g., "20%").
 */
export function normalizedWeightPct(
  key: string,
  weights: Record<string, number>
): string {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total === 0) return "0%";
  return `${Math.round((weights[key] / total) * 100)}%`;
}

/**
 * Save a custom weight profile to localStorage.
 */
export function saveWeightProfile(name: string, weights: Record<string, number>): void {
  const profiles = loadWeightProfiles();
  const existing = profiles.findIndex((p) => p.name === name);
  if (existing >= 0) {
    profiles[existing].weights = { ...weights };
  } else {
    profiles.push({ name, weights: { ...weights } });
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  }
}

/**
 * Load custom weight profiles from localStorage.
 */
export function loadWeightProfiles(): WeightProfile[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

/**
 * Delete a custom weight profile from localStorage.
 */
export function deleteWeightProfile(name: string): void {
  const profiles = loadWeightProfiles().filter((p) => p.name !== name);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  }
}

/**
 * Check if weights differ from default.
 */
export function isCustomWeights(weights: Record<string, number>): boolean {
  return SCORE_FACTOR_KEYS.some(
    (f) => (weights[f.key] || 0) !== (DEFAULT_WEIGHTS[f.key] || 0)
  );
}
