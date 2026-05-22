/**
 * Maps Tripjack-specific field names to a normalized internal format.
 * All other providers should produce the same normalized shape.
 *
 * Field reference:
 *   sI  = segment info
 *   fD  = flight details
 *   al  = airline
 *   dt  = departure time
 *   at  = arrival time
 *   fC  = fare components
 *   TF  = total fare
 *   BF  = base fare
 *   TAF = taxes and fees
 *   rT  = refundable type (0=No, 1=Yes, 2=Partial)
 *   iB  = included baggage
 */

function mapSegment(si) {
  return {
    id: si.id,
    airline: {
      code: si.fD?.aI?.code,
      name: si.fD?.aI?.name,
      flightNumber: si.fD?.fN || '',
    },
    departure: {
      airport: si.da?.code,
      city: si.da?.cityCode,
      terminal: si.da?.terminal,
      time: si.dt,
    },
    arrival: {
      airport: si.aa?.code,
      city: si.aa?.cityCode,
      terminal: si.aa?.terminal,
      time: si.at,
    },
    durationMinutes: si.duration,
    stops: si.stops,
    cabin: si.cC,
    ssrInfo: si.ssrInfo || null,
  };
}

function mapFareOption(priceOption) {
  const adultFare = priceOption.fd?.ADULT;
  const childFare = priceOption.fd?.CHILD;
  const infantFare = priceOption.fd?.INFANT;

  return {
    priceId: priceOption.id,
    fareIdentifier: priceOption.fareIdentifier,
    refundable: adultFare?.rT,   // 0=No, 1=Yes, 2=Partial
    adult: adultFare ? {
      totalFare: adultFare.fC?.TF,
      baseFare: adultFare.fC?.BF,
      tax: adultFare.fC?.TAF,
      baggage: {
        checkIn: adultFare.bI?.iB,
        cabin: adultFare.bI?.cB,
      },
    } : null,
    child: childFare ? {
      totalFare: childFare.fC?.TF,
      baseFare: childFare.fC?.BF,
      tax: childFare.fC?.TAF,
    } : null,
    infant: infantFare ? {
      totalFare: infantFare.fC?.TF,
      baseFare: infantFare.fC?.BF,
      tax: infantFare.fC?.TAF,
    } : null,
  };
}

function mapSearchResult(raw) {
  const result = raw.searchResult;
  if (!result) return raw;

  const mapped = { raw };

  if (result.tripInfos?.ONWARD) {
    mapped.onward = result.tripInfos.ONWARD.map((trip) => ({
      segments: (trip.sI || []).map(mapSegment),
      fareOptions: (trip.totalPriceList || []).map(mapFareOption),
    }));
  }

  if (result.tripInfos?.RETURN) {
    mapped.return = result.tripInfos.RETURN.map((trip) => ({
      segments: (trip.sI || []).map(mapSegment),
      fareOptions: (trip.totalPriceList || []).map(mapFareOption),
    }));
  }

  if (result.tripInfos?.COMBO) {
    mapped.combo = result.tripInfos.COMBO.map((trip) => ({
      segments: (trip.sI || []).map(mapSegment),
      fareOptions: (trip.totalPriceList || []).map(mapFareOption),
    }));
  }

  return mapped;
}

function mapReviewResult(raw) {
  if (!raw.bookingId) return raw;

  // Tripjack uses lowercase 'fc' inside totalFareDetail but uppercase 'fC' inside individual
  // passenger fares (fd.ADULT.fC.TF). Try both to guard against any casing inconsistency.
  const totalFare =
    raw.totalPriceInfo?.totalFareDetail?.fC?.TF ??
    raw.totalPriceInfo?.totalFareDetail?.fc?.TF ??
    null;

  return {
    bookingId: raw.bookingId,
    sessionValidSeconds: raw.conditions?.st,
    conditions: raw.conditions,
    totalFare,
    tripInfos: raw.tripInfos,
    raw,
  };
}

function mapBookingDetails(raw) {
  if (!raw.order) return raw;

  return {
    bookingId: raw.order.bookingId,
    status: raw.order.status,
    amount: raw.order.amount,
    note: raw.order.orderNote,
    travellers: raw.itemInfos?.AIR?.travellerInfos,
    totalFare: raw.itemInfos?.AIR?.totalPriceInfo?.totalFareDetail?.fc?.TF,
    raw,
  };
}

module.exports = { mapSearchResult, mapReviewResult, mapBookingDetails, mapSegment, mapFareOption };
