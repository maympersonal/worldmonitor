import assert from 'node:assert/strict';
import test from 'node:test';

import handler, { normalizeFlightAwareFlight } from './flightaware-cuba.js';

test('normalizes active FlightAware arrivals and excludes landed or cancelled flights', () => {
  const destination = {
    icao: 'MUHA',
    iata: 'HAV',
    name: 'Jose Marti International',
    city: 'Havana',
  };
  const active = normalizeFlightAwareFlight({
    fa_flight_id: 'AAL123-1',
    ident_iata: 'AA123',
    actual_out: '2026-07-02T12:00:00Z',
    estimated_in: '2026-07-02T14:00:00Z',
    origin: {
      code_iata: 'MIA',
      code_icao: 'KMIA',
      name: 'Miami International',
      city: 'Miami',
    },
    destination: {
      code_iata: 'HAV',
      code_icao: 'MUHA',
      name: 'Jose Marti International',
      city: 'Havana',
    },
    last_position: {
      latitude: 24.4,
      longitude: -81.2,
      altitude: 210,
      groundspeed: 410,
    },
  }, destination, 'arrivals');

  assert.equal(active.status, 'en_route');
  assert.equal(active.ident, 'AA123');
  assert.deepEqual(active.lastPosition, {
    latitude: 24.4,
    longitude: -81.2,
    altitude: 210,
    groundspeed: 410,
  });
  assert.equal(normalizeFlightAwareFlight({ ...active, actual_in: '2026-07-02T14:05:00Z' }, destination, 'arrivals'), null);
  assert.equal(normalizeFlightAwareFlight({ ...active, cancelled: true }, destination, 'scheduled_arrivals'), null);
});

test('returns an explicit unconfigured response without exposing a secret', async () => {
  const previousKey = process.env.FLIGHTAWARE_AEROAPI_KEY;
  delete process.env.FLIGHTAWARE_AEROAPI_KEY;
  try {
    const response = await handler(new Request('http://localhost/api/flightaware-cuba'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.configured, false);
    assert.deepEqual(payload.flights, []);
  } finally {
    if (previousKey === undefined) delete process.env.FLIGHTAWARE_AEROAPI_KEY;
    else process.env.FLIGHTAWARE_AEROAPI_KEY = previousKey;
  }
});

test('loads, filters, and deduplicates Cuba inbound flights from AeroAPI', async () => {
  const previousKey = process.env.FLIGHTAWARE_AEROAPI_KEY;
  const previousFetch = globalThis.fetch;
  const requestedAirports = [];
  process.env.FLIGHTAWARE_AEROAPI_KEY = 'test-aeroapi-key';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const airport = url.pathname.split('/').at(-2);
    requestedAirports.push(airport);
    assert.equal(init.headers['x-apikey'], 'test-aeroapi-key');
    assert.equal(url.searchParams.get('max_pages'), '1');

    if (airport === 'MUHA') {
      return new Response(JSON.stringify({
        arrivals: [{
          fa_flight_id: 'AAL123-1',
          ident_iata: 'AA123',
          actual_out: '2026-07-02T12:00:00Z',
          estimated_in: '2026-07-02T14:00:00Z',
          origin: { code_iata: 'MIA', code_icao: 'KMIA', name: 'Miami International', city: 'Miami' },
          destination: { code_iata: 'HAV', code_icao: 'MUHA', name: 'Jose Marti International', city: 'Havana' },
          last_position: { latitude: 24.4, longitude: -81.2 },
        }, {
          fa_flight_id: 'LANDED-1',
          ident_iata: 'AA999',
          actual_in: '2026-07-02T11:00:00Z',
          origin: { code_iata: 'MIA', code_icao: 'KMIA' },
        }],
        scheduled_arrivals: [{
          fa_flight_id: 'CUP101-1',
          ident: 'CUP101',
          scheduled_out: '2026-07-02T18:00:00Z',
          scheduled_in: '2026-07-02T20:00:00Z',
          origin: { code_iata: 'MEX', code_icao: 'MMMX', name: 'Mexico City International', city: 'Mexico City' },
          destination: { code_iata: 'HAV', code_icao: 'MUHA', name: 'Jose Marti International', city: 'Havana' },
        }],
      }), { status: 200 });
    }

    return new Response(JSON.stringify({ arrivals: [], scheduled_arrivals: [] }), { status: 200 });
  };

  try {
    const response = await handler(new Request('http://localhost/api/flightaware-cuba'));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.flights.length, 2);
    assert.deepEqual(new Set(requestedAirports), new Set(['MUHA', 'MUVR', 'MUHG', 'MUCC', 'MUCU']));
    assert.deepEqual(payload.flights.map((flight) => flight.status).sort(), ['en_route', 'scheduled']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FLIGHTAWARE_AEROAPI_KEY;
    else process.env.FLIGHTAWARE_AEROAPI_KEY = previousKey;
  }
});
