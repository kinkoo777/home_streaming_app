// ================= ACTOR MODAL =================

function openActorModal(actorId) {
  const modal = document.getElementById('actor-modal')
  modal.classList.remove('hidden')
  document.body.classList.add('modal-open')
  document.getElementById('actor-name').textContent = 'Načítání...'
  document.getElementById('actor-bio').textContent  = ''
  document.getElementById('actor-works').innerHTML  = renderSkeletonsHTML(8)
  document.getElementById('actor-photo').style.display             = 'none'
  document.getElementById('actor-photo-placeholder').style.display = 'flex'

  fetch(`/tmdb/actor?id=${actorId}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('actor-name').textContent = data.name || ''
      document.getElementById('actor-bio').textContent  = data.biography
        ? data.biography.slice(0, 300) + (data.biography.length > 300 ? '…' : '')
        : 'Biografie není dostupná.'

      if (data.profile_path) {
        const img = document.getElementById('actor-photo')
        img.src = `https://image.tmdb.org/t/p/w185${data.profile_path}`
        img.style.display = 'block'
        document.getElementById('actor-photo-placeholder').style.display = 'none'
      }

      const works = data.works || []
      works.forEach(m => { searchDataMap[m.id] = m })
      document.getElementById('actor-works').innerHTML = works.map(m => buildCard(m)).join('')
    })
    .catch(() => {
      document.getElementById('actor-name').textContent = 'Nepodařilo se načíst.'
    })
}

function closeActorModal() {
  document.getElementById('actor-modal').classList.add('hidden')
  document.body.classList.remove('modal-open')
}

document.getElementById('actor-close').addEventListener('click', closeActorModal)
document.getElementById('actor-backdrop').addEventListener('click', closeActorModal)

window.openActorModal = openActorModal
