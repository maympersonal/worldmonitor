// UCDP (Uppsala Conflict Data Program) proxy
// Returns conflict classification per country with intensity levels
// No auth required - public API
export const config = { runtime: 'edge' };

import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { recordCacheTelemetry } from './_cache-telemetry.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

const CACHE_KEY = 'ucdp:country-conflicts:v2';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours (annual data)
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const RESPONSE_CACHE_CONTROL = 'public, max-age=3600';
const MAX_PAGES = 40;

// In-memory fallback when Redis is unavailable.
let fallbackCache = { data: null, timestamp: 0 };

function isValidResult(data) {
  return Boolean(
    data &&
    typeof data === 'object' &&
    Array.isArray(data.conflicts)
  );
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
}

function buildVersionCandidates() {
  const year = new Date().getFullYear() - 2000;
  return Array.from(new Set([
    `${year}.1`,
    `${year - 1}.1`,
    '25.1',
    '24.1',
  ]));
}

async function fetchConflictPage(version, page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      `https://ucdpapi.pcr.uu.se/api/ucdpprioconflict/${version}?pagesize=100&page=${page}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`UCDP API error (${version}, page ${page}): ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverConflictVersion() {
  const candidates = buildVersionCandidates();
  for (const version of candidates) {
    try {
      const page0 = await fetchConflictPage(version, 0);
      if (Array.isArray(page0?.Result)) {
        return { version, page0 };
      }
    } catch {
      // Try next version candidate.
    }
  }

  throw new Error('Unable to fetch UCDP conflict metadata from known API versions');
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const now = Date.now();
  const cached = await getCachedJson(CACHE_KEY);
  if (isValidResult(cached)) {
    recordCacheTelemetry('/api/ucdp', 'REDIS-HIT');
    return Response.json(cached, {
      status: 200,
      headers: {
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'REDIS-HIT',
      },
    });
  }

  if (isValidResult(fallbackCache.data) && now - fallbackCache.timestamp < CACHE_TTL_MS) {
    recordCacheTelemetry('/api/ucdp', 'MEMORY-HIT');
    return Response.json(fallbackCache.data, {
      status: 200,
      headers: {
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'MEMORY-HIT',
      },
    });
  }

  try {
    const { version, page0 } = await discoverConflictVersion();

    // Fetch all pages of conflicts
    let allConflicts = [];
    const totalPages = Math.max(1, Number(page0?.TotalPages) || 1);
    const pagesToFetch = Math.min(totalPages, MAX_PAGES);

    for (let page = 0; page < pagesToFetch; page += 1) {
      try {
        const rawData = page === 0 ? page0 : await fetchConflictPage(version, page);
        const conflicts = Array.isArray(rawData?.Result) ? rawData.Result : [];
        allConflicts = allConflicts.concat(conflicts);
      } catch (error) {
        if (allConflicts.length > 0) {
          console.warn(`[UCDP] Partial fetch after page ${page}:`, toErrorMessage(error));
          break;
        }
        throw error;
      }
    }

    // Fields are snake_case: conflict_id, location, side_a, side_b, year, intensity_level, type_of_conflict
    const countryConflicts = {};
    for (const c of allConflicts) {
      const name = c.location || '';
      const year = parseInt(c.year, 10) || 0;
      const intensity = parseInt(c.intensity_level, 10) || 0;

      const entry = {
        conflictId: parseInt(c.conflict_id, 10) || 0,
        conflictName: c.side_b || '',
        location: name,
        year,
        intensityLevel: intensity,
        typeOfConflict: parseInt(c.type_of_conflict, 10) || 0,
        startDate: c.start_date,
        startDate2: c.start_date2,
        sideA: c.side_a,
        sideB: c.side_b,
        region: c.region,
      };

      // Keep most recent / highest intensity per location
      if (!countryConflicts[name] || year > countryConflicts[name].year ||
          (year === countryConflicts[name].year && intensity > countryConflicts[name].intensityLevel)) {
        countryConflicts[name] = entry;
      }
    }

    const result = {
      success: true,
      count: Object.keys(countryConflicts).length,
      conflicts: Object.values(countryConflicts),
      version,
      cached_at: new Date().toISOString(),
    };

    fallbackCache = { data: result, timestamp: now };
    void setCachedJson(CACHE_KEY, result, CACHE_TTL_SECONDS);
    recordCacheTelemetry('/api/ucdp', 'MISS');

    return Response.json(result, {
      status: 200,
      headers: {
        ...cors,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    if (isValidResult(fallbackCache.data)) {
      recordCacheTelemetry('/api/ucdp', 'STALE');
      return Response.json(fallbackCache.data, {
        status: 200,
        headers: {
          ...cors,
          'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
          'X-Cache': 'STALE',
        },
      });
    }

    recordCacheTelemetry('/api/ucdp', 'ERROR');
    return Response.json({ error: `Fetch failed: ${toErrorMessage(error)}`, conflicts: [] }, {
      status: 500,
      headers: { ...cors },
    });
  }
}
