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

module.exports = { upsertNationality, bulkUpsertNationalities, searchNationalities };
