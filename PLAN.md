# kolumn plan

kolumn is a KWin script for Plasma 6.6, the version Kubuntu 26.04 ships. It arranges windows into scrolling columns, in the style of niri and PaperWM.

## Design rules

1. Keep the number of concepts small and the code short. Avoid code golf, but every rule and every line has to earn its place.
2. Work with KWin, not against it. If KWin already does something harmless, let it. If a feature is not needed, leave it out.
3. Every window is handled the same way. kolumn has no exemption lists, no floating mode, and no per-app rules.

## Nouns

- A window is a KWin window.
- A cell holds one window and has a weight. A cell's share of the column height is its weight divided by the sum of the weights in the column.
- A column is a vertical stack of one or more cells. It has a width in pixels.
- A ribbon is a horizontal row of zero or more columns. It has an anchor, which is the index of the column centered on the main monitor, and a weight. A new ribbon gets the mean weight of the existing ribbons.
- A workspace is a vertical stack of ribbons. It also stores the index of the top visible ribbon and how many ribbons each monitor row shows at once, which is at least 1 and starts at 2. There is one workspace per KDE virtual desktop.

kolumn deletes a column when its last cell leaves, and deletes a ribbon when its last column leaves.

## What kolumn tiles

kolumn tiles any window where `managed && (normalWindow || dialog) && !popupWindow`. This covers app main windows and their dialogs. It leaves out panels, the desktop, notifications, OSDs, menus, and tooltips. KWin keeps handling those as it does now. The `popupWindow` check is needed for KWin's own windows, such as the tooltips on decoration buttons. They count as managed and always report type Normal (`kwin/src/internalwindow.cpp:65-68`, `152-155`), but Qt's popup flag makes them popups (`internalwindow.cpp:162-168`).

These windows are tiled, but kolumn does not set their geometry:

- Fullscreen windows. They keep their cell, so leaving fullscreen puts them back in place.
- Maximized windows (`maximizeMode != 0`). The rule is the same as for fullscreen.

KWin applies each window's own min and max size limits. A window that cannot grow to fill its cell sits at the cell's top-left corner.

## Geometry

kolumn places every window directly in KDE's global coordinate space. KWin then shows whatever lands on each monitor. A window outside every monitor is not drawn.

1. Rows. kolumn groups monitors whose usable vertical ranges overlap into one row. It uses `workspace.clientArea(MaximizeArea, output, desktop)` for each monitor's usable area, which already leaves out Plasma panels. Rows are sorted top to bottom. With a single monitor there is one row. Each row has a main monitor, which is its first monitor in `workspace.screenOrder`. That list is sorted by Plasma's monitor priority, so the row with the primary monitor has it as its main monitor.
2. Which ribbons each row shows. With `shown` ribbons per row, row `k` shows ribbons `top + k * shown` through `top + k * shown + shown - 1`. Each shown ribbon gets `weight / sum(weights)` of the row's height, summed over the ribbons that row actually shows. A ribbon alone in its row fills it, even when `shown` is larger. kolumn stacks ribbons above `top` upward past the top edge of row 0, one row height each. It stacks ribbons past the last shown one downward past the last row's bottom edge. Ribbons outside the rows end up off-screen.
3. Horizontal placement. The ribbon's anchor column is centered on its row's main monitor. The other columns pack edge to edge outward from it in both directions. Any column that would cross a seam between two monitors moves past it, leaving a blank. A column too wide to fit on one side of a seam stays across it. Columns may run past the row's outer edges. Positions depend only on the anchor, so focusing a window never moves anything by itself. When `main.ts` writes a window's geometry, it insets the window GAP/2 px from its cell on every side, which leaves a GAP px gap between neighboring windows. A column's width includes that gap, so a new column is GAP px wider than the window's own width.
4. Column height. A ribbon's weighted band is taken on each monitor separately. For example, the first of two equal ribbons gets the top half of each monitor's usable height. A column's vertical extent is the overlap of its ribbon's bands on the monitors it covers horizontally in its row. A column on one monitor gets that monitor's band. A column across a seam gets the overlap of the bands on both monitors. On a single monitor no two ribbons' bands overlap, so neither do their overlaps, even when a column of one ribbon crosses a seam and a column of the next ribbon does not. An off-screen column uses the nearest monitor in its row.
5. Cell height. Each cell gets `weight / sum(weights)` of the column height. The weights are never normalized. Removing a cell leaves the other weights unchanged, so in a column with weights `a, b, c`, removing `a` gives `b` a share of `b/(b+c)`. A new cell gets the mean of the column's existing weights, so it takes `1/(n+1)` of the height and the existing cells keep their proportions to each other.
6. Scrolling. When the focused window changes, kolumn scrolls as little as possible:
   - Horizontally, if the focused column is not fully inside its row, kolumn moves the ribbon's anchor one column toward it, and repeats until it is. This moves the view by whole columns. In the worst case the anchor reaches the focused column, which is then centered on the main monitor. A fully visible focused column moves nothing.
   - Vertically, it changes `top` just enough to show the focused ribbon. `top` never goes past the point where the last ribbon fills the last shown slot, so closing a ribbon at the end pulls the others back.

   Other ribbons keep their anchors.

`relayout()` is one function that computes the rectangle for every tiled window on every desktop and assigns `frameGeometry` to each. kolumn calls it after every event it handles. KWin's own placement, snapping, and quick-tiling can do whatever they do in the meantime. The next `relayout()` overrides them.

## Focus

`workspace.activeWindow` is the only record of focus. Shortcuts change focus by assigning to it. A `windowActivated` handler does the rest: it records the focused cell in its column, the focused column in its ribbon, and the focused ribbon, then scrolls and calls `relayout()`. This means Alt+Tab, clicking a taskbar entry, and new windows taking focus all scroll correctly with no extra code.

## Events

| KWin signal | kolumn action |
|---|---|
| `windowAdded` | Insert the window as a new column to the right of the focused column, in the focused ribbon of the window's desktop. The column width is the window's current `frameGeometry.width`. |
| `windowRemoved`, `minimizedChanged` (to true), `desktopsChanged` | Remove the window from the layout. For `desktopsChanged`, insert it into its new desktop's workspace using the `windowAdded` rule. Unminimizing also uses the `windowAdded` rule. |
| `windowActivated` | See the Focus section. |
| `interactiveMoveResizeStarted` | Record the window's start geometry and whether this is a move or a resize. |
| `interactiveMoveResizeFinished` | Apply the drop rule or the resize rule, then call `relayout()`. |
| `screensChanged`, `screenOrderChanged`, `virtualScreenGeometryChanged` | Call `relayout()`. |

A window that is on all desktops goes in the workspace of the current desktop when it is added.

At startup, kolumn adds every existing window from `workspace.windowList()` as if it had just opened. It does not save or restore layouts.

kolumn listens to `interactiveMoveResizeFinished` and not `interactiveMoveResizeStepped`. KWin draws the live move or resize itself, and kolumn rearranges everything once when you let go.

## Mouse

KWin's defaults are Meta+left-drag to move and Meta+right-drag to resize (`CommandAll1`/`CommandAll3`, set in `kwin/src/options.cpp:673-675`). kolumn reuses both and does not grab the mouse.

### Drop rule

The drop rule runs when a move finishes:

1. Find the tiled cell under `workspace.cursorPos`, other than the dragged window. kolumn looks this up in its own computed rectangles.
2. Pick the edge of that cell's rectangle closest to the cursor, measured as a fraction of the cell's width or height.
   - Top quarter: insert the dragged window as a cell above the target.
   - Bottom quarter: insert it as a cell below the target.
   - Left quarter: insert it as a new column to the left of the target's column.
   - Right quarter: insert it as a new column to the right.
   - Middle: swap the two windows.
3. If the pointer is over empty space, such as beside a ribbon narrower than its row or in the gap between two windows, the target is the nearest window at the pointer's height. The window becomes a new column on that window's side facing the pointer.
4. If the pointer is over the dragged window's own cell, or no window is at the pointer's height, the window snaps back to where it was, because the next `relayout()` puts it back.

Dragging never creates a ribbon. Only the keyboard does that.

### Resize rule

The resize rule runs when a resize finishes. KWin chooses which edge to drag from the 3x3 region of the window you grabbed (`kwin/src/window.cpp:2158-2161`). kolumn compares the final geometry with the start geometry:

- If the left or right edge moved, the column width becomes the new width.
- If the top or bottom edge moved and there is a neighbor cell on that side, kolumn moves weight between the two cells so the shared edge ends up where you released it.
- If the top or bottom edge moved and there is no neighbor cell on that side, which is always true for a one-cell column, kolumn moves weight the same way between the window's ribbon and the neighbor ribbon shown in the same row. With no ribbon shown on that side, nothing changes.
- Anything else is discarded by `relayout()`.

### Zoom out

Meta+Z opens a separate desktop effect, `kolumnzoom`. It shows a thumbnail of every tiled window on the current desktop at its real position, scaled so the whole layout, including off-screen columns and ribbons, fits on each screen. Clicking a thumbnail makes that window active and closes the effect, and kolumn then scrolls to it as it does for any focus change. Escape, or a click outside the thumbnails, closes the effect.

The effect does not read kolumn's state. kolumn keeps every window at its real position, so the window positions alone are the layout. KWin's Overview can't do this, because it rearranges windows into a grid that breaks up columns with more than one cell.

### Screen edges

Pushing the pointer into the left, right, top, or bottom screen edge does the same thing as Meta+Left, Right, Up, or Down (`registerScreenEdge`, `kwin/src/scripting/scripting.cpp:397`). Up and down step through cells before they reach the next ribbon. KWin only creates edges on the outer borders of the monitor layout, so there is no edge on a seam between two monitors. The activation and reactivation delays come from System Settings > Screen Edges. A pointer resting at the edge does not trigger it again.

kolumn does not keep any of a neighbor column visible at the screen edge. With focus follows mouse, a strip of the neighbor would end up under the pointer after every scroll, so each small pointer movement would focus the next column. Without the strip, a column scrolled in from the edge lines up with the edge, and the pointer sits on the window that just got focus.

## Keyboard

| Shortcut | Action |
|---|---|
| Meta+Left/Right | Focus the neighbor column. Stops at the ends of the ribbon. |
| Meta+Up/Down | Focus the neighbor cell. From the top or bottom cell, focus the ribbon above or below. |
| Meta+Shift+Left/Right | If the column has other cells, take the window out into its own column on that side. If the window is alone in its column, move it into the neighbor column at the gap between cells nearest the column's middle, counting the top and bottom edges as gaps. Ties go down, so joining a single cell puts the window below it. At the end of the ribbon, do nothing. |
| Meta+Shift+Up/Down | Swap with the neighbor cell. From the top or bottom cell, move into the ribbon above or below as a new column using the `windowAdded` rule. Create a new ribbon if there isn't one in that direction. |
| Meta+Ctrl+arrows | Switch virtual desktop. This is KDE's default binding, and kolumn does not change it. |
| Meta+Ctrl+Shift+arrows | Move the window to another virtual desktop. This is KDE's default, handled through `desktopsChanged`. |
| No default key | Increase or decrease window width: change the focused column's width by 100px. It never goes below the window's minimum width. |
| No default key | Increase or decrease window height: change the focused cell's height by 100px. Only that cell's weight changes, so the other cells in the column keep their proportions to each other. The cell stays at or above the window's minimum height and at or below 90% of the column. In a one-cell column, the ribbon's height changes the same way among the ribbons shown in its row. |
| No default key | Show more or fewer ribbons: change how many ribbons each monitor row shows, by one, never below 1. |

### Why these keys

The default shortcuts listed here come from the Plasma 6.6.4, kwin 6.6.4, and spectacle sources in `tmp/`. On a stock install, Meta+WASD conflicts with six bindings:

| Shortcut | Default action | Source |
|---|---|---|
| Meta+W | Overview | `kwin/src/plugins/overview/overvieweffect.cpp:140` |
| Meta+A | Activity switcher | `plasma-desktop/imports/activitymanager/switcherbackend.cpp:184` |
| Meta+Shift+A | Activity switcher, reverse | `plasma-desktop/imports/activitymanager/switcherbackend.cpp:189` |
| Meta+D | Show desktop | `kwin/src/useractions.cpp:981` |
| Meta+Shift+D | Minimize all | `kwin/src/plugins/minimizeall/package/contents/code/main.js:112` |
| Meta+Shift+S | Spectacle region capture | `spectacle/src/SpectacleCore.cpp:706` |

Meta+HJKL clashes with Meta+L, which is Lock Screen (`kscreenlocker/settings/kscreensaversettings.cpp:20`).

The arrow-key bindings that kolumn takes over only control features that stop mattering once kolumn places every window:

| Shortcut | Default action | Source |
|---|---|---|
| Meta+arrows | Quick tile | `kwin/src/useractions.cpp:879-883` |
| Meta+Shift+Left/Right | Window to previous or next screen | `kwin/src/useractions.cpp:951` |

Meta+Shift+Up/Down has no default binding. Meta+Ctrl+arrows is already "switch desktop" (`kwin/src/virtualdesktops.cpp:822-823`), which matches the rule that a workspace is a virtual desktop. Meta+Alt+arrows, KWin's directional focus (`kwin/src/useractions.cpp:895-901`), stays as it is and becomes redundant.

### One manual step

A key can only be bound to one action. kolumn's shortcuts are registered with `registerShortcut()` and appear under KWin in System Settings > Keyboard > Shortcuts. Before enabling kolumn, clear these KWin bindings so kolumn's defaults can claim the keys:

- Quick Tile Window to the Left, Right, Top, and Bottom.
- Window to Previous Screen and Window to Next Screen.

kolumn does not change other components' shortcuts on its own.

## Code layout

```
package/metadata.json        KPackageStructure "KWin/Script", X-Plasma-API "javascript"
package/contents/code/main.js   build output, not edited by hand
src/model.ts      nouns and pure operations (insert, remove, move, swap, drop, resize weights)
src/geometry.ts   pure functions: monitor rows, rectangles for every cell, minimal scroll
src/main.ts       KWin adapter: signal wiring, shortcuts, writing frameGeometry
test/*.test.ts    node:test against model.ts and geometry.ts
effect/metadata.json         KPackageStructure "KWin/Effect", X-Plasma-API "declarativescript"
effect/contents/ui/main.qml  the zoom-out effect
```

`model.ts` and `geometry.ts` do not touch KWin, so tests can run them in plain Node with plain objects. `main.ts` is the only file that uses KWin's API, and it holds no layout logic.

The build has two dev dependencies:

- `typescript` for type checking.
- `esbuild`, which bundles `src/main.ts` into one IIFE `main.js`. KWin loads that file as a plain script, not as an ES module.

Tests run with `node --test`. Node's built-in TypeScript type stripping handles the `.ts` files, so there is no test framework.

The code budget is about 400 lines of application code across the three `src` files, not counting tests. If the code grows past that, the design is doing too much.

## Steps

1. Scaffold the package: `metadata.json`, `package.json` with `build` and `test` scripts, `tsconfig.json`, and minimal type declarations for the parts of the KWin API that kolumn uses.
2. Write `model.ts` and its tests. This covers insert, remove, focus moves, Meta+Shift moves, drop, swap, and weight resize.
3. Write `geometry.ts` and its tests. Cover a single monitor, two side-by-side monitors of different heights, a column across a seam, two stacked monitors, monitors with panels, and minimal scroll in both directions.
4. Write `main.ts`: the event wiring, the shortcuts, and `relayout()`.
5. Install it and try it on the real desktop:
   ```
   kwriteconfig6 --file kwinrc --group Plugins --key kolumnEnabled true
   npm run reload      # build, install or upgrade, then restart the script and effect
   journalctl --user -f | grep -i kolumn           # script errors and console.warn() output
   ```
   `qdbus6 org.kde.KWin /KWin reconfigure` does not pick up a new build. KWin only loads scripts that are not already loaded (`kwin/src/scripting/scripting.cpp:774-790`), so `reload` unloads kolumn first.
6. Check each requirement by hand on one monitor, then on two:
   - Open and close windows.
   - Use every shortcut, including at the edges of columns and ribbons.
   - Drop into each quarter of a window, and drop onto nothing.
   - Resize the left and right edges, and the edge between two cells.
   - Go fullscreen and back.
   - Alt+Tab to an off-screen window.
   - Move a window to another desktop.
   - Unplug a monitor.

## Left out on purpose

These are left out because they add concepts or code without being required: floating windows, exemption lists, configurable gaps, drop-preview outlines, live rearranging during a drag, animations, width presets, Meta+wheel scrolling, saving and restoring layouts, Activities support, and a config UI.

KWin's Geometry Change desktop effect, which is part of kdeplasma-addons, can animate kolumn's moves with no code in kolumn. You can turn it on in System Settings if you want animations.
