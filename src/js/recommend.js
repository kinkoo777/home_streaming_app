// ================= RECOMMENDED FOR YOU =================
// Seeds: the profile's most recent watched titles, 👍 ratings, favorites and titles in
// progress. Each seed's TMDB recommendations are merged; titles recommended by
// several seeds rank higher. Anything already watched / in progress is skipped.

let _recommendSeq = 0

function recommendationSeeds() {
  const seeds = []
  const add = (id, type) => {
    id = Number(id)
    if (!id || (type !== 'movie' && type !== 'tv')) return
    if (!seeds.some(s => s.id === id && s.type === type)) seeds.push({ id, type })
  }
  // In progress (most recent first)
  const progress = window._profileProgress || {}
  Object.keys(progress)
    .map(k => progress[k])
    .filter(v => v && typeof v === 'object' && v.tmdbId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 2)
    .forEach(v => add(v.tmdbId, v.mediaType))
  // 👍 / 👍👍 (newest first)
  ;(window.getRatedList ? window.getRatedList() : []).filter(r => r.rating > 0).slice(0, 2).forEach(r => add(r.tmdbId, r.mediaType))
  ;(typeof _watchedCache !== 'undefined' ? _watchedCache : []).slice(0, 3).forEach(w => add(w.tmdbId, w.mediaType))
  ;(typeof _favState !== 'undefined' ? _favState.list : []).slice(0, 2).forEach(f => add(f.tmdbId, f.mediaType))
  return seeds.slice(0, 6)
}

async function renderRecommendations() {
  const section = document.getElementById('recommended-section')
  const track = document.getElementById('recommended-movies')
  if (!section || !track) return
  const seq = ++_recommendSeq
  const seeds = hasActiveProfile() ? recommendationSeeds() : []
  if (!seeds.length) { section.style.display = 'none'; const b = document.getElementById('because-rows'); if (b) b.innerHTML = ''; return }

  const lists = await Promise.all(seeds.map(s =>
    fetch(`/tmdb/recommendations?id=${s.id}&type=${s.type}`)
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(d => (d.results || []).map(m => Object.assign({ media_type: s.type }, m)))
      .catch(() => [])))
  if (seq !== _recommendSeq) return

  const skip = {}
  seeds.forEach(s => { skip[s.type + s.id] = true })
  const progress = window._profileProgress || {}
  Object.keys(progress).forEach(k => {
    const v = progress[k]
    if (v && typeof v === 'object' && v.tmdbId) skip[(v.mediaType || 'movie') + v.tmdbId] = true
  })

  const score = {}
  const byKey = {}
  lists.forEach(list => list.forEach((m, rank) => {
    const type = m.media_type === 'tv' ? 'tv' : 'movie'
    const key = type + m.id
    if (!m.poster_path || skip[key] || isWatched(m.id, type) || (window.isDisliked && window.isDisliked(m.id, type))) return
    byKey[key] = m
    // Several seeds agreeing counts most; earlier rank and rating break ties.
    score[key] = (score[key] || 0) + 10 + (20 - Math.min(rank, 20)) * 0.2 + (m.vote_average || 0) * 0.1
  }))
  const picks = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, 20).map(k => byKey[k])
  if (!picks.length) { section.style.display = 'none'; return }

  rememberMovies(picks)
  window._recommendedPicks = picks              // also the pool for "Co pustit?" (random.js)
  track.innerHTML = picks.map((m, i) => buildCard(m, { index: i })).join('')
  track.scrollLeft = 0
  section.style.display = 'block'
  if (window.updateRowArrows) window.updateRowArrows(track)
  // The first titles of this row are on screen anyway — the extra rows bring others.
  const shown = Object.assign({}, skip)
  picks.slice(0, 6).forEach(m => { shown[(m.media_type === 'tv' ? 'tv' : 'movie') + m.id] = true })
  renderBecauseRows(seq, shown)
}

// ── "Protože se vám líbilo X" / "Protože jste sledovali X" ──
// Up to two rows, each from one title: the latest 👍 / 👍👍 first, then the latest
// finished one. Rows with fewer than 6 new titles are left out.
function becauseSeeds() {
  const seeds = []
  const add = (id, type, title, liked) => {
    id = Number(id)
    if (!id || !title || (type !== 'movie' && type !== 'tv') || seeds.some(s => s.id === id && s.type === type)) return
    seeds.push({ id, type, title, liked })
  }
  ;(window.getRatedList ? window.getRatedList() : []).filter(r => r.rating > 0).slice(0, 1)
    .forEach(r => add(r.tmdbId, r.mediaType, r.title, true))
  ;(typeof _watchedCache !== 'undefined' ? _watchedCache : []).slice(0, 3)
    .forEach(w => add(w.tmdbId, w.mediaType, w.title, false))
  return seeds.slice(0, 2)
}

async function renderBecauseRows(seq, skip) {
  const box = document.getElementById('because-rows')
  if (!box) return
  const seeds = hasActiveProfile() ? becauseSeeds() : []
  const lists = await Promise.all(seeds.map(s =>
    fetch(`/tmdb/recommendations?id=${s.id}&type=${s.type}`)
      .then(r => (r.ok ? r.json() : { results: [] }))
      .then(d => (d.results || []).map(m => Object.assign({ media_type: s.type }, m)))
      .catch(() => [])))
  if (seq !== _recommendSeq) return
  const used = {}
  const rows = []
  seeds.forEach((s, i) => {
    const picks = lists[i].filter(m => {
      const type = m.media_type === 'tv' ? 'tv' : 'movie'
      const key = type + m.id
      if (!m.poster_path || used[key] || (skip && skip[key]) || isWatched(m.id, type) || (window.isDisliked && window.isDisliked(m.id, type))) return false
      used[key] = true
      return true
    }).slice(0, 20)
    if (picks.length < 6) return
    rememberMovies(picks)
    rows.push(`
      <section class="row-section because-section">
        <div class="row-header"><div>
          <h3>${s.liked ? 'Protože se vám líbilo' : 'Protože jste sledovali'} „${escapeHtml(s.title)}“</h3>
          <p>Podobné ${s.type === 'tv' ? 'seriály a filmy' : 'filmy a seriály'}</p>
        </div></div>
        <div class="row" data-row><div class="row-track">${picks.map((m, j) => buildCard(m, { index: j })).join('')}</div></div>
      </section>`)
  })
  box.innerHTML = rows.join('')
  box.querySelectorAll('[data-row]').forEach(r => { if (window.initRow) window.initRow(r) })
  box.querySelectorAll('.row-track').forEach(t => { if (window.updateRowArrows) window.updateRowArrows(t) })
}

window.reloadRecommendations = renderRecommendations

// Library data loads asynchronously; build the row once it's had time to arrive.
document.addEventListener('DOMContentLoaded', () => {
  if (hasActiveProfile()) setTimeout(renderRecommendations, 1500)
})
