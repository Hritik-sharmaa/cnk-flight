const { searchHotels, getHotelById } = require('../repositories/hotelRepository');

async function searchHotelsService({ cityId, page, limit }) {
  return searchHotels({ cityId, page, limit });
}

async function getHotelByIdService(id) {
  return getHotelById(id);
}

module.exports = { searchHotelsService, getHotelByIdService };
