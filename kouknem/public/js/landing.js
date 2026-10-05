// ================= KOUKNEM — landing page =================
// "Založit místnost": POST /api/rooms → the host's credentials go to localStorage
// (the room page reads them, see js/room.js) → /r/<room>.

;(function () {
  'use strict'

  const $ = id => document.getElementById(id)
  function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) {} }

  // Navbar gets a border once the page scrolls.
  const nav = $('nav')
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  const form = $('start-form')
  const name = $('start-name')
  const btn = $('start-btn')
  const error = $('start-error')

  name.value = lsGet('kouknem_name') || ''
  const prefs = (() => { try { return JSON.parse(lsGet('kouknem_prefs') || '{}') || {} } catch (e) { return {} } })()
  if (prefs.audioPref) $('start-audio').value = prefs.audioPref
  if (prefs.qualityPref) $('start-quality').value = prefs.qualityPref

  // Buttons further down bring you back to the form, ready to type.
  document.querySelectorAll('a[href="#zalozit"]').forEach(a => a.addEventListener('click', () => setTimeout(() => name.focus({ preventScroll: true }), 350)))

  form.addEventListener('submit', e => {
    e.preventDefault()
    const n = name.value.trim()
    if (!n) { name.focus(); return }
    const p = { audioPref: $('start-audio').value, qualityPref: $('start-quality').value }
    btn.disabled = true
    error.textContent = ''
    fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, prefs: p }) })
      .then(r => r.json().catch(() => ({})).then(b => {
        if (!r.ok) throw new Error(b.error || 'Místnost se nepodařilo založit')
        lsSet('kouknem_name', n)
        lsSet('kouknem_prefs', JSON.stringify(p))
        lsSet('kouknem_room_' + b.id, JSON.stringify(b.member))
        location.href = '/r/' + encodeURIComponent(b.id)
      }))
      .catch(err => {
        error.textContent = err.message === 'Failed to fetch' ? 'Server neodpovídá — zkuste to znovu.' : err.message
        btn.disabled = false
      })
  })
})()
