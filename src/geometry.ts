// Turns a workspace into window rectangles in KDE's global coordinates.
// Nothing here touches KWin.

import { clamp, total, type Side, type Workspace } from "./model.ts";

export interface Rect { x: number; y: number; width: number; height: number }
export interface Row { monitors: Rect[]; left: number; right: number; top: number; bottom: number }

// Groups monitors whose vertical ranges overlap into rows, top to bottom.
export function rows(monitors: Rect[]): Row[] {
  const out: Row[] = [];
  for (const m of [...monitors].sort((a, b) => a.y - b.y)) {
    const row = out[out.length - 1];
    if (row && m.y < row.bottom) {
      row.monitors.push(m);
      row.left = Math.min(row.left, m.x);
      row.right = Math.max(row.right, m.x + m.width);
      row.bottom = Math.max(row.bottom, m.y + m.height);
    } else {
      out.push({ monitors: [m], left: m.x, right: m.x + m.width, top: m.y, bottom: m.y + m.height });
    }
  }
  return out;
}

// The vertical range shared by the monitors that a column covers. A column
// that covers no monitor uses the nearest one.
function span(row: Row, x: number, width: number): [number, number] {
  let ms = row.monitors.filter(m => m.x < x + width && m.x + m.width > x);
  if (!ms.length) {
    const dist = (m: Rect) => Math.abs(m.x + m.width / 2 - (x + width / 2));
    ms = [row.monitors.reduce((a, b) => (dist(a) <= dist(b) ? a : b))];
  }
  return [Math.max(...ms.map(m => m.y)), Math.min(...ms.map(m => m.y + m.height))];
}

// Row k shows ribbon top + k. Ribbons above or below the rows stack
// off-screen past the first or last row.
export function layout<W>(ws: Workspace<W>, rs: Row[]): Map<W, Rect> {
  const out = new Map<W, Rect>();
  if (!rs.length) return out;
  ws.ribbons.forEach((ribbon, r) => {
    const k = r - ws.top, row = rs[clamp(k, rs.length)];
    const dy = (k - clamp(k, rs.length)) * (row.bottom - row.top);
    let x = row.left - ribbon.scroll;
    for (const column of ribbon.columns) {
      const [top, bottom] = span(row, x, column.width);
      const at = (acc: number) => Math.round(top + ((bottom - top) * acc) / total(column));
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

// Scrolls as little as possible so the focused ribbon is on a row and its
// focused column fits between the row's left and right edges. A column
// wider than the row lines up with the left edge.
export function scroll<W>(ws: Workspace<W>, rs: Row[]) {
  const ribbon = ws.ribbons[ws.focus];
  if (!ribbon || !rs.length) return;
  ws.top = Math.min(ws.focus, Math.max(ws.top, ws.focus - rs.length + 1));
  const row = rs[ws.focus - ws.top];
  const start = ribbon.columns.slice(0, ribbon.focus).reduce((s, c) => s + c.width, 0);
  const end = start + ribbon.columns[ribbon.focus].width;
  ribbon.scroll = Math.min(start, Math.max(ribbon.scroll, end - (row.right - row.left)));
}

// The window under p, other than skip, and which part of it p is in. The
// outer quarter nearest p picks a side, and anything else is the middle.
export function hit<W>(rects: Map<W, Rect>, p: { x: number; y: number }, skip: W): [W, Side] | undefined {
  for (const [win, r] of rects) {
    const fx = (p.x - r.x) / r.width, fy = (p.y - r.y) / r.height;
    if (win === skip || fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue;
    const sides: [Side, number][] = [["left", fx], ["right", 1 - fx], ["up", fy], ["down", 1 - fy]];
    const [side, d] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
    return [win, d < 0.25 ? side : "middle"];
  }
}
