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
3. Enable the script, then build, install, and start it:
   ```
   kwriteconfig6 --file kwinrc --group Plugins --key kolumnEnabled true
   npm run reload
   ```

To see script errors and `console.warn()` output, run `journalctl --user -f | grep -i kolumn`.

If another action already has one of kolumn's keys when kolumn first starts, that kolumn shortcut is saved with no key. Clearing the other binding later does not move the key over. Look for these in `~/.config/kglobalshortcutsrc`:

```
grep -E 'Meta\+(Shift\+)?(Left|Right|Up|Down)|^kolumn' ~/.config/kglobalshortcutsrc
```

Each line reads `name=active keys,default keys,label`, and `\t` separates two active keys. An empty active field on a `kolumn` line means the shortcut has no key. Any other action listing a Meta+arrow key owns it. For example, `Switch Window Left=Meta+Alt+Left\tMeta+Left` gives Meta+Left to KWin's directional focus. Remove those keys, then assign them to the `kolumn:` shortcuts in System Settings > Keyboard > Shortcuts > KWin.

## Upgrades

```
git pull
npm install
npm run reload
```

`npm run reload` unloads the running script and starts it again. Running `qdbus6 org.kde.KWin /KWin reconfigure` is not enough: KWin does not reload a script that is already running, so the old code keeps running. Reloading rebuilds the layout from scratch, so every window starts out in its own column.
