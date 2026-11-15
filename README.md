# Chart Converter

Convierte charts de FNF entre **Psych (0.6.3 / 0.7 / 1.0 / P-Slice), Kade, Codename y V-Slice** (`.fnfc`), en los dos sentidos.
Por Panchito Manriquez & Deiby [GamerCB].

Funciona en **Web, Windows, Linux, Android e iOS** con el mismo código (`index.html` + `script.js` + `converter.js`).

## Descargas (apps)

Ve a la pestaña **Actions → Build apps → Run workflow** y descarga los archivos de la sección *Artifacts*.
Si subes un tag (`git tag v3.1.0 && git push origin v3.1.0`) los archivos se publican solos en **Releases**.

| Plataforma | Archivo | Notas |
|---|---|---|
| Windows | `ChartConverter-Setup-*.exe` / `ChartConverter-Portable-*.exe` | Instalador o portable |
| Linux | `ChartConverter-*.AppImage` / `.deb` | `chmod +x` al AppImage y ejecútalo |
| Android | `ChartConverter-*-android.apk` | APK de depuración, instalable directo (activa "instalar apps desconocidas") |
| iOS | `ChartConverter-*-ios-unsigned.ipa` | **Sin firmar**: hay que firmarlo (AltStore, Sideloadly o tu cuenta de Apple Developer) |
| Cualquiera | la versión web | Se puede **instalar como app (PWA)** y funciona sin internet |

> En iOS no se puede instalar un `.ipa` sin firmar directamente; la opción más simple es abrir la versión web en Safari → *Compartir → Añadir a pantalla de inicio*.

## Uso web / PWA

Publica el repo con **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root) y abre la URL.
En Chrome/Edge/Android aparece "Instalar app"; en iOS Safari: *Compartir → Añadir a pantalla de inicio*.

Para probar en local: `npx serve .` (el service worker exige http, no `file://`).

## Desarrollo

```bash
npm install           # solo si vas a compilar las apps
npm test              # pruebas del convertidor (Node 22, no necesita dependencias)
npm start             # abre la app de escritorio (Electron)
npm run dist:win      # instalador Windows  (en Windows)
npm run dist:linux    # AppImage + deb      (en Linux)
npm run build:web     # copia la app a www/ para Capacitor
npx cap add android && npx capacitor-assets generate --android && npx cap sync android
```

El icono se genera desde un único diseño: `npm run icons` (requiere `rsvg-convert` e ImageMagick) y reescribe `icons/`, `assets/*.png`, `build/icon.png` y `favicon.*`.

## Estructura

- `converter.js` — núcleo de conversión, sin DOM (se prueba con `npm test`)
- `script.js`, `index.html`, `style.css` — interfaz
- `vendor/jszip.min.js` — JSZip incluido (no depende de internet)
- `sw.js`, `manifest.webmanifest` — PWA (instalable y offline)
- `electron/` — app de escritorio · `capacitor.config.json` — Android/iOS
- `.github/workflows/` — CI y compilación de todas las plataformas
