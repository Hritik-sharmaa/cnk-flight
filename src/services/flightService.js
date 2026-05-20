const { getProvider } = require('../providers/FlightProviderFactory');
const { mapSearchResult, mapReviewResult, mapBookingDetails } = require('../providers/tripjack/tripjackMapper');
const db = require('./supabaseService');

const PROVIDER_NAME = () => process.env.FLIGHT_PROVIDER || 'tripjack';

async function search(params) {
  const raw = await getProvider().search(params);
  // Only apply the Tripjack mapper when using Tripjack; other providers will have their own mappers
  if (PROVIDER_NAME() === 'tripjack') return mapSearchResult(raw);
  return raw;
}

async function review(priceIds) {
  const raw = await getProvider().review(priceIds);
  if (PROVIDER_NAME() === 'tripjack') return mapReviewResult(raw);
  return raw;
}

async function fareRule(id, flowType) {
  return getProvider().fareRule(id, flowType);
}

async function seatMap(bookingId) {
  return getProvider().seatMap(bookingId);
}

async function book(bookingData) {
  const { _meta, ...providerPayload } = bookingData;

  const raw = await getProvider().book(providerPayload);

  // Persist to Supabase — detect hold vs instant by absence of paymentInfos
  const isHold = !providerPayload.paymentInfos || providerPayload.paymentInfos.length === 0;
  const status = raw.status?.success === false ? 'FAILED' : (isHold ? 'ON_HOLD' : 'PENDING');

  try {
    const booking = await db.saveBooking({
      provider: PROVIDER_NAME(),
      providerBookingId: providerPayload.bookingId,
      status,
      bookingType: isHold ? 'HOLD' : 'INSTANT',
      totalFare: providerPayload.paymentInfos?.[0]?.amount || null,
      searchParams: _meta?.searchParams || null,
      bookingRequest: providerPayload,
      bookingResponse: raw,
      createdBy: _meta?.createdBy || null,
    });

    if (booking && providerPayload.travellerInfo) {
      await db.savePassengers(booking.id, providerPayload.travellerInfo);
    }
  } catch (dbErr) {
    // DB failure must not block the booking response — log and continue
    console.error('[flightService.book] Supabase save failed:', dbErr.message);
  }

  return raw;
}

async function fareValidate(bookingId) {
  return getProvider().fareValidate(bookingId);
}

async function confirmBook(bookingId, paymentInfos) {
  const raw = await getProvider().confirmBook(bookingId, paymentInfos);

  try {
    await db.updateBookingStatus(bookingId, 'PENDING', raw);
  } catch (dbErr) {
    console.error('[flightService.confirmBook] Supabase update failed:', dbErr.message);
  }

  return raw;
}

async function bookingDetails(bookingId, requirePaxPricing) {
  const raw = await getProvider().bookingDetails(bookingId, requirePaxPricing);

  // Sync status to DB if we have a record
  if (raw.order?.status) {
    try {
      await db.updateBookingStatus(bookingId, raw.order.status, raw);
    } catch (_) {}
  }

  if (PROVIDER_NAME() === 'tripjack') return mapBookingDetails(raw);
  return raw;
}

async function unhold(bookingId, pnrs) {
  const raw = await getProvider().unhold(bookingId, pnrs);

  try {
    await db.updateBookingStatus(bookingId, 'UNCONFIRMED', raw);
  } catch (dbErr) {
    console.error('[flightService.unhold] Supabase update failed:', dbErr.message);
  }

  return raw;
}

async function amendmentCharges(data) {
  return getProvider().amendmentCharges(data);
}

async function submitAmendment(data) {
  return getProvider().submitAmendment(data);
}

async function amendmentDetails(amendmentId) {
  return getProvider().amendmentDetails(amendmentId);
}

async function userBalance() {
  return getProvider().userBalance();
}

module.exports = {
  search,
  review,
  fareRule,
  seatMap,
  book,
  fareValidate,
  confirmBook,
  bookingDetails,
  unhold,
  amendmentCharges,
  submitAmendment,
  amendmentDetails,
  userBalance,
};
