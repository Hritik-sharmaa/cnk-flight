const supabase = require('../../db/supabase');

async function upsertNationality({ supplierNationalityId, countryName, isoCode, isDefault }) {
  // Only one row may be flagged default — clear any existing default first so
  // the partial unique index (idx_hotels_nationalities_one_default) never conflicts.
  if (isDefault) {
    const { error: clearError } = await supabase
      .from('hotels_nationalities')
      .update({ is_default: false })
      .eq('supplier', 'tripjack')
      .eq('is_default', true);
    if (clearError) throw clearError;
  }

  const row = {
    supplier: 'tripjack',
    supplier_nationality_id: supplierNationalityId,
    country_name: countryName,
    iso_code: isoCode ?? null,
    ...(isDefault !== undefined ? { is_default: isDefault } : {}),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('hotels_nationalities')
    .upsert(row, { onConflict: 'supplier,supplier_nationality_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Bulk upsert from TripJack's /hms/v3/nationality-info sync. Never touches
// is_default — that stays whatever was manually set (India, by default),
// so a re-sync can't silently change the agent selector's pre-selected value.
async function bulkUpsertNationalities(nationalities) {
  if (!nationalities.length) return 0;

  const rows = nationalities.map((n) => ({
    supplier: 'tripjack',
    supplier_nationality_id: n.supplierNationalityId,
    country_name: n.countryName,
    iso_code: n.isoCode ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('hotels_nationalities')
    .upsert(rows, { onConflict: 'supplier,supplier_nationality_id', ignoreDuplicates: false });

  if (error) throw error;
  return rows.length;
}

async function searchNationalities({ q, limit = 50 }) {
  let query = supabase
    .from('hotels_nationalities')
    .select('id, supplier_nationality_id, country_name, iso_code, is_default')
    .order('is_default', { ascending: false })
    .order('country_name')
    .limit(limit);

  if (q) query = query.ilike('country_name', `%${q}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Resolves ISO 3166-1 alpha-2 codes to TripJack's own countryName spelling,
// via the already-synced hotels_nationalities table (populated by
// syncNationalities() from TripJack's nationality-info endpoint) — not a
// live TripJack API call. This is the fix for country-name mismatches like
// "BURMA (MYANMAR)"/"Myanmar" or "UNITED STATES"/"United States of
// America": matching by ISO code has no phrasing ambiguity, so a new
// mismatch never needs a manual alias again. Returns
// Map<isoCodeUpper, countryNameUpper>; codes with no matching row (e.g.
// hotels_nationalities hasn't been synced yet) are simply absent from the
// map — callers should fall back to name-based matching in that case.
async function getCountryNamesByIsoCodes(isoCodes) {
  const codes = [...new Set(isoCodes.filter(Boolean).map((c) => c.trim().toUpperCase()))];
  const map = new Map();
  if (!codes.length) return map;

  const { data, error } = await supabase
    .from('hotels_nationalities')
    .select('iso_code, country_name')
    .eq('supplier', 'tripjack')
    .in('iso_code', codes);

  if (error) throw error;

  for (const row of data ?? []) {
    const iso = (row.iso_code ?? '').trim().toUpperCase();
    const countryName = (row.country_name ?? '').trim().toUpperCase();
    if (!iso || !countryName) continue;
    map.set(iso, countryName);
  }
  return map;
}

module.exports = { upsertNationality, bulkUpsertNationalities, searchNationalities, getCountryNamesByIsoCodes };
