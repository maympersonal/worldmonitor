/**
 * Summarization Service with Fallback Chain
 * Server-side Redis caching handles cross-user deduplication
 * Default fallback: Hugging Face -> Alibaba Qwen -> Browser T5
 * Opt-in fallback: LocalAI -> Browser T5
 */

import { mlWorker } from './ml-worker';
import { SITE_VARIANT } from '@/config';
import { isFeatureAvailable } from './runtime-config';

export type SummarizationProvider = 'localai' | 'huggingface' | 'alibaba' | 'browser' | 'cache';

export interface SummarizationResult {
  summary: string;
  provider: SummarizationProvider;
  cached: boolean;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

export interface GenerateSummaryOptions {
  allowBrowserFallback?: boolean;
  allowLocalAi?: boolean;
}

const REMOTE_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const REMOTE_QUOTA_COOLDOWN_KEY = 'summary:remote-quota-cooldown-until';
let remoteQuotaCooldownUntil = readRemoteQuotaCooldown();

function readRemoteQuotaCooldown(): number {
  try {
    const value = Number(localStorage.getItem(REMOTE_QUOTA_COOLDOWN_KEY) || '0');
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function isRemoteQuotaCoolingDown(): boolean {
  return Date.now() < remoteQuotaCooldownUntil;
}

function markRemoteQuotaExhausted(retryAfterSeconds?: number): void {
  const retryAfterMs = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, Number(retryAfterSeconds) * 1000)
    : REMOTE_QUOTA_COOLDOWN_MS;
  remoteQuotaCooldownUntil = Date.now() + retryAfterMs;
  try {
    localStorage.setItem(REMOTE_QUOTA_COOLDOWN_KEY, String(remoteQuotaCooldownUntil));
  } catch {
    // Ignore storage failures; the in-memory cooldown still prevents spam.
  }
  console.warn(`[Summarization] Remote AI quota exhausted; using browser fallback for ${Math.ceil(retryAfterMs / 60000)} minutes`);
}

function getRetryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('Retry-After') || '');
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function hasRemoteSummaryProvider(): boolean {
  return isFeatureAvailable('aiHuggingFace') || isFeatureAvailable('aiAlibabaQwen');
}

async function tryRemoteSummary(
  headlines: string[],
  geoContext?: string,
  localAiOnly = false
): Promise<SummarizationResult | null> {
  if ((!localAiOnly && !hasRemoteSummaryProvider()) || isRemoteQuotaCoolingDown()) return null;
  try {
    if (localAiOnly) {
      console.log('[Summarization][LocalAI] Solicitando resumen al backend', {
        headlineCount: headlines.length,
        geoContext,
        variant: SITE_VARIANT,
      });
    }
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'summary',
        headlines,
        mode: 'brief',
        geoContext,
        variant: SITE_VARIANT,
        ...(localAiOnly ? { allowLocalAi: true, localAiOnly: true } : {}),
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 402 || data.quotaExhausted) markRemoteQuotaExhausted(getRetryAfterSeconds(response));
      if (data.fallback) return null;
      throw new Error(`AI provider error: ${response.status}`);
    }

    const data = await response.json();
    if (data.quotaExhausted) {
      markRemoteQuotaExhausted(getRetryAfterSeconds(response));
      return null;
    }
    if (data.fallback || data.skipped || typeof data.summary !== 'string' || !data.summary.trim()) {
      if (localAiOnly) {
        console.warn('[Summarization][LocalAI] El backend no generó un resumen', data);
      }
      return null;
    }

    const provider = data.cached
      ? 'cache'
      : data.provider === 'localai'
        ? 'localai'
        : data.provider === 'huggingface'
        ? 'huggingface'
        : 'alibaba';
    console.log(
      `[Summarization] ${provider === 'cache' ? 'Redis cache hit' : `${provider} success`}:`,
      data.model
    );
    if (localAiOnly) {
      console.log('[Summarization][LocalAI] Resultado recibido', {
        provider,
        model: data.model,
        cached: Boolean(data.cached),
        summary: data.summary,
      });
    }
    return {
      summary: data.summary,
      provider: provider as SummarizationProvider,
      cached: !!data.cached,
    };
  } catch (error) {
    console.warn(`[Summarization] ${localAiOnly ? 'LocalAI' : 'Remote provider'} failed:`, error);
    return null;
  }
}

async function tryBrowserT5(headlines: string[], geoContext?: string): Promise<SummarizationResult | null> {
  try {
    if (!mlWorker.isAvailable) {
      const ready = await mlWorker.init();
      if (!ready) {
        console.log('[Summarization] Browser ML not available');
        return null;
      }
    }

    const combinedText = headlines.slice(0, 8).map(h => h.slice(0, 140)).join('. ');
    const prompt = geoContext
      ? `Resume en español los siguientes titulares respetando estrictamente estas instrucciones. ${geoContext} Titulares fuente: ${combinedText}`
      : `Summarize the main themes from these news headlines in 2 sentences: ${combinedText}`;

    const [summary] = await mlWorker.summarize([prompt]);

    if (!summary || summary.length < 20 || summary.toLowerCase().includes('summarize')) {
      return null;
    }

    console.log('[Summarization] Browser T5 success');
    return {
      summary,
      provider: 'browser',
      cached: false,
    };
  } catch (error) {
    console.warn('[Summarization] Browser T5 failed:', error);
    return null;
  }
}

/**
 * Generate a summary using the fallback chain: Hugging Face -> Alibaba Qwen -> Browser T5
 * Server-side Redis caching is handled by the API endpoints
 * @param geoContext Optional geographic signal context to include in the prompt
 */
export async function generateSummary(
  headlines: string[],
  onProgress?: ProgressCallback,
  geoContext?: string,
  options: GenerateSummaryOptions = {}
): Promise<SummarizationResult | null> {
  if (!headlines || headlines.length < 2) {
    return null;
  }

  const allowBrowserFallback = options.allowBrowserFallback ?? true;
  const allowLocalAi = options.allowLocalAi === true;
  const remoteAvailable = (allowLocalAi || hasRemoteSummaryProvider()) && !isRemoteQuotaCoolingDown();

  if (!remoteAvailable && !allowBrowserFallback) {
    console.log(
      allowBrowserFallback
        ? '[Summarization] No summary providers available'
        : '[Summarization] Remote provider unavailable and browser fallback disabled'
    );
    return null;
  }

  const totalSteps = allowBrowserFallback ? 2 : 1;

  if (remoteAvailable) {
    onProgress?.(1, totalSteps, allowLocalAi ? 'Connecting to LocalAI...' : 'Connecting to AI provider...');
    const remoteResult = await tryRemoteSummary(headlines, geoContext, allowLocalAi);
    if (remoteResult) {
      return remoteResult;
    }
  }

  if (!allowBrowserFallback) {
    if (remoteAvailable) {
      console.log('[Summarization] Browser fallback skipped for this request');
      console.warn('[Summarization] Remote provider failed');
    }
    return null;
  }

  // Step 2: Try Browser T5 (local, unlimited but slower)
  onProgress?.(2, totalSteps, 'Loading local AI model...');
  const browserResult = await tryBrowserT5(headlines, geoContext);
  if (browserResult) {
    return browserResult;
  }

  console.warn('[Summarization] All providers failed');
  return null;
}
