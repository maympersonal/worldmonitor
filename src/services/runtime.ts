const DEFAULT_REMOTE_HOSTS: Record<string, string> = {
  finance: 'https://finance.worldmonitor.app',
  tech: 'https://tech.worldmonitor.app',
  full: 'https://worldmonitor.app',
  world: 'https://worldmonitor.app',
};

const DEFAULT_LOCAL_API_BASE = 'http://127.0.0.1:46123';
const FORCE_DESKTOP_RUNTIME = import.meta.env.VITE_DESKTOP_RUNTIME === '1';
const LOCAL_API_TOKEN_MAX_ATTEMPTS = 8;
const LOCAL_API_TOKEN_RETRY_DELAY_MS = 75;
const LOCAL_API_BYPASS_COOLDOWN_MS = 30_000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

type RuntimeProbe = {
  hasTauriGlobals: boolean;
  userAgent: string;
  locationProtocol: string;
  locationHost: string;
  locationOrigin: string;
};

export function detectDesktopRuntime(probe: RuntimeProbe): boolean {
  const tauriInUserAgent = probe.userAgent.includes('Tauri');
  const secureLocalhostOrigin = (
    probe.locationProtocol === 'https:' && (
      probe.locationHost === 'localhost' ||
      probe.locationHost.startsWith('localhost:') ||
      probe.locationHost === '127.0.0.1' ||
      probe.locationHost.startsWith('127.0.0.1:')
    )
  );

  // Tauri production windows can expose tauri-like hosts/schemes without
  // always exposing bridge globals at first paint.
  const tauriLikeLocation = (
    probe.locationProtocol === 'tauri:' ||
    probe.locationProtocol === 'asset:' ||
    probe.locationHost === 'tauri.localhost' ||
    probe.locationHost.endsWith('.tauri.localhost') ||
    probe.locationOrigin.startsWith('tauri://') ||
    secureLocalhostOrigin
  );

  return probe.hasTauriGlobals || tauriInUserAgent || tauriLikeLocation;
}

export function isDesktopRuntime(): boolean {
  if (FORCE_DESKTOP_RUNTIME) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return detectDesktopRuntime({
    hasTauriGlobals: '__TAURI_INTERNALS__' in window || '__TAURI__' in window,
    userAgent: window.navigator?.userAgent ?? '',
    locationProtocol: window.location?.protocol ?? '',
    locationHost: window.location?.host ?? '',
    locationOrigin: window.location?.origin ?? '',
  });
}

export function getApiBaseUrl(): string {
  if (!isDesktopRuntime()) {
    return '';
  }

  const configuredBaseUrl = import.meta.env.VITE_TAURI_API_BASE_URL;
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  return DEFAULT_LOCAL_API_BASE;
}

export function getRemoteApiBaseUrl(): string {
  const configuredRemoteBase = import.meta.env.VITE_TAURI_REMOTE_API_BASE_URL;
  if (configuredRemoteBase) {
    return normalizeBaseUrl(configuredRemoteBase);
  }

  const variant = import.meta.env.VITE_VARIANT || 'full';
  return DEFAULT_REMOTE_HOSTS[variant] ?? DEFAULT_REMOTE_HOSTS.full ?? 'https://worldmonitor.app';
}

export function toRuntimeUrl(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path}`;
}

const LOCAL_API_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'tauri.localhost',
]);

function isLocalApiOriginUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    return LOCAL_API_HOSTS.has(host) || host.endsWith('.tauri.localhost');
  } catch {
    return false;
  }
}

function getApiTargetFromRequestInput(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    if (input.startsWith('/')) return input;
    if (isLocalApiOriginUrl(input)) {
      const u = new URL(input);
      return `${u.pathname}${u.search}`;
    }
    return null;
  }

  if (input instanceof URL) {
    if (isLocalApiOriginUrl(input.href)) {
      return `${input.pathname}${input.search}`;
    }
    return null;
  }

  if (isLocalApiOriginUrl(input.url)) {
    const u = new URL(input.url);
    return `${u.pathname}${u.search}`;
  }
  return null;
}

function isTokenOptionalRoute(target: string): boolean {
  return target === '/api/service-status'
    || target === '/api/local-status'
    || target === '/api/local-traffic-log'
    || target === '/api/local-debug-toggle';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLocalWithStartupRetry(
  nativeFetch: typeof window.fetch,
  localUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const maxAttempts = 4;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await nativeFetch(localUrl, init);
    } catch (error) {
      lastError = error;

      // Preserve caller intent for aborted requests.
      if (init?.signal?.aborted) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      await sleep(125 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Local API unavailable');
}

function isLocalOnlyRoute(target: string): boolean {
  return target === '/api/service-status'
    || target === '/api/local-status'
    || target === '/api/local-traffic-log'
    || target === '/api/local-debug-toggle'
    || target === '/api/local-env-update'
    || target === '/api/local-validate-secret';
}

function shouldUseSameOriginApiFallback(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (!import.meta.env.DEV) {
    return false;
  }

  const host = window.location?.hostname ?? '';
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === 'tauri.localhost'
    || host.endsWith('.tauri.localhost');
}

export function installRuntimeFetchPatch(): void {
  if (!isDesktopRuntime() || typeof window === 'undefined' || (window as unknown as Record<string, unknown>).__wmFetchPatched) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const localBase = getApiBaseUrl();
  const fallbackBase = getRemoteApiBaseUrl();
  const preferSameOriginFallback = shouldUseSameOriginApiFallback();
  let localApiToken: string | null = null;
  let localApiTokenPromise: Promise<string | null> | null = null;
  let localApiBypassUntil = 0;
  let localApiFailureCount = 0;

  const getFallbackUrl = (target: string): string => {
    if (preferSameOriginFallback) {
      return target;
    }

    return `${fallbackBase}${target}`;
  };

  const fetchFallback = async (
    target: string,
    init: RequestInit | undefined,
    reason: string,
    debug: boolean,
  ): Promise<Response> => {
    const fallbackUrl = getFallbackUrl(target);
    if (debug) {
      console.warn(`[runtime] Falling back to ${fallbackUrl} for ${target} (${reason})`);
    }

    return nativeFetch(fallbackUrl, init);
  };

  const markLocalApiUnavailable = (
    target: string,
    error: unknown,
    debug: boolean,
  ): void => {
    localApiFailureCount += 1;
    const cooldownMs = Math.min(
      LOCAL_API_BYPASS_COOLDOWN_MS * localApiFailureCount,
      5 * 60 * 1000,
    );
    localApiBypassUntil = Date.now() + cooldownMs;

    if (debug) {
      console.warn(`[runtime] Local API unavailable for ${target}; bypassing for ${cooldownMs}ms`, error);
    }
  };

  const resolveLocalApiToken = async (): Promise<string | null> => {
    if (localApiToken) {
      return localApiToken;
    }

    if (!localApiTokenPromise) {
      localApiTokenPromise = (async () => {
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= LOCAL_API_TOKEN_MAX_ATTEMPTS; attempt += 1) {
          try {
            const { invokeTauri } = await import('@/services/tauri-bridge');
            const token = (await invokeTauri<string>('get_local_api_token')).trim();
            if (token) {
              localApiToken = token;
              return token;
            }
          } catch (error) {
            lastError = error;
          }

          if (attempt < LOCAL_API_TOKEN_MAX_ATTEMPTS) {
            await sleep(LOCAL_API_TOKEN_RETRY_DELAY_MS * attempt);
          }
        }

        if (lastError) {
          console.warn('[runtime] Local API token unavailable after startup retry', lastError);
        }

        return null;
      })().finally(() => {
        localApiTokenPromise = null;
      });
    }

    return localApiTokenPromise;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = getApiTargetFromRequestInput(input);
    const debug = localStorage.getItem('wm-debug-log') === '1';

    if (!target?.startsWith('/api/')) {
      if (debug) {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        console.log(`[fetch] passthrough -> ${raw.slice(0, 120)}`);
      }
      return nativeFetch(input, init);
    }

    if (Date.now() < localApiBypassUntil && !isLocalOnlyRoute(target)) {
      return fetchFallback(target, init, 'local API cooldown active', debug);
    }

    if (!localApiToken) {
      localApiToken = await resolveLocalApiToken();
    }

    if (!localApiToken && !isTokenOptionalRoute(target)) {
      markLocalApiUnavailable(target, new Error('Local API token unavailable'), debug);

      if (!isLocalOnlyRoute(target)) {
        try {
          return await fetchFallback(target, init, 'local API token unavailable', debug);
        } catch (fallbackError) {
          if (debug) {
            console.warn(`[runtime] Fallback fetch failed for ${target}`, fallbackError);
          }
        }
      }

      return new Response(JSON.stringify({
        error: 'Local desktop API token unavailable',
        target,
      }), {
        status: 503,
        headers: {
          'content-type': 'application/json',
        },
      });
    }

    const headers = new Headers(init?.headers);
    if (localApiToken) {
      headers.set('Authorization', `Bearer ${localApiToken}`);
    }
    const localInit = { ...init, headers };

    const localUrl = `${localBase}${target}`;
    if (debug) {
      console.log(`[fetch] intercept -> ${target}`);
    }

    try {
      const t0 = performance.now();
      const response = await fetchLocalWithStartupRetry(nativeFetch, localUrl, localInit);
      localApiFailureCount = 0;
      localApiBypassUntil = 0;
      if (debug) {
        console.log(`[fetch] ${target} -> ${response.status} (${Math.round(performance.now() - t0)}ms)`);
      }
      return response;
    } catch (error) {
      markLocalApiUnavailable(target, error, debug);

      if (!isLocalOnlyRoute(target)) {
        try {
          return await fetchFallback(target, init, 'local API unavailable', debug);
        } catch (fallbackError) {
          if (debug) {
            console.warn(`[runtime] Fallback fetch failed for ${target}`, fallbackError);
          }
        }
      }

      return new Response(JSON.stringify({
        error: 'Local desktop API unavailable',
        target,
      }), {
        status: 503,
        headers: {
          'content-type': 'application/json',
        },
      });
    }
  };

  (window as unknown as Record<string, unknown>).__wmFetchPatched = true;
}
