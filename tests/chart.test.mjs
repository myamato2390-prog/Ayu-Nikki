import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, textWidth, placeLabels, levelScatterSvg } from '../js/chart.js';

test('niceStep', () => {
  assert.equal(niceStep(30, 5), 10);
  assert.equal(niceStep(18, 5), 5);
  assert.equal(niceStep(4, 5), 1);
});

test('labels never overlap each other', () => {
  const plot = { x0: 40, x1: 350, y0: 20, y1: 280 };
  const items = Array.from({ length: 25 }, (_, i) => ({ px: 60 + (i % 5) * 50, py: 40 + Math.floor(i / 5) * 18, label: `7/${i + 1} 24.5cm` }));
  const pos = placeLabels(items, plot);
  const boxes = pos.filter(Boolean);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), 'overlap');
    }
    assert.ok(boxes[i].x >= plot.x0 && boxes[i].x + boxes[i].w <= plot.x1);
  }
  assert.ok(textWidth('7/12', 10) < textWidth('七月', 10) * 2);
});

test('water level ticks stay readable when levels are close together', () => {
  const { svg } = levelScatterSvg([
    { id: 'a', count: 20, level: -12, label: '7/1' },
    { id: 'b', count: 8, level: -10, label: '7/3' },
  ]);
  // 横軸（水位）の目盛りの数字を数える：0.5cm 刻みにならず、5本前後
  const ticks = [...svg.matchAll(/text-anchor="middle">([^<]+)</g)].map((m) => m[1]);
  assert.ok(ticks.length <= 8, ticks.join(','));
  assert.ok(ticks.every((t) => !t.includes('.')), ticks.join(','));
});

test('svg output', () => {
  const { svg, hidden } = levelScatterSvg([
    { id: 'a', count: 18, level: -15, label: '7/12 24.5cm' },
    { id: 'b', count: 3, level: 25, label: '8/20 21cm', past: true },
  ]);
  assert.match(svg, /<svg/);
  assert.match(svg, /data-pt="a"/);
  assert.match(svg, /class="zero"/);
  assert.match(svg, /7\/12 24\.5cm/);
  assert.equal(hidden, 0);
});
