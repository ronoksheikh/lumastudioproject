// Pre-renders the world map used by the map-zoom recipe to a light JSON file of SVG path
// strings (Natural Earth data via world-atlas), so the browser only has to tween an SVG viewBox.
// The highlighted country and its neighbours use detailed 1:50m geometry; the rest uses 1:110m.
//
// Usage: node scripts/build-map.mjs [--highlight 050] [--neighbours 356,104,064,524,156] [--city 90.4125,23.8103] [--root <project>]
//   ids are ISO 3166-1 numeric codes (050 = Bangladesh). Writes assets/world-map.json.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, projectRoot, importPkg, resolvePkg } from './lib/common.mjs';

const { opts } = parseArgs();
const root = projectRoot(opts);
const { geoMercator, geoPath } = await importPkg('d3-geo', root);
const { feature } = await importPkg('topojson-client', root);
const load = async (f) => JSON.parse(await readFile(resolvePkg(`world-atlas/${f}`, root), 'utf8'));

const W = 2400;
const H = 1500;
const ANTARCTICA = '010';
const HIGHLIGHT = String(opts.highlight ?? '050').padStart(3, '0');
const NEIGHBOURS = String(opts.neighbours ?? '356,104,064,524,156').split(',').filter(Boolean).map((s) => s.padStart(3, '0')); // IN, MM, BT, NP, CN
const CITY = String(opts.city ?? '90.4125,23.8103').split(',').map(Number);

const coarseTopo = await load('countries-110m.json');
const coarse = feature(coarseTopo, coarseTopo.objects.countries);
const fineTopo = await load('countries-50m.json');
const fine = feature(fineTopo, fineTopo.objects.countries);

const DETAILED = new Set([HIGHLIGHT, ...NEIGHBOURS]);
const world = coarse.features.filter((f) => f.id !== ANTARCTICA);
const projection = geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], { type: 'FeatureCollection', features: world });
const pathOf = geoPath(projection).digits(1);

const rest = world.filter((f) => !DETAILED.has(f.id)).map((f) => pathOf(f)).join('');
const neighbours = fine.features.filter((f) => DETAILED.has(f.id) && f.id !== HIGHLIGHT).map((f) => pathOf(f)).join('');
const hlFeature = fine.features.find((f) => f.id === HIGHLIGHT);
if (!hlFeature) throw new Error(`No country with id ${HIGHLIGHT}`);
const highlight = pathOf(hlFeature);
const [[x0, y0], [x1, y1]] = pathOf.bounds(hlFeature);
const round1 = (v) => Math.round(v * 10) / 10;
const highlightBox = [x0, y0, x1 - x0, y1 - y0].map(round1);
const city = projection(CITY).map(round1);

// generic keys + the legacy names the explainer example reads (bd / bdBox / dhaka)
const out = { width: W, height: H, rest, neighbours, highlight, highlightBox, city, bd: highlight, bdBox: highlightBox, dhaka: city };
await writeFile(path.join(root, 'assets/world-map.json'), JSON.stringify(out));
console.log(`world-map.json: ${(JSON.stringify(out).length / 1024).toFixed(0)} KB, highlight ${HIGHLIGHT} box ${highlightBox.join(', ')}, city ${city}`);
