const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { syncDelhiFares } = require('../services/delhiFareSyncService');
const { createSyncLog, getSyncLog } = require('../repositories/syncLogRepository');

function runInBackground(label, fn) {
  fn().then(
    (result) => logger.info(`[syncController] ${label} completed — ${result.recordsProcessed} records`),
    (err) => logger.error(`[syncController] ${label} failed`, { error: err.message }),
  );
}

const triggerDelhiFareSync = asyncHandler(async (req, res) => {
  const logId = await createSyncLog({ supplier: 'tripjack', syncType: 'delhi_fares' });
  logger.info(`Delhi fare sync triggered [logId=${logId}]`);
  runInBackground('Delhi fare sync', () => syncDelhiFares(logId));
  return response(res, true, 202, 'Delhi fare sync started', { logId });
});

const getSyncStatus = asyncHandler(async (req, res) => {
  const { logId } = req.params;
  const log = await getSyncLog(logId);

  if (!log.completed_at) {
    const ageMs = Date.now() - new Date(log.started_at).getTime();
    // A full catalogue sync can run considerably longer than hotel-sync's
    // hotel content sync since each package needs its own live provider
    // call; give it a generous window before calling it timed out.
    if (ageMs > 60 * 60 * 1000) {
      return response(res, false, 200, 'Sync timed out (no completion recorded)', { status: 'failed', logId });
    }
    return response(res, true, 200, 'Sync still in progress', { status: 'in_progress', logId });
  }

  if (!log.success) {
    return response(res, false, 200, 'Sync failed', { status: 'failed', logId, error: log.error_message });
  }

  return response(res, true, 200, 'Sync completed', { status: 'success', logId, recordsProcessed: log.records_processed });
});

module.exports = { triggerDelhiFareSync, getSyncStatus };
