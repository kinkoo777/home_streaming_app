// ================= SERVICE WORKER =================
// Makes FilmBox installable as an app (phone home screen, desktop) and quicker to open:
//  - the app itself (pages, CSS, JS, icons): network first, so an update shows at once,
//    the last copy when the server can't be reached (then a "server offline" note);
//  - TMDB posters and backdrops: from the cache first (they never change), up to ~400;
//  - everything else (API, search, video, subtitles): never touched.
// Browsers only run service workers on https:// or localhost (see README: Install as an app).

const SHELL = 'filmbox-shell-v1'
const IMAGES = 'filmbox-img-v1'
const IMAGE_LIMIT = 400
const PRECACHE = ['/', '/player.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

const isShell = url => url.origin === self.location.origin &&
  (url.pathname === '/' || /\.(html|css|js|png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) &&
  !/^\/(api|tmdb|search|get_video|stream|subs|get_subtitle)\b/.test(url.pathname) &&
  url.pathname !== '/sw.js'

function networkFirst(req) {
  return fetch(req).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone()
      caches.open(SHELL).then(c => c.put(req, copy))
    }
    return res
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => {
    if (hit) return hit
    if (req.mode === 'navigate') return caches.match('/')
    return Response.error()
  }))
}

let _trimming = false
function trimImages() {
  if (_trimming) return
  _trimming = true
  caches.open(IMAGES).then(c => c.keys().then(keys => {
    const extra = keys.length - IMAGE_LIMIT
    return Promise.all(keys.slice(0, Math.max(0, extra)).map(k => c.delete(k)))
  })).catch(() => {}).then(() => { _trimming = false })
}
function cacheFirstImage(req) {
  return caches.open(IMAGES).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    // Cross-origin images come back opaque (status 0): still fine to keep.
    if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimImages() }
    return res
  })))
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  if (url.hostname === 'image.tmdb.org') { e.respondWith(cacheFirstImage(req)); return }
  if (req.mode === 'navigate' || isShell(url)) e.respondWith(networkFirst(req))
})
