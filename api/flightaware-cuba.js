import { getCachedJson, setCachedJson } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const AEROAPI_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';
const CACHE_TTL_SECONDS = Math.max(
  300,
  Number(process.env.FLIGHTAWARE_CACHE_TTL_SECONDS || 1800) || 1800
);
const STALE_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_KEY = 'flightaware:cuba-inbound:v1';
const STALE_CACHE_KEY = 'flightaware:cuba-inbound:stale:v1';

const CUBA_AIRPORTS = [
  { icao: 'MUHA', iata: 'HAV', name: 'Jose Marti International', city: 'Havana' },
  { icao: 'MUVR', iata: 'VRA', name: 'Juan Gualberto Gomez', city: 'Varadero' },
  { icao: 'MUHG', iata: 'HOG', name: 'Frank Pais International', city: 'Holguin' },
  { icao: 'MUCC', iata: 'CCC', name: 'Jardines del Rey', city: 'Cayo Coco' },
  { icao: 'MUCU', iata: 'SCU', name: 'Antonio Maceo', city: 'Santiago de Cuba' },
];

function json(data, status, cors, cacheControl = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      ...cors,
    },
  });
}

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeAirport(airport, fallback) {
  const value = airport && typeof airport === 'object' ? airport : {};
  return {
    code: asString(value.code) || asString(value.code_iata) || asString(value.code_icao) || fallback.iata,
    codeIata: asString(value.code_iata) || fallback.iata,
    codeIcao: asString(value.code_icao) || fallback.icao,
    name: asString(value.name) || fallback.name,
    city: asString(value.city) || fallback.city,
  };
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object') return undefined;
  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  const optionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  };
  const altitude = optionalNumber(position.altitude);
  const groundspeed = optionalNumber(position.groundspeed);
  const heading = optionalNumber(position.heading);
  return {
    latitude,
    longitude,
    ...(altitude !== undefined ? { altitude } : {}),
    ...(groundspeed !== undefined ? { groundspeed } : {}),
    ...(heading !== undefined ? { heading } : {}),
    ...(asString(position.timestamp) ? { timestamp: asString(position.timestamp) } : {}),
  };
}

function flightTime(flight, keys) {
  for (const key of keys) {
    const value = asString(flight[key]);
    if (value) return value;
  }
  return undefined;
}

export function normalizeFlightAwareFlight(flight, destination, category) {
  if (!flight || typeof flight !== 'object' || flight.cancelled === true) return null;
  if (flight.actual_in || flight.actual_on) return null;

  const origin = normalizeAirport(flight.origin, {
    icao: '',
    iata: '',
    name: 'Unknown origin',
    city: 'Unknown origin',
  });
  if (!origin.code && !origin.codeIata && !origin.codeIcao) return null;

  const actualOut = flightTime(flight, ['actual_out', 'actual_off']);
  const status = actualOut || category === 'arrivals' ? 'en_route' : 'scheduled';
  const ident = asString(flight.ident_iata)
    || asString(flight.ident_icao)
    || asString(flight.ident)
    || 'Unknown flight';
  const id = asString(flight.fa_flight_id)
    || `${ident}-${flightTime(flight, ['scheduled_out', 'scheduled_off']) || destination.icao}`;
  const lastPosition = normalizePosition(flight.last_position);

  return {
    id,
    ident,
    status,
    ...(asString(flight.aircraft_type) ? { aircraftType: asString(flight.aircraft_type) } : {}),
    ...(asString(flight.registration) ? { registration: asString(flight.registration) } : {}),
    ...(flightTime(flight, ['scheduled_out', 'scheduled_off'])
      ? { scheduledOut: flightTime(flight, ['scheduled_out', 'scheduled_off']) }
      : {}),
    ...(flightTime(flight, ['estimated_in', 'estimated_on', 'scheduled_in', 'scheduled_on'])
      ? { estimatedIn: flightTime(flight, ['estimated_in', 'estimated_on', 'scheduled_in', 'scheduled_on']) }
      : {}),
    ...(actualOut ? { actualOut } : {}),
    origin,
    destination: normalizeAirport(flight.destination, destination),
    ...(lastPosition ? { lastPosition } : {}),
  };
}

async function fetchAirportFlights(apiKey, airport) {
  const url = new URL(`${AEROAPI_BASE_URL}/airports/${airport.icao}/flights`);
  url.searchParams.set('max_pages', '1');
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'x-apikey': apiKey,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 200);
    try {
      const payload = JSON.parse(text);
      message = payload.title || payload.detail || payload.error || message;
    } catch {
      // Preserve the short upstream response.
    }
    const error = new Error(`AeroAPI ${airport.icao} returned ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`AeroAPI ${airport.icao} returned invalid JSON`);
  }

  const candidates = [
    ...(Array.isArray(payload.arrivals) ? payload.arrivals.map((flight) => [flight, 'arrivals']) : []),
    ...(Array.isArray(payload.scheduled_arrivals)
      ? payload.scheduled_arrivals.map((flight) => [flight, 'scheduled_arrivals'])
      : []),
  ];
  return candidates
    .map(([flight, category]) => normalizeFlightAwareFlight(flight, airport, category))
    .filter(Boolean);
}

function deduplicateFlights(flights) {
  return Array.from(new Map(flights.map((flight) => [flight.id, flight])).values());
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (isDisallowedOrigin(req)) {
    return json({ success: false, error: 'Origin not allowed' }, 403, cors);
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'GET') {
    return json({ success: false, error: 'Method not allowed' }, 405, cors);
  }

  const apiKey = String(process.env.FLIGHTAWARE_AEROAPI_KEY || '').trim();
  if (!apiKey) {
    return json({
      success: false,
      configured: false,
      flights: [],
      error: 'FLIGHTAWARE_AEROAPI_KEY is not configured',
    }, 200, cors, 'public, max-age=60, s-maxage=60');
  }

  const cached = await getCachedJson(CACHE_KEY);
  if (cached) {
    return json(
      { ...cached, cached: true },
      200,
      cors,
      `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=300`
    );
  }

  const results = await Promise.allSettled(
    CUBA_AIRPORTS.map((airport) => fetchAirportFlights(apiKey, airport))
  );
  const flights = deduplicateFlights(results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  ));
  const errors = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{
        airport: CUBA_AIRPORTS[index].icao,
        status: Number(result.reason?.status) || 502,
        message: result.reason instanceof Error ? result.reason.message : 'AeroAPI request failed',
      }]
      : []
  );

  if (flights.length === 0 && errors.length === CUBA_AIRPORTS.length) {
    const stale = await getCachedJson(STALE_CACHE_KEY);
    if (stale) {
      return json(
        { ...stale, cached: true, stale: true, partial: true, errors },
        200,
        cors,
        'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
      );
    }
    const authFailure = errors.some((error) => error.status === 401 || error.status === 403);
    return json({
      success: false,
      configured: true,
      flights: [],
      errors,
      error: authFailure ? 'FlightAware rejected the AeroAPI key' : 'FlightAware AeroAPI is unavailable',
    }, authFailure ? 401 : 502, cors);
  }

  const payload = {
    success: true,
    configured: true,
    cached: false,
    stale: false,
    partial: errors.length > 0,
    fetchedAt: new Date().toISOString(),
    airports: CUBA_AIRPORTS.map(({ icao, iata }) => ({ icao, iata })),
    flights,
    ...(errors.length ? { errors } : {}),
  };
  await Promise.all([
    setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS),
    setCachedJson(STALE_CACHE_KEY, payload, STALE_CACHE_TTL_SECONDS),
  ]);

  return json(
    payload,
    200,
    cors,
    `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=300`
  );
}
