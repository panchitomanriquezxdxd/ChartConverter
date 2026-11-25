"use strict";
/* Pruebas del núcleo de conversión (sin DOM). Ejecutar:  npm test   (Node 18+) */
const test = require("node:test");
const assert = require("node:assert/strict");
const CC = require("../converter.js");

const FILE = { name: "test-hard.json" };

// Chart Psych "legacy" (0.6.3): 3 secciones, cambio de BPM y mustHit alterno.
const legacyChart = () => ({
    song: {
        song: "Test Song", bpm: 120, speed: 2.2, player1: "bf", player2: "dad", gfVersion: "gf", stage: "stage",
        notes: [
            { mustHitSection: true, sectionBeats: 4, sectionNotes: [[0, 0, 0], [500, 1, 250], [1000, 5, 0]] },
            { mustHitSection: false, sectionBeats: 4, changeBPM: true, bpm: 150, sectionNotes: [[2000, 0, 0], [2200, 4, 0], [2400, 3, 0]] },
            { mustHitSection: true, sectionBeats: 4, sectionNotes: [[3600, 2, 0], [3700, 6, 0]] }
        ]
    }
});

function toVSlice(raw, mode) {
    const r = CC.convertPsychToVSlice(raw, FILE, mode);
    const chart = { version: "2.0.0", scrollSpeed: { hard: r.speed }, notes: { hard: r.notesArr }, events: r.eventsArr };
    const meta = CC.buildVSliceMeta({ songName: r.songName, bpm: r.bpm, timeChanges: r.timeChanges, difficulties: ["hard"] });
    return { r, chart, meta };
}

test("parseJson quita el BOM de Windows", () => {
    assert.deepEqual(CC.parseJson("﻿{\"a\":1}"), { a: 1 });
});

test("slug quita acentos en vez de comerse las letras", () => {
    assert.equal(CC.slug("Ñandú Ñu!"), "nandu-nu");
    assert.equal(CC.slug("Für Elise — Remix"), "fur-elise-remix");
    assert.equal(CC.slug("¡¡¡", "fallback"), "fallback");
});

test("getDiff / songKeyFromFile reconocen las dificultades habituales", () => {
    for (const [name, diff, key] of [
        ["song-hard.json", "hard", "song"], ["song_hard.json", "hard", "song"], ["hard.json", "hard", "hard"],
        ["song-chart.json", "normal", "song"], ["Song-Erect.json", "erect", "song"], ["song.json", "normal", "song"]
    ]) {
        assert.equal(CC.getDiff(name), diff, name);
        assert.equal(CC.songKeyFromFile(name), key, name);
    }
});

test("Psych legacy → V-Slice: carriles absolutos (0-3 jugador, 4-7 oponente) y BPM", () => {
    const { r } = toVSlice(legacyChart(), "063");
    assert.deepEqual(r.notesArr.map(n => n.d), [0, 1, 5, 4, 0, 7, 2, 6]);
    assert.equal(r.notesArr[1].l, 250);
    assert.equal(r.timeChanges.length, 2);
    assert.equal(r.timeChanges[1].bpm, 150);
    assert.deepEqual(r.eventsArr.map(e => e.v.char), [0, 1, 0]); // jugador, oponente, jugador
});

test("ida y vuelta Psych legacy ↔ V-Slice conserva todas las notas", () => {
    const { r, chart, meta } = toVSlice(legacyChart(), "063");
    const out = CC.convertVSliceToTarget(chart, meta, "legacy", {});
    const back = CC.convertPsychToVSlice({ song: JSON.parse(out.files[0].content).song }, FILE, "063");
    assert.deepEqual(back.notesArr, r.notesArr);
});

test("ida y vuelta psych_v1 ↔ V-Slice conserva todas las notas", () => {
    const { r, chart, meta } = toVSlice(legacyChart(), "063");
    const out = CC.convertVSliceToTarget(chart, meta, "psych_v1", {});
    const v1 = JSON.parse(out.files[0].content);
    assert.equal(v1.format, "psych_v1");
    assert.deepEqual(CC.convertPsychToVSlice(v1, FILE, "104").notesArr, r.notesArr);
});

test("ida y vuelta Codename ↔ V-Slice conserva notas, BPM y cámara", () => {
    const { r, chart, meta } = toVSlice(legacyChart(), "063");
    const out = CC.convertVSliceToTarget(chart, meta, "codename", {});
    assert.ok(out.files.some(f => f.name.endsWith("/meta.json")));
    const back = CC.convertCodenameToVSlice(JSON.parse(out.files[0].content));
    assert.deepEqual(back.notesArr, r.notesArr);
    assert.deepEqual(back.timeChanges, r.timeChanges);
    assert.deepEqual(back.eventsArr, r.eventsArr);
});

test("eventos inline de Psych 0.7+/1.0 (FocusCamera y Add Camera Zoom)", () => {
    const r = CC.convertPsychToVSlice({
        song: {
            song: "A", bpm: 100, format: "psych_v1", notes: [{
                mustHitSection: true,
                sectionNotes: [[0, 0, 0], [1000, "FocusCamera", "1", ""], [1200, -1, "Add Camera Zoom", "0.03", ""]]
            }]
        }
    }, FILE, "auto");
    assert.equal(r.notesArr.length, 1);
    assert.deepEqual(r.eventsArr.find(e => e.t === 1000).v, { char: 1 });
    assert.equal(r.eventsArr.find(e => e.t === 1200).v.zoom, 1.03);
});

test("eventos sin equivalente en V-Slice se avisan (antes se perdían en silencio)", () => {
    const r = CC.convertPsychToVSlice({
        song: { song: "A", bpm: 100, notes: [{ mustHitSection: true, sectionNotes: [] }] },
        events: [[500, [["Add Camera Zoom", "0.04", ""], ["Screen Shake", "1, 0.05", ""], ["Screen Shake", "2, 0.05", ""]]]]
    }, FILE, "063");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /2 evento\(s\)/);
    assert.match(r.warnings[0], /Screen Shake/);
});

test("chart sin 'notes' lanza un error claro", () => {
    assert.throws(() => CC.convertPsychToVSlice({ foo: 1 }, FILE, "auto"), /notes/);
    assert.throws(() => CC.convertCodenameToVSlice({ foo: 1 }), /strumLines/);
});

test("inversa sin metadata avisa y asume 100 BPM", () => {
    const chart = { notes: { normal: [{ t: 0, d: 0, l: 0 }] }, scrollSpeed: { normal: 2 }, events: [] };
    const out = CC.convertVSliceToTarget(chart, null, "psych_v1", {});
    assert.match(out.warnings[0], /100 BPM/);
});

test("inversa: lane fuera de rango se normaliza y el título raro usa el respaldo", () => {
    const meta = { songName: "¡¡¡", timeChanges: [{ t: 0, bpm: 100 }] };
    const chart = { notes: { normal: [{ t: 0, d: -1, l: 0 }, { t: 10, d: 9, l: 0 }] } };
    const out = CC.convertVSliceToTarget(chart, meta, "psych_v1", { songKey: "fallback" });
    assert.equal(out.key, "fallback");
    assert.deepEqual(JSON.parse(out.files[0].content).notes[0].sectionNotes.map(n => n[1]), [7, 1]);
});

test("rendimiento: 60 000 notas se convierten en tiempo razonable", () => {
    const notes = Array.from({ length: 60000 }, (_, i) => ({ t: i * 120, d: i % 8, l: 0 }));
    const t0 = Date.now();
    const out = CC.convertVSliceToTarget({ notes: { hard: notes } }, { songName: "Big", timeChanges: [{ t: 0, bpm: 150 }] }, "legacy", {});
    assert.ok(out.files.length === 1);
    assert.ok(Date.now() - t0 < 5000, "tardó demasiado");
});

test("buildVSliceMeta incluye dificultades, álbum y stickers", () => {
    const m = CC.buildVSliceMeta({ songName: "X", difficulties: ["easy", "hard"], album: "Vol 1", stickerPack: "Pack" });
    assert.deepEqual(m.playData.difficulties, ["easy", "hard"]);
    assert.equal(m.playData.album, "Vol 1");
    assert.equal(m.playData.stickerPack, "Pack");
    assert.deepEqual(Object.keys(m.playData.ratings), ["easy", "hard"]);
});

test("songKeyFromFile quita chart/metadata y dificultad en cualquier orden", () => {
    for (const name of ["song-erect-chart.json", "song-chart-erect.json", "song-metadata-erect.json", "song_hard_chart.json"]) {
        assert.equal(CC.songKeyFromFile(name), "song", name);
    }
});

test("generatedBy dice Chart Converter en V-Slice y en todos los destinos inversos", () => {
    assert.match(CC.GENERATED_BY, /^Chart Converter/);
    const { chart, meta } = toVSlice(legacyChart(), "063");
    assert.equal(meta.generatedBy, CC.GENERATED_BY);
    for (const target of ["psych_v1", "legacy", "kade", "codename"]) {
        const out = CC.convertVSliceToTarget(chart, meta, target, {});
        const json = JSON.parse(out.files[0].content);
        assert.equal(json.generatedBy, CC.GENERATED_BY, target);
    }
});

test("la firma generatedBy no rompe la ida y vuelta de psych_v1 ni legacy", () => {
    const { r, chart, meta } = toVSlice(legacyChart(), "063");
    for (const [target, mode] of [["psych_v1", "104"], ["legacy", "063"]]) {
        const out = CC.convertVSliceToTarget(chart, meta, target, {});
        const back = CC.convertPsychToVSlice(JSON.parse(out.files[0].content), FILE, mode);
        assert.deepEqual(back.notesArr.map(n => n.d), r.notesArr.map(n => n.d), target);
    }
});

// ---- inverso: correcciones
const vsliceChart = extra => Object.assign({
    scrollSpeed: { default: 2.7 },
    notes: { easy: [{ t: 0, d: 0, l: 0, p: [] }, { t: 6000, d: 5, l: 0, p: [] }], hard: [{ t: 0, d: 0, l: 0, p: [] }, { t: 6000, d: 5, l: 0, p: [] }] },
    events: []
}, extra);
const vsliceMeta = { songName: "Inv", timeChanges: [{ t: 0, bpm: 120 }] };

test("inverso: scrollSpeed solo con 'default' se usa en todas las dificultades", () => {
    const out = CC.convertVSliceToTarget(vsliceChart(), vsliceMeta, "psych_v1", {});
    for (const f of out.files) assert.equal(JSON.parse(f.content).speed, 2.7, f.name);
    const own = CC.convertVSliceToTarget(vsliceChart({ scrollSpeed: { default: 2.7, hard: 3.1 } }), vsliceMeta, "psych_v1", {});
    assert.deepEqual(own.files.map(f => JSON.parse(f.content).speed), [2.7, 3.1]);
});

test("inverso: FocusCamera con char -1 (posición fija) no se toma como oponente", () => {
    const chart = vsliceChart({ events: [{ t: 0, e: "FocusCamera", v: { char: -1, x: 10, y: 20 } }] });
    const out = CC.convertVSliceToTarget(chart, vsliceMeta, "psych_v1", {});
    const song = JSON.parse(out.files[0].content);
    assert.equal(song.notes[0].mustHitSection, true);
    assert.deepEqual(song.events[0][1][0].slice(0, 2), ["Camera Follow Pos", "10"]); // ahora se convierte, no se omite
    const kade = CC.convertVSliceToTarget(chart, vsliceMeta, "kade", {});
    assert.ok(kade.warnings.some(w => /posición fija/.test(w))); // Kade no tiene equivalente
});

test("inverso: los avisos de eventos no se multiplican por cada dificultad", () => {
    const chart = vsliceChart({ events: [{ t: 1000, e: "FocusCamera", v: { char: 1 } }, { t: 500, e: "ZoomCamera", v: { zoom: 1.2, mode: "direct" } }] });
    const out = CC.convertVSliceToTarget(chart, vsliceMeta, "legacy", {});
    assert.ok(out.warnings.some(w => /^1 cambio\(s\) de cámara/.test(w)), out.warnings.join(" | "));
    assert.ok(out.warnings.some(w => /^1 ZoomCamera/.test(w)), out.warnings.join(" | "));
});

test("inverso Kade: avisa que los ZoomCamera se descartan", () => {
    const chart = vsliceChart({ events: [{ t: 500, e: "ZoomCamera", v: { zoom: 1.2, mode: "stage" } }] });
    const out = CC.convertVSliceToTarget(chart, vsliceMeta, "kade", {});
    assert.ok(out.warnings.some(w => /ZoomCamera omitidos/.test(w)));
});

test("inverso Codename: dificultades en minúsculas, iguales al nombre de archivo", () => {
    const out = CC.convertVSliceToTarget(vsliceChart(), vsliceMeta, "codename", {});
    const meta = JSON.parse(out.files.find(f => f.name.endsWith("meta.json")).content);
    assert.deepEqual(meta.difficulties, ["easy", "hard"]);
    assert.ok(out.files.some(f => f.name.endsWith("/easy.json")) && out.files.some(f => f.name.endsWith("/hard.json")));
});

test("buildVSliceMeta ordena las dificultades de fácil a difícil", () => {
    const m = CC.buildVSliceMeta({ songName: "S", difficulties: ["hard", "easy", "normal"] });
    assert.deepEqual(m.playData.difficulties, ["easy", "normal", "hard"]);
});

// ---- events.json de Psych y eventos nuevos
const sectionsChart = events => ({
    song: { song: "Ev", bpm: 120, notes: [
        { mustHitSection: true, sectionBeats: 4, sectionNotes: [[0, 0, 0]] },
        { mustHitSection: false, sectionBeats: 4, sectionNotes: [[2000, 1, 0]] },
        { mustHitSection: true, sectionBeats: 4, sectionNotes: [[4000, 2, 0]] },
        { mustHitSection: false, sectionBeats: 4, sectionNotes: [[6000, 3, 0]] }
    ] },
    events
});
const ev = (r, name) => r.eventsArr.filter(e => e.e === name);

test("events.json: se reconoce por nombre y se valida", () => {
    assert.ok(CC.isPsychEventsFile("events.json"));
    assert.ok(CC.isPsychEventsFile("Eventos/Events.JSON"));
    assert.ok(!CC.isPsychEventsFile("events-hard.json") && !CC.isPsychEventsFile("song.json"));
    assert.equal(CC.readPsychEventsFile({ song: { notes: [], events: [[1, []]] } }).length, 1);
    assert.equal(CC.readPsychEventsFile({ events: [[1, []], [2, []]], notes: [] }).length, 2);
    assert.throws(() => CC.readPsychEventsFile({ song: { notes: [] } }), /events/);
});

test("events.json: sus eventos se suman al chart sin crear secciones ni dificultades", () => {
    const extra = [[1000, [["Add Camera Zoom", "0.03", ""], ["Screen Shake", "1, 0.05", ""]]], [3000, [["Add Camera Zoom", "", ""]]]];
    const r = CC.convertPsychToVSlice(sectionsChart([]), FILE, "063", { extraEvents: extra });
    assert.deepEqual(ev(r, "ZoomCamera").map(e => [e.t, e.v.zoom]), [[1000, 1.03], [3000, 1.015]]);
    assert.deepEqual(ev(r, "FocusCamera").map(e => e.v.char), [0, 1, 0, 1]);
    assert.ok(r.warnings.some(w => /Screen Shake/.test(w)));
});

test("Hey! → PlayAnimation (BF hey, GF cheer) y Play Animation → PlayAnimation", () => {
    const r = CC.convertPsychToVSlice(sectionsChart([
        [500, [["Hey!", "bf", ""]]], [600, [["Hey!", "GF", ""]]], [700, [["Hey!", "", ""]]],
        [800, [["Play Animation", "singUP", "bf"]]], [900, [["Play Animation", "hey", "2"]]], [950, [["Play Animation", "idle", ""]]],
        [960, [["Play Animation", "", "bf"]]]
    ]), FILE, "063");
    const p = ev(r, "PlayAnimation").map(e => [e.t, e.v.target, e.v.anim, e.v.force]);
    assert.deepEqual(p, [
        [500, "boyfriend", "hey", true], [600, "girlfriend", "cheer", true],
        [700, "boyfriend", "hey", true], [700, "girlfriend", "cheer", true],
        [800, "boyfriend", "singUP", true], [900, "girlfriend", "hey", true], [950, "dad", "idle", true]
    ]);
    assert.ok(r.warnings.some(w => /Play Animation/.test(w))); // el que no trae animación
});

test("Change Scroll Speed → ScrollSpeed: duración en steps según el BPM de ese momento", () => {
    const r = CC.convertPsychToVSlice(sectionsChart([
        [1000, [["Change Scroll Speed", "1.5", "2"]]],   // 2 s a 120 BPM = 16 steps
        [3000, [["Change Scroll Speed", "0.8", "0"]]],   // al instante
        [5000, [["Change Scroll Speed", "", ""]]]        // sin valores: multiplicador 1, instantáneo
    ]), FILE, "063");
    const s = ev(r, "ScrollSpeed");
    assert.deepEqual(s.map(e => [e.t, e.v.scroll, e.v.duration, e.v.ease, e.v.absolute]),
        [[1000, 1.5, 16, "linear", false], [3000, 0.8, 0, "INSTANT", false], [5000, 1, 0, "INSTANT", false]]);
});

test("Camera Follow Pos → FocusCamera char -1; la cámara queda fija hasta soltarla", () => {
    const r = CC.convertPsychToVSlice(sectionsChart([
        [1000, [["Camera Follow Pos", "400", "250"]]],   // fija en mitad de la sección 0
        [4500, [["Camera Follow Pos", "", ""]]]          // se suelta; sigue al personaje en la sección siguiente (6000)
    ]), FILE, "063");
    // Mientras está fija se omiten los cambios de sección (2000 y 4000); al soltarla vuelve a la sección que sigue.
    assert.deepEqual(ev(r, "FocusCamera").map(e => [e.t, e.v.char, e.v.x, e.v.y]),
        [[0, 0, undefined, undefined], [1000, -1, 400, 250], [6000, 1, undefined, undefined]]);
});

test("Camera Follow Pos con un solo valor usa 0 en el otro, y soltar sin estar fija no hace nada", () => {
    const r = CC.convertPsychToVSlice(sectionsChart([
        [100, [["Camera Follow Pos", "", ""]]],
        [1000, [["Camera Follow Pos", "", "80"]]]
    ]), FILE, "063");
    const pos = ev(r, "FocusCamera").filter(e => e.v.char === -1);
    assert.deepEqual(pos.map(e => [e.t, e.v.x, e.v.y]), [[1000, 0, 80]]);
});

test("el chart de Psych sigue siendo válido con Hey!/Camera Follow Pos en eventos inline (0.7+)", () => {
    const chart = sectionsChart([]);
    chart.song.notes[0].sectionNotes.push([500, "Hey!", "bf", ""], [700, -1, "Change Scroll Speed", "2", "0"]);
    const r = CC.convertPsychToVSlice(chart, FILE, "104");
    assert.equal(ev(r, "PlayAnimation").length, 1);
    assert.equal(ev(r, "ScrollSpeed")[0].v.scroll, 2);
    assert.equal(r.notesArr.length, 4); // los eventos inline no cuentan como notas
});

// ---- inverso: eventos nuevos (PlayAnimation, ScrollSpeed, cámara fija)
const evChart = events => vsliceChart({ events });
const psychEvents = (chart, target = "psych_v1", diff = 0) => {
    const out = CC.convertVSliceToTarget(chart, vsliceMeta, target, {});
    const song = JSON.parse(out.files[diff].content);
    return { out, list: (song.song && typeof song.song === "object" ? song.song : song).events.flatMap(([t, l]) => l.map(e => [t, ...e])) };
};

test("inverso: PlayAnimation → Hey! / Play Animation; ScrollSpeed → Change Scroll Speed", () => {
    const { list, out } = psychEvents(evChart([
        { t: 500, e: "PlayAnimation", v: { target: "boyfriend", anim: "hey", force: true } },
        { t: 600, e: "PlayAnimation", v: { target: "girlfriend", anim: "cheer", force: true } },
        { t: 700, e: "PlayAnimation", v: { target: "dad", anim: "singUP", force: true } },
        { t: 800, e: "PlayAnimation", v: { target: "pico", anim: "x", force: true } },
        { t: 1000, e: "ScrollSpeed", v: { scroll: 1.5, duration: 16, ease: "linear", absolute: false, strumline: "both" } },
        { t: 3000, e: "ScrollSpeed", v: { scroll: 5.4, duration: 0, ease: "INSTANT", absolute: true, strumline: "both" } }
    ]));
    assert.deepEqual(list, [
        [500, "Hey!", "bf", ""], [600, "Hey!", "gf", ""], [700, "Play Animation", "singUP", "dad"],
        [1000, "Change Scroll Speed", "1.5", "2"],   // 16 steps a 120 BPM = 2 s
        [3000, "Change Scroll Speed", "2", "0"]      // absoluta 5.4 sobre velocidad 2.7 = x2
    ]);
    assert.ok(out.warnings.some(w => /1 PlayAnimation omitidos/.test(w)));
    assert.ok(!out.warnings.some(w => /sin equivalente omitidos/.test(w)));
});

test("inverso: el BPM de ese momento se usa al pasar steps a segundos", () => {
    const meta = { songName: "B", timeChanges: [{ t: 0, bpm: 60 }] };
    const out = CC.convertVSliceToTarget(evChart([{ t: 100, e: "ScrollSpeed", v: { scroll: 2, duration: 4, ease: "linear" } }]), meta, "legacy", {});
    const ev = JSON.parse(out.files[0].content).song.events[0][1][0];
    assert.deepEqual(ev, ["Change Scroll Speed", "2", "1"]); // 4 steps a 60 BPM = 1 s
});

test("inverso: cámara fija → Camera Follow Pos y se suelta al volver a un personaje", () => {
    const { list } = psychEvents(evChart([
        { t: 1000, e: "FocusCamera", v: { char: -1, x: 400, y: 250 } },
        { t: 4500, e: "FocusCamera", v: { char: 1 } }
    ]));
    assert.deepEqual(list.filter(e => e[1] === "Camera Follow Pos"), [[1000, "Camera Follow Pos", "400", "250"], [4500, "Camera Follow Pos", "", ""]]);
});

test("inverso: Kade y Codename avisan de los eventos nuevos que no soportan", () => {
    const chart = evChart([{ t: 500, e: "ScrollSpeed", v: { scroll: 2, duration: 0, ease: "INSTANT" } }, { t: 600, e: "PlayAnimation", v: { target: "dad", anim: "a" } }]);
    for (const target of ["kade", "codename"]) {
        const out = CC.convertVSliceToTarget(chart, vsliceMeta, target, {});
        assert.ok(out.warnings.some(w => /2 evento\(s\) sin equivalente omitidos \(ScrollSpeed, PlayAnimation\)/.test(w)), target + ": " + out.warnings.join(" | "));
    }
});

test("ida y vuelta de eventos: V-Slice → Psych → V-Slice conserva Hey!, velocidad y cámara fija", () => {
    const events = [
        { t: 500, e: "PlayAnimation", v: { target: "boyfriend", anim: "hey", force: true } },
        { t: 1000, e: "ScrollSpeed", v: { scroll: 1.5, duration: 16, ease: "linear", absolute: false, strumline: "both" } },
        { t: 1500, e: "FocusCamera", v: { char: -1, x: 400, y: 250 } }
    ];
    const out = CC.convertVSliceToTarget(evChart(events), vsliceMeta, "psych_v1", {});
    const back = CC.convertPsychToVSlice(JSON.parse(out.files[0].content), FILE, "104");
    const get = n => back.eventsArr.filter(e => e.e === n);
    assert.deepEqual(get("PlayAnimation").map(e => [e.t, e.v.target, e.v.anim]), [[500, "boyfriend", "hey"]]);
    assert.deepEqual(get("ScrollSpeed").map(e => [e.t, e.v.scroll, e.v.duration]), [[1000, 1.5, 16]]);
    assert.deepEqual(get("FocusCamera").filter(e => e.v.char === -1).map(e => [e.t, e.v.x, e.v.y]), [[1500, 400, 250]]);
});

// ---- carriles: el modo no debe invertir los lados de un chart relativo
test("modos 0.7.x / 1.0 con un chart SIN format psych_v1 usan carriles relativos (como 0.6.3)", () => {
    const chart = { song: { song: "L", bpm: 100, notes: [
        { mustHitSection: true, sectionBeats: 4, sectionNotes: [[0, 0, 0], [0, 4, 0]] },
        { mustHitSection: false, sectionBeats: 4, sectionNotes: [[2400, 0, 0], [2400, 5, 0]] }
    ] } };
    const lanes = r => r.notesArr.map(n => [n.t, n.d]);
    const want = [[0, 0], [0, 4], [2400, 4], [2400, 1]];
    assert.deepEqual(lanes(CC.convertPsychToVSlice(chart, FILE, "063")), want);
    for (const mode of ["073", "104", "auto"]) {
        assert.deepEqual(lanes(CC.convertPsychToVSlice(chart, FILE, mode)), want, mode);
    }
    assert.ok(CC.convertPsychToVSlice(chart, FILE, "104").warnings.some(w => /psych_v1/.test(w)));
    assert.ok(!CC.convertPsychToVSlice(chart, FILE, "auto").warnings.some(w => /psych_v1/.test(w)));
});

test("chart psych_v1 declarado: carriles absolutos en 0.7.x, 1.0 y auto; P Slice los fuerza", () => {
    const v1 = { format: "psych_v1", song: "V", bpm: 100, notes: [
        { mustHitSection: false, sectionBeats: 4, sectionNotes: [[0, 1, 0], [0, 6, 0]] }
    ] };
    for (const mode of ["073", "104", "auto", "absolute"]) {
        assert.deepEqual(CC.convertPsychToVSlice(v1, FILE, mode).notesArr.map(n => n.d), [1, 6], mode);
    }
    assert.deepEqual(CC.convertPsychToVSlice(v1, FILE, "063").notesArr.map(n => n.d), [5, 2]); // 063 fuerza relativos
});

test("P Slice ('absolute') fuerza carriles absolutos aunque el chart no declare el formato", () => {
    const chart = { song: { song: "P", bpm: 100, notes: [{ mustHitSection: false, sectionBeats: 4, sectionNotes: [[0, 1, 0], [0, 6, 0]] }] } };
    assert.deepEqual(CC.convertPsychToVSlice(chart, FILE, "absolute").notesArr.map(n => n.d), [1, 6]);
});
