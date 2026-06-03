# FilmBox Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Watched section, restore Continue Watching and Watchlist, and ship 6 smaller improvements (hero hover-pause, system dark-mode detection, search keyboard nav, player progress keyed by TMDB ID, pagehide save, global error handler).

**Architecture:** All new features use localStorage for persistence, following the existing `favorites.js` pattern. `watched.js` is a new module. `watchlist.js` is restored to the script load order with its missing HTML. `player.html` writes directly to localStorage so Continue Watching and Watched sections update correctly when the user returns to `index.html`.

**Tech Stack:** Vanilla JS, CSS, localStorage, Bootstrap Icons (already loaded)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/js/watched.js` | **Create** | Watched storage, toggle, render, refresh badges |
| `src/css/cards.css` | Modify | `.watched-badge` style |
| `src/css/navbar.css` | Modify | `.search-item.focused` style |
| `src/css/watchlist.css` | Modify | `.watched-section` header style |
| `src/js/cards.js` | Modify | Add watched badge + fix progress key to use TMDB ID |
| `src/js/player.js` | Modify | Pass `tmdbId`, `mediaType`, `posterPath` in `filmbox_player` payload |
| `src/player.html` | Modify | Progress key → TMDB ID, `pagehide` save, auto-watched at 90%, meta cache write |
| `src/js/watchlist.js` | Modify | `openModal()`/`closeModal()`, fix progress key, overhaul `renderContinueWatching()` |
| `src/js/utils.js` | Modify | Global `unhandledrejection` handler |
| `src/js/hero.js` | Modify | Hover pause + pass `tmdbId` to `openPrehrajSearch` |
| `src/js/intro.js` | Modify | `prefers-color-scheme` detection on first visit |
| `src/js/search.js` | Modify | `↑`/`↓`/`Enter` keyboard navigation in results |
| `src/js/detail.js` | Modify | Add Watched + Watchlist buttons; update `openPrehrajSearch` calls; remove `closeWlModal` guard |
| `src/index.html` | Modify | Add all new HTML sections + wl-modal + correct script load order |

---

## Task 1: CSS — watched badge, search focus, section label

**Files:**
- Modify: `src/css/cards.css`
- Modify: `src/css/navbar.css`
- Modify: `src/css/watchlist.css`

- [ ] **Add `.watched-badge` to `src/css/cards.css`** (append at end of file)

```css
/* ── Watched badge on card ── */

.watched-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(34, 197, 94, 0.9);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 999px;
  pointer-events: none;
  z-index: 2;
}
```

- [ ] **Add `.search-item.focused` to `src/css/navbar.css`** (append at end of file)

```css
/* ── Search keyboard focus ── */

.search-item.focused {
  background: rgba(255, 255, 255, 0.07);
}

.search-history-label {
  padding: 14px 14px 6px;
  font-size: 12px;
  font-weight: 600;
  color: #71717a;
  display: flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

- [ ] **Add watched section label to `src/css/watchlist.css`** (append at end of file)

```css
/* ── Watched section ── */

.watched-time {
  font-size: 11px;
  color: #4ade80;
}
```

- [ ] **Commit**

```bash
git add src/css/cards.css src/css/navbar.css src/css/watchlist.css
git commit -m "style: add watched-badge, search focus, and watched-time CSS"
```

---

## Task 2: `watched.js` — new module

**Files:**
- Create: `src/js/watched.js`

- [ ] **Create `src/js/watched.js`** with the full content below:

```js
// ================= WATCHED =================

const WATCHED_KEY = 'filmbox_watched'

function getWatched() {
  return JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]')
}

function saveWatched(list) {
  localStorage.setItem(WATCHED_KEY, JSON.stringify(list))
}

function isWatched(id) {
  return getWatched().some(w => w.id === id)
}

// Returns true if now watched, false if removed
async function toggleWatched(movie) {
  const list = getWatched()
  const idx  = list.findIndex(w => w.id === movie.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveWatched(list)
    showToast('Odebráno ze sledovaných')
    renderWatched()
    refreshWatchedBadges()
    return false
  }
  list.unshift({
    id:         movie.id,
    mediaType:  movie.media_type || (movie.title ? 'movie' : 'tv'),
    title:      movie.title || movie.name,
    posterPath: movie.poster_path || null,
    watchedAt:  new Date().toISOString()
  })
  saveWatched(list)
  showToast('Přidáno mezi uzřené ✓')
  renderWatched()
  refreshWatchedBadges()
  return true
}

function _timeAgo(isoStr) {
  const d = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (d === 0)  return 'Dnes'
  if (d === 1)  return 'Včera'
  if (d < 7)   return d + ' dní'
  if (d < 30)  return Math.floor(d / 7) + ' týd.'
  return Math.floor(d / 30) + ' měs.'
}

function renderWatched() {
  const section   = document.getElementById('watched-section')
  const container = document.getElementById('watched-movies')
  if (!section || !container) return

  const list = getWatched()
  if (!list.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = list.map(w => `
    <div class="movie-card" onclick="openDetailModal(${w.id},'${w.mediaType}',decodeURIComponent('${encodeURIComponent(w.title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${w.posterPath || ''}" alt="${w.title}" loading="lazy">
        <button class="fav-btn active" style="background:rgba(34,197,94,0.2);color:#4ade80"
                onclick="event.stopPropagation();watchedRemoveCard(${w.id})">
          <i class="bi bi-check-circle-fill"></i>
        </button>
      </div>
      <div class="movie-info">
        <h4>${w.title}</h4>
        <div class="movie-meta">
          <span>${w.mediaType === 'tv' ? 'Seriál' : 'Film'}</span>
          <span class="watched-time">${_timeAgo(w.watchedAt)}</span>
        </div>
      </div>
    </div>
  `).join('')
}

function refreshWatchedBadges() {
  document.querySelectorAll('.movie-card').forEach(card => {
    const fn = card.getAttribute('onclick') || ''
    const m  = fn.match(/openDetailModal\((\d+)/)
    if (!m) return
    const id     = parseInt(m[1])
    const poster = card.querySelector('.movie-poster')
    if (!poster) return
    let badge = poster.querySelector('.watched-badge')
    if (isWatched(id)) {
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'watched-badge'
        badge.textContent = '✓ Seen'
        poster.appendChild(badge)
      }
    } else {
      badge?.remove()
    }
  })
}

window.watchedRemoveCard = function(id) {
  const list = getWatched().filter(w => w.id !== id)
  saveWatched(list)
  renderWatched()
  refreshWatchedBadges()
  showToast('Odebráno ze sledovaných')
}

window.isWatched     = isWatched
window.toggleWatched = toggleWatched
window.renderWatched = renderWatched
window.reloadWatched = renderWatched

document.addEventListener('DOMContentLoaded', () => {
  renderWatched()
})
```

- [ ] **Manual test:** In browser console on `index.html`, run:
```js
localStorage.setItem('filmbox_watched', JSON.stringify([{id:1,mediaType:'movie',title:'Test',posterPath:null,watchedAt:new Date().toISOString()}]))
renderWatched()
```
Verify watched section appears.

- [ ] **Commit**

```bash
git add src/js/watched.js
git commit -m "feat: add watched.js module with storage, render, and badge refresh"
```

---

## Task 3: `cards.js` — watched badge + TMDB ID progress key

**Files:**
- Modify: `src/js/cards.js`

- [ ] **Replace the `buildCard` function** in `src/js/cards.js` (lines 3–29) with:

```js
function buildCard(movie, extraClass = '') {
  const title     = movie.title || movie.name
  const year      = (movie.release_date || movie.first_air_date || '').slice(0, 4)
  const mediaType = movie.media_type || (movie.title ? 'movie' : 'tv')
  const inFav     = isFavorite(movie.id, mediaType)
  const watched   = typeof isWatched === 'function' && isWatched(movie.id)
  const progress  = localStorage.getItem('filmbox_progress_' + movie.id)
  const pct = progress && movie.runtime
    ? Math.min(100, (parseFloat(progress) / (movie.runtime * 60)) * 100).toFixed(0)
    : null

  return `
    <div class="movie-card${extraClass ? ' ' + extraClass : ''}" onclick="openDetailModal(${movie.id},'${mediaType}',decodeURIComponent('${encodeURIComponent(title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${title}" loading="lazy">
        <div class="rating">⭐ ${(movie.vote_average || 0).toFixed(1)}</div>
        ${watched ? '<div class="watched-badge">✓ Seen</div>' : ''}
        <button class="fav-btn${inFav ? ' active' : ''}" data-tmdb-id="${movie.id}" data-media-type="${mediaType}" onclick="event.stopPropagation();favToggleCard(this,${movie.id},'${mediaType}')">
          <i class="bi ${inFav ? 'bi-heart-fill' : 'bi-heart'}"></i>
        </button>
        ${pct ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="movie-info">
        <h4>${title}</h4>
        <div class="movie-meta"><span>${year}</span><span>${mediaType === 'tv' ? 'Seriál' : 'Film'}</span></div>
      </div>
    </div>
  `
}
```

Key changes: progress key is now `'filmbox_progress_' + movie.id` (was title-based); `watched` badge injected when `isWatched(movie.id)` is true.

- [ ] **Commit**

```bash
git add src/js/cards.js
git commit -m "feat: add watched badge to buildCard; fix progress key to use TMDB ID"
```

---

## Task 4: `player.js` — pass tmdbId/mediaType/posterPath in payload

**Files:**
- Modify: `src/js/player.js`

- [ ] **Update `openPrehrajSearch` signature and payload** in `src/js/player.js`.

Replace the function signature line:
```js
async function openPrehrajSearch(title) {
```
with:
```js
async function openPrehrajSearch(title, tmdbId = null, mediaType = null, posterPath = null) {
```

Replace the `sessionStorage.setItem` line inside the link click handler:
```js
sessionStorage.setItem('filmbox_player', JSON.stringify({ title: prehrajModalTitle.textContent, videos: valid }))
```
with:
```js
sessionStorage.setItem('filmbox_player', JSON.stringify({
  title:      prehrajModalTitle.textContent,
  videos:     valid,
  tmdbId,
  mediaType,
  posterPath
}))
```

- [ ] **Commit**

```bash
git add src/js/player.js
git commit -m "feat: pass tmdbId, mediaType, posterPath through filmbox_player payload"
```

---

## Task 5: `player.html` — TMDB ID key, pagehide save, auto-watched, meta cache

**Files:**
- Modify: `src/player.html`

- [ ] **Replace the `playerKey` assignment** (around line 469) from:
```js
playerKey = 'filmbox_progress_' + (data.title || 'unknown').replace(/\s+/g, '_')
```
to:
```js
playerKey = data.tmdbId
  ? 'filmbox_progress_' + data.tmdbId
  : 'filmbox_progress_' + (data.title || 'unknown').replace(/\s+/g, '_')
```

- [ ] **Add meta cache write** directly after the `playerKey` assignment:
```js
if (data.tmdbId) {
  localStorage.setItem('filmbox_meta_' + data.tmdbId, JSON.stringify({
    id:         data.tmdbId,
    title:      data.title,
    media_type: data.mediaType || 'movie',
    mediaType:  data.mediaType || 'movie',
    poster_path: data.posterPath || null
  }))
}
```

- [ ] **Add `_watchedFired` flag and auto-watched logic** inside the existing `video.addEventListener('timeupdate', ...)` handler. After the `progressSaveTimer` block, add:
```js
// Auto-mark watched at 90%
if (!_watchedFired && video.duration && video.currentTime / video.duration >= 0.9) {
  _watchedFired = true
  const _raw = sessionStorage.getItem('filmbox_player')
  if (_raw) {
    const _d = JSON.parse(_raw)
    if (_d.tmdbId) {
      const _wKey  = 'filmbox_watched'
      const _wList = JSON.parse(localStorage.getItem(_wKey) || '[]')
      if (!_wList.some(w => w.id === _d.tmdbId)) {
        _wList.unshift({
          id:         _d.tmdbId,
          mediaType:  _d.mediaType || 'movie',
          title:      _d.title,
          posterPath: _d.posterPath || null,
          watchedAt:  new Date().toISOString()
        })
        localStorage.setItem(_wKey, JSON.stringify(_wList))
      }
    }
  }
}
```

Declare `let _watchedFired = false` just before the `video.addEventListener('loadedmetadata', ...)` block.

- [ ] **Add `pagehide` save** anywhere before the closing `</script>` tag:
```js
window.addEventListener('pagehide', () => {
  if (playerKey && video.currentTime > 5) {
    localStorage.setItem(playerKey, video.currentTime)
  }
})
```

- [ ] **Manual test:** Play a video in the player, seek to ~91%, then navigate back. Open `index.html` and verify the movie appears in Continue Watching (after Task 9 adds the HTML section) and in Watched.

- [ ] **Commit**

```bash
git add src/player.html
git commit -m "feat: TMDB ID progress key, pagehide save, auto-watched at 90%, meta cache"
```

---

## Task 6: `watchlist.js` — openModal/closeModal + renderContinueWatching overhaul

**Files:**
- Modify: `src/js/watchlist.js`

- [ ] **Replace `openWlModal`** body (lines 193–196):

Replace:
```js
function openWlModal(movie) {
  wlModalMovie = movie
  const modal = document.getElementById('wl-modal')
  modal.classList.remove('hidden')
  document.body.classList.add('modal-open')
  renderWlModalLists()
}
```
with:
```js
function openWlModal(movie) {
  wlModalMovie = movie
  const modal = document.getElementById('wl-modal')
  modal.classList.remove('hidden')
  openModal()
  renderWlModalLists()
}
```

- [ ] **Replace `closeWlModal`** body (lines 198–201):

Replace:
```js
function closeWlModal() {
  document.getElementById('wl-modal').classList.add('hidden')
  document.body.classList.remove('modal-open')
  wlModalMovie = null
}
```
with:
```js
function closeWlModal() {
  document.getElementById('wl-modal').classList.add('hidden')
  closeModal()
  wlModalMovie = null
}
```

- [ ] **Replace `renderContinueWatching`** entirely (lines 3–19) with the version that scans localStorage for any TMDB ID that has saved progress and whose metadata was cached by player.html:

```js
function renderContinueWatching() {
  const section   = document.getElementById('continue-watching-section')
  const container = document.getElementById('continue-watching-movies')
  if (!section || !container) return

  const items = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('filmbox_progress_')) continue
    const tmdbId   = key.replace('filmbox_progress_', '')
    const progress = parseFloat(localStorage.getItem(key))
    if (!progress || progress <= 30) continue
    // Skip if already in Watched list
    if (typeof isWatched === 'function' && isWatched(parseInt(tmdbId))) continue
    const metaRaw = localStorage.getItem('filmbox_meta_' + tmdbId)
    if (!metaRaw) continue
    items.push({ ...JSON.parse(metaRaw), _progress: progress })
  }

  if (!items.length) { section.style.display = 'none'; return }
  section.style.display = 'block'
  container.innerHTML = items.map(m => buildCard(m, 'continue-card')).join('')
}
```

- [ ] **Add optional chaining to `watchlist-toggle` listener** (line 258) to prevent a crash if the button isn't in the DOM:

Replace:
```js
document.getElementById('watchlist-toggle').addEventListener('click', () => {
```
with:
```js
document.getElementById('watchlist-toggle')?.addEventListener('click', () => {
```

- [ ] **Add DOMContentLoaded call for `renderContinueWatching`** at the very end of the file:

```js
document.addEventListener('DOMContentLoaded', () => {
  renderContinueWatching()
  renderWatchlist()
})
```

- [ ] **Commit**

```bash
git add src/js/watchlist.js
git commit -m "feat: fix watchlist openModal/closeModal, overhaul renderContinueWatching to use meta cache"
```

---

## Task 7: `utils.js` — global error handler

**Files:**
- Modify: `src/js/utils.js`

- [ ] **Append at the end of `src/js/utils.js`**:

```js
// ================= GLOBAL ERROR HANDLER =================

window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.name !== 'AbortError') {
    const msg = e.reason.message || 'Něco se pokazilo'
    showToast('Chyba: ' + msg)
  }
})
```

- [ ] **Manual test:** In the browser console run `Promise.reject(new Error('test error'))` — verify a toast appears saying "Chyba: test error".

- [ ] **Commit**

```bash
git add src/js/utils.js
git commit -m "feat: global unhandledrejection handler shows toast"
```

---

## Task 8: `hero.js` — hover pause + pass tmdbId to openPrehrajSearch

**Files:**
- Modify: `src/js/hero.js`

- [ ] **Update hero play button onclick** in `setHero` to pass tmdbId and mediaType. Replace:
```js
document.getElementById('hero-play-btn').onclick = () => openPrehrajSearch(movieTitle)
```
with:
```js
document.getElementById('hero-play-btn').onclick = () =>
  openPrehrajSearch(movieTitle, movie.id, movie.media_type || 'movie', movie.poster_path || null)
```

- [ ] **Add hover-pause** at the end of `loadHeroMovies`, after `startHeroRotation()`:

```js
const banner = document.querySelector('.hero-banner')
if (banner) {
  banner.addEventListener('mouseenter', () => clearInterval(heroTimer))
  banner.addEventListener('mouseleave', () => startHeroRotation())
}
```

- [ ] **Manual test:** Load `index.html`, hover over the hero — dots should stop rotating. Mouse out — rotation resumes.

- [ ] **Commit**

```bash
git add src/js/hero.js
git commit -m "feat: hero pauses rotation on hover; pass tmdbId to player"
```

---

## Task 9: `intro.js` — prefers-color-scheme on first visit

**Files:**
- Modify: `src/js/intro.js`

- [ ] **Find the DOMContentLoaded block** in `intro.js` (around line 217). Find this line near the end of the block:

```js
// If profile already active in this tab → skip intro
const active = getActiveProfile()
if (active) {
```

**Insert before it**:
```js
// Apply system dark-mode preference on first visit (no stored theme, no active session)
if (!localStorage.getItem('filmbox_theme') && !sessionStorage.getItem('filmbox_active_profile')) {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.classList.add('dark')
  }
}
```

- [ ] **Manual test:** Clear localStorage and sessionStorage in a browser with system dark mode → verify body gets `dark` class before profile chooser appears.

- [ ] **Commit**

```bash
git add src/js/intro.js
git commit -m "feat: apply prefers-color-scheme on first visit before profile chooser"
```

---

## Task 10: `search.js` — keyboard navigation

**Files:**
- Modify: `src/js/search.js`

- [ ] **Add `searchFocusIdx` variable** at the top of the file, after the existing `const addedMovieIds = new Set()` line:

```js
let searchFocusIdx = -1
```

- [ ] **Add a `setSearchFocus` helper** after the `searchFocusIdx` declaration:

```js
function setSearchFocus(idx) {
  const items = searchResults.querySelectorAll('.search-item')
  if (!items.length) return
  searchFocusIdx = Math.max(-1, Math.min(idx, items.length - 1))
  items.forEach((el, i) => el.classList.toggle('focused', i === searchFocusIdx))
}
```

- [ ] **Reset `searchFocusIdx` when results render** — in `performSearch`, after `searchResults.innerHTML = ''` add `searchFocusIdx = -1`, and after `showHistory` renders add the same reset. The simplest place is inside `showHistory()` at the top:

In `showHistory()` add as first line of the function body:
```js
searchFocusIdx = -1
```

And inside `performSearch`, after the line `searchResults.innerHTML = ''`:
```js
searchFocusIdx = -1
```

- [ ] **Add keyboard handler on `searchInput`** — add this block directly after the existing `searchInput.addEventListener('input', ...)` block:

```js
searchInput.addEventListener('keydown', e => {
  if (!searchResults.classList.contains('active')) return
  const items = searchResults.querySelectorAll('.search-item')
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setSearchFocus(searchFocusIdx + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    setSearchFocus(searchFocusIdx - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (searchFocusIdx >= 0 && items[searchFocusIdx]) {
      items[searchFocusIdx].click()
    }
  }
})
```

- [ ] **Manual test:** Type in the search box, press `↓` twice → second result gets `.focused` highlight. Press `Enter` → that item is selected and detail modal opens.

- [ ] **Commit**

```bash
git add src/js/search.js
git commit -m "feat: keyboard navigation (↑/↓/Enter) in search results"
```

---

## Task 11: `detail.js` — Watched + Watchlist buttons; update openPrehrajSearch calls

**Files:**
- Modify: `src/js/detail.js`

- [ ] **Update the play button onclick** inside `openDetailModal` to pass tmdbId/mediaType/posterPath. Replace:
```js
document.getElementById('detail-play-btn').onclick = () => {
  closeDetailModal()
  openPrehrajSearch(movieTitle)
}
```
with:
```js
document.getElementById('detail-play-btn').onclick = () => {
  closeDetailModal()
  openPrehrajSearch(movieTitle, id, type, d.poster_path || null)
}
```

- [ ] **Update the episode onclick** in `loadSeason` to pass tmdbId. Replace:
```js
return `
  <div class="episode-item" onclick="openPrehrajSearch(decodeURIComponent('${query}'))">
```
with:
```js
return `
  <div class="episode-item" onclick="openPrehrajSearch(decodeURIComponent('${query}'),${tvId},'tv')">
```

- [ ] **Add Watched button wiring** inside `openDetailModal`, after the existing `favBtn.onclick = ...` line:

```js
const watchedBtn = document.getElementById('detail-watched-btn')
if (watchedBtn) {
  const updateWatchedBtn = () => {
    const w = isWatched(id)
    watchedBtn.innerHTML = `<i class="bi ${w ? 'bi-check-circle-fill' : 'bi-check-circle'}"></i> ${w ? 'Uzřeno' : 'Označit'}`
    watchedBtn.style.color = w ? '#4ade80' : ''
  }
  updateWatchedBtn()
  watchedBtn.onclick = async () => { await toggleWatched(movieData); updateWatchedBtn() }
}
```

- [ ] **Add Watchlist button wiring** directly after the watched button block:

```js
const wlBtn = document.getElementById('detail-wl-btn')
if (wlBtn) {
  const inAny = isInAnyList(id)
  wlBtn.innerHTML = `<i class="bi ${inAny ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i> ${inAny ? 'V seznamu' : 'Přidat'}`
  wlBtn.onclick = () => openWlModal(movieData)
}
```

- [ ] **Replace `closeWlModal` guard** with direct call. Replace:
```js
if (typeof closeWlModal === 'function') closeWlModal()
```
with:
```js
closeWlModal()
```

- [ ] **Commit**

```bash
git add src/js/detail.js
git commit -m "feat: wire Watched and Watchlist buttons in detail modal; fix episode search passthrough"
```

---

## Task 12: `index.html` — all HTML sections, wl-modal, and script load order

**Files:**
- Modify: `src/index.html`

- [ ] **Add Continue Watching section** — insert after `</header>` (line 91) and before `<section class="hero container">`:

```html
<!-- ── Continue Watching ── -->
<main class="container" id="continue-watching-section" style="display:none; padding-top: 40px;">
  <section>
    <div class="section-header">
      <div>
        <h3>Pokračovat ve sledování</h3>
        <p>Tam, kde jste skončili</p>
      </div>
    </div>
    <div class="movies-grid" id="continue-watching-movies"></div>
  </section>
</main>
```

- [ ] **Add Watchlist section** — insert after the closing `</main>` of `#favorites-section` and before `#search-movies-section`:

```html
<!-- ── Watchlist ── -->
<main class="container" id="watchlist-section" style="display:none; padding-top: 40px;">
  <section>
    <div class="section-header">
      <div>
        <h3>Můj seznam</h3>
        <p>Filmy, které chcete vidět</p>
      </div>
      <button id="clear-watchlist" class="info-btn" style="font-size:13px; padding:8px 16px;">
        <i class="bi bi-trash"></i> Vymazat
      </button>
    </div>
    <div id="watchlist-tabs" class="watchlist-tabs"></div>
    <div class="movies-grid" id="watchlist-movies"></div>
  </section>
</main>
```

- [ ] **Add Watched section** — insert after the closing `</main>` of `<main class="container categories">` (after the top-rated section), before the closing `</div id="detail-modal">`:

```html
<!-- ── Watched ── -->
<main class="container" id="watched-section" style="display:none; padding-top: 40px; padding-bottom: 60px;">
  <section>
    <div class="section-header">
      <div>
        <h3>Uzřeno</h3>
        <p>Filmy a seriály, které jste již viděli</p>
      </div>
    </div>
    <div class="movies-grid" id="watched-movies"></div>
  </section>
</main>
```

- [ ] **Add Watched and Watchlist buttons to the detail modal** `.detail-actions` div. After the existing `detail-fav-btn` button:

```html
<button id="detail-watched-btn" class="info-btn">
  <i class="bi bi-check-circle"></i> Označit
</button>
<button id="detail-wl-btn" class="info-btn">
  <i class="bi bi-bookmark"></i> Přidat
</button>
```

- [ ] **Add wl-modal** — insert before the closing `</body>` tag, after `#actor-modal`:

```html
<!-- Watchlist modal -->
<div id="wl-modal" class="wl-modal hidden">
  <div class="wl-modal-backdrop" id="wl-modal-backdrop"></div>
  <div class="wl-modal-inner">
    <div class="wl-modal-header">
      <h3>Přidat do seznamu</h3>
      <button id="wl-modal-close"><i class="bi bi-x-lg"></i></button>
    </div>
    <div id="wl-modal-lists"></div>
    <div class="wl-modal-footer">
      <input type="text" id="wl-new-list-input" placeholder="Nový seznam..." maxlength="30" />
      <button id="wl-new-list-btn" class="play-btn"><i class="bi bi-plus-lg"></i></button>
    </div>
  </div>
</div>
```

- [ ] **Update script load order** — replace the entire `<script>` block at the bottom of `<body>` with:

```html
<script src="js/intro.js"></script>
<script src="js/utils.js"></script>
<script src="js/watchlist.js"></script>
<script src="js/favorites.js"></script>
<script src="js/watched.js"></script>
<script src="js/cards.js"></script>
<script src="js/trailer.js"></script>
<script src="js/actor.js"></script>
<script src="js/player.js"></script>
<script src="js/detail.js"></script>
<script src="js/search.js"></script>
<script src="js/hero.js"></script>
<script src="js/main.js"></script>
```

- [ ] **Manual test:** Open `index.html`. Open the browser console and verify no errors. Open a detail modal → confirm Watched and Watchlist buttons appear. Click Watched → green tick appears, toast shows. Close modal → Watched section appears at bottom of page.

- [ ] **Commit**

```bash
git add src/index.html
git commit -m "feat: add Continue Watching, Watchlist, Watched sections and wl-modal to index.html; fix script load order"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Watched section (new) — Tasks 1, 2, 11, 12
- ✅ Continue Watching (restored) — Tasks 5, 6, 12
- ✅ Watchlist (restored) — Tasks 6, 11, 12
- ✅ Hero pause on hover — Task 8
- ✅ prefers-color-scheme — Task 9
- ✅ Search keyboard nav — Task 10
- ✅ Progress key → TMDB ID — Tasks 3, 4, 5, 6
- ✅ pagehide save — Task 5
- ✅ Global error handler — Task 7
- ✅ `closeWlModal` guard removed (now real function) — Task 11
- ✅ `openModal()`/`closeModal()` for wl-modal — Task 6

**Type consistency check:**
- `openPrehrajSearch(title, tmdbId, mediaType, posterPath)` signature set in Task 4, called correctly in Tasks 8 and 11 ✅
- `filmbox_meta_<tmdbId>` written in Task 5, read in Task 6 ✅
- `filmbox_progress_<tmdbId>` written in Task 5 (player), read in Tasks 3 and 6 ✅
- `isWatched(id)` defined in Task 2, used in Tasks 3 and 6 ✅
- `toggleWatched(movie)` defined in Task 2, called in Task 11 ✅
- `openWlModal(movie)` already in watchlist.js, called in Task 11 ✅
- `wl-modal-close`, `wl-modal-backdrop`, `wl-new-list-btn`, `wl-new-list-input` — all added in Task 12 HTML, referenced in watchlist.js ✅
