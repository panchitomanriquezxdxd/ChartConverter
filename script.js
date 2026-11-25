/* Chart Converter V3 — interfaz. La lógica de conversión vive en converter.js */
const CC = window.ChartConverter;
const I18N = window.I18N;
const tr = (key, params) => I18N.t(key, params); // texto en el idioma activo (i18n.js)

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const convertBtn = document.getElementById("convert-btn");
const downloadZipBtn = document.getElementById("download-zip-btn");
const chartArea = document.getElementById("chart-area");
const metaArea = document.getElementById("meta-area");
const dropText = document.getElementById("drop-text");
const dropHint = document.getElementById("drop-hint");
const fileList = document.getElementById("file-list");
const fileNames = document.getElementById("file-names");
const warningsEl = document.getElementById("warnings");
const clearBtn = document.getElementById("clear-btn");
const toastEl = document.getElementById("toast");
const chartTitle = document.getElementById("chart-title");
const metaTitle = document.getElementById("meta-title");

// Metadatos extra
const albumToggle = document.getElementById("album-toggle");
const albumInput = document.getElementById("album-input");
const stickerToggle = document.getElementById("sticker-toggle");
const stickerInput = document.getElementById("sticker-input");

// Eventos incluidos
const cameraToggle = document.getElementById("camera-toggle");
const zoomToggle = document.getElementById("zoom-toggle");

// .fnfc
const instAudioInput = document.getElementById("inst-audio");
const oppAudioInput = document.getElementById("opp-audio");
const plyAudioInput = document.getElementById("ply-audio");
const fnfcBtn = document.getElementById("fnfc-btn");

const forwardModes = document.getElementById("forward-modes");
const inverseModes = document.getElementById("inverse-modes");
const statusForward = document.getElementById("status-forward");
const statusInverse = document.getElementById("status-inverse");
const metaExtraBox = document.getElementById("meta-extra-box");
const fnfcBox = document.getElementById("fnfc-box");

let selectedFiles = [];
let currentSongKey = "pack";
let direction = "forward";        // "forward" (→ V Slice) | "inverse" (V Slice →)
let converterMode = "psych";      // modo de origen (forward)
let inverseMode = "psych_v1";     // modo de destino (inverse)
let currentPack = null;           // { name, files: [{name, content}] } para el ZIP

const FORWARD_LABELS = {
    psych: "Psych Engine", psych063: "Psych 0.6.3 (Legacy)", kade: "Kade Engine",
    psych073: "Psych 0.7.3 (psych_v1)", psych104: "Psych 1.0.4 (psych_v1)",
    pslice: "P Slice", codename: "Codename Engine", funkinmaker: "Funkin Maker Mobile"
};
const INVERSE_LABELS = {
    psych_v1: "Psych 0.7+ / 1.0 / P Slice", legacy: "Psych 0.6.3 (Legacy)",
    kade: "Kade Engine", codename: "Codename Engine"
};

// Estado de la línea de estado: se guarda la CLAVE (no el texto) para volver a dibujarla si cambia el idioma.
let statusState = null;
function renderStatus() {
    fileList.textContent = !statusState ? "" : (statusState.raw !== undefined ? statusState.raw : tr(statusState.key, statusState.params));
}
function setStatus(key, params) { statusState = { key, params }; renderStatus(); }
function setStatusRaw(text) { statusState = text ? { raw: text } : null; renderStatus(); }

// ---------------------------------------------------------------- utilidades UI
function showEl(el, visible, display) {
    el.style.display = visible ? (display || "block") : "none";
}

// Aviso no bloqueante. alert() se cuelga o se omite en varios WebViews/PWA y bloquea la página.
let toastTimer = null;
function notify(message, kind) {
    toastEl.textContent = message;
    toastEl.className = "toast" + (kind ? " " + kind : "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === "error" ? 9000 : 4500);
}

function renderFileNames() {
    fileNames.textContent = "";
    selectedFiles.forEach(f => {
        const row = document.createElement("div");
        row.textContent = "• " + f.name;
        fileNames.appendChild(row);
    });
    clearBtn.style.display = selectedFiles.length ? "block" : "none";
}

// Avisos de la conversión (antes en modo normal solo iban a la consola, invisibles en móvil).
function renderWarnings(list) {
    warningsEl.textContent = "";
    (list || []).forEach(w => {
        const row = document.createElement("div");
        row.textContent = "⚠ " + w;
        warningsEl.appendChild(row);
    });
}

function resetOutputs() {
    selectedFiles = [];
    currentPack = null;
    setStatusRaw("");
    renderWarnings([]);
    renderFileNames();
    chartArea.value = "";
    metaArea.value = "";
    convertBtn.style.display = "none";
    downloadZipBtn.style.display = "none";
}

// keepTitles: al cambiar de idioma con un resultado ya mostrado, los títulos son nombres de archivo y no se tocan.
function refreshLabels(keepTitles) {
    if (direction === "forward") {
        dropText.innerHTML = converterMode === "funkinmaker"
            ? tr("drop.forward.fnmm")
            : tr("drop.forward", { mode: FORWARD_LABELS[converterMode] || "Psych Engine" });
        dropHint.textContent = tr("drop.hint.forward");
        convertBtn.textContent = tr("btn.convert");
        if (!keepTitles) { chartTitle.textContent = "chart.json"; metaTitle.textContent = "metadata.json"; }
        chartArea.placeholder = tr("ph.chart");
        metaArea.placeholder = tr("ph.meta");
    } else {
        dropText.innerHTML = tr("drop.inverse");
        dropHint.textContent = tr("drop.hint.inverse", { target: INVERSE_LABELS[inverseMode] });
        convertBtn.textContent = tr("btn.convert.inverse", { target: INVERSE_LABELS[inverseMode].toUpperCase() });
        if (!keepTitles) { chartTitle.textContent = tr("title.chart.inverse"); metaTitle.textContent = tr("title.meta.inverse"); }
        chartArea.placeholder = tr("ph.chart.inverse");
        metaArea.placeholder = tr("ph.meta.inverse");
    }
    downloadZipBtn.textContent = tr(direction === "forward" ? "btn.zip" : "btn.zip.inverse");
}

function setDirection(dir) {
    direction = dir;
    const fwd = dir === "forward";
    showEl(forwardModes, fwd);
    showEl(statusForward, fwd);
    showEl(inverseModes, !fwd);
    showEl(statusInverse, !fwd);
    showEl(metaExtraBox, fwd);
    showEl(fnfcBox, fwd);
    resetOutputs();
    refreshLabels();
}

// Radios: dirección / modo de origen / modo de destino
function bindRadioGroup(name, onChange) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.closest(".mode-card").classList.remove("selected"));
            radio.closest(".mode-card").classList.add("selected");
            onChange(radio.value);
        });
    });
}
bindRadioGroup("direction", setDirection);
bindRadioGroup("converter-mode", v => { converterMode = v; resetOutputs(); refreshLabels(); });
bindRadioGroup("inverse-mode", v => { inverseMode = v; resetOutputs(); refreshLabels(); });

albumToggle.addEventListener("change", e => {
    albumInput.disabled = !e.target.checked;
    if (e.target.checked) albumInput.focus();
});
stickerToggle.addEventListener("change", e => {
    stickerInput.disabled = !e.target.checked;
    if (e.target.checked) stickerInput.focus();
});

// ---------------------------------------------------------------- carga de archivos
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", e => {
    handleFiles(e.target.files);
    fileInput.value = ""; // permite volver a elegir el mismo archivo
});
dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
});
// Soltar un archivo FUERA de la zona hacía que el navegador/Electron lo abriera y se perdiera la página.
["dragover", "drop"].forEach(type => window.addEventListener(type, e => e.preventDefault()));

function isAccepted(name) {
    const n = name.toLowerCase();
    if (direction === "inverse") return n.endsWith(".json") || n.endsWith(".fnfc") || n.endsWith(".zip");
    return converterMode === "funkinmaker" ? n.endsWith(".fnmm") : n.endsWith(".json");
}

const fileKey = f => `${f.name}|${f.size}|${f.lastModified}`;

function handleFiles(files) {
    const incoming = Array.from(files || []);
    const valid = incoming.filter(f => isAccepted(f.name));
    const rejected = incoming.length - valid.length;

    // Si ya se convirtió algo, una nueva selección empieza de cero (si no, se mezclarían canciones).
    // Antes de convertir, los archivos se ACUMULAN: en el móvil es común elegirlos de uno en uno.
    if (currentPack) selectedFiles = [];
    const seen = new Set(selectedFiles.map(fileKey));
    valid.forEach(f => { if (!seen.has(fileKey(f))) { seen.add(fileKey(f)); selectedFiles.push(f); } });

    // Los resultados anteriores ya no corresponden a la nueva selección.
    chartArea.value = "";
    metaArea.value = "";
    currentPack = null;
    downloadZipBtn.style.display = "none";
    renderWarnings([]);
    renderFileNames();

    if (selectedFiles.length > 0) {
        setStatus("list.found", { n: selectedFiles.length });
        convertBtn.style.display = "block";
        if (rejected) notify(tr("list.ignored", { n: rejected }));
    } else {
        setStatus(direction === "inverse" ? "list.none.inverse" : (converterMode === "funkinmaker" ? "list.none.fnmm" : "list.none"));
        convertBtn.style.display = "none";
    }
}

clearBtn.addEventListener("click", resetOutputs);

document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyToClipboard(btn.dataset.copy, btn));
});

function copyToClipboard(areaId, button) {
    const textarea = document.getElementById(areaId);
    const reset = () => {
        button.innerText = tr("copy.label");
        button.style.borderColor = "";
        button.style.color = "";
    };
    if (!textarea.value) {
        button.innerText = tr("copy.empty");
        setTimeout(reset, 1500);
        return;
    }
    const done = () => {
        button.innerText = tr("copy.done");
        button.style.borderColor = "#00ff66";
        button.style.color = "#00ff66";
        setTimeout(reset, 2000);
    };
    const fallback = () => {
        textarea.focus();
        textarea.select();
        try {
            if (document.execCommand("copy")) return done();
        } catch (err) {
            console.error("Error al copiar código: ", err);
        }
        button.innerText = tr("copy.denied");
        setTimeout(reset, 1500);
    };
    // navigator.clipboard no existe en contextos no seguros (file://) o falla sin permisos.
    if (!navigator.clipboard || !window.isSecureContext) return fallback();
    navigator.clipboard.writeText(textarea.value).then(done).catch(fallback);
}

// ---------------------------------------------------------------- guardar archivos (multiplataforma)
// • App Android/iOS (Capacitor): los WebViews NO descargan blobs con <a download>. Se escribe el
//   archivo en caché con @capacitor/filesystem y se abre la hoja de compartir (@capacitor/share),
//   desde donde se puede "Guardar en Archivos / Descargas" o enviarlo a otra app.
// • PWA instalada en iOS: <a download> abre un visor sin salida → se usa la hoja de compartir web.
// • Web de escritorio / Android Chrome / Electron: descarga normal (Electron muestra "Guardar como").
function isNativeApp() {
    const cap = window.Capacitor;
    return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error(tr("err.readfile")));
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.readAsDataURL(blob);
    });
}

const isCancel = err => /cancel|abort|dismiss/i.test(String((err && (err.message || err.name)) || err));

async function saveNative(blob, filename) {
    const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    const { Filesystem, Share } = plugins;
    if (!Filesystem || !Share) throw new Error(tr("err.noplugins"));
    const written = await Filesystem.writeFile({
        path: filename,
        data: await blobToBase64(blob), // sin 'encoding' = base64
        directory: "CACHE",
        recursive: true
    });
    await Share.share({ title: filename, dialogTitle: tr("share.dialog"), files: [written.uri] });
}

function isIosStandalone() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return ios && (window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);
}

function saveViaAnchor(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); // Firefox antiguo exige que esté en el DOM
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveFile(blob, filename) {
    if (isNativeApp()) {
        try { return await saveNative(blob, filename); }
        catch (err) { if (isCancel(err)) return; console.warn("Guardado nativo falló, se intenta descarga normal:", err); }
    } else if (isIosStandalone() && navigator.canShare) {
        try {
            const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
            if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
        } catch (err) { if (isCancel(err)) return; console.warn("navigator.share falló, se intenta descarga normal:", err); }
    }
    saveViaAnchor(blob, filename);
}

function requireJSZip() {
    if (typeof JSZip === "undefined") {
        notify(tr("err.jszip"), "error");
        return false;
    }
    return true;
}

// ---------------------------------------------------------------- conversión normal (→ V Slice)
function psychModeFor(mode) {
    if (mode === "psych063" || mode === "kade") return "063";
    if (mode === "psych073") return "073";
    if (mode === "psych104") return "104";
    if (mode === "pslice") return "absolute";
    return "auto";
}

async function runForward() {
    const isCodename = converterMode === "codename";
    const isFunkinMaker = converterMode === "funkinmaker";
    const finalChart = {
        version: "2.0.0",
        scrollSpeed: {},
        notes: {},
        events: [],
        generatedBy: isCodename ? `${CC.GENERATED_BY} (Codename → V Slice)`
            : isFunkinMaker ? `${CC.GENERATED_BY} (Funkin Maker → V Slice)` : CC.GENERATED_BY
    };
    let finalMeta = null;
    let songKey = "pack";
    const activeDifficulties = [];
    const warnings = [];
    const seenEvents = new Set();
    const seenWarnings = new Set();
    const pushWarnings = (file, list) => list.forEach(w => {
        // Mismo aviso en varias dificultades (p. ej. un evento sin equivalente de events.json): una sola vez.
        if (seenWarnings.has(w)) return;
        seenWarnings.add(w);
        warnings.push(`${file.name}: ${w}`);
    });

    // Los eventos de V-Slice son globales: se deduplican entre dificultades y archivos.
    const addEvents = list => list.forEach(ev => {
        if (ev.e === "FocusCamera" && !cameraToggle.checked) return;
        if (ev.e === "ZoomCamera" && !zoomToggle.checked) return;
        const k = `${ev.t}|${ev.e}|${JSON.stringify(ev.v)}`;
        if (seenEvents.has(k)) return;
        seenEvents.add(k);
        finalChart.events.push(ev);
    });

    // 1) Se leen todos los archivos. events.json de Psych no es una dificultad: aporta eventos a la canción
    //    entera y se convierte junto a cada chart (necesita su BPM y sus secciones), sin importar el orden de subida.
    const charts = [];
    let extraEvents = [];
    for (const file of selectedFiles) {
        if (isFunkinMaker) {
            // Un .FNMM es un ZIP: data.json (notas) + events.json + scene.json.
            if (!requireJSZip()) throw new Error(tr("err.nojszip"));
            let parts;
            try {
                parts = await CC.readFunkinMakerArchive(await JSZip.loadAsync(file));
            } catch (err) {
                throw new Error(tr("err.fileprefix", { file: file.name, msg: err.message }));
            }
            charts.push({ file, rawData: parts.data, extra: parts });
            continue;
        }
        let rawData;
        try {
            rawData = CC.parseJson(await file.text());
        } catch (err) {
            throw new Error(tr("err.badjson", { file: file.name, msg: err.message }));
        }
        if (!isCodename && CC.isPsychEventsFile(file.name)) {
            try {
                extraEvents = extraEvents.concat(CC.readPsychEventsFile(rawData));
            } catch (err) {
                throw new Error(tr("err.fileprefix", { file: file.name, msg: err.message }));
            }
        } else {
            charts.push({ file, rawData });
        }
    }
    if (!charts.length) {
        throw new Error(tr(extraEvents.length ? "err.onlyevents" : "err.nocharts"));
    }

    // 2) Conversión de cada chart
    for (const { file, rawData, extra } of charts) {
        let result;
        try {
            result = isFunkinMaker
                ? CC.convertFunkinMakerToVSlice(rawData, extra, file)
                : isCodename
                    ? CC.convertCodenameToVSlice(rawData)
                    : CC.convertPsychToVSlice(rawData, file, psychModeFor(converterMode), { extraEvents });
        } catch (err) {
            throw new Error(tr("err.fileprefix", { file: file.name, msg: err.message }));
        }

        const diff = CC.getDiff(file.name);
        if (activeDifficulties.includes(diff)) warnings.push(tr("warn.dupdiff", { diff, file: file.name }));
        else activeDifficulties.push(diff);
        if (songKey === "pack") songKey = CC.slug(result.canonicalKey, "pack");

        finalChart.scrollSpeed[diff] = result.speed;
        finalChart.notes[diff] = result.notesArr;
        pushWarnings(file, result.warnings);
        if (!result.notesArr.length) warnings.push(tr("warn.nonotes", { file: file.name }));

        addEvents(result.eventsArr);

        if (!finalMeta) {
            finalMeta = { result };
        }
    }

    const r = finalMeta.result;
    const meta = CC.buildVSliceMeta({
        songName: r.songName,
        bpm: r.bpm,
        player1: r.player1,
        player2: r.player2,
        girlfriend: r.girlfriend,
        stage: r.stage,
        difficulties: activeDifficulties,
        timeChanges: r.timeChanges,
        stickerPack: stickerToggle.checked ? (stickerInput.value.trim() || "Custom Stickers") : null,
        album: albumToggle.checked ? (albumInput.value.trim() || "Custom Album") : null
    });

    finalChart.events.sort((a, b) => a.t - b.t);
    chartArea.value = JSON.stringify(finalChart, null, 2);
    metaArea.value = JSON.stringify(meta, null, 2);

    currentSongKey = songKey;
    currentPack = {
        name: `${songKey}_VSlice_Pack.zip`,
        files: [
            { name: `${songKey}-chart.json`, content: chartArea.value },
            { name: `${songKey}-metadata.json`, content: metaArea.value }
        ]
    };
    return { songKey, warnings };
}

// ---------------------------------------------------------------- conversión inversa (V Slice →)
function looksLikeVSliceChart(o) {
    return o && typeof o === "object" && o.notes && typeof o.notes === "object" && !Array.isArray(o.notes) &&
        (o.scrollSpeed !== undefined || Object.values(o.notes).some(Array.isArray));
}
function looksLikeVSliceMeta(o) {
    return o && typeof o === "object" && (o.playData || Array.isArray(o.timeChanges) || o.songName);
}

async function collectJsonEntries() {
    const entries = []; // { name, text }
    for (const file of selectedFiles) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".fnfc") || lower.endsWith(".zip")) {
            if (!requireJSZip()) throw new Error(tr("err.nojszip"));
            let zip;
            try {
                zip = await JSZip.loadAsync(file);
            } catch (err) {
                throw new Error(tr("err.zipopen", { file: file.name, msg: err.message }));
            }
            // Se ignoran manifest.json y la basura que macOS mete en los ZIP (__MACOSX/, ._archivo.json),
            // que antes rompía la conversión con "no es un JSON válido".
            const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && n.toLowerCase().endsWith(".json") &&
                !/(^|\/)manifest\.json$/i.test(n) && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\._[^/]*$/.test(n));
            for (const n of names) entries.push({ name: n, text: await zip.files[n].async("string") });
        } else {
            entries.push({ name: file.name, text: await file.text() });
        }
    }
    return entries;
}

async function runInverse() {
    const entries = await collectJsonEntries();
    const warnings = [];
    const chart = { notes: {}, scrollSpeed: {}, events: [] };
    let meta = null;
    let metaIsBase = false;
    let chartCount = 0;
    const seenEvents = new Set();

    for (const entry of entries) {
        let obj;
        try {
            obj = CC.parseJson(entry.text);
        } catch (err) {
            throw new Error(tr("err.badjson", { file: entry.name, msg: err.message }));
        }
        if (looksLikeVSliceChart(obj)) {
            chartCount++;
            Object.keys(obj.notes).forEach(d => {
                if (chart.notes[d]) warnings.push(tr("warn.dupdiff.inverse", { diff: d, file: entry.name }));
                chart.notes[d] = obj.notes[d];
            });
            Object.assign(chart.scrollSpeed, obj.scrollSpeed || {});
            (Array.isArray(obj.events) ? obj.events : []).forEach(ev => {
                const k = `${ev.t}|${ev.e}|${JSON.stringify(ev.v)}`;
                if (!seenEvents.has(k)) { seenEvents.add(k); chart.events.push(ev); }
            });
        } else if (looksLikeVSliceMeta(obj)) {
            // Un .fnfc puede traer metadata de variaciones ("-metadata-erect.json"): se prefiere la base
            // ("-metadata.json"), en vez de quedarse con la que casualmente viniera primero en el ZIP.
            const isBase = /(^|[\\/])[^\\/]*-metadata\.json$/i.test(entry.name);
            if (!meta) { meta = obj; metaIsBase = isBase; }
            else if (isBase && !metaIsBase) {
                warnings.push(tr("warn.basemeta", { file: entry.name }));
                meta = obj; metaIsBase = true;
            } else warnings.push(tr("warn.extrameta", { file: entry.name }));
        } else {
            warnings.push(tr("warn.notvslice", { file: entry.name }));
        }
    }

    if (!chartCount) {
        throw new Error(tr("err.novslice"));
    }
    chart.events.sort((a, b) => a.t - b.t);

    const result = CC.convertVSliceToTarget(chart, meta, inverseMode, {
        camera: cameraToggle.checked,
        zoom: zoomToggle.checked,
        songKey: CC.songKeyFromFile(selectedFiles[0].name)
    });
    warnings.push(...result.warnings);

    chartArea.value = result.files[0].content;
    chartTitle.textContent = result.files[0].name;
    const report = [
        tr("report.song", { v: result.songName }),
        tr("report.target", { v: INVERSE_LABELS[inverseMode] }),
        tr("report.diffs", { v: result.difficulties.join(", ") }),
        "",
        tr("report.files"),
        ...result.files.map(f => `  • ${f.name}`),
        ...(warnings.length ? ["", tr("report.warnings"), ...warnings.map(w => `  ⚠ ${w}`)] : [])
    ];
    metaArea.value = report.join("\n");

    const suffix = { psych_v1: "Psych", legacy: "Psych063", kade: "Kade", codename: "Codename" }[inverseMode];
    currentPack = { name: `${result.key}_${suffix}_Pack.zip`, files: result.files };
    return { songKey: result.key, warnings };
}

// ---------------------------------------------------------------- acciones
async function runConversion() {
    if (selectedFiles.length === 0) return null;
    convertBtn.disabled = true;
    try {
        const res = direction === "inverse" ? await runInverse() : await runForward();
        downloadZipBtn.style.display = "block";
        // En modo inverso los avisos ya aparecen en el panel derecho; en modo normal se listan aquí.
        renderWarnings(direction === "forward" ? res.warnings : []);
        if (res.warnings.length) setStatus(direction === "inverse" ? "done.warn.inverse" : "done.warn.forward", { n: res.warnings.length });
        else setStatus("done.ok");
        return res;
    } catch (err) {
        notify(tr("err.convert", { msg: err.message }), "error");
        console.error(err);
        setStatusRaw("❌ " + err.message);
        chartArea.value = "";
        metaArea.value = "";
        currentPack = null;
        downloadZipBtn.style.display = "none";
        return null;
    } finally {
        convertBtn.disabled = false;
    }
}

convertBtn.addEventListener("click", runConversion);

downloadZipBtn.addEventListener("click", async () => {
    if (!currentPack || !requireJSZip()) return;
    downloadZipBtn.disabled = true;
    try {
        const zip = new JSZip();
        currentPack.files.forEach(f => zip.file(f.name, f.content));
        const blob = await zip.generateAsync({ type: "blob" });
        await saveFile(blob, currentPack.name);
    } catch (err) {
        console.error(err);
        notify(tr("err.zip", { msg: err.message }), "error");
    } finally {
        downloadZipBtn.disabled = false;
    }
});

fnfcBtn.addEventListener("click", async () => {
    if (!requireJSZip()) return;
    const instFile = instAudioInput.files[0];

    // Se validan los requisitos ANTES de convertir (antes se convertía primero y el error de
    // "falta Inst.ogg" aparecía después de haber procesado todo).
    if (selectedFiles.length === 0) {
        notify(tr("err.nofiles"), "error");
        return;
    }
    if (!instFile) {
        notify(tr("err.noinst"), "error");
        instAudioInput.focus();
        return;
    }
    // El pack guarda los audios como .ogg: un mp3/wav renombrado dentro del .fnfc no suena en el juego.
    const notOgg = f => f && !/\.(ogg|oga)$/i.test(f.name) && !/ogg/i.test(f.type || "");
    const badAudio = [instAudioInput.files[0], oppAudioInput.files[0], plyAudioInput.files[0]].find(notOgg);
    if (badAudio) {
        notify(tr("err.notogg", { file: badAudio.name }), "error");
        return;
    }

    fnfcBtn.disabled = true;
    try {
        // Se reconvierte siempre para reflejar los interruptores actuales (cámara, zoom, álbum, stickers).
        const res = await runConversion();
        if (!res) return;

        const songKey = currentPack.files[0].name.replace(/-chart\.json$/, "") || "song";
        const plyFile = plyAudioInput.files[0];
        const oppFile = oppAudioInput.files[0];

        // La metadata declara voces por defecto; si no se subieron esos audios se quitan,
        // para que el juego no busque archivos que no existen dentro del .fnfc.
        const files = currentPack.files.map(f => {
            if (!f.name.endsWith("-metadata.json")) return f;
            try {
                const meta = JSON.parse(f.content);
                const chars = meta && meta.playData && meta.playData.characters;
                if (chars) {
                    if (!plyFile) chars.playerVocals = [];
                    if (!oppFile) chars.opponentVocals = [];
                }
                return { name: f.name, content: JSON.stringify(meta, null, 2) };
            } catch (err) { return f; }
        });

        const zip = new JSZip();
        zip.file("manifest.json", JSON.stringify({ version: "1.0.0", songId: songKey }, null, 2));
        files.forEach(f => zip.file(f.name, f.content));
        zip.file("Inst.ogg", instFile);
        if (plyFile) zip.file("Voices-Player.ogg", plyFile);
        if (oppFile) zip.file("Voices-Opponent.ogg", oppFile);

        const blob = await zip.generateAsync({ type: "blob" });
        await saveFile(blob, `${songKey}.fnfc`);
    } catch (err) {
        console.error(err);
        notify(tr("err.fnfc", { msg: err.message }), "error");
    } finally {
        fnfcBtn.disabled = false;
    }
});

// ---------------------------------------------------------------- PWA (instalable + offline)
// Solo en http(s) y fuera de las apps empaquetadas (Electron usa file://, Capacitor ya trae todo local).
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !isNativeApp()) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker no registrado:", err));
    });
}

// ---------------------------------------------------------------- idioma
// El selector se rellena con los idiomas de i18n.js; la elección se recuerda (localStorage) y, si no hay una,
// se usa el idioma del navegador. Al cambiar, se redibuja todo lo que lleva data-i18n y los textos dinámicos.
const langSelect = document.getElementById("lang-select");
I18N.LANGS.forEach(l => {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.name;
    langSelect.appendChild(opt);
});
langSelect.value = I18N.getLang();
langSelect.addEventListener("change", () => I18N.setLang(langSelect.value, true));
I18N.onChange(code => {
    langSelect.value = code;
    I18N.applyDom();
    refreshLabels(!!currentPack);
    renderStatus();
    // Los avisos y el informe ya generados están en el idioma anterior: se reconvierte (es instantáneo) para traducirlos.
    if (currentPack && selectedFiles.length && !convertBtn.disabled) runConversion();
});

I18N.applyDom();
refreshLabels();
