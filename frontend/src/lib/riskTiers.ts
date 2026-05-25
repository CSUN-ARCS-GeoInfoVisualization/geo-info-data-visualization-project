/**
 * Canonical 9-tier risk model. Backend source of truth lives in
 * backend/routes/locations.py (_TIER_THRESHOLDS); every frontend surface
 * — polygon overlays, legends, badges — should pull colors and labels
 * from here so they can never drift apart.
 *
 * Thresholds and labels mirror the backend. Colors mirror the slider
 * tiers in notification-settings.tsx so the user sees the same green→
 * yellow→orange→red progression they pick in settings.
 *
 * Cutoff is INCLUSIVE: a score >= cutoff matches that tier. The list
 * is ordered highest-to-lowest so a top-down scan returns the first match.
 */
export interface RiskTier {
  /** Inclusive lower bound on risk_score (0..1). */
  cutoff: number;
  /** Human-readable label. */
  label: string;
  /** Hex color for legends / badges. */
  hex: string;
  /** RGBA tuple for deck.gl polygon fills (alpha tuned for translucent overlays). */
  rgba: [number, number, number, number];
}

export const RISK_TIERS_DESC: RiskTier[] = [
  { cutoff: 0.95, label: "Catastrophic", hex: "#991b1b", rgba: [153, 27, 27, 200] },
  { cutoff: 0.90, label: "Critical",     hex: "#dc2626", rgba: [220, 38, 38, 190] },
  { cutoff: 0.85, label: "Extreme",      hex: "#f87171", rgba: [248, 113, 113, 180] },
  { cutoff: 0.80, label: "Severe",       hex: "#c2410c", rgba: [194, 65, 12, 170] },
  { cutoff: 0.75, label: "Very High",    hex: "#f97316", rgba: [249, 115, 22, 165] },
  { cutoff: 0.70, label: "High",         hex: "#fb923c", rgba: [251, 146, 60, 160] },
  { cutoff: 0.65, label: "Elevated",     hex: "#ca8a04", rgba: [202, 138, 4, 150] },
  { cutoff: 0.55, label: "Guarded",      hex: "#facc15", rgba: [250, 204, 21, 140] },
  { cutoff: 0.00, label: "Low",          hex: "#22c55e", rgba: [34, 197, 94, 130] },
];

/** Same list but ordered low → high for legend rendering. */
export const RISK_TIERS_ASC: RiskTier[] = [...RISK_TIERS_DESC].reverse();

/** Lookup a tier by a 0..1 risk score. */
export function tierForScore(score: number): RiskTier {
  for (const t of RISK_TIERS_DESC) {
    if (score >= t.cutoff) return t;
  }
  return RISK_TIERS_DESC[RISK_TIERS_DESC.length - 1];
}

/** RGBA polygon color (deck.gl format) for a 0..1 score. */
export function riskRgba(score: number): [number, number, number, number] {
  return tierForScore(score).rgba;
}
