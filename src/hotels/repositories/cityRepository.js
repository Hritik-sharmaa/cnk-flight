const supabase = require('../../db/supabase');
const { toTripjackCountryName } = require('../providers/tripjack/tripjackHotelConfig');

// public.cities is CNK's single source of truth for tour destinations
// (countries.cities and packages.destination_legacy serve other purposes
// and aren't reliable/complete for this — confirmed). `cities.country_id`
// is a FK into countries(id), backfilled by migration_add_city_country_id.sql,
// so each destination is self-contained: one row, one city, one country.
//
// Returns a Map<cityNameLower, countryNameUpper> — cities.name is unique,
// so there's exactly one country per city, no ambiguity to resolve. A city
// whose `country_id` hasn't been set is left out of the map entirely —
// TripJack can't be safely matched for it until someone sets it. The value
// is run through toTripjackCountryName() so the map is directly comparable
// against TripJack's own countryName field (which doesn't always match our
// display name — e.g. TripJack sends "BURMA (MYANMAR)" for "Myanmar").
async function getSellableCityCountryMap() {
  const { data, error } = await supabase
    .from('cities')
    .select('name, countries(name)');
  if (error) throw error;

  const map = new Map();
  for (const row of data ?? []) {
    const cityName = (row.name ?? '').trim().toLowerCase();
    const countryName = toTripjackCountryName(row.countries?.name);
    if (!cityName || !countryName) continue;
    map.set(cityName, countryName);
  }
  return map;
}

// Single city lookup by id (public.cities), for the "sync just this one
// city" path triggered when someone adds a city in the admin — returns
// name + country name shaped for direct comparison against TripJack's
// countryName field, or null if the city or its country isn't set.
async function getCityById(cityId) {
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, countries(name)')
    .eq('id', cityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    countryName: data.countries?.name ?? null,
  };
}

// A single hotels_regions row by its TripJack supplier_region_id — used
// right after upsertCities() writes one matched region, to get its DB id
// for the follow-up hotel-mapping sync without re-listing every region.
async function getRegionBySupplierRegionId(supplierRegionId) {
  const { data, error } = await supabase
    .from('hotels_regions')
    .select('id, supplier_region_id, city_name, country_name')
    .eq('supplier', 'tripjack')
    .eq('supplier_region_id', supplierRegionId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
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

module.exports = {
  upsertCities,
  searchCities,
  getSellableCityCountryMap,
  listRegions,
  getCityById,
  getRegionBySupplierRegionId,
};
