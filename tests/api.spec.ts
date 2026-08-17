/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from 'vitest'
import { createNotifyApiHandler } from '../src/api.js'
import type { SettingsDescriptor, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'

/** One descriptor the fake settings service serves. */
function descriptor(ns: string, overrides: Partial<SettingsDescriptor> = {}): SettingsDescriptor {
  return {
    ns,
    schema: { uid: 1, refs: {} },
    value: { enabled: true },
    revision: 0,
    applies: 'live',
    secrets: [],
    ...overrides,
  } as SettingsDescriptor
}

/** Fake settings service capturing describe/mutate calls. */
function fakeSettings(descriptors: SettingsDescriptor[]) {
  return {
    writable: true,
    describe: vi.fn(() => descriptors),
    mutate: vi.fn(async (_ns: string, ops: readonly SettingsPathOp[]) => { void ops }),
  } as unknown as SettingsProvider
}

/** Minimal ctx face the handler reads. */
function fakeCtx(settings: SettingsProvider | undefined) {
  return { get: (name: string) => (name === 'settings' ? settings : undefined) } as never
}

/** Capture writeHead/end calls. */
function fakeRes() {
  const calls: Array<{ status?: number; body?: string }> = []
  return {
    calls,
    writeHead(status: number) { calls.push({ status }) },
    end(body: string) { calls.push({ body }) },
  } as never
}

/** Build a fake IncomingMessage; a body makes it an async iterable of chunks. */
function fakeReq(method: string, url: string, body?: unknown) {
  const req: Record<string, unknown> = { method, url }
  if (body !== undefined) {
    const buffer = Buffer.from(JSON.stringify(body))
    req[Symbol.asyncIterator] = async function* () { yield buffer }
  }
  return req as never
}

function lastBody(res: { calls: Array<{ status?: number; body?: string }> }): { status: number; body: unknown } {
  const status = res.calls.find(call => call.status !== undefined)?.status ?? 0
  const body = res.calls.filter(call => call.body !== undefined).map(call => call.body).join('')
  return { status, body: JSON.parse(body || '{}') }
}

describe('createNotifyApiHandler', () => {
  it('serves the notify-on-complete config on GET', async () => {
    const settings = fakeSettings([
      descriptor('notify-on-complete', { value: { sound: false }, base: { sound: true }, user: { sound: false }, revision: 3 }),
      descriptor('shell'),
    ])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    const { status, body } = lastBody(res)
    expect(status).toBe(200)
    expect(body).toEqual({
      value: { sound: false },
      base: { sound: true },
      user: { sound: false },
      writable: true,
    })
    expect(settings.describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('404s when the namespace is not registered', async () => {
    const settings = fakeSettings([descriptor('shell')])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    const { status } = lastBody(res)
    expect(status).toBe(404)
  })

  it('applies set and unset ops on POST', async () => {
    const settings = fakeSettings([descriptor('notify-on-complete')])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('POST', '/notify-on-complete/api/config', {
      set: { sound: false, sounds: { completed: 'Funk', error: 'Sosumi', approval: 'Ping' } },
      unset: ['quietHours'],
    }), res)
    const { status } = lastBody(res)
    expect(status).toBe(200)
    expect(settings.mutate).toHaveBeenCalledWith('notify-on-complete', [
      { op: 'set', path: ['sound'], value: false },
      { op: 'set', path: ['sounds'], value: { completed: 'Funk', error: 'Sosumi', approval: 'Ping' } },
      { op: 'unset', path: ['quietHours'] },
    ])
  })

  it('rejects a malformed set payload', async () => {
    const settings = fakeSettings([descriptor('notify-on-complete')])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('POST', '/notify-on-complete/api/config', { set: 'not-an-object' }), res)
    const { status } = lastBody(res)
    expect(status).toBe(400)
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('503s without a settings service', async () => {
    const handler = createNotifyApiHandler(fakeCtx(undefined))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    const { status } = lastBody(res)
    expect(status).toBe(503)
  })

  it('404s on unknown actions', async () => {
    const settings = fakeSettings([descriptor('notify-on-complete')])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/other'), res)
    const { status } = lastBody(res)
    expect(status).toBe(404)
  })
})
