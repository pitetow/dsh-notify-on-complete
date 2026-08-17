/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/** Quiet-hours helpers: parse "HH:MM-HH:MM" specs and test a moment against them. */

/** Parse `"HH:MM"` into minutes since midnight, or null when malformed. */
function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Parse a quiet-hours spec `"HH:MM-HH:MM"` (24h; start after end crosses
 * midnight) into `[startMin, endMin]`. Returns null on malformed input.
 * @param spec - the spec string, e.g. `"23:00-08:00"`.
 * @returns the range in minutes, or null.
 */
export function parseQuietRange(spec: string): [number, number] | null {
  const [startSpec, endSpec, ...extra] = spec.split('-')
  if (extra.length > 0) return null
  const start = startSpec === undefined ? null : parseClock(startSpec)
  const end = endSpec === undefined ? null : parseClock(endSpec)
  if (start === null || end === null) return null
  return [start, end]
}

/** Whether `minute` falls in `[start, end)`, handling cross-midnight ranges. */
function inRange(minute: number, start: number, end: number): boolean {
  if (start <= end) return minute >= start && minute < end
  return minute >= start || minute < end
}

/**
 * Whether `now` falls inside any quiet-hours range. Malformed specs are
 * ignored; an empty list is never quiet. The start minute is included, the
 * end minute excluded.
 * @param now - the moment to test.
 * @param ranges - `"HH:MM-HH:MM"` specs; start after end crosses midnight.
 * @returns whether notifications should be suppressed.
 */
export function isInQuietHours(now: Date, ranges: string[]): boolean {
  const minute = now.getHours() * 60 + now.getMinutes()
  return ranges.some((spec) => {
    const range = parseQuietRange(spec)
    return range !== null && inRange(minute, range[0], range[1])
  })
}
