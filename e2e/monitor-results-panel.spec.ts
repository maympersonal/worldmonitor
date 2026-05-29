import { expect, test } from '@playwright/test';

test.describe('monitor result panels', () => {
  test('renders one panel from matching title or snippet results', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const { initI18n } = await import('/src/services/i18n.ts');
      const { MonitorResultsPanel } = await import('/src/components/MonitorResultsPanel.ts');

      localStorage.setItem('i18nextLng', 'es');
      await initI18n();

      const monitor = {
        id: 'energia',
        name: 'Energía',
        keywords: ['holguín', 'electricidad'],
        color: '#44ff88',
      };
      const panel = new MonitorResultsPanel(monitor);
      document.body.appendChild(panel.getElement());

      panel.renderResults([
        {
          source: 'Source A',
          title: 'Regresa la electricidad tras la averia',
          link: 'https://example.com/electricidad',
          pubDate: new Date(),
          isAlert: false,
        },
        {
          source: 'Source B',
          title: 'Actualizacion provincial',
          snippet: 'Restablecen servicios en Holguin',
          link: 'https://example.com/holguin',
          pubDate: new Date(),
          isAlert: false,
        },
        {
          source: 'Source B',
          title: 'Duplicada',
          snippet: 'Electricidad en Holguin',
          link: 'https://example.com/holguin',
          pubDate: new Date(),
          isAlert: false,
        },
        {
          source: 'Source C',
          title: 'Noticia sin relacion',
          link: 'https://example.com/otra',
          pubDate: new Date(),
          isAlert: false,
        },
      ]);

      const root = panel.getElement();
      const output = {
        panelId: root.dataset.panel,
        title: root.querySelector('.panel-title')?.textContent,
        count: root.querySelector('.panel-count')?.textContent,
        headlines: Array.from(root.querySelectorAll('.item-title')).map((item) => item.textContent),
      };

      panel.destroy();
      root.remove();
      return output;
    });

    expect(result.panelId).toBe('monitor-result-energia');
    expect(result.title).toBe('Energía');
    expect(result.count).toBe('2');
    expect(result.headlines).toEqual([
      'Regresa la electricidad tras la averia',
      'Actualizacion provincial',
    ]);
  });

  test('creates and removes a panel from My Monitors', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 720 });
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const { initI18n } = await import('/src/services/i18n.ts');
      const { App } = await import('/src/App.ts');

      localStorage.clear();
      localStorage.setItem('i18nextLng', 'es');
      await initI18n();

      document.body.innerHTML = '<div id="app"></div>';
      const app = new App('app');
      (app as unknown as { renderLayout: () => void }).renderLayout();

      const input = document.querySelector<HTMLInputElement>('[data-panel="monitors"] .monitor-input');
      input!.value = 'Cuba energía: <img src=x onerror="window.__monitorInjected=true">, apagón';
      document.querySelector<HTMLButtonElement>('[data-panel="monitors"] .monitor-add-btn')!.click();

      const dynamicPanel = document.querySelector<HTMLElement>('[data-panel^="monitor-result-"]');
      const panelKey = dynamicPanel?.dataset.panel ?? '';
      const settingsEntry = document.querySelector<HTMLElement>(`.panel-toggle-item[data-panel="${panelKey}"]`);
      const created = {
        hasPanel: !!dynamicPanel,
        panelTitle: dynamicPanel?.querySelector('.panel-title')?.textContent ?? '',
        hasInjectedMarkup: !!settingsEntry?.querySelector('img'),
        storedMonitors: JSON.parse(localStorage.getItem('worldmonitor-monitors') || '[]').length,
      };

      document.querySelector<HTMLElement>('[data-panel="monitors"] .monitor-tag-remove')!.click();
      const removed = {
        hasPanel: !!document.querySelector(`[data-panel="${panelKey}"]`),
        hasSetting: !!document.querySelector(`.panel-toggle-item[data-panel="${panelKey}"]`),
        storedMonitors: JSON.parse(localStorage.getItem('worldmonitor-monitors') || '[]').length,
      };

      app.destroy();
      return { created, removed };
    });

    expect(result.created.hasPanel).toBe(true);
    expect(result.created.panelTitle).toBe('Cuba energía');
    expect(result.created.hasInjectedMarkup).toBe(false);
    expect(result.created.storedMonitors).toBe(1);
    expect(result.removed).toEqual({
      hasPanel: false,
      hasSetting: false,
      storedMonitors: 0,
    });
  });

  test('removes a monitor panel after app restart', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 720 });
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const { initI18n } = await import('/src/services/i18n.ts');
      const { App } = await import('/src/App.ts');

      localStorage.clear();
      localStorage.setItem('i18nextLng', 'es');
      await initI18n();

      document.body.innerHTML = '<div id="app"></div>';
      const firstApp = new App('app');
      (firstApp as unknown as { renderLayout: () => void }).renderLayout();

      const input = document.querySelector<HTMLInputElement>('[data-panel="monitors"] .monitor-input');
      input!.value = 'Conectividad: internet, etecsa';
      document.querySelector<HTMLButtonElement>('[data-panel="monitors"] .monitor-add-btn')!.click();

      const panelKey = document.querySelector<HTMLElement>('[data-panel^="monitor-result-"]')?.dataset.panel ?? '';
      const orderBeforeRestart = JSON.parse(localStorage.getItem('panel-order') || '[]') as string[];
      firstApp.destroy();

      document.body.innerHTML = '<div id="app"></div>';
      const secondApp = new App('app');
      (secondApp as unknown as { renderLayout: () => void }).renderLayout();

      const restored = {
        hasPanel: !!document.querySelector(`[data-panel="${panelKey}"]`),
        hasSetting: !!document.querySelector(`.panel-toggle-item[data-panel="${panelKey}"]`),
        orderIncludesPanel: (JSON.parse(localStorage.getItem('panel-order') || '[]') as string[]).includes(panelKey),
        orderBeforeRestartIncludesPanel: orderBeforeRestart.includes(panelKey),
      };

      document.querySelector<HTMLElement>('[data-panel="monitors"] .monitor-tag-remove')!.click();

      const panelSettings = JSON.parse(localStorage.getItem('worldmonitor-panels') || '{}') as Record<string, unknown>;
      const orderAfterRemoval = JSON.parse(localStorage.getItem('panel-order') || '[]') as string[];
      const removed = {
        hasPanel: !!document.querySelector(`[data-panel="${panelKey}"]`),
        hasSetting: !!document.querySelector(`.panel-toggle-item[data-panel="${panelKey}"]`),
        storedMonitors: JSON.parse(localStorage.getItem('worldmonitor-monitors') || '[]').length,
        orderIncludesPanel: orderAfterRemoval.includes(panelKey),
        settingsIncludesPanel: Object.prototype.hasOwnProperty.call(panelSettings, panelKey),
      };

      secondApp.destroy();
      return { restored, removed };
    });

    expect(result.restored).toEqual({
      hasPanel: true,
      hasSetting: true,
      orderIncludesPanel: true,
      orderBeforeRestartIncludesPanel: true,
    });
    expect(result.removed).toEqual({
      hasPanel: false,
      hasSetting: false,
      storedMonitors: 0,
      orderIncludesPanel: false,
      settingsIncludesPanel: false,
    });
  });
});
