const supabase = require('../lib/supabase');

async function saveBooking({ provider, providerBookingId, status, bookingType, totalFare, currency, searchParams, bookingRequest, bookingResponse, createdBy }) {
  const { data, error } = await supabase
    .from('flight_bookings')
    .insert({
      provider,
      provider_booking_id: providerBookingId,
      status,
      booking_type: bookingType || 'INSTANT',
      total_fare: totalFare,
      currency: currency || 'INR',
      search_params: searchParams || null,
      booking_request: bookingRequest || null,
      booking_response: bookingResponse || null,
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function savePassengers(flightBookingId, travellerInfo) {
  if (!travellerInfo || travellerInfo.length === 0) return [];

  const rows = travellerInfo.map((t) => ({
    flight_booking_id: flightBookingId,
    passenger_type: t.pt,
    title: t.ti || null,
    first_name: t.fN,
    last_name: t.lN,
    dob: t.dob || null,
    passport_number: t.pNum || null,
    passport_expiry: t.eD || null,
    passport_nationality: t.pNat || null,
    pan_number: t.pan || null,
  }));

  const { data, error } = await supabase.from('flight_passengers').insert(rows).select();
  if (error) throw error;
  return data;
}

async function updateBookingStatus(providerBookingId, status, bookingResponse) {
  const { data, error } = await supabase
    .from('flight_bookings')
    .update({ status, booking_response: bookingResponse })
    .eq('provider_booking_id', providerBookingId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getBookingByProviderId(providerBookingId) {
  const { data, error } = await supabase
    .from('flight_bookings')
    .select('*, flight_passengers(*)')
    .eq('provider_booking_id', providerBookingId)
    .single();

  if (error) throw error;
  return data;
}

module.exports = { saveBooking, savePassengers, updateBookingStatus, getBookingByProviderId };
