import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/model.ts";

// Renders a workspace as ribbons of columns of window names, e.g. [[["a"], ["b", "c"]]].
const shape = (ws: m.Workspace<string>) => ws.ribbons.map(r => r.columns.map(c => c.cells.map(cell => cell.win)));
const weights = (ws: m.Workspace<string>, r: number, c: number) => ws.ribbons[r].columns[c].cells.map(cell => cell.weight);

function build(...wins: string[]) {
  const ws = m.workspace<string>();
  for (const w of wins) {
    m.add(ws, w, 100);
    m.setFocus(ws, w);
  }
  return ws;
}

test("new windows open right of the focused column", () => {
  const ws = build("a", "b");
  m.setFocus(ws, "a");
  m.add(ws, "c", 100);
  assert.deepEqual(shape(ws), [[["a"], ["c"], ["b"]]]);
});

test("removing a cell keeps the other weights", () => {
  const ws = build("a", "b", "c");
  m.drop(ws, "b", "a", "down");
  m.drop(ws, "c", "b", "down");
  const cells = ws.ribbons[0].columns[0].cells;
  cells[0].weight = 1; cells[1].weight = 2; cells[2].weight = 3;
  m.remove(ws, "a");
  assert.deepEqual(shape(ws), [[["b", "c"]]]);
  assert.deepEqual(weights(ws, 0, 0), [2, 3]);
});

test("a new cell gets the mean weight", () => {
  const ws = build("a", "b", "c");
  m.drop(ws, "b", "a", "down");
  ws.ribbons[0].columns[0].cells[1].weight = 3;
  m.drop(ws, "c", "b", "up");
  assert.deepEqual(weights(ws, 0, 0), [1, 2, 3]);
});

test("removing the last window of a column or ribbon removes it", () => {
  const ws = build("a", "b");
  m.move(ws, "b", "down");
  assert.deepEqual(shape(ws), [[["a"]], [["b"]]]);
  m.remove(ws, "b");
  assert.deepEqual(shape(ws), [[["a"]]]);
});

const anywhere = () => 0;

test("focus moves between columns and stops at the ends", () => {
  const ws = build("a", "b");
  assert.equal(m.neighbor(ws, "a", "right", anywhere), "b");
  assert.equal(m.neighbor(ws, "b", "right", anywhere), undefined);
  assert.equal(m.neighbor(ws, "a", "left", anywhere), undefined);
});

test("focus up and down falls through to the next ribbon, entering at the near cell", () => {
  const ws = build("a", "b", "c");
  m.drop(ws, "b", "a", "down");
  m.move(ws, "c", "down");
  assert.deepEqual(shape(ws), [[["a", "b"]], [["c"]]]);
  assert.equal(m.neighbor(ws, "a", "down", anywhere), "b");
  assert.equal(m.neighbor(ws, "b", "down", anywhere), "c");
  assert.equal(m.neighbor(ws, "c", "up", anywhere), "b");
  assert.equal(m.neighbor(ws, "c", "down", anywhere), undefined);
});

test("moving between ribbons picks the column with the least distance", () => {
  const ws = build("a", "b", "c", "d");
  m.move(ws, "d", "down");
  m.setFocus(ws, "a");
  // Ribbon 0 has columns a, b, c. Pretend b is nearest, though a was focused last.
  const at = { a: 0, b: 1000, c: 2000 } as Record<string, number>;
  assert.equal(m.neighbor(ws, "d", "up", col => Math.abs(at[col.cells[0].win] - 900)), "b");
});

test("moving sideways out of a shared column makes a new column on that side", () => {
  const ws = build("a", "b");
  m.drop(ws, "b", "a", "down");
  m.move(ws, "b", "left");
  assert.deepEqual(shape(ws), [[["b"], ["a"]]]);
});

test("moving a lone window sideways into one cell goes below it", () => {
  const ws = build("a", "b");
  m.move(ws, "b", "left");
  assert.deepEqual(shape(ws), [[["a", "b"]]]);
});

test("moving a lone window sideways takes the gap nearest the middle, ties going down", () => {
  const join = (...weights: number[]) => {
    const ws = build("x", ...weights.map((_, i) => `c${i}`));
    weights.forEach((w, i) => {
      if (i > 0) m.drop(ws, `c${i}`, `c${i - 1}`, "down");
      ws.ribbons[0].columns[1].cells[i].weight = w;
    });
    m.move(ws, "x", "right");
    return shape(ws)[0][0];
  };
  assert.deepEqual(join(1), ["c0", "x"]);
  assert.deepEqual(join(1, 1), ["c0", "x", "c1"]);
  assert.deepEqual(join(1, 1, 1), ["c0", "c1", "x", "c2"]);
  assert.deepEqual(join(1, 2), ["c0", "x", "c1"]);
  assert.deepEqual(join(2, 1), ["c0", "x", "c1"]);
  assert.deepEqual(join(1, 3), ["c0", "x", "c1"]);
  assert.deepEqual(join(3, 1), ["c0", "x", "c1"]);
});

test("moving a lone window sideways at the end of a ribbon does nothing", () => {
  const ws = build("a");
  m.move(ws, "a", "left");
  assert.deepEqual(shape(ws), [[["a"]]]);
});

test("moving up and down swaps cells, then changes ribbon, creating one if needed", () => {
  const ws = build("a", "b");
  m.drop(ws, "b", "a", "down");
  m.move(ws, "b", "up");
  assert.deepEqual(shape(ws), [[["b", "a"]]]);
  m.move(ws, "b", "up");
  assert.deepEqual(shape(ws), [[["b"]], [["a"]]]);
  m.move(ws, "b", "down");
  assert.deepEqual(shape(ws), [[["a"], ["b"]]]);
});

test("dropping on each side of a window", () => {
  const ws = build("a", "b");
  m.drop(ws, "b", "a", "left");
  assert.deepEqual(shape(ws), [[["b"], ["a"]]]);
  m.drop(ws, "b", "a", "right");
  assert.deepEqual(shape(ws), [[["a"], ["b"]]]);
  m.drop(ws, "b", "a", "up");
  assert.deepEqual(shape(ws), [[["b", "a"]]]);
  m.drop(ws, "b", "a", "down");
  assert.deepEqual(shape(ws), [[["a", "b"]]]);
});

test("dropping on the middle swaps windows and leaves weights in place", () => {
  const ws = build("a", "b", "c");
  m.drop(ws, "b", "a", "down");
  ws.ribbons[0].columns[0].cells[0].weight = 2;
  m.drop(ws, "a", "c", "middle");
  assert.deepEqual(shape(ws), [[["c", "b"], ["a"]]]);
  assert.deepEqual(weights(ws, 0, 0), [2, 1]);
});

test("resizing moves weight only from the neighbor", () => {
  const ws = build("a", "b", "c");
  m.drop(ws, "b", "a", "down");
  m.drop(ws, "c", "b", "down");
  m.resizePair(ws.ribbons[0].columns[0].cells, 1, 1, 0.5);
  assert.deepEqual(weights(ws, 0, 0), [1, 1.5, 0.5]);
});

test("growing a share adds pixels to one item and keeps the others' proportions", () => {
  const items = [{ weight: 1 }, { weight: 1 }, { weight: 2 }];
  m.growShare(items, 0, 200, 0, 1000);
  const [a, b, c] = items.map(i => i.weight), sum = a + b + c;
  assert.ok(Math.abs((a / sum) * 1000 - 450) < 1e-9);
  assert.ok(Math.abs(c / b - 2) < 1e-9);
});

test("growing a share stops at the minimum and at 90%", () => {
  const items = [{ weight: 1 }, { weight: 1 }];
  const share = () => items[0].weight / (items[0].weight + items[1].weight);
  m.growShare(items, 0, -1000, 100, 1000);
  assert.ok(Math.abs(share() - 0.1) < 1e-9);
  m.growShare(items, 0, 5000, 100, 1000);
  assert.ok(Math.abs(share() - 0.9) < 1e-9);
});

test("a single item has no share to grow", () => {
  const items = [{ weight: 1 }];
  m.growShare(items, 0, 200, 0, 1000);
  assert.deepEqual(items, [{ weight: 1 }]);
});

test("a new ribbon gets the mean ribbon weight", () => {
  const ws = build("a", "b");
  ws.ribbons[0].weight = 3;
  m.move(ws, "b", "down");
  assert.deepEqual(ws.ribbons.map(r => r.weight), [3, 3]);
});

test("a workspace shows two ribbons per row by default", () => {
  assert.equal(m.workspace().shown, 2);
});
