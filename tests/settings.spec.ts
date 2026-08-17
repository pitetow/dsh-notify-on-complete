/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import { NotifySettingsSchema } from '../src/settings.js'

describe('NotifySettingsSchema', () => {
  it('resolves defaults for an empty document', () => {
    expect(NotifySettingsSchema({})).toEqual({
      enabled: true,
      title: 'DeepSeek Harness',
      sound: true,
      sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' },
      quietHours: [],
      onBlocked: true,
      onQuestion: true,
      onApproval: true,
    })
  })

  it('overlays user fields over the defaults', () => {
    expect(NotifySettingsSchema({ sound: false, quietHours: ['23:00-08:00'] })).toMatchObject({
      sound: false,
      quietHours: ['23:00-08:00'],
      title: 'DeepSeek Harness',
    })
  })

  it('rejects a non-boolean sound', () => {
    expect(() => NotifySettingsSchema({ sound: 1 as never })).toThrow()
  })
})
