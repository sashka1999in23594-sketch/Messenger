import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, passwordStrength } from './password.js';
import { cleanText, registerSchema } from './schemas.js';
import { extractHashtags, extractMentions, tokenizeText } from './text.js';

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

  it('register schema normalizes username', () => {
    const r = registerSchema.safeParse({ username: '  Alice_1 ', displayName: 'Alice', password: 'sunny-river-42-mountain' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.username).toBe('alice_1');
  });
});
