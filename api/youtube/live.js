// YouTube Live Stream Detection API
// Fetches channel live/streams pages and extracts active video IDs

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { Innertube, Log } from 'youtubei.js';
import {
  getErrorMessage,
  normalizeYouTubeChannelRef,
  pickBestChannelVideo,
  resolveChannelVideoFromHtml,
} from './live-shared.js';

let innertubePromise = null;
let testYouTubeiResolver = null;
let youtubeLogLevelConfigured = false;
export {
  normalizeYouTubeChannelRef,
  pickBestChannelVideo,
  resolveChannelVideoFromHtml,
} from './live-shared.js';

function configureYoutubeLogs() {
  if (youtubeLogLevelConfigured) return;
  Log.setLevel(Log.Level.ERROR);
  youtubeLogLevelConfigured = true;
}

async function getInnertube() {
  configureYoutubeLogs();
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
    console.warn('[YouTube live] youtubei resolver failed:', getErrorMessage(error));
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
    const message = getErrorMessage(error);
    console.warn('[YouTube live] Returning offline result:', message);
    return new Response(JSON.stringify({ videoId: null, isLive: false, error: message }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
