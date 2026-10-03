// Scene list for the master timeline. Order = playback order. Each scene is
// `export default function scene(ctx) { … }` (async is fine) and builds its own DOM + tweens.
// Add a scene: create NN-name.js here, import it below, add it to SCENES. See LUMA.md.
import { makeContext } from '../lib/timeline.js';
import title from './00-title.js';
import mapScene from './01-map.js';
import chart from './02-chart.js';
import outro from './03-outro.js';

const SCENES = [title, mapScene, chart, outro];

export async function buildTimeline(args) {
  const ctx = makeContext(args);
  ctx.initWorld({ night: 0, jitter: 0.35, particles: 0.14 }); // night: 0 = Lumademy blue stage
  for (const scene of SCENES) await scene(ctx);
  return ctx.finish();
}
