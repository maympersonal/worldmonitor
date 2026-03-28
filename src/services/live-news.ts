const liveVideoCache = new Map<string, { videoId: string | null; timestamp: number }>();
const LIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for positive detections
const MISS_CACHE_TTL = 30 * 1000; // 30s for null results to retry quickly

export async function fetchLiveVideoId(channelHandle: string): Promise<string | null> {
  const cached = liveVideoCache.get(channelHandle);
  if (cached) {
    const ttl = cached.videoId ? LIVE_CACHE_TTL : MISS_CACHE_TTL;
    if (Date.now() - cached.timestamp < ttl) {
      return cached.videoId;
    }
  }

  try {
    // Keep this same-origin so desktop dev does not hit cross-origin redirects
    // (worldmonitor.app -> www.worldmonitor.app) that browsers block via CORS.
    const res = await fetch(`/api/youtube/live?channel=${encodeURIComponent(channelHandle)}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const videoId = data.videoId || null;
    liveVideoCache.set(channelHandle, { videoId, timestamp: Date.now() });
    return videoId;
  } catch (error) {
    console.warn(`[LiveNews] Failed to fetch live ID for ${channelHandle}:`, error);
    return null;
  }
}
