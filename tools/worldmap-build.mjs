import fs from "fs";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath, geoArea } from "d3-geo";
import iso from "i18n-iso-countries";
const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/countries-110m.json"));
const fc = feature(topo, topo.objects.countries);
fc.features = fc.features.filter((f) => f.properties.name !== "Antarctica");
const proj = geoNaturalEarth1().fitExtent([[0, 0], [1000, 500]], fc);
const path = geoPath(proj).digits(1);
const rows = [];
for (const f of fc.features) {
  let a2 = f.id ? (iso.numericToAlpha2(f.id) || "") : "";
  if (!a2 && f.properties.name === "Kosovo") a2 = "XK";
  const d = path(f); if (!d) continue;
  // zoom box: the biggest piece of the country (mainland), so the US zooms on the 48 states, France on France
  let g = f;
  if (f.geometry.type === "MultiPolygon") {
    let best = null, bestA = -1;
    for (const poly of f.geometry.coordinates) { const p = { type: "Polygon", coordinates: poly }; const a = geoArea(p); if (a > bestA) { bestA = a; best = p; } }
    g = best;
  }
  const b = path.bounds(g).flat().map((v) => Math.round(v * 10) / 10);
  rows.push([a2.toLowerCase(), d, b]);
}
fs.writeFileSync("/home/claude/club-app/worldmap.js",
  "// World map for the Members → Map tab. Natural Earth projection, 1000×500, from world-atlas countries-110m (public domain, Natural Earth).\n" +
  "// Each row: [ISO alpha-2 code (lower case, '' if none), SVG path, zoom box [x0, y0, x1, y1] of the country's main piece].\n" +
  "// Built by a script; don't edit by hand.\n" +
  "export const WORLD = " + JSON.stringify(rows) + ";\n");
console.log(rows.length, rows.filter(r => !r[0]).length, fs.statSync("/home/claude/club-app/worldmap.js").size);
