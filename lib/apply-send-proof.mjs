/**
 * Send proof helpers shared by the dashboard server and its tests.
 */

// The 409 body for /api/apply/start when the offer's latest run already sent.
export function applyRelaunchBlock(prior) {
  if (prior?.state !== 'submitted') return null;
  return {
    error: prior.unconfirmed
      ? `Already sent once (run ${prior.runId}), without a confirmation read: check the tab or your inbox before sending again.`
      : `Already sent (run ${prior.runId}, confirmation read).`,
    alreadySubmitted: true,
    runId: prior.runId,
  };
}
