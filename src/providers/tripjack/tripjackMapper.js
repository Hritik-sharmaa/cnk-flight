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
    // Special Return pairing fields (Tripjack errCode 1080 — both legs must have
    // compatible sri/msri: onward.sri must appear in return.msri and vice versa).
    sri: priceOption.sri ?? null,
    msri: Array.isArray(priceOption.msri) ? priceOption.msri : [],
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
  const trips = result.tripInfos || {};

  const mapTrip = (trip) => ({
    segments: (trip.sI || []).map(mapSegment),
    fareOptions: (trip.totalPriceList || []).map(mapFareOption),
  });

  // Standard keys (domestic one-way/return + international COMBO)
  if (Array.isArray(trips.ONWARD)) mapped.onward = trips.ONWARD.map(mapTrip);
  if (Array.isArray(trips.RETURN)) mapped.return = trips.RETURN.map(mapTrip);
  if (Array.isArray(trips.COMBO)) mapped.combo = trips.COMBO.map(mapTrip);

  // Tripjack returns numeric-indexed keys ("0", "1", ...) for **domestic
  // multi-city** searches — one trip block per leg in order. International
  // multi-city uses tripInfos.COMBO instead (already handled above).
  if (!mapped.onward && !mapped.combo) {
    const numericKeys = Object.keys(trips)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      // Expose every leg as an ordered legs[] array so the frontend can render
      // one fare list per leg and collect a priceId per leg for /review.
      mapped.legs = numericKeys.map((k) => (trips[k] || []).map(mapTrip));
      // Also surface leg 0 as onward so single-leg / legacy callers keep working.
      mapped.onward = mapped.legs[0];
    }
  }

  return mapped;
}

function extractTotalFareDetail(raw) {
  // Tripjack uses lowercase 'fc' inside totalFareDetail but uppercase 'fC' inside individual
  // passenger fares (fd.ADULT.fC.TF). Try both to guard against any casing inconsistency.
  return raw.totalPriceInfo?.totalFareDetail?.fC ?? raw.totalPriceInfo?.totalFareDetail?.fc ?? null;
}

function mapReviewResult(raw) {
  if (!raw.bookingId) return raw;

  const fc = extractTotalFareDetail(raw);
  const totalFare = fc?.TF ?? null;
  const baseFare = fc?.BF ?? null;
  const tax = fc?.TAF ?? (totalFare !== null && baseFare !== null ? totalFare - baseFare : null);

  return {
    bookingId: raw.bookingId,
    sessionValidSeconds: raw.conditions?.st,
    conditions: raw.conditions,
    totalFare,
    baseFare,
    tax,
    tripInfos: raw.tripInfos,
    raw,
  };
}

function mapBookResult(raw) {
  if (!raw.bookingId) return { raw };

  const fc = extractTotalFareDetail(raw);
  const totalFare = fc?.TF ?? (raw.totalFare ?? null);
  const baseFare = fc?.BF ?? null;
  const tax = fc?.TAF ?? (totalFare !== null && baseFare !== null ? totalFare - baseFare : null);

  return {
    bookingId: raw.bookingId,
    totalFare,
    baseFare,
    tax,
    raw,
  };
}

function mapFareRule(raw) {
  // Tripjack returns: { fareRule: { "<sector>": { fr: {...mini-rules...}, tfr: { CANCELLATION: [...], DATECHANGE: [...], NO_SHOW: [...] }, miscInfo: "..." } } }
  // Frontend wants:  { fareRules: [{ policyName, policyInfo }] }
  const fareRules = [];

  // Tripjack has been seen using both `fareRule` and `farerule` casings; accept either.
  const sectors = raw?.fareRule ?? raw?.farerule ?? {};
  for (const [sectorKey, sector] of Object.entries(sectors)) {
    if (!sector || typeof sector !== 'object') continue;

    // tfr — structured policy entries
    const tfr = sector.tfr ?? {};
    for (const [category, entries] of Object.entries(tfr)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const lines = entries.map((e) => {
        const parts = [];
        if (e.amount != null) parts.push(`Airline fee: ${e.amount}`);
        if (e.additionalFee != null) parts.push(`Service fee: ${e.additionalFee}`);
        if (e.st != null && e.et != null) parts.push(`Window: ${e.st}h–${e.et}h ${e.pp ?? ''}`.trim());
        return parts.join(' | ');
      }).filter(Boolean);

      if (lines.length > 0) {
        fareRules.push({
          policyName: `${sectorKey} — ${category}`,
          policyInfo: lines.join('\n'),
        });
      }
    }

    // fr — mini rule text (object of category -> string)
    const fr = sector.fr ?? {};
    for (const [category, info] of Object.entries(fr)) {
      if (typeof info === 'string' && info.trim()) {
        fareRules.push({
          policyName: `${sectorKey} — ${category}`,
          policyInfo: info,
        });
      } else if (info && typeof info === 'object') {
        // Sometimes fr[category] is an object with policy fields — stringify minimally
        const text = JSON.stringify(info, null, 2);
        if (text && text !== '{}') {
          fareRules.push({
            policyName: `${sectorKey} — ${category}`,
            policyInfo: text,
          });
        }
      }
    }

    if (sector.miscInfo && typeof sector.miscInfo === 'string') {
      fareRules.push({
        policyName: `${sectorKey} — Other Rules`,
        policyInfo: sector.miscInfo,
      });
    }
  }

  return { fareRules, raw };
}

function mapSeatMap(raw) {
  // Tripjack returns: { tripSeatMap: { tripSeat: { "<segmentId>": { sData: { row, column }, sInfo: [...] } } } }
  // (Older shape skipped the `tripSeat` wrapper — accept both.)
  // Frontend wants:  { tripId, seatLayout: SeatInfo[][] }   where SeatInfo = { code, row, column, available, price?, seatType? }
  const segments = raw?.tripSeatMap?.tripSeat ?? raw?.tripSeatMap ?? {};
  const segmentIds = Object.keys(segments).filter((k) => segments[k] && typeof segments[k] === 'object');
  if (segmentIds.length === 0) return { tripId: '', seatLayout: [], raw };

  // Use the first segment — frontend assigns one seat key per traveller
  const tripId = segmentIds[0];
  const segment = segments[tripId] ?? {};

  // Docs say `sInfo` is at the segment root, but in practice it can be nested inside `sData`.
  // Try both, then fall back to scanning for any seat-like array so a future shape change
  // doesn't break us silently.
  let sInfo = [];
  if (Array.isArray(segment.sInfo)) {
    sInfo = segment.sInfo;
  } else if (Array.isArray(segment.sData?.sInfo)) {
    sInfo = segment.sData.sInfo;
  } else {
    const looksLikeSeat = (a) =>
      Array.isArray(a) && a.length > 0 && a[0] && typeof a[0] === 'object' && ('code' in a[0] || 'seatNo' in a[0]);
    for (const v of Object.values(segment)) {
      if (looksLikeSeat(v)) { sInfo = v; break; }
      if (v && typeof v === 'object') {
        for (const inner of Object.values(v)) {
          if (looksLikeSeat(inner)) { sInfo = inner; break; }
        }
        if (sInfo.length > 0) break;
      }
    }
  }

  // Build a row -> column-ordered grid
  const byRow = new Map();
  for (const seat of sInfo) {
    const row = seat.seatPosition?.row ?? seat.row;
    const column = seat.seatPosition?.column ?? seat.column;
    if (row == null) continue;

    const seatType = [
      seat.isLegroom && 'legroom',
      seat.isAisle && 'aisle',
      seat.isExitRow && 'exit',
    ].filter(Boolean).join('-') || undefined;

    const mapped = {
      code: seat.code,
      row,
      column,
      available: seat.isBooked === false,
      price: typeof seat.amount === 'number' ? seat.amount : undefined,
      seatType,
      seatNo: seat.seatNo,
    };

    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(mapped);
  }

  const seatLayout = Array.from(byRow.entries())
    .sort(([a], [b]) => a - b)
    .map(([, seats]) => seats.sort((a, b) => (a.column ?? 0) - (b.column ?? 0)));

  return { tripId, seatLayout, raw };
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

module.exports = { mapSearchResult, mapReviewResult, mapBookResult, mapBookingDetails, mapFareRule, mapSeatMap, mapSegment, mapFareOption };
