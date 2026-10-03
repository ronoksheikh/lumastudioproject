// Pre-renders the world map used in the "map zoom" scene to a light JSON file
// of SVG path strings (Natural Earth data via world-atlas), so the browser only
// has to tween an SVG viewBox. Bangladesh and its neighbours use the detailed
// 1:50m geometry; the rest of the world uses 1:110m.
//
// Usage: node scripts/build-map.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f) => JSON.parse(await readFile(require.resolve(`world-atlas/${f}`), 'utf8'));

const W = 2400;
const H = 1500;
const ANTARCTICA = '010';
const BANGLADESH = '050';
const DETAILED = new Set([BANGLADESH, '356', '104', '064', '524', '156']); // IN, MM, BT, NP, CN
const DHAKA = [90.4125, 23.8103];

const coarse = feature(await load('countries-110m.json'), (await load('countries-110m.json')).objects.countries);
const fineTopo = await load('countries-50m.json');
const fine = feature(fineTopo, fineTopo.objects.countries);

const world = coarse.features.filter((f) => f.id !== ANTARCTICA);
const projection = geoMercator().fitExtent([[40, 40], [W - 40, H - 40]], { type: 'FeatureCollection', features: world });
const pathOf = geoPath(projection).digits(1);

const rest = world.filter((f) => !DETAILED.has(f.id)).map((f) => pathOf(f)).join('');
const neighbours = fine.features.filter((f) => DETAILED.has(f.id) && f.id !== BANGLADESH).map((f) => pathOf(f)).join('');
const bdFeature = fine.features.find((f) => f.id === BANGLADESH);
const bd = pathOf(bdFeature);
const [[x0, y0], [x1, y1]] = pathOf.bounds(bdFeature);
const dhaka = projection(DHAKA).map((v) => Math.round(v * 10) / 10);

const out = { width: W, height: H, rest, neighbours, bd, bdBox: [x0, y0, x1 - x0, y1 - y0].map((v) => Math.round(v * 10) / 10), dhaka };
await writeFile(path.join(root, 'public/assets/world-map.json'), JSON.stringify(out));
console.log(`world-map.json: ${(JSON.stringify(out).length / 1024).toFixed(0)} KB, Bangladesh box ${out.bdBox.join(', ')}, Dhaka ${dhaka}`);
