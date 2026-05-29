import type { Feed, Monitor, NewsItem } from '@/types';
import { fetchFeed } from '@/services/rss';
import { getMonitorGoogleNewsSearch, getMonitorRuleText } from '@/services/monitor-query';

const MONITOR_GOOGLE_NEWS_LIMIT = 20;

function rss(url: string): string {
  return `/api/rss-proxy?url=${encodeURIComponent(url)}`;
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildGoogleNewsRssUrl(query: string, hl: string, gl: string, ceid: string): string {
  const params = new URLSearchParams({
    q: query,
    hl,
    gl,
    ceid,
  });

  return rss(`https://news.google.com/rss/search?${params.toString()}`);
}

export function buildMonitorGoogleNewsFeed(monitor: Monitor): Feed | null {
  const rule = getMonitorRuleText(monitor);
  const search = getMonitorGoogleNewsSearch(rule);
  if (!search.query) return null;

  const fingerprint = hashText(`${search.query}|${search.hl}|${search.gl}|${search.ceid}`);

  return {
    name: `Monitor Google News ${monitor.id} ${fingerprint}`,
    url: buildGoogleNewsRssUrl(search.query, search.hl, search.gl, search.ceid),
    limit: MONITOR_GOOGLE_NEWS_LIMIT,
  };
}

export async function fetchMonitorGoogleNews(monitor: Monitor): Promise<NewsItem[]> {
  const feed = buildMonitorGoogleNewsFeed(monitor);
  if (!feed) return [];

  const items = await fetchFeed(feed);
  return items.map((item) =>
    item.source === feed.name ? { ...item, source: 'Google News' } : item
  );
}
