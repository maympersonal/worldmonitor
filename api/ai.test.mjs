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

function makeSummaryRequest() {
  return new Request('http://localhost:3000/api/ai', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      task: 'summary',
      headlines: ['First test headline', 'Second test headline'],
    }),
  });
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ENV_KEYS) setEnv(key, ORIGINAL_ENV[key]);
});

test('uses LocalAI before cloud providers and omits authorization when no key is configured', async () => {
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
  const response = await handler(makeSummaryRequest());
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
  assert.equal(result.provider, 'localai');
  assert.equal(result.model, 'gemma-3-4b-it');
  assert.equal(result.summary, 'LocalAI generated summary.');
  assert.equal(result.tokens, 42);
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
  const response = await handler(makeSummaryRequest());
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
  const response = await handler(makeSummaryRequest());
  const result = await response.json();

  assert.equal(response.status, 504);
  assert.equal(result.fallback, true);
  assert.equal(result.provider, 'localai');
  assert.equal(result.providerStatus, 504);
});
