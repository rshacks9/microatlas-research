// SIGNALS page data — all stream/link targets are real, verified endpoints.
// LiveATC: https://d.liveatc.net/{feed_id} (302 -> https stream, ACAO:*)
// WebSDR:  http://websdr.ewi.utwente.nl:8901/?tune={khz}{mode}
// Scanners: Broadcastify feed/listing pages (external links only).

export type AtcRegion = 'NORTH AMERICA' | 'EUROPE' | 'MIDDLE EAST' | 'ASIA-PACIFIC' | 'SOUTH AMERICA';

export interface AtcFeed {
  /** LiveATC mount id, e.g. kjfk_twr */
  id: string;
  /** Display label, e.g. KJFK TWR */
  label: string;
  /** Airport / facility line */
  facility: string;
  /** Published VHF frequencies */
  freqs: string;
  region: AtcRegion;
}

export interface HfStation {
  name: string;
  freqKhz: number;
  mode: 'usb' | 'lsb' | 'am' | 'cw';
  freqLabel: string;
  tag: string;
  description: string;
}

export interface ScannerLink {
  tag: string;
  name: string;
  note: string;
  url: string;
}

export const ATC_FEEDS: AtcFeed[] = [
  // NORTH AMERICA
  { id: 'kjfk_twr', label: 'KJFK TWR', facility: 'NEW YORK JFK · TOWER', freqs: '119.1 / 123.9', region: 'NORTH AMERICA' },
  { id: 'kjfk_app', label: 'KJFK APP', facility: 'NEW YORK JFK · APPROACH', freqs: '127.4', region: 'NORTH AMERICA' },
  { id: 'kord_twr', label: 'KORD TWR', facility: "CHICAGO O'HARE · TOWER", freqs: '126.9 / 132.7', region: 'NORTH AMERICA' },
  { id: 'klax_twr', label: 'KLAX TWR', facility: 'LOS ANGELES INTL · TOWER', freqs: '133.9 / 120.95', region: 'NORTH AMERICA' },
  { id: 'ksfo_twr', label: 'KSFO TWR', facility: 'SAN FRANCISCO INTL · TOWER', freqs: '120.5 / 118.85', region: 'NORTH AMERICA' },
  { id: 'cyyz_twr', label: 'CYYZ TWR', facility: 'TORONTO PEARSON · TOWER', freqs: '118.35 / 118.7', region: 'NORTH AMERICA' },
  // EUROPE
  { id: 'egll_twr', label: 'EGLL TWR', facility: 'LONDON HEATHROW · TOWER', freqs: '118.5 / 124.47', region: 'EUROPE' },
  { id: 'egkk_twr', label: 'EGKK TWR', facility: 'LONDON GATWICK · TOWER', freqs: '124.22', region: 'EUROPE' },
  { id: 'lfpg_twr', label: 'LFPG TWR', facility: 'PARIS CHARLES DE GAULLE · TOWER', freqs: '119.25', region: 'EUROPE' },
  { id: 'eddf_twr', label: 'EDDF TWR', facility: 'FRANKFURT MAIN · TOWER', freqs: '119.9 / 124.85', region: 'EUROPE' },
  { id: 'lemd_twr', label: 'LEMD TWR', facility: 'MADRID BARAJAS · TOWER', freqs: '118.17 / 124.97', region: 'EUROPE' },
  // MIDDLE EAST
  { id: 'omdb_twr', label: 'OMDB TWR', facility: 'DUBAI INTL · TOWER', freqs: '118.75', region: 'MIDDLE EAST' },
  { id: 'othh_twr', label: 'OTHH TWR', facility: 'DOHA HAMAD INTL · TOWER', freqs: '118.55', region: 'MIDDLE EAST' },
  // ASIA-PACIFIC
  { id: 'rjtt_twr', label: 'RJTT TWR', facility: 'TOKYO HANEDA · TOWER', freqs: '118.1 / 124.35', region: 'ASIA-PACIFIC' },
  { id: 'rjaa_app', label: 'RJAA APP', facility: 'TOKYO NARITA · APPROACH', freqs: '124.4', region: 'ASIA-PACIFIC' },
  { id: 'vhhh_app', label: 'VHHH APP', facility: 'HONG KONG INTL · APPROACH', freqs: '119.1', region: 'ASIA-PACIFIC' },
  { id: 'yssy_twr', label: 'YSSY TWR', facility: 'SYDNEY KINGSFORD SMITH · TOWER', freqs: '120.5 / 124.7', region: 'ASIA-PACIFIC' },
  // SOUTH AMERICA
  { id: 'sbgr_twr', label: 'SBGR TWR', facility: 'SÃO PAULO GUARULHOS · TOWER', freqs: '118.35', region: 'SOUTH AMERICA' },
];

export const ATC_REGIONS: AtcRegion[] = ['NORTH AMERICA', 'EUROPE', 'MIDDLE EAST', 'ASIA-PACIFIC', 'SOUTH AMERICA'];

export const WEBSDR_TWENTE = 'http://websdr.ewi.utwente.nl:8901/';
export const websdrTune = (khz: number, mode: string) => WEBSDR_TWENTE + '?tune=' + khz + mode;
export const WEBSDR_DIRECTORY = 'http://websdr.org/';
export const KIWISDR_DIRECTORY = 'http://kiwisdr.com/public/';

export const UVB76 = {
  name: 'UVB-76 · "THE BUZZER"',
  freqLabel: '4625 kHz USB',
  description:
    'Russian military numbers station, broadcasting the buzzing marker nearly continuously since the 1970s. Voice messages break through irregularly.',
  tuneUrl: websdrTune(4625, 'usb'),
};

export const HF_STATIONS: HfStation[] = [
  {
    name: 'CHU CANADA',
    freqKhz: 7850,
    mode: 'am',
    freqLabel: '7850 kHz AM',
    tag: 'TIME SIGNAL',
    description: 'Canadian national time signal — continuous UTC time ticks and bilingual voice announcements from Ottawa.',
  },
  {
    name: 'WWV · NIST',
    freqKhz: 10000,
    mode: 'am',
    freqLabel: '10000 kHz AM',
    tag: 'TIME SIGNAL',
    description: 'US NIST time and frequency standard broadcast from Fort Collins, Colorado — ticks, tones, and voice time.',
  },
  {
    name: 'VOLMET SHANNON',
    freqKhz: 5505,
    mode: 'usb',
    freqLabel: '5505 kHz USB',
    tag: 'AVIATION WX',
    description: 'Shannon (Ireland) aviation VOLMET — meteorological information for North Atlantic air routes, in cycle.',
  },
  {
    name: 'HFGWS · USAF',
    freqKhz: 8992,
    mode: 'usb',
    freqLabel: '8992 kHz USB',
    tag: 'MIL UTILITY',
    description: 'US Air Force High Frequency Global Communications System — EAMs and phone patches on the global net.',
  },
  {
    name: 'RAF VOLMET',
    freqKhz: 5450,
    mode: 'usb',
    freqLabel: '5450 kHz USB',
    tag: 'AVIATION WX',
    description: 'Royal Air Force VOLMET from the UK — weather for military airfields across Europe, broadcast in rotation.',
  },
];

// Broadcastify feed/listing pages confirmed real & indexed (feed IDs verified via public listings).
export const SCANNER_LINKS: ScannerLink[] = [
  { tag: 'US-IL / POLICE', name: 'CHICAGO PD ZONE 08', note: 'Official CPD zone feed', url: 'https://www.broadcastify.com/listen/feed/37361' },
  { tag: 'US-IL / POLICE', name: 'CHICAGO PD ZONE 01', note: 'Official CPD zone feed', url: 'https://www.broadcastify.com/listen/feed/37354' },
  { tag: 'US-NY / FIRE', name: 'FDNY MANHATTAN DISPATCH', note: 'Fire dispatch, Manhattan', url: 'https://www.broadcastify.com/listen/feed/46554' },
  { tag: 'US-TX / POLICE', name: 'DALLAS CITY POLICE', note: 'All dispatch zones scanned', url: 'https://www.broadcastify.com/listen/feed/5318' },
  { tag: 'AU-ACT / SCANNER', name: 'ACT REGION GRN & FIRE', note: 'NSW & ACT public safety net', url: 'https://www.broadcastify.com/listen/feed/31608' },
  { tag: 'AU-NSW / SCANNER', name: 'NSW GRN/PSN · MID NORTH COAST', note: 'Shared dispatch incl. Sydney', url: 'https://www.broadcastify.com/listen/feed/35139' },
  { tag: 'AU-NSW / FIRE', name: 'SOUTHERN TABLELANDS RFS · FRNSW', note: 'Rural fire + FRNSW dispatch', url: 'https://www.broadcastify.com/listen/feed/1176' },
  { tag: 'US-NY / METRO', name: 'NEW YORK CITY · ALL FEEDS', note: 'Full county listing', url: 'https://www.broadcastify.com/listen/ctid/1855' },
  { tag: 'AU-NSW / METRO', name: 'SYDNEY SURROUNDS DIVISION', note: 'GRN public safety listings', url: 'https://www.broadcastify.com/listen/ctid/4350' },
  { tag: 'GLOBAL / INDEX', name: 'BROADCASTIFY TOP 50', note: 'Most-listened live feeds', url: 'https://www.broadcastify.com/listen/top/' },
];

export const liveatcStreamUrl = (id: string) => 'https://d.liveatc.net/' + id;
export const liveatcPageUrl = (id: string) => {
  const icao = id.slice(0, 4);
  return 'https://www.liveatc.net/hlisten.php?mount=' + id + '&icao=' + icao;
};

export const TOTAL_FEEDS = ATC_FEEDS.length + HF_STATIONS.length + 1 + SCANNER_LINKS.length;
