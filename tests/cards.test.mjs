// 仲間とのカードのやりとり（お豆日記の tests/cards.test.mjs を鮎日記用に移したもの）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip, normalizeTrip } from '../js/model.js';
import { makeCardPack, checkCardPack, importCardPack, friendsOf, analysisTrips, ownTrips, isShared } from '../js/cards.js';
import { filterTrips, isEmptyQuery, emptyQuery } from '../js/search.js';
import { summarize } from '../js/stats.js';
import { personalBests, pointStats } from '../js/insights.js';
import { planImport } from '../js/backup.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date), ...o });
const taro = [
  mk({ id: 'a', date: '2026-07-01', river: '面河川', point: '仕七川小学校前', count: 20, maxSize: 26, memo: '秘密の瀬', photos: [{ id: 'p', data: 'data:...' }], updatedAt: '2026-07-02T00:00:00Z' }),
  mk({ id: 'b', date: '2026-07-05', river: '仁淀川', point: '越知', count: 3, updatedAt: '2026-07-05T00:00:00Z' }),
];
const me = [mk({ id: 'm1', date: '2026-07-03', river: '面河川', point: '仕七川小学校前', count: 8, maxSize: 22 })];

test('kind and app id', () => {
  assert.equal(newTrip().kind, 'ayu');
  assert.equal(normalizeTrip({ date: '2025-07-01' }).kind, 'ayu'); // 古い記録にも付く
});

test('make & check a card pack', () => {
  const pack = makeCardPack(taro, ' たろう ', { memo: false });
  assert.equal(pack.app, 'ayu-nikki');
  assert.equal(pack.type, 'cards');
  assert.equal(pack.from, 'たろう');
  assert.equal(pack.trips.length, 2);
  assert.equal(pack.trips[0].memo, '');
  assert.deepEqual(pack.trips[0].photos, []); // 写真は送らない
  assert.equal(taro[0].memo, '秘密の瀬'); // 元の記録は変えない
  assert.equal(makeCardPack(taro, 'たろう').trips[0].memo, '秘密の瀬');
  assert.deepEqual(makeCardPack(taro, 'たろう').trips[0].photos, []);
  assert.equal(checkCardPack(pack), '');
  assert.match(checkCardPack({ app: 'aji-nikki', type: 'cards', from: 'x', trips: [] }), /お豆日記/);
  assert.match(checkCardPack({ app: 'ayu-nikki', trips: [] }), /バックアップ/);
  assert.match(checkCardPack({ ...pack, from: '' }), /名前/);
  assert.match(checkCardPack(null), /読めません/);
});

test('import adds once, updates newer', () => {
  const pack = makeCardPack(taro, 'たろう');
  const r1 = importCardPack(pack, me, '2026-11-11T00:00:00Z');
  assert.equal(r1.add.length, 2);
  assert.ok(r1.add.every((t) => isShared(t) && t.shared.from === 'たろう' && t.id.startsWith('sh-') && t.kind === 'ayu'));
  assert.deepEqual(r1.add.map((t) => t.shared.originId), ['a', 'b']);
  const all = [...me, ...r1.add];
  const r2 = importCardPack(pack, all);
  assert.equal(r2.add.length + r2.update.length, 0);
  assert.equal(r2.same, 2);
  const edited = makeCardPack([{ ...taro[0], count: 25, updatedAt: '2026-07-09T00:00:00Z' }], 'たろう');
  const r3 = importCardPack(edited, all);
  assert.equal(r3.update.length, 1);
  assert.equal(r3.update[0].id, r1.add[0].id);
  assert.equal(r3.update[0].count, 25);
  assert.equal(importCardPack(makeCardPack([taro[0]], 'はなこ'), all).add.length, 1); // 別の人は別のカード
  assert.equal(makeCardPack(all, 'わたし').trips.length, 1); // もらったカードは送り直せない
  // お豆日記の記録（kind: 'aji'）が混ざっていても入れない
  assert.equal(importCardPack({ ...pack, trips: [{ id: 'z', kind: 'aji' }] }, me).add.length, 0);
});

test('analysis can include or exclude friends; bests are mine only', () => {
  const r = importCardPack(makeCardPack(taro, 'たろう'), me);
  const hana = importCardPack(makeCardPack([mk({ id: 'h', date: '2026-07-07', river: '面河川', count: 1 })], 'はなこ'), me).add;
  const all = [...me, ...r.add, ...hana];
  assert.equal(analysisTrips(all, {}).length, 1);
  assert.equal(analysisTrips(all, { useShared: true }).length, 4);
  assert.equal(analysisTrips(all, { useShared: true, friends: { はなこ: { use: false } } }).length, 3);
  assert.deepEqual(friendsOf(all), [{ name: 'たろう', count: 2 }, { name: 'はなこ', count: 1 }]);
  assert.equal(ownTrips(all).length, 1);
  const s = summarize(analysisTrips(all, { useShared: true }));
  assert.equal(s.tripCount, 4);
  assert.equal(s.maxSize, 26);
  assert.equal(personalBests(ownTrips(all), null).maxSize, 22);
  assert.equal(pointStats(analysisTrips(all, { useShared: true }), '面河川', '仕七川小学校前').trips, 2);
});

test('search: own cards by default, friends on request', () => {
  const all = [...me, ...importCardPack(makeCardPack(taro, 'たろう'), me).add];
  assert.equal(filterTrips(all, emptyQuery()).length, 1);
  assert.ok(isEmptyQuery(emptyQuery()));
  assert.ok(!isEmptyQuery({ ...emptyQuery(), who: 'friends' }));
  assert.equal(filterTrips(all, { who: 'friends' }).length, 2);
  assert.equal(filterTrips(all, { who: 'all', text: 'たろう' }).length, 2);
});

test('backup keeps friend cards as they are', () => {
  const friend = importCardPack(makeCardPack(taro, 'たろう'), me).add;
  const plan = planImport({ app: 'ayu-nikki', trips: [...me, ...friend] }, { trips: [], presets: [], rivers: [] });
  assert.equal(plan.trips.filter(isShared).length, 2);
});

test('send as a long link and read it back', async () => {
  const { packToLink, parseCardText } = await import('../js/cards.js');
  const many = Array.from({ length: 20 }, (_, i) => mk({ id: `t${i}`, date: '2026-07-01', river: '面河川', count: i, memo: '午前は瀬肩、昼から荒瀬で連発。' }));
  const pack = makeCardPack(many, 'たろう');
  const msg = await packToLink(pack, 'https://example.github.io/Ayu-Nikki/');
  assert.ok(msg.startsWith('🐟 鮎日記のカード（たろうさん・20枚）'));
  const link = msg.split('\n').pop();
  assert.ok(link.startsWith('https://example.github.io/Ayu-Nikki/?openExternalBrowser=1#c='));
  const back = await parseCardText(new URL(link).hash);
  assert.equal(checkCardPack(back), '');
  assert.equal(back.trips.length, 20);
  assert.equal((await parseCardText(`転送: ${msg}\n既読`)).trips.length, 20);
  assert.equal(await parseCardText('#c=abcdefghijklmnopqrstuvwxyz'), null);
  assert.equal(await parseCardText('こんにちは'), null);
});

test('short link: store the cards, send only an id', async () => {
  const { uploadPack, downloadPack, shortLinkMessage, shareIdIn, newShareId } = await import('../js/cards.js');
  const { SHARE } = await import('../js/config.js');
  const pack = makeCardPack(taro, 'たろう');
  const store = new Map();
  const calls = [];
  const fake = async (url, opt) => {
    calls.push([opt?.method || 'GET', url]);
    const u = new URL(url);
    if (opt?.method === 'POST') { store.set(u.searchParams.get('documentId'), JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    const doc = store.get(u.pathname.split('/').pop());
    return doc ? { ok: true, status: 200, json: async () => doc } : { ok: false, status: 404, json: async () => ({}) };
  };
  const id = await uploadPack(pack, SHARE, fake, Date.UTC(2026, 10, 12));
  assert.match(id, /^[A-Z2-9]{12}$/);
  // お豆日記と同じ保管場所
  assert.ok(calls[0][1].startsWith('https://firestore.googleapis.com/v1/projects/omame-nikki/databases/omame-nikki/documents/cards?documentId='));
  const doc = store.get(id);
  assert.deepEqual(Object.keys(doc.fields).sort(), ['d', 'exp']); // ルールで許す2つの項目だけ
  assert.equal(doc.fields.exp.timestampValue, '2026-12-12T00:00:00.000Z'); // 30日後
  const msg = shortLinkMessage(pack, 'https://example.github.io/Ayu-Nikki/', id);
  const link = msg.split('\n').pop();
  assert.equal(link, `https://example.github.io/Ayu-Nikki/?openExternalBrowser=1#k=${id}`);
  assert.equal(shareIdIn(new URL(link).hash), id);
  assert.equal(shareIdIn(`転送: ${msg}`), id);
  assert.equal(shareIdIn('#/settings'), '');
  const back = await downloadPack(id, SHARE, fake);
  assert.equal(checkCardPack(back), '');
  assert.equal(back.trips.length, 2);
  assert.equal(await downloadPack(newShareId(), SHARE, fake), null);
  await assert.rejects(uploadPack(pack, SHARE, async () => ({ ok: false, status: 403 })));
});
