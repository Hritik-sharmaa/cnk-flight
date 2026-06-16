const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { syncCities, syncHotels, syncDeletedHotels } = require('../services/syncService');

const triggerCitySync = asyncHandler(async (req, res) => {
  const mode = req.query.mode;
  logger.info(`City sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}]`);
  const result = await syncCities(mode);
  logger.info(`City sync completed — ${result.recordsProcessed} records`);
  return response(res, true, 200, 'City sync completed successfully', { mode, recordsProcessed: result.recordsProcessed });
});

const triggerHotelSync = asyncHandler(async (req, res) => {
  const mode           = req.query.mode;
  const lastUpdateTime = req.query.lastUpdateTime ?? null;
  const type           = req.query.type ?? 'NEW';

  logger.info(`Hotel sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, type=${type}, since=${lastUpdateTime ?? 'all'}]`);
  const result = await syncHotels(mode, lastUpdateTime, type);
  logger.info(`Hotel sync completed — ${result.recordsProcessed} records`);
  return response(res, true, 200, 'Hotel sync completed successfully', { mode, type, lastUpdateTime, recordsProcessed: result.recordsProcessed });
});

const triggerDeletedHotelSync = asyncHandler(async (req, res) => {
  const mode           = req.query.mode;
  const lastUpdateTime = req.query.lastUpdateTime ?? null;

  logger.info(`Deleted hotel sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}, since=${lastUpdateTime ?? 'last 30 days'}]`);
  const result = await syncDeletedHotels(lastUpdateTime, mode);
  logger.info(`Deleted hotel sync completed — ${result.recordsProcessed} records marked deleted`);
  return response(res, true, 200, 'Deleted hotel sync completed successfully', { mode, lastUpdateTime, recordsProcessed: result.recordsProcessed });
});

module.exports = { triggerCitySync, triggerHotelSync, triggerDeletedHotelSync };
