/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Source imports use `.js` extensions (NodeNext output); tests resolve them to `.ts`.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
})
