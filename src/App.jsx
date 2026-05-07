import { useState, useRef, useEffect } from "react";

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const C30 = Math.cos(Math.PI / 6);
const TL = 1360, TW = 245;
const PH = 15, MAX_H = 205, MAX_KG = 1000;

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

// ── FLAT ORIENTATION RULE ──────────────────────────────────────────────────
function flatOrient(en, boy, yuk) {
  const [s, m, l] = [+en, +boy, +yuk].sort((a, b) => a - b);
  return { bH: s, bW: m, bL: l };
}

// ── CSV PARSER ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdrs = lines[0].split(",").map(h => h.trim());
  const fi = (...kws) => {
    for (const kw of kws) {
      const kwl = kw.toLowerCase();
      const i = hdrs.findIndex(h => {
        const first = h.toLowerCase().trim().split(/[\s(,_]/)[0];
        return first === kwl;
      });
      if (i >= 0) return i;
    }
    return -1;
  };
  const iP=fi("parent"), iS=fi("sku"), iQ=fi("paket"),
        iE=fi("en"),     iB=fi("boy"), iY=fi("yukseklik","yükseklik","yuk"),
        iK=fi("kg");
  return lines.slice(1)
    .filter(l => l.trim())
    .map((line, idx) => {
      const v = line.split(",").map(s => s.trim());
      const get = i => (i >= 0 ? v[i] : "") || "";
      return {
        sku:  get(iS) || `SKU-${idx + 1}`,
        name: get(iP) || get(iS) || `Ürün ${idx + 1}`,
        qty:  parseInt(get(iQ))   || 0,
        en:   parseFloat(get(iE)) || 0,
        boy:  parseFloat(get(iB)) || 0,
        yuk:  parseFloat(get(iY)) || 0,
        kg:   parseFloat(get(iK)) || 0,
      };
    })
    .filter(s => s.en > 0 && s.boy > 0 && s.yuk > 0);
}

// ── PALLET PACKING ─────────────────────────────────────────────────────────
function packPallet(bL, bW, bH, pA, pB, oh) {
  const eA = pA + 2 * oh, eB = pB + 2 * oh;
  const layers = Math.max(1, Math.floor((MAX_H - PH) / bH));
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
function PalletView({ sku, pa, pb, oh, col, pack }) {
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
  const wzMax = PH + layers * bH;

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
            z: PH + ly * bH,
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
    ? [[0,0,PH],[pa,0,PH],[pa,pb,PH],[0,pb,PH],[0,0,PH]]
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
        <IsoBox x={0} y={0} z={0} w={pa} d={pb} h={PH} col="#7B5B1C" s={S} bf={1} />
        {[pa * 0.33, pa * 0.66].map((lx, i) => {
          const [x1, y1] = toIso(lx, 0, PH, S);
          const [x2, y2] = toIso(lx, pb, PH, S);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(0,0,0,0.11)" strokeWidth={0.8} />;
        })}
        {boxList.map(b => (
          <IsoBox key={b.key} x={b.x} y={b.y} z={b.z}
            w={boxL} d={boxW} h={bH} col={col} s={S} bf={b.bf} />
        ))}
        {(cols === 0 || rows === 0) && (
          <text x={toIso(pa/2, pb/2, PH+10, S)[0]} y={toIso(pa/2, pb/2, PH+10, S)[1]}
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
function TruckMap({ placements, col, fpA, fpB }) {
  const SC = 0.46;
  const tw = TL * SC, th = TW * SC;
  const PL = 38, PT = 8;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={tw + PL + 10} height={th + PT + 22} style={{ display: "block" }}>
        <g transform={`translate(${PL},${PT})`}>
          <rect x={0} y={0} width={tw} height={th}
            fill="#060F1C" stroke="#1B3354" strokeWidth={1.5} rx={2} />
          <rect x={0} y={0} width={tw} height={th} fill="rgba(239,68,68,0.05)" />
          <rect x={0} y={0}        width={tw} height={4 * SC} fill="#192A3A" />
          <rect x={0} y={th-4*SC} width={tw} height={4 * SC} fill="#192A3A" />

          {/* LAYER 1 — Pallets (brown wood) */}
          {placements.map((p, i) => {
            const px = p.x*SC, py = p.y*SC, pw = p.w*SC, ph = p.h*SC;
            const longHoriz = pw >= ph;
            return (
              <g key={`pal-${i}`}>
                <rect x={px+0.4} y={py+0.4} width={pw-0.8} height={ph-0.8}
                  fill="#7B5B1C" stroke="#3D2D0E" strokeWidth={0.5} rx={1.5} />
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
              <rect key={`pkg-${i}`} x={pkx} y={pky} width={pkw} height={pkh}
                fill={alpha(col, 0.74)} stroke={shade(col, 0.5)}
                strokeWidth={0.7} rx={1} />
            );
          })}

          {/* LAYER 3 — Pallet numbers */}
          {placements.map((p, i) => {
            const px = p.x*SC, py = p.y*SC, pw = p.w*SC, ph = p.h*SC;
            if (pw < 14 || ph < 9) return null;
            return (
              <text key={`n-${i}`} x={px+pw/2} y={py+ph/2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={Math.min(pw, ph) * 0.27} fill="white"
                fontWeight={800} opacity={0.92}>
                {i + 1}
              </text>
            );
          })}

          <rect x={tw-8} y={0} width={8} height={th} fill="#1B2A3B" rx={1} />
          <rect x={tw-8} y={th*0.18} width={3} height={th*0.64} fill="#2C3F55" rx={1} />
          <text x={tw/2} y={th+15} textAnchor="middle" fontSize={9} fill="#2C3F55">
            {TL} cm ← Tır Uzunluğu →
          </text>
        </g>
        <text x={15} y={th/2+PT} textAnchor="middle" dominantBaseline="middle"
          fontSize={9} fill="#2C3F55" transform={`rotate(-90,15,${th/2+PT})`}>
          {TW} cm
        </text>
      </svg>
    </div>
  );
}

// ── SEARCHABLE SKU COMBOBOX ────────────────────────────────────────────────
function SkuCombobox({ skus, skuI, setSkuI, color }) {
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
          background: "#08121E", color: "#7FA8C8",
          border: `1px solid ${open ? color : "#192C45"}`, borderRadius: 8,
          padding: "7px 32px 7px 12px", fontSize: 12.5,
          outline: "none", cursor: "text", transition: "border 0.15s",
        }}
      />
      <span style={{
        position: "absolute", right: 10, top: "50%",
        transform: "translateY(-50%)", color: "#364C65",
        fontSize: 11, pointerEvents: "none",
      }}>
        {open ? "🔍" : "▾"}
      </span>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#0C1827", border: "1px solid #192C45",
          borderRadius: 8, zIndex: 100,
          boxShadow: "0 10px 26px rgba(0,0,0,0.6)",
        }}>
          <div style={{
            padding: "5px 11px", fontSize: 9, color: "#283A50",
            fontWeight: 800, letterSpacing: 1.5,
            borderBottom: "1px solid #192C45", textTransform: "uppercase",
          }}>
            {filtered.length} / {skus.length} SKU eşleşti
          </div>
          <div ref={listRef} style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 14, color: "#445570", fontSize: 11, textAlign: "center" }}>
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
                      padding: "7px 11px", cursor: "pointer", fontSize: 11.5,
                      background: isSel ? alpha(color, 0.13) : (isHov ? "#101C2E" : "transparent"),
                      borderLeft: `2px solid ${isSel ? color : "transparent"}`,
                      transition: "background 0.1s",
                    }}>
                    <div style={{ fontWeight: 700, color: isSel ? color : "#A0BAD0" }}>
                      {s.sku}
                    </div>
                    <div style={{ fontSize: 10, color: "#445570", marginTop: 1 }}>
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
function Gauge({ lbl, val, max, unit }) {
  const pct = Math.min(100, (val / max) * 100);
  const c = pct < 70 ? "#22D3EE" : pct < 90 ? "#FBBF24" : "#EF4444";
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: "#445570" }}>{lbl}</span>
        <span style={{ color: c, fontWeight: 700 }}>
          {val % 1 ? val.toFixed(1) : val} / {max} {unit}
        </span>
      </div>
      <div style={{ background: "#060F1C", borderRadius: 5, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 5,
          transition: "width 0.32s ease",
          background: `linear-gradient(90deg,${shade(c,0.55)},${c})` }} />
      </div>
      <div style={{ fontSize: 9, color: "#283A50", textAlign: "right", marginTop: 2 }}>
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

function StatRow({ k, v, vc }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3.5px 0",
      borderBottom: "1px solid #0A1525", fontSize: 11 }}>
      <span style={{ color: "#364C65" }}>{k}</span>
      <span style={{ color: vc || "#7FA8C8", fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function Badge({ ok, lbl }) {
  return (
    <span style={{
      fontSize: 9.5, padding: "2px 8px", borderRadius: 20, fontWeight: 800,
      border: `1px solid ${ok ? "#34D399" : "#F87171"}35`,
      background: ok ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)",
      color: ok ? "#34D399" : "#F87171",
    }}>
      {ok ? "✓" : "✗"} {lbl}
    </span>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [skus,   setSkus]   = useState(DEMO_SKUS);
  const [isDemo, setIsDemo] = useState(true);
  const [skuI,   setSkuI]   = useState(0);
  const [palI,   setPalI]   = useState(0);
  const [oh,     setOh]     = useState(0);
  const [msg,    setMsg]    = useState("");
  const fRef = useRef();

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setMsg("⏳ Yükleniyor...");
    const r = new FileReader();
    r.onload = ev => {
      try {
        const parsed = parseCSV(ev.target.result);
        if (!parsed.length) { setMsg("⚠ CSV boş ya da format tanınamadı."); return; }
        setSkus(parsed); setSkuI(0); setIsDemo(false);
        setMsg(`✓ ${parsed.length} SKU yüklendi.`);
      } catch { setMsg("✗ Dosya okunamadı."); }
    };
    r.readAsText(f, "UTF-8");
    e.target.value = "";
  }

  // Derived
  const sku = skus[skuI] || skus[0];
  const pal = PALLET_TYPES[palI];
  const col = PALETTE[skuI % PALETTE.length];
  const { bH, bW, bL } = flatOrient(sku.en, sku.boy, sku.yuk);
  const pack = packPallet(bL, bW, bH, pal.a, pal.b, oh);
  const { cols, rows, layers } = pack;
  const fpA  = cols * pack.boxL;   // pkg footprint along pallet pA axis
  const fpB  = rows * pack.boxW;   // pkg footprint along pallet pB axis
  const ipp  = cols * rows * layers;
  const pKg  = ipp * sku.kg;
  const stkH = PH + layers * bH;
  const pls  = packTruck(pal.a, pal.b);
  const nPal = pls.length;
  const nItm = nPal * ipp;
  const nTon = nPal * pKg / 1000;

  const card = { background:"#101C2E", borderRadius:12, padding:"13px 17px", border:"1px solid #192C45" };
  const SL   = { fontSize:9, color:"#283A50", fontWeight:900, letterSpacing:2,
                 marginBottom:10, display:"block", textTransform:"uppercase" };
  const SEL  = { width:"100%", background:"#08121E", color:"#7FA8C8",
                 border:"1px solid #192C45", borderRadius:8, padding:"7px 10px",
                 fontSize:12.5, outline:"none", cursor:"pointer" };

  const msgCol = msg.startsWith("✓") ? "#34D399" : msg.startsWith("⚠") ? "#FCD34D" : "#F87171";
  const msgBg  = msg.startsWith("✓") ? "rgba(52,211,153,0.08)" :
                 msg.startsWith("⚠") ? "rgba(252,211,77,0.08)" : "rgba(248,113,113,0.08)";

  return (
    <div style={{ background:"#080F1C", minHeight:"100vh", padding:"13px 16px",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif", color:"#B0C8E0" }}>

      {/* HEADER */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14,
        paddingBottom:12, borderBottom:"1px solid #101C2E" }}>
        <span style={{ fontSize:26 }}>🚛</span>
        <div style={{ flex:1 }}>
          <h1 style={{ margin:0, fontSize:16, fontWeight:900, letterSpacing:-0.4, color:"#DDE8F4" }}>
            Nordure Palet Yükleme Simülatörü
            <span style={{ fontSize:9, color:"#283A50", fontWeight:700, marginLeft:8, verticalAlign:"middle" }}>v3.0</span>
          </h1>
          <p style={{ margin:"2px 0 0", fontSize:10, color:"#283A50" }}>
            CSV + Aranabilir SKU + Detaylı Tır Haritası · Tır: {TL}×{TW}cm · Limit: {MAX_H}cm / {MAX_KG}kg
          </p>
        </div>
        {msg && (
          <div style={{ fontSize:10.5, padding:"4px 12px", borderRadius:8, flexShrink:0,
            background:msgBg, color:msgCol, border:`1px solid ${msgCol}28` }}>
            {msg}
          </div>
        )}
      </div>

      {/* CONTROLS */}
      <div style={{ display:"flex", gap:9, marginBottom:12, flexWrap:"wrap", alignItems:"flex-end" }}>
        <div style={{ flexShrink:0 }}>
          <span style={SL}>CSV Yükle</span>
          <button onClick={() => fRef.current && fRef.current.click()}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 15px",
              background:"linear-gradient(135deg,#1A4FA0,#2563EB)", border:"none",
              borderRadius:8, color:"white", fontSize:12, cursor:"pointer",
              fontWeight:700, whiteSpace:"nowrap", boxShadow:"0 2px 8px rgba(37,99,235,0.3)" }}>
            📂 Dosya Seç
          </button>
          <input ref={fRef} type="file" accept=".csv" style={{ display:"none" }} onChange={handleFile} />
          <div style={{ fontSize:9, color:"#1E3050", marginTop:3, maxWidth:130 }}>
            Parent, SKU, PAKET SAYISI,<br/>En, Boy, Yukseklik, KG Agirlik
          </div>
        </div>

        <div style={{ flex:"1 1 240px", minWidth:200 }}>
          <span style={SL}>Ürün Seçimi (SKU) · Aranabilir</span>
          <SkuCombobox skus={skus} skuI={skuI} setSkuI={setSkuI} color={col} />
          {isDemo && <div style={{ fontSize:9, color:"#1E3050", marginTop:3 }}>
            ⚠ Örnek veri · CSV yükleyin
          </div>}
        </div>

        <div style={{ flex:"0 1 175px", minWidth:140 }}>
          <span style={SL}>Palet Tipi</span>
          <select style={SEL} value={palI} onChange={e => setPalI(+e.target.value)}>
            {PALLET_TYPES.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
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
                  border:`1.5px solid ${on ? col : "#192C45"}`,
                  background: on ? alpha(col, 0.11) : "#08121E",
                  color: on ? col : "#364C65",
                  fontWeight: on ? 800 : 500, transition:"all 0.18s" }}>
                  {v === 0 ? "Yok" : `${v}cm`}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* FLAT ORIENT INFO */}
      <div style={{ ...card, marginBottom:10, padding:"7px 14px", display:"flex",
        gap:14, flexWrap:"wrap", alignItems:"center", borderLeft:`3px solid ${col}` }}>
        <span style={{ fontSize:9, color:"#283A50", fontWeight:900, letterSpacing:1.8, textTransform:"uppercase" }}>
          Düzleme Kuralı
        </span>
        <span style={{ fontSize:11, color:"#364C65" }}>
          Girdi [{sku.en}, {sku.boy}, {sku.yuk}] cm → Sırala →
        </span>
        <span style={{ fontSize:11 }}>
          <span style={{ color:"#4A6080" }}>H = </span>
          <b style={{ color:"#7FA8C8" }}>{bH} cm</b>
        </span>
        <span style={{ fontSize:11 }}>
          <span style={{ color:"#4A6080" }}>Taban = </span>
          <b style={{ color:col }}>{bL} × {bW} cm</b>
        </span>
        {oh > 0 && (
          <span style={{ fontSize:11, color:"#F59E0B" }}>
            + Sarkım ±{oh}cm → Eff. Alan: {pal.a+2*oh}×{pal.b+2*oh} cm
          </span>
        )}
      </div>

      {/* MAIN GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 255px", gap:10, marginBottom:10 }}>
        <div style={card}>
          <span style={SL}>📦 İzometrik Palet Görünümü · Painter Sıralı · Merkezlenmiş</span>
          <div style={{ background:"#060F1C", borderRadius:9, padding:"10px",
            display:"flex", justifyContent:"center", marginBottom:9 }}>
            <PalletView sku={sku} pa={pal.a} pb={pal.b} oh={oh} col={col} pack={pack} />
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:10.5, color:"#283A50", alignItems:"center" }}>
            <span>Palet: <b style={{ color:"#4A6080" }}>{pal.a}×{pal.b}×{PH}cm</b></span>
            <span style={{ color:"#0D1A2A" }}>·</span>
            <span>Kutu: <b style={{ color:"#4A6080" }}>{bL}×{bW}×{bH}cm</b></span>
            <span style={{ color:"#0D1A2A" }}>·</span>
            <span>Dizilim: <b style={{ color:col }}>{cols}×{rows}×{layers} kat</b></span>
            <span style={{ color:"#0D1A2A" }}>·</span>
            <span>Paket Tabanı: <b style={{ color:col }}>{fpA}×{fpB}cm</b></span>
            {oh > 0 && <>
              <span style={{ color:"#0D1A2A" }}>·</span>
              <span style={{ color:"#F59E0B" }}>⚠ ±{oh}cm Sarkım</span>
            </>}
          </div>
        </div>

        <div style={card}>
          <span style={SL}>📊 Yük Analizi</span>
          <Gauge lbl="Yükleme Yüksekliği" val={stkH} max={MAX_H}  unit="cm" />
          <Gauge lbl="Palet Ağırlığı"     val={pKg}  max={MAX_KG} unit="kg" />
          <div style={{ borderTop:"1px solid #0A1525", margin:"9px 0 7px" }} />
          <StatRow k="Ürün (SKU)"        v={sku.sku} vc={col} />
          <StatRow k="Palet Tipi"        v={pal.label} />
          <StatRow k="Kat Başına Kutu"   v={`${cols}×${rows} = ${cols*rows}`} />
          <StatRow k="Toplam Kat"        v={layers} />
          <StatRow k="Palet Başına"      v={`${ipp} adet`} />
          <StatRow k="Tırdaki Palet"     v={`${nPal} adet`} />
          <StatRow k="Toplam Kutu"       v={nItm.toLocaleString()} />
          <StatRow k="Toplam Yük"        v={`${nTon.toFixed(2)} ton`} />
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:10 }}>
            <Badge ok={stkH <= MAX_H}        lbl="YÜKSEKLİK" />
            <Badge ok={pKg  <= MAX_KG}       lbl="AĞIRLIK" />
            <Badge ok={cols > 0 && rows > 0} lbl="SIĞIYOR" />
          </div>
        </div>
      </div>

      {/* TRUCK MAP */}
      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:10, flexWrap:"wrap", gap:6 }}>
          <span style={{ ...SL, marginBottom:0 }}>🗺️ Tır Yükleme Haritası · Palet + Paket Detayı</span>
          <span style={{ fontSize:10.5, color:"#283A50" }}>
            <b style={{ color:"#7FA8C8" }}>{nPal}</b> palet · Guillotine Karma · {TL}×{TW}cm
          </span>
        </div>
        <div style={{ background:"#060F1C", borderRadius:9, padding:"9px 7px" }}>
          <TruckMap placements={pls} col={col} fpA={fpA} fpB={fpB} />
        </div>
        <div style={{ display:"flex", gap:16, marginTop:9, fontSize:10.5, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"#7B5B1C", border:"0.5px solid #3D2D0E" }} />
            <span style={{ color:"#445570" }}>Palet ({pal.a}×{pal.b}cm) · {nPal} adet</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:alpha(col, 0.74) }} />
            <span style={{ color:"#445570" }}>Paket Tabanı ({fpA}×{fpB}cm)</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:12, height:12, borderRadius:2, background:"rgba(239,68,68,0.4)" }} />
            <span style={{ color:"#445570" }}>Boş Alan</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize:9, color:"#111E30", textAlign:"center", marginTop:10, marginBottom:0 }}>
        {isDemo ? "⚠ Örnek veri · CSV yükleyerek gerçek verilerinizi görselleştirin"
                : "✓ Gerçek CSV verisi yüklü"} · Painter Algorithm · Düzleme Kuralı v2 · Guillotine Packing
      </p>
    </div>
  );
}
