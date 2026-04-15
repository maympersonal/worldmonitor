import { isDesktopRuntime, toRuntimeUrl } from '../services/runtime';

const isDev = import.meta.env.DEV;
const DEFAULT_PROXY_FETCH_TIMEOUT_MS = 25_000;

// In production browser deployments, routes are handled by Vercel serverless functions.
// In local dev, Vite proxy handles these routes.
// In Tauri desktop mode, route requests need an absolute remote host.
export function proxyUrl(localPath: string): string {
  if (isDesktopRuntime()) {
    return toRuntimeUrl(localPath);
  }

  if (isDev) {
    return localPath;
  }

  return localPath;
}

function createTimeoutError(url: string, timeoutMs: number): Error {
  const error = new Error(`Request timed out after ${timeoutMs}ms (${url})`);
  error.name = 'TimeoutError';
  return error;
}

export async function fetchWithProxy(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROXY_FETCH_TIMEOUT_MS
): Promise<Response> {
  const finalUrl = proxyUrl(url);
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let removeAbortListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
    }
  }

  try {
    return await fetch(finalUrl, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !externalSignal?.aborted) {
      throw createTimeoutError(finalUrl, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}
