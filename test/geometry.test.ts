import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/model.ts";
import { hit, layout, rows, scroll, type Rect } from "../src/geometry.ts";

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

// One ribbon per row unless a test says otherwise.
function build(...widths: number[]) {
  const ws = m.workspace<string>();
  ws.shown = 1;
  widths.forEach((width, i) => {
    m.add(ws, `w${i}`, width);
    m.setFocus(ws, `w${i}`);
  });
  return ws;
}

test("monitors that share a vertical range form one row", () => {
  const rs = rows([rect(1920, 0, 1440, 900), rect(0, 0, 1920, 1080), rect(0, 1080, 1920, 1080)]);
  assert.equal(rs.length, 2);
  assert.deepEqual([rs[0].left, rs[0].right, rs[0].top, rs[0].bottom], [0, 3360, 0, 1080]);
  assert.deepEqual([rs[1].top, rs[1].bottom], [1080, 2160]);
  assert.deepEqual(rs[0].main, rect(1920, 0, 1440, 900));
  assert.deepEqual(rs[1].main, rect(0, 1080, 1920, 1080));
});

test("columns pack edge to edge and fill the monitor height", () => {
  const ws = build(800, 600);
  m.drop(ws, "w1", "w0", "down");
  m.add(ws, "w2", 500);
  const out = layout(ws, rows([rect(0, 30, 1920, 1050)]));
  assert.deepEqual(out.get("w0"), rect(310, 30, 800, 525));
  assert.deepEqual(out.get("w1"), rect(310, 555, 800, 525));
  assert.deepEqual(out.get("w2"), rect(1110, 30, 500, 1050));
});

test("a column that would cross a seam moves past it, leaving a blank", () => {
  const ws = build(1500, 1000, 500);
  m.setFocus(ws, "w0");
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w0"), rect(0, 0, 1500, 1080));
  assert.deepEqual(out.get("w1"), rect(1920, 0, 1000, 900));
  assert.deepEqual(out.get("w2"), rect(2920, 0, 500, 900));
});

test("a column that cannot avoid a seam takes the smaller monitor's height", () => {
  const ws = build(3000);
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w0"), rect(0, 0, 3000, 900));
});

test("blanks work outward from the main monitor's center, leftward too", () => {
  const ws = build(800, 800, 800);
  const out = layout(ws, rows([rect(1440, 0, 1920, 1080), rect(0, 0, 1440, 1080)]));
  assert.deepEqual([0, 1, 2].map(i => out.get(`w${i}`)!.x), [640, 1760, 2560]);
});

test("an off-screen column uses the nearest monitor", () => {
  const ws = build(1000, 1000, 1000, 1000);
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w3"), rect(3000, 0, 1000, 900));
});

test("ribbons off the rows stack above and below them", () => {
  const ws = build(500, 500, 500);
  m.move(ws, "w1", "down");
  m.move(ws, "w2", "down");
  m.move(ws, "w2", "down");
  ws.top = 1;
  const out = layout(ws, rows([rect(0, 0, 1920, 1080)]));
  assert.equal(out.get("w0")!.y, -1080);
  assert.equal(out.get("w1")!.y, 0);
  assert.equal(out.get("w2")!.y, 1080);
});

test("stacked monitors show consecutive ribbons", () => {
  const ws = build(500, 500);
  m.move(ws, "w1", "down");
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(0, 1080, 2560, 1440)]));
  assert.deepEqual(out.get("w0"), rect(710, 0, 500, 1080));
  assert.deepEqual(out.get("w1"), rect(1030, 1080, 500, 1440));
});

test("scrolling moves just far enough to show the focused column", () => {
  const ws = build(800, 800, 800);
  const rs = rows([rect(0, 0, 1920, 1080)]);
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 480);
  m.setFocus(ws, "w1");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 480);
  m.setFocus(ws, "w0");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 0);
});

test("closing the last column pulls the ribbon back so it ends at the row's edge", () => {
  const ws = build(800, 800, 800, 800);
  const rs = rows([rect(0, 0, 1920, 1080)]);
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 1280);
  m.remove(ws, "w3");
  m.setFocus(ws, "w2");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 480);
  m.remove(ws, "w2");
  m.setFocus(ws, "w1");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].scroll, 0);
});

test("a ribbon narrower than the row is centered on the main monitor", () => {
  const ws = build(800, 400);
  const out = layout(ws, rows([rect(1920, 0, 2560, 1440), rect(0, 0, 1920, 1080)]));
  assert.deepEqual(out.get("w0"), rect(2600, 0, 800, 1440));
  assert.deepEqual(out.get("w1"), rect(3400, 0, 400, 1440));
});

test("a ribbon wider than the main monitor stays inside the row", () => {
  const ws = build(1500, 1500);
  const out = layout(ws, rows([rect(1920, 0, 2560, 1440), rect(0, 0, 1920, 1080)]));
  assert.deepEqual(out.get("w0"), rect(420, 0, 1500, 1080));
  assert.deepEqual(out.get("w1"), rect(2980, 0, 1500, 1440));
});

test("a column wider than the row lines up with the left edge", () => {
  const ws = build(500, 3000);
  scroll(ws, rows([rect(0, 0, 1920, 1080)]));
  assert.equal(ws.ribbons[0].scroll, 500);
});

test("scrolling brings the focused ribbon onto a row", () => {
  const ws = build(500, 500, 500);
  m.move(ws, "w1", "down");
  m.move(ws, "w2", "down");
  m.move(ws, "w2", "down");
  const rs = rows([rect(0, 0, 1920, 1080)]);
  m.setFocus(ws, "w2");
  scroll(ws, rs);
  assert.equal(ws.top, 2);
  m.setFocus(ws, "w1");
  scroll(ws, rs);
  assert.equal(ws.top, 1);
});

test("hit picks the nearest outer quarter, or the middle", () => {
  const rects = new Map([["a", rect(0, 0, 100, 100)], ["b", rect(100, 0, 100, 100)]]);
  assert.deepEqual(hit(rects, { x: 10, y: 50 }, "b"), ["a", "left"]);
  assert.deepEqual(hit(rects, { x: 50, y: 90 }, "b"), ["a", "down"]);
  assert.deepEqual(hit(rects, { x: 50, y: 50 }, "b"), ["a", "middle"]);
});

test("over empty space, hit picks the nearest window level with the pointer", () => {
  const rects = new Map([["a", rect(500, 0, 100, 100)], ["b", rect(600, 0, 100, 100)], ["c", rect(500, 100, 200, 100)]]);
  assert.deepEqual(hit(rects, { x: 900, y: 50 }, "c"), ["b", "right"]);
  assert.deepEqual(hit(rects, { x: 10, y: 50 }, "c"), ["a", "left"]);
  assert.deepEqual(hit(rects, { x: 10, y: 150 }, "a"), ["c", "left"]);
  assert.deepEqual(hit(rects, { x: 900, y: 50 }, "b"), ["a", "right"]);
  assert.equal(hit(rects, { x: 900, y: 500 }, "a"), undefined);
});

test("over the dragged window's own cell, hit finds nothing", () => {
  const rects = new Map([["a", rect(0, 0, 100, 100)], ["b", rect(100, 0, 100, 100)]]);
  assert.equal(hit(rects, { x: 150, y: 50 }, "b"), undefined);
});

// Three ribbons of one 1920-wide column each.
function ribbons() {
  const ws = build(1920, 1920, 1920);
  m.move(ws, "w1", "down");
  m.move(ws, "w2", "down");
  m.move(ws, "w2", "down");
  return ws;
}

test("a row shows `shown` ribbons, split by their weights", () => {
  const ws = ribbons();
  ws.shown = 2;
  ws.ribbons[1].weight = 3;
  const out = layout(ws, rows([rect(0, 0, 1920, 1080)]));
  assert.deepEqual(out.get("w0"), rect(0, 0, 1920, 270));
  assert.deepEqual(out.get("w1"), rect(0, 270, 1920, 810));
  assert.equal(out.get("w2")!.y, 1080);
});

test("a ribbon alone in its row fills it, even when more could be shown", () => {
  const ws = build(1920);
  ws.shown = 3;
  assert.deepEqual(layout(ws, rows([rect(0, 0, 1920, 1080)])).get("w0"), rect(0, 0, 1920, 1080));
});

test("stacked monitors each show `shown` ribbons", () => {
  const ws = ribbons();
  ws.shown = 2;
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(0, 1080, 1920, 1080)]));
  assert.deepEqual(out.get("w1"), rect(0, 540, 1920, 540));
  assert.deepEqual(out.get("w2"), rect(0, 1080, 1920, 1080));
});

test("scrolling keeps the focused ribbon shown without leaving empty slots", () => {
  const ws = ribbons();
  const rs = rows([rect(0, 0, 1920, 1080)]);
  ws.shown = 2;
  m.setFocus(ws, "w2");
  scroll(ws, rs);
  assert.equal(ws.top, 1);
  m.setFocus(ws, "w0");
  scroll(ws, rs);
  assert.equal(ws.top, 0);
  ws.top = 2;
  m.setFocus(ws, "w2");
  scroll(ws, rs);
  assert.equal(ws.top, 1);
});

test("ribbons sharing a row never overlap across a seam", () => {
  // Ribbon 0 has one column on the taller monitor. Ribbon 1's only column
  // is too wide to avoid the seam and crosses it directly below.
  const ws = build(1900, 3000);
  m.move(ws, "w1", "down");
  ws.shown = 2;
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  const above = out.get("w0")!, below = out.get("w1")!;
  assert.ok(below.x < above.x + above.width, "the columns overlap horizontally");
  assert.equal(above.y + above.height, 540);
  assert.equal(below.y, 540);
  assert.equal(below.y + below.height, 900);
});

test("blanks never push the focused column off screen", () => {
  const ws = build(1500, 1000, 1000, 600);
  const rs = rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]);
  scroll(ws, rs);
  const r = layout(ws, rs).get("w3")!;
  assert.ok(r.x >= 1920 && r.x + r.width <= 3360, `w3 at ${r.x}`);
  assert.ok(layout(ws, rs).get("w2")!.x + 1000 <= 1920, "w2 moved fully onto the left monitor");
});

test("a focused column on a seam moves onto the monitor holding more of it", () => {
  const ws = build(1700, 500);
  ws.ribbons[0].scroll = 0;
  const rs = rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]);
  assert.equal(layout(ws, rs).get("w1")!.x, 1920);
  m.setFocus(ws, "w0");
  assert.equal(layout(ws, rs).get("w0")!.x, 0);
});
