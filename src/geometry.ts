// Turns a workspace into window rectangles in KDE's global coordinates.
// Nothing here touches KWin.

import { clamp, total, type Ribbon, type Side, type Workspace } from "./model.ts";

export interface Rect { x: number; y: number; width: number; height: number }
// main is the row's monitor that comes first in the list passed to rows().
export interface Row { monitors: Rect[]; main: Rect; left: number; right: number; top: number; bottom: number }

// Groups monitors whose vertical ranges overlap into rows, top to bottom.
// monitors is in priority order, most important first.
export function rows(monitors: Rect[]): Row[] {
  const out: Row[] = [];
  for (const m of [...monitors].sort((a, b) => a.y - b.y)) {
    const row = out[out.length - 1];
    if (row && m.y < row.bottom) {
      row.monitors.push(m);
      if (monitors.indexOf(m) < monitors.indexOf(row.main)) row.main = m;
      row.left = Math.min(row.left, m.x);
      row.right = Math.max(row.right, m.x + m.width);
      row.bottom = Math.max(row.bottom, m.y + m.height);
    } else {
      out.push({ monitors: [m], main: m, left: m.x, right: m.x + m.width, top: m.y, bottom: m.y + m.height });
    }
  }
  return out;
}

// The vertical range a column gets when its ribbon has the band from
// fraction f0 to f1 of each monitor's height. It is the overlap of that band
// on every monitor the column covers, so columns of different ribbons never
// overlap, even across a seam. A column that covers no monitor uses the
// nearest one.
function span(row: Row, x: number, width: number, f0: number, f1: number): [number, number] {
  let ms = row.monitors.filter(m => m.x < x + width && m.x + m.width > x);
  if (!ms.length) {
    const dist = (m: Rect) => Math.abs(m.x + m.width / 2 - (x + width / 2));
    ms = [row.monitors.reduce((a, b) => (dist(a) <= dist(b) ? a : b))];
  }
  return [Math.max(...ms.map(m => m.y + m.height * f0)), Math.min(...ms.map(m => m.y + m.height * f1))];
}

const width = <W>(ribbon: Ribbon<W>) => ribbon.columns.reduce((s, c) => s + c.width, 0);

// Where the ribbon's first column starts. A ribbon narrower than the row is
// centered on the row's main monitor, but kept inside the row. A wider one
// starts at the row's left edge minus its scroll offset.
function origin<W>(ribbon: Ribbon<W>, row: Row) {
  const w = width(ribbon), m = row.main;
  if (w >= row.right - row.left) return row.left - ribbon.scroll;
  return Math.min(Math.max(m.x + (m.width - w) / 2, row.left), row.right - w);
}

// Row k shows ws.shown ribbons starting at ribbon top + k * ws.shown, and
// group is the ribbons that share ribbon r's row. A ribbon above or below
// the rows gets a row index past the first or last row and a row to itself,
// so off-screen ribbons stack away from the screen.
export function place<W>(ws: Workspace<W>, rs: Row[], r: number): { k: number; group: Ribbon<W>[] } {
  const j = r - ws.top, slots = rs.length * ws.shown;
  if (j < 0 || j >= slots) return { k: j < 0 ? j : rs.length + j - slots, group: [ws.ribbons[r]] };
  const k = Math.floor(j / ws.shown), first = ws.top + k * ws.shown;
  return { k, group: ws.ribbons.slice(first, first + ws.shown) };
}

// Each ribbon takes its weighted band of its row's height.
export function layout<W>(ws: Workspace<W>, rs: Row[]): Map<W, Rect> {
  const out = new Map<W, Rect>();
  if (!rs.length) return out;
  ws.ribbons.forEach((ribbon, r) => {
    const { k, group } = place(ws, rs, r), row = rs[clamp(k, rs.length)];
    const dy = (k - clamp(k, rs.length)) * (row.bottom - row.top);
    const f0 = total(group.slice(0, group.indexOf(ribbon))) / total(group), f = ribbon.weight / total(group);
    let x = origin(ribbon, row);
    for (const column of ribbon.columns) {
      const [top, bottom] = span(row, x, column.width, f0, f0 + f);
      const at = (acc: number) => Math.round(top + ((bottom - top) * acc) / total(column.cells));
      let acc = 0;
      for (const cell of column.cells) {
        const y = at(acc);
        acc += cell.weight;
        out.set(cell.win, { x: Math.round(x), y: y + dy, width: column.width, height: at(acc) - y });
      }
      x += column.width;
    }
  });
  return out;
}

// Scrolls as little as possible so the focused ribbon is shown and its
// focused column fits between its row's left and right edges. A column
// wider than the row lines up with the left edge. Scrolling never goes past
// the last ribbon or the last column, so closing one at the end pulls the
// rest back.
export function scroll<W>(ws: Workspace<W>, rs: Row[]) {
  const ribbon = ws.ribbons[ws.focus];
  if (!ribbon || !rs.length) return;
  const slots = rs.length * ws.shown;
  ws.top = Math.max(0, Math.min(ws.focus, Math.max(ws.top, ws.focus - slots + 1), ws.ribbons.length - slots));
  const row = rs[place(ws, rs, ws.focus).k], rowWidth = row.right - row.left;
  const start = ribbon.columns.slice(0, ribbon.focus).reduce((s, c) => s + c.width, 0);
  const end = start + ribbon.columns[ribbon.focus].width;
  const last = width(ribbon) - rowWidth;
  ribbon.scroll = Math.max(0, Math.min(start, last, Math.max(ribbon.scroll, end - rowWidth)));
}

// The window under p, other than skip, and which part of it p is in. The
// outer quarter nearest p picks a side, and anything else is the middle.
// Over empty space, it is the nearest window level with p, on the side
// facing p, so a drop there makes a new column next to that window. Over
// skip's own cell, it is nothing, so the window stays where it was.
export function hit<W>(rects: Map<W, Rect>, p: { x: number; y: number }, skip: W): [W, Side] | undefined {
  const own = rects.get(skip);
  if (own && p.x >= own.x && p.x < own.x + own.width && p.y >= own.y && p.y < own.y + own.height) return;
  let near: [W, Side] | undefined, best = Infinity;
  for (const [win, r] of rects) {
    const fx = (p.x - r.x) / r.width, fy = (p.y - r.y) / r.height;
    if (win === skip || fy < 0 || fy >= 1) continue;
    if (fx >= 0 && fx < 1) {
      const sides: [Side, number][] = [["left", fx], ["right", 1 - fx], ["up", fy], ["down", 1 - fy]];
      const [side, d] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
      return [win, d < 0.25 ? side : "middle"];
    }
    const d = fx < 0 ? r.x - p.x : p.x - (r.x + r.width);
    if (d < best) [near, best] = [[win, fx < 0 ? "left" : "right"], d];
  }
  return near;
}
