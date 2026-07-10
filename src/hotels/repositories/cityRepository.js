const supabase = require('../../db/supabase');

// Builds a Map<cityNameLower, Set<countryNameUpper>> of CNK's real
// destinations and which country(s) each belongs to. Two tiers, in order:
//
//   Tier 1 — public.countries.cities: CNK's own admin-curated list of which
//   city names belong to which country (e.g. the "India" row's `cities`
//   field lists "Barkot, Guwahati, ..., Agra, ..."). Exact and reliable
//   where present, but confirmed incomplete — roughly a third of CNK's
//   destinations (public.cities rows), including big unambiguous ones like
//   Mumbai, Sydney, Singapore, Chicago, aren't linked to any country here.
//
//   Tier 2 — packages fallback, only for city names Tier 1 didn't cover:
//   look up every package whose destination_legacy mentions that city, and
//   use the union of those packages' own `country` field as the allowed
//   set. A single-country package resolves exactly; a multi-country package
//   narrows the match to "one of these specific countries" instead of
//   "anywhere in the world" — which is what stops collision-prone names
//   (Moscow, Denver, Melbourne, Buenos Aires, Lima, ...) from matching the
//   wrong country again once they fall through to this tier.
//
// A city name absent from both tiers is left out of the map entirely —
// TripJack can't be matched for it until it's linked to a country or a
// package (both by hand — see docs/HOTELS.md).
async function getSellableCityCountryMap() {
  const { data: countryRows, error: countryErr } = await supabase.from('countries').select('name, cities');
  if (countryErr) throw countryErr;

  const map = new Map();
  for (const row of countryRows ?? []) {
    if (!row.cities) continue;
    const countryName = (row.name ?? '').trim().toUpperCase();
    if (!countryName) continue;

    for (const rawCity of row.cities.split(',')) {
      const cityName = rawCity.trim().toLowerCase();
      if (!cityName) continue;
      if (!map.has(cityName)) map.set(cityName, new Set());
      map.get(cityName).add(countryName);
    }
  }

  // Tier 2: fill gaps for public.cities entries Tier 1 didn't resolve.
  const { data: cityRows, error: cityErr } = await supabase.from('cities').select('name');
  if (cityErr) throw cityErr;

  const unresolved = new Set(
    (cityRows ?? [])
      .map((c) => (c.name ?? '').trim().toLowerCase())
      .filter((name) => name && !map.has(name)),
  );

  if (unresolved.size) {
    const { data: packageRows, error: pkgErr } = await supabase
      .from('packages')
      .select('destination_legacy, country')
      .not('destination_legacy', 'is', null)
      .not('country', 'is', null);
    if (pkgErr) throw pkgErr;

    for (const pkg of packageRows ?? []) {
      const pkgCountries = (pkg.country ?? '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      if (!pkgCountries.length) continue;

      const pkgCities = (pkg.destination_legacy ?? '')
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

      for (const cityName of pkgCities) {
        if (!unresolved.has(cityName)) continue; // only fill what Tier 1 missed
        if (!map.has(cityName)) map.set(cityName, new Set());
        for (const country of pkgCountries) map.get(cityName).add(country);
      }
    }
  }

  return map;
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

module.exports = { upsertCities, searchCities, getSellableCityCountryMap, listRegions };
