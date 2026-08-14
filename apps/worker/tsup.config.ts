import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Pachetele din workspace se bundluiesc; dependintele externe raman externe.
  noExternal: [/^@damina\//],
});
