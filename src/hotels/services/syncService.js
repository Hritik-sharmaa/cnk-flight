const { get, post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS, PAGINATION, toTripjackCountryName } = require('../providers/tripjack/tripjackHotelConfig');
const { mapCity, toLightweightRow } = require('../providers/tripjack/tripjackHotelMapper');
const logger = require('../../utils/logger');
const { createSyncLog, completeSyncLog } = require('../repositories/syncLogRepository');
const { upsertCities, getSellableCityCountryMap, listRegions, getCityById, getRegionBySupplierRegionId } = require('../repositories/cityRepository');
const { upsertHotelMapping, upsertHotelIndex, markHotelsDeleted } = require('../repositories/hotelRepository');
const { bulkUpsertNationalities, getCountryNamesByIsoCodes } = require('../repositories/nationalityRepository');

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
 * Fetch all cities from TripJack (cursor-paginated) and upsert into
 * hotels_regions — but only cities that match CNK's own destination list,
 * sourced from public.cities, the single source of truth for tour
 * destinations (name + country_id FK into countries, one row per city). TripJack's
 * global city list is walked once (cheap, ID+name only) but everything
 * outside CNK's real destinations is discarded rather than stored, since
 * that's what keeps the downstream hotel-mapping sync scoped to a
 * tractable size instead of TripJack's whole worldwide catalogue.
 *
 * Matching is by (city name, country) together, not name alone — TripJack's
 * global list has many same-named cities in different countries (confirmed:
 * "Granada" exists in Spain, Colombia, and Nicaragua; "Barcelona" in Spain,
 * Brazil, Ecuador, Peru, and the Philippines). A TripJack city only counts
 * as a match if its country matches the country recorded on the matching
 * public.cities row. A city whose `country_id` hasn't been set yet is
 * simply skipped, not guessed at.
 *
 * TripJack's own city master data also has confirmed exact duplicates — the
 * same real city (identical name/state/country) can appear under two
 * different cityRegionIds (e.g. Bangkok, Thailand appeared as both 727326
 * and 740089). Since duplicates can land on different pages of the cursor
 * walk, dedup is tracked across the whole run (not per-page) by (city_name,
 * country_name), keeping only the first cityRegionId seen for each real
 * place — otherwise the downstream hotel-mapping sync redundantly walks the
 * same city under multiple region rows.
 * @param {'live'|'test'} [mode]
 */
async function syncCities(mode, logId) {
  logId = logId ?? await createSyncLog({
    supplier: 'tripjack',
    syncType: 'cities',
    requestUrl: ENDPOINTS.CITY_LIST,
    requestPayload: { mode },
  });

  let totalProcessed = 0;
  let cursor = null;
  let hasMore = true;
  let page = 1;
  const seenCityCountryKeys = new Set();

  try {
    const cityCountryMap = await getSellableCityCountryMap();
    logger.info(`[syncService] Scoping city sync to ${cityCountryMap.size} CNK destination names`);

    while (hasMore) {
      const params = { limit: PAGINATION.CITY_LIMIT };
      if (cursor) params.cursor = cursor;

      logger.info(`[syncService] Fetching city page ${page} (cursor: ${cursor ?? 'first'})`);

      const res = await get(ENDPOINTS.CITY_LIST, params, mode, 'hms', 'hotel-sync');

      const raw = res.hotelCityRegionIds ?? [];
      const mapped = raw
        .map(mapCity)
        .filter((c) => {
          if (!c.cityName) return false;
          const allowedCountry = cityCountryMap.get(c.cityName.trim().toLowerCase());
          if (!allowedCountry) return false; // not a CNK destination, or country not set yet
          const tripjackCountry = (c.countryName ?? '').trim().toUpperCase();
          return allowedCountry === tripjackCountry;
        })
        .filter((c) => {
          // Keyed by (city, state, country) — not just (city, country) — so
          // genuinely different places sharing a name (Anchorage, NJ vs
          // Anchorage, AK) are both kept as separate hotels_regions rows
          // instead of the second one being discarded as a false duplicate.
          // Only exact re-listings of the same real place (identical name +
          // state + country, e.g. Bangkok appearing under two cityRegionIds)
          // still collapse to one.
          const key = `${c.cityName.trim().toLowerCase()}||${(c.stateName ?? '').trim().toLowerCase()}||${(c.countryName ?? '').trim().toLowerCase()}`;
          if (seenCityCountryKeys.has(key)) return false;
          seenCityCountryKeys.add(key);
          return true;
        });
      const count = mapped.length ? await upsertCities(mapped) : 0;
      totalProcessed += count;

      logger.info(`[syncService] City page ${page} — fetched ${raw.length}, matched ${mapped.length}, upserted ${count}`);

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
 * Sync hotels for every region already in hotels_regions — which
 * syncCities() has already scoped down to CNK's own ~196 destinations
 * (public.cities), not TripJack's whole 1.6M-hotel worldwide catalogue.
 * Two steps per region:
 *   1. fetch-hotel-mapping (filtered by regionIds) → {tjHotelId, unicaId}
 *      pairs, with a reliable region_id set directly (no city-name
 *      guessing). Always persisted via upsertHotelMapping.
 *   2. fetch-hotel-content, batched 100 IDs at a time, for those same IDs
 *      → name/rating/hero image/etc., persisted via the same
 *      toLightweightRow/upsertHotelIndex pipeline the on-demand detail-view
 *      path already uses. This is the "heavy" endpoint, but scoped to CNK's
 *      real destinations it stays a bounded, one-time-per-sync cost instead
 *      of TripJack's entire worldwide catalogue.
 * A content-batch failure only logs a warning and moves on — the mapping
 * (step 1) already succeeded, so that hotel just stays nameless until
 * someone opens its detail page directly, rather than aborting the sync.
 *
 * There's no incremental concept for fetch-hotel-mapping (no
 * lastUpdateTime/type filter), so every run re-walks all scoped regions —
 * cheap at this scale, and every upsert is idempotent. The
 * lastUpdateTime/type params are accepted and ignored so existing call
 * sites (syncController, the GitHub Actions workflow) don't need to change.
 * @param {'live'|'test'} [mode]
 */
// Hotel-mapping + content sync for a single region row — the per-region
// unit of work shared by syncHotels() (looped over every scoped region)
// and syncSingleCity() (called for just the one newly matched region).
// @param {{id: string, supplier_region_id: string, city_name: string, country_name: string}} region
// @param {'live'|'test'} [mode]
async function syncHotelsForRegion(region, mode) {
  let page = 0;
  let hasMore = true;
  let regionTotal = 0;

  while (hasMore) {
    const body = {
      regionIds: [region.supplier_region_id],
      page,
      size: PAGINATION.HOTEL_MAPPING_SIZE,
    };

    // Unlike the content-fetch step below, a mapping-fetch failure here
    // used to be uncaught — it would throw out of syncHotelsForRegion(),
    // which propagates through runConcurrent()'s Promise.all and aborts
    // the ENTIRE syncHotels() run for every other region too. Confirmed in
    // production: a single transient 504 from TripJack's Cloudflare killed
    // a multi-hour, 326-region sync after it had already completed most of
    // them. Now: give up on just this region (keep whatever pages it
    // already got through) and let the rest of the sync continue.
    let res;
    try {
      res = await post(ENDPOINTS.HOTEL_MAPPING, body, mode, 'hms', 2, 'hotel-sync');
    } catch (err) {
      logger.warn(`[syncService]   mapping fetch failed for ${region.city_name} page ${page} — abandoning rest of this region, sync continues`, { error: err.message });
      break;
    }
    const hotels = res.hotels ?? [];

    if (hotels.length === 0) break;

    // ── Step 1: ID↔region mapping (cheap, always safe) ────────────────
    const mappingRows = hotels.map((h) => ({
      supplierHotelId: String(h.tjHotelId),
      unicaId: h.unicaId ? String(h.unicaId) : null,
      regionId: region.id,
    }));
    regionTotal += await upsertHotelMapping(mappingRows);

    // ── Step 2: batch content fetch for the same IDs → lightweight
    //            fields (name/rating/hero image), scoped to this region ─
    const hotelIds = hotels.map((h) => String(h.tjHotelId));
    const contentBatches = chunk(hotelIds, PAGINATION.HOTEL_CONTENT_SIZE);
    const contentTasks = contentBatches.map((batchIds) => async () => {
      try {
        const contentRes = await post(ENDPOINTS.HOTEL_CONTENT, { hotelIds: batchIds }, mode, 'hms', 1, 'hotel-sync');
        const rawHotels = contentRes.hotels ?? [];
        await upsertHotelIndex(rawHotels.map(toLightweightRow));
      } catch (err) {
        logger.warn(`[syncService]   content batch failed for ${region.city_name} (${batchIds.length} ids) — mapping kept, will fill in on detail view`, { error: err.message });
      }
    });
    // Concurrency here (2) times syncHotels()'s own region concurrency (3)
    // caps simultaneous hotels_inventory upserts at 6 — confirmed in
    // production that the previous 3x5=15 combo was tripping Postgres
    // statement timeouts under write contention on a cold-table full sync
    // (content batches failing with "canceling statement due to statement
    // timeout", leaving mapped-but-nameless hotels behind).
    await runConcurrent(contentTasks, 2);

    const pageable = res.pageable ?? {};
    page++;
    hasMore = page < (pageable.totalPages ?? 0);
  }

  if (regionTotal > 0) {
    logger.info(`[syncService]   ${region.city_name}, ${region.country_name} — mapped ${regionTotal} hotels`);
  }
  return regionTotal;
}

async function syncHotels(mode, _lastUpdateTime, _type, logId) {
  logId = logId ?? await createSyncLog({
    supplier: 'tripjack',
    syncType: 'hotels',
    requestUrl: ENDPOINTS.HOTEL_MAPPING,
    requestPayload: { mode },
  });

  let totalProcessed = 0;

  try {
    const regions = await listRegions();
    logger.info(`[syncService] Hotel sync — walking ${regions.length} scoped regions (mapping + content)`);

    const tasks = regions.map((region) => () => syncHotelsForRegion(region, mode));
    const counts = await runConcurrent(tasks, 3);
    totalProcessed = counts.reduce((s, c) => s + c, 0);

    logger.info(`[syncService] Hotel sync complete — ${totalProcessed} hotels across ${regions.length} regions`);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });
    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

/**
 * Sync exactly one city — triggered when someone adds a new city via the
 * admin (rather than waiting for the next scheduled full syncCities() run).
 * TripJack's city-list endpoint has no name search (confirmed: cursor
 * pagination only), so finding this one city still means walking their
 * global list page by page — same cost as syncCities(), just stopping the
 * moment a match is found instead of filtering the whole list against
 * every CNK destination. Worst case (no match, or the match is on the
 * last page) is a full walk, same as today's cron.
 *
 * If the city has no country_id set, or TripJack has no matching city for
 * that name+country, this completes successfully with recordsProcessed: 0
 * — the city stays usable for its original purpose (tour packages) with
 * no hotel inventory, same as the handful of non-TripJack-matched cities
 * already in the initial migration. No error, no separate alert.
 * @param {string} cityId
 * @param {'live'|'test'} [mode]
 */
async function syncSingleCity(cityId, mode, logId) {
  logId = logId ?? await createSyncLog({
    supplier: 'tripjack',
    syncType: 'city-single',
    requestUrl: ENDPOINTS.CITY_LIST,
    requestPayload: { mode, cityId },
  });

  try {
    const target = await getCityById(cityId);
    if (!target || !target.countryName) {
      logger.warn(`[syncService] Single-city sync skipped — city ${cityId} not found or has no country set`);
      await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: 0, success: true });
      return { success: true, recordsProcessed: 0 };
    }

    const targetCityName = target.name.trim().toLowerCase();
    const isoMap = target.isoCode ? await getCountryNamesByIsoCodes([target.isoCode]) : null;
    const targetCountryName = (isoMap && isoMap.get(target.isoCode))
      || toTripjackCountryName(target.countryName);

    let cursor = null;
    let hasMore = true;
    let page = 1;
    const matches = [];
    const seenStateKeys = new Set();

    // Walk the FULL city list rather than stopping at the first hit — a
    // name+country match can be one of several real places (e.g. Anchorage,
    // NJ vs Anchorage, AK are both "Anchorage, United States"), so every
    // candidate needs to be collected before anything gets synced. Same
    // (city, state, country) dedup as syncCities() — only exact re-listings
    // of the same real place collapse to one.
    while (hasMore) {
      const params = { limit: PAGINATION.CITY_LIMIT };
      if (cursor) params.cursor = cursor;

      logger.info(`[syncService] Single-city sync — scanning city page ${page} for "${target.name}, ${target.countryName}" (cursor: ${cursor ?? 'first'})`);

      const res = await get(ENDPOINTS.CITY_LIST, params, mode, 'hms', 'hotel-sync');
      const raw = res.hotelCityRegionIds ?? [];
      const mapped = raw.map(mapCity);

      for (const c of mapped) {
        if (!c.cityName || c.cityName.trim().toLowerCase() !== targetCityName) continue;
        if ((c.countryName ?? '').trim().toUpperCase() !== targetCountryName) continue;
        const key = `${(c.stateName ?? '').trim().toLowerCase()}`;
        if (seenStateKeys.has(key)) continue;
        seenStateKeys.add(key);
        matches.push(c);
      }

      cursor = res.nextCursor ?? null;
      hasMore = res.hasMore === true && cursor !== null;
      page++;
    }

    if (!matches.length) {
      logger.warn(`[syncService] Single-city sync — no TripJack match for "${target.name}, ${target.countryName}" after walking full city list`);
      await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: 0, success: true });
      return { success: true, recordsProcessed: 0 };
    }

    await upsertCities(matches);

    let hotelsProcessed = 0;
    for (const match of matches) {
      const region = await getRegionBySupplierRegionId(match.supplierRegionId);
      if (!region) continue;
      hotelsProcessed += await syncHotelsForRegion(region, mode);
    }
    logger.info(`[syncService] Single-city sync complete — ${target.name}, ${target.countryName}: ${matches.length} candidate region(s), ${hotelsProcessed} hotels`);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: hotelsProcessed, success: true });
    return { success: true, recordsProcessed: hotelsProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: 0, success: false, errorMessage: err.message });
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
async function syncDeletedHotels(lastUpdateTime, mode, logId) {
  const since = lastUpdateTime
    ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';

  logId = logId ?? await createSyncLog({
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

      const res = await post(ENDPOINTS.HOTEL_DELETED_MAPPING_SYNC, body, mode, 'hms', 1, 'hotel-sync');
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

/**
 * Fetch the full nationality/country list from TripJack and upsert into
 * hotels_nationalities. Single call, no pagination — the endpoint returns
 * everything at once (see docs/HOTELS.md).
 * @param {'live'|'test'} [mode]
 */
async function syncNationalities(mode, logId) {
  logId = logId ?? await createSyncLog({
    supplier: 'tripjack',
    syncType: 'nationalities',
    requestUrl: ENDPOINTS.NATIONALITY_LIST,
    requestPayload: { mode },
  });

  try {
    logger.info('[syncService] Fetching nationality list');

    const res = await get(ENDPOINTS.NATIONALITY_LIST, {}, mode, 'hms', 'hotel-sync');
    const raw = res.nationalityInfos ?? [];

    const mapped = raw.map((n) => ({
      supplierNationalityId: String(n.countryId),
      countryName: n.countryName ?? n.name,
      isoCode: n.code ?? null,
    }));

    const count = await bulkUpsertNationalities(mapped);
    logger.info(`[syncService] Nationality sync — fetched ${raw.length}, upserted ${count}`);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: count, success: true });
    return { success: true, recordsProcessed: count };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: 0, success: false, errorMessage: err.message });
    throw err;
  }
}

module.exports = { syncCities, syncHotels, syncSingleCity, syncDeletedHotels, syncNationalities };
