import { useEffect } from 'react';

/** Sets the browser tab title for the current page ("<page> · Luma Studio"); the server fills the rest of <head>. */
export function usePageTitle(page: string | null | undefined) {
  useEffect(() => {
    document.title = page ? `${page} · Luma Studio` : 'Luma Studio — AI motion graphics agent by Lumademy';
  }, [page]);
}
