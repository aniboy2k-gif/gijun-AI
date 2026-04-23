import { getDb } from '../db/client.js'

export function listPolicies(activeOnly = true): unknown[] {
  if (activeOnly) {
    return getDb().prepare('SELECT * FROM policies WHERE is_active = 1 ORDER BY created_at DESC').all()
  }
  return getDb().prepare('SELECT * FROM policies ORDER BY created_at DESC').all()
}
