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
