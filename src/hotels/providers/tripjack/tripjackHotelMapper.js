function slugify(name) {
  return (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseDescription(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { text: raw }; }
}

function mapCity(raw) {
  const parts = (raw.fullRegionName ?? '').split(', ');
  const stateName = parts.length >= 3 ? parts[parts.length - 2] : null;

  return {
    supplier: 'tripjack',
    supplierRegionId: String(raw.cityRegionId ?? ''),
    regionType: raw.regionType ?? null,
    cityName: raw.cityName ?? null,
    regionName: raw.regionName ?? raw.cityName ?? null,
    stateName,
    countryName: raw.countryName ?? null,
    countryCode: null,
    fullRegionName: raw.fullRegionName ?? raw.cityName ?? null,
    normalizedName: (raw.cityName ?? '').toLowerCase().trim(),
    latitude: null,
    longitude: null,
  };
}

function mapHotel(raw) {
  const addr = raw.address ?? {};
  const images = Array.isArray(raw.images) ? raw.images : [];
  const facilities = Array.isArray(raw.facilities) ? raw.facilities : [];

  return {
    hotel: {
      supplier: 'tripjack',
      supplierHotelId: String(raw.tjHotelId ?? ''),
      unicaId: raw.unicaId ? String(raw.unicaId) : null,
      supplierCityCode: addr.city?.code ? String(addr.city.code) : null, // used to resolve region_id FK
      name: raw.name ?? '',
      slug: slugify(raw.name),
      propertyType: raw.propertyType ?? null,
      description: parseDescription(raw.description),
      rating: raw.rating != null ? parseFloat(raw.rating) : null,
      isDeleted: raw.isDeleted === true,
      addressLine: addr.adr ?? null,
      postalCode: addr.postalCode ?? null,
      cityName: addr.city?.name ?? raw.cityName ?? null,
      stateName: addr.state?.name ?? null,
      countryName: addr.country?.name ?? raw.countryName ?? null,
      countryCode: addr.country?.code ?? null,
      latitude: raw.geolocation?.lt != null ? parseFloat(raw.geolocation.lt) : null,
      longitude: raw.geolocation?.ln != null ? parseFloat(raw.geolocation.ln) : null,
      contactPhone: raw.contact?.ph ?? null,
      contactEmail: raw.contact?.em ?? null,
      contactFax: raw.contact?.fax ?? null,
      website: raw.contact?.wb ?? null,
      rawData: raw,
    },
    images: images
      .filter((img) => img.url)
      .map((img, i) => ({
        imageUrl: img.url,
        imageSize: img.sz ?? null,
        sortOrder: i,
      })),
    facilities: facilities.map((f) => ({
      facilityCode: String(f.id ?? f.code ?? ''),
      facilityType: f.type ?? null,
      facilityName: f.name ?? '',
    })),
  };
}

module.exports = { mapCity, mapHotel };
