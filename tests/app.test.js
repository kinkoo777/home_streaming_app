const { test, expect } = require('@playwright/test');

// End-to-end tests against a running server (needs a real TMDB token).
// Start it with `node server.js` (or PORT=3100 node server.js and BASE=http://localhost:3100).
const BASE = process.env.BASE || 'http://localhost:3000';
const WEBOS_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager';

const firstCard = page => page.locator('#popular-movies .movie-card:not(.skeleton-card)').first();
const waitForGrid = page => firstCard(page).waitFor({ timeout: 15000 });

// Skip intro + profile chooser for every test by pre-seeding sessionStorage
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify({ id: 'p1', name: 'Tester', theme: 'dark' }));
  });
});

test.describe('FilmBox – page load & hero', () => {
  test('page loads with title FilmBox', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/FilmBox/);
  });

  test('hero shows a film title and backdrop', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('#hero-title')).not.toHaveText('Načítání…', { timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('.hero-img.active');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
  });

  test('hero dots switch slides', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('.hero-dot').nth(1).waitFor({ timeout: 10000 });
    const before = await page.locator('#hero-title').textContent();
    await page.locator('.hero-dot').nth(1).click();
    await expect(page.locator('#hero-title')).not.toHaveText(before, { timeout: 3000 });
  });
});

test.describe('FilmBox – rows', () => {
  for (const id of ['popular-movies', 'trending', 'top-rated']) {
    test(`${id} row loads cards`, async ({ page }) => {
      await page.goto(BASE);
      await page.waitForFunction(sel => document.querySelectorAll(sel).length >= 10,
        `#${id} .movie-card:not(.skeleton-card)`, { timeout: 15000 });
    });
  }

  test('genre filter narrows results', async ({ page }) => {
    await page.goto(BASE);
    await waitForGrid(page);
    const before = await page.locator('#popular-movies .movie-card').count();
    await page.locator('#genre-filters-popular .genre-chip').nth(1).click();
    const after = await page.locator('#popular-movies .movie-card').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
  });

  test('sort by rating puts the highest rating first', async ({ page }) => {
    await page.goto(BASE);
    await waitForGrid(page);
    await page.locator('[data-grid="popular-movies"] .sort-tab[data-sort="rating"]').click();
    const ratings = await page.locator('#popular-movies .movie-card .rating').allTextContents();
    const nums = ratings.map(r => parseFloat(r));
    expect(nums[0]).toBe(Math.max(...nums));
  });

  test('scrolling a row to the end loads the next page', async ({ page }) => {
    await page.goto(BASE);
    await waitForGrid(page);
    const before = await page.locator('#popular-movies .movie-card').count();
    await page.evaluate(() => { const t = document.getElementById('popular-movies'); t.style.scrollBehavior = 'auto'; t.scrollLeft = t.scrollWidth })
    await page.waitForFunction(prev => document.querySelectorAll('#popular-movies .movie-card').length > prev, before, { timeout: 10000 });
  });
});

test.describe('FilmBox – search', () => {
  test('live search shows results', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
  });

  test('clicking a result opens the detail modal', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().click({ timeout: 8000 });
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('Enter shows a results grid; titles with apostrophes open fine', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', "Ocean's Eleven");
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
    await page.press('#search-input', 'Enter');
    await expect(page.locator('#search-movies-section')).toBeVisible({ timeout: 5000 });
    await page.locator('#search-movies .movie-card').first().click();
    await expect(page.locator('#detail-title')).not.toBeEmpty({ timeout: 8000 });
  });

  test('empty search shows history on focus', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
    await page.press('#search-input', 'Enter');
    await page.fill('#search-input', '');
    await page.locator('#search-input').focus();
    await expect(page.locator('.search-history-label')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FilmBox – detail modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await waitForGrid(page);
    await firstCard(page).click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
  });

  test('shows title, overview, genres and cast', async ({ page }) => {
    await expect(page.locator('#detail-title')).not.toBeEmpty();
    await expect(page.locator('#detail-overview')).not.toBeEmpty();
    expect(await page.locator('.genre-tag').count()).toBeGreaterThan(0);
    expect(await page.locator('.cast-item').count()).toBeGreaterThan(0);
  });

  test('closes with the X button', async ({ page }) => {
    await page.locator('#detail-modal .sheet-close').click();
    await expect(page.locator('#detail-modal')).toHaveClass(/hidden/);
  });

  test('Escape closes only the top modal', async ({ page }) => {
    await page.locator('#detail-wl-btn').click();
    await expect(page.locator('#wl-modal')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wl-modal')).toHaveClass(/hidden/);
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail-modal')).toHaveClass(/hidden/);
  });

  test('trailer button opens trailer modal', async ({ page }) => {
    await page.locator('#detail-trailer-btn').click();
    await expect(page.locator('#trailer-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('play opens the source picker', async ({ page }) => {
    await page.locator('#detail-play-btn').click();
    await expect(page.locator('#prehraj-modal')).not.toHaveClass(/hidden/);
    await page.locator('.source-item, .source-state').first().waitFor({ timeout: 20000 });
  });

  test('create a new list in the list modal', async ({ page }) => {
    await page.locator('#detail-wl-btn').click();
    await page.fill('#wl-new-list-input', 'Test seznam');
    await page.locator('#wl-new-list-btn').click();
    await expect(page.locator('.wl-list-name').filter({ hasText: 'Test seznam' })).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FilmBox – watchlist', () => {
  test('"Můj seznam" in the navbar opens the section even when empty', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#nav-watchlist').click();
    await expect(page.locator('#watchlist-section')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FilmBox – theme', () => {
  test('theme toggle switches and persists', async ({ page }) => {
    await page.goto(BASE);
    const dark = await page.evaluate(() => document.body.classList.contains('dark'));
    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(!dark);
    expect(await page.evaluate(() => localStorage.getItem('filmbox_theme'))).toBe(dark ? 'light' : 'dark');
  });
});

test.describe('FilmBox – TV remote (webOS)', () => {
  test.use({ userAgent: WEBOS_UA, viewport: { width: 1920, height: 1080 } });

  test('TV mode, D-pad focus and Back key', async ({ page }) => {
    await page.goto(BASE);
    await waitForGrid(page);
    await expect(page.locator('body')).toHaveClass(/tv/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement.className);
    expect(focused).toContain('movie-card');
    await page.keyboard.press('Enter');
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true })));
    await expect(page.locator('#detail-modal')).toHaveClass(/hidden/);
  });
});

test.describe('FilmBox – PIN lock', () => {
  test('locked profile is refused by the API, asks for the PIN, then loads its data', async ({ page, request }) => {
    const p = await (await request.post(`${BASE}/api/profiles`, { data: { name: 'PIN ' + Date.now() } })).json();
    const set = await (await request.post(`${BASE}/api/profiles/${p.id}/pin`, { data: { pin: '4321' } })).json();
    const auth = { 'X-Profile-Token': set.token };
    await request.post(`${BASE}/api/profiles/${p.id}/favorites`, { data: { tmdbId: 157336, mediaType: 'movie', title: 'Interstellar' }, headers: auth });
    expect((await request.get(`${BASE}/api/profiles/${p.id}/favorites`)).status()).toBe(401);

    await page.goto(BASE);
    await page.evaluate(() => window.showProfileChooser());
    await page.locator(`.profile-card[data-id="${p.id}"]`).click();
    await page.fill('#pin-prompt-input', '4321');
    await page.click('#pin-prompt-confirm');
    await expect(page.locator('#favorites-section')).toBeVisible({ timeout: 10000 });

    await request.delete(`${BASE}/api/profiles/${p.id}`, { headers: auth });
  });
});
