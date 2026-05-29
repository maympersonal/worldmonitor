import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { Monitor } from '@/types';
import { MONITOR_COLORS } from '@/config';
import { generateId, getCSSColor } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { extractMonitorKeywords, getMonitorDisplayRule, isMonitorQueryField } from '@/services/monitor-query';

interface ParsedMonitorInput {
  name?: string;
  query: string;
  keywords: string[];
}

export class MonitorPanel extends Panel {
  private monitors: Monitor[] = [];
  private onMonitorsChange?: (monitors: Monitor[]) => void;

  constructor(initialMonitors: Monitor[] = []) {
    super({ id: 'monitors', title: t('panels.monitors') });
    this.monitors = initialMonitors;
    this.renderInput();
  }

  private renderInput(): void {
    this.content.innerHTML = '';
    const inputContainer = document.createElement('div');
    inputContainer.className = 'monitor-input-container';
    inputContainer.innerHTML = `
      <input type="text" class="monitor-input" placeholder="${t('components.monitor.placeholder')}">
      <button class="monitor-add-btn">${t('components.monitor.add')}</button>
    `;

    this.content.appendChild(inputContainer);

    const monitorsList = document.createElement('div');
    monitorsList.className = 'monitors-list';
    this.content.appendChild(monitorsList);

    inputContainer.querySelector('.monitor-add-btn')?.addEventListener('click', () => {
      this.addMonitor();
    });

    const input = inputContainer.querySelector('.monitor-input') as HTMLInputElement;
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addMonitor();
    });

    this.renderMonitorsList();
  }

  private parseMonitorInput(value: string): ParsedMonitorInput {
    const trimmed = value.trim();
    const separatorIndex = this.findNameSeparator(trimmed);
    const hasSeparator = separatorIndex !== -1;
    const rawName = hasSeparator ? trimmed.slice(0, separatorIndex).trim() : '';
    const name = rawName || undefined;
    const ruleText = hasSeparator ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
    const keywords = extractMonitorKeywords(ruleText);

    return {
      ...(name && { name }),
      query: ruleText,
      keywords: keywords.length > 0 ? keywords : [ruleText.toLocaleLowerCase()].filter(Boolean),
    };
  }

  private findNameSeparator(value: string): number {
    const separatorMatch = value.match(/:\s+/);
    if (!separatorMatch || separatorMatch.index === undefined) return -1;

    const prefix = value.slice(0, separatorMatch.index).trim();
    if (!prefix) return -1;

    const prefixTokens = prefix.split(/\s+/);
    const lastPrefixToken = prefixTokens[prefixTokens.length - 1] ?? '';
    if (isMonitorQueryField(lastPrefixToken)) return -1;

    return separatorMatch.index;
  }

  private getMonitorLabel(monitor: Monitor): string {
    const rule = getMonitorDisplayRule(monitor);
    return monitor.name ? `${monitor.name}: ${rule}` : rule;
  }

  private addMonitor(): void {
    const input = this.content.querySelector('.monitor-input') as HTMLInputElement | null;
    if (!input) return;

    const parsed = this.parseMonitorInput(input.value);

    if (!parsed.query) return;

    const monitor: Monitor = {
      id: generateId(),
      keywords: parsed.keywords,
      color: MONITOR_COLORS[this.monitors.length % MONITOR_COLORS.length] ?? getCSSColor('--status-live'),
      ...(parsed.name && { name: parsed.name }),
      query: parsed.query,
    };

    this.monitors.push(monitor);
    input.value = '';
    this.renderMonitorsList();
    this.onMonitorsChange?.(this.monitors);
  }

  public removeMonitor(id: string): void {
    this.monitors = this.monitors.filter((m) => m.id !== id);
    this.renderMonitorsList();
    this.onMonitorsChange?.(this.monitors);
  }

  private renderMonitorsList(): void {
    const list = this.content.querySelector('.monitors-list');
    if (!list) return;

    list.innerHTML = this.monitors
      .map(
        (m) => `
      <span class="monitor-tag">
        <span class="monitor-tag-color" style="background: ${escapeHtml(m.color)}"></span>
        ${escapeHtml(this.getMonitorLabel(m))}
        <span class="monitor-tag-remove" data-id="${escapeHtml(m.id)}">×</span>
      </span>
    `
      )
      .join('');

    list.querySelectorAll('.monitor-tag-remove').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id) this.removeMonitor(id);
      });
    });
  }

  public onChanged(callback: (monitors: Monitor[]) => void): void {
    this.onMonitorsChange = callback;
  }

  public getMonitors(): Monitor[] {
    return [...this.monitors];
  }

  public setMonitors(monitors: Monitor[]): void {
    this.monitors = monitors;
    this.renderMonitorsList();
  }
}
