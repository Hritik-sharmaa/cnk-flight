const logger = require('../../utils/logger');
const flightService = require('../../services/flightService');
const { createSyncLog, completeSyncLog } = require('../repositories/syncLogRepository');
const {
  getFlightIncludedPackages,
  getCheapestActiveDepartures,
  writeDelhiFare,
} = require('../repositories/departureFareRepository');
const { resolveDestinationAirports, resolveTravelDates } = require('../utils/airportResolver');

const DELHI_CODE = 'DEL';
const CONCURRENCY = 3; // bounded — one live provider search per package

/**
 * Run async tasks with a concurrency cap. Same shape as hotels' syncService
 * runConcurrent helper.
 */
async function runConcurrent(tasks, limit = CONCURRENCY) {
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
 * Cheapest total round-trip fare per adult from a raw flightService.search()
 * result. International routes land in `combo` (fare already bundles the
 * round trip); domestic routes return separate `onward`/`return` trip
 * arrays, so the round-trip total there is the cheapest onward fare plus the
 * cheapest return fare.
 */
function pickCheapestRoundTripFare(searchResult) {
  const cheapestFareInTrips = (trips) => {
    let min = null;
    for (const trip of trips ?? []) {
      for (const option of trip.fareOptions ?? []) {
        const fare = option.adult?.totalFare;
        if (typeof fare === 'number' && (min === null || fare < min)) min = fare;
      }
    }
    return min;
  };

  if (searchResult?.combo?.length) {
    return cheapestFareInTrips(searchResult.combo);
  }

  if (searchResult?.onward?.length && searchResult?.return?.length) {
    const onwardMin = cheapestFareInTrips(searchResult.onward);
    const returnMin = cheapestFareInTrips(searchResult.return);
    if (onwardMin === null || returnMin === null) return null;
    return onwardMin + returnMin;
  }

  return null;
}

/**
 * Fetches and writes the cheapest DEL-origin round-trip fare for one
 * specific departure (its own dates — fares vary by date, so a fare fetched
 * for one departure cannot be copied onto another even if they share the
 * same land price). Never throws for expected failure modes (no fares,
 * provider error) — those are logged and the existing cached value (if any)
 * is left untouched. Returns true if a fare was written, false otherwise.
 */
async function syncDepartureDelhiFare(pkg, departure, outboundCode, returnFromCode) {
  const { departureDateStr, returnDateStr } = resolveTravelDates({
    departure,
    tourRoute: pkg.tour_route,
  });

  const actualReturnFrom = returnFromCode && returnFromCode !== outboundCode ? returnFromCode : outboundCode;

  const searchQuery = {
    cabinClass: 'ECONOMY',
    paxInfo: { ADULT: 1, CHILD: 0, INFANT: 0 },
    routeInfos: [
      {
        fromCityOrAirport: { code: DELHI_CODE },
        toCityOrAirport: { code: outboundCode },
        travelDate: departureDateStr,
      },
      {
        fromCityOrAirport: { code: actualReturnFrom },
        toCityOrAirport: { code: DELHI_CODE },
        travelDate: returnDateStr,
      },
    ],
    searchModifiers: { isDirectFlight: false, isConnectingFlight: false, pft: 'REGULAR' },
  };

  let searchResult;
  try {
    searchResult = await flightService.search(searchQuery);
  } catch (err) {
    logger.error(`[delhiFareSync] ${pkg.slug} departure ${departure.id} — provider search failed: ${err.message}`);
    return false;
  }

  const cheapestFare = pickCheapestRoundTripFare(searchResult);
  if (cheapestFare === null) {
    logger.info(`[delhiFareSync] ${pkg.slug} departure ${departure.id} — no fares found for DEL → ${outboundCode}, skipping`);
    return false;
  }

  await writeDelhiFare(departure.id, cheapestFare);
  logger.info(`[delhiFareSync] ${pkg.slug} — wrote flight_price_del=${cheapestFare} on departure ${departure.id}`);
  return true;
}

/**
 * Fetches and writes a DEL-origin fare for every one of a package's active
 * departures tied at the cheapest land price — not just one arbitrarily
 * picked row. Read-path "starting price" logic can land on any of these
 * tied departures depending on request-to-request ordering, so all of them
 * need their own flight price or the badge/price shown becomes inconsistent
 * between page loads. Returns the count of departures successfully updated.
 */
async function syncPackageDelhiFare(pkg) {
  const isFIT = pkg.package_type === 'FIT';

  const departures = await getCheapestActiveDepartures(pkg.id, isFIT);
  if (departures.length === 0) {
    logger.info(`[delhiFareSync] ${pkg.slug} — no active departure, skipping`);
    return 0;
  }

  const { outboundCode, returnFromCode } = resolveDestinationAirports({
    destination: pkg.destination,
    tourRoute: pkg.tour_route,
    country: pkg.country,
  });

  if (!outboundCode) {
    logger.warn(`[delhiFareSync] ${pkg.slug} — destination airport unresolvable, skipping`);
    return 0;
  }

  let updated = 0;
  for (const departure of departures) {
    const wrote = await syncDepartureDelhiFare(pkg, departure, outboundCode, returnFromCode);
    if (wrote) updated++;
  }
  return updated;
}

/**
 * Processes one cursor-paginated page of includes_flight packages.
 * Returns { done, nextCursor, processed, updated, skipped } for the
 * controller/workflow to loop on.
 */
async function syncDelhiFaresPage({ cursor = null, limit = 25 } = {}) {
  const packages = await getFlightIncludedPackages({ afterId: cursor, limit });

  if (packages.length === 0) {
    return { done: true, nextCursor: null, processed: 0, updated: 0, skipped: 0 };
  }

  const tasks = packages.map((pkg) => async () => {
    try {
      return await syncPackageDelhiFare(pkg);
    } catch (err) {
      logger.error(`[delhiFareSync] ${pkg.slug ?? pkg.id} — unexpected error: ${err.message}`);
      return 0;
    }
  });

  const results = await runConcurrent(tasks);
  const updated = results.reduce((sum, count) => sum + count, 0);
  const packagesWithNoUpdate = results.filter((count) => count === 0).length;

  return {
    done: packages.length < limit,
    nextCursor: packages[packages.length - 1].id,
    processed: packages.length,
    updated,
    skipped: packagesWithNoUpdate,
  };
}

/**
 * Runs the full sync to completion (all pages), logging a sync-log row for
 * observability via GET /api/v1/flights/sync/status/:logId — same pattern
 * hotel-sync uses.
 */
async function syncDelhiFares(logId) {
  logId = logId ?? (await createSyncLog({ supplier: 'tripjack', syncType: 'delhi_fares' }));

  let cursor = null;
  let totalUpdated = 0;
  let page = 1;

  try {
    let done = false;
    while (!done) {
      logger.info(`[delhiFareSync] page ${page} (cursor: ${cursor ?? 'first'})`);
      const result = await syncDelhiFaresPage({ cursor });
      totalUpdated += result.updated;
      logger.info(`[delhiFareSync] page ${page} — processed ${result.processed}, updated ${result.updated}`);
      cursor = result.nextCursor;
      done = result.done;
      page++;
    }

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalUpdated, success: true });
    return { success: true, recordsProcessed: totalUpdated };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalUpdated, success: false, errorMessage: err.message });
    throw err;
  }
}

module.exports = { syncDelhiFares, syncDelhiFaresPage, pickCheapestRoundTripFare };
