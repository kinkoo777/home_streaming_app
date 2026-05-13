// ================= TOAST =================

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.remove('hidden')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.add('hidden'), duration)
}

// ================= SKELETON =================

function renderSkeletons(containerId, count = 12) {
  const c = document.getElementById(containerId)
  if (!c) return
  c.innerHTML = Array(count).fill(`
    <div class="movie-card skeleton-card">
      <div class="movie-poster skeleton-poster"></div>
      <div class="movie-info">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>
  `).join('')
}

function renderSkeletonsHTML(count = 8) {
  return Array(count).fill(`
    <div class="movie-card skeleton-card">
      <div class="movie-poster skeleton-poster"></div>
      <div class="movie-info"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
    </div>
  `).join('')
}

// ================= GENRE IDS =================

const GENRE_NAMES = {
  28:'Akční',12:'Dobrodružný',16:'Animovaný',35:'Komedie',80:'Krimi',
  99:'Dokument',18:'Drama',10751:'Rodinný',14:'Fantasy',36:'Historický',
  27:'Horor',10402:'Hudební',9648:'Mysteriózní',10749:'Romantický',
  878:'Sci-Fi',53:'Thriller',10752:'Válečný',37:'Western',
  10759:'Akční',10762:'Dětský',10763:'Zprávy',10764:'Reality',
  10765:'Sci-Fi & Fantasy',10766:'Telenovela',10767:'Talk show',10768:'Válka'
}

// ================= SHARED DATA MAP =================
// All fetched movies keyed by id for O(1) lookup across search, grids, and watchlist

const searchDataMap = {}
