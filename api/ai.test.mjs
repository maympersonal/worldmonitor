import { strict as assert } from 'node:assert';
import test from 'node:test';

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'LOCALAI_API_URL',
  'LOCALAI_MODEL',
  'LOCALAI_API_KEY',
  'LOCALAI_REQUEST_TIMEOUT_MS',
  'HF_TOKEN',
  'HUGGINGFACE_API_KEY',
  'HUGGING_FACE_HUB_TOKEN',
  'DASHSCOPE_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function configureLocalAi(apiKey = '') {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.LOCALAI_API_URL = 'http://localai.test:8080/v1/chat/completions';
  process.env.LOCALAI_MODEL = 'gemma-3-4b-it';
  process.env.LOCALAI_API_KEY = apiKey;
}

async function loadHandler() {
  const module = await import(`./ai.js?localai-test=${Date.now()}-${Math.random()}`);
  return module.default;
}

function makeSummaryRequest(overrides = {}) {
  return new Request('http://localhost:3000/api/ai', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      task: 'summary',
      headlines: ['First test headline', 'Second test headline'],
      ...overrides,
    }),
  });
}

function makeClassifyBatchRequest(titles, overrides = {}) {
  return new Request('http://localhost:3000/api/ai', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      task: 'classify_batch',
      titles,
      variant: 'full',
      ...overrides,
    }),
  });
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ENV_KEYS) setEnv(key, ORIGINAL_ENV[key]);
});

test('skips LocalAI unless the request explicitly opts in', async () => {
  configureLocalAi();

  globalThis.fetch = async () => {
    throw new Error('LocalAI should not be called without opt-in');
  };

  const handler = await loadHandler();
  const response = await handler(makeSummaryRequest());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.fallback, true);
  assert.equal(result.skipped, true);
});

test('localAiOnly does not fall through to cloud providers', async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.HF_TOKEN = 'cloud-token-that-must-not-be-used';

  globalThis.fetch = async () => {
    throw new Error('Cloud provider should not be called for localAiOnly requests');
  };

  const handler = await loadHandler();
  const response = await handler(makeSummaryRequest({ allowLocalAi: true, localAiOnly: true }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.fallback, true);
  assert.equal(result.skipped, true);
});

test('uses LocalAI before cloud providers when explicitly requested and omits authorization when no key is configured', async () => {
  configureLocalAi();
  process.env.HF_TOKEN = 'cloud-token-that-must-not-be-used';

  let capturedUrl = '';
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: 'LocalAI generated summary.',
        },
      }],
      usage: { total_tokens: 42 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeSummaryRequest({ allowLocalAi: true, localAiOnly: true }));
  const result = await response.json();
  const upstreamBody = JSON.parse(capturedInit.body);
  const upstreamHeaders = new Headers(capturedInit.headers);

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, 'http://localai.test:8080/v1/chat/completions');
  assert.equal(upstreamHeaders.get('authorization'), null);
  assert.equal(upstreamHeaders.get('content-type'), 'application/json');
  assert.equal(upstreamBody.model, 'gemma-3-4b-it');
  assert.equal(upstreamBody.messages[0].role, 'system');
  assert.equal(upstreamBody.messages[1].role, 'user');
  assert.equal(upstreamBody.max_tokens, 160);
  assert.equal(result.provider, 'localai');
  assert.equal(result.model, 'gemma-3-4b-it');
  assert.equal(result.summary, 'LocalAI generated summary.');
  assert.equal(result.tokens, 42);
});

test('caps LocalAI classification batches and token budget', async () => {
  configureLocalAi();

  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            results: [
              { level: 'info', category: 'general' },
              { level: 'low', category: 'economic' },
              { level: 'medium', category: 'conflict' },
            ],
          }),
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeClassifyBatchRequest(
    ['Headline one', 'Headline two', 'Headline three', 'Headline four'],
    { allowLocalAi: true, localAiOnly: true }
  ));
  const result = await response.json();
  const upstreamBody = JSON.parse(capturedInit.body);

  assert.equal(response.status, 200);
  assert.equal(upstreamBody.max_tokens, 120);
  assert.equal(upstreamBody.temperature, 0);
  assert.equal(upstreamBody.top_p, 1);
  assert.deepEqual(upstreamBody.response_format, { type: 'json_object' });
  assert.match(upstreamBody.messages[0].content, /Return only valid JSON/);
  assert.match(upstreamBody.messages[1].content, /1\. Headline one/);
  assert.match(upstreamBody.messages[1].content, /3\. Headline three/);
  assert.doesNotMatch(upstreamBody.messages[1].content, /Headline four/);
  assert.equal(result.results.length, 3);
});

test('serializes concurrent LocalAI requests', async () => {
  configureLocalAi();

  let activeRequests = 0;
  let maxActiveRequests = 0;
  globalThis.fetch = async () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRequests -= 1;
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Queued summary.' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const [first, second] = await Promise.all([
    handler(makeSummaryRequest({
      headlines: ['First queued headline', 'Second queued headline'],
      allowLocalAi: true,
      localAiOnly: true,
    })),
    handler(makeSummaryRequest({
      headlines: ['Third queued headline', 'Fourth queued headline'],
      allowLocalAi: true,
      localAiOnly: true,
    })),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(maxActiveRequests, 1);
});

test('sends the optional LocalAI API key as a bearer token', async () => {
  configureLocalAi('private-local-key');

  let authorization = null;
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init.headers).get('authorization');
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Authenticated summary.' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeSummaryRequest({ allowLocalAi: true, localAiOnly: true }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(authorization, 'Bearer private-local-key');
  assert.equal(result.provider, 'localai');
  assert.equal(result.summary, 'Authenticated summary.');
});

test('returns a gateway timeout response when LocalAI does not answer', async () => {
  configureLocalAi();
  process.env.LOCALAI_REQUEST_TIMEOUT_MS = '10';

  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });

  const handler = await loadHandler();
  const response = await handler(makeSummaryRequest({ allowLocalAi: true, localAiOnly: true }));
  const result = await response.json();

  assert.equal(response.status, 504);
  assert.equal(result.fallback, true);
  assert.equal(result.provider, 'localai');
  assert.equal(result.providerStatus, 504);
});
