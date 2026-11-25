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
        events: [[500, [["Add Camera Zoom", "0.04", ""], ["Hey!", "1", ""], ["Hey!", "2", ""]]]]
    }, FILE, "063");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /2 evento\(s\)/);
    assert.match(r.warnings[0], /Hey!/);
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
