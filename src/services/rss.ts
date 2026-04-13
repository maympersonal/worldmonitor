import type { Feed, NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';
import { classifyByKeyword, classifyWithAI } from './threat-classifier';
import { inferGeoHubsFromTitle } from './geo-hub-index';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { ingestHeadlines } from './trending-keywords';

// Per-feed circuit breaker: track failures and cooldowns
const FEED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after failure
const BLOCKED_FEED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours after upstream 403
const MAX_FAILURES = 2; // failures before cooldown
const MAX_CACHE_ENTRIES = 100; // Prevent unbounded growth
const feedFailures = new Map<string, { count: number; cooldownUntil: number; blocked?: boolean }>();
const feedCache = new Map<string, { items: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const AI_CLASSIFY_DEDUP_MS = 30 * 60 * 1000;
const AI_CLASSIFY_WINDOW_MS = 60 * 1000;
const AI_CLASSIFY_MAX_PER_WINDOW =
  SITE_VARIANT === 'finance' ? 40 : SITE_VARIANT === 'tech' ? 60 : 80;
const AI_CLASSIFY_MAX_PER_FEED =
  SITE_VARIANT === 'finance' ? 2 : SITE_VARIANT === 'tech' ? 2 : 3;
const aiRecentlyQueued = new Map<string, number>();
const aiDispatches: number[] = [];
const DEBUG_FINANCE_FEED_NAMES = new Set([
  'Cuba Economia',
  'Cuba Economy (EN)',
  'Cuba Moneda',
  'Cuba Currency (EN)',
  'Cuba Comercio Exterior',
  'Cuba Foreign Trade (EN)',
]);
const CUBA_TECH_FILTER_FEED_NAMES = new Set([
  'Cuba Tecnologia (ES)',
  'Cuba Technology (EN)',
  'Cuba Telecom (ES)',
  'Cuba Telecom (EN)',
]);
const CUBA_GOV_FILTER_FEED_NAMES = new Set([
  'Gobierno de Cuba',
  'Cuban Government (EN)',
  'Presidencia Cuba',
  'Cuban Presidency (EN)',
  'MINREX Cuba',
  'Cuban Foreign Ministry (EN)',
]);
const CUBA_FINANCE_FILTER_FEED_NAMES = new Set([
  'Cuba Economia',
  'Cuba Economy (EN)',
  'Cuba Moneda',
  'Cuba Currency (EN)',
  'Cuba Comercio Exterior',
  'Cuba Foreign Trade (EN)',
]);
const CUBA_AI_FILTER_FEED_NAMES = new Set([
  'IA en Cuba',
  'AI in Cuba (EN)',
  'Política de IA (Cuba)',
  'Cuban AI Policy (EN)',
  'Infraestructura IA Cuba',
  'Cuba AI Infrastructure (EN)',
  'Reuters IA Cuba',
  'Reuters AI Cuba (EN)',
]);
const CUBA_ENERGY_FILTER_FEED_NAMES = new Set([
  'Petróleo y Gas (Cuba)',
  'Oil & Gas (Cuba)',
  'Energía Nuclear (Cuba)',
  'Nuclear Energy (Cuba)',
  'Reuters Energía Cuba',
  'Reuters Energy Cuba (EN)',
  'Minería y Recursos Naturales (Cuba)',
  'Mining & Natural Resources (Cuba)',
]);
const CUBA_CONTEXT_RE = /\b(cuba|habana|havana|cuban|cubano|cubana|etecsa)\b/i;
const CUBA_TECH_TOPICAL_RE =
  /\b(tecnolog(?:ia|ias|ico|ica|icos|icas)|tecnolog[ií]as?|technology|technologies|digitalizaci[oó]n|digitalization|software|inform[aá]tica|informatizaci[oó]n|transformaci[oó]n digital|digital transformation|tic|ict|inteligencia artificial|artificial intelligence|ia|ai|app(?:s)?|aplicaciones?)\b/i;
const CUBA_TELECOM_TOPICAL_RE =
  /\b(internet|conectividad|connectivity|telecom(?:unicaciones?)?|telecommunications?|banda ancha|broadband|4g|5g|fibra|fiber|datos m[oó]viles|mobile data|red(?:es)? m[oó]viles|network(?:s)?|carrier(?:s)?|operador(?:es)?|etecsa|ministerio de comunicaciones|ministry of communications)\b/i;
const CUBA_GOV_GENERAL_TOPICAL_RE =
  /\b(gobierno cubano|cuban government|consejo de ministros|council of ministers|consejo de estado|council of state|asamblea nacional|national assembly|poder popular|people'?s power)\b/i;
const CUBA_PRESIDENCY_TOPICAL_RE =
  /\b(presidencia(?: de cuba)?|presidency(?: of cuba)?|diaz-canel|president(?:e)?|decreto|decree|discurso|speech|reunion|meeting|medidas|measures)\b/i;
const CUBA_MINREX_TOPICAL_RE =
  /\b(minrex|minrex\.gob\.cu|canciller[ií]a(?: de cuba)?|cuban foreign ministry|foreign ministry of cuba|comunicado|statement|declaraci[oó]n|declaration|pol[ií]tica exterior|foreign policy)\b/i;
const CUBA_FINANCE_GENERAL_TOPICAL_RE =
  /\b(econom[ií]a|economy|finanzas?|finance|comercio|trade|inversi[oó]n(?:es)?|investment(?:s)?|inflaci[oó]n|inflation|deuda|debt|remesas?|remittances?|pib|gdp)\b/i;
const CUBA_FINANCE_CURRENCY_TOPICAL_RE =
  /\b(peso|cup|mlc|moneda|currency|divisa|tipo de cambio|exchange rate|devaluaci[oó]n|devaluation|mercado informal|black market)\b/i;
const CUBA_FINANCE_TRADE_TOPICAL_RE =
  /\b(comercio exterior|foreign trade|exportaciones?|exports?|importaciones?|imports?|balanza comercial|trade balance|arancel(?:es)?|tariff(?:s)?|aduana(?:s)?|customs)\b/i;
const CUBA_AI_GENERAL_TOPICAL_RE =
  /\b(inteligencia artificial|artificial intelligence|\bia\b|\bai\b|aprendizaje autom[aá]tico|machine learning|ia generativa|generative ai|chatgpt|modelo de lenguaje|language model|llm|digitalizaci[oó]n|digitalization|transformaci[oó]n digital|digital transformation|tecnolog[ií]a|technology)\b/i;
const CUBA_AI_POLICY_TOPICAL_RE =
  /\b(inteligencia artificial|artificial intelligence|\bia\b|\bai\b|regulaci[oó]n|regulation|estrategia|strategy|decreto|policy|lineamientos|gobierno cubano|cuban government|transformaci[oó]n digital|digital transformation|mincom|citma)\b/i;
const CUBA_AI_INFRA_TOPICAL_RE =
  /\b(inteligencia artificial|artificial intelligence|\bia\b|\bai\b|centro de datos|data center|nube|cloud|computaci[oó]n|compute|servidores|servers|gpu|fibra [oó]ptica|fiber optics|conectividad|connectivity|etecsa|telecom|digitalizaci[oó]n|digitalization|tecnolog[ií]a|technology)\b/i;
const CUBA_AI_REUTERS_TOPICAL_RE =
  /\b(inteligencia artificial|artificial intelligence|\bia\b|\bai\b|automatizaci[oó]n|automation|centro de datos|data center|machine learning|chatgpt|llm|digitalizaci[oó]n|digitalization|tecnolog[ií]a|technology|telecom)\b/i;
const CUBA_ENERGY_OIL_GAS_TOPICAL_RE =
  /\b(petr[oó]leo|oil(?: price)?|gas natural|natural gas|opec|opep|oleoducto|gasoducto|pipeline|lng|refiner[ií]a|refinery|combustible|fuel)\b/i;
const CUBA_ENERGY_NUCLEAR_TOPICAL_RE =
  /\b(energ[ií]a nuclear|nuclear energy|nuclear power|energ[ií]a at[oó]mica|uranio|uranium|oiea|iaea|reactor(?:es)?|reactor(?:s)?)\b/i;
const CUBA_ENERGY_MINING_TOPICAL_RE =
  /\b(recursos naturales|natural resources|miner[ií]a|mining|industria extractiva|extractive|mineral(?:es)?|minerals?|n[ií]quel|nickel|cobalto|cobalt|litio|lithium|tierras raras|rare earth|rare-earth|cobre|copper)\b/i;
const CUBA_ENERGY_REUTERS_TOPICAL_RE =
  /\b(energ[ií]a|energy|petr[oó]leo|oil|gas|opec|opep|lng|nuclear|miner[ií]a|mining|recursos naturales|natural resources|mineral(?:es)?|minerals?)\b/i;
const XML_BUILTIN_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const HTML_ENTITY_TO_NUMERIC: Record<string, string> = {
  nbsp: '&#160;',
  ndash: '&#8211;',
  mdash: '&#8212;',
  hellip: '&#8230;',
  lsquo: '&#8216;',
  rsquo: '&#8217;',
  ldquo: '&#8220;',
  rdquo: '&#8221;',
  copy: '&#169;',
  reg: '&#174;',
  trade: '&#8482;',
  euro: '&#8364;',
};

function compactText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getItemSnippet(item: Element): string {
  const contentEncodedBySelector = item.querySelector('content\\:encoded')?.textContent || '';
  const contentEncodedByTag = item.getElementsByTagName('content:encoded')[0]?.textContent || '';

  return compactText([
    item.querySelector('description')?.textContent || '',
    item.querySelector('summary')?.textContent || '',
    item.querySelector('content')?.textContent || '',
    contentEncodedBySelector,
    contentEncodedByTag,
  ].join(' '));
}

function shouldKeepCubaTechHeadline(feedName: string, title: string, snippet: string): boolean {
  if (!CUBA_TECH_FILTER_FEED_NAMES.has(feedName)) return true;

  const haystack = `${title} ${snippet}`;
  if (!CUBA_CONTEXT_RE.test(haystack)) return false;

  const topicalRe = feedName.includes('Telecom') ? CUBA_TELECOM_TOPICAL_RE : CUBA_TECH_TOPICAL_RE;
  return topicalRe.test(haystack);
}

function shouldKeepCubaGovHeadline(feedName: string, title: string, snippet: string): boolean {
  if (!CUBA_GOV_FILTER_FEED_NAMES.has(feedName)) return true;

  const haystack = `${title} ${snippet}`;
  if (!CUBA_CONTEXT_RE.test(haystack)) return false;

  if (feedName.includes('Presidencia') || feedName.includes('Presidency')) {
    return CUBA_PRESIDENCY_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('MINREX') || feedName.includes('Foreign Ministry')) {
    return CUBA_MINREX_TOPICAL_RE.test(haystack);
  }
  return CUBA_GOV_GENERAL_TOPICAL_RE.test(haystack);
}

function shouldKeepCubaFinanceHeadline(feedName: string, title: string, snippet: string): boolean {
  if (!CUBA_FINANCE_FILTER_FEED_NAMES.has(feedName)) return true;

  const haystack = `${title} ${snippet}`;
  if (!CUBA_CONTEXT_RE.test(haystack)) return false;

  if (feedName.includes('Moneda') || feedName.includes('Currency')) {
    return CUBA_FINANCE_CURRENCY_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('Comercio Exterior') || feedName.includes('Foreign Trade')) {
    return CUBA_FINANCE_TRADE_TOPICAL_RE.test(haystack);
  }
  return CUBA_FINANCE_GENERAL_TOPICAL_RE.test(haystack);
}

function shouldKeepCubaAiHeadline(feedName: string, title: string, snippet: string): boolean {
  if (!CUBA_AI_FILTER_FEED_NAMES.has(feedName)) return true;

  const haystack = `${title} ${snippet}`;
  // AI feeds are already Cuba-scoped at query level. Google News can omit
  // explicit Cuba tokens in title/snippet, so we only enforce topical match.
  if (feedName.includes('Política') || feedName.includes('Policy')) {
    return CUBA_AI_POLICY_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('Infraestructura') || feedName.includes('Infrastructure')) {
    return CUBA_AI_INFRA_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('Reuters')) {
    return CUBA_AI_REUTERS_TOPICAL_RE.test(haystack);
  }
  return CUBA_AI_GENERAL_TOPICAL_RE.test(haystack);
}

function shouldKeepCubaEnergyHeadline(feedName: string, title: string, snippet: string): boolean {
  if (!CUBA_ENERGY_FILTER_FEED_NAMES.has(feedName)) return true;

  const haystack = `${title} ${snippet}`;
  if (!CUBA_CONTEXT_RE.test(haystack)) return false;
  if (feedName.includes('Nuclear')) {
    return CUBA_ENERGY_NUCLEAR_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('Minería') || feedName.includes('Mining')) {
    return CUBA_ENERGY_MINING_TOPICAL_RE.test(haystack);
  }
  if (feedName.includes('Reuters')) {
    return CUBA_ENERGY_REUTERS_TOPICAL_RE.test(haystack);
  }
  return CUBA_ENERGY_OIL_GAS_TOPICAL_RE.test(haystack);
}

function shouldKeepCubaScopedHeadline(feedName: string, title: string, snippet: string): boolean {
  return shouldKeepCubaTechHeadline(feedName, title, snippet)
    && shouldKeepCubaGovHeadline(feedName, title, snippet)
    && shouldKeepCubaFinanceHeadline(feedName, title, snippet)
    && shouldKeepCubaAiHeadline(feedName, title, snippet)
    && shouldKeepCubaEnergyHeadline(feedName, title, snippet);
}

function isCubaScopedFeed(feedName: string): boolean {
  return CUBA_TECH_FILTER_FEED_NAMES.has(feedName)
    || CUBA_GOV_FILTER_FEED_NAMES.has(feedName)
    || CUBA_FINANCE_FILTER_FEED_NAMES.has(feedName)
    || CUBA_AI_FILTER_FEED_NAMES.has(feedName)
    || CUBA_ENERGY_FILTER_FEED_NAMES.has(feedName);
}

function toSerializable(items: NewsItem[]): Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }> {
  return items.map(item => ({ ...item, pubDate: item.pubDate.toISOString() }));
}

function fromSerializable(items: Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>): NewsItem[] {
  return items.map(item => ({ ...item, pubDate: new Date(item.pubDate) }));
}

async function loadPersistentFeed(feedName: string): Promise<NewsItem[] | null> {
  const entry = await getPersistentCache<Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>>(`feed:${feedName}`);
  if (!entry?.data?.length) return null;
  return fromSerializable(entry.data);
}

// Clean up stale entries to prevent unbounded growth
function cleanupCaches(): void {
  const now = Date.now();

  for (const [key, value] of feedCache) {
    if (now - value.timestamp > CACHE_TTL * 2) {
      feedCache.delete(key);
    }
  }

  for (const [key, state] of feedFailures) {
    if (state.cooldownUntil > 0 && now > state.cooldownUntil) {
      feedFailures.delete(key);
    }
  }

  if (feedCache.size > MAX_CACHE_ENTRIES) {
    const entries = Array.from(feedCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) {
      feedCache.delete(key);
    }
  }
}

function isFeedOnCooldown(feedName: string): boolean {
  const state = feedFailures.get(feedName);
  if (!state) return false;
  if (Date.now() < state.cooldownUntil) return true;
  if (state.cooldownUntil > 0) feedFailures.delete(feedName);
  return false;
}

function recordFeedFailure(feedName: string, options: { status?: number; blocked?: boolean } = {}): void {
  const state = feedFailures.get(feedName) || { count: 0, cooldownUntil: 0, blocked: false };
  const isBlocked = options.blocked || options.status === 403;

  if (isBlocked) {
    state.count = Math.max(state.count + 1, MAX_FAILURES);
    state.blocked = true;
    state.cooldownUntil = Date.now() + BLOCKED_FEED_COOLDOWN_MS;
    console.warn(`[RSS] ${feedName} on cooldown for 6 hours after upstream block`);
    feedFailures.set(feedName, state);
    return;
  }

  state.count++;
  if (state.count >= MAX_FAILURES) {
    state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    state.blocked = false;
    console.warn(`[RSS] ${feedName} on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedName, state);
}

function recordFeedSuccess(feedName: string): void {
  feedFailures.delete(feedName);
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number(error.status);
  return Number.isFinite(status) ? status : undefined;
}

function isBlockedError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'blocked' in error && error.blocked);
}

function toAiKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function canQueueAiClassification(title: string): boolean {
  const now = Date.now();
  while (aiDispatches.length > 0 && now - aiDispatches[0]! > AI_CLASSIFY_WINDOW_MS) {
    aiDispatches.shift();
  }
  for (const [key, queuedAt] of aiRecentlyQueued) {
    if (now - queuedAt > AI_CLASSIFY_DEDUP_MS) {
      aiRecentlyQueued.delete(key);
    }
  }
  if (aiDispatches.length >= AI_CLASSIFY_MAX_PER_WINDOW) {
    return false;
  }

  const key = toAiKey(title);
  const lastQueued = aiRecentlyQueued.get(key);
  if (lastQueued && now - lastQueued < AI_CLASSIFY_DEDUP_MS) {
    return false;
  }

  aiDispatches.push(now);
  aiRecentlyQueued.set(key, now);
  return true;
}

function getFeedAttemptUrls(feed: Feed): string[] {
  return Array.from(new Set([feed.url, ...(feed.fallbackUrls || [])].filter(Boolean)));
}

function buildFeedHttpError(feedName: string, response: Response): Error {
  const error = new Error(`HTTP ${response.status}`);
  Object.assign(error, {
    status: response.status,
    blocked: response.status === 403 || response.headers.get('x-feed-state') === 'blocked',
    feedName,
  });
  return error;
}

function shouldTryFallback(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 403 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (isParseError(error)) {
    return true;
  }
  return isBlockedError(error);
}

function isParseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'parseError' in error && error.parseError);
}

function sanitizeXmlForParser(xml: string): string {
  let sanitized = xml
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  sanitized = sanitized.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (entity, name) => {
    const normalized = name.toLowerCase();
    if (XML_BUILTIN_ENTITIES.has(normalized)) {
      return entity;
    }
    return HTML_ENTITY_TO_NUMERIC[normalized] || `&amp;${name};`;
  });

  sanitized = sanitized.replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;)/g, '&amp;');

  return sanitized;
}

function decodeMaybe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function logFinanceFeedResults(feed: Feed, items: NewsItem[]): void {
  if (!DEBUG_FINANCE_FEED_NAMES.has(feed.name)) return;

  console.log(`[RSS][FinanceDebug] ${feed.name} -> ${items.length} items`);
  console.log(`[RSS][FinanceDebug] ${feed.name} query: ${decodeMaybe(feed.url)}`);

  if (items.length === 0) {
    console.log(`[RSS][FinanceDebug] ${feed.name} returned no headlines`);
    return;
  }

  items.slice(0, 5).forEach((item, index) => {
    console.log(
      `[RSS][FinanceDebug] ${feed.name} #${index + 1}: ${item.title} | ${item.link}`
    );
  });
}

function parseRssDocument(xml: string): { doc: Document; recovered: boolean } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  if (!doc.querySelector('parsererror')) {
    return { doc, recovered: false };
  }

  const sanitized = sanitizeXmlForParser(xml);
  if (sanitized !== xml) {
    const recoveredDoc = parser.parseFromString(sanitized, 'text/xml');
    if (!recoveredDoc.querySelector('parsererror')) {
      return { doc: recoveredDoc, recovered: true };
    }
  }

  return { doc, recovered: false };
}

export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  if (feedCache.size > MAX_CACHE_ENTRIES / 2) cleanupCaches();
  const hasScopedCubaFilter = isCubaScopedFeed(feed.name);

  if (isFeedOnCooldown(feed.name)) {
    const cached = feedCache.get(feed.name);
    if (cached && !(hasScopedCubaFilter && cached.items.length === 0)) return cached.items;
    const persistent = await loadPersistentFeed(feed.name);
    if (persistent && !(hasScopedCubaFilter && persistent.length === 0)) return persistent;
    return [];
  }

  const cached = feedCache.get(feed.name);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    if (!(hasScopedCubaFilter && cached.items.length === 0)) {
      return cached.items;
    }
  }

  try {
    const attemptUrls = getFeedAttemptUrls(feed);
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < attemptUrls.length; attemptIndex += 1) {
      const attemptUrl = attemptUrls[attemptIndex]!;
      const isFallback = attemptIndex > 0;

      try {
        const response = await fetchWithProxy(attemptUrl);
        if (!response.ok) {
          throw buildFeedHttpError(feed.name, response);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const text = await response.text();
        const { doc, recovered } = parseRssDocument(text);

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
          const parseFailure = new Error(`Parse error (${contentType || 'unknown content type'})`);
          Object.assign(parseFailure, {
            blocked: contentType.includes('html'),
            parseError: true,
          });
          throw parseFailure;
        }

        if (recovered) {
          console.info(`[RSS] ${feed.name} recovered malformed XML via sanitizer`);
        }

        let items = doc.querySelectorAll('item');
        const isAtom = items.length === 0;
        if (isAtom) items = doc.querySelectorAll('entry');

        const parsedCandidates = Array.from(items)
          .map((item) => {
            const title = item.querySelector('title')?.textContent || '';
            let link = '';
            if (isAtom) {
              const linkEl = item.querySelector('link[href]');
              link = linkEl?.getAttribute('href') || '';
            } else {
              link = item.querySelector('link')?.textContent || '';
            }

            const snippet = getItemSnippet(item);
            const pubDateStr = isAtom
              ? (item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '')
              : (item.querySelector('pubDate')?.textContent || '');
            const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
            const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
            const threat = classifyByKeyword(title, SITE_VARIANT);
            const isAlert = threat.level === 'critical' || threat.level === 'high';
            const geoMatches = inferGeoHubsFromTitle(title);
            const topGeo = geoMatches[0];

            return {
              item: {
                source: feed.name,
                title,
                link,
                pubDate,
                isAlert,
                threat,
                ...(topGeo && { lat: topGeo.hub.lat, lon: topGeo.hub.lon, locationName: topGeo.hub.name }),
              } satisfies NewsItem,
              snippet,
            };
          });
        const filteredCandidates = parsedCandidates
          .filter(({ item, snippet }) => shouldKeepCubaScopedHeadline(feed.name, item.title, snippet));
        const parsed = filteredCandidates
          .slice(0, 5)
          .map(({ item }) => item);

        if (hasScopedCubaFilter && filteredCandidates.length < parsedCandidates.length) {
          console.info(`[RSS] ${feed.name} filtered ${parsedCandidates.length - filteredCandidates.length} off-topic items`);
        }

        // If this attempt yields no headlines, try configured fallbacks before
        // accepting an empty result.
        if (parsed.length === 0 && attemptIndex < attemptUrls.length - 1) {
          console.warn(`[RSS] ${feed.name} returned no items, trying fallback ${attemptIndex + 1}/${attemptUrls.length - 1}`);
          continue;
        }

        if (isFallback) {
          console.info(`[RSS] ${feed.name} recovered via fallback source`);
        }

        if (parsed.length > 0 || !hasScopedCubaFilter) {
          feedCache.set(feed.name, { items: parsed, timestamp: Date.now() });
          void setPersistentCache(`feed:${feed.name}`, toSerializable(parsed));
        } else {
          feedCache.delete(feed.name);
        }
        recordFeedSuccess(feed.name);
        ingestHeadlines(parsed.map(item => ({
          title: item.title,
          pubDate: item.pubDate,
          source: item.source,
          link: item.link,
        })));

        const aiCandidates = parsed
          .filter(item => item.threat.source === 'keyword')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
          .slice(0, AI_CLASSIFY_MAX_PER_FEED);

        for (const item of aiCandidates) {
          if (!canQueueAiClassification(item.title)) continue;
          classifyWithAI(item.title, SITE_VARIANT).then((aiResult) => {
            if (aiResult && aiResult.confidence > item.threat.confidence) {
              item.threat = aiResult;
              item.isAlert = aiResult.level === 'critical' || aiResult.level === 'high';
            }
          }).catch(() => {});
        }

        return parsed;
      } catch (error) {
        lastError = error;

        if (attemptIndex < attemptUrls.length - 1 && shouldTryFallback(error)) {
          console.warn(`[RSS] ${feed.name} primary source failed, trying fallback ${attemptIndex + 1}/${attemptUrls.length - 1}`);
          continue;
        }

        if (error instanceof Error && error.message.startsWith('Parse error')) {
          console.warn(`Parse error for ${feed.name}`);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('RSS fetch failed');
  } catch (e) {
    console.error(`Failed to fetch ${feed.name}:`, e);
    recordFeedFailure(feed.name, {
      status: getErrorStatus(e),
      blocked: isBlockedError(e),
    });
    const persistent = await loadPersistentFeed(feed.name);
    return cached?.items || persistent || [];
  }
}

export async function fetchCategoryFeeds(
  feeds: Feed[],
  options: {
    batchSize?: number;
    onBatch?: (items: NewsItem[]) => void;
  } = {}
): Promise<NewsItem[]> {
  const topLimit = 20;
  const batchSize = options.batchSize ?? 5;
  const batches = chunkArray(feeds, batchSize);
  const topItems: NewsItem[] = [];
  let totalItems = 0;

  const ensureSortedDescending = () => [...topItems].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const insertTopItem = (item: NewsItem) => {
    totalItems += 1;
    if (topItems.length < topLimit) {
      topItems.push(item);
      if (topItems.length === topLimit) topItems.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
      return;
    }

    const itemTime = item.pubDate.getTime();
    if (itemTime <= topItems[0]!.pubDate.getTime()) return;

    topItems[0] = item;
    for (let i = 0; i < topItems.length - 1; i += 1) {
      if (topItems[i]!.pubDate.getTime() <= topItems[i + 1]!.pubDate.getTime()) break;
      [topItems[i], topItems[i + 1]] = [topItems[i + 1]!, topItems[i]!];
    }
  };

  for (const batch of batches) {
    const results = await Promise.all(batch.map(fetchFeed));
    results.forEach((feedItems, index) => {
      const feed = batch[index];
      if (!feed) return;
      logFinanceFeedResults(feed, feedItems);
    });
    results.flat().forEach(insertTopItem);
    options.onBatch?.(ensureSortedDescending());
  }

  if (totalItems > 0) {
    import('./data-freshness').then(({ dataFreshness }) => {
      dataFreshness.recordUpdate('rss', totalItems);
    });
  }

  return ensureSortedDescending();
}
