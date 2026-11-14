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

## Upgrades

```
git pull
npm install
npm run reload
```

`npm run reload` unloads the running script and starts it again. Running `qdbus6 org.kde.KWin /KWin reconfigure` is not enough: KWin does not reload a script that is already running, so the old code keeps running. Reloading rebuilds the layout from scratch, so every window starts out in its own column.
