import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', admin: 'src/cli/admin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // the workspace package ships TypeScript source, so bundle it
  noExternal: ['@luma/shared'],
});
