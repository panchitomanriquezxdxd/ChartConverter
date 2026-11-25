/* Service worker de Chart Converter: permite instalar la app (PWA) y usarla sin conexión.
 * Estrategia: "stale-while-revalidate" — responde al instante desde caché y se actualiza en segundo plano.
 * Sube CACHE_VERSION cuando cambies archivos para forzar que todos los dispositivos se actualicen. */
const CACHE_VERSION = "v2";
const CACHE = `chartconverter-${CACHE_VERSION}`;

const ASSETS = [
    "./",
    "index.html",
    "style.css",
    "script.js",
    "converter.js",
    "vendor/jszip.min.js",
    "manifest.webmanifest",
    "favicon.svg",
    "favicon.ico",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-192.png",
    "icons/maskable-512.png",
    "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith("chartconverter-") && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // solo archivos propios

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req).then(res => {
            if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
            return res;
        }).catch(() => null);

        if (cached) { event.waitUntil(network); return cached; }
        const res = await network;
        if (res) return res;
        // Sin red y sin caché: para navegaciones se sirve la app.
        if (req.mode === "navigate") {
            const shell = await cache.match("index.html");
            if (shell) return shell;
        }
        return new Response("Sin conexión", { status: 503, statusText: "Offline" });
    })());
});
