const { post } = require('../providers/tripjack/tripjackHotelClient');
const { mapCity, mapHotel } = require('../providers/tripjack/tripjackHotelMapper');
const { createSyncLog, completeSyncLog } = require('../repositories/syncLogRepository');
const { upsertCities } = require('../repositories/cityRepository');
const { upsertHotels } = require('../repositories/hotelRepository');

const CITY_PATH = '/hms/v1/static/cityList';
const HOTEL_PATH = '/hms/v1/static/hotelList';

async function syncCities() {
  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'cities',
    requestUrl: CITY_PATH,
    requestPayload: {},
  });

  let totalProcessed = 0;
  let next = null;

  try {
    do {
      const body = next ? { next } : {};
      const res = await post(CITY_PATH, body);

      const raw = res.hotelCityRegionIds ?? [];
      const mapped = raw.map(mapCity);
      const count = await upsertCities(mapped);
      totalProcessed += count;

      next = res.next ?? null;
    } while (next);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });

    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

async function syncHotels() {
  const logId = await createSyncLog({
    supplier: 'tripjack',
    syncType: 'hotels',
    requestUrl: HOTEL_PATH,
    requestPayload: {},
  });

  let totalProcessed = 0;
  let next = null;

  try {
    do {
      const body = next ? { next } : {};
      const res = await post(HOTEL_PATH, body);

      const raw = res.hotelOpInfos ?? [];
      const mapped = raw.map(mapHotel);
      const count = await upsertHotels(mapped);
      totalProcessed += count;

      next = res.next ?? null;
    } while (next);

    await completeSyncLog({ id: logId, responseStatus: 200, recordsProcessed: totalProcessed, success: true });

    return { success: true, recordsProcessed: totalProcessed };
  } catch (err) {
    await completeSyncLog({ id: logId, responseStatus: null, recordsProcessed: totalProcessed, success: false, errorMessage: err.message });
    throw err;
  }
}

module.exports = { syncCities, syncHotels };
