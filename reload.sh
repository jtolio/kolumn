#!/bin/sh
# Builds kolumn, installs or upgrades the script and the zoom effect, then
# restarts both. KWin's reconfigure never reloads a running script or effect.
set -e
npm run build
kpackagetool6 --type=KWin/Script -u package/ || kpackagetool6 --type=KWin/Script -i package/
kpackagetool6 --type=KWin/Effect -u effect/ || kpackagetool6 --type=KWin/Effect -i effect/
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript kolumn
qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect kolumnzoom
qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect kolumnzoom
