// ================= SEARCH =================

const searchInput           = document.getElementById('search-input')
const searchResults         = document.getElementById('search-results')
const searchMoviesSection   = document.getElementById('search-movies-section')
const searchMoviesContainer = document.getElementById('search-movies')
const clearSearchMoviesBtn  = document.getElementById('clear-search-movies')

const addedMovieIds = new Set()

clearSearchMoviesBtn.addEventListener('click', () => {
  searchMoviesContainer.innerHTML = ''
  addedMovieIds.clear()
  searchMoviesSection.style.display = 'none'
})

// ── Search history ──

function getSearchHistory() {
  return JSON.parse(localStorage.getItem('filmbox_history') || '[]')
}

function addToHistory(q) {
  const h = getSearchHistory().filter(t => t !== q)
  h.unshift(q)
  localStorage.setItem('filmbox_history', JSON.stringify(h.slice(0, 8)))
}

function showHistory() {
  const h = getSearchHistory()
  if (!h.length) return
  searchResults.innerHTML = `
    <div class="search-history-label"><i class="bi bi-clock-history"></i> Nedávné</div>
    ${h.map(t => `
      <div class="search-item" onclick="selectHistoryItem(decodeURIComponent('${encodeURIComponent(t)}'))">
        <i class="bi bi-clock-history" style="font-size:20px;color:#71717a;flex-shrink:0"></i>
        <div class="search-item-info"><h4>${t}</h4></div>
      </div>
    `).join('')}
  `
  searchResults.classList.add('active')
}

window.selectHistoryItem = function(title) {
  searchInput.value = title
  searchResults.classList.remove('active')
  performSearch(title)
}

searchInput.addEventListener('focus', () => {
  if (!searchInput.value.trim()) showHistory()
})

let searchDebounce = null
searchInput.addEventListener('input', e => {
  clearTimeout(searchDebounce)
  const q = e.target.value.trim()
  if (q.length < 2) {
    searchResults.classList.remove('active')
    if (!q) showHistory()
    return
  }
  searchDebounce = setTimeout(() => performSearch(q), 300)
})

async function performSearch(query) {
  try {
    const res  = await fetch(`/tmdb/search?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    if (!data.results) return

    const filtered = data.results.filter(item => item.poster_path)
    searchResults.innerHTML = ''

    if (!filtered.length) {
      searchResults.innerHTML = '<div class="search-empty">Nic nebylo nalezeno.</div>'
      searchResults.classList.add('active')
      return
    }

    filtered.slice(0, 8).forEach(movie => {
      const title = movie.title || movie.name
      searchDataMap[movie.id] = movie
      searchResults.innerHTML += `
        <div class="search-item" onclick="selectSearchItem(${movie.id})">
          <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${title}"/>
          <div class="search-item-info">
            <h4>${title}</h4>
            <p>${(movie.release_date || movie.first_air_date || '').slice(0, 4)}</p>
          </div>
        </div>
      `
    })
    searchResults.classList.add('active')
  } catch {}
}

window.addEventListener('click', e => {
  if (!e.target.closest('.search-wrapper') && !e.target.closest('#search-mobile-btn'))
    searchResults.classList.remove('active')
})

// ── Mobile search overlay ──

const searchWrapper    = document.querySelector('.search-wrapper')
const searchMobileBtn  = document.getElementById('search-mobile-btn')
const searchCloseBtn   = document.getElementById('search-close-mobile')

searchMobileBtn?.addEventListener('click', () => {
  searchWrapper.classList.add('mobile-open')
  searchInput.focus()
})

searchCloseBtn?.addEventListener('click', () => {
  searchWrapper.classList.remove('mobile-open')
  searchResults.classList.remove('active')
  searchInput.value = ''
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && searchWrapper.classList.contains('mobile-open')) {
    searchWrapper.classList.remove('mobile-open')
    searchResults.classList.remove('active')
    searchInput.value = ''
  }
})

// ── Theme toggle ──

const themeToggle = document.getElementById('theme-toggle')
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark')
  localStorage.setItem('filmbox_theme', document.body.classList.contains('dark') ? 'dark' : '')
})
if (localStorage.getItem('filmbox_theme') === 'dark') document.body.classList.add('dark')

// ── Select search result ──

function selectSearchItem(id) {
  const movie = searchDataMap[id]
  if (!movie) return
  const title = movie.title || movie.name
  searchInput.value = title
  searchResults.classList.remove('active')
  addToHistory(title)

  if (!addedMovieIds.has(id)) {
    addedMovieIds.add(id)
    searchMoviesContainer.innerHTML += buildCard(movie)
    searchMoviesSection.style.display = 'block'
  }

  openDetailModal(movie.id, movie.media_type || 'movie', title)
}
