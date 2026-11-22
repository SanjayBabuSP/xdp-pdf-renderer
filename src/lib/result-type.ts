import { Result } from '../types';
import type { ErrorCode } from '../errors/error-codes';

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure(
  code: ErrorCode,
  message: string,
  details?: string[],
  hint?: string
): Result<never> {
  return { success: false, error: { code, message, details, hint } };
}
