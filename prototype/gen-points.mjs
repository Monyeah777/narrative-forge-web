import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N_GLYPH = [
  "1000001",
  "1100001",
  "1010001",
  "1001001",
  "1000101",
  "1000011",
  "1000001"
];

const F_GLYPH = [
  "111111",
  "100000",
  "100000",
  "111110",
  "100000",
  "100000",
  "100000"
];

function stamp(points, glyph, ox, oy, cellW, cellH, perCell, rand) {
  for (let row = 0; row < glyph.length; row++) {
    const line = glyph[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== "1") continue;
      for (let k = 0; k < perCell; k++) {
        points.push({
          x: +(ox + (col + rand()) * cellW).toFixed(5),
          y: +(oy + (row + rand()) * cellH).toFixed(5)
        });
      }
    }
  }
}

const rand = mulberry32(0x4e46);
const points = [];

stamp(points, N_GLYPH, 0.07, 0.22, 0.034, 0.075, 34, rand);
stamp(points, F_GLYPH, 0.34, 0.22, 0.034, 0.075, 34, rand);

for (let i = 0; i < 260; i++) {
  const t = rand();
  points.push({
    x: +(0.055 + rand() * 0.012).toFixed(5),
    y: +(0.18 + t * 0.62).toFixed(5)
  });
}

for (let i = 0; i < 180; i++) {
  points.push({
    x: +(0.07 + rand() * 0.5).toFixed(5),
    y: +(0.78 + rand() * 0.04).toFixed(5)
  });
}

const clipped = points.filter((p) => p.x >= 0 && p.x <= 0.62 && p.y >= 0 && p.y <= 1);
const payload = { points: clipped };

const out = join(dirname(fileURLToPath(import.meta.url)), "points.json");
writeFileSync(out, JSON.stringify(payload));
console.log("wrote", clipped.length, "points to", out);
