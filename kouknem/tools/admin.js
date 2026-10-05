#!/usr/bin/env node
// Kouknem notice-and-action admin. A person decides; this only records it.
// The running server picks up blocklist changes within ~5 s and stops rooms
// that are playing a newly blocked URL.
//
//   node tools/admin.js notices [--all]                 open notices (or all)
//   node tools/admin.js show <notice-id>                one notice in full
//   node tools/admin.js action <notice-id> [note]       block every URL in the notice, mark it "actioned"
//   node tools/admin.js status <notice-id> <status> [note]
//                                                       received | needs-info | actioned | rejected
//   node tools/admin.js block <url> [--notice <id>] [--note <text>]
//   node tools/admin.js unblock <url>
//   node tools/admin.js blocked                         the blocklist

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { createNotices } = require('../lib/notices');

const DATA_DIR = process.env.KOUKNEM_DATA_DIR || path.join(__dirname, '..', 'data');
const store = createNotices(DATA_DIR);
const STATUSES = ['received', 'needs-info', 'actioned', 'rejected'];

const [cmd, ...args] = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const find = id => {
    const n = store.list().find(x => x.id === id);
    if (!n) { console.error('Neznámé oznámení: ' + id); process.exit(1); }
    return n;
};

switch (cmd) {
    case 'notices': {
        const all = args.includes('--all');
        const list = store.list().filter(n => all || n.status === 'received' || n.status === 'needs-info');
        if (!list.length) { console.log(all ? 'Žádná oznámení.' : 'Žádná otevřená oznámení.'); break; }
        for (const n of list) console.log(`${n.id}  ${n.status.padEnd(10)}  ${n.receivedAt.slice(0, 16).replace('T', ' ')}  ${n.name} <${n.email}>  ${n.urls.length} URL  — ${n.work.split('\n')[0].slice(0, 60)}`);
        break;
    }
    case 'show':
        console.log(JSON.stringify(find(args[0]), null, 2));
        break;
    case 'action': {
        const n = find(args[0]);
        if (!n.urls.length) { console.error('V oznámení není žádná URL — zablokujte ručně příkazem "block".'); process.exit(1); }
        n.urls.forEach(u => console.log('blokováno: ' + store.block(u, { noticeId: n.id, note: args[1] || '' })));
        store.setStatus(n.id, 'actioned', args[1] || '');
        console.log(`${n.id} → actioned`);
        break;
    }
    case 'status': {
        const [id, status, ...note] = args;
        find(id);
        if (!STATUSES.includes(status)) { console.error('Stav musí být jeden z: ' + STATUSES.join(', ')); process.exit(1); }
        store.setStatus(id, status, note.join(' '));
        console.log(`${id} → ${status}`);
        break;
    }
    case 'block': {
        const noticeId = flag('notice');
        const note = flag('note');
        if (!args[0]) { console.error('Chybí URL'); process.exit(1); }
        console.log('blokováno: ' + store.block(args[0], { noticeId: noticeId || null, note: note || '' }));
        break;
    }
    case 'unblock':
        console.log(store.unblock(args[0] || '') ? 'odblokováno' : 'tato URL na seznamu není');
        break;
    case 'blocked': {
        const list = store.blockedList();
        if (!list.length) console.log('Seznam blokovaných URL je prázdný.');
        list.forEach(b => console.log(`${b.at.slice(0, 10)}  ${b.noticeId || '-'}  ${b.url}${b.note ? '  (' + b.note + ')' : ''}`));
        break;
    }
    default:
        console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
        process.exit(cmd ? 1 : 0);
}
