export const ErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  HITL_REQUIRED: 'HITL_REQUIRED',
  POLICY_OVERFLOW: 'POLICY_OVERFLOW',
  VALIDATION: 'VALIDATION',
  INVALID_STATE: 'INVALID_STATE',
} as const

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode]

export class CodedError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'CodedError'
  }
}
