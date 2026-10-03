// Number roll-ups and progress bars, driven by the timeline (no timers).

/** Rolls a number from `from` to `to`; `format(v)` turns the live value into text. */
export function countUp(ctx, node, { to, from = 0, at, dur = 0.8, ease = 'power3.out', format = (v) => String(Math.round(v)) }) {
  const o = { v: from };
  ctx.tl.fromTo(o, { v: from }, { v: to, duration: dur, ease, onUpdate: () => (node.textContent = format(o.v)) }, at);
  return o;
}

/** Ready-made formatters for countUp(). */
export const fmt = {
  /** 4.2 → '4.2M' */
  millions: (digits = 1) => (v) => v.toFixed(digits) + 'M',
  /** 128000 → '128,000' */
  thousands: (v) => Math.round(v).toLocaleString('en-US'),
};

/** Scales a bar-fill element (transform-origin: left) from `from` to `to` over [at, at+dur]. */
export function progressBar(ctx, fillNode, { at, dur, from = 0.1, to = 0.7, ease = 'none' }) {
  return ctx.tl.fromTo(fillNode, { scaleX: from }, { scaleX: to, duration: dur, ease }, at);
}
