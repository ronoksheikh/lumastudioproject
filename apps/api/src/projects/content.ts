// What a project contains so far. New projects start empty (no scenes, script or voice); the UI and the
// tools that need a playable video use this to show a friendly empty state / a clear error.
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectContent {
  /** public/js/scenes/index.js exists */
  scenes: boolean;
  /** script.json exists */
  script: boolean;
  /** public/audio/timing.json exists */
  voice: boolean;
}

export function projectContent(dir: string): ProjectContent {
  const has = (rel: string) => fs.existsSync(path.join(dir, rel));
  return { scenes: has('public/js/scenes/index.js'), script: has('script.json'), voice: has('public/audio/timing.json') };
}

/** Why the video cannot be played/previewed/rendered yet, or null. (Same wording as template/scripts/lib/common.mjs.) */
export function notPlayableReason(dir: string): string | null {
  const c = projectContent(dir);
  if (!c.scenes) {
    return 'This project has no scenes yet (public/js/scenes/index.js does not exist). Write script.json, generate the voice, then create the scene files and public/js/scenes/index.js — see read_guide("engine").';
  }
  if (!c.voice) return 'This project has no voice timing yet (public/audio/timing.json is missing). Generate the voice first (generate_voice; placeholder:true works without a key).';
  return null;
}
