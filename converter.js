/* =====================================================================
 *  Chart Converter V3 — núcleo de conversión (sin DOM, probable en Node)
 *  Normal : Psych / Kade / Codename / Funkin Maker Mobile (.FNMM)  →  V Slice
 *  Inversa: V Slice  →  Psych (psych_v1 / legacy) / Kade / Codename
 * ===================================================================== */
(function (root) {
    "use strict";

    // Textos (avisos y errores) en el idioma activo; i18n.js debe cargarse antes que este archivo.
    const I18N = root.I18N || (typeof require !== "undefined" ? require("./i18n.js") : null);
    const t = (key, params) => I18N.t(key, params);

    const KNOWN_DIFFS = ["easy", "normal", "hard", "erect", "nightmare"];
    const DEFAULT_RATINGS = { easy: 3, normal: 5, hard: 6, erect: 7, nightmare: 8 };
    // Firma que se escribe en el campo "generatedBy" de todo lo que genera la herramienta.
    const GENERATED_BY = "Chart Converter - Panchito & Deiby";

    // ------------------------------------------------------------ utilidades
    function parseJson(text) {
        // Quita BOM (muchos editores de Windows lo añaden y JSON.parse revienta).
        return JSON.parse(String(text).replace(/^\uFEFF/, ""));
    }
    function toNum(v, fallback) {
        const n = typeof v === "number" ? v : parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    }
    const round3 = x => Math.round(x * 1000) / 1000;
    const round4 = x => Math.round(x * 10000) / 10000;
    function slug(s, fb) {
        // NFD + quitar marcas: "Ñandú" → "nandu" (antes quedaba "and" porque ñ/ú se descartaban).
        const r = String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "")
            .toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
        return r || fb || "song";
    }
    function baseName(name) {
        return String(name || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    }
    // Quita el "ruido" que añaden las descargas y las copias al nombre: "cancion-hard (1)", "cancion-hard - copy",
    // "cancion-hard-chart", "cancion-hard-2". Antes esos nombres no se reconocían y la dificultad caía a "normal":
    // el pack salía sin la dificultad esperada y V Slice fallaba al cargarla ("error retrieving note data").
    function stripFileNoise(name) {
        let b = String(name || "").toLowerCase().trim(), prev;
        do {
            prev = b;
            b = b.replace(/\s*\(\d+\)$/, "")
                 .replace(/[-_ .]+(copy|copia|copie|cópia|kopie)(\s*\d+)?$/, "")
                 .replace(/[-_ .]+(chart|metadata)$/, "")
                 .replace(/([-_ .](?:easy|normal|hard|erect|nightmare))[-_ ]\d+$/, "$1")
                 .trim();
        } while (b !== prev);
        return b;
    }
    function getDiff(name) {
        const lower = stripFileNoise(baseName(name));
        for (const d of KNOWN_DIFFS) {
            if (lower === d || [...lower.matchAll(/[-_ .]/g)].some(m => lower.slice(m.index + 1) === d)) return d;
        }
        return "normal";
    }
    function songKeyFromFile(name) {
        let b = stripFileNoise(baseName(name));
        // Quita sufijos en cualquier orden ("cancion-erect-chart" y "cancion-chart-erect" → "cancion").
        // Antes solo se quitaba la dificultad al final, así que "cancion-erect-chart" dejaba "cancion-erect".
        let changed = true;
        while (changed) {
            changed = false;
            const m = b.match(/^(.+?)[-_ .](chart|metadata|easy|normal|hard|erect|nightmare)$/);
            if (m) { b = m[1]; changed = true; }
        }
        return b;
    }

    // ------------------------------------------------------------ eventos de Psych (chart y events.json)
    // Los eventos se acumulan "crudos" y se convierten al final (build): algunos necesitan saber el BPM de
    // ese momento (Change Scroll Speed) o la cámara de cada sección (Camera Follow Pos).
    //   FocusCamera / Camera Follow Pos → FocusCamera      Add Camera Zoom (y similares) → ZoomCamera
    //   Hey! / Play Animation           → PlayAnimation    Change Scroll Speed           → ScrollSpeed
    function createPsychEventCollector() {
        const raw = []; // { name, v1, v2, t }
        const add = (name, v1, t, v2) => { if (Number.isFinite(t)) raw.push({ name, v1, v2, t }); };
        const toZoom = (key, value) => {
            // "Add Camera Zoom" suma (0.015 por defecto) → zoom relativo al stage = 1 + valor.
            // El resto de eventos "zoom" llevan el zoom absoluto.
            const zoom = key === "addcamerazoom" ? 1 + toNum(value, 0.015) : toNum(value, 1);
            return { ease: "expoInOut", duration: 4, mode: "stage", zoom: round4(zoom) };
        };
        const str = v => String(v == null ? "" : v).trim();

        const build = ctx => {
            const bpmAt = (ctx && ctx.bpmAt) || (() => 100);
            const eventsArr = [];
            const followPos = []; // Camera Follow Pos: se resuelve junto con la cámara de las secciones
            const skippedEvents = new Map(); // nombre → cantidad (eventos sin equivalente en V-Slice)
            const play = (t, target, anim) => eventsArr.push({ t, e: "PlayAnimation", v: { target, anim, force: true } });

            raw.forEach(({ name, v1, v2, t }) => {
                const key = str(name).toLowerCase().replace(/[^a-z]/g, "");
                const s1 = str(v1), s2 = str(v2);
                if (key === "focuscamera") {
                    const c = parseInt(v1, 10);
                    eventsArr.push({ t, e: "FocusCamera", v: { char: c === 0 ? 0 : (c === 2 ? 2 : 1) } });
                } else if (key === "camerafollowpos") {
                    // Con x/y la cámara queda fija en esa posición; sin valores vuelve a seguir a los personajes.
                    const x = parseFloat(s1), y = parseFloat(s2);
                    if (Number.isNaN(x) && Number.isNaN(y)) followPos.push({ t, reset: true });
                    else followPos.push({ t, x: Number.isNaN(x) ? 0 : x, y: Number.isNaN(y) ? 0 : y });
                } else if (key === "hey") {
                    // value1: bf / gf / ambos (por defecto). El BF hace "hey" y la GF "cheer".
                    const who = s1.toLowerCase();
                    const bfOnly = who === "bf" || who === "boyfriend" || who === "0";
                    const gfOnly = who === "gf" || who === "girlfriend" || who === "1";
                    if (!gfOnly) play(t, "boyfriend", "hey");
                    if (!bfOnly) play(t, "girlfriend", "cheer");
                } else if (key === "playanimation") {
                    // value1 = animación; value2 = personaje (dad por defecto; 0 dad, 1 bf, 2 gf; o bf/gf).
                    const who = s2.toLowerCase();
                    let target = "dad";
                    if (who === "bf" || who === "boyfriend") target = "boyfriend";
                    else if (who === "gf" || who === "girlfriend") target = "girlfriend";
                    else if (parseInt(who, 10) === 1) target = "boyfriend";
                    else if (parseInt(who, 10) === 2) target = "girlfriend";
                    if (s1) play(t, target, s1);
                    else skippedEvents.set("Play Animation", (skippedEvents.get("Play Animation") || 0) + 1);
                } else if (key === "changescrollspeed") {
                    // value1 = multiplicador de la velocidad del chart; value2 = duración en SEGUNDOS (0 = al instante).
                    let mult = parseFloat(s1);
                    if (!Number.isFinite(mult)) mult = 1;
                    let sec = parseFloat(s2);
                    if (!Number.isFinite(sec) || sec < 0) sec = 0;
                    const v = { scroll: round4(mult), duration: 0, ease: "INSTANT", absolute: false, strumline: "both" };
                    if (sec > 0) { v.duration = round4(sec * bpmAt(t) / 15); v.ease = "linear"; } // V-Slice usa steps (1 step = 15000/bpm ms)
                    eventsArr.push({ t, e: "ScrollSpeed", v });
                } else if (key.includes("zoom")) {
                    eventsArr.push({ t, e: "ZoomCamera", v: toZoom(key, v1) });
                } else if (key) {
                    skippedEvents.set(String(name), (skippedEvents.get(String(name)) || 0) + 1);
                }
            });
            return { eventsArr, followPos, skippedEvents };
        };
        return { add, build };
    }

    // Formato de Psych: [[tiempo, [[nombre, v1, v2], ...]], ...]
    function collectPsychEventGroups(list, add) {
        if (!Array.isArray(list)) return;
        list.forEach(group => {
            if (!Array.isArray(group)) return;
            const evTime = toNum(group[0], NaN);
            if (Array.isArray(group[1])) {
                group[1].forEach(sub => { if (Array.isArray(sub)) add(sub[0], sub[1], evTime, sub[2]); });
            }
        });
    }

    // Psych deja la cámara FIJA con "Camera Follow Pos" (aunque cambie la sección) hasta que se llama otra vez sin
    // valores; entonces vuelve a seguir al personaje en el siguiente inicio de sección. V-Slice lo expresa con
    // FocusCamera char -1 (x, y): se omiten los cambios de cámara de las secciones mientras esté fija y, al soltarla,
    // se enfoca al personaje de la sección que sigue.
    function resolveCameraFocus(followPos, sectionFocus, sectionStarts) {
        const out = [];
        const intervals = [];
        let start = null;
        followPos.slice().sort((a, b) => a.t - b.t).forEach(fp => {
            if (fp.reset) {
                if (start === null) return;
                intervals.push([start, fp.t]);
                start = null;
                const next = sectionStarts.find(s => s.t >= fp.t);
                if (next) out.push({ t: next.t, e: "FocusCamera", v: { char: next.char } });
            } else {
                out.push({ t: fp.t, e: "FocusCamera", v: { char: -1, x: round4(fp.x), y: round4(fp.y) } });
                if (start === null) start = fp.t;
            }
        });
        if (start !== null) intervals.push([start, Infinity]);
        sectionFocus.forEach(ev => { if (!intervals.some(([a, b]) => ev.t >= a && ev.t <= b)) out.push(ev); });
        return out;
    }

    function dedupeEvents(list) {
        const seen = new Set();
        return list.filter(ev => {
            const k = `${ev.t}|${ev.e}|${JSON.stringify(ev.v)}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    function skippedEventsWarning(skippedEvents) {
        if (!skippedEvents.size) return null;
        const total = [...skippedEvents.values()].reduce((a, b) => a + b, 0);
        const names = [...skippedEvents.keys()].slice(0, 6).join(", ");
        return t("warn.skipped", { n: total, names: names + (skippedEvents.size > 6 ? ", …" : "") });
    }

    // events.json de Psych (0.6.3 / 0.7 / 1.0): solo se toman los eventos. Las secciones de ese archivo
    // van vacías y NO deben convertirse en una dificultad ni generar FocusCamera. Sus eventos se pasan a
    // convertPsychToVSlice (opts.extraEvents) para convertirlos junto con el BPM y la cámara del chart.
    // Se reconoce "events.json" aunque venga como "events (1).json", "events - copia.json" o "cancion-events.json".
    function isPsychEventsFile(name) {
        const b = stripFileNoise(baseName(name));
        return b === "events" || /[-_ ]events$/.test(b);
    }
    // La lista [[tiempo, [[nombre, v1, v2]]]] puede venir en la raíz, en "events" o en "song.events".
    function findPsychEventList(rawData) {
        if (Array.isArray(rawData)) return rawData;
        const song = rawData && rawData.song && typeof rawData.song === "object" ? rawData.song : rawData;
        if (rawData && Array.isArray(rawData.events)) return rawData.events;
        return song && Array.isArray(song.events) ? song.events : null;
    }
    // Un archivo con eventos pero SIN ninguna nota es un events.json aunque se llame de otra forma.
    function looksLikePsychEvents(rawData) {
        const list = findPsychEventList(rawData);
        if (!list || !list.length) return false;
        const song = rawData && rawData.song && typeof rawData.song === "object" ? rawData.song : rawData;
        const sections = song && Array.isArray(song.notes) ? song.notes : [];
        return !sections.some(s => s && Array.isArray(s.sectionNotes) && s.sectionNotes.length);
    }
    // Devuelve la lista de eventos (puede estar vacía: un events.json sin eventos no debe impedir convertir).
    function readPsychEventsFile(rawData) {
        if (rawData === null || typeof rawData !== "object") throw new Error(t("conv.noevents"));
        return findPsychEventList(rawData) || [];
    }

    // ------------------------------------------------------------ PSYCH / KADE → V SLICE
    // psychMode: "auto" | "063" (legacy/Kade, fuerza relativos) | "073" | "104" (según el campo format) | "absolute" (P Slice, fuerza absolutos)
    // opts.extraEvents: lista de eventos [[t, [[nombre, v1, v2]]]] de un events.json de Psych (se suman a los del chart).
    function convertPsychToVSlice(rawData, file, psychMode, opts) {
        psychMode = psychMode || "auto";
        opts = opts || {};
        const song = rawData && rawData.song && typeof rawData.song === "object" ? rawData.song : rawData;

        if (!song || !Array.isArray(song.notes)) {
            throw new Error(t("conv.nonotes"));
        }

        const warnings = [];
        // psych_v1 = carriles ABSOLUTOS. "psych_v1_convert" y sin formato = legacy (relativo a mustHitSection).
        const fmt = typeof song.format === "string" ? song.format.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        // Igual que Psych al cargar un chart: solo el formato "psych_v1" lleva carriles absolutos. Antes los modos
        // 0.7.x / 1.0 los trataban SIEMPRE como absolutos, así que un chart sin ese formato (0.7.x clásico, o uno
        // viejo abierto en 1.0, que Psych convierte) salía con los lados de jugador/oponente cambiados en las
        // secciones donde mustHitSection es falso. "absolute" (P Slice) fuerza carriles absolutos; "063" fuerza relativos.
        const declaredV1 = fmt.startsWith("psychv1") && !fmt.includes("convert");
        const isV1 = psychMode === "absolute" ||
            ((psychMode === "073" || psychMode === "104" || psychMode === "auto") && declaredV1);
        if (!isV1 && (psychMode === "073" || psychMode === "104")) {
            warnings.push(t("warn.relative"));
        }
        const needsLaneRemap = !isV1;

        const remapLane = (lane, mustHitSection) => {
            const raw = ((lane % 8) + 8) % 8;
            const isPlayer = raw < 4 ? !!mustHitSection : !mustHitSection;
            return (raw % 4) + (isPlayer ? 0 : 4);
        };

        const collector = createPsychEventCollector();
        const addPsychEvent = collector.add;
        const sectionFocus = [];  // cambios de cámara que implican las secciones (mustHitSection / gfSection)
        const sectionStarts = []; // enfoque de CADA sección (para volver a seguir al personaje tras Camera Follow Pos)

        // Eventos inline en sectionNotes (Psych 0.7+/1.0):
        //  [time, "Nombre", v1, v2]  |  [time, -1, "Nombre", v1, v2]
        const extractInline = note => {
            if (note.length < 2) return null;
            // Un carril escrito como texto ("2") es una nota, no un evento.
            if (typeof note[1] === "string" && !/^\s*-?\d+(\.\d+)?\s*$/.test(note[1])) return { name: note[1], v1: note[2], v2: note[3], t: toNum(note[0], NaN) };
            if (typeof note[1] === "number" && note[1] < 0 && typeof note[2] === "string") {
                return { name: note[2], v1: note[3], v2: note[4], t: toNum(note[0], NaN) };
            }
            return null;
        };

        // Eventos de song.events: [[time, [[nombre, v1, v2], ...]], ...]  (+ los de un events.json aparte)
        collectPsychEventGroups((rawData && rawData.events) || song.events, addPsychEvent);
        collectPsychEventGroups(opts.extraEvents, addPsychEvent);

        const baseBpm = toNum(song.bpm, 100) > 0 ? toNum(song.bpm, 100) : 100;
        let bpm = baseBpm;
        const notesArr = [];
        const timeChanges = [{ t: 0, b: 0, bpm, n: 4, d: 4, bt: [4, 4, 4, 4] }];
        let currentTime = 0;
        let currentBeat = 0;
        let lastFocus = -1;

        song.notes.forEach(sec => {
            if (!sec || typeof sec !== "object") return;

            if (sec.changeBPM && toNum(sec.bpm, 0) > 0) {
                bpm = toNum(sec.bpm, bpm);
                const last = timeChanges[timeChanges.length - 1];
                const t = Math.round(currentTime);
                if (last.t === t) { last.bpm = bpm; last.b = round4(currentBeat); }
                else if (last.bpm !== bpm) {
                    timeChanges.push({ t, b: round4(currentBeat), bpm, n: 4, d: 4, bt: [4, 4, 4, 4] });
                }
            }

            const focusChar = sec.gfSection ? 2 : (sec.mustHitSection ? 0 : 1);
            sectionStarts.push({ t: Math.round(currentTime), char: focusChar });
            if (focusChar !== lastFocus) {
                sectionFocus.push({ t: Math.round(currentTime), e: "FocusCamera", v: { char: focusChar } });
                lastFocus = focusChar;
            }

            (Array.isArray(sec.sectionNotes) ? sec.sectionNotes : []).forEach(n => {
                if (!Array.isArray(n)) return;

                const inline = extractInline(n);
                if (inline) { addPsychEvent(inline.name, inline.v1, inline.t, inline.v2); return; }

                const t = toNum(n[0], NaN);
                const rawLane = Math.round(toNum(n[1], NaN)); // V-Slice exige carriles enteros: un 1.5 invalidaría el chart entero
                if (!Number.isFinite(t) || !Number.isFinite(rawLane)) return;
                if (rawLane < 0) return; // nota de GF/evento antiguo: V-Slice no tiene carril GF

                const d = needsLaneRemap ? remapLane(rawLane, sec.mustHitSection) : ((rawLane % 8) + 8) % 8;
                const note = { t, d, l: Math.max(0, toNum(n[2], 0)), p: [] };
                if (typeof n[3] === "string" && n[3] !== "") note.k = n[3]; // tipo de nota (Hurt Note, Alt Animation…)
                notesArr.push(note);
            });

            const beats = toNum(sec.sectionBeats, NaN) > 0
                ? toNum(sec.sectionBeats, 4)
                : (toNum(sec.lengthInSteps, 0) > 0 ? toNum(sec.lengthInSteps, 16) / 4 : 4);
            currentTime += (60000 / bpm) * beats;
            currentBeat += beats;
        });

        notesArr.sort((a, b) => a.t - b.t);

        // Ya se conocen los cambios de BPM y la cámara de cada sección: se convierten los eventos.
        const bpmAt = t => { let b = timeChanges[0].bpm; for (const tc of timeChanges) { if (tc.t <= t) b = tc.bpm; else break; } return b; };
        const built = collector.build({ bpmAt });
        const eventsArr = dedupeEvents(built.eventsArr
            .concat(resolveCameraFocus(built.followPos, sectionFocus, sectionStarts))
            .sort((a, b) => a.t - b.t));

        const skippedWarning = skippedEventsWarning(built.skippedEvents);
        if (skippedWarning) warnings.push(skippedWarning);

        const name = song.song || (file && file.name ? songKeyFromFile(file.name) : "Unknown");
        // Velocidad 0 o negativa dejaría todas las flechas apiladas en V Slice.
        let speed = toNum(song.speed, 2.5);
        if (!(speed > 0)) { warnings.push(t("warn.badspeed", { speed: String(song.speed) })); speed = 2.5; }
        return {
            canonicalKey: String(name).toLowerCase(),
            songName: name,
            speed,
            bpm: baseBpm,
            player1: song.player1 || "bf",
            player2: song.player2 || "dad",
            girlfriend: song.gfVersion || song.player3 || "gf",
            stage: song.stage || "stage",
            difficulties: null,
            notesArr, eventsArr, timeChanges, warnings
        };
    }

    // ------------------------------------------------------------ CODENAME → V SLICE
    function convertCodenameToVSlice(rawData) {
        let chart = (rawData && typeof rawData === "object") ? rawData : {};
        const wrapped = chart.song && typeof chart.song === "object" ? chart.song : null;
        if (wrapped && (wrapped.strumLines || Array.isArray(wrapped.chart) || wrapped.codenameChart)) chart = wrapped;

        if (!Array.isArray(chart.strumLines)) {
            throw new Error(t("conv.nocodename"));
        }

        const warnings = [];
        const meta = chart.meta || (rawData && rawData.meta) || {};
        const baseBpm = toNum(meta.bpm, 100) > 0 ? toNum(meta.bpm, 100) : 100;
        const noteTypes = Array.isArray(chart.noteTypes) ? chart.noteTypes : [];
        const notesArr = [];
        const eventsArr = [];
        let skippedGf = 0;

        const findLine = type => chart.strumLines.find(s => Number(s.type) === type);
        const getChara = (type, fb) => {
            const line = findLine(type);
            return line && Array.isArray(line.characters) && line.characters[0] ? line.characters[0] : fb;
        };

        for (const sl of chart.strumLines) {
            const type = Number(sl.type);
            if (type === 2) { skippedGf += (sl.notes || []).length; continue; } // GF no existe en V-Slice
            const baseLane = type === 1 ? 0 : 4; // PLAYER → 0-3 | OPPONENT → 4-7
            for (const n of sl.notes || []) {
                const t = toNum(n.time, NaN);
                if (!Number.isFinite(t)) continue;
                const note = { t, d: baseLane + (((Number(n.id) || 0) % 4) + 4) % 4, l: Math.max(0, toNum(n.sLen, 0)), p: [] };
                const nType = Number(n.type);
                if (nType > 0 && noteTypes[nType - 1]) note.k = noteTypes[nType - 1];
                notesArr.push(note);
            }
        }
        if (skippedGf) warnings.push(t("warn.gf", { n: skippedGf }));

        const timeChanges = [{ t: 0, b: 0, bpm: baseBpm, n: 4, d: 4, bt: [4, 4, 4, 4] }];

        for (const ev of chart.events || []) {
            const name = String(ev.name || "").toLowerCase();
            const params = Array.isArray(ev.params) ? ev.params : [];
            const t = toNum(ev.time, 0);

            if (name === "camera movement") {
                // params[0] = ÍNDICE de strumline objetivo → se resuelve a su tipo.
                const idx = Number(params[0]);
                const line = chart.strumLines[idx];
                const type = line ? Number(line.type) : (idx === 1 ? 1 : 0);
                eventsArr.push({ t, e: "FocusCamera", v: { char: type === 1 ? 0 : (type === 2 ? 2 : 1) } });
            } else if (name === "camera zoom") {
                // [tween?, zoom, cam, duración, ease, tipo, modo]
                const zoom = toNum(params[1], 1.4);
                const mode = params[6] === "stage" ? "stage" : "direct";
                eventsArr.push({ t, e: "ZoomCamera", v: { ease: "expoInOut", duration: 4, mode, zoom } });
            } else if (name === "add camera zoom") {
                eventsArr.push({ t, e: "ZoomCamera", v: { ease: "expoInOut", duration: 4, mode: "stage", zoom: round4(1 + toNum(params[0], 0.015)) } });
            } else if (name === "bpm change") {
                const bpm = toNum(params[0], 0);
                if (bpm > 0) timeChanges.push({ t, b: 0, bpm, n: 4, d: 4, bt: [4, 4, 4, 4] });
            }
        }

        timeChanges.sort((a, b) => a.t - b.t);
        // Recalcula el beat de cada cambio de BPM
        for (let i = 1; i < timeChanges.length; i++) {
            const p = timeChanges[i - 1];
            timeChanges[i].b = round4(p.b + (timeChanges[i].t - p.t) / (60000 / p.bpm));
        }
        notesArr.sort((a, b) => a.t - b.t);

        const songName = meta.displayName || meta.name || "unknown";
        return {
            canonicalKey: String(meta.name || songName).toLowerCase(),
            songName,
            speed: toNum(chart.scrollSpeed, 1),
            bpm: baseBpm,
            player1: getChara(1, "bf"),
            player2: getChara(0, "dad"),
            girlfriend: getChara(2, "gf"),
            stage: chart.stage || "stage",
            difficulties: Array.isArray(meta.difficulties) ? meta.difficulties.slice() : null,
            notesArr, eventsArr, timeChanges, warnings
        };
    }

    // ------------------------------------------------------------ FUNKIN MAKER MOBILE (.FNMM) → V SLICE
    // Un .FNMM es un ZIP con data.json (notas), events.json (eventos), scene.json (escena), music.ogg y sprites/.
    //  • Todos los tiempos van en SEGUNDOS (start / duration / time).
    //  • data.strumLines[0] = jugador y data.strumLines[1] = oponente; cada una con 4 carriles (izq, abajo, arriba, der).
    //  • events.json: "action_packs" (grupos de acciones reutilizables) + "events" (acciones en un instante;
    //    RunActionPack ejecuta un pack). Solo CameraSet (focus) y CameraZoom tienen equivalente en V-Slice.
    const FNMM_DEFAULT_SPEED = 2.5;

    function isFunkinMakerFile(name) {
        return /\.fnmm$/i.test(String(name || ""));
    }

    // Busca "data.json" / "events.json" / "scene.json" en la raíz del ZIP (o en una carpeta contenedora),
    // sin confundirlos con los sprite.json de sprites/ ni con la basura de macOS.
    function findFnmmEntry(zip, wanted) {
        const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\._[^/]*$/.test(n));
        const lower = wanted.toLowerCase();
        const exact = names.find(n => n.toLowerCase() === lower);
        if (exact) return exact;
        return names.find(n => n.toLowerCase().endsWith("/" + lower) && !/(^|\/)sprites\//i.test(n)) || null;
    }

    // zip: instancia ya cargada de JSZip. Devuelve { data, events, scene } (events y scene pueden ser null).
    async function readFunkinMakerArchive(zip) {
        const read = async wanted => {
            const entry = findFnmmEntry(zip, wanted);
            if (!entry) return null;
            try {
                return parseJson(await zip.files[entry].async("string"));
            } catch (err) {
                throw new Error(t("err.badjson", { file: entry, msg: err.message }));
            }
        };
        let data = await read("data.json");
        if (!data) throw new Error(t("conv.fnmm.nodata"));
        // Busca el objeto que contiene "strumLines" (puede estar anidado, con otra capitalización, o en otro JSON del ZIP).
        const findStrum = (obj, depth) => {
            if (!obj || typeof obj !== "object" || depth > 3) return null;
            if (!Array.isArray(obj)) {
                for (const k of Object.keys(obj)) {
                    if (/^strum_?lines$/i.test(k) && Array.isArray(obj[k])) {
                        return k === "strumLines" ? obj : Object.assign({}, obj, { strumLines: obj[k] });
                    }
                }
            }
            for (const k of Object.keys(obj)) {
                const r = findStrum(obj[k], depth + 1);
                if (r) return r;
            }
            return null;
        };
        let found = findStrum(data, 0);
        if (!found) {
            const others = Object.keys(zip.files).filter(n => /\.json$/i.test(n) && !zip.files[n].dir
                && !/(^|\/)(sprites|__MACOSX)\//i.test(n) && !/(^|\/)\._/.test(n) && !/(^|\/)(events|scene)\.json$/i.test(n));
            for (const n of others) {
                try {
                    found = findStrum(parseJson(await zip.files[n].async("string")), 0);
                } catch (e) { /* no era un JSON válido: se ignora */ }
                if (found) break;
            }
        }
        if (found) data = found;
        else {
            const keys = (data && typeof data === "object") ? Object.keys(data).slice(0, 12).join(", ") : typeof data;
            const files = Object.keys(zip.files).filter(n => !zip.files[n].dir).slice(0, 12).join(", ");
            const err = new Error(t("conv.fnmm.nostrum") + ` [data.json: ${keys || "∅"} | ZIP: ${files}]`);
            throw err;
        }
        return { data, events: await read("events.json"), scene: await read("scene.json") };
    }

    // Easing de Funkin Maker → nombre de FlxEase (los que V-Slice acepta en ZoomCamera).
    function fnmmEase(name) {
        const map = {
            default: "linear", linear: "linear", quad: "quadInOut", quadratic: "quadInOut", cubic: "cubeInOut", cube: "cubeInOut",
            quart: "quartInOut", quint: "quintInOut", sine: "sineInOut", expo: "expoInOut", circ: "circInOut",
            back: "backInOut", elastic: "elasticInOut", bounce: "bounceInOut", smooth: "smoothStepInOut"
        };
        return map[String(name == null ? "" : name).toLowerCase()] || "linear";
    }

    // extra: { events, scene } (los JSON ya leídos del .FNMM). file: File/obj con .name (para el nombre de la canción).
    function convertFunkinMakerToVSlice(data, extra, file) {
        extra = extra || {};
        if (!data || !Array.isArray(data.strumLines)) {
            throw new Error(t("conv.fnmm.nostrum"));
        }

        const warnings = [];
        const bpm = toNum(data.bpm, 100) > 0 ? toNum(data.bpm, 100) : 100;

        // --- Notas: strumLine 0 → carriles 0-3 (jugador) | strumLine 1 → carriles 4-7 (oponente)
        const notesArr = [];
        let extraLines = 0, extraLanes = 0, skinNotes = 0, triggerNotes = 0, duplicates = 0;
        const seen = new Set();
        data.strumLines.forEach((line, si) => {
            if (!Array.isArray(line)) return;
            if (si > 1) { extraLines += line.reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0); return; }
            line.forEach((lane, li) => {
                if (!Array.isArray(lane)) return;
                if (li > 3) { extraLanes += lane.length; return; }
                lane.forEach(n => {
                    const start = toNum(n && n.start, NaN);
                    if (!Number.isFinite(start)) return;
                    const d = (si === 0 ? 0 : 4) + li;
                    const t = round3(start * 1000);
                    const key = `${t}|${d}`;
                    if (seen.has(key)) { duplicates++; return; } // dos notas idénticas apiladas
                    seen.add(key);
                    const note = { t, d, l: round3(Math.max(0, toNum(n.duration, 0)) * 1000), p: [] };
                    const props = (n && n.props) || {};
                    const skin = toNum(props.skin, 0);
                    if (skin > 0) { note.k = `skin${skin}`; skinNotes++; }
                    if (toNum(props.onPressEvent, -1) >= 0 || toNum(props.onMissEvent, -1) >= 0) triggerNotes++;
                    notesArr.push(note);
                });
            });
        });
        notesArr.sort((a, b) => a.t - b.t || a.d - b.d);
        if (extraLines) warnings.push(t("warn.fnmm.extralines", { n: extraLines }));
        if (extraLanes) warnings.push(t("warn.fnmm.extralanes", { n: extraLanes }));
        if (duplicates) warnings.push(t("warn.fnmm.dups", { n: duplicates }));
        if (skinNotes) warnings.push(t("warn.fnmm.skin", { n: skinNotes }));
        if (triggerNotes) warnings.push(t("warn.fnmm.trigger", { n: triggerNotes }));

        // --- Eventos
        // La cámara N de scene.json apunta a un personaje: se elige la strumline cuyo objeto queda más cerca de ella
        // (así no depende del orden). Sin escena: cámara 1 → jugador, cámara 0 → oponente.
        const charForCamera = idx => {
            const scene = extra.scene;
            const cam = scene && Array.isArray(scene.cameras) ? scene.cameras[idx] : null;
            const camX = cam && cam.position ? toNum(cam.position.x, NaN) : NaN;
            if (Number.isFinite(camX) && Array.isArray(scene.objects)) {
                let best = null, bestDist = Infinity;
                scene.objects.forEach(o => {
                    const sl = toNum(o && o.strumLine, -1);
                    if (sl !== 0 && sl !== 1) return;
                    const tr = Array.isArray(o.transform) ? o.transform[0] : null;
                    const x = tr && tr.position ? toNum(tr.position.x, NaN) : NaN;
                    if (!Number.isFinite(x)) return;
                    if (Math.abs(x - camX) < bestDist) { bestDist = Math.abs(x - camX); best = sl; }
                });
                if (best !== null) return best === 0 ? 0 : 1;
            }
            return idx === 0 ? 1 : 0;
        };

        // Duración → steps de V-Slice (1 step = 15000 / bpm ms).
        const toSteps = (value, unit) => {
            const v = Math.max(0, toNum(value, 0));
            const u = String(unit == null ? "seconds" : unit).toLowerCase();
            if (/beat/.test(u)) return v * 4;
            if (/step/.test(u)) return v;
            if (/^m(illi)?s/.test(u)) return v / 1000 * bpm / 15;
            return v * bpm / 15;
        };

        const eventsArr = [];
        const skipped = new Map();
        const skip = name => skipped.set(name, (skipped.get(name) || 0) + 1);
        const packs = extra.events && Array.isArray(extra.events.action_packs) ? extra.events.action_packs : [];

        const run = (actions, t, depth) => {
            if (!Array.isArray(actions)) return;
            actions.forEach(a => {
                if (!a || typeof a.type !== "string") return;
                const p = a.props || {};
                if (a.type === "RunActionPack") {
                    const pack = packs[Math.round(toNum(p.actionPack, -1))];
                    if (pack && depth < 8) run(pack.actions, t, depth + 1); // depth: un pack que se llama a sí mismo no cuelga
                } else if (a.type === "CameraSet") {
                    if (String(p.mode).toLowerCase() === "focus") {
                        eventsArr.push({ t, e: "FocusCamera", v: { char: charForCamera(Math.round(toNum(p.target, 0))) } });
                    } else skip(`CameraSet (${p.mode})`);
                } else if (a.type === "CameraZoom") {
                    const duration = round4(toSteps(p.transitionTime, p.transitionTimeUnit));
                    const v = { ease: duration > 0 ? fnmmEase(p.easingType) : "INSTANT", duration, mode: "direct", zoom: round4(toNum(p.value, 1)) };
                    eventsArr.push({ t, e: "ZoomCamera", v });
                } else {
                    skip(a.type); // CameraShake, Object*, GUI…: efectos de la escena sin equivalente en V-Slice
                }
            });
        };
        const rawEvents = extra.events && Array.isArray(extra.events.events) ? extra.events.events : [];
        rawEvents.forEach(ev => {
            const sec = toNum(ev && ev.time, NaN);
            if (Number.isFinite(sec)) run(ev.actions, round3(sec * 1000), 0);
        });
        eventsArr.sort((a, b) => a.t - b.t);
        const skippedWarning = skippedEventsWarning(skipped);
        if (skippedWarning) warnings.push(skippedWarning);

        warnings.push(t("warn.fnmm.nospeed", { speed: FNMM_DEFAULT_SPEED }));

        const songName = baseName(file && file.name) || "Unknown";
        return {
            canonicalKey: songName.toLowerCase(),
            songName,
            speed: FNMM_DEFAULT_SPEED,
            bpm,
            player1: "bf",
            player2: "dad",
            girlfriend: "gf",
            stage: "stage",
            difficulties: null,
            notesArr, eventsArr: dedupeEvents(eventsArr),
            timeChanges: [{ t: 0, b: 0, bpm, n: 4, d: 4, bt: [4, 4, 4, 4] }],
            warnings
        };
    }

    // ------------------------------------------------------------ METADATA V SLICE
    function buildVSliceMeta(opts) {
        // Se ordenan easy → nightmare: V-Slice muestra las dificultades en el orden del array (antes quedaba
        // el orden en que se subieron los archivos, p. ej. "hard" antes que "easy").
        const rank = d => { const i = KNOWN_DIFFS.indexOf(d); return i < 0 ? KNOWN_DIFFS.length : i; };
        const diffs = (opts.difficulties && opts.difficulties.length) ? opts.difficulties.slice().sort((a, b) => rank(a) - rank(b)) : ["normal"];
        const ratings = {};
        diffs.forEach(d => { ratings[d] = DEFAULT_RATINGS[d] || 5; });

        const playData = {};
        if (opts.stickerPack) playData.stickerPack = opts.stickerPack;
        playData.difficulties = diffs;
        playData.characters = {
            player: opts.player1 || "bf",
            girlfriend: opts.girlfriend || "gf",
            opponent: opts.player2 || "dad",
            instrumental: "",
            opponentVocals: ["Opponent"],
            playerVocals: ["Player"]
        };
        playData.stage = opts.stage || "stage";
        playData.noteStyle = "funkin";
        playData.ratings = ratings;
        if (opts.album) playData.album = opts.album;
        playData.previewStart = 0;
        playData.previewEnd = 0;

        return {
            version: "2.2.4",
            songName: opts.songName || "Unknown",
            artist: "Unknown",
            charter: "V-Slice Converter",
            looped: false,
            offsets: { instrumental: 0, altInstrumentals: {}, vocals: {}, altVocals: {} },
            playData,
            generatedBy: GENERATED_BY,
            timeFormat: "ms",
            timeChanges: (opts.timeChanges && opts.timeChanges.length)
                ? opts.timeChanges
                : [{ t: 0, b: 0, bpm: opts.bpm || 100, n: 4, d: 4, bt: [4, 4, 4, 4] }]
        };
    }

    // ------------------------------------------------------------ V SLICE → PSYCH / KADE / CODENAME
    // target: "psych_v1" | "legacy" | "kade" | "codename"
    function normalizeTimeChanges(meta, warnings) {
        let tcs = meta && Array.isArray(meta.timeChanges) ? meta.timeChanges
            .map(tc => ({ t: toNum(tc.t, 0), bpm: toNum(tc.bpm, 0) }))
            .filter(tc => tc.bpm > 0) : [];
        if (!tcs.length) {
            warnings.push(t("warn.nometa"));
            tcs = [{ t: 0, bpm: 100 }];
        }
        tcs.sort((a, b) => a.t - b.t);
        if (tcs[0].t > 0) tcs.unshift({ t: 0, bpm: tcs[0].bpm });
        else tcs[0].t = 0;
        return tcs;
    }

    // Divide la canción en secciones (4 beats; se acorta si cae un cambio de BPM dentro).
    function buildSections(tcs, endTime) {
        const sections = [];
        let s = 0;
        const bpmAt = t => { let b = tcs[0].bpm; for (const tc of tcs) if (tc.t <= t + 1) b = tc.bpm; return b; };
        while (s <= endTime + 1 && sections.length < 20000) {
            const bpm = bpmAt(s);
            const beatMs = 60000 / bpm;
            const full = 4 * beatMs;
            const next = tcs.find(tc => tc.t > s + 1 && tc.t < s + full - 1);
            let beats = 4, nextStart = s + full;
            if (next) { beats = round4((next.t - s) / beatMs); nextStart = next.t; }
            sections.push({ start: s, beats, bpm, end: nextStart });
            s = nextStart;
        }
        return sections;
    }

    function sectionIndex(sections, t) {
        let lo = 0, hi = sections.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (sections[mid].start <= t + 1) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    function convertVSliceToTarget(chart, meta, target, opts) {
        opts = opts || {};
        const warnings = [];
        const camera = opts.camera !== false;
        const zoomOn = opts.zoom !== false;

        let notesByDiff = chart && chart.notes;
        if (Array.isArray(notesByDiff)) notesByDiff = { normal: notesByDiff };
        if (!notesByDiff || typeof notesByDiff !== "object" || !Object.keys(notesByDiff).length) {
            throw new Error(t("conv.novslicenotes"));
        }

        const tcs = normalizeTimeChanges(meta, warnings);
        const pd = (meta && meta.playData) || {};
        const chars = pd.characters || {};
        const songName = (meta && meta.songName) || opts.songName || "Unknown";
        const player1 = chars.player || "bf";
        const player2 = chars.opponent || "dad";
        const gf = chars.girlfriend || "gf";
        const stage = pd.stage || "stage";
        const key = slug(songName, opts.songKey || "song");
        const diffs = Object.keys(notesByDiff);

        const allEvents = (Array.isArray(chart.events) ? chart.events : [])
            .map(e => ({ t: toNum(e.t, NaN), e: e.e, v: e.v || {} }))
            .filter(e => Number.isFinite(e.t))
            .sort((a, b) => a.t - b.t);
        // FocusCamera solo tiene equivalente para char 0 (jugador), 1 (oponente) y 2 (GF). Con char -1 / sin char
        // la cámara va a una posición fija (x, y): antes se contaba como "oponente" y desordenaba las secciones.
        const isCodename = target === "codename";
        const isV1 = target === "psych_v1";
        const isKade = target === "kade";
        const isPsych = !isCodename && !isKade; // Psych legacy / v1: admiten eventos en el chart
        const allFocus = camera ? allEvents.filter(e => e.e === "FocusCamera")
            .map(e => ({ t: e.t, c: toNum(e.v.char, NaN), x: toNum(e.v.x, 0), y: toNum(e.v.y, 0) })) : [];
        const isCharFocus = f => f.c === 0 || f.c === 1 || f.c === 2;
        const focusEvents = allFocus.filter(isCharFocus);
        // Cámara fija (char -1, x, y) → "Camera Follow Pos" de Psych; al volver a un personaje se "suelta" (valores vacíos).
        const camFollow = [];
        let camWasFixed = false;
        allFocus.forEach(f => {
            if (isCharFocus(f)) { if (camWasFixed) camFollow.push({ t: f.t, reset: true }); camWasFixed = false; }
            else { camFollow.push({ t: f.t, x: f.x, y: f.y }); camWasFixed = true; }
        });
        const fixedFocus = allFocus.length - focusEvents.length;
        if (fixedFocus && !isPsych) warnings.push(t("warn.fixedfocus", { n: fixedFocus }));
        const zoomEvents = zoomOn ? allEvents.filter(e => e.e === "ZoomCamera") : [];
        // V-Slice puede traer solo "default" en scrollSpeed (sin una entrada por dificultad).
        const speedFor = diff => {
            const ss = chart.scrollSpeed;
            if (typeof ss === "number") return toNum(ss, 1);
            const own = ss && typeof ss === "object" ? toNum(ss[diff], NaN) : NaN;
            if (Number.isFinite(own)) return own;
            const def = ss && typeof ss === "object" ? toNum(ss.default, NaN) : NaN;
            return Number.isFinite(def) ? def : 1;
        };
        const handled = isPsych ? ["FocusCamera", "ZoomCamera", "PlayAnimation", "ScrollSpeed"] : ["FocusCamera", "ZoomCamera"];
        const otherEvents = allEvents.filter(e => !handled.includes(e.e));
        if (otherEvents.length) {
            const names = [...new Set(otherEvents.map(e => e.e))].slice(0, 6).join(", ");
            warnings.push(t("warn.skipped.inverse", { n: otherEvents.length, names }));
        }

        const files = [];
        // Lane inversa (exacta respecto a la conversión normal)
        const encodeLane = (d, mustHit) => {
            const lane = ((Math.round(d) % 8) + 8) % 8;
            if (isV1) return lane;
            const isPlayer = lane < 4;
            const lo = lane % 4;
            return (isPlayer === !!mustHit) ? lo : lo + 4;
        };

        const focusAt = t => {
            let c = 0; // por defecto: jugador
            for (const f of focusEvents) { if (f.t <= t + 2) c = f.c; else break; }
            return c;
        };

        const diffNames = {};
        let lostFocus = 0, approxZoom = 0, approxScroll = 0, skippedAnim = 0;

        diffs.forEach(diff => {
            const notes = (Array.isArray(notesByDiff[diff]) ? notesByDiff[diff] : [])
                .filter(n => n && Number.isFinite(toNum(n.t, NaN)))
                .sort((a, b) => a.t - b.t);
            const speed = speedFor(diff);
            const firstDiff = diff === diffs[0]; // los eventos son globales: se cuentan una sola vez, no por dificultad

            let endTime = 0;
            notes.forEach(n => { endTime = Math.max(endTime, n.t + toNum(n.l, 0)); });
            allEvents.forEach(e => { endTime = Math.max(endTime, e.t); });
            const sections = buildSections(tcs, endTime);
            const bySection = sections.map(() => []);

            if (isCodename) {
                const noteTypes = [];
                const lines = [
                    { type: 0, notes: [] }, { type: 1, notes: [] }, { type: 2, notes: [] }
                ];
                notes.forEach(n => {
                    const d = ((Math.round(toNum(n.d, 0)) % 8) + 8) % 8;
                    const out = { time: round3(n.t), id: d % 4, type: 0, sLen: round3(Math.max(0, toNum(n.l, 0))) };
                    if (typeof n.k === "string" && n.k) {
                        let i = noteTypes.indexOf(n.k);
                        if (i < 0) { noteTypes.push(n.k); i = noteTypes.length - 1; }
                        out.type = i + 1;
                    }
                    lines[d < 4 ? 1 : 0].notes.push(out);
                });
                const strumLines = [
                    { characters: [player2], type: 0, notes: lines[0].notes, position: "dad", visible: true, strumPos: [0.25, 50], strumScale: 1, vocalsSuffix: "" },
                    { characters: [player1], type: 1, notes: lines[1].notes, position: "boyfriend", visible: true, strumPos: [0.75, 50], strumScale: 1, vocalsSuffix: "" },
                    { characters: [gf], type: 2, notes: lines[2].notes, position: "girlfriend", visible: false, strumPos: [0.5, 50], strumScale: 1, vocalsSuffix: "" }
                ];
                const events = [];
                focusEvents.forEach(f => events.push({ name: "Camera Movement", time: round3(f.t), params: [f.c === 0 ? 1 : (f.c === 2 ? 2 : 0)] }));
                zoomEvents.forEach(z => events.push({
                    name: "Camera Zoom", time: round3(z.t),
                    params: [true, toNum(z.v.zoom, 1), "camGame", toNum(z.v.duration, 4), z.v.ease || "expoInOut", "beat", z.v.mode === "stage" ? "stage" : "direct"]
                }));
                tcs.slice(1).forEach(tc => events.push({ name: "BPM Change", time: round3(tc.t), params: [tc.bpm] }));
                events.sort((a, b) => a.time - b.time);
                // Dificultades en minúsculas, igual que los nombres de archivo (<dificultad>.json): Codename las
                // busca por nombre y antes meta.json decía "HARD" mientras el archivo era "hard.json".
                const cMeta = { name: key, displayName: songName, bpm: tcs[0].bpm, beatsPerMeasure: 4, stepsPerBeat: 4, difficulties: diffs, icon: player2 };
                files.push({
                    name: `charts/${key}/${diff}.json`,
                    content: JSON.stringify({ strumLines, events, meta: cMeta, noteTypes, scrollSpeed: speed, stage, codenameChart: true, generatedBy: GENERATED_BY }, null, 2)
                });
                diffNames[diff] = true;
                return;
            }

            // --- Psych / Kade: secciones
            const focusPerSection = sections.map(sec => focusAt(sec.start));
            notes.forEach(n => {
                const i = sectionIndex(sections, n.t);
                const mustHit = focusPerSection[i] === 0;
                const out = [round3(n.t), encodeLane(toNum(n.d, 0), mustHit), round3(Math.max(0, toNum(n.l, 0)))];
                if (typeof n.k === "string" && n.k) out.push(n.k);
                bySection[i].push(out);
            });

            const evGroups = new Map(); // t → [[nombre, v1, v2]]
            const pushEv = (t, name, v1, v2) => {
                const k = round3(t);
                if (!evGroups.has(k)) evGroups.set(k, []);
                evGroups.get(k).push([name, String(v1), String(v2 == null ? "" : v2)]);
            };

            focusEvents.forEach(f => {
                const i = sectionIndex(sections, f.t);
                if (f.t > sections[i].start + 2) {
                    if (isV1) pushEv(f.t, "FocusCamera", f.c, "");
                    else if (firstDiff) lostFocus++;
                }
            });
            if (isPsych) {
                camFollow.forEach(c => pushEv(c.t, "Camera Follow Pos", c.reset ? "" : round4(c.x), c.reset ? "" : round4(c.y)));

                const bpmAt = t => { let b = tcs[0].bpm; for (const tc of tcs) { if (tc.t <= t) b = tc.bpm; else break; } return b; };
                allEvents.forEach(e => {
                    if (e.e === "ScrollSpeed") {
                        // Psych: value1 = multiplicador del chart; value2 = duración en segundos (V-Slice usa steps).
                        const absolute = e.v.absolute === true;
                        const scroll = toNum(e.v.scroll, 1);
                        const mult = absolute ? (speed > 0 ? scroll / speed : 1) : scroll;
                        const instant = String(e.v.ease || "").toUpperCase() === "INSTANT";
                        const secs = instant ? 0 : toNum(e.v.duration, 4) * 15 / bpmAt(e.t);
                        pushEv(e.t, "Change Scroll Speed", round4(mult), round4(secs));
                        if (firstDiff && e.v.strumline && e.v.strumline !== "both") approxScroll++;
                    } else if (e.e === "PlayAnimation") {
                        const anim = String(e.v.anim == null ? "" : e.v.anim);
                        const who = String(e.v.target == null ? "" : e.v.target).toLowerCase();
                        const psychWho = ["boyfriend", "bf", "player"].includes(who) ? "bf"
                            : ["girlfriend", "gf"].includes(who) ? "gf"
                            : ["dad", "opponent"].includes(who) ? "dad" : null;
                        if (!anim || !psychWho) { if (firstDiff) skippedAnim++; return; }
                        if (psychWho === "bf" && anim === "hey") pushEv(e.t, "Hey!", "bf", "");
                        else if (psychWho === "gf" && anim === "cheer") pushEv(e.t, "Hey!", "gf", "");
                        else pushEv(e.t, "Play Animation", anim, psychWho);
                    }
                });
            }
            // Kade no tiene eventos en el chart: los zooms se descartan (antes sin avisar).
            if (!isKade) {
                zoomEvents.forEach(z => {
                    const zoom = toNum(z.v.zoom, 1);
                    if (z.v.mode !== "stage" && firstDiff) approxZoom++;
                    pushEv(z.t, "Add Camera Zoom", round4(zoom - 1), "");
                });
            } else if (firstDiff && zoomEvents.length) {
                warnings.push(t("warn.zoomkade", { n: zoomEvents.length }));
            }
            const events = [...evGroups.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => [t, list]);

            let prevBpm = tcs[0].bpm;
            const notesOut = sections.map((sec, i) => {
                const changeBPM = i > 0 && sec.bpm !== prevBpm;
                prevBpm = sec.bpm;
                const sOut = {
                    sectionNotes: bySection[i],
                    sectionBeats: sec.beats,
                    lengthInSteps: Math.round(sec.beats * 4),
                    mustHitSection: focusPerSection[i] === 0,
                    gfSection: focusPerSection[i] === 2,
                    bpm: sec.bpm,
                    changeBPM,
                    altAnim: false,
                    typeOfSection: 0
                };
                if (isKade) { sOut.startTime = round3(sec.start); sOut.endTime = round3(sec.end); }
                return sOut;
            });

            const songObj = {
                song: songName,
                notes: notesOut,
                events: isKade ? [] : events,
                bpm: tcs[0].bpm,
                needsVoices: true,
                speed,
                player1, player2,
                gfVersion: gf,
                stage,
                validScore: true
            };
            if (isKade) songObj.eventObjects = [{ name: "Init BPM", position: 0, value: tcs[0].bpm, type: "BPM Change" }];
            if (isV1) { songObj.format = "psych_v1"; songObj.offset = 0; songObj.generatedBy = GENERATED_BY; }

            // En legacy/Kade la firma va fuera de "song" para no tocar la estructura que lee el motor.
            const content = JSON.stringify(isV1 ? songObj : { song: songObj, generatedBy: GENERATED_BY }, null, 2);
            const fname = diff === "normal" ? `${key}.json` : `${key}-${diff}.json`;
            files.push({ name: fname, content });
        });

        if (lostFocus) warnings.push(t("warn.lostfocus", { n: lostFocus }));
        if (approxZoom) warnings.push(t("warn.approxzoom", { n: approxZoom }));
        if (approxScroll) warnings.push(t("warn.approxscroll", { n: approxScroll }));
        if (skippedAnim) warnings.push(t("warn.skippedanim", { n: skippedAnim }));

        if (isCodename) {
            files.push({
                name: `charts/${key}/meta.json`,
                content: JSON.stringify({ name: key, displayName: songName, bpm: tcs[0].bpm, beatsPerMeasure: 4, stepsPerBeat: 4, difficulties: diffs }, null, 2)
            });
        }

        return { songName, key, files, warnings, difficulties: diffs };
    }

    const api = {
        GENERATED_BY, parseJson, getDiff, songKeyFromFile, slug, baseName,
        isPsychEventsFile, looksLikePsychEvents, readPsychEventsFile, convertPsychToVSlice, convertCodenameToVSlice, buildVSliceMeta, convertVSliceToTarget,
        isFunkinMakerFile, readFunkinMakerArchive, convertFunkinMakerToVSlice
    };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.ChartConverter = api;
})(typeof window !== "undefined" ? window : globalThis);
