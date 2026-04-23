import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { toPublicFieldErrors } from '../lib/error-mask.js'

test('toPublicFieldErrors: public fields pass through', () => {
  const schema = z.object({
    title: z.string().min(1),
    email: z.string().email(),
  })
  const r = schema.safeParse({ title: '', email: 'not-an-email' })
  assert.equal(r.success, false)
  if (r.success) return
  const masked = toPublicFieldErrors(r.error)
  assert.ok(masked.title)
  assert.ok(masked.email)
})

test('toPublicFieldErrors: internal prefix (hitl_, audit_, _, __, internal_) collapses to invalid_field', () => {
  // Build a ZodError manually to hit internal field names via refinements is fussy;
  // instead simulate by patching flatten output via a constructed schema object.
  const schema = z.object({
    hitl_trigger: z.string().min(1),
    _hidden: z.string().min(1),
    __weird: z.string().min(1),
    internal_state: z.string().min(1),
    audit_event: z.string().min(1),
    // Also a normal field to ensure pass-through still works next to internals.
    title: z.string().min(1),
  })
  const r = schema.safeParse({
    hitl_trigger: '',
    _hidden: '',
    __weird: '',
    internal_state: '',
    audit_event: '',
    title: '',
  })
  assert.equal(r.success, false)
  if (r.success) return
  const masked = toPublicFieldErrors(r.error)
  // None of the internal names should leak.
  for (const k of Object.keys(masked)) {
    assert.ok(
      !/^(_|__|internal_|hitl_|audit_)/.test(k),
      `internal field name '${k}' must not leak into response`,
    )
  }
  // They should have collapsed into invalid_field.
  assert.ok(masked.invalid_field, 'internal fields must collapse into invalid_field')
  assert.ok(masked.invalid_field.length >= 5, 'all 5 internal failures recorded')
  // The public field 'title' stays addressable.
  assert.ok(masked.title)
})
