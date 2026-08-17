/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotifyConfigStore } from '../src/client/config-store.js'

/** Stub global fetch for one test. */
function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const stub = vi.fn(handler)
  vi.stubGlobal('fetch', stub)
  return stub
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NotifyConfigStore', () => {
  it('loads the config and publishes a ready snapshot', async () => {
    const fetchStub = stubFetch(() => Promise.resolve(jsonResponse(200, {
      value: { sound: false },
      base: { sound: true },
      user: { sound: false },
      writable: true,
    })))
    const store = new NotifyConfigStore('/notify/api/config')
    const seen: string[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().status) })
    expect(store.getSnapshot().status).toBe('loading')
    await store.load()
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().value).toEqual({ sound: false })
    expect(store.getSnapshot().writable).toBe(true)
    expect(fetchStub).toHaveBeenCalledWith('/notify/api/config')
    expect(seen).toEqual(['ready'])
  })

  it('marks the store unavailable on a failed read', async () => {
    stubFetch(() => Promise.reject(new Error('network down')))
    const store = new NotifyConfigStore('/notify/api/config')
    await store.load()
    expect(store.getSnapshot().status).toBe('unavailable')
  })

  it('marks the store unavailable on a non-ok read', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(503, { error: 'absent' })))
    const store = new NotifyConfigStore('/notify/api/config')
    await store.load()
    expect(store.getSnapshot().status).toBe('unavailable')
  })

  it('POSTs a set write and re-reads the accepted value', async () => {
    const fetchStub = stubFetch((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { ok: true }))
      }
      return Promise.resolve(jsonResponse(200, {
        value: { sound: false },
        writable: true,
      }))
    })
    const store = new NotifyConfigStore('/notify/api/config')
    await store.load()
    await store.set('sound', false)
    expect(fetchStub).toHaveBeenCalledWith('/notify/api/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ set: { sound: false } }),
    }))
    expect(store.getSnapshot().value).toEqual({ sound: false })
  })

  it('POSTs an unset write', async () => {
    const fetchStub = stubFetch((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { ok: true }))
      }
      return Promise.resolve(jsonResponse(200, { value: {}, writable: true }))
    })
    const store = new NotifyConfigStore('/notify/api/config')
    await store.load()
    await store.unset('quietHours')
    expect(fetchStub).toHaveBeenCalledWith('/notify/api/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ unset: ['quietHours'] }),
    }))
  })

  it('throws when a write is refused', async () => {
    stubFetch((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(400, { error: 'refused' }))
      }
      return Promise.resolve(jsonResponse(200, { value: {}, writable: true }))
    })
    const store = new NotifyConfigStore('/notify/api/config')
    await store.load()
    await expect(store.set('sound', false)).rejects.toThrow(/refused/)
  })
})
