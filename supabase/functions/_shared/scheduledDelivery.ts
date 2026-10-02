export function deliveryOutcome(result: Record<string, unknown>, ok: boolean) {
  if (!ok || result.error || Number(result.failed || 0) > 0) return 'failed'
  if (result.simulated === true || Number(result.simulated || 0) > 0) return 'failed'
  if (result.skipped || (Number(result.sent || 0) === 0 && Number(result.queued || 0) === 0)) return 'skipped'
  return 'accepted'
}
