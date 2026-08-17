/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { NotifyConfig } from './types.js'

/** Settings namespace for this plugin; the web settings panel renders its schema. */
export const NOTIFY_SETTINGS_NAMESPACE = settingsNamespace('notify-on-complete')

/** Declarative settings schema — the web settings panel renders a form from it. */
export const NotifySettingsSchema = Schema.object({
  enabled: Schema.boolean().default(true),
  title: Schema.string().default('DeepSeek Harness'),
  sound: Schema.boolean().default(true),
  sounds: Schema.object({
    completed: Schema.string().default('Glass'),
    error: Schema.string().default('Sosumi'),
    approval: Schema.string().default('Ping'),
  }),
  quietHours: Schema.array(Schema.string()).default([]),
  onBlocked: Schema.boolean().default(true),
  onQuestion: Schema.boolean().default(true),
  onApproval: Schema.boolean().default(true),
})

/**
 * Wire this plugin's settings namespace into the harness: while a settings
 * service exists, the web panel edits take precedence over the composition
 * entry config; without one, the entry config stands. The source thunk is
 * retained and re-read on every committed change, so panel edits apply live
 * without a restart.
 * @param ctx - the plugin context.
 * @param config - the composition entry config (cordis.patch.yml layer).
 * @param setCurrent - sink for the authoritative value; called on attach,
 * detach, and every committed change.
 */
export function installNotifySettings(ctx: Context, config: NotifyConfig, setCurrent: (value: NotifyConfig) => void): void {
  let source: () => NotifyConfig = () => config
  installSettingsSection(ctx, NOTIFY_SETTINGS_NAMESPACE, NotifySettingsSchema, config, {
    setSource: (current) => { source = current; setCurrent(current()) },
    onChange: () => { setCurrent(source()) },
  })
}
