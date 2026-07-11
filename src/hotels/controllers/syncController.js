const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { syncCities, syncHotels, syncSingleCity, syncDeletedHotels, syncNationalities } = require('../services/syncService');
const { createSyncLog, getSyncLog } = require('../repositories/syncLogRepository');
const { purgeExpiredDetailCache } = require('../repositories/hotelRepository');
const { ENDPOINTS } = require('../providers/tripjack/tripjackHotelConfig');

function runInBackground(label, fn) {
  fn().then(
    (result) => logger.info(`[syncController] ${label} completed — ${result.recordsProcessed} records`),
    (err)    => logger.error(`[syncController] ${label} failed`, { error: err.message }),
  );
}

const triggerCitySync = asyncHandler(async (req, res) => {
  const mode = req.query.mode;
  const logId = await createSyncLog({
    supplier: 'tripjack', syncType: 'cities',
    requestUrl: ENDPOINTS.CITY_LIST, requestPayload: { mode },
  });
  logger.info(`City sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, logId=${logId}]`);
  runInBackground('City sync', () => syncCities(mode, logId));
  return response(res, true, 202, 'City sync started', { logId });
});

// Triggered from cnk-website right after someone adds a city in the admin —
// syncs just that one city instead of waiting for the next scheduled full
// syncCities()/syncHotels() run.
const triggerSingleCitySync = asyncHandler(async (req, res) => {
  const mode = req.query.mode;
  const { cityId } = req.body ?? {};

  if (!cityId) {
    return response(res, false, 400, 'cityId is required');
  }

  const logId = await createSyncLog({
    supplier: 'tripjack', syncType: 'city-single',
    requestUrl: ENDPOINTS.CITY_LIST, requestPayload: { mode, cityId },
  });
  logger.info(`Single-city sync triggered [cityId=${cityId}, mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, logId=${logId}]`);
  runInBackground('Single city sync', () => syncSingleCity(cityId, mode, logId));
  return response(res, true, 202, 'Single-city sync started', { logId });
});

const triggerHotelSync = asyncHandler(async (req, res) => {
  const mode           = req.query.mode;
  // lastUpdateTime/type no longer apply — the region-scoped fetch-hotel-mapping
  // sync has no incremental concept, it re-walks all scoped regions every run.
  // Kept as accepted-but-unused query params so existing callers (the GitHub
  // Actions workflow) don't need to change their request shape.
  const lastUpdateTime = req.query.lastUpdateTime ?? null;
  const type           = req.query.type ?? 'NEW';
  const logId = await createSyncLog({
    supplier: 'tripjack', syncType: 'hotels',
    requestUrl: ENDPOINTS.HOTEL_MAPPING, requestPayload: { mode },
  });
  logger.info(`Hotel mapping sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, logId=${logId}]`);
  runInBackground('Hotel mapping sync', () => syncHotels(mode, lastUpdateTime, type, logId));
  return response(res, true, 202, 'Hotel sync started', { logId });
});

const triggerDeletedHotelSync = asyncHandler(async (req, res) => {
  const mode           = req.query.mode;
  const lastUpdateTime = req.query.lastUpdateTime ?? null;
  const since = lastUpdateTime
    ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const logId = await createSyncLog({
    supplier: 'tripjack', syncType: 'hotels_deleted',
    requestUrl: ENDPOINTS.HOTEL_DELETED_MAPPING_SYNC, requestPayload: { lastUpdateTime: since, mode },
  });
  logger.info(`Deleted hotel sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, since=${since}, logId=${logId}]`);
  runInBackground('Deleted hotel sync', () => syncDeletedHotels(lastUpdateTime, mode, logId));
  return response(res, true, 202, 'Deleted hotel sync started', { logId });
});

const triggerNationalitySync = asyncHandler(async (req, res) => {
  const mode = req.query.mode;
  const logId = await createSyncLog({
    supplier: 'tripjack', syncType: 'nationalities',
    requestUrl: ENDPOINTS.NATIONALITY_LIST, requestPayload: { mode },
  });
  logger.info(`Nationality sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, logId=${logId}]`);
  runInBackground('Nationality sync', () => syncNationalities(mode, logId));
  return response(res, true, 202, 'Nationality sync started', { logId });
});

// Deletes hotel_details_cache rows older than 24h. No TripJack calls — pure
// DB cleanup, so it runs synchronously and returns the count directly rather
// than the fire-and-forget + poll pattern used by the sync jobs above.
const purgeDetailCache = asyncHandler(async (req, res) => {
  const deletedCount = await purgeExpiredDetailCache();
  logger.info(`[syncController] Purged ${deletedCount} expired hotel_details_cache rows`);
  return response(res, true, 200, 'Expired detail cache purged', { deletedCount });
});

const getSyncStatus = asyncHandler(async (req, res) => {
  const { logId } = req.params;
  const log = await getSyncLog(logId);

  if (!log.completed_at) {
    const ageMs = Date.now() - new Date(log.started_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      return response(res, false, 200, 'Sync timed out (no completion recorded)', { status: 'failed', logId });
    }
    return response(res, true, 200, 'Sync still in progress', { status: 'in_progress', logId });
  }

  if (!log.success) {
    return response(res, false, 200, 'Sync failed', { status: 'failed', logId, error: log.error_message });
  }

  return response(res, true, 200, 'Sync completed', { status: 'success', logId, recordsProcessed: log.records_processed });
});

module.exports = { triggerCitySync, triggerSingleCitySync, triggerHotelSync, triggerDeletedHotelSync, triggerNationalitySync, purgeDetailCache, getSyncStatus };
