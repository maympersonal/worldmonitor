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

export interface IntelTopic {
  id: string;
  name: string;
  query: string;
  icon: string;
  description: string;
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
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (military exercise OR troop deployment OR airstrike OR "naval exercise")) sourcelang:(eng OR spa)',
    icon: '⚔️',
    description: 'Military exercises, deployments, and operations',
  },
  {
    id: 'cyber',
    name: 'Cyber Threats',
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (cyberattack OR ransomware OR hacking OR "data breach" OR APT)) sourcelang:(eng OR spa)',
    icon: '🔓',
    description: 'Cyber attacks, ransomware, and digital threats',
  },
  {
    id: 'nuclear',
    name: 'Nuclear',
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (nuclear OR uranium enrichment OR IAEA OR "nuclear weapon" OR plutonium)) sourcelang:(eng OR spa)',
    icon: '☢️',
    description: 'Nuclear programs, IAEA inspections, proliferation',
  },
  {
    id: 'sanctions',
    name: 'Sanctions',
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (sanctions OR embargo OR "trade war" OR tariff OR "economic pressure")) sourcelang:(eng OR spa)',
    icon: '🚫',
    description: 'Economic sanctions and trade restrictions',
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (espionage OR spy OR intelligence agency OR covert OR surveillance)) sourcelang:(eng OR spa)',
    icon: '🕵️',
    description: 'Espionage, intelligence operations, surveillance',
  },
  {
    id: 'maritime',
    name: 'Maritime Security',
    query: '((Cuba OR Cuban OR Habana OR Havana) AND (naval blockade OR piracy OR "strait of hormuz" OR "south china sea" OR warship)) sourcelang:(eng OR spa)',
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
const articleCache = new Map<string, { articles: GdeltArticle[]; timestamp: number }>();
const inFlightRequests = new Map<string, Promise<GdeltArticle[]>>();
let globalCooldownUntil = 0;

function getRetryAfterSeconds(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5;
}

function buildGdeltDocUrl(query: string, maxrecords = 10, timespan = '24h'): string {
  return `/api/gdelt-doc?query=${encodeURIComponent(query)}&maxrecords=${maxrecords}&timespan=${timespan}`;
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
      const response = await fetchWithProxy(url);

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfterSeconds = getRetryAfterSeconds(response);
          globalCooldownUntil = Date.now() + Math.max(retryAfterSeconds * 1000, FAILURE_BACKOFF_MS);
          console.warn(`[GDELT-Intel] Rate limited for ${retryAfterSeconds}s`);
        } else {
          console.warn(`[GDELT-Intel] Failed to fetch: ${response.status}`);
        }
        return cached?.articles || [];
      }

      const data = await response.json();
      const articles: GdeltArticle[] = data.articles || [];

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

export async function fetchTopicIntelligence(topic: IntelTopic): Promise<TopicIntelligence> {
  const articles = await fetchGdeltArticles(topic.query, 10, '24h');
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
