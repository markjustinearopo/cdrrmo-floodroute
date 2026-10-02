// A heuristic conversion, not a measured depth or validated passability rule.
export const DEPTH_PER_RISK = 0.83

export function estDepthFromRisk(risk) {
  return Math.max(0, risk * DEPTH_PER_RISK)
}
