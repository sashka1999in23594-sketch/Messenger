/**
 * Демо-данные: пользователи, подписки, посты всех видов, комментарии, чаты,
 * каналы, сообщества и истории. Используется командой `npm run seed` и
 * автоматически при старте сервера с DEMO_SEED=true (публичное демо).
 * Все демо-аккаунты имеют пароль DEMO_PASSWORD.
 */
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPACE_PERMS } from '@omni/shared';
import type { Config } from '../config.js';
import { createServices } from '../context.js';
import { dayKey, type StatMetric } from '../modules/stats/daily.js';
import { RealtimeHub } from '../modules/realtime/hub.js';
import type { Db } from './index.js';

export const DEMO_PASSWORD = 'spaceup-demo-2026';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Возвращает false, если демо-данные уже есть. */
export async function seedDemo(db: Db, config: Config): Promise<boolean> {
  if (db.get("SELECT 1 FROM users WHERE username = 'sasha'")) return false;
  const ASSETS = [path.resolve(here, '../../seed-assets'), path.resolve(here, '../seed-assets'), path.resolve(process.cwd(), 'seed-assets')].find(existsSync);
  if (!ASSETS) throw new Error('Не найдена папка seed-assets');

  // Виртуальные часы: контент «появляется» в течение последних двух недель
  const realNow = Date.now.bind(Date);
  let clock = realNow() - 7.5 * 24 * 3600 * 1000;
  Date.now = () => clock;
  const tick = (minutes: number) => {
    clock += minutes * 60_000 + Math.floor(Math.random() * 60_000);
  };

  const hub = new RealtimeHub();
  const s = createServices(db, config, hub);
  const meta = { ip: '127.0.0.1', userAgent: 'seed', deviceName: 'Seed' };

  /** Действия, запрещённые политикой приватности (например, закрытый профиль), просто пропускаем. */
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  const upload = (owner: string, file: string, opts: { posterId?: string; durationSec?: number } = {}) =>
    s.media.store(owner, createReadStream(path.join(ASSETS, file)), opts);

  type U = { id: string; username: string };
  const users: Record<string, U> = {};
  const people = [
    ['sasha', 'Саша', 'Строю SpaceUp — мессенджер, где есть всё. Люблю чистый код и безопасность 🔐', 10],
    ['alice', 'Алиса Котова', 'Фотограф. Свет, цвет и немного магии ✨ #фото', 1],
    ['boris', 'Борис Петров', 'Backend-разработчик. TypeScript, базы данных, кофе ☕', 2],
    ['maria', 'Мария Смирнова', 'Путешествую и снимаю короткие видео о городах 🌍', 3],
    ['dmitry', 'Дмитрий Орлов', 'Музыкант и звукорежиссёр 🎧', 4],
    ['elena', 'Елена Волкова', 'Продуктовый дизайнер. Делаю интерфейсы, которые приятно трогать', 5],
    ['kirill', 'Кирилл Новиков', 'Стримлю игры и рассказываю про железо 🎮', 6],
    ['lena', 'Лена Морозова', 'Книги, кино, прогулки', 7],
    ['nikita', 'Никита Соколов', 'Научпоп: космос, физика, фракталы 🔭', 8],
    ['olga', 'Ольга Лебедева', 'Готовлю просто и вкусно. Рецепты каждый день 🍝', 9],
    ['spaceup', 'SpaceUp', 'Официальный аккаунт SpaceUp: новости, обновления, советы по безопасности.', 0],
  ] as const;

  try {
      // ── Пользователи ──────────────────────────────────────────────────────────
      for (const [i, [username, displayName, bio, avatar]] of people.entries()) {
        // Адреса из зарезервированного домена example.com: не подтверждены, писем на них не отправляем
        const phone = `+7900000${String(i + 1).padStart(4, '0')}`;
        const session = await s.auth.register({ username, displayName, email: `${username}@example.com`, phone, password: DEMO_PASSWORD }, meta, { sendVerification: false });
        s.sessions.revoke(session.userId, session.sessionId);
        users[username] = { id: session.userId, username };
        const avatarMedia = await upload(session.userId, avatar ? `avatar-${avatar}.jpg` : 'photo-12.jpg');
        const banner = await upload(session.userId, `banner-${(avatar % 3) + 1}.jpg`);
        s.users.updateProfile(session.userId, { bio, avatarMediaId: avatarMedia.id, bannerMediaId: banner.id, location: 'Москва' });
        tick(30);
      }
      db.run("UPDATE users SET verified = 1 WHERE username IN ('spaceup', 'alice', 'nikita')");
      db.run("UPDATE users SET role = 'admin' WHERE username = 'sasha'");
      s.users.updatePrivacy(users.lena!.id, { isPrivate: true });

      // ── Подписки ──────────────────────────────────────────────────────────────
      const names = Object.keys(users);
      for (const a of names) {
        for (const b of names) {
          if (a === b) continue;
          if (b === 'spaceup' || Math.random() < 0.55 || a === 'sasha') s.users.follow(users[a]!.id, users[b]!.id);
        }
      }
      s.users.answerFollowRequest(users.lena!.id, users.sasha!.id, true);

      // ── Сообщества ────────────────────────────────────────────────────────────
      const communities = {
        photo: s.communities.create(users.alice!.id, { name: 'Фотография', slug: 'photo', description: 'Делимся снимками, разбираем свет и композицию.', visibility: 'public' }),
        dev: s.communities.create(users.boris!.id, { name: 'Разработчики', slug: 'dev', description: 'Код, архитектура, безопасность и немного мемов.', visibility: 'public' }),
        travel: s.communities.create(users.maria!.id, { name: 'Путешествия', slug: 'travel', description: 'Маршруты, лайфхаки и красивые места.', visibility: 'public' }),
        food: s.communities.create(users.olga!.id, { name: 'Кулинария', slug: 'food', description: 'Рецепты и фото еды.', visibility: 'public' }),
      };
      for (const u of names) {
        for (const c of Object.values(communities)) if (Math.random() < 0.6 || u === 'sasha') s.communities.join(users[u]!.id, c.id);
      }

      // ── Заметки (как в X) ─────────────────────────────────────────────────────
      const notes: [string, string][] = [
        ['spaceup', 'Добро пожаловать в #spaceup! Чаты, лента, видео, клипы, фото и истории — в одном приложении. Начните с раздела «Мессенджер» слева 👈'],
        ['spaceup', 'Совет по #безопасность: включите двухфакторную защиту в Настройки → Безопасность → 2FA. Это занимает минуту.'],
        ['boris', 'Перевёл сервис на ULID вместо автоинкремента: сортировка по времени + не угадать соседние id. #код #безопасность'],
        ['elena', 'Хороший интерфейс — тот, который не нужно объяснять. Но хорошая навигация — та, в которой невозможно потеряться 🧭 #дизайн'],
        ['nikita', 'Фрактал Мандельброта бесконечно сложен, но задаётся одной формулой: z → z² + c. Залипательное видео у меня на канале 🔭 #наука'],
        ['maria', 'Утро в новом городе — лучшее время, чтобы гулять. Пока все спят, улицы принадлежат тебе ☀️ #путешествия'],
        ['dmitry', 'Свёл новый трек за ночь. Иногда лучшие идеи приходят в 4 утра 🎧 #музыка'],
        ['kirill', 'Сегодня стрим в 20:00 — собираем ПК за 100к и проверяем в играх 🎮'],
        ['sasha', 'Первый день SpaceUp. Цель — сделать платформу, где безопасность не мешает удобству, а удобство не ломает безопасность. #spaceup'],
        ['olga', 'Паста за 15 минут: чеснок, оливковое масло, чили, пармезан. Всё. Иногда меньше — значит больше 🍝 #еда'],
        ['boris', 'Напоминание: никогда не храните пароли в открытом виде. scrypt/argon2 + соль + постоянное время сравнения. #код #безопасность'],
        ['alice', 'Золотой час — не миф. Снимайте за час до заката, и свет сделает половину работы за вас 📸 #фото'],
        ['lena', 'Перечитываю «Мастера и Маргариту». Каждый раз — другая книга.'],
        ['elena', `Собрала гайд по тёмной теме: контраст ≥ 4.5:1, без чистого чёрного, акцент чуть светлее. @sasha, глянь для SpaceUp? #дизайн`],
        ['nikita', 'Жизнь Конвея — клеточный автомат с 4 правилами, который умеет вычислять что угодно. Тьюринг-полный! #наука'],
      ];
      const notePosts: string[] = [];
      for (const [u, text] of notes) {
        notePosts.push(s.posts.create(users[u]!.id, { kind: 'note', text, mediaIds: [], visibility: 'public', commentsDisabled: false }).id);
        tick(180);
      }

      // ── Фото (как в Instagram) ────────────────────────────────────────────────
      const photoSpec: [string, number[], string, keyof typeof communities | null][] = [
        ['alice', [1, 2], 'Цвет как настроение. Серия «Плазма» #фото #искусство', 'photo'],
        ['maria', [3], 'Закат, который не передать словами 🌅 #путешествия', 'travel'],
        ['elena', [4, 5, 6], 'Палитры для нового проекта. Какая ваша? #дизайн', null],
        ['alice', [7], 'Минимализм #фото', null],
        ['olga', [8, 9], 'Ягодный тарт — рецепт в комментариях 🍓 #еда', 'food'],
        ['maria', [10, 11], 'Северное сияние своими глазами ✨ #путешествия', null],
        ['alice', [12], 'Тишина #фото', 'photo'],
      ];
      const photoPosts: string[] = [];
      for (const [u, photos, text, community] of photoSpec) {
        const media = [];
        for (const p of photos) media.push((await upload(users[u]!.id, `photo-${p}.jpg`)).id);
        photoPosts.push(
          s.posts.create(users[u]!.id, {
            kind: 'photo',
            text,
            mediaIds: media,
            visibility: 'public',
            commentsDisabled: false,
            communityId: community ? communities[community].id : undefined,
          }).id,
        );
        tick(240);
      }

      // ── Видео (как в YouTube) ─────────────────────────────────────────────────
      const videoSpec: [string, number, string, string, number][] = [
        ['nikita', 1, 'Погружение в фрактал Мандельброта', 'Бесконечная сложность из одной формулы. Смотрим, как устроен самый знаменитый фрактал. #наука #математика', 12],
        ['nikita', 2, 'Игра «Жизнь» Конвея за 8 секунд', 'Клеточный автомат, который умеет считать. #наука', 8],
        ['elena', 3, 'Градиенты в интерфейсах: как не переборщить', 'Разбираем, когда градиент помогает, а когда мешает. #дизайн', 12],
        ['boris', 4, 'Правило 110: компьютер из клеток', 'Самый простой Тьюринг-полный автомат. #код #наука', 12],
        ['kirill', 5, 'Тест-таблица: проверяем монитор', 'Как проверить цвета, резкость и задержку монитора без программ. #железо', 10],
      ];
      const videoPosts: string[] = [];
      for (const [u, n, title, text, dur] of videoSpec) {
        const poster = await upload(users[u]!.id, `video-${n}-poster.jpg`);
        const video = await upload(users[u]!.id, `video-${n}.mp4`, { posterId: poster.id, durationSec: dur });
        videoPosts.push(s.posts.create(users[u]!.id, { kind: 'video', title, text, mediaIds: [video.id], visibility: 'public', commentsDisabled: false }).id);
        tick(300);
      }

      // ── Клипы (как в TikTok) ──────────────────────────────────────────────────
      const shortSpec: [string, number, string, number][] = [
        ['maria', 1, 'Когда дизайнер увидел новую палитру 🎨 #клипы', 8],
        ['nikita', 2, 'Зум в бесконечность 🌀 #наука', 8],
        ['kirill', 3, 'Жизнь на экране 🟩 #клипы', 6],
        ['dmitry', 4, 'Визуализация под мой новый трек 🎧 #музыка', 8],
        ['elena', 5, 'Спираль гипнотизирует 😵‍💫 #дизайн', 8],
      ];
      const shortPosts: string[] = [];
      for (const [u, n, text, dur] of shortSpec) {
        const poster = await upload(users[u]!.id, `short-${n}-poster.jpg`);
        const video = await upload(users[u]!.id, `short-${n}.mp4`, { posterId: poster.id, durationSec: dur });
        shortPosts.push(s.posts.create(users[u]!.id, { kind: 'short', text, mediaIds: [video.id], visibility: 'public', commentsDisabled: false }).id);
        tick(200);
      }

      // Пост в сообщество разработчиков
      s.posts.create(users.boris!.id, {
        kind: 'note',
        text: 'Чек-лист безопасного API: валидация всех входов, CSRF, rate limit, httpOnly cookies, CSP, логирование входов. Что добавить? #код',
        mediaIds: [],
        visibility: 'public',
        commentsDisabled: false,
        communityId: communities.dev.id,
      });

      // ── Реакции: лайки, просмотры, комментарии, репосты ──────────────────────
      const allPosts = [...notePosts, ...photoPosts, ...videoPosts, ...shortPosts];
      for (const pid of allPosts) {
        for (const u of names) {
          if (Math.random() < 0.45) attempt(() => s.posts.like(users[u]!.id, pid, true));
          if (Math.random() < 0.7) attempt(() => s.posts.view(users[u]!.id, pid, Math.random() * 8));
        }
      }
      db.run("UPDATE posts SET view_count = view_count * 37 + abs(random() % 500) WHERE kind IN ('video', 'short')");

      const commentLines = [
        'Огонь 🔥',
        'Очень красиво!',
        'Сохранил, спасибо 🙏',
        'А можно подробнее?',
        'Полностью согласен',
        'Вау, как это сделано?',
        'Лучшее, что видел сегодня',
        'Подписался 👍',
      ];
      for (const pid of allPosts) {
        const n = Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const author = names[Math.floor(Math.random() * names.length)]!;
          tick(5);
          const c = attempt(() => s.comments.create(users[author]!.id, pid, { text: commentLines[Math.floor(Math.random() * commentLines.length)]! }));
          if (!c) continue;
          if (Math.random() < 0.5) {
            const replier = names[Math.floor(Math.random() * names.length)]!;
            attempt(() => s.comments.create(users[replier]!.id, pid, { text: 'Согласен! ' + commentLines[Math.floor(Math.random() * commentLines.length)]!, parentId: c.id }));
          }
          if (Math.random() < 0.6) attempt(() => s.comments.like(users.sasha!.id, c.id, true));
        }
      }
      s.comments.create(users.olga!.id, photoPosts[4]!, { text: 'Рецепт: 200 г муки, 100 г масла, 1 яйцо, ягоды, 2 ст. л. сахара. 180°, 25 минут 🍓' });
      s.posts.create(users.sasha!.id, { kind: 'note', text: '', mediaIds: [], visibility: 'public', commentsDisabled: false, repostOfId: notePosts[3]! });
      s.posts.create(users.boris!.id, { kind: 'note', text: 'Подписываюсь под каждым словом 👇', mediaIds: [], visibility: 'public', commentsDisabled: false, repostOfId: notePosts[1]! });
      s.posts.bookmark(users.sasha!.id, videoPosts[0]!, true);
      s.posts.bookmark(users.sasha!.id, notePosts[10]!, true);
      s.posts.watchLater(users.sasha!.id, videoPosts[2]!, true);
      const pl = s.posts.createPlaylist(users.sasha!.id, { title: 'Наука и фракталы', description: 'Залипательные видео', isPublic: true });
      s.posts.playlistItem(users.sasha!.id, pl.id, videoPosts[0]!, true);
      s.posts.playlistItem(users.sasha!.id, pl.id, videoPosts[1]!, true);
      s.posts.playlistItem(users.sasha!.id, pl.id, videoPosts[3]!, true);

      // ── Чаты ──────────────────────────────────────────────────────────────────
      let cid = 0;
      const say = (u: string, chatId: string, text: string, replyToId?: string) => {
        tick(2);
        return s.chats.send(users[u]!.id, chatId, { clientId: `seed-${String(cid++).padStart(8, '0')}`, text, mediaIds: [], replyToId });
      };

      clock = realNow() - 2 * 24 * 3600 * 1000;
      const dmAlice = s.chats.getOrCreateDirect(users.sasha!.id, users.alice!.id);
      say('sasha', dmAlice.id, 'Привет! Как тебе новый SpaceUp?');
      const a1 = say('alice', dmAlice.id, 'Привет! Очень нравится, особенно что фото и чаты в одном месте 📸');
      say('alice', dmAlice.id, 'А секретные чаты правда шифруются на устройстве?');
      say('sasha', dmAlice.id, 'Да! Ключи создаются в браузере, сервер видит только шифротекст. Попробуй: профиль → «Секретный чат» 🔐', a1.id);
      const lastAlice = say('alice', dmAlice.id, 'Супер, вечером попробую. Скину фотки со съёмки!');
      s.chats.react(users.sasha!.id, dmAlice.id, lastAlice.id, '❤️');
      const photo = await upload(users.alice!.id, 'photo-7.jpg');
      tick(3);
      s.chats.send(users.alice!.id, dmAlice.id, { clientId: 'seed-photo-0000001', text: 'Вот одна из них', mediaIds: [photo.id] });

      const dmBoris = s.chats.getOrCreateDirect(users.boris!.id, users.sasha!.id);
      say('boris', dmBoris.id, 'Саш, глянул миграции — всё ок. Добавил индекс на сообщения по сроку жизни.');
      say('sasha', dmBoris.id, 'Отлично, спасибо! Тесты зелёные?');
      say('boris', dmBoris.id, 'Все 20 проходят ✅ Включая CSRF и блокировку перебора');

      const team = s.chats.createGroup(users.sasha!.id, {
        title: 'Команда SpaceUp',
        description: 'Рабочий чат команды',
        memberIds: [users.boris!.id, users.elena!.id, users.kirill!.id, users.nikita!.id],
      });
      say('sasha', team.id, 'Всем привет! Здесь обсуждаем запуск 🚀');
      say('elena', team.id, 'Закинула макеты новой навигации — дерево разделов слева + быстрый поиск по Ctrl+K');
      say('boris', team.id, 'API для чатов готово: личные, группы, каналы, секретные. Реакции и пересылка тоже.');
      const k = say('kirill', team.id, 'Проверил на телефоне — нижняя панель вкладок удобная 👍');
      s.chats.react(users.elena!.id, team.id, k.id, '🔥');
      s.chats.react(users.sasha!.id, team.id, k.id, '🔥');
      say('nikita', team.id, 'Когда добавим звонки?');
      say('sasha', team.id, 'Звонки — следующий этап (WebRTC). Фундамент под них уже заложен 😉');
      s.chats.pin(users.sasha!.id, team.id, k.id);

      const travel = s.chats.createGroup(users.maria!.id, { title: 'Путешествия 2026 ✈️', description: '', memberIds: [users.sasha!.id, users.lena!.id] });
      say('maria', travel.id, 'Куда едем летом? Предлагаю Алтай');
      say('lena', travel.id, 'Я за! Только без палаток 😅');

      const news = s.chats.createChannel(users.spaceup!.id, { title: 'SpaceUp Новости', description: 'Официальный канал: обновления и советы по безопасности', handle: 'spaceup_news', isPublic: true });
      for (const u of names) if (u !== 'spaceup') s.chats.join(users[u]!.id, news.id);
      say('spaceup', news.id, '🎉 SpaceUp открыт! Чаты и звонки, каналы, лента, кометы, компании и сообщества — в одном приложении.');
      say('spaceup', news.id, '🔐 Новое: секретные чаты со сквозным шифрованием (ECDH P-256 + AES-GCM). Ключи не покидают ваше устройство.');
      say('spaceup', news.id, '🛡 Советуем включить 2FA и проверить список активных сеансов в настройках безопасности.');

      const code = s.chats.createChannel(users.boris!.id, { title: 'Код и кофе ☕', description: 'Заметки бэкенд-разработчика', handle: 'code_coffee', isPublic: true });
      s.chats.join(users.sasha!.id, code.id);
      say('boris', code.id, 'Почему мы храним в базе только хэш токена сессии: если база утечёт, токены бесполезны.');

      // ── Компания и сообщество ─────────────────────────────────────────────────
      const company = s.spaces.create(users.sasha!.id, { kind: 'company', name: 'Орбита Студио', description: 'Делаем SpaceUp: продукт, дизайн и разработка', isPublic: false });
      for (const u of ['alice', 'boris', 'maria', 'kirill'] as const) {
        const inv = s.spaces.invite(users.sasha!.id, company.id, users[u]!.id);
        s.spaces.respond(users[u]!.id, inv.id, true);
      }
      const devRole = s.spaces.createRole(users.sasha!.id, company.id, { name: 'Разработка', color: '#57f287', permissions: SPACE_PERMS.announce });
      const designRole = s.spaces.createRole(users.sasha!.id, company.id, { name: 'Дизайн', color: '#eb459e', permissions: 0 });
      const headRole = company.roles.find((r) => r.name === 'Руководитель отдела')!;
      s.spaces.setMemberRoles(users.sasha!.id, company.id, users.boris!.id, [devRole.id, headRole.id]);
      s.spaces.setMemberRoles(users.sasha!.id, company.id, users.kirill!.id, [devRole.id]);
      s.spaces.setMemberRoles(users.sasha!.id, company.id, users.alice!.id, [designRole.id]);
      const depts = s.spaces.createCategory(users.sasha!.id, company.id, { name: 'Отделы' });
      const devRoom = s.spaces.createRoom(users.sasha!.id, company.id, { title: 'разработка', description: 'Бэкенд, фронтенд, релизы', kind: 'group', categoryId: depts.id, roleIds: [devRole.id], isPublic: false });
      s.spaces.createRoom(users.sasha!.id, company.id, { title: 'дизайн', description: 'Макеты и ревью', kind: 'group', categoryId: depts.id, roleIds: [designRole.id], isPublic: false });
      const coGeneral = company.rooms.find((r) => r.chat.type === 'group')!.chat.id;
      const coNews = company.rooms.find((r) => r.chat.type === 'channel')!.chat.id;
      say('sasha', coNews, 'Добро пожаловать в «Орбита Студио»! Здесь — важные объявления, обсуждения — в #общий.');
      say('sasha', coGeneral, 'Всем привет! Планёрка в понедельник в 11:00 🚀');
      say('alice', coGeneral, 'Принесу новые макеты главной');
      say('boris', devRoom.chat.id, 'Выкатил комментарии в каналах, посмотрите на стенде');
      say('kirill', devRoom.chat.id, 'Смотрю. Просмотры считаются один раз на человека — проверил 👍');

      // Приглашение, которое ждёт ответа: так выглядит приглашение в уведомлениях
      const cafe = s.spaces.create(users.olga!.id, { kind: 'company', name: 'Кофейня «Комета»', description: 'Команда кофейни', isPublic: false });
      s.spaces.invite(users.olga!.id, cafe.id, users.sasha!.id);

      const astro = s.spaces.create(users.elena!.id, { kind: 'community', name: 'Астрономия', description: 'Наблюдения, телескопы и фото звёздного неба', isPublic: true });
      const astroGroups = s.spaces.createCategory(users.elena!.id, astro.id, { name: 'Темы' });
      const sky = s.spaces.createRoom(users.elena!.id, astro.id, { title: 'Наблюдения', description: 'Что видно сегодня', kind: 'group', categoryId: astroGroups.id, roleIds: [], isPublic: true });
      s.spaces.createRoom(users.elena!.id, astro.id, { title: 'Телескопы', description: 'Выбор и настройка', kind: 'group', categoryId: astroGroups.id, roleIds: [], isPublic: true });
      s.spaces.createRoom(users.elena!.id, astro.id, { title: 'Новости космоса', description: '', kind: 'channel', categoryId: astroGroups.id, roleIds: [], isPublic: true });
      for (const u of ['sasha', 'alice', 'nikita', 'kirill'] as const) {
        s.spaces.join(users[u]!.id, astro.id);
        s.chats.join(users[u]!.id, sky.chat.id);
      }
      say('elena', sky.chat.id, 'Сегодня отлично видно Сатурн — после 22:00 на юго-востоке 🪐');
      say('nikita', sky.chat.id, 'Поймал кольца даже в бинокль!');

      const saved = s.chats.getOrCreateSaved(users.sasha!.id);
      say('sasha', saved.id, 'Идеи: голосовые сообщения, звонки, стикеры, папки чатов, боты 💡');
      say('sasha', saved.id, 'Не забыть: настроить HTTPS и бэкапы базы перед запуском');

      // ── Истории ───────────────────────────────────────────────────────────────
      clock = realNow() - 6 * 3600 * 1000;
      for (const [u, file] of [
        ['alice', 'photo-1.jpg'],
        ['maria', 'short-1.mp4'],
        ['elena', 'photo-5.jpg'],
        ['kirill', 'short-3.mp4'],
        ['nikita', 'short-2.mp4'],
        ['olga', 'photo-9.jpg'],
      ] as const) {
        const m = await upload(users[u]!.id, file, file.endsWith('.mp4') ? { durationSec: 8 } : {});
        s.stories.create(users[u]!.id, { mediaId: m.id, text: u === 'olga' ? 'Сегодня на ужин 🍓' : undefined, audience: 'all', allowReplies: true });
        tick(40);
      }
      s.stories.view(users.sasha!.id, s.stories.ofUser(users.sasha!.id, users.alice!.id)[0]!.id);

      // «Близкие друзья»: alice показывает историю только им, sasha в списке
      s.stories.setCloseFriend(users.alice!.id, users.sasha!.id, true);
      s.stories.setCloseFriend(users.sasha!.id, users.alice!.id, true);
      s.stories.setCloseFriend(users.sasha!.id, users.boris!.id, true);
      const cf = await upload(users.alice!.id, 'photo-3.jpg');
      s.stories.create(users.alice!.id, { mediaId: cf.id, text: 'Только для своих 💚', audience: 'close', allowReplies: true });

      // Истории sasha: одна «вчерашняя» (уже в архиве) и одна свежая — обе в «Актуальном»
      clock = realNow() - 30 * 3600 * 1000;
      const old1 = await upload(users.sasha!.id, 'photo-7.jpg');
      const oldStory = s.stories.create(users.sasha!.id, { mediaId: old1.id, text: 'Как всё начиналось', audience: 'all', allowReplies: true });
      clock = realNow() - 2 * 3600 * 1000;
      const new1 = await upload(users.sasha!.id, 'photo-11.jpg');
      const freshStory = s.stories.create(users.sasha!.id, { mediaId: new1.id, text: 'SpaceUp 1.0 скоро 🚀', audience: 'all', allowReplies: true });
      s.stories.createHighlight(users.sasha!.id, { title: 'SpaceUp', storyIds: [oldStory.id, freshStory.id], coverStoryId: freshStory.id });
      s.stories.view(users.alice!.id, freshStory.id);
      s.stories.view(users.boris!.id, freshStory.id);
      s.stories.react(users.alice!.id, freshStory.id, '🔥');

      // Профиль: статус, ссылки, закреплённая публикация, «колокольчик»
      s.users.setStatus(users.sasha!.id, { emoji: '🚀', text: 'Запускаю SpaceUp', durationHours: 0 });
      s.users.setStatus(users.alice!.id, { emoji: '📸', text: 'На съёмке до вечера', durationHours: 0 });
      s.users.setLinks(users.sasha!.id, [
        { title: 'GitHub', url: 'https://github.com/' },
        { title: 'Блог', url: 'https://example.com/blog' },
      ]);
      s.users.pinPost(users.sasha!.id, notePosts[notes.findIndex(([u]) => u === 'sasha')]!);
      s.users.subscribe(users.sasha!.id, users.alice!.id, true);

      // Списки, коллекции, черновики
      const devs = s.lists.create(users.sasha!.id, { name: 'Разработка', description: 'Код, безопасность и дизайн', emoji: '🧑‍💻', isPrivate: false });
      s.lists.addMembers(users.sasha!.id, devs.id, [users.boris!.id, users.elena!.id, users.nikita!.id]);
      const ideas = s.collections.create(users.sasha!.id, { name: 'Идеи для SpaceUp', emoji: '💡' });
      for (const pid of [notePosts[6]!, notePosts[4]!, photoPosts[0]!]) s.collections.setItem(users.sasha!.id, ideas.id, pid, true);
      s.drafts.create(users.sasha!.id, {
        kind: 'note',
        text: 'Черновик: рассказать про звонки и папки в SpaceUp…',
        mediaIds: [],
        visibility: 'public',
        commentsDisabled: false,
      });


    // Канал Саши — чтобы в «Статистике» было что показать
    const mine = s.chats.createChannel(users.sasha!.id, { title: 'Заметки разработчика', description: 'Как мы делаем SpaceUp', handle: 'sasha_dev', isPublic: true });
    for (const u of names) if (u !== 'sasha' && u !== 'spaceup') s.chats.join(users[u]!.id, mine.id);
    say('sasha', mine.id, 'Запустили каналы как в Telegram: реакции, комментарии и честные просмотры 👀');
    say('sasha', mine.id, 'Следующее — статистика с графиками роста, как курс на бирже 📈');

    // Демо-история статистики за 90 дней: случайное блуждание, которое
    // сходится к текущим числам (ряды строятся назад от них)
    Date.now = realNow;
    const seedSeries = (gainedMetric: StatMetric, lostMetric: StatMetric, entityId: string, current: number) => {
      // Идём от сегодняшнего значения назад: в среднем рост, но с отписками
      const n = 90;
      const drift = (current * 0.7) / n;
      let v = current;
      for (let i = n - 1; i >= 0; i--) {
        let g = Math.random() < 0.3 + drift ? 1 + (Math.random() < 0.15 ? 1 : 0) : 0;
        const l = Math.random() < 0.28 ? 1 : 0;
        if (v - g + l < 0) g = v + l;
        v = v - g + l;
        const day = dayKey(realNow() - (n - 1 - i) * 86_400_000);
        if (g) db.run('INSERT OR REPLACE INTO stat_daily (metric, entity_id, day, value) VALUES (:m, :e, :d, :v)', { m: gainedMetric, e: entityId, d: day, v: g });
        if (l) db.run('INSERT OR REPLACE INTO stat_daily (metric, entity_id, day, value) VALUES (:m, :e, :d, :v)', { m: lostMetric, e: entityId, d: day, v: l });
      }
    };
    const followers = db.value<number>("SELECT COUNT(*) FROM follows WHERE followee_id = :u AND status = 'accepted'", { u: users.sasha!.id }) ?? 0;
    db.run("DELETE FROM stat_daily WHERE entity_id = :u AND metric IN ('followers_gained', 'followers_lost')", { u: users.sasha!.id });
    seedSeries('followers_gained', 'followers_lost', users.sasha!.id, followers);
    const subs = db.value<number>('SELECT member_count FROM chats WHERE id = :c', { c: mine.id }) ?? 0;
    db.run("DELETE FROM stat_daily WHERE entity_id = :c AND metric IN ('channel_joins', 'channel_leaves')", { c: mine.id });
    seedSeries('channel_joins', 'channel_leaves', mine.id, subs);
    for (let i = 1; i < 90; i++) {
      const day = dayKey(realNow() - i * 86_400_000);
      const views = Math.round(20 + 15 * Math.sin(i / 6) + Math.random() * 25 + (90 - i) * 0.6);
      db.run("INSERT OR REPLACE INTO stat_daily (metric, entity_id, day, value) VALUES ('channel_views', :c, :d, :v)", { c: mine.id, d: day, v: views });
      const pv = Math.round(6 + Math.random() * 14 + (90 - i) * 0.15);
      db.run("INSERT OR REPLACE INTO stat_daily (metric, entity_id, day, value) VALUES ('profile_views', :u, :d, :v)", { u: users.sasha!.id, d: day, v: pv });
    }

    // Демо-аккаунты сразу готовы к работе — без экранов знакомства
    db.run('UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL');
  } finally {
    Date.now = realNow;
  }
  return true;
}
