// "Quick video": records the live preview in the student's own browser — no server, no render time used.
// The browser asks to share THIS tab (with its audio); the capture is cropped to the video stage (Region
// Capture), the preview plays once from 0, and MediaRecorder saves it (MP4 where Chrome supports it, else WebM).
// Real time: a slow computer can drop frames, so it's a draft — final videos still come from Render.
// Desktop Chrome / Edge only (Region Capture + preferCurrentTab).

type CropTargetCtor = { fromElement(el: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

export function quickVideoSupport(): { ok: true } | { ok: false; reason: string } {
  const w = window as unknown as { CropTarget?: CropTargetCtor };
  if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'This browser can’t record the screen. Use Chrome or Edge on a computer.' };
  if (!w.CropTarget || typeof MediaRecorder === 'undefined') return { ok: false, reason: 'Quick video needs Chrome or Edge on a computer (it isn’t available on phones or in this browser).' };
  return { ok: true };
}

const MIME = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const pickMime = () => MIME.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

/** Asks to share this tab and crops it to `stage`. Must be called from a click. */
export async function captureStage(stage: HTMLElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: true,
    // Chrome: offer this tab first and include its audio
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
  } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
  const CT = (window as unknown as { CropTarget: CropTargetCtor }).CropTarget;
  try {
    if (!track?.cropTo) throw new Error('crop');
    await track.cropTo(await CT.fromElement(stage));
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Please choose “This tab” in the sharing dialog (with “Also share tab audio” on).');
  }
  return stream;
}

/** Records `stream` until `done()` resolves; returns the file. */
export async function record(stream: MediaStream, done: Promise<void>, opts: { bitrate?: number } = {}): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: opts.bitrate ?? 8_000_000, audioBitsPerSecond: 160_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(1000);
  try {
    await done;
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
  }
  const type = rec.mimeType || mimeType || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
