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
  epoch: number;
}

export class CubaBriefPanel extends Panel {
  private static readonly BRIEF_CACHE_KEY = 'summary:cuba-tourism-brief';
  private static readonly MAX_VISIBLE_SOURCES = 8;

  private cubaNews: NewsItem[] = [];
  private cubaBrief: string | null = null;
  private newsSignature = '';
  private briefSignature = '';
  private briefIsCached = false;
  private briefUnavailable = false;
  private refreshInFlight = false;
  private pendingRefresh: CubaBriefRefreshRequest | null = null;
  private refreshEpoch = 0;
  private isHidden = false;

  constructor() {
    super({
      id: 'cuba-brief',
      title: 'Situación Turística en Cuba',
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

    if (nextSignature !== this.newsSignature) {
      this.newsSignature = nextSignature;
      this.refreshEpoch += 1;
      this.cubaBrief = null;
      this.briefSignature = '';
      this.briefIsCached = false;
      this.briefUnavailable = false;
    }

    this.cubaNews = nextItems;
    this.render();

    if (nextItems.length < 2) {
      this.pendingRefresh = null;
      this.cubaBrief = null;
      this.briefSignature = '';
      this.briefIsCached = false;
      this.briefUnavailable = true;
      this.setDataBadge('unavailable');
      this.render();
      return;
    }

    const allowBrowserFallback = options.allowBrowserFallback ?? true;
    this.enqueueRefresh({
      signature: nextSignature,
      titles: nextItems.slice(0, 8).map(item => item.title),
      allowBrowserFallback,
      epoch: this.refreshEpoch,
    });
  }

  private async loadBriefFromCache(signature: string, epoch: number): Promise<boolean> {
    const entry = await getPersistentCache<{ summary: string; signature: string }>(CubaBriefPanel.BRIEF_CACHE_KEY);
    if (!entry?.data?.summary || entry.data.signature !== signature) return false;
    if (epoch !== this.refreshEpoch) return false;

    this.cubaBrief = entry.data.summary.replace(/\s*\n+\s*/g, ' ').trim();
    this.briefSignature = signature;
    this.briefIsCached = true;
    this.briefUnavailable = false;
    return true;
  }

  private enqueueRefresh(request: CubaBriefRefreshRequest): void {
    if (this.refreshInFlight) {
      // Keep only one fallback candidate. The first successful request wins;
      // this latest request is attempted only when the active one fails.
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
        const succeeded = await this.refreshBrief(request);
        if (succeeded) {
          this.pendingRefresh = null;
          return;
        }

        request = this.pendingRefresh;
        this.pendingRefresh = null;
      }

      if (!this.cubaBrief) {
        this.briefUnavailable = true;
        this.setDataBadge('unavailable');
        this.render();
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async refreshBrief(request: CubaBriefRefreshRequest): Promise<boolean> {
    if (this.isHidden || request.epoch !== this.refreshEpoch) return false;

    if (request.titles.length < 2) return false;

    if (this.cubaBrief && this.briefSignature === request.signature) {
      this.setDataBadge(this.briefIsCached ? 'cached' : 'live');
      this.render();
      return true;
    }

    const loadedFromCache = await this.loadBriefFromCache(request.signature, request.epoch);
    if (request.epoch !== this.refreshEpoch) return false;

    if (loadedFromCache) {
      this.setDataBadge('cached');
      this.render();
      return true;
    }

    this.briefUnavailable = false;
    this.setContent('<div class="insights-empty">Generando resumen turístico de Cuba...</div>');

    const cubaContext = [
      'FOCUS COUNTRY: Cuba.',
      'Summarize only tourism, travel, hospitality, cultural tourism, flights, cruises, destinations, visitor demand, travel costs, infrastructure, and tourism policy developments directly tied to Cuba.',
      'Return exactly one short paragraph in Spanish describing the current tourism situation in Cuba.',
      'Prioritize practical implications for visitors, tour operators, hotels, airlines, cultural venues, and provincial destinations.',
      'Ignore unrelated political, economic, or regional stories unless they directly affect tourism in Cuba.',
      'Do not use bullet points, headings, or multiple paragraphs.',
    ].join(' ');

    const result = await generateSummary(
      request.titles,
      undefined,
      cubaContext,
      { allowBrowserFallback: request.allowBrowserFallback, allowLocalAi: true }
    ).catch(() => null);

    if (request.epoch !== this.refreshEpoch) return false;

    if (!result?.summary) {
      return false;
    }

    const summary = result.summary.replace(/\s*\n+\s*/g, ' ').trim();
    this.cubaBrief = summary;
    this.briefSignature = request.signature;
    this.briefIsCached = result.cached;
    this.briefUnavailable = false;
    this.setDataBadge(result.cached ? 'cached' : 'live');
    void setPersistentCache(CubaBriefPanel.BRIEF_CACHE_KEY, { summary, signature: request.signature });
    this.render();
    return true;
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
      this.setContent('<div class="insights-empty">Esperando noticias turísticas de Cuba...</div>');
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
        <p class="cuba-brief-paragraph">${
          this.cubaBrief
            ? escapeHtml(this.cubaBrief)
            : this.briefUnavailable
              ? 'Resumen turístico de Cuba no disponible.'
              : 'Generando resumen de la situación turística en Cuba...'
        }</p>
        ${sourcesHtml}
      </div>
    `);
  }
}
