// ── Watch together: rooms shared by link ──
//
// A host (on the home network) opens a room for the video they're watching and
// shares its link. Everyone in the room gets the same playback — play, pause and
// seeks apply to all — plus chat, emoji reactions and a list of who's watching.
//
// Roles: host (one, owns the room) > moderator > viewer. What moderators and
// viewers may do is set per room by the host (permissions below). The host can
// change anyone's role, remove people and lock the room.
//
// The room id in the link is the invitation (128 random bits). Each member gets
// its own id + secret on joining, sent with every request. Events go out over
// Server-Sent Events. Everything lives in memory: a server restart ends rooms.
//
// A room can also start without a film: people propose films (TMDB search),
// vote — one vote each, changeable — and whoever may control playback starts
// one — with an upload picked from the list of what's available, or the
// recommended one (listSources / findPlayer in server.js). Whoever may control
// playback can also switch the playing film to another upload.
//
// The router is mounted twice: on the main app (home network — can create rooms)
// and on the guest app (GUEST_PORT, the one exposed to the internet — can only
// join existing rooms, see server.js).

const crypto = require('crypto');
const express = require('express');

const MAX_ROOMS = 20;
const MAX_MEMBERS = 20;
const CHAT_KEEP = 100;
const OFFLINE_DROP = 2 * 60 * 1000;      // a member without a connection this long leaves
const EMPTY_CLOSE = 30 * 60 * 1000;      // a room nobody is connected to closes
const MAX_AGE = 12 * 60 * 60 * 1000;
const ROLES = ['host', 'moderator', 'viewer'];
const RANK = { host: 3, moderator: 2, viewer: 1 };
const PERMS = ['control', 'chat', 'react', 'suggest', 'kick'];
const DEFAULT_PERMS = {
    moderator: { control: true, chat: true, react: true, suggest: true, kick: true },
    viewer: { control: false, chat: true, react: true, suggest: true, kick: false }
};
const MAX_POLL = 20;
const AUDIO = ['dub', 'original', 'any'];
const QUALITY = ['2160', '1080', '720'];
const EMOJI = ['😂', '😮', '❤️', '👍', '😢', '🔥', '👏', '😱'];

const rooms = new Map();

const token = bytes => crypto.randomBytes(bytes).toString('base64url');
const now = () => Date.now();

function cleanName(v, fallback) {
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    return s || fallback;
}

// Fixed-window limiter: max `n` hits per `ms` per key.
function limiter(n, ms) {
    const hits = new Map();
    return key => {
        const t = now();
        const h = hits.get(key);
        if (!h || t - h.start > ms) { hits.set(key, { start: t, count: 1 }); return true; }
        if (h.count >= n) return false;
        h.count++;
        return true;
    };
}
const joinLimit = limiter(10, 60 * 1000);
const chatLimit = limiter(5, 5000);
const reactLimit = limiter(10, 5000);
const actionLimit = limiter(15, 5000);
const searchLimit = limiter(20, 10000);
const pollLimit = limiter(20, 10000);

// ── Room state ──

// Where playback is right now (seconds), from the last control action.
function positionAt(state, t) {
    return state.position + (state.playing ? (t - state.updatedAt) / 1000 : 0);
}

function can(room, m, perm) {
    if (m.role === 'host') return true;
    const p = room.settings.perms[m.role];
    return !!(p && p[perm]);
}

function permsOf(room, m) {
    const out = {};
    PERMS.forEach(p => { out[p] = can(room, m, p); });
    return out;
}

function publicMember(m) {
    return { id: m.id, name: m.name, role: m.role, online: m.conns.size > 0, buffering: !!m.buffering, position: m.position || 0 };
}

// What members see of the video: no page URL, just what playing it needs.
// null = no film yet (choosing one).
function publicVideo(room) {
    const p = room.player;
    if (!p) return null;
    return {
        title: p.title || 'Film',
        posterPath: typeof p.posterPath === 'string' ? p.posterPath : null,
        mediaType: p.mediaType === 'tv' ? 'tv' : 'movie',
        tmdbId: Number(p.tmdbId) || null,
        episode: p.episode && typeof p.episode === 'object' ? { season: Number(p.episode.season) || 0, number: Number(p.episode.number) || 0 } : null,
        episodeLabel: typeof p.episodeLabel === 'string' ? p.episodeLabel : null,
        qualities: p.source.qualities.map(q => ({ src: q.src, label: String(q.label || ''), res: Number(q.res) || null })),
        subtitles: (p.source.subtitles || []).map(s => ({ label: String(s.label || s.lang || 'Titulky'), lang: String(s.lang || '') }))
    };
}

// links: { link, public } — worked out when sent, so turning Funnel on later
// gives an open room its public link too.
function snapshot(room, m, links) {
    const t = now();
    return {
        type: 'hello',
        serverTime: t,
        you: { id: m.id, name: m.name, role: m.role, perms: permsOf(room, m) },
        room: {
            id: room.id, hostId: room.hostId, settings: room.settings, emoji: EMOJI,
            link: links.link, publicLink: links.public
        },
        video: publicVideo(room),
        videoVersion: room.videoVersion,
        state: Object.assign({}, room.state, { position: positionAt(room.state, t), updatedAt: t }),
        members: [...room.members.values()].map(publicMember),
        chat: room.chat.slice(-50),
        poll: publicPoll(room)
    };
}

// Proposals, most votes first (ties: proposed earlier first).
function publicPoll(room) {
    const items = room.poll.items.map(it => ({
        id: it.id, tmdbId: it.tmdbId, title: it.title, year: it.year, posterPath: it.posterPath,
        rating: it.rating, overview: it.overview, by: it.by,
        votes: it.votes.size,
        voters: [...it.votes].map(id => { const m = room.members.get(id); return { id, name: m ? m.name : '?' }; })
    })).sort((a, b) => b.votes - a.votes || room.poll.items.findIndex(x => x.id === a.id) - room.poll.items.findIndex(x => x.id === b.id));
    return { items, finding: room.poll.finding || null, error: room.poll.error || null };
}

function broadcastPoll(room) {
    broadcast(room, { type: 'poll', poll: publicPoll(room) });
}

function send(res, msg) {
    res.write('data: ' + JSON.stringify(msg) + '\n\n');
}

function broadcast(room, msg) {
    room.lastActive = now();
    for (const m of room.members.values()) for (const res of m.conns) send(res, msg);
}

function broadcastMembers(room) {
    broadcast(room, { type: 'members', members: [...room.members.values()].map(publicMember) });
}

// Each member gets its own copy: permissions depend on the role.
function broadcastYou(room) {
    for (const m of room.members.values()) {
        const msg = { type: 'you', you: { id: m.id, name: m.name, role: m.role, perms: permsOf(room, m) }, settings: room.settings };
        for (const res of m.conns) send(res, msg);
    }
}

function systemMessage(room, text) {
    const msg = { id: token(6), at: now(), system: true, text };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.shift();
    broadcast(room, { type: 'chat', message: msg });
}

function addMember(room, name, role) {
    const m = { id: token(9), secret: token(18), name, role, joinedAt: now(), lastSeen: now(), conns: new Set(), buffering: false, position: 0 };
    room.members.set(m.id, m);
    return m;
}

function removeMember(room, m, notice) {
    for (const res of m.conns) { send(res, { type: notice || 'left' }); res.end(); }
    room.members.delete(m.id);
}

function closeRoom(room, reason) {
    for (const m of room.members.values()) for (const res of m.conns) { send(res, { type: 'closed', reason }); res.end(); }
    rooms.delete(room.id);
}

// Housekeeping: members gone for a while leave; idle or old rooms close.
setInterval(() => {
    const t = now();
    for (const room of rooms.values()) {
        let changed = false;
        for (const m of room.members.values()) {
            if (m.role !== 'host' && !m.conns.size && t - m.lastSeen > OFFLINE_DROP) {
                room.members.delete(m.id);
                systemMessage(room, m.name + ' odešel');
                changed = true;
            }
        }
        if (changed) broadcastMembers(room);
        const anyone = [...room.members.values()].some(m => m.conns.size);
        if ((!anyone && t - room.lastActive > EMPTY_CLOSE) || t - room.createdAt > MAX_AGE) closeRoom(room, 'Místnost vypršela');
    }
}, 30 * 1000).unref();

// ── Router ──
// opts: { canCreate, checkPlayer, resolveVideo, handleStream, loadSubtitle, linkFor }

function router(opts) {
    const r = express.Router();

    function room(req, res) {
        const rm = rooms.get(String(req.params.id || ''));
        if (!rm) { res.status(404).json({ error: 'Místnost neexistuje nebo už skončila' }); return null; }
        return rm;
    }
    // Member credentials: X-Room-Member: "<id>.<secret>" (or ?m=&s= where headers can't be set).
    function member(req, res, rm) {
        const h = req.get('x-room-member') || '';
        const dot = h.indexOf('.');
        const id = dot > 0 ? h.slice(0, dot) : String(req.query.m || '');
        const secret = dot > 0 ? h.slice(dot + 1) : String(req.query.s || '');
        const m = rm.members.get(id);
        if (!m || !secret || m.secret.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(m.secret), Buffer.from(secret))) {
            res.status(401).json({ error: 'Nejste v této místnosti' });
            return null;
        }
        m.lastSeen = now();
        return m;
    }
    function need(res, rm, m, perm) {
        if (can(rm, m, perm)) return true;
        res.status(403).json({ error: 'K tomu nemáte oprávnění' });
        return false;
    }

    if (opts.canCreate) {
        // { player?, name, position, playing, prefs? } → { id, link, member }
        // Without a player the room starts by choosing a film together.
        r.post('/', (req, res) => {
            const b = req.body || {};
            const bad = b.player != null ? opts.checkPlayer(b.player) : null;
            if (bad) return res.status(400).json({ error: bad });
            if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: 'Je otevřeno příliš mnoho místností' });
            const id = token(16);
            const t = now();
            const position = Number(b.position);
            const rm = {
                id, createdAt: t, lastActive: t,
                player: b.player || null,
                videoVersion: 1,
                state: { playing: !!b.player && b.playing !== false, position: b.player && Number.isFinite(position) && position > 0 ? position : 0, updatedAt: t },
                settings: { locked: false, defaultRole: 'viewer', perms: JSON.parse(JSON.stringify(DEFAULT_PERMS)) },
                members: new Map(), chat: [], hostId: null, refreshedAt: 0, refreshing: null,
                poll: { items: [], finding: null, error: null },
                // The host's playback preferences pick uploads for films from the poll.
                prefs: {
                    audioPref: AUDIO.includes(b.prefs && b.prefs.audioPref) ? b.prefs.audioPref : 'dub',
                    qualityPref: QUALITY.includes(b.prefs && b.prefs.qualityPref) ? b.prefs.qualityPref : '1080'
                }
            };
            rm.linkHost = req.hostname;          // fallback for links without a public address
            const links = opts.linkFor(rm.linkHost, id);
            const host = addMember(rm, cleanName(b.name, 'Hostitel'), 'host');
            rm.hostId = host.id;
            rooms.set(id, rm);
            res.status(201).json({ id, link: links.link, public: links.public, member: { id: host.id, secret: host.secret } });
        });
    }

    // Join screen: what the room is, before entering a name.
    r.get('/:id', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const host = rm.members.get(rm.hostId);
        const v = publicVideo(rm) || { title: 'Vybíráme film', posterPath: null, episodeLabel: null };
        const links = opts.linkFor(rm.linkHost, rm.id);
        res.json({ title: v.title, posterPath: v.posterPath, episodeLabel: v.episodeLabel, choosing: !rm.player, host: host ? host.name : null, locked: rm.settings.locked, count: rm.members.size, full: rm.members.size >= MAX_MEMBERS, link: links.link, public: links.public });
    });

    r.post('/:id/join', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        if (!joinLimit(req.ip || '?')) return res.status(429).json({ error: 'Příliš mnoho pokusů, zkuste to za chvíli' });
        if (rm.settings.locked) return res.status(403).json({ error: 'Hostitel místnost zamkl' });
        if (rm.members.size >= MAX_MEMBERS) return res.status(403).json({ error: 'Místnost je plná' });
        const m = addMember(rm, cleanName((req.body || {}).name, 'Host ' + (rm.members.size + 1)), rm.settings.defaultRole);
        systemMessage(rm, m.name + ' se připojil');
        broadcastMembers(rm);
        res.status(201).json({ member: { id: m.id, secret: m.secret } });
    });

    r.get('/:id/events', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        res.write('retry: 3000\n\n');
        const wasOnline = m.conns.size > 0;
        m.conns.add(res);
        send(res, snapshot(rm, m, opts.linkFor(rm.linkHost, rm.id)));
        if (!wasOnline) broadcastMembers(rm);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
            clearInterval(ping);
            m.conns.delete(res);
            m.lastSeen = now();
            if (!m.conns.size && rm.members.has(m.id) && rooms.has(rm.id)) broadcastMembers(rm);
        });
    });

    // Playback for everyone: { type: 'play' | 'pause' | 'seek', position }
    r.post('/:id/action', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'control')) return;
        if (!actionLimit(m.id)) return res.status(429).json({ error: 'Pomaleji' });
        const b = req.body || {};
        const t = now();
        const pos = Number(b.position);
        const position = Number.isFinite(pos) && pos >= 0 && pos < 1e6 ? pos : positionAt(rm.state, t);
        if (b.type === 'play') rm.state = { playing: true, position, updatedAt: t };
        else if (b.type === 'pause') rm.state = { playing: false, position, updatedAt: t };
        else if (b.type === 'seek') rm.state = { playing: rm.state.playing, position, updatedAt: t };
        else return res.status(400).json({ error: 'Neznámá akce' });
        broadcast(rm, { type: 'sync', state: rm.state, serverTime: t, by: { id: m.id, name: m.name }, action: b.type });
        res.json({ ok: true });
    });

    r.post('/:id/chat', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'chat')) return;
        const text = typeof (req.body || {}).text === 'string' ? req.body.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500) : '';
        if (!text) return res.status(400).json({ error: 'Prázdná zpráva' });
        if (!chatLimit(m.id)) return res.status(429).json({ error: 'Píšete moc rychle' });
        const msg = { id: token(6), at: now(), from: { id: m.id, name: m.name, role: m.role }, text };
        rm.chat.push(msg);
        if (rm.chat.length > CHAT_KEEP) rm.chat.shift();
        broadcast(rm, { type: 'chat', message: msg });
        res.json({ ok: true });
    });

    r.post('/:id/react', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'react')) return;
        const emoji = (req.body || {}).emoji;
        if (!EMOJI.includes(emoji)) return res.status(400).json({ error: 'Neznámá reakce' });
        if (!reactLimit(m.id)) return res.status(429).json({ error: 'Pomaleji' });
        broadcast(rm, { type: 'reaction', emoji, from: { id: m.id, name: m.name } });
        res.json({ ok: true });
    });

    // Every few seconds: where this member is and whether it's buffering.
    r.post('/:id/presence', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        const b = req.body || {};
        const buffering = b.buffering === true;
        const pos = Number(b.position);
        if (Number.isFinite(pos) && pos >= 0 && pos < 1e6) m.position = pos;
        if (buffering !== m.buffering) { m.buffering = buffering; broadcastMembers(rm); }
        res.status(204).end();
    });

    // Host: role of a member ({ role }); remove someone (host, or "kick" for lower roles).
    r.post('/:id/members/:mid', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (m.role !== 'host') return res.status(403).json({ error: 'Role mění jen hostitel' });
        const target = rm.members.get(req.params.mid);
        const role = (req.body || {}).role;
        if (!target || target.role === 'host') return res.status(404).json({ error: 'Člen nenalezen' });
        if (role !== 'moderator' && role !== 'viewer') return res.status(400).json({ error: 'Neznámá role' });
        target.role = role;
        systemMessage(rm, target.name + (role === 'moderator' ? ' je teď moderátor' : ' je teď divák'));
        broadcastMembers(rm);
        broadcastYou(rm);
        res.json({ ok: true });
    });
    r.delete('/:id/members/:mid', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        const target = rm.members.get(req.params.mid);
        if (!target) return res.status(404).json({ error: 'Člen nenalezen' });
        if (target.id === m.id) {                        // leaving on your own
            if (m.role === 'host') return res.status(400).json({ error: 'Hostitel místnost zavírá' });
            removeMember(rm, m, 'left');
            systemMessage(rm, m.name + ' odešel');
            broadcastMembers(rm);
            return res.json({ ok: true });
        }
        if (!need(res, rm, m, 'kick')) return;
        if (RANK[target.role] >= RANK[m.role]) return res.status(403).json({ error: 'Tohoto člena odebrat nemůžete' });
        removeMember(rm, target, 'kicked');
        systemMessage(rm, target.name + ' byl odebrán');
        broadcastMembers(rm);
        res.json({ ok: true });
    });

    // Host: { locked, defaultRole, perms: { moderator: {…}, viewer: {…} } }
    r.post('/:id/settings', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (m.role !== 'host') return res.status(403).json({ error: 'Nastavení mění jen hostitel' });
        const b = req.body || {};
        const s = rm.settings;
        if (b.locked !== undefined) {
            if (typeof b.locked !== 'boolean') return res.status(400).json({ error: 'Neplatné nastavení' });
            s.locked = b.locked;
        }
        if (b.defaultRole !== undefined) {
            if (b.defaultRole !== 'moderator' && b.defaultRole !== 'viewer') return res.status(400).json({ error: 'Neznámá role' });
            s.defaultRole = b.defaultRole;
        }
        if (b.perms !== undefined) {
            if (!b.perms || typeof b.perms !== 'object') return res.status(400).json({ error: 'Neplatná oprávnění' });
            for (const role of ['moderator', 'viewer']) {
                const p = b.perms[role];
                if (p === undefined) continue;
                if (!p || typeof p !== 'object') return res.status(400).json({ error: 'Neplatná oprávnění' });
                for (const perm of PERMS) {
                    if (p[perm] === undefined) continue;
                    if (typeof p[perm] !== 'boolean') return res.status(400).json({ error: 'Neplatná oprávnění' });
                    s.perms[role][perm] = p[perm];
                }
            }
        }
        broadcastYou(rm);
        res.json({ ok: true, settings: s });
    });

    // A new film for everyone (null = back to choosing). `playing` defaults to
    // playing whenever there's a film.
    function setVideo(rm, player, position, note, playing) {
        const t = now();
        rm.player = player;
        rm.videoVersion++;
        rm.state = { playing: !!player && playing !== false, position: player && Number.isFinite(position) && position > 0 ? position : 0, updatedAt: t };
        broadcast(rm, { type: 'video', video: publicVideo(rm), videoVersion: rm.videoVersion, state: rm.state, serverTime: t });
        systemMessage(rm, player ? (note === 'switch' ? 'Jiný zdroj: ' + publicVideo(rm).title : 'Hraje: ' + publicVideo(rm).title + (note || '')) : 'Vybíráme další film');
    }

    // The upload someone picked in the source chooser (or none = recommended).
    const pickedUrl = b => (b && typeof b.url === 'string' && b.url.length <= 500 ? b.url : null);

    // ── Choosing the upload ──
    // What's available for a proposal / for the film playing now (needs "control").
    async function sendSources(res, rm, what, currentUrl) {
        try {
            const list = await opts.listSources(what, rm.prefs);
            res.json({
                title: list.title,
                sources: list.sources.map(s => Object.assign({}, s, { current: !!currentUrl && s.url === currentUrl })),
                recommended: list.sources.length ? list.sources[0].url : null
            });
        } catch (err) {
            res.status(502).json({ error: 'Zdroje se nepodařilo načíst' });
        }
    }
    r.get('/:id/poll/:item/sources', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'control')) return;
        const item = rm.poll.items.find(it => it.id === req.params.item);
        if (!item) return res.status(404).json({ error: 'Návrh nenalezen' });
        sendSources(res, rm, { tmdbId: item.tmdbId, mediaType: 'movie', episode: null }, null);
    });
    function currentWhat(rm) {
        const p = rm.player;
        if (!p || !Number(p.tmdbId)) return null;
        const tv = p.mediaType === 'tv';
        if (tv && !(p.episode && p.episode.season != null && p.episode.number)) return null;
        return { tmdbId: Number(p.tmdbId), mediaType: tv ? 'tv' : 'movie', episode: tv ? { season: Number(p.episode.season), number: Number(p.episode.number) } : null };
    }
    r.get('/:id/sources', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'control')) return;
        const what = currentWhat(rm);
        if (!what) return res.status(400).json({ error: 'U tohoto videa jiný zdroj vybrat nejde' });
        sendSources(res, rm, what, rm.player.source.pageUrl || null);
    });

    // Switch the playing film to another upload ({ url }), same position for everyone.
    r.post('/:id/source', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'control')) return;
        const what = currentWhat(rm);
        const url = pickedUrl(req.body);
        if (!what) return res.status(400).json({ error: 'U tohoto videa jiný zdroj vybrat nejde' });
        if (!url) return res.status(400).json({ error: 'Vyberte zdroj' });
        if (rm.switching) return res.status(409).json({ error: 'Zdroj se právě přepíná' });
        rm.switching = true;
        const version = rm.videoVersion;
        broadcast(rm, { type: 'switching', by: m.name });
        res.status(202).json({ ok: true });
        opts.findPlayer(what, rm.prefs, url).then(player => {
            if (!rooms.has(rm.id)) return;
            if (rm.videoVersion !== version) return;           // something else started meanwhile
            const bad = opts.checkPlayer(player);
            if (bad) throw new Error(bad);
            setVideo(rm, player, positionAt(rm.state, now()), 'switch', rm.state.playing);
        }).catch(err => {
            if (rooms.has(rm.id)) broadcast(rm, { type: 'switching', error: err.message || 'Zdroj se nepodařilo přepnout' });
        }).finally(() => { rm.switching = false; });
    });

    // Host: play something else ({ player, position }) — next episode etc.
    r.post('/:id/video', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (m.role !== 'host') return res.status(403).json({ error: 'Video mění jen hostitel' });
        const b = req.body || {};
        const bad = opts.checkPlayer(b.player);
        if (bad) return res.status(400).json({ error: bad });
        setVideo(rm, b.player, Number(b.position));
        res.json({ ok: true });
    });

    // Host: stop the film and go back to choosing one.
    r.post('/:id/lobby', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (m.role !== 'host') return res.status(403).json({ error: 'Jen hostitel' });
        if (rm.player) setVideo(rm, null);
        res.json({ ok: true });
    });

    // ── Choosing a film together ──

    // Film search for members (empty q → this week's trending films).
    r.get('/:id/search', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'suggest')) return;
        if (!searchLimit(m.id)) return res.status(429).json({ error: 'Pomaleji' });
        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        try {
            res.json({ results: q ? await opts.tmdb.search(q) : await opts.tmdb.trending(), trending: !q });
        } catch (err) {
            res.status(502).json({ error: 'Hledání filmů teď nefunguje' });
        }
    });

    // Propose a film: { tmdbId }. Title, poster etc. come from TMDB, not from the request.
    r.post('/:id/poll', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'suggest')) return;
        if (!pollLimit(m.id)) return res.status(429).json({ error: 'Pomaleji' });
        const tmdbId = Number((req.body || {}).tmdbId);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId >= 1e9) return res.status(400).json({ error: 'Neplatný film' });
        const id = 'm' + tmdbId;
        if (rm.poll.items.some(it => it.id === id)) return res.status(409).json({ error: 'Tento film už je v hlasování' });
        if (rm.poll.items.length >= MAX_POLL) return res.status(400).json({ error: 'V hlasování je už ' + MAX_POLL + ' filmů' });
        let info;
        try { info = await opts.tmdb.movie(tmdbId); } catch (err) { return res.status(404).json({ error: 'Film se nenašel' }); }
        if (!rooms.has(rm.id) || rm.poll.items.some(it => it.id === id)) return res.status(409).json({ error: 'Tento film už je v hlasování' });
        const item = Object.assign(info, { id, by: { id: m.id, name: m.name }, votes: new Set([m.id]), at: now() });
        // Proposing counts as your vote (moved from wherever it was).
        rm.poll.items.forEach(it => it.votes.delete(m.id));
        rm.poll.items.push(item);
        rm.poll.error = null;
        systemMessage(rm, m.name + ' navrhuje: ' + item.title + (item.year ? ' (' + item.year + ')' : ''));
        broadcastPoll(rm);
        res.status(201).json({ ok: true, id });
    });

    // Vote for a film — one vote each; voting again for the same film takes it back.
    r.post('/:id/poll/:item/vote', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (!pollLimit(m.id)) return res.status(429).json({ error: 'Pomaleji' });
        const item = rm.poll.items.find(it => it.id === req.params.item);
        if (!item) return res.status(404).json({ error: 'Návrh nenalezen' });
        const had = item.votes.has(m.id);
        rm.poll.items.forEach(it => it.votes.delete(m.id));
        if (!had) item.votes.add(m.id);
        broadcastPoll(rm);
        res.json({ ok: true, voted: !had });
    });

    // Remove a proposal: the host, or whoever proposed it.
    r.delete('/:id/poll/:item', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        const item = rm.poll.items.find(it => it.id === req.params.item);
        if (!item) return res.status(404).json({ error: 'Návrh nenalezen' });
        if (m.role !== 'host' && item.by.id !== m.id) return res.status(403).json({ error: 'Návrh může odebrat jen hostitel nebo ten, kdo ho přidal' });
        rm.poll.items = rm.poll.items.filter(it => it !== item);
        broadcastPoll(rm);
        res.json({ ok: true });
    });

    // Start a proposed film for everyone (needs "control"). Finding a working upload
    // takes a while, so this answers right away and the room hears how it went.
    r.post('/:id/poll/:item/play', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m || !need(res, rm, m, 'control')) return;
        const item = rm.poll.items.find(it => it.id === req.params.item);
        if (!item) return res.status(404).json({ error: 'Návrh nenalezen' });
        if (rm.poll.finding) return res.status(409).json({ error: 'Už se hledá „' + rm.poll.finding + '“' });
        rm.poll.finding = item.title;
        rm.poll.error = null;
        broadcastPoll(rm);
        res.status(202).json({ ok: true });
        opts.findPlayer({ tmdbId: item.tmdbId, mediaType: 'movie', episode: null }, rm.prefs, pickedUrl(req.body)).then(player => {
            if (!rooms.has(rm.id)) return;
            const bad = opts.checkPlayer(player);
            if (bad) throw new Error(bad);
            // The film leaves the list; everyone gets their vote back for next time.
            rm.poll.items = rm.poll.items.filter(it => it.id !== item.id);
            rm.poll.items.forEach(it => it.votes.clear());
            rm.poll.finding = null;
            setVideo(rm, player, 0, item.votes.size ? ' (' + item.votes.size + ' ' + (item.votes.size === 1 ? 'hlas' : item.votes.size < 5 ? 'hlasy' : 'hlasů') + ')' : '');
            broadcastPoll(rm);
        }).catch(err => {
            if (!rooms.has(rm.id)) return;
            rm.poll.finding = null;
            rm.poll.error = err.message || 'Film se nepodařilo pustit';
            broadcastPoll(rm);
        });
    });

    // The video links expired / stopped working → fetch fresh ones (at most every 30 s).
    r.post('/:id/refresh', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        const pageUrl = rm.player && rm.player.source.pageUrl;
        if (!pageUrl) return res.status(400).json({ error: 'Video nejde obnovit' });
        try {
            if (!rm.refreshing && now() - rm.refreshedAt > 30000) {
                const version = rm.videoVersion;
                rm.refreshing = opts.resolveVideo(pageUrl).then(fresh => {
                    if (rm.videoVersion !== version) return;          // the host changed the video meanwhile
                    rm.player = Object.assign({}, rm.player, { source: fresh });
                    rm.videoVersion++;
                    const t = now();
                    broadcast(rm, { type: 'video', video: publicVideo(rm), videoVersion: rm.videoVersion, state: Object.assign({}, rm.state, { position: positionAt(rm.state, t), updatedAt: t }), serverTime: t, refreshed: true });
                }).finally(() => { rm.refreshedAt = now(); rm.refreshing = null; });
            }
            if (rm.refreshing) await rm.refreshing;
            res.json({ ok: true, videoVersion: rm.videoVersion });
        } catch (err) {
            res.status(502).json({ error: 'Nepodařilo se obnovit odkaz na video' });
        }
    });

    // Host: end the room for everyone.
    r.delete('/:id', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        if (m.role !== 'host') return res.status(403).json({ error: 'Místnost zavírá jen hostitel' });
        closeRoom(rm, 'Hostitel místnost ukončil');
        res.json({ ok: true });
    });

    // The room's own video and subtitles only — never arbitrary URLs.
    r.get('/:id/stream/:q', (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        if (!member(req, res, rm)) return;
        const q = rm.player && rm.player.source.qualities[Number(req.params.q)];
        if (!q) return res.status(404).json({ error: 'Kvalita nenalezena' });
        opts.handleStream(req, res, q.src).catch(err => {
            if (!res.headersSent) res.status(502).json({ error: err.message });
        });
    });
    r.get('/:id/subtitle/:n', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        if (!member(req, res, rm)) return;
        const sub = rm.player && (rm.player.source.subtitles || [])[Number(req.params.n)];
        if (!sub) return res.status(404).json({ error: 'Titulky nenalezeny' });
        try {
            const vtt = await opts.loadSubtitle(sub.src);
            res.set('Content-Type', 'text/vtt; charset=utf-8');
            res.send(vtt);
        } catch (err) {
            res.status(502).json({ error: 'Titulky se nepodařilo načíst' });
        }
    });

    return r;
}

module.exports = { router, EMOJI, ROLES, PERMS, DEFAULT_PERMS, _rooms: rooms };
