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

function showHistory() {
  searchFocusIdx = -1
  const h = getSearchHistory()
  if (!h.length) { closeDropdown(); return }
  searchResults.innerHTML = `
    <div class="search-history-label"><i class="bi bi-clock-history"></i>Nedávné hledání</div>
    ${h.map(t => `
      <div class="search-item" data-history="${escapeHtml(t)}">
        <span class="search-hist-icon"><i class="bi bi-clock-history"></i></span>
        <div class="search-item-info"><h4>${escapeHtml(t)}</h4></div>
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

async function performSearch(query) {
  const seq = ++searchSeq
  try {
    const list = await fetchSearch(query)
    if (seq !== searchSeq) return          // a newer query already answered
    lastResults = list
    searchFocusIdx = -1

    if (!list.length) {
      searchResults.innerHTML = '<div class="search-empty">Nic nebylo nalezeno.</div>'
      openDropdown()
      return
    }
    searchResults.innerHTML = list.slice(0, 7).map(movie => {
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
  } catch (e) {}
}

// Full results grid (Enter)
async function showAllResults(query) {
  addToHistory(query)
  closeDropdown()
  let list = lastResults
  if (!list.length || searchInput.dataset.lastQuery !== query) list = await fetchSearch(query)
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
  const item = e.target.closest('.search-item')
  if (!item) return
  if (item.dataset.history != null) {
    searchInput.value = item.dataset.history
    performSearch(item.dataset.history)
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
  searchDebounce = setTimeout(() => { searchInput.dataset.lastQuery = q; performSearch(q) }, 280)
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
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (active && searchFocusIdx >= 0 && items[searchFocusIdx]) items[searchFocusIdx].click()
    else if (searchInput.value.trim().length >= 2) showAllResults(searchInput.value.trim())
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
