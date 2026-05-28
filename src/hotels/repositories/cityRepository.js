const supabase = require('../../db/supabase');

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
    .from('regions')
    .upsert(rows, { onConflict: 'supplier,supplier_region_id' });

  if (error) throw error;
  return rows.length;
}

async function searchCities({ q, limit = 20 }) {
  const { data, error } = await supabase
    .from('regions')
    .select('id, city_name, region_name, state_name, country_name, country_code, supplier_region_id, region_type, latitude, longitude')
    .eq('is_active', true)
    .ilike('full_region_name', `%${q}%`)
    .order('city_name')
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

module.exports = { upsertCities, searchCities };
