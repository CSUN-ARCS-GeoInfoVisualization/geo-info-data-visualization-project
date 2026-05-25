/**
 * Canonical 5-tier risk model, modeled after the National Fire Danger
 * Rating System (NFDRS) that CAL FIRE, NIFC, and NWS Red Flag products
 * use. Five clean equal-width bands (20% each) so a user reading "High"
 * or "Extreme" maps it to the same mental model used by the agencies
 * issuing the underlying advisories.
 *
 * Backend source of truth lives in backend/routes/locations.py
 * (_TIER_THRESHOLDS) and backend/ml/inference.py (risk_label). Every
 * frontend surface — polygon overlays, legends, badges, alert email
 * subjects — pulls from here so they can never drift apart.
 *
 * Cutoff is INCLUSIVE: a score >= cutoff matches that tier. The list
 * is ordered highest-to-lowest so a top-down scan returns the first match.
 */
export interface RiskTier {
  cutoff: number;
  label: string;
  hex: string;
  rgba: [number, number, number, number];
}

export const RISK_TIERS_DESC: RiskTier[] = [
  { cutoff: 0.80, label: "Extreme",   hex: "#7f1d1d", rgba: [127,  29,  29, 200] },
  { cutoff: 0.60, label: "Very High", hex: "#dc2626", rgba: [220,  38,  38, 180] },
  { cutoff: 0.40, label: "High",      hex: "#f97316", rgba: [249, 115,  22, 160] },
  { cutoff: 0.20, label: "Moderate",  hex: "#facc15", rgba: [250, 204,  21, 140] },
  { cutoff: 0.00, label: "Low",       hex: "#22c55e", rgba: [ 34, 197,  94, 120] },
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
