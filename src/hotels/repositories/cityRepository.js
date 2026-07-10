const supabase = require('../../db/supabase');

// public.cities is CNK's own destination list, extracted from `packages` —
// the only cities CNK actually sells. Used to scope the TripJack city sync
// down from its entire global city list to just these ~196 destinations,
// which is what keeps the downstream hotel-mapping sync small and fast
// instead of walking TripJack's full 1.6M-hotel worldwide catalogue.
async function getSellableCityNames() {
  const { data, error } = await supabase.from('cities').select('name');
  if (error) throw error;
  return new Set((data ?? []).map((c) => c.name.trim().toLowerCase()).filter(Boolean));
}

async function upsertCities(cities) {
  if (!cities.length) return 0;

  const rows = cities.map((c) => ({
    supplier: c.supplier,
    supplier_region_id: c.supplierRegionId,
    region_type: c.regionType,
    city_name: c.cityName,
    region_name: c.regionName,
    state_name: c.stateName,
    country_name: c.countryName,
    country_code: c.countryCode,
    full_region_name: c.fullRegionName,
    normalized_name: c.normalizedName,
    latitude: c.latitude,
    longitude: c.longitude,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('hotels_regions')
    .upsert(rows, { onConflict: 'supplier,supplier_region_id' });

  if (error) throw error;
  return rows.length;
}

// All synced regions (already scoped to CNK's destinations by syncCities()) —
// used to drive the region-by-region hotel-mapping sync.
async function listRegions() {
  const { data, error } = await supabase
    .from('hotels_regions')
    .select('id, supplier_region_id, city_name, country_name')
    .eq('supplier', 'tripjack')
    .eq('is_active', true);

  if (error) throw error;
  return data ?? [];
}

async function searchCities({ q, limit = 20 }) {
  const { data, error } = await supabase
    .from('hotels_regions')
    .select('id, city_name, region_name, state_name, country_name, country_code, supplier_region_id, region_type, latitude, longitude')
    .eq('is_active', true)
    .ilike('full_region_name', `%${q}%`)
    .order('city_name')
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

module.exports = { upsertCities, searchCities, getSellableCityNames, listRegions };
