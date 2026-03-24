import type { Feed, NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';
import { classifyByKeyword, classifyWithAI } from './threat-classifier';
import { inferGeoHubsFromTitle } from './geo-hub-index';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { ingestHeadlines } from './trending-keywords';

// Per-feed circuit breaker: track failures and cooldowns
const FEED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after failure
const BLOCKED_FEED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours after upstream 403
const MAX_FAILURES = 2; // failures before cooldown
const MAX_CACHE_ENTRIES = 100; // Prevent unbounded growth
const feedFailures = new Map<string, { count: number; cooldownUntil: number; blocked?: boolean }>();
const feedCache = new Map<string, { items: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const AI_CLASSIFY_DEDUP_MS = 30 * 60 * 1000;
const AI_CLASSIFY_WINDOW_MS = 60 * 1000;
const AI_CLASSIFY_MAX_PER_WINDOW =
  SITE_VARIANT === 'finance' ? 40 : SITE_VARIANT === 'tech' ? 60 : 80;
const AI_CLASSIFY_MAX_PER_FEED =
  SITE_VARIANT === 'finance' ? 2 : SITE_VARIANT === 'tech' ? 2 : 3;
const aiRecentlyQueued = new Map<string, number>();
const aiDispatches: number[] = [];

function toSerializable(items: NewsItem[]): Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }> {
  return items.map(item => ({ ...item, pubDate: item.pubDate.toISOString() }));
}

function fromSerializable(items: Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>): NewsItem[] {
  return items.map(item => ({ ...item, pubDate: new Date(item.pubDate) }));
}

async function loadPersistentFeed(feedName: string): Promise<NewsItem[] | null> {
  const entry = await getPersistentCache<Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>>(`feed:${feedName}`);
  if (!entry?.data?.length) return null;
  return fromSerializable(entry.data);
}

// Clean up stale entries to prevent unbounded growth
function cleanupCaches(): void {
  const now = Date.now();

  for (const [key, value] of feedCache) {
    if (now - value.timestamp > CACHE_TTL * 2) {
      feedCache.delete(key);
    }
  }

  for (const [key, state] of feedFailures) {
    if (state.cooldownUntil > 0 && now > state.cooldownUntil) {
      feedFailures.delete(key);
    }
  }

  if (feedCache.size > MAX_CACHE_ENTRIES) {
    const entries = Array.from(feedCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) {
      feedCache.delete(key);
    }
  }
}

function isFeedOnCooldown(feedName: string): boolean {
  const state = feedFailures.get(feedName);
  if (!state) return false;
  if (Date.now() < state.cooldownUntil) return true;
  if (state.cooldownUntil > 0) feedFailures.delete(feedName);
  return false;
}

function recordFeedFailure(feedName: string, options: { status?: number; blocked?: boolean } = {}): void {
  const state = feedFailures.get(feedName) || { count: 0, cooldownUntil: 0, blocked: false };
  const isBlocked = options.blocked || options.status === 403;

  if (isBlocked) {
    state.count = Math.max(state.count + 1, MAX_FAILURES);
    state.blocked = true;
    state.cooldownUntil = Date.now() + BLOCKED_FEED_COOLDOWN_MS;
    console.warn(`[RSS] ${feedName} on cooldown for 6 hours after upstream block`);
    feedFailures.set(feedName, state);
    return;
  }

  state.count++;
  if (state.count >= MAX_FAILURES) {
    state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    state.blocked = false;
    console.warn(`[RSS] ${feedName} on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedName, state);
}

function recordFeedSuccess(feedName: string): void {
  feedFailures.delete(feedName);
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number(error.status);
  return Number.isFinite(status) ? status : undefined;
}

function isBlockedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'blocked' in error && error.blocked);
}

function toAiKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function canQueueAiClassification(title: string): boolean {
  const now = Date.now();
  while (aiDispatches.length > 0 && now - aiDispatches[0]! > AI_CLASSIFY_WINDOW_MS) {
    aiDispatches.shift();
  }
  for (const [key, queuedAt] of aiRecentlyQueued) {
    if (now - queuedAt > AI_CLASSIFY_DEDUP_MS) {
      aiRecentlyQueued.delete(key);
    }
  }
  if (aiDispatches.length >= AI_CLASSIFY_MAX_PER_WINDOW) {
    return false;
  }

  const key = toAiKey(title);
  const lastQueued = aiRecentlyQueued.get(key);
  if (lastQueued && now - lastQueued < AI_CLASSIFY_DEDUP_MS) {
    return false;
  }

  aiDispatches.push(now);
  aiRecentlyQueued.set(key, now);
  return true;
}

function getFeedAttemptUrls(feed: Feed): string[] {
  return Array.from(new Set([feed.url, ...(feed.fallbackUrls || [])].filter(Boolean)));
}

function buildFeedHttpError(feedName: string, response: Response): Error {
  const error = new Error(`HTTP ${response.status}`);
  Object.assign(error, {
    status: response.status,
    blocked: response.status === 403 || response.headers.get('x-feed-state') === 'blocked',
    feedName,
  });
  return error;
}

function shouldTryFallback(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 403 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return isBlockedError(error);
}

export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  if (feedCache.size > MAX_CACHE_ENTRIES / 2) cleanupCaches();

  if (isFeedOnCooldown(feed.name)) {
    const cached = feedCache.get(feed.name);
    if (cached) return cached.items;
    return (await loadPersistentFeed(feed.name)) || [];
  }

  const cached = feedCache.get(feed.name);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.items;
  }

  try {
    const attemptUrls = getFeedAttemptUrls(feed);
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < attemptUrls.length; attemptIndex += 1) {
      const attemptUrl = attemptUrls[attemptIndex]!;
      const isFallback = attemptIndex > 0;

      try {
        const response = await fetchWithProxy(attemptUrl);
        if (!response.ok) {
          throw buildFeedHttpError(feed.name, response);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
          const parseFailure = new Error(`Parse error (${contentType || 'unknown content type'})`);
          Object.assign(parseFailure, {
            blocked: contentType.includes('html'),
          });
          throw parseFailure;
        }

        let items = doc.querySelectorAll('item');
        const isAtom = items.length === 0;
        if (isAtom) items = doc.querySelectorAll('entry');

        const parsed = Array.from(items)
          .slice(0, 5)
          .map((item) => {
            const title = item.querySelector('title')?.textContent || '';
            let link = '';
            if (isAtom) {
              const linkEl = item.querySelector('link[href]');
              link = linkEl?.getAttribute('href') || '';
            } else {
              link = item.querySelector('link')?.textContent || '';
            }

            const pubDateStr = isAtom
              ? (item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '')
              : (item.querySelector('pubDate')?.textContent || '');
            const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
            const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
            const threat = classifyByKeyword(title, SITE_VARIANT);
            const isAlert = threat.level === 'critical' || threat.level === 'high';
            const geoMatches = inferGeoHubsFromTitle(title);
            const topGeo = geoMatches[0];

            return {
              source: feed.name,
              title,
              link,
              pubDate,
              isAlert,
              threat,
              ...(topGeo && { lat: topGeo.hub.lat, lon: topGeo.hub.lon, locationName: topGeo.hub.name }),
            };
          });

        if (isFallback) {
          console.info(`[RSS] ${feed.name} recovered via fallback source`);
        }

        feedCache.set(feed.name, { items: parsed, timestamp: Date.now() });
        void setPersistentCache(`feed:${feed.name}`, toSerializable(parsed));
        recordFeedSuccess(feed.name);
        ingestHeadlines(parsed.map(item => ({
          title: item.title,
          pubDate: item.pubDate,
          source: item.source,
          link: item.link,
        })));

        const aiCandidates = parsed
          .filter(item => item.threat.source === 'keyword')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
          .slice(0, AI_CLASSIFY_MAX_PER_FEED);

        for (const item of aiCandidates) {
          if (!canQueueAiClassification(item.title)) continue;
          classifyWithAI(item.title, SITE_VARIANT).then((aiResult) => {
            if (aiResult && aiResult.confidence > item.threat.confidence) {
              item.threat = aiResult;
              item.isAlert = aiResult.level === 'critical' || aiResult.level === 'high';
            }
          }).catch(() => {});
        }

        return parsed;
      } catch (error) {
        lastError = error;

        if (attemptIndex < attemptUrls.length - 1 && shouldTryFallback(error)) {
          console.warn(`[RSS] ${feed.name} primary source failed, trying fallback ${attemptIndex + 1}/${attemptUrls.length - 1}`);
          continue;
        }

        if (error instanceof Error && error.message.startsWith('Parse error')) {
          console.warn(`Parse error for ${feed.name}`);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('RSS fetch failed');
  } catch (e) {
    console.error(`Failed to fetch ${feed.name}:`, e);
    recordFeedFailure(feed.name, {
      status: getErrorStatus(e),
      blocked: isBlockedError(e),
    });
    const persistent = await loadPersistentFeed(feed.name);
    return cached?.items || persistent || [];
  }
}

export async function fetchCategoryFeeds(
  feeds: Feed[],
  options: {
    batchSize?: number;
    onBatch?: (items: NewsItem[]) => void;
  } = {}
): Promise<NewsItem[]> {
  const topLimit = 20;
  const batchSize = options.batchSize ?? 5;
  const batches = chunkArray(feeds, batchSize);
  const topItems: NewsItem[] = [];
  let totalItems = 0;

  const ensureSortedDescending = () => [...topItems].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const insertTopItem = (item: NewsItem) => {
    totalItems += 1;
    if (topItems.length < topLimit) {
      topItems.push(item);
      if (topItems.length === topLimit) topItems.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
      return;
    }

    const itemTime = item.pubDate.getTime();
    if (itemTime <= topItems[0]!.pubDate.getTime()) return;

    topItems[0] = item;
    for (let i = 0; i < topItems.length - 1; i += 1) {
      if (topItems[i]!.pubDate.getTime() <= topItems[i + 1]!.pubDate.getTime()) break;
      [topItems[i], topItems[i + 1]] = [topItems[i + 1]!, topItems[i]!];
    }
  };

  for (const batch of batches) {
    const results = await Promise.all(batch.map(fetchFeed));
    results.flat().forEach(insertTopItem);
    options.onBatch?.(ensureSortedDescending());
  }

  if (totalItems > 0) {
    import('./data-freshness').then(({ dataFreshness }) => {
      dataFreshness.recordUpdate('rss', totalItems);
    });
  }

  return ensureSortedDescending();
}
