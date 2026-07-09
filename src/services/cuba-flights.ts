import type {
  FlightRoute,
  FlightRouteEndpoint,
  FlightRouteFlight,
  FlightRouteMarket,
  FlightRoutePosition,
} from '@/types';
import {
  CUBA_FLIGHT_AIRPORTS,
  CUBA_FLIGHT_ROUTES,
  MONITORED_AIRPORTS,
} from '@/config';
import { isFeatureEnabled } from './runtime-config';

const API_URL = '/api/flightaware-cuba';

interface FlightAwareAirport {
  code?: string;
  codeIata?: string;
  codeIcao?: string;
  name?: string;
  city?: string;
}

interface FlightAwarePosition {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  groundspeed?: number;
  heading?: number;
  timestamp?: string;
}

interface FlightAwareInboundFlight {
  id?: string;
  ident?: string;
  status?: 'en_route' | 'scheduled';
  aircraftType?: string;
  registration?: string;
  scheduledOut?: string;
  estimatedIn?: string;
  actualOut?: string;
  origin?: FlightAwareAirport;
  destination?: FlightAwareAirport;
  lastPosition?: FlightAwarePosition;
}

interface FlightAwareCubaPayload {
  success?: boolean;
  configured?: boolean;
  cached?: boolean;
  stale?: boolean;
  partial?: boolean;
  fetchedAt?: string;
  flights?: FlightAwareInboundFlight[];
  error?: string;
}

export interface CubaInboundFlightsResult {
  routes: FlightRoute[];
  airports: FlightRouteEndpoint[];
  source: 'flightaware' | 'static';
  configured: boolean;
  cached: boolean;
  stale: boolean;
  partial: boolean;
  flightCount: number;
  omittedFlightCount: number;
  fetchedAt?: string;
  reason?: string;
}

const knownAirports = [...CUBA_FLIGHT_AIRPORTS, ...MONITORED_AIRPORTS.map((airport) => ({
  iata: airport.iata,
  icao: airport.icao,
  name: airport.name,
  city: airport.city,
  country: airport.country,
  lat: airport.lat,
  lon: airport.lon,
}))];

const airportByCode = new Map<string, FlightRouteEndpoint>();
for (const airport of knownAirports) {
  airportByCode.set(airport.iata.toUpperCase(), airport);
  if (airport.icao) airportByCode.set(airport.icao.toUpperCase(), airport);
}

function airportCodes(airport?: FlightAwareAirport): string[] {
  return [airport?.codeIata, airport?.codeIcao, airport?.code]
    .filter((code): code is string => typeof code === 'string' && code.trim().length > 0)
    .map((code) => code.trim().toUpperCase());
}

function findKnownAirport(airport?: FlightAwareAirport): FlightRouteEndpoint | null {
  for (const code of airportCodes(airport)) {
    const known = airportByCode.get(code);
    if (known) return known;
  }
  return null;
}

function validPosition(position?: FlightAwarePosition): FlightRoutePosition | null {
  if (
    !position
    || !Number.isFinite(position.latitude)
    || !Number.isFinite(position.longitude)
  ) {
    return null;
  }

  return {
    lat: position.latitude!,
    lon: position.longitude!,
    ...(Number.isFinite(position.altitude) ? { altitude: position.altitude } : {}),
    ...(Number.isFinite(position.groundspeed) ? { groundspeed: position.groundspeed } : {}),
    ...(Number.isFinite(position.heading) ? { heading: position.heading } : {}),
    ...(position.timestamp ? { timestamp: position.timestamp } : {}),
  };
}

function fallbackEndpoint(
  airport: FlightAwareAirport | undefined,
  position: FlightRoutePosition
): FlightRouteEndpoint {
  const codes = airportCodes(airport);
  const iata = airport?.codeIata?.toUpperCase() || codes[0] || 'UNK';
  return {
    iata,
    ...(airport?.codeIcao ? { icao: airport.codeIcao.toUpperCase() } : {}),
    name: airport?.name || iata,
    city: airport?.city || iata,
    country: 'Unknown',
    lat: position.lat,
    lon: position.lon,
  };
}

function inferMarket(origin: FlightRouteEndpoint): FlightRouteMarket {
  const country = origin.country.toLowerCase();
  if (country === 'usa' || country.includes('united states')) return 'us';
  if (country.includes('canada')) return 'canada';
  if (
    country.includes('spain')
    || country.includes('france')
    || country.includes('germany')
    || country.includes('russia')
    || country.includes('uk')
    || country.includes('italy')
  ) return 'europe';
  if (
    country.includes('dominican')
    || country.includes('bahamas')
    || country.includes('caribbean')
  ) return 'caribbean';
  if (country !== 'unknown') return 'latin_america';

  const icao = origin.icao?.toUpperCase() || '';
  if (icao.startsWith('K')) return 'us';
  if (icao.startsWith('C')) return 'canada';
  if (/^[ELU]/.test(icao)) return 'europe';
  if (icao.startsWith('T')) return 'caribbean';
  if (/^[MS]/.test(icao)) return 'latin_america';
  return 'other';
}

function toFlightDetail(flight: FlightAwareInboundFlight, index: number): FlightRouteFlight {
  return {
    id: flight.id || `${flight.ident || 'flight'}-${index}`,
    ident: flight.ident || 'Unknown flight',
    status: flight.status === 'en_route' ? 'en_route' : 'scheduled',
    ...(flight.aircraftType ? { aircraftType: flight.aircraftType } : {}),
    ...(flight.registration ? { registration: flight.registration } : {}),
    ...(flight.scheduledOut ? { scheduledOut: flight.scheduledOut } : {}),
    ...(flight.estimatedIn ? { estimatedIn: flight.estimatedIn } : {}),
    ...(flight.actualOut ? { actualOut: flight.actualOut } : {}),
  };
}

function routePriority(flights: FlightRouteFlight[]): 1 | 2 | 3 {
  if (flights.some((flight) => flight.status === 'en_route')) return 1;
  const nextArrival = flights
    .map((flight) => Date.parse(flight.estimatedIn || ''))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (!nextArrival) return 3;
  const hoursUntilArrival = (nextArrival - Date.now()) / (60 * 60 * 1000);
  return hoursUntilArrival <= 6 ? 1 : hoursUntilArrival <= 12 ? 2 : 3;
}

export function normalizeFlightAwareCubaRoutes(
  flights: FlightAwareInboundFlight[],
  fetchedAt?: string
): { routes: FlightRoute[]; airports: FlightRouteEndpoint[]; omittedFlightCount: number } {
  const groups = new Map<string, {
    origin: FlightRouteEndpoint;
    destination: FlightRouteEndpoint;
    position: FlightRoutePosition | null;
    flights: FlightRouteFlight[];
  }>();
  let omittedFlightCount = 0;

  flights.forEach((flight, index) => {
    const destination = findKnownAirport(flight.destination);
    const position = validPosition(flight.lastPosition);
    const knownOrigin = findKnownAirport(flight.origin);
    const origin = knownOrigin || (position ? fallbackEndpoint(flight.origin, position) : null);
    if (!origin || !destination || destination.country !== 'Cuba') {
      omittedFlightCount += 1;
      return;
    }

    const originCode = airportCodes(flight.origin)[0] || origin.iata;
    const destinationCode = airportCodes(flight.destination)[0] || destination.iata;
    const groupKey = `${originCode}-${destinationCode}`;
    const group = groups.get(groupKey) || {
      origin,
      destination,
      position: null,
      flights: [],
    };
    group.flights.push(toFlightDetail(flight, index));
    if (!group.position && flight.status === 'en_route' && position) {
      group.position = position;
    }
    groups.set(groupKey, group);
  });

  const routes = Array.from(groups.entries()).map(([key, group]): FlightRoute => {
    const enRouteCount = group.flights.filter((flight) => flight.status === 'en_route').length;
    const count = group.flights.length;
    const summary = enRouteCount > 0
      ? `${enRouteCount} en route · ${count} total`
      : `${count} scheduled`;
    return {
      id: `flightaware-${key.toLowerCase()}`,
      origin: group.origin,
      destination: group.destination,
      market: inferMarket(group.origin),
      priority: routePriority(group.flights),
      note: `${summary} · FlightAware AeroAPI`,
      source: 'flightaware',
      flights: group.flights,
      flightCount: count,
      ...(group.position ? { currentPosition: group.position } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
    };
  }).sort((a, b) => a.priority - b.priority || (b.flightCount || 0) - (a.flightCount || 0));

  const airports = Array.from(new Map(
    routes.flatMap((route) => [
      [route.destination.iata, route.destination] as const,
      ...(findKnownAirport({ codeIata: route.origin.iata })
        ? [[route.origin.iata, route.origin] as const]
        : []),
    ])
  ).values());

  return { routes, airports, omittedFlightCount };
}

function staticFallback(reason: string, configured = false): CubaInboundFlightsResult {
  return {
    routes: CUBA_FLIGHT_ROUTES,
    airports: CUBA_FLIGHT_AIRPORTS,
    source: 'static',
    configured,
    cached: false,
    stale: false,
    partial: false,
    flightCount: 0,
    omittedFlightCount: 0,
    reason,
  };
}

export async function fetchCubaInboundFlights(): Promise<CubaInboundFlightsResult> {
  if (!isFeatureEnabled('flightAwareCubaFlights')) {
    return staticFallback('FlightAware Cuba flights are disabled');
  }
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    const payload = await response.json() as FlightAwareCubaPayload;
    if (!payload.configured) {
      return staticFallback('FLIGHTAWARE_AEROAPI_KEY is not configured');
    }
    if (!response.ok || !payload.success || !Array.isArray(payload.flights)) {
      return staticFallback(payload.error || `FlightAware proxy returned HTTP ${response.status}`, true);
    }

    const normalized = normalizeFlightAwareCubaRoutes(payload.flights, payload.fetchedAt);
    if (normalized.routes.length === 0) {
      return {
        routes: [],
        airports: CUBA_FLIGHT_AIRPORTS.filter((airport) => airport.country === 'Cuba'),
        source: 'flightaware',
        configured: true,
        cached: payload.cached === true,
        stale: payload.stale === true,
        partial: payload.partial === true || payload.flights.length > 0,
        flightCount: payload.flights.length,
        omittedFlightCount: normalized.omittedFlightCount,
        ...(payload.fetchedAt ? { fetchedAt: payload.fetchedAt } : {}),
      };
    }

    return {
      ...normalized,
      source: 'flightaware',
      configured: true,
      cached: payload.cached === true,
      stale: payload.stale === true,
      partial: payload.partial === true || normalized.omittedFlightCount > 0,
      flightCount: payload.flights.length,
      ...(payload.fetchedAt ? { fetchedAt: payload.fetchedAt } : {}),
    };
  } catch (error) {
    return staticFallback(error instanceof Error ? error.message : 'FlightAware request failed');
  }
}
