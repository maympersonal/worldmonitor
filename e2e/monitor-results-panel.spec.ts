import { expect, test } from '@playwright/test';

test.describe('monitor result panels', () => {
  test('evaluates advanced monitor query operators', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const {
        compileMonitorQuery,
        matchesCompiledMonitorQuery,
      } = await import('/src/services/monitor-query.ts');

      const makeItem = (overrides: {
        title: string;
        link?: string;
        snippet?: string;
        pubDate?: Date;
      }) => ({
        source: 'Test',
        title: overrides.title,
        link: overrides.link ?? 'https://example.com/news/cuba-economia',
        pubDate: overrides.pubDate ?? new Date('2026-02-15T12:00:00Z'),
        isAlert: false,
        ...(overrides.snippet && { snippet: overrides.snippet }),
      });

      const matches = (query: string, item = makeItem({ title: 'Cuba economia digital' }), now = new Date('2026-05-29T12:00:00Z')) =>
        matchesCompiledMonitorQuery(compileMonitorQuery(query), item, now);

      return {
        implicitAnd: matches('Cuba economia'),
        implicitAndRejectsPartial: matches('Cuba economia', makeItem({ title: 'Cuba baseball' })),
        exactPhrase: matches('"inteligencia artificial"', makeItem({ title: 'Nueva ley de inteligencia artificial' })),
        alternatives: matches('Cuba OR Habana OR Havana', makeItem({ title: 'Havana updates economy plan' })),
        explicitAnd: matches('Cuba AND economia'),
        grouping: matches('(Cuba OR Habana) economia', makeItem({ title: 'Habana economia informal' })),
        excludeWord: matches('Cuba economia -beisbol', makeItem({ title: 'Cuba economia beisbol' })),
        excludePhrase: matches('Cuba -"serie nacional"', makeItem({ title: 'Cuba abre la serie nacional' })),
        intitle: matches('intitle:Cuba economia', makeItem({ title: 'Cuba politics', snippet: 'economia' })),
        allintitle: matches('allintitle:Cuba economia', makeItem({ title: 'Cuba economia digital', snippet: 'economia' })),
        allintitleRejectsBodyOnly: matches('allintitle:Cuba economia', makeItem({ title: 'Cuba politics', snippet: 'economia' })),
        site: matches('site:reuters.com Cuba', makeItem({ title: 'Cuba economy', link: 'https://www.reuters.com/world/americas/cuba-economy/' })),
        inurl: matches('inurl:cuba economia', makeItem({ title: 'Economia update', link: 'https://example.com/world/cuba/latest' })),
        when: matches('Cuba when:30d', makeItem({ title: 'Cuba update', pubDate: new Date('2026-05-10T12:00:00Z') })),
        whenRejectsOld: matches('Cuba when:30d', makeItem({ title: 'Cuba update', pubDate: new Date('2026-03-01T12:00:00Z') })),
        after: matches('Cuba after:2026-01-01', makeItem({ title: 'Cuba update', pubDate: new Date('2026-01-02T12:00:00Z') })),
        before: matches('Cuba before:2026-05-01', makeItem({ title: 'Cuba update', pubDate: new Date('2026-05-01T20:00:00Z') })),
        oldCommaAsOr: matches('apagón, electricidad', makeItem({ title: 'Restablecen electricidad' })),
      };
    });

    expect(result).toEqual({
      implicitAnd: true,
      implicitAndRejectsPartial: false,
      exactPhrase: true,
      alternatives: true,
      explicitAnd: true,
      grouping: true,
      excludeWord: false,
      excludePhrase: false,
      intitle: true,
      allintitle: true,
      allintitleRejectsBodyOnly: false,
      site: true,
      inurl: true,
      when: true,
      whenRejectsOld: false,
      after: true,
      before: true,
      oldCommaAsOr: true,
    });
  });

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
    await page.route('**/api/rss-proxy?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        body: '<rss><channel></channel></rss>',
      })
    );
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

  test('fetches monitor results from Google News RSS', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 720 });

    let capturedGoogleUrl = '';
    await page.route('**/api/rss-proxy?**', async (route) => {
      const proxyUrl = new URL(route.request().url());
      capturedGoogleUrl = proxyUrl.searchParams.get('url') || '';

      await route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <item>
                <title>Cuba economy update from Reuters</title>
                <link>https://news.google.com/rss/articles/example</link>
                <source url="https://www.reuters.com">Reuters</source>
                <pubDate>Fri, 29 May 2026 12:00:00 GMT</pubDate>
                <description>Google News result</description>
              </item>
            </channel>
          </rss>`,
      });
    });

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
      input!.value = 'Reuters Cuba: site:reuters.com Cuba economia hl:es-419 gl:CU ceid:CU:es';
      document.querySelector<HTMLButtonElement>('[data-panel="monitors"] .monitor-add-btn')!.click();

      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
          if (document.querySelector('[data-panel^="monitor-result-"] .item-title')) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 5000) {
            reject(new Error('Timed out waiting for Google News monitor result'));
            return;
          }
          setTimeout(check, 25);
        };
        check();
      });

      const dynamicPanel = document.querySelector<HTMLElement>('[data-panel^="monitor-result-"]');
      const output = {
        title: dynamicPanel?.querySelector('.panel-title')?.textContent ?? '',
        source: dynamicPanel?.querySelector('.item-source')?.textContent ?? '',
        headline: dynamicPanel?.querySelector('.item-title')?.textContent ?? '',
      };

      app.destroy();
      return output;
    });

    const googleUrl = new URL(capturedGoogleUrl);

    expect(googleUrl.origin + googleUrl.pathname).toBe('https://news.google.com/rss/search');
    expect(googleUrl.searchParams.get('q')).toBe('site:reuters.com Cuba economia');
    expect(googleUrl.searchParams.get('hl')).toBe('es-419');
    expect(googleUrl.searchParams.get('gl')).toBe('CU');
    expect(googleUrl.searchParams.get('ceid')).toBe('CU:es');
    expect(result).toEqual({
      title: 'Reuters Cuba',
      source: 'Reuters',
      headline: 'Cuba economy update from Reuters',
    });
  });

  test('removes a monitor panel after app restart', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 720 });
    await page.route('**/api/rss-proxy?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        body: '<rss><channel></channel></rss>',
      })
    );
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
