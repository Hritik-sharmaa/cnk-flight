const { upsertNationality, searchNationalities } = require('../repositories/nationalityRepository');

async function upsertNationalityService({ supplier_nationality_id, country_name, iso_code, is_default }) {
  return upsertNationality({
    supplierNationalityId: supplier_nationality_id,
    countryName: country_name,
    isoCode: iso_code,
    isDefault: is_default,
  });
}

async function searchNationalitiesService({ q, limit }) {
  return searchNationalities({ q, limit });
}

module.exports = { upsertNationalityService, searchNationalitiesService };
