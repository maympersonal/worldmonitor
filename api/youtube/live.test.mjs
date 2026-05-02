import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler, {
  __resetYouTubeiResolverForTests,
  __setYouTubeiResolverForTests,
  pickBestChannelVideo,
  resolveChannelVideo,
} from './live.js';

const originalFetch = globalThis.fetch;

function makeRequest(query = '') {
  return new Request(`https://worldmonitor.app/api/youtube/live${query}`);
}

test('rejects missing channel parameter', async () => {
  const response = await handler(makeRequest());
  assert.equal(response.status, 400);
});

test('normalizes plain handles to /live URLs', async () => {
  let requestedUrl = '';
  __setYouTubeiResolverForTests(async () => null);
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  try {
    const response = await handler(makeRequest('?channel=%40Bloomberg'));
    assert.equal(response.status, 200);
    assert.equal(requestedUrl, 'https://www.youtube.com/@Bloomberg/live');

    const body = await response.json();
    assert.equal(body.videoId, null);
    assert.equal(body.isLive, false);
  } finally {
    __resetYouTubeiResolverForTests();
    globalThis.fetch = originalFetch;
  }
});

test('preserves explicit @handle/live URLs', async () => {
  let requestedUrl = '';
  __setYouTubeiResolverForTests(async () => null);
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response('<html>{"videoId":"xLQtzck_Gks","isLive":true}</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  try {
    const response = await handler(
      makeRequest('?channel=https%3A%2F%2Fwww.youtube.com%2F%40CanalCaribeCuba%2Flive'),
    );
    assert.equal(response.status, 200);
    assert.equal(requestedUrl, 'https://www.youtube.com/@CanalCaribeCuba/live');

    const body = await response.json();
    assert.equal(body.videoId, 'xLQtzck_Gks');
    assert.equal(body.isLive, true);
  } finally {
    __resetYouTubeiResolverForTests();
    globalThis.fetch = originalFetch;
  }
});

test('supports channel/.../streams URLs', async () => {
  let requestedUrl = '';
  __setYouTubeiResolverForTests(async () => null);
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response('<html>{"videoId":"pwgmLCtAqKM","isLiveNow":true}</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  try {
    const response = await handler(
      makeRequest(
        '?channel=https%3A%2F%2Fwww.youtube.com%2Fchannel%2FUCjYAyKy8xfcXMA3_Gg3tOnw%2Fstreams',
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(
      requestedUrl,
      'https://www.youtube.com/channel/UCjYAyKy8xfcXMA3_Gg3tOnw/streams',
    );

    const body = await response.json();
    assert.equal(body.videoId, 'pwgmLCtAqKM');
    assert.equal(body.isLive, true);
  } finally {
    __resetYouTubeiResolverForTests();
    globalThis.fetch = originalFetch;
  }
});

test('pickBestChannelVideo prefers a live item over older streams', () => {
  const result = pickBestChannelVideo({
    current_tab: {
      content: {
        contents: [
          { content: { video_id: 'BnZ9OXSPKiE', is_live: false } },
          { content: { video_id: 'xLQtzck_Gks', is_live: true } },
        ],
      },
    },
  });

  assert.deepEqual(result, { videoId: 'xLQtzck_Gks', isLive: true });
});

test('resolveChannelVideo prefers youtubei results before HTML fallback', async () => {
  const result = await resolveChannelVideo('@CanalCaribeCuba/live', {
    youtubeiResolver: async () => ({ videoId: 'BnZ9OXSPKiE', isLive: false }),
    htmlResolver: async () => ({ videoId: 'xLQtzck_Gks', isLive: true, source: 'html' }),
  });

  assert.deepEqual(result, {
    videoId: 'BnZ9OXSPKiE',
    isLive: false,
    source: 'youtubei',
  });
});

test('resolveChannelVideo falls back to HTML resolver when youtubei returns no video', async () => {
  const result = await resolveChannelVideo('@CanalCaribeCuba/live', {
    youtubeiResolver: async () => null,
    htmlResolver: async () => ({ videoId: 'xLQtzck_Gks', isLive: true, source: 'html' }),
  });

  assert.deepEqual(result, {
    videoId: 'xLQtzck_Gks',
    isLive: true,
    source: 'html',
  });
});

test('returns the latest stream video even when the channel is not live', async () => {
  __setYouTubeiResolverForTests(async () => null);
  globalThis.fetch = async () => new Response('<html>{"videoId":"BnZ9OXSPKiE"}</html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  try {
    const response = await handler(
      makeRequest('?channel=https%3A%2F%2Fwww.youtube.com%2F%40CanalCaribeCuba%2Flive'),
    );
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.videoId, 'BnZ9OXSPKiE');
    assert.equal(body.isLive, false);
  } finally {
    __resetYouTubeiResolverForTests();
    globalThis.fetch = originalFetch;
  }
});

test('returns an offline payload when upstream fetch throws', async () => {
  __setYouTubeiResolverForTests(async () => null);
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    const response = await handler(makeRequest('?channel=%40Bloomberg'));
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.videoId, null);
    assert.equal(body.isLive, false);
    assert.equal(body.error, 'fetch failed');
  } finally {
    __resetYouTubeiResolverForTests();
    globalThis.fetch = originalFetch;
  }
});
