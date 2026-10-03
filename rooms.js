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
const PERMS = ['control', 'chat', 'react', 'kick'];
const DEFAULT_PERMS = {
    moderator: { control: true, chat: true, react: true, kick: true },
    viewer: { control: false, chat: true, react: true, kick: false }
};
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
function publicVideo(room) {
    const p = room.player;
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
        chat: room.chat.slice(-50)
    };
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
        // { player, name, position, playing } → { id, link, member }
        r.post('/', (req, res) => {
            const b = req.body || {};
            const bad = opts.checkPlayer(b.player);
            if (bad) return res.status(400).json({ error: bad });
            if (rooms.size >= MAX_ROOMS) return res.status(503).json({ error: 'Je otevřeno příliš mnoho místností' });
            const id = token(16);
            const t = now();
            const position = Number(b.position);
            const rm = {
                id, createdAt: t, lastActive: t,
                player: b.player,
                videoVersion: 1,
                state: { playing: b.playing !== false, position: Number.isFinite(position) && position > 0 ? position : 0, updatedAt: t },
                settings: { locked: false, defaultRole: 'viewer', perms: JSON.parse(JSON.stringify(DEFAULT_PERMS)) },
                members: new Map(), chat: [], hostId: null, refreshedAt: 0, refreshing: null
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
        const v = publicVideo(rm);
        const links = opts.linkFor(rm.linkHost, rm.id);
        res.json({ title: v.title, posterPath: v.posterPath, episodeLabel: v.episodeLabel, host: host ? host.name : null, locked: rm.settings.locked, count: rm.members.size, full: rm.members.size >= MAX_MEMBERS, link: links.link, public: links.public });
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
        const t = now();
        const pos = Number(b.position);
        rm.player = b.player;
        rm.videoVersion++;
        rm.state = { playing: true, position: Number.isFinite(pos) && pos > 0 ? pos : 0, updatedAt: t };
        broadcast(rm, { type: 'video', video: publicVideo(rm), videoVersion: rm.videoVersion, state: rm.state, serverTime: t });
        systemMessage(rm, 'Hraje: ' + publicVideo(rm).title);
        res.json({ ok: true });
    });

    // The video links expired / stopped working → fetch fresh ones (at most every 30 s).
    r.post('/:id/refresh', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        const m = member(req, res, rm);
        if (!m) return;
        const pageUrl = rm.player.source.pageUrl;
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
        const q = rm.player.source.qualities[Number(req.params.q)];
        if (!q) return res.status(404).json({ error: 'Kvalita nenalezena' });
        opts.handleStream(req, res, q.src).catch(err => {
            if (!res.headersSent) res.status(502).json({ error: err.message });
        });
    });
    r.get('/:id/subtitle/:n', async (req, res) => {
        const rm = room(req, res);
        if (!rm) return;
        if (!member(req, res, rm)) return;
        const sub = (rm.player.source.subtitles || [])[Number(req.params.n)];
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
