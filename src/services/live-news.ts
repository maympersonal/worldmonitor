export interface ChannelVideoResolution {
  videoId: string | null;
  isLive: boolean;
}

const liveVideoCache = new Map<string, { resolution: ChannelVideoResolution; timestamp: number }>();
const LIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for positive detections
const MISS_CACHE_TTL = 30 * 1000; // 30s for null results to retry quickly

function extractYouTubeChannelPath(channelRef: string): string {
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

export function normalizeYouTubeChannelRef(channelRef: string): string {
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

export function getYouTubeChannelUrl(channelRef: string): string {
  const normalized = normalizeYouTubeChannelRef(channelRef);
  return normalized ? `https://www.youtube.com/${normalized}` : 'https://www.youtube.com';
}

export async function fetchChannelVideo(channelRef: string): Promise<ChannelVideoResolution> {
  const normalizedChannelRef = normalizeYouTubeChannelRef(channelRef);
  if (!normalizedChannelRef) return { videoId: null, isLive: false };

  const cached = liveVideoCache.get(normalizedChannelRef);
  if (cached) {
    const ttl = cached.resolution.videoId ? LIVE_CACHE_TTL : MISS_CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.resolution;
    }
  }

  try {
    // Keep this same-origin so desktop dev does not hit cross-origin redirects
    // (worldmonitor.app -> www.worldmonitor.app) that browsers block via CORS.
    const res = await fetch(`/api/youtube/live?channel=${encodeURIComponent(normalizedChannelRef)}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const resolution: ChannelVideoResolution = {
      videoId: data.videoId || null,
      isLive: data.isLive === true,
    };
    liveVideoCache.set(normalizedChannelRef, { resolution, timestamp: Date.now() });
    return resolution;
  } catch (error) {
    console.warn(`[LiveNews] Failed to fetch live ID for ${normalizedChannelRef}:`, error);
    return { videoId: null, isLive: false };
  }
}
