// Phosphor icons (MIT — @phosphor-icons/core) for videos: 1,500+ consistent glyphs in six weights, so scenes
// never need hand-drawn clip art. The SVGs come from the shared packages via /vendor (local, works offline in
// renders). Use in an async scene:  const svg = await phosphor('rocket-launch', 'bold');
//   → '<svg class="ico" …>' sized by font-size (1em) and coloured by `color` (fill="currentColor").

export const PHOSPHOR_WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'];
const cache = new Map();

export const phosphorUrl = (name, weight = 'regular') =>
  `vendor/@phosphor-icons/core/assets/${weight}/${name}${weight === 'regular' ? '' : `-${weight}`}.svg`;

/** Inline SVG markup for a Phosphor icon. Throws (and the page shows the error) for an unknown name or weight. */
export async function phosphor(name, weight = 'regular', { cls = 'ico' } = {}) {
  if (!PHOSPHOR_WEIGHTS.includes(weight)) throw new Error(`phosphor("${name}", "${weight}"): weight must be one of ${PHOSPHOR_WEIGHTS.join(', ')}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`phosphor("${name}"): icon names are kebab-case, e.g. "rocket-launch"`);
  const key = `${weight}/${name}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(phosphorUrl(name, weight)).then((r) => {
      if (!r.ok) throw new Error(`Phosphor icon "${name}" (${weight}) does not exist. Names are kebab-case like "rocket-launch", "chart-line-up", "users-three" — see phosphoricons.com`);
      return r.text();
    }));
  }
  const svg = await cache.get(key);
  return svg.replace('<svg ', `<svg class="${cls}" aria-hidden="true" `);
}
