const { searchCities } = require('../repositories/cityRepository');

async function searchCitiesService({ q, limit }) {
  if (!q || q.trim().length < 2) {
    return [];
  }
  return searchCities({ q: q.trim(), limit });
}

module.exports = { searchCitiesService };
