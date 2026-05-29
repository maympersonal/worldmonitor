import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { Monitor } from '@/types';
import { MONITOR_COLORS } from '@/config';
import { generateId, getCSSColor } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';

interface ParsedMonitorInput {
  name?: string;
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
    const separatorIndex = trimmed.indexOf(':');
    const hasSeparator = separatorIndex !== -1;
    const rawName = hasSeparator ? trimmed.slice(0, separatorIndex).trim() : '';
    const name = rawName || undefined;
    const ruleText = hasSeparator ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
    const keywords = Array.from(new Set(
      ruleText
        .split(',')
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
    ));

    return {
      ...(name && { name }),
      keywords,
    };
  }

  private getMonitorLabel(monitor: Monitor): string {
    const rule = monitor.keywords.join(', ');
    return monitor.name ? `${monitor.name}: ${rule}` : rule;
  }

  private addMonitor(): void {
    const input = this.content.querySelector('.monitor-input') as HTMLInputElement | null;
    if (!input) return;

    const parsed = this.parseMonitorInput(input.value);

    if (parsed.keywords.length === 0) return;

    const monitor: Monitor = {
      id: generateId(),
      keywords: parsed.keywords,
      color: MONITOR_COLORS[this.monitors.length % MONITOR_COLORS.length] ?? getCSSColor('--status-live'),
      ...(parsed.name && { name: parsed.name }),
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
