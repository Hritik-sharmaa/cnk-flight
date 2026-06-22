const { get, post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS, PAGINATION } = require('../providers/tripjack/tripjackHotelConfig');
const { mapCity, mapHotel } = require('../providers/tripjack/tripjackHotelMapper');
const logger = require('../../utils/logger');
const { createSyncLog, completeSyncLog } = require('../repositories/syncLogRepository');
const { upsertCities } = require('../repositories/cityRepository');
const { upsertHotels, markHotelsDeleted } = require('../repositories/hotelRepository');

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

/**
 * Run async tasks with a concurrency cap.
 * tasks: array of () => Promise
 * Returns array of results in the same order.
 */
async function runConcurrent(tasks, limit = 5) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

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
 * Sync hotels using the V3 Static Content API (2-step process):
 *   Step 1 — fetch-hotel-mapping-sync  → paginate to collect all tjHotelIds (2000/page)
 *   Step 2 — fetch-hotel-content       → fetch full details in batches of 100
 *
 * @param {'live'|'test'} [mode]
 * @param {string} [lastUpdateTime]  ISO 8601 — only sync hotels updated after this time.
 *                                   Use for incremental syncs. Omit for full sync.
 * @param {'NEW'|'UPDATE'} [type]    Default: 'NEW'
 */
async function syncHotels(mode, lastUpdateTime, type = 'NEW') {
  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'hotels',
    requestUrl: ENDPOINTS.HOTEL_MAPPING_SYNC,
    requestPayload: { mode, lastUpdateTime, type },
  });

  let totalProcessed = 0;
  let nextCursor = null;
  let mappingPage = 1;

  try {
    do {
      // ── Step 1: get a page of hotel IDs ─────────────────────────────────
      const mappingBody = {
        type,
        lastUpdateTime: lastUpdateTime ?? '2020-01-01T00:00:00Z',
      };
      if (nextCursor) mappingBody.cursor = nextCursor; // request field is 'cursor', response field is 'nextCursor'

      logger.info(`[syncService] Mapping page ${mappingPage} (cursor: ${nextCursor ?? 'first'})`);

      const mappingRes = await post(ENDPOINTS.HOTEL_MAPPING_SYNC, mappingBody, mode, 'hms');
      const hotelIds = (mappingRes.hotels ?? []).map((h) => String(h.tjHotelId));

      if (hotelIds.length === 0) {
        logger.info(`[syncService] Mapping page ${mappingPage} returned 0 IDs — stopping`);
        break;
      }

      const pageable = mappingRes.pageable ?? {};
      logger.info(`[syncService] Mapping page ${mappingPage} — ${hotelIds.length} IDs (total: ${pageable.totalElements ?? '?'})`);

      // ── Step 2: fetch full content — 5 batches of 100 concurrently ─────
      const batches = chunk(hotelIds, PAGINATION.HOTEL_CONTENT_SIZE);
      logger.info(`[syncService] Mapping page ${mappingPage} — ${batches.length} content batches (concurrency 5)`);

      const tasks = batches.map((batchIds, b) => async () => {
        const contentRes = await post(ENDPOINTS.HOTEL_CONTENT, { hotelIds: batchIds }, mode, 'hms');
        const rawHotels = contentRes.hotels ?? [];
        const mapped = rawHotels.map(mapHotel);
        const count = await upsertHotels(mapped);
        logger.info(`[syncService]   batch ${b + 1}/${batches.length} — upserted ${count}`);
        return count;
      });

      const counts = await runConcurrent(tasks, 3);
      const pageTotal = counts.reduce((s, c) => s + c, 0);
      totalProcessed += pageTotal;

      logger.info(`[syncService] Mapping page ${mappingPage} complete — +${pageTotal} | cumulative: ${totalProcessed}`);

      nextCursor = mappingRes.nextCursor ?? null;
      mappingPage++;

    } while (nextCursor);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });
    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

/**
 * Fetch deleted hotel IDs from TripJack and mark them inactive in hotels_inventory.
 * Uses the dedicated fetch-deleted-hotel-mapping endpoint (type=DELETE).
 * @param {string} [lastUpdateTime] ISO 8601 — hotels deleted after this timestamp.
 *                                  Defaults to 30 days ago if omitted.
 * @param {'live'|'test'} [mode]
 */
async function syncDeletedHotels(lastUpdateTime, mode) {
  const since = lastUpdateTime
    ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';

  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'hotels_deleted',
    requestUrl: ENDPOINTS.HOTEL_DELETED_MAPPING_SYNC,
    requestPayload: { lastUpdateTime: since, mode },
  });

  let totalProcessed = 0;
  let nextCursor = null;
  let page = 1;

  try {
    do {
      const body = { type: 'DELETE', lastUpdateTime: since };
      if (nextCursor) body.cursor = nextCursor;

      logger.info(`[syncService] Fetching deleted hotel mapping page ${page} (cursor: ${nextCursor ?? 'first'})`);

      const res = await post(ENDPOINTS.HOTEL_DELETED_MAPPING_SYNC, body, mode, 'hms');
      const deletedIds = (res.hotels ?? []).map((h) => String(h.tjHotelId ?? '')).filter(Boolean);

      if (deletedIds.length) {
        const count = await markHotelsDeleted(deletedIds);
        totalProcessed += count;
        logger.info(`[syncService] Deleted page ${page} — found ${deletedIds.length}, marked ${count}`);
      }

      nextCursor = res.nextCursor ?? null;
      page++;
    } while (nextCursor);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });
    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

module.exports = { syncCities, syncHotels, syncDeletedHotels };
