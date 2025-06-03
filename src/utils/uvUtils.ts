export interface UVRisk {
  level: string;
  color: string;
  advice: string;
}

export function getUVRisk(uvIndex: number): UVRisk {
  if (uvIndex < 0) return {level: 'N/A', color: '#grey', advice: 'UV Index not available'}; // Handle negative or undefined
  if (uvIndex <= 2.9) return {level: 'Low', color: '#A3D6FF', advice: 'Minimal protection needed. You can safely be outside.'} // UV Index 0-2
  if (uvIndex <= 5.9) return {level: 'Moderate', color: '#FFD700', advice: 'Wear sunglasses on bright days. If you burn easily, cover up and use broad spectrum SPF 30+ sunscreen. Watch for bright surfaces, like sand, water and snow, which reflect UV and increase exposure.'} // UV Index 3-5
  if (uvIndex <= 7.9) return {level: 'High', color: '#FF8C00', advice: 'Reduce time in the sun between 10 a.m. and 4 p.m. If outdoors, seek shade and wear protective clothing, a wide-brimmed hat, and UV-blocking sunglasses. Generously apply broad spectrum SPF 30+ sunscreen every 2 hours, even on cloudy days, and after swimming or sweating.'} // UV Index 6-7
  if (uvIndex <= 10.9) return {level: 'Very High', color: '#E60000', advice: 'Minimize sun exposure between 10 a.m. and 4 p.m. If outdoors, seek shade and wear protective clothing, a wide-brimmed hat, and UV-blocking sunglasses. Generously apply broad spectrum SPF 30+ sunscreen every 2 hours, even on cloudy days, and after swimming or sweating.'} // UV Index 8-10
  return {level: 'Extreme', color: '#B500A1', advice: 'Try to avoid sun exposure between 10 a.m. and 4 p.m. If outdoors, seek shade and wear protective clothing, a wide-brimmed hat, and UV-blocking sunglasses. Generously apply broad spectrum SPF 30+ sunscreen every 2 hours, even on cloudy days, and after swimming or sweating.'} // UV Index 11+
} 