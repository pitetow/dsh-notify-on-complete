/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * JSON API for the notify settings card.
 *
 * Served by the plugin's own `webServer` prefix route (`/notify-on-complete/api`).
 * The harness's settings API exposes only an explicit allowlist of namespaces
 * to the browser (`settings-not-exposed` otherwise), so the card reads and
 * writes through this route instead: GET resolves the plugin's registered
 * namespace in-process (where it is always visible), POST applies set/unset
 * ops through the settings provider's mutate path, which persists to the
 * settings document and re-reads live.
 * @module dsh-notify-on-complete/api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsNamespace, type SettingsPathOp, type SettingsProvider } from '@deepseek-ai/dsh-settings'

/** The settings namespace the card edits (spelled here, mirror of settings.ts). */
export const NOTIFY_NS: SettingsNamespace = settingsNamespace('notify-on-complete')

/** The config section the API serves. */
export interface NotifyApiConfig {
  /** Schema-resolved value (defaults + base + user). */
  value?: Record<string, unknown>
  /** Composition layer the value resolves over (what a reset returns to). */
  base?: Record<string, unknown>
  /** Raw user layer as stored. */
  user?: Record<string, unknown>
  /** Whether the settings document accepts writes. */
  writable: boolean
}

/** Write payload the card POSTs: fields to set and fields to clear. */
export interface NotifyApiWrite {
  set?: Record<string, unknown>
  unset?: string[]
}

/** Send one JSON response with the given status. */
function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read and parse a JSON request body (bounded to 1 MiB). */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > 1024 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Resolve the settings service at call time (the web profile mounts it; CLI runs skip the route). */
function settingsOf(ctx: Context): SettingsProvider | undefined {
  return ctx.get('settings') as SettingsProvider | undefined
}

/**
 * Build the prefix-route handler for the JSON API. The handler resolves the
 * settings service on every request, so it works whenever the settings
 * provider is mounted — even if it appeared after the plugin started.
 * @param ctx - the plugin context.
 * @returns the route handler.
 */
export function createNotifyApiHandler(ctx: Context): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await dispatch(req, res, ctx)
    } catch (error) {
      respond(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

async function dispatch(req: IncomingMessage, res: ServerResponse, ctx: Context): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const action = url.pathname.replace(/^\/notify-on-complete\/api/, '').replace(/^\/+|\/+$/g, '')
  const settings = settingsOf(ctx)
  if (settings === undefined) {
    respond(res, 503, { error: 'settings service is absent' })
    return
  }
  if (req.method === 'GET' && action === 'config') {
    const descriptor = settings.describe({ redactSecrets: true })
      .find((entry) => String(entry.ns) === NOTIFY_NS)
    if (descriptor === undefined) {
      respond(res, 404, { error: `settings namespace "${NOTIFY_NS}" is not registered` })
      return
    }
    const config: NotifyApiConfig = {
      value: descriptor.value as Record<string, unknown>,
      writable: settings.writable,
    }
    if (descriptor.base !== undefined) config.base = descriptor.base as Record<string, unknown>
    if (descriptor.user !== undefined) config.user = descriptor.user as Record<string, unknown>
    respond(res, 200, config)
    return
  }
  if (req.method === 'POST' && action === 'config') {
    const body = (await readJson(req)) as NotifyApiWrite
    const ops: SettingsPathOp[] = []
    const set = body.set ?? {}
    if (typeof set !== 'object' || set === null || Array.isArray(set)) {
      respond(res, 400, { error: 'set must be an object of fields' })
      return
    }
    for (const [field, value] of Object.entries(set)) {
      ops.push({ op: 'set', path: [field], value })
    }
    const unset = body.unset ?? []
    if (!Array.isArray(unset) || unset.some((field) => typeof field !== 'string')) {
      respond(res, 400, { error: 'unset must be an array of field names' })
      return
    }
    for (const field of unset) ops.push({ op: 'unset', path: [field] })
    await settings.mutate(NOTIFY_NS, ops)
    respond(res, 200, { ok: true })
    return
  }
  respond(res, 404, { error: 'not found' })
}
