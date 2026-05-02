import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler from './rss-proxy.js';

const originalFetch = globalThis.fetch;
const originalRelayUrl = process.env.WS_RELAY_URL;

function makeRequest(feedUrl) {
  return new Request(`https://worldmonitor.app/api/rss-proxy?url=${encodeURIComponent(feedUrl)}`);
}

test('recovers via relay when upstream fetch throws before a response exists', async () => {
  const feedUrl = 'https://www.themoscowtimes.com/rss/news';
  const relayBaseUrl = 'https://relay.example';
  const relayBody = '<rss><channel><title>Recovered</title></channel></rss>';

  process.env.WS_RELAY_URL = relayBaseUrl;
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === feedUrl) {
      throw new Error('socket hang up');
    }

    if (url === `${relayBaseUrl}/rss?url=${encodeURIComponent(feedUrl)}`) {
      return new Response(relayBody, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const response = await handler(makeRequest(feedUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-rss-upstream'), 'railway-relay');
    assert.equal(response.headers.get('x-feed-state'), 'relay-recovered-error');
    assert.equal(await response.text(), relayBody);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) {
      delete process.env.WS_RELAY_URL;
    } else {
      process.env.WS_RELAY_URL = originalRelayUrl;
    }
  }
});

test('serves a stale snapshot when a later upstream request throws and relay is unavailable', async () => {
  const feedUrl = 'https://www.theguardian.com/world/rss';
  const rssBody = '<rss><channel><title>Guardian</title></channel></rss>';

  delete process.env.WS_RELAY_URL;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === feedUrl) {
      return new Response(rssBody, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      });
    }
    throw new Error(`Unexpected URL during snapshot seed: ${url}`);
  };

  try {
    const seedResponse = await handler(makeRequest(feedUrl));
    assert.equal(seedResponse.status, 200);
    assert.equal(await seedResponse.text(), rssBody);

    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const staleResponse = await handler(makeRequest(feedUrl));
    assert.equal(staleResponse.status, 200);
    assert.equal(staleResponse.headers.get('x-cache'), 'SNAPSHOT-HIT');
    assert.equal(staleResponse.headers.get('x-feed-state'), 'stale-error');
    assert.equal(await staleResponse.text(), rssBody);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) {
      delete process.env.WS_RELAY_URL;
    } else {
      process.env.WS_RELAY_URL = originalRelayUrl;
    }
  }
});
