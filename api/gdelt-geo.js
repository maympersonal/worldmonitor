// GDELT Geo API proxy with security hardening
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
export const config = { runtime: 'edge' };

const ALLOWED_FORMATS = ['geojson', 'json', 'csv'];
const MAX_RECORDS = 500;
const MIN_RECORDS = 1;
const ALLOWED_TIMESPANS = ['1d', '7d', '14d', '30d', '60d', '90d'];
const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const fallbackCache = new Map();

function validateMaxRecords(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return 250;
  return Math.max(MIN_RECORDS, Math.min(MAX_RECORDS, num));
}

function validateFormat(val) {
  return ALLOWED_FORMATS.includes(val) ? val : 'geojson';
}

function validateTimespan(val) {
  return ALLOWED_TIMESPANS.includes(val) ? val : '7d';
}

function sanitizeQuery(val) {
  if (!val || typeof val !== 'string') return 'protest';
  return val.slice(0, 200).replace(/[<>\"']/g, '');
}

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

async function fetchWithTimeout(url, timeoutMs = 10000) {
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
      const response = await fetchWithTimeout(url);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 2) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('GDELT geo fetch failed');
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const url = new URL(req.url);
  const query = sanitizeQuery(url.searchParams.get('query'));
  const format = validateFormat(url.searchParams.get('format') || 'geojson');
  const maxrecords = validateMaxRecords(url.searchParams.get('maxrecords') || '250');
  const timespan = validateTimespan(url.searchParams.get('timespan') || '7d');
  const cacheKey = `gdelt-geo:${hashString(`${query}|${format}|${maxrecords}|${timespan}`)}`;

  const cached = await getCachedJson(cacheKey);
  if (cached && typeof cached.data === 'string') {
    recordCacheTelemetry('/api/gdelt-geo', 'REDIS-HIT');
    return new Response(cached.data, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType || (format === 'csv' ? 'text/csv' : 'application/json'),
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120',
        'X-Cache': 'REDIS-HIT',
      },
    });
  }

  const fallback = getFallback(cacheKey);
  if (fallback && typeof fallback.data === 'string') {
    recordCacheTelemetry('/api/gdelt-geo', 'MEMORY-HIT');
    return new Response(fallback.data, {
      status: 200,
      headers: {
        'Content-Type': fallback.contentType || (format === 'csv' ? 'text/csv' : 'application/json'),
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120',
        'X-Cache': 'MEMORY-HIT',
      },
    });
  }

  try {
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/geo/geo');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('format', format);
    gdeltUrl.searchParams.set('maxrecords', String(maxrecords));
    gdeltUrl.searchParams.set('timespan', timespan);

    const response = await fetchWithRetry(gdeltUrl.toString());

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Upstream service unavailable' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...cors,
        },
      });
    }

    const data = await response.text();
    const contentType = response.headers.get('content-type') || (format === 'csv' ? 'text/csv' : 'application/json');
    const result = {
      data,
      contentType,
      query,
      format,
      maxrecords,
      timespan,
      cached_at: new Date().toISOString(),
    };
    setFallback(cacheKey, result);
    void setCachedJson(cacheKey, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/gdelt-geo', 'MISS');

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...cors,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=120',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    const stale = getFallback(cacheKey);
    if (stale && typeof stale.data === 'string') {
      recordCacheTelemetry('/api/gdelt-geo', 'STALE');
      return new Response(stale.data, {
        status: 200,
        headers: {
          'Content-Type': stale.contentType || (format === 'csv' ? 'text/csv' : 'application/json'),
          ...cors,
          'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60',
          'X-Cache': 'STALE',
        },
      });
    }

    console.error('[GDELT] Fetch error:', toErrorMessage(error));
    recordCacheTelemetry('/api/gdelt-geo', 'ERROR');
    return new Response(JSON.stringify({ error: `Failed to fetch GDELT data: ${toErrorMessage(error)}` }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        ...cors,
      },
    });
  }
}
