import { defineConfig } from 'tsup';

// Build-time switch for the Skills server the CLI talks to by default.
// Set SKILLS_DEFAULT_REGISTRY when building to bake a server address into the
// binary, so end users need NO env var — a single `npx <url> install <skill>`
// just works. They can still override at runtime with SKILLS_REGISTRY.
//
//   SKILLS_DEFAULT_REGISTRY=http://35.165.188.177:3000 pnpm build   # AWS (now)
//   SKILLS_DEFAULT_REGISTRY=http://10.20.30.40:3000   pnpm build    # intranet (later)
//
// Use scripts/release-cli.sh to do build + pack + copy-to-public in one step.
const DEFAULT_REGISTRY = process.env.SKILLS_DEFAULT_REGISTRY ?? 'http://localhost:3000';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  shims: true,
  // Replace the exact token `process.env.SKILLS_DEFAULT_REGISTRY` in the source
  // with a string literal at build time. `process.env.SKILLS_REGISTRY` is left
  // untouched, so it stays a genuine runtime lookup on the user's machine.
  define: {
    'process.env.SKILLS_DEFAULT_REGISTRY': JSON.stringify(DEFAULT_REGISTRY),
  },
});
