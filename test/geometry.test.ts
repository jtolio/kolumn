import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/model.ts";
import { hit, layout, rows, scroll, type Rect } from "../src/geometry.ts";

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function build(...widths: number[]) {
  const ws = m.workspace<string>();
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

test("a column across a seam takes the smaller monitor's height", () => {
  const ws = build(1500, 1000, 500);
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w0"), rect(0, 0, 1500, 1080));
  assert.deepEqual(out.get("w1"), rect(1500, 0, 1000, 900));
  assert.deepEqual(out.get("w2"), rect(2500, 0, 500, 900));
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
  assert.deepEqual(out.get("w0"), rect(1480, 0, 1500, 1080));
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
  assert.equal(hit(rects, { x: 150, y: 50 }, "b"), undefined);
  assert.equal(hit(rects, { x: 300, y: 50 }, "b"), undefined);
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
