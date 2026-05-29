import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { Monitor, NewsItem } from '@/types';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

const MAX_VISIBLE_RESULTS = 10;

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class MonitorResultsPanel extends Panel {
  private readonly monitor: Monitor;
  private readonly keywords: string[];

  constructor(monitor: Monitor) {
    super({
      id: MonitorResultsPanel.getPanelId(monitor),
      title: MonitorResultsPanel.getTitle(monitor),
      showCount: true,
      trackActivity: false,
    });

    this.monitor = monitor;
    this.keywords = monitor.keywords
      .map((keyword) => normalizeSearchText(keyword.trim()))
      .filter(Boolean);
  }

  public static getPanelId(monitor: Monitor): string {
    return `monitor-result-${monitor.id}`;
  }

  public static getTitle(monitor: Monitor): string {
    return monitor.name?.trim() || monitor.keywords.filter(Boolean).join(', ') || 'Monitor';
  }

  private matches(item: NewsItem): boolean {
    const searchText = normalizeSearchText(`${item.title} ${item.snippet || ''}`);

    return this.keywords.some((keyword) => {
      const escaped = escapeRegExp(keyword);
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu');
      return expression.test(searchText);
    });
  }

  public renderResults(news: NewsItem[]): void {
    const matchedItems = news
      .filter((item) => this.matches(item))
      .filter((item, index, items) =>
        items.findIndex((candidate) => candidate.link === item.link) === index
      );

    this.setCount(matchedItems.length);

    if (matchedItems.length === 0) {
      this.setContent(
        `<div style="color: var(--text-dim); font-size: 10px; margin-top: 12px;">${t('components.monitor.noMatches', { count: String(news.length) })}</div>`
      );
      return;
    }

    const countText = matchedItems.length > MAX_VISIBLE_RESULTS
      ? t('components.monitor.showingMatches', { count: String(MAX_VISIBLE_RESULTS), total: String(matchedItems.length) })
      : `${matchedItems.length} ${matchedItems.length === 1 ? t('components.monitor.match') : t('components.monitor.matches')}`;

    this.setContent(`
      <div style="color: var(--text-dim); font-size: 10px; margin: 12px 0 8px;">${countText}</div>
      ${matchedItems
        .slice(0, MAX_VISIBLE_RESULTS)
        .map(
          (item) => `
        <div class="item" style="border-left: 2px solid ${escapeHtml(this.monitor.color)}; padding-left: 8px; margin-left: -8px;">
          <div class="item-source">${escapeHtml(item.source)}</div>
          <a class="item-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
          <div class="item-time">${formatTime(item.pubDate)}</div>
        </div>
      `
        )
        .join('')}`);
  }
}
