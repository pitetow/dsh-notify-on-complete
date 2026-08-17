/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify-on-complete settings card, registered into the Plugins settings
 * section's configurable tab. Header disclosure is card-local state; staged
 * edits outlive collapsing, so the header marks a card holding unsaved edits.
 * The card renders nothing while its namespace is unavailable.
 * @module dsh-notify-on-complete/client/NotifyCard
 */

import { createElement, useState, type ReactNode } from 'react'
import { SOUND_OPTIONS, type NotifyCardSnapshot, type SoundTier } from './notify-settings.js'

/** Props the slot renderer binds from the registration's injected face. */
export interface NotifyCardProps {
  /** Bound selector hook over the controller's snapshot store. */
  useNotifyCard: (selector: (snapshot: NotifyCardSnapshot) => NotifyCardSnapshot) => NotifyCardSnapshot
  /** Stage one field edit. */
  edit: (field: string, value: unknown) => void
  /** Stage a clear so saving re-inherits the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field row: copy, optional hint, and the control cluster. */
function FieldRow(props: {
  label: string
  hint?: string
  overridden: boolean
  disabled: boolean
  onReset: () => void
  resetLabel?: string
  overriddenLabel?: string
  children: ReactNode
}) {
  const { label, hint, overridden, disabled, onReset, children } = props
  return (
    <div className="noc-field">
      <div className="noc-field-copy">
        <span className="noc-field-label">{label}</span>
        {hint === undefined ? null : <span className="noc-field-hint">{hint}</span>}
      </div>
      <div className="noc-controls">
        {children}
        {overridden ? (
          <>
            <span className="noc-badge">{props.overriddenLabel ?? '已覆盖'}</span>
            <button type="button" className="noc-reset" disabled={disabled} onClick={onReset}>
              {props.resetLabel ?? '重置'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** A labeled toggle switch. */
function SwitchRow(props: {
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  overridden: boolean
  onEdit: (value: boolean) => void
  onReset: () => void
}) {
  const { label, hint, checked, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="noc-switch"
        disabled={disabled}
        onClick={() => { onEdit(!checked) }}
      >
        <span className="noc-knob" />
      </button>
    </FieldRow>
  )
}

/** A labeled sound-name selector. */
function SelectRow(props: {
  label: string
  hint?: string
  options: readonly string[]
  value: string
  disabled: boolean
  overridden: boolean
  onEdit: (value: string) => void
  onReset: () => void
}) {
  const { label, hint, options, value, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <select
        className="noc-select"
        disabled={disabled}
        value={value}
        onChange={(event) => { onEdit(event.target.value) }}
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </FieldRow>
  )
}

/** A labeled text input. */
function TextRow(props: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  disabled: boolean
  overridden: boolean
  onEdit: (value: string) => void
  onReset: () => void
}) {
  const { label, hint, value, placeholder, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <input
        type="text"
        className="noc-input"
        value={value}
        placeholder={placeholder ?? ''}
        disabled={disabled}
        onChange={(event) => { onEdit(event.target.value) }}
      />
    </FieldRow>
  )
}

/** Render the notify-on-complete card. */
export function NotifyCard(props: NotifyCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useNotifyCard(snapshot => snapshot)
  if (!state.shell.available) return null
  const { shell } = state
  const disabled = !shell.writable

  // The three per-tier selectors all edit the one nested `sounds` object; each
  // edit re-stages the object with the changed tier so a save writes one field.
  const currentSounds = (): Record<SoundTier, string> => ({
    completed: state.sounds.completed.value,
    error: state.sounds.error.value,
    approval: state.sounds.approval.value,
  })

  return (
    <li className={`noc-card${open ? ' noc-open' : ''}`}>
      <button
        type="button"
        className="noc-header"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className="noc-head-text">
          <span className="noc-name">运行完成通知</span>
          <span className="noc-description">运行完成、失败、提问与审批的桌面通知设置（含提示音）</span>
        </span>
        {shell.dirty ? <span className="noc-pending">未保存</span> : null}
        <svg className="noc-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="noc-body">
          {!shell.writable ? <p className="noc-readonly" role="status">设置文档为只读，无法保存修改。</p> : null}
          <SwitchRow
            label="启用通知"
            hint="关闭后不再发送任何通知"
            checked={state.enabled.value}
            disabled={disabled}
            overridden={state.enabled.overridden}
            onEdit={value => { props.edit('enabled', value) }}
            onReset={() => { props.resetField('enabled') }}
          />
          <TextRow
            label="通知标题"
            hint="通知中心显示的应用标题"
            value={state.title.value}
            disabled={disabled}
            overridden={state.title.overridden}
            onEdit={value => { props.edit('title', value) }}
            onReset={() => { props.resetField('title') }}
          />
          <SwitchRow
            label="播放提示音"
            hint="通知时同时播放系统提示音；关闭则只弹通知不出声"
            checked={state.sound.value}
            disabled={disabled}
            overridden={state.sound.overridden}
            onEdit={value => { props.edit('sound', value) }}
            onReset={() => { props.resetField('sound') }}
          />
          <SelectRow
            label="完成音色"
            hint="运行完成时的提示音；default 为平台默认（macOS 上不响铃）"
            options={SOUND_OPTIONS}
            value={state.sounds.completed.value}
            disabled={disabled}
            overridden={state.sounds.completed.overridden}
            onEdit={value => { props.edit('sounds', { ...currentSounds(), completed: value }) }}
            onReset={() => { props.resetField('sounds') }}
          />
          <SelectRow
            label="失败音色"
            hint="运行失败或中止时的提示音"
            options={SOUND_OPTIONS}
            value={state.sounds.error.value}
            disabled={disabled}
            overridden={state.sounds.error.overridden}
            onEdit={value => { props.edit('sounds', { ...currentSounds(), error: value }) }}
            onReset={() => { props.resetField('sounds') }}
          />
          <SelectRow
            label="提问/审批音色"
            hint="模型提问或等待审批时的提示音"
            options={SOUND_OPTIONS}
            value={state.sounds.approval.value}
            disabled={disabled}
            overridden={state.sounds.approval.overridden}
            onEdit={value => { props.edit('sounds', { ...currentSounds(), approval: value }) }}
            onReset={() => { props.resetField('sounds') }}
          />
          <TextRow
            label="静音时段"
            hint="HH:MM-HH:MM，多个用逗号分隔，如 22:00-08:00（跨午夜）"
            value={state.quietHours.value}
            placeholder="例如 22:00-08:00"
            disabled={disabled}
            overridden={state.quietHours.overridden}
            onEdit={value => { props.edit('quietHours', value) }}
            onReset={() => { props.resetField('quietHours') }}
          />
          <SwitchRow
            label="阻塞交互通知"
            hint="需要回答提问或批准操作时立即通知"
            checked={state.onBlocked.value}
            disabled={disabled}
            overridden={state.onBlocked.overridden}
            onEdit={value => { props.edit('onBlocked', value) }}
            onReset={() => { props.resetField('onBlocked') }}
          />
          <SwitchRow
            label="提问通知"
            hint="模型调用提问工具时通知"
            checked={state.onQuestion.value}
            disabled={disabled}
            overridden={state.onQuestion.overridden}
            onEdit={value => { props.edit('onQuestion', value) }}
            onReset={() => { props.resetField('onQuestion') }}
          />
          <SwitchRow
            label="审批通知"
            hint="等待操作批准时通知"
            checked={state.onApproval.value}
            disabled={disabled}
            overridden={state.onApproval.overridden}
            onEdit={value => { props.edit('onApproval', value) }}
            onReset={() => { props.resetField('onApproval') }}
          />
          <div className="noc-footer">
            {shell.failed ? <p className="noc-failed" role="status">保存失败，请重试。</p> : null}
            <button type="button" className="noc-button noc-discard" disabled={!shell.dirty || shell.saving} onClick={props.discard}>
              放弃修改
            </button>
            <button type="button" className="noc-button noc-save" disabled={!shell.dirty || shell.saving} onClick={props.save}>
              {shell.saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
