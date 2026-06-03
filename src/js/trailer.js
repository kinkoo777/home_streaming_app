// ================= TRAILER MODAL =================

// Per-profile preference: should the YouTube trailer auto-play on open?
function trailerAutoplayEnabled() {
  try {
    const p = JSON.parse(sessionStorage.getItem('filmbox_active_profile') || 'null')
    return !p || !p.settings || p.settings.autoplayTrailers !== false
  } catch { return true }
}

function openTrailerModal(id, type) {
  const modal = document.getElementById('trailer-modal')
  const embed = document.getElementById('trailer-embed')
  embed.innerHTML = '<div style="color:#71717a;padding:40px;text-align:center">Načítání...</div>'
  modal.classList.remove('hidden')
  openModal()

  fetch(`/tmdb/videos?id=${id}&type=${type}`)
    .then(r => r.json())
    .then(data => {
      const trailer = (data.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')
        || (data.results || []).find(v => v.site === 'YouTube')
      if (!trailer) {
        embed.innerHTML = '<div style="color:#71717a;padding:40px;text-align:center">Trailer není dostupný.</div>'
        return
      }
      const autoplay = trailerAutoplayEnabled() ? 1 : 0
      embed.innerHTML = `<iframe src="https://www.youtube.com/embed/${trailer.key}?autoplay=${autoplay}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>`
    })
    .catch(() => {
      embed.innerHTML = '<div style="color:#f87171;padding:40px;text-align:center">Nepodařilo se načíst trailer.</div>'
    })
}

function closeTrailerModal() {
  document.getElementById('trailer-modal').classList.add('hidden')
  document.getElementById('trailer-embed').innerHTML = ''
  closeModal()
}

document.getElementById('trailer-close').addEventListener('click', closeTrailerModal)
document.getElementById('trailer-backdrop').addEventListener('click', closeTrailerModal)
