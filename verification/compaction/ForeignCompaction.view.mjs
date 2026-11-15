export const title = 'Compact with another model without approving SDK recovery';
export const state = v => {
  if (v.opened) return 'Unsafe SDK request';
  if (v.phase === 'ready') return 'Compaction requested';
  if (v.phase === 'rejected') return v.complete && v.provider === 'foreign' ? 'New model wrongly blocked' : 'Unsafe request blocked';
  if (v.phase === 'summarizing') return 'New model summarizing';
  if (v.phase === 'published') return 'Summary saved, receipt pending';
  if (v.phase === 'failed') return v.saved === 'original' ? 'Stopped or failed, history intact' : 'Failed, history changed';
  return 'Other models usable, SDK blocked';
};
export const step = action => ({
  Prepare: 'check history',
  SaveSummary: 'save the summary',
  SaveReceipt: 'save SDK block',
  SummaryFailsOrStops: 'summary fails or you press Stop',
  Restart: 'process restarts',
  TrySDK: 'try Claude SDK',
  SwitchModel: null,
  Done: null,
})[action] ?? null;
