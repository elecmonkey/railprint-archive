const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
