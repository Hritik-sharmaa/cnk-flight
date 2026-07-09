const supabase = require('../../db/supabase');

// Reads/writes cnk-website's `packages`/`departures` tables directly — same
// Supabase project cnk-flight already holds credentials for (see db/supabase.js).

/**
 * Packages that should get a nightly Delhi-origin indicative fare:
 * includes_flight = true, active, with a slug (needed only for logging).
 */
async function getFlightIncludedPackages({ afterId = null, limit = 25 } = {}) {
  let query = supabase
    .from('packages')
    .select(
      'id, slug, package_type, country, destination, tour_route, is_active, includes_flight',
    )
    .eq('is_active', true)
    .eq('includes_flight', true)
    .order('id', { ascending: true })
    .limit(limit);

  if (afterId) query = query.gt('id', afterId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * The cheapest active/upcoming departure for a package — same selection rule
 * cnk-website's attachStartingPrices()/fetchDeparturesBySlugDirect() use:
 * min price_adult_double among active, non-past departures (validity-period
 * FIT departures are matched on end_date instead of start_date).
 */
async function getCheapestActiveDeparture(packageId, isFIT) {
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('departures')
    .select('id, package_id, start_date, end_date, is_validity_period, price_adult_double')
    .eq('package_id', packageId)
    .eq('is_active', true)
    .eq('is_validity_period', Boolean(isFIT))
    .not('price_adult_double', 'is', null)
    .order('price_adult_double', { ascending: true })
    .limit(1);

  query = isFIT ? query.gte('end_date', today) : query.gte('start_date', today);

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] ?? null;
}

async function writeDelhiFare(departureId, fareAmount) {
  const { error } = await supabase
    .from('departures')
    .update({
      flight_price_del: fareAmount,
      flight_price_updated_at: new Date().toISOString(),
    })
    .eq('id', departureId);

  if (error) throw error;
}

module.exports = { getFlightIncludedPackages, getCheapestActiveDeparture, writeDelhiFare };
