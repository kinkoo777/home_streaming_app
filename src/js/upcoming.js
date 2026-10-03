// ================= NEW EPISODES + COMING SOON =================
// "Nové díly": series this profile follows that aired episodes it hasn't seen.
// "Brzy vyjde" + calendar: upcoming cinema / digital premieres of films on the
// profile's lists and favourites, and the next episodes of followed series.
//
// Followed series come from the profile's own data: episodes in the progress
// store (how far it got), series marked watched, and favourite series.

;(function () {
  'use strict'

  const DAY = 86400000
  const WEEKDAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']
  const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec']
  const NEW_WINDOW = 120          // days: an episode older than this isn't "new" any more
  const SOON_WINDOW = 120         // days ahead shown in the calendar
  let _seq = 0
  let _events = []                // calendar entries of the last render
  const _detailsCache = {}        // 'tv:1399' → TMDB details promise (for this page view)

  function today() {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }
  const toTime = iso => { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime() }
  const daysFrom = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY)
  const epCode = (s, e) => 'S' + String(s).padStart(2, '0') + 'E' + String(e).padStart(2, '0')
  const cmpEp = (a, b) => a.s - b.s || a.e - b.e

  // "14. 10." (+ year when it isn't this year)
  function shortDate(iso) {
    const p = iso.split('-').map(Number)
    return p[2] + '. ' + p[1] + '.' + (p[0] !== new Date().getFullYear() ? ' ' + p[0] : '')
  }
  function weekday(iso) { return WEEKDAYS[new Date(toTime(iso)).getDay()] }

  function details(type, id) {
    const key = type + ':' + id
    if (!_detailsCache[key]) {
      _detailsCache[key] = fetch(`/tmdb/details?id=${id}&type=${type}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null)
    }
    return _detailsCache[key]
  }

  // ── Followed series ──
  // { id, furthest: { s, e } | null, since: 'YYYY-MM-DD', title, poster }
  function followedShows() {
    const shows = {}
    const touch = (id, since, title, poster) => {
      id = Number(id)
      if (!id) return null
      const sh = shows[id] || (shows[id] = { id, furthest: null, since: '', title: null, poster: null })
      if (since && since > sh.since) sh.since = since
      if (title && !sh.title) sh.title = String(title).replace(/\s*S\d{1,3}E\d{1,4}.*$/i, '').trim()
      if (poster && !sh.poster) sh.poster = poster
      return sh
    }
    const progress = window._profileProgress || {}
    Object.keys(progress).forEach(key => {
      const m = /^(\d+):S(\d+)E(\d+)$/.exec(key)
      const v = progress[key]
      if (!m || !v || typeof v !== 'object') return
      const sh = touch(m[1], (v.updatedAt || '').slice(0, 10), v.title, v.posterPath)
      const ep = { s: +m[2], e: +m[3] }
      if (sh && (!sh.furthest || cmpEp(ep, sh.furthest) > 0)) sh.furthest = ep
    })
    ;(typeof _watchedCache !== 'undefined' ? _watchedCache : []).forEach(w => {
      if (w.mediaType === 'tv') touch(w.tmdbId, (w.watchedAt || '').slice(0, 10), w.title, w.posterPath)
    })
    ;(typeof _favState !== 'undefined' ? _favState.list : []).forEach(f => {
      if (f.mediaType === 'tv') touch(f.tmdbId, (f.addedAt || '').slice(0, 10), f.title, f.posterPath)
    })
    return Object.keys(shows).map(k => shows[k]).sort((a, b) => b.since.localeCompare(a.since)).slice(0, 30)
  }

  // Aired episodes the profile hasn't seen yet, or null.
  //  - progress known: the latest aired episode is past the furthest one watched,
  //    and the profile is no more than a season behind (not an abandoned show);
  //  - only marked watched / favourite: something aired since then.
  function newEpisodeBadge(show, d, now) {
    const last = d && d.last_episode_to_air
    if (!last || !last.air_date || last.air_date > now || daysFrom(last.air_date, now) > NEW_WINDOW) return null
    const lastEp = { s: last.season_number, e: last.episode_number }
    if (show.furthest) {
      if (cmpEp(lastEp, show.furthest) <= 0 || lastEp.s - show.furthest.s > 1) return null
      if (lastEp.s > show.furthest.s) return 'Nová řada · ' + epCode(lastEp.s, lastEp.e)
      const n = lastEp.e - show.furthest.e
      return n === 1 ? 'Nový díl ' + epCode(lastEp.s, lastEp.e) : n + (n <= 4 ? ' nové díly' : ' nových dílů')
    }
    if (!show.since || last.air_date < show.since) return null
    return 'Nový díl ' + epCode(lastEp.s, lastEp.e)
  }

  // ── Films: release dates from TMDB (Czech, else US) ──
  // TMDB types: 2 limited cinema, 3 cinema, 4 digital, 5 disc.
  function releaseEvents(rd, now) {
    const countries = (rd && rd.results) || []
    const pick = (types) => {
      for (const iso of ['CZ', 'US']) {
        const c = countries.find(x => x.iso_3166_1 === iso)
        const dates = c ? c.release_dates.filter(r => types.indexOf(r.type) >= 0).map(r => (r.release_date || '').slice(0, 10)).filter(Boolean).sort() : []
        if (dates.length) return { date: dates[0], country: iso }
      }
      return null
    }
    const out = []
    const cinema = pick([3, 2])
    const digital = pick([4])
    if (cinema && cinema.date >= now) out.push({ date: cinema.date, kind: 'cinema', what: 'V kinech' + (cinema.country === 'US' ? ' (USA)' : '') })
    if (digital && digital.date >= now) out.push({ date: digital.date, kind: 'digital', what: 'Digitálně' + (digital.country === 'US' ? ' (USA)' : '') })
    return out
  }

  // Films and series from every list + favourites, with how they're known.
  function listedTitles() {
    const out = {}
    const add = (m, type) => {
      const id = Number(m.id || m.tmdbId)
      if (!id) return
      const key = type + id
      if (!out[key]) out[key] = { id, type, title: m.title || m.name, poster: m.poster_path || m.posterPath || null, release: m.release_date || m.first_air_date || '' }
    }
    ;(typeof getLists === 'function' ? getLists() : []).forEach(l => l.movies.forEach(m => add(m, m.media_type === 'tv' ? 'tv' : 'movie')))
    ;(typeof _favState !== 'undefined' ? _favState.list : []).forEach(f => add(f, f.mediaType))
    return Object.keys(out).map(k => out[k])
  }

  async function collect() {
    const now = today()
    const horizon = new Date(toTime(now) + SOON_WINDOW * DAY)
    const until = horizon.getFullYear() + '-' + String(horizon.getMonth() + 1).padStart(2, '0') + '-' + String(horizon.getDate()).padStart(2, '0')
    const followed = followedShows()
    const listed = listedTitles()

    // Series: followed + listed, one details call each (cached on the server).
    const showIds = {}
    followed.forEach(s => { showIds[s.id] = s })
    listed.filter(t => t.type === 'tv').forEach(t => {
      if (!showIds[t.id]) showIds[t.id] = { id: t.id, furthest: null, since: '', title: t.title, poster: t.poster, listedOnly: true }
    })
    const showList = Object.keys(showIds).map(k => showIds[k]).slice(0, 40)
    const showDetails = await Promise.all(showList.map(s => details('tv', s.id)))

    const fresh = []
    const events = []
    showList.forEach((s, i) => {
      const d = showDetails[i]
      if (!d) return
      const title = d.name || s.title
      const poster = d.poster_path || s.poster
      const card = { id: s.id, name: title, poster_path: poster, media_type: 'tv', vote_average: d.vote_average, first_air_date: d.first_air_date }
      const next = d.next_episode_to_air
      if (!s.listedOnly) {
        const badge = newEpisodeBadge(s, d, now)
        // No year on these cards: "Seriál · další 14. 10." has to fit a phone-sized card.
        if (badge) fresh.push({ card: Object.assign({}, card, { first_air_date: null }), badge, date: d.last_episode_to_air.air_date, note: next && next.air_date ? 'další ' + shortDate(next.air_date) : null })
      }
      if (next && next.air_date && next.air_date >= now && next.air_date <= until) {
        events.push({ date: next.air_date, kind: 'episode', what: epCode(next.season_number, next.episode_number) + (next.episode_number === 1 ? ' · nová řada' : ''), card })
      } else if (s.listedOnly && d.first_air_date && d.first_air_date >= now && d.first_air_date <= until) {
        events.push({ date: d.first_air_date, kind: 'premiere', what: 'Premiéra seriálu', card })
      }
    })

    // Films: only ones that could still be coming (unknown date or released < 200 days ago).
    const films = listed.filter(t => t.type === 'movie' && (!t.release || daysFrom(t.release, now) < 200)).slice(0, 40)
    const dates = await Promise.all(films.map(f =>
      fetch(`/tmdb/release_dates?id=${f.id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
    films.forEach((f, i) => {
      const card = { id: f.id, title: f.title, poster_path: f.poster, media_type: 'movie', release_date: f.release }
      releaseEvents(dates[i], now).filter(ev => ev.date <= until).forEach(ev => events.push(Object.assign(ev, { card })))
    })

    fresh.sort((a, b) => b.date.localeCompare(a.date))
    events.sort((a, b) => a.date.localeCompare(b.date))
    return { fresh, events }
  }

  function showRow(sectionId, trackId, items) {
    const section = document.getElementById(sectionId)
    const track = document.getElementById(trackId)
    if (!items.length) { section.style.display = 'none'; return }
    rememberMovies(items.map(x => x.card))
    track.innerHTML = items.map((x, i) => buildCard(x.card, { index: i, badge: x.badge, note: x.note, hideWatchedBadge: true })).join('')
    track.scrollLeft = 0
    section.style.display = 'block'
    if (window.updateRowArrows) window.updateRowArrows(track)
  }

  async function render() {
    const seq = ++_seq
    if (!hasActiveProfile()) {
      document.getElementById('new-episodes-section').style.display = 'none'
      document.getElementById('upcoming-section').style.display = 'none'
      return
    }
    const res = await collect()
    if (seq !== _seq) return
    _events = res.events
    showRow('new-episodes-section', 'new-episodes-movies', res.fresh)
    // The row: each title once, at its nearest date.
    const seen = {}
    const soon = res.events.filter(ev => {
      const k = ev.card.media_type + ev.card.id
      if (seen[k]) return false
      seen[k] = true
      return true
    }).map(ev => ({ card: ev.card, badge: shortDate(ev.date) + ' · ' + ev.what }))
    showRow('upcoming-section', 'upcoming-movies', soon)
  }

  // ── Calendar sheet: every event, grouped by month ──
  function openCalendar() {
    const list = document.getElementById('calendar-list')
    if (!_events.length) {
      list.innerHTML = '<p class="calendar-empty">V nejbližších měsících nic z vašich seznamů nevychází.</p>'
    } else {
      let month = ''
      list.innerHTML = _events.map(ev => {
        const m = ev.date.slice(0, 7)
        const head = m !== month ? `<h4 class="calendar-month">${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}</h4>` : ''
        month = m
        const c = ev.card
        const title = c.title || c.name || ''
        return head + `
          <button class="calendar-item" data-id="${c.id}" data-type="${c.media_type}" data-title="${escapeHtml(title)}">
            <span class="calendar-date"><b>${ev.date.slice(8).replace(/^0/, '')}.</b><small>${weekday(ev.date)}</small></span>
            ${c.poster_path ? `<img src="${tmdbImg(c.poster_path, 'w92')}" alt="" loading="lazy">` : '<span class="calendar-noposter"><i class="bi bi-film"></i></span>'}
            <span class="calendar-text"><b>${escapeHtml(title)}</b><small class="calendar-kind ${ev.kind}">${escapeHtml(ev.what)}</small></span>
            <span class="calendar-in">${escapeHtml(inDays(ev.date))}</span>
          </button>`
      }).join('')
    }
    const modal = document.getElementById('calendar-modal')
    modal.scrollTop = 0
    openModal(modal, () => closeModal(modal))
  }
  function inDays(iso) {
    const n = daysFrom(today(), iso)
    return n === 0 ? 'dnes' : n === 1 ? 'zítra' : 'za ' + n + (n <= 4 ? ' dny' : ' dní')
  }

  document.getElementById('upcoming-calendar-btn').addEventListener('click', openCalendar)
  document.getElementById('calendar-list').addEventListener('click', e => {
    const it = e.target.closest('.calendar-item')
    if (it) openDetailModal(parseInt(it.dataset.id, 10), it.dataset.type, it.dataset.title)
  })

  window.reloadUpcoming = render
  window.openCalendar = openCalendar
  // Same timing as the recommendations: after the library has loaded.
  document.addEventListener('DOMContentLoaded', () => {
    if (hasActiveProfile()) setTimeout(render, 1600)
  })
})()
