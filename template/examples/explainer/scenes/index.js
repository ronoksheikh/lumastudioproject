// Scene list for the master timeline. Order = playback order. Each scene is
// `export default function scene(ctx) { … }` (async is fine) and builds its own DOM + tweens.
import { makeContext } from '../lib/timeline.js';
import hook from './00-hook.js';
import ten from './01-ten.js';
import mapScene from './02-map.js';
import graph from './03-graph.js';
import youtube from './04-youtube.js';
import paths from './05-paths.js';
import you from './06-you.js';
import forScene from './07-for.js';
import end from './08-end.js';

const SCENES = [hook, ten, mapScene, graph, youtube, paths, you, forScene, end];

export async function buildTimeline(args) {
  const ctx = makeContext(args);
  ctx.initWorld({ night: 1, jitter: 0.35, particles: 0.14 });
  for (const scene of SCENES) await scene(ctx);
  return ctx.finish();
}
