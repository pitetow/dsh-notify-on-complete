/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Browser config store for the notify settings card.
 *
 * The harness's settings API exposes only an explicit allowlist of namespaces
 * to the web client (`settings-not-exposed` otherwise), so the card reads and
 * writes through the plugin's own JSON route (`/notify-on-complete/api/config`)
 * instead of the settings scope. The store implements the same snapshot
 * contract the card controller drives: a stable snapshot plus queued field
 * writes that re-read what the Host accepted.
 * @module dsh-notify-on-complete/client/config-store
 */

import type { NotifySection, SettingsScopeLike } from './notify-settings.js'

/** Snapshot served to the card controller (mirrors the settings-scope shape). */
export interface NotifyConfigSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: NotifySection | undefined
  base: unknown
  user: unknown
  writable: boolean
}

/** Write payload the JSON route accepts. */
interface WritePayload {
  set?: Record<string, unknown>
  unset?: string[]
}

/**
 * Fetch-backed store over the plugin's config JSON route.
 * @param configUrl - the JSON route URL; defaults to the same-origin path.
 */
export class NotifyConfigStore implements SettingsScopeLike<NotifySection> {
  private snapshot: NotifyConfigSnapshot = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    writable: false,
  }
  private readonly listeners = new Set<() => void>()

  /** @param configUrl - the JSON route URL; defaults to the same-origin path. */
  constructor(private readonly configUrl = '/notify-on-complete/api/config') {}

  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): NotifyConfigSnapshot {
    return this.snapshot
  }

  /** @returns the disposer removing one listener. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Re-read the config from the route and publish. A failed read (route
   * absent, network error) marks the namespace unavailable so the card
   * renders nothing rather than a broken form.
   * @returns settlement after the read.
   */
  async load(): Promise<void> {
    try {
      const response = await fetch(this.configUrl)
      if (!response.ok) {
        this.publish({ status: 'unavailable' })
        return
      }
      const data = (await response.json()) as {
        value?: NotifySection
        base?: unknown
        user?: unknown
        writable?: boolean
      }
      this.publish({
        status: 'ready',
        value: data.value,
        base: data.base,
        user: data.user,
        writable: data.writable === true,
      })
    } catch {
      this.publish({ status: 'unavailable' })
    }
  }

  /**
   * Queue one field write (set) and re-read what the Host accepted.
   * @param field - the section field to write.
   * @param value - the JSON-shaped value to store.
   * @returns settlement after the write and read-back.
   */
  async set(field: string, value: unknown): Promise<void> {
    await this.write({ set: { [field]: value } })
  }

  /**
   * Queue one field clear and re-read what the Host accepted.
   * @param field - the section field to clear.
   * @returns settlement after the write and read-back.
   */
  async unset(field: string): Promise<void> {
    await this.write({ unset: [field] })
  }

  private async write(payload: WritePayload): Promise<void> {
    const response = await fetch(this.configUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`notify config write failed: HTTP ${response.status}${text ? ` — ${text}` : ''}`)
    }
    await this.load()
  }

  private publish(next: Partial<NotifyConfigSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of [...this.listeners]) listener()
  }
}
