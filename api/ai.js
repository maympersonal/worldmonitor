import { getCachedJson, setCachedJson, mget, hashString } from './_upstash-cache.js';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = {
  runtime: 'edge',
};

const LOCALAI_API_URL = String(process.env.LOCALAI_API_URL || '').trim();
const LOCALAI_MODEL = String(process.env.LOCALAI_MODEL || '').trim();
const LOCALAI_API_KEY = String(process.env.LOCALAI_API_KEY || '').trim();
const LOCALAI_TIMEOUT_MS = 120000;
const LOCALAI_REQUEST_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.LOCALAI_REQUEST_TIMEOUT_MS || LOCALAI_TIMEOUT_MS) || LOCALAI_TIMEOUT_MS
);
const LOCALAI_CONCURRENCY = 1;
let localAiActiveRequests = 0;
const localAiQueue = [];
const DASHSCOPE_API_URL =
  String(process.env.DASHSCOPE_API_URL || '').trim()
  || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const HUGGINGFACE_API_URL =
  String(process.env.HF_API_URL || process.env.HUGGINGFACE_API_URL || '').trim()
  || 'https://router.huggingface.co/v1/chat/completions';
const HUGGINGFACE_MODEL =
  String(process.env.HF_MODEL || process.env.HUGGINGFACE_MODEL || '').trim()
  || 'Qwen/Qwen2.5-7B-Instruct';
const DASHSCOPE_MODEL = 'qwen2.5-1.5b-instruct';
const SUMMARY_CACHE_TTL_SECONDS = 86400;
const COUNTRY_CACHE_TTL_SECONDS = 7200;
const CLASSIFY_CACHE_TTL_SECONDS = 86400;
const SUMMARY_CACHE_VERSION = 'v5';
const COUNTRY_CACHE_VERSION = 'ci-v3';
const CLASSIFY_CACHE_VERSION = 'v2';
const MAX_BATCH_SIZE = 20;
const QUOTA_RETRY_AFTER_SECONDS = 3600;

const VALID_LEVELS = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_CATEGORIES = [
  'conflict', 'protest', 'disaster', 'diplomatic', 'economic',
  'terrorism', 'cyber', 'health', 'environmental', 'military',
  'crime', 'infrastructure', 'tech', 'general',
];

function isLocalAiDebugEnabled() {
  const value = String(process.env.LOCALAI_DEBUG || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return process.env.NODE_ENV !== 'production';
}

function logLocalAi(message, details) {
  if (!isLocalAiDebugEnabled()) return;
  if (details === undefined) {
    console.log(`[LocalAI] ${message}`);
    return;
  }
  console.log(`[LocalAI] ${message}`, details);
}

function json(body, status = 200, corsHeaders = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function getDashScopeApiKey() {
  return String(process.env.DASHSCOPE_API_KEY || '').trim();
}

function getHuggingFaceApiKey() {
  return String(
    process.env.HF_TOKEN
    || process.env.HUGGINGFACE_API_KEY
    || process.env.HUGGING_FACE_HUB_TOKEN
    || ''
  ).trim();
}

function getAiProvider(options = {}) {
  const allowLocalAi = options.allowLocalAi === true || options.localAiOnly === true;
  if (allowLocalAi && LOCALAI_API_URL && LOCALAI_MODEL) {
    return {
      id: 'localai',
      label: 'LocalAI',
      apiUrl: LOCALAI_API_URL,
      apiKey: LOCALAI_API_KEY,
      model: LOCALAI_MODEL,
      timeoutMs: LOCALAI_REQUEST_TIMEOUT_MS,
    };
  }

  if (options.localAiOnly === true) return null;

  const huggingFaceKey = getHuggingFaceApiKey();
  if (huggingFaceKey) {
    return {
      id: 'huggingface',
      label: 'Hugging Face',
      apiUrl: HUGGINGFACE_API_URL,
      apiKey: huggingFaceKey,
      model: HUGGINGFACE_MODEL,
    };
  }

  const dashScopeKey = getDashScopeApiKey();
  if (dashScopeKey) {
    return {
      id: 'alibaba',
      label: 'DashScope',
      apiUrl: DASHSCOPE_API_URL,
      apiKey: dashScopeKey,
      model: DASHSCOPE_MODEL,
    };
  }

  return null;
}

function getSummaryCacheKey(headlines, mode, geoContext = '', variant = 'full', providerScope = 'shared') {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  return `summary:${SUMMARY_CACHE_VERSION}:${providerScope}:${variant}:${hash}${geoHash}`;
}

function deduplicateHeadlines(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    const normalized = String(headline || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) continue;

    const words = new Set(normalized.split(' ').filter((word) => word.length >= 4));

    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter((word) => seenWords.has(word));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(words);
      unique.push(headline);
    }
  }

  return unique;
}

function stripMarkdownFences(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonLoose(text) {
  const cleaned = stripMarkdownFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Ignore and fall through.
      }
    }

    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // Ignore and fall through.
      }
    }
  }

  return null;
}

function extractChoiceText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

function isQuotaExhaustedError(status, rawText = '') {
  return status === 402 || /depleted your monthly included credits|purchase pre-paid credits|payment required/i.test(rawText);
}

function buildProviderErrorPayload(provider, status, rawText = '') {
  const quotaExhausted = isQuotaExhaustedError(status, rawText);
  return {
    error: quotaExhausted ? `${provider.label} quota exhausted` : `${provider.label} API error`,
    fallback: true,
    provider: provider.id,
    providerStatus: status,
    ...(quotaExhausted ? { quotaExhausted: true } : {}),
  };
}

function buildProviderErrorHeaders(status, rawText = '') {
  return isQuotaExhaustedError(status, rawText)
    ? { 'Retry-After': String(QUOTA_RETRY_AFTER_SECONDS) }
    : {};
}

function runWithLocalAiConcurrency(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      localAiActiveRequests += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          localAiActiveRequests -= 1;
          const next = localAiQueue.shift();
          if (next) next();
        });
    };

    if (localAiActiveRequests < LOCALAI_CONCURRENCY) {
      run();
    } else {
      logLocalAi('Solicitud en cola', {
        activeRequests: localAiActiveRequests,
        queuedRequests: localAiQueue.length + 1,
      });
      localAiQueue.push(run);
    }
  });
}

async function callAiProviderChat(provider, {
  messages,
  temperature = 0.3,
  maxTokens = 256,
  topP = 0.9,
  responseFormat,
}) {
  const sendRequest = async () => {
    const startedAt = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    const requestBody = {
      model: provider.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    if (provider.id === 'localai') {
      logLocalAi('Conectando con el modelo', {
        endpoint: provider.apiUrl,
        model: provider.model,
        timeoutMs: Number(provider.timeoutMs) || LOCALAI_TIMEOUT_MS,
        authenticated: Boolean(provider.apiKey),
      });
      logLocalAi('Prompt enviado', JSON.stringify(requestBody, null, 2));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(provider.timeoutMs) || LOCALAI_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(provider.apiUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (provider.id === 'localai') {
          console.error(`[LocalAI] Timeout después de ${Date.now() - startedAt}ms`, {
            endpoint: provider.apiUrl,
            model: provider.model,
          });
        }
        const timeoutError = new Error(`${provider.label} timed out`);
        timeoutError.status = 504;
        throw timeoutError;
      }
      if (provider.id === 'localai') {
        console.error(`[LocalAI] Error de conexión después de ${Date.now() - startedAt}ms`, {
          endpoint: provider.apiUrl,
          model: provider.model,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      // Some error payloads may not be JSON.
    }

    if (!response.ok) {
      if (provider.id === 'localai') {
        console.error(`[LocalAI] Respuesta HTTP ${response.status} después de ${Date.now() - startedAt}ms`, {
          response: rawText.slice(0, 2000),
        });
      }
      const error = new Error(`${provider.label} error: ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      error.rawText = rawText;
      error.provider = provider.id;
      throw error;
    }

    if (provider.id === 'localai') {
      logLocalAi(`Respuesta recibida en ${Date.now() - startedAt}ms`, {
        status: response.status,
        usage: payload?.usage || null,
        text: extractChoiceText(payload),
      });
    }

    return {
      payload,
      text: extractChoiceText(payload),
      usage: payload?.usage || null,
    };
  };

  return provider.id === 'localai' ? runWithLocalAiConcurrency(sendRequest) : sendRequest();
}

function buildSummaryPrompts(uniqueHeadlines, mode = 'brief', geoContext = '', variant = 'full') {
  const headlineText = uniqueHeadlines.map((headline, index) => `${index + 1}. ${headline}`).join('\n');
  const intelSection = geoContext ? `\n\n${geoContext}` : '';
  const isTechVariant = variant === 'tech';
  const dateContext =
    `Current date: ${new Date().toISOString().split('T')[0]}.`
    + (isTechVariant ? '' : ' Donald Trump is the current US President (second term, inaugurated Jan 2025).');

  let systemPrompt = '';
  let userPrompt = '';

  if (mode === 'brief') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Summarize the key tech/startup development in 2-3 sentences.
Rules:
- Focus ONLY on technology, startups, AI, funding, product launches, or developer news
- Ignore non-tech politics unless directly about technology regulation
- Lead with the company, product, or technology name
- No bullet points or meta-commentary`;
    } else {
      systemPrompt = `${dateContext}

Summarize the key development in 2-3 sentences.
Rules:
- Lead with what happened and where
- Start directly with the subject
- Mention focal actors by name when they are central
- No bullet points or meta-commentary`;
    }
    userPrompt = `Summarize the top story:\n${headlineText}${intelSection}`;
  } else if (mode === 'analysis') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Analyze the tech/startup trend in 2-3 sentences.
Rules:
- Focus on technology implications, funding trends, AI developments, product strategy, and market shifts
- Ignore non-tech political angles unless directly about technology policy
- Lead with the insight`;
    } else {
      systemPrompt = `${dateContext}

Provide analysis in 2-3 sentences.
Rules:
- Lead with the insight and why it matters
- Be direct and specific
- Explain implications when signals and news converge`;
    }
    userPrompt = isTechVariant
      ? `What's the key tech trend or development?\n${headlineText}${intelSection}`
      : `What's the key pattern or risk?\n${headlineText}${intelSection}`;
  } else {
    systemPrompt = isTechVariant
      ? `${dateContext}\n\nSynthesize the tech headlines in 2 sentences. Focus on startups, AI, funding, and product developments.`
      : `${dateContext}\n\nSynthesize the headlines in at most 2 sentences. Lead with substance and be direct.`;
    userPrompt = `Key takeaway:\n${headlineText}${intelSection}`;
  }

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
}

async function handleSummaryTask(body, corsHeaders, provider) {
  const { headlines, mode = 'brief', geoContext = '', variant = 'full' } = body;

  if (!Array.isArray(headlines) || headlines.length === 0) {
    return json({ error: 'Headlines array required' }, 400, corsHeaders);
  }

  const providerScope = body.localAiOnly === true ? `localai:${provider.model}` : 'shared';
  const cacheKey = getSummaryCacheKey(headlines, mode, geoContext, variant, providerScope);
  const cached = await getCachedJson(cacheKey);
  if (cached && typeof cached === 'object' && cached.summary) {
    if (provider.id === 'localai') {
      logLocalAi('Resumen recuperado de caché; no se enviará un prompt al modelo', {
        cacheKey,
        model: cached.model || provider.model,
      });
    }
    return json(
      {
        summary: cached.summary,
        model: cached.model || provider.model,
        provider: 'cache',
        cached: true,
      },
      200,
      corsHeaders
    );
  }

  const uniqueHeadlines = deduplicateHeadlines(headlines.slice(0, 8));
  const { messages } = buildSummaryPrompts(uniqueHeadlines, mode, geoContext, variant);
  if (provider.id === 'localai') {
    logLocalAi('Preparando resumen', {
      receivedHeadlines: headlines.length,
      uniqueHeadlines: uniqueHeadlines.length,
      mode,
      variant,
      cacheKey,
    });
  }

  try {
    const { text, usage } = await callAiProviderChat(provider, {
      messages,
      temperature: 0.3,
      maxTokens: 180,
      topP: 0.9,
    });

    if (!text) {
      return json({ error: 'Empty response', fallback: true }, 500, corsHeaders);
    }

    await setCachedJson(
      cacheKey,
      {
        summary: text,
        model: provider.model,
        provider: provider.id,
        timestamp: Date.now(),
      },
      SUMMARY_CACHE_TTL_SECONDS
    );

    return json(
      {
        summary: text,
        model: provider.model,
        provider: provider.id,
        cached: false,
        tokens: usage?.total_tokens || 0,
      },
      200,
      corsHeaders,
      { 'Cache-Control': 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=300' }
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    const rawText = typeof error?.rawText === 'string' ? error.rawText : '';
    console.error(`[AI summary] ${provider.label} error:`, status, rawText || error?.message || error);
    return json(
      buildProviderErrorPayload(provider, status, rawText),
      status,
      corsHeaders,
      buildProviderErrorHeaders(status, rawText)
    );
  }
}

async function handleCountryBriefTask(body, corsHeaders, provider) {
  const { country, code, context } = body;

  if (!country || !code) {
    return json({ error: 'country and code required' }, 400, corsHeaders);
  }

  const contextHash = context ? hashString(JSON.stringify(context)).slice(0, 8) : 'no-ctx';
  const cacheKey = `${COUNTRY_CACHE_VERSION}:${code}:${contextHash}`;
  const cached = await getCachedJson(cacheKey);
  if (cached && typeof cached === 'object' && cached.brief) {
    return json(
      { ...cached, cached: true },
      200,
      corsHeaders,
      { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' }
    );
  }

  const dataLines = [];
  if (context?.score != null) {
    const changeStr = context.change24h
      ? ` (${context.change24h > 0 ? '+' : ''}${context.change24h} in 24h)`
      : '';
    dataLines.push(`Instability Score: ${context.score}/100 (${context.level || 'unknown'}) — trend: ${context.trend || 'unknown'}${changeStr}`);
  }
  if (context?.components) {
    const components = context.components;
    dataLines.push(
      `Score Components: Unrest ${components.unrest ?? '?'}/100, Security ${components.security ?? '?'}/100, Information ${components.information ?? '?'}/100`
    );
  }
  if (context?.protests != null) dataLines.push(`Active protests in/near country (7d): ${context.protests}`);
  if (context?.militaryFlights != null) dataLines.push(`Military aircraft detected in/near country: ${context.militaryFlights}`);
  if (context?.militaryVessels != null) dataLines.push(`Military vessels detected in/near country: ${context.militaryVessels}`);
  if (context?.outages != null) dataLines.push(`Internet outages: ${context.outages}`);
  if (context?.earthquakes != null) dataLines.push(`Recent earthquakes: ${context.earthquakes}`);
  if (context?.stockIndex) dataLines.push(`Stock Market Index: ${context.stockIndex}`);
  if (context?.convergenceScore != null) {
    dataLines.push(
      `Signal convergence score: ${context.convergenceScore}/100 (multiple signal types detected: ${(context.signalTypes || []).join(', ')})`
    );
  }
  if (context?.regionalConvergence?.length > 0) {
    dataLines.push('\nRegional convergence alerts:');
    context.regionalConvergence.forEach((entry) => dataLines.push(`- ${entry}`));
  }
  if (context?.headlines?.length > 0) {
    dataLines.push(`\nRecent headlines mentioning ${country} (${context.headlines.length} found):`);
    context.headlines.slice(0, 15).forEach((headline, index) => dataLines.push(`${index + 1}. ${headline}`));
  }

  const dataSection = dataLines.length > 0
    ? `\nCURRENT SENSOR DATA:\n${dataLines.join('\n')}`
    : '\nNo real-time sensor data available for this country.';

  const dateStr = new Date().toISOString().split('T')[0];
  const systemPrompt = `You are a senior intelligence analyst providing a concise, data-driven country situation brief. Current date: ${dateStr}. Donald Trump is the current US President (second term, inaugurated Jan 2025).

Write a clear intelligence brief for the requested country.

Structure:
1. Current situation
2. Security and military posture
3. Key risk factors
4. Regional context
5. Outlook and watch items

Rules:
- Use plain language
- Reference the data provided
- If data is quiet, say so
- Do not speculate beyond the supplied data
- Keep the brief to 4-5 short paragraphs and about 220-320 words
- If military assets are 0, explicitly say monitoring shows no current military activity
- When citing a numbered headline, use [N]`;
  const userPrompt = `Country: ${country} (${code})${dataSection}`;

  try {
    const { text } = await callAiProviderChat(provider, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 700,
      topP: 0.9,
    });

    const result = {
      brief: text || '',
      country,
      code,
      model: provider.model,
      provider: provider.id,
      generatedAt: new Date().toISOString(),
    };

    if (result.brief) {
      await setCachedJson(cacheKey, result, COUNTRY_CACHE_TTL_SECONDS);
    }

    return json(
      result,
      200,
      corsHeaders,
      { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' }
    );
  } catch (error) {
    const status = Number(error?.status) || 502;
    const rawText = typeof error?.rawText === 'string' ? error.rawText : '';
    console.error(`[AI country brief] ${provider.label} error:`, status, rawText || error?.message || error);
    return json(
      buildProviderErrorPayload(provider, status, rawText),
      status,
      corsHeaders,
      buildProviderErrorHeaders(status, rawText)
    );
  }
}

async function handleClassifyBatchTask(body, corsHeaders, provider) {
  const { titles, variant = 'full' } = body;

  if (!Array.isArray(titles) || titles.length === 0) {
    return json({ error: 'titles array required' }, 400, corsHeaders);
  }

  const batch = titles.slice(0, MAX_BATCH_SIZE);
  const results = new Array(batch.length).fill(null);
  const uncachedIndices = [];
  const cacheKeys = batch.map(
    (title) => `classify:${CLASSIFY_CACHE_VERSION}:${hashString(String(title).toLowerCase() + ':' + variant)}`
  );
  const cached = await mget(...cacheKeys);

  for (let index = 0; index < cached.length; index += 1) {
    const entry = cached[index];
    if (entry && typeof entry === 'object' && entry.level) {
      results[index] = { level: entry.level, category: entry.category, cached: true };
    } else {
      uncachedIndices.push(index);
    }
  }

  if (uncachedIndices.length === 0) {
    return json(
      { results },
      200,
      corsHeaders,
      { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' }
    );
  }

  const uncachedTitles = uncachedIndices.map((index) => batch[index]);
  const isTech = variant === 'tech';
  const numberedList = uncachedTitles.map((title, index) => `${index + 1}. ${title}`).join('\n');

  const systemPrompt = `You classify news headlines into threat level and category. Return only JSON.

Allowed levels: critical, high, medium, low, info
Allowed categories: conflict, protest, disaster, diplomatic, economic, terrorism, cyber, health, environmental, military, crime, infrastructure, tech, general

${isTech
    ? 'Focus on technology, startups, AI, and cybersecurity. Most tech news should be low or info unless it describes major disruption, breach, outage, or severe strategic impact.'
    : 'Focus on geopolitical events, conflicts, disasters, diplomacy, and real-world severity.'}

Return a JSON object with this exact shape:
{"results":[{"level":"...","category":"..."},{"level":"...","category":"..."}]}

Preserve the original order of the headlines.`;

  try {
    const { text } = await callAiProviderChat(provider, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: numberedList },
      ],
      temperature: 0,
      maxTokens: uncachedTitles.length * 60,
      topP: 1,
      responseFormat: { type: 'json_object' },
    });

    const parsed = parseJsonLoose(text);
    const parsedResults = Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed)
        ? parsed
        : [];

    const cacheWrites = [];
    for (let index = 0; index < uncachedIndices.length; index += 1) {
      const classification = parsedResults[index];
      if (!classification) continue;

      const level = VALID_LEVELS.includes(classification.level) ? classification.level : null;
      const category = VALID_CATEGORIES.includes(classification.category) ? classification.category : null;
      if (!level || !category) continue;

      const resultIndex = uncachedIndices[index];
      results[resultIndex] = { level, category, cached: false };
      cacheWrites.push(
        setCachedJson(
          `classify:${CLASSIFY_CACHE_VERSION}:${hashString(String(batch[resultIndex]).toLowerCase() + ':' + variant)}`,
          { level, category, timestamp: Date.now() },
          CLASSIFY_CACHE_TTL_SECONDS
        )
      );
    }

    if (cacheWrites.length > 0) {
      await Promise.allSettled(cacheWrites);
    }

    return json(
      { results },
      200,
      corsHeaders,
      { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' }
    );
  } catch (error) {
    const status = Number(error?.status) || 500;
    const rawText = typeof error?.rawText === 'string' ? error.rawText : '';
    console.error(`[AI classify batch] ${provider.label} error:`, status, rawText || error?.message || error);
    return json(
      {
        results,
        ...buildProviderErrorPayload(provider, status, rawText),
      },
      status,
      corsHeaders,
      buildProviderErrorHeaders(status, rawText)
    );
  }
}

async function handleClassifySingleTask(body, corsHeaders, provider) {
  const { title, variant = 'full' } = body;
  if (!title) {
    return json({ error: 'title param required' }, 400, corsHeaders);
  }

  const cacheKey = `classify:${CLASSIFY_CACHE_VERSION}:${hashString(String(title).toLowerCase() + ':' + variant)}`;
  const cached = await getCachedJson(cacheKey);
  if (cached && typeof cached === 'object' && cached.level) {
    return json(
      {
        level: cached.level,
        category: cached.category,
        confidence: 0.9,
        source: 'llm',
        cached: true,
      },
      200,
      corsHeaders
    );
  }

  const batchResponse = await handleClassifyBatchTask({ titles: [title], variant }, corsHeaders, provider);
  const payload = await batchResponse.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;

  if (!result?.level || !result?.category) {
    return json({ fallback: true }, batchResponse.status, corsHeaders);
  }

  return json(
    {
      level: result.level,
      category: result.category,
      confidence: 0.9,
      source: 'llm',
      cached: !!result.cached,
    },
    200,
    corsHeaders
  );
}

async function dispatchTask(body, corsHeaders, provider) {
  switch (body.task) {
    case 'summary':
      return handleSummaryTask(body, corsHeaders, provider);
    case 'country_brief':
      return handleCountryBriefTask(body, corsHeaders, provider);
    case 'classify_batch':
      return handleClassifyBatchTask(body, corsHeaders, provider);
    case 'classify_single':
      return handleClassifySingleTask(body, corsHeaders, provider);
    default:
      return json({ error: 'Unsupported AI task' }, 400, corsHeaders);
  }
}

export default async function handler(request) {
  const corsHeaders = getCorsHeaders(request, 'POST, OPTIONS');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  if (isDisallowedOrigin(request)) {
    return json({ error: 'Origin not allowed' }, 403, {});
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 51200) {
    return json({ error: 'Payload too large' }, 413, corsHeaders);
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid request body' }, 400, corsHeaders);
  }

  const provider = getAiProvider({
    allowLocalAi: body.allowLocalAi === true,
    localAiOnly: body.localAiOnly === true,
  });
  if (!provider) {
    if (body.localAiOnly === true) {
      console.warn('[LocalAI] No configurado. Se requieren LOCALAI_API_URL y LOCALAI_MODEL.');
    }
    return json(
      {
        fallback: true,
        skipped: true,
        reason: body.localAiOnly === true
          ? 'LOCALAI_API_URL/LOCALAI_MODEL not configured'
          : 'HF_TOKEN or DASHSCOPE_API_KEY not configured',
      },
      200,
      corsHeaders
    );
  }

  return dispatchTask(body, corsHeaders, provider);
}
