import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.dirname(new URL(import.meta.url).pathname);

const config: NextConfig = {
  output: 'standalone',
  // sqlite-vec loads a platform-specific native extension at runtime
  serverExternalPackages: ['sqlite-vec'],
  // Pin the app root so a lockfile in a parent directory is never picked up
  outputFileTracingRoot: root,
  // The database is mounted at runtime; never bake a local copy into the image
  outputFileTracingExcludes: { '/*': ['./data/**/*', './.env*'] },
  // sqlite-vec picks its platform package (sqlite-vec-linux-x64, ...) at runtime, which tracing can't see
  outputFileTracingIncludes: { '/*': ['./node_modules/sqlite-vec-*/**/*'] },
  turbopack: { root },
  poweredByHeader: false,
  // Next writes AGENTS.md on dev start; we keep our own docs
  agentRules: false,
};

export default config;
