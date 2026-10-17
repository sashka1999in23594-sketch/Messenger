/** Машиночитаемые коды ошибок API. Клиент показывает текст по коду, а не по HTTP-статусу. */
export const ErrorCode = {
  Validation: 'VALIDATION_ERROR',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RateLimited: 'RATE_LIMITED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  AccountLocked: 'ACCOUNT_LOCKED',
  TwoFactorRequired: 'TWO_FACTOR_REQUIRED',
  TwoFactorInvalid: 'TWO_FACTOR_INVALID',
  Csrf: 'CSRF_FAILED',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  UnsupportedMedia: 'UNSUPPORTED_MEDIA',
  PrivacyRestricted: 'PRIVACY_RESTRICTED',
  Blocked: 'BLOCKED',
  WeakPassword: 'WEAK_PASSWORD',
  EmailCodeInvalid: 'EMAIL_CODE_INVALID',
  MailUnavailable: 'MAIL_UNAVAILABLE',
  Internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Ошибки валидации по полям: { "password": "Слишком короткий" } */
    fields?: Record<string, string>;
    /** Через сколько секунд можно повторить (для RATE_LIMITED / ACCOUNT_LOCKED) */
    retryAfter?: number;
  };
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Проверьте правильность заполнения полей',
  UNAUTHORIZED: 'Нужно войти в аккаунт',
  FORBIDDEN: 'Недостаточно прав',
  NOT_FOUND: 'Не найдено',
  CONFLICT: 'Конфликт данных',
  RATE_LIMITED: 'Слишком много запросов. Подождите немного',
  INVALID_CREDENTIALS: 'Неверное имя пользователя или пароль',
  ACCOUNT_LOCKED: 'Слишком много попыток входа. Попробуйте позже',
  TWO_FACTOR_REQUIRED: 'Требуется код двухфакторной аутентификации',
  TWO_FACTOR_INVALID: 'Неверный код подтверждения',
  CSRF_FAILED: 'Запрос отклонён системой защиты. Обновите страницу',
  PAYLOAD_TOO_LARGE: 'Файл слишком большой',
  UNSUPPORTED_MEDIA: 'Этот тип файла не поддерживается',
  PRIVACY_RESTRICTED: 'Настройки приватности пользователя не позволяют это сделать',
  BLOCKED: 'Действие недоступно: пользователь в чёрном списке',
  WEAK_PASSWORD: 'Пароль слишком простой',
  EMAIL_CODE_INVALID: 'Неверный или устаревший код из письма',
  MAIL_UNAVAILABLE: 'Отправка писем на сервере не настроена',
  INTERNAL_ERROR: 'Что-то пошло не так. Мы уже разбираемся',
};
