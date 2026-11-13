import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip, normalizeTrip } from '../js/model.js';
import { checkBackup, planImport } from '../js/backup.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date || '2026-07-01'), ...o });

test('checkBackup refuses other files kindly', () => {
  assert.equal(checkBackup({ app: 'ayu-nikki', trips: [] }).ok, true);
  assert.match(checkBackup({ app: 'aji-nikki', trips: [] }).message, /お豆日記のバックアップ/);
  assert.match(checkBackup({ type: 'cards', cards: [] }).message, /仲間のカード/);
  assert.match(checkBackup({ foo: 1 }).message, /鮎日記のバックアップファイルではない/);
  assert.match(checkBackup({ app: 'ayu-nikki' }).message, /鮎日記のバックアップファイルではない/);
  assert.equal(checkBackup(null).ok, false);
});

test('planImport only adds, keeps the newer record', () => {
  const current = {
    trips: [
      mk({ id: 'a', title: '手元で直した', updatedAt: '2026-08-10T00:00:00Z' }),
      mk({ id: 'b', title: '手元の古い', updatedAt: '2026-07-01T00:00:00Z' }),
      mk({ id: 'c', title: '手元だけ', updatedAt: '2026-07-01T00:00:00Z' }),
    ],
    presets: [{ id: 'p1', name: '定番' }],
    rivers: [{ name: '面河川' }, { name: '仁淀川' }],
  };
  const data = {
    app: 'ayu-nikki',
    trips: [
      { id: 'a', title: '古いバックアップ', updatedAt: '2026-07-20T00:00:00Z' }, // 手元の方が新しい → 読まない
      { id: 'b', title: 'バックアップで直した', updatedAt: '2026-07-15T00:00:00Z' }, // バックアップの方が新しい → 読む
      { id: 'd', title: '新しい記録', updatedAt: '2026-07-02T00:00:00Z' }, // 手元にない → 読む
      { id: 'e', kind: 'aji', title: 'アジ', updatedAt: '2026-07-02T00:00:00Z' }, // 別の釣り物 → 読まない
    ],
    presets: [{ id: 'p1', name: '定番（古い）' }, { id: 'p2', name: '新しいプリセット' }],
    rivers: [{ name: '面河川', station: '別' }, { name: '加茂川' }],
  };
  const plan = planImport(data, current);
  assert.deepEqual(plan.trips.map((t) => t.id).sort(), ['b', 'd']);
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 1);
  assert.equal(plan.total, 4);
  assert.deepEqual(plan.presets.map((p) => p.id), ['p2']);
  assert.deepEqual(plan.rivers.map((r) => r.name), ['加茂川']);
  // 手元だけの記録 c は計画に出てこない（消されない）
  assert.ok(!plan.trips.some((t) => t.id === 'c'));
});

test('planImport with nothing new', () => {
  const t = mk({ id: 'a', updatedAt: '2026-08-10T00:00:00Z' });
  const plan = planImport({ app: 'ayu-nikki', trips: [{ ...t }] }, { trips: [t], presets: [], rivers: [] });
  assert.equal(plan.trips.length, 0);
});
