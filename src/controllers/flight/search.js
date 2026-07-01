const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');
const logger = require('../../utils/logger');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory cache: cacheKey → { data, expiresAt }
// Keyed on route + dates + pax + cabin so different searches never collide.
const searchCache = new Map();

function makeCacheKey(body) {
  const routes = (body.routeInfos || [])
    .map((r) => `${r.fromCityOrAirport?.code}>${r.toCityOrAirport?.code}@${r.travelDate}`)
    .join('|');
  const pax = `A${body.paxInfo?.ADULT ?? 1}_C${body.paxInfo?.CHILD ?? 0}_I${body.paxInfo?.INFANT ?? 0}`;
  const cabin = body.cabinClass ?? 'ECONOMY';
  return `${routes}::${pax}::${cabin}`;
}

function getFromCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(key, data) {
  // Keep the Map bounded — evict all expired entries when it gets large.
  if (searchCache.size >= 200) {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (now > v.expiresAt) searchCache.delete(k);
    }
  }
  searchCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const search = asyncHandler(async (req, res) => {
  requireFields(req.body, ['paxInfo', 'routeInfos']);
  requireNonEmptyArray(req.body.routeInfos, 'routeInfos');

  const { _noCache, ...searchBody } = req.body;
  const cacheKey = makeCacheKey(searchBody);

  if (!_noCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      logger.info(`[search] cache hit: ${cacheKey}`);
      return response(res, true, 200, 'Flights fetched successfully (cached)', cached);
    }
  } else {
    logger.info(`[search] cache bypassed (refresh): ${cacheKey}`);
    searchCache.delete(cacheKey);
  }

  const result = await flightService.search(searchBody);
  setInCache(cacheKey, result);

  return response(res, true, 200, 'Flights fetched successfully', result);
});

module.exports = search;
