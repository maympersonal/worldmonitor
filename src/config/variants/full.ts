// Full tourism-oriented variant - worldmonitor.app
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// Geopolitical-specific exports
export * from '../feeds';
export * from '../geo';
export * from '../irradiators';
export * from '../pipelines';
export * from '../ports';
export * from '../military';
export * from '../airports';
export * from '../entities';

// Panel configuration for tourism analysis
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Tourism Map', enabled: true, priority: 1 },
  'live-news': { name: 'Live Tourism News', enabled: true, priority: 1 },
  intel: { name: 'Tourism Intel Feed', enabled: true, priority: 1 },
  'gdelt-intel': { name: 'Live Tourism Intelligence', enabled: true, priority: 1 },
  cii: { name: 'Traveler Risk Index', enabled: true, priority: 1 },
  cascade: { name: 'Tourism Infrastructure Impact', enabled: true, priority: 1 },
  'strategic-risk': { name: 'Tourism Risk Overview', enabled: true, priority: 1 },
  politics: { name: 'World Tourism', enabled: true, priority: 1 },
  middleeast: { name: 'MENA Tourism', enabled: true, priority: 1 },
  africa: { name: 'Africa Tourism', enabled: true, priority: 1 },
  latam: { name: 'Latin America Tourism', enabled: true, priority: 1 },
  asia: { name: 'Asia-Pacific Tourism', enabled: true, priority: 1 },
  energy: { name: 'Tourism Infrastructure', enabled: true, priority: 1 },
  gov: { name: 'Tourism Policy', enabled: true, priority: 1 },
  culture: { name: 'Cultural Tourism', enabled: true, priority: 1 },
  thinktanks: { name: 'Think Tanks', enabled: true, priority: 1 },
  polymarket: { name: 'Predictions', enabled: true, priority: 1 },
  commodities: { name: 'Commodities', enabled: true, priority: 1 },
  markets: { name: 'Markets', enabled: true, priority: 1 },
  economic: { name: 'Economic Indicators', enabled: true, priority: 1 },
  finance: { name: 'Tourism Economy', enabled: true, priority: 1 },
  tech: { name: 'Travel Technology', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 2 },
  ai: { name: 'AI for Tourism', enabled: true, priority: 2 },
  layoffs: { name: 'Layoffs Tracker', enabled: false, priority: 2 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// Map layers for tourism view
export const DEFAULT_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: true,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: true,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

// Mobile-specific defaults for tourism
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'full',
  description: 'Full tourism intelligence dashboard',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
