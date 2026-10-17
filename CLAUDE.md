# Omni — заметки для разработки

Монорепозиторий npm workspaces: `packages/shared` (zod-схемы, типы API, протокол WS), `apps/server` (Fastify 5 + node:sqlite), `apps/web` (React 19 + Vite PWA).

- Запуск: `npm install && npm run seed && npm run dev` → http://localhost:5173, вход `sasha` / `omni-demo-2026`.
- Проверка перед коммитом: `npm run typecheck && npm test` (сборка — `npm run build`).
- Как добавлять разделы и функции: `docs/CONTRIBUTING.md`. Архитектура: `docs/ARCHITECTURE.md`. Безопасность: `docs/SECURITY.md`.
- Интерфейс и комментарии в коде — на русском.
- Авторизация только через `apps/server/src/modules/policy`; SQL только параметризованный; миграции только добавляются.
- Навигация — реестр `apps/web/src/app/navigation.ts`; тест не допускает пунктов без маршрута или пометки `planned`.
- Стили — только CSS-переменные из `apps/web/src/styles/tokens.css`; проверять на 390 px и 1440 px.
