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

test("the main monitor holds as many columns as fit, centered as a group", () => {
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
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w0"), rect(210, 0, 1500, 1080));
  assert.deepEqual(out.get("w1"), rect(1920, 0, 1000, 900));
  assert.deepEqual(out.get("w2"), rect(2920, 0, 500, 900));
});

test("a column that cannot avoid a seam takes the smaller monitor's height", () => {
  const ws = build(3000);
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w0"), rect(-540, 0, 3000, 900));
});

test("blanks work leftward from the main monitor's run too", () => {
  const ws = build(800, 800, 800);
  ws.ribbons[0].anchor = 2;
  const out = layout(ws, rows([rect(1440, 0, 1920, 1080), rect(0, 0, 1440, 1080)]));
  assert.deepEqual([0, 1, 2].map(i => out.get(`w${i}`)!.x), [640, 1600, 2400]);
});

test("an off-screen column uses the nearest monitor", () => {
  const ws = build(1000, 1000, 1000, 1000);
  const out = layout(ws, rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]));
  assert.deepEqual(out.get("w3"), rect(3920, 0, 1000, 900));
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

test("focusing a fully visible column moves nothing", () => {
  const ws = build(600, 600, 600);
  const rs = rows([rect(0, 0, 1920, 1080)]);
  m.setFocus(ws, "w0");
  scroll(ws, rs);
  const before = layout(ws, rs);
  m.setFocus(ws, "w1");
  scroll(ws, rs);
  assert.deepEqual(layout(ws, rs), before);
  assert.equal(ws.ribbons[0].anchor, 0);
});

test("focusing a column that is cut off steps the anchor toward it until it shows", () => {
  const ws = build(600, 600, 600, 600);
  const rs = rows([rect(0, 0, 1920, 1080)]);
  m.setFocus(ws, "w3");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].anchor, 2);
  m.setFocus(ws, "w0");
  scroll(ws, rs);
  assert.equal(ws.ribbons[0].anchor, 1);
});

test("removing columns keeps the anchor on an existing column", () => {
  const ws = build(600, 600, 600);
  ws.ribbons[0].anchor = 2;
  m.remove(ws, "w2");
  m.remove(ws, "w1");
  assert.equal(ws.ribbons[0].anchor, 0);
});

test("a ribbon that fits on the main monitor is centered there as a whole", () => {
  const ws = build(800, 400);
  const out = layout(ws, rows([rect(1920, 0, 2560, 1440), rect(0, 0, 1920, 1080)]));
  assert.deepEqual(out.get("w0"), rect(2600, 0, 800, 1440));
  assert.deepEqual(out.get("w1"), rect(3400, 0, 400, 1440));
});

test("a column wider than the row becomes the anchor and stays centered", () => {
  const ws = build(500, 3000);
  scroll(ws, rows([rect(0, 0, 1920, 1080)]));
  assert.equal(ws.ribbons[0].anchor, 1);
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

test("scrolling always shows the focused column despite blanks", () => {
  const ws = build(1500, 1000, 1000, 600);
  const rs = rows([rect(0, 0, 1920, 1080), rect(1920, 0, 1440, 900)]);
  scroll(ws, rs);
  const r = layout(ws, rs).get("w3")!;
  assert.ok(r.x >= 0 && r.x + r.width <= 3360, `w3 at ${r.x}`);
});

test("with the main monitor on the right, hovering any window moves nothing", () => {
  // A ribbon of three that nearly fits the main monitor, above one of five
  // where three fit. Every window should end up fully on one monitor, so
  // focus follows mouse never makes the view move.
  const rs = rows([rect(1920, 0, 2898, 1800), rect(0, 0, 1920, 1080)]);
  const ws = m.workspace<string>();
  const open = (w: string, width: number) => { m.add(ws, w, width); m.setFocus(ws, w); scroll(ws, rs); };
  ["a0", "a1", "a2"].forEach(w => open(w, 1000));
  open("b0", 900);
  m.move(ws, "b0", "down");
  m.setFocus(ws, "b0");
  scroll(ws, rs);
  ["b1", "b2", "b3", "b4"].forEach(w => open(w, 900));
  const seams = (g: Rect) => g.x < 1920 && g.x + g.width > 1920;
  for (const w of ["a0", "a1", "a2", "b0", "b1", "b2", "b3", "b4"]) {
    const before = layout(ws, rs), g = before.get(w)!;
    assert.ok(g.x >= 0 && g.x + g.width <= 4818 && !seams(g), `${w} at ${g.x}..${g.x + g.width}`);
    m.setFocus(ws, w);
    scroll(ws, rs);
    assert.deepEqual(layout(ws, rs), before, `hovering ${w} moved windows`);
  }
  assert.deepEqual(["a0", "a1", "a2"].map(w => layout(ws, rs).get(w)!.x), [920, 2369, 3369]);
});
