const { randomUUID } = require('crypto');
const {
  searchHotels,
  getHotelById,
  getHotelBySupplierHotelId,
  getHotelIdsByRegion,
  upsertHotelIndex,
  getDetailCache,
  upsertDetailCache,
} = require('../repositories/hotelRepository');
const { post } = require('../providers/tripjack/tripjackHotelClient');
const { ENDPOINTS } = require('../providers/tripjack/tripjackHotelConfig');
const { toLightweightRow, toDetailCache } = require('../providers/tripjack/tripjackHotelMapper');
const supabase = require('../../db/supabase');
const logger = require('../../utils/logger');

// ─── Guest details builder ────────────────────────────────────────────────────
// Constructs the guest_details JSON that goes into hotel_bookings from fields
// already present in the Book request body.

function buildGuestDetails({ roomTravellerInfo, deliveryInfo }) {
  const rooms = (roomTravellerInfo ?? []).map((room) => {
    const pax = room.travellerInfo ?? room.travelerInfo ?? [];
    return {
      adults: pax.filter((t) => t.pt === 'ADULT').length,
      ...(pax.some((t) => t.pt === 'CHILD') ? { children: pax.filter((t) => t.pt === 'CHILD').length } : {}),
    };
  });

  const pax_details = (roomTravellerInfo ?? []).map((room) =>
    (room.travellerInfo ?? room.travelerInfo ?? []).map((t) => ({
      title: t.ti,
      pax_type: t.pt === 'ADULT' ? 'adult' : 'child',
      first_name: t.fN,
      last_name: t.lN,
      ...(t.pan ? { pan: t.pan } : {}),
      ...(t.pNum ? { passport: t.pNum } : {}),
    }))
  );

  const customer_email = deliveryInfo?.emails?.[0] ?? null;
  const phone = deliveryInfo?.contacts?.[0] ?? null;
  const code = deliveryInfo?.code?.[0] ?? '';
  const customer_phone = phone ? `${code}${phone}` : null;

  return { rooms, pax_details, customer_email, customer_phone };
}

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

async function searchHotelsService({ cityId, cityName, q, minRating, sortBy, page, limit }) {
  // Resolve cityName → cityId when only a name string is provided
  let resolvedCityId = cityId ?? null;
  let resolvedCityName = null;

  if (!resolvedCityId && cityName) {
    const { data: region } = await supabase
      .from('hotels_regions')
      .select('id, city_name')
      .ilike('city_name', `%${cityName.trim()}%`)
      .limit(1)
      .maybeSingle();

    if (region) {
      resolvedCityId  = region.id;
      resolvedCityName = region.city_name;
    }
  }

  logger.info(`[hotelService] searchHotels: q="${q ?? ''}", cityId=${resolvedCityId ?? 'N/A'}, minRating=${minRating ?? 'any'}, sortBy=${sortBy}, page=${page}, limit=${limit}`);

  const { hotels, total } = await searchHotels({
    cityId:    resolvedCityId,
    q,
    minRating,
    sortBy,
    page,
    limit,
  });

  logger.info(`[hotelService] searchHotels: returned ${hotels.length}/${total}`);

  return {
    hotels,
    resolvedCity: resolvedCityName ?? null,
    pagination: buildPagination({ page, limit, total }),
  };
}

// ─── DB: single hotel by ID (lightweight row + on-demand 24h detail cache) ────

async function fetchAndCacheHotelDetail(hotelId, supplierHotelId) {
  const data = await post(ENDPOINTS.HOTEL_STATIC_DETAIL, { hid: supplierHotelId }, undefined, 'hms', 1, 'hotel-content');

  // Refresh the lightweight columns (name/rating/hero image) from this same
  // response too, not just the heavy cache — keeps hotels_inventory current
  // whenever we already have fresh data, instead of only on first sighting.
  await upsertHotelIndex([toLightweightRow(data)]);

  const detailCache = toDetailCache(data);
  await upsertDetailCache(hotelId, detailCache);
  return detailCache;
}

async function getHotelDetailService(hotel) {
  const cached = await getDetailCache(hotel.id);
  if (cached) {
    logger.info(`[hotelService] getHotelDetail: cache hit for id=${hotel.id}`);
    return cached;
  }

  logger.info(`[hotelService] getHotelDetail: cache miss for id=${hotel.id} — fetching from TripJack`);
  return fetchAndCacheHotelDetail(hotel.id, hotel.supplier_hotel_id);
}

async function getHotelByIdService(id) {
  logger.info(`[hotelService] getHotelById: id=${id}`);
  const hotel = await getHotelById(id);
  if (!hotel) {
    logger.info('[hotelService] getHotelById: not found');
    return null;
  }

  const detail = await getHotelDetailService(hotel);
  return { ...hotel, ...detail };
}

// ─── DB: single hotel by TripJack ID (creates the inventory row on first view) ─
// Live search results carry TripJack's tjHotelId, not an internal id — a
// hotel the catalogue-wide sync hasn't reached yet has no row at all. This
// seeds a lightweight row and the detail cache from a single static-detail
// call as a sync-lag safety net.

async function getHotelByTripjackIdService(hid) {
  logger.info(`[hotelService] getHotelByTripjackId: hid=${hid}`);
  let hotel = await getHotelBySupplierHotelId(hid);

  if (!hotel) {
    logger.info(`[hotelService] getHotelByTripjackId: no inventory row for hid=${hid} — fetching + seeding`);
    const data = await post(ENDPOINTS.HOTEL_STATIC_DETAIL, { hid }, undefined, 'hms', 1, 'hotel-content');

    await upsertHotelIndex([toLightweightRow(data)]);
    hotel = await getHotelBySupplierHotelId(hid);
    if (!hotel) throw new Error(`Failed to index hotel hid=${hid} after static-detail fetch`);

    const detailCache = toDetailCache(data);
    await upsertDetailCache(hotel.id, detailCache);
    return { ...hotel, ...detailCache };
  }

  const detail = await getHotelDetailService(hotel);
  return { ...hotel, ...detail };
}

// ─── Step 1: Live search (TripJack Listing API) ──────────────────────────────
// v3 removed `cityCode` from Listing entirely — it now only accepts `hids`.
// So a cityId-only search resolves to a set of hids via hotels_inventory
// (populated by the region-scoped hotel-mapping sync), not a cityCode field.
// Supports:
//   - cityId only     → resolves to hids mapped to that region (max 100)
//   - hids only        → direct hotel ID search
//   - cityId + hids    → union of both, capped at 100 (TripJack's per-request max)
//
// All extra body fields (future TripJack additions) are spread into the payload
// as-is so nothing is silently dropped.

const LISTING_HIDS_MAX = 100;

async function liveSearchHotelsService(body) {
  const { cityId, hids, correlationId, ...rest } = body;

  logger.info(`[hotelService] liveSearch: cityId=${cityId ?? 'N/A'}, hids=${hids?.length ?? 0}, checkIn=${body.checkIn}, checkOut=${body.checkOut}, rooms=${body.rooms.length}`);

  let cityInfo = null;
  let resolvedHids = (hids ?? []).map((id) => String(id));

  if (cityId) {
    const { data: region, error } = await supabase
      .from('hotels_regions')
      .select('id, city_name, country_name')
      .eq('id', cityId)
      .eq('supplier', 'tripjack')
      .single();

    if (error || !region) {
      logger.error(`[hotelService] liveSearch: region lookup failed for cityId=${cityId}`, { error });
      throw new Error(`City not found for cityId=${cityId}`);
    }

    cityInfo = region;

    const mappedHids = await getHotelIdsByRegion(region.id, LISTING_HIDS_MAX);
    logger.info(`[hotelService] liveSearch: resolved city="${region.city_name}" → ${mappedHids.length} mapped hids`);

    resolvedHids = [...new Set([...resolvedHids, ...mappedHids])].slice(0, LISTING_HIDS_MAX);
  }

  if (!resolvedHids.length) {
    throw new Error(
      cityId
        ? `No hotels indexed yet for cityId=${cityId} — run the hotel-mapping sync for this city first`
        : 'hids is required (no cityId provided)'
    );
  }

  // Spread all client-sent fields first (preserves any TripJack fields we haven't
  // explicitly modelled), then override with our resolved values.
  const payload = {
    ...rest,                                             // checkIn, checkOut, rooms, currency, nationality, timeoutMs, + any extra TripJack fields
    correlationId: correlationId ?? randomUUID(),        // use client-provided or generate
    hids: resolvedHids.map((id) => parseInt(id, 10)),    // TripJack requires hids as integers
  };

  logger.info('[hotelService] liveSearch: sending payload to TripJack', { payload });

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
    hid: parseInt(String(hid), 10),   // TripJack pricing requires hid as integer
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

async function hotelBookService(body) {
  // Strip _meta before sending to TripJack — it's our internal field only
  const { _meta, ...tripjackPayload } = body;
  const { bookingId, paymentInfos, roomTravellerInfo, deliveryInfo } = tripjackPayload;
  const bookingMode = paymentInfos?.length ? 'INSTANT' : 'HOLD';
  logger.info(`[hotelService] hotelBook: bookingId=${bookingId}, mode=${bookingMode}`);

  const data = await post(ENDPOINTS.BOOK, tripjackPayload, undefined, 'booker');

  logger.info(`[hotelService] hotelBook: bookingId=${data.bookingId}, status=${data.status?.success}`);

  const confirmedId = data.bookingId ?? bookingId;
  // Book only confirms the request was received — TripJack takes up to 180s to
  // actually confirm/reject it. Poll /booking/details (bookingDetailsService) to
  // learn the real terminal status; don't mark INSTANT bookings SUCCESS here.
  const bookingStatus = bookingMode === 'INSTANT' ? 'IN_PROGRESS' : 'ON_HOLD';
  const now = new Date().toISOString();

  // Fire-and-forget — each booking always gets its own fresh row (no upsert on supplier_booking_id
  // to prevent cross-booking overwrites when TripJack reuses IDs in test env)
  supabase.from('hotels_bookings').insert({
    id: randomUUID(),
    supplier: 'tripjack',
    supplier_booking_id: confirmedId,
    booking_status: bookingStatus,
    amount: paymentInfos?.[0]?.amount ?? null,
    currency: _meta?.currency ?? 'INR',
    hotel_id: _meta?.hotel_id ?? null,
    hotel_name: _meta?.hotel_name ?? null,
    city: _meta?.city ?? null,
    room_name: _meta?.room_name ?? null,
    checkin_date: _meta?.checkin_date ?? null,
    checkout_date: _meta?.checkout_date ?? null,
    deadline_datetime: _meta?.deadline_datetime ?? null,
    quote_id: _meta?.quote_id ?? null,
    booking_reference: _meta?.booking_reference ?? null,
    client_id: _meta?.client_id ?? null,
    guest_details: buildGuestDetails({ roomTravellerInfo, deliveryInfo }),
    booking_response: {
      confirmation: {
        status: bookingStatus,
        success: data.status?.success ?? false,
        booking_id: confirmedId,
        actual_booking_id: confirmedId,
        hotel_confirmation_number: null,
      },
      original_booking_id: bookingId,
    },
    created_at: now,
    updated_at: now,
  }).then(({ error }) => {
    if (error) logger.error(`[hotelService] hotelBook: DB save failed for ${confirmedId}:`, error.message);
    else logger.info(`[hotelService] hotelBook: saved to hotels_bookings, id=${confirmedId}, status=${bookingStatus}`);
  });

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

  const rawStatus = data.order?.status;
  logger.info(`[hotelService] bookingDetails: status=${rawStatus ?? 'N/A'}`);

  // Reconcile our stored status with TripJack's real terminal status — the initial
  // Book response only confirms the request was received, not the outcome. Never
  // overwrite a booking that's already moved into post-booking cancellation states.
  if (rawStatus) {
    supabase
      .from('hotels_bookings')
      .update({ booking_status: rawStatus, updated_at: new Date().toISOString() })
      .eq('supplier_booking_id', bookingId)
      .not('booking_status', 'in', '(CANCELLATION_PENDING,CANCELLED,CANCEL_FAILED)')
      .then(({ error }) => {
        if (error) logger.error(`[hotelService] bookingDetails: DB status sync failed for ${bookingId}:`, error.message);
        else logger.info(`[hotelService] bookingDetails: synced booking_status=${rawStatus} for ${bookingId}`);
      });
  }

  delete data.debug_curl;
  return data;
}

// ─── Confirm Booking (ON_HOLD → confirmed) ───────────────────────────────────

async function confirmBookingService(body) {
  const { _meta, ...tripjackPayload } = body;
  const { bookingId, paymentInfos } = tripjackPayload;
  logger.info(`[hotelService] confirmBooking: bookingId=${bookingId}, amount=${paymentInfos?.[0]?.amount}`);

  const data = await post(ENDPOINTS.CONFIRM_BOOKING, tripjackPayload, undefined, 'booker');

  const success = data.status?.success ?? false;
  logger.info(`[hotelService] confirmBooking: bookingId=${bookingId}, success=${success}`);

  const confirmedId = data.bookingId ?? bookingId;
  const bookingStatus = success ? 'SUCCESS' : 'FAILED';
  const now = new Date().toISOString();

  const bookingResponse = {
    confirmation: {
      status: bookingStatus,
      success,
      booking_id: confirmedId,
      actual_booking_id: confirmedId,
      hotel_confirmation_number: null,
    },
    original_booking_id: bookingId,
  };

  // Try to update the existing ON_HOLD record first; if none exists, insert a new one.
  // Scoped to booking_status=ON_HOLD so a re-confirm attempt never stomps a SUCCESS row.
  (async () => {
    const { data: updated, error: updateError } = await supabase
      .from('hotels_bookings')
      .update({ supplier_booking_id: confirmedId, booking_status: bookingStatus, booking_response: bookingResponse, updated_at: now })
      .eq('supplier_booking_id', bookingId)
      .eq('booking_status', 'ON_HOLD')
      .select('id');

    if (updateError) {
      logger.error(`[hotelService] confirmBooking: DB update failed for ${bookingId}:`, updateError.message);
      return;
    }

    if (updated && updated.length > 0) {
      logger.info(`[hotelService] confirmBooking: updated ON_HOLD → ${bookingStatus} for ${confirmedId}`);
      return;
    }

    // No pre-existing ON_HOLD record — insert fresh (handles cases where hotelBook was
    // called before this feature existed or came from another system)
    const { error: insertError } = await supabase.from('hotels_bookings').insert({
      id: randomUUID(),
      supplier: 'tripjack',
      supplier_booking_id: confirmedId,
      booking_status: bookingStatus,
      amount: paymentInfos?.[0]?.amount ?? null,
      currency: _meta?.currency ?? 'INR',
      hotel_id: _meta?.hotel_id ?? null,
      hotel_name: _meta?.hotel_name ?? null,
      city: _meta?.city ?? null,
      room_name: _meta?.room_name ?? null,
      checkin_date: _meta?.checkin_date ?? null,
      checkout_date: _meta?.checkout_date ?? null,
      quote_id: _meta?.quote_id ?? null,
      booking_reference: _meta?.booking_reference ?? null,
      client_id: _meta?.client_id ?? null,
      guest_details: null,
      booking_response: bookingResponse,
      created_at: now,
      updated_at: now,
    });

    if (insertError) logger.error(`[hotelService] confirmBooking: DB insert failed for ${confirmedId}:`, insertError.message);
    else logger.info(`[hotelService] confirmBooking: inserted new record for ${confirmedId}, status=${bookingStatus}`);
  })().catch((e) => logger.error('[hotelService] confirmBooking: DB operation error:', e.message));

  delete data.debug_curl;
  return data;
}

// ─── Cancel Booking ──────────────────────────────────────────────────────────

async function cancelBookingService({ bookingId }) {
  logger.info(`[hotelService] cancelBooking: bookingId=${bookingId}`);

  const data = await post(`${ENDPOINTS.CANCEL_BOOKING}/${bookingId}`, {}, undefined, 'booker');

  const success = data.status?.success ?? false;
  logger.info(`[hotelService] cancelBooking: bookingId=${bookingId}, status=${success}`);

  // Update hotels_bookings: move to CANCELLATION_PENDING (TripJack Ops processes offline;
  // the daily sync cron will poll booking-details and flip to CANCELLED once confirmed).
  const newStatus = success ? 'CANCELLATION_PENDING' : 'CANCEL_FAILED';
  const now = new Date().toISOString();
  supabase
    .from('hotels_bookings')
    .update({
      booking_status: newStatus,
      cancellation_response: data,
      updated_at: now,
    })
    .eq('supplier_booking_id', bookingId)
    .then(({ error }) => {
      if (error) logger.error(`[hotelService] cancelBooking: DB update failed for ${bookingId}:`, error.message);
      else logger.info(`[hotelService] cancelBooking: DB updated to ${newStatus} for ${bookingId}`);
    });

  return { bookingId, status: data.status };
}

module.exports = {
  searchHotelsService,
  getHotelByIdService,
  getHotelByTripjackIdService,
  liveSearchHotelsService,
  hotelDetailService,
  hotelReviewService,
  hotelBookService,
  confirmBookingService,
  bookingDetailsService,
  cancelBookingService,
};
