import QtQuick
import org.kde.kwin

// Shows every tiled window on the current desktop at its real position,
// scaled so the whole layout fits on each screen. Clicking a window focuses
// it, and kolumn scrolls to it as it does for any focus change.
SceneEffect {
    id: effect

    delegate: Rectangle {
        id: view
        focus: true
        color: "#cc000000"

        // The same windows kolumn tiles, as in src/main.ts. The list is read
        // once, when the view is created each time the effect opens, because
        // stackingOrder and popupWindow have no change signals to bind to.
        property var windows: []
        Component.onCompleted: windows = Workspace.stackingOrder.filter(w =>
            w.managed && (w.normalWindow || w.dialog) && !w.popupWindow && w.opacity > 0 && w.moveableAcrossScreens && !w.minimized
            && (w.onAllDesktops || w.desktops.includes(Workspace.currentDesktop)))
        readonly property rect bounds: {
            const gs = windows.map(w => w.frameGeometry);
            const x = Math.min(...gs.map(g => g.x)), y = Math.min(...gs.map(g => g.y));
            return Qt.rect(x, y, Math.max(...gs.map(g => g.x + g.width)) - x, Math.max(...gs.map(g => g.y + g.height)) - y);
        }
        readonly property real scale: 0.95 * Math.min(width / bounds.width, height / bounds.height)

        Keys.onEscapePressed: effect.visible = false
        MouseArea {
            anchors.fill: parent
            onClicked: effect.visible = false
        }

        Repeater {
            model: view.windows
            WindowThumbnail {
                required property var modelData
                client: modelData
                x: (view.width - view.bounds.width * view.scale) / 2 + (modelData.frameGeometry.x - view.bounds.x) * view.scale
                y: (view.height - view.bounds.height * view.scale) / 2 + (modelData.frameGeometry.y - view.bounds.y) * view.scale
                width: modelData.frameGeometry.width * view.scale
                height: modelData.frameGeometry.height * view.scale

                MouseArea {
                    anchors.fill: parent
                    onClicked: {
                        Workspace.activeWindow = parent.modelData;
                        effect.visible = false;
                    }
                }
            }
        }
    }

    ShortcutHandler {
        name: "kolumn zoom"
        text: "kolumn: Zoom Out"
        sequence: "Meta+Z"
        onActivated: effect.visible = !effect.visible
    }
}
