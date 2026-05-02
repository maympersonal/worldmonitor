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

export function normalizeYouTubeChannelRef(channelRef) {
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

export function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
