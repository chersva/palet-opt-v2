import { readFileSync } from "fs";

function normHeader(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ý/g, "i")
    .replace(/þ/g, "s")
    .replace(/[^\w]+/g, " ")
    .trim();
}

function headerMatches(hdr, alias, { exactOnly = false, shortToken = false, exclude = [] } = {}) {
  if (!hdr || !alias) return false;
  if (exclude.some((ex) => hdr.includes(ex))) return false;
  if (hdr === alias) return true;
  if (exactOnly || shortToken) return false;
  if (alias.includes(" ")) return hdr === alias || hdr.startsWith(`${alias} `);
  return hdr.split(/\s+/)[0] === alias;
}

const hdrs = [
  "tedarikci adi", "parent", "sku", "name", "gercek alis fiyati",
  "paket sayisi", "en", "boy", "yukseklik", "agirlik",
].map(normHeader);

const findEn = () => {
  for (let i = 0; i < hdrs.length; i++) {
    if (headerMatches(hdrs[i], "en", { shortToken: true })) return i;
  }
  return -1;
};

const enIdx = findEn();
const parentIdx = hdrs.indexOf("parent");
const nameIdx = hdrs.indexOf("name");
const fiyatIdx = hdrs.indexOf("gercek alis fiyati");

console.log("TAB-10 mapping:", { enIdx, parentIdx, nameIdx, fiyatIdx });
if (enIdx !== 6 || parentIdx !== 1 || nameIdx !== 3 || fiyatIdx !== 4) {
  console.error("FAIL header mapping");
  process.exit(1);
}
// Eski fi(): hdr.includes("en") → "parent".includes("en") === true (yanlış eşleşme)
if (headerMatches(hdrs[parentIdx], "en", { shortToken: true })) {
  console.error("FAIL shortToken matcher must not match parent as en");
  process.exit(1);
}

const files = [
  ["ilk200.csv", "\t", { parent: 1, name: 3, fiyat: 4, en: 6, boy: 7, yuk: 8 }],
  ["200coklu.csv", ";", { parent: 1, name: 3, fiyat: 4, en: 5, boy: 6, yuk: 7 }],
];

for (const [file, delim, idx] of files) {
  const p = `c:/Users/alibaran/Desktop/Furniture & Sofa/Palet-Tır yerleşimi/${file}`;
  try {
    const lines = readFileSync(p, "utf8").trim().split(/\r?\n/);
    const v = lines[1].split(delim);
    for (const [key, i] of Object.entries(idx)) {
      const val = v[i];
      console.log(`  ${file} ${key}[${i}]=${val?.slice(0, 40)}`);
    }
  } catch (e) {
    console.warn(`  skip ${file}:`, e.message);
  }
}

console.log("OK");
