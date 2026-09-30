// ================= BROWSE (genre / decade / sort) =================

;(function () {
  'use strict'

  const grid    = document.getElementById('browse-grid')
  const more    = document.getElementById('browse-more')
  const genres  = document.getElementById('browse-genres')
  const decades = document.getElementById('browse-decades')
  const sub     = document.getElementById('browse-sub')
  if (!grid) return

  const now = new Date().getFullYear()
  const DECADES = [
    { id: '', label: 'Všechna období' },
    { id: 'new', label: 'Posledních 5 let', from: now - 4, to: now },
    { id: '2010', label: '2010–2019', from: 2010, to: 2019 },
    { id: '2000', label: '2000–2009', from: 2000, to: 2009 },
    { id: '1990', label: '90. léta', from: 1990, to: 1999 },
    { id: '1980', label: '80. léta', from: 1980, to: 1989 },
    { id: 'old', label: 'Starší', from: 1900, to: 1979 }
  ]

  const state = { type: 'movie', sort: 'popular', genre: null, decade: '', page: 0, total: 1, loading: false, seq: 0 }
  const genreCache = {}

  function chip(label, data, active) {
    return `<button class="chip${active ? ' active' : ''}" ${data}>${escapeHtml(label)}</button>`
  }

  async function loadGenres() {
    if (!genreCache[state.type]) {
      try {
        const d = await (await fetch(`/tmdb/genres?type=${state.type}`)).json()
        genreCache[state.type] = d.genres || []
      } catch (e) { genreCache[state.type] = [] }
    }
    const list = genreCache[state.type]
    if (state.genre && !list.some(g => g.id === state.genre)) state.genre = null
    genres.innerHTML = chip('Všechny žánry', 'data-genre=""', !state.genre) +
      list.map(g => chip(g.name, `data-genre="${g.id}"`, state.genre === g.id)).join('')
  }

  function renderDecades() {
    decades.innerHTML = DECADES.map(d => chip(d.label, `data-decade="${d.id}"`, state.decade === d.id)).join('')
  }

  function describe() {
    const g = (genreCache[state.type] || []).find(x => x.id === state.genre)
    const d = DECADES.find(x => x.id === state.decade)
    const parts = [state.type === 'tv' ? 'Seriály' : 'Filmy']
    if (g) parts.push(g.name.toLowerCase())
    if (d && d.id) parts.push(d.label.toLowerCase())
    sub.textContent = parts.join(' · ')
  }

  async function load(reset) {
    if (state.loading && !reset) return
    const seq = ++state.seq
    if (reset) {
      state.page = 0
      state.total = 1
      grid.innerHTML = renderSkeletonsHTML(12)
      more.style.display = 'none'
    }
    if (state.page >= state.total) return
    state.loading = true
    more.disabled = true
    const d = DECADES.find(x => x.id === state.decade) || {}
    const q = new URLSearchParams({ type: state.type, sort: state.sort, page: String(state.page + 1) })
    if (state.genre) q.set('genre', String(state.genre))
    if (d.from) { q.set('from', String(d.from)); q.set('to', String(d.to)) }
    try {
      const data = await (await fetch(`/tmdb/discover?${q}`)).json()
      if (seq !== state.seq) return
      const items = (data.results || []).filter(m => m.poster_path).map(m => Object.assign({ media_type: state.type }, m))
      rememberMovies(items)
      state.page = data.page || state.page + 1
      state.total = Math.min(data.total_pages || 1, 500)
      const html = items.map((m, i) => buildCard(m, { index: i })).join('')
      if (reset) grid.innerHTML = html || '<div class="browse-empty">Nic nenalezeno — zkuste jiný žánr nebo období.</div>'
      else grid.insertAdjacentHTML('beforeend', html)
      more.style.display = state.page < state.total ? '' : 'none'
    } catch (e) {
      if (seq !== state.seq) return
      if (reset) grid.innerHTML = '<div class="browse-empty">Nepodařilo se načíst.</div>'
    } finally {
      if (seq === state.seq) { state.loading = false; more.disabled = false }
    }
  }

  function refresh() {
    describe()
    load(true)
  }

  document.getElementById('browse-type').addEventListener('click', async e => {
    const b = e.target.closest('[data-type]')
    if (!b || b.dataset.type === state.type) return
    state.type = b.dataset.type
    b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    await loadGenres()
    refresh()
  })
  document.getElementById('browse-sort').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]')
    if (!b || b.dataset.sort === state.sort) return
    state.sort = b.dataset.sort
    b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b))
    refresh()
  })
  genres.addEventListener('click', e => {
    const b = e.target.closest('[data-genre]')
    if (!b) return
    state.genre = b.dataset.genre ? parseInt(b.dataset.genre, 10) : null
    genres.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b))
    refresh()
  })
  decades.addEventListener('click', e => {
    const b = e.target.closest('[data-decade]')
    if (!b) return
    state.decade = b.dataset.decade
    decades.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b))
    refresh()
  })
  more.addEventListener('click', () => load(false))

  // Load only when the section scrolls near view (it's at the bottom of the page).
  let started = false
  function start() {
    if (started) return
    started = true
    renderDecades()
    loadGenres().then(refresh)
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) { io.disconnect(); start() }
    }, { rootMargin: '600px 0px' })
    io.observe(document.getElementById('browse-section'))
  } else {
    start()
  }
})()
