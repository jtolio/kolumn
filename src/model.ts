// The layout model. Nothing here touches KWin, so tests can drive it with
// plain values standing in for windows.

export type Dir = "left" | "right" | "up" | "down";
export type Side = Dir | "middle";

// A cell's share of its column's height is weight / (sum of the column's weights).
export interface Cell<W> { win: W; weight: number }
export interface Column<W> { cells: Cell<W>[]; width: number; focus: number }
export interface Ribbon<W> { columns: Column<W>[]; scroll: number; focus: number }
// top is the index of the ribbon shown on the first monitor row.
export interface Workspace<W> { ribbons: Ribbon<W>[]; top: number; focus: number }

interface Pos<W> { ribbon: Ribbon<W>; column: Column<W>; r: number; c: number; k: number }

const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

export const clamp = (i: number, n: number) => Math.max(0, Math.min(i, n - 1));
export const total = <W>(column: Column<W>) => column.cells.reduce((s, c) => s + c.weight, 0);

export const workspace = <W>(): Workspace<W> => ({ ribbons: [], top: 0, focus: 0 });
const ribbon = <W>(): Ribbon<W> => ({ columns: [], scroll: 0, focus: 0 });
const column = <W>(win: W, width: number): Column<W> => ({ cells: [{ win, weight: 1 }], width, focus: 0 });
const focused = <W>(column?: Column<W>) => column?.cells[column.focus]?.win;

export function find<W>(ws: Workspace<W>, win: W): Pos<W> | undefined {
  for (const [r, ribbon] of ws.ribbons.entries()) {
    for (const [c, column] of ribbon.columns.entries()) {
      const k = column.cells.findIndex(cell => cell.win === win);
      if (k >= 0) return { ribbon, column, r, c, k };
    }
  }
}

export function setFocus<W>(ws: Workspace<W>, win: W) {
  const p = find(ws, win);
  if (!p) return;
  ws.focus = p.r;
  p.ribbon.focus = p.c;
  p.column.focus = p.k;
}

// Drops empty columns and ribbons and keeps focus indices in range.
function prune<W>(ws: Workspace<W>) {
  for (const ribbon of ws.ribbons) {
    ribbon.columns = ribbon.columns.filter(c => c.cells.length > 0);
    for (const column of ribbon.columns) column.focus = clamp(column.focus, column.cells.length);
    ribbon.focus = clamp(ribbon.focus, ribbon.columns.length);
  }
  ws.ribbons = ws.ribbons.filter(r => r.columns.length > 0);
  ws.focus = clamp(ws.focus, ws.ribbons.length);
}

// A new cell gets the mean weight, so existing cells keep their proportions.
function insertCell<W>(column: Column<W>, k: number, win: W) {
  column.cells.splice(k, 0, { win, weight: total(column) / column.cells.length || 1 });
}

function insertRight<W>(ribbon: Ribbon<W>, win: W, width: number) {
  ribbon.columns.splice(ribbon.focus + 1, 0, column(win, width));
}

function detach<W>(ws: Workspace<W>, win: W) {
  const p = find(ws, win);
  p?.column.cells.splice(p.k, 1);
  return p;
}

// Adds win as a new column right of the focused column in the focused ribbon.
export function add<W>(ws: Workspace<W>, win: W, width: number) {
  if (!ws.ribbons.length) ws.ribbons.push(ribbon());
  insertRight(ws.ribbons[ws.focus], win, width);
}

export function remove<W>(ws: Workspace<W>, win: W) {
  detach(ws, win);
  prune(ws);
}

// The window that focus moves to. Up and down fall through to the next ribbon.
export function neighbor<W>(ws: Workspace<W>, win: W, dir: Dir): W | undefined {
  const p = find(ws, win);
  if (!p) return;
  const [dx, dy] = delta[dir];
  if (dx) return focused(p.ribbon.columns[p.c + dx]);
  const next = ws.ribbons[p.r + dy];
  return p.column.cells[p.k + dy]?.win ?? focused(next?.columns[next.focus]);
}

export function move<W>(ws: Workspace<W>, win: W, dir: Dir) {
  const p = find(ws, win);
  if (!p) return;
  const [dx, dy] = delta[dir];
  const cells = p.column.cells;
  if (dx && cells.length > 1) {
    // Leave the column for a new one on that side.
    const [cell] = cells.splice(p.k, 1);
    p.ribbon.columns.splice(p.c + (dx > 0 ? 1 : 0), 0, { cells: [cell], width: p.column.width, focus: 0 });
  } else if (dx) {
    // A lone window joins the neighbor column at the gap between cells
    // nearest its own center, which is the middle of the column. Ties go
    // down, so a window joining a single cell goes below it.
    const target = p.ribbon.columns[p.c + dx];
    if (!target) return;
    cells.splice(p.k, 1);
    let acc = 0;
    const gaps = [0, ...target.cells.map(c => (acc += c.weight) / total(target))];
    const off = (i: number) => Math.abs(gaps[i] - 0.5);
    insertCell(target, gaps.reduce((best, _, i) => (off(i) <= off(best) + 1e-9 ? i : best), 0), win);
  } else if (cells[p.k + dy]) {
    [cells[p.k], cells[p.k + dy]] = [cells[p.k + dy], cells[p.k]];
  } else {
    cells.splice(p.k, 1);
    let target = ws.ribbons[p.r + dy];
    if (!target) ws.ribbons.splice(dy > 0 ? ws.ribbons.length : 0, 0, target = ribbon());
    insertRight(target, win, p.column.width);
  }
  prune(ws);
}

// Puts win next to target on the given side, or swaps the two for "middle".
export function drop<W>(ws: Workspace<W>, win: W, target: W, side: Side) {
  const from = find(ws, win), to = find(ws, target);
  if (!from || !to || win === target) return;
  if (side === "middle") {
    from.column.cells[from.k].win = target;
    to.column.cells[to.k].win = win;
    return;
  }
  detach(ws, win);
  const at = find(ws, target)!;
  if (side === "up" || side === "down") insertCell(at.column, at.k + (side === "down" ? 1 : 0), win);
  else at.ribbon.columns.splice(at.c + (side === "right" ? 1 : 0), 0, column(win, from.column.width));
  prune(ws);
}

// Moves weight between cell k and its neighbor in direction dy (-1 above,
// 1 below) so cell k takes `share` of the column. Other cells keep theirs.
export function resizeCell<W>(column: Column<W>, k: number, dy: number, share: number) {
  const cell = column.cells[k], other = column.cells[k + dy];
  if (!other) return;
  const pair = cell.weight + other.weight;
  cell.weight = Math.min(Math.max(share * total(column), 0.1 * pair), 0.9 * pair);
  other.weight = pair - cell.weight;
}

// Grows win's column width, or its cell's height, by delta pixels, but not
// below min. height is the column's height in pixels. The cell's new height
// comes from its weight alone, so the other cells keep their proportions to
// each other, and it never takes more than 90% of the column.
export function grow<W>(ws: Workspace<W>, win: W, axis: "width" | "height", delta: number, min: number, height: number) {
  const p = find(ws, win);
  if (!p) return;
  if (axis === "width") {
    p.column.width = Math.max(p.column.width + delta, min);
    return;
  }
  const cell = p.column.cells[p.k], rest = total(p.column) - cell.weight;
  if (!rest) return;
  const share = Math.min(Math.max(cell.weight / total(p.column) + delta / height, min / height), 0.9);
  cell.weight = (share * rest) / (1 - share);
}
