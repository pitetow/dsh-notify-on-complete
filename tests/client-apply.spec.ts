/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
// Client entry apply: the settings card registers into the keyed
// `settings.plugin.item` slot under its settings namespace. The platform's
// configurable-plugins tab dispatches cards by key, and the slot registry
// rejects a keyless keyed registration at load, so the key this spec locks
// is the plugin-load contract — not just a rendering detail.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

type ClientContext = Parameters<typeof apply>[0]

interface RegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  inject?: () => unknown
}

/** A minimal slots/context fake capturing one register call. */
function harness(): { ctx: ClientContext; registered: RegisterOptions[] } {
  const registered: RegisterOptions[] = []
  const slots = {
    inject: (_key: string, register: () => () => void) => register(),
    register: (options: RegisterOptions) => {
      registered.push(options)
      return () => {}
    },
  }
  return {
    ctx: {
      get: () => slots,
      effect: (callback: () => void | (() => void)) => { callback() },
    },
    registered,
  }
}

describe('client entry apply', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('registers the settings card keyed by its settings namespace', () => {
    // The card's config read fires at apply time; no JSON route exists here.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no route in unit env'))))
    const { ctx, registered } = harness()
    apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'settings.plugin.item',
      // Must equal the host-registered namespace (settingsNamespace('notify-on-complete')).
      key: 'notify-on-complete',
      order: 30,
    })
    // `id` names list-slot entries; keyed slots dispatch by `key` instead.
    expect(registered[0].id).toBeUndefined()
  })
})
