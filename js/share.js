// カードを画像（PNG）にしてLINEなどへ共有する
import { formatDate, formatLevel, tripCost, yen, has, TACKLE_FIELDS } from './model.js';

const W = 1080, PAD = 56;
const C = { bg: '#f4f7f5', card: '#ffffff', main: '#0f5f57', sub: '#5b6b66', text: '#1d2a27', accent: '#e3b400', line: '#dfe7e4' };
const FONT = '"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans",sans-serif';

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function loadImage(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

// 描画を2回行う：1回目で高さを測り、2回目で実際に描く
function draw(ctx, t, photo, measureOnly) {
  let y = 0;
  const text = (s, x, size, color = C.text, weight = 400, align = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align;
    if (!measureOnly) ctx.fillText(s, x, y);
  };
  const section = (title) => {
    y += 34;
    if (!measureOnly) { ctx.fillStyle = C.line; ctx.fillRect(PAD, y, W - PAD * 2, 2); }
    y += 52; text(title, PAD, 30, C.main, 700); y += 14;
  };
  const row = (label, value) => {
    if (!value) return;
    ctx.font = `400 32px ${FONT}`;
    const lines = wrap(ctx, value, W - PAD * 2 - 230);
    y += 46; text(label, PAD, 30, C.sub);
    lines.forEach((l, i) => { if (i) y += 44; text(l, PAD + 230, 32); });
  };

  // ヘッダー帯
  if (!measureOnly) { ctx.fillStyle = C.main; ctx.fillRect(0, 0, W, 250); }
  y = 86; text(formatDate(t.date), PAD, 44, '#fff', 700);
  text('鮎日記', W - PAD, 34, '#cfe9e3', 700, 'right');
  y += 74; text(t.river || '河川未入力', PAD, 58, '#fff', 800);
  ctx.font = `400 34px ${FONT}`;
  const pt = t.point ? wrap(ctx, t.point, W - PAD * 2)[0] : '';
  y += 56; text(pt, PAD, 34, '#e3f3ef');
  y = 250;

  // 釣果
  y += 110;
  text(has(t.count) ? `${t.count}` : '-', PAD, 110, C.main, 800);
  ctx.font = `800 110px ${FONT}`;
  const cw = ctx.measureText(has(t.count) ? `${t.count}` : '-').width;
  text('匹', PAD + cw + 10, 44, C.main, 700);
  text(has(t.maxSize) ? `最大 ${t.maxSize}cm` : '', W - PAD, 48, C.text, 700, 'right');
  y += 54;
  const sub = [has(t.bare) ? `バラシ ${t.bare}` : '', t.sizeFeel].filter(Boolean).join('　');
  text(sub, W - PAD, 32, C.sub, 400, 'right');
  if (!measureOnly) { ctx.fillStyle = C.accent; ctx.fillRect(PAD, y + 10, 120, 8); }
  y += 10;
  row('時合', (t.jiai || []).join('・'));
  row('釣れた場所', (t.spots || []).join('・'));
  row('時間', [t.startTime, t.endTime].some(Boolean) ? `${t.startTime || '?'}〜${t.endTime || '?'}` : '');

  section('状況');
  row('天気', [t.weather, has(t.airTemp) ? `気温${t.airTemp}℃` : '', has(t.waterTemp) ? `水温${t.waterTemp}℃` : ''].filter(Boolean).join('　'));
  row('水位', formatLevel(t));
  row('濁り・垢', [t.clarity, t.aka ? `垢：${t.aka}` : ''].filter(Boolean).join('　'));

  const tk = TACKLE_FIELDS.filter(([k]) => t.tackle?.[k]);
  if (tk.length) { section('仕掛け'); tk.forEach(([k, label]) => row(label, t.tackle[k])); }

  const cost = tripCost(t);
  if (cost || t.otori?.shop) {
    section('オトリ・費用');
    row('オトリ', [t.otori?.shop, has(t.otori?.count) ? `${t.otori.count}匹` : ''].filter(Boolean).join('　'));
    row('費用合計', cost ? yen(cost) : '');
  }

  if (t.memo) {
    section('メモ');
    ctx.font = `400 32px ${FONT}`;
    for (const l of wrap(ctx, t.memo, W - PAD * 2)) { y += 46; text(l, PAD, 32); }
  }

  if (photo) {
    y += 40;
    const pw = W - PAD * 2, ph = Math.round(pw * Math.min(photo.height / photo.width, 1.2));
    if (!measureOnly) {
      const scale = Math.max(pw / photo.width, ph / photo.height);
      const sw = pw / scale, sh = ph / scale;
      ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, PAD, y, pw, ph);
    }
    y += ph;
  }
  return y + PAD;
}

export async function renderCardImage(t) {
  const photo = t.photos?.[0] ? await loadImage(t.photos[0].data) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  const h = draw(ctx, t, photo, true);
  canvas.height = h;
  ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, h);
  draw(ctx, t, photo, false);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

export function shareText(t) {
  const L = [`【鮎日記】${formatDate(t.date)}`, `${t.river}${t.point ? ' ' + t.point : ''}`];
  L.push(`釣果 ${has(t.count) ? t.count : '-'}匹${has(t.maxSize) ? ` / 最大${t.maxSize}cm` : ''}${has(t.bare) ? ` / バラシ${t.bare}` : ''}`);
  const lv = formatLevel(t);
  if (lv) L.push(`水位 ${lv}`);
  return L.join('\n');
}

export async function shareTrip(t) {
  const blob = await renderCardImage(t);
  const file = new File([blob], `鮎日記_${t.date}_${t.river || ''}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText(t) });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, file.name);
  return 'downloaded';
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
