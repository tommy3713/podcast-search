import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.dirname(new URL(import.meta.url).pathname);

const config: NextConfig = {
  output: 'standalone',
  // sqlite-vec loads a platform-specific native extension at runtime; subset-font reads
  // harfbuzzjs's wasm by require.resolve, which a bundled copy can't find
  serverExternalPackages: ['sqlite-vec', 'subset-font', 'harfbuzzjs'],
  // Pin the app root so a lockfile in a parent directory is never picked up
  outputFileTracingRoot: root,
  // The database is mounted at runtime; never bake a local copy into the image
  outputFileTracingExcludes: { '/*': ['./data/**/*', './.env*'] },
  // sqlite-vec picks its platform package (sqlite-vec-linux-x64, ...) at runtime, which tracing can't see
  // Whisper's vocabulary, read with fs by src/lib/whisper/tokens.ts (only /admin/whisper and its API)
  // The share images' fonts and the site's image they fall back to, read with fs by
  // src/lib/og/episode-image.tsx and src/app/ep/[no]/opengraph-image.tsx (fonts outside src: the worker copies src)
  outputFileTracingIncludes: {
    '/*': ['./node_modules/sqlite-vec-*/**/*', './src/lib/whisper/multilingual.tiktoken'],
    // Only the share image's route ('[no]' is a glob class there, so '*')
    '/ep/*/opengraph-image': ['./assets/og-fonts/*.otf', './src/app/opengraph-image.png', './node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'],
  },
  turbopack: { root },
  poweredByHeader: false,
  // Next writes AGENTS.md on dev start; we keep our own docs
  agentRules: false,
};

export default config;
