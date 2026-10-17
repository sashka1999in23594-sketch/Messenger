/**
 * Политика паролей (по мотивам NIST SP 800-63B): длина важнее «спецсимволов»,
 * запрет самых распространённых паролей и паролей, совпадающих с именем.
 */
import { LIMITS } from './constants.js';

/** Небольшой список самых частых паролей. В production — проверка по HIBP (k-anonymity). */
const COMMON_PASSWORDS = new Set([
  '123456789012', '1234567890', '12345678910', 'qwertyuiop', 'qwerty123456', 'password123',
  'password1234', 'passwordpassword', '1q2w3e4r5t', '1q2w3e4r5t6y', 'zaq12wsxcde', 'iloveyou123',
  'qwertyqwerty', 'asdfghjkl1', 'abc123456789', 'aaaaaaaaaa', '0000000000', '1111111111',
  'qwerty12345', 'admin12345', 'administrator', 'letmein1234', 'welcome1234', 'monkey12345',
  'dragon12345', 'football123', 'baseball123', 'princess123', 'sunshine123', 'superman123',
  'trustno1234', 'starwars123', 'michael1234', 'computer123', 'whatever123', 'йцукенгшщз',
  'пароль12345', 'парольпароль', 'qwerty1234567', '987654321098', '1qaz2wsx3edc', 'q1w2e3r4t5y6',
]);

/** Возвращает текст проблемы или null, если пароль подходит. */
export function checkPasswordPolicy(password: string, personal: string[] = []): string | null {
  if (password.length < LIMITS.passwordMin) return `Минимум ${LIMITS.passwordMin} символов`;
  if (password.length > LIMITS.passwordMax) return `Не более ${LIMITS.passwordMax} символов`;
  if (password.trim().length === 0) return 'Пароль не может состоять из пробелов';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Этот пароль слишком распространён';
  if (new Set(lower).size < 4) return 'Слишком мало разных символов';
  for (const p of personal) {
    const v = p.trim().toLowerCase();
    if (v.length >= 3 && lower.includes(v)) return 'Пароль не должен содержать ваше имя';
  }
  if (/^(.)\1+$/.test(password)) return 'Пароль из одного повторяющегося символа';
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(password) && password.length < 14) {
    return 'Слишком предсказуемая последовательность';
  }
  return null;
}

/** Оценка надёжности 0..4 для индикатора в интерфейсе (не заменяет проверку на сервере). */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let classes = 0;
  if (/[a-zа-яё]/.test(password)) classes++;
  if (/[A-ZА-ЯЁ]/.test(password)) classes++;
  if (/\d/.test(password)) classes++;
  if (/[^\p{L}\p{N}]/u.test(password)) classes++;
  const unique = new Set(password).size;
  let score = 0;
  if (password.length >= LIMITS.passwordMin) score++;
  if (password.length >= 14) score++;
  if (password.length >= 20) score++;
  if (classes >= 3 && unique >= 8) score++;
  if (checkPasswordPolicy(password)) score = Math.min(score, 1);
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
