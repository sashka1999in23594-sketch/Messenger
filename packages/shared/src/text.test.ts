import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, passwordStrength } from './password.js';
import { cleanText, registerSchema } from './schemas.js';
import { extractHashtags, extractMentions, formatPhone, normalizePhone, tokenizeText } from './text.js';

describe('text', () => {
  it('extracts hashtags in any language, ignores numbers and html entities', () => {
    expect(extractHashtags('Привет #Мир и #hello_world, #123 &#39;')).toEqual(['мир', 'hello_world']);
  });

  it('extracts mentions, ignores emails', () => {
    expect(extractMentions('hi @Alice and @bob_1, mail me a@example.com')).toEqual(['alice', 'bob_1']);
  });

  it('tokenizes only http(s) links', () => {
    const tokens = tokenizeText('see https://example.com/x. and javascript:alert(1) #tag @user');
    expect(tokens.map((t) => t.type)).toEqual(['text', 'url', 'text', 'hashtag', 'text', 'mention']);
    expect(tokens[1]).toMatchObject({ href: 'https://example.com/x' });
  });

  it('strips bidi overrides and control chars but keeps emoji ZWJ sequences', () => {
    expect(cleanText('a‮b\u0007c')).toBe('abc');
    expect(cleanText('👨‍👩‍👧')).toBe('👨‍👩‍👧');
  });
});

describe('password policy', () => {
  it('rejects short, common and personal passwords', () => {
    expect(checkPasswordPolicy('short')).not.toBeNull();
    expect(checkPasswordPolicy('password123')).not.toBeNull();
    expect(checkPasswordPolicy('alice-is-great', ['alice'])).not.toBeNull();
    expect(checkPasswordPolicy('correct horse battery staple')).toBeNull();
  });

  it('scores strength', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('Tr0ub4dor&3-Long-Phrase')).toBeGreaterThanOrEqual(3);
  });

  it('register schema normalizes username and email', () => {
    const r = registerSchema.safeParse({ username: '  Alice_1 ', displayName: 'Алиса', email: ' Alice@Example.COM ', phone: '8 (999) 123-45-67', password: 'correct-horse-battery-staple' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.username).toBe('alice_1');
      expect(r.data.email).toBe('alice@example.com');
      expect(r.data.phone).toBe('+79991234567');
    }
    expect(registerSchema.safeParse({ username: 'bob_1', displayName: 'Bob', email: 'not-an-email', phone: '+79991234567', password: 'correct-horse-battery-staple' }).success).toBe(false);
    expect(registerSchema.safeParse({ username: 'bob_1', displayName: 'Bob', email: 'bob@example.com', phone: '12345', password: 'correct-horse-battery-staple' }).success).toBe(false);
  });

  it('phone numbers are normalized to E.164', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizePhone('89991234567')).toBe('+79991234567');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('not a phone')).toBeNull();
    expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67');
  });
});
