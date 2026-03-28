// YouTube Live Stream Detection API
// Uses YouTube's oembed endpoint to check for live streams

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const cors = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403, headers: cors });
  }
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel');

  if (!channel) {
    return new Response(JSON.stringify({ error: 'Missing channel parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Try to fetch the channel's live page
    const channelHandle = channel.startsWith('@') ? channel : `@${channel}`;
    const liveUrl = `https://www.youtube.com/${channelHandle}/live`;

    const response = await fetch(liveUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ videoId: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();
    const finalUrl = response.url ? new URL(response.url) : null;
    const redirectedVideoId = finalUrl?.searchParams.get('v') || null;
    const validRedirectedId = redirectedVideoId && /^[A-Za-z0-9_-]{11}$/.test(redirectedVideoId)
      ? redirectedVideoId
      : null;

    // Extract video ID from the page
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const isLiveMatch = /"isLive":\s*true/.test(html) || /"isLiveNow":\s*true/.test(html);
    const detectedVideoId = validRedirectedId || videoIdMatch?.[1] || null;
    const isLive = Boolean(validRedirectedId || (isLiveMatch && detectedVideoId));

    if (detectedVideoId && isLive) {
      return new Response(JSON.stringify({ videoId: detectedVideoId, isLive: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60', // Cache for 5 minutes
        },
      });
    }

    // Return null if no live stream found
    return new Response(JSON.stringify({ videoId: null, isLive: false }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('YouTube live check error:', error);
    return new Response(JSON.stringify({ videoId: null, error: error.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
