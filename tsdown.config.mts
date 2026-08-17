/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'tsdown'

/**
 * Client-half bundle: built by tsdown into `lib/client.cjs` as a CJS factory,
 * then renamed and wrapped by scripts/normalize-client-banner.mjs with the
 * browser module loader preamble (`window.__ModuleLoader__.load({ id, factory })`).
 * The only externals are the loader module table's own entries: react and the
 * jsx runtime resolve at runtime through the table, never inline.
 */
export default defineConfig({
  entry: { 'client': 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [
      'react',
      'react-dom',
      'react/jsx-runtime',
    ],
  },
})
