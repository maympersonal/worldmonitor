/**
 * Summarization Service with Fallback Chain
 * Server-side Redis caching handles cross-user deduplication
 * Fallback: Hugging Face -> Alibaba Qwen -> Browser T5
 */

import { mlWorker } from './ml-worker';
import { SITE_VARIANT } from '@/config';
import { isFeatureAvailable } from './runtime-config';

export type SummarizationProvider = 'huggingface' | 'alibaba' | 'browser' | 'cache';

export interface SummarizationResult {
  summary: string;
  provider: SummarizationProvider;
  cached: boolean;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

export interface GenerateSummaryOptions {
  allowBrowserFallback?: boolean;
}

function hasRemoteSummaryProvider(): boolean {
  return isFeatureAvailable('aiHuggingFace') || isFeatureAvailable('aiAlibabaQwen');
}

async function tryRemoteSummary(headlines: string[], geoContext?: string): Promise<SummarizationResult | null> {
  if (!hasRemoteSummaryProvider()) return null;
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'summary', headlines, mode: 'brief', geoContext, variant: SITE_VARIANT }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.fallback) return null;
      throw new Error(`AI provider error: ${response.status}`);
    }

    const data = await response.json();
    if (data.fallback || data.skipped || typeof data.summary !== 'string' || !data.summary.trim()) {
      return null;
    }

    const provider = data.cached
      ? 'cache'
      : data.provider === 'huggingface'
        ? 'huggingface'
        : 'alibaba';
    console.log(
      `[Summarization] ${provider === 'cache' ? 'Redis cache hit' : `${provider} success`}:`,
      data.model
    );
    return {
      summary: data.summary,
      provider: provider as SummarizationProvider,
      cached: !!data.cached,
    };
  } catch (error) {
    console.warn('[Summarization] Remote provider failed:', error);
    return null;
  }
}

async function tryBrowserT5(headlines: string[]): Promise<SummarizationResult | null> {
  try {
    if (!mlWorker.isAvailable) {
      console.log('[Summarization] Browser ML not available');
      return null;
    }

    const combinedText = headlines.slice(0, 6).map(h => h.slice(0, 80)).join('. ');
    const prompt = `Summarize the main themes from these news headlines in 2 sentences: ${combinedText}`;

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
  const remoteAvailable = hasRemoteSummaryProvider();
  const browserAvailable = allowBrowserFallback && mlWorker.isAvailable;

  if (!remoteAvailable && !browserAvailable) {
    console.log(
      allowBrowserFallback
        ? '[Summarization] No summary providers available'
        : '[Summarization] Remote provider unavailable and browser fallback disabled'
    );
    return null;
  }

  const totalSteps = allowBrowserFallback ? 2 : 1;

  // Step 1: Try the shared server route. It prefers Hugging Face, then DashScope.
  onProgress?.(1, totalSteps, 'Connecting to AI provider...');
  const remoteResult = await tryRemoteSummary(headlines, geoContext);
  if (remoteResult) {
    return remoteResult;
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
  const browserResult = await tryBrowserT5(headlines);
  if (browserResult) {
    return browserResult;
  }

  console.warn('[Summarization] All providers failed');
  return null;
}
