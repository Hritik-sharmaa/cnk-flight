/**
 * Test script: Full TripJack hotel booking flow for OPO Viva Palace
 *
 * Flow:
 *   Step 1 — Listing  (fresh search to get the hotel in results)
 *   Step 2 — Detail   (get all options + reviewHash for this hotel)
 *   Step 3 — Review   (lock the option, get bookingId)
 *   Step 4 — Book     (HOLD mode — no payment, reserves the room)
 *   Step 5 — Re-check (call Detail again to see if the same option is still available)
 *
 * Run:
 *   node scripts/testHotelBookFlow.js
 */

require('dotenv').config();
const axios = require('axios');

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.HOTEL_API_KEY;
const HMS_BASE = process.env.HOTEL_HMS_API_BASE_URL_TEST;    // https://apitest-hms.tripjack.com
const BOOKER_BASE = process.env.HOTEL_BOOKER_API_BASE_URL_TEST; // https://apitest-hotel-booker.tripjack.com

const HOTEL = {
  tjHotelId: 100000003038,          // supplier_hotel_id
  name: 'OPO Viva Palace',
  checkIn: '2026-06-28',
  checkOut: '2026-06-30',
  // Fresh correlationId per run to avoid duplicate booking errors in test env
  correlationId: `cnk-test-${Date.now()}`,
  targetRoomName: 'Deluxe Double Room, 1 Double Bed, Non Smoking',
  targetMealBasis: 'Room Only',
  expectedPrice: 6829.79,
};

const ROOMS = [{ adults: 2 }]; // 1 room, 2 adults — matches a double room
const CURRENCY = 'INR';
const NATIONALITY = 106; // India

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hmsClient() {
  return axios.create({
    baseURL: HMS_BASE,
    headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

function bookerClient() {
  return axios.create({
    baseURL: BOOKER_BASE,
    headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

function log(step, msg, data) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${step}] ${msg}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function err(step, msg, e) {
  console.error(`\n${'═'.repeat(60)}`);
  console.error(`[${step}] ERROR: ${msg}`);
  console.error(e?.response?.data ?? e?.message ?? e);
  console.error('═'.repeat(60));
}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function step1_listing() {
  log('STEP 1', 'Listing — search for OPO Viva Palace by hotel ID');
  const payload = {
    checkIn: HOTEL.checkIn,
    checkOut: HOTEL.checkOut,
    rooms: ROOMS,
    currency: CURRENCY,
    correlationId: HOTEL.correlationId,
    nationality: NATIONALITY,
    timeoutMs: 15000,
    hids: [HOTEL.tjHotelId],
  };
  log('STEP 1', 'Request payload', payload);

  const res = await hmsClient().post('/hms/v3/hotel/listing', payload);
  const data = res.data;

  if (!data.status?.success) {
    throw new Error(`Listing failed: ${JSON.stringify(data.status)}`);
  }

  const hotel = data.hotels?.[0];
  if (!hotel) throw new Error('Hotel not returned in listing results — check dates or hotel ID');

  log('STEP 1', `Found hotel: ${hotel.name} (${hotel.tjHotelId})`, hotel.options?.[0]);
  return data;
}

async function step2_detail() {
  log('STEP 2', 'Detail/Pricing — get all options + reviewHash');
  const payload = {
    correlationId: HOTEL.correlationId,
    hid: HOTEL.tjHotelId,
    checkIn: HOTEL.checkIn,
    checkOut: HOTEL.checkOut,
    rooms: ROOMS,
    currency: CURRENCY,
    nationality: NATIONALITY,
    timeoutMs: 15000,
  };
  log('STEP 2', 'Request payload', payload);

  const res = await hmsClient().post('/hms/v3/hotel/pricing', payload);
  const data = res.data;

  if (!data.status?.success) {
    throw new Error(`Detail failed: ${JSON.stringify(data.status)}`);
  }

  log('STEP 2', `Options received: ${data.options?.length ?? 0}`, {
    reviewHash: data.reviewHash,
    optionCount: data.options?.length,
  });

  return data;
}

function pickOption(options, targetRoomName, targetMealBasis) {
  // Try to match the same room + meal basis from the original search
  let match = options.find(
    (o) =>
      o.roomInfo?.some((r) => r.name?.toLowerCase().includes('deluxe double') || r.name?.toLowerCase().includes('double bed')) &&
      o.mealBasis?.toLowerCase() === targetMealBasis.toLowerCase()
  );

  if (!match) {
    // Fallback: just pick the first option
    match = options[0];
    console.warn('[STEP 2] Could not match original room — falling back to first option');
  }

  return match;
}

async function step3_review(optionId, reviewHash) {
  log('STEP 3', 'Review — lock option and get bookingId');
  const payload = {
    correlationId: HOTEL.correlationId,
    optionId,
    reviewHash,
    hid: HOTEL.tjHotelId,
  };
  log('STEP 3', 'Request payload', payload);

  const res = await hmsClient().post('/hms/v3/hotel/review', payload);
  const data = res.data;

  if (!data.status?.success) {
    throw new Error(`Review failed: ${JSON.stringify(data)}`);
  }

  log('STEP 3', `bookingId=${data.bookingId}`, {
    bookingId: data.bookingId,
    totalPrice: data.option?.pricing?.totalPrice,
    currency: data.option?.pricing?.currency,
    isRefundable: data.option?.cancellation?.isRefundable,
    onholdAllowed: data.onholdAllowed,
    deadlineDateTime: data.option?.deadlineDateTime,
  });

  return data;
}

async function step4_book(bookingId, totalPrice, onholdAllowed) {
  const mode = onholdAllowed ? 'HOLD' : 'INSTANT';
  log('STEP 4', `Book — ${mode} mode for bookingId=${bookingId}, price=${totalPrice}`);

  const payload = {
    bookingId,
    roomTravellerInfo: [
      {
        travellerInfo: [
          { ti: 'Mr', pt: 'ADULT', fN: 'TEST', lN: 'GUEST' },
          { ti: 'Mrs', pt: 'ADULT', fN: 'TEST', lN: 'GUEST2' },
        ],
      },
    ],
    deliveryInfo: {
      emails: ['test@coxandkings.com'],
      contacts: ['9999999999'],
      code: ['+91'],
    },
    // INSTANT: include paymentInfos; HOLD: omit paymentInfos
    ...(onholdAllowed ? {} : { paymentInfos: [{ amount: totalPrice }] }),
    type: 'HOTEL',
  };

  log('STEP 4', 'Request payload', payload);

  let data;
  try {
    const res = await bookerClient().post('/oms/v3/hotel/book', payload);
    data = res.data;
  } catch (e) {
    const body = e.response?.data;
    const dupError = body?.errors?.find((err) => err.errCode === '2502');
    if (dupError) {
      // Extract existing bookingId from error details
      const existingId = dupError.details ?? dupError.message?.match(/TJ\w+/)?.[0] ?? bookingId;
      log('STEP 4', `Duplicate booking detected — existing bookingId: ${existingId}`, dupError);
      return { bookingId: existingId, status: { success: true }, _duplicate: true };
    }
    throw e;
  }

  log('STEP 4', `Book response — success=${data.status?.success}`, {
    bookingId: data.bookingId,
    status: data.status,
    metaData: data.metaData,
  });

  return data;
}

async function step5_recheck_availability() {
  log('STEP 5', 'Re-check availability — calling Detail again after booking');

  // Use a fresh correlationId for the re-check
  const freshCorrelationId = `recheck-${Date.now()}`;
  const payload = {
    correlationId: freshCorrelationId,
    hid: HOTEL.tjHotelId,
    checkIn: HOTEL.checkIn,
    checkOut: HOTEL.checkOut,
    rooms: ROOMS,
    currency: CURRENCY,
    nationality: NATIONALITY,
    timeoutMs: 15000,
  };
  log('STEP 5', 'Request payload', payload);

  const res = await hmsClient().post('/hms/v3/hotel/pricing', payload);
  const data = res.data;

  if (!data.status?.success) {
    log('STEP 5', 'Detail returned failure (hotel may be fully sold out)', data.status);
    return data;
  }

  const optionCount = data.options?.length ?? 0;
  log('STEP 5', `Options still available: ${optionCount}`);

  if (optionCount === 0) {
    console.log('\n✅ Hotel is SOLD OUT — no options available after booking');
  } else {
    console.log(`\n⚠️  Hotel still has ${optionCount} option(s) available`);
    // Show the cheapest remaining option
    const cheapest = data.options.reduce((a, b) =>
      (a.pricing?.totalPrice ?? Infinity) < (b.pricing?.totalPrice ?? Infinity) ? a : b
    );
    log('STEP 5', 'Cheapest remaining option', {
      optionId: cheapest.optionId,
      roomName: cheapest.roomInfo?.[0]?.name,
      mealBasis: cheapest.mealBasis,
      totalPrice: cheapest.pricing?.totalPrice,
      currency: cheapest.pricing?.currency,
    });
  }

  return data;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   TripJack Hotel Booking Flow — OPO Viva Palace          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Hotel ID : ${HOTEL.tjHotelId}`);
  console.log(`Dates    : ${HOTEL.checkIn} → ${HOTEL.checkOut} (2 nights)`);
  console.log(`Mode     : TEST (${HMS_BASE})`);

  if (!API_KEY) {
    console.error('HOTEL_API_KEY not set — check .env');
    process.exit(1);
  }

  try {
    // Step 1 — Listing (fresh search)
    await step1_listing();

    // Step 2 — Detail (get options + reviewHash)
    const detailData = await step2_detail();
    const { options, reviewHash } = detailData;

    if (!options?.length) throw new Error('No options returned from Detail API');
    if (!reviewHash) throw new Error('No reviewHash returned from Detail API');

    // Pick the best matching option
    const selectedOption = pickOption(options, HOTEL.targetRoomName, HOTEL.targetMealBasis);
    log('STEP 2', 'Selected option', {
      optionId: selectedOption.optionId,
      roomName: selectedOption.roomInfo?.[0]?.name,
      mealBasis: selectedOption.mealBasis,
      totalPrice: selectedOption.pricing?.totalPrice,
      currency: selectedOption.pricing?.currency,
    });

    // Step 3 — Review
    const reviewData = await step3_review(selectedOption.optionId, reviewHash);
    const { bookingId } = reviewData;
    if (!bookingId) throw new Error('No bookingId returned from Review API');

    // Step 4 — Book (INSTANT or HOLD based on reviewData)
    const bookData = await step4_book(bookingId, reviewData.option?.pricing?.totalPrice, reviewData.onholdAllowed);

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log(`║ Booking placed — bookingId: ${bookData.bookingId ?? bookingId}`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    // Step 5 — Re-check availability
    await step5_recheck_availability();

    console.log('\n✅ Full flow complete.');
  } catch (e) {
    err('MAIN', 'Flow failed', e);
    process.exit(1);
  }
}

main();
