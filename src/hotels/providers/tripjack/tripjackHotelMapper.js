function slugify(name) {
  return (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

/**
 * Maps a hotel object from fetch-hotel-content (V3 Static Content API).
 *
 * Response structure:
 *   tjHotelId, unicaId, name, is_active, star_rating,
 *   property_type: { id, name },
 *   locale: { address: { fulladdr, city, statename, countryname, countrycode, postal_code },
 *             coordinates: { lat, long }, phone: [] },
 *   amenities: { "0": { id, name }, "1": ... },  ← object with numeric keys
 *   images: [{ is_hero_image, links: { XXL: { href } } }],
 *   descriptions: { default, amenities, dining, location, ... }
 */
function mapHotel(raw) {
  const locale   = raw.locale ?? {};
  const addr     = locale.address ?? {};
  const coords   = locale.coordinates ?? {};
  const phones   = Array.isArray(locale.phone) ? locale.phone : [];

  // amenities is an object with numeric keys, not an array
  const amenitiesObj = raw.amenities ?? {};
  const facilities = Object.values(amenitiesObj).map((f) => ({
    facilityCode: String(f.id ?? ''),
    facilityType: null,
    facilityName: f.name ?? '',
  }));

  // images: each entry has links.{SIZE}.href
  const images = (raw.images ?? [])
    .map((img, i) => {
      const links = img.links ?? {};
      // prefer XXL, fall back to first available size
      const sizeKey = links.XXL ? 'XXL' : Object.keys(links)[0];
      const href = sizeKey ? links[sizeKey]?.href : null;
      if (!href) return null;
      return {
        imageUrl:    href,
        imageSize:   sizeKey ?? null,
        isHeroImage: img.is_hero_image === true,
        sortOrder:   i,
      };
    })
    .filter(Boolean);

  return {
    hotel: {
      supplier:        'tripjack',
      supplierHotelId: String(raw.tjHotelId ?? ''),
      unicaId:         raw.unicaId ? String(raw.unicaId) : null,
      name:            raw.name ?? '',
      slug:            slugify(raw.name),
      propertyType:    raw.property_type?.name ?? raw.property_type?.id ?? null,
      description:     raw.descriptions ?? null,
      rating:          raw.star_rating != null ? parseFloat(raw.star_rating) : null,
      isDeleted:       raw.is_active === false,
      addressLine:     addr.fulladdr ?? addr.line_1 ?? null,
      postalCode:      addr.postal_code ?? null,
      cityName:        addr.city ?? null,
      stateName:       addr.statename ?? null,
      countryName:     addr.countryname ?? null,
      countryCode:     addr.countrycode ?? null,
      latitude:        coords.lat  != null ? parseFloat(coords.lat)  : null,
      longitude:       coords.long != null ? parseFloat(coords.long) : null,
      contactPhone:    phones[0] ?? null,
      contactEmail:    null,
      contactFax:      null,
      website:         null,
      rawData:         raw,
    },
    images,
    facilities,
  };
}

module.exports = { mapCity, mapHotel };
