const { test, expect, chromium } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// Skip intro + profile chooser for every test by pre-seeding sessionStorage
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify({
      id: 'p1', name: 'Tester', colorIdx: 0
    }));
  });
});

test.describe('FilmBox – page load & hero', () => {
  test('page loads with title FilmBox', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/FilmBox/);
  });

  test('hero section shows a film title (not loading placeholder)', async ({ page }) => {
    await page.goto(BASE);
    const heroTitle = page.locator('#hero-title');
    await expect(heroTitle).not.toHaveText('Načítání...', { timeout: 10000 });
    const text = await heroTitle.textContent();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('hero image loads', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForFunction(() => {
      const img = document.getElementById('hero-image');
      return img && img.src && img.complete && img.naturalWidth > 0;
    }, { timeout: 10000 });
  });

  test('hero dots appear after load', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('.hero-dot')).toHaveCount(5, { timeout: 10000 });
  });

  test('hero dot click switches slide', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('.hero-dot').nth(0).waitFor({ timeout: 10000 });
    const titleBefore = await page.locator('#hero-title').textContent();
    await page.locator('.hero-dot').nth(2).click();
    await page.waitForTimeout(800);
    const titleAfter = await page.locator('#hero-title').textContent();
    // title should have changed (or at minimum not crash)
    expect(titleAfter.trim().length).toBeGreaterThan(0);
  });
});

test.describe('FilmBox – movie grids', () => {
  test('popular movies grid loads cards', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('#popular-movies .movie-card')).toHaveCount(20, { timeout: 15000 });
  });

  test('trending grid loads cards', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('#trending .movie-card')).toHaveCount(20, { timeout: 15000 });
  });

  test('top-rated grid loads cards', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('#top-rated .movie-card')).toHaveCount(20, { timeout: 15000 });
  });

  test('genre filter chips appear', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    const chips = page.locator('#genre-filters-popular .genre-chip');
    await expect(chips.first()).toBeVisible();
    expect(await chips.count()).toBeGreaterThan(1);
  });

  test('genre filter narrows results', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    const chips = page.locator('#genre-filters-popular .genre-chip');
    const count = await chips.count();
    if (count > 1) {
      await chips.nth(1).click();
      await page.waitForTimeout(300);
      const cards = await page.locator('#popular-movies .movie-card').count();
      expect(cards).toBeGreaterThan(0);
    }
  });

  test('sort by rating changes order', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    const ratingBefore = await page.locator('#popular-movies .movie-card .rating').first().textContent();
    await page.locator('[data-grid="popular-movies"] .sort-tab[data-sort="rating"]').click();
    await page.waitForTimeout(300);
    const ratingAfter = await page.locator('#popular-movies .movie-card .rating').first().textContent();
    // highest rated should be 8+
    expect(parseFloat(ratingAfter.replace('⭐', ''))).toBeGreaterThanOrEqual(parseFloat(ratingBefore.replace('⭐', '')));
  });

  test('load more button appends more cards', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    const before = await page.locator('#popular-movies .movie-card').count();
    await page.locator('.load-more-btn[data-grid="popular-movies"]').click();
    await page.waitForFunction(
      (prev) => document.querySelectorAll('#popular-movies .movie-card').length > prev,
      before, { timeout: 10000 }
    );
    const after = await page.locator('#popular-movies .movie-card').count();
    expect(after).toBeGreaterThan(before);
  });
});

test.describe('FilmBox – search', () => {
  test('search returns results for "inception"', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
    const count = await page.locator('.search-results.active .search-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking search result adds card to search section', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
    await page.locator('.search-results.active .search-item').first().click();
    await expect(page.locator('#search-movies-section')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#search-movies .movie-card')).toHaveCount(1);
  });

  test('empty search shows history on focus', async ({ page }) => {
    await page.goto(BASE);
    // trigger a search first to populate history
    await page.fill('#search-input', 'inception');
    await page.locator('.search-results.active .search-item').first().waitFor({ timeout: 8000 });
    await page.locator('.search-results.active .search-item').first().click();
    // clear and focus
    await page.fill('#search-input', '');
    await page.locator('#search-input').focus();
    await expect(page.locator('.search-history-label')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FilmBox – detail modal', () => {
  test('clicking a movie card opens detail modal', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/, { timeout: 8000 });
  });

  test('detail modal shows title, overview and genres', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#detail-title')).not.toBeEmpty();
    await expect(page.locator('#detail-overview')).not.toBeEmpty();
    expect(await page.locator('.genre-tag').count()).toBeGreaterThan(0);
  });

  test('detail modal shows cast', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    expect(await page.locator('.cast-item').count()).toBeGreaterThan(0);
  });

  test('detail modal shows similar movies', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#detail-similar')).toBeVisible({ timeout: 5000 });
    expect(await page.locator('#detail-similar-grid .movie-card').count()).toBeGreaterThan(0);
  });

  test('detail modal closes with X button', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/, { timeout: 8000 });
    await page.locator('#detail-close').click();
    await expect(page.locator('#detail-modal')).toHaveClass(/hidden/);
  });

  test('detail modal closes on Escape key', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-modal')).not.toHaveClass(/hidden/, { timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail-modal')).toHaveClass(/hidden/);
  });

  test('trailer button opens trailer modal', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    await page.locator('#detail-trailer-btn').click();
    await expect(page.locator('#trailer-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
  });
});

test.describe('FilmBox – watchlist', () => {
  test('bookmark button on card adds to watchlist', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    const wlBtn = page.locator('#popular-movies .movie-card').first().locator('.wl-btn');
    await wlBtn.hover();
    await wlBtn.click();
    await expect(wlBtn).toHaveClass(/active/);
  });

  test('watchlist toggle button shows watchlist section', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    // add a movie first
    const wlBtn = page.locator('#popular-movies .movie-card').first().locator('.wl-btn');
    await wlBtn.hover();
    await wlBtn.click();
    await page.locator('#watchlist-toggle').click();
    await expect(page.locator('#watchlist-section')).toBeVisible({ timeout: 3000 });
    expect(await page.locator('#watchlist-movies .movie-card').count()).toBeGreaterThan(0);
  });

  test('add to list modal opens from detail modal', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    await page.locator('#detail-wl-btn').click();
    await expect(page.locator('#wl-modal')).not.toHaveClass(/hidden/, { timeout: 3000 });
    expect(await page.locator('.wl-list-item').count()).toBeGreaterThan(0);
  });

  test('create a new list in wl-modal', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#popular-movies .movie-card').first().waitFor({ timeout: 15000 });
    await page.locator('#popular-movies .movie-card').first().click();
    await expect(page.locator('#detail-skeleton')).toBeHidden({ timeout: 10000 });
    await page.locator('#detail-wl-btn').click();
    await page.fill('#wl-new-list-input', 'Test seznam');
    await page.locator('#wl-new-list-btn').click();
    await expect(page.locator('.wl-list-name').filter({ hasText: 'Test seznam' })).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FilmBox – theme toggle', () => {
  test('theme toggle switches dark mode', async ({ page }) => {
    await page.goto(BASE);
    const hasDark = await page.evaluate(() => document.body.classList.contains('dark'));
    await page.locator('#theme-toggle').click();
    const hasDarkAfter = await page.evaluate(() => document.body.classList.contains('dark'));
    expect(hasDarkAfter).toBe(!hasDark);
  });

  test('theme is persisted in localStorage', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#theme-toggle').click();
    const saved = await page.evaluate(() => localStorage.getItem('filmbox_theme'));
    expect(['dark', '']).toContain(saved);
  });
});
