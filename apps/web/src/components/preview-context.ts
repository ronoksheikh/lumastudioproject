import { createContext, useContext } from 'react';

export interface PreviewCtx {
  /** signed URL of the preview origin ending in "/" (null until fetched) */
  base: string | null;
  reloadKey: number;
  reload(): void;
  projectId: string;
}
export const PreviewContext = createContext<PreviewCtx>({ base: null, reloadKey: 0, reload() {}, projectId: '' });
export const usePreview = () => useContext(PreviewContext);
