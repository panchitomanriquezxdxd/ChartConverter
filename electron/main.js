"use strict";
/* Chart Converter — app de escritorio (Windows / Linux) con Electron.
 * Carga el mismo index.html que la versión web: no hay lógica duplicada. */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

// Linux: en Ubuntu 24.04+ (AppArmor limita los "user namespaces") y en AppImage el sandbox SUID de
// Chromium suele impedir que la app arranque. La app solo abre archivos locales propios y bloquea
// toda navegación externa (ver más abajo), por lo que el riesgo es mínimo.
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");

let win = null;

function isExternal(url) {
    return /^https?:\/\//i.test(url);
}

function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 900,
        minWidth: 360,
        minHeight: 600,
        backgroundColor: "#030508",
        title: "Chart Converter",
        icon: path.join(__dirname, "..", "icons", "icon-512.png"),
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, "..", "index.html"));

    // Enlaces externos → navegador del sistema; la ventana nunca navega fuera de la app.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternal(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("file://")) {
            event.preventDefault();
            if (isExternal(url)) shell.openExternal(url);
        }
    });

    // Depuración opcional:  CC_DEVTOOLS=1 npm start
    if (process.env.CC_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });

    win.on("closed", () => { win = null; });
}

// Una sola instancia: abrir la app otra vez enfoca la ventana existente.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
    app.whenReady().then(createWindow);
    app.on("window-all-closed", () => app.quit());
}
