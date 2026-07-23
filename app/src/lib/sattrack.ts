/**
 * satellite.js SGP4 helpers shared by the globe layer and the entity drawer.
 */

import * as satellite from 'satellite.js';
import type { SatelliteTle } from '@/store/useLiveStore';

export interface SatRecEntry {
  tle: SatelliteTle;
  satrec: satellite.SatRec;
}

export function buildSatRecs(tles: SatelliteTle[]): SatRecEntry[] {
  const out: SatRecEntry[] = [];
  for (const tle of tles) {
    try {
      const satrec = satellite.twoline2satrec(tle.tle1, tle.tle2);
      if (satrec && !Number.isNaN(satrec.no)) out.push({ tle, satrec });
    } catch {
      /* malformed TLE — skip */
    }
  }
  return out;
}

export interface SatPosition {
  lat: number; // degrees
  lon: number; // degrees
  altKm: number;
  velKmS: number;
}

/** Propagate one satrec to a date; null when decayed / propagation error. */
export function propagate(satrec: satellite.SatRec, date: Date): SatPosition | null {
  try {
    const pv = satellite.propagate(satrec, date);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let velKmS = 0;
    if (pv.velocity && typeof pv.velocity !== 'boolean') {
      velKmS = Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2);
    }
    return { lat, lon, altKm: geo.height, velKmS };
  } catch {
    return null;
  }
}

/** Orbital period (minutes) from mean motion. */
export function orbitalPeriodMin(satrec: satellite.SatRec): number | null {
  const no = satrec.no; // rad/min
  if (!no || !Number.isFinite(no)) return null;
  return (2 * Math.PI) / no;
}

/** Inclination in degrees. */
export function inclinationDeg(satrec: satellite.SatRec): number {
  return (satrec.inclo * 180) / Math.PI;
}
