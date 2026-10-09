// ================= HERO =================
// Billboard carousel: cross-fading backdrops with a slow Ken Burns zoom,
// staggered text entrance, progress dots, and an ambient page glow tinted
// from each backdrop's average colour.

const HERO_INTERVAL = 8000
const heroEl      = document.getElementById('hero')
const heroContent = document.getElementById('hero-content')
const heroImgs    = [document.getElementById('hero-img-a'), document.getElementById('hero-img-b')]
let heroMovies = []
let heroIdx    = 0
let heroLayer  = 0
let heroTimer  = null
let heroPaused = false
let heroTrailer = false      // a muted trailer is playing (previews.js) — the carousel waits

heroEl.style.setProperty('--hero-interval', HERO_INTERVAL + 'ms')

async function loadHeroMovies() {
  try {
    const res  = await fetch('/tmdb/hero')
    const data = await res.json()
    heroMovies = (data.results || []).filter(m => m.backdrop_path).slice(0, 6)
    if (!heroMovies.length) throw new Error('empty')
    rememberMovies(heroMovies)
    renderHeroDots()
    setHero(0, true)
    // Warm the cache for the next slide.
    if (heroMovies[1]) new Image().src = tmdbImg(heroMovies[1].backdrop_path, 'w1280')
  } catch (e) {
    document.getElementById('hero-title').textContent = 'FilmBox'
    document.getElementById('hero-title').classList.remove('skeleton-text')
    document.getElementById('hero-description').textContent = 'Nepodařilo se načíst doporučené tituly.'
  }
}

function heroMeta(movie) {
  const parts = []
  if (movie.vote_average) parts.push(`<span class="rating-pill"><i class="bi bi-star-fill"></i>${Number(movie.vote_average).toFixed(1)}</span>`)
  const year = (movie.release_date || movie.first_air_date || '').slice(0, 4)
  if (year) parts.push(`<span>${year}</span>`)
  const genres = (movie.genre_ids || []).map(id => GENRE_NAMES[id]).filter(Boolean).slice(0, 3)
  if (genres.length) parts.push('<span class="dot"></span>', `<span>${genres.map(escapeHtml).join(', ')}</span>`)
  return parts.join('')
}

function setHero(idx, first) {
  const movie = heroMovies[idx]
  if (!movie) return
  heroIdx = idx

  // Cross-fade: load into the hidden layer, then swap.
  const next = heroImgs[1 - heroLayer]
  const cur  = heroImgs[heroLayer]
  const swap = () => {
    next.classList.remove('active')
    void next.offsetWidth                 // restart Ken Burns
    next.classList.add('active')
    cur.classList.remove('active')
    heroLayer = 1 - heroLayer
  }
  next.onload = swap
  next.onerror = swap
  next.src = tmdbImg(movie.backdrop_path, 'w1280')
  if (next.complete && next.naturalWidth) { next.onload = null; swap() }

  // Text: replay the staggered entrance.
  heroContent.classList.add('swap')
  const title = document.getElementById('hero-title')
  title.textContent = movie.title || movie.name
  title.classList.remove('skeleton-text')
  document.getElementById('hero-meta').innerHTML = heroMeta(movie)
  document.getElementById('hero-description').textContent = movie.overview || 'Popis není dostupný.'
  void heroContent.offsetWidth
  heroContent.classList.remove('swap')

  const mediaType = movie.media_type || 'movie'
  const movieTitle = movie.title || movie.name
  document.getElementById('hero-play-btn').onclick = () =>
    openPrehrajSearch(movieTitle, movie.id, mediaType, movie.poster_path || null)
  document.getElementById('hero-info-btn').onclick = () => openDetailModal(movie.id, mediaType, movieTitle)
  document.getElementById('hero-list-btn').onclick = () => {
    if (!hasActiveProfile()) { showToast('Nejprve vyberte profil'); return }
    const added = toggleMovieInList(DEFAULT_LIST_ID, Object.assign({ media_type: mediaType }, movie))
    renderWatchlist()
    syncHeroListButton()
    showToast(added ? 'Přidáno do „Můj seznam“ ✓' : 'Odebráno z „Můj seznam“')
  }
  syncHeroListButton()

  document.querySelectorAll('.hero-dot').forEach((d, i) => {
    d.classList.remove('active')
    d.setAttribute('aria-selected', i === idx ? 'true' : 'false')
  })
  const dot = document.querySelectorAll('.hero-dot')[idx]
  if (dot) { void dot.offsetWidth; dot.classList.add('active') }

  tintAmbient(movie)
  if (window.heroPreviewSlide) window.heroPreviewSlide(movie)
  scheduleNext()
}

window.heroPreviewPlaying = function (on) {
  heroTrailer = on
  if (on) clearTimeout(heroTimer)
  else scheduleNext()
}

function syncHeroListButton() {
  const movie = heroMovies[heroIdx]
  const btn = document.getElementById('hero-list-btn')
  if (!movie || !btn) return
  const inList = isInAnyList(movie.id)
  btn.innerHTML = `<i class="bi ${inList ? 'bi-check-lg' : 'bi-plus-lg'}"></i>`
  btn.title = inList ? 'V seznamu' : 'Přidat do seznamu'
  btn.setAttribute('aria-label', btn.title)
}
window.syncHeroListButton = syncHeroListButton

function renderHeroDots() {
  const wrap = document.getElementById('hero-dots')
  wrap.innerHTML = heroMovies.map((m, i) =>
    `<button class="hero-dot" role="tab" data-idx="${i}" aria-label="${escapeHtml(m.title || m.name)}"></button>`).join('')
  wrap.addEventListener('click', e => {
    const dot = e.target.closest('.hero-dot')
    if (dot) setHero(parseInt(dot.dataset.idx, 10))
  })
}

function scheduleNext() {
  clearTimeout(heroTimer)
  if (heroPaused || heroTrailer || heroMovies.length < 2) return
  heroTimer = setTimeout(() => setHero((heroIdx + 1) % heroMovies.length), HERO_INTERVAL)
}

function pauseHero(on) {
  if (heroPaused === on) return
  heroPaused = on
  heroEl.classList.toggle('paused', on)
  if (on) clearTimeout(heroTimer)
  else {
    // Restart the active dot's progress so it matches the fresh timer.
    const dot = document.querySelector('.hero-dot.active')
    if (dot) { dot.classList.remove('active'); void dot.offsetWidth; dot.classList.add('active') }
    scheduleNext()
  }
}

heroEl.addEventListener('mouseenter', () => pauseHero(true))
heroEl.addEventListener('mouseleave', () => pauseHero(false))
heroEl.addEventListener('focusin', () => pauseHero(true))
heroEl.addEventListener('focusout', e => { if (!heroEl.contains(e.relatedTarget)) pauseHero(false) })
document.addEventListener('visibilitychange', () => pauseHero(document.hidden))

// Ambient glow: average colour of a tiny copy of the backdrop (TMDB serves CORS headers).
function tintAmbient(movie) {
  if (window.IS_TV) return
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = 12; c.height = 7
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, 12, 7)
      const d = ctx.getImageData(0, 0, 12, 7).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n)
      // Boost saturation a little so the glow reads as colour, not grey.
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const k = max === min ? 1 : Math.min(1.8, 140 / (max - min + 20))
      const mid = (max + min) / 2
      const s = v => Math.max(0, Math.min(255, Math.round(mid + (v - mid) * k)))
      document.getElementById('ambient').style.setProperty('--ambient', `rgba(${s(r)},${s(g)},${s(b)},0.35)`)
    } catch (e) {}
  }
  img.src = tmdbImg(movie.backdrop_path, 'w300')
}

loadHeroMovies()
