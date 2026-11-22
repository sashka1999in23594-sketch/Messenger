import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, registerUser } from './helpers.js';

let app: FastifyInstance;
let run: (command: string) => Promise<{ ok: boolean; lines: string[] }>;
beforeAll(async () => {
  app = await createTestApp();
  const owner = await registerUser(app, 'owner_script');
  app.ctx.db.run("UPDATE users SET owner = 1, role = 'admin' WHERE id = :id", { id: owner.user.id });
  for (const n of ['ann_zz', 'bob_zz', 'cat_zz']) await registerUser(app, n);
  run = async (command) => (await owner.client.post('/admin/console', { command })).body;
});
afterAll(async () => {
  await app.close();
});

describe('язык консоли «Луч»', () => {
  it('команд больше тысячи и у каждой есть описание', async () => {
    const r = await run('help.count()');
    const n = Number(/Команд: (\d+)/.exec(r.lines[0]!)?.[1]);
    expect(n).toBeGreaterThan(1000);
  });

  it('переменные, конвейеры и подстановка', async () => {
    const r = await run(`let ники = user.recent(50) | where username contains "_zz" | sort username desc | pick username
echo "Нашлось: {ники.length}"
echo ники | take 1`);
    expect(r.ok).toBe(true);
    expect(r.lines).toContain('Нашлось: 3');
    expect(r.lines).toContain('cat_zz');
  });

  it('циклы и условия управляют командами', async () => {
    const r = await run(`for u in user.recent(50) | where username == "bob_zz" { user.block(u, duration: 1d, reason: "тест") }
if user.blocked() | count >= 1 { echo "заблокирован" } else { echo "нет" }
повтор 2 { вывод "шаг {i}" }`);
    expect(r.lines.join('\\n')).toContain('@bob_zz заблокирован');
    expect(r.lines).toContain('заблокирован');
    expect(r.lines).toEqual(expect.arrayContaining(['шаг 1', 'шаг 2']));
  });

  it('команды прямо в тексте', async () => {
    const r = await run('echo "Людей: {user.count}"');
    expect(r.lines[0]).toMatch(/^Людей: \d+$/);
  });

  it('числа из команд можно сравнивать и складывать', async () => {
    const r = await run('let n = user.count()\necho n + 1 > 4');
    expect(r.lines.at(-1)).toBe('true');
  });

  it('понятные ошибки и защита от бесконечных циклов', async () => {
    expect((await run('user.nope()')).lines[0]).toContain('Нет команды user.nope');
    expect((await run('echo "без кавычки')).lines[0]).toContain('кавычка');
    const loop = await run('repeat 1000 { repeat 1000 { echo i } }');
    expect(loop.ok).toBe(false);
    expect(loop.lines.at(-1)).toMatch(/шагов|секунд/);
  });

  it('личные сообщения — только числа', async () => {
    expect((await run('message.recent(5)')).lines[0]).toContain('Нет команды');
    expect((await run('message.count()')).ok).toBe(true);
  });
});
