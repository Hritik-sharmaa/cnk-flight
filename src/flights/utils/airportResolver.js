// Ported from cnk-website's lib/constants/destination-airports.ts and the
// outbound/return airport + travel-date resolution logic in
// components/sections/tour-details/BuyNowForm.tsx (lines ~187-227). Kept in
// sync manually — cnk-flight is a separate deployed Node service and cannot
// import cnk-website's TypeScript directly.

const CITY_TO_IATA = {
  'dubai': 'DXB',
  'abu dhabi': 'AUH',
  'sharjah': 'SHJ',
  'singapore': 'SIN',
  'london': 'LHR',
  'manchester': 'MAN',
  'paris': 'CDG',
  'bangkok': 'BKK',
  'phuket': 'HKT',
  'chiang mai': 'CNX',
  'bali': 'DPS',
  'jakarta': 'CGK',
  'kuala lumpur': 'KUL',
  'malaysia': 'KUL',
  'amsterdam': 'AMS',
  'rome': 'FCO',
  'milan': 'MXP',
  'barcelona': 'BCN',
  'madrid': 'MAD',
  'new york': 'JFK',
  'los angeles': 'LAX',
  'sydney': 'SYD',
  'melbourne': 'MEL',
  'tokyo': 'NRT',
  'osaka': 'KIX',
  'hong kong': 'HKG',
  'seoul': 'ICN',
  'istanbul': 'IST',
  'cairo': 'CAI',
  'nairobi': 'NBO',
  'johannesburg': 'JNB',
  'cape town': 'CPT',
  'mauritius': 'MRU',
  'maldives': 'MLE',
  'male': 'MLE',
  'colombo': 'CMB',
  'sri lanka': 'CMB',
  'kathmandu': 'KTM',
  'nepal': 'KTM',
  'bhutan': 'PBH',
  'muscat': 'MCT',
  'oman': 'MCT',
  'doha': 'DOH',
  'qatar': 'DOH',
  'bahrain': 'BAH',
  'kuwait': 'KWI',
  'riyadh': 'RUH',
  'jeddah': 'JED',
  'vienna': 'VIE',
  'zurich': 'ZRH',
  'switzerland': 'ZRH',
  'prague': 'PRG',
  'budapest': 'BUD',
  'athens': 'ATH',
  'greece': 'ATH',
  'frankfurt': 'FRA',
  'munich': 'MUC',
  'germany': 'FRA',
  'brussels': 'BRU',
  'toronto': 'YYZ',
  'vancouver': 'YVR',
  'canada': 'YYZ',
  'mexico city': 'MEX',
  'cancun': 'CUN',
  'beijing': 'PEK',
  'shanghai': 'PVG',
  'china': 'PEK',
  'vietnam': 'SGN',
  'ho chi minh': 'SGN',
  'hanoi': 'HAN',
  'philippines': 'MNL',
  'manila': 'MNL',
  'cambodia': 'PNH',
  'phnom penh': 'PNH',
  'myanmar': 'RGN',
  'yangon': 'RGN',
  'jordan': 'AMM',
  'amman': 'AMM',
  'israel': 'TLV',
  'tel aviv': 'TLV',
};

const SORTED_CITY_KEYS = Object.keys(CITY_TO_IATA).sort((a, b) => b.length - a.length);

function getDestinationAirportCode(destination) {
  if (!destination) return null;
  const lower = destination.toLowerCase();
  for (const key of SORTED_CITY_KEYS) {
    if (lower.includes(key)) return CITY_TO_IATA[key];
  }
  return null;
}

function getFirstAndLastCityAirportCodes(tourRoute) {
  if (!tourRoute?.length) return { firstCityCode: null, lastCityCode: null };
  return {
    firstCityCode: getDestinationAirportCode(tourRoute[0].destination),
    lastCityCode: getDestinationAirportCode(tourRoute[tourRoute.length - 1].destination),
  };
}

/**
 * Resolves the outbound (arrival) and return-departure airport codes for a
 * package, mirroring BuyNowForm.tsx's useMemo exactly: prefer the admin-set
 * destination[].isFlightArrival + iataCode entry (both outboundCode and
 * returnFromCode collapse to this single city — treated as a simple round
 * trip), else any destination[].iataCode entry, else fall back to the legacy
 * tour_route first/last city + country dictionary lookup (this is where
 * open-jaw/multi-city naturally falls out, when first city !== last city).
 */
function resolveDestinationAirports({ destination, tourRoute, country }) {
  const destinationEntries = destination ?? [];
  const arrivalEntry =
    destinationEntries.find((entry) => entry.isFlightArrival && entry.iataCode) ??
    destinationEntries.find((entry) => entry.iataCode) ??
    null;

  if (arrivalEntry?.iataCode) {
    return { outboundCode: arrivalEntry.iataCode, returnFromCode: arrivalEntry.iataCode };
  }

  const { firstCityCode, lastCityCode } = getFirstAndLastCityAirportCodes(tourRoute);
  const fallback = getDestinationAirportCode(country ?? '');
  return {
    outboundCode: firstCityCode ?? fallback,
    returnFromCode: lastCityCode ?? fallback,
  };
}

/**
 * Resolves travel dates for a departure, mirroring BuyNowForm.tsx's
 * useEffect (lines ~211-227). The interactive flow anchors validity-period
 * (FIT) departures on the user's chosen travel date; a nightly batch job has
 * no user, so it anchors on the departure's own start_date instead — the
 * nearest reasonable representative date.
 */
function resolveTravelDates({ departure, tourRoute }) {
  if (!departure.is_validity_period) {
    return { departureDateStr: departure.start_date, returnDateStr: departure.end_date };
  }

  const totalNights = (tourRoute ?? []).reduce((sum, leg) => sum + (leg.no_of_nights ?? 0), 0);
  const anchor = new Date(departure.start_date);
  const returnDate = new Date(anchor);
  returnDate.setDate(returnDate.getDate() + Math.max(1, totalNights));

  return {
    departureDateStr: anchor.toISOString().split('T')[0],
    returnDateStr: returnDate.toISOString().split('T')[0],
  };
}

module.exports = {
  getDestinationAirportCode,
  getFirstAndLastCityAirportCodes,
  resolveDestinationAirports,
  resolveTravelDates,
};
