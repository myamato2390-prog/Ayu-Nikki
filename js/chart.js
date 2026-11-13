// 水位×釣果の散布図（SVG文字列を作る。DOMに依存しない）
// 縦軸＝水位(cm)、横軸＝釣果(匹)。点の横に「日付 最大cm」を重ならないように置く

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 目盛りのきりのよい間隔
export function niceStep(range, target = 5) {
  const raw = Math.max(range, 1) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

// 文字幅のおおよその見積もり（英数字は半角、それ以外は全角）
export function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += /[\x20-\x7e]/.test(ch) ? size * 0.58 : size;
  return w;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ラベルを重ならない位置に置く。置けないものは hidden
export function placeLabels(items, plot, size = 11) {
  const placed = [];
  // 点そのものもぶつかり判定に入れる
  const dots = items.map((p) => ({ x: p.px - 6, y: p.py - 6, w: 12, h: 12 }));
  const order = [...items.keys()].sort((a, b) => items[a].py - items[b].py);
  const out = new Array(items.length);
  for (const i of order) {
    const p = items[i];
    const w = textWidth(p.label, size), h = size + 2;
    const right = p.px + 8 + w <= plot.x1;
    let pos = null;
    for (const side of right ? ['r', 'l'] : ['l', 'r']) {
      for (const dy of [0, -h, h, -2 * h, 2 * h]) {
        const x = side === 'r' ? p.px + 8 : p.px - 8 - w;
        const box = { x, y: p.py - h / 2 + dy, w, h };
        if (box.x < plot.x0 || box.x + box.w > plot.x1 || box.y < plot.y0 || box.y + box.h > plot.y1) continue;
        if (placed.some((b) => overlaps(b, box)) || dots.some((d, j) => j !== i && overlaps(d, box))) continue;
        pos = { ...box, side, dy };
        break;
      }
      if (pos) break;
    }
    if (pos) placed.push(pos);
    out[i] = pos;
  }
  return out;
}

/**
 * points: [{ id, count, level, label, past }]
 * opts: { width, height, color, labels }
 */
export function levelScatterSvg(points, { width = 360, height = 320, color = '#0f5f57', labels = true } = {}) {
  // 横軸＝水位(cm)、縦軸＝釣果(匹)
  const m = { l: 34, r: 12, t: 24, b: 34 };
  const plot = { x0: m.l, x1: width - m.r, y0: m.t, y1: height - m.b };

  const counts = points.map((p) => p.count);
  const levels = points.map((p) => p.level);
  const yStep = niceStep(Math.max(...counts, 5), 5);
  const yMax = Math.ceil(Math.max(...counts, 1) / yStep) * yStep;
  // 目盛りの間隔は、軸全体（0cm を含む）の幅で決める。水位は cm の整数なので 1cm より細かくしない
  const lo = Math.min(...levels, 0), hi = Math.max(...levels, 0);
  const xStep = Math.max(1, niceStep(hi - lo, 5));
  let xMin = Math.floor(lo / xStep) * xStep;
  let xMax = Math.ceil(hi / xStep) * xStep;
  if (xMin === Math.min(...levels)) xMin -= xStep;
  if (xMax === Math.max(...levels)) xMax += xStep;

  const sx = (v) => plot.x0 + ((v - xMin) / (xMax - xMin)) * (plot.x1 - plot.x0);
  const sy = (v) => plot.y1 - (v / yMax) * (plot.y1 - plot.y0);
  const fmtLevel = (v) => (v > 0 ? `+${v}` : `${v}`);

  let g = '';
  // 横の目盛り線（釣果）
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = sy(v);
    g += `<line x1="${plot.x0}" x2="${plot.x1}" y1="${y}" y2="${y}" class="grid"/>`;
    g += `<text x="${plot.x0 - 6}" y="${y + 4}" class="tick" text-anchor="end">${v}</text>`;
  }
  // 縦の目盛り線（水位）。±0 は少し濃く
  for (let v = xMin; v <= xMax + 1e-9; v += xStep) {
    const x = sx(v);
    g += `<line x1="${x}" x2="${x}" y1="${plot.y0}" y2="${plot.y1}" class="${v === 0 ? 'zero' : 'grid'}"/>`;
    g += `<text x="${x}" y="${plot.y1 + 16}" class="tick" text-anchor="middle">${fmtLevel(v)}</text>`;
  }
  g += `<text x="${plot.x0 - 28}" y="14" class="axis">釣果（匹）</text>`;
  g += `<text x="${plot.x1}" y="${height - 4}" class="axis" text-anchor="end">水位（cm）</text>`;

  // 過去シーズンを先に描き、今シーズンを上に重ねる
  const items = points.map((p) => ({ ...p, px: sx(p.level), py: sy(p.count) }));
  const drawOrder = [...items.keys()].sort((a, b) => Number(items[b].past) - Number(items[a].past));
  const pos = labels ? placeLabels(items, plot) : [];

  // 上下にずらしたラベルは、点と細い線でつなぐ
  for (const i of drawOrder) {
    const b = pos[i];
    if (!b || !b.dy) continue;
    const p = items[i];
    const lx = b.side === 'r' ? b.x - 2 : b.x + b.w + 2;
    g += `<line x1="${p.px}" y1="${p.py}" x2="${lx}" y2="${b.y + b.h / 2}" class="leader"/>`;
  }
  for (const i of drawOrder) {
    const p = items[i];
    const fill = p.past ? '#a9b5b1' : color;
    g += `<g class="pt" data-pt="${esc(p.id)}" data-x="${p.px.toFixed(1)}" data-y="${p.py.toFixed(1)}">
      <circle cx="${p.px}" cy="${p.py}" r="14" fill="transparent"/>
      <circle cx="${p.px}" cy="${p.py}" r="5" fill="${fill}" stroke="#fff" stroke-width="2"/>
    </g>`;
  }
  for (const i of drawOrder) {
    const b = pos[i];
    if (!b) continue;
    g += `<text x="${b.side === 'r' ? b.x : b.x + b.w}" y="${b.y + b.h - 3}" class="lbl${items[i].past ? ' past' : ''}" text-anchor="${b.side === 'r' ? 'start' : 'end'}">${esc(items[i].label)}</text>`;
  }

  const hidden = labels ? pos.filter((b) => !b).length : 0;
  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="水位と釣果の散布図">${g}</svg>`,
    hidden,
  };
}
