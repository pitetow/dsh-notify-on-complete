/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import {
  NotifyCardController,
  deepEqualJson,
  formatQuietHours,
  parseQuietHours,
  type NotifySection,
  type SettingsScopeLike,
} from '../src/client/notify-settings.js'

/** A fake settings scope with in-memory set/unset, publishing on every write. */
function fakeScope(initial: {
  value?: NotifySection
  base?: NotifySection
  user?: Record<string, unknown>
  writable?: boolean
}): SettingsScopeLike<NotifySection> & { writes: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }> } {
  let snapshot = {
    status: 'ready' as const,
    value: initial.value,
    base: initial.base,
    user: initial.user,
    writable: initial.writable ?? true,
  }
  const listeners = new Set<() => void>()
  const writes: Array<{ op: 'set' | 'unset'; field: string; value?: unknown }> = []
  const publish = (): void => { for (const listener of [...listeners]) listener() }
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field, value) => {
      writes.push({ op: 'set', field, value })
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, [field]: value },
        user: { ...(snapshot.user ?? {}), [field]: value },
      }
      publish()
    },
    unset: async (field) => {
      writes.push({ op: 'unset', field })
      const { [field]: _removed, ...user } = snapshot.user ?? {}
      const { [field]: _value, ...value } = snapshot.value ?? {}
      snapshot = { ...snapshot, user, value }
      publish()
    },
  }
}

describe('parseQuietHours / formatQuietHours', () => {
  it('parses comma-separated ranges, trimming and dropping empty parts', () => {
    expect(parseQuietHours('22:00-08:00, 09:00-10:00 , , 11:00-12:00')).toEqual([
      '22:00-08:00', '09:00-10:00', '11:00-12:00',
    ])
  })

  it('returns undefined (clear) for an empty draft', () => {
    expect(parseQuietHours('')).toBeUndefined()
    expect(parseQuietHours('   ')).toBeUndefined()
  })

  it('formats a stored array back into a comma-joined draft', () => {
    expect(formatQuietHours(['22:00-08:00', '09:00-10:00'])).toBe('22:00-08:00, 09:00-10:00')
    expect(formatQuietHours(undefined)).toBe('')
  })
})

describe('deepEqualJson', () => {
  it('compares primitives, arrays, and nested objects structurally', () => {
    expect(deepEqualJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqualJson({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqualJson([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqualJson(null, null)).toBe(true)
    expect(deepEqualJson({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('NotifyCardController', () => {
  it('renders resolved values and overridden flags from the scope', () => {
    const scope = fakeScope({
      base: { sound: true },
      value: { enabled: true, sound: false, sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' }, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
      user: { sound: false },
    })
    const form = new NotifyCardController(scope)
    const snapshot = form.getSnapshot()
    expect(snapshot.shell.available).toBe(true)
    expect(snapshot.shell.dirty).toBe(false)
    expect(snapshot.sound.value).toBe(false)
    expect(snapshot.sound.overridden).toBe(true)
    expect(snapshot.enabled.value).toBe(true)
    expect(snapshot.enabled.overridden).toBe(false)
    expect(snapshot.quietHours.value).toBe('')
  })

  it('is unavailable while the namespace is not served', () => {
    const scope = fakeScope({})
    scope.getSnapshot = () => ({ status: 'unavailable' as const, value: undefined, base: undefined, user: undefined, writable: false })
    const form = new NotifyCardController(scope)
    expect(form.getSnapshot().shell.available).toBe(false)
  })

  it('stages a set, marks it overridden, and writes it on save', async () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' }, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    form.stage('sound', false)
    expect(form.getSnapshot().shell.dirty).toBe(true)
    expect(form.getSnapshot().sound.value).toBe(false)
    expect(form.getSnapshot().sound.overridden).toBe(true)
    await form.save()
    expect(scope.writes).toEqual([{ op: 'set', field: 'sound', value: false }])
    expect(form.getSnapshot().shell.dirty).toBe(false)
  })

  it('unstages an edit that equals the current section value', () => {
    const scope = fakeScope({
      value: { enabled: true, sound: false, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    form.stage('sound', false)
    expect(form.getSnapshot().shell.dirty).toBe(false)
    expect(form.getSnapshot().sound.overridden).toBe(false)
  })

  it('stages a clear (reset) and unsets the user layer on save', async () => {
    const scope = fakeScope({
      base: { sound: true },
      value: { enabled: true, sound: false, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
      user: { sound: false },
    })
    const form = new NotifyCardController(scope)
    form.reset('sound')
    const snapshot = form.getSnapshot()
    expect(snapshot.shell.dirty).toBe(true)
    expect(snapshot.sound.value).toBe(true) // falls back to the base layer
    expect(snapshot.sound.overridden).toBe(false)
    await form.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'sound' }])
  })

  it('writes the nested sounds object as one field', async () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' }, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    const snapshot = form.getSnapshot()
    form.stage('sounds', { ...{ completed: snapshot.sounds.completed.value, error: snapshot.sounds.error.value, approval: snapshot.sounds.approval.value }, completed: 'Funk' })
    await form.save()
    expect(scope.writes).toEqual([{ op: 'set', field: 'sounds', value: { completed: 'Funk', error: 'Sosumi', approval: 'Ping' } }])
  })

  it('parses the quiet-hours draft into the stored array on save', async () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    form.stage('quietHours', '22:00-08:00, 09:00-10:00')
    await form.save()
    expect(scope.writes).toEqual([{ op: 'set', field: 'quietHours', value: ['22:00-08:00', '09:00-10:00'] }])
  })

  it('clears quietHours when the draft is empty', async () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: ['22:00-08:00'] },
      user: { quietHours: ['22:00-08:00'] },
    })
    const form = new NotifyCardController(scope)
    form.stage('quietHours', '')
    await form.save()
    expect(scope.writes).toEqual([{ op: 'unset', field: 'quietHours' }])
  })

  it('discard drops every staged edit', () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    form.stage('sound', false)
    form.stage('enabled', false)
    expect(form.getSnapshot().shell.dirty).toBe(true)
    form.discard()
    expect(form.getSnapshot().shell.dirty).toBe(false)
    expect(form.getSnapshot().sound.value).toBe(true)
    expect(form.getSnapshot().enabled.value).toBe(true)
  })

  it('keeps the snapshot reference stable until something changes', () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    const form = new NotifyCardController(scope)
    const first = form.getSnapshot()
    // The selector hook the card binds compares with Object.is, so repeated
    // reads must return the identical reference while nothing changed.
    expect(form.getSnapshot()).toBe(first)
    form.stage('sound', false)
    expect(form.getSnapshot()).not.toBe(first)
    expect(form.getSnapshot().sound.value).toBe(false)
  })

  it('keeps drafts and reports failed when a write does not land', async () => {
    const scope = fakeScope({
      value: { enabled: true, sound: true, sounds: {}, onBlocked: true, onQuestion: true, onApproval: true, title: 'DeepSeek Harness', quietHours: [] },
    })
    scope.set = async () => { throw new Error('write refused') }
    const form = new NotifyCardController(scope)
    form.stage('sound', false)
    await form.save()
    const snapshot = form.getSnapshot()
    expect(snapshot.shell.failed).toBe(true)
    expect(snapshot.shell.dirty).toBe(true) // drafts kept for correction
    expect(snapshot.sound.value).toBe(false)
  })
})
