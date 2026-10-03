import { createContext, useContext } from 'react';

export interface PreviewCtx {
  /** signed URL of the preview origin ending in "/" (null until fetched) */
  base: string | null;
  reloadKey: number;
  reload(): void;
  projectId: string;
  /** "Attach this frame": puts the moment (seconds) on the chat composer */
  attachFrame?(f: FrameChip): void;
}
/** A moment of the preview attached to the next chat message. */
export interface FrameChip {
  t: number;
  segment?: string | null;
}
export const PreviewContext = createContext<PreviewCtx>({ base: null, reloadKey: 0, reload() {}, projectId: '' });
export const usePreview = () => useContext(PreviewContext);
