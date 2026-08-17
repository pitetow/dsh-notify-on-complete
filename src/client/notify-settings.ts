/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Browser-half settings form for the `notify-on-complete` settings namespace.
 * Stages what the user edits and writes it only on save, mirroring the
 * platform's plugin-card pattern: each write is a durable, revision-fenced
 * document mutation, so a control that committed as it settled would turn one
 * edit into a write the user never asked for and could not preview. The
 * settings-scope face is declared structurally here — the client bundle must
 * not import across plugin packages.
 * @module dsh-notify-on-complete/client/notify-settings
 */

/** The three sound tiers: completion, failure, and blocking interactions. */
export type SoundTier = 'completed' | 'error' | 'approval'

/** The section this card edits — a mirror of the host schema's shape. */
export interface NotifySection {
  enabled?: boolean
  title?: string
  /** Play a system sound alongside the notification; default `true`. */
  sound?: boolean
  /** Per-tier sound overrides; defaults in {@link DEFAULT_SOUNDS}. */
  sounds?: Partial<Record<SoundTier, string>>
  /** Quiet-hours specs "HH:MM-HH:MM" (start after end crosses midnight). */
  quietHours?: string[]
  /** Notify on blocking user-interactions (questions + approvals). */
  onBlocked?: boolean
  /** Notify when the model asks a question. */
  onQuestion?: boolean
  /** Notify when the harness waits for approval. */
  onApproval?: boolean
}

/** Default per-tier sound names (macOS system sound names), mirroring the host defaults. */
export const DEFAULT_SOUNDS: Record<SoundTier, string> = {
  completed: 'Glass',
  error: 'Sosumi',
  approval: 'Ping',
}

/**
 * macOS sound names offered by the per-tier selectors. `default` maps to each
 * platform's default chime (and on macOS means no chime — the single-tier
 * mute the README documents).
 */
export const SOUND_OPTIONS: readonly string[] = [
  'default', 'Glass', 'Sosumi', 'Ping', 'Funk',
  'Basso', 'Blow', 'Bottle', 'Frog', 'Hero',
  'Morse', 'Pop', 'Purr', 'Submarine', 'Tink',
]

/** Resolved values a field falls back to when neither the user nor the base carries it. */
const DEFAULTS: Required<Pick<NotifySection, 'enabled' | 'title' | 'sound' | 'onBlocked' | 'onQuestion' | 'onApproval'>> & { sounds: Record<SoundTier, string> } = {
  enabled: true,
  title: 'DeepSeek Harness',
  sound: true,
  onBlocked: true,
  onQuestion: true,
  onApproval: true,
  sounds: { ...DEFAULT_SOUNDS },
}

/** One field's staged edit. */
type Staged = { readonly kind: 'set'; readonly value: unknown } | { readonly kind: 'clear' }

/** What a control renders for one field. */
export interface FieldState<V> {
  /** The value the control renders (resolved, or the staged draft). */
  value: V
  /** True when saving would leave a user-layer override for this field. */
  overridden: boolean
}

/** Card-level form state shared by every plugin card. */
export interface NotifyFormState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The projected snapshot the card renders. */
export interface NotifyCardSnapshot {
  shell: NotifyFormState
  enabled: FieldState<boolean>
  title: FieldState<string>
  sound: FieldState<boolean>
  /** The three per-tier sound selectors (the nested `sounds` object written as one field). */
  sounds: Record<SoundTier, FieldState<string>>
  /** Quiet-hours as a comma-joined text draft; saved as the parsed array. */
  quietHours: FieldState<string>
  onBlocked: FieldState<boolean>
  onQuestion: FieldState<boolean>
  onApproval: FieldState<boolean>
}

/**
 * The settings-scope face this form drives, declared structurally so the
 * bundle stays free of cross-plugin value imports. Matches the runtime
 * `SettingsScope<T>` contract.
 */
export interface SettingsScopeLike<T> {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    base: unknown
    user: unknown
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** Deep equality over JSON-compatible data (objects, arrays, primitives). */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqualJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqualJson(left[key], right[key]))
}

/**
 * Parse a quiet-hours text draft ("HH:MM-HH:MM", comma separated) into the
 * stored array. An empty draft clears the field; any other draft yields the
 * trimmed, non-empty ranges in order.
 * @param text - the draft text.
 * @returns the stored array, or undefined to clear the field.
 */
export function parseQuietHours(text: string): string[] | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return trimmed.split(',').map(part => part.trim()).filter(part => part !== '')
}

/** Join a stored quiet-hours array into the text draft the control renders. */
export function formatQuietHours(value: readonly string[] | undefined): string {
  return (value ?? []).join(', ')
}

/**
 * The staged form over the `notify-on-complete` settings namespace. Publishes
 * a snapshot projection through a store the card binds as its `useNotifyCard`
 * selector hook; both the scope and the local drafts change underneath, so
 * every projection is rebuilt from the two together.
 */
export class NotifyCardController {
  private readonly staged = new Map<string, Staged>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  /** @param scope - the bound settings scope for the `notify-on-complete` namespace. */
  constructor(private readonly scope: SettingsScopeLike<NotifySection>) {
    scope.subscribe(() => this.publish())
  }

  /** @returns the current snapshot projection (stable until the next change). */
  getSnapshot(): NotifyCardSnapshot {
    const snapshot = this.scope.getSnapshot()
    const shell: NotifyFormState = {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      saving: this.saving,
      failed: this.failed,
    }
    return {
      shell,
      enabled: this.field('enabled', snapshot, (value) => typeof value === 'boolean' ? value : DEFAULTS.enabled),
      title: this.field('title', snapshot, (value) => typeof value === 'string' ? value : DEFAULTS.title),
      sound: this.field('sound', snapshot, (value) => typeof value === 'boolean' ? value : DEFAULTS.sound),
      sounds: {
        completed: this.field('sounds', snapshot, (value) => {
          const sounds = (value ?? {}) as Partial<Record<SoundTier, string>>
          return typeof sounds.completed === 'string' ? sounds.completed : DEFAULTS.sounds.completed
        }),
        error: this.field('sounds', snapshot, (value) => {
          const sounds = (value ?? {}) as Partial<Record<SoundTier, string>>
          return typeof sounds.error === 'string' ? sounds.error : DEFAULTS.sounds.error
        }),
        approval: this.field('sounds', snapshot, (value) => {
          const sounds = (value ?? {}) as Partial<Record<SoundTier, string>>
          return typeof sounds.approval === 'string' ? sounds.approval : DEFAULTS.sounds.approval
        }),
      },
      quietHours: this.field('quietHours', snapshot, (value) => formatQuietHours(Array.isArray(value) ? value : undefined)),
      onBlocked: this.field('onBlocked', snapshot, (value) => typeof value === 'boolean' ? value : DEFAULTS.onBlocked),
      onQuestion: this.field('onQuestion', snapshot, (value) => typeof value === 'boolean' ? value : DEFAULTS.onQuestion),
      onApproval: this.field('onApproval', snapshot, (value) => typeof value === 'boolean' ? value : DEFAULTS.onApproval),
    }
  }

  /** @returns the disposer removing one listener. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The registration-side face the card's slot entry injects: the snapshot
   * store bound as the `useNotifyCard` selector hook, plus the form actions
   * spread as card props.
   * @returns the injected face.
   */
  inject(): {
    hooks: { notifyCard: NotifyCardController }
    edit: (field: string, value: unknown) => void
    resetField: (field: string) => void
    save: () => void
    discard: () => void
  } {
    return {
      hooks: { notifyCard: this },
      edit: (field, value) => { this.stage(field, value) },
      resetField: (field) => { this.reset(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /**
   * Stage one field edit. A staged value equal to the current section value
   * is a no-op and unstages (toggling a switch back reverts the draft).
   * @param field - the section field this edit addresses.
   * @param value - the drafted value (for `sounds`, the whole object; for
   * `quietHours`, the comma-joined text).
   */
  stage(field: string, value: unknown): void {
    const section = this.sectionValue(field)
    if (value !== undefined && deepEqualJson(this.toStored(field, value), section)) {
      this.staged.delete(field)
    } else {
      this.staged.set(field, { kind: 'set', value })
    }
    this.failed = false
    this.publish()
  }

  /**
   * Stage a clear, so saving lets the field re-inherit the composition layer.
   * @param field - the section field to clear.
   */
  reset(field: string): void {
    this.staged.set(field, { kind: 'clear' })
    this.failed = false
    this.publish()
  }

  /**
   * Drop every staged edit.
   */
  discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted. The
   * Host is the only authority on whether a value was accepted, so the
   * outcome is read back from the section rather than predicted here. A save
   * that did not land keeps its drafts so the user can correct them.
   * @returns settlement after every write and the read-back.
   */
  async save(): Promise<void> {
    const writes: Array<() => Promise<boolean>> = []
    for (const [field, staged] of this.staged) {
      if (staged.kind === 'clear') {
        if (this.stored(field)) writes.push(() => this.clear(field))
        continue
      }
      const value = this.toStored(field, staged.value)
      if (value === undefined) {
        if (this.stored(field)) writes.push(() => this.clear(field))
        continue
      }
      if (!deepEqualJson(value, this.sectionValue(field))) writes.push(() => this.store(field, value))
    }
    if (writes.length === 0) {
      this.staged.clear()
      this.publish()
      return
    }
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      try {
        landed = await write() && landed
      } catch {
        // A refused write must not escape into an unhandled rejection: the
        // card reports the failure and keeps the drafts for correction.
        landed = false
      }
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * Convert a staged draft into the value a save would store.
   * @param field - the section field.
   * @param value - the drafted value.
   * @returns the stored value, or undefined when the draft clears the field.
   */
  private toStored(field: string, value: unknown): unknown {
    if (field === 'quietHours') {
      return typeof value === 'string' ? parseQuietHours(value) : undefined
    }
    return value
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return deepEqualJson(this.userLayer()?.[field], value)
  }

  private field<V>(field: string, snapshot: ReturnType<SettingsScopeLike<NotifySection>['getSnapshot']>, resolve: (value: unknown) => V): FieldState<V> {
    const staged = this.staged.get(field)
    if (staged !== undefined) {
      if (staged.kind === 'clear') {
        return { value: resolve(this.baseValue(field)), overridden: false }
      }
      return { value: resolve(staged.value), overridden: true }
    }
    return { value: resolve(this.sectionValue(field, snapshot)), overridden: this.stored(field, snapshot) }
  }

  private sectionValue(field: string, snapshot?: ReturnType<SettingsScopeLike<NotifySection>['getSnapshot']>): unknown {
    const value = (snapshot ?? this.scope.getSnapshot()).value as NotifySection | undefined
    return value?.[field as keyof NotifySection]
  }

  private baseValue(field: string): unknown {
    const base = this.scope.getSnapshot().base as NotifySection | undefined
    return base?.[field as keyof NotifySection]
  }

  private userLayer(snapshot?: ReturnType<SettingsScopeLike<NotifySection>['getSnapshot']>): Record<string, unknown> | undefined {
    const user = (snapshot ?? this.scope.getSnapshot()).user
    if (typeof user !== 'object' || user === null || Array.isArray(user)) return undefined
    return user as Record<string, unknown>
  }

  private stored(field: string, snapshot?: ReturnType<SettingsScopeLike<NotifySection>['getSnapshot']>): boolean {
    const user = this.userLayer(snapshot)
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
