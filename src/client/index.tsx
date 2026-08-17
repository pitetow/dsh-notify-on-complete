/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * dsh-notify-on-complete client half.
 *
 * Registers the plugin's settings card into the Plugins settings section
 * (设置 → 插件 → 配置) and renders the staged form over the
 * `notify-on-complete` settings namespace: enable switch, title, sound toggle,
 * per-tier sound selectors, quiet hours, and the blocking/approval switches.
 * All data rides the settings scope bound to the host-registered namespace;
 * the bundle itself is a module-table consumer (react only — resolved by the
 * shell at runtime, never inlined).
 * @module dsh-notify-on-complete/client
 */

import { createElement } from 'react'
import { NotifyCard, type NotifyCardProps } from './NotifyCard.js'
import { NotifyCardController, type SettingsScopeLike } from './notify-settings.js'
import { NOTIFY_CSS } from './styles.js'

export const name = 'dsh-notify-on-complete'

/** Required services (cordis fiber inject): the settings scope, slots, and the scope transport. */
export const inject = ['slots', 'settingsScope', 'connection', 'remote']

/** Minimal client slots face. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    id?: string
    order?: number
    label?: string | (() => string)
    inject?: () => unknown
  }, render: (props: unknown) => unknown): () => void
}

/** Minimal client context face. */
interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  settingsScope: { bind<T>(spec: { namespace: string }): SettingsScopeLike<T> }
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
  // Bind the settings scope on this fiber: the binding registers its own
  // teardown, so the card only lives while this plugin is mounted.
  const scope = ctx.settingsScope.bind<Record<string, unknown>>({ namespace: 'notify-on-complete' })
  const controller = new NotifyCardController(scope)
  ctx.effect(
    () => slots.inject('settings.plugin.item', () => slots.register(
      { name: 'settings.plugin.item', id: 'notify-on-complete', order: 30, inject: () => controller.inject() },
      (props) => createElement(NotifyCard, props as NotifyCardProps),
    )),
    'dsh-notify-on-complete: settings card',
  )
}
