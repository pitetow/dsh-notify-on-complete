/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/* dsh-notify-on-complete settings card — theme-aware via DSH alias tokens. */

export const NOTIFY_CSS = `
/* dsh-notify-on-complete settings card — theme-aware via DSH alias tokens. */

.noc-card {
  list-style: none;
}

.noc-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: none;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 8px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.noc-header:hover {
  border-color: var(--dsw-alias-border-l2, #c9cdd4);
}

.noc-head-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.noc-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2329);
}

.noc-description {
  font-size: 12px;
  line-height: 1.4;
  color: var(--dsw-alias-label-secondary, #646a73);
}

.noc-pending {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-warn-primary, #f79009);
  color: #ffffff;
}

.noc-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.noc-open .noc-chevron {
  transform: rotate(180deg);
}

.noc-body {
  margin-top: 8px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}

.noc-readonly {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #646a73);
}

.noc-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.noc-field + .noc-field {
  border-top: 1px solid var(--dsw-alias-border-l0, #f0f1f3);
}

.noc-field-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.noc-field-label {
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #1f2329);
}

.noc-field-hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-secondary, #646a73);
}

.noc-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.noc-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, #f2f3f5);
  color: var(--dsw-alias-label-secondary, #646a73);
}

.noc-reset {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary, #646a73);
  cursor: pointer;
}

.noc-reset:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary, #3370ff);
  color: var(--dsw-alias-brand-primary, #3370ff);
}

.noc-reset:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Switch control: a labeled toggle button. */
.noc-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  border: none;
  background: var(--dsw-alias-border-l2, #c9cdd4);
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.noc-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary, #3370ff);
}

.noc-switch:disabled {
  opacity: 0.5;
  cursor: default;
}

.noc-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.15s ease;
}

.noc-switch[aria-checked="true"] .noc-knob {
  transform: translateX(16px);
}

.noc-select {
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2329);
}

.noc-select:disabled {
  opacity: 0.5;
}

.noc-input {
  font-size: 13px;
  padding: 4px 8px;
  width: 220px;
  max-width: 100%;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2329);
}

.noc-input:disabled {
  opacity: 0.5;
}

.noc-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l0, #f0f1f3);
}

.noc-failed {
  margin: 0 auto 0 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary, #d92d20);
}

.noc-button {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
}

.noc-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.noc-discard {
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  background: none;
  color: var(--dsw-alias-label-secondary, #646a73);
}

.noc-save {
  border: 1px solid var(--dsw-alias-brand-primary, #3370ff);
  background: var(--dsw-alias-brand-primary, #3370ff);
  color: #ffffff;
}
`
