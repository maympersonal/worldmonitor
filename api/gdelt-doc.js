import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { getCachedJson, setCachedJson, hashString } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
export const config = { runtime: 'edge' };

const MAX_RECORDS = 20;
const DEFAULT_RECORDS = 10;
const CACHE_TTL_SECONDS = 10 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const RESPONSE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=120';
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const GDELT_TIMEOUT_MS = 10_000;

// ─── Rate limiting ────────────────────────────────────────────────────────────
// GDELT Doc public endpoint no tolera más de ~1 req/5s.
// rateLimitedUntil: se activa de forma REACTIVA cuando upstream devuelve 429.
// lastGdeltRequestTime: throttle PROACTIVO — impide disparar antes de que
//   hayan pasado GDELT_MIN_INTERVAL_MS desde la última request al upstream,
//   independientemente de si hubo 429 o no.
const GDELT_RATE_LIMIT_WINDOW_MS = 6_000;   // bloqueo tras recibir 429 upstream
const GDELT_MIN_INTERVAL_MS      = 5_000;   // ← NUEVO: intervalo mínimo entre requests al upstream
const GDELT_RATE_LIMIT_MESSAGE   = 'GDELT rate limited';

const fallbackCache = new Map();
let rateLimitedUntil     = 0;
let lastGdeltRequestTime = 0; // ← NUEVO: timestamp de la última request disparada

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createHttpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function getErrorStatus(error) {
  return typeof error?.status === 'number' ? error.status : null;
}

function isJsonContentType(contentType) {
  return contentType.toLowerCase().includes('json');
}

function getRetryAfterSeconds() {
  return Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
}

// ─── NUEVO: segundos que faltan para poder hacer otra request al upstream ─────
function getThrottleRetryAfterSeconds() {
  const remaining = lastGdeltRequestTime + GDELT_MIN_INTERVAL_MS - Date.now();
  return Math.max(1, Math.ceil(remaining / 1000));
}

function buildRateLimitPayload(retryAfterSeconds) {
  return {
    error: GDELT_RATE_LIMIT_MESSAGE,
    retryAfterSeconds,
    articles: [],
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function fetchJsonWithTimeout(url, timeoutMs = GDELT_TIMEOUT_MS) {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (didTimeout) {
      throw createHttpError(504, 'GDELT request timed out');
    }
    throw error;
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
      await sleep(250 * attempt);
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      if (status === 429 || status === 400 || status === 403 || status === 404) {
        throw error;
      }
      if (attempt === 2) throw error;
      await sleep(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('GDELT fetch failed');
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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

  // 1. Caché Redis
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

  // 2. Caché en memoria
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

  // 3. Bloqueo reactivo: upstream ya devolvió 429 recientemente
  if (Date.now() < rateLimitedUntil) {
    const retryAfterSeconds = getRetryAfterSeconds();
    recordCacheTelemetry('/api/gdelt-doc', 'RATE-LIMITED');
    return new Response(JSON.stringify(buildRateLimitPayload(retryAfterSeconds)), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        ...cors,
      },
    });
  }

  // ─── NUEVO: 4. Throttle proactivo ──────────────────────────────────────────
  // Si la última request al upstream fue hace menos de GDELT_MIN_INTERVAL_MS,
  // no disparamos otra aunque no haya caché — devolvemos 429 con Retry-After
  // para que el cliente espere en lugar de saturar el endpoint.
  if (lastGdeltRequestTime > 0 && Date.now() - lastGdeltRequestTime < GDELT_MIN_INTERVAL_MS) {
    const retryAfterSeconds = getThrottleRetryAfterSeconds();
    console.warn('[GDELT DOC] Throttle proactivo activado', {
      query,
      retryAfterSeconds,
      msSinceLastRequest: Date.now() - lastGdeltRequestTime,
    });
    recordCacheTelemetry('/api/gdelt-doc', 'THROTTLED');
    return new Response(
      JSON.stringify(buildRateLimitPayload(retryAfterSeconds)),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
          'X-Throttle-Reason': 'proactive', // útil para distinguirlo en logs de cliente
          ...cors,
        },
      }
    );
  }
  // ───────────────────────────────────────────────────────────────────────────

  try {
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('mode', 'artlist');
    gdeltUrl.searchParams.set('maxrecords', maxrecords.toString());
    gdeltUrl.searchParams.set('format', 'json');
    gdeltUrl.searchParams.set('sort', 'date');
    gdeltUrl.searchParams.set('timespan', timespan);

    // ─── NUEVO: registrar timestamp justo antes de disparar ─────────────────
    lastGdeltRequestTime = Date.now();
    // ────────────────────────────────────────────────────────────────────────

    const response = await fetchWithRetry(gdeltUrl.toString());

    if (response.status === 429) {
      rateLimitedUntil = Date.now() + GDELT_RATE_LIMIT_WINDOW_MS;
      const bodyText = await response.text();
      console.warn('[GDELT DOC] Upstream rate limited request', {
        query,
        retryAfterSeconds: GDELT_RATE_LIMIT_WINDOW_MS / 1000,
        bodyPreview: bodyText.slice(0, 200),
      });
      throw createHttpError(429, GDELT_RATE_LIMIT_MESSAGE, bodyText.slice(0, 500));
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GDELT DOC] Upstream request failed', {
        url: gdeltUrl.toString(),
        status: response.status,
        bodyPreview: errorText.slice(0, 500),
      });
      throw createHttpError(response.status, `GDELT returned ${response.status}`, errorText.slice(0, 500));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isJsonContentType(contentType)) {
      const bodyText = await response.text();
      console.error('[GDELT DOC] Unexpected upstream content type', {
        url: gdeltUrl.toString(),
        contentType,
        bodyPreview: bodyText.slice(0, 500),
      });
      throw createHttpError(502, `Unexpected GDELT content-type: ${contentType || 'unknown'}`, bodyText.slice(0, 500));
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

    const errorStatus = getErrorStatus(error);
    if (errorStatus === 429) {
      const retryAfterSeconds = getRetryAfterSeconds();
      recordCacheTelemetry('/api/gdelt-doc', 'RATE-LIMITED');
      return new Response(JSON.stringify(buildRateLimitPayload(retryAfterSeconds)), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
          ...cors,
        },
      });
    }

    recordCacheTelemetry('/api/gdelt-doc', 'ERROR');
    return new Response(JSON.stringify({
      error: `Fetch failed: ${toErrorMessage(error)}`,
      upstreamStatus: errorStatus,
      articles: [],
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}