const { randomUUID } = require('crypto');
const { searchHotels, getHotelById } = require('../repositories/hotelRepository');
const { post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS } = require('../providers/tripjack/tripjackHotelConfig');
const supabase = require('../../db/supabase');
const logger = require('../../utils/logger');

async function searchHotelsService({ cityId, page, limit }) {
  logger.info(`[hotelService] searchHotels: cityId=${cityId}, page=${page}, limit=${limit}`);
  const results = await searchHotels({ cityId, page, limit });
  logger.info(`[hotelService] searchHotels: returned ${results.length} hotels`);
  return results;
}

async function getHotelByIdService(id) {
  logger.info(`[hotelService] getHotelById: id=${id}`);
  const hotel = await getHotelById(id);
  logger.info(`[hotelService] getHotelById: ${hotel ? 'found' : 'not found'}`);
  return hotel;
}

async function liveSearchHotelsService({ cityId, checkIn, checkOut, rooms, currency, nationality, timeoutMs }) {
  logger.info(`[hotelService] liveSearch: cityId=${cityId}, checkIn=${checkIn}, checkOut=${checkOut}, rooms=${rooms.length}`);

  const { data: region, error } = await supabase
    .from('hotels_regions')
    .select('supplier_region_id, city_name, country_name')
    .eq('id', cityId)
    .eq('supplier', 'tripjack')
    .single();

  if (error) {
    logger.error(`[hotelService] liveSearch: region lookup failed for cityId=${cityId}`, { error });
    throw new Error(`City not found for cityId=${cityId}`);
  }
  if (!region) {
    logger.warn(`[hotelService] liveSearch: no region found for cityId=${cityId}`);
    throw new Error(`City not found for cityId=${cityId}`);
  }

  logger.info(`[hotelService] liveSearch: resolved city="${region.city_name}", country="${region.country_name}", cityCode=${region.supplier_region_id}`);

  const payload = {
    checkIn,
    checkOut,
    rooms,
    currency: currency ?? 'INR',
    nationality: nationality ?? '106', // 106 = India (TripJack countryId)
    correlationId: randomUUID(),
    cityCode: region.supplier_region_id,
    ...(timeoutMs ? { timeoutMs } : {}),
  };

  logger.info(`[hotelService] liveSearch: sending payload to TripJack`, { payload });

  const data = await post(ENDPOINTS.LISTING, payload);

  const hotelCount = data.hotels?.length ?? 0;
  logger.info(`[hotelService] liveSearch: TripJack returned ${hotelCount} hotels (totalResults=${data.totalResults ?? 'N/A'})`);

  return {
    city: { id: cityId, name: region.city_name, country: region.country_name },
    correlationId: payload.correlationId,
    totalResults: data.totalResults ?? hotelCount,
    hotels: data.hotels ?? [],
  };
}

module.exports = { searchHotelsService, getHotelByIdService, liveSearchHotelsService };
