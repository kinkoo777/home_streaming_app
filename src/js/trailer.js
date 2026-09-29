// ================= TRAILER MODAL =================

const trailerModal = document.getElementById('trailer-modal')
const trailerEmbed = document.getElementById('trailer-embed')

// Per-profile preference: should the YouTube trailer auto-play on open?
function trailerAutoplayEnabled() {
  const p = getActiveProfile()
  return !p || !p.settings || p.settings.autoplayTrailers !== false
}

function openTrailerModal(id, type) {
  trailerEmbed.innerHTML = '<div class="trailer-msg">Načítání…</div>'
  openModal(trailerModal, closeTrailerModal)

  fetch(`/tmdb/videos?id=${id}&type=${type}`)
    .then(r => r.json())
    .then(data => {
      const vids = (data.results || []).filter(v => v.site === 'YouTube')
      const trailer = vids.find(v => v.type === 'Trailer') || vids.find(v => v.type === 'Teaser') || vids[0]
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
