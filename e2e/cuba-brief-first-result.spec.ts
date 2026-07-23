import { expect, test } from '@playwright/test';

const PERSISTENT_BRIEF_CACHE_KEY = 'worldmonitor-persistent-cache:summary:cuba-tourism-brief';

async function mountCubaBriefWithTwoUpdates(
  page: import('@playwright/test').Page,
  useDifferentHeadlines = false
): Promise<void> {
  await page.goto('/tests/runtime-harness.html');
  await page.evaluate(async ({ cacheKey, useDifferentHeadlines }) => {
    localStorage.removeItem(cacheKey);

    const { CubaBriefPanel } = await import('/src/components/CubaBriefPanel.ts');
    const panel = new CubaBriefPanel();
    document.body.appendChild(panel.getElement());

    const makeItems = (prefix: string) => [
      {
        title: `${prefix} vuelos hacia Cuba`,
        source: 'Fuente A',
        link: `https://example.com/${prefix}-vuelos`,
        pubDate: new Date('2026-07-15T12:00:00Z'),
        isAlert: false,
        threat: { level: 'info', category: 'general', confidence: 0.5, source: 'keyword' },
      },
      {
        title: `${prefix} ocupación hotelera en Cuba`,
        source: 'Fuente B',
        link: `https://example.com/${prefix}-hoteles`,
        pubDate: new Date('2026-07-15T11:00:00Z'),
        isAlert: false,
        threat: { level: 'info', category: 'general', confidence: 0.5, source: 'keyword' },
      },
    ];

    panel.setCubaNews(makeItems('Primer'), { allowBrowserFallback: false });
    if (useDifferentHeadlines) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    panel.setCubaNews(makeItems(useDifferentHeadlines ? 'Segundo' : 'Primer'), { allowBrowserFallback: false });
  }, { cacheKey: PERSISTENT_BRIEF_CACHE_KEY, useDifferentHeadlines });
}

test.describe('Cuba tourism brief request arbitration', () => {
  test('keeps the first successful result and discards the pending request', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/ai', async (route) => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 75));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: 'Primer resumen válido.',
          provider: 'localai',
          model: 'test-localai',
          cached: false,
        }),
      });
    });

    await mountCubaBriefWithTwoUpdates(page);

    await expect(page.locator('.cuba-brief-paragraph')).toHaveText('Primer resumen válido.');
    await page.waitForTimeout(150);

    expect(requestCount).toBe(1);
    await expect(page.locator('.cuba-brief-paragraph')).toHaveText('Primer resumen válido.');
  });

  test('uses the pending request when the first one fails', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/ai', async (route) => {
      requestCount += 1;

      if (requestCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ fallback: true, error: 'LocalAI failed' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: 'Resumen de respaldo válido.',
          provider: 'localai',
          model: 'test-localai',
          cached: false,
        }),
      });
    });

    await mountCubaBriefWithTwoUpdates(page);

    await expect(page.locator('.cuba-brief-paragraph')).toHaveText('Resumen de respaldo válido.');
    expect(requestCount).toBe(2);
  });

  test('keeps the first successful result when the headline set changes', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/ai', async (route) => {
      requestCount += 1;
      const isFirstRequest = requestCount === 1;

      if (isFirstRequest) {
        await new Promise((resolve) => setTimeout(resolve, 75));
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: isFirstRequest ? 'Primer resumen recibido.' : 'Resumen posterior.',
          provider: 'localai',
          model: 'test-localai',
          cached: false,
        }),
      });
    });

    await mountCubaBriefWithTwoUpdates(page, true);

    await expect(page.locator('.cuba-brief-paragraph')).toHaveText('Primer resumen recibido.');
    await page.waitForTimeout(100);

    expect(requestCount).toBe(1);
    await expect(page.locator('.cuba-brief-paragraph')).toHaveText('Primer resumen recibido.');
  });
});
