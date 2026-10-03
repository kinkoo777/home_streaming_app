// ================= "SLEDOVAT SPOLEČNĚ" FROM THE HOME PAGE =================
// A room without a film: everyone proposes and votes, then the chosen film starts
// for all (rooms.js, watch.html). Films for the room are picked with this
// profile's playback preferences. Not on TVs — the link is shared from a phone/PC.

;(function () {
  'use strict'

  const btn = document.getElementById('together-nav-btn')
  if (!btn) return
  if (document.body.classList.contains('tv')) { btn.style.display = 'none'; return }

  btn.addEventListener('click', async () => {
    const profile = getActiveProfile()
    if (!profile) { showToast('Nejprve vyberte profil'); return }
    const s = profile.settings || {}
    btn.disabled = true
    try {
      const room = await apiFetch('/api/rooms', jsonBody('POST', {
        name: profile.name,
        prefs: { audioPref: s.audioPref, qualityPref: s.qualityPref }
      }))
      lsSet('filmbox_room_' + room.id, JSON.stringify(room.member))
      location.href = 'watch.html?room=' + encodeURIComponent(room.id)
    } catch (err) {
      showToast('Místnost se nepodařilo založit: ' + err.message)
      btn.disabled = false
    }
  })
})()
