# FilmBox – Feature Expansion Design
**Date:** 2026-05-22  
**Status:** Approved

---

## Overview

Add eight improvements to FilmBox: a new Watched section, restored Continue Watching and Watchlist sections, hero hover-pause, system dark-mode detection, search keyboard navigation, improved player progress tracking, and a global error handler.

---

## 1. Page Layout

Final section order (sections only render when they have content):

```
Navbar
Hero
Continue Watching   ← restored
Favorites           ← existing
Watchlist           ← restored
Popular / Trending / Top Rated  ← existing
Watched             ← new (archive, always at bottom)
```

---

## 2. Watched Section (new)

### Storage
`localStorage` key `filmbox_watched` — JSON array of:
```js
{ id, mediaType, title, posterPath, watchedAt }  // watchedAt = ISO timestamp
```

### Auto-complete trigger
In `player.html`: when `currentTime / duration >= 0.90`, call `markWatched()` once per session (guarded by a `_watchedFired` flag). Also fires on `pagehide` if progress ≥ 90%.

`markWatched()` reads `filmbox_player` from sessionStorage (which already holds `{ title, videos, tmdbId, mediaType }`) and appends to `filmbox_watched`.

### Manual toggle
"✓ Watched" button added to the detail modal action row. Clicking when unwatched adds to list; clicking when already watched removes it. Button turns green when active.

### Card badge (option B)
All `buildCard()` calls check `isWatched(id)`. If true, a `<div class="watched-badge">✓ Seen</div>` is injected into the poster. Visible in all grids and search results.

### Watched section UI
- Same grid layout as Favorites
- Each card has a `✕` remove button (top-right, visible on hover)
- Section header: "Uzřeno" / subtitle: "Filmy a seriály, které jste již viděli"
- Hidden when list is empty

### New file: `src/js/watched.js`
Exports (on `window`): `isWatched(id)`, `toggleWatched(movie)`, `markWatched(data)`, `renderWatched()`, `reloadWatched()`.

---

## 3. Continue Watching (restored)

### What exists
`watchlist.js` already has `renderContinueWatching()`. It iterates all watchlist lists to find movies with saved progress > 30s.

### Progress key fix
Change progress key from `filmbox_progress_<title>` → `filmbox_progress_<tmdbId>`. Update `player.html` (reads/writes key), `cards.js` `buildCard()` (reads key for progress bar), and `renderContinueWatching()` (reads key).

TMDB ID is stored in `filmbox_player` sessionStorage alongside title — no new data needed.

### HTML section
Added above Favorites in `index.html`:
```html
<main class="container" id="continue-watching-section" style="display:none; padding-top:40px">
  <section>
    <div class="section-header">…</div>
    <div class="movies-grid" id="continue-watching-movies"></div>
  </section>
</main>
```

---

## 4. Watchlist (restored)

### What exists
`watchlist.js` has the full multi-list engine and `wl-modal`. All that's missing is the HTML and the `<script>` tag.

### HTML additions to `index.html`
1. Watchlist section (above Popular, after Favorites)
2. `wl-modal` markup (for "add to list" picker)
3. Watchlist toggle button in detail modal (`detail-wl-btn`)

### Script order
`watchlist.js` inserted between `utils.js` and `favorites.js`.

### Detail modal
Add `<button id="detail-wl-btn" class="info-btn">🔖 Přidat</button>` to the `.detail-actions` row. `detail.js` wires it up to `openWlModal(movieData)`.

### Guard removal
The `if (typeof closeWlModal === 'function')` guard in `detail.js` is replaced with the direct call `closeWlModal()` once the script is loaded.

---

## 5. Hero Pause on Hover

In `hero.js`, add to the end of `loadHeroMovies()` (after `startHeroRotation()`):

```js
const banner = document.querySelector('.hero-banner')
banner.addEventListener('mouseenter', () => clearInterval(heroTimer))
banner.addEventListener('mouseleave', () => startHeroRotation())
```

---

## 6. System Dark Mode Detection

In `intro.js`, in the DOMContentLoaded boot block, before showing the profile chooser:

```js
if (!localStorage.getItem('filmbox_theme') && !getActiveProfile()) {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.classList.add('dark')
  }
}
```

This only applies on first visit (no stored theme, no active profile).

---

## 7. Search Keyboard Navigation

In `search.js`, add a `searchFocusIdx` variable (default `-1`). On `keydown` in `searchInput`:

- `ArrowDown` → increment index, add `.focused` class to matching `.search-item`
- `ArrowUp` → decrement index
- `Enter` → trigger click on the focused item
- `Escape` → close dropdown (already handled globally)

Visual: `.search-item.focused` gets `background: rgba(255,255,255,0.07)` — add to `navbar.css`.

Reset `searchFocusIdx` to `-1` when new results render.

---

## 8. Player Progress — TMDB ID Key + pagehide Save

### Key change
`playerKey` in `player.html` changes from:
```js
'filmbox_progress_' + (data.title || '').replace(/\s+/g, '_')
```
to:
```js
data.tmdbId ? 'filmbox_progress_' + data.tmdbId : null
```

`filmbox_player` sessionStorage must include `tmdbId`. Update `player.js` (the prehraj modal) to include `tmdbId: currentDetailId` when building the player payload.

### pagehide save
```js
window.addEventListener('pagehide', () => {
  if (playerKey && video.currentTime > 0) {
    localStorage.setItem(playerKey, video.currentTime)
  }
})
```

---

## 9. Global Error Handler

In `utils.js`, add at the bottom:

```js
window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.name !== 'AbortError') {
    showToast('Chyba: ' + (e.reason.message || 'Něco se pokazilo'))
  }
})
```

Individual `catch` blocks in `fetchMovies` already show inline error messages — the global handler catches anything else that slips through (trailer load, actor load, etc.).

---

## Files Changed

| File | Change |
|------|--------|
| `src/index.html` | Add HTML sections for Continue Watching, Watchlist, Watched; add `watchlist.js` script; add `watched.js` script |
| `src/js/watched.js` | **New file** — watched storage, toggle, render |
| `src/js/watchlist.js` | Use `openModal()`/`closeModal()` helpers; minor: progress key ref update |
| `src/js/cards.js` | Add `isWatched` badge to `buildCard()`; update progress key to use TMDB ID |
| `src/js/detail.js` | Add Watched + Watchlist buttons; wire `openWlModal`; remove `closeWlModal` guard |
| `src/js/player.js` | Include `tmdbId` in `filmbox_player` payload |
| `src/js/hero.js` | Add mouseenter/mouseleave to `.hero-banner` |
| `src/js/intro.js` | Add `prefers-color-scheme` check |
| `src/js/search.js` | Add keyboard navigation |
| `src/js/utils.js` | Add global error handler |
| `src/player.html` | Change progress key to TMDB ID; add `pagehide` save; add auto-watched trigger |
| `src/css/navbar.css` | Add `.search-item.focused` style |
| `src/css/cards.css` | Add `.watched-badge` style |
| `src/css/watchlist.css` | Add watched section styles |

---

## Out of Scope

- Server-side watched tracking (localStorage only, per-device)
- Watched sync across profiles
- Rating or review system
