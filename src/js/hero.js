// ================= HERO =================

let heroMovies = []
let heroIdx    = 0
let heroTimer  = null

async function loadHeroMovies() {
  try {
    const res  = await fetch('/tmdb/hero')
    const data = await res.json()
    heroMovies = (data.results || []).slice(0, 5)
    if (!heroMovies.length) return
    setHero(heroMovies[0])
    renderHeroDots()
    startHeroRotation()
  } catch {}
}

function setHero(movie) {
  if (!movie) return
  const img   = document.getElementById('hero-image')
  const title = document.getElementById('hero-title')
  const desc  = document.getElementById('hero-description')

  img.style.transition = 'opacity 0.6s'
  img.style.opacity = '0'
  img.onload = () => { img.style.opacity = '1' }
  img.src = `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
  if (img.complete) img.style.opacity = '1'

  title.textContent = movie.title || movie.name
  desc.textContent  = movie.overview || 'Popis není dostupný.'

  const movieTitle = movie.title || movie.name
  document.getElementById('hero-play-btn').onclick = () => openPrehrajSearch(movieTitle)
  document.getElementById('hero-info-btn').onclick = () => openDetailModal(movie.id, movie.media_type || 'movie', movieTitle)

  document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === heroIdx))
}

function renderHeroDots() {
  document.getElementById('hero-dots').innerHTML = heroMovies
    .map((_, i) => `<span class="hero-dot${i === 0 ? ' active' : ''}" onclick="goHero(${i})"></span>`)
    .join('')
}

window.goHero = function(idx) {
  heroIdx = idx
  setHero(heroMovies[heroIdx])
  clearInterval(heroTimer)
  startHeroRotation()
}

function startHeroRotation() {
  heroTimer = setInterval(() => {
    heroIdx = (heroIdx + 1) % heroMovies.length
    setHero(heroMovies[heroIdx])
  }, 6000)
}

loadHeroMovies()
