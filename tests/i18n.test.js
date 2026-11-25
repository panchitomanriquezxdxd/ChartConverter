"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const I = require("../i18n.js");

const root = path.resolve(__dirname, "..");
const placeholders = s => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");

test("i18n: idiomas pedidos disponibles (es, en, pt, pt-BR + otros)", () => {
    const codes = I.LANGS.map(l => l.code);
    for (const c of ["es", "en", "pt", "pt-BR"]) assert.ok(codes.includes(c), c);
    assert.deepEqual(Object.keys(I.DICT).sort(), codes.slice().sort());
});

test("i18n: todos los idiomas tienen exactamente las mismas claves que 'es'", () => {
    const base = Object.keys(I.DICT.es).sort();
    for (const [code, dict] of Object.entries(I.DICT)) {
        assert.deepEqual(Object.keys(dict).sort(), base, code);
    }
});

test("i18n: cada traducción conserva los marcadores {…} y no está vacía", () => {
    for (const [code, dict] of Object.entries(I.DICT)) {
        for (const [key, value] of Object.entries(dict)) {
            assert.ok(typeof value === "string" && value.trim(), `${code}.${key} vacío`);
            assert.equal(placeholders(value), placeholders(I.DICT.es[key]), `${code}.${key}`);
        }
    }
});

test("i18n: el inglés y el portugués realmente están traducidos (no son copia del español)", () => {
    for (const code of ["en", "pt", "pt-BR", "fr", "de", "it"]) {
        const same = Object.keys(I.DICT.es).filter(k => I.DICT[code][k] === I.DICT.es[k]);
        assert.ok(same.length < 12, `${code}: ${same.length} textos idénticos al español (${same.slice(0, 5)})`);
    }
});

test("i18n: pt (Portugal) y pt-BR son variantes distintas", () => {
    const diff = Object.keys(I.DICT.pt).filter(k => I.DICT.pt[k] !== I.DICT["pt-BR"][k]);
    assert.ok(diff.length >= 5, "pt y pt-BR casi idénticos: " + diff.length);
});

test("i18n: t() sustituye parámetros, cambia de idioma y cae a inglés/clave si falta", () => {
    assert.ok(I.setLang("es"));
    assert.equal(I.t("list.found", { n: 3 }).includes("3"), true);
    assert.ok(I.setLang("en"));
    assert.match(I.t("done.ok"), /ready|done|complete/i);
    assert.equal(I.t("clave.que.no.existe"), "clave.que.no.existe");
    assert.equal(I.setLang("xx"), false);
    assert.equal(I.getLang(), "en");
    I.setLang("es");
});

test("i18n: los avisos del convertidor salen en el idioma activo", () => {
    const CC = require("../converter.js");
    const chart = { song: { song: "L", bpm: 100, notes: [{ mustHitSection: true, sectionBeats: 4, sectionNotes: [[0, 0, 0]] }] } };
    I.setLang("es");
    assert.match(CC.convertPsychToVSlice(chart, { name: "a.json" }, "104").warnings[0], /no declara format/);
    I.setLang("en");
    const en = CC.convertPsychToVSlice(chart, { name: "a.json" }, "104").warnings[0];
    assert.match(en, /psych_v1/);
    assert.doesNotMatch(en, /no declara/);
    assert.throws(() => CC.convertPsychToVSlice({}, { name: "a.json" }), err => !/No se encontró/.test(err.message));
    I.setLang("es");
});

test("i18n: toda clave usada con t()/tr() o data-i18n* existe en el diccionario", () => {
    const keys = new Set(Object.keys(I.DICT.es));
    const used = new Set();
    for (const f of ["converter.js", "script.js"]) {
        const src = fs.readFileSync(path.join(root, f), "utf8");
        for (const m of src.matchAll(/\b(?:t|tr)\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)) used.add(m[1]);
        for (const m of src.matchAll(/\b(?:setStatus)\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)) used.add(m[1]);
        for (const m of src.matchAll(/\?\s*["']([a-z]+\.[a-zA-Z0-9_.]+)["']\s*:\s*["']([a-z]+\.[a-zA-Z0-9_.]+)["']/g)) { used.add(m[1]); used.add(m[2]); }
    }
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    for (const m of html.matchAll(/data-i18n(?:-html|-placeholder|-aria|-content)?="([^"]+)"/g)) used.add(m[1]);
    const missing = [...used].filter(k => !keys.has(k));
    assert.deepEqual(missing, []);
    assert.ok(used.size > 60, "pocas claves detectadas: " + used.size);
});

test("i18n: i18n.js se carga antes que converter.js y está en el service worker y en los builds", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.ok(html.indexOf('src="i18n.js"') > -1 && html.indexOf('src="i18n.js"') < html.indexOf('src="converter.js"'));
    assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /"i18n\.js"/);
    assert.match(fs.readFileSync(path.join(root, "scripts/build-web.js"), "utf8"), /"i18n\.js"/);
    assert.match(fs.readFileSync(path.join(root, "package.json"), "utf8"), /"i18n\.js"/);
});
