export const APP_NAME = 'Luma Studio';

/** Project aspect ratios -> stage size (see plan.md Phase 1). */
export const ASPECTS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const BRAND = {
  blue: '#2970EC',
  sky: '#5DAEFF',
  royal: '#1557D1',
  deep: '#07358F',
  offWhite: '#EFF5FF',
  white: '#FFFFFF',
} as const;
