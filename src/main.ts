// The KWin adapter. It wires KWin signals and shortcuts to the model and
// writes the computed rectangles back to windows. Layout rules live in
// model.ts and geometry.ts.

import * as model from "./model.ts";
import { hit, layout, nearest, opening, place, ribbonAt, rows, scroll, type Rect } from "./geometry.ts";

// The parts of KWin's scripting API used here. See kwin/src/window.h and
// kwin/src/scripting/workspace_wrapper.h.
interface Signal<A extends unknown[] = []> { connect(f: (...args: A) => void): void }
interface Desktop { id: string }
interface Win {
  managed: boolean; normalWindow: boolean; dialog: boolean; popupWindow: boolean; opacity: number; moveableAcrossScreens: boolean;
  minimized: boolean; fullScreen: boolean; maximizeMode: number; move: boolean;
  frameGeometry: Rect; minSize: { width: number; height: number }; desktops: Desktop[];
  minimizedChanged: Signal; desktopsChanged: Signal;
  interactiveMoveResizeStarted: Signal; interactiveMoveResizeFinished: Signal;
}
declare const workspace: {
  activeWindow: Win | null; currentDesktop: Desktop; screenOrder: object[]; cursorPos: { x: number; y: number };
  windowList(): Win[]; clientArea(option: number, output: object, desktop: Desktop): Rect;
  windowAdded: Signal<[Win]>; windowRemoved: Signal<[Win]>; windowActivated: Signal<[Win]>;
  screensChanged: Signal; screenOrderChanged: Signal; virtualScreenGeometryChanged: Signal;
};
declare const KWin: { MaximizeArea: number; ElectricLeft: number; ElectricRight: number; ElectricTop: number; ElectricBottom: number };
declare function registerShortcut(name: string, text: string, keys: string, f: () => void): void;
declare function registerScreenEdge(edge: number, f: () => void): void;
declare function readConfig(key: string, fallback: unknown): unknown;

// One workspace per virtual desktop, keyed by desktop id.
interface Space { desktop: Desktop; ws: model.Workspace<Win> }
const spaces = new Map<string, Space>();
const home = new Map<Win, Space>();

const copy = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

// Settings from the kolumn settings page in System Settings, read once when
// kolumn starts. GAP is the space between neighboring windows. Each window
// is inset from its cell by half of it on every side, so a cell is GAP
// larger than its window. RIBBONS is how many ribbons each monitor row of a
// new workspace shows.
const GAP = Number(readConfig("Gap", 6));
const RIBBONS = Math.max(1, Number(readConfig("Ribbons", 1)));
const inset = (r: Rect): Rect => ({ x: r.x + GAP / 2, y: r.y + GAP / 2, width: r.width - GAP, height: r.height - GAP });
// screenOrder lists monitors by priority, with the primary monitor first.
const rowsOf = (desktop: Desktop) => rows(workspace.screenOrder.map(o => copy(workspace.clientArea(KWin.MaximizeArea, o, desktop))));

// A window on all desktops has no desktops listed and joins the current one.
// It opens where opening() says, next to the workspace's focused window. KWin
// activates a new window before it emits windowAdded, but refresh() only
// moves focus to windows kolumn tiles, so that is still the window that had
// focus before.
function add(w: Win) {
  if (w.minimized) return;
  const desktop = w.desktops[0] ?? workspace.currentDesktop;
  let s = spaces.get(desktop.id);
  if (!s) spaces.set(desktop.id, (s = { desktop, ws: model.workspace(RIBBONS) }));
  model.add(s.ws, w, w.frameGeometry.width + GAP, opening(s.ws, rowsOf(desktop)));
  home.set(w, s);
}

function remove(w: Win) {
  const s = home.get(w);
  if (s) model.remove(s.ws, w);
  home.delete(w);
}

// Scrolls to the active window, then places every tiled window except
// fullscreen and maximized ones, which KWin sizes itself.
function refresh() {
  const active = workspace.activeWindow, s = active && home.get(active);
  if (s) {
    model.setFocus(s.ws, active);
    scroll(s.ws, rowsOf(s.desktop));
  }
  for (const { desktop, ws } of spaces.values()) {
    for (const [w, r] of layout(ws, rowsOf(desktop))) {
      if (!w.fullScreen && !w.maximizeMode) w.frameGeometry = inset(r);
    }
  }
}

// With no window at the pointer's height, a drop into an empty ribbon moves
// the window there.
function dropped(s: Space, w: Win) {
  const rs = rowsOf(s.desktop), p = workspace.cursorPos, target = hit(layout(s.ws, rs), p, w);
  if (target) return model.drop(s.ws, w, ...target);
  const r = ribbonAt(s.ws, rs, p);
  if (r !== undefined && !s.ws.ribbons[r].columns.length) model.moveTo(s.ws, w, r);
}

// KWin resizes from the edge nearest the grab point. A moved left or right
// edge sets the column width. A moved top or bottom edge moves the split
// with the neighbor cell on that side, or, with no cell there, with the
// neighbor ribbon shown in the same row.
function resized(s: Space, w: Win, start: Rect) {
  const p = model.find(s.ws, w), g = w.frameGeometry;
  if (!p) return;
  if (g.width !== start.width) p.column.width = g.width + GAP;
  const dy = g.y !== start.y ? -1 : g.y + g.height !== start.y + start.height ? 1 : 0;
  if (!dy) return;
  const [items, k, size, height] = vertical(s, p, !!p.column.cells[p.k + dy]);
  model.resizePair(items, k, dy, (size + g.height - start.height) / height);
}

// What a vertical resize of p's window changes: the cells of its column,
// or the ribbons shown in its row. Returns those items, the index of the
// window's own item, that item's height, and all the items' height, in
// pixels at the window's column.
function vertical(s: Space, p: model.Pos<Win>, cells: boolean): [model.Weighted[], number, number, number] {
  const rs = rowsOf(s.desktop), rects = layout(s.ws, rs);
  const height = p.column.cells.reduce((h, c) => h + rects.get(c.win)!.height, 0);
  if (cells) return [p.column.cells, p.k, rects.get(p.column.cells[p.k].win)!.height, height];
  const { group } = place(s.ws, rs, p.r);
  return [group, group.indexOf(p.ribbon), height, (height * model.total(group)) / p.ribbon.weight];
}

// KWin's own windows, such as decoration button tooltips, report type
// Normal, but their Qt popup flag marks them as popups. Fully transparent
// windows, such as the Xwayland Video Bridge's, are never seen. Layer-shell
// windows, such as the lock and logout screens, can report type Normal
// too, but KWin never moves them.
function track(w: Win) {
  if (!(w.managed && (w.normalWindow || w.dialog) && !w.popupWindow && w.opacity > 0 && w.moveableAcrossScreens)) return;
  let start: Rect, moving: boolean;
  const rehome = () => { remove(w); add(w); refresh(); };
  w.minimizedChanged.connect(rehome);
  w.desktopsChanged.connect(rehome);
  w.interactiveMoveResizeStarted.connect(() => { start = copy(w.frameGeometry); moving = w.move; });
  w.interactiveMoveResizeFinished.connect(() => {
    const s = home.get(w);
    if (s) moving ? dropped(s, w) : resized(s, w, start);
    refresh();
  });
  add(w);
}

function withActive(f: (s: Space, w: Win) => void) {
  const w = workspace.activeWindow, s = w && home.get(w);
  if (w && s) f(s, w);
}

// Focus moves by Meta+arrow or by pushing the pointer into the matching
// outer screen edge. KWin's Screen Edges settings set the edge delays.
const keys = { left: "Left", right: "Right", up: "Up", down: "Down" } as const;
const edges = { left: KWin.ElectricLeft, right: KWin.ElectricRight, up: KWin.ElectricTop, down: KWin.ElectricBottom };
for (const dir of Object.keys(keys) as model.Dir[]) {
  const focus = () => withActive((s, w) => {
    const rs = rowsOf(s.desktop), next = model.neighbor(s.ws, w, dir, r => nearest(s.ws, rs, w, r));
    if (next) workspace.activeWindow = next;
  });
  registerShortcut(`kolumn focus ${dir}`, `kolumn: Focus ${keys[dir]}`, `Meta+${keys[dir]}`, focus);
  registerScreenEdge(edges[dir], focus);
  registerShortcut(`kolumn move ${dir}`, `kolumn: Move ${keys[dir]}`, `Meta+Shift+${keys[dir]}`, () =>
    withActive((s, w) => { model.move(s.ws, w, dir); refresh(); }));
}

// Resizing steps by STEP pixels. Height resizes the window's cell, or its
// ribbon when the window is alone in its column. These shortcuts and the
// ribbon count ones have no default keys. Assign them in System Settings.
const STEP = 100;
for (const axis of ["width", "height"] as const) {
  for (const [verb, delta] of [["Increase", STEP], ["Decrease", -STEP]] as const) {
    registerShortcut(`kolumn ${verb.toLowerCase()} ${axis}`, `kolumn: ${verb} Window ${axis[0].toUpperCase() + axis.slice(1)}`, "", () =>
      withActive((s, w) => {
        const p = model.find(s.ws, w);
        if (!p) return;
        if (axis === "width") p.column.width = Math.max(p.column.width + delta, w.minSize.width + GAP);
        else {
          const [items, k, , height] = vertical(s, p, p.column.cells.length > 1);
          model.growShare(items, k, delta, w.minSize.height + GAP, height);
        }
        refresh();
      }));
  }
}

// How many ribbons each monitor row shows, at least 1.
for (const [verb, delta] of [["More", 1], ["Fewer", -1]] as const) {
  registerShortcut(`kolumn ${verb.toLowerCase()} ribbons`, `kolumn: Show ${verb} Ribbons`, "", () =>
    withActive(s => { model.show(s.ws, s.ws.shown + delta); refresh(); }));
}

workspace.windowAdded.connect(w => { track(w); refresh(); });
workspace.windowRemoved.connect(w => { remove(w); refresh(); });
workspace.windowActivated.connect(refresh);
workspace.screensChanged.connect(refresh);
workspace.screenOrderChanged.connect(refresh);
workspace.virtualScreenGeometryChanged.connect(refresh);
workspace.windowList().forEach(track);
refresh();
