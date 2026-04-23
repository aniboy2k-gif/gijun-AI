import { timingSafeEqual } from 'node:crypto'

const DUMMY = Buffer.alloc(64, 0)

/**
 * Constant-time equality for tokens.
 *
 * length 선체크가 길이 정보를 타이밍으로 유출할 수 있으므로, 길이가
 * 달라도 고정 길이 dummy 비교를 한 번 수행해 분기 타이밍 차이를 최소화한다.
 * (로컬 전용 환경이라도 README의 fail-closed 철학과 일관되게 작성.)
 *
 * 향후 v0.2에서 @gijun-ai/common-security 패키지로 이관 예정.
 */
export function safeTokenCompare(provided: string | undefined | null, expected: string): boolean {
  if (!expected) return false
  if (typeof provided !== 'string') {
    timingSafeEqual(DUMMY, DUMMY)
    return false
  }
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(DUMMY, DUMMY)
    return false
  }
  return timingSafeEqual(a, b)
}
