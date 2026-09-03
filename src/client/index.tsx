/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * dsh-notify-on-complete client half.
 *
 * Registers the plugin's settings card into the Plugins settings section
 * (设置 → 插件 → 配置) and renders the staged form over the plugin's config:
 * enable switch, title, sound toggle, per-tier sound selectors, quiet hours,
 * and the blocking/approval switches. Data rides the plugin's own JSON route
 * (`/notify-on-complete/api/config`) — the harness's settings API serves only
 * an explicit allowlist of namespaces to the browser, so the settings scope is
 * not a viable read/write channel for a third-party namespace. The bundle
 * itself is a module-table consumer (react only — resolved by the shell at
 * runtime, never inlined).
 * @module dsh-notify-on-complete/client
 */

import { createElement } from 'react'
import { NotifyCard, type NotifyCardProps } from './NotifyCard.js'
import { NotifyConfigStore } from './config-store.js'
import { NotifyCardController } from './notify-settings.js'
import { NOTIFY_CSS } from './styles.js'

export const name = 'dsh-notify-on-complete'

/**
 * Keyed-slot key for the settings card: the settings namespace this card
 * edits, mirroring the host side's `NOTIFY_SETTINGS_NAMESPACE` (src/settings.ts)
 * and `NOTIFY_NS` (src/api.ts). The configurable-plugins tab dispatches a
 * card only when its key names a served namespace, and a keyed registration
 * without `key` fails the plugin load, so the two must never drift.
 */
const SETTINGS_NAMESPACE = 'notify-on-complete'

/** Required services (cordis fiber inject): only the slots registry. */
export const inject = ['slots']

/** Minimal client slots face. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    /** Keyed slots dispatch by key: the settings namespace the card edits. */
    key: string
    order?: number
    label?: string | (() => string)
    inject?: () => unknown
  }, render: (props: unknown) => unknown): () => void
}

/** Minimal client context face. */
interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsService
}

let stylesInjected = false

/** Inject the card styles once per page; idempotent across re-activation. */
function ensureStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  if (document.getElementById('dsh-notify-on-complete-css') !== null) return
  const element = document.createElement('style')
  element.id = 'dsh-notify-on-complete-css'
  element.textContent = NOTIFY_CSS
  document.head.appendChild(element)
}

/**
 * Client plugin body.
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ensureStyles()
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  // Read config through the plugin's JSON route; the store re-reads after
  // every write, and the card renders nothing until the first read lands.
  const store = new NotifyConfigStore()
  const controller = new NotifyCardController(store)
  void store.load()
  ctx.effect(
    () => slots.inject('settings.plugin.item', () => slots.register(
      { name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, order: 30, inject: () => controller.inject() },
      (props) => createElement(NotifyCard, props as NotifyCardProps),
    )),
    'dsh-notify-on-complete: settings card',
  )
}
