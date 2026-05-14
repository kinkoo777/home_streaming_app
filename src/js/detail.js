// ================= DETAIL MODAL =================

const detailModal    = document.getElementById('detail-modal')
const detailClose    = document.getElementById('detail-close')
const detailBackdrop = document.querySelector('.detail-backdrop')

function closeDetailModal() {
  detailModal.classList.add('hidden')
  document.body.classList.remove('modal-open')
}

detailClose.addEventListener('click', closeDetailModal)
detailBackdrop.addEventListener('click', closeDetailModal)

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetailModal()
    closePrehrajModal()
    closeTrailerModal()
    closeActorModal()
    closeWlModal()
  }
})

let currentDetailId   = null
let currentDetailType = null

window.openDetailModal = async function(id, type, title) {
  currentDetailId   = id
  currentDetailType = type

  detailModal.classList.remove('hidden')
  document.body.classList.add('modal-open')
  document.getElementById('detail-title').textContent      = title
  document.getElementById('detail-overview').textContent   = ''
  document.getElementById('detail-cast').innerHTML         = ''
  document.getElementById('detail-genres').innerHTML       = ''
  document.getElementById('detail-meta').textContent       = ''
  document.getElementById('detail-poster').style.display   = 'none'
  document.getElementById('detail-skeleton').style.display = 'block'
  document.getElementById('detail-seasons').style.display  = 'none'
  document.getElementById('detail-similar').style.display  = 'none'
  document.getElementById('detail-seasons').innerHTML      = ''
  document.getElementById('detail-similar-grid').innerHTML = ''

  try {
    const [detRes, simRes] = await Promise.all([
      fetch(`/tmdb/details?id=${id}&type=${type}`),
      fetch(`/tmdb/similar?id=${id}&type=${type}`)
    ])
    const d   = await detRes.json()
    const sim = await simRes.json()

    document.getElementById('detail-skeleton').style.display = 'none'
    const poster = document.getElementById('detail-poster')
    if (d.poster_path) {
      poster.src = `https://image.tmdb.org/t/p/w342${d.poster_path}`
      poster.style.display = 'block'
    }

    document.getElementById('detail-title').textContent    = d.title || d.name
    document.getElementById('detail-overview').textContent = d.overview || 'Popis není dostupný.'
    document.getElementById('detail-meta').textContent     = [
      (d.release_date || d.first_air_date || '').slice(0, 4),
      d.runtime ? d.runtime + ' min' : (d.number_of_seasons ? d.number_of_seasons + ' sezón' : ''),
      '⭐ ' + (d.vote_average || 0).toFixed(1)
    ].filter(Boolean).join('  ·  ')

    document.getElementById('detail-genres').innerHTML = (d.genres || [])
      .map(g => `<span class="genre-tag">${g.name}</span>`).join('')

    document.getElementById('detail-cast').innerHTML = (d.cast || [])
      .map(a => `
        <div class="cast-item" onclick="openActorModal(${a.id})" style="cursor:pointer" title="${a.name}">
          ${a.profile_path
            ? `<img src="https://image.tmdb.org/t/p/w92${a.profile_path}" alt="${a.name}">`
            : '<div class="cast-placeholder"><i class="bi bi-person"></i></div>'}
          <span>${a.name}</span>
        </div>
      `).join('')

    const movieTitle = d.title || d.name
    const movieData  = {
      id, title: d.title, name: d.name, poster_path: d.poster_path,
      vote_average: d.vote_average, release_date: d.release_date,
      first_air_date: d.first_air_date, media_type: type, runtime: d.runtime
    }

    const favBtn = document.getElementById('detail-fav-btn')
    const updateFavBtn = () => {
      const f = isFavorite(id, type)
      favBtn.innerHTML = `<i class="bi ${f ? 'bi-heart-fill' : 'bi-heart'}"></i> ${f ? 'Oblíbené' : 'Oblíbit'}`
      favBtn.style.color = f ? '#ef4444' : ''
    }
    updateFavBtn()
    favBtn.onclick = async () => { await toggleFavorite(movieData); updateFavBtn() }

    document.getElementById('detail-play-btn').onclick = () => {
      closeDetailModal()
      openPrehrajSearch(movieTitle)
    }

    document.getElementById('detail-trailer-btn').onclick = () => openTrailerModal(id, type)

    // ── Seasons (TV only) ──
    if (type === 'tv' && d.number_of_seasons) {
      const seasonsEl = document.getElementById('detail-seasons')
      seasonsEl.style.display = 'block'
      seasonsEl.innerHTML = `
        <h4 class="similar-title">Sezóny</h4>
        <div class="seasons-tabs">
          ${Array.from({ length: d.number_of_seasons }, (_, i) => i + 1)
            .map(n => `<button class="season-tab" data-season="${n}" data-id="${id}">Sezóna ${n}</button>`).join('')}
        </div>
        <div id="episodes-list" class="episodes-list"></div>
      `
      loadSeason(id, 1)
    }

    // ── Similar movies ──
    const simMovies = (sim.results || []).filter(m => m.poster_path).slice(0, 8)
    if (simMovies.length) {
      document.getElementById('detail-similar').style.display = 'block'
      document.getElementById('detail-similar-grid').innerHTML = simMovies.map(m => buildCard(m)).join('')
      simMovies.forEach(m => { searchDataMap[m.id] = m })
    }

  } catch {
    document.getElementById('detail-skeleton').style.display = 'none'
    document.getElementById('detail-overview').textContent   = 'Nepodařilo se načíst detaily.'
  }
}

// ── Season episodes ──

async function loadSeason(tvId, seasonNum) {
  const list = document.getElementById('episodes-list')
  if (!list) return
  list.innerHTML = '<div style="color:#71717a;padding:16px">Načítání...</div>'

  document.querySelectorAll('.season-tab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.season) === seasonNum))

  try {
    const res  = await fetch(`/tmdb/season?id=${tvId}&season=${seasonNum}`)
    const data = await res.json()
    const eps       = data.episodes || []
    const showTitle = document.getElementById('detail-title').textContent || ''
    const sNum      = String(seasonNum).padStart(2, '0')

    list.innerHTML = eps.map(ep => {
      const eNum  = String(ep.episode_number).padStart(2, '0')
      const query = encodeURIComponent(showTitle + ' S' + sNum + 'E' + eNum)
      return `
        <div class="episode-item" onclick="openPrehrajSearch(decodeURIComponent('${query}'))">
          <div class="episode-num">S${sNum}E${eNum}</div>
          <div class="episode-info">
            <strong>${ep.name || 'Epizoda ' + ep.episode_number}</strong>
            <span>${ep.overview ? ep.overview.slice(0, 80) + '\u2026' : ''}</span>
          </div>
        </div>
      `
    }).join('')
  } catch {
    list.innerHTML = '<div style="color:#f87171;padding:16px">Nepodařilo se načíst epizody.</div>'
  }
}

// Delegate season tab clicks
document.addEventListener('click', e => {
  const tab = e.target.closest('.season-tab')
  if (!tab) return
  loadSeason(parseInt(tab.dataset.id), parseInt(tab.dataset.season))
})
