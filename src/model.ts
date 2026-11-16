// The layout model. Nothing here touches KWin, so tests can drive it with
// plain values standing in for windows.

export type Dir = "left" | "right" | "up" | "down";
export type Side = Dir | "middle";

// A cell's share of its column's height is weight / (sum of the column's weights).
export interface Cell<W> { win: W; weight: number }
export interface Column<W> { cells: Cell<W>[]; width: number; focus: number }
// A ribbon's share of its monitor row's height is weight / (sum of the
// weights of the ribbons shown in that row).
// anchor is the index of the first column of the main monitor's run of
// columns.
export interface Ribbon<W> { columns: Column<W>[]; anchor: number; focus: number; weight: number }
// top is the index of the ribbon shown on the first monitor row.
// shown is how many ribbons each monitor row shows at once.
export interface Workspace<W> { ribbons: Ribbon<W>[]; top: number; focus: number; shown: number }

export interface Pos<W> { ribbon: Ribbon<W>; column: Column<W>; r: number; c: number; k: number }

const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;

export const clamp = (i: number, n: number) => Math.max(0, Math.min(i, n - 1));
export interface Weighted { weight: number }
export const total = (items: Weighted[]) => items.reduce((s, c) => s + c.weight, 0);
// A new cell or ribbon gets the mean weight, so the others keep their proportions.
const mean = (items: Weighted[]) => total(items) / items.length || 1;

export const workspace = <W>(shown = 1): Workspace<W> => ({ ribbons: [], top: 0, focus: 0, shown });
const ribbon = <W>(ws: Workspace<W>): Ribbon<W> => ({ columns: [], anchor: 0, focus: 0, weight: mean(ws.ribbons) });
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

// Drops empty columns, and empty ribbons while there are more than ws.shown,
// starting from the bottom. Adds empty ribbons up to ws.shown, so a row
// always has that many to move windows into. Keeps focus indices in range.
function prune<W>(ws: Workspace<W>) {
  for (const ribbon of ws.ribbons) {
    ribbon.columns = ribbon.columns.filter(c => c.cells.length > 0);
    for (const column of ribbon.columns) column.focus = clamp(column.focus, column.cells.length);
    ribbon.focus = clamp(ribbon.focus, ribbon.columns.length);
    ribbon.anchor = clamp(ribbon.anchor, ribbon.columns.length);
  }
  for (let r = ws.ribbons.length - 1; r >= 0 && ws.ribbons.length > ws.shown; r--) {
    if (!ws.ribbons[r].columns.length) ws.ribbons.splice(r, 1);
  }
  while (ws.ribbons.length < ws.shown) ws.ribbons.push(ribbon(ws));
  ws.focus = clamp(ws.focus, ws.ribbons.length);
}

function insertCell<W>(column: Column<W>, k: number, win: W) {
  column.cells.splice(k, 0, { win, weight: mean(column.cells) });
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
  prune(ws);
  insertRight(ws.ribbons[ws.focus], win, width);
}

// Moves win into ribbon r as a new column right of that ribbon's focused
// column, keeping its column's width.
export function moveTo<W>(ws: Workspace<W>, win: W, r: number) {
  const target = ws.ribbons[r], p = target && detach(ws, win);
  if (!p) return;
  insertRight(target, win, p.column.width);
  prune(ws);
}

// Sets how many ribbons each monitor row shows, at least 1.
export function show<W>(ws: Workspace<W>, shown: number) {
  ws.shown = Math.max(1, shown);
  prune(ws);
}

export function remove<W>(ws: Workspace<W>, win: W) {
  detach(ws, win);
  prune(ws);
}

// The window that focus moves to. Up and down fall through to the column of
// the next ribbon with windows that has the least distance(column),
// entering it at the cell on the side focus comes from.
export function neighbor<W>(ws: Workspace<W>, win: W, dir: Dir, distance: (column: Column<W>) => number): W | undefined {
  const p = find(ws, win);
  if (!p) return;
  const [dx, dy] = delta[dir];
  if (dx) return focused(p.ribbon.columns[p.c + dx]);
  let r = p.r + dy;
  while (ws.ribbons[r] && !ws.ribbons[r].columns.length) r += dy;
  const own = p.column.cells[p.k + dy]?.win, next = ws.ribbons[r];
  if (own || !next) return own;
  const column = next.columns.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  return column.cells[dy > 0 ? 0 : column.cells.length - 1].win;
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
    const gaps = [0, ...target.cells.map(c => (acc += c.weight) / total(target.cells))];
    const off = (i: number) => Math.abs(gaps[i] - 0.5);
    insertCell(target, gaps.reduce((best, _, i) => (off(i) <= off(best) + 1e-9 ? i : best), 0), win);
  } else if (cells[p.k + dy]) {
    [cells[p.k], cells[p.k + dy]] = [cells[p.k + dy], cells[p.k]];
  } else {
    cells.splice(p.k, 1);
    let target = ws.ribbons[p.r + dy];
    if (!target) ws.ribbons.splice(dy > 0 ? ws.ribbons.length : 0, 0, target = ribbon(ws));
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

// Moves weight between items[k] and items[k + dy] so items[k] takes share
// of the items' total. The other items keep their weights.
export function resizePair(items: Weighted[], k: number, dy: number, share: number) {
  const item = items[k], other = items[k + dy];
  if (!other) return;
  const pair = item.weight + other.weight;
  item.weight = Math.min(Math.max(share * total(items), 0.1 * pair), 0.9 * pair);
  other.weight = pair - item.weight;
}

// Grows items[k] by delta pixels, where height is the pixel height of all
// the items together, but not below min pixels or above 90% of height.
// Only its weight changes, so the other items keep their proportions.
export function growShare(items: Weighted[], k: number, delta: number, min: number, height: number) {
  const item = items[k], rest = total(items) - item.weight;
  if (!rest) return;
  const share = Math.min(Math.max(item.weight / total(items) + delta / height, min / height), 0.9);
  item.weight = (share * rest) / (1 - share);
}
