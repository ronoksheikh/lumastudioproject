import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    hcaptcha?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

let loading: Promise<void> | null = null;
const loadScript = () =>
  (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('captcha script blocked'));
    document.head.appendChild(s);
  }));

/** hCaptcha “I am human” box; only rendered when the server has it configured. */
export function Captcha({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !box.current || !window.hcaptcha || box.current.childElementCount) return;
      window.hcaptcha.render(box.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') });
    }).catch(() => onToken(''));
    return () => {
      cancelled = true;
    };
  }, [siteKey, onToken]);
  return <div ref={box} className="min-h-[78px]" aria-label="Human check" />;
}
