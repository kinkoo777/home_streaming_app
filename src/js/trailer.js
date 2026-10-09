// ================= TRAILER MODAL =================

const trailerModal = document.getElementById('trailer-modal')
const trailerEmbed = document.getElementById('trailer-embed')

// Per-profile preference: should the YouTube trailer auto-play on open?
function trailerAutoplayEnabled() {
  const p = getActiveProfile()
  return !p || !p.settings || p.settings.autoplayTrailers !== false
}

// The best YouTube video of a title: a Czech trailer, then an English one, then a teaser.
function pickTrailer(results) {
  const vids = (results || []).filter(v => v && v.site === 'YouTube' && v.key)
  const rank = v => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.iso_639_1 === 'cs' ? 0 : 1) - (v.official ? 0.5 : 0)
  return vids.sort((a, b) => rank(a) - rank(b))[0] || null
}

function openTrailerModal(id, type) {
  trailerEmbed.innerHTML = '<div class="trailer-msg">Načítání…</div>'
  openModal(trailerModal, closeTrailerModal)

  fetch(`/tmdb/videos?id=${id}&type=${type}`)
    .then(r => r.json())
    .then(data => {
      const trailer = pickTrailer(data.results)
      if (!trailer) {
        trailerEmbed.innerHTML = '<div class="trailer-msg">Trailer není dostupný.</div>'
        return
      }
      const autoplay = trailerAutoplayEnabled() ? 1 : 0
      trailerEmbed.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(trailer.key)}?autoplay=${autoplay}&rel=0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`
    })
    .catch(() => {
      trailerEmbed.innerHTML = '<div class="trailer-msg">Nepodařilo se načíst trailer.</div>'
    })
}

function closeTrailerModal() {
  closeModal(trailerModal)
  trailerEmbed.innerHTML = ''   // stop playback
}
