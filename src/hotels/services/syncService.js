const { get, post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS, PAGINATION } = require('../providers/tripjack/tripjackHotelConfig');
const { mapCity, mapHotel } = require('../providers/tripjack/tripjackHotelMapper');
const logger = require('../../utils/logger');
const { createSyncLog, completeSyncLog } = require('../repositories/syncLogRepository');
const { upsertCities } = require('../repositories/cityRepository');
const { upsertHotels } = require('../repositories/hotelRepository');

/**
 * Fetch all cities from TripJack (cursor-paginated) and upsert into hotels_regions.
 * @param {'live'|'test'} [mode]
 */
async function syncCities(mode) {
  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'cities',
    requestUrl: ENDPOINTS.CITY_LIST,
    requestPayload: { mode },
  });

  let totalProcessed = 0;
  let cursor = null;
  let hasMore = true;
  let page = 1;

  try {
    while (hasMore) {
      const params = { limit: PAGINATION.CITY_LIMIT };
      if (cursor) params.cursor = cursor;

      logger.info(`[syncService] Fetching city page ${page} (cursor: ${cursor ?? 'first'})`);

      const res = await get(ENDPOINTS.CITY_LIST, params, mode, 'hms');

      const raw = res.hotelCityRegionIds ?? [];
      const mapped = raw.map(mapCity);
      const count = await upsertCities(mapped);
      totalProcessed += count;

      logger.info(`[syncService] City page ${page} — fetched ${raw.length}, upserted ${count}`);

      cursor = res.nextCursor ?? null;
      hasMore = res.hasMore === true && cursor !== null;
      page++;
    }

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });
    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

/**
 * Fetch all hotels from TripJack (next-token paginated) and upsert into hotels_inventory.
 * @param {'live'|'test'} [mode]
 */
async function syncHotels(mode) {
  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'hotels',
    requestUrl: ENDPOINTS.HOTEL_LIST,
    requestPayload: { mode },
  });

  let totalProcessed = 0;
  let next = null;
  let page = 1;

  try {
    do {
      const body = next ? { next } : {};

      logger.info(`[syncService] Fetching hotel page ${page} (next: ${next ?? 'first'})`);

      const res = await post(ENDPOINTS.HOTEL_LIST, body, mode, 'static');

      const raw = res.hotelOpInfos ?? [];
      const mapped = raw.map(mapHotel);
      const count = await upsertHotels(mapped);
      totalProcessed += count;

      logger.info(`[syncService] Hotel page ${page} — fetched ${raw.length}, upserted ${count}`);

      next = res.next ?? null;
      page++;
    } while (next);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });
    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

module.exports = { syncCities, syncHotels };
