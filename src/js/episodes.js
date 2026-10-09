// ================= NEXT EPISODE =================
// Which episode comes after S{season}E{number}, from the show's TMDB details
// (/tv/{id}: seasons[].episode_count, last_episode_to_air, next_episode_to_air).
// After a season's last episode it moves on to the next season's first one. It never
// offers an episode that doesn't exist or hasn't aired yet. Pure function, loaded by
// the page (window.FilmBoxEpisodes) and by the Node unit tests (require).

;(function (root) {
  'use strict'

  const pad2 = n => String(n).padStart(2, '0')
  const code = (s, e) => 'S' + pad2(s) + 'E' + pad2(e)
  const isAfter = (a, b) => a.season > b.season || (a.season === b.season && a.number > b.number)

  // → { next: { season, number, code } | null, airDate: 'YYYY-MM-DD' | null, ended: bool }
  // `next` is null at the end of the show, or when the following episode hasn't aired
  // yet (airDate then says when, if TMDB knows). `today` is only for tests.
  function nextEpisode(show, season, number, today) {
    season = Number(season); number = Number(number)
    const found = (s, e) => ({ next: { season: s, number: e, code: code(s, e) }, airDate: null, ended: false })
    const seasons = ((show && show.seasons) || [])
      .filter(s => s && s.season_number > 0 && s.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number)
    const current = seasons.filter(s => s.season_number === season)[0]
    // Specials, or no season data: nothing to check against — just the following number.
    if (!season || !current) return found(season, number + 1)

    let next
    if (number < current.episode_count) next = { season, number: number + 1 }
    else {
      const later = seasons.filter(s => s.season_number > season)[0]
      if (later) next = { season: later.season_number, number: 1 }
    }
    const status = show.status || ''
    const ended = /^(Ended|Canceled|Cancelled)$/.test(status)
    const upcoming = show.next_episode_to_air
    const upcomingIs = n => upcoming && upcoming.season_number === n.season && upcoming.episode_number === n.number
    if (!next) return { next: null, airDate: (upcoming && upcoming.air_date) || null, ended }

    // TMDB counts announced episodes too — stop at the last one that has aired.
    const last = show.last_episode_to_air
    if (last && last.season_number && isAfter(next, { season: last.season_number, number: last.episode_number })) {
      const day = today || new Date().toISOString().slice(0, 10)
      // Details are cached for hours: an episode that aired since then is fine to play.
      if (upcomingIs(next) && upcoming.air_date && upcoming.air_date <= day) return found(next.season, next.number)
      const seasonInfo = next.number === 1 ? seasons.filter(s => s.season_number === next.season)[0] : null
      const airDate = (upcomingIs(next) && upcoming.air_date) || (seasonInfo && seasonInfo.air_date) || null
      return { next: null, airDate: airDate && airDate > day ? airDate : null, ended: false }
    }
    return found(next.season, next.number)
  }

  // Why there's no next episode, for the player / room ("12. 10. 2026").
  function noNextMessage(r) {
    if (r && r.airDate) {
      const p = r.airDate.split('-')
      return 'Další díl vyjde ' + Number(p[2]) + '. ' + Number(p[1]) + '. ' + p[0]
    }
    return r && r.ended ? 'To byl poslední díl seriálu' : 'Další díl zatím nevyšel'
  }

  const api = { nextEpisode, noNextMessage, episodeCode: code }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.FilmBoxEpisodes = api
})(typeof window !== 'undefined' ? window : this)
