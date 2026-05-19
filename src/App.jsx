import { useState, useRef, useEffect, useMemo } from "react";
import * as XLSX from "xlsx-js-style";

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const C30 = Math.cos(Math.PI / 6);
const TL = 1360, TW = 245; // default truck length/width (cm)
const PALLET_BASE_H = 15;
const DEFAULT_MAX_H = 205;
const DEFAULT_TRUCK_H = 245;
const DEFAULT_MAX_KG = 1000;
const GRID_STEP_CM = 2;
const LS_PALLETS_KEY = "palet-opt-custom-pallets";
const LS_SKUS_KEY = "palet-opt-custom-skus";

const PALLET_TYPES = [
  { label: "80 × 120 cm",  a: 80,  b: 120 },
  { label: "110 × 190 cm", a: 110, b: 190 },
  { label: "120 × 210 cm", a: 120, b: 210 },
];

const PALETTE = ["#3B82F6","#10B981","#F59E0B","#A78BFA","#F87171",
                 "#06B6D4","#EC4899","#84CC16","#FB923C","#A78BFA"];

const DEMO_SKUS = [
  { sku:"NRD-4412", name:"Seramik Döşeme 60×40",    en:60, boy:40, yuk:10, kg:18.5, qty:100, fiyat:0 },
  { sku:"NRD-2280", name:"Duvar Karosu 30×60",      en:30, boy:60, yuk:8,  kg:9.2,  qty:200, fiyat:0 },
  { sku:"NRD-8801", name:"Porselen Levha 60×60",    en:60, boy:60, yuk:12, kg:28.0, qty:50,  fiyat:0 },
  { sku:"NRD-3315", name:"Mozaik Karo 30×30",       en:30, boy:30, yuk:15, kg:6.4,  qty:400, fiyat:0 },
  { sku:"NRD-6670", name:"Dış Mekan Taş Karo 60×40",en:60, boy:40, yuk:14, kg:22.0, qty:75,  fiyat:0 },
];

// ── COLOR HELPERS ──────────────────────────────────────────────────────────
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.min(255,~~(((n>>16)&255)*f))},${Math.min(255,~~(((n>>8)&255)*f))},${Math.min(255,~~((n&255)*f))})`;
};
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
};

const THEME = {
  pageBg: "#122841",
  cardBg: "#1D395A",
  panelBg: "#17314F",
  panelBgStrong: "#142B46",
  border: "#4D739F",
  borderSoft: "#3E5F87",
  textPrimary: "#F5FAFF",
  textSecondary: "#E2EEFC",
  textMuted: "#C9DDF4",
  textSubtle: "#B3CDEB",
  dim: "#8FB1D6",
};

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function safeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseFlexibleNumber(raw) {
  let s = String(raw ?? "").trim();
  s = s.replace(/\s*(kg|g|cm|mm|m|ton|adet)\s*$/i, "").replace(/\s/g, "");
  if (!s) return 0;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // 1.234,56 -> 1234.56
      return parseFloat(s.replace(/\./g, "").replace(",", "."));
    }
    // 2,416.14 -> 2416.14
    return parseFloat(s.replace(/,/g, ""));
  }
  if (hasComma) {
    const parts = s.split(",");
    // Ondalık virgül: 79,5 · 148,5 · 30,6
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,3}$/.test(parts[1])) {
      return parseFloat(`${parts[0]}.${parts[1]}`);
    }
    // Binlik virgül: 2,416
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return parseFloat(s.replace(/,/g, ""));
    return parseFloat(s.replace(",", "."));
  }
  if (hasDot) return parseFloat(s);
  return parseFloat(s);
}

function overlap(a, b) {
  const eps = 0.01;
  return !(
    a.x + a.w <= b.x + eps ||
    b.x + b.w <= a.x + eps ||
    a.y + a.h <= b.y + eps ||
    b.y + b.h <= a.y + eps
  );
}

function validPlacement(candidate, placements, ignoreId = null, truckL = TL, truckW = TW) {
  if (candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.x + candidate.w > truckL || candidate.y + candidate.h > truckW) return false;
  return !placements.some((p) => p.id !== ignoreId && overlap(candidate, p));
}

function findFreeSpot(placements, w, h, truckL = TL, truckW = TW) {
  for (let x = 0; x <= truckL - w; x += GRID_STEP_CM) {
    for (let y = 0; y <= truckW - h; y += GRID_STEP_CM) {
      const candidate = { x, y, w, h };
      if (validPlacement(candidate, placements, null, truckL, truckW)) return { x, y };
    }
  }
  return null;
}
// ── FLAT ORIENTATION RULE ──────────────────────────────────────────────────
// orient "A": largest face down (default) | "B": middle face | "C": smallest face
function flatOrient(en, boy, yuk, orient = "A") {
  const [s, m, l] = [+en, +boy, +yuk].sort((a, b) => a - b);
  if (orient === "B") return { bH: m, bW: s, bL: l };
  if (orient === "C") return { bH: l, bW: s, bL: m };
  return { bH: s, bW: m, bL: l };
}

// ── CSV PARSER ─────────────────────────────────────────────────────────────
function normHeader(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ý/g, "i")
    .replace(/Ý/g, "i")
    .replace(/þ/g, "s")
    .replace(/Þ/g, "s")
    .replace(/[^\w]+/g, " ")
    .trim();
}

function headerMatches(hdr, alias, { exactOnly = false, shortToken = false, exclude = [] } = {}) {
  if (!hdr || !alias) return false;
  if (exclude.some((ex) => hdr.includes(ex))) return false;
  if (hdr === alias) return true;
  if (exactOnly || shortToken) return false;
  if (alias.includes(" ")) return hdr === alias || hdr.startsWith(`${alias} `);
  const first = hdr.split(/\s+/)[0];
  return first === alias;
}

const CSV_COLUMN_SPECS = {
  tedarikci: { aliases: ["tedarikci adi", "tedarikci", "supplier", "vendor", "uretici"] },
  parent: { aliases: ["parent"], exactOnly: true },
  name: { aliases: ["name", "urun adi", "product name", "title"], exclude: ["fiyat", "alis", "price"] },
  sku: { aliases: ["sku", "stok kodu", "stock kodu", "kod"] },
  paket: { aliases: ["paket sayisi", "paket", "adet", "qty", "quantity"] },
  fiyat: { aliases: ["gercek alis fiyati", "alis fiyati", "gercek alis", "fiyat", "price", "unit price"] },
  en: { aliases: ["en", "genislik", "width"], shortToken: true },
  boy: { aliases: ["boy", "uzunluk", "length"], shortToken: true },
  yuk: { aliases: ["yukseklik", "height"], exactOnly: true },
  kg: { aliases: ["agirlik", "kg", "weight"] },
};

const CSV_LAYOUT_PROFILES = {
  TAB_10: {
    id: "TAB-10",
    delim: "\t",
    colCount: 10,
    map: { tedarikci: 0, parent: 1, sku: 2, name: 3, fiyat: 4, paket: 5, en: 6, boy: 7, yuk: 8, kg: 9 },
  },
  SEMI_9: {
    id: "SEMI-9",
    delim: ";",
    colCount: 9,
    map: { tedarikci: 0, parent: 1, sku: 2, name: 3, fiyat: 4, en: 5, boy: 6, yuk: 7, kg: 8 },
  },
  SEMI_10: {
    id: "SEMI-10",
    delim: ";",
    colCount: 10,
    map: { tedarikci: 0, parent: 1, sku: 2, name: 3, fiyat: 4, paket: 5, en: 6, boy: 7, yuk: 8, kg: 9 },
  },
  LEGACY_7: {
    id: "LEGACY-7",
    delim: ",",
    colCount: 7,
    map: { parent: 0, sku: 1, paket: 2, en: 3, boy: 4, yuk: 5, kg: 6 },
  },
};

function resolveColumnMapping(hdrs) {
  const used = new Set();
  const mapping = {};
  for (const [field, spec] of Object.entries(CSV_COLUMN_SPECS)) {
    let found = { index: -1, header: null, source: "none" };
    for (const alias of spec.aliases) {
      const kwl = normHeader(alias);
      for (let i = 0; i < hdrs.length; i++) {
        if (used.has(i)) continue;
        const h = hdrs[i];
        if (headerMatches(h, kwl, {
          exactOnly: spec.exactOnly,
          shortToken: spec.shortToken,
          exclude: spec.exclude || [],
        })) {
          found = { index: i, header: hdrs[i], source: "header" };
          used.add(i);
          break;
        }
      }
      if (found.index >= 0) break;
    }
    mapping[field] = found;
  }
  return mapping;
}

function pickLayoutProfile(delim, colCount) {
  if (delim === "\t" && colCount === 10) return CSV_LAYOUT_PROFILES.TAB_10;
  if (delim === ";" && colCount === 9) return CSV_LAYOUT_PROFILES.SEMI_9;
  if (delim === ";" && colCount === 10) return CSV_LAYOUT_PROFILES.SEMI_10;
  if (delim === "," && colCount === 7) return CSV_LAYOUT_PROFILES.LEGACY_7;
  return null;
}

function applyLayoutProfile(mapping, profile) {
  if (!profile) return mapping;
  const next = { ...mapping };
  const required = ["en", "boy", "yuk", "sku"];
  const missingRequired = required.filter((k) => (next[k]?.index ?? -1) < 0);
  if (missingRequired.length < 2) return next;
  for (const [field, index] of Object.entries(profile.map)) {
    next[field] = { index, header: `(profil ${profile.id})`, source: "profile" };
  }
  return next;
}

function buildSkuFromRow(v, mapping, idx) {
  const get = (field) => {
    const i = mapping[field]?.index ?? -1;
    return i >= 0 ? String(v[i] ?? "").trim() : "";
  };
  const num = (x) => parseFlexibleNumber(x);
  const parent = get("parent");
  const displayName = get("name");
  const name = displayName
    ? (parent && displayName !== parent ? `${parent} · ${displayName}` : displayName)
    : (parent || get("sku") || `Ürün ${idx + 1}`);
  return {
    tedarikci: get("tedarikci"),
    parent,
    displayName,
    name,
    sku: get("sku") || `SKU-${idx + 1}`,
    qty: parseInt(get("paket"), 10) || 0,
    en: num(get("en")) || 0,
    boy: num(get("boy")) || 0,
    yuk: num(get("yuk")) || 0,
    kg: num(get("kg")) || 0,
    fiyat: num(get("fiyat")) || 0,
  };
}

function formatMappingSummary(mapping) {
  const labels = {
    tedarikci: "Tedarikçi",
    parent: "Parent",
    name: "NAME",
    sku: "SKU",
    fiyat: "Fiyat",
    en: "En",
    boy: "Boy",
    yuk: "Yük",
    kg: "Kg",
  };
  return Object.entries(labels)
    .filter(([key]) => (mapping[key]?.index ?? -1) >= 0)
    .map(([key, lbl]) => `${lbl}→${mapping[key].index + 1}`)
    .join(", ");
}

function validateCsvImport(rows, mapping) {
  const warnings = [];
  if (!rows.length) {
    warnings.push("Hiç geçerli satır okunamadı (En/Boy/Yükseklik > 0 olmalı).");
    return warnings;
  }
  const priceLikeName = rows.filter((r) => /^\d+([.,]\d+)?$/.test(String(r.displayName || r.name || "").trim())).length;
  if (priceLikeName > rows.length * 0.2) {
    warnings.push("Ürün adı kolonu fiyat gibi görünüyor; kolon eşlemesini kontrol edin.");
  }
  const badDims = rows.filter((r) => r.en > 500 || r.boy > 500 || r.yuk > 500).length;
  if (badDims > rows.length * 0.15) {
    warnings.push("Ölçüler olağandışı büyük; kolon kayması olabilir.");
  }
  const enIdx = mapping.en?.index ?? -1;
  const parentIdx = mapping.parent?.index ?? -1;
  const nameIdx = mapping.name?.index ?? -1;
  const fiyatIdx = mapping.fiyat?.index ?? -1;
  if (enIdx >= 0 && enIdx === parentIdx) {
    warnings.push("En kolonu Parent ile çakışıyor.");
  }
  if (nameIdx >= 0 && nameIdx === fiyatIdx) {
    warnings.push("NAME kolonu fiyat kolonu ile çakışıyor.");
  }
  return warnings;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQ && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === delim && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.map((v) => v.replace(/^"(.*)"$/, "$1").trim());
}

function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], mapping: {}, warnings: ["Dosyada başlık veya veri satırı yok."], delim: ",", profileName: null };
  }

  const delimCandidates = ["\t", ";", ",", "|"];
  const detectDelimiter = () => {
    const sample = lines.slice(0, Math.min(12, lines.length));
    let best = ",";
    let bestScore = -1;
    for (const d of delimCandidates) {
      const counts = sample.map((line) => splitCsvLine(line, d).length);
      const cols = counts[0] || 0;
      if (cols < 2) continue;
      if (!counts.every((c) => c === cols)) continue;
      const score = cols * 100 + (d === "\t" ? 20 : 0) + (d === ";" ? 18 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    if (bestScore < 0) {
      const tabCols = (lines[0].match(/\t/g) || []).length + 1;
      if (tabCols >= 5) return "\t";
      const semiCols = (lines[0].match(/;/g) || []).length + 1;
      if (semiCols >= 5) return ";";
    }
    return best;
  };

  const delim = detectDelimiter();
  const parseRow = (line) => splitCsvLine(line, delim);
  const hdrs = parseRow(lines[0]).map(normHeader);
  const colCount = hdrs.length;

  let mapping = resolveColumnMapping(hdrs);
  const profile = pickLayoutProfile(delim, colCount);
  let profileName = null;
  const headerMappedCount = ["en", "boy", "yuk", "sku", "name", "fiyat"].filter((k) => mapping[k]?.source === "header").length;
  if (headerMappedCount < 4 && profile) {
    mapping = applyLayoutProfile(mapping, profile);
    profileName = profile.id;
  }

  const rows = lines.slice(1)
    .map((line, idx) => buildSkuFromRow(parseRow(line), mapping, idx))
    .filter((s) => s.en > 0 && s.boy > 0 && s.yuk > 0);

  const warnings = validateCsvImport(rows, mapping);
  return { rows, mapping, warnings, delim, profileName };
}

function parseCSVLoose(text) {
  const primary = parseCSV(text);
  if (primary.rows.length) return primary;

  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], mapping: {}, warnings: ["Dosya boş."], delim: ",", profileName: null };
  }

  const tabCols = (lines[0].match(/\t/g) || []).length + 1;
  const semiCols = (lines[0].match(/;/g) || []).length + 1;
  const delim = tabCols >= 5 ? "\t" : (semiCols >= 5 ? ";" : ",");
  const profile = pickLayoutProfile(delim, tabCols >= 5 ? tabCols : semiCols);
  if (!profile) return primary;

  const mapping = applyLayoutProfile(resolveColumnMapping([]), profile);
  const num = (x) => parseFlexibleNumber(x);
  const rows = lines.slice(1).map((line, idx) => {
    const v = line.split(delim).map((x) => x.trim());
    return buildSkuFromRow(v, mapping, idx);
  }).filter((s) => s.en > 0 && s.boy > 0 && s.yuk > 0);

  return {
    rows,
    mapping,
    warnings: validateCsvImport(rows, mapping),
    delim,
    profileName: profile.id,
  };
}

// ── SARKIM MODEL ────────────────────────────────────────────────────────────
// mode 0  -> no extension
// mode 5  -> optional overhang up to +10 per axis (not mandatory on both axes)
// mode 15 -> board is mandatory (+20 per axis), plus optional overhang to +30 per axis
function getSarkimPolicy(mode) {
  if (mode === 15) return { baseAxisExtra: 20, maxAxisExtra: 30 };
  if (mode === 5) return { baseAxisExtra: 0, maxAxisExtra: 10 };
  return { baseAxisExtra: 0, maxAxisExtra: 0 };
}

// ── PALLET PACKING ─────────────────────────────────────────────────────────
function packPallet(bL, bW, bH, pA, pB, oh, maxProductH, maxKg, itemKg, palletBaseH = PALLET_BASE_H, partialSarkim = false, partialSarkimMode = "overflow") {
  const { baseAxisExtra, maxAxisExtra } = getSarkimPolicy(oh);
  const maxByHeight = Math.max(0, Math.floor(maxProductH / bH));

  const evalPack = (cols, rows, boxL, boxW) => {
    const perLayer = Math.max(0, cols * rows);
    const usedA = cols * boxL;
    const usedB = rows * boxW;

    const partialEnabled = partialSarkim && oh === 15;
    const partial15 = partialEnabled && oh === 15;
    const axisBase = (p, used) => {
      if (!partialEnabled) return p + baseAxisExtra;
      if (!partial15) return p;
      const overflow = Math.max(0, used - p);
      if (overflow <= 0) return p;
      const boardAdd = partialSarkimMode === "fixed10" ? 20 : Math.min(20, overflow);
      return p + boardAdd;
    };
    const axisMax = (p, used) => {
      if (!partialEnabled) return p + maxAxisExtra;
      if (!partial15) return p + 10;
      const overflow = Math.max(0, used - p);
      if (overflow <= 0) return p;
      // Parcali 15 mode: total extension on a needed axis is capped to +20 (10+10).
      const boardAdd = partialSarkimMode === "fixed10" ? 20 : Math.min(20, overflow);
      return p + boardAdd;
    };
    const minA = axisBase(pA, usedA);
    const minB = axisBase(pB, usedB);
    const maxA = axisMax(pA, usedA);
    const maxB = axisMax(pB, usedB);

    if (usedA > maxA || usedB > maxB) {
      return { cols, rows, layers: 0, boxL, boxW, effA: minA, effB: minB, score: 0 };
    }
    const effA = Math.max(minA, usedA);
    const effB = Math.max(minB, usedB);
    if (perLayer === 0 || maxByHeight === 0) {
      return { cols, rows, layers: 0, boxL, boxW, effA, effB, score: 0 };
    }
    const maxByWeight = itemKg > 0
      ? Math.max(0, Math.floor(maxKg / (perLayer * itemKg)))
      : Number.MAX_SAFE_INTEGER;
    const layers = Math.min(maxByHeight, maxByWeight);
    const score = perLayer * layers;
    return { cols, rows, layers, boxL, boxW, effA, effB, score };
  };

  const partial15 = partialSarkim && oh === 15;
  const globalMaxA = partial15 ? (pA + 20) : (pA + maxAxisExtra);
  const globalMaxB = partial15 ? (pB + 20) : (pB + maxAxisExtra);
  const [c1, r1] = [Math.floor(globalMaxA / bL), Math.floor(globalMaxB / bW)];
  const [c2, r2] = [Math.floor(globalMaxA / bW), Math.floor(globalMaxB / bL)];
  const a = evalPack(Math.max(0, c1), Math.max(0, r1), bL, bW);
  const b = evalPack(Math.max(0, c2), Math.max(0, r2), bW, bL);
  const best = b.score > a.score ? b : a;
  return {
    cols: best.cols,
    rows: best.rows,
    layers: best.layers,
    boxL: best.boxL,
    boxW: best.boxW,
    effA: best.effA,
    effB: best.effB,
  };
}

// ── TRUCK PACKING ──────────────────────────────────────────────────────────
// 'across' = pallet dim across truck width, 'along' = pallet dim along truck length
// 'paAlongL' = true if pallet's pA axis runs along truck length
function packTruck(eA, eB, truckL = TL, truckW = TW) {
  const unif = (across, along, paAlongL) => {
    const c = Math.floor(truckW / across);
    const r = Math.floor(truckL / along);
    if (!c || !r) return { n: 0, pls: [] };
    const pls = [];
    for (let ri = 0; ri < r; ri++)
      for (let ci = 0; ci < c; ci++)
        pls.push({ x: ri * along, y: ci * across, w: along, h: across, paAlongL });
    return { n: c * r, pls };
  };

  const guill = (a1, b1, paL1, a2, b2, paL2) => {
    const c1 = Math.floor(truckW / a1), c2 = Math.floor(truckW / a2);
    if (!c1) return { n: 0, pls: [] };
    let bn = 0, br1 = 0;
    for (let r = 0; r <= Math.floor(truckL / b1); r++) {
      const rem = truckL - r * b1;
      const r2 = c2 ? Math.floor(rem / b2) : 0;
      const t = c1 * r + (c2 ? c2 * r2 : 0);
      if (t > bn) { bn = t; br1 = r; }
    }
    const r2 = c2 ? Math.floor((truckL - br1 * b1) / b2) : 0;
    const pls = [];
    for (let r = 0; r < br1; r++)
      for (let c = 0; c < c1; c++)
        pls.push({ x: r * b1, y: c * a1, w: b1, h: a1, paAlongL: paL1 });
    const sx = br1 * b1;
    for (let r = 0; r < r2; r++)
      for (let c = 0; c < c2; c++)
        pls.push({ x: sx + r * b2, y: c * a2, w: b2, h: a2, paAlongL: paL2 });
    return { n: bn, pls };
  };

  return [
    unif(eA, eB, false),
    unif(eB, eA, true),
    guill(eA, eB, false, eB, eA, true),
    guill(eB, eA, true,  eA, eB, false),
  ].reduce((b, o) => o.n > b.n ? o : b, { n: -1, pls: [] }).pls;
}

/** Tır yerleşiminde uzunluk (x) ve genişlik (y) eksenindeki palet adımları */
function truckLayoutAlongAxes(pls) {
  if (!pls?.length) return { alongL: 0, alongW: 0 };
  const q = (v) => Math.round(v * 100) / 100;
  const xs = new Set(pls.map((p) => q(p.x)));
  const ys = new Set(pls.map((p) => q(p.y)));
  return { alongL: xs.size, alongW: ys.size };
}

function formatSarkimExport(oh, partialSarkim, partialSarkimMode) {
  if (oh === 0) return "Sarkım yok";
  if (oh === 5) return "+5 cm (opsiyonel taşma)";
  if (oh === 15) {
    if (partialSarkim) {
      return partialSarkimMode === "fixed10"
        ? "15 cm · Parçalı · Fix 10 cm"
        : "15 cm · Parçalı · Taşma kadar";
    }
    return "15 cm sarkım";
  }
  return `${oh} cm sarkım`;
}

/** Döviz → TL (kur: 1 birim döviz kaç TL) */
function unitPriceToTlForExport(unitPrice, currency, kurTlPerUnit) {
  if (!(unitPrice > 0)) return 0;
  if (currency === "TL") return unitPrice;
  if (Number.isFinite(kurTlPerUnit) && kurTlPerUnit > 0) return unitPrice * kurTlPerUnit;
  return 0;
}

/** Excel maliyet kolonları — UI ile aynı kur mantığı */
function resolveExportCostUnitPrice(unitPrice, currency, { useKur, kurVal, kurType }) {
  if (!(unitPrice > 0)) return { unitPrice: 0, currency: "TL" };
  if (useKur) {
    const fx = kurType === "EUR" ? "EUR" : "USD";
    if (currency === "TL") {
      if (Number.isFinite(kurVal) && kurVal > 0) {
        return { unitPrice: unitPrice / kurVal, currency: fx };
      }
      return { unitPrice: 0, currency: fx };
    }
    return { unitPrice, currency: currency === "EUR" ? "EUR" : "USD" };
  }
  return { unitPrice: unitPriceToTlForExport(unitPrice, currency, kurVal), currency: "TL" };
}

/**
 * UI’daki orientGlobalBest ile aynı paletli optimal (tek yön).
 * Dökme modu bu raporda yok — her zaman paletli senaryo.
 */
function optimalPalletLoadForOrient(sku, orient, opts) {
  const {
    allPallets,
    effectivePalletProductLimit,
    livePalletMaxKg,
    livePalletMaxH,
    livePalletBaseH,
    liveTruckH,
    truckTonKg,
    truckL,
    truckW,
    autoSarkım,
    partialSarkim,
    partialSarkimMode,
  } = opts;
  const en = sku?.en || 0, boy = sku?.boy || 0, yuk = sku?.yuk || 0, kg = sku?.kg || 0;
  const { bH: tH, bW: tW, bL: tL } = flatOrient(en, boy, yuk, orient);
  let best = null;
  const ohOptions = autoSarkım ? [0, 5, 15] : [0];
  for (const p of allPallets) {
    for (const ohOpt of ohOptions) {
      const packed = packPallet(
        tL, tW, tH,
        p.a, p.b, ohOpt,
        effectivePalletProductLimit,
        livePalletMaxKg,
        kg,
        livePalletBaseH,
        partialSarkim,
        partialSarkimMode
      );
      const pls = packTruck(packed.effA, packed.effB, truckL, truckW);
      const truckPallets = pls.length;
      const perLayerCount = packed.cols * packed.rows;
      if (perLayerCount <= 0) continue;
      const maxLayersByTruckTon = kg > 0 && truckPallets > 0
        ? Math.floor(truckTonKg / (truckPallets * perLayerCount * kg))
        : Number.MAX_SAFE_INTEGER;
      const candidateLayers = Math.max(0, Math.min(packed.layers, maxLayersByTruckTon));
      const count = perLayerCount * candidateLayers;
      if (count <= 0) continue;
      const candidateKg = count * kg;
      const candidateProductH = candidateLayers * tH;
      const candidateTruckKg = candidateKg * truckPallets;
      const candidateTotalH = livePalletBaseH + candidateProductH;
      const fits = (
        candidateProductH <= livePalletMaxH &&
        candidateKg <= livePalletMaxKg &&
        candidateTotalH <= liveTruckH &&
        candidateTruckKg <= truckTonKg
      );
      if (!fits) continue;
      const truckBoxes = truckPallets * count;
      const candidate = {
        orient,
        pallet: p.label,
        oh: ohOpt,
        cols: packed.cols,
        rows: packed.rows,
        layers: candidateLayers,
        countPerPallet: count,
        truckPallets,
        truckBoxes,
        effA: packed.effA,
        effB: packed.effB,
        bL: tL,
        bW: tW,
        bH: tH,
        pls,
      };
      if (!best || candidate.truckBoxes > best.truckBoxes) best = candidate;
    }
  }
  return best;
}

function dolulukFromOptimal(candidate, truckL, truckW, liveTruckH, livePalletBaseH) {
  if (!candidate) {
    return {
      totalM2: "",
      doluM2: "",
      bosM2: "",
      totalM3: "",
      doluM3: "",
      bosM3: "",
    };
  }
  const totalM2 = (truckL * truckW) / 10000;
  const nPal = candidate.truckPallets;
  const doluM2 = (nPal * candidate.effA * candidate.effB) / 10000;
  const bosM2 = Math.max(0, totalM2 - doluM2);
  const totalM3 = (truckL * truckW * liveTruckH) / 1_000_000;
  const volBox = candidate.bL * candidate.bW * candidate.bH;
  const totalBoxVol = (candidate.truckBoxes * volBox) / 1_000_000;
  const baseVol = (nPal * candidate.effA * candidate.effB * livePalletBaseH) / 1_000_000;
  const doluM3 = totalBoxVol + baseVol;
  const bosM3 = Math.max(0, totalM3 - doluM3);
  const r4 = (n) => Number(n.toFixed(4));
  return {
    totalM2: r4(totalM2),
    doluM2: r4(doluM2),
    bosM2: r4(bosM2),
    totalM3: r4(totalM3),
    doluM3: r4(doluM3),
    bosM3: r4(bosM3),
  };
}

function summarizePalletConfig(cand, partialSarkim, partialSarkimMode) {
  if (!cand) return "—";
  return `${cand.pallet}; ${formatSarkimExport(cand.oh, partialSarkim, partialSarkimMode)}`;
}

function palletDetailLine(cand) {
  if (!cand) return "—";
  return `${cand.countPerPallet} kutu; dizilim ${cand.cols} × ${cand.rows} × ${cand.layers}`;
}

function truckDetailLine(cand) {
  if (!cand) return "—";
  const { alongL, alongW } = truckLayoutAlongAxes(cand.pls);
  return `${cand.truckPallets} palet; dizilim ${alongL} × ${alongW}`;
}

/** Excel export: A/B/C arasında en yüksek tır kapasitesi (UI bestFit ile aynı skor) */
function exportCandidateScore(cand, skuKg) {
  const productH = (cand.layers || 0) * (cand.bH || 0);
  const palletKg = (cand.countPerPallet || 0) * (skuKg || 0);
  return [cand.truckBoxes || 0, cand.countPerPallet || 0, -productH, -palletKg];
}

function pickBestExportOrient(candidatesByOrient, skuKg) {
  let bestOrient = null;
  let bestCand = null;
  for (const orient of ["A", "B", "C"]) {
    const cand = candidatesByOrient[orient];
    if (!cand) continue;
    if (!bestCand) {
      bestOrient = orient;
      bestCand = cand;
      continue;
    }
    const cur = exportCandidateScore(bestCand, skuKg);
    const next = exportCandidateScore(cand, skuKg);
    for (let i = 0; i < next.length; i++) {
      if (next[i] > cur[i]) {
        bestOrient = orient;
        bestCand = cand;
        break;
      }
      if (next[i] < cur[i]) break;
    }
  }
  return bestOrient;
}

const EXPORT_ORIENT_COL_START = { A: 9, B: 14, C: 19 };
const EXPORT_ORIENT_BLOCK_COLS = 5;
const EXCEL_OPTIMAL_FILL = { patternType: "solid", fgColor: { rgb: "FFFF00" } };

function highlightExportOptimalRow(ws, sheetRow, orient) {
  if (!orient) return;
  const col0 = EXPORT_ORIENT_COL_START[orient];
  for (let dc = 0; dc < EXPORT_ORIENT_BLOCK_COLS; dc++) {
    const addr = XLSX.utils.encode_cell({ r: sheetRow, c: col0 + dc });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = { fill: EXCEL_OPTIMAL_FILL };
  }
}

// ── ISO HELPERS ────────────────────────────────────────────────────────────
const toIso = (x, y, z, s) => [(x - y) * C30 * s, ((x + y) / 2 - z) * s];
const mkP   = (pts, s) => pts.map(([x, y, z]) => toIso(x, y, z, s).join(",")).join(" ");

function IsoBox({ x, y, z, w, d, h, col, s, bf = 1, project = toIso }) {
  const sk = "rgba(0,0,0,0.18)", sw = 0.65;
  const mk = (pts) => pts.map(([px, py, pz]) => project(px, py, pz, s).join(",")).join(" ");
  return (
    <g>
      <polygon points={mk([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]])}
        fill={shade(col, bf * 0.43)} stroke={sk} strokeWidth={sw} />
      <polygon points={mk([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]])}
        fill={shade(col, bf * 0.67)} stroke={sk} strokeWidth={sw} />
      <polygon points={mk([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]])}
        fill={shade(col, bf * 1.0)}  stroke={sk} strokeWidth={sw} />
    </g>
  );
}

// ── PALLET ISO VIEW ────────────────────────────────────────────────────────
function PalletView({ sku, pa, pb, oh, col, pack, extraBoxes = 0, orient = "A", palletBaseH = PALLET_BASE_H }) {
  const [yawDeg, setYawDeg] = useState(0);
  const dragRef = useRef(null);
  const { bH } = flatOrient(sku.en, sku.boy, sku.yuk, orient);
  const { cols, rows, layers, boxL, boxW } = pack;
  const perLayer = cols * rows;
  const safeExtra = Math.max(0, extraBoxes);
  const totalBoxes = perLayer > 0 ? perLayer * layers + safeExtra : 0;
  const highestLayerIndex = perLayer > 0 && totalBoxes > 0
    ? Math.floor((totalBoxes - 1) / perLayer)
    : Math.max(0, layers - 1);
  const yaw = (yawDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const pivotX = pa / 2;
  const pivotY = pb / 2;
  const project = (x, y, z, s) => {
    const dx = x - pivotX;
    const dy = y - pivotY;
    const rx = pivotX + dx * cy - dy * sy;
    const ry = pivotY + dx * sy + dy * cy;
    return toIso(rx, ry, z, s);
  };

  const stackL = cols * boxL;
  const stackD = rows * boxW;
  const offX = (pa - stackL) / 2;
  const offY = (pb - stackD) / 2;

  const wxMin = Math.min(0, offX);
  const wxMax = Math.max(pa, offX + stackL);
  const wyMin = Math.min(0, offY);
  const wyMax = Math.max(pb, offY + stackD);
  const wzMax = palletBaseH + (highestLayerIndex + 1) * bH;

  const span = (wxMax - wxMin) + (wyMax - wyMin);
  const S = Math.min(2.5, Math.max(0.52, 330 / Math.max(1, span * C30)));

  const wCorners = [
    [wxMin,wyMin,0],[wxMax,wyMin,0],[wxMin,wyMax,0],[wxMax,wyMax,0],
    [wxMin,wyMin,wzMax],[wxMax,wyMin,wzMax],[wxMin,wyMax,wzMax],[wxMax,wyMax,wzMax],
  ].map(([x, y, z]) => project(x, y, z, S));
  const pad = 18;
  const vx0 = Math.min(...wCorners.map(c => c[0])) - pad;
  const vy0 = Math.min(...wCorners.map(c => c[1])) - pad;
  const vx1 = Math.max(...wCorners.map(c => c[0])) + pad;
  const vy1 = Math.max(...wCorners.map(c => c[1])) + pad;
  const vW = vx1 - vx0, vH = vy1 - vy0;

  const boxList = [];
  if (cols > 0 && rows > 0 && totalBoxes > 0) {
    for (let i = 0; i < totalBoxes; i++) {
      const ly = Math.floor(i / perLayer);
      const slot = i % perLayer;
      const ry = Math.floor(slot / cols);
      const cx = slot % cols;
      const bf = 0.50 + (ly / Math.max(highestLayerIndex, 1)) * 0.55;
      boxList.push({
        x: offX + cx * boxL,
        y: offY + ry * boxW,
        z: palletBaseH + ly * bH,
        bf,
        key: `${ly}-${ry}-${cx}-${i}`,
      });
    }
    boxList.sort((a, b) => a.z - b.z || (a.x + a.y) - (b.x + b.y));
  }

  const ohLine = oh > 0
    ? [[0,0,palletBaseH],[pa,0,palletBaseH],[pa,pb,palletBaseH],[0,pb,palletBaseH],[0,0,palletBaseH]]
        .map(([x, y, z]) => project(x, y, z, S).join(",")).join(" ")
    : null;

  const [scx, scy] = project(pa / 2, pb / 2, 0, S);

  return (
    <svg width="100%" viewBox={`0 0 ${vW.toFixed(1)} ${vH.toFixed(1)}`}
      style={{ maxHeight: 420, display: "block", userSelect: "none", cursor: "grab" }}
      onMouseDown={(e) => {
        dragRef.current = { x: e.clientX, base: yawDeg };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.x;
        setYawDeg(Math.max(-70, Math.min(70, dragRef.current.base + dx * 0.25)));
      }}
      onMouseUp={() => { dragRef.current = null; }}
      onMouseLeave={() => { dragRef.current = null; }}
    >
      <defs>
        <filter id="ps-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#000" floodOpacity="0.4" />
        </filter>
      </defs>
      <g transform={`translate(${(-vx0).toFixed(2)},${(-vy0).toFixed(2)})`}>
        <ellipse cx={scx} cy={scy + 7}
          rx={(pa + pb) * C30 * S * 0.42} ry={(pa + pb) * S * 0.085}
          fill="rgba(0,0,0,0.28)" filter="url(#ps-shadow)" />
        <IsoBox x={0} y={0} z={0} w={pa} d={pb} h={palletBaseH} col="#7B5B1C" s={S} bf={1} project={project} />
        {[pa * 0.33, pa * 0.66].map((lx, i) => {
          const [x1, y1] = project(lx, 0, palletBaseH, S);
          const [x2, y2] = project(lx, pb, palletBaseH, S);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(0,0,0,0.11)" strokeWidth={0.8} />;
        })}
        {boxList.map(b => (
          <IsoBox key={b.key} x={b.x} y={b.y} z={b.z}
            w={boxL} d={boxW} h={bH} col={col} s={S} bf={b.bf} project={project} />
        ))}
        {(cols === 0 || rows === 0 || layers === 0) && (
          <text x={project(pa/2, pb/2, palletBaseH+10, S)[0]} y={project(pa/2, pb/2, palletBaseH+10, S)[1]}
            textAnchor="middle" fontSize={11} fill="#F87171" fontWeight={700}>
            ⚠ Ürün Palete Sığmıyor
          </text>
        )}
        {ohLine && <polyline points={ohLine} fill="none" stroke="#FBBF24"
          strokeWidth={2} strokeDasharray="7,4" opacity={0.92} />}
      </g>
      <text x={12} y={16} fill="#D1E7FF" fontSize={10} fontWeight={700}>Surukle: yatay dondur ({yawDeg.toFixed(0)}°)</text>
    </svg>
  );
}

// ── ORIENT BOX PREVIEW ─────────────────────────────────────────────────────
// Shows a static isometric box with A/B/C face labels.
// Face areas: top=m×l (A), front=s×l (B), right=s×m (C)
function OrientBox({ en, boy, yuk, activeOrient, col }) {
  const [s, m, l] = [+en, +boy, +yuk].sort((a, b) => a - b);
  const W = l, D = m, H = s;
  const S = Math.min(2.8, Math.max(0.9, 220 / Math.max(1, (W + D) * C30)));

  const corners = [
    [0,0,0],[W,0,0],[0,D,0],[W,D,0],
    [0,0,H],[W,0,H],[0,D,H],[W,D,H],
  ].map(([x,y,z]) => toIso(x,y,z,S));
  const pad = 14;
  const vx0 = Math.min(...corners.map(c=>c[0])) - pad;
  const vy0 = Math.min(...corners.map(c=>c[1])) - pad;
  const vx1 = Math.max(...corners.map(c=>c[0])) + pad;
  const vy1 = Math.max(...corners.map(c=>c[1])) + pad;
  const vW = vx1 - vx0, vH = vy1 - vy0;

  // face centers in iso coords
  const faceCenterIso = (pts) => {
    const xs = pts.map(([x,y,z]) => toIso(x,y,z,S)[0]);
    const ys = pts.map(([x,y,z]) => toIso(x,y,z,S)[1]);
    return [(Math.min(...xs)+Math.max(...xs))/2, (Math.min(...ys)+Math.max(...ys))/2];
  };
  // A = top face (z=H)
  const [ax, ay] = faceCenterIso([[0,0,H],[W,0,H],[W,D,H],[0,D,H]]);
  // B = front face (y=D)
  const [bx, by] = faceCenterIso([[0,D,0],[W,D,0],[W,D,H],[0,D,H]]);
  // C = right face (x=W)
  const [cx, cy] = faceCenterIso([[W,0,0],[W,D,0],[W,D,H],[W,0,H]]);

  const boxCol = col || "#3B82F6";
  const labelStyle = (face) => ({
    fontSize: Math.min(22, Math.max(12, S * 9)),
    fontWeight: 900,
    fill: activeOrient === face ? "#FFFFFF" : "rgba(255,255,255,0.55)",
    paintOrder: "stroke",
    stroke: "rgba(0,0,0,0.55)",
    strokeWidth: 3,
  });

  return (
    <svg width="100%" viewBox={`0 0 ${vW.toFixed(1)} ${vH.toFixed(1)}`}
      style={{ maxHeight: 190, display: "block" }}>
      <g transform={`translate(${(-vx0).toFixed(2)},${(-vy0).toFixed(2)})`}>
        <IsoBox x={0} y={0} z={0} w={W} d={D} h={H} col={boxCol} s={S} bf={1} />
        <text x={ax} y={ay} textAnchor="middle" dominantBaseline="middle" {...labelStyle("A")}>A</text>
        <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle" {...labelStyle("B")}>B</text>
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" {...labelStyle("C")}>C</text>
      </g>
    </svg>
  );
}

// ── TRUCK MAP (DETAILED: pallet + package footprint, in 3 layered passes) ──
function TruckMap({
  placements,
  setPlacements,
  selectedIds,
  setSelectedIds,
  col,
  fpA,
  fpB,
  theme,
  readOnly = false,
  truckL = TL,
  truckW = TW,
  showPackageOverlay = true,
  bulkMode = false,
}) {
  const SC = 0.9;
  const SNAP_DIST_CM = 4;
  const tw = truckL * SC, th = truckW * SC;
  const PL = 44, PT = 10;
  const svgRef = useRef();
  const [drag, setDrag] = useState(null);

  const toCm = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - PL) / SC;
    const y = (clientY - rect.top - PT) / SC;
    return { x, y };
  };
  const roundCm = (v) => Math.round(v * 2) / 2;
  const clampRect = (x, y, w, h) => ({
    x: Math.max(0, Math.min(truckL - w, x)),
    y: Math.max(0, Math.min(truckW - h, y)),
  });
  const snapAxis = (value, candidates, threshold) => {
    let best = value;
    let bestDist = threshold + 1;
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  };
  const applySoftSnap = (targetX, targetY, w, h, staticPlacements) => {
    const xCandidates = [0, truckL - w];
    const yCandidates = [0, truckW - h];
    for (const sp of staticPlacements) {
      // Side-by-side candidates (touching edges)
      xCandidates.push(sp.x - w, sp.x + sp.w);
      yCandidates.push(sp.y - h, sp.y + sp.h);
      // Alignment candidates (same left/right or top/bottom lines)
      xCandidates.push(sp.x, sp.x + sp.w - w);
      yCandidates.push(sp.y, sp.y + sp.h - h);
    }
    let snappedX = snapAxis(targetX, xCandidates, SNAP_DIST_CM);
    let snappedY = snapAxis(targetY, yCandidates, SNAP_DIST_CM);

    // Coupled snapping: if we're close to top/bottom contact, also align on X.
    // If we're close to left/right contact, also align on Y.
    for (const sp of staticPlacements) {
      const topTouchY = sp.y - h;
      const bottomTouchY = sp.y + sp.h;
      if (Math.abs(targetY - topTouchY) <= SNAP_DIST_CM || Math.abs(targetY - bottomTouchY) <= SNAP_DIST_CM) {
        snappedY = Math.abs(targetY - topTouchY) < Math.abs(targetY - bottomTouchY) ? topTouchY : bottomTouchY;
        snappedX = snapAxis(
          snappedX,
          [sp.x, sp.x + sp.w - w, sp.x + (sp.w - w) / 2],
          SNAP_DIST_CM
        );
      }

      const leftTouchX = sp.x - w;
      const rightTouchX = sp.x + sp.w;
      if (Math.abs(targetX - leftTouchX) <= SNAP_DIST_CM || Math.abs(targetX - rightTouchX) <= SNAP_DIST_CM) {
        snappedX = Math.abs(targetX - leftTouchX) < Math.abs(targetX - rightTouchX) ? leftTouchX : rightTouchX;
        snappedY = snapAxis(
          snappedY,
          [sp.y, sp.y + sp.h - h, sp.y + (sp.h - h) / 2],
          SNAP_DIST_CM
        );
      }
    }

    const clamped = clampRect(roundCm(snappedX), roundCm(snappedY), w, h);
    return { x: clamped.x, y: clamped.y };
  };
  const nearestFreeSpot = (staticPlacements, w, h, targetX, targetY) => {
    const snap = (v, max) => Math.max(0, Math.min(max, roundCm(v)));
    const isValid = (x, y) => {
      const cand = { x, y, w, h };
      if (cand.x < 0 || cand.y < 0 || cand.x + cand.w > truckL || cand.y + cand.h > truckW) return false;
      return !staticPlacements.some((sp) => overlap(cand, sp));
    };
    const tx = snap(targetX, truckL - w);
    const ty = snap(targetY, truckW - h);
    if (isValid(tx, ty)) return { x: tx, y: ty };
    const step = 2;
    const maxR = Math.max(truckL, truckW);
    for (let r = step; r <= maxR; r += step) {
      for (let d = -r; d <= r; d += step) {
        const candidates = [
          { x: tx + d, y: ty - r },
          { x: tx + d, y: ty + r },
          { x: tx - r, y: ty + d },
          { x: tx + r, y: ty + d },
        ];
        for (const c of candidates) {
          const cx = snap(c.x, truckL - w);
          const cy = snap(c.y, truckW - h);
          if (isValid(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return null;
  };

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (evt) => {
      if (!svgRef.current) return;
      const { x, y } = toCm(evt.clientX, evt.clientY);
      setPlacements((prev) => {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        const movedIds = new Set(drag.ids);
        const staticPlacements = prev.filter((p) => !movedIds.has(p.id));
        const nextById = new Map(
          drag.ids.map((id) => {
            const origin = drag.origins[id];
            const w = drag.sizes[id].w;
            const h = drag.sizes[id].h;
            const raw = clampRect(roundCm(origin.x + dx), roundCm(origin.y + dy), w, h);
            const snapped = applySoftSnap(raw.x, raw.y, w, h, staticPlacements);
            return [id, { x: snapped.x, y: snapped.y }];
          })
        );
        return prev.map((p) => {
          const n = nextById.get(p.id);
          return n ? { ...p, x: n.x, y: n.y } : p;
        });
      });
    };
    const onUp = () => {
      setPlacements((prev) => {
        const movedIds = new Set(drag.ids);
        const movedPlacements = prev.filter((p) => movedIds.has(p.id));
        const staticPlacements = prev.filter((p) => !movedIds.has(p.id));
        const validBounds = movedPlacements.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= truckL && p.y + p.h <= truckW);
        let validStaticOverlap = true;
        for (const p of movedPlacements) {
          if (staticPlacements.some((sp) => overlap(p, sp))) { validStaticOverlap = false; break; }
        }
        let validInternalOverlap = true;
        for (let i = 0; i < movedPlacements.length; i++) {
          for (let j = i + 1; j < movedPlacements.length; j++) {
            if (overlap(movedPlacements[i], movedPlacements[j])) { validInternalOverlap = false; break; }
          }
          if (!validInternalOverlap) break;
        }
        if (validBounds && validStaticOverlap && validInternalOverlap) return prev;
        if (drag.ids.length === 1 && movedPlacements.length === 1) {
          const p = movedPlacements[0];
          const spot = nearestFreeSpot(staticPlacements, p.w, p.h, p.x, p.y);
          if (spot) return prev.map((item) => item.id === p.id ? { ...item, x: spot.x, y: spot.y } : item);
        }
        return prev.map((p) => {
          if (!movedIds.has(p.id)) return p;
          const origin = drag.origins[p.id];
          return origin ? { ...p, x: origin.x, y: origin.y } : p;
        });
      });
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, setPlacements]);

  const isMultiToggle = (evt) => evt.ctrlKey || evt.metaKey || evt.shiftKey;
  const startDrag = (evt, ids, leadPlacement) => {
    const m = toCm(evt.clientX, evt.clientY);
    const origins = {};
    const sizes = {};
    placements.forEach((pl) => {
      if (ids.includes(pl.id)) {
        origins[pl.id] = { x: pl.x, y: pl.y };
        sizes[pl.id] = { w: pl.w, h: pl.h };
      }
    });
    setDrag({
      ids,
      origins,
      sizes,
      startX: m.x,
      startY: m.y,
      leadX: leadPlacement.x,
      leadY: leadPlacement.y,
    });
  };

  const handlePalletMouseDown = (evt, p) => {
    if (readOnly) return;
    evt.stopPropagation();
    if (isMultiToggle(evt)) {
      setSelectedIds((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]);
      return;
    }
    const activeIds = selectedIds.includes(p.id) ? selectedIds : [p.id];
    setSelectedIds(activeIds);
    startDrag(evt, activeIds, p);
  };

  const gridX = [];
  for (let x = 0; x <= truckL; x += 20) gridX.push(x);
  const gridY = [];
  for (let y = 0; y <= truckW; y += 10) gridY.push(y);
  const truckRect = { x: 0, y: 0, w: truckL, h: truckW };
  const overflowParts = (inner, outer) => {
    const parts = [];
    const innerRight = inner.x + inner.w;
    const innerBottom = inner.y + inner.h;
    const outerRight = outer.x + outer.w;
    const outerBottom = outer.y + outer.h;
    const midX = Math.max(inner.x, outer.x);
    const midRight = Math.min(innerRight, outerRight);
    if (inner.x < outer.x) parts.push({ x: inner.x, y: inner.y, w: outer.x - inner.x, h: inner.h });
    if (innerRight > outerRight) parts.push({ x: outerRight, y: inner.y, w: innerRight - outerRight, h: inner.h });
    if (inner.y < outer.y && midRight > midX) parts.push({ x: midX, y: inner.y, w: midRight - midX, h: outer.y - inner.y });
    if (innerBottom > outerBottom && midRight > midX) parts.push({ x: midX, y: outerBottom, w: midRight - midX, h: innerBottom - outerBottom });
    return parts.filter((r) => r.w > 0 && r.h > 0);
  };
  const toSvgRect = (r) => ({
    x: r.x * SC,
    y: r.y * SC,
    w: r.w * SC,
    h: r.h * SC,
  });

  return (
    <div style={{ overflowX: "auto", border: `1px solid ${theme.borderSoft}`, borderRadius: 10, cursor: readOnly ? "default" : (drag ? "grabbing" : "default") }}>
      <svg
        ref={svgRef}
        width={tw + PL + 12}
        height={th + PT + 28}
        style={{ display: "block", background: theme.panelBgStrong, userSelect: "none" }}
      >
        <g transform={`translate(${PL},${PT})`} onMouseDown={() => setSelectedIds([])}>
          <rect x={0} y={0} width={tw} height={th}
            fill={theme.panelBg} stroke={theme.border} strokeWidth={1.5} rx={2} />
          {gridX.map((x) => {
            const strong = x % 100 === 0;
            return (
              <line
                key={`gx-${x}`}
                x1={x * SC}
                y1={0}
                x2={x * SC}
                y2={th}
                stroke={strong ? alpha("#E5F1FF", 0.26) : alpha("#E5F1FF", 0.13)}
                strokeWidth={strong ? 1 : 0.65}
                strokeDasharray={strong ? "2,3" : "1.5,4.5"}
                style={{ pointerEvents: "none" }}
              />
            );
          })}
          {gridY.map((y) => {
            const strong = y % 50 === 0;
            return (
              <line
                key={`gy-${y}`}
                x1={0}
                y1={y * SC}
                x2={tw}
                y2={y * SC}
                stroke={strong ? alpha("#E5F1FF", 0.26) : alpha("#E5F1FF", 0.13)}
                strokeWidth={strong ? 1 : 0.65}
                strokeDasharray={strong ? "2,3" : "1.5,4.5"}
                style={{ pointerEvents: "none" }}
              />
            );
          })}
          <rect x={0} y={0} width={tw} height={th} fill="rgba(239,68,68,0.05)" />
          <rect x={0} y={0}        width={tw} height={4 * SC} fill="#192A3A" />
          <rect x={0} y={th-4*SC} width={tw} height={4 * SC} fill="#192A3A" />

          {/* LAYER 1 — Pallets (brown wood) */}
          {placements.map((p, i) => {
            const px = p.x*SC, py = p.y*SC, pw = p.w*SC, ph = p.h*SC;
            const longHoriz = pw >= ph;
            const isSelected = selectedIds.includes(p.id);
            return (
              <g
                key={p.id}
                onMouseDown={(e) => handlePalletMouseDown(e, p)}
                style={{ cursor: "grab" }}
              >
                <rect x={px+0.4} y={py+0.4} width={pw-0.8} height={ph-0.8}
                  fill={bulkMode ? alpha(col, 0.58) : "#7B5B1C"}
                  stroke={isSelected ? "#FCD34D" : (bulkMode ? shade(col, 0.6) : "#3D2D0E")}
                  strokeWidth={isSelected ? 2.1 : 0.5}
                  rx={1.5} />
                {[0.25, 0.5, 0.75].map((t, j) => longHoriz ? (
                  <line key={j} x1={px+pw*t} y1={py+1.5} x2={px+pw*t} y2={py+ph-1.5}
                    stroke="rgba(0,0,0,0.30)" strokeWidth={0.4} />
                ) : (
                  <line key={j} x1={px+1.5} y1={py+ph*t} x2={px+pw-1.5} y2={py+ph*t}
                    stroke="rgba(0,0,0,0.30)" strokeWidth={0.4} />
                ))}
              </g>
            );
          })}

          {/* LAYER 2 — Package footprints centered on each pallet */}
          {showPackageOverlay && placements.map((p, i) => {
            const fpL = p.paAlongL ? fpA : fpB;
            const fpW = p.paAlongL ? fpB : fpA;
            if (fpL <= 0 || fpW <= 0) return null;
            const pkg = {
              x: p.x + (p.w - fpL) / 2,
              y: p.y + (p.h - fpW) / 2,
              w: fpL,
              h: fpW,
            };
            const palletOverflow = overflowParts(pkg, p);
            const truckOverflow = overflowParts(pkg, truckRect);
            const hasOverflow = palletOverflow.length > 0 || truckOverflow.length > 0;
            const pk = toSvgRect(pkg);
            return (
              <g key={`pkg-${p.id}`} style={{ pointerEvents: "none" }}>
                <rect x={pk.x} y={pk.y} width={pk.w} height={pk.h}
                  fill={alpha(col, hasOverflow ? 0.48 : 0.74)}
                  stroke={hasOverflow ? "#F59E0B" : shade(col, 0.5)}
                  strokeWidth={hasOverflow ? 1.4 : 0.7}
                  strokeDasharray={hasOverflow ? "4,3" : undefined}
                  rx={1} />
                {palletOverflow.map((r, idx) => {
                  const sr = toSvgRect(r);
                  return <rect key={`p-over-${idx}`} x={sr.x} y={sr.y} width={sr.w} height={sr.h}
                    fill="rgba(245,158,11,0.55)" stroke="#F59E0B" strokeWidth={0.8} rx={1} />;
                })}
                {truckOverflow.map((r, idx) => {
                  const sr = toSvgRect(r);
                  return <rect key={`t-over-${idx}`} x={sr.x} y={sr.y} width={sr.w} height={sr.h}
                    fill="rgba(239,68,68,0.58)" stroke="#F87171" strokeWidth={0.9} rx={1} />;
                })}
              </g>
            );
          })}

          {/* LAYER 3 — Pallet numbers */}
          {placements.map((p, i) => {
            const px = p.x*SC, py = p.y*SC, pw = p.w*SC, ph = p.h*SC;
            if (pw < 14 || ph < 9) return null;
            return (
              <text key={`n-${p.id}`} x={px+pw/2} y={py+ph/2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={Math.min(pw, ph) * 0.27} fill="white"
                fontWeight={800} opacity={0.92} style={{ pointerEvents: "none" }}>
                {i + 1}
              </text>
            );
          })}

          <rect x={tw-8} y={0} width={8} height={th} fill="#1B2A3B" rx={1} />
          <rect x={tw-8} y={th*0.18} width={3} height={th*0.64} fill="#2C3F55" rx={1} />
          <text x={tw/2} y={th+17} textAnchor="middle" fontSize={11} fill={theme.textMuted}>
            {truckL} cm ← Tır Uzunluğu →
          </text>
        </g>
        <text x={15} y={th/2+PT} textAnchor="middle" dominantBaseline="middle"
          fontSize={12} fill={theme.textMuted} transform={`rotate(-90,15,${th/2+PT})`}>
          {truckW} cm
        </text>
      </svg>
    </div>
  );
}

// ── SEARCHABLE SKU COMBOBOX ────────────────────────────────────────────────
function SkuCombobox({ skus, skuI, setSkuI, color, theme }) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const [hov, setHov]   = useState(0);
  const ref     = useRef();
  const inpRef  = useRef();
  const listRef = useRef();

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false); setQ("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => { setHov(0); }, [q]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[hov];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  }, [hov, open]);

  const filtered = (q.trim() === "")
    ? skus.map((s, _i) => ({ ...s, _i }))
    : skus.map((s, _i) => ({ ...s, _i })).filter(s => {
        const ql = q.toLowerCase();
        return s.sku.toLowerCase().includes(ql) ||
               s.name.toLowerCase().includes(ql);
      });

  const sel = skus[skuI];
  const onSelect = (i) => {
    setSkuI(i); setOpen(false); setQ("");
    if (inpRef.current && inpRef.current.blur) inpRef.current.blur();
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        ref={inpRef}
        type="text"
        value={open ? q : (sel ? `${sel.sku} — ${sel.name}` : "")}
        placeholder={open ? "🔍  SKU veya ürün adı yazın..." : "Ürün seç..."}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            if (inpRef.current && inpRef.current.blur) inpRef.current.blur();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setHov(h => Math.min(filtered.length - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHov(h => Math.max(0, h - 1));
          } else if (e.key === "Enter" && filtered[hov]) {
            e.preventDefault();
            onSelect(filtered[hov]._i);
          }
        }}
        style={{
          width: "100%", boxSizing: "border-box",
          background: theme.panelBgStrong, color: theme.textSecondary,
          border: `1px solid ${open ? color : theme.border}`, borderRadius: 8,
          padding: "9px 34px 9px 12px", fontSize: 14,
          outline: "none", cursor: "text", transition: "border 0.15s",
        }}
      />
      <span style={{
        position: "absolute", right: 10, top: "50%",
        transform: "translateY(-50%)", color: theme.textMuted,
        fontSize: 12.5, pointerEvents: "none",
      }}>
        {open ? "🔍" : "▾"}
      </span>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: theme.panelBg, border: `1px solid ${theme.border}`,
          borderRadius: 8, zIndex: 100,
          boxShadow: "0 10px 26px rgba(0,0,0,0.6)",
        }}>
          <div style={{
            padding: "7px 11px", fontSize: 11, color: theme.textMuted,
            fontWeight: 800, letterSpacing: 1.5,
            borderBottom: `1px solid ${theme.border}`, textTransform: "uppercase",
          }}>
            {filtered.length} / {skus.length} SKU eşleşti
          </div>
          <div ref={listRef} style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 14, color: theme.textSecondary, fontSize: 12, textAlign: "center" }}>
                Eşleşen SKU bulunamadı
              </div>
            ) : (
              filtered.map((s, idx) => {
                const isSel = s._i === skuI;
                const isHov = idx === hov;
                return (
                  <div key={s._i}
                    onClick={() => onSelect(s._i)}
                    onMouseEnter={() => setHov(idx)}
                    style={{
                      padding: "9px 11px", cursor: "pointer", fontSize: 13.5,
                      background: isSel ? alpha(color, 0.13) : (isHov ? THEME.cardBg : "transparent"),
                      borderLeft: `2px solid ${isSel ? color : "transparent"}`,
                      transition: "background 0.1s",
                    }}>
                    <div style={{ fontWeight: 700, color: isSel ? color : theme.textPrimary }}>
                      {s.sku}
                    </div>
                    <div style={{ fontSize: 11.5, color: theme.textSecondary, marginTop: 1 }}>
                      {s.name} · {s.en}×{s.boy}×{s.yuk}cm · {s.kg}kg
                      {s.qty ? ` · ${s.qty} pkt` : ""}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UI HELPERS ─────────────────────────────────────────────────────────────
function Gauge({ lbl, val, max, unit, theme }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeVal = Number.isFinite(val) ? val : 0;
  const pct = Math.min(100, (safeVal / safeMax) * 100);
  const c = pct < 70 ? "#22D3EE" : pct < 90 ? "#FBBF24" : "#EF4444";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 7 }}>
        <span style={{ color: theme.textSecondary }}>{lbl}</span>
        <span style={{ color: c, fontWeight: 700 }}>
          {safeVal % 1 ? safeVal.toFixed(1) : safeVal} / {safeMax} {unit}
        </span>
      </div>
      <div style={{ background: theme.panelBg, borderRadius: 6, height: 11, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 6,
          transition: "width 0.32s ease",
          background: `linear-gradient(90deg,${shade(c,0.55)},${c})` }} />
      </div>
      <div style={{ fontSize: 12, color: theme.textMuted, textAlign: "right", marginTop: 3 }}>
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

function StatRow({ k, v, vc, theme }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0",
      borderBottom: `1px solid ${theme.borderSoft}`, fontSize: 14 }}>
      <span style={{ color: theme.textMuted }}>{k}</span>
      <span style={{ color: vc || theme.textSecondary, fontWeight: 800, textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Badge({ ok, lbl }) {
  return (
    <span style={{
      fontSize: 12, padding: "4px 10px", borderRadius: 20, fontWeight: 800,
      border: `1px solid ${ok ? "#34D399" : "#F87171"}35`,
      background: ok ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)",
      color: ok ? "#34D399" : "#F87171",
    }}>
      {ok ? "✓" : "✗"} {lbl}
    </span>
  );
}

function LayerEditor({ baseLayers, effectiveLayers, setLayerAdjust, extraBoxInput, setExtraBoxInput, addExtraBoxes, removeExtraBoxes, resetExtraBoxes, extraBoxes, theme }) {
  return (
    <div style={{
      marginTop: 10,
      borderTop: `1px solid ${theme.borderSoft}`,
      paddingTop: 10,
      background: alpha("#0F1F33", 0.55),
      borderRadius: 10,
      padding: "10px 12px",
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: theme.textPrimary, fontWeight: 700 }}>
          Kat Kontrolu: {effectiveLayers} kat (taban: {baseLayers})
        </span>
        <button
          onClick={() => setLayerAdjust((v) => v + 1)}
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${theme.border}`, background: "rgba(59,130,246,0.14)", color: "#BFDBFE", cursor: "pointer" }}
        >
          Kat Ekle
        </button>
        <button
          onClick={() => setLayerAdjust((v) => Math.max(-baseLayers, v - 1))}
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${theme.border}`, background: "rgba(239,68,68,0.12)", color: "#FCA5A5", cursor: "pointer" }}
        >
          Kat Cikar
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: theme.textMuted }}>Kutu ekle:</span>
        <input
          type="text"
          inputMode="numeric"
          value={extraBoxInput}
          onChange={(e) => setExtraBoxInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExtraBoxes()}
          style={{ width: 90, background: theme.panelBgStrong, color: theme.textPrimary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, outline: "none" }}
        />
        <button
          onClick={addExtraBoxes}
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${theme.border}`, background: "rgba(16,185,129,0.12)", color: "#86EFAC", cursor: "pointer" }}
        >
          Kutu Ekle
        </button>
        <button
          onClick={removeExtraBoxes}
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${theme.border}`, background: "rgba(239,68,68,0.12)", color: "#FCA5A5", cursor: "pointer" }}
        >
          Kutu Cikar
        </button>
        <button
          onClick={resetExtraBoxes}
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${theme.border}`, background: "rgba(255,255,255,0.09)", color: theme.textSecondary, cursor: "pointer" }}
        >
          Ek Kutuyu Sifirla ({extraBoxes})
        </button>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [baseSkus, setBaseSkus] = useState(DEMO_SKUS.map((s, i) => ({ ...s, _id: `base-${i}-${s.sku}` })));
  const [customSkus, setCustomSkus] = useState(() =>
    safeRead(LS_SKUS_KEY, []).map((s, i) => ({ ...s, _id: `custom-${i}-${s.sku}`, persist: true }))
  );
  const [customPallets, setCustomPallets] = useState(() =>
    safeRead(LS_PALLETS_KEY, []).map((p, i) => ({ ...p, _id: `custom-p-${i}`, persist: true }))
  );
  const [isDemo, setIsDemo] = useState(true);
  const [skuI,   setSkuI]   = useState(0);
  const [palI,   setPalI]   = useState(0);
  const [useDefaultLimits, setUseDefaultLimits] = useState(true);
  const [bulkLoad, setBulkLoad] = useState(false);
  const [autoSarkım, setAutoSarkım] = useState(true);
  const [partialSarkim, setPartialSarkim] = useState(true);
  const [partialSarkimMode, setPartialSarkimMode] = useState("overflow");
  const [manualOh,   setManualOh]   = useState(0);
  const [maxH, setMaxH] = useState(DEFAULT_MAX_H);
  const [maxKg, setMaxKg] = useState(DEFAULT_MAX_KG);
  const [palletBaseH, setPalletBaseH] = useState(PALLET_BASE_H);
  const [truckL, setTruckL] = useState(TL);
  const [truckW, setTruckW] = useState(TW);
  const [truckHeightLimit, setTruckHeightLimit] = useState(DEFAULT_TRUCK_H);
  const [truckTonLimit, setTruckTonLimit] = useState(22);
  const [useDefaultTruckDims, setUseDefaultTruckDims] = useState(true);
  const [maxHInput, setMaxHInput] = useState(String(DEFAULT_MAX_H));
  const [maxKgInput, setMaxKgInput] = useState(String(DEFAULT_MAX_KG));
  const [palletBaseHInput, setPalletBaseHInput] = useState(String(PALLET_BASE_H));
  const [truckLInput, setTruckLInput] = useState(String(TL));
  const [truckWInput, setTruckWInput] = useState(String(TW));
  const [truckHeightInput, setTruckHeightInput] = useState(String(DEFAULT_TRUCK_H));
  const [truckTonInput, setTruckTonInput] = useState("22");
  const [placements, setPlacements] = useState([]);
  const [selectedPlacementIds, setSelectedPlacementIds] = useState([]);
  const [layerAdjust, setLayerAdjust] = useState(0);
  const [extraBoxes, setExtraBoxes] = useState(0);
  const [extraBoxInput, setExtraBoxInput] = useState("1");
  const [quickAddPanel, setQuickAddPanel] = useState("none");
  const [newPal, setNewPal] = useState({ label: "", a: "", b: "", mode: "temporary" });
  const [newSku, setNewSku] = useState({ sku: "", name: "", en: "", boy: "", yuk: "", kg: "", qty: "", fiyat: "", mode: "temporary" });
  const [msg,    setMsg]    = useState("");
  const [orient, setOrient] = useState("A");
  const [useKur,    setUseKur]    = useState(false);
  const [kurInput,  setKurInput]  = useState("");
  const [kurType,   setKurType]   = useState("USD");
  const [manualPriceInput, setManualPriceInput] = useState("");
  const [manualPriceCurrency, setManualPriceCurrency] = useState("TL");
  const fRef = useRef();
  const parseNum = (v) => parseFlexibleNumber(v);

  const allPallets = useMemo(
    () => [
      ...PALLET_TYPES.map((p, i) => ({ ...p, _id: `base-p-${i}`, source: "default" })),
      ...customPallets.map((p) => ({ ...p, source: "custom" })),
    ],
    [customPallets]
  );
  const skus = useMemo(() => [...baseSkus, ...customSkus], [baseSkus, customSkus]);
  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setMsg("⏳ Yükleniyor...");
    const r = new FileReader();
    r.onload = ev => {
      try {
        let result = parseCSV(ev.target.result);
        if (!result.rows.length) result = parseCSVLoose(ev.target.result);
        if (!result.rows.length) {
          const warn = result.warnings?.[0] || "CSV boş ya da format tanınamadı.";
          setMsg(`⚠ ${warn}`);
          return;
        }
        setBaseSkus(result.rows.map((s, i) => ({ ...s, _id: `csv-${i}-${s.sku}` })));
        setSkuI(0);
        setIsDemo(false);
        const mapSummary = formatMappingSummary(result.mapping);
        let msgText = `✓ ${result.rows.length} SKU yüklendi`;
        if (mapSummary) msgText += ` · ${mapSummary}`;
        if (result.profileName) msgText += ` · profil ${result.profileName}`;
        if (result.warnings?.length) msgText += ` · ${result.warnings.join(" ")}`;
        setMsg(msgText);
      } catch { setMsg("✗ Dosya okunamadı."); }
    };
    r.readAsText(f, "UTF-8");
    e.target.value = "";
  }

  // Derived
  useEffect(() => {
    localStorage.setItem(
      LS_PALLETS_KEY,
      JSON.stringify(customPallets.filter((p) => p.persist).map(({ label, a, b }) => ({ label, a, b })))
    );
  }, [customPallets]);

  useEffect(() => {
    localStorage.setItem(
      LS_SKUS_KEY,
      JSON.stringify(customSkus.filter((s) => s.persist).map(({ sku, name, qty, en, boy, yuk, kg, fiyat }) => ({ sku, name, qty, en, boy, yuk, kg, fiyat })))
    );
  }, [customSkus]);

  useEffect(() => {
    if (skuI >= skus.length) setSkuI(0);
  }, [skuI, skus.length]);

  useEffect(() => {
    if (palI >= allPallets.length) setPalI(0);
  }, [palI, allPallets.length]);

  const sku = skus[skuI] || skus[0];
  const pal = allPallets[palI] || allPallets[0];
  const col = PALETTE[skuI % PALETTE.length];
  const livePalletMaxH = (() => {
    const parsed = parseNum(maxHInput);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : maxH;
  })();
  const livePalletMaxKg = (() => {
    const parsed = parseNum(maxKgInput);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : maxKg;
  })();
  const livePalletBaseH = (() => {
    const parsed = parseNum(palletBaseHInput);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : palletBaseH;
  })();
  const liveTruckH = (() => {
    const parsed = parseNum(truckHeightInput);
    return Number.isFinite(parsed) && parsed >= 10 ? parsed : truckHeightLimit;
  })();
  const liveTruckTon = (() => {
    const parsed = parseNum(truckTonInput);
    return Number.isFinite(parsed) && parsed >= 0.1 ? parsed : truckTonLimit;
  })();
  const liveTruckL = (() => {
    const parsed = parseNum(truckLInput);
    return Number.isFinite(parsed) && parsed >= 100 ? parsed : truckL;
  })();
  const liveTruckW = (() => {
    const parsed = parseNum(truckWInput);
    return Number.isFinite(parsed) && parsed >= 100 ? parsed : truckW;
  })();
  const truckTonKg = liveTruckTon * 1000;
  const bulkProductHeightLimit = Math.max(0, liveTruckH - 30);
  const truckBasedPalletProductLimit = Math.max(0, liveTruckH - livePalletBaseH);
  const effectivePalletProductLimit = Math.min(livePalletMaxH, truckBasedPalletProductLimit);
  useEffect(() => {
    if (!useDefaultLimits) return;
    setMaxH(DEFAULT_MAX_H);
    setMaxKg(DEFAULT_MAX_KG);
    setPalletBaseH(PALLET_BASE_H);
    setMaxHInput(String(DEFAULT_MAX_H));
    setMaxKgInput(String(DEFAULT_MAX_KG));
    setPalletBaseHInput(String(PALLET_BASE_H));
  }, [useDefaultLimits]);
  useEffect(() => {
    if (!useDefaultTruckDims) return;
    setTruckL(TL);
    setTruckW(TW);
    setTruckHeightLimit(DEFAULT_TRUCK_H);
    setTruckTonLimit(22);
    setTruckLInput(String(TL));
    setTruckWInput(String(TW));
    setTruckHeightInput(String(DEFAULT_TRUCK_H));
    setTruckTonInput("22");
  }, [useDefaultTruckDims]);

  // bestOption computed first (no dependency on oh) so autoSarkım can derive oh from it
  const bestOption = useMemo(() => {
    let bestFit = null;
    let bestAny = null;
    if (bulkLoad) {
      for (const ort of ["A", "B", "C"]) {
        const { bH: tH, bW: tW, bL: tL } = flatOrient(sku?.en || 0, sku?.boy || 0, sku?.yuk || 0, ort);
        const placements = packTruck(tL, tW, liveTruckL, liveTruckW);
        const unitsPerTruck = placements.length;
        if (unitsPerTruck <= 0) continue;
        const byH = tH > 0 ? Math.floor(bulkProductHeightLimit / tH) : 0;
        const byKg = (sku?.kg || 0) > 0 ? Math.floor(truckTonKg / (unitsPerTruck * (sku?.kg || 0))) : Number.MAX_SAFE_INTEGER;
        const layers = Math.max(0, Math.min(byH, byKg));
        if (layers <= 0) continue;
        const truckBoxes = unitsPerTruck * layers;
        const candidate = {
          mode: "bulk",
          pallet: "Dökme",
          count: layers,
          truckPallets: unitsPerTruck,
          truckBoxes,
          layers,
          cols: 1,
          rows: 1,
          oh: 0,
          orient: ort,
          fits: true,
          h: layers * tH,
          kg: layers * (sku?.kg || 0),
          truckKg: truckBoxes * (sku?.kg || 0),
        };
        if (!bestAny || candidate.truckBoxes > bestAny.truckBoxes) bestAny = candidate;
        if (!bestFit || candidate.truckBoxes > bestFit.truckBoxes) bestFit = candidate;
      }
    } else {
      const ohOptions = autoSarkım ? [0, 5, 15] : [0];
      const orientOptions = ["A", "B", "C"];
      for (const p of allPallets) {
        for (const ohOpt of ohOptions) {
          for (const ort of orientOptions) {
            const { bH: tH, bW: tW, bL: tL } = flatOrient(sku?.en || 0, sku?.boy || 0, sku?.yuk || 0, ort);
            const packed = packPallet(tL, tW, tH, p.a, p.b, ohOpt, effectivePalletProductLimit, livePalletMaxKg, sku?.kg || 0, livePalletBaseH, partialSarkim, partialSarkimMode);
            const truckPallets = packTruck(packed.effA, packed.effB, liveTruckL, liveTruckW).length;
            const perLayerCount = packed.cols * packed.rows;
            if (perLayerCount <= 0) continue;
            const maxLayersByTruckTon = (sku?.kg || 0) > 0 && truckPallets > 0
              ? Math.floor(truckTonKg / (truckPallets * perLayerCount * (sku?.kg || 0)))
              : Number.MAX_SAFE_INTEGER;
            const candidateLayers = Math.max(0, Math.min(packed.layers, maxLayersByTruckTon));
            const count = perLayerCount * candidateLayers;
            if (count <= 0) continue;
            const candidateKg = count * (sku?.kg || 0);
            const candidateProductH = candidateLayers * tH;
            const candidateTruckKg = candidateKg * truckPallets;
            const candidateTotalH = livePalletBaseH + candidateProductH;
            const fits = (
              candidateProductH <= livePalletMaxH &&
              candidateKg <= livePalletMaxKg &&
              candidateTotalH <= liveTruckH &&
              candidateTruckKg <= truckTonKg
            );
            const truckBoxes = truckPallets * count;
            const candidate = {
              mode: "pallet",
              pallet: p.label,
              count,
              truckPallets,
              truckBoxes,
              layers: candidateLayers,
              cols: packed.cols,
              rows: packed.rows,
              oh: ohOpt,
              orient: ort,
              fits,
              h: candidateProductH,
              kg: candidateKg,
              truckKg: candidateTruckKg,
            };
            if (!bestAny || candidate.truckBoxes > bestAny.truckBoxes) bestAny = candidate;
            if (!candidate.fits) continue;
            if (!bestFit) { bestFit = candidate; continue; }
            const bestScore = [bestFit.truckBoxes, bestFit.count, -bestFit.h, -bestFit.kg];
            const nextScore = [candidate.truckBoxes, candidate.count, -candidate.h, -candidate.kg];
            for (let i = 0; i < nextScore.length; i++) {
              if (nextScore[i] > bestScore[i]) { bestFit = candidate; break; }
              if (nextScore[i] < bestScore[i]) break;
            }
          }
        }
      }
    }
    return { bestFit, bestAny };
  }, [allPallets, sku?.en, sku?.boy, sku?.yuk, sku?.kg, effectivePalletProductLimit, livePalletMaxKg, autoSarkım, liveTruckL, liveTruckW, livePalletBaseH, liveTruckH, truckTonKg, bulkLoad, bulkProductHeightLimit, partialSarkim, partialSarkimMode]);

  const orientGlobalBest = useMemo(() => {
    const out = {};
    for (const ort of ["A", "B", "C"]) {
      let best = null;
      const { bH: tH, bW: tW, bL: tL } = flatOrient(sku?.en || 0, sku?.boy || 0, sku?.yuk || 0, ort);
      if (bulkLoad) {
        const placements = packTruck(tL, tW, liveTruckL, liveTruckW);
        const unitsPerTruck = placements.length;
        if (unitsPerTruck > 0) {
          const byH = tH > 0 ? Math.floor(bulkProductHeightLimit / tH) : 0;
          const byKg = (sku?.kg || 0) > 0 ? Math.floor(truckTonKg / (unitsPerTruck * (sku?.kg || 0))) : Number.MAX_SAFE_INTEGER;
          const layers = Math.max(0, Math.min(byH, byKg));
          if (layers > 0) {
            const totalBoxes = unitsPerTruck * layers;
            best = {
              orient: ort,
              mode: "bulk",
              count: layers,
              truckPallets: unitsPerTruck,
              truckBoxes: totalBoxes,
            };
          }
        }
      } else {
        const ohOptions = autoSarkım ? [0, 5, 15] : [0];
        for (const p of allPallets) {
          for (const ohOpt of ohOptions) {
            const packed = packPallet(tL, tW, tH, p.a, p.b, ohOpt, effectivePalletProductLimit, livePalletMaxKg, sku?.kg || 0, livePalletBaseH, partialSarkim, partialSarkimMode);
            const truckPallets = packTruck(packed.effA, packed.effB, liveTruckL, liveTruckW).length;
            const perLayerCount = packed.cols * packed.rows;
            if (perLayerCount <= 0) continue;
            const maxLayersByTruckTon = (sku?.kg || 0) > 0 && truckPallets > 0
              ? Math.floor(truckTonKg / (truckPallets * perLayerCount * (sku?.kg || 0)))
              : Number.MAX_SAFE_INTEGER;
            const candidateLayers = Math.max(0, Math.min(packed.layers, maxLayersByTruckTon));
            const count = perLayerCount * candidateLayers;
            if (count <= 0) continue;
            const candidateKg = count * (sku?.kg || 0);
            const candidateProductH = candidateLayers * tH;
            const candidateTruckKg = candidateKg * truckPallets;
            const candidateTotalH = livePalletBaseH + candidateProductH;
            const fits = (
              candidateProductH <= livePalletMaxH &&
              candidateKg <= livePalletMaxKg &&
              candidateTotalH <= liveTruckH &&
              candidateTruckKg <= truckTonKg
            );
            if (!fits) continue;
            const candidate = {
              orient: ort,
              mode: "pallet",
              pallet: p.label,
              oh: ohOpt,
              count,
              truckPallets,
              truckBoxes: truckPallets * count,
              truckKg: candidateTruckKg,
            };
            if (!best || candidate.truckBoxes > best.truckBoxes) best = candidate;
          }
        }
      }
      out[ort] = best;
    }
    return out;
  }, [allPallets, sku?.en, sku?.boy, sku?.yuk, sku?.kg, effectivePalletProductLimit, livePalletMaxKg, autoSarkım, liveTruckL, liveTruckW, livePalletBaseH, liveTruckH, truckTonKg, bulkLoad, bulkProductHeightLimit, partialSarkim, partialSarkimMode]);

  const oh = autoSarkım ? manualOh : 0;

  const { bH, bW, bL } = flatOrient(sku?.en || 0, sku?.boy || 0, sku?.yuk || 0, orient);
  const basePack = packPallet(bL, bW, bH, pal.a, pal.b, oh, effectivePalletProductLimit, livePalletMaxKg, sku?.kg || 0, livePalletBaseH, partialSarkim, partialSarkimMode);
  const effPalA = basePack.effA;
  const effPalB = basePack.effB;
  const { cols, rows, layers } = basePack;
  const nPal = placements.length;
  const perLayer = cols * rows;
  const effectiveLayers = Math.max(0, layers + layerAdjust);
  const tonnageLayerCap = (!bulkLoad && (sku?.kg || 0) > 0 && nPal > 0 && perLayer > 0)
    ? Math.floor(truckTonKg / (nPal * perLayer * (sku?.kg || 0)))
    : Number.MAX_SAFE_INTEGER;
  const effectiveLayersByTon = bulkLoad ? effectiveLayers : Math.max(0, Math.min(effectiveLayers, tonnageLayerCap));
  const pack = { ...basePack, layers: effectiveLayersByTon };
  const fpA  = cols * pack.boxL;
  const fpB  = rows * pack.boxW;
  const ippRaw = cols * rows * effectiveLayersByTon;
  const ipp  = Math.max(0, ippRaw + extraBoxes);
  const pKg  = ipp * (sku?.kg || 0);
  const extraLayerCount = perLayer > 0 ? Math.ceil(Math.max(0, extraBoxes) / perLayer) : 0;
  const visualLayers = effectiveLayersByTon + extraLayerCount;
  const stkH = livePalletBaseH + visualLayers * bH;
  const productLoadH = visualLayers * bH;
  const palletTotalHeightLimit = livePalletMaxH + livePalletBaseH;
  const layoutState = useMemo(() => {
    const boundsOk = placements.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= liveTruckL && p.y + p.h <= liveTruckW);
    let overlapOk = true;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        if (overlap(placements[i], placements[j])) {
          overlapOk = false;
          break;
        }
      }
      if (!overlapOk) break;
    }
    return {
      boundsOk,
      overlapOk,
      valid: boundsOk && overlapOk,
    };
  }, [placements, liveTruckL, liveTruckW]);
  const autoPlacements = useMemo(() => {
    const base = bulkLoad
      ? packTruck(bL, bW, liveTruckL, liveTruckW)
      : packTruck(effPalA, effPalB, liveTruckL, liveTruckW);
    return base.map((p, i) => ({ ...p, id: `auto-${i}` }));
  }, [bulkLoad, bL, bW, effPalA, effPalB, liveTruckL, liveTruckW, truckTonKg]);
  useEffect(() => {
    setPlacements(autoPlacements);
    setSelectedPlacementIds([]);
  }, [autoPlacements]);
  useEffect(() => {
    setSelectedPlacementIds([]);
    setLayerAdjust(0);
    setExtraBoxes(0);
  }, [bulkLoad]);

  const bulkBaseLayers = useMemo(() => {
    if (!bulkLoad || nPal <= 0 || bH <= 0) return 0;
    const byH = Math.floor(bulkProductHeightLimit / bH);
    const byKg = (sku?.kg || 0) > 0 ? Math.floor(truckTonKg / (nPal * (sku?.kg || 0))) : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(byH, byKg));
  }, [bulkLoad, nPal, bH, bulkProductHeightLimit, sku?.kg, truckTonKg]);
  useEffect(() => {
    const minAdjust = bulkLoad ? -bulkBaseLayers : -layers;
    setLayerAdjust((prev) => Math.max(minAdjust, prev));
  }, [bulkLoad, bulkBaseLayers, layers]);
  const bulkLayers = Math.max(0, bulkBaseLayers + layerAdjust);
  const bulkItems = Math.max(0, nPal * bulkLayers + extraBoxes);
  const bulkHeight = bulkLayers * bH;
  const bulkKg = bulkItems * (sku?.kg || 0);

  const placementUnits = bulkLoad ? bulkLayers : ipp;
  const placementKg = bulkLoad ? (bulkLayers * (sku?.kg || 0)) : pKg;
  const totalItems = bulkLoad ? bulkItems : nPal * ipp;
  const totalKg = bulkLoad ? bulkKg : nPal * pKg;
  const stackHeight = bulkLoad ? bulkHeight : stkH;
  const heightGaugeVal = bulkLoad ? stackHeight : productLoadH;
  const heightGaugeMax = bulkLoad ? bulkProductHeightLimit : livePalletMaxH;
  const weightGaugeVal = bulkLoad ? totalKg : placementKg;
  const weightGaugeMax = livePalletMaxKg;
  const nItm = totalItems;
  const nTon = totalKg / 1000;
  const truckMapKey = `${liveTruckL}-${liveTruckW}-${liveTruckH}-${liveTruckTon}-${bulkLoad ? "bulk" : "pallet"}-${orient}-${fpA}-${fpB}-${nPal}-${placementUnits}-${Math.round(truckTonKg)}`;

  const skuFiyat = sku?.fiyat || 0;
  const manualUnit = Math.max(0, parseNum(manualPriceInput) || 0);
  const actualUnitPrice = manualUnit > 0 ? manualUnit : skuFiyat;
  const actualPriceCurrency = manualUnit > 0 ? manualPriceCurrency : "TL";
  const liveKur = parseNum(kurInput);
  const unitCountPerPlacement = placementUnits;
  let effectiveUnitPrice = actualUnitPrice;
  let effectiveCurrency = actualPriceCurrency;
  if (useKur && actualPriceCurrency === "TL") {
    if (Number.isFinite(liveKur) && liveKur > 0) {
      effectiveUnitPrice = actualUnitPrice / liveKur;
      effectiveCurrency = kurType;
    } else {
      effectiveUnitPrice = 0;
      effectiveCurrency = kurType;
    }
  }
  const paletMaliyeti = effectiveUnitPrice * unitCountPerPlacement;
  const tirMaliyeti = paletMaliyeti * nPal;
  const currencySymbol = effectiveCurrency === "USD" ? "$" : (effectiveCurrency === "EUR" ? "€" : "₺");
  const totalM2 = (liveTruckL * liveTruckW) / 10000;
  const totalM3 = (liveTruckL * liveTruckW * liveTruckH) / 1_000_000;
  const doluM2 = placements.reduce((sum, p) => sum + (p.w * p.h) / 10000, 0);
  const boxVolumeM3 = (bL * bW * bH) / 1_000_000;
  const totalBoxVolumeM3 = nItm * boxVolumeM3;
  const totalPalletBaseVolumeM3 = bulkLoad
    ? 0
    : placements.reduce((sum, p) => sum + (p.w * p.h * livePalletBaseH) / 1_000_000, 0);
  const doluM3 = totalBoxVolumeM3 + totalPalletBaseVolumeM3;
  const bosM2 = Math.max(0, totalM2 - doluM2);
  const bosM3 = Math.max(0, totalM3 - doluM3);

  const card = { background:THEME.cardBg, borderRadius:12, padding:"16px 18px", border:`1px solid ${THEME.border}` };
  const SL   = { fontSize:11, color:THEME.textPrimary, fontWeight:900, letterSpacing:1.2,
                 marginBottom:10, display:"block", textTransform:"uppercase" };
  const SEL  = { width:"100%", background:THEME.panelBgStrong, color:THEME.textSecondary,
                 border:`1px solid ${THEME.border}`, borderRadius:8, padding:"7px 10px",
                 fontSize:13.5, outline:"none", cursor:"pointer" };

  const msgCol = msg.startsWith("✓") ? "#34D399" : msg.startsWith("⚠") ? "#FCD34D" : "#F87171";
  const msgBg  = msg.startsWith("✓") ? "rgba(52,211,153,0.08)" :
                 msg.startsWith("⚠") ? "rgba(252,211,77,0.08)" : "rgba(248,113,113,0.08)";
  const INPUT_COMMON = { ...SEL, padding: "6px 10px" };

  const handleExportExcel = () => {
    try {
      if (!skus.length) {
        setMsg("⚠ Dışa aktarılacak ürün yok.");
        return;
      }
      const exportCtx = {
        allPallets,
        effectivePalletProductLimit,
        livePalletMaxKg,
        livePalletMaxH,
        livePalletBaseH,
        liveTruckH,
        truckTonKg,
        truckL: liveTruckL,
        truckW: liveTruckW,
        autoSarkım,
        partialSarkim,
        partialSarkimMode,
      };
      const kurVal = parseNum(kurInput);
      const manualU = Math.max(0, parseNum(manualPriceInput) || 0);
      const exportCostCurrency = useKur && Number.isFinite(kurVal) && kurVal > 0
        ? (kurType === "EUR" ? "EUR" : "USD")
        : "TL";
      const costSuffix = `(${exportCostCurrency})`;
      const hdr = [
        "Tedarikçi",
        "Parent",
        "SKU",
        "Ürün Adı (NAME)",
        "En (cm)",
        "Boy (cm)",
        "Yükseklik (cm)",
        "Ağırlık (kg)",
        "Gerçek Alış Fiyatı",
        "A Palet özeti",
        "A Palet kutu/dizilim",
        "A Tır yerleşim",
        `A Palet maliyeti ${costSuffix}`,
        `A Tır maliyeti ${costSuffix}`,
        "B Palet özeti",
        "B Palet kutu/dizilim",
        "B Tır yerleşim",
        `B Palet maliyeti ${costSuffix}`,
        `B Tır maliyeti ${costSuffix}`,
        "C Palet özeti",
        "C Palet kutu/dizilim",
        "C Tır yerleşim",
        `C Palet maliyeti ${costSuffix}`,
        `C Tır maliyeti ${costSuffix}`,
        "A Dolu m²",
        "A Dolu m³",
        "B Dolu m²",
        "B Dolu m³",
        "C Dolu m²",
        "C Dolu m³",
      ];
      const bestOrients = [];
      const dataRows = skus.map((rowSku) => {
        const skuCsvFiyat = rowSku?.fiyat || 0;
        // CSV'de fiyat varsa her zaman onu kullan; manuel fiyat sadece CSV'siz SKU fallback'i.
        const actualPrice = skuCsvFiyat > 0 ? skuCsvFiyat : manualU;
        const priceCurrency = skuCsvFiyat > 0 ? "TL" : manualPriceCurrency;
        const priceLabel = actualPrice > 0
          ? `${actualPrice} ${priceCurrency === "USD" ? "USD" : priceCurrency === "EUR" ? "EUR" : "TL"}`
          : "—";
        const { unitPrice: costUnitPrice } = resolveExportCostUnitPrice(
          actualPrice,
          priceCurrency,
          { useKur, kurVal, kurType }
        );

        const cA = optimalPalletLoadForOrient(rowSku, "A", exportCtx);
        const cB = optimalPalletLoadForOrient(rowSku, "B", exportCtx);
        const cC = optimalPalletLoadForOrient(rowSku, "C", exportCtx);

        const costCells = [cA, cB, cC].flatMap((cand) => {
          const cols = cand
            ? [
                summarizePalletConfig(cand, partialSarkim, partialSarkimMode),
                palletDetailLine(cand),
                truckDetailLine(cand),
              ]
            : ["—", "—", "—"];
          if (!(costUnitPrice > 0) || !cand) return [...cols, "—", "—"];
          return [
            ...cols,
            +(costUnitPrice * cand.countPerPallet).toFixed(2),
            +(costUnitPrice * cand.truckBoxes).toFixed(2),
          ];
        });

        const doluCells = [cA, cB, cC].flatMap((cand) => {
          const d = dolulukFromOptimal(cand, liveTruckL, liveTruckW, liveTruckH, livePalletBaseH);
          if (!cand) return ["—", "—"];
          return [d.doluM2, d.doluM3];
        });

        bestOrients.push(pickBestExportOrient({ A: cA, B: cB, C: cC }, rowSku.kg || 0));

        return [
          rowSku.tedarikci || "",
          rowSku.parent || "",
          rowSku.sku,
          rowSku.displayName || rowSku.name,
          rowSku.en,
          rowSku.boy,
          rowSku.yuk,
          rowSku.kg,
          priceLabel,
          ...costCells,
          ...doluCells,
        ];
      });

      const truckTotalM2 = (liveTruckL * liveTruckW) / 10000;
      const truckTotalM3 = (liveTruckL * liveTruckW * liveTruckH) / 1_000_000;
      const wb = XLSX.utils.book_new();
      const info = [
        [`Rapor tarihi (export anı)`, new Date().toLocaleString("tr-TR")],
        [`Senaryo`, "Paletli optimal (CSV’deki tüm SKUlar; A/B/C ayrı). Dökme modu bu çıktıyı etkilemez."],
        [`Tır ölçüleri (cm)`, `${liveTruckL} × ${liveTruckW} × ${liveTruckH}`],
        [`Tır alanı (m²)`, +truckTotalM2.toFixed(4)],
        [`Tır hacmi (m³)`, +truckTotalM3.toFixed(4)],
        [`Tır tonaj (ton)`, liveTruckTon],
        [`Palet limit`, `Ürün max ${livePalletMaxH} cm · max ${livePalletMaxKg} kg · taban ${livePalletBaseH} cm`],
        [`Otomatik sarkım seçenekleri`, autoSarkım ? "0 / 5 / 15 cm" : "Kapalı (yalnız 0 cm)"],
        [`Parçalı sarkım (15 cm)`, `${partialSarkim ? `Açık (${partialSarkimMode})` : "Kapalı"}`],
        [`Maliyet para birimi`, exportCostCurrency],
        ...(useKur && Number.isFinite(kurVal) && kurVal > 0
          ? [[`Güncel kur (1 ${kurType} = … TL)`, `${kurVal} TL`]]
          : []),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), "Özet");

      const wsProducts = XLSX.utils.aoa_to_sheet([hdr, ...dataRows]);
      bestOrients.forEach((orient, i) => highlightExportOptimalRow(wsProducts, i + 1, orient));
      XLSX.utils.book_append_sheet(wb, wsProducts, "Ürünler");

      const fn = `palet-opt-export-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.xlsx`;
      XLSX.writeFile(wb, fn);
      setMsg(`✓ Excel indirildi (${skus.length} satır)`);
    } catch {
      setMsg("✗ Excel oluşturulamadı.");
    }
  };

  const commitMaxH = () => {
    if (useDefaultLimits) {
      setMaxHInput(String(DEFAULT_MAX_H));
      return;
    }
    const parsed = parseNum(maxHInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setMaxH(parsed);
      setMaxHInput(String(parsed));
      return;
    }
    setMaxHInput(String(maxH));
    setMsg("⚠ Ürün max yükseklik değeri geçersiz. Önceki değer korundu.");
  };

  const commitMaxKg = () => {
    if (useDefaultLimits) {
      setMaxKgInput(String(DEFAULT_MAX_KG));
      return;
    }
    const parsed = parseNum(maxKgInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setMaxKg(parsed);
      setMaxKgInput(String(parsed));
      return;
    }
    setMaxKgInput(String(maxKg));
    setMsg("⚠ Maks ağırlık değeri geçersiz. Önceki değer korundu.");
  };

  const commitPalletBaseH = () => {
    if (useDefaultLimits) {
      setPalletBaseHInput(String(PALLET_BASE_H));
      return;
    }
    const parsed = parseNum(palletBaseHInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setPalletBaseH(parsed);
      setPalletBaseHInput(String(parsed));
      return;
    }
    setPalletBaseHInput(String(palletBaseH));
    setMsg("⚠ Palet taban yüksekliği geçersiz. Önceki değer korundu.");
  };

  const commitTruckL = () => {
    if (useDefaultTruckDims) {
      setTruckLInput(String(TL));
      return;
    }
    const parsed = parseNum(truckLInput);
    if (Number.isFinite(parsed) && parsed >= 100) {
      setTruckL(parsed);
      setTruckLInput(String(parsed));
      return;
    }
    setTruckLInput(String(truckL));
    setMsg("⚠ Tır uzunluğu geçersiz. Önceki değer korundu.");
  };

  const commitTruckW = () => {
    if (useDefaultTruckDims) {
      setTruckWInput(String(TW));
      return;
    }
    const parsed = parseNum(truckWInput);
    if (Number.isFinite(parsed) && parsed >= 100) {
      setTruckW(parsed);
      setTruckWInput(String(parsed));
      return;
    }
    setTruckWInput(String(truckW));
    setMsg("⚠ Tır genişliği geçersiz. Önceki değer korundu.");
  };

  const commitTruckHeight = () => {
    if (useDefaultTruckDims) {
      setTruckHeightInput(String(DEFAULT_TRUCK_H));
      return;
    }
    const parsed = parseNum(truckHeightInput);
    if (Number.isFinite(parsed) && parsed >= 10) {
      setTruckHeightLimit(parsed);
      setTruckHeightInput(String(parsed));
      return;
    }
    setTruckHeightInput(String(truckHeightLimit));
    setMsg("⚠ Tır yükseklik limiti geçersiz. Önceki değer korundu.");
  };

  const commitTruckTon = () => {
    if (useDefaultTruckDims) {
      setTruckTonInput("22");
      return;
    }
    const parsed = parseNum(truckTonInput);
    if (Number.isFinite(parsed) && parsed >= 0.1) {
      setTruckTonLimit(parsed);
      setTruckTonInput(String(parsed));
      return;
    }
    setTruckTonInput(String(truckTonLimit));
    setMsg("⚠ Tır tonaj limiti geçersiz. Önceki değer korundu.");
  };

  const addCustomPallet = () => {
    const a = parseNum(newPal.a);
    const b = parseNum(newPal.b);
    const label = (newPal.label || `${a} × ${b} cm`).trim();
    if (!(a > 0 && b > 0)) {
      setMsg("⚠ Geçerli palet ölçüsü girin.");
      return;
    }
    const added = { _id: uid("custom-p"), label, a, b, persist: newPal.mode === "persistent" };
    setCustomPallets((prev) => [...prev, added]);
    setPalI(allPallets.length);
    setNewPal({ label: "", a: "", b: "", mode: newPal.mode });
    setQuickAddPanel("none");
    setMsg(`✓ Yeni palet eklendi (${label}).`);
  };

  const addCustomSku = () => {
    const en = parseNum(newSku.en);
    const boy = parseNum(newSku.boy);
    const yuk = parseNum(newSku.yuk);
    const kg = parseNum(newSku.kg);
    const qty = parseNum(newSku.qty || 0);
    const fiyat = parseNum(newSku.fiyat || 0);
    if (!(en > 0 && boy > 0 && yuk > 0 && kg >= 0)) {
      setMsg("⚠ Ürün için en, boy, yükseklik ve kg değerlerini doğru girin.");
      return;
    }
    const displayName = (newSku.name || "Manuel Ürün").trim();
    const item = {
      _id: uid("custom-sku"),
      sku: (newSku.sku || `MAN-${customSkus.length + 1}`).trim(),
      parent: "",
      displayName,
      name: displayName,
      en, boy, yuk, kg, qty, fiyat: Number.isFinite(fiyat) && fiyat > 0 ? fiyat : 0,
      persist: newSku.mode === "persistent",
    };
    setCustomSkus((prev) => [...prev, item]);
    setSkuI(skus.length);
    setNewSku({ sku: "", name: "", en: "", boy: "", yuk: "", kg: "", qty: "", fiyat: "", mode: newSku.mode });
    setQuickAddPanel("none");
    setMsg(`✓ Geçici simülasyon ürünü eklendi (${item.sku}).`);
  };

  const addPalletToTruck = (rotated = false) => {
    const unitA = bulkLoad ? bL : effPalA;
    const unitB = bulkLoad ? bW : effPalB;
    const p = rotated
      ? { w: unitA, h: unitB, paAlongL: true }
      : { w: unitB, h: unitA, paAlongL: false };
    const free = findFreeSpot(placements, p.w, p.h, liveTruckL, liveTruckW);
    if (!free) {
      setMsg("⚠ Tır içinde boş yer bulunamadı.");
      return;
    }
    const created = { ...p, ...free, id: uid("pl") };
    setPlacements((prev) => [...prev, created]);
    setSelectedPlacementIds([created.id]);
  };

  const removeSelectedPallet = () => {
    if (!selectedPlacementIds.length) return;
    setPlacements((prev) => prev.filter((p) => !selectedPlacementIds.includes(p.id)));
    setSelectedPlacementIds([]);
  };

  const rotateSelected = () => {
    if (!selectedPlacementIds.length) return;
    setPlacements((prev) => {
      let next = [...prev];
      for (const id of selectedPlacementIds) {
        next = next.map((p) => {
          if (p.id !== id) return p;
          const candidate = { ...p, w: p.h, h: p.w, paAlongL: !p.paAlongL };
          return validPlacement(candidate, next, p.id, liveTruckL, liveTruckW) ? candidate : p;
        });
      }
      return next;
    });
  };

  const resetTruckLayout = () => {
    setPlacements(autoPlacements);
    setSelectedPlacementIds([]);
  };

  const deleteCustomPallet = () => {
    setCustomPallets(prev => prev.filter(p => p._id !== pal._id));
    setPalI(0);
  };

  const addExtraBoxes = () => {
    const n = Math.floor(parseNum(extraBoxInput));
    if (!Number.isFinite(n) || n <= 0) {
      setMsg("⚠ Kutu ekleme icin 1 veya daha buyuk sayi girin.");
      return;
    }
    setExtraBoxes((prev) => prev + n);
  };

  const removeExtraBoxes = () => {
    const n = Math.floor(parseNum(extraBoxInput));
    if (!Number.isFinite(n) || n <= 0) {
      setMsg("⚠ Kutu cikarma icin 1 veya daha buyuk sayi girin.");
      return;
    }
    setExtraBoxes((prev) => Math.max(0, prev - n));
  };

  const resetExtraBoxes = () => setExtraBoxes(0);

  return (
    <div style={{ background:THEME.pageBg, minHeight:"100vh", padding:"13px 16px",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif", color:THEME.textSecondary }}>

      {/* HEADER */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14,
        paddingBottom:12, borderBottom:`1px solid ${THEME.borderSoft}` }}>
        <span style={{ fontSize:26 }}>🚛</span>
        <div style={{ flex:1 }}>
          <h1 style={{ margin:0, fontSize:19, fontWeight:900, letterSpacing:-0.3, color:THEME.textPrimary }}>
            Nordure Palet Yükleme Simülatörü
            <span style={{ fontSize:12, color:THEME.textMuted, fontWeight:700, marginLeft:8, verticalAlign:"middle" }}>v3.2</span>
          </h1>
          <p style={{ margin:"3px 0 0", fontSize:13, color:THEME.textMuted }}>
            CSV + Aranabilir SKU + İnteraktif Tır Haritası · Tır: {liveTruckL}×{liveTruckW}cm ·
            {" "}Palet Limiti: ürün {livePalletMaxH}cm (toplam {palletTotalHeightLimit}cm) / {livePalletMaxKg}kg ·
            {" "}Tır Limiti: {liveTruckH}cm / {liveTruckTon.toFixed(1)} ton
          </p>
        </div>
        {msg && (
          <div style={{ fontSize:12, padding:"6px 12px", borderRadius:8, flexShrink:0,
            background:msgBg, color:msgCol, border:`1px solid ${msgCol}28` }}>
            {msg}
          </div>
        )}
      </div>

      {/* CONTROLS */}
      <div style={{ display:"flex", gap:10, marginBottom:12, flexWrap:"wrap", alignItems:"flex-end" }}>
        <div style={{ flexShrink:0 }}>
          <span style={SL}>CSV Yükle</span>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <button onClick={() => fRef.current && fRef.current.click()}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 15px",
              background:"linear-gradient(135deg,#1A4FA0,#2563EB)", border:"none",
              borderRadius:8, color:"white", fontSize:13, cursor:"pointer",
              fontWeight:700, whiteSpace:"nowrap", boxShadow:"0 2px 8px rgba(37,99,235,0.3)" }}>
            📂 Dosya Seç
          </button>
          <button type="button" onClick={handleExportExcel}
            disabled={!skus.length}
            title="Liste ve mevcut tır/limit ayarlarıyla paletli A/B/C optimal raporu (.xlsx)"
            style={{
              display:"flex", alignItems:"center", gap:6, padding:"9px 15px",
              background:!skus.length ? THEME.panelBgStrong : "linear-gradient(135deg,#0F766E,#14B8A6)",
              border:`1px solid ${THEME.border}`, borderRadius:8, color:!skus.length ? THEME.dim : "white",
              fontSize:13, cursor:!skus.length ? "not-allowed" : "pointer", fontWeight:700, whiteSpace:"nowrap",
            }}>
            📊 Excel’e Aktar
          </button>
          </div>
          <input ref={fRef} type="file" accept=".csv" style={{ display:"none" }} onChange={handleFile} />
          <div style={{ fontSize:11.5, color:THEME.textSubtle, marginTop:5, maxWidth:180 }}>
            Parent, SKU, PAKET SAYISI,<br/>En, Boy, Yukseklik, KG Agirlik
          </div>
        </div>

        <div style={{ flex:"1 1 240px", minWidth:200 }}>
          <span style={SL}>Ürün Seçimi (SKU) · Aranabilir</span>
          <SkuCombobox skus={skus} skuI={skuI} setSkuI={setSkuI} color={col} theme={THEME} />
          {isDemo && <div style={{ fontSize:11.5, color:THEME.textSubtle, marginTop:4 }}>
            ⚠ Örnek veri · CSV yükleyin
          </div>}
        </div>

        <div style={{ flex:"1 1 270px", minWidth:200 }}>
          <span style={SL}>Yükleme Limitleri</span>
          <div style={{ display:"flex", gap:8, marginBottom:7, flexWrap:"wrap" }}>
            <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:THEME.textSecondary, cursor:"pointer" }}>
              <input
                type="checkbox"
                checked={useDefaultLimits}
                onChange={(e) => setUseDefaultLimits(e.target.checked)}
                style={{ accentColor: col }}
              />
              Default
            </label>
            <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:THEME.textSecondary, cursor:"pointer" }}>
              <input
                type="checkbox"
                checked={bulkLoad}
                onChange={(e) => setBulkLoad(e.target.checked)}
                style={{ accentColor: col }}
              />
              Dökme
            </label>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            <input
              type="text"
              inputMode="decimal"
              value={maxHInput}
              onChange={(e) => setMaxHInput(e.target.value)}
              onBlur={commitMaxH}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="Ürün max yükseklik (cm)"
              disabled={useDefaultLimits}
              style={INPUT_COMMON}
            />
            <input
              type="text"
              inputMode="decimal"
              value={maxKgInput}
              onChange={(e) => setMaxKgInput(e.target.value)}
              onBlur={commitMaxKg}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="Maks ağırlık (kg)"
              disabled={useDefaultLimits}
              style={INPUT_COMMON}
            />
            <input
              type="text"
              inputMode="decimal"
              value={palletBaseHInput}
              onChange={(e) => setPalletBaseHInput(e.target.value)}
              onBlur={commitPalletBaseH}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="Palet taban (cm)"
              disabled={useDefaultLimits}
              style={INPUT_COMMON}
            />
          </div>
          <div style={{ marginTop:6, fontSize:11.5, color:THEME.textSubtle }}>
            Palet taban yüksekliği: <b style={{ color:THEME.textSecondary }}>{livePalletBaseH} cm</b>
            {" "}· Toplam paletli yükseklik limiti: <b style={{ color:THEME.textSecondary }}>{palletTotalHeightLimit} cm</b>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <span style={SL}>Hızlı Ekle</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setQuickAddPanel((v) => v === "pallet" ? "none" : "pallet")}
              style={{
                ...SEL,
                width: "auto",
                padding: "8px 11px",
                fontWeight: 800,
                background: quickAddPanel === "pallet" ? "rgba(59,130,246,0.22)" : THEME.panelBgStrong,
                color: quickAddPanel === "pallet" ? "#DBEAFE" : THEME.textSecondary,
              }}
            >
              + Özel Palet
            </button>
            <button
              onClick={() => setQuickAddPanel((v) => v === "sku" ? "none" : "sku")}
              style={{
                ...SEL,
                width: "auto",
                padding: "8px 11px",
                fontWeight: 800,
                background: quickAddPanel === "sku" ? "rgba(16,185,129,0.22)" : THEME.panelBgStrong,
                color: quickAddPanel === "sku" ? "#D1FAE5" : THEME.textSecondary,
              }}
            >
              + Simülasyon Ürünü
            </button>
          </div>
        </div>
      </div>

      {quickAddPanel !== "none" && (
        <div style={{ ...card, marginBottom: 10, background: "linear-gradient(180deg, #224267, #1C3656)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={SL}>
              {quickAddPanel === "pallet"
                ? "Özel Palet Ekle (Varsayılanları Değiştirmez)"
                : "CSV Dışında Ürün Simülasyonu Ekle"}
            </span>
            <button
              onClick={() => setQuickAddPanel("none")}
              style={{ ...SEL, width: "auto", padding: "6px 10px", fontSize: 12.5, background: "rgba(255,255,255,0.08)" }}
            >
              Kapat
            </button>
          </div>
          {quickAddPanel === "pallet" ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, alignItems:"end" }}>
              <input value={newPal.label} onChange={(e) => setNewPal((p) => ({ ...p, label: e.target.value }))}
                placeholder="Palet adı (opsiyonel)" style={SEL} />
              <input type="text" inputMode="decimal" value={newPal.a} onChange={(e) => setNewPal((p) => ({ ...p, a: e.target.value }))}
                placeholder="En (cm)" style={SEL} />
              <input type="text" inputMode="decimal" value={newPal.b} onChange={(e) => setNewPal((p) => ({ ...p, b: e.target.value }))}
                placeholder="Boy (cm)" style={SEL} />
              <select value={newPal.mode} onChange={(e) => setNewPal((p) => ({ ...p, mode: e.target.value }))} style={SEL}>
                <option value="temporary">Geçici</option>
                <option value="persistent">Kalıcı</option>
              </select>
              <button onClick={addCustomPallet} style={{ ...SEL, width: "auto", padding: "9px 11px", fontWeight: 800, background: "rgba(59,130,246,0.2)", color: "#DBEAFE" }}>
                + Palet
              </button>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))", gap:8 }}>
              <input value={newSku.sku} onChange={(e) => setNewSku((s) => ({ ...s, sku: e.target.value }))} placeholder="SKU" style={SEL} />
              <input value={newSku.name} onChange={(e) => setNewSku((s) => ({ ...s, name: e.target.value }))} placeholder="Ürün adı" style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.en} onChange={(e) => setNewSku((s) => ({ ...s, en: e.target.value }))} placeholder="En" style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.boy} onChange={(e) => setNewSku((s) => ({ ...s, boy: e.target.value }))} placeholder="Boy" style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.yuk} onChange={(e) => setNewSku((s) => ({ ...s, yuk: e.target.value }))} placeholder="Yük." style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.kg} onChange={(e) => setNewSku((s) => ({ ...s, kg: e.target.value }))} placeholder="Kg" style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.qty} onChange={(e) => setNewSku((s) => ({ ...s, qty: e.target.value }))} placeholder="Adet" style={SEL} />
              <input type="text" inputMode="decimal" value={newSku.fiyat} onChange={(e) => setNewSku((s) => ({ ...s, fiyat: e.target.value }))} placeholder="Gerçek alış fiyatı" style={SEL} />
              <select value={newSku.mode} onChange={(e) => setNewSku((s) => ({ ...s, mode: e.target.value }))} style={SEL}>
                <option value="temporary">Geçici</option>
                <option value="persistent">Kalıcı</option>
              </select>
              <button onClick={addCustomSku} style={{ ...SEL, width: "auto", padding: "9px 11px", fontWeight: 800, background: "rgba(16,185,129,0.18)", color: "#D1FAE5" }}>+ Ürün</button>
            </div>
          )}
        </div>
      )}

      {/* FLAT ORIENT INFO */}
      <div style={{ ...card, marginBottom:10, padding:"7px 14px", display:"flex",
        gap:14, flexWrap:"wrap", alignItems:"center", borderLeft:`3px solid ${col}` }}>
        <span style={{ fontSize:10, color:THEME.textMuted, fontWeight:900, letterSpacing:1.8, textTransform:"uppercase" }}>
          Düzleme Kuralı
        </span>
        <span style={{ fontSize:11.5, color:THEME.textSecondary }}>
          Girdi [{sku.en}, {sku.boy}, {sku.yuk}] cm → Sırala →
        </span>
        <span style={{ fontSize:11, color:THEME.textSecondary }}>
          Ağırlık: <b>{sku.kg || 0} kg</b>
        </span>
        <span style={{ fontSize:11 }}>
          <span style={{ color:THEME.textSubtle }}>H = </span>
          <b style={{ color:THEME.textSecondary }}>{bH} cm</b>
        </span>
        <span style={{ fontSize:11 }}>
          <span style={{ color:THEME.textSubtle }}>Taban = </span>
          <b style={{ color:col }}>{bL} × {bW} cm</b>
        </span>
        {oh > 0 && (
          <span style={{ fontSize:11, color:"#F59E0B" }}>
            + Sarkım modu {oh === 15 ? "15" : "5"} → Eff. Alan: {effPalA}×{effPalB} cm
            {oh === 15 ? " (sunta + gerekirse ekstra taşma)" : ""}
          </span>
        )}
        {bestOption?.bestFit ? (
          <span style={{ fontSize:11.5, color:"#86EFAC", fontWeight:700 }}>
            {bestOption.bestFit.mode === "bulk"
              ? `En Optimal (Limitlere Uygun): Dökme · Yön ${bestOption.bestFit.orient} · ${bestOption.bestFit.count} kutu/yerleşim · Tırda ${bestOption.bestFit.truckPallets} yerleşim (${bestOption.bestFit.truckBoxes} kutu)`
              : `En Optimal (Limitlere Uygun): ${bestOption.bestFit.pallet} · Yön ${bestOption.bestFit.orient} · Sarkim ${bestOption.bestFit.oh === 0 ? "Yok" : `+${bestOption.bestFit.oh}cm`} · ${bestOption.bestFit.cols}x${bestOption.bestFit.rows}x${bestOption.bestFit.layers} = ${bestOption.bestFit.count} kutu/palet · Tirda ${bestOption.bestFit.truckPallets} palet (${bestOption.bestFit.truckBoxes} kutu)`}
          </span>
        ) : (
          <span style={{ fontSize:11.5, color:"#FCA5A5", fontWeight:700 }}>
            Limitlere uygun optimal kombinasyon yok
            {bestOption?.bestAny ? ` (En yuksek kapasite: ${bestOption.bestAny.pallet}, tirda ${bestOption.bestAny.truckBoxes} kutu)` : ""}
          </span>
        )}
      </div>

      {/* MAIN GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 420px", gap:12, marginBottom:10 }}>
        <div style={card}>
          <span style={SL}>📦 İzometrik Palet Görünümü · Kutu Ekle/Çıkar Aktif</span>
          <div style={{ background:THEME.panelBg, borderRadius:9, padding:"10px",
            display:"flex", justifyContent:"center", marginBottom:9 }}>
            <PalletView
              sku={sku}
              pa={pal.a}
              pb={pal.b}
              oh={oh}
              col={col}
              pack={pack}
              extraBoxes={extraBoxes}
              orient={orient}
              palletBaseH={livePalletBaseH}
            />
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:13, color:THEME.textMuted, alignItems:"center" }}>
            <span>{bulkLoad ? "Dökme Taban" : "Palet"}: <b style={{ color:THEME.textSecondary }}>{bulkLoad ? `${bL}×${bW}cm` : `${pal.a}×${pal.b}×${livePalletBaseH}cm`}</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Kutu: <b style={{ color:THEME.textSecondary }}>{bL}×{bW}×{bH}cm</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Dizilim: <b style={{ color:col }}>{bulkLoad ? `${nPal}×${bulkLayers} kat` : `${cols}×${rows}×${effectiveLayers} kat`}</b></span>
            {!bulkLoad && <>
              <span style={{ color:THEME.dim }}>·</span>
              <span>Paket Tabanı: <b style={{ color:col }}>{fpA}×{fpB}cm</b></span>
            </>}
            <span style={{ color:THEME.dim }}>·</span>
            <span>Aktif Kutu: <b style={{ color:"#86EFAC" }}>{ipp}</b></span>
            {extraBoxes > 0 && <>
              <span style={{ color:THEME.dim }}>·</span>
              <span>Ek Kutu: <b style={{ color:"#FCD34D" }}>+{extraBoxes}</b></span>
            </>}
            {oh > 0 && <>
              <span style={{ color:THEME.dim }}>·</span>
              <span style={{ color:"#F59E0B" }}>⚠ ±{oh}cm Sarkım</span>
            </>}
          </div>
          <div style={{ marginTop:10, borderTop:`1px solid ${THEME.borderSoft}`, paddingTop:10, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <span style={{ fontSize:10, color:THEME.textMuted, fontWeight:900, letterSpacing:1.3, textTransform:"uppercase", display:"block", marginBottom:6 }}>
                Palet Tipi
              </span>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <select style={{ ...SEL, flex:1 }} value={palI} onChange={e => setPalI(+e.target.value)}>
                  {allPallets.map((p, i) => <option key={p._id || i} value={i}>{p.label}{p.source === "custom" ? " (özel)" : ""}</option>)}
                </select>
                {pal.source === "custom" && (
                  <button onClick={deleteCustomPallet} title="Paleti sil" style={{
                    flexShrink:0, padding:"6px 9px", borderRadius:8, cursor:"pointer",
                    fontSize:13, fontWeight:900, border:`1px solid #F87171`,
                    background:"rgba(248,113,113,0.12)", color:"#F87171", lineHeight:1 }}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div>
              <span style={{ fontSize:10, color:THEME.textMuted, fontWeight:900, letterSpacing:1.3, textTransform:"uppercase", display:"block", marginBottom:6 }}>
                Sarkım
              </span>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer",
                  userSelect:"none", padding:"6px 10px", borderRadius:8,
                  border:`1.5px solid ${autoSarkım ? col : THEME.border}`,
                  background: autoSarkım ? alpha(col, 0.11) : THEME.panelBgStrong }}>
                  <input type="checkbox" checked={autoSarkım}
                    onChange={e => setAutoSarkım(e.target.checked)}
                    style={{ width:13, height:13, cursor:"pointer", accentColor:col }}
                    disabled={bulkLoad} />
                  <span style={{ fontSize:11.5, fontWeight: autoSarkım ? 800 : 500, color: autoSarkım ? col : THEME.textMuted }}>
                    Sarkım
                  </span>
                  {autoSarkım && oh > 0 && <span style={{ fontSize:11, color:col, fontWeight:900 }}>({oh}cm)</span>}
                </label>
                <div style={{ display:"flex", gap:4, opacity: (autoSarkım && !bulkLoad) ? 1 : 0.35, pointerEvents: (autoSarkım && !bulkLoad) ? "auto" : "none" }}>
                  {[0, 5, 15].map(v => {
                    const on = manualOh === v;
                    return (
                      <button key={v} onClick={() => setManualOh(v)} style={{
                        padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11.5,
                        border:`1.5px solid ${on ? col : THEME.border}`,
                        background: on ? alpha(col, 0.11) : THEME.panelBgStrong,
                        color: on ? col : THEME.textMuted, fontWeight: on ? 800 : 500 }}>
                        {v === 0 ? "Yok" : `${v}cm`}
                      </button>
                    );
                  })}
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer",
                  userSelect:"none", padding:"6px 10px", borderRadius:8,
                  border:`1px solid ${partialSarkim ? col : THEME.border}`,
                  background: partialSarkim ? alpha(col, 0.11) : THEME.panelBgStrong,
                  opacity: (autoSarkım && !bulkLoad && manualOh === 15) ? 1 : 0.45,
                  pointerEvents: (autoSarkım && !bulkLoad && manualOh === 15) ? "auto" : "none" }}>
                  <input type="checkbox" checked={partialSarkim} onChange={e => setPartialSarkim(e.target.checked)}
                    style={{ width:13, height:13, cursor:"pointer", accentColor:col }} />
                  <span style={{ fontSize:11.5, color: partialSarkim ? col : THEME.textMuted, fontWeight: partialSarkim ? 800 : 500 }}>
                    Parçalı Sarkım
                  </span>
                </label>
                <div style={{ display:"flex", gap:6, opacity: (autoSarkım && partialSarkim && !bulkLoad && manualOh === 15) ? 1 : 0.45, pointerEvents: (autoSarkım && partialSarkim && !bulkLoad && manualOh === 15) ? "auto" : "none" }}>
                  <button onClick={() => setPartialSarkimMode("fixed10")} style={{
                    ...SEL, width:"auto", padding:"6px 10px", fontSize:11.5,
                    border:`1px solid ${partialSarkimMode === "fixed10" ? col : THEME.border}`,
                    background: partialSarkimMode === "fixed10" ? alpha(col, 0.13) : THEME.panelBgStrong,
                    color: partialSarkimMode === "fixed10" ? col : THEME.textMuted
                  }}>
                    Fix 10cm
                  </button>
                  <button onClick={() => setPartialSarkimMode("overflow")} style={{
                    ...SEL, width:"auto", padding:"6px 10px", fontSize:11.5,
                    border:`1px solid ${partialSarkimMode === "overflow" ? col : THEME.border}`,
                    background: partialSarkimMode === "overflow" ? alpha(col, 0.13) : THEME.panelBgStrong,
                    color: partialSarkimMode === "overflow" ? col : THEME.textMuted
                  }}>
                    Taşma Kadar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <LayerEditor
            baseLayers={bulkLoad ? bulkBaseLayers : layers}
            effectiveLayers={bulkLoad ? bulkLayers : effectiveLayers}
            setLayerAdjust={setLayerAdjust}
            extraBoxInput={extraBoxInput}
            setExtraBoxInput={setExtraBoxInput}
            addExtraBoxes={addExtraBoxes}
            removeExtraBoxes={removeExtraBoxes}
            resetExtraBoxes={resetExtraBoxes}
            extraBoxes={extraBoxes}
            theme={THEME}
          />

          {/* ── ORIENTATION SELECTOR ── */}
          {(() => {
            const [bS, bM, bBL] = [sku?.en||0, sku?.boy||0, sku?.yuk||0].sort((a,b)=>a-b);
            const orientFaces = {
              A: `${bBL}×${bM} cm`,
              B: `${bS}×${bBL} cm`,
              C: `${bS}×${bM} cm`,
            };
            return (
              <div style={{ marginTop:12, borderTop:`1px solid ${THEME.borderSoft}`, paddingTop:10 }}>
                <span style={{ fontSize:10, color:THEME.textMuted, fontWeight:900, letterSpacing:1.5,
                  textTransform:"uppercase", display:"block", marginBottom:8 }}>
                  Paket Yüzey Yönü
                </span>
                <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                  <div style={{ flex:"0 0 auto", background:THEME.panelBg, borderRadius:8,
                    padding:"8px", width:220 }}>
                    <OrientBox en={sku?.en||0} boy={sku?.boy||0} yuk={sku?.yuk||0}
                      activeOrient={orient} col={col} />
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6, flex:1 }}>
                    {["A","B","C"].map(v => {
                      const on = orient === v;
                      const orientBest = orientGlobalBest[v];
                      return (
                        <div key={v} style={{ width:"100%" }}>
                          <button onClick={() => setOrient(v)} style={{
                            width:"100%", padding:"8px 10px", borderRadius:8, cursor:"pointer",
                            fontSize:12, border:`1.5px solid ${on ? col : THEME.border}`,
                            background: on ? alpha(col, 0.15) : THEME.panelBgStrong,
                            color: on ? col : THEME.textMuted,
                            fontWeight: on ? 900 : 500, transition:"all 0.18s",
                            textAlign:"left", display:"flex", alignItems:"center", gap:8,
                          }}>
                            <span style={{ fontWeight:900, fontSize:15, minWidth:16 }}>{v}</span>
                            <span style={{ fontSize:11, opacity:0.9 }}>{orientFaces[v]}</span>
                          </button>
                          <div style={{ marginTop:4, fontSize:10.5, color:THEME.textSubtle, lineHeight:1.35 }}>
                            {orientBest
                              ? orientBest.mode === "bulk"
                                ? `${orientBest.count} kutu/yerleşim · ${orientBest.truckPallets} yerleşim/tır · ${orientBest.truckBoxes} kutu/tır · Dökme`
                                : `${orientBest.count} kutu/palet · ${orientBest.truckPallets} palet/tır · ${orientBest.truckBoxes} kutu/tır · ${orientBest.pallet} · ${orientBest.oh === 0 ? "Sarkım yok" : `${orientBest.oh}cm`}`
                              : "Bu yön için limitlere uygun kombinasyon yok"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div style={{ ...card, padding:"20px 22px" }}>
          <span style={{ ...SL, fontSize:13, marginBottom:13 }}>📊 Yük Analizi</span>
          <Gauge
            lbl={bulkLoad ? "Tır Yükleme Yüksekliği" : "Yükleme Yüksekliği"}
            val={heightGaugeVal}
            max={heightGaugeMax}
            unit="cm"
            theme={THEME}
          />
          <Gauge
            lbl={bulkLoad ? "Tır Toplam Ağırlık" : "Palet Ağırlığı"}
            val={weightGaugeVal}
            max={weightGaugeMax}
            unit="kg"
            theme={THEME}
          />
          <div style={{ borderTop:`1px solid ${THEME.borderSoft}`, margin:"12px 0 9px" }} />
          <StatRow k="Ürün (SKU)"        v={sku.sku} vc={col} theme={THEME} />
          <StatRow k="Yükleme Modu" v={bulkLoad ? "Dökme (kutu bazlı)" : "Paletli"} theme={THEME} />
          {!bulkLoad && <StatRow k="Palet Tipi" v={pal.label} theme={THEME} />}
          <StatRow
            k="Kat Başına Kutu"
            v={bulkLoad ? `${nPal} kutu/layer` : `${cols}×${rows} = ${cols*rows}`}
            theme={THEME}
          />
          <StatRow k="Toplam Kat" v={bulkLoad ? bulkLayers : visualLayers} theme={THEME} />
          <StatRow k={bulkLoad ? "Yerleşim Başına (aktif)" : "Palet Başına (aktif)"} v={`${placementUnits} adet`} theme={THEME} />
          <StatRow k={bulkLoad ? "Tırdaki Yerleşim" : "Tırdaki Palet"} v={`${nPal} adet`} theme={THEME} />
          <StatRow k="Toplam Kutu"       v={nItm.toLocaleString()} theme={THEME} />
          <StatRow k="Tırdaki Toplam Yük" v={`${nTon.toFixed(2)} ton`} theme={THEME} />
          <StatRow k="Toplam Yük Limiti" v={`${livePalletMaxKg.toLocaleString("tr-TR")} kg`} theme={THEME} />
          <StatRow k="Tırdaki Toplam Yük Limiti" v={`${liveTruckTon.toFixed(2)} ton`} theme={THEME} />
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:12 }}>
            <Badge ok={heightGaugeVal <= heightGaugeMax} lbl="YÜKSEKLİK" />
            <Badge ok={bulkLoad ? (stackHeight <= bulkProductHeightLimit) : (stkH <= liveTruckH)} lbl="TIR YÜKSEKLİK" />
            <Badge ok={weightGaugeVal <= weightGaugeMax} lbl="AĞIRLIK" />
            <Badge ok={totalKg <= truckTonKg} lbl="TIR TONAJI" />
            <Badge ok={bulkLoad ? (nPal > 0 && bulkLayers > 0) : (cols > 0 && rows > 0 && effectiveLayersByTon > 0)} lbl="SIĞIYOR" />
            <Badge ok={layoutState.valid} lbl="TIR YERLEŞİMİ" />
            <Badge ok={!!bestOption?.bestFit} lbl="OPTIMAL LIMIT" />
          </div>

          {/* ── COST SECTION ── */}
          <div style={{ marginTop:16, borderTop:`1px solid ${THEME.borderSoft}`, paddingTop:13 }}>
            <span style={{ fontSize:12, color:THEME.textMuted, fontWeight:900, letterSpacing:1.5,
              textTransform:"uppercase", display:"block", marginBottom:10 }}>
              Maliyet Hesabı
            </span>
            <StatRow
              k="Gerçek Alış Fiyatı"
              v={actualUnitPrice > 0 ? `${currencySymbol}${effectiveUnitPrice.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}` : "—"}
              theme={THEME}
            />
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0",
              borderBottom:`1px solid ${THEME.borderSoft}`, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, color:THEME.textMuted }}>Gerçek alış (birim)</span>
              <input
                type="text"
                inputMode="decimal"
                value={manualPriceInput}
                onChange={(e) => setManualPriceInput(e.target.value)}
                placeholder={skuFiyat > 0 ? `Varsayılan: ${skuFiyat}` : "Fiyat"}
                style={{ flex:"1 1 90px", minWidth:70, background:THEME.panelBgStrong, color:THEME.textPrimary, border:`1px solid ${THEME.border}`, borderRadius:7, padding:"7px 9px", fontSize:13 }}
              />
              <select
                value={manualPriceCurrency}
                onChange={(e) => setManualPriceCurrency(e.target.value)}
                style={{ ...SEL, width:"auto", padding:"7px 8px", fontSize:12.5 }}
              >
                <option value="TL">TL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0",
              borderBottom:`1px solid ${THEME.borderSoft}`, flexWrap:"wrap" }}>
              <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer",
                fontSize:14, color:THEME.textSecondary, whiteSpace:"nowrap" }}>
                <input type="checkbox" checked={useKur} onChange={e => setUseKur(e.target.checked)}
                  style={{ width:15, height:15, cursor:"pointer", accentColor:col }} />
                Güncel Kur
              </label>
              {useKur && (
                <>
                  <input
                    type="text" inputMode="decimal"
                    value={kurInput}
                    onChange={e => setKurInput(e.target.value)}
                    placeholder="Kur değeri"
                    style={{ flex:1, minWidth:70, background:THEME.panelBgStrong,
                      color:THEME.textPrimary, border:`1px solid ${THEME.border}`,
                      borderRadius:7, padding:"7px 9px", fontSize:14, outline:"none" }}
                  />
                  <div style={{ display:"flex", borderRadius:7, overflow:"hidden",
                    border:`1px solid ${THEME.border}` }}>
                    {["USD","EUR"].map(t => (
                      <button key={t} onClick={() => setKurType(t)} style={{
                        padding:"7px 11px", fontSize:13, fontWeight:800, cursor:"pointer",
                        background: kurType === t ? alpha(col, 0.25) : THEME.panelBgStrong,
                        color: kurType === t ? col : THEME.textMuted,
                        border:"none", transition:"all 0.15s",
                      }}>{t}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <StatRow
              k={bulkLoad ? "Yerleşim Maliyeti" : "Palet Maliyeti"}
              v={paletMaliyeti > 0
                ? `${currencySymbol}${paletMaliyeti.toLocaleString("tr-TR", {maximumFractionDigits:2})}`
                : "—"}
              vc={paletMaliyeti > 0 ? "#86EFAC" : undefined}
              theme={THEME}
            />
            <StatRow
              k="Tır Maliyeti"
              v={tirMaliyeti > 0
                ? `${currencySymbol}${tirMaliyeti.toLocaleString("tr-TR", {maximumFractionDigits:2})}`
                : "—"}
              vc={tirMaliyeti > 0 ? "#FCD34D" : undefined}
              theme={THEME}
            />
          </div>
        </div>
      </div>

      {/* TRUCK MAP */}
      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:10, flexWrap:"wrap", gap:6 }}>
          <span style={{ ...SL, marginBottom:0, fontSize:13 }}>🗺️ Tır Yükleme Haritası · Çoklu Seçim + Sürükle-Bırak</span>
          <span style={{ fontSize:13, color:THEME.textMuted }}>
            <b style={{ color:THEME.textPrimary }}>{nPal}</b> {bulkLoad ? "yerleşim" : "palet"} · Seçili: <b style={{ color:"#FCD34D" }}>{selectedPlacementIds.length}</b> · Ctrl/Shift ile çoklu seçim
          </span>
        </div>
        <div style={{ fontSize:13, color:THEME.textMuted, marginBottom:8 }}>
          Tır Ölçüleri:
          <label style={{ display:"inline-flex", alignItems:"center", gap:5, marginLeft:8, fontSize:12, color:THEME.textSecondary, cursor:"pointer" }}>
            <input
              type="checkbox"
              checked={useDefaultTruckDims}
              onChange={(e) => setUseDefaultTruckDims(e.target.checked)}
              style={{ accentColor: col }}
            />
            Default
          </label>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, marginLeft:6, flexWrap:"wrap" }}>
            <input
              type="text"
              inputMode="decimal"
              value={truckLInput}
              onChange={(e) => setTruckLInput(e.target.value)}
              onBlur={commitTruckL}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={useDefaultTruckDims}
              style={{ width:66, background:THEME.panelBgStrong, color:THEME.textPrimary, border:`1px solid ${THEME.border}`, borderRadius:7, padding:"4px 6px", fontSize:12 }}
              title="Tır uzunluğu (cm)"
            />
            ×
            <input
              type="text"
              inputMode="decimal"
              value={truckWInput}
              onChange={(e) => setTruckWInput(e.target.value)}
              onBlur={commitTruckW}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={useDefaultTruckDims}
              style={{ width:66, background:THEME.panelBgStrong, color:THEME.textPrimary, border:`1px solid ${THEME.border}`, borderRadius:7, padding:"4px 6px", fontSize:12 }}
              title="Tır genişliği (cm)"
            />
            ×
            <input
              type="text"
              inputMode="decimal"
              value={truckHeightInput}
              onChange={(e) => setTruckHeightInput(e.target.value)}
              onBlur={commitTruckHeight}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={useDefaultTruckDims}
              style={{ width:66, background:THEME.panelBgStrong, color:THEME.textPrimary, border:`1px solid ${THEME.border}`, borderRadius:7, padding:"4px 6px", fontSize:12 }}
              title="Tır yükseklik limiti (cm)"
            />
            <b style={{ color:THEME.textSecondary }}>cm</b>
            ·
            <input
              type="text"
              inputMode="decimal"
              value={truckTonInput}
              onChange={(e) => setTruckTonInput(e.target.value)}
              onBlur={commitTruckTon}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={useDefaultTruckDims}
              style={{ width:66, background:THEME.panelBgStrong, color:THEME.textPrimary, border:`1px solid ${THEME.border}`, borderRadius:7, padding:"4px 6px", fontSize:12 }}
              title="Tır tonaj limiti (ton)"
            />
            <b style={{ color:THEME.textSecondary }}>ton</b>
          </span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 240px", gap:10, alignItems:"stretch" }}>
          <div style={{ background:THEME.panelBg, borderRadius:9, padding:"12px 10px" }}>
            <TruckMap
              key={truckMapKey}
              placements={placements}
              setPlacements={setPlacements}
              selectedIds={selectedPlacementIds}
              setSelectedIds={setSelectedPlacementIds}
              col={col}
              fpA={fpA}
              fpB={fpB}
              theme={THEME}
              truckL={liveTruckL}
              truckW={liveTruckW}
              showPackageOverlay={!bulkLoad}
              bulkMode={bulkLoad}
            />
          </div>
          <div style={{ ...card, padding:"12px 12px", margin:0 }}>
            <span style={{ ...SL, marginBottom:8, fontSize:11 }}>Doluluk Metrikleri</span>
            <StatRow k="Total m²" v={totalM2.toFixed(2)} theme={THEME} />
            <StatRow k="Dolu m²" v={doluM2.toFixed(2)} vc="#86EFAC" theme={THEME} />
            <StatRow k="Boş m²" v={bosM2.toFixed(2)} vc="#FCA5A5" theme={THEME} />
            <div style={{ borderTop:`1px solid ${THEME.borderSoft}`, margin:"8px 0" }} />
            <StatRow k="Total m³" v={totalM3.toFixed(2)} theme={THEME} />
            <StatRow k="Dolu m³" v={doluM3.toFixed(2)} vc="#86EFAC" theme={THEME} />
            <StatRow k="Boş m³" v={bosM3.toFixed(2)} vc="#FCA5A5" theme={THEME} />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
          <button onClick={() => addPalletToTruck(false)} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>+ {bulkLoad ? "Kutu" : "Palet"}</button>
          <button onClick={() => addPalletToTruck(true)} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>+ Döndürülmüş</button>
          <button onClick={rotateSelected} style={{ ...SEL, width:"auto", padding:"9px 11px", color:"#FDE68A", fontWeight:700 }}>Seçiliyi Döndür</button>
          <button onClick={removeSelectedPallet} style={{ ...SEL, width:"auto", padding:"9px 11px", color:"#FCA5A5", fontWeight:700 }}>Seçiliyi Sil</button>
          <button onClick={resetTruckLayout} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>Sıfırla</button>
        </div>
        <div style={{ display:"flex", gap:16, marginTop:10, fontSize:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:bulkLoad ? alpha(col, 0.58) : "#7B5B1C", border:bulkLoad ? `0.5px solid ${shade(col, 0.6)}` : "0.5px solid #3D2D0E" }} />
            <span style={{ color:THEME.textSecondary }}>
              {bulkLoad ? `Kutu tabanı (${bL}×${bW}cm)` : `Palet ${oh > 0 ? `(Eff. ${effPalA}×${effPalB}cm)` : `(${pal.a}×${pal.b}cm)`}`} · {nPal} adet
            </span>
          </div>
          {!bulkLoad && <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:alpha(col, 0.74) }} />
            <span style={{ color:THEME.textSecondary }}>Paket Tabanı ({fpA}×{fpB}cm)</span>
          </div>}
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"rgba(239,68,68,0.4)" }} />
            <span style={{ color:THEME.textSecondary }}>Boş Alan</span>
          </div>
          {!bulkLoad && <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"rgba(245,158,11,0.55)", border:"0.5px dashed #F59E0B" }} />
            <span style={{ color:THEME.textSecondary }}>Paletten taşan paket</span>
          </div>}
          {!bulkLoad && <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"rgba(239,68,68,0.58)", border:"0.5px dashed #F87171" }} />
            <span style={{ color:THEME.textSecondary }}>Tır dışı paket taşması</span>
          </div>}
        </div>
      </div>

      <p style={{ fontSize:12, color:THEME.textMuted, textAlign:"center", marginTop:10, marginBottom:0 }}>
        {isDemo ? "⚠ Örnek veri · CSV yükleyerek gerçek verilerinizi görselleştirin"
                : "✓ Gerçek CSV verisi yüklü"} · Painter Algorithm · İnteraktif Yerleşim · Guillotine Packing
      </p>
    </div>
  );
}
