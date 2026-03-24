import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const FEED_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const BLOCKED_FEED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const feedSnapshots = new Map();
const blockedFeeds = new Map();

function getFeedLocale(hostname) {
  const normalized = hostname.toLowerCase();
  if (
    normalized.includes('lasillavacia') ||
    normalized.includes('cubadebate') ||
    normalized.includes('prensalatina')
  ) {
    return 'es-ES,es;q=0.9,en;q=0.7';
  }
  return 'en-US,en;q=0.9';
}

function getFeedSnapshot(feedUrl) {
  const snapshot = feedSnapshots.get(feedUrl);
  if (!snapshot) return null;
  if (Date.now() - snapshot.timestamp > FEED_SNAPSHOT_TTL_MS) {
    feedSnapshots.delete(feedUrl);
    return null;
  }
  return snapshot;
}

function setFeedSnapshot(feedUrl, snapshot) {
  feedSnapshots.set(feedUrl, { ...snapshot, timestamp: Date.now() });
}

function getBlockedUntil(feedUrl) {
  const blockedUntil = blockedFeeds.get(feedUrl);
  if (!blockedUntil) return 0;
  if (Date.now() >= blockedUntil) {
    blockedFeeds.delete(feedUrl);
    return 0;
  }
  return blockedUntil;
}

function setBlockedFeed(feedUrl, cooldownMs = BLOCKED_FEED_COOLDOWN_MS) {
  blockedFeeds.set(feedUrl, Date.now() + cooldownMs);
}

function clearBlockedFeed(feedUrl) {
  blockedFeeds.delete(feedUrl);
}

function buildRequestHeaders(feedUrl, snapshot = null) {
  const parsed = new URL(feedUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const headers = {
    ...RSS_HEADERS,
    'Accept-Language': getFeedLocale(parsed.hostname),
    'Referer': `${origin}/`,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  if (snapshot?.etag) {
    headers['If-None-Match'] = snapshot.etag;
  }

  if (snapshot?.lastModified) {
    headers['If-Modified-Since'] = snapshot.lastModified;
  }

  return headers;
}

function looksLikeXml(contentType, data) {
  const lowerType = (contentType || '').toLowerCase();
  if (lowerType.includes('xml') || lowerType.includes('rss') || lowerType.includes('atom')) {
    return true;
  }

  const sample = data.trim().slice(0, 200).toLowerCase();
  return sample.startsWith('<?xml') || sample.includes('<rss') || sample.includes('<feed');
}

function buildSnapshotResponse(snapshot, corsHeaders, extraHeaders = {}) {
  return new Response(snapshot.body, {
    status: 200,
    headers: {
      'Content-Type': snapshot.contentType || 'application/xml',
      'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=300',
      'X-Cache': 'SNAPSHOT-HIT',
      ...extraHeaders,
      ...corsHeaders,
    },
  });
}

// Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Allowed RSS feed domains for security
const ALLOWED_DOMAINS = [
  'feeds.bbci.co.uk',
  'www.theguardian.com',
  'feeds.npr.org',
  'news.google.com',
  'www.aljazeera.com',
  'rss.cnn.com',
  'hnrss.org',
  'feeds.arstechnica.com',
  'www.theverge.com',
  'www.cnbc.com',
  'feeds.marketwatch.com',
  'www.defenseone.com',
  'breakingdefense.com',
  'www.bellingcat.com',
  'techcrunch.com',
  'huggingface.co',
  'www.technologyreview.com',
  'rss.arxiv.org',
  'export.arxiv.org',
  'www.federalreserve.gov',
  'www.sec.gov',
  'www.whitehouse.gov',
  'www.state.gov',
  'www.defense.gov',
  'home.treasury.gov',
  'www.justice.gov',
  'tools.cdc.gov',
  'www.fema.gov',
  'www.dhs.gov',
  'www.thedrive.com',
  'krebsonsecurity.com',
  'finance.yahoo.com',
  'thediplomat.com',
  'venturebeat.com',
  'foreignpolicy.com',
  'www.ft.com',
  'openai.com',
  'www.reutersagency.com',
  'feeds.reuters.com',
  'rsshub.app',
  'asia.nikkei.com',
  'www.cfr.org',
  'www.csis.org',
  'www.politico.com',
  'www.brookings.edu',
  'layoffs.fyi',
  'www.defensenews.com',
  'www.foreignaffairs.com',
  'www.atlanticcouncil.org',
  // Tech variant domains
  'www.zdnet.com',
  'www.techmeme.com',
  'www.darkreading.com',
  'www.schneier.com',
  'rss.politico.com',
  'www.anandtech.com',
  'www.tomshardware.com',
  'www.semianalysis.com',
  'feed.infoq.com',
  'thenewstack.io',
  'devops.com',
  'dev.to',
  'lobste.rs',
  'changelog.com',
  'seekingalpha.com',
  'news.crunchbase.com',
  'www.saastr.com',
  'feeds.feedburner.com',
  // Additional tech variant domains
  'www.producthunt.com',
  'www.axios.com',
  'github.blog',
  'githubnext.com',
  'mshibanami.github.io',
  'www.engadget.com',
  'news.mit.edu',
  'dev.events',
  // VC blogs
  'www.ycombinator.com',
  'a16z.com',
  'review.firstround.com',
  'www.sequoiacap.com',
  'www.nfx.com',
  'www.aaronsw.com',
  'bothsidesofthetable.com',
  'www.lennysnewsletter.com',
  'stratechery.com',
  // Regional startup news
  'www.eu-startups.com',
  'tech.eu',
  'sifted.eu',
  'www.techinasia.com',
  'kr-asia.com',
  'techcabal.com',
  'disrupt-africa.com',
  'lavca.org',
  'contxto.com',
  'inc42.com',
  'yourstory.com',
  // Funding & VC
  'pitchbook.com',
  'www.cbinsights.com',
  // Accelerators
  'www.techstars.com',
  // Middle East & Regional News
  'english.alarabiya.net',
  'www.arabnews.com',
  'www.timesofisrael.com',
  'www.scmp.com',
  'kyivindependent.com',
  'www.themoscowtimes.com',
  'feeds.24.com',
  'feeds.capi24.com',  // News24 redirect destination
  // International Organizations
  'news.un.org',
  'www.iaea.org',
  'www.who.int',
  'www.cisa.gov',
  'www.crisisgroup.org',
  // Think Tanks & Research (Added 2026-01-29)
  'rusi.org',
  'warontherocks.com',
  'www.aei.org',
  'responsiblestatecraft.org',
  'www.fpri.org',
  'jamestown.org',
  'www.chathamhouse.org',
  'ecfr.eu',
  'www.gmfus.org',
  'www.wilsoncenter.org',
  'www.lowyinstitute.org',
  'www.mei.edu',
  'www.stimson.org',
  'www.cnas.org',
  'carnegieendowment.org',
  'www.rand.org',
  'fas.org',
  'www.armscontrol.org',
  'www.nti.org',
  'thebulletin.org',
  'www.iss.europa.eu',
  // Economic & Food Security
  'www.fao.org',
  'worldbank.org',
  'www.imf.org',
  // Additional
  'news.ycombinator.com',
  // Finance variant
  'seekingalpha.com',
  'www.coindesk.com',
  'cointelegraph.com',
  // Cuba
  'www.cubadebate.cu',
  "www.granma.cu",
  "www.juventudrebelde.cu",
  "www.trabajadores.cu",
  "www.tribuna.cu",
  "www.prensa-latina.cu",
  // Cuba alterno
];
const ALLOWED_DOMAIN_SET = new Set(ALLOWED_DOMAINS);

function isAllowedHostname(hostname) {
  return ALLOWED_DOMAIN_SET.has(hostname);
}

async function fetchFeedResponse(feedUrl, timeoutMs) {
  let currentUrl = feedUrl;
  const snapshot = getFeedSnapshot(feedUrl);
  let conditionalHeaders = snapshot ? buildRequestHeaders(feedUrl, snapshot) : null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchWithTimeout(currentUrl, {
      headers: conditionalHeaders || buildRequestHeaders(currentUrl),
      redirect: 'manual',
    }, timeoutMs);

    conditionalHeaders = null;

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    const redirectUrl = new URL(location, currentUrl);
    if (!isAllowedHostname(redirectUrl.hostname)) {
      throw new Error(`Redirect to disallowed domain: ${redirectUrl.hostname}`);
    }

    currentUrl = redirectUrl.href;
  }

  throw new Error('Too many redirects');
}

async function fetchFeedWithRetry(feedUrl, timeoutMs) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchFeedResponse(feedUrl, timeoutMs);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Feed fetch failed');
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const requestUrl = new URL(req.url);
  const feedUrl = requestUrl.searchParams.get('url');

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const parsedUrl = new URL(feedUrl);
    const snapshot = getFeedSnapshot(feedUrl);
    const blockedUntil = getBlockedUntil(feedUrl);

    // Security: Check if domain is allowed
    if (!isAllowedHostname(parsedUrl.hostname)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (blockedUntil > 0) {
      const retryAfterSeconds = Math.max(60, Math.ceil((blockedUntil - Date.now()) / 1000));
      if (snapshot) {
        return buildSnapshotResponse(snapshot, corsHeaders, {
          'Retry-After': String(retryAfterSeconds),
          'X-Feed-State': 'blocked-stale',
        });
      }

      return new Response(JSON.stringify({
        error: 'Feed temporarily blocked by upstream',
        url: feedUrl,
        retryAfter: retryAfterSeconds,
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
          'X-Feed-State': 'blocked',
          ...corsHeaders,
        },
      });
    }

    // Google News is slow - use longer timeout
    const isGoogleNews = feedUrl.includes('news.google.com');
    const timeout = isGoogleNews ? 20000 : 12000;

    const response = await fetchFeedWithRetry(feedUrl, timeout);

    if (response.status === 304 && snapshot) {
      return buildSnapshotResponse(snapshot, corsHeaders, { 'X-Feed-State': 'not-modified' });
    }

    const data = await response.text();

    if (!response.ok) {
      const details = data.trim().slice(0, 500);
      const upstreamStatus = response.status;

      console.warn('[RSS PROXY] upstream response not ok', {
        url: feedUrl,
        finalUrl: response.url,
        status: upstreamStatus,
        contentType: response.headers.get('content-type'),
        bodyPreview: details,
      });

      if (upstreamStatus === 403) {
        setBlockedFeed(feedUrl);
      }

      return new Response(JSON.stringify({
        error: 'Upstream feed error',
        details: details || `HTTP ${upstreamStatus}`,
        status: upstreamStatus,
        url: feedUrl,
      }), {
        status: upstreamStatus,
        headers: {
          'Content-Type': 'application/json',
          ...(upstreamStatus === 403 ? {
            'Retry-After': String(BLOCKED_FEED_COOLDOWN_MS / 1000),
            'X-Feed-State': 'blocked',
          } : {}),
          ...corsHeaders,
        },
      });
    }

    const contentType = response.headers.get('content-type') || 'application/xml';
    clearBlockedFeed(feedUrl);

    if (looksLikeXml(contentType, data)) {
      setFeedSnapshot(feedUrl, {
        body: data,
        contentType,
        etag: response.headers.get('etag') || '',
        lastModified: response.headers.get('last-modified') || '',
      });
    }

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('RSS proxy error:', feedUrl, message);
    return new Response(JSON.stringify({
      error: isTimeout ? 'Feed timeout' : 'Failed to fetch feed',
      details: message,
      url: feedUrl,
    }), {
      status: isTimeout ? 504 : 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
