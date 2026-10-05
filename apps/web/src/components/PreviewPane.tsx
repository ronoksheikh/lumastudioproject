import { Spinner, Tooltip, toast } from '@heroui/react';
import { Button } from './Button';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Icon } from './Icon';
import { usePreview } from './preview-context';
import { captureStage, download, quickVideoSupport, record } from '../lib/quick-video';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function EmptyState() {
  return (
    <div className="luma-gradient grid h-full place-items-center p-6 text-center text-white" data-testid="preview-empty">
      <div>
        <Icon name="spark" size={28} className="mx-auto mb-3 opacity-90" />
        <p className="text-lg font-semibold sm:text-xl">Nothing here yet</p>
        <p className="mt-1 text-sm text-white/85">Tell Luma what video you want — it appears here as it’s built.</p>
      </div>
    </div>
  );
}

export function PreviewPane({ aspect, empty = false }: { aspect: '16:9' | '9:16'; empty?: boolean }) {
  const { base, reloadKey, reload, projectId, attachFrame } = usePreview();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ t: number; playing: boolean; duration: number; segment?: string | null }>({ t: 0, playing: false, duration: 0 });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [error, setError] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState<null | 'starting' | 'recording'>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
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
      } else if (m.type === 'empty') {
        setPhase('empty');
      } else if (m.type === 'error') {
        setPhase('error');
        setError(String(m.message));
      } else if (m.type === 'state') setState({ t: m.t, playing: m.playing, duration: m.duration, segment: m.segment ?? null });
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

  /**
   * Quick video: record the preview in this browser (no server, no render time). The stage grows to fill the
   * window for a sharper recording, the tab capture is cropped to it, and the preview plays once from 0.
   */
  const quickVideo = async () => {
    const support = quickVideoSupport();
    if (!support.ok) return toast.danger(support.reason);
    if (!stage.current) return;
    if (stateRef.current.playing) send({ type: 'pause' });
    setRecording('starting');
    let stream: MediaStream;
    try {
      stream = await captureStage(stage.current);
    } catch (e) {
      setRecording(null);
      if ((e as Error).name !== 'NotAllowedError') toast.danger((e as Error).message);
      return;
    }
    let cancelled = false;
    try {
      seek(0);
      await new Promise((r) => setTimeout(r, 700)); // the enlarged stage and frame 0 settle
      setRecording('recording');
      const done = new Promise<void>((resolve) => {
        const started = Date.now();
        const finish = () => { clearInterval(id); window.removeEventListener('keydown', onKey); setTimeout(resolve, 400); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { cancelled = true; finish(); } };
        window.addEventListener('keydown', onKey);
        stream.getVideoTracks()[0]?.addEventListener('ended', () => { cancelled = true; finish(); }); // "Stop sharing"
        send({ type: 'play' });
        const id = setInterval(() => {
          const s = stateRef.current;
          const elapsed = (Date.now() - started) / 1000;
          const atEnd = s.duration > 0 && s.t >= s.duration - 0.05;
          if ((elapsed > 1.5 && (atEnd || !s.playing)) || elapsed > s.duration + 10) finish();
        }, 100);
      });
      const { blob, ext } = await record(stream, done);
      send({ type: 'pause' });
      if (cancelled) toast.info?.('Recording cancelled');
      else {
        download(blob, `luma-quick-video.${ext}`);
        toast.success(`Quick video saved (${(blob.size / 1e6).toFixed(1)} MB). For the final, frame-perfect MP4 use Render.`);
      }
    } catch (e) {
      toast.danger(`Recording failed: ${(e as Error).message}`);
    } finally {
      setRecording(null);
    }
  };

  const shown = scrub ?? state.t;
  const attach = () => {
    if (!attachFrame) return;
    if (state.playing) send({ type: 'pause' }); // the student points at THIS moment
    attachFrame({ t: Math.round(shown * 100) / 100, segment: scrub == null ? state.segment : null });
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div ref={box} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-xl bg-[#eff5ff]">
        {recording && (
          <div className="fixed inset-0 z-[90] bg-[#eff5ff]" aria-hidden="true">
            <p className="absolute left-1/2 top-2 z-[91] -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#1557d1] shadow">
              {recording === 'starting' ? 'Choose “This tab” and turn on “Also share tab audio”' : '● Recording — press Esc to stop'}
            </p>
          </div>
        )}
        <div
          ref={stage}
          className={recording
            ? `fixed inset-0 z-[95] m-auto overflow-hidden ${portrait ? 'aspect-[9/16] h-[min(100vh,calc(100vw*16/9))]' : 'aspect-video w-[min(100vw,calc(100vh*16/9))]'}`
            : `relative max-h-full max-w-full overflow-hidden rounded-lg shadow-lg ${portrait ? 'aspect-[9/16] h-full' : 'aspect-video w-full'}`}
        >
          {empty || phase === 'empty' ? (
            <EmptyState />
          ) : base ? (
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
          {phase === 'loading' && base && !empty && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#2970ec]/70"><Spinner color="current" /></div>}
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
        {attachFrame && (
          <Button size="sm" variant="secondary" className="flex-none" onPress={attach} isDisabled={phase !== 'ready'} aria-label="Attach this frame to the chat">
            <Icon name="target" size={14} /><span className="hidden sm:inline">Attach this frame</span>
          </Button>
        )}
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={reload} aria-label="Reload preview"><Icon name="refresh" size={15} /></Button></Tooltip.Trigger><Tooltip.Content>Reload</Tooltip.Content></Tooltip>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={() => void quickVideo()} isDisabled={phase !== 'ready' || !!recording} aria-label="Quick video: record the preview in your browser">{recording ? <Spinner size="sm" /> : <Icon name="film" size={15} />}</Button></Tooltip.Trigger><Tooltip.Content>Quick video — record in your browser (free, no render time)</Tooltip.Content></Tooltip>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={() => void capture()} isDisabled={phase !== 'ready' || capturing} aria-label="Capture this frame as PNG">{capturing ? <Spinner size="sm" /> : <Icon name="camera" size={15} />}</Button></Tooltip.Trigger><Tooltip.Content>Capture frame (PNG)</Tooltip.Content></Tooltip>
        <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="tertiary" className="flex-none" onPress={() => void box.current?.requestFullscreen?.()} aria-label="Full screen"><Icon name="maximize" size={15} /></Button></Tooltip.Trigger><Tooltip.Content>Full screen</Tooltip.Content></Tooltip>
      </div>
    </div>
  );
}
