// バックアップの読み込み（DOMに依存しない）
// 読み込みは「足すだけ」。今ある記録は消さず、同じ記録は updatedAt が新しい方を残す
import { normalizeTrip } from './model.js';

export const APP_ID = 'ayu-nikki';

// 読み込めるファイルか確かめる。だめなときは、やさしい言葉の理由を返す
export function checkBackup(data) {
  if (!data || typeof data !== 'object') return { ok: false, message: 'バックアップファイルを読み込めませんでした' };
  if (data.type === 'cards') return { ok: false, message: 'これは仲間のカードのファイルです。バックアップではないので、ここからは読み込めません' };
  if (data.app === 'aji-nikki') return { ok: false, message: 'これはお豆日記のバックアップです。鮎日記には読み込めません' };
  if (data.app !== APP_ID || !Array.isArray(data.trips)) return { ok: false, message: '鮎日記のバックアップファイルではないようです' };
  return { ok: true };
}

// 何を足すかを決める。current = { trips, presets, rivers }
export function planImport(data, current) {
  const mine = new Map(current.trips.map((t) => [t.id, t]));
  const trips = data.trips
    .filter((t) => t && t.id && (!t.kind || t.kind === 'ayu'))
    .map(normalizeTrip)
    .filter((t) => !mine.has(t.id) || (t.updatedAt || '') > (mine.get(t.id).updatedAt || ''));
  const added = trips.filter((t) => !mine.has(t.id)).length;

  const presetIds = new Set(current.presets.map((p) => p.id));
  const presets = Array.isArray(data.presets) ? data.presets.filter((p) => p && p.id && !presetIds.has(p.id)) : [];

  const riverNames = new Set(current.rivers.map((r) => r.name));
  const rivers = Array.isArray(data.rivers) ? data.rivers.filter((r) => r && r.name && !riverNames.has(r.name)) : [];

  return { trips, added, updated: trips.length - added, presets, rivers, total: data.trips.length };
}
