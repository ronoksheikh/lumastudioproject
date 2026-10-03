// Small shared helpers. Pure functions + DOM builders — no timeline state in here.

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const BENGALI = /[ঀ-৿]/;

/** 12 → '১২' */
export const bnNum = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[d]);

/** 12345 → '12,345' (Latin digits) */
export const withCommas = (n) => Math.round(n).toLocaleString('en-US');

/** Builds one element from an HTML string. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * Wraps every WORD of an element in a masked span pair (.w > .wi) and returns the inner spans.
 * Safe for Bengali: it never breaks a word, so conjuncts and vowel signs stay intact.
 */
export function splitWords(node) {
  const words = node.textContent.trim().split(/\s+/);
  node.innerHTML = words.map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');
  return [...node.querySelectorAll('.wi')];
}

/** Per-character split. LATIN TEXT ONLY — Bengali conjuncts and vowel signs break when split. */
export function splitChars(node) {
  const text = node.textContent;
  if (BENGALI.test(text)) throw new Error('splitChars() is for Latin text only — use splitWords() for Bengali.');
  node.innerHTML = [...text].map((c) => (c === ' ' ? ' ' : `<span class="c">${c}</span>`)).join('');
  return [...node.querySelectorAll('.c')];
}

/** Deterministic pseudo-random in [0,1): same (i, k) → same value, always. Never use Math.random(). */
export const rand = (i, k = 1) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, k) => a + (b - a) * k;

export const q = (node, sel) => node.querySelector(sel);
export const qa = (node, sel) => [...node.querySelectorAll(sel)];

/** Inline SVG icons (use `currentColor`; size with font-size). */
export const icons = {
  arrow: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" class="ico"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ico"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 1.5c.6 4.9 2.6 8.2 10.5 10.5C14.6 14.3 12.6 17.6 12 22.5 11.4 17.6 9.4 14.3 1.5 12 9.4 9.7 11.4 6.4 12 1.5Z" fill="currentColor"/></svg>',
  person: '<svg viewBox="0 0 48 48" class="ico"><circle cx="24" cy="14" r="8" fill="currentColor"/><path d="M9 44c1.5-11 7.5-16 15-16s13.5 5 15 16z" fill="currentColor"/></svg>',
  clock: '<svg viewBox="0 0 48 48" class="ico"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="3.4"/><path class="hand" d="M24 24V12" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path class="hand2" d="M24 24h8" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 48 64" class="pin-svg"><path d="M24 2C12.4 2 3 11.2 3 22.6 3 38 24 62 24 62s21-24 21-39.4C45 11.2 35.6 2 24 2Z" fill="#fff"/><circle cx="24" cy="23" r="8.5" fill="#2970EC"/></svg>',
  camera: '<svg viewBox="0 0 48 48" class="ico"><rect x="4" y="12" width="28" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="3.4"/><path d="M32 21l12-7v20l-12-7z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/></svg>',
  brief: '<svg viewBox="0 0 48 48" class="ico"><rect x="5" y="14" width="38" height="27" rx="5" fill="none" stroke="currentColor" stroke-width="3.4"/><path d="M17 14v-3a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3M5 25h38" fill="none" stroke="currentColor" stroke-width="3.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lens: '<svg viewBox="0 0 48 48" class="ico"><circle cx="21" cy="21" r="13" fill="none" stroke="currentColor" stroke-width="3.6"/><path d="M31 31l11 11M21 15v12M15 21h12" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg>',
};
