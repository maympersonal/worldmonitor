import { fetchWithProxy } from '@/utils';
import type { Hotspot } from '@/types';
import { t } from '@/services/i18n';

export interface GdeltArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  image?: string;
  language?: string;
  tone?: number;
}

interface GdeltDocResponse {
  articles?: GdeltArticle[];
  degraded?: boolean;
  reason?: string;
  upstreamStatus?: number | null;
}

export interface IntelTopic {
  id: string;
  name: string;
  queries: string[];
  icon: string;
  description: string;
}

const CUBA_CITY_FILTER = '(Habana OR Havana)';
const QUERY_RESULTS_PER_LANGUAGE = 6;
const TOPIC_RESULTS_LIMIT = 10;

function buildBilingualQueries(englishTerms: string[], spanishTerms: string[]): string[] {
  return [
    `${CUBA_CITY_FILTER} (${englishTerms.join(' OR ')}) sourcelang:english`,
    `${CUBA_CITY_FILTER} (${spanishTerms.join(' OR ')}) sourcelang:spanish`,
  ];
}

export interface TopicIntelligence {
  topic: IntelTopic;
  articles: GdeltArticle[];
  fetchedAt: Date;
}

export const INTEL_TOPICS: IntelTopic[] = [
  {
    id: 'military',
    name: 'Military Activity',
    queries: buildBilingualQueries(
      ['"military exercise"', '"troop deployment"', 'airstrike', '"naval exercise"'],
      ['"ejercicio militar"', '"despliegue de tropas"', 'bombardeo', '"ejercicio naval"'],
    ),
    icon: '⚔️',
    description: 'Military exercises, deployments, and operations',
  },
  {
    id: 'cyber',
    name: 'Cyber Threats',
    queries: buildBilingualQueries(
      ['cyberattack', 'ransomware', 'hacking', '"data breach"', 'APT'],
      ['ciberataque', 'ransomware', 'hackeo', '"brecha de datos"', 'APT'],
    ),
    icon: '🔓',
    description: 'Cyber attacks, ransomware, and digital threats',
  },
  {
    id: 'nuclear',
    name: 'Nuclear',
    queries: buildBilingualQueries(
      ['nuclear', '"uranium enrichment"', 'IAEA', '"nuclear weapon"', 'plutonium'],
      ['nuclear', '"enriquecimiento de uranio"', 'OIEA', '"arma nuclear"', 'plutonio'],
    ),
    icon: '☢️',
    description: 'Nuclear programs, IAEA inspections, proliferation',
  },
  {
    id: 'sanctions',
    name: 'Sanctions',
    queries: buildBilingualQueries(
      ['sanctions', 'embargo', '"trade war"', 'tariff', '"economic pressure"'],
      ['sanciones', 'embargo', '"guerra comercial"', 'arancel', '"presion economica"'],
    ),
    icon: '🚫',
    description: 'Economic sanctions and trade restrictions',
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    queries: buildBilingualQueries(
      ['espionage', 'spy', '"intelligence agency"', 'covert', 'surveillance'],
      ['espionaje', 'espia', '"agencia de inteligencia"', 'encubierto', 'vigilancia'],
    ),
    icon: '🕵️',
    description: 'Espionage, intelligence operations, surveillance',
  },
  {
    id: 'maritime',
    name: 'Maritime Security',
    queries: buildBilingualQueries(
      ['"naval blockade"', 'piracy', '"strait of hormuz"', '"south china sea"', 'warship'],
      ['"bloqueo naval"', 'pirateria', '"estrecho de ormuz"', '"mar de china meridional"', 'buque'],
    ),
    icon: '🚢',
    description: 'Naval operations, maritime chokepoints, sea lanes',
  },
];

export function getIntelTopics(): IntelTopic[] {
  return INTEL_TOPICS.map(topic => ({
    ...topic,
    name: t(`intel.topics.${topic.id}.name`),
    description: t(`intel.topics.${topic.id}.description`),
  }));
}

const CACHE_TTL = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 30 * 1000;
const GDELT_REQUEST_SPACING_MS = 5500;
const articleCache = new Map<string, { articles: GdeltArticle[]; timestamp: number }>();
const inFlightRequests = new Map<string, Promise<GdeltArticle[]>>();
let globalCooldownUntil = 0;
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestTimestamp = 0;

function getRetryAfterSeconds(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5;
}

function buildGdeltDocUrl(query: string, maxrecords = 10, timespan = '24h'): string {
  return `/api/gdelt-doc?query=${encodeURIComponent(query)}&maxrecords=${maxrecords}&timespan=${timespan}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleGdeltRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const waitMs = Math.max(0, (lastRequestTimestamp + GDELT_REQUEST_SPACING_MS) - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastRequestTimestamp = Date.now();
    return task();
  });

  // Keep queue alive even if one request fails.
  requestQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function fetchGdeltArticles(
  query: string,
  maxrecords = 10,
  timespan = '24h'
): Promise<GdeltArticle[]> {
  const cacheKey = `${query}:${maxrecords}:${timespan}`;
  const cached = articleCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.articles;
  }

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  if (Date.now() < globalCooldownUntil) {
    return cached?.articles || [];
  }

  const request = (async () => {
    try {
      const url = buildGdeltDocUrl(query, maxrecords, timespan);
      const response = await scheduleGdeltRequest(() => fetchWithProxy(url));

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          const retryAfterSeconds = getRetryAfterSeconds(response);
          globalCooldownUntil = Date.now() + Math.max(retryAfterSeconds * 1000, FAILURE_BACKOFF_MS);
          if (response.status === 429) {
            console.warn(`[GDELT-Intel] Rate limited for ${retryAfterSeconds}s`);
          } else {
            console.warn(`[GDELT-Intel] Upstream unavailable (${response.status}), backing off for ${retryAfterSeconds}s`);
          }
        } else {
          console.warn(`[GDELT-Intel] Failed to fetch: ${response.status}`);
        }
        return cached?.articles || [];
      }

      const data = await response.json() as GdeltDocResponse;
      const articles: GdeltArticle[] = data.articles || [];

      if (data.degraded) {
        globalCooldownUntil = Date.now() + FAILURE_BACKOFF_MS;
        console.warn(`[GDELT-Intel] Degraded response${data.reason ? `: ${data.reason}` : ''}`);
        return cached?.articles || articles;
      }

      globalCooldownUntil = 0;
      articleCache.set(cacheKey, { articles, timestamp: Date.now() });
      return articles;
    } catch (error) {
      console.error('[GDELT-Intel] Fetch error:', error);
      return cached?.articles || [];
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, request);
  return request;
}

export async function fetchHotspotContext(hotspot: Hotspot): Promise<GdeltArticle[]> {
  const query = hotspot.keywords.slice(0, 5).join(' OR ');
  return fetchGdeltArticles(query, 8, '48h');
}

function articleIdentity(article: GdeltArticle): string {
  return article.url || `${article.title}|${article.date}`;
}

function articleTimestamp(article: GdeltArticle): number {
  const time = article.date ? new Date(article.date).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function compareRankedArticles(
  a: GdeltArticle & { matchedQueries: number },
  b: GdeltArticle & { matchedQueries: number },
): number {
  if (b.matchedQueries !== a.matchedQueries) {
    return b.matchedQueries - a.matchedQueries;
  }

  const timeDelta = articleTimestamp(b) - articleTimestamp(a);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return a.title.localeCompare(b.title);
}

export async function fetchTopicIntelligence(topic: IntelTopic): Promise<TopicIntelligence> {
  const mergedArticles = new Map<string, GdeltArticle & { matchedQueries: number }>();

  for (const query of topic.queries) {
    const articles = await fetchGdeltArticles(query, QUERY_RESULTS_PER_LANGUAGE, '24h');

    for (const article of articles) {
      const key = articleIdentity(article);
      const existing = mergedArticles.get(key);

      if (existing) {
        existing.matchedQueries += 1;
        continue;
      }

      mergedArticles.set(key, { ...article, matchedQueries: 1 });
    }
  }

  const articles = Array.from(mergedArticles.values())
    .sort(compareRankedArticles)
    .slice(0, TOPIC_RESULTS_LIMIT)
    .map(({ matchedQueries: _matchedQueries, ...article }) => article);

  return {
    topic,
    articles,
    fetchedAt: new Date(),
  };
}

export async function fetchAllTopicIntelligence(): Promise<TopicIntelligence[]> {
  const results: TopicIntelligence[] = [];

  for (const topic of INTEL_TOPICS) {
    try {
      results.push(await fetchTopicIntelligence(topic));
    } catch {
      // Keep partial results when one topic fails or is rate-limited.
    }
  }

  return results;
}

export function formatArticleDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    // GDELT returns compact format: "20260111T093000Z"
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11);
    const min = dateStr.slice(11, 13);
    const sec = dateStr.slice(13, 15);
    const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
    if (isNaN(date.getTime())) return '';

    const now = Date.now();
    const diff = now - date.getTime();

    if (diff < 0) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return '';
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}
