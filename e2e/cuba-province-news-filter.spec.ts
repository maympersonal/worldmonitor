import { expect, test } from '@playwright/test';

test.describe('Cuba province tourism news filters', () => {
  test('requires provincial tourism relevance for broad province mentions', async ({ page }) => {
    await page.goto('/tests/runtime-harness.html');

    const result = await page.evaluate(async () => {
      const {
        matchesCubaProvinceNewsText,
        matchesCubaProvinceTourismNewsText,
      } = await import('/src/services/cuba-province-news-filter.ts');

      return {
        broadProvinceStillMatchesLocation: matchesCubaProvinceNewsText('matanzas', 'Apagon electrico en Matanzas'),
        broadProvinceWithoutTourismRejected: matchesCubaProvinceTourismNewsText('matanzas', 'Apagon electrico en Matanzas'),
        broadProvinceWithTourismAccepted: matchesCubaProvinceTourismNewsText('matanzas', 'Nuevos hoteles impulsan el turismo en Matanzas'),
        touristSiteAccepted: matchesCubaProvinceTourismNewsText('matanzas', 'Varadero recibira nuevos vuelos de Canada'),
        wrongProvinceRejected: matchesCubaProvinceTourismNewsText('matanzas', 'Turismo cultural crece en Holguin'),
      };
    });

    expect(result).toEqual({
      broadProvinceStillMatchesLocation: true,
      broadProvinceWithoutTourismRejected: false,
      broadProvinceWithTourismAccepted: true,
      touristSiteAccepted: true,
      wrongProvinceRejected: false,
    });
  });

  test('filters provincial RSS results before rendering panels', async ({ page }) => {
    await page.route('**/api/rss-proxy?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/rss+xml',
        body: `<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <item>
                <title>Nuevos hoteles impulsan el turismo en Matanzas</title>
                <link>https://example.com/matanzas-hoteles</link>
                <source url="https://example.com">Example</source>
                <pubDate>Fri, 29 May 2026 12:00:00 GMT</pubDate>
                <description>Visitantes llegan a destinos cubanos.</description>
              </item>
              <item>
                <title>Apagon electrico en Matanzas</title>
                <link>https://example.com/matanzas-apagon</link>
                <source url="https://example.com">Example</source>
                <pubDate>Fri, 29 May 2026 12:05:00 GMT</pubDate>
                <description>Reporte general provincial.</description>
              </item>
              <item>
                <title>Varadero recibira nuevos vuelos de Canada</title>
                <link>https://example.com/varadero-vuelos</link>
                <source url="https://example.com">Example</source>
                <pubDate>Fri, 29 May 2026 12:10:00 GMT</pubDate>
                <description>Conectividad aerea para visitantes.</description>
              </item>
              <item>
                <title>Turismo cultural crece en Holguin</title>
                <link>https://example.com/holguin-turismo</link>
                <source url="https://example.com">Example</source>
                <pubDate>Fri, 29 May 2026 12:15:00 GMT</pubDate>
                <description>Destino de otra provincia.</description>
              </item>
            </channel>
          </rss>`,
      })
    );
    await page.goto('/tests/runtime-harness.html');

    const titles = await page.evaluate(async () => {
      const { fetchFeed } = await import('/src/services/rss.ts');
      const items = await fetchFeed({
        name: 'Matanzas Turismo 7d Test',
        url: '/api/rss-proxy?url=https%3A%2F%2Fexample.com%2Fmatanzas.xml',
        provinceTextFilterId: 'matanzas',
        limit: 10,
      });
      return items.map((item) => item.title);
    });

    expect(titles).toEqual([
      'Nuevos hoteles impulsan el turismo en Matanzas',
      'Varadero recibira nuevos vuelos de Canada',
    ]);
  });
});
