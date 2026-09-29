// ================= MAIN: navigation, navbar, theme =================

const navbar = document.getElementById('navbar')

function scrollToTarget(target) {
  if (target === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
  if (target === 'watchlist-section') { window.openWatchlistSection(); return }
  const el = document.getElementById(target)
  if (!el) return
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - 80), behavior: 'smooth' })
}

document.addEventListener('click', e => {
  const link = e.target.closest('[data-target]')
  if (!link) return
  e.preventDefault()
  scrollToTarget(link.dataset.target)
})
document.getElementById('nav-brand').addEventListener('click', e => { e.preventDefault(); scrollToTarget('top') })

// ── Navbar: solid once scrolled; highlight the section in view ──
const navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-link'))
let navTicking = false
function onScroll() {
  navTicking = false
  const y = window.pageYOffset
  navbar.classList.toggle('scrolled', y > 40)

  let active = 'top'
  navLinks.forEach(a => {
    const t = a.dataset.target
    if (t === 'top') return
    const el = document.getElementById(t)
    if (!el || el.style.display === 'none') return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.4) active = t
  })
  navLinks.forEach(a => a.classList.toggle('active', a.dataset.target === active))
}
window.addEventListener('scroll', () => {
  if (!navTicking) { navTicking = true; requestAnimationFrame(onScroll) }
}, { passive: true })
onScroll()

// ── Theme toggle (saved to the active profile) ──
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark'
  applyTheme(next)
  const profile = getActiveProfile()
  if (profile) {
    profile.theme = next
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))
    fetch(`/api/profiles/${profile.id}`, jsonBody('PUT', { theme: next })).catch(() => {})
  }
})

const footerYear = document.getElementById('footer-year')
if (footerYear) footerYear.textContent = new Date().getFullYear()
