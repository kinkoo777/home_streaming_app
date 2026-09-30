// ================= SHARED HELPERS =================
// Loaded first. Everything here is plain ES2018 so it parses on LG webOS 5+
// (Chromium 68): no optional chaining (?.), no nullish coalescing (??).

// ── HTML escape ──
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

// ── Client diagnostics → server log (journalctl -u filmbox) ──
// Temporary aid for TV-only problems that can't be reproduced on a PC.
// At most 150 small events per page, sent in batches.
const _clientLogQ = []
let _clientLogN = 0, _clientLogTimer = null
function clientLog(event, data) {
  if (_clientLogN++ >= 150) return
  _clientLogQ.push({ t: Math.round(performance.now()), event: event, data: data || null })
  if (!_clientLogTimer) _clientLogTimer = setTimeout(_flushClientLog, 1500)
}
function _flushClientLog() {
  _clientLogTimer = null
  if (!_clientLogQ.length) return
  const batch = _clientLogQ.splice(0)
  try {
    fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: location.pathname, events: batch }) }).catch(() => {})
  } catch (e) {}
}
window.clientLog = clientLog

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v } catch (e) { return fallback }
}
function lsSet(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch (e) {}
}

// JSON fetch that throws the server's error message on non-2xx.
async function apiFetch(path, opts) {
  const res = await fetch(path, opts)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || res.statusText || 'Chyba serveru')
  }
  return res.json()
}
function jsonBody(method, data) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
}

// TMDB image URL (sizes: w92 w185 w342 w500 w780 w1280 original)
function tmdbImg(path, size) {
  return path ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + path : ''
}

// ================= TOAST =================

function showToast(msg, duration) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('hidden')
  void t.offsetWidth           // restart the entrance animation
  t.classList.remove('hidden')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.add('hidden'), duration || 2600)
}

// ================= SKELETONS =================

function renderSkeletonsHTML(count) {
  let html = ''
  for (let i = 0; i < (count || 8); i++) {
    html += `
      <div class="movie-card skeleton-card" aria-hidden="true">
        <div class="movie-poster skeleton"></div>
        <div class="movie-info"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>
      </div>`
  }
  return html
}
function renderSkeletons(containerId, count) {
  const c = document.getElementById(containerId)
  if (c) c.innerHTML = renderSkeletonsHTML(count || 10)
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
// One stack for every modal: Esc / TV Back closes only the top one, focus
// returns to whatever opened it, and page scroll is locked while any is open.

const _modalStack = []
let _savedScrollY = 0

function openModal(el, onClose) {
  if (!el) return
  clearTimeout(el._closeTimer)
  el.classList.remove('hidden', 'closing')
  if (_modalStack.some(m => m.el === el)) return
  if (!_modalStack.length) {
    _savedScrollY = window.pageYOffset
    document.body.style.top = '-' + _savedScrollY + 'px'
    document.body.classList.add('modal-open')
  }
  _modalStack.push({ el, onClose, prevFocus: document.activeElement })
  // Later-opened modals always stack above earlier ones, regardless of DOM order.
  el.style.zIndex = String(4100 + _modalStack.length * 10)   // above the profile chooser (4000)
  // Remote/keyboard users need focus inside the dialog.
  if (document.body.classList.contains('kbd')) setTimeout(() => focusFirstIn(el), 80)
}

function closeModal(el) {
  const idx = _modalStack.findIndex(m => m.el === el)
  if (idx < 0) return
  const entry = _modalStack.splice(idx, 1)[0]
  el.classList.add('closing')
  el._closeTimer = setTimeout(() => {
    el.classList.add('hidden')
    el.classList.remove('closing')
  }, 240)
  if (!_modalStack.length) {
    document.body.classList.remove('modal-open')
    document.body.style.top = ''
    window.scrollTo(0, _savedScrollY)
  }
  const back = entry.prevFocus
  if (back && back.focus && document.body.contains(back)) {
    try { back.focus({ preventScroll: true }) } catch (e) { back.focus() }
  }
}

// Close via the modal's own close handler when it has one (it may clean up).
function requestCloseModal(el) {
  const entry = _modalStack.find(m => m.el === el)
  if (!entry) return
  if (entry.onClose) entry.onClose()
  else closeModal(el)
}

function topModal() {
  return _modalStack.length ? _modalStack[_modalStack.length - 1].el : null
}

function closeTopModal() {
  const top = topModal()
  if (!top) return false
  requestCloseModal(top)
  return true
}

function isModalOpen(el) { return _modalStack.some(m => m.el === el) }

function focusFirstIn(root) {
  if (!root) return
  const target = root.querySelector('[data-autofocus]') ||
    root.querySelector('.btn-primary:not([disabled]), .source-item, .wl-list-item, input.field, button:not([disabled]):not(.sheet-close)') ||
    root.querySelector('button, [tabindex="0"]')
  if (target) { try { target.focus({ preventScroll: true }) } catch (e) { target.focus() } }
}

// Any element with [data-close] closes the modal it lives in.
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-close]')
  if (!closer) return
  const modal = closer.closest('.sheet-modal, .overlay-modal')
  if (modal) requestCloseModal(modal)
})

// ================= CONFIRM DIALOG =================
// Promise-based replacement for window.confirm() that a TV remote can drive.

function confirmDialog(text, okLabel) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal')
    if (!modal) { resolve(window.confirm(text)); return }
    const ok = document.getElementById('confirm-ok')
    const cancel = document.getElementById('confirm-cancel')
    document.getElementById('confirm-text').textContent = text
    ok.textContent = okLabel || 'Potvrdit'
    let done = false
    const finish = result => {
      if (done) return
      done = true
      ok.removeEventListener('click', onOk)
      cancel.removeEventListener('click', onCancel)
      closeModal(modal)
      resolve(result)
    }
    const onOk = () => finish(true)
    const onCancel = () => finish(false)
    ok.addEventListener('click', onOk)
    cancel.addEventListener('click', onCancel)
    openModal(modal, onCancel)
    setTimeout(() => cancel.focus(), 60)
  })
}

// ================= PIN SESSIONS =================
// PIN-protected profiles need a session token (from /pin/verify) on every
// /api/profiles/<id>/… call. The wrapper below adds it; a 401 "PIN required"
// (e.g. after a server restart) sends the viewer back to the profile chooser.

function getProfileToken(id) {
  try { return (JSON.parse(sessionStorage.getItem('filmbox_tokens') || '{}'))[id] || null } catch (e) { return null }
}
function setProfileToken(id, token) {
  try {
    const all = JSON.parse(sessionStorage.getItem('filmbox_tokens') || '{}')
    if (token) all[id] = token; else delete all[id]
    sessionStorage.setItem('filmbox_tokens', JSON.stringify(all))
  } catch (e) {}
}

;(function () {
  const nativeFetch = window.fetch.bind(window)
  let prompting = false
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const m = /^\/api\/profiles\/([^/?#]+)/.exec(url)
    if (m) {
      const token = getProfileToken(decodeURIComponent(m[1]))
      if (token) {
        init = Object.assign({}, init)
        init.headers = Object.assign({}, init.headers || {}, { 'X-Profile-Token': token })
      }
    }
    return nativeFetch(input, init).then(res => {
      if (res.status === 401 && m && !prompting && decodeURIComponent(m[1]) === getActiveProfileId()) {
        prompting = true
        setProfileToken(decodeURIComponent(m[1]), null)
        sessionStorage.removeItem('filmbox_active_profile')
        showToast('Relace profilu vypršela — zadejte PIN znovu')
        setTimeout(() => { prompting = false; if (window.showProfileChooser) window.showProfileChooser() }, 600)
      }
      return res
    })
  }
})()

// ================= PROFILE HELPERS =================

function getActiveProfile() {
  try {
    const raw = sessionStorage.getItem('filmbox_active_profile')
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}

// Profile id, or 'default' when no profile is chosen yet.
function getActiveProfileId() {
  const p = getActiveProfile()
  return (p && p.id) || 'default'
}

function hasActiveProfile() { return getActiveProfileId() !== 'default' }

// ================= PROFILE PROGRESS =================

window._profileProgress = {}

async function loadProfileProgress() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { window._profileProgress = {}; return }
  try {
    const res = await fetch(`/api/profiles/${profileId}/progress`)
    if (res.ok) window._profileProgress = await res.json()
  } catch (e) {}
}

// ================= SHARED DATA MAP =================
// All fetched titles keyed by id so card buttons can find full movie data.

const searchDataMap = {}

function rememberMovies(list) {
  (list || []).forEach(m => { if (m && m.id != null) searchDataMap[m.id] = m })
}

// ================= GLOBAL ERROR HANDLER =================

window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.name !== 'AbortError') {
    const msg = e.reason.message || 'Něco se pokazilo'
    showToast('Chyba: ' + msg)
  }
})
