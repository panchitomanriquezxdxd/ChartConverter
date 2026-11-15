#!/usr/bin/env node
"use strict";
/* Copia los archivos de la app web a ./www, que es la carpeta que Capacitor empaqueta en el APK / IPA.
 * (sw.js no se copia a propósito: las apps nativas ya traen todo local y no necesitan service worker.) */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "www");

const FILES = ["index.html", "style.css", "script.js", "converter.js", "manifest.webmanifest", "favicon.svg", "favicon.ico"];
const DIRS = ["icons", "vendor"];

const missing = [...FILES, ...DIRS].filter(p => !fs.existsSync(path.join(root, p)));
if (missing.length) {
    console.error("Faltan archivos para construir la app web: " + missing.join(", "));
    process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
FILES.forEach(f => fs.copyFileSync(path.join(root, f), path.join(out, f)));
DIRS.forEach(d => fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true }));

console.log(`www/ listo: ${FILES.length} archivos + ${DIRS.join(", ")}`);
