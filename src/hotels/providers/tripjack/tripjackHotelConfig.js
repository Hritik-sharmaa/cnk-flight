/**
 * All TripJack hotel API constants in one place.
 * Import from here — never hardcode URLs or paths elsewhere.
 *
 * TripJack uses two separate services:
 *   HMS    — city/region content  (hms.tripjack.com)
 *   Static — hotel inventory sync (tripjack.com, same domain as flight API)
 */

const BASE_URLS = {
  hms: {
    test: process.env.HOTEL_HMS_API_BASE_URL_TEST,
    live: process.env.HOTEL_HMS_API_BASE_URL_LIVE,
  },
  static: {
    test: process.env.HOTEL_STATIC_API_BASE_URL_TEST,
    live: process.env.HOTEL_STATIC_API_BASE_URL_LIVE,
  },
};

const ENDPOINTS = {
  CITY_LIST:  '/hms/v3/content/fetch-city-regionIds', // GET  — HMS service
  HOTEL_LIST: '/hms/v3/fetch-static-hotels',          // POST — Static service
  LISTING:    '/hms/v3/hotel/listing',                // POST — HMS service, live pricing
};

const PAGINATION = {
  CITY_LIMIT: 2000,  // max records per city page (cursor-based)
};

module.exports = { BASE_URLS, ENDPOINTS, PAGINATION };
