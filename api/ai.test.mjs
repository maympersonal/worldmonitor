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
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function configureLocalAi(apiKey = '') {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.LOCALAI_API_URL = 'http://localai.test:8080/v1/chat/completions';
  process.env.LOCALAI_MODEL = 'gemma-test';
  process.env.LOCALAI_API_KEY = apiKey;
}

function makeRequest(overrides = {}) {
  return new Request('http://localhost:3000/api/ai', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      task: 'summary',
      headlines: ['Primera noticia sobre Cuba', 'Segunda noticia sobre Cuba'],
      allowLocalAi: true,
      localAiOnly: true,
      ...overrides,
    }),
  });
}

async function loadHandler() {
  const module = await import(`./ai.js?localai-test=${Date.now()}-${Math.random()}`);
  return module.default;
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

test('localAiOnly never falls through to a cloud provider', async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.HF_TOKEN = 'cloud-token';

  globalThis.fetch = async () => {
    throw new Error('No provider should be called');
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /LOCALAI_API_URL/);
});

test('uses the configured OpenAI-compatible LocalAI endpoint', async () => {
  configureLocalAi();
  let capturedUrl = '';
  let capturedInit;

  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Cuba presenta una situación general estable según los titulares disponibles.' } }],
      usage: { total_tokens: 31 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest());
  const result = await response.json();
  const upstreamBody = JSON.parse(capturedInit.body);
  const upstreamHeaders = new Headers(capturedInit.headers);

  assert.equal(response.status, 200);
  assert.equal(capturedUrl, 'http://localai.test:8080/v1/chat/completions');
  assert.equal(upstreamHeaders.get('authorization'), null);
  assert.equal(upstreamBody.model, 'gemma-test');
  assert.equal(result.provider, 'localai');
  assert.equal(result.tokens, 31);
});

test('sends an optional LocalAI key and returns 504 on timeout', async () => {
  configureLocalAi('private-key');
  process.env.LOCALAI_REQUEST_TIMEOUT_MS = '1';
  let authorization = '';

  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init.headers).get('authorization') || '';
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest());
  const result = await response.json();

  assert.equal(authorization, 'Bearer private-key');
  assert.equal(response.status, 504);
  assert.equal(result.provider, 'localai');
  assert.equal(result.fallback, true);
});
