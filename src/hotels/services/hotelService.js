const { randomUUID } = require('crypto');
const { searchHotels, getHotelById } = require('../repositories/hotelRepository');
const { post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS } = require('../providers/tripjack/tripjackHotelConfig');
const supabase = require('../../db/supabase');
const logger = require('../../utils/logger');

// ─── Pagination helper ────────────────────────────────────────────────────────

function buildPagination({ page, limit, total }) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ─── Step 0: DB hotel search ─────────────────────────────────────────────────

async function searchHotelsService({ cityId, q, page, limit }) {
  logger.info(`[hotelService] searchHotels: q="${q ?? ''}", cityId=${cityId ?? 'N/A'}, page=${page}, limit=${limit}`);
  const { hotels, total } = await searchHotels({ cityId, q, page, limit });
  logger.info(`[hotelService] searchHotels: returned ${hotels.length}/${total}`);
  return {
    hotels,
    pagination: buildPagination({ page, limit, total }),
  };
}

// ─── DB: single hotel by ID ──────────────────────────────────────────────────

async function getHotelByIdService(id) {
  logger.info(`[hotelService] getHotelById: id=${id}`);
  const hotel = await getHotelById(id);
  logger.info(`[hotelService] getHotelById: ${hotel ? 'found' : 'not found'}`);
  return hotel;
}

// ─── Step 1: Live search (TripJack Listing API) ──────────────────────────────
// Supports two modes:
//   - cityId only     → resolves to TripJack cityCode, no hids filter
//   - hids only       → direct hotel ID search, no cityCode needed
//   - cityId + hids   → cityCode + hids filter together
//
// All extra body fields (future TripJack additions) are spread into the payload
// as-is so nothing is silently dropped.

async function liveSearchHotelsService(body) {
  const { cityId, hids, correlationId, ...rest } = body;

  const mode = cityId && hids?.length ? 'cityId+hids' : cityId ? 'cityId' : 'hids';
  logger.info(`[hotelService] liveSearch: mode=${mode}, cityId=${cityId ?? 'N/A'}, hids=${hids?.length ?? 0}, checkIn=${body.checkIn}, checkOut=${body.checkOut}, rooms=${body.rooms.length}`);

  let cityInfo = null;

  if (cityId) {
    const { data: region, error } = await supabase
      .from('hotels_regions')
      .select('supplier_region_id, city_name, country_name')
      .eq('id', cityId)
      .eq('supplier', 'tripjack')
      .single();

    if (error || !region) {
      logger.error(`[hotelService] liveSearch: region lookup failed for cityId=${cityId}`, { error });
      throw new Error(`City not found for cityId=${cityId}`);
    }

    cityInfo = region;
    logger.info(`[hotelService] liveSearch: resolved city="${region.city_name}", cityCode=${region.supplier_region_id}`);
  }

  // Spread all client-sent fields first (preserves any TripJack fields we haven't
  // explicitly modelled), then override with our resolved values.
  const payload = {
    ...rest,                                             // checkIn, checkOut, rooms, currency, nationality, timeoutMs, + any extra TripJack fields
    correlationId: correlationId ?? randomUUID(),        // use client-provided or generate
    ...(cityInfo ? { cityCode: cityInfo.supplier_region_id } : {}),
    ...(hids?.length ? { hids } : {}),
  };

  logger.info(`[hotelService] liveSearch: sending payload to TripJack`, { payload });

  const data = await post(ENDPOINTS.LISTING, payload);

  const hotels = data.hotels ?? [];
  const total = data.totalResults ?? hotels.length;

  logger.info(`[hotelService] liveSearch: TripJack returned ${hotels.length} hotels (total=${total})`);

  return {
    city: cityInfo
      ? { id: cityId, name: cityInfo.city_name, country: cityInfo.country_name }
      : null,
    correlationId: payload.correlationId,
    hotels,
    pagination: buildPagination({ page: 1, limit: hotels.length || 1, total }),
  };
}

// ─── Step 2: Dynamic Detail / Pricing ───────────────────────────────────────
// Spreads the full body to TripJack — all fields pass through for debugging.

async function hotelDetailService(body) {
  const { correlationId, hid, checkIn, checkOut } = body;
  logger.info(`[hotelService] hotelDetail: hid=${hid}, checkIn=${checkIn}, checkOut=${checkOut}, correlationId=${correlationId ?? 'auto'}`);

  const payload = {
    ...body,
    correlationId: correlationId ?? randomUUID(),
  };

  const data = await post(ENDPOINTS.DETAIL, payload);

  logger.info(`[hotelService] hotelDetail: received ${data.options?.length ?? 0} options for hid=${hid}`);

  return {
    tjHotelId: data.tjHotelId,
    hotelName: data.hotelName,
    correlationId: data.correlationId,
    reviewHash: data.reviewHash,
    options: data.options ?? [],
  };
}

// ─── Step 3: Review ──────────────────────────────────────────────────────────
// Spreads the full body to TripJack.

async function hotelReviewService(body) {
  const { correlationId, optionId, hid } = body;
  logger.info(`[hotelService] hotelReview: optionId=${optionId}, hid=${hid}, correlationId=${correlationId}`);

  const data = await post(ENDPOINTS.REVIEW, body);

  logger.info(`[hotelService] hotelReview: bookingId=${data.bookingId ?? 'N/A'}, isAvailable=${data.isAvailable}`);

  return {
    correlationId: data.correlationId,
    hotelId: data.hotelId,
    hotelName: data.hotelName,
    bookingId: data.bookingId,
    option: data.option,
    deadlineDateTime: data.deadlineDateTime,
    isAvailable: data.isAvailable,
    priceChanged: data.priceChanged ?? false,
    onholdAllowed: data.onholdAllowed ?? false,
  };
}

// ─── Step 4: Book ────────────────────────────────────────────────────────────
// Spreads the full body to TripJack Booker service.

async function hotelBookService(body) {
  const { bookingId, paymentInfos } = body;
  const bookingMode = paymentInfos?.length ? 'INSTANT' : 'HOLD';
  logger.info(`[hotelService] hotelBook: bookingId=${bookingId}, mode=${bookingMode}`);

  const data = await post(ENDPOINTS.BOOK, body, undefined, 'booker');

  logger.info(`[hotelService] hotelBook: bookingId=${data.bookingId}, status=${data.status?.success}`);

  return {
    bookingId: data.bookingId,
    status: data.status,
    metaData: data.metaData ?? null,
  };
}

// ─── Booking Details (poll) ──────────────────────────────────────────────────

async function bookingDetailsService(body) {
  const { bookingId } = body;
  logger.info(`[hotelService] bookingDetails: bookingId=${bookingId}`);

  const data = await post(ENDPOINTS.BOOKING_DETAILS, body, undefined, 'booker');

  logger.info(`[hotelService] bookingDetails: status=${data.order?.status ?? 'N/A'}`);

  return data;
}

// ─── Cancel Booking ──────────────────────────────────────────────────────────

async function cancelBookingService({ bookingId }) {
  logger.info(`[hotelService] cancelBooking: bookingId=${bookingId}`);

  const data = await post(`${ENDPOINTS.CANCEL_BOOKING}/${bookingId}`, {}, undefined, 'booker');

  logger.info(`[hotelService] cancelBooking: bookingId=${bookingId}, status=${data.status?.success}`);

  return { bookingId, status: data.status };
}

module.exports = {
  searchHotelsService,
  getHotelByIdService,
  liveSearchHotelsService,
  hotelDetailService,
  hotelReviewService,
  hotelBookService,
  bookingDetailsService,
  cancelBookingService,
};
