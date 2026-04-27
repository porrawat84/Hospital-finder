export function haversineDistance(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function sortHospitalsByDistance(hospitals, userPosition) {
  return hospitals
    .map((hospital) => ({
      ...hospital,
      distance: haversineDistance(
        userPosition.lat,
        userPosition.lng,
        hospital.lat,
        hospital.lng
      )
    }))
    .sort((a, b) => a.distance - b.distance);
}
