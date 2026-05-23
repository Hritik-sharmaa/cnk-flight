const { getProvider } = require('../providers/FlightProviderFactory');
const { mapSearchResult, mapReviewResult, mapBookingDetails } = require('../providers/tripjack/tripjackMapper');

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
  return getProvider().book(providerPayload);
}

async function fareValidate(bookingId) {
  return getProvider().fareValidate(bookingId);
}

async function confirmFare(bookingId) {
  return getProvider().confirmFare(bookingId);
}

async function confirmBook(bookingId, paymentInfos) {
  // Tripjack requires /oms/v1/air/fare-validate (pre-ticket) before confirm-book in the Hold flow.
  const fareCheck = await getProvider().confirmFare(bookingId);

  if (fareCheck.status?.success === false) {
    const err = fareCheck.errors?.[0];
    const code = err?.errCode;
    if (code === '1059') throw new Error('Hold time limit expired. Please start a new booking.');
    const msg = err
      ? `Fare no longer available: ${code} — ${err.details ?? ''}`
      : 'Fare is no longer available for this held booking';
    throw new Error(msg);
  }

  const hasFareAlert = Array.isArray(fareCheck.alerts) &&
    fareCheck.alerts.some((a) => a.type === 'FAREALERT');
  if (hasFareAlert) {
    throw new Error('Flight fare has changed since the hold was placed. Please start a new booking to get the current fare.');
  }

  const raw = await getProvider().confirmBook(bookingId, paymentInfos);

  if (raw.status?.success === false) {
    const err = raw.errors?.[0];
    const msg = err
      ? `Tripjack confirm-book failed: ${err.errCode} — ${err.details ?? ''}`
      : 'Tripjack confirm-book returned success=false';
    throw new Error(msg);
  }

  return raw;
}

async function bookingDetails(bookingId, requirePaxPricing) {
  const raw = await getProvider().bookingDetails(bookingId, requirePaxPricing);
  if (PROVIDER_NAME() === 'tripjack') return mapBookingDetails(raw);
  return raw;
}

async function unhold(bookingId, pnrs) {
  return getProvider().unhold(bookingId, pnrs);
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
  confirmFare,
  confirmBook,
  bookingDetails,
  unhold,
  amendmentCharges,
  submitAmendment,
  amendmentDetails,
  userBalance,
};
