import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler from './temporal-baseline.js';

function makeRequest(url, init = {}) {
  return new Request(url, init);
}

test('returns CORS headers for OPTIONS preflight', async () => {
  const response = await handler(makeRequest('https://worldmonitor.app/api/temporal-baseline', {
    method: 'OPTIONS',
    headers: { origin: 'https://tauri.localhost' },
  }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://tauri.localhost');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
});

test('includes CORS headers on GET responses', async () => {
  const response = await handler(makeRequest(
    'https://worldmonitor.app/api/temporal-baseline?type=news&region=global&count=12',
    { headers: { origin: 'https://tauri.localhost' } },
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://tauri.localhost');

  const body = await response.json();
  assert.equal(body.learning, true);
});

test('accepts text/plain POST bodies to avoid CORS preflight dependence', async () => {
  const response = await handler(makeRequest('https://worldmonitor.app/api/temporal-baseline', {
    method: 'POST',
    headers: {
      origin: 'https://tauri.localhost',
      'content-type': 'text/plain',
    },
    body: JSON.stringify({
      updates: [{ type: 'news', region: 'global', count: 25 }],
    }),
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://tauri.localhost');

  const body = await response.json();
  assert.equal(body.updated, 1);
});
