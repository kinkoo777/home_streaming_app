// ================= SEARCH =================

const searchInput         = document.getElementById('search-input')
const searchResults       = document.getElementById('search-results')
const searchWrapper       = document.getElementById('search-wrapper')
const searchMobileBtn     = document.getElementById('search-mobile-btn')
const searchCloseBtn      = document.getElementById('search-close-mobile')
const searchMoviesSection = document.getElementById('search-movies-section')
const searchMoviesGrid    = document.getElementById('search-movies')

let searchFocusIdx = -1
let searchSeq = 0
let lastResults = []

function setSearchFocus(idx) {
  const items = searchResults.querySelectorAll('.search-item')
  if (!items.length) return
  searchFocusIdx = Math.max(-1, Math.min(idx, items.length - 1))
  items.forEach((el, i) => el.classList.toggle('focused', i === searchFocusIdx))
  if (searchFocusIdx >= 0) items[searchFocusIdx].scrollIntoView({ block: 'nearest' })
}

function openDropdown() { searchResults.classList.add('active') }
function closeDropdown() { searchResults.classList.remove('active'); searchFocusIdx = -1 }

// ── Search history ──

function getSearchHistory() {
  try { return JSON.parse(lsGet('filmbox_history', '[]')) || [] } catch (e) { return [] }
}
function addToHistory(q) {
  const h = getSearchHistory().filter(t => t !== q)
  h.unshift(q)
  lsSet('filmbox_history', JSON.stringify(h.slice(0, 8)))
}

function removeFromHistory(q) {
  lsSet('filmbox_history', JSON.stringify(getSearchHistory().filter(t => t !== q)))
}

function showHistory() {
  searchFocusIdx = -1
  const h = getSearchHistory()
  if (!h.length) { closeDropdown(); return }
  searchResults.innerHTML = `
    <div class="search-section-head">
      <span>Nedávné hledání</span>
      <button type="button" class="search-clear" data-clear-history>Vymazat</button>
    </div>
    ${h.map(t => `
      <div class="search-item search-recent" data-history="${escapeHtml(t)}">
        <span class="recent-icon"><i class="bi bi-clock-history"></i></span>
        <span class="recent-text">${escapeHtml(t)}</span>
        <button type="button" class="recent-remove" data-remove-history="${escapeHtml(t)}" aria-label="Odebrat z historie" tabindex="-1"><i class="bi bi-x-lg"></i></button>
      </div>`).join('')}`
  openDropdown()
}

function isPlayable(item) {
  return item && item.poster_path && (item.media_type === 'movie' || item.media_type === 'tv' || item.title)
}

async function fetchSearch(query) {
  const res  = await fetch(`/tmdb/search?q=${encodeURIComponent(query)}`)
  const data = await res.json()
  const list = (data.results || []).filter(isPlayable)
  rememberMovies(list)
  return list
}

// ── Search mode: TMDB (films & series) or the video sites directly ──
const searchModeEl = document.getElementById('search-mode')
let searchMode = lsGet('filmbox_search_mode', 'tmdb') === 'sources' ? 'sources' : 'tmdb'

function applySearchMode() {
  searchModeEl.querySelectorAll('[data-mode]').forEach(b => {
    const on = b.dataset.mode === searchMode
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', String(on))
  })
  searchWrapper.classList.toggle('mode-sources', searchMode === 'sources')
  searchInput.placeholder = searchMode === 'sources' ? 'Hledat na zdrojích' : 'Filmy a seriály'
}
applySearchMode()

searchModeEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-mode]')
  if (!btn || btn.dataset.mode === searchMode) return
  searchMode = btn.dataset.mode
  lsSet('filmbox_search_mode', searchMode)
  applySearchMode()
  lastResults = []
  searchSeq++
  searchInput.focus()
  const q = searchInput.value.trim()
  if (q.length >= 2) runQuery(q); else showHistory()
})

function runQuery(q) {
  searchInput.dataset.lastQuery = q
  if (searchMode === 'sources') performSourceSuggest(q); else performSearch(q)
}

// "Zdroje" mode: the sites' own search hints (same /suggest as the source picker).
async function performSourceSuggest(query) {
  const seq = ++searchSeq
  let list = []
  try {
    const sites = typeof sitesParam === 'function' ? sitesParam() : ''
    const res = await fetch(`/suggest?q=${encodeURIComponent(query)}${sites}`)
    if (res.ok) list = await res.json()
  } catch (e) {}
  if (seq !== searchSeq) return
  searchFocusIdx = -1
  const t = query.trim().toLowerCase()
  searchResults.innerHTML = directSearchRow(query) + list.filter(s => s.term.toLowerCase() !== t).slice(0, 8).map(s => {
    const term = escapeHtml(s.term)
    const hint = s.term.toLowerCase().indexOf(t) === 0 ? escapeHtml(s.term.slice(0, t.length)) + '<b>' + escapeHtml(s.term.slice(t.length)) + '</b>' : term
    return `
      <div class="search-item search-suggest" data-direct="${term}">
        <span class="search-hist-icon"><i class="bi bi-search"></i></span>
        <div class="search-item-info"><h4>${hint}</h4></div>
      </div>`
  }).join('') + '<div class="search-footer"><kbd>Enter</kbd> hledá přímo na zdrojích</div>'
  openDropdown()
}

// Search the video sites with the typed text as-is, bypassing TMDB.
function directSearchRow(query) {
  const sites = typeof sitesLabel === 'function' ? sitesLabel() : 'zdrojích'
  return `
    <div class="search-item search-direct" data-direct="${escapeHtml(query)}">
      <span class="search-hist-icon"><i class="bi bi-collection-play"></i></span>
      <div class="search-item-info">
        <h4>Hledat „${escapeHtml(query)}“ přímo na zdrojích</h4>
        <p>${escapeHtml(sites)} · bez TMDB</p>
      </div>
    </div>`
}

function openDirectSearch(query) {
  const q = String(query || '').trim()
  if (!q) return
  addToHistory(q)
  closeDropdown()
  closeSearchUI()
  openPrehrajSearch(q)
}

async function performSearch(query) {
  const seq = ++searchSeq
  try {
    const list = await fetchSearch(query)
    if (seq !== searchSeq) return          // a newer query already answered
    lastResults = list
    searchFocusIdx = -1

    if (!list.length) {
      searchResults.innerHTML = '<div class="search-empty">V TMDB nebylo nic nalezeno.</div>' + directSearchRow(query)
      openDropdown()
      return
    }
    searchResults.innerHTML = directSearchRow(query) + list.slice(0, 7).map(movie => {
      const title = escapeHtml(movie.title || movie.name)
      const year  = (movie.release_date || movie.first_air_date || '').slice(0, 4)
      return `
        <div class="search-item" data-id="${movie.id}">
          <img src="${tmdbImg(movie.poster_path, 'w92')}" alt="" loading="lazy"/>
          <div class="search-item-info">
            <h4>${title}</h4>
            <p><span class="tag">${movie.media_type === 'tv' ? 'Seriál' : 'Film'}</span>${year}${movie.vote_average ? ' · ★ ' + Number(movie.vote_average).toFixed(1) : ''}</p>
          </div>
        </div>`
    }).join('') + `<div class="search-footer">Stiskněte <kbd>Enter</kbd> pro všechny výsledky (${list.length})</div>`
    openDropdown()
  } catch (e) {
    // TMDB unreachable — the sites can still be searched directly.
    if (seq !== searchSeq) return
    lastResults = []
    searchFocusIdx = -1
    searchResults.innerHTML = '<div class="search-empty">TMDB je nedostupné.</div>' + directSearchRow(query)
    openDropdown()
  }
}

// Full results grid (Enter)
async function showAllResults(query) {
  addToHistory(query)
  closeDropdown()
  let list = lastResults
  if (!list.length || searchInput.dataset.lastQuery !== query) list = await fetchSearch(query)
  searchMoviesSection.dataset.query = query
  document.getElementById('search-results-title').textContent = `Výsledky pro „${query}“`
  document.getElementById('search-results-sub').textContent = list.length ? `${list.length} titulů` : 'Nic nebylo nalezeno'
  searchMoviesGrid.innerHTML = list.map((m, i) => buildCard(m, { index: i })).join('')
  searchMoviesSection.style.display = 'block'
  searchMoviesSection.classList.add('in')
  closeSearchUI()
  searchInput.blur()
  window.scrollTo({ top: Math.max(0, searchMoviesSection.getBoundingClientRect().top + window.pageYOffset - 90), behavior: 'smooth' })
  const first = searchMoviesGrid.querySelector('.movie-card')
  if (first && document.body.classList.contains('kbd')) setTimeout(() => first.focus({ preventScroll: true }), 300)
}

function selectSearchItem(id) {
  const movie = searchDataMap[id]
  if (!movie) return
  const title = movie.title || movie.name
  addToHistory(searchInput.value.trim() || title)
  closeDropdown()
  openDetailModal(movie.id, movie.media_type || 'movie', title)
}

searchResults.addEventListener('click', e => {
  const remove = e.target.closest('[data-remove-history]')
  if (remove) {
    e.stopPropagation()                              // the button is re-rendered away; don't let "click outside" close the list
    removeFromHistory(remove.dataset.removeHistory)
    showHistory()
    searchInput.focus()
    return
  }
  if (e.target.closest('[data-clear-history]')) {
    lsSet('filmbox_history', '[]')
    closeDropdown()
    searchInput.focus()
    return
  }
  const item = e.target.closest('.search-item')
  if (!item) return
  if (item.dataset.direct != null) { openDirectSearch(item.dataset.direct); return }
  if (item.dataset.history != null) {
    searchInput.value = item.dataset.history
    runQuery(item.dataset.history)
    searchInput.focus()
    return
  }
  selectSearchItem(parseInt(item.dataset.id, 10))
})

searchInput.addEventListener('focus', () => {
  if (!searchInput.value.trim()) showHistory()
  else if (searchResults.innerHTML) openDropdown()
})

let searchDebounce = null
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce)
  const q = searchInput.value.trim()
  if (q.length < 2) {
    if (!q) showHistory(); else closeDropdown()
    return
  }
  searchDebounce = setTimeout(() => runQuery(q), searchMode === 'sources' ? 220 : 280)
})

searchInput.addEventListener('keydown', e => {
  const active = searchResults.classList.contains('active')
  const items = searchResults.querySelectorAll('.search-item')
  if (e.key === 'ArrowDown' && active && items.length) {
    e.preventDefault()
    setSearchFocus(searchFocusIdx + 1)
  } else if (e.key === 'ArrowUp' && active && searchFocusIdx >= 0) {
    e.preventDefault()
    setSearchFocus(searchFocusIdx - 1)
  } else if (e.key === 'Delete' && active && searchFocusIdx >= 0 && items[searchFocusIdx] && items[searchFocusIdx].dataset.history != null) {
    // Delete removes the highlighted recent search.
    e.preventDefault()
    const idx = searchFocusIdx
    removeFromHistory(items[searchFocusIdx].dataset.history)
    showHistory()
    setSearchFocus(Math.min(idx, searchResults.querySelectorAll('.search-item').length - 1))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (active && searchFocusIdx >= 0 && items[searchFocusIdx]) items[searchFocusIdx].click()
    else if (searchInput.value.trim().length >= 2) {
      if (searchMode === 'sources') openDirectSearch(searchInput.value.trim())
      else showAllResults(searchInput.value.trim())
    }
  }
})

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrapper') && !e.target.closest('#search-mobile-btn')) closeDropdown()
})

// Called by tv.js on Back/Esc. Returns true if something was closed.
window.closeSearchUI = function () {
  let closed = false
  if (searchResults.classList.contains('active')) { closeDropdown(); closed = true }
  if (searchWrapper.classList.contains('mobile-open')) { searchWrapper.classList.remove('mobile-open'); closed = true }
  if (document.activeElement === searchInput) { searchInput.blur(); closed = true }
  return closed
}

// ── Mobile search overlay ──

searchMobileBtn.addEventListener('click', () => {
  searchWrapper.classList.add('mobile-open')
  searchInput.focus()
})
searchCloseBtn.addEventListener('click', () => {
  window.closeSearchUI()
  searchInput.value = ''
})

document.getElementById('clear-search-movies').addEventListener('click', () => {
  searchMoviesGrid.innerHTML = ''
  searchMoviesSection.style.display = 'none'
})

// ── "/" focuses search from anywhere (unless already typing in a field) ──
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (topModal()) return
  e.preventDefault()
  if (getComputedStyle(searchMobileBtn).display !== 'none') searchWrapper.classList.add('mobile-open')
  searchInput.focus()
})

document.getElementById('direct-search-movies').addEventListener('click', () => openDirectSearch(searchMoviesSection.dataset.query))
