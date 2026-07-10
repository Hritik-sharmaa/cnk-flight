const supabase = require('../../db/supabase');

const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Upsert lightweight rows (name/city/rating/hero image — no heavy content)
 * into hotels_inventory. Used by the recurring catalogue-wide sync and by
 * the on-the-fly fallback when a hotel is viewed before the sync has ever
 * reached it.
 * @param {Array} rows - toLightweightRow() output from tripjackHotelMapper
 */
async function upsertHotelIndex(rows) {
  if (!rows.length) return 0;

  // Batch-resolve region_id by matching city_name + country_name.
  // We intentionally avoid addr.city.code because TripJack uses a different
  // numeric sequence for hotel city codes vs cityRegionId in the city list —
  // they collide across countries and cause hotels to be linked to wrong regions.
  const cityNames = [...new Set(rows.map((r) => r.cityName).filter(Boolean))];

  const cityKeyToRegionId = {};
  if (cityNames.length) {
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

  const now = new Date().toISOString();
  const hotelRows = rows.map((hotel) => {
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
      hero_image_url: hotel.heroImageUrl,
      last_synced_at: now,
      updated_at: now,
    };
  });

  const { error } = await supabase
    .from('hotels_inventory')
    .upsert(hotelRows, { onConflict: 'supplier,supplier_hotel_id' });

  if (error) throw error;
  return hotelRows.length;
}

async function getDetailCache(hotelId) {
  const { data, error } = await supabase
    .from('hotel_details_cache')
    .select('detail_cache, cached_at')
    .eq('hotel_id', hotelId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw error;
  }

  const isStale = Date.now() - new Date(data.cached_at).getTime() > DETAIL_CACHE_TTL_MS;
  return isStale ? null : data.detail_cache;
}

async function upsertDetailCache(hotelId, detailCache) {
  const { error } = await supabase
    .from('hotel_details_cache')
    .upsert(
      { hotel_id: hotelId, detail_cache: detailCache, cached_at: new Date().toISOString() },
      { onConflict: 'hotel_id' },
    );
  if (error) throw error;
}

async function purgeExpiredDetailCache() {
  const cutoff = new Date(Date.now() - DETAIL_CACHE_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from('hotel_details_cache')
    .delete()
    .lt('cached_at', cutoff)
    .select('id');

  if (error) throw error;
  return (data ?? []).length;
}

const HOTEL_COLS = 'id, name, rating, property_type, city_name, country_name, address_line, latitude, longitude, supplier_hotel_id, contact_phone, hero_image_url';

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
    .select('*')
    .eq('id', id)
    .eq('is_deleted', false)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data;
}

async function getHotelBySupplierHotelId(supplierHotelId) {
  const { data, error } = await supabase
    .from('hotels_inventory')
    .select('*')
    .eq('supplier', 'tripjack')
    .eq('supplier_hotel_id', supplierHotelId)
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

module.exports = {
  upsertHotelIndex,
  markHotelsDeleted,
  searchHotels,
  getHotelById,
  getHotelBySupplierHotelId,
  getDetailCache,
  upsertDetailCache,
  purgeExpiredDetailCache,
};
