import { timingSafeEqual } from 'node:crypto'

const DUMMY = Buffer.alloc(64, 0)
const GRACE_MS = 5000

let currentToken: string | undefined = (process.env['AGENTGUARD_TOKEN'] || undefined)
let rotatedAt: string = new Date().toISOString()
let previousToken: string | undefined
let previousExpiresAtMs = 0
let rotateInFlight = false

function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(DUMMY, DUMMY)
    return false
  }
  return timingSafeEqual(a, b)
}

export function getCurrentToken(): string | undefined {
  return currentToken
}

export function isTokenValid(provided: string | undefined | null): boolean {
  if (typeof provided !== 'string' || provided.length === 0) {
    timingSafeEqual(DUMMY, DUMMY)
    return false
  }
  if (currentToken && safeCompare(provided, currentToken)) return true
  if (previousToken && Date.now() < previousExpiresAtMs && safeCompare(provided, previousToken)) {
    return true
  }
  return false
}

function maskToken(token: string | undefined): string {
  if (!token || token.length < 8) return '****'
  return '****' + token.slice(-5)
}

export function getTokenMetadata(): { rotated_at: string; masked: string } {
  return { rotated_at: rotatedAt, masked: maskToken(currentToken) }
}

export function rotateToken(newToken: string): { rotated_at: string } {
  previousToken = currentToken
  previousExpiresAtMs = Date.now() + GRACE_MS
  currentToken = newToken
  rotatedAt = new Date().toISOString()
  return { rotated_at: rotatedAt }
}

export function acquireRotateLock(): boolean {
  if (rotateInFlight) return false
  rotateInFlight = true
  return true
}

export function releaseRotateLock(): void {
  rotateInFlight = false
}

export function _resetForTests(token?: string): void {
  currentToken = token ?? (process.env['AGENTGUARD_TOKEN'] || undefined)
  rotatedAt = new Date().toISOString()
  previousToken = undefined
  previousExpiresAtMs = 0
  rotateInFlight = false
}
