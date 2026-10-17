import { ERROR_MESSAGES, ErrorCode } from '@omni/shared';
import type { ZodError, ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message?: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
  }
}

export const badRequest = (message?: string, fields?: Record<string, string>) =>
  new AppError(400, ErrorCode.Validation, message, fields);
export const unauthorized = (message?: string) => new AppError(401, ErrorCode.Unauthorized, message);
export const forbidden = (message?: string) => new AppError(403, ErrorCode.Forbidden, message);
export const notFound = (message = 'Не найдено') => new AppError(404, ErrorCode.NotFound, message);
export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, ErrorCode.Conflict, message, fields);
export const privacyRestricted = (message?: string) => new AppError(403, ErrorCode.PrivacyRestricted, message);
export const blocked = () => new AppError(403, ErrorCode.Blocked);

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Валидирует данные схемой; при ошибке — 400 с описанием полей. */
export function parse<S extends ZodType>(schema: S, data: unknown): S['_output'] {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw badRequest(undefined, zodFields(result.error));
  return result.data;
}
