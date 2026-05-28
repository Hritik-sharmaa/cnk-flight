function mapCity(raw) {
  return {
    supplier: 'tripjack',
    supplierRegionId: String(raw.regionId ?? raw.id ?? ''),
    regionType: raw.regionType ?? null,
    cityName: raw.cityName ?? null,
    regionName: raw.regionName ?? raw.cityName ?? null,
    stateName: raw.stateName ?? null,
    countryName: raw.countryName ?? null,
    countryCode: raw.countryCode ?? null,
    fullRegionName: [raw.cityName, raw.stateName, raw.countryName].filter(Boolean).join(', '),
    normalizedName: (raw.cityName ?? '').toLowerCase().trim(),
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
  };
}

function mapHotel(raw) {
  const addr = raw.ad ?? {};
  const images = Array.isArray(raw.imgs) ? raw.imgs : [];
  const facilities = Array.isArray(raw.fac) ? raw.fac : [];

  return {
    hotel: {
      supplier: 'tripjack',
      supplierHotelId: String(raw.id ?? ''),
      name: raw.name ?? '',
      propertyType: raw.pt ?? null,
      rating: raw.cat != null ? parseFloat(raw.cat) : null,
      addressLine: addr.adr ?? null,
      postalCode: addr.postalCode ?? null,
      cityName: addr.city?.name ?? raw.cityName ?? null,
      stateName: addr.state?.name ?? null,
      countryName: addr.country?.name ?? null,
      latitude: raw.gl?.lt ?? null,
      longitude: raw.gl?.ln ?? null,
      contactPhone: raw.contact?.ph ?? null,
      contactEmail: raw.contact?.em ?? null,
      contactFax: raw.contact?.fx ?? null,
      website: raw.contact?.web ?? null,
      rawData: raw,
    },
    images: images.map((img, i) => ({
      imageUrl: img.url ?? img,
      imageSize: img.sz ?? null,
      sortOrder: i,
    })),
    facilities: facilities.map((f) => ({
      facilityCode: String(f.id ?? f.code ?? ''),
      facilityType: f.type ?? null,
      facilityName: f.name ?? String(f),
    })),
  };
}

module.exports = { mapCity, mapHotel };
