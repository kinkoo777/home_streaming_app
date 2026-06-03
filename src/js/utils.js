// ================= HTML ESCAPE =================

// Escape user-controlled text before injecting into innerHTML, to prevent XSS
// (e.g. a watchlist named `<img src=x onerror=...>`).
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
window.escapeHtml = escapeHtml

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

// ================= MODAL STACK =================
// Tracks how many modals are open so scroll position is saved once on first
// open and restored only when every modal has been closed.

let _modalOpenCount = 0
let _savedScrollY = 0

function openModal() {
  if (_modalOpenCount === 0) {
    _savedScrollY = window.scrollY
    document.body.style.top = `-${_savedScrollY}px`
    document.body.classList.add('modal-open')
  }
  _modalOpenCount++
}

function closeModal() {
  _modalOpenCount = Math.max(0, _modalOpenCount - 1)
  if (_modalOpenCount === 0) {
    document.body.classList.remove('modal-open')
    document.body.style.top = ''
    window.scrollTo(0, _savedScrollY)
  }
}

// ================= PROFILE HELPER =================

function getActiveProfileId() {
  try {
    const raw = sessionStorage.getItem('filmbox_active_profile')
    if (!raw) return 'default'
    return JSON.parse(raw).id || 'default'
  } catch {
    return 'default'
  }
}

// ================= PROFILE PROGRESS =================

window._profileProgress = {}

async function loadProfileProgress() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') return
  try {
    const res = await fetch(`/api/profiles/${profileId}/progress`)
    if (res.ok) window._profileProgress = await res.json()
  } catch {}
}

// ================= SHARED DATA MAP =================
// All fetched movies keyed by id for O(1) lookup across search, grids, and watchlist

const searchDataMap = {}

// ================= GLOBAL ERROR HANDLER =================

window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.name !== 'AbortError') {
    const msg = e.reason.message || 'Něco se pokazilo'
    showToast('Chyba: ' + msg)
  }
})
