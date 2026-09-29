// ================= ACTOR MODAL =================

const actorModal = document.getElementById('actor-modal')

function openActorModal(actorId) {
  document.getElementById('actor-name').textContent = 'Načítání…'
  document.getElementById('actor-bio').textContent  = ''
  document.getElementById('actor-works').innerHTML  = renderSkeletonsHTML(8)
  document.getElementById('actor-photo').style.display             = 'none'
  document.getElementById('actor-photo-placeholder').style.display = 'flex'
  actorModal.scrollTop = 0
  openModal(actorModal, closeActorModal)

  fetch(`/tmdb/actor?id=${encodeURIComponent(actorId)}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('actor-name').textContent = data.name || ''
      const bio = data.biography || ''
      document.getElementById('actor-bio').textContent = bio
        ? bio.slice(0, 420) + (bio.length > 420 ? '…' : '')
        : 'Biografie není dostupná.'

      if (data.profile_path) {
        const img = document.getElementById('actor-photo')
        img.src = tmdbImg(data.profile_path, 'w185')
        img.style.display = 'block'
        document.getElementById('actor-photo-placeholder').style.display = 'none'
      }

      const works = data.works || []
      rememberMovies(works)
      document.getElementById('actor-works').innerHTML = works.map((m, i) => buildCard(m, { index: i })).join('')
    })
    .catch(() => {
      document.getElementById('actor-name').textContent = 'Nepodařilo se načíst.'
      document.getElementById('actor-works').innerHTML = ''
    })
}

function closeActorModal() { closeModal(actorModal) }

window.openActorModal = openActorModal
