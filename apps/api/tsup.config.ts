import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@boomerbuddy\//u],
  external: ['@electric-sql/pglite', 'dotenv', 'kysely', 'pg', 'tldts'],
});
