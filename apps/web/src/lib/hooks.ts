import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, setCsrf } from '../api/client';

export function useMe() {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const r = await api.me();
      setCsrf(r.csrfToken ?? '');
      return r;
    },
    staleTime: Infinity,
  });
  return q;
}

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.projects().then((r) => r.projects) });
export const useProject = (id: string) => useQuery({ queryKey: ['project', id], queryFn: () => api.project(id).then((r) => r.project) });
export const useModels = () => useQuery({ queryKey: ['models'], queryFn: () => api.models().then((r) => r.models) });
export const useVoice = () => useQuery({ queryKey: ['voice'], queryFn: () => api.voice() });

/** Invalidate a query key when `signal` changes (used to refresh files/history after the agent works). */
export function useInvalidateOn(keys: unknown[][], signal: unknown) {
  const qc = useQueryClient();
  useEffect(() => {
    for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
