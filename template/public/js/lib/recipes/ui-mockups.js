// Fake UI chrome for "this is how it's made" moments: an IDE/editor window, a video player, a channel row.
import { icons } from '../core.js';

const esc = (s) => s.replace(/</g, '&lt;');

/**
 * IDE window: code on the left, a preview + prompt on the right.
 * lines: [['c' | 'k', text], …] (c = comment, k = code). Position/size via your own class (default is 1600×780 at 160,180).
 */
export function ideWindow({ title = 'project — scene.js', lines = [], prompt = '', badge = 'PREVIEW', cls = '' }) {
  return `
    <div class="rc-ide ${cls}">
      <div class="rc-ide-bar"><i></i><i></i><i></i><span class="mono">${title}</span></div>
      <div class="rc-ide-body">
        <div class="rc-code mono">${lines.map(([k, l], i) => `<div class="ln ${k}"><em>${i + 1}</em><span>${esc(l)}</span></div>`).join('')}</div>
        <div class="rc-preview">
          <div class="rc-pv-screen"><span class="rc-pv-badge mono">${badge}</span></div>
          <div class="rc-prompt"><span class="sp">${icons.spark}</span><span class="en">${esc(prompt)}</span></div>
        </div>
      </div>
    </div>`;
}

/** Types the code lines in, one after another (call after ctx.add). */
export function animateIde(ctx, root, { at, stagger = 0.07 }) {
  const lines = ctx.qa(root, '.ln');
  ctx.tl.fromTo(lines, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.15, stagger }, at + 0.1);
  ctx.tl.fromTo(ctx.q(root, '.rc-prompt'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 }, at + 0.25);
  for (let i = 0; i < lines.length; i += 2) ctx.cue(at + 0.1 + i * stagger, 'tick', 0.4);
}

/** Video player: `screen` is inner HTML (stack `.rc-mtg` layers to cut between them). */
export function videoPlayer({ screen = '', time = '12:48', cls = '' } = {}) {
  return `
    <div class="rc-player ${cls}">
      <div class="rc-screen">${screen}</div>
      <div class="rc-ctrl"><span class="pp">${icons.play}</span><div class="prog"><i></i></div><span class="mono">${time}</span></div>
    </div>`;
}

/** Channel row under a player: avatar, name, stats, subscribe button. */
export function channelRow({ name = 'My Channel', stats = '', cta = 'Subscribe', cls = '' } = {}) {
  return `
    <div class="rc-channel ${cls}">
      <span class="rc-ch-av">${icons.play}</span>
      <div><b class="en">${name}</b><span class="mono">${stats}</span></div>
      <div class="rc-ch-sub en">${cta}</div>
    </div>`;
}
