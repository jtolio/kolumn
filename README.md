# kolumn

A KWin script for Plasma 6.6 that arranges windows into scrolling columns. See `PLAN.md` for how it works.

## Installation

You need Node.js and npm to build it.

1. Install the build dependencies:
   ```
   npm install
   ```
2. In System Settings > Keyboard > Shortcuts > KWin, clear these bindings so kolumn's Meta+arrow shortcuts can take the keys:
   - Quick Tile Window to the Left, Right, Top, and Bottom
   - Window to Previous Screen
   - Window to Next Screen
3. Enable the script and the zoom-out effect, then build, install, and start them:
   ```
   kwriteconfig6 --file kwinrc --group Plugins --key kolumnEnabled true
   kwriteconfig6 --file kwinrc --group Plugins --key kolumnzoomEnabled true
   npm run reload
   ```
   The zoom-out effect opens with Meta+Z.

To see script errors and `console.warn()` output, run `journalctl --user -f | grep -i kolumn`.

If another action already has one of kolumn's keys when kolumn first starts, that kolumn shortcut is saved with no key. Clearing the other binding later does not move the key over. Look for these in `~/.config/kglobalshortcutsrc`:

```
grep -E 'Meta\+(Shift\+)?(Left|Right|Up|Down)|^kolumn' ~/.config/kglobalshortcutsrc
```

Each line reads `name=active keys,default keys,label`, and `\t` separates two active keys. An empty active field on a `kolumn` line means the shortcut has no key. Any other action listing a Meta+arrow key owns it. For example, `Switch Window Left=Meta+Alt+Left\tMeta+Left` gives Meta+Left to KWin's directional focus. Remove those keys, then assign them to the `kolumn:` shortcuts in System Settings > Keyboard > Shortcuts > KWin.

## Settings

kolumn has two settings, on its settings page under System Settings > Window Management > KWin Scripts:

- Gap between windows, in pixels. The default is 6.
- Ribbons per row at start, which is how many ribbons each monitor row shows when kolumn starts. The default is 2. The show more or fewer ribbons shortcuts still change it afterwards.

The settings are stored in the `[Script-kolumn]` group of `kwinrc`, so you can also set them with `kwriteconfig6 --file kwinrc --group Script-kolumn --key Gap 10`. kolumn reads them only when it starts, so run `npm run reload` after changing them. KWin's settings page does not tell a running script that its settings changed.

## Upgrades

```
git pull
npm install
npm run reload
```

`npm run reload` unloads the running script and effect and starts them again. Running `qdbus6 org.kde.KWin /KWin reconfigure` is not enough: KWin does not reload a script that is already running, so the old code keeps running. Reloading rebuilds the layout from scratch, so every window starts out in its own column.
