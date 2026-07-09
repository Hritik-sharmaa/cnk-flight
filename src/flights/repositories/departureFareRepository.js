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
 * All active/upcoming departures for a package tied at the cheapest
 * price_adult_double — same selection rule cnk-website's
 * attachStartingPrices()/fetchDeparturesBySlugDirect() use to pick "the"
 * starting-price departure (validity-period FIT departures are matched on
 * end_date instead of start_date), except when several departures share
 * that exact cheapest price, every one of them is returned rather than an
 * arbitrary single row. Read-path "starting price" logic picks whichever of
 * these it likes on any given request, so all of them need their own
 * (date-specific) flight price, not a copy of one another's.
 */
async function getCheapestActiveDepartures(packageId, isFIT) {
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('departures')
    .select('id, package_id, start_date, end_date, is_validity_period, price_adult_double')
    .eq('package_id', packageId)
    .eq('is_active', true)
    .eq('is_validity_period', Boolean(isFIT))
    .not('price_adult_double', 'is', null)
    .order('price_adult_double', { ascending: true });

  query = isFIT ? query.gte('end_date', today) : query.gte('start_date', today);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return [];

  const cheapest = data[0].price_adult_double;
  return data.filter((d) => d.price_adult_double === cheapest);
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

module.exports = { getFlightIncludedPackages, getCheapestActiveDepartures, writeDelhiFare };
