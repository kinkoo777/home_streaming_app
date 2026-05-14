// ================= MAIN INIT =================

document.getElementById('nav-home')?.addEventListener('click', e => {
  e.preventDefault()
  window.scrollTo({ top: 0, behavior: 'smooth' })
})

document.getElementById('nav-filmy')?.addEventListener('click', e => {
  e.preventDefault()
  document.getElementById('section-popular')?.scrollIntoView({ behavior: 'smooth' })
})

document.getElementById('nav-serialy')?.addEventListener('click', e => {
  e.preventDefault()
  document.getElementById('section-trending')?.scrollIntoView({ behavior: 'smooth' })
})

document.getElementById('nav-novinky')?.addEventListener('click', e => {
  e.preventDefault()
  document.getElementById('section-top-rated')?.scrollIntoView({ behavior: 'smooth' })
})
