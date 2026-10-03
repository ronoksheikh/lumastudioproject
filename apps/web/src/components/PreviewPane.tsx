import { Button, Spinner, Tooltip, toast } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Icon } from './Icon';
import { usePreview } from './preview-context';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function PreviewPane({ aspect }: { aspect: '16:9' | '9:16' }) {
  const { base, reloadKey, reload, projectId } = usePreview();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ t: 0, playing: false, duration: 0 });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const portrait = aspect === '9:16';

  const send = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ source: 'luma-studio', ...msg }, '*');

  useEffect(() => {
    setPhase('loading');
    setError('');
  }, [base, reloadKey]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.source !== 'luma-preview' || e.source !== frame.current?.contentWindow) return;
      if (m.type === 'ready') {
        setPhase('ready');
        setState((s) => ({ ...s, duration: m.duration }));
      } else if (m.type === 'error') {
        setPhase('error');
        setError(String(m.message));
      } else if (m.type === 'state') setState({ t: m.t, playing: m.playing, duration: m.duration });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ask the page for its clock while it is ready (cheap: one tiny message every 250 ms)
  useEffect(() => {
    if (phase !== 'ready') return;
    const id = setInterval(() => send({ type: 'state' }), 250);
    return () => clearInterval(id);
  }, [phase, base, reloadKey]);

  const toggle = () => send({ type: state.playing ? 'pause' : 'play' });
  const seek = (t: number) => {
    send({ type: 'seek', t });
    setState((s) => ({ ...s, t, playing: false }));
  };
  const capture = async () => {
    setCapturing(true);
    try {
      const { url } = await api.captureFrame(projectId, state.t);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frame-${state.t.toFixed(2)}s.png`;
      a.click();
    } catch (e) {
      toast.danger(e instanceof ApiError ? e.message : 'Could not capture the frame');
    } finally {
      setCapturing(false);
    }
  };

  const shown = scrub ?? state.t;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div ref={box} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-xl bg-[#eff5ff]">
        <div className={`relative max-h-full max-w-full overflow-hidden rounded-lg shadow-lg ${portrait ? 'aspect-[9/16] h-full' : 'aspect-video w-full'}`}>
          {base ? (
            <iframe
              ref={frame}
              key={`${base}-${reloadKey}`}
              title="Video preview"
              src={`${base}?v=${reloadKey}`}
              className="absolute inset-0 h-full w-full border-0 bg-[#2970ec]"
              allow="autoplay; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              onLoad={() => setPhase((p) => (p === 'loading' ? 'ready' : p))}
            />
          ) : (
            <div className="grid h-full place-items-center bg-[#2970ec]"><Spinner color="current" /></div>
          )}
          {phase === 'loading' && base && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#2970ec]/70"><Spinner color="current" /></div>}
        </div>
        {phase === 'error' && (
          <div role="alert" className="absolute inset-x-3 bottom-3 max-h-40 overflow-auto rounded-lg border border-[#f3c5c5] bg-[#fdf2f2] p-3 text-sm text-[#7f1d1d]">
            <b>The video can’t be played yet.</b> {error ? <span className="mono block whitespace-pre-wrap text-xs">{error.slice(0, 600)}</span> : null}
            <span className="mt-1 block text-xs">Ask Luma to fix it — it can see this error.</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2" role="toolbar" aria-label="Preview controls">
        <Button isIconOnly size="sm" variant="primary" className="flex-none" onPress={toggle} aria-label={state.playing ? 'Pause' : 'Play'} isDisabled={phase !== 'ready'}>
          <Icon name={state.playing ? 'pause' : 'play'} size={14} />
        </Button>
        <span className="mono hidden w-12 flex-none text-xs text-[#5b6b8f] min-[420px]:block" aria-hidden="true">{fmt(shown)}</span>
        <input
          type="range" min={0} max={Math.max(state.duration, 0.1)} step={0.05} value={Math.min(shown, state.duration || 0)}
          aria-label="Seek" disabled={phase !== 'ready'}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => { if (scrub != null) seek(scrub); setScrub(null); }}
          onKeyUp={() => { if (scrub != null) seek(scrub); setScrub(null); }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#2970ec]"
        />
        <span className="mono hidden w-12 flex-none text-right text-xs text-[#5b6b8f] min-[420px]:block" aria-hidden="true">{fmt(state.duration)}</span>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={reload} aria-label="Reload preview"><Icon name="refresh" size={15} /></Button></Tooltip.Trigger><Tooltip.Content>Reload</Tooltip.Content></Tooltip>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={() => void capture()} isDisabled={phase !== 'ready' || capturing} aria-label="Capture this frame as PNG">{capturing ? <Spinner size="sm" /> : <Icon name="camera" size={15} />}</Button></Tooltip.Trigger><Tooltip.Content>Capture frame (PNG)</Tooltip.Content></Tooltip>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={() => void box.current?.requestFullscreen?.()} aria-label="Full screen"><Icon name="maximize" size={15} /></Button></Tooltip.Trigger><Tooltip.Content>Full screen</Tooltip.Content></Tooltip>
      </div>
    </div>
  );
}
