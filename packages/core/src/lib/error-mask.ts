import type { ZodError } from 'zod'

// Field names matching this pattern are considered internal and must not
// appear in externally-visible validation error responses. Leaking internal
// column names (e.g. hitl_trigger.axes) aids reconnaissance of DB schema or
// evaluator internals (CWE-209).
const INTERNAL_FIELD_PATTERN = /^(_|__|internal_|hitl_|audit_)/

/**
 * Project a ZodError.flatten().fieldErrors into a response-safe shape.
 * Field names matching INTERNAL_FIELD_PATTERN collapse into a single
 * 'invalid_field' bucket, preserving the count of errors without exposing
 * the offending field name.
 */
export function toPublicFieldErrors(err: ZodError): Record<string, string[]> {
  const flat = err.flatten().fieldErrors as Record<string, string[] | undefined>
  const out: Record<string, string[]> = {}
  for (const [field, errs] of Object.entries(flat)) {
    const key = INTERNAL_FIELD_PATTERN.test(field) ? 'invalid_field' : field
    if (!out[key]) out[key] = []
    out[key].push(...(errs ?? []))
  }
  return out
}
