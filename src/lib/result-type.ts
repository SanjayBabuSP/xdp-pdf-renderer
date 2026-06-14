import { Result } from '../types';

// Every domain function returns one of these. Never throw for business logic.

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure(code: string, message: string, details?: string[]): Result<never> {
  return { success: false, error: { code, message, details } };
}
