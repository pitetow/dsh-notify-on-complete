#!/usr/bin/env node
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
// Post-build: tsc drops the file-header comment when a file's first import is
// type-only (the elided import takes the leading trivia with it), so
// re-insert the attribution header into every emitted lib file. Idempotent:
// files that already carry the SPDX marker are left untouched.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = '/**\n * Copyright (c) 2026 Luozy\n * SPDX-License-Identifier: MIT\n */\n'
const libDir = fileURLToPath(new URL('../lib/', import.meta.url))

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(p)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      const src = readFileSync(p, 'utf8')
      if (src.includes('SPDX-License-Identifier: MIT')) continue
      writeFileSync(p, HEADER + src)
    }
  }
}

walk(libDir)
console.log('[add-header] attribution header ensured in lib/')
