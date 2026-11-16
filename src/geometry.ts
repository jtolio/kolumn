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

// The x of each of the ribbon's columns. The row's main monitor holds a run
// of columns starting at the anchor: as many as fit, added to the right and
// then, at the end of the ribbon, to the left. Where the run sits on the main
// monitor:
//   - When columns follow the run and the main monitor's right edge is an
//     outer edge, the run sits against the left edge. The next column fills
//     the leftover space on the right and hangs off the outer edge.
//   - At the end of the ribbon, when columns precede the run and the main
//     monitor's left edge is an outer edge, the run sits against the right
//     edge, so the previous column fills the left side the same way.
//   - Otherwise the run is centered, for example when the whole ribbon fits
//     or when the leftover space faces a seam.
// Where the leftover space faces a seam, the columns outside the run start
// on the next monitor instead. Moving the anchor by one moves one column
// across the main monitor's edge. The other columns pack outward from the
// run both ways, and a column that would cross a seam moves past it and
// leaves a blank. Columns may run past the row's outer edges. Positions
// depend only on the anchor, never on focus.
function xs<W>(ribbon: Ribbon<W>, row: Row): number[] {
  const cs = ribbon.columns, out: number[] = [];
  if (!cs.length) return out;
  let lo = clamp(ribbon.anchor, cs.length), hi = lo, w = cs[lo].width;
  const fits = (i: number) => i >= 0 && i < cs.length && w + cs[i].width <= row.main.width;
  while (fits(hi + 1)) w += cs[++hi].width;
  while (hi === cs.length - 1 && fits(lo - 1)) w += cs[--lo].width;
  const seams = [...row.monitors.map(m => m.x), ...row.monitors.map(m => m.x + m.width)].filter(s => s > row.left && s < row.right);
  const seam = (x: number, w: number) => seams.find(s => x < s && s < x + w);
  const left = row.main.x, right = left + row.main.width;
  const end = hi === cs.length - 1, slack = row.main.width - w;
  out[lo] = left + (end ? (lo > 0 && !seams.includes(left) ? slack : slack / 2) : seams.includes(right) ? slack / 2 : 0);
  for (let i = lo + 1; i < cs.length; i++) {
    const x = i === hi + 1 && seams.includes(right) ? right : out[i - 1] + cs[i - 1].width;
    out[i] = i <= hi ? x : seam(x, cs[i].width) ?? x;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const x = (i === lo - 1 && seams.includes(left) ? left : out[i + 1]) - cs[i].width, s = seam(x, cs[i].width);
    out[i] = s === undefined ? x : s - cs[i].width;
  }
  return out;
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

// The fractions of its row's height, from the top, that a ribbon's band
// covers among the ribbons it shares the row with.
function band<W>(group: Ribbon<W>[], ribbon: Ribbon<W>): [number, number] {
  const f0 = total(group.slice(0, group.indexOf(ribbon))) / total(group);
  return [f0, f0 + ribbon.weight / total(group)];
}

// The shown ribbon whose band on the monitor under p contains p, if any.
export function ribbonAt<W>(ws: Workspace<W>, rs: Row[], p: { x: number; y: number }): number | undefined {
  for (let r = 0; r < ws.ribbons.length; r++) {
    const { k, group } = place(ws, rs, r), [f0, f1] = band(group, ws.ribbons[r]);
    const m = rs[k]?.monitors.find(m => p.x >= m.x && p.x < m.x + m.width);
    if (m && p.y >= m.y + m.height * f0 && p.y < m.y + m.height * f1) return r;
  }
}

// Each ribbon takes its weighted band of its row's height.
export function layout<W>(ws: Workspace<W>, rs: Row[]): Map<W, Rect> {
  const out = new Map<W, Rect>();
  if (!rs.length) return out;
  ws.ribbons.forEach((ribbon, r) => {
    const { k, group } = place(ws, rs, r), row = rs[clamp(k, rs.length)];
    const dy = (k - clamp(k, rs.length)) * (row.bottom - row.top);
    const [f0, f1] = band(group, ribbon), x = xs(ribbon, row);
    ribbon.columns.forEach((column, c) => {
      const [top, bottom] = span(row, x[c], column.width, f0, f1);
      const at = (acc: number) => Math.round(top + ((bottom - top) * acc) / total(column.cells));
      let acc = 0;
      for (const cell of column.cells) {
        const y = at(acc);
        acc += cell.weight;
        out.set(cell.win, { x: Math.round(x[c]), y: y + dy, width: column.width, height: at(acc) - y });
      }
    });
  });
  return out;
}

// Scrolls as little as possible so the focused ribbon is shown, then steps
// its anchor one column at a time toward the focused column until that
// column is fully inside its row. A fully visible focused column moves
// nothing. Scrolling never goes past the last ribbon, so closing one at the
// end pulls the rest back.
export function scroll<W>(ws: Workspace<W>, rs: Row[]) {
  const ribbon = ws.ribbons[ws.focus];
  if (!ribbon || !rs.length) return;
  const slots = rs.length * ws.shown;
  ws.top = Math.max(0, Math.min(ws.focus, Math.max(ws.top, ws.focus - slots + 1), ws.ribbons.length - slots));
  if (!ribbon.columns.length) return;
  const row = rs[place(ws, rs, ws.focus).k], f = ribbon.focus, w = ribbon.columns[f].width;
  for (let x = xs(ribbon, row)[f]; ribbon.anchor !== f && (x < row.left || x + w > row.right); x = xs(ribbon, row)[f]) {
    ribbon.anchor += Math.sign(f - ribbon.anchor);
  }
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
