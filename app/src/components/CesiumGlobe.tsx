/**
 * CesiumGlobe — the deck instrument. Esri World Imagery (darkened),
 * 10° graticule, atmosphere glow, and every live layer driven by
 * useLiveStore + layerStore: satellites (SGP4 1Hz), aircraft, ships,
 * conflict zones, tension heat, news markers, natural events,
 * day-night terminator. Points use PointPrimitiveCollection.
 */

import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useLiveState, useLayers } from '@/store/useLiveStore';
import type { NewsItem, NaturalEvent, LiveState } from '@/store/useLiveStore';
import { CONFLICT_ZONES } from '@/lib/zones';
import { LEVEL_COLORS } from '@/lib/tension';
import type { ZoneScore } from '@/lib/tension';
import { buildSatRecs, propagate } from '@/lib/sattrack';
import type { SatRecEntry } from '@/lib/sattrack';

export type SelectedEntity =
  | { kind: 'satellite'; id: number } // norad
  | { kind: 'aircraft'; id: string } // icao hex
  | { kind: 'ship'; id: number } // mmsi
  | { kind: 'zone'; id: string }
  | { kind: 'news'; id: string } // url
  | { kind: 'event'; id: string };

export interface FlyTarget {
  lat: number;
  lon: number;
  altKm?: number;
  ts: number;
}

const CYAN = Cesium.Color.fromCssColorString('#2EE6C8');
const AMBER = Cesium.Color.fromCssColorString('#FFB020');
const BLUE = Cesium.Color.fromCssColorString('#4EA8FF');
const VIOLET = Cesium.Color.fromCssColorString('#9B8CFF');
const WHITE_INK = Cesium.Color.fromCssColorString('#D7E6EF');

const DECK_ALT = 14_000_000;
const ORBIT_ALT = 28_000_000;
const HOME = { lat: 20, lon: 30 };

function satColor(group: string): Cesium.Color {
  switch (group) {
    case 'stations':
      return Cesium.Color.fromCssColorString('#DFFFF8');
    case 'gps-ops':
    case 'glo-ops':
    case 'galileo':
    case 'beidou':
      return CYAN;
    case 'last-30-days':
      return CYAN.withAlpha(0.45);
    case 'starlink':
      return CYAN.withAlpha(0.7);
    default:
      return CYAN.withAlpha(0.85);
  }
}

export default function CesiumGlobe({
  onSelect,
  flyTarget,
  booted,
  tracking,
}: {
  onSelect: (sel: SelectedEntity | null) => void;
  flyTarget: FlyTarget | null;
  booted: boolean;
  tracking: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const satRecsRef = useRef<SatRecEntry[]>([]);
  const satColRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const airColRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const shipColRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const newsColRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const evColRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const graticuleRef = useRef<Cesium.PolylineCollection | null>(null);
  const zoneEntsRef = useRef<Cesium.Entity[]>([]);
  const selRingRef = useRef<Cesium.Entity | null>(null);
  const selOuterRef = useRef<Cesium.Entity | null>(null);
  const selectedRef = useRef<SelectedEntity | null>(null);
  const trackingRef = useRef(false);
  const hoverRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const state = useLiveState();
  const layers = useLayers();

  /* latest values in refs for collection constructors / callbacks */
  const layerShowRef = useRef(layers);
  layerShowRef.current = layers;
  const liveStateRef = useRef<LiveState>(state);
  liveStateRef.current = state;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* ---------------- viewer lifecycle ---------------- */
  useEffect(() => {
    let destroyed = false;
    let viewer: Cesium.Viewer | null = null;

    const init = async () => {
      try {
        /* Imagery provider with timeout + fallbacks — the app must never
           hang on a black void if one tile host stalls. */
        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
          Promise.race<T>([
            p,
            new Promise<T>((_, rej) => setTimeout(() => rej(new Error('imagery timeout')), ms)),
          ]);
        let provider: Cesium.ImageryProvider;
        try {
          provider = await withTimeout(
            Cesium.ArcGisMapServerImageryProvider.fromUrl(
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
            ),
            12000,
          );
        } catch {
          try {
            provider = await withTimeout(
              Cesium.ArcGisMapServerImageryProvider.fromUrl(
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
              ),
              12000,
            );
          } catch {
            provider = new Cesium.UrlTemplateImageryProvider({
              url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              maximumLevel: 19,
              credit: '© OpenStreetMap contributors',
            });
          }
        }
        if (destroyed || !containerRef.current) return;

        const credit = document.createElement('div');
        credit.style.display = 'none';

        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: new Cesium.ImageryLayer(provider, {
            brightness: 0.55,
            saturation: 0.35,
            hue: 0.12,
          }),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          shouldAnimate: true,
          creditContainer: credit,
          requestRenderMode: false,
        });
        viewerRef.current = viewer;

        const scene = viewer.scene;
        scene.globe.baseColor = Cesium.Color.fromCssColorString('#03060A');
        scene.globe.showGroundAtmosphere = true;
        if (scene.skyAtmosphere) {
          scene.skyAtmosphere.hueShift = 0.35;
          scene.skyAtmosphere.brightnessShift = -0.15;
          scene.skyAtmosphere.saturationShift = -0.2;
        }
        scene.backgroundColor = Cesium.Color.fromCssColorString('#03060A');
        scene.fog.enabled = false;

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, ORBIT_ALT),
        });
        viewer.camera.percentageChanged = 0.01;
        viewer.scene.canvas.style.cursor = 'crosshair';

        setReady(true);
      } catch (err) {
        setFailed(err instanceof Error ? err.message : 'WebGL initialization failed');
      }
    };
    void init();

    return () => {
      destroyed = true;
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  /* ---------------- boot camera ease ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !booted || v.isDestroyed()) return;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(HOME.lon, HOME.lat, DECK_ALT),
      duration: 2.2,
    });
  }, [booted, ready]);

  /* ---------------- fly-to requests ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !flyTarget || v.isDestroyed()) return;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(flyTarget.lon, flyTarget.lat, (flyTarget.altKm ?? 1200) * 1000),
      duration: 1.6,
    });
  }, [flyTarget]);

  /* ---------------- graticule ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const col = new Cesium.PolylineCollection();
    const mat = Cesium.Material.fromType('Color', { color: CYAN.withAlpha(0.08) });
    for (let lat = -80; lat <= 80; lat += 10) {
      const pts: Cesium.Cartesian3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(Cesium.Cartesian3.fromDegrees(lon, lat));
      col.add({ positions: pts, width: 1, material: mat });
    }
    for (let lon = -180; lon < 180; lon += 10) {
      const pts: Cesium.Cartesian3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(Cesium.Cartesian3.fromDegrees(lon, lat));
      col.add({ positions: pts, width: 1, material: mat });
    }
    col.show = layerShowRef.current.graticule;
    graticuleRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      graticuleRef.current = null;
    };
  }, [ready]);

  useEffect(() => {
    if (graticuleRef.current) graticuleRef.current.show = layers.graticule;
  }, [layers.graticule, ready]);

  /* ---------------- day-night terminator ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;
    v.scene.globe.enableLighting = layers.dayNight;
  }, [layers.dayNight, ready]);

  /* ---------------- satellites ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    satRecsRef.current = buildSatRecs(state.tle.data);

    const col = new Cesium.PointPrimitiveCollection();
    col.show = layerShowRef.current.satellites;
    const now = new Date();
    for (const entry of satRecsRef.current) {
      const pos = propagate(entry.satrec, now);
      if (!pos) continue;
      const p = col.add({
        position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altKm * 1000),
        pixelSize: 3,
        color: satColor(entry.tle.group),
        outlineWidth: 0,
      });
      p.id = { selKind: 'satellite', norad: entry.tle.norad, name: entry.tle.name };
    }
    satColRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      satColRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tle.data, ready]);

  /* propagate at 1Hz (index-aligned with satRecsRef) */
  useEffect(() => {
    if (!ready) return;
    const t = window.setInterval(() => {
      const col = satColRef.current;
      if (!col || col.isDestroyed()) return;
      const now = new Date();
      const n = Math.min(col.length, satRecsRef.current.length);
      for (let j = 0; j < n; j++) {
        const pos = propagate(satRecsRef.current[j].satrec, now);
        if (pos) col.get(j).position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altKm * 1000);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [ready]);

  useEffect(() => {
    if (satColRef.current && !satColRef.current.isDestroyed()) satColRef.current.show = layers.satellites;
  }, [layers.satellites, ready]);

  /* ---------------- aircraft ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const col = new Cesium.PointPrimitiveCollection();
    col.show = layerShowRef.current.aircraft;
    for (const ac of state.aircraft.data) {
      const alt = (ac.altBaro ?? 30_000) * 0.3048;
      const p = col.add({
        position: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt),
        pixelSize: 3,
        color: AMBER,
      });
      p.id = { selKind: 'aircraft', hex: ac.hex, name: ac.flight || ac.hex };
      if (ac.track != null && ac.gs != null) {
        const rad = (ac.track * Math.PI) / 180;
        const dLat = Math.cos(rad) * 0.25;
        const dLon = (Math.sin(rad) * 0.25) / Math.max(0.2, Math.cos((ac.lat * Math.PI) / 180));
        const tp = col.add({
          position: Cesium.Cartesian3.fromDegrees(ac.lon + dLon, ac.lat + dLat, alt),
          pixelSize: 2,
          color: AMBER.withAlpha(0.55),
        });
        tp.id = { selKind: 'aircraft', hex: ac.hex, name: ac.flight || ac.hex };
      }
    }
    airColRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      airColRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aircraft.data, ready]);

  useEffect(() => {
    if (airColRef.current && !airColRef.current.isDestroyed()) airColRef.current.show = layers.aircraft;
  }, [layers.aircraft, ready]);

  /* ---------------- ships ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const col = new Cesium.PointPrimitiveCollection();
    col.show = layerShowRef.current.ships;
    for (const sh of state.ships.data) {
      const p = col.add({
        position: Cesium.Cartesian3.fromDegrees(sh.lon, sh.lat, 0),
        pixelSize: 3,
        color: BLUE,
      });
      p.id = { selKind: 'ship', mmsi: sh.mmsi, name: sh.name || `MMSI ${sh.mmsi}` };
      const dir = sh.cog ?? sh.heading;
      if (dir != null) {
        const rad = (dir * Math.PI) / 180;
        const tp = col.add({
          position: Cesium.Cartesian3.fromDegrees(sh.lon + Math.sin(rad) * 0.08, sh.lat + Math.cos(rad) * 0.08, 0),
          pixelSize: 2,
          color: BLUE.withAlpha(0.55),
        });
        tp.id = { selKind: 'ship', mmsi: sh.mmsi, name: sh.name || `MMSI ${sh.mmsi}` };
      }
    }
    shipColRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      shipColRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ships.data, ready]);

  useEffect(() => {
    if (shipColRef.current && !shipColRef.current.isDestroyed()) shipColRef.current.show = layers.ships;
  }, [layers.ships, ready]);

  /* ---------------- news markers ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const col = new Cesium.PointPrimitiveCollection();
    col.show = layerShowRef.current.newsMarkers;
    for (const n of state.news.data) {
      if (n.lat == null || n.lon == null) continue;
      const p = col.add({
        position: Cesium.Cartesian3.fromDegrees(n.lon, n.lat, 0),
        pixelSize: 4,
        color: WHITE_INK.withAlpha(0.9),
      });
      p.id = { selKind: 'news', url: n.url, name: `${n.title} [APPROX]` };
    }
    newsColRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      newsColRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.news.data, ready]);

  useEffect(() => {
    if (newsColRef.current && !newsColRef.current.isDestroyed()) newsColRef.current.show = layers.newsMarkers;
  }, [layers.newsMarkers, ready]);

  /* ---------------- natural events ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const col = new Cesium.PointPrimitiveCollection();
    col.show = layerShowRef.current.naturalEvents;
    const all: NaturalEvent[] = [...state.eonet.data, ...state.usgs.data];
    for (const ev of all) {
      const size = ev.kind === 'usgs' ? 3 + Math.max(0, ev.magnitude ?? 2.5) : 5;
      const p = col.add({
        position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat, 0),
        pixelSize: size,
        color: VIOLET.withAlpha(0.9),
      });
      p.id = { selKind: 'event', eid: ev.id, name: ev.title };
    }
    evColRef.current = col;
    v.scene.primitives.add(col);
    return () => {
      if (!v.isDestroyed()) v.scene.primitives.remove(col);
      evColRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.eonet.data, state.usgs.data, ready]);

  useEffect(() => {
    if (evColRef.current && !evColRef.current.isDestroyed()) evColRef.current.show = layers.naturalEvents;
  }, [layers.naturalEvents, ready]);

  /* ---------------- conflict zones + tension heat ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;
    const ents: Cesium.Entity[] = [];
    const zones = state.tension.data.zones;

    const pulsing = Object.values(zones)
      .filter((z) => z.level === 'HIGH' || z.level === 'CRITICAL')
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((z) => z.zoneId);

    for (const zone of CONFLICT_ZONES) {
      const score: ZoneScore | undefined = zones[zone.id];
      const level = score?.level ?? 'LOW';
      const color = Cesium.Color.fromCssColorString(LEVEL_COLORS[level]);
      const pos = Cesium.Cartesian3.fromDegrees(zone.centroid[1], zone.centroid[0]);

      ents.push(
        v.entities.add({
          position: pos,
          name: `zone:${zone.id}`,
          ellipse: {
            semiMajorAxis: zone.radiusKm * 1000,
            semiMinorAxis: zone.radiusKm * 1000,
            material: color.withAlpha(0.05),
            outline: true,
            outlineColor: color.withAlpha(0.6),
            outlineWidth: 1,
            height: 0,
          },
        }),
      );

      ents.push(
        v.entities.add({
          position: pos,
          name: `zone:${zone.id}`,
          point: {
            pixelSize: score ? 5 + score.score / 9 : 4,
            color,
            outlineColor: color.withAlpha(0.4),
            outlineWidth: 2,
          },
        }),
      );

      if (pulsing.includes(zone.id)) {
        ents.push(
          v.entities.add({
            position: pos,
            name: `zone:${zone.id}`,
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty((time) => {
                const t = (Cesium.JulianDate.toDate(time ?? Cesium.JulianDate.now()).getTime() % 2000) / 2000;
                return zone.radiusKm * 1000 * (1 + 0.6 * t);
              }, false),
              semiMinorAxis: new Cesium.CallbackProperty((time) => {
                const t = (Cesium.JulianDate.toDate(time ?? Cesium.JulianDate.now()).getTime() % 2000) / 2000;
                return zone.radiusKm * 1000 * (1 + 0.6 * t);
              }, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty((time) => {
                  const t = (Cesium.JulianDate.toDate(time ?? Cesium.JulianDate.now()).getTime() % 2000) / 2000;
                  return color.withAlpha(0.25 * (1 - t));
                }, false),
              ),
              height: 0,
            },
          }),
        );
      }

      if (score && (score.level === 'HIGH' || score.level === 'CRITICAL')) {
        ents.push(
          v.entities.add({
            position: Cesium.Cartesian3.fromDegrees(zone.centroid[1], zone.centroid[0], 200_000),
            name: `zone:${zone.id}`,
            label: {
              text: `${zone.name} · ${score.score.toFixed(0)}`,
              font: '500 10px "Chakra Petch", sans-serif',
              fillColor: Cesium.Color.fromCssColorString('#5F7484'),
              pixelOffset: new Cesium.Cartesian2(0, -18),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
      }

      if (score && score.score > 5) {
        const heat = v.entities.add({
          position: pos,
          name: `zoneheat:${zone.id}`,
          ellipse: {
            semiMajorAxis: zone.radiusKm * 700,
            semiMinorAxis: zone.radiusKm * 700,
            material: color.withAlpha(0.04 + score.score / 1200),
            height: 0,
            extrudedHeight: score.score * 9000,
          },
        });
        (heat as unknown as { wfHeat: boolean }).wfHeat = true;
        ents.push(heat);
      }
    }

    zoneEntsRef.current = ents;
    ents.forEach((e) => {
      e.show = (e as unknown as { wfHeat?: boolean }).wfHeat
        ? layerShowRef.current.tensionHeat
        : layerShowRef.current.conflictZones;
    });

    return () => {
      if (!v.isDestroyed()) ents.forEach((e) => v.entities.remove(e));
      zoneEntsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tension.data.zones, ready]);

  useEffect(() => {
    zoneEntsRef.current.forEach((e) => {
      e.show = (e as unknown as { wfHeat?: boolean }).wfHeat ? layers.tensionHeat : layers.conflictZones;
    });
  }, [layers.conflictZones, layers.tensionHeat, ready]);

  /* ---------------- selection rings + tracking ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;

    const positionOf = (sel: SelectedEntity | null): Cesium.Cartesian3 | undefined => {
      if (!sel) return undefined;
      const st = liveStateRef.current;
      if (sel.kind === 'satellite') {
        const entry = satRecsRef.current.find((s) => s.tle.norad === sel.id);
        if (!entry) return undefined;
        const pos = propagate(entry.satrec, new Date());
        return pos ? Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altKm * 1000) : undefined;
      }
      if (sel.kind === 'aircraft') {
        const ac = st.aircraft.data.find((a) => a.hex === sel.id);
        return ac ? Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, (ac.altBaro ?? 30_000) * 0.3048) : undefined;
      }
      if (sel.kind === 'ship') {
        const sh = st.ships.data.find((s) => s.mmsi === sel.id);
        return sh ? Cesium.Cartesian3.fromDegrees(sh.lon, sh.lat, 0) : undefined;
      }
      if (sel.kind === 'zone') {
        const z = CONFLICT_ZONES.find((c) => c.id === sel.id);
        return z ? Cesium.Cartesian3.fromDegrees(z.centroid[1], z.centroid[0], 100_000) : undefined;
      }
      if (sel.kind === 'news') {
        const n = st.news.data.find((x: NewsItem) => x.url === sel.id);
        return n?.lat != null && n.lon != null ? Cesium.Cartesian3.fromDegrees(n.lon, n.lat, 50_000) : undefined;
      }
      if (sel.kind === 'event') {
        const ev = [...st.eonet.data, ...st.usgs.data].find((x) => x.id === sel.id);
        return ev ? Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat, 50_000) : undefined;
      }
      return undefined;
    };

    const posProp = new Cesium.CallbackPositionProperty(() => positionOf(selectedRef.current), false);
    const heightProp = new Cesium.CallbackProperty(() => {
      const sel = selectedRef.current;
      if (!sel) return 0;
      if (sel.kind === 'satellite') {
        const entry = satRecsRef.current.find((s) => s.tle.norad === sel.id);
        if (!entry) return 0;
        const pos = propagate(entry.satrec, new Date());
        return pos ? pos.altKm * 1000 : 0;
      }
      if (sel.kind === 'aircraft') {
        const ac = liveStateRef.current.aircraft.data.find((a) => a.hex === sel.id);
        return ac ? (ac.altBaro ?? 30_000) * 0.3048 : 0;
      }
      return 0;
    }, false);

    const inner = v.entities.add({
      position: posProp,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => (selectedRef.current?.kind === 'zone' ? 300_000 : 120_000), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => (selectedRef.current?.kind === 'zone' ? 300_000 : 120_000), false),
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: AMBER,
        outlineWidth: 2,
        height: heightProp,
      },
    });
    inner.show = false;
    const outer = v.entities.add({
      position: posProp,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => (selectedRef.current?.kind === 'zone' ? 420_000 : 190_000), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => (selectedRef.current?.kind === 'zone' ? 420_000 : 190_000), false),
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: AMBER.withAlpha(0.5),
        outlineWidth: 1,
        height: heightProp,
      },
    });
    outer.show = false;
    selRingRef.current = inner;
    selOuterRef.current = outer;

    return () => {
      if (!v.isDestroyed()) {
        v.entities.remove(inner);
        v.entities.remove(outer);
        v.trackedEntity = undefined;
      }
      selRingRef.current = null;
      selOuterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const applySelection = (sel: SelectedEntity | null) => {
    selectedRef.current = sel;
    const v = viewerRef.current;
    if (selRingRef.current) selRingRef.current.show = !!sel;
    if (selOuterRef.current) selOuterRef.current.show = !!sel;
    if (v && !v.isDestroyed()) {
      v.trackedEntity = sel && trackingRef.current ? selRingRef.current ?? undefined : undefined;
    }
  };
  const applySelectionRef = useRef(applySelection);
  applySelectionRef.current = applySelection;

  useEffect(() => {
    trackingRef.current = tracking;
    const v = viewerRef.current;
    if (v && !v.isDestroyed()) {
      v.trackedEntity = selectedRef.current && tracking ? selRingRef.current ?? undefined : undefined;
    }
  }, [tracking]);

  /* ---------------- picking / hover / auto-rotate / HUD ---------------- */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || v.isDestroyed()) return;

    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
    let lastInteract = Date.now();
    let lastFps = 60;
    let frames = 0;
    let lastFpsT = performance.now();

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      lastInteract = Date.now();
      const picked = v.scene.pick(e.position);
      if (picked) {
        const prim = picked.primitive;
        if (prim instanceof Cesium.PointPrimitive && prim.id) {
          const id = prim.id as { selKind?: string; norad?: number; hex?: string; mmsi?: number; url?: string; eid?: string };
          let sel: SelectedEntity | null = null;
          if (id.selKind === 'satellite' && id.norad != null) sel = { kind: 'satellite', id: id.norad };
          else if (id.selKind === 'aircraft' && id.hex) sel = { kind: 'aircraft', id: id.hex };
          else if (id.selKind === 'ship' && id.mmsi != null) sel = { kind: 'ship', id: id.mmsi };
          else if (id.selKind === 'event' && id.eid) sel = { kind: 'event', id: id.eid };
          else if (id.selKind === 'news' && id.url) {
            window.open(id.url, '_blank', 'noopener');
            return;
          }
          if (sel) {
            applySelectionRef.current(sel);
            onSelectRef.current(sel);
            return;
          }
        }
        const ent = picked.id as Cesium.Entity | undefined;
        if (ent?.name?.startsWith('zone:')) {
          const sel: SelectedEntity = { kind: 'zone', id: ent.name.slice(5) };
          applySelectionRef.current(sel);
          onSelectRef.current(sel);
          return;
        }
      }
      applySelectionRef.current(null);
      onSelectRef.current(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const tip = hoverRef.current;
      if (tip) {
        let text: string | null = null;
        const picked = v.scene.pick(e.endPosition);
        if (picked) {
          const prim = picked.primitive;
          if (prim instanceof Cesium.PointPrimitive && prim.id) {
            const id = prim.id as { name?: string };
            if (id.name) text = id.name;
          }
          const ent = picked?.id as Cesium.Entity | undefined;
          if (!text && ent?.name?.startsWith('zone:')) {
            const z = CONFLICT_ZONES.find((c) => c.id === ent.name!.slice(5));
            if (z) text = z.name;
          }
        }
        if (text) {
          tip.style.display = 'block';
          tip.style.transform = `translate(${e.endPosition.x + 14}px, ${e.endPosition.y + 10}px)`;
          tip.textContent = text;
        } else {
          tip.style.display = 'none';
        }
      }
      const ro = readoutRef.current;
      if (ro) {
        const cart = v.camera.pickEllipsoid(e.endPosition, v.scene.globe.ellipsoid);
        if (cart) {
          const c = Cesium.Cartographic.fromCartesian(cart);
          const lat = Cesium.Math.toDegrees(c.latitude);
          const lon = Cesium.Math.toDegrees(c.longitude);
          const alt = v.camera.positionCartographic.height / 1000;
          ro.textContent = `LAT ${lat.toFixed(2)}  LON ${lon.toFixed(2)}  CAM ${Math.round(alt).toLocaleString()} KM  FPS ${Math.round(lastFps)}`;
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    const touch = () => {
      lastInteract = Date.now();
    };
    handler.setInputAction(touch, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(touch, Cesium.ScreenSpaceEventType.WHEEL);

    const removePost = v.scene.postRender.addEventListener(() => {
      frames++;
      const t = performance.now();
      if (t - lastFpsT >= 1000) {
        lastFps = (frames * 1000) / (t - lastFpsT);
        frames = 0;
        lastFpsT = t;
      }
      if (!trackingRef.current && Date.now() - lastInteract > 20_000) {
        v.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, Cesium.Math.toRadians(-0.4) / 60);
      }
    });

    return () => {
      handler.destroy();
      removePost();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-0">
        <div className="wf-panel max-w-md p-6 text-center">
          <div className="font-display text-lg font-semibold tracking-[0.14em] text-wf-red">3D UPLINK UNAVAILABLE</div>
          <p className="mt-2 font-data text-xs text-wf-ink-dim">{failed}</p>
          <p className="mt-1 font-body text-xs text-wf-ink-faint">Data pages remain reachable via the nav above.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 border border-wf-line px-4 py-1.5 font-data text-[11px] uppercase tracking-[0.08em] text-wf-cyan hover:border-wf-line-hi"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      <div
        ref={hoverRef}
        className="pointer-events-none absolute left-0 top-0 z-20 hidden max-w-[280px] truncate border border-wf-line bg-bg-2/95 px-2 py-1 font-data text-[11px] text-wf-ink"
      />
      <div
        ref={readoutRef}
        className="pointer-events-none absolute bottom-10 left-3 z-10 font-data text-[10px] tabular-nums text-wf-ink-faint"
      />
    </div>
  );
}
