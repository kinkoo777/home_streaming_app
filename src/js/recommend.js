// ================= RECOMMENDED FOR YOU =================
// Seeds: the profile's most recent watched titles, favorites and titles in
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
  if (!seeds.length) { section.style.display = 'none'; return }

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
    if (!m.poster_path || skip[key] || isWatched(m.id, type)) return
    byKey[key] = m
    // Several seeds agreeing counts most; earlier rank and rating break ties.
    score[key] = (score[key] || 0) + 10 + (20 - Math.min(rank, 20)) * 0.2 + (m.vote_average || 0) * 0.1
  }))
  const picks = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, 20).map(k => byKey[k])
  if (!picks.length) { section.style.display = 'none'; return }

  rememberMovies(picks)
  track.innerHTML = picks.map((m, i) => buildCard(m, { index: i })).join('')
  track.scrollLeft = 0
  section.style.display = 'block'
  if (window.updateRowArrows) window.updateRowArrows(track)
}

window.reloadRecommendations = renderRecommendations

// Library data loads asynchronously; build the row once it's had time to arrive.
document.addEventListener('DOMContentLoaded', () => {
  if (hasActiveProfile()) setTimeout(renderRecommendations, 1500)
})
