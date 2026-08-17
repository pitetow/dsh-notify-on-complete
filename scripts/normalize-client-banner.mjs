#!/usr/bin/env node
/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Wrap the tsdown CJS output with the browser module loader preamble:
 *
 *   window.__ModuleLoader__.load({ id: "<name>", factory: (require) => {
 *     var module = { exports: {} };
 *     var exports = module.exports;
 *     Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
 *     ...rolldown CJS body...
 *     return module.exports;
 *   }});
 *
 * The shape mirrors the shipped bundles of installed plugins (dshmarket,
 * dsh-better-sidebar): the factory closes over `require`, which the module
 * loader resolves against the shell's module table (react and the dsh-client
 * packages stay external). Reads `lib/client.cjs`, writes `lib/client.js`,
 * and removes the intermediate files. Idempotent for a single invocation.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = resolve(root, 'lib/client.cjs')
const output = resolve(root, 'lib/client.js')
const pkgName = 'dsh-notify-on-complete'

const body = readFileSync(input, 'utf8')
if (body.includes('window.__ModuleLoader__.load')) {
  // Already normalized; do not double-wrap (a re-run after a partial write).
  console.log('normalize-client-banner: already wrapped, skipping')
  process.exit(0)
}

const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "' + pkgName + '",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  body.replace(/\/\/# sourceMappingURL=.*$/m, ''),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, wrapped)
for (const extra of ['lib/client.cjs', 'lib/client.cjs.map', 'lib/client.d.cts', 'lib/style.css']) {
  rmSync(resolve(root, extra), { force: true })
}
console.log(`normalize-client-banner: wrote ${output}`)
