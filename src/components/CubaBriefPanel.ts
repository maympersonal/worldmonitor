import { Panel } from './Panel';
import { generateSummary } from '@/services/summarization';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { escapeHtml } from '@/utils/sanitize';
import { isMobileDevice } from '@/utils';
import type { NewsItem } from '@/types';

export class CubaBriefPanel extends Panel {
  private static readonly BRIEF_CACHE_KEY = 'summary:cuba-general-brief-v2';
  private static readonly BRIEF_COOLDOWN_MS = 120000;
  private static readonly MAX_VISIBLE_SOURCES = 8;

  private cubaNews: NewsItem[] = [];
  private cubaBrief: string | null = null;
  private headlineSignature = '';
  private lastBriefUpdate = 0;
  private isHidden = false;

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
      this.setDataBadge('unavailable');
      this.render();
      return;
    }

    const allowBrowserFallback = options.allowBrowserFallback ?? true;
    void this.refreshBrief(nextSignature, allowBrowserFallback);
  }

  private async loadBriefFromCache(signature: string): Promise<boolean> {
    if (this.cubaBrief && this.headlineSignature === signature) return false;

    const entry = await getPersistentCache<{ summary: string; signature: string }>(CubaBriefPanel.BRIEF_CACHE_KEY);
    if (!entry?.data?.summary || entry.data.signature !== signature) return false;

    this.cubaBrief = entry.data.summary;
    this.lastBriefUpdate = entry.updatedAt;
    this.headlineSignature = signature;
    return true;
  }

  private async refreshBrief(signature: string, allowBrowserFallback: boolean): Promise<void> {
    if (this.isHidden) return;

    const titles = this.cubaNews.slice(0, 8).map(item => item.title);
    if (titles.length < 2) return;

    const loadedFromCache = await this.loadBriefFromCache(signature);
    const now = Date.now();

    if (
      loadedFromCache
      || (this.cubaBrief && this.headlineSignature === signature && now - this.lastBriefUpdate <= CubaBriefPanel.BRIEF_COOLDOWN_MS)
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
      titles,
      undefined,
      cubaContext,
      { allowBrowserFallback }
    ).catch(() => null);

    if (!result?.summary) {
      this.setDataBadge('unavailable');
      this.render();
      return;
    }

    this.cubaBrief = result.summary.replace(/\s*\n+\s*/g, ' ').trim();
    this.headlineSignature = signature;
    this.lastBriefUpdate = now;
    this.setDataBadge(result.cached ? 'cached' : 'live');
    void setPersistentCache(CubaBriefPanel.BRIEF_CACHE_KEY, { summary: result.summary, signature });
    this.render();
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
