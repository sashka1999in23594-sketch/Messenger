import { describe, expect, it } from 'vitest';
import { compactNumber, duration, initials, plural } from './format';

describe('форматирование', () => {
  it('склоняет русские числительные', () => {
    expect(plural(1, 'сообщение', 'сообщения', 'сообщений')).toBe('сообщение');
    expect(plural(3, 'сообщение', 'сообщения', 'сообщений')).toBe('сообщения');
    expect(plural(11, 'сообщение', 'сообщения', 'сообщений')).toBe('сообщений');
    expect(plural(21, 'сообщение', 'сообщения', 'сообщений')).toBe('сообщение');
    expect(plural(112, 'сообщение', 'сообщения', 'сообщений')).toBe('сообщений');
  });

  it('сокращает большие числа', () => {
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1500)).toBe('1,5 тыс.');
    expect(compactNumber(25_000)).toBe('25 тыс.');
    expect(compactNumber(2_300_000)).toBe('2,3 млн');
  });

  it('форматирует длительность видео', () => {
    expect(duration(8)).toBe('0:08');
    expect(duration(125)).toBe('2:05');
    expect(duration(3725)).toBe('1:02:05');
  });

  it('берёт инициалы', () => {
    expect(initials('Алиса Котова')).toBe('АК');
    expect(initials('omni')).toBe('O');
  });
});
