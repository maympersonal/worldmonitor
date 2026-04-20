// YouTube Live Stream Detection API
// Fetches channel live/streams pages and extracts active video IDs

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { Innertube } from 'youtubei.js';

let innertubePromise = null;
let testYouTubeiResolver = null;

function extractYouTubeChannelPath(channelRef) {
  const trimmed = channelRef.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
        return `${parsed.pathname}${parsed.search}`.replace(/^\/+/, '');
      }
    } catch {
      // Fall through to raw path handling below.
    }
  }

  return trimmed.replace(/^\/+/, '');
}

function normalizeYouTubeChannelRef(channelRef) {
  const normalized = extractYouTubeChannelPath(channelRef);
  if (!normalized) return '';

  if (/^@[^/]+$/u.test(normalized)) {
    return `${normalized}/live`;
  }

  if (/^(?:channel|c|user)\/[^/]+$/u.test(normalized)) {
    return `${normalized}/streams`;
  }

  if (/^(?:@|channel\/|c\/|user\/)/u.test(normalized)) {
    return normalized;
  }

  return `@${normalized}/live`;
}

function isValidVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function extractVideoEntries(channelTab) {
  const contents = channelTab?.current_tab?.content?.contents;
  if (!Array.isArray(contents)) return [];

  return contents
    .map((item) => item?.content ?? item)
    .filter((item) => item && isValidVideoId(item.video_id));
}

export function pickBestChannelVideo(channelTab) {
  const videos = extractVideoEntries(channelTab);
  if (videos.length === 0) return null;

  const liveVideo = videos.find((video) => video.is_live === true);
  const selected = liveVideo || videos[0];

  if (!selected) return null;

  return {
    videoId: selected.video_id,
    isLive: selected.is_live === true,
  };
}

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = Innertube.create().catch((error) => {
      innertubePromise = null;
      throw error;
    });
  }

  return innertubePromise;
}

export async function resolveChannelVideoWithYoutubei(normalizedChannelRef) {
  const yt = await getInnertube();
  const targetUrl = `https://www.youtube.com/${normalizedChannelRef}`;
  const resolved = await yt.resolveURL(targetUrl);
  const browseId = resolved?.payload?.browseId;

  if (!browseId) return null;

  const channel = await yt.getChannel(browseId);
  const liveStreamsTab = channel.has_live_streams ? await channel.getLiveStreams() : channel;

  return pickBestChannelVideo(liveStreamsTab);
}

export async function resolveChannelVideoFromHtml(normalizedChannelRef) {
  const liveUrl = `https://www.youtube.com/${normalizedChannelRef}`;

  const response = await fetch(liveUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    return { videoId: null, isLive: false, source: 'html' };
  }

  const html = await response.text();
  const finalUrl = response.url ? new URL(response.url) : null;
  const redirectedVideoId = finalUrl?.searchParams.get('v') || null;
  const validRedirectedId = isValidVideoId(redirectedVideoId) ? redirectedVideoId : null;

  // Extract video ID from the page
  const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  const isLiveMatch = /"isLive":\s*true/.test(html) || /"isLiveNow":\s*true/.test(html);
  const detectedVideoId = validRedirectedId || videoIdMatch?.[1] || null;
  const isLive = Boolean(validRedirectedId || (isLiveMatch && detectedVideoId));

  return {
    videoId: detectedVideoId,
    isLive,
    source: 'html',
  };
}

export async function resolveChannelVideo(
  normalizedChannelRef,
  {
    youtubeiResolver = testYouTubeiResolver || resolveChannelVideoWithYoutubei,
    htmlResolver = resolveChannelVideoFromHtml,
  } = {},
) {
  try {
    const youtubeiResult = await youtubeiResolver(normalizedChannelRef);
    if (youtubeiResult?.videoId) {
      return { ...youtubeiResult, source: 'youtubei' };
    }
  } catch (error) {
    console.warn('[YouTube live] youtubei resolver failed:', error);
  }

  return htmlResolver(normalizedChannelRef);
}

export function __setYouTubeiResolverForTests(resolver) {
  testYouTubeiResolver = resolver;
}

export function __resetYouTubeiResolverForTests() {
  testYouTubeiResolver = null;
}

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel');

  if (!channel) {
    return new Response(JSON.stringify({ error: 'Missing channel parameter' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const normalizedChannelRef = normalizeYouTubeChannelRef(channel);
    if (!normalizedChannelRef) {
      return new Response(JSON.stringify({ error: 'Invalid channel parameter' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const resolved = await resolveChannelVideo(normalizedChannelRef);

    return new Response(JSON.stringify({
      videoId: resolved.videoId || null,
      isLive: resolved.isLive === true,
      source: resolved.source || 'unknown',
    }), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('YouTube live check error:', error);
    return new Response(JSON.stringify({ videoId: null, error: error.message }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
