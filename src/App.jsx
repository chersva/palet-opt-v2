import { useState, useRef, useEffect, useMemo } from "react";

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const C30 = Math.cos(Math.PI / 6);
const TL = 1360, TW = 245;
const PALLET_BASE_H = 15;
const DEFAULT_MAX_H = 205;
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
  { sku:"NRD-4412", name:"Seramik Döşeme 60×40",    en:60, boy:40, yuk:10, kg:18.5, qty:100 },
  { sku:"NRD-2280", name:"Duvar Karosu 30×60",      en:30, boy:60, yuk:8,  kg:9.2,  qty:200 },
  { sku:"NRD-8801", name:"Porselen Levha 60×60",    en:60, boy:60, yuk:12, kg:28.0, qty:50  },
  { sku:"NRD-3315", name:"Mozaik Karo 30×30",       en:30, boy:30, yuk:15, kg:6.4,  qty:400 },
  { sku:"NRD-6670", name:"Dış Mekan Taş Karo 60×40",en:60, boy:40, yuk:14, kg:22.0, qty:75  },
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

function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function validPlacement(candidate, placements, ignoreId = null) {
  if (candidate.x < 0 || candidate.y < 0) return false;
  if (candidate.x + candidate.w > TL || candidate.y + candidate.h > TW) return false;
  return !placements.some((p) => p.id !== ignoreId && overlap(candidate, p));
}

function findFreeSpot(placements, w, h) {
  for (let x = 0; x <= TL - w; x += GRID_STEP_CM) {
    for (let y = 0; y <= TW - h; y += GRID_STEP_CM) {
      const candidate = { x, y, w, h };
      if (validPlacement(candidate, placements)) return { x, y };
    }
  }
  return null;
}
// ── FLAT ORIENTATION RULE ──────────────────────────────────────────────────
function flatOrient(en, boy, yuk) {
  const [s, m, l] = [+en, +boy, +yuk].sort((a, b) => a - b);
  return { bH: s, bW: m, bL: l };
}

// ── CSV PARSER ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/);
  if (lines.length < 2) return [];
  const delimCandidates = [",", ";", "\t", "|"];
  const scoreDelim = (d) => {
    const h = lines[0].split(d).length;
    const r = (lines[1] || "").split(d).length;
    return Math.max(h, r);
  };
  const delim = delimCandidates.reduce((best, d) => scoreDelim(d) > scoreDelim(best) ? d : best, ",");
  const parseRow = (line) => {
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
  };
  const norm = (s) => s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\w]+/g, " ")
    .trim();
  const hdrs = parseRow(lines[0]).map(norm);
  const fallbackIndexByName = (name) => {
    const map = { en: 3, boy: 4, yuk: 5, kg: 6, sku: 1, parent: 0, paket: 2 };
    return map[name] ?? -1;
  };
  const fi = (...kws) => {
    for (const kw of kws) {
      const kwl = norm(kw);
      const i = hdrs.findIndex(h => {
        const first = h.split(/\s+/)[0];
        return first === kwl || h.includes(kwl);
      });
      if (i >= 0) return i;
    }
    return fallbackIndexByName(kws[0]);
  };
  const iP = fi("parent", "urun", "urun adi", "product", "name");
  const iS = fi("sku", "kod", "stok kodu", "stock");
  const iQ = fi("paket", "paket sayisi", "adet", "qty", "quantity");
  const iE = fi("en", "genislik", "width");
  const iB = fi("boy", "uzunluk", "length");
  const iY = fi("yukseklik", "yuk", "height");
  const iK = fi("kg", "agirlik", "weight");
  return lines.slice(1)
    .filter(l => l.trim())
    .map((line, idx) => {
      const v = parseRow(line);
      const get = i => (i >= 0 ? v[i] : "") || "";
      const num = (x) => {
        const s = String(x).trim().replace(/\s/g, "");
        if (!s) return 0;
        if (s.includes(",") && s.includes(".")) {
          // 1.234,56 or 1,234.56 -> normalize to dot decimal
          const lastComma = s.lastIndexOf(",");
          const lastDot = s.lastIndexOf(".");
          if (lastComma > lastDot) return parseFloat(s.replace(/\./g, "").replace(",", "."));
          return parseFloat(s.replace(/,/g, ""));
        }
        return parseFloat(s.replace(",", "."));
      };
      return {
        sku:  get(iS) || `SKU-${idx + 1}`,
        name: get(iP) || get(iS) || `Ürün ${idx + 1}`,
        qty:  parseInt(get(iQ))   || 0,
        en:   num(get(iE)) || 0,
        boy:  num(get(iB)) || 0,
        yuk:  num(get(iY)) || 0,
        kg:   num(get(iK)) || 0,
      };
    })
    .filter(s => s.en > 0 && s.boy > 0 && s.yuk > 0);
}

function parseCSVLoose(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
  const num = (x) => {
    const s = String(x || "").trim().replace(/\s/g, "");
    if (!s) return 0;
    return parseFloat(s.replace(",", "."));
  };
  return lines.slice(1).map((line, idx) => {
    const v = line.split(delim).map((x) => x.trim());
    return {
      sku: v[1] || `SKU-${idx + 1}`,
      name: v[0] || v[1] || `Ürün ${idx + 1}`,
      qty: parseInt(v[2]) || 0,
      en: num(v[3]),
      boy: num(v[4]),
      yuk: num(v[5]),
      kg: num(v[6]),
    };
  }).filter((s) => s.en > 0 && s.boy > 0 && s.yuk > 0);
}

// ── PALLET PACKING ─────────────────────────────────────────────────────────
function packPallet(bL, bW, bH, pA, pB, oh, maxH, palletBaseH = PALLET_BASE_H) {
  const eA = pA + 2 * oh, eB = pB + 2 * oh;
  const layers = Math.max(1, Math.floor((maxH - palletBaseH) / bH));
  const [c1, r1] = [Math.floor(eA / bL), Math.floor(eB / bW)];
  const [c2, r2] = [Math.floor(eA / bW), Math.floor(eB / bL)];
  const rot = c2 * r2 > c1 * r1;
  return {
    cols: Math.max(0, rot ? c2 : c1),
    rows: Math.max(0, rot ? r2 : r1),
    layers,
    boxL: rot ? bW : bL,
    boxW: rot ? bL : bW,
  };
}

// ── TRUCK PACKING ──────────────────────────────────────────────────────────
// 'across' = pallet dim across truck width, 'along' = pallet dim along truck length
// 'paAlongL' = true if pallet's pA axis runs along truck length
function packTruck(pA, pB) {
  const unif = (across, along, paAlongL) => {
    const c = Math.floor(TW / across);
    const r = Math.floor(TL / along);
    if (!c || !r) return { n: 0, pls: [] };
    const pls = [];
    for (let ri = 0; ri < r; ri++)
      for (let ci = 0; ci < c; ci++)
        pls.push({ x: ri * along, y: ci * across, w: along, h: across, paAlongL });
    return { n: c * r, pls };
  };

  const guill = (a1, b1, paL1, a2, b2, paL2) => {
    const c1 = Math.floor(TW / a1), c2 = Math.floor(TW / a2);
    if (!c1) return { n: 0, pls: [] };
    let bn = 0, br1 = 0;
    for (let r = 0; r <= Math.floor(TL / b1); r++) {
      const rem = TL - r * b1;
      const r2 = c2 ? Math.floor(rem / b2) : 0;
      const t = c1 * r + (c2 ? c2 * r2 : 0);
      if (t > bn) { bn = t; br1 = r; }
    }
    const r2 = c2 ? Math.floor((TL - br1 * b1) / b2) : 0;
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
    unif(pA, pB, false),
    unif(pB, pA, true),
    guill(pA, pB, false, pB, pA, true),
    guill(pB, pA, true,  pA, pB, false),
  ].reduce((b, o) => o.n > b.n ? o : b, { n: -1, pls: [] }).pls;
}

// ── ISO HELPERS ────────────────────────────────────────────────────────────
const toIso = (x, y, z, s) => [(x - y) * C30 * s, ((x + y) / 2 - z) * s];
const mkP   = (pts, s) => pts.map(([x, y, z]) => toIso(x, y, z, s).join(",")).join(" ");

function IsoBox({ x, y, z, w, d, h, col, s, bf = 1 }) {
  const sk = "rgba(0,0,0,0.18)", sw = 0.65;
  return (
    <g>
      <polygon points={mkP([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]], s)}
        fill={shade(col, bf * 0.43)} stroke={sk} strokeWidth={sw} />
      <polygon points={mkP([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]], s)}
        fill={shade(col, bf * 0.67)} stroke={sk} strokeWidth={sw} />
      <polygon points={mkP([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]], s)}
        fill={shade(col, bf * 1.0)}  stroke={sk} strokeWidth={sw} />
    </g>
  );
}

// ── PALLET ISO VIEW ────────────────────────────────────────────────────────
function PalletView({ sku, pa, pb, oh, col, pack, disabledBoxes, onToggleBox }) {
  const { bH, bW, bL } = flatOrient(sku.en, sku.boy, sku.yuk);
  const { cols, rows, layers, boxL, boxW } = pack;

  // ── CENTERING: stack centered on pallet (works for under- and overhang) ─
  const stackL = cols * boxL;
  const stackD = rows * boxW;
  const offX = (pa - stackL) / 2;
  const offY = (pb - stackD) / 2;

  const wxMin = Math.min(0, offX);
  const wxMax = Math.max(pa, offX + stackL);
  const wyMin = Math.min(0, offY);
  const wyMax = Math.max(pb, offY + stackD);
  const wzMax = PALLET_BASE_H + layers * bH;

  const span = (wxMax - wxMin) + (wyMax - wyMin);
  const S = Math.min(2.5, Math.max(0.52, 330 / Math.max(1, span * C30)));

  const wCorners = [
    [wxMin,wyMin,0],[wxMax,wyMin,0],[wxMin,wyMax,0],[wxMax,wyMax,0],
    [wxMin,wyMin,wzMax],[wxMax,wyMin,wzMax],[wxMin,wyMax,wzMax],[wxMax,wyMax,wzMax],
  ].map(([x, y, z]) => toIso(x, y, z, S));
  const pad = 18;
  const vx0 = Math.min(...wCorners.map(c => c[0])) - pad;
  const vy0 = Math.min(...wCorners.map(c => c[1])) - pad;
  const vx1 = Math.max(...wCorners.map(c => c[0])) + pad;
  const vy1 = Math.max(...wCorners.map(c => c[1])) + pad;
  const vW = vx1 - vx0, vH = vy1 - vy0;

  // ── PAINTER'S ALGORITHM ─────────────────────────────────────────────────
  // Generate every box, then sort strictly by (z asc, then x+y asc).
  // Lower layers draw first; within a layer, far corners (small x+y) draw
  // first and front-right corner (large x+y) draws last.
  const boxList = [];
  if (cols > 0 && rows > 0) {
    for (let ly = 0; ly < layers; ly++) {
      const bf = 0.50 + (ly / Math.max(layers - 1, 1)) * 0.55;
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          boxList.push({
            x: offX + cx * boxL,
            y: offY + ry * boxW,
            z: PALLET_BASE_H + ly * bH,
            bf,
            key: `${ly}-${ry}-${cx}`,
          });
        }
      }
    }
    boxList.sort((a, b) => a.z - b.z || (a.x + a.y) - (b.x + b.y));
  }

  // Pallet edge dashed line (visible whenever overhang is enabled)
  const ohLine = oh > 0
    ? [[0,0,PALLET_BASE_H],[pa,0,PALLET_BASE_H],[pa,pb,PALLET_BASE_H],[0,pb,PALLET_BASE_H],[0,0,PALLET_BASE_H]]
        .map(([x, y, z]) => toIso(x, y, z, S).join(",")).join(" ")
    : null;

  const [scx, scy] = toIso(pa / 2, pb / 2, 0, S);

  return (
    <svg width="100%" viewBox={`0 0 ${vW.toFixed(1)} ${vH.toFixed(1)}`}
      style={{ maxHeight: 420, display: "block" }}>
      <defs>
        <filter id="ps-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#000" floodOpacity="0.4" />
        </filter>
      </defs>
      <g transform={`translate(${(-vx0).toFixed(2)},${(-vy0).toFixed(2)})`}>
        <ellipse cx={scx} cy={scy + 7}
          rx={(pa + pb) * C30 * S * 0.42} ry={(pa + pb) * S * 0.085}
          fill="rgba(0,0,0,0.28)" filter="url(#ps-shadow)" />
        <IsoBox x={0} y={0} z={0} w={pa} d={pb} h={PALLET_BASE_H} col="#7B5B1C" s={S} bf={1} />
        {[pa * 0.33, pa * 0.66].map((lx, i) => {
          const [x1, y1] = toIso(lx, 0, PALLET_BASE_H, S);
          const [x2, y2] = toIso(lx, pb, PALLET_BASE_H, S);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(0,0,0,0.11)" strokeWidth={0.8} />;
        })}
        {boxList.map(b => {
          const disabled = disabledBoxes.has(b.key);
          return (
            <g
              key={b.key}
              style={{ cursor: "pointer", opacity: disabled ? 0.22 : 1 }}
              onClick={() => onToggleBox && onToggleBox(b.key)}
            >
              <IsoBox x={b.x} y={b.y} z={b.z}
                w={boxL} d={boxW} h={bH} col={disabled ? "#5C6D80" : col} s={S} bf={disabled ? 0.55 : b.bf} />
            </g>
          );
        })}
        {(cols === 0 || rows === 0) && (
          <text x={toIso(pa/2, pb/2, PALLET_BASE_H+10, S)[0]} y={toIso(pa/2, pb/2, PALLET_BASE_H+10, S)[1]}
            textAnchor="middle" fontSize={11} fill="#F87171" fontWeight={700}>
            ⚠ Ürün Palete Sığmıyor
          </text>
        )}
        {ohLine && <polyline points={ohLine} fill="none" stroke="#FBBF24"
          strokeWidth={2} strokeDasharray="7,4" opacity={0.92} />}
      </g>
    </svg>
  );
}

// ── TRUCK MAP (DETAILED: pallet + package footprint, in 3 layered passes) ──
function TruckMap({ placements, setPlacements, selectedIds, setSelectedIds, col, fpA, fpB, theme }) {
  const SC = 0.61;
  const tw = TL * SC, th = TW * SC;
  const PL = 44, PT = 10;
  const svgRef = useRef();
  const [drag, setDrag] = useState(null);

  const toCm = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - PL) / SC;
    const y = (clientY - rect.top - PT) / SC;
    return { x, y };
  };

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (evt) => {
      if (!svgRef.current) return;
      const { x, y } = toCm(evt.clientX, evt.clientY);
      setPlacements((prev) => {
        const dx = Math.round((x - drag.startX) / GRID_STEP_CM) * GRID_STEP_CM;
        const dy = Math.round((y - drag.startY) / GRID_STEP_CM) * GRID_STEP_CM;
        const nextById = new Map(
          drag.ids.map((id) => {
            const origin = drag.origins[id];
            return [id, { x: origin.x + dx, y: origin.y + dy }];
          })
        );
        const staticPlacements = prev.filter((p) => !nextById.has(p.id));
        for (const p of prev) {
          if (!nextById.has(p.id)) continue;
          const n = nextById.get(p.id);
          const candidate = { ...p, x: n.x, y: n.y };
          if (candidate.x < 0 || candidate.y < 0) return prev;
          if (candidate.x + candidate.w > TL || candidate.y + candidate.h > TW) return prev;
          if (staticPlacements.some((sp) => overlap(candidate, sp))) return prev;
        }
        return prev.map((p) => {
          const n = nextById.get(p.id);
          return n ? { ...p, x: n.x, y: n.y } : p;
        });
      });
    };
    const onUp = () => setDrag(null);
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
    placements.forEach((pl) => {
      if (ids.includes(pl.id)) origins[pl.id] = { x: pl.x, y: pl.y };
    });
    setDrag({
      ids,
      origins,
      startX: m.x,
      startY: m.y,
      leadX: leadPlacement.x,
      leadY: leadPlacement.y,
    });
  };

  const handlePalletMouseDown = (evt, p) => {
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
  for (let x = 0; x <= TL; x += 20) gridX.push(x);
  const gridY = [];
  for (let y = 0; y <= TW; y += 10) gridY.push(y);

  return (
    <div style={{ overflowX: "auto", border: `1px solid ${theme.borderSoft}`, borderRadius: 10 }}>
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
                  fill="#7B5B1C" stroke={isSelected ? "#FCD34D" : "#3D2D0E"} strokeWidth={isSelected ? 2.1 : 0.5} rx={1.5} />
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
          {placements.map((p, i) => {
            const fpL = p.paAlongL ? fpA : fpB;
            const fpW = p.paAlongL ? fpB : fpA;
            if (fpL <= 0 || fpW <= 0) return null;
            const pkx = (p.x + (p.w - fpL) / 2) * SC;
            const pky = (p.y + (p.h - fpW) / 2) * SC;
            const pkw = fpL * SC;
            const pkh = fpW * SC;
            return (
              <rect key={`pkg-${p.id}`} x={pkx} y={pky} width={pkw} height={pkh}
                fill={alpha(col, 0.74)} stroke={shade(col, 0.5)}
                strokeWidth={0.7} rx={1} style={{ pointerEvents: "none" }} />
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
            {TL} cm ← Tır Uzunluğu →
          </text>
        </g>
        <text x={15} y={th/2+PT} textAnchor="middle" dominantBaseline="middle"
          fontSize={12} fill={theme.textMuted} transform={`rotate(-90,15,${th/2+PT})`}>
          {TW} cm
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
  const pct = Math.min(100, (val / max) * 100);
  const c = pct < 70 ? "#22D3EE" : pct < 90 ? "#FBBF24" : "#EF4444";
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ color: theme.textSecondary }}>{lbl}</span>
        <span style={{ color: c, fontWeight: 700 }}>
          {val % 1 ? val.toFixed(1) : val} / {max} {unit}
        </span>
      </div>
      <div style={{ background: theme.panelBg, borderRadius: 5, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 5,
          transition: "width 0.32s ease",
          background: `linear-gradient(90deg,${shade(c,0.55)},${c})` }} />
      </div>
      <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "right", marginTop: 2 }}>
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

function StatRow({ k, v, vc, theme }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3.5px 0",
      borderBottom: `1px solid ${theme.borderSoft}`, fontSize: 12.5 }}>
      <span style={{ color: theme.textMuted }}>{k}</span>
      <span style={{ color: vc || theme.textSecondary, fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function Badge({ ok, lbl }) {
  return (
    <span style={{
      fontSize: 11, padding: "3px 9px", borderRadius: 20, fontWeight: 800,
      border: `1px solid ${ok ? "#34D399" : "#F87171"}35`,
      background: ok ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)",
      color: ok ? "#34D399" : "#F87171",
    }}>
      {ok ? "✓" : "✗"} {lbl}
    </span>
  );
}

function LayerEditor({ cols, rows, layers, activeLayer, setActiveLayer, setDisabledBoxes, theme }) {
  if (!cols || !rows || !layers) return null;
  const makeKey = (ly, ry, cx) => `${ly}-${ry}-${cx}`;
  const clearLayer = () => {
    setDisabledBoxes((prev) => {
      const next = [...prev];
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          const key = makeKey(activeLayer, ry, cx);
          if (!next.includes(key)) next.push(key);
        }
      }
      return next;
    });
  };
  const fillLayer = () => {
    setDisabledBoxes((prev) => prev.filter((k) => !k.startsWith(`${activeLayer}-`)));
  };

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
        <span style={{ fontSize: 12, color: theme.textPrimary, fontWeight: 700 }}>Kat Kontrolü:</span>
        <select
          value={activeLayer}
          onChange={(e) => setActiveLayer(+e.target.value)}
          style={{
            background: theme.panelBgStrong,
            color: theme.textPrimary,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {Array.from({ length: layers }).map((_, i) => (
            <option key={i} value={i}>{i + 1}. kat</option>
          ))}
        </select>
        <button onClick={clearLayer} style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
          background: "rgba(239,68,68,0.12)",
          color: "#FCA5A5",
          cursor: "pointer",
        }}>
          Katı boşalt
        </button>
        <button onClick={fillLayer} style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 8,
          border: `1px solid ${theme.border}`,
          background: "rgba(16,185,129,0.12)",
          color: "#86EFAC",
          cursor: "pointer",
        }}>
          Katı doldur
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
  const [oh,     setOh]     = useState(0);
  const [maxH, setMaxH] = useState(DEFAULT_MAX_H);
  const [maxKg, setMaxKg] = useState(DEFAULT_MAX_KG);
  const [placements, setPlacements] = useState([]);
  const [selectedPlacementIds, setSelectedPlacementIds] = useState([]);
  const [disabledBoxes, setDisabledBoxes] = useState([]);
  const [activeLayer, setActiveLayer] = useState(0);
  const [quickAddPanel, setQuickAddPanel] = useState("none");
  const [newPal, setNewPal] = useState({ label: "", a: "", b: "", mode: "temporary" });
  const [newSku, setNewSku] = useState({ sku: "", name: "", en: "", boy: "", yuk: "", kg: "", qty: "", mode: "temporary" });
  const [msg,    setMsg]    = useState("");
  const fRef = useRef();

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
        let parsed = parseCSV(ev.target.result);
        if (!parsed.length) parsed = parseCSVLoose(ev.target.result);
        if (!parsed.length) { setMsg("⚠ CSV boş ya da format tanınamadı."); return; }
        setBaseSkus(parsed.map((s, i) => ({ ...s, _id: `csv-${i}-${s.sku}` })));
        setSkuI(0);
        setIsDemo(false);
        setMsg(`✓ ${parsed.length} SKU yüklendi.`);
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
      JSON.stringify(customSkus.filter((s) => s.persist).map(({ sku, name, qty, en, boy, yuk, kg }) => ({ sku, name, qty, en, boy, yuk, kg })))
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
  const { bH, bW, bL } = flatOrient(sku?.en || 0, sku?.boy || 0, sku?.yuk || 0);
  const pack = packPallet(bL, bW, bH, pal.a, pal.b, oh, maxH);
  const { cols, rows, layers } = pack;
  const fpA  = cols * pack.boxL;   // pkg footprint along pallet pA axis
  const fpB  = rows * pack.boxW;   // pkg footprint along pallet pB axis
  const ippRaw = cols * rows * layers;
  const disabledCount = disabledBoxes.length;
  const ipp  = Math.max(0, ippRaw - disabledCount);
  const pKg  = ipp * (sku?.kg || 0);
  const stkH = PALLET_BASE_H + layers * bH;
  const autoPlacements = useMemo(
    () => packTruck(pal.a, pal.b).map((p, i) => ({ ...p, id: `auto-${i}` })),
    [pal.a, pal.b]
  );
  useEffect(() => {
    setPlacements(autoPlacements);
    setSelectedPlacementIds([]);
  }, [autoPlacements]);

  useEffect(() => {
    const validKeys = new Set();
    for (let ly = 0; ly < layers; ly++) {
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          validKeys.add(`${ly}-${ry}-${cx}`);
        }
      }
    }
    setDisabledBoxes((prev) => prev.filter((k) => validKeys.has(k)));
    setActiveLayer((prev) => Math.min(prev, Math.max(0, layers - 1)));
  }, [cols, rows, layers]);

  const nPal = placements.length;
  const nItm = nPal * ipp;
  const nTon = nPal * pKg / 1000;

  const card = { background:THEME.cardBg, borderRadius:12, padding:"16px 18px", border:`1px solid ${THEME.border}` };
  const SL   = { fontSize:11, color:THEME.textPrimary, fontWeight:900, letterSpacing:1.2,
                 marginBottom:10, display:"block", textTransform:"uppercase" };
  const SEL  = { width:"100%", background:THEME.panelBgStrong, color:THEME.textSecondary,
                 border:`1px solid ${THEME.border}`, borderRadius:8, padding:"7px 10px",
                 fontSize:13.5, outline:"none", cursor:"pointer" };

  const msgCol = msg.startsWith("✓") ? "#34D399" : msg.startsWith("⚠") ? "#FCD34D" : "#F87171";
  const msgBg  = msg.startsWith("✓") ? "rgba(52,211,153,0.08)" :
                 msg.startsWith("⚠") ? "rgba(252,211,77,0.08)" : "rgba(248,113,113,0.08)";

  const addCustomPallet = () => {
    const a = Number(newPal.a);
    const b = Number(newPal.b);
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
    const en = Number(newSku.en);
    const boy = Number(newSku.boy);
    const yuk = Number(newSku.yuk);
    const kg = Number(newSku.kg);
    const qty = Number(newSku.qty || 0);
    if (!(en > 0 && boy > 0 && yuk > 0 && kg >= 0)) {
      setMsg("⚠ Ürün için en, boy, yükseklik ve kg değerlerini doğru girin.");
      return;
    }
    const item = {
      _id: uid("custom-sku"),
      sku: (newSku.sku || `MAN-${customSkus.length + 1}`).trim(),
      name: (newSku.name || "Manuel Ürün").trim(),
      en, boy, yuk, kg, qty,
      persist: newSku.mode === "persistent",
    };
    setCustomSkus((prev) => [...prev, item]);
    setSkuI(skus.length);
    setNewSku({ sku: "", name: "", en: "", boy: "", yuk: "", kg: "", qty: "", mode: newSku.mode });
    setQuickAddPanel("none");
    setMsg(`✓ Geçici simülasyon ürünü eklendi (${item.sku}).`);
  };

  const addPalletToTruck = (rotated = false) => {
    const p = rotated
      ? { w: pal.a, h: pal.b, paAlongL: true }
      : { w: pal.b, h: pal.a, paAlongL: false };
    const free = findFreeSpot(placements, p.w, p.h);
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
          return validPlacement(candidate, next, p.id) ? candidate : p;
        });
      }
      return next;
    });
  };

  const resetTruckLayout = () => {
    setPlacements(autoPlacements);
    setSelectedPlacementIds([]);
  };

  const toggleIsoBox = (key) => {
    setDisabledBoxes((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const disabledSet = useMemo(() => new Set(disabledBoxes), [disabledBoxes]);

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
            CSV + Aranabilir SKU + İnteraktif Tır Haritası · Tır: {TL}×{TW}cm · Limit: {maxH}cm / {maxKg}kg
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
          <button onClick={() => fRef.current && fRef.current.click()}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 15px",
              background:"linear-gradient(135deg,#1A4FA0,#2563EB)", border:"none",
              borderRadius:8, color:"white", fontSize:13, cursor:"pointer",
              fontWeight:700, whiteSpace:"nowrap", boxShadow:"0 2px 8px rgba(37,99,235,0.3)" }}>
            📂 Dosya Seç
          </button>
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

        <div style={{ flex:"0 1 175px", minWidth:140 }}>
          <span style={SL}>Palet Tipi</span>
          <select style={SEL} value={palI} onChange={e => setPalI(+e.target.value)}>
            {allPallets.map((p, i) => <option key={p._id || i} value={i}>{p.label}{p.source === "custom" ? " (özel)" : ""}</option>)}
          </select>
        </div>

        <div style={{ flexShrink:0 }}>
          <span style={SL}>Sarkım</span>
          <div style={{ display:"flex", gap:4 }}>
            {[0, 5, 15].map(v => {
              const on = oh === v;
              return (
                <button key={v} onClick={() => setOh(v)} style={{
                  padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11.5,
                  border:`1.5px solid ${on ? col : THEME.border}`,
                  background: on ? alpha(col, 0.11) : THEME.panelBgStrong,
                  color: on ? col : THEME.textMuted,
                  fontWeight: on ? 800 : 500, transition:"all 0.18s" }}>
                  {v === 0 ? "Yok" : `${v}cm`}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ flex:"1 1 270px", minWidth:200 }}>
          <span style={SL}>Yükleme Limitleri</span>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <input
              type="number"
              value={maxH}
              min={PALLET_BASE_H + 1}
              onChange={(e) => setMaxH(Math.max(PALLET_BASE_H + 1, Number(e.target.value || DEFAULT_MAX_H)))}
              placeholder="Maks yükseklik (cm)"
              style={{ ...SEL, padding: "6px 10px" }}
            />
            <input
              type="number"
              value={maxKg}
              min={1}
              onChange={(e) => setMaxKg(Math.max(1, Number(e.target.value || DEFAULT_MAX_KG)))}
              placeholder="Maks ağırlık (kg)"
              style={{ ...SEL, padding: "6px 10px" }}
            />
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
              <input type="number" value={newPal.a} onChange={(e) => setNewPal((p) => ({ ...p, a: e.target.value }))}
                placeholder="En (cm)" style={SEL} />
              <input type="number" value={newPal.b} onChange={(e) => setNewPal((p) => ({ ...p, b: e.target.value }))}
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
              <input type="number" value={newSku.en} onChange={(e) => setNewSku((s) => ({ ...s, en: e.target.value }))} placeholder="En" style={SEL} />
              <input type="number" value={newSku.boy} onChange={(e) => setNewSku((s) => ({ ...s, boy: e.target.value }))} placeholder="Boy" style={SEL} />
              <input type="number" value={newSku.yuk} onChange={(e) => setNewSku((s) => ({ ...s, yuk: e.target.value }))} placeholder="Yük." style={SEL} />
              <input type="number" value={newSku.kg} onChange={(e) => setNewSku((s) => ({ ...s, kg: e.target.value }))} placeholder="Kg" style={SEL} />
              <input type="number" value={newSku.qty} onChange={(e) => setNewSku((s) => ({ ...s, qty: e.target.value }))} placeholder="Adet" style={SEL} />
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
            + Sarkım ±{oh}cm → Eff. Alan: {pal.a+2*oh}×{pal.b+2*oh} cm
          </span>
        )}
      </div>

      {/* MAIN GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:10, marginBottom:10 }}>
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
              disabledBoxes={disabledSet}
              onToggleBox={toggleIsoBox}
            />
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:13, color:THEME.textMuted, alignItems:"center" }}>
            <span>Palet: <b style={{ color:THEME.textSecondary }}>{pal.a}×{pal.b}×{PALLET_BASE_H}cm</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Kutu: <b style={{ color:THEME.textSecondary }}>{bL}×{bW}×{bH}cm</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Dizilim: <b style={{ color:col }}>{cols}×{rows}×{layers} kat</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Paket Tabanı: <b style={{ color:col }}>{fpA}×{fpB}cm</b></span>
            <span style={{ color:THEME.dim }}>·</span>
            <span>Aktif Kutu: <b style={{ color:"#86EFAC" }}>{ipp}</b></span>
            {oh > 0 && <>
              <span style={{ color:THEME.dim }}>·</span>
              <span style={{ color:"#F59E0B" }}>⚠ ±{oh}cm Sarkım</span>
            </>}
          </div>
          <LayerEditor
            cols={cols}
            rows={rows}
            layers={layers}
            activeLayer={activeLayer}
            setActiveLayer={setActiveLayer}
            setDisabledBoxes={setDisabledBoxes}
            theme={THEME}
          />
        </div>

        <div style={card}>
          <span style={SL}>📊 Yük Analizi</span>
          <Gauge lbl="Yükleme Yüksekliği" val={stkH} max={maxH}  unit="cm" theme={THEME} />
          <Gauge lbl="Palet Ağırlığı"     val={pKg}  max={maxKg} unit="kg" theme={THEME} />
          <div style={{ borderTop:`1px solid ${THEME.borderSoft}`, margin:"9px 0 7px" }} />
          <StatRow k="Ürün (SKU)"        v={sku.sku} vc={col} theme={THEME} />
          <StatRow k="Palet Tipi"        v={pal.label} theme={THEME} />
          <StatRow k="Kat Başına Kutu"   v={`${cols}×${rows} = ${cols*rows}`} theme={THEME} />
          <StatRow k="Toplam Kat"        v={layers} theme={THEME} />
          <StatRow k="Palet Başına (aktif)" v={`${ipp} adet`} theme={THEME} />
          <StatRow k="Tırdaki Palet"     v={`${nPal} adet`} theme={THEME} />
          <StatRow k="Toplam Kutu"       v={nItm.toLocaleString()} theme={THEME} />
          <StatRow k="Toplam Yük"        v={`${nTon.toFixed(2)} ton`} theme={THEME} />
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:10 }}>
            <Badge ok={stkH <= maxH}          lbl="YÜKSEKLİK" />
            <Badge ok={pKg  <= maxKg}         lbl="AĞIRLIK" />
            <Badge ok={cols > 0 && rows > 0} lbl="SIĞIYOR" />
          </div>
        </div>
      </div>

      {/* TRUCK MAP */}
      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:10, flexWrap:"wrap", gap:6 }}>
          <span style={{ ...SL, marginBottom:0, fontSize:13 }}>🗺️ Tır Yükleme Haritası · Çoklu Seçim + Sürükle-Bırak</span>
          <span style={{ fontSize:13, color:THEME.textMuted }}>
            <b style={{ color:THEME.textPrimary }}>{nPal}</b> palet · Seçili: <b style={{ color:"#FCD34D" }}>{selectedPlacementIds.length}</b> · Ctrl/Shift ile çoklu seçim
          </span>
        </div>
        <div style={{ background:THEME.panelBg, borderRadius:9, padding:"12px 10px" }}>
          <TruckMap
            placements={placements}
            setPlacements={setPlacements}
            selectedIds={selectedPlacementIds}
            setSelectedIds={setSelectedPlacementIds}
            col={col}
            fpA={fpA}
            fpB={fpB}
            theme={THEME}
          />
        </div>
        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
          <button onClick={() => addPalletToTruck(false)} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>+ Palet</button>
          <button onClick={() => addPalletToTruck(true)} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>+ Döndürülmüş</button>
          <button onClick={rotateSelected} style={{ ...SEL, width:"auto", padding:"9px 11px", color:"#FDE68A", fontWeight:700 }}>Seçiliyi Döndür</button>
          <button onClick={removeSelectedPallet} style={{ ...SEL, width:"auto", padding:"9px 11px", color:"#FCA5A5", fontWeight:700 }}>Seçiliyi Sil</button>
          <button onClick={resetTruckLayout} style={{ ...SEL, width:"auto", padding:"9px 11px", fontWeight:700 }}>Sıfırla</button>
        </div>
        <div style={{ display:"flex", gap:16, marginTop:10, fontSize:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"#7B5B1C", border:"0.5px solid #3D2D0E" }} />
            <span style={{ color:THEME.textSecondary }}>Palet ({pal.a}×{pal.b}cm) · {nPal} adet</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:alpha(col, 0.74) }} />
            <span style={{ color:THEME.textSecondary }}>Paket Tabanı ({fpA}×{fpB}cm)</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"rgba(239,68,68,0.4)" }} />
            <span style={{ color:THEME.textSecondary }}>Boş Alan</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize:12, color:THEME.textMuted, textAlign:"center", marginTop:10, marginBottom:0 }}>
        {isDemo ? "⚠ Örnek veri · CSV yükleyerek gerçek verilerinizi görselleştirin"
                : "✓ Gerçek CSV verisi yüklü"} · Painter Algorithm · İnteraktif Yerleşim · Guillotine Packing
      </p>
    </div>
  );
}
