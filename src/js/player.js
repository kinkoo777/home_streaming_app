// ================= PREHRAJ MODAL =================

const prehrajModal         = document.getElementById('prehraj-modal')
const prehrajModalTitle    = document.getElementById('prehraj-modal-title')
const prehrajModalSubtitle = document.getElementById('prehraj-modal-subtitle')
const prehrajModalContent  = document.getElementById('prehraj-modal-content')
const prehrajModalClose    = document.getElementById('prehraj-modal-close')
const prehrajModalBackdrop = document.querySelector('.prehraj-modal-backdrop')

prehrajModalClose.addEventListener('click', closePrehrajModal)
prehrajModalBackdrop.addEventListener('click', closePrehrajModal)

function closePrehrajModal() {
  prehrajModal.classList.add('hidden')
  document.body.classList.remove('modal-open')
}

async function openPrehrajSearch(title) {
  prehrajModal.classList.remove('hidden')
  document.body.classList.add('modal-open')
  prehrajModalTitle.textContent    = title
  prehrajModalSubtitle.textContent = 'Hledání na prehraj.to...'
  prehrajModalContent.innerHTML    = `<div class="prehraj-loading"><i class="bi bi-arrow-repeat"></i> Načítání výsledků...</div>`

  try {
    const response = await fetch(`/search?q=${encodeURIComponent(title)}`)
    if (!response.ok) throw new Error('Server neodpověděl')
    const results = await response.json()

    if (!results.length) {
      prehrajModalSubtitle.textContent = 'Žádné výsledky'
      prehrajModalContent.innerHTML    = `
        <div class="prehraj-empty">
          <p>Pro <strong style="color:#fafafa">"${title}"</strong> nebyly nalezeny žádné výsledky.</p>
          <p style="margin-top:6px;font-size:13px">Zkuste jiný název:</p>
          <div class="prehraj-retry">
            <input class="prehraj-retry-input" type="text" value="${title.replace(/"/g, '&quot;')}" placeholder="Vlastní název..." />
            <button class="play-btn" onclick="window.retryPrehrajSearch(this)">
              <i class="bi bi-search"></i> Hledat
            </button>
          </div>
        </div>`
      setTimeout(() => {
        const inp = prehrajModalContent.querySelector('.prehraj-retry-input')
        if (inp) inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') window.retryPrehrajSearch(inp.nextElementSibling)
        })
      }, 0)
      return
    }

    prehrajModalSubtitle.textContent = `${results.length} výsledků na prehraj.to`
    prehrajModalContent.innerHTML    = `<div class="prehraj-grid">${results.join('')}</div>`

    prehrajModalContent.querySelectorAll('a[href]').forEach(link => {
      link.addEventListener('click', async e => {
        e.preventDefault()
        const href = link.getAttribute('href')
        if (!href) return

        prehrajModalSubtitle.textContent = 'Načítání videa...'
        prehrajModalContent.innerHTML    = `<div class="prehraj-loading"><i class="bi bi-arrow-repeat"></i> Získávání odkazu...</div>`

        try {
          const res    = await fetch(`/get_video?url=${encodeURIComponent(href)}`)
          if (!res.ok) throw new Error('Server neodpověděl')
          const videos = await res.json()
          const valid  = videos.filter(v => v.videoSrc && !v.videoSrc.startsWith('blob:'))
          if (!valid.length) throw new Error('Nepodařilo se získat odkaz na video')
          sessionStorage.setItem('filmbox_player', JSON.stringify({ title: prehrajModalTitle.textContent, videos: valid }))
          window.location.href = 'player.html'
        } catch (err) {
          prehrajModalSubtitle.textContent = 'Chyba'
          prehrajModalContent.innerHTML    = `<div class="prehraj-error"><i class="bi bi-exclamation-circle"></i> ${err.message}</div>`
        }
      })
    })

  } catch (err) {
    prehrajModalSubtitle.textContent = 'Chyba'
    prehrajModalContent.innerHTML    = `<div class="prehraj-error"><i class="bi bi-exclamation-circle"></i> ${err.message}</div>`
  }
}

window.retryPrehrajSearch = function(btn) {
  const input = btn.previousElementSibling
  const name  = input ? input.value.trim() : ''
  if (name) openPrehrajSearch(name)
}
