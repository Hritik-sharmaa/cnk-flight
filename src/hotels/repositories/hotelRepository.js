const supabase = require('../../db/supabase');

async function upsertHotels(hotels) {
  if (!hotels.length) return 0;

  // Batch-resolve region_id by matching city_name + country_name.
  // We intentionally avoid addr.city.code because TripJack uses a different
  // numeric sequence for hotel city codes vs cityRegionId in the city list —
  // they collide across countries and cause hotels to be linked to wrong regions.
  const cityKeys = [...new Set(
    hotels
      .map(({ hotel }) => hotel.cityName && hotel.countryName
        ? `${hotel.cityName.toLowerCase().trim()}||${hotel.countryName.toLowerCase().trim()}`
        : null)
      .filter(Boolean)
  )];

  const cityKeyToRegionId = {};
  if (cityKeys.length) {
    const cityNames = [...new Set(hotels.map(({ hotel }) => hotel.cityName).filter(Boolean))];
    const { data: regions } = await supabase
      .from('hotels_regions')
      .select('id, city_name, country_name')
      .eq('supplier', 'tripjack')
      .in('city_name', cityNames);

    (regions ?? []).forEach((r) => {
      const key = `${(r.city_name ?? '').toLowerCase().trim()}||${(r.country_name ?? '').toLowerCase().trim()}`;
      cityKeyToRegionId[key] = r.id;
    });
  }

  const hotelRows = hotels.map(({ hotel }) => {
    const key = hotel.cityName && hotel.countryName
      ? `${hotel.cityName.toLowerCase().trim()}||${hotel.countryName.toLowerCase().trim()}`
      : null;
    return {
    supplier: hotel.supplier,
    supplier_hotel_id: hotel.supplierHotelId,
    unica_id: hotel.unicaId,
    region_id: key ? (cityKeyToRegionId[key] ?? null) : null,
    name: hotel.name,
    slug: hotel.slug,
    property_type: hotel.propertyType,
    description: hotel.description,
    rating: hotel.rating,
    is_deleted: hotel.isDeleted ?? false,
    address_line: hotel.addressLine,
    postal_code: hotel.postalCode,
    city_name: hotel.cityName,
    state_name: hotel.stateName,
    country_name: hotel.countryName,
    country_code: hotel.countryCode,
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    contact_phone: hotel.contactPhone,
    contact_email: hotel.contactEmail,
    contact_fax: hotel.contactFax,
    website: hotel.website,
    raw_data: hotel.rawData,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    };
  });

  const { data: upsertedHotels, error: hotelError } = await supabase
    .from('hotels_inventory')
    .upsert(hotelRows, { onConflict: 'supplier,supplier_hotel_id' })
    .select('id, supplier_hotel_id');

  if (hotelError) throw hotelError;

  // Map supplier_hotel_id → internal id for image/facility inserts
  const idMap = {};
  (upsertedHotels ?? []).forEach((h) => {
    idMap[h.supplier_hotel_id] = h.id;
  });

  const allImages = [];
  const allFacilities = [];
  const hotelIds = [];

  hotels.forEach(({ hotel, images, facilities }) => {
    const hotelId = idMap[hotel.supplierHotelId];
    if (!hotelId) return;

    hotelIds.push(hotelId);
    images.forEach((img) => allImages.push({
      hotel_id: hotelId,
      image_url: img.imageUrl,
      image_size: img.imageSize,
      sort_order: img.sortOrder,
    }));
    facilities.forEach((f) => allFacilities.push({
      hotel_id: hotelId,
      facility_code: f.facilityCode,
      facility_type: f.facilityType,
      facility_name: f.facilityName,
    }));
  });

  if (hotelIds.length) {
    await supabase.from('hotels_images').delete().in('hotel_id', hotelIds);
    await supabase.from('hotels_facilities').delete().in('hotel_id', hotelIds);

    if (allImages.length) {
      const { error: imgError } = await supabase.from('hotels_images').insert(allImages);
      if (imgError) throw imgError;
    }

    if (allFacilities.length) {
      const { error: facError } = await supabase.from('hotels_facilities').insert(allFacilities);
      if (facError) throw facError;
    }
  }

  return hotelRows.length;
}

const HOTEL_COLS = 'id, name, rating, property_type, city_name, country_name, address_line, latitude, longitude, supplier_hotel_id, description, contact_phone, website';

// Sanitize free-text input into a safe plainto_tsquery string.
// plainto_tsquery is injection-safe — Supabase parameterises it.
function sanitizeQ(raw) {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 200);
}

async function searchHotels({ cityId, q, minRating, sortBy = 'rating_desc', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const to     = offset + limit - 1;

  // ── 1. Resolve cityId → region (B-tree on hotels_regions.id) ────────────
  let region = null;
  if (cityId) {
    const { data, error } = await supabase
      .from('hotels_regions')
      .select('id, city_name')
      .eq('id', cityId)
      .single();

    if (error || !data) return { hotels: [], total: 0 };
    region = data;
  }

  // ── 2. Build filtered query factory ─────────────────────────────────────
  const applyFilters = (base) => {
    let query = base.eq('is_deleted', false);
    // Match by region_id OR city_name (covers hotels whose region_id was not resolved at sync time)
    if (region)    query = query.or(`region_id.eq.${region.id},city_name.ilike.%${region.city_name}%`);
    if (q)         query = query.textSearch('search_vector', sanitizeQ(q), { type: 'plain', config: 'simple' });
    if (minRating) query = query.gte('rating', minRating);
    return query;
  };

  // ── 3. Run count + data page in parallel ─────────────────────────────────
  const dataQuery = applyFilters(supabase.from('hotels_inventory').select(HOTEL_COLS));

  const orderedQuery = sortBy === 'name_asc'
    ? dataQuery.order('name').order('rating', { ascending: false, nullsFirst: false })
    : dataQuery.order('rating', { ascending: false, nullsFirst: false }).order('name');

  const [{ count, error: countErr }, { data, error }] = await Promise.all([
    applyFilters(supabase.from('hotels_inventory').select('id', { count: 'exact', head: true })),
    orderedQuery.range(offset, to),
  ]);

  if (countErr) throw countErr;
  if (error)    throw error;

  return { hotels: data ?? [], total: count ?? 0 };
}

async function getHotelById(id) {
  const { data, error } = await supabase
    .from('hotels_inventory')
    .select(`
      *,
      hotels_images ( image_url, image_size, sort_order ),
      hotels_facilities ( facility_code, facility_type, facility_name )
    `)
    .eq('id', id)
    .eq('is_deleted', false)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data;
}

async function markHotelsDeleted(supplierHotelIds) {
  if (!supplierHotelIds.length) return 0;
  const { data, error } = await supabase
    .from('hotels_inventory')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('supplier', 'tripjack')
    .in('supplier_hotel_id', supplierHotelIds)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

module.exports = { upsertHotels, markHotelsDeleted, searchHotels, getHotelById };
