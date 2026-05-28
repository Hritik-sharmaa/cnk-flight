const supabase = require('../../db/supabase');

async function upsertHotels(hotels) {
  if (!hotels.length) return 0;

  const hotelRows = hotels.map(({ hotel }) => ({
    supplier: hotel.supplier,
    supplier_hotel_id: hotel.supplierHotelId,
    name: hotel.name,
    slug: hotel.slug,
    property_type: hotel.propertyType,
    description: hotel.description,
    rating: hotel.rating,
    is_deleted: hotel.isDeleted ?? false,
    address_line: hotel.addressLine,
    postal_code: hotel.postalCode,
    city_name: hotel.cityName,
    state_name: hotel.stateName,
    country_name: hotel.countryName,
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    contact_phone: hotel.contactPhone,
    contact_email: hotel.contactEmail,
    contact_fax: hotel.contactFax,
    website: hotel.website,
    raw_data: hotel.rawData,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { data: upsertedHotels, error: hotelError } = await supabase
    .from('hotels_inventory')
    .upsert(hotelRows, { onConflict: 'supplier,supplier_hotel_id' })
    .select('id, supplier_hotel_id');

  if (hotelError) throw hotelError;

  // Map supplier_hotel_id → internal id for image/facility inserts
  const idMap = {};
  (upsertedHotels ?? []).forEach((h) => {
    idMap[h.supplier_hotel_id] = h.id;
  });

  // Collect images and facilities across all hotels in this batch
  const allImages = [];
  const allFacilities = [];
  const hotelIds = [];

  hotels.forEach(({ hotel, images, facilities }) => {
    const hotelId = idMap[hotel.supplierHotelId];
    if (!hotelId) return;

    hotelIds.push(hotelId);
    images.forEach((img) => allImages.push({ hotel_id: hotelId, image_url: img.imageUrl, image_size: img.imageSize, sort_order: img.sortOrder }));
    facilities.forEach((f) => allFacilities.push({ hotel_id: hotelId, facility_code: f.facilityCode, facility_type: f.facilityType, facility_name: f.facilityName }));
  });

  if (hotelIds.length) {
    // Delete existing images/facilities for this batch before re-inserting
    await supabase.from('hotels_images').delete().in('hotel_id', hotelIds);
    await supabase.from('hotels_facilities').delete().in('hotel_id', hotelIds);

    if (allImages.length) {
      const { error: imgError } = await supabase.from('hotels_images').insert(allImages);
      if (imgError) throw imgError;
    }

    if (allFacilities.length) {
      const { error: facError } = await supabase.from('hotels_facilities').insert(allFacilities);
      if (facError) throw facError;
    }
  }

  return hotelRows.length;
}

async function searchHotels({ cityId, page = 1, limit = 20 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await supabase
    .from('hotels_inventory')
    .select('id, name, rating, property_type, city_name, country_name, address_line, latitude, longitude, supplier_hotel_id')
    .eq('is_deleted', false)
    .eq('region_id', cityId)
    .order('rating', { ascending: false, nullsFirst: false })
    .order('name')
    .range(from, to);

  if (error) throw error;
  return data ?? [];
}

async function getHotelById(id) {
  const { data, error } = await supabase
    .from('hotels_inventory')
    .select(`
      *,
      hotels_images ( image_url, image_size, sort_order ),
      hotels_facilities ( facility_code, facility_type, facility_name )
    `)
    .eq('id', id)
    .eq('is_deleted', false)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // row not found
    throw error;
  }

  return data;
}

module.exports = { upsertHotels, searchHotels, getHotelById };
