/**
 * Демо-данные: пользователи, подписки, посты всех видов, комментарии, чаты,
 * каналы, сообщества и истории. Используется командой `npm run seed` и
 * автоматически при старте сервера с DEMO_SEED=true (публичное демо).
 * Все демо-аккаунты имеют пароль DEMO_PASSWORD.
 */
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';
import { createServices } from '../context.js';
import { RealtimeHub } from '../modules/realtime/hub.js';
import type { Db } from './index.js';

export const DEMO_PASSWORD = 'omni-demo-2026';

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
    ['sasha', 'Саша', 'Строю Omni — мессенджер, где есть всё. Люблю чистый код и безопасность 🔐', 10],
    ['alice', 'Алиса Котова', 'Фотограф. Свет, цвет и немного магии ✨ #фото', 1],
    ['boris', 'Борис Петров', 'Backend-разработчик. TypeScript, базы данных, кофе ☕', 2],
    ['maria', 'Мария Смирнова', 'Путешествую и снимаю короткие видео о городах 🌍', 3],
    ['dmitry', 'Дмитрий Орлов', 'Музыкант и звукорежиссёр 🎧', 4],
    ['elena', 'Елена Волкова', 'Продуктовый дизайнер. Делаю интерфейсы, которые приятно трогать', 5],
    ['kirill', 'Кирилл Новиков', 'Стримлю игры и рассказываю про железо 🎮', 6],
    ['lena', 'Лена Морозова', 'Книги, кино, прогулки', 7],
    ['nikita', 'Никита Соколов', 'Научпоп: космос, физика, фракталы 🔭', 8],
    ['olga', 'Ольга Лебедева', 'Готовлю просто и вкусно. Рецепты каждый день 🍝', 9],
    ['omni', 'Omni', 'Официальный аккаунт Omni: новости, обновления, советы по безопасности.', 0],
  ] as const;

  try {
      // ── Пользователи ──────────────────────────────────────────────────────────
      for (const [username, displayName, bio, avatar] of people) {
        const session = await s.auth.register({ username, displayName, password: DEMO_PASSWORD }, meta);
        s.sessions.revoke(session.userId, session.sessionId);
        users[username] = { id: session.userId, username };
        const avatarMedia = await upload(session.userId, avatar ? `avatar-${avatar}.jpg` : 'photo-12.jpg');
        const banner = await upload(session.userId, `banner-${(avatar % 3) + 1}.jpg`);
        s.users.updateProfile(session.userId, { bio, avatarMediaId: avatarMedia.id, bannerMediaId: banner.id, location: 'Москва' });
        tick(30);
      }
      db.run("UPDATE users SET verified = 1 WHERE username IN ('omni', 'alice', 'nikita')");
      db.run("UPDATE users SET role = 'admin' WHERE username = 'sasha'");
      s.users.updatePrivacy(users.lena!.id, { isPrivate: true });

      // ── Подписки ──────────────────────────────────────────────────────────────
      const names = Object.keys(users);
      for (const a of names) {
        for (const b of names) {
          if (a === b) continue;
          if (b === 'omni' || Math.random() < 0.55 || a === 'sasha') s.users.follow(users[a]!.id, users[b]!.id);
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
        ['omni', 'Добро пожаловать в #omni! Чаты, лента, видео, клипы, фото и истории — в одном приложении. Начните с раздела «Мессенджер» слева 👈'],
        ['omni', 'Совет по #безопасность: включите двухфакторную защиту в Настройки → Безопасность → 2FA. Это занимает минуту.'],
        ['boris', 'Перевёл сервис на ULID вместо автоинкремента: сортировка по времени + не угадать соседние id. #код #безопасность'],
        ['elena', 'Хороший интерфейс — тот, который не нужно объяснять. Но хорошая навигация — та, в которой невозможно потеряться 🧭 #дизайн'],
        ['nikita', 'Фрактал Мандельброта бесконечно сложен, но задаётся одной формулой: z → z² + c. Залипательное видео у меня на канале 🔭 #наука'],
        ['maria', 'Утро в новом городе — лучшее время, чтобы гулять. Пока все спят, улицы принадлежат тебе ☀️ #путешествия'],
        ['dmitry', 'Свёл новый трек за ночь. Иногда лучшие идеи приходят в 4 утра 🎧 #музыка'],
        ['kirill', 'Сегодня стрим в 20:00 — собираем ПК за 100к и проверяем в играх 🎮'],
        ['sasha', 'Первый день Omni. Цель — сделать платформу, где безопасность не мешает удобству, а удобство не ломает безопасность. #omni'],
        ['olga', 'Паста за 15 минут: чеснок, оливковое масло, чили, пармезан. Всё. Иногда меньше — значит больше 🍝 #еда'],
        ['boris', 'Напоминание: никогда не храните пароли в открытом виде. scrypt/argon2 + соль + постоянное время сравнения. #код #безопасность'],
        ['alice', 'Золотой час — не миф. Снимайте за час до заката, и свет сделает половину работы за вас 📸 #фото'],
        ['lena', 'Перечитываю «Мастера и Маргариту». Каждый раз — другая книга.'],
        ['elena', `Собрала гайд по тёмной теме: контраст ≥ 4.5:1, без чистого чёрного, акцент чуть светлее. @sasha, глянь для Omni? #дизайн`],
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
      say('sasha', dmAlice.id, 'Привет! Как тебе новый Omni?');
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
        title: 'Команда Omni',
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

      const news = s.chats.createChannel(users.omni!.id, { title: 'Omni Новости', description: 'Официальный канал: обновления и советы по безопасности', handle: 'omni_news', isPublic: true });
      for (const u of names) if (u !== 'omni') s.chats.join(users[u]!.id, news.id);
      say('omni', news.id, '🎉 Omni открыт! Мессенджер, лента, видео, клипы, фото и истории — в одном приложении.');
      say('omni', news.id, '🔐 Новое: секретные чаты со сквозным шифрованием (ECDH P-256 + AES-GCM). Ключи не покидают ваше устройство.');
      say('omni', news.id, '🛡 Советуем включить 2FA и проверить список активных сеансов в настройках безопасности.');

      const code = s.chats.createChannel(users.boris!.id, { title: 'Код и кофе ☕', description: 'Заметки бэкенд-разработчика', handle: 'code_coffee', isPublic: true });
      s.chats.join(users.sasha!.id, code.id);
      say('boris', code.id, 'Почему мы храним в базе только хэш токена сессии: если база утечёт, токены бесполезны.');

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
        s.stories.create(users[u]!.id, { mediaId: m.id, text: u === 'olga' ? 'Сегодня на ужин 🍓' : undefined });
        tick(40);
      }
      s.stories.view(users.sasha!.id, s.stories.ofUser(users.sasha!.id, users.alice!.id)[0]!.id);


  } finally {
    Date.now = realNow;
  }
  return true;
}
