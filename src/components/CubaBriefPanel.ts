import { Panel } from './Panel';
import { generateSummary } from '@/services/summarization';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { escapeHtml } from '@/utils/sanitize';
import { isMobileDevice } from '@/utils';
import type { NewsItem } from '@/types';

interface CubaBriefRefreshRequest {
  signature: string;
  titles: string[];
  allowBrowserFallback: boolean;
}

export class CubaBriefPanel extends Panel {
  private static readonly BRIEF_CACHE_KEY = 'summary:cuba-general-brief-v2';
  private static readonly BRIEF_COOLDOWN_MS = 120000;
  private static readonly BRIEF_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly MAX_VISIBLE_SOURCES = 8;

  private cubaNews: NewsItem[] = [];
  private cubaBrief: string | null = null;
  private headlineSignature = '';
  private briefSignature = '';
  private lastBriefUpdate = 0;
  private isHidden = false;
  private refreshInFlight = false;
  private pendingRefresh: CubaBriefRefreshRequest | null = null;

  constructor() {
    super({
      id: 'cuba-brief',
      title: 'Situación General de Cuba',
      showCount: false,
    });

    if (isMobileDevice()) {
      this.hide();
      this.isHidden = true;
    }

    this.render();
  }

  public setCubaNews(items: NewsItem[], options: { allowBrowserFallback?: boolean } = {}): void {
    const nextItems = items
      .slice()
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    const nextSignature = nextItems
      .slice(0, 8)
      .map(item => item.title.trim().toLowerCase())
      .join('|');

    this.cubaNews = nextItems;
    this.headlineSignature = nextSignature;
    this.render();

    if (nextItems.length < 2) {
      this.cubaBrief = null;
      this.briefSignature = '';
      this.setDataBadge('unavailable');
      this.render();
      return;
    }

    const allowBrowserFallback = options.allowBrowserFallback ?? true;
    this.enqueueRefresh({
      signature: nextSignature,
      titles: nextItems.slice(0, 8).map(item => item.title),
      allowBrowserFallback,
    });
  }

  private enqueueRefresh(request: CubaBriefRefreshRequest): void {
    if (this.refreshInFlight) {
      // Feed batches can update rapidly. Keep only the latest state instead of
      // sending every intermediate headline set to the single-request LocalAI queue.
      this.pendingRefresh = request;
      return;
    }

    void this.processRefreshQueue(request);
  }

  private async processRefreshQueue(initialRequest: CubaBriefRefreshRequest): Promise<void> {
    this.refreshInFlight = true;
    let request: CubaBriefRefreshRequest | null = initialRequest;

    try {
      while (request) {
        await this.refreshBrief(request);
        request = this.pendingRefresh;
        this.pendingRefresh = null;
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async loadBriefFromCache(signature: string): Promise<boolean> {
    if (this.cubaBrief && this.briefSignature === signature) return false;

    const entry = await getPersistentCache<{ summary: string; signature: string }>(CubaBriefPanel.BRIEF_CACHE_KEY);
    if (!entry?.data?.summary || entry.data.signature !== signature) return false;
    if (Date.now() - entry.updatedAt > CubaBriefPanel.BRIEF_CACHE_TTL_MS) return false;
    if (this.headlineSignature !== signature) return false;

    const summary = this.normalizeAndValidateSummary(entry.data.summary);
    if (!summary) return false;

    this.cubaBrief = summary;
    this.lastBriefUpdate = entry.updatedAt;
    this.briefSignature = signature;
    return true;
  }

  private async refreshBrief(request: CubaBriefRefreshRequest): Promise<void> {
    if (this.isHidden) return;

    if (request.titles.length < 2) return;

    const loadedFromCache = await this.loadBriefFromCache(request.signature);
    const now = Date.now();

    if (
      loadedFromCache
      || (this.cubaBrief && this.briefSignature === request.signature && now - this.lastBriefUpdate <= CubaBriefPanel.BRIEF_COOLDOWN_MS)
    ) {
      this.setDataBadge(loadedFromCache ? 'cached' : 'live');
      this.render();
      return;
    }

    this.setContent('<div class="insights-empty">Generando resumen general de Cuba...</div>');

    const cubaContext = [
      'FOCUS COUNTRY: Cuba.',
      'Produce a balanced synthesis of the most important current developments directly tied to Cuba.',
      'Return exactly one concise paragraph in Spanish describing the general situation in Cuba.',
      'Cover the dominant developments across domestic politics, economy, society, public services, energy, infrastructure, migration, foreign relations, health, culture, technology, security, weather, and tourism when supported by the headlines.',
      'Prioritize impact on the Cuban population and distinguish confirmed developments from announcements or projections.',
      'Do not force every topic into the summary; select the most consequential and well-supported themes.',
      'Ignore unrelated regional stories unless Cuba is central to the event.',
      'Do not invent facts, causes, figures, or conclusions that are absent from the supplied headlines.',
      'Do not use bullet points, headings, or multiple paragraphs.',
    ].join(' ');

    const result = await generateSummary(
      request.titles,
      undefined,
      cubaContext,
      { allowBrowserFallback: request.allowBrowserFallback, allowLocalAi: true }
    ).catch(() => null);

    const summary = result?.summary ? this.normalizeAndValidateSummary(result.summary) : null;
    if (!summary) {
      console.warn('[CubaBrief] Summary rejected or unavailable', {
        requestSignature: request.signature,
        currentSignature: this.headlineSignature,
        provider: result?.provider,
        summary: result?.summary,
      });
      this.setDataBadge('unavailable');
      this.render();
      return;
    }

    // Show a successful result even when a newer feed batch arrived during
    // inference. The queued latest request will replace it when it completes.
    this.cubaBrief = summary;
    this.briefSignature = request.signature;
    this.lastBriefUpdate = Date.now();
    this.setDataBadge(result?.cached ? 'cached' : 'live');
    void setPersistentCache(CubaBriefPanel.BRIEF_CACHE_KEY, { summary, signature: request.signature });
    console.log('[CubaBrief] Summary displayed', {
      requestSignature: request.signature,
      currentSignature: this.headlineSignature,
      provider: result?.provider,
      cached: result?.cached,
    });
    this.render();
  }

  private normalizeAndValidateSummary(value: string): string | null {
    const summary = value
      .replace(/^```(?:\w+)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/\s*\n+\s*/g, ' ')
      .trim();

    if (summary.length < 40 || summary.length > 1200) return null;
    if (/^(?:[-*•]|\d+[.)])\s/.test(summary)) return null;
    if (!/\b(?:el|la|los|las|de|del|en|que|para|con|por|una|un)\b/i.test(summary)) return null;

    return summary;
  }

  private getVisibleSources(): string[] {
    const sources: string[] = [];
    const seen = new Set<string>();

    for (const item of this.cubaNews) {
      const source = item.source.trim();
      if (!source || seen.has(source)) continue;

      seen.add(source);
      sources.push(source);

      if (sources.length >= CubaBriefPanel.MAX_VISIBLE_SOURCES) {
        break;
      }
    }

    return sources;
  }

  private render(): void {
    if (this.isHidden) return;

    if (this.cubaNews.length === 0) {
      this.setDataBadge('unavailable');
      this.setContent('<div class="insights-empty">Esperando noticias de Cuba...</div>');
      return;
    }

    const visibleSources = this.getVisibleSources();
    const sourcesHtml = visibleSources.length > 0
      ? `
        <div class="cuba-brief-sources" aria-label="Fuentes activas para el resumen de Cuba">
          <span class="cuba-brief-sources-label">Fuentes</span>
          <div class="cuba-brief-source-list">
            ${visibleSources.map(source => `<span class="cuba-brief-source">${escapeHtml(source)}</span>`).join('')}
          </div>
        </div>
      `
      : '';

    this.setContent(`
      <div class="cuba-brief-panel">
        <p class="cuba-brief-paragraph">${this.cubaBrief ? escapeHtml(this.cubaBrief) : 'Generando resumen de la situación general de Cuba...'}</p>
        ${sourcesHtml}
      </div>
    `);
  }
}
