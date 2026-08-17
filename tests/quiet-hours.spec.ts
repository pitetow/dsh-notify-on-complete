/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import { isInQuietHours, parseQuietRange } from '../src/quiet-hours.js'

describe('parseQuietRange', () => {
  it('parses a same-day range into minutes', () => {
    expect(parseQuietRange('09:00-17:30')).toEqual([540, 1050])
  })

  it('parses a cross-midnight range (start after end)', () => {
    expect(parseQuietRange('23:00-08:00')).toEqual([1380, 480])
  })

  it('rejects malformed specs', () => {
    expect(parseQuietRange('')).toBeNull()
    expect(parseQuietRange('abc')).toBeNull()
    expect(parseQuietRange('25:00-08:00')).toBeNull()
    expect(parseQuietRange('23:60-08:00')).toBeNull()
    expect(parseQuietRange('23:00')).toBeNull()
    expect(parseQuietRange('23:00-08')).toBeNull()
  })
})

describe('isInQuietHours', () => {
  const at = (h: number, m = 0): Date => new Date(2026, 0, 1, h, m)

  it('is false with no ranges', () => {
    expect(isInQuietHours(at(10), [])).toBe(false)
  })

  it('matches inside a same-day range', () => {
    expect(isInQuietHours(at(10, 30), ['09:00-17:00'])).toBe(true)
  })

  it('does not match outside a same-day range', () => {
    expect(isInQuietHours(at(8, 59), ['09:00-17:00'])).toBe(false)
    expect(isInQuietHours(at(17, 0), ['09:00-17:00'])).toBe(false)
  })

  it('includes the start minute and excludes the end minute', () => {
    expect(isInQuietHours(at(9, 0), ['09:00-17:00'])).toBe(true)
    expect(isInQuietHours(at(17, 0), ['09:00-17:00'])).toBe(false)
  })

  it('matches across midnight', () => {
    expect(isInQuietHours(at(23, 30), ['23:00-08:00'])).toBe(true)
    expect(isInQuietHours(at(3, 0), ['23:00-08:00'])).toBe(true)
    expect(isInQuietHours(at(8, 0), ['23:00-08:00'])).toBe(false)
    expect(isInQuietHours(at(12, 0), ['23:00-08:00'])).toBe(false)
  })

  it('matches when any of several ranges hit', () => {
    expect(isInQuietHours(at(12, 30), ['23:00-08:00', '12:00-13:00'])).toBe(true)
    expect(isInQuietHours(at(10, 0), ['23:00-08:00', '12:00-13:00'])).toBe(false)
  })

  it('ignores malformed ranges', () => {
    expect(isInQuietHours(at(10, 0), ['garbage'])).toBe(false)
  })
})
