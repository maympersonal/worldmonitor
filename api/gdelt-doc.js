import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
export const config = { runtime: 'edge' };

const MAX_RECORDS = 20;
const DEFAULT_RECORDS = 10;
const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const RESPONSE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=120';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const fallbackCache = new Map();

function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
}

function getFallback(key) {
  const entry = fallbackCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    fallbackCache.delete(key);
    return null;
  }
  return entry.data;
}

function setFallback(key, data) {
  fallbackCache.set(key, { data, timestamp: Date.now() });
}

async function fetchJsonWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchJsonWithTimeout(url);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('GDELT fetch failed');
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed', articles: [] }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get('query');
  const maxrecords = Math.min(
    parseInt(url.searchParams.get('maxrecords') || DEFAULT_RECORDS, 10),
    MAX_RECORDS
  );
  const timespan = url.searchParams.get('timespan') || '72h';

  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ error: 'Query parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const cacheKey = `gdelt-doc:${hashString(`${query}|${maxrecords}|${timespan}`)}`;
  const cached = await getCachedJson(cacheKey);
  if (cached) {
    recordCacheTelemetry('/api/gdelt-doc', 'REDIS-HIT');
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'REDIS-HIT',
      },
    });
  }

  const fallback = getFallback(cacheKey);
  if (fallback) {
    recordCacheTelemetry('/api/gdelt-doc', 'MEMORY-HIT');
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'MEMORY-HIT',
      },
    });
  }

  try {
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('mode', 'artlist');
    gdeltUrl.searchParams.set('maxrecords', maxrecords.toString());
    gdeltUrl.searchParams.set('format', 'json');
    gdeltUrl.searchParams.set('sort', 'date');
    gdeltUrl.searchParams.set('timespan', timespan);

    const response = await fetchWithRetry(gdeltUrl.toString());

    if (!response.ok) {
      throw new Error(`GDELT returned ${response.status}`);
    }

    const data = await response.json();

    const articles = (data.articles || []).map(article => ({
      title: article.title,
      url: article.url,
      source: article.domain || article.source?.domain,
      date: article.seendate,
      image: article.socialimage,
      language: article.language,
      tone: article.tone,
    }));

    const result = { articles, query, cached_at: new Date().toISOString() };
    setFallback(cacheKey, result);
    void setCachedJson(cacheKey, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/gdelt-doc', 'MISS');

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    const stale = getFallback(cacheKey);
    if (stale) {
      recordCacheTelemetry('/api/gdelt-doc', 'STALE');
      return new Response(JSON.stringify(stale), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...cors,
          'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60',
          'X-Cache': 'STALE',
        },
      });
    }

    recordCacheTelemetry('/api/gdelt-doc', 'ERROR');
    return new Response(JSON.stringify({
      error: `Fetch failed: ${toErrorMessage(error)}`,
      articles: [],
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
