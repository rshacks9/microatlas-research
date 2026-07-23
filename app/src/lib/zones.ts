/**
 * Curated conflict flashpoint zones (~20). Each zone drives:
 *  - a ground ring on the globe (centroid + radiusKm)
 *  - a GDELT query for the tension engine (keywords)
 * Scores are derived live by src/lib/tension.ts — never hardcoded.
 */

export interface ConflictZone {
  id: string;
  name: string;
  centroid: [number, number]; // [lat, lon]
  radiusKm: number;
  /** GDELT DOC 2.0 query (quoted phrases / OR groups) */
  gdeltQuery: string;
  region: string;
}

export const CONFLICT_ZONES: ConflictZone[] = [
  { id: 'ukraine', name: 'UKRAINE FRONT', centroid: [48.6, 37.0], radiusKm: 700, region: 'Eastern Europe', gdeltQuery: '(ukraine OR donetsk OR zaporizhzhia) (strike OR offensive OR frontline)' },
  { id: 'gaza', name: 'GAZA / S. ISRAEL', centroid: [31.4, 34.4], radiusKm: 180, region: 'Levant', gdeltQuery: '(gaza OR rafah OR "khan younis") (strike OR ceasefire OR hostages)' },
  { id: 'lebanon', name: 'LEBANON BORDER', centroid: [33.3, 35.5], radiusKm: 150, region: 'Levant', gdeltQuery: '(hezbollah OR "south lebanon") (rocket OR airstrike)' },
  { id: 'syria', name: 'SYRIA', centroid: [35.0, 38.5], radiusKm: 400, region: 'Levant', gdeltQuery: '(syria OR idlib OR aleppo) (clashes OR airstrike)' },
  { id: 'yemen', name: 'YEMEN / RED SEA', centroid: [15.0, 44.5], radiusKm: 500, region: 'Arabian Peninsula', gdeltQuery: '(houthi OR yemen OR "red sea") (missile OR drone OR shipping)' },
  { id: 'iran', name: 'IRAN', centroid: [32.5, 53.5], radiusKm: 700, region: 'Gulf', gdeltQuery: '(iran OR tehran) (nuclear OR strike OR sanctions OR missile)' },
  { id: 'iraq', name: 'IRAQ', centroid: [33.3, 44.0], radiusKm: 400, region: 'Mesopotamia', gdeltQuery: '(iraq OR baghdad OR mosul) (attack OR militia OR isis)' },
  { id: 'taiwan', name: 'TAIWAN STRAIT', centroid: [24.0, 119.5], radiusKm: 300, region: 'East Asia', gdeltQuery: '(taiwan OR "taiwan strait") (china OR pla OR incursion OR drills)' },
  { id: 'korea', name: 'KOREAN DMZ', centroid: [38.4, 127.2], radiusKm: 250, region: 'East Asia', gdeltQuery: '("north korea" OR pyongyang) (missile OR launch OR nuclear)' },
  { id: 'scs', name: 'S. CHINA SEA', centroid: [12.0, 114.5], radiusKm: 600, region: 'SE Asia', gdeltQuery: '("south china sea" OR spratly OR scarborough) (standoff OR "coast guard" OR clash)' },
  { id: 'kashmir', name: 'KASHMIR LOC', centroid: [34.1, 74.8], radiusKm: 250, region: 'South Asia', gdeltQuery: '(kashmir OR "line of control") (india OR pakistan) (firing OR militant OR strike)' },
  { id: 'afghanistan', name: 'AFGHANISTAN', centroid: [34.5, 69.2], radiusKm: 450, region: 'South Asia', gdeltQuery: '(afghanistan OR kabul OR taliban) (attack OR bombing OR isis)' },
  { id: 'myanmar', name: 'MYANMAR', centroid: [21.0, 96.0], radiusKm: 500, region: 'SE Asia', gdeltQuery: '(myanmar OR rakhine OR shan) (junta OR airstrike OR resistance)' },
  { id: 'sudan', name: 'SUDAN', centroid: [15.6, 32.5], radiusKm: 550, region: 'East Africa', gdeltQuery: '(sudan OR khartoum OR darfur OR rsf) (fighting OR offensive OR famine)' },
  { id: 'sahel', name: 'SAHEL / W. AFRICA', centroid: [15.0, 0.0], radiusKm: 800, region: 'West Africa', gdeltQuery: '(mali OR niger OR "burkina faso") (insurgent OR attack OR coup)' },
  { id: 'somalia', name: 'SOMALIA', centroid: [3.5, 45.5], radiusKm: 500, region: 'East Africa', gdeltQuery: '(somalia OR mogadishu OR "al-shabaab") (attack OR airstrike)' },
  { id: 'drc', name: 'EASTERN DRC', centroid: [-1.7, 29.2], radiusKm: 350, region: 'Central Africa', gdeltQuery: '(congo OR goma OR m23 OR drc) (fighting OR offensive OR rebels)' },
  { id: 'ethiopia', name: 'ETHIOPIA / HORN', centroid: [9.5, 39.5], radiusKm: 500, region: 'East Africa', gdeltQuery: '(ethiopia OR tigray OR amhara OR oromia) (conflict OR airstrike OR clashes)' },
  { id: 'haiti', name: 'HAITI', centroid: [18.6, -72.3], radiusKm: 180, region: 'Caribbean', gdeltQuery: '(haiti OR "port-au-prince") (gang OR violence OR police)' },
  { id: 'venezuela', name: 'VENEZUELA BORDER', centroid: [8.0, -66.5], radiusKm: 500, region: 'South America', gdeltQuery: '(venezuela OR maduro OR esequibo) (military OR crisis OR deployment)' },
  { id: 'nagorno', name: 'S. CAUCASUS', centroid: [40.2, 46.5], radiusKm: 300, region: 'Caucasus', gdeltQuery: '(armenia OR azerbaijan OR karabakh) (border OR clash OR peace)' },
  { id: 'baltic', name: 'BALTIC / KALININGRAD', centroid: [55.0, 21.5], radiusKm: 350, region: 'Northern Europe', gdeltQuery: '(kaliningrad OR baltic OR suwalki) (russia OR nato OR provocation)' },
  { id: 'mexico', name: 'MEXICO CARTELS', centroid: [23.5, -102.5], radiusKm: 600, region: 'North America', gdeltQuery: '(mexico OR sinaloa OR jalisco) (cartel OR shootout OR fentanyl)' },
  { id: 'pakistan-af', name: 'PAK–AFG BORDER', centroid: [33.0, 70.5], radiusKm: 300, region: 'South Asia', gdeltQuery: '(pakistan OR waziristan OR ttp) (airstrike OR border OR militant)' },
];

export function zoneById(id: string): ConflictZone | undefined {
  return CONFLICT_ZONES.find((z) => z.id === id);
}
