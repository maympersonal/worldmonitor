import type { Feed } from '@/types';
import { SITE_VARIANT } from './variant';

// Helper to create RSS proxy URL (Vercel)
const rss = (url: string) => `/api/rss-proxy?url=${encodeURIComponent(url)}`;

// Railway proxy for feeds blocked by Vercel IPs (UN News, CISA, etc.)
// Reuses VITE_WS_RELAY_URL which is already configured for AIS/OpenSky
const wsRelayUrl = import.meta.env.VITE_WS_RELAY_URL || '';
const railwayBaseUrl = wsRelayUrl
  ? wsRelayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '')
  : '';
const railwayRss = (url: string) =>
  railwayBaseUrl ? `${railwayBaseUrl}/rss?url=${encodeURIComponent(url)}` : rss(url);
const googleNewsRss = (
  query: string,
  hl = 'en-US',
  gl = 'US',
  ceid = 'US:en',
) => rss(`https://news.google.com/rss/search?q=${query}&hl=${hl}&gl=${gl}&ceid=${ceid}`);

const googleNewsRssPlain = (
  query: string,
  hl = 'en-US',
  gl = 'US',
  ceid = 'US:en',
) => rss(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`);

// Source tier system for prioritization (lower = more authoritative)
// Tier 1: Wire services - fastest, most reliable breaking news
// Tier 2: Major outlets - high-quality journalism
// Tier 3: Specialty sources - domain expertise
// Tier 4: Aggregators & blogs - useful but less authoritative
export const SOURCE_TIERS: Record<string, number> = {
  // Tier 1 - Wire Services
  'Reuters': 1,
  'AP News': 1,
  'AFP': 1,
  'Bloomberg': 1,

  // Tier 2 - Major Outlets
  'BBC World': 2,
  'BBC Middle East': 2,
  'Guardian World': 2,
  'Guardian ME': 2,
  'NPR News': 2,
  'CNN World': 2,
  'CNBC': 2,
  'MarketWatch': 2,
  'Al Jazeera': 2,
  'Financial Times': 2,
  'Politico': 2,
  'Reuters World': 1,
  'Reuters Business': 1,
  'OpenAI News': 3,

  // Tier 1 - Official Government & International Orgs
  'White House': 1,
  'State Dept': 1,
  'Pentagon': 1,
  'UN News': 1,
  'CISA': 1,
  'Treasury': 2,
  'DOJ': 2,
  'DHS': 2,
  'CDC': 2,
  'FEMA': 2,

  // Tier 3 - Specialty
  'Defense One': 3,
  'Breaking Defense': 3,
  'The War Zone': 3,
  'Defense News': 3,
  'Janes': 3,
  'Foreign Policy': 3,
  'The Diplomat': 3,
  'Bellingcat': 3,
  'Krebs Security': 3,
  'Federal Reserve': 3,
  'SEC': 3,
  'MIT Tech Review': 3,
  'Ars Technica': 3,
  'Atlantic Council': 3,
  'Foreign Affairs': 3,
  'CrisisWatch': 3,
  'CSIS': 3,
  'RAND': 3,
  'Brookings': 3,
  'Carnegie': 3,
  'IAEA': 1,
  'WHO': 1,
  'UNHCR': 1,
  'Xinhua': 3,
  'TASS': 3,
  'Layoffs.fyi': 3,
  'BBC Persian': 2,
  'Iran International': 3,
  'Fars News': 3,
  'MIIT (China)': 1,
  'MOFCOM (China)': 1,

  // Tier 2 - Premium Startup/VC Sources
  'Y Combinator Blog': 2,
  'a16z Blog': 2,
  'Sequoia Blog': 2,
  'Crunchbase News': 2,
  'CB Insights': 2,
  'PitchBook News': 2,
  'The Information': 2,

  // Tier 3 - Regional/Specialty Startup Sources
  'EU Startups': 3,
  'Tech.eu': 3,
  'Sifted (Europe)': 3,
  'The Next Web': 3,
  'Tech in Asia': 3,
  'TechCabal (Africa)': 3,
  'Inc42 (India)': 3,
  'YourStory': 3,
  'Paul Graham Essays': 2,
  'Stratechery': 2,
  // Asia - Regional
  'e27 (SEA)': 3,
  'DealStreetAsia': 3,
  'Pandaily (China)': 3,
  '36Kr English': 3,
  'TechNode (China)': 3,
  'China Tech News': 3,
  'The Bridge (Japan)': 3,
  'Japan Tech News': 3,
  'Nikkei Tech': 2,
  'NHK World': 2,
  'Nikkei Asia': 2,
  'Korea Tech News': 3,
  'KED Global': 3,
  'Entrackr (India)': 3,
  'India Tech News': 3,
  'Taiwan Tech News': 3,
  'GloNewswire (Taiwan)': 4,
  // LATAM
  'La Silla Vacía': 3,
  'LATAM Tech News': 3,
  'Startups.co (LATAM)': 3,
  'Contxto (LATAM)': 3,
  'Brazil Tech News': 3,
  'Mexico Tech News': 3,
  'LATAM Fintech': 3,
  // Africa & MENA
  'Disrupt Africa': 3,
  'Wamda (MENA)': 3,
  'Magnitt': 3,

  // Tier 3 - Think Tanks
  'Brookings Tech': 3,
  'CSIS Tech': 3,
  'MIT Tech Policy': 3,
  'Stanford HAI': 2,
  'AI Now Institute': 3,
  'OECD Digital': 2,
  'Bruegel (EU)': 3,
  'Chatham House Tech': 3,
  'ISEAS (Singapore)': 3,
  'ORF Tech (India)': 3,
  'RIETI (Japan)': 3,
  'Lowy Institute': 3,
  'China Tech Analysis': 3,
  'DigiChina': 2,
  // Security/Defense Think Tanks
  'RUSI': 2,
  'Wilson Center': 3,
  'GMF': 3,
  'Stimson Center': 3,
  'CNAS': 2,
  // Nuclear & Arms Control
  'Arms Control Assn': 2,
  'Bulletin of Atomic Scientists': 2,
  // Food Security
  'FAO GIEWS': 2,
  'EU ISS': 3,
  // New verified think tanks
  'War on the Rocks': 2,
  'AEI': 3,
  'Responsible Statecraft': 3,
  'FPRI': 3,
  'Jamestown': 3,

  // Tier 3 - Policy Sources
  'Politico Tech': 2,
  'AI Regulation': 3,
  'Tech Antitrust': 3,
  'EFF News': 3,
  'EU Digital Policy': 3,
  'Euractiv Digital': 3,
  'EU Commission Digital': 2,
  'China Tech Policy': 3,
  'UK Tech Policy': 3,
  'India Tech Policy': 3,

  // Tier 2-3 - Podcasts & Newsletters
  'Acquired Podcast': 2,
  'All-In Podcast': 2,
  'a16z Podcast': 2,
  'This Week in Startups': 3,
  'The Twenty Minute VC': 2,
  'Lex Fridman Tech': 3,
  'The Vergecast': 3,
  'Decoder (Verge)': 3,
  'Hard Fork (NYT)': 2,
  'Pivot (Vox)': 2,
  'Benedict Evans': 2,
  'The Pragmatic Engineer': 2,
  'Lenny Newsletter': 2,
  'AI Podcast (NVIDIA)': 3,
  'Gradient Dissent': 3,
  'Eye on AI': 3,
  'How I Built This': 2,
  'Masters of Scale': 2,
  'The Pitch': 3,

  // Tier 4 - Aggregators
  'Hacker News': 4,
  'The Verge': 4,
  'The Verge AI': 4,
  'VentureBeat AI': 4,
  'Yahoo Finance': 4,
  'TechCrunch Layoffs': 4,
  'ArXiv AI': 4,
  'AI News': 4,
  'Layoffs News': 4,
  // Cuba
  'Cubadebate': 2,
  'Granma': 2,
  'JuventudRevelde': 2,
  'Trabajadores': 2,
  'Tribuna': 2,
  'PrensaLatina': 2,
  '14ymedio': 3,
  'Directorio Cubano': 3,
  'Cubanet': 3,
  'CiberCuba': 3,
};

export function getSourceTier(sourceName: string): number {
  return SOURCE_TIERS[sourceName] ?? 4; // Default to tier 4 if unknown
}

export type SourceType = 'wire' | 'gov' | 'intel' | 'mainstream' | 'market' | 'tech' | 'other';

export const SOURCE_TYPES: Record<string, SourceType> = {
  // Wire services - fastest, most authoritative
  'Reuters': 'wire', 'Reuters World': 'wire', 'Reuters Business': 'wire',
  'AP News': 'wire', 'AFP': 'wire', 'Bloomberg': 'wire',

  // Government & International Org sources
  'White House': 'gov', 'State Dept': 'gov', 'Pentagon': 'gov',
  'Treasury': 'gov', 'DOJ': 'gov', 'DHS': 'gov', 'CDC': 'gov',
  'FEMA': 'gov', 'Federal Reserve': 'gov', 'SEC': 'gov',
  'UN News': 'gov', 'CISA': 'gov',

  // Intel/Defense specialty
  'Defense One': 'intel', 'Breaking Defense': 'intel', 'The War Zone': 'intel',
  'Defense News': 'intel', 'Janes': 'intel', 'Bellingcat': 'intel', 'Krebs Security': 'intel',
  'Foreign Policy': 'intel', 'The Diplomat': 'intel',
  'Atlantic Council': 'intel', 'Foreign Affairs': 'intel',
  'CrisisWatch': 'intel',
  'CSIS': 'intel', 'RAND': 'intel', 'Brookings': 'intel', 'Carnegie': 'intel',
  'IAEA': 'gov', 'WHO': 'gov', 'UNHCR': 'gov',
  'Xinhua': 'wire', 'TASS': 'wire',
  'NHK World': 'mainstream', 'Nikkei Asia': 'market',

  // Mainstream outlets
  'BBC World': 'mainstream', 'BBC Middle East': 'mainstream',
  'Guardian World': 'mainstream', 'Guardian ME': 'mainstream',
  'NPR News': 'mainstream', 'Al Jazeera': 'mainstream',
  'CNN World': 'mainstream', 'Politico': 'mainstream',

  // Market/Finance
  'CNBC': 'market', 'MarketWatch': 'market', 'Yahoo Finance': 'market',
  'Financial Times': 'market',

  // Tech
  'Hacker News': 'tech', 'Ars Technica': 'tech', 'The Verge': 'tech',
  'The Verge AI': 'tech', 'MIT Tech Review': 'tech', 'TechCrunch Layoffs': 'tech',
  'AI News': 'tech', 'ArXiv AI': 'tech', 'VentureBeat AI': 'tech',
  'Layoffs.fyi': 'tech', 'Layoffs News': 'tech',

  // Regional Tech Startups
  'EU Startups': 'tech', 'Tech.eu': 'tech', 'Sifted (Europe)': 'tech',
  'The Next Web': 'tech', 'Tech in Asia': 'tech', 'e27 (SEA)': 'tech',
  'DealStreetAsia': 'tech', 'Pandaily (China)': 'tech', '36Kr English': 'tech',
  'TechNode (China)': 'tech', 'The Bridge (Japan)': 'tech', 'Nikkei Tech': 'tech',
  'Inc42 (India)': 'tech', 'YourStory': 'tech', 'TechCabal (Africa)': 'tech',
  'Disrupt Africa': 'tech', 'Wamda (MENA)': 'tech', 'Magnitt': 'tech',

  // Think Tanks & Policy
  'Brookings Tech': 'intel', 'CSIS Tech': 'intel', 'Stanford HAI': 'intel',
  'AI Now Institute': 'intel', 'OECD Digital': 'intel', 'Bruegel (EU)': 'intel',
  'Chatham House Tech': 'intel', 'DigiChina': 'intel', 'Lowy Institute': 'intel',
  'EFF News': 'intel', 'Politico Tech': 'intel',
  // Security/Defense Think Tanks
  'RUSI': 'intel', 'Wilson Center': 'intel', 'GMF': 'intel',
  'Stimson Center': 'intel', 'CNAS': 'intel',
  // Nuclear & Arms Control
  'Arms Control Assn': 'intel', 'Bulletin of Atomic Scientists': 'intel',
  // Food Security & Regional
  'FAO GIEWS': 'gov', 'EU ISS': 'intel',
  // New verified think tanks
  'War on the Rocks': 'intel', 'AEI': 'intel', 'Responsible Statecraft': 'intel',
  'FPRI': 'intel', 'Jamestown': 'intel',

  // Podcasts & Newsletters
  'Acquired Podcast': 'tech', 'All-In Podcast': 'tech', 'a16z Podcast': 'tech',
  'This Week in Startups': 'tech', 'The Twenty Minute VC': 'tech',
  'Hard Fork (NYT)': 'tech', 'Pivot (Vox)': 'tech', 'Stratechery': 'tech',
  'Benedict Evans': 'tech', 'How I Built This': 'tech', 'Masters of Scale': 'tech',
  //Cuba
  'Cubadebate': 'mainstream',
  'Granma': 'mainstream',
  'JuventudRevelde': 'other',
  'Trabajadores': 'other',
  'Tribuna': 'other',
  'PrensaLatina': 'mainstream',
  '14ymedio': 'mainstream',
  'Directorio Cubano': 'mainstream',
  'Cubanet': 'mainstream',
  'CiberCuba': 'mainstream',
};

export function getSourceType(sourceName: string): SourceType {
  return SOURCE_TYPES[sourceName] ?? 'other';
}

// Propaganda risk assessment for sources (Quick Win #5)
// 'high' = State-controlled media, known to push government narratives
// 'medium' = State-affiliated or known editorial bias toward specific governments
// 'low' = Independent journalism with editorial standards
export type PropagandaRisk = 'low' | 'medium' | 'high';

export interface SourceRiskProfile {
  risk: PropagandaRisk;
  stateAffiliated?: string;
  knownBiases?: string[];
  note?: string;
}

export const SOURCE_PROPAGANDA_RISK: Record<string, SourceRiskProfile> = {
  // High risk - State-controlled media
  'Xinhua': { risk: 'high', stateAffiliated: 'China', note: 'Official CCP news agency' },
  'TASS': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state news agency' },
  'RT': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state media, banned in EU' },
  'Sputnik': { risk: 'high', stateAffiliated: 'Russia', note: 'Russian state media' },
  'CGTN': { risk: 'high', stateAffiliated: 'China', note: 'Chinese state broadcaster' },
  'Press TV': { risk: 'high', stateAffiliated: 'Iran', note: 'Iranian state media' },
  'KCNA': { risk: 'high', stateAffiliated: 'North Korea', note: 'North Korean state media' },

  // Medium risk - State-affiliated or known bias
  'Al Jazeera': { risk: 'medium', stateAffiliated: 'Qatar', note: 'Qatari state-funded, independent editorial' },
  'Al Arabiya': { risk: 'medium', stateAffiliated: 'Saudi Arabia', note: 'Saudi-owned, reflects Gulf perspective' },
  'TRT World': { risk: 'medium', stateAffiliated: 'Turkey', note: 'Turkish state broadcaster' },
  'France 24': { risk: 'medium', stateAffiliated: 'France', note: 'French state-funded, editorially independent' },
  'DW News': { risk: 'medium', stateAffiliated: 'Germany', note: 'German state-funded, editorially independent' },
  'Voice of America': { risk: 'medium', stateAffiliated: 'USA', note: 'US government-funded' },
  'Kyiv Independent': { risk: 'medium', knownBiases: ['Pro-Ukraine'], note: 'Ukrainian perspective on Russia-Ukraine war' },
  'Moscow Times': { risk: 'medium', knownBiases: ['Anti-Kremlin'], note: 'Independent, critical of Russian government' },

  // Low risk - Independent with editorial standards (explicit)
  'Reuters': { risk: 'low', note: 'Wire service, strict editorial standards' },
  'AP News': { risk: 'low', note: 'Wire service, nonprofit cooperative' },
  'AFP': { risk: 'low', note: 'Wire service, editorially independent' },
  'BBC World': { risk: 'low', note: 'Public broadcaster, editorial independence charter' },
  'BBC Middle East': { risk: 'low', note: 'Public broadcaster, editorial independence charter' },
  'Guardian World': { risk: 'low', knownBiases: ['Center-left'], note: 'Scott Trust ownership, no shareholders' },
  'Financial Times': { risk: 'low', note: 'Business focus, Nikkei-owned' },
  'Bellingcat': { risk: 'low', note: 'Open-source investigations, methodology transparent' },

  //Cuba
  'Cubadebate': { risk: 'high', stateAffiliated: 'Cuba', note: 'Government-aligned digital outlet' },
  'Granma': { risk: 'high', stateAffiliated: 'Cuba', note: 'Official newspaper of the PCC' },
  'JuventudRevelde': { risk: 'high', stateAffiliated: 'Cuba', note: 'Official newspaper of the UJC' },
  'Trabajadores': { risk: 'high', stateAffiliated: 'Cuba', note: 'Wire service, strict editorial standards' },
  'Tribuna': { risk: 'high', stateAffiliated: 'Cuba', note: 'Wire service, strict editorial standards' },
  'PrensaLatina': { risk: 'high', stateAffiliated: 'Cuba', note: 'Wire service, strict editorial standards' },
  '14ymedio': { risk: 'low', note: 'Independent Cuban outlet focused on domestic reporting' },
  'Directorio Cubano': { risk: 'medium', note: 'Cuban diaspora service outlet with practical news coverage' },
  'Cubanet': { risk: 'medium', note: 'Independent Cuba-focused outlet with diaspora editorial perspective' },
  'CiberCuba': { risk: 'medium', note: 'Digital Cuba-focused outlet with diaspora editorial perspective' },
};

export function getSourcePropagandaRisk(sourceName: string): SourceRiskProfile {
  return SOURCE_PROPAGANDA_RISK[sourceName] ?? { risk: 'low' };
}

export function isStateAffiliatedSource(sourceName: string): boolean {
  const profile = SOURCE_PROPAGANDA_RISK[sourceName];
  return !!profile?.stateAffiliated;
}

interface CubaProvinceFeedDefinition {
  key: string;
  panelName: string;
  terms: string[];
  destinationTerms?: string[];
}

const CUBA_PROVINCE_FEED_DEFINITIONS: CubaProvinceFeedDefinition[] = [
  {
    key: 'pinarDelRio',
    panelName: 'Pinar del Río',
    terms: ['"Pinar del Río"', '"Pinar del Rio"'],
    destinationTerms: ['Viñales', 'Vinales', '"Valle de Viñales"', '"Valle de Vinales"', '"Cayo Jutías"', '"Cayo Jutias"', '"Cayo Levisa"', '"Soroa"'],
  },
  {
    key: 'artemisa',
    panelName: 'Artemisa',
    terms: ['Artemisa'],
    destinationTerms: ['Soroa', 'Mariel', '"Las Terrazas"', '"San Antonio de los Baños"', '"San Antonio de los Banos"'],
  },
  {
    key: 'laHabana',
    panelName: 'La Habana',
    terms: ['"La Habana"', 'Havana'],
    destinationTerms: ['"Habana Vieja"', '"Old Havana"', 'Vedado', 'Malecon', 'Malecón', '"Playas del Este"', '"Fusterlandia"'],
  },
  {
    key: 'islaDeLaJuventud',
    panelName: 'Isla de la Juventud',
    terms: ['"Isla de la Juventud"', '"Nueva Gerona"'],
    destinationTerms: ['"Cayo Largo"', '"Punta Frances"', '"Punta Francés"', '"Playa Bibijagua"', '"Colony Hotel"'],
  },
  {
    key: 'mayabeque',
    panelName: 'Mayabeque',
    terms: ['Mayabeque'],
    destinationTerms: ['Jibacoa', '"Santa Cruz del Norte"', '"Escaleras de Jaruco"', '"Playa Jibacoa"'],
  },
  {
    key: 'matanzas',
    panelName: 'Matanzas',
    terms: ['Matanzas'],
    destinationTerms: ['Varadero', '"Cienaga de Zapata"', '"Ciénaga de Zapata"', '"Bahía de Cochinos"', '"Bay of Pigs"', '"Playa Giron"', '"Playa Girón"'],
  },
  {
    key: 'cienfuegos',
    panelName: 'Cienfuegos',
    terms: ['Cienfuegos'],
    destinationTerms: ['"Punta Gorda"', '"Jardín Botánico de Cienfuegos"', '"Jardin Botanico de Cienfuegos"', '"El Nicho"', '"Bahía de Cienfuegos"'],
  },
  {
    key: 'villaClara',
    panelName: 'Villa Clara',
    terms: ['"Villa Clara"'],
    destinationTerms: ['"Cayo Santa María"', '"Cayo Santa Maria"', '"Cayo Las Brujas"', '"Cayo Ensenachos"', '"Santa Clara"', '"Remedios"'],
  },
  {
    key: 'sanctiSpiritus',
    panelName: 'Sancti Spíritus',
    terms: ['"Sancti Spíritus"', '"Sancti Spiritus"'],
    destinationTerms: ['Trinidad', '"Valle de los Ingenios"', '"Topes de Collantes"', '"Playa Ancón"', '"Playa Ancon"', '"Cayo Blanco"'],
  },
  {
    key: 'ciegoDeAvila',
    panelName: 'Ciego de Ávila',
    terms: ['"Ciego de Ávila"', '"Ciego de Avila"'],
    destinationTerms: ['"Cayo Coco"', '"Cayo Guillermo"', '"Jardines del Rey"', 'Morón', 'Moron', '"Laguna de la Leche"'],
  },
  {
    key: 'camaguey',
    panelName: 'Camagüey',
    terms: ['Camagüey', 'Camaguey'],
    destinationTerms: ['"Santa Lucía"', '"Santa Lucia"', '"Playa Santa Lucia"', 'Nuevitas', '"Centro histórico de Camagüey"', '"Centro historico de Camaguey"'],
  },
  {
    key: 'lasTunas',
    panelName: 'Las Tunas',
    terms: ['"Las Tunas"'],
    destinationTerms: ['"Puerto Padre"', '"Covarrubias"', '"Playa Covarrubias"', '"Chaparra"'],
  },
  {
    key: 'holguin',
    panelName: 'Holguín',
    terms: ['Holguín', 'Holguin'],
    destinationTerms: ['Guardalavaca', '"Playa Pesquero"', '"Gibara"', '"Banes"', '"Cayo Saetía"', '"Cayo Saetia"', '"Bahía de Naranjo"'],
  },
  {
    key: 'granma',
    panelName: 'Granma',
    terms: ['Granma'],
    destinationTerms: ['Bayamo', 'Manzanillo', '"Sierra Maestra"', '"Marea del Portillo"', '"La Demajagua"', 'Pilón', 'Pilon'],
  },
  {
    key: 'santiagoDeCuba',
    panelName: 'Santiago de Cuba',
    terms: ['"Santiago de Cuba"'],
    destinationTerms: ['"Castillo del Morro"', '"Cementerio Santa Ifigenia"', '"Gran Piedra"', '"Parque Baconao"', '"Carnaval de Santiago"'],
  },
  {
    key: 'guantanamo',
    panelName: 'Guantánamo',
    terms: ['Guantánamo', 'Guantanamo'],
    destinationTerms: ['Baracoa', 'Maisí', 'Maisi', '"Yunque de Baracoa"', '"Alejandro de Humboldt"', '"Playa Maguana"'],
  },
];

const CUBA_TOURISM_TOPIC_QUERY =
  '(turismo OR turistico OR turistica OR turistas OR visitante OR visitantes OR hotel OR hoteles OR resort OR playa OR playas OR patrimonio OR festival OR cultura OR vuelo OR vuelos OR aeropuerto OR crucero OR cruceros OR marina OR alojamiento OR gastronomia OR ecoturismo OR travel OR tourism OR tourist OR visitors OR beach OR heritage OR flight OR airport OR cruise)';

const CUBA_PROVINCIAL_FEEDS: Record<string, Feed[]> = Object.fromEntries(
  CUBA_PROVINCE_FEED_DEFINITIONS.map(({ key, panelName, terms, destinationTerms = [] }) => {
    const provinceTextFilterId = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const locationQuery = Array.from(new Set([...terms, ...destinationTerms])).join(' OR ');
    const tourismRecentQuery = `(${locationQuery} ${CUBA_TOURISM_TOPIC_QUERY}) when:7d`;

    const provinceFeeds: Feed[] = [
      {
        name: `${panelName} Turismo 7d`,
        url: googleNewsRssPlain(tourismRecentQuery, 'es-419', 'US', 'US:es-419'),
        provinceTextFilterId,
        limit: 8,
      },
    ];

    return [
      key,
      provinceFeeds,
    ];
  }),
);

const FULL_FEEDS: Record<string, Feed[]> = {
  politics: [
    {
      name: 'Turismo Mundial (ES)',
      url: googleNewsRssPlain(
        '("turismo mundial" OR "turismo internacional" OR "industria turistica" OR "viajes internacionales" OR "llegadas de turistas" OR "demanda turistica" OR aerolineas OR hoteles OR cruceros) when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Global Tourism (EN)',
      url: googleNewsRssPlain(
        '("global tourism" OR "international tourism" OR "travel industry" OR "tourist arrivals" OR "hotel occupancy" OR airlines OR cruises OR destinations) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'UN Tourism',
      url: googleNewsRssPlain(
        '(site:unwto.org OR "UN Tourism" OR UNWTO) AND (tourism OR travel OR destination OR arrivals OR sustainability) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'WTTC',
      url: googleNewsRssPlain(
        '(site:wttc.org OR "World Travel and Tourism Council" OR WTTC) AND (tourism OR travel OR economy OR jobs OR investment) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  middleeast: [
    {
      name: 'Turismo MENA',
      url: googleNewsRssPlain(
        '("Middle East tourism" OR "MENA tourism" OR Dubai OR Abu Dhabi OR Saudi OR Qatar OR Egypt OR Jordan OR Morocco) AND (tourism OR travel OR hotel OR airline OR cruise OR destination) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Golfo y Turismo',
      url: googleNewsRssPlain(
        '(Dubai OR "Abu Dhabi" OR "Saudi Arabia" OR Qatar OR Oman OR Bahrain) AND (tourism OR travel OR hotel OR resort OR airport OR airline OR cruise OR "Vision 2030") when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Turismo Norte de Africa',
      url: googleNewsRssPlain(
        '(Egypt OR Morocco OR Tunisia OR Algeria) AND (tourism OR travel OR hotel OR resort OR visitors OR "tourist arrivals") when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  tech: [
    {
      name: 'Tecnología Turística (ES)',
      url: googleNewsRssPlain(
        '("tecnologia turistica" OR traveltech OR "turismo inteligente" OR "hotel tech" OR "reservas online" OR "check-in digital" OR "pagos digitales" OR "experiencia del viajero") when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Travel Technology (EN)',
      url: googleNewsRssPlain(
        '(traveltech OR "travel technology" OR "hotel tech" OR "smart tourism" OR "online booking" OR "digital check-in" OR "tourism platform" OR "visitor experience") when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Cuba Travel Tech',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR ETECSA OR MINTUR OR "turismo cubano") AND (internet OR conectividad OR "pagos digitales" OR reservas OR "booking" OR hotel OR "transformacion digital" OR "digital transformation" OR traveltech) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Aerolíneas y Canales Digitales',
      url: googleNewsRssPlain(
        '(airline OR aerolinea OR airport OR aeropuerto OR hotel OR resort) AND ("mobile app" OR app OR "digital booking" OR "online booking" OR "self service" OR biometrics OR biometricos) AND (tourism OR travel OR turismo) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  ai: [
    {
      name: 'IA para Turismo (ES)',
      url: googleNewsRssPlain(
        '("inteligencia artificial" OR IA OR "machine learning" OR "IA generativa" OR ChatGPT OR "modelo de lenguaje" OR LLM) AND (turismo OR hotel OR hoteles OR aerolinea OR aeropuerto OR viajes OR visitantes OR destinos) when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'AI for Travel (EN)',
      url: googleNewsRssPlain(
        '("artificial intelligence" OR AI OR "machine learning" OR "generative AI" OR ChatGPT OR "language model" OR LLM) AND (tourism OR travel OR hotel OR airline OR airport OR destination OR visitor) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'IA Turística Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR MINTUR OR "turismo cubano" OR hotel OR hoteles) AND ("inteligencia artificial" OR IA OR "machine learning" OR ChatGPT OR "analitica de datos" OR "experiencia del viajero" OR "transformacion digital") when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Tourism Data Platforms',
      url: googleNewsRssPlain(
        '("tourism data" OR "travel data" OR "hotel analytics" OR "destination intelligence" OR "revenue management" OR "dynamic pricing") AND (AI OR "artificial intelligence" OR analytics OR platform) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  finance: [
    {
      name: 'Economía Turística Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR MINTUR OR "turismo cubano") AND (turismo OR hotel OR hoteles OR visitantes OR "llegadas de turistas" OR inversion OR ingresos OR ocupacion OR aerolineas OR cruceros) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Tourism Economy (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR MINTUR OR "Cuban tourism") AND (tourism OR hotel OR visitors OR "tourist arrivals" OR investment OR revenue OR occupancy OR airlines OR cruises) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Costos para Viajeros Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana) AND (turismo OR turista OR viajeros OR visitantes) AND (peso OR CUP OR MLC OR divisa OR moneda OR "tipo de cambio" OR precios OR tarifas OR costo) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Travel Costs Cuba (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana) AND (tourism OR tourist OR travelers OR visitors) AND (peso OR CUP OR MLC OR currency OR "exchange rate" OR prices OR fees OR costs) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Inversión Hotelera Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero) AND (hotel OR hoteles OR resort OR alojamiento OR inversion OR inversion extranjera OR "grupo hotelero" OR Meliá OR Melia OR Iberostar OR Gaviota) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Hotel Investment Cuba (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR Varadero) AND (hotel OR resort OR accommodation OR investment OR "foreign investment" OR "hotel group" OR Melia OR Iberostar OR Gaviota) when:30d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  gov: [
    {
      name: 'Política Turística Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR MINTUR OR "Ministerio de Turismo") AND (turismo OR turistas OR visitantes OR hoteles OR vuelos OR visado OR visa OR regulacion OR medidas OR normas) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Tourism Policy (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR MINTUR OR "Ministry of Tourism") AND (tourism OR tourists OR visitors OR hotels OR flights OR visa OR regulation OR measures OR rules) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'MINTUR Cuba',
      url: googleNewsRssPlain(
        '(site:mintur.gob.cu OR MINTUR OR "Ministerio de Turismo de Cuba" OR "turismo cubano") AND (turismo OR hotel OR hoteles OR visitantes OR destinos OR feria OR FITCuba) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Travel Rules',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana) AND (travel OR tourism OR tourist OR visitor) AND (visa OR entry OR customs OR airport OR health OR regulation OR requirement) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Conectividad Aérea Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero) AND (vuelos OR aerolinea OR aerolineas OR aeropuerto OR ruta OR rutas OR conectividad aerea OR charter) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Air Connectivity (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR Varadero) AND (flight OR flights OR airline OR airport OR route OR routes OR air connectivity OR charter) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    // Desactivado por solicitud: feeds de EE.UU. y organismos en la categoría gov.
    // { name: 'White House', url: rss('https://news.google.com/rss/search?q=site:whitehouse.gov&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'State Dept', url: rss('https://news.google.com/rss/search?q=site:state.gov+OR+"State+Department"&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'Pentagon', url: rss('https://news.google.com/rss/search?q=site:defense.gov+OR+Pentagon&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'Treasury', url: rss('https://news.google.com/rss/search?q=site:treasury.gov+OR+"Treasury+Department"&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'DOJ', url: rss('https://news.google.com/rss/search?q=site:justice.gov+OR+"Justice+Department"+DOJ&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'Federal Reserve', url: rss('https://www.federalreserve.gov/feeds/press_all.xml') },
    // { name: 'SEC', url: rss('https://www.sec.gov/news/pressreleases.rss') },
    // { name: 'CDC', url: rss('https://news.google.com/rss/search?q=site:cdc.gov+OR+CDC+health&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'FEMA', url: rss('https://news.google.com/rss/search?q=site:fema.gov+OR+FEMA+emergency&hl=en-US&gl=US&ceid=US:en') },
    // { name: 'DHS', url: rss('https://news.google.com/rss/search?q=site:dhs.gov+OR+"Homeland+Security"&hl=en-US&gl=US&ceid=US:en') },
    // {
    //   name: 'UN News',
    //   url: railwayRss('https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
    //   fallbackUrls: [googleNewsRss('site:news.un.org+when:7d')],
    // },
    // { name: 'CISA', url: railwayRss('https://www.cisa.gov/cybersecurity-advisories/all.xml') },
  ],
  culture: [
    {
      name: 'Turismo Cultural Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR cubano OR cubana) AND (turismo OR turistas OR visitantes OR viajes) AND (cultura OR arte OR musica OR cine OR literatura OR teatro OR danza OR patrimonio OR museo OR festival OR gastronomia) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuban Cultural Tourism (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR cuban) AND (tourism OR tourists OR visitors OR travel) AND (culture OR arts OR music OR film OR cinema OR literature OR theater OR dance OR heritage OR museum OR festival OR gastronomy) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Eventos y Festivales Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR MINCULT OR "Ministerio de Cultura de Cuba") AND (festival OR feria OR carnaval OR evento OR concierto OR exposicion OR museo OR patrimonio OR turismo cultural) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuban Heritage Travel (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR "Ministry of Culture of Cuba" OR MINCULT) AND (heritage OR museum OR festival OR "cultural tourism" OR music OR arts OR gastronomy OR travel) when:30d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  layoffs: [
    { name: 'Layoffs.fyi', url: rss('https://layoffs.fyi/feed/') },
    { name: 'TechCrunch Layoffs', url: rss('https://techcrunch.com/tag/layoffs/feed/') },
    { name: 'Layoffs News', url: rss('https://news.google.com/rss/search?q=(layoffs+OR+"job+cuts"+OR+"workforce+reduction")+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  thinktanks: [
    { name: 'Foreign Policy', url: rss('https://foreignpolicy.com/feed/') },
    { name: 'Atlantic Council', url: railwayRss('https://www.atlanticcouncil.org/feed/') },
    { name: 'Foreign Affairs', url: rss('https://www.foreignaffairs.com/rss.xml') },
    { name: 'CSIS', url: rss('https://news.google.com/rss/search?q=site:csis.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'RAND', url: rss('https://news.google.com/rss/search?q=site:rand.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Brookings', url: rss('https://news.google.com/rss/search?q=site:brookings.edu+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Carnegie', url: rss('https://news.google.com/rss/search?q=site:carnegieendowment.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // New verified think tank feeds
    // War on the Rocks - Defense and national security analysis
    {
      name: 'War on the Rocks',
      url: rss('https://warontherocks.com/feed'),
      fallbackUrls: [googleNewsRss('site:warontherocks.com+when:7d')],
    },
    // AEI - American Enterprise Institute (US conservative think tank)
    { name: 'AEI', url: googleNewsRss('site:aei.org+when:7d') },
    // Responsible Statecraft - Foreign policy analysis (Quincy Institute)
    { name: 'Responsible Statecraft', url: rss('https://responsiblestatecraft.org/feed/') },
    // RUSI - Royal United Services Institute (UK defense & security)
    { name: 'RUSI', url: rss('https://news.google.com/rss/search?q=site:rusi.org+when:3d&hl=en-US&gl=US&ceid=US:en') },
    // FPRI - Foreign Policy Research Institute (US foreign policy)
    { name: 'FPRI', url: rss('https://www.fpri.org/feed/') },
    // Jamestown Foundation - Eurasia/China/Terrorism analysis
    { name: 'Jamestown', url: rss('https://jamestown.org/feed/') },
  ],
  crisis: [
    { name: 'CrisisWatch', url: rss('https://www.crisisgroup.org/rss') },
    { name: 'IAEA', url: rss('https://www.iaea.org/feeds/topnews') },
    { name: 'WHO', url: rss('https://www.who.int/rss-feeds/news-english.xml') },
    { name: 'UNHCR', url: rss('https://news.google.com/rss/search?q=site:unhcr.org+OR+UNHCR+refugees+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  regional: [
    { name: 'Xinhua', url: rss('https://news.google.com/rss/search?q=site:xinhuanet.com+OR+Xinhua+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TASS', url: rss('https://news.google.com/rss/search?q=site:tass.com+OR+TASS+Russia+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Kyiv Independent', url: rss('https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Moscow Times', url: googleNewsRss('(site:themoscowtimes.com+OR+site:ru.themoscowtimes.com)+when:7d') },
  ],
  africa: [
    {
      name: 'Turismo África',
      url: googleNewsRssPlain(
        '(Africa OR Nigeria OR Kenya OR "South Africa" OR Ethiopia OR Tanzania OR Morocco OR Egypt) AND (tourism OR travel OR hotel OR resort OR safari OR visitors OR "tourist arrivals") when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Turismo África (ES)',
      url: googleNewsRssPlain(
        '(Africa OR Marruecos OR Egipto OR Kenia OR Tanzania OR "Sudafrica") AND (turismo OR viajes OR hotel OR hoteles OR safari OR visitantes OR "llegadas de turistas") when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Safaris y Naturaleza',
      url: googleNewsRssPlain(
        '(Kenya OR Tanzania OR Botswana OR Namibia OR Rwanda OR Uganda OR "South Africa") AND (safari OR ecotourism OR "wildlife tourism" OR conservation OR lodge OR visitors) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  latam: [
    {
      name: 'Turismo América Latina',
      url: googleNewsRssPlain(
        '("America Latina" OR "Latin America" OR Mexico OR Brasil OR Brazil OR Argentina OR Colombia OR Peru OR Chile OR "Costa Rica" OR Caribe) AND (turismo OR travel OR hotel OR resort OR visitantes OR "llegadas de turistas" OR vuelos OR cruceros) when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'LATAM Tourism (EN)',
      url: googleNewsRssPlain(
        '("Latin America" OR Mexico OR Brazil OR Argentina OR Colombia OR Peru OR Chile OR "Costa Rica" OR Caribbean) AND (tourism OR travel OR hotel OR resort OR visitors OR "tourist arrivals" OR flights OR cruises) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Caribe Turismo',
      url: googleNewsRssPlain(
        '(Caribe OR Caribbean OR Cuba OR Jamaica OR "Dominican Republic" OR "Republica Dominicana" OR Bahamas OR Barbados) AND (turismo OR tourism OR hotel OR resort OR cruise OR crucero OR vuelos OR visitors) when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
  ],
  asia: [
    {
      name: 'Turismo Asia-Pacífico',
      url: googleNewsRssPlain(
        '(Asia OR China OR Japan OR Korea OR India OR ASEAN OR Thailand OR Vietnam OR Indonesia OR Singapore OR "Asia Pacific") AND (tourism OR travel OR hotel OR resort OR visitors OR "tourist arrivals" OR flights) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Asia Turismo (ES)',
      url: googleNewsRssPlain(
        '(Asia OR China OR Japon OR Japón OR Corea OR India OR ASEAN OR Tailandia OR Vietnam OR Indonesia OR Singapur) AND (turismo OR viajes OR hotel OR hoteles OR visitantes OR "llegadas de turistas" OR vuelos) when:7d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'ASEAN y Hoteles',
      url: googleNewsRssPlain(
        '(Thailand OR Vietnam OR Indonesia OR Malaysia OR Singapore OR Philippines OR ASEAN) AND (tourism OR hotel OR resort OR airline OR airport OR visitors OR travel) when:7d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  energy: [
    {
      name: 'Infraestructura Turística Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero OR MINTUR) AND (hotel OR hoteles OR resort OR aeropuerto OR aeropuertos OR transporte OR crucero OR marina OR electricidad OR combustible OR agua OR conectividad) AND (turismo OR turistas OR visitantes OR viajes) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Tourism Infrastructure (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR Varadero OR MINTUR) AND (hotel OR resort OR airport OR transport OR cruise OR marina OR electricity OR fuel OR water OR connectivity) AND (tourism OR tourists OR visitors OR travel) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Aeropuertos y Vuelos Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero OR Holguin OR "Santiago de Cuba") AND (aeropuerto OR vuelos OR aerolineas OR ruta OR charter OR terminal OR conectividad aerea) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cruise and Marina Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR "Santiago de Cuba" OR Cienfuegos OR "Isla de la Juventud") AND (cruise OR cruises OR marina OR port OR yacht OR nautical OR crucero OR cruceros) AND (tourism OR travel OR turismo) when:30d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'Hoteles y Resorts Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero OR "Cayo Coco" OR "Cayo Santa Maria" OR Holguin) AND (hotel OR hoteles OR resort OR alojamiento OR habitaciones OR ocupacion OR renovacion OR apertura) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Hotels and Resorts (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR Varadero OR "Cayo Coco" OR "Cayo Santa Maria" OR Holguin) AND (hotel OR resort OR accommodation OR rooms OR occupancy OR renovation OR opening) when:30d',
        'en-US',
        'US',
        'US:en',
      ),
    },
  ],
  
  cuba: [
    {
      name: 'Turismo Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero OR MINTUR OR "turismo cubano") AND (turismo OR turistas OR visitantes OR hotel OR hoteles OR resort OR vuelos OR cruceros OR destinos) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Tourism (EN)',
      url: googleNewsRssPlain(
        '(Cuba OR Havana OR Habana OR Varadero OR MINTUR OR "Cuban tourism") AND (tourism OR tourists OR visitors OR hotel OR resort OR flights OR cruises OR destinations) when:14d',
        'en-US',
        'US',
        'US:en',
      ),
    },
    {
      name: 'MINTUR y FITCuba',
      url: googleNewsRssPlain(
        '(site:mintur.gob.cu OR MINTUR OR FITCuba OR "Feria Internacional de Turismo" OR "Ministerio de Turismo de Cuba") AND (turismo OR visitantes OR hoteles OR destinos OR feria OR viaje) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Varadero y Cayos',
      url: googleNewsRssPlain(
        '(Varadero OR "Cayo Coco" OR "Cayo Guillermo" OR "Cayo Santa Maria" OR "Cayo Santa María" OR Guardalavaca OR "Playa Pesquero") AND (turismo OR turistas OR hotel OR hoteles OR resort OR vuelos OR visitantes) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'La Habana Turística',
      url: googleNewsRssPlain(
        '("La Habana" OR Havana OR "Habana Vieja" OR "Old Havana") AND (turismo OR turistas OR visitantes OR hotel OR hoteles OR patrimonio OR cultura OR museo OR festival OR vuelos) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Vuelos y Aerolíneas',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Varadero OR Holguin OR "Santiago de Cuba") AND (vuelos OR aerolineas OR aeropuerto OR ruta OR charter OR "air connectivity" OR flight OR airline) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Cuba Cruceros',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Cienfuegos OR "Santiago de Cuba") AND (crucero OR cruceros OR cruise OR cruises OR puerto OR port OR marina) AND (turismo OR tourism OR travel) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Turismo Cultural Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana OR Trinidad OR Viñales OR Vinales OR "Santiago de Cuba" OR Baracoa) AND (turismo cultural OR patrimonio OR museo OR festival OR musica OR gastronomia OR visitantes OR travel) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Ecoturismo Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Viñales OR Vinales OR Baracoa OR "Cienaga de Zapata" OR "Ciénaga de Zapata" OR "Alejandro de Humboldt" OR "Topes de Collantes") AND (ecoturismo OR naturaleza OR senderismo OR turismo OR visitantes OR travel OR conservation) when:30d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
    {
      name: 'Noticias Prácticas Viajeros Cuba',
      url: googleNewsRssPlain(
        '(Cuba OR Habana OR Havana) AND (viajeros OR turistas OR visitantes OR travel) AND (visa OR visado OR aduana OR moneda OR tipo de cambio OR internet OR transporte OR electricidad OR requisitos) when:14d',
        'es-419',
        'US',
        'US:es-419',
      ),
    },
  ],
  ...CUBA_PROVINCIAL_FEEDS,
};

// Tech/AI variant feeds
const TECH_FEEDS: Record<string, Feed[]> = {
  tech: [
    { name: 'TechCrunch', url: rss('https://techcrunch.com/feed/') },
    { name: 'The Verge', url: rss('https://www.theverge.com/rss/index.xml') },
    { name: 'Ars Technica', url: rss('https://feeds.arstechnica.com/arstechnica/technology-lab') },
    { name: 'Hacker News', url: rss('https://hnrss.org/frontpage') },
    { name: 'MIT Tech Review', url: rss('https://www.technologyreview.com/feed/') },
    { name: 'ZDNet', url: rss('https://www.zdnet.com/news/rss.xml') },
    { name: 'TechMeme', url: rss('https://www.techmeme.com/feed.xml') },
    { name: 'Engadget', url: rss('https://www.engadget.com/rss.xml') },
    { name: 'Fast Company', url: rss('https://feeds.feedburner.com/fastcompany/headlines') },
  ],
  ai: [
    { name: 'AI News', url: rss('https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Google+AI+OR+"large+language+model"+OR+ChatGPT+OR+Claude+OR+"AI+model")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VentureBeat AI', url: rss('https://venturebeat.com/category/ai/feed/') },
    { name: 'The Verge AI', url: rss('https://www.theverge.com/rss/ai-artificial-intelligence/index.xml') },
    { name: 'MIT Tech Review AI', url: rss('https://www.technologyreview.com/topic/artificial-intelligence/feed') },
    { name: 'MIT Research', url: rss('https://news.mit.edu/rss/research') },
    { name: 'ArXiv AI', url: rss('https://export.arxiv.org/rss/cs.AI') },
    { name: 'ArXiv ML', url: rss('https://export.arxiv.org/rss/cs.LG') },
    { name: 'AI Weekly', url: rss('https://news.google.com/rss/search?q="artificial+intelligence"+OR+"machine+learning"+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Anthropic News', url: rss('https://news.google.com/rss/search?q=Anthropic+Claude+AI+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'OpenAI News', url: rss('https://news.google.com/rss/search?q=OpenAI+ChatGPT+GPT-4+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  startups: [
    { name: 'TechCrunch Startups', url: rss('https://techcrunch.com/category/startups/feed/') },
    { name: 'VentureBeat', url: rss('https://venturebeat.com/feed/') },
    { name: 'Crunchbase News', url: rss('https://news.crunchbase.com/feed/') },
    { name: 'SaaStr', url: rss('https://www.saastr.com/feed/') },
    { name: 'AngelList News', url: rss('https://news.google.com/rss/search?q=site:angellist.com+OR+"AngelList"+funding+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TechCrunch Venture', url: rss('https://techcrunch.com/category/venture/feed/') },
    { name: 'The Information', url: rss('https://news.google.com/rss/search?q=site:theinformation.com+startup+OR+funding+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Fortune Term Sheet', url: rss('https://news.google.com/rss/search?q="Term+Sheet"+venture+capital+OR+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'PitchBook News', url: rss('https://news.google.com/rss/search?q=site:pitchbook.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'CB Insights', url: rss('https://www.cbinsights.com/research/feed/') },
  ],
  vcblogs: [
    { name: 'Y Combinator Blog', url: rss('https://www.ycombinator.com/blog/rss/') },
    { name: 'a16z Blog', url: rss('https://news.google.com/rss/search?q=site:a16z.com+OR+"Andreessen+Horowitz"+blog+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Sequoia Blog', url: rss('https://news.google.com/rss/search?q=site:sequoiacap.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Paul Graham Essays', url: rss('https://news.google.com/rss/search?q="Paul+Graham"+essay+OR+blog+when:30d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VC Insights', url: rss('https://news.google.com/rss/search?q=("venture+capital"+insights+OR+"VC+trends"+OR+"startup+advice")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Lenny\'s Newsletter', url: rss('https://www.lennysnewsletter.com/feed') },
    { name: 'Stratechery', url: rss('https://stratechery.com/feed/') },
    { name: 'FwdStart Newsletter', url: '/api/fwdstart' },
  ],
  regionalStartups: [
    // Europe
    { name: 'EU Startups', url: rss('https://news.google.com/rss/search?q=site:eu-startups.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Tech.eu', url: rss('https://tech.eu/feed/') },
    { name: 'Sifted (Europe)', url: rss('https://sifted.eu/feed') },
    { name: 'The Next Web', url: rss('https://news.google.com/rss/search?q=site:thenextweb.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Asia - General
    { name: 'Tech in Asia', url: rss('https://news.google.com/rss/search?q=site:techinasia.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'KrASIA', url: rss('https://news.google.com/rss/search?q=site:kr-asia.com+OR+KrASIA+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'SEA Startups', url: rss('https://news.google.com/rss/search?q=(Singapore+OR+Indonesia+OR+Vietnam+OR+Thailand+OR+Malaysia)+startup+funding+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Asia VC News', url: rss('https://news.google.com/rss/search?q=("Southeast+Asia"+OR+ASEAN)+venture+capital+OR+funding+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // China
    { name: 'China Startups', url: rss('https://news.google.com/rss/search?q=China+startup+funding+OR+"Chinese+startup"+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: '36Kr English', url: rss('https://news.google.com/rss/search?q=site:36kr.com+OR+"36Kr"+startup+china+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'China Tech Giants', url: rss('https://news.google.com/rss/search?q=(Alibaba+OR+Tencent+OR+ByteDance+OR+Baidu+OR+JD.com+OR+Xiaomi+OR+Huawei)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    // Japan
    { name: 'Japan Startups', url: rss('https://news.google.com/rss/search?q=Japan+startup+funding+OR+"Japanese+startup"+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Japan Tech News', url: rss('https://news.google.com/rss/search?q=(Japan+startup+OR+Japan+tech+OR+SoftBank+OR+Rakuten+OR+Sony)+funding+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Nikkei Tech', url: rss('https://news.google.com/rss/search?q=site:asia.nikkei.com+technology+when:3d&hl=en-US&gl=US&ceid=US:en') },
    // Korea
    { name: 'Korea Tech News', url: rss('https://news.google.com/rss/search?q=(Korea+startup+OR+Korean+tech+OR+Samsung+OR+Kakao+OR+Naver+OR+Coupang)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Korea Startups', url: rss('https://news.google.com/rss/search?q=Korea+startup+funding+OR+"Korean+unicorn"+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // India
    { name: 'Inc42 (India)', url: rss('https://inc42.com/feed/') },
    { name: 'YourStory', url: rss('https://yourstory.com/feed') },
    { name: 'India Startups', url: rss('https://news.google.com/rss/search?q=India+startup+funding+OR+"Indian+startup"+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'India Tech News', url: rss('https://news.google.com/rss/search?q=(Flipkart+OR+Razorpay+OR+Zerodha+OR+Zomato+OR+Paytm+OR+PhonePe)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Southeast Asia
    { name: 'SEA Tech News', url: rss('https://news.google.com/rss/search?q=(Grab+OR+GoTo+OR+Sea+Limited+OR+Shopee+OR+Tokopedia)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Vietnam Tech', url: rss('https://news.google.com/rss/search?q=Vietnam+startup+OR+Vietnam+tech+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Indonesia Tech', url: rss('https://news.google.com/rss/search?q=Indonesia+startup+OR+Indonesia+tech+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Taiwan
    { name: 'Taiwan Tech', url: rss('https://news.google.com/rss/search?q=(Taiwan+startup+OR+TSMC+OR+MediaTek+OR+Foxconn)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Latin America
    { name: 'LAVCA (LATAM)', url: rss('https://news.google.com/rss/search?q=site:lavca.org+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'LATAM Startups', url: rss('https://news.google.com/rss/search?q=("Latin+America"+startup+OR+LATAM+funding)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startups LATAM', url: rss('https://news.google.com/rss/search?q=(startup+Brazil+OR+startup+Mexico+OR+startup+Argentina+OR+startup+Colombia+OR+startup+Chile)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Brazil Tech', url: rss('https://news.google.com/rss/search?q=(Nubank+OR+iFood+OR+Mercado+Libre+OR+Rappi+OR+VTEX)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'FinTech LATAM', url: rss('https://news.google.com/rss/search?q=fintech+(Brazil+OR+Mexico+OR+Argentina+OR+"Latin+America")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Africa
    { name: 'TechCabal (Africa)', url: rss('https://techcabal.com/feed/') },
    { name: 'Disrupt Africa', url: rss('https://news.google.com/rss/search?q=site:disrupt-africa.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Africa Startups', url: rss('https://news.google.com/rss/search?q=Africa+startup+funding+OR+"African+startup"+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Africa Tech News', url: rss('https://news.google.com/rss/search?q=(Flutterwave+OR+Paystack+OR+Jumia+OR+Andela+OR+"Africa+startup")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Middle East
    { name: 'MENA Startups', url: rss('https://news.google.com/rss/search?q=(MENA+startup+OR+"Middle+East"+funding+OR+Gulf+startup)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'MENA Tech News', url: rss('https://news.google.com/rss/search?q=(UAE+startup+OR+Saudi+tech+OR+Dubai+startup+OR+NEOM+tech)+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  github: [
    { name: 'GitHub Blog', url: rss('https://github.blog/feed/') },
    { name: 'GitHub Trending', url: rss('https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml') },
    { name: 'Show HN', url: rss('https://hnrss.org/show') },
    { name: 'YC Launches', url: rss('https://news.google.com/rss/search?q=("Y+Combinator"+OR+"YC+launch"+OR+"YC+W25"+OR+"YC+S25")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Dev Events', url: rss('https://news.google.com/rss/search?q=("developer+conference"+OR+"tech+summit"+OR+"devcon"+OR+"developer+event")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Open Source News', url: rss('https://news.google.com/rss/search?q="open+source"+project+release+OR+launch+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  ipo: [
    { name: 'IPO News', url: rss('https://news.google.com/rss/search?q=(IPO+OR+"initial+public+offering"+OR+SPAC)+tech+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Renaissance IPO', url: rss('https://news.google.com/rss/search?q=site:renaissancecapital.com+IPO+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Tech IPO News', url: rss('https://news.google.com/rss/search?q=tech+IPO+OR+"tech+company"+IPO+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  funding: [
    { name: 'SEC Filings', url: rss('https://news.google.com/rss/search?q=(S-1+OR+"IPO+filing"+OR+"SEC+filing")+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'VC News', url: rss('https://news.google.com/rss/search?q=("Series+A"+OR+"Series+B"+OR+"Series+C"+OR+"funding+round"+OR+"venture+capital")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Seed & Pre-Seed', url: rss('https://news.google.com/rss/search?q=("seed+round"+OR+"pre-seed"+OR+"angel+round"+OR+"seed+funding")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startup Funding', url: rss('https://news.google.com/rss/search?q=("startup+funding"+OR+"raised+funding"+OR+"raised+$"+OR+"funding+announced")+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  producthunt: [
    { name: 'Product Hunt', url: rss('https://www.producthunt.com/feed') },
  ],
  outages: [
    { name: 'AWS Status', url: rss('https://news.google.com/rss/search?q=AWS+outage+OR+"Amazon+Web+Services"+down+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Cloud Outages', url: rss('https://news.google.com/rss/search?q=(Azure+OR+GCP+OR+Cloudflare+OR+Slack+OR+GitHub)+outage+OR+down+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],
  security: [
    { name: 'Krebs Security', url: rss('https://krebsonsecurity.com/feed/') },
    { name: 'The Hacker News', url: rss('https://feeds.feedburner.com/TheHackersNews') },
    { name: 'Dark Reading', url: rss('https://www.darkreading.com/rss.xml') },
    { name: 'Schneier', url: rss('https://www.schneier.com/feed/') },
  ],
  policy: [
    // US Policy
    { name: 'Politico Tech', url: rss('https://rss.politico.com/technology.xml') },
    { name: 'AI Regulation', url: rss('https://news.google.com/rss/search?q=AI+regulation+OR+"artificial+intelligence"+law+OR+policy+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Tech Antitrust', url: rss('https://news.google.com/rss/search?q=tech+antitrust+OR+FTC+Google+OR+FTC+Apple+OR+FTC+Amazon+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'EFF News', url: rss('https://news.google.com/rss/search?q=site:eff.org+OR+"Electronic+Frontier+Foundation"+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // EU Digital Policy
    { name: 'EU Digital Policy', url: rss('https://news.google.com/rss/search?q=("Digital+Services+Act"+OR+"Digital+Markets+Act"+OR+"EU+AI+Act"+OR+"GDPR")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Euractiv Digital', url: rss('https://news.google.com/rss/search?q=site:euractiv.com+digital+OR+tech+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'EU Commission Digital', url: rss('https://news.google.com/rss/search?q=site:ec.europa.eu+digital+OR+technology+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // China Tech Policy
    { name: 'China Tech Policy', url: rss('https://news.google.com/rss/search?q=(China+tech+regulation+OR+China+AI+policy+OR+MIIT+technology)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // UK Policy
    { name: 'UK Tech Policy', url: rss('https://news.google.com/rss/search?q=(UK+AI+safety+OR+"Online+Safety+Bill"+OR+UK+tech+regulation)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // India Policy
    { name: 'India Tech Policy', url: rss('https://news.google.com/rss/search?q=(India+tech+regulation+OR+India+data+protection+OR+India+AI+policy)+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  thinktanks: [
    // US Think Tanks
    { name: 'Brookings Tech', url: rss('https://news.google.com/rss/search?q=site:brookings.edu+technology+OR+AI+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'CSIS Tech', url: rss('https://news.google.com/rss/search?q=site:csis.org+technology+OR+AI+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'MIT Tech Policy', url: rss('https://news.google.com/rss/search?q=site:techpolicypress.org+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Stanford HAI', url: rss('https://news.google.com/rss/search?q=site:hai.stanford.edu+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'AI Now Institute', url: rss('https://news.google.com/rss/search?q=site:ainowinstitute.org+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // Europe Think Tanks
    { name: 'OECD Digital', url: rss('https://news.google.com/rss/search?q=site:oecd.org+digital+OR+AI+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'EU Tech Policy', url: rss('https://news.google.com/rss/search?q=("EU+tech+policy"+OR+"European+digital"+OR+Bruegel+tech)+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Chatham House Tech', url: rss('https://news.google.com/rss/search?q=site:chathamhouse.org+technology+OR+AI+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // Asia Think Tanks
    { name: 'ISEAS (Singapore)', url: rss('https://news.google.com/rss/search?q=site:iseas.edu.sg+technology+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'ORF Tech (India)', url: rss('https://news.google.com/rss/search?q=(India+tech+policy+OR+ORF+technology+OR+"Observer+Research+Foundation"+tech)+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'RIETI (Japan)', url: rss('https://news.google.com/rss/search?q=site:rieti.go.jp+technology+when:30d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Asia Pacific Tech', url: rss('https://news.google.com/rss/search?q=("Asia+Pacific"+tech+policy+OR+"Lowy+Institute"+technology)+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // China Research (External Views)
    { name: 'China Tech Analysis', url: rss('https://news.google.com/rss/search?q=("China+tech+strategy"+OR+"Chinese+AI"+OR+"China+semiconductor")+analysis+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'DigiChina', url: rss('https://news.google.com/rss/search?q=site:digichina.stanford.edu+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
  finance: [
    { name: 'CNBC Tech', url: rss('https://www.cnbc.com/id/19854910/device/rss/rss.html') },
    { name: 'MarketWatch Tech', url: rss('https://news.google.com/rss/search?q=site:marketwatch.com+technology+markets+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Yahoo Finance', url: rss('https://finance.yahoo.com/rss/topstories') },
    { name: 'Seeking Alpha Tech', url: rss('https://seekingalpha.com/market_currents.xml') },
  ],
  hardware: [
    { name: "Tom's Hardware", url: rss('https://www.tomshardware.com/feeds/all') },
    { name: 'SemiAnalysis', url: rss('https://news.google.com/rss/search?q=site:semianalysis.com+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Semiconductor News', url: rss('https://news.google.com/rss/search?q=semiconductor+OR+chip+OR+TSMC+OR+NVIDIA+OR+Intel+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  cloud: [
    { name: 'InfoQ', url: rss('https://feed.infoq.com/') },
    { name: 'The New Stack', url: rss('https://thenewstack.io/feed/') },
    { name: 'DevOps.com', url: rss('https://devops.com/feed/') },
  ],
  dev: [
    { name: 'Dev.to', url: rss('https://dev.to/feed') },
    { name: 'Lobsters', url: rss('https://lobste.rs/rss') },
    { name: 'Changelog', url: rss('https://changelog.com/feed') },
  ],
  layoffs: [
    { name: 'Layoffs.fyi', url: rss('https://news.google.com/rss/search?q=tech+layoffs+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TechCrunch Layoffs', url: rss('https://techcrunch.com/tag/layoffs/feed/') },
  ],
  unicorns: [
    { name: 'Unicorn News', url: rss('https://news.google.com/rss/search?q=("unicorn+startup"+OR+"unicorn+valuation"+OR+"$1+billion+valuation")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'CB Insights Unicorn', url: rss('https://news.google.com/rss/search?q=site:cbinsights.com+unicorn+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Decacorn News', url: rss('https://news.google.com/rss/search?q=("decacorn"+OR+"$10+billion+valuation"+OR+"$10B+valuation")+startup+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'New Unicorns', url: rss('https://news.google.com/rss/search?q=("becomes+unicorn"+OR+"joins+unicorn"+OR+"reaches+unicorn"+OR+"achieved+unicorn")+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
  accelerators: [
    { name: 'Techstars News', url: rss('https://news.google.com/rss/search?q=Techstars+accelerator+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: '500 Global News', url: rss('https://news.google.com/rss/search?q="500+Global"+OR+"500+Startups"+accelerator+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Demo Day News', url: rss('https://news.google.com/rss/search?q=("demo+day"+OR+"YC+batch"+OR+"accelerator+batch")+startup+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startup School', url: rss('https://news.google.com/rss/search?q="Startup+School"+OR+"YC+Startup+School"+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
  podcasts: [
    // Tech Podcast Episodes (via Google News - podcast hosts block RSS proxies)
    { name: 'Acquired Episodes', url: rss('https://news.google.com/rss/search?q="Acquired+podcast"+episode+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'All-In Podcast', url: rss('https://news.google.com/rss/search?q="All-In+podcast"+(Chamath+OR+Sacks+OR+Friedberg)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'a16z Insights', url: rss('https://news.google.com/rss/search?q=("a16z"+OR+"Andreessen+Horowitz")+podcast+OR+interview+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'TWIST Episodes', url: rss('https://news.google.com/rss/search?q="This+Week+in+Startups"+Jason+Calacanis+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: '20VC Episodes', url: rss('https://news.google.com/rss/search?q="20+Minute+VC"+Harry+Stebbings+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Lex Fridman Tech', url: rss('https://news.google.com/rss/search?q=("Lex+Fridman"+interview)+(AI+OR+tech+OR+startup+OR+CEO)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    // Tech Media Shows
    { name: 'Verge Shows', url: rss('https://news.google.com/rss/search?q=("Vergecast"+OR+"Decoder+podcast"+Verge)+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Hard Fork (NYT)', url: rss('https://news.google.com/rss/search?q="Hard+Fork"+podcast+NYT+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Pivot Podcast', url: rss('https://news.google.com/rss/search?q="Pivot+podcast"+(Kara+Swisher+OR+Scott+Galloway)+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // Newsletters
    { name: 'Tech Newsletters', url: rss('https://news.google.com/rss/search?q=("Benedict+Evans"+OR+"Pragmatic+Engineer"+OR+Stratechery)+tech+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // AI Podcasts & Shows
    { name: 'AI Podcasts', url: rss('https://news.google.com/rss/search?q=("AI+podcast"+OR+"artificial+intelligence+podcast")+episode+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'AI Interviews', url: rss('https://news.google.com/rss/search?q=(NVIDIA+OR+OpenAI+OR+Anthropic+OR+DeepMind)+interview+OR+podcast+when:14d&hl=en-US&gl=US&ceid=US:en') },
    // Startup Shows
    { name: 'How I Built This', url: rss('https://news.google.com/rss/search?q="How+I+Built+This"+Guy+Raz+when:14d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Startup Podcasts', url: rss('https://news.google.com/rss/search?q=("Masters+of+Scale"+OR+"The+Pitch+podcast"+OR+"startup+podcast")+episode+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
};

// Finance/Trading variant feeds (all free RSS / Google News proxies)
const FINANCE_FEEDS: Record<string, Feed[]> = {
  markets: [
    { name: 'CNBC', url: rss('https://www.cnbc.com/id/100003114/device/rss/rss.html') },
    // Direct MarketWatch RSS returns frequent 403s from cloud IPs; use Google News fallback.
    { name: 'MarketWatch', url: rss('https://news.google.com/rss/search?q=site:marketwatch.com+markets+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Yahoo Finance', url: rss('https://finance.yahoo.com/rss/topstories') },
    { name: 'Seeking Alpha', url: rss('https://seekingalpha.com/market_currents.xml') },
    { name: 'Reuters Markets', url: rss('https://news.google.com/rss/search?q=site:reuters.com+markets+stocks+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Bloomberg Markets', url: rss('https://news.google.com/rss/search?q=site:bloomberg.com+markets+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Investing.com News', url: rss('https://news.google.com/rss/search?q=site:investing.com+markets+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],
  forex: [
    { name: 'Forex News', url: rss('https://news.google.com/rss/search?q=("forex"+OR+"currency"+OR+"FX+market")+trading+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Dollar Watch', url: rss('https://news.google.com/rss/search?q=("dollar+index"+OR+DXY+OR+"US+dollar"+OR+"euro+dollar")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Central Bank Rates', url: rss('https://news.google.com/rss/search?q=("central+bank"+OR+"interest+rate"+OR+"rate+decision"+OR+"monetary+policy")+when:2d&hl=en-US&gl=US&ceid=US:en') },
  ],
  bonds: [
    { name: 'Bond Market', url: rss('https://news.google.com/rss/search?q=("bond+market"+OR+"treasury+yields"+OR+"bond+yields"+OR+"fixed+income")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Treasury Watch', url: rss('https://news.google.com/rss/search?q=("US+Treasury"+OR+"Treasury+auction"+OR+"10-year+yield"+OR+"2-year+yield")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Corporate Bonds', url: rss('https://news.google.com/rss/search?q=("corporate+bond"+OR+"high+yield"+OR+"investment+grade"+OR+"credit+spread")+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  commodities: [
    { name: 'Oil & Gas', url: rss('https://news.google.com/rss/search?q=(oil+price+OR+OPEC+OR+"natural+gas"+OR+"crude+oil"+OR+WTI+OR+Brent)+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Gold & Metals', url: rss('https://news.google.com/rss/search?q=(gold+price+OR+silver+price+OR+copper+OR+platinum+OR+"precious+metals")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Agriculture', url: rss('https://news.google.com/rss/search?q=(wheat+OR+corn+OR+soybeans+OR+coffee+OR+sugar)+price+OR+commodity+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Commodity Trading', url: rss('https://news.google.com/rss/search?q=("commodity+trading"+OR+"futures+market"+OR+CME+OR+NYMEX+OR+COMEX)+when:2d&hl=en-US&gl=US&ceid=US:en') },
  ],
  crypto: [
    { name: 'CoinDesk', url: rss('https://www.coindesk.com/arc/outboundfeeds/rss/') },
    { name: 'Cointelegraph', url: rss('https://cointelegraph.com/rss') },
    { name: 'The Block', url: rss('https://news.google.com/rss/search?q=site:theblock.co+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Crypto News', url: rss('https://news.google.com/rss/search?q=(bitcoin+OR+ethereum+OR+crypto+OR+"digital+assets")+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'DeFi News', url: rss('https://news.google.com/rss/search?q=(DeFi+OR+"decentralized+finance"+OR+DEX+OR+"yield+farming")+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  centralbanks: [
    { name: 'Federal Reserve', url: rss('https://www.federalreserve.gov/feeds/press_all.xml') },
    { name: 'ECB Watch', url: rss('https://news.google.com/rss/search?q=("European+Central+Bank"+OR+ECB+OR+Lagarde)+monetary+policy+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'BoJ Watch', url: rss('https://news.google.com/rss/search?q=("Bank+of+Japan"+OR+BoJ)+monetary+policy+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'BoE Watch', url: rss('https://news.google.com/rss/search?q=("Bank+of+England"+OR+BoE)+monetary+policy+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'PBoC Watch', url: rss('https://news.google.com/rss/search?q=("People%27s+Bank+of+China"+OR+PBoC+OR+PBOC)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Global Central Banks', url: rss('https://news.google.com/rss/search?q=("rate+hike"+OR+"rate+cut"+OR+"interest+rate+decision")+central+bank+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  economic: [
    { name: 'Economic Data', url: rss('https://news.google.com/rss/search?q=(CPI+OR+inflation+OR+GDP+OR+"jobs+report"+OR+"nonfarm+payrolls"+OR+PMI)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Trade & Tariffs', url: rss('https://news.google.com/rss/search?q=(tariff+OR+"trade+war"+OR+"trade+deficit"+OR+sanctions)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Housing Market', url: rss('https://news.google.com/rss/search?q=("housing+market"+OR+"home+prices"+OR+"mortgage+rates"+OR+REIT)+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  ipo: [
    { name: 'IPO News', url: rss('https://news.google.com/rss/search?q=(IPO+OR+"initial+public+offering"+OR+SPAC+OR+"direct+listing")+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Earnings Reports', url: rss('https://news.google.com/rss/search?q=("earnings+report"+OR+"quarterly+earnings"+OR+"revenue+beat"+OR+"earnings+miss")+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'M&A News', url: rss('https://news.google.com/rss/search?q=("merger"+OR+"acquisition"+OR+"takeover+bid"+OR+"buyout")+billion+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  derivatives: [
    { name: 'Options Market', url: rss('https://news.google.com/rss/search?q=("options+market"+OR+"options+trading"+OR+"put+call+ratio"+OR+VIX)+when:2d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Futures Trading', url: rss('https://news.google.com/rss/search?q=("futures+trading"+OR+"S%26P+500+futures"+OR+"Nasdaq+futures")+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],
  fintech: [
    { name: 'Fintech News', url: rss('https://news.google.com/rss/search?q=(fintech+OR+"payment+technology"+OR+"neobank"+OR+"digital+banking")+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Trading Tech', url: rss('https://news.google.com/rss/search?q=("algorithmic+trading"+OR+"trading+platform"+OR+"quantitative+finance")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Blockchain Finance', url: rss('https://news.google.com/rss/search?q=("blockchain+finance"+OR+"tokenization"+OR+"digital+securities"+OR+CBDC)+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  regulation: [
    { name: 'SEC', url: rss('https://www.sec.gov/news/pressreleases.rss') },
    { name: 'Financial Regulation', url: rss('https://news.google.com/rss/search?q=(SEC+OR+CFTC+OR+FINRA+OR+FCA)+regulation+OR+enforcement+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Banking Rules', url: rss('https://news.google.com/rss/search?q=(Basel+OR+"capital+requirements"+OR+"banking+regulation")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Crypto Regulation', url: rss('https://news.google.com/rss/search?q=(crypto+regulation+OR+"digital+asset"+regulation+OR+"stablecoin"+regulation)+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  institutional: [
    { name: 'Hedge Fund News', url: rss('https://news.google.com/rss/search?q=("hedge+fund"+OR+"Bridgewater"+OR+"Citadel"+OR+"Renaissance")+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Private Equity', url: rss('https://news.google.com/rss/search?q=("private+equity"+OR+Blackstone+OR+KKR+OR+Apollo+OR+Carlyle)+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Sovereign Wealth', url: rss('https://news.google.com/rss/search?q=("sovereign+wealth+fund"+OR+"pension+fund"+OR+"institutional+investor")+when:7d&hl=en-US&gl=US&ceid=US:en') },
  ],
  analysis: [
    { name: 'Market Outlook', url: rss('https://news.google.com/rss/search?q=("market+outlook"+OR+"stock+market+forecast"+OR+"bull+market"+OR+"bear+market")+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Risk & Volatility', url: rss('https://news.google.com/rss/search?q=(VIX+OR+"market+volatility"+OR+"risk+off"+OR+"market+correction")+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Bank Research', url: rss('https://news.google.com/rss/search?q=("Goldman+Sachs"+OR+"JPMorgan"+OR+"Morgan+Stanley")+forecast+OR+outlook+when:3d&hl=en-US&gl=US&ceid=US:en') },
  ],
  gccNews: [
    { name: 'Arabian Business', url: rss('https://news.google.com/rss/search?q=site:arabianbusiness.com+(Saudi+Arabia+OR+UAE+OR+GCC)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'The National', url: rss('https://news.google.com/rss/search?q=site:thenationalnews.com+(Abu+Dhabi+OR+UAE+OR+Saudi)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Arab News', url: rss('https://news.google.com/rss/search?q=site:arabnews.com+(Saudi+Arabia+OR+investment+OR+infrastructure)+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Gulf FDI', url: rss('https://news.google.com/rss/search?q=(PIF+OR+"DP+World"+OR+Mubadala+OR+ADNOC+OR+Masdar+OR+"ACWA+Power")+infrastructure+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Gulf Investments', url: rss('https://news.google.com/rss/search?q=("Saudi+Arabia"+OR+"UAE"+OR+"Abu+Dhabi")+investment+infrastructure+when:7d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Vision 2030', url: rss('https://news.google.com/rss/search?q="Vision+2030"+(project+OR+investment+OR+announced)+when:14d&hl=en-US&gl=US&ceid=US:en') },
  ],
};

// Variant-aware exports
export const FEEDS = SITE_VARIANT === 'tech' ? TECH_FEEDS : SITE_VARIANT === 'finance' ? FINANCE_FEEDS : FULL_FEEDS;

export const INTEL_SOURCES: Feed[] = [
  // Defense & Security (Tier 1)
  { name: 'Defense One', url: rss('https://www.defenseone.com/rss/all/'), type: 'defense' },
  {
    name: 'Breaking Defense',
    url: googleNewsRss('site:breakingdefense.com+when:7d'),
    fallbackUrls: [railwayRss('https://breakingdefense.com/feed/')],
    type: 'defense',
  },
  { name: 'The War Zone', url: rss('https://news.google.com/rss/search?q=site:thedrive.com+"war+zone"+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'defense' },
  { name: 'Defense News', url: rss('https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml'), type: 'defense' },
  { name: 'Janes', url: rss('https://news.google.com/rss/search?q=site:janes.com+when:3d&hl=en-US&gl=US&ceid=US:en'), type: 'defense' },
  { name: 'CSIS', url: rss('https://www.csis.org/analysis?type=analysis'), type: 'defense' },

  // International Relations (Tier 2)
  { name: 'Chatham House', url: rss('https://news.google.com/rss/search?q=site:chathamhouse.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'intl' },
  { name: 'ECFR', url: rss('https://news.google.com/rss/search?q=site:ecfr.eu+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'intl' },
  { name: 'Foreign Policy', url: rss('https://foreignpolicy.com/feed/'), type: 'intl' },
  { name: 'Foreign Affairs', url: rss('https://www.foreignaffairs.com/rss.xml'), type: 'intl' },
  { name: 'Atlantic Council', url: railwayRss('https://www.atlanticcouncil.org/feed/'), type: 'intl' },
  { name: 'Middle East Institute', url: rss('https://news.google.com/rss/search?q=site:mei.edu+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'intl' },

  // Think Tanks & Research (Tier 3)
  { name: 'RAND', url: rss('https://www.rand.org/rss/all.xml'), type: 'research' },
  { name: 'Brookings', url: rss('https://www.brookings.edu/feed/'), type: 'research' },
  { name: 'Carnegie', url: rss('https://carnegieendowment.org/rss/'), type: 'research' },
  { name: 'FAS', url: rss('https://fas.org/feed/'), type: 'research' },
  {
    name: 'NTI',
    url: googleNewsRss('site:nti.org+(nuclear+OR+missile+OR+proliferation)+when:7d'),
    fallbackUrls: [railwayRss('https://www.nti.org/rss/')],
    type: 'research',
  },
  { name: 'RUSI', url: rss('https://news.google.com/rss/search?q=site:rusi.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'research' },
  { name: 'Wilson Center', url: rss('https://news.google.com/rss/search?q=site:wilsoncenter.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'research' },
  { name: 'GMF', url: rss('https://news.google.com/rss/search?q=site:gmfus.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'research' },
  { name: 'Stimson Center', url: rss('https://www.stimson.org/feed/'), type: 'research' },
  { name: 'CNAS', url: rss('https://news.google.com/rss/search?q=site:cnas.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'research' },
  { name: 'Lowy Institute', url: rss('https://news.google.com/rss/search?q=site:lowyinstitute.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'research' },

  // Nuclear & Arms Control (Tier 2)
  { name: 'Arms Control Assn', url: rss('https://news.google.com/rss/search?q=site:armscontrol.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'nuclear' },
  { name: 'Bulletin of Atomic Scientists', url: rss('https://news.google.com/rss/search?q=site:thebulletin.org+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'nuclear' },

  // OSINT & Monitoring (Tier 2)
  { name: 'Bellingcat', url: rss('https://www.bellingcat.com/feed/'), type: 'osint' },
  { name: 'Krebs Security', url: rss('https://krebsonsecurity.com/feed/'), type: 'cyber' },

  // Economic & Food Security (Tier 2)
  { name: 'FAO News', url: rss('https://www.fao.org/feeds/fao-newsroom-rss'), type: 'economic' },
  {
    // Historical GIEWS RSS endpoint now redirects to HTML (/giews/en/) and breaks XML parsing.
    name: 'FAO GIEWS',
    url: googleNewsRss('(site:fao.org+giews+OR+"FAO+GIEWS"+OR+"Global+Information+and+Early+Warning+System")+when:14d'),
    fallbackUrls: [rss('https://www.fao.org/feeds/fao-newsroom-rss')],
    type: 'economic',
  },
  { name: 'EU ISS', url: rss('https://news.google.com/rss/search?q=site:iss.europa.eu+when:7d&hl=en-US&gl=US&ceid=US:en'), type: 'intl' },
];

// Keywords that trigger alert status - must be specific to avoid false positives
export const ALERT_KEYWORDS = [
  'war', 'invasion', 'military', 'nuclear', 'sanctions', 'missile',
  'airstrike', 'drone strike', 'troops deployed', 'armed conflict', 'bombing', 'casualties',
  'ceasefire', 'peace treaty', 'nato', 'coup', 'martial law',
  'assassination', 'terrorist', 'terror attack', 'cyber attack', 'hostage', 'evacuation order',
];

// Patterns that indicate non-alert content (lifestyle, entertainment, etc.)
export const ALERT_EXCLUSIONS = [
  'protein', 'couples', 'relationship', 'dating', 'diet', 'fitness',
  'recipe', 'cooking', 'shopping', 'fashion', 'celebrity', 'movie',
  'tv show', 'sports', 'game', 'concert', 'festival', 'wedding',
  'vacation', 'travel tips', 'life hack', 'self-care', 'wellness',
];
