import { getDb } from '../db/client.js'
import { LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT } from '../lib/limits.js'

export function listPolicies(opts: { activeOnly?: boolean; limit?: number } = {}): unknown[] {
  const activeOnly = opts.activeOnly ?? true
  const limit = Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  if (activeOnly) {
    return getDb().prepare(
      'SELECT * FROM policies WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?',
    ).all(limit)
  }
  return getDb().prepare(
    'SELECT * FROM policies ORDER BY created_at DESC LIMIT ?',
  ).all(limit)
}
