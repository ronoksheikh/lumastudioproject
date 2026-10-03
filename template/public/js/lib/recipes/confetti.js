// Deterministic confetti: a pool of bits driven purely by time. Use for celebrations, not for serious moments.
import { el, rand } from '../core.js';

const COLORS = ['#ffffff', '#5DAEFF', '#2970EC', '#BFE2FF', '#ffffff', '#1557D1'];

/** Creates the confetti layer once; returns burst(t, x, y, power). */
export function createConfetti(ctx, { count = 90, colors = COLORS } = {}) {
  const layer = el('<div class="rc-confetti"></div>');
  ctx.fxRoot.prepend(layer);
  const bits = Array.from({ length: count }, (_, i) => {
    const b = el(`<i style="background:${colors[i % colors.length]}"></i>`);
    layer.appendChild(b);
    return b;
  });
  const bursts = [];
  ctx.onFrame((t) => {
    const b = bursts.filter((x) => x.t <= t && t - x.t < 2.6).at(-1);
    bits.forEach((bit, i) => {
      if (!b) return (bit.style.opacity = 0);
      const dt = t - b.t;
      const a = rand(i, 1) * Math.PI * 2;
      const v = (500 + rand(i, 2) * 1100) * b.power;
      const x = b.x + Math.cos(a) * v * dt * Math.exp(-dt * 1.6);
      const y = b.y + Math.sin(a) * v * dt * Math.exp(-dt * 1.6) + 520 * dt * dt;
      bit.style.opacity = Math.max(0, 1 - dt / 2.6);
      bit.style.transform = `translate(${x}px, ${y}px) rotate(${dt * (300 + rand(i, 3) * 900)}deg) scale(${0.6 + rand(i, 4)})`;
    });
  });
  return (t, x = ctx.W / 2, y = ctx.H / 2, power = 1) => bursts.push({ t, x, y, power });
}
