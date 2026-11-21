# Sunnet Connect

Подключает ваш компьютер, VPS или сервис на Render к Sunnet как сервер. Соединение только исходящее (HTTPS к Sunnet), поэтому **роутер настраивать не нужно** — никаких пробросов портов.

## Что нужно

- Node.js 22 или новее (nodejs.org → LTS).
- Код подключения: Sunnet → Серверы → ваш сервер → «Код подключения».
- Компьютер должен быть включён, не уходить в сон и иметь стабильный интернет.

## Свой компьютер

```bash
node sunnet-connect.mjs XXXX-XXXX-XXXX
```

Откройте http://127.0.0.1:7470 — там видно, подключён ли сервер, сколько свободно процессора, памяти и диска, и что ещё настроить.

- **Windows:** Параметры → Система → Питание → «Переводить в спящий режим» → «Никогда» (пока работает сервер).
- **macOS:** Настройки → Аккумулятор → «Не переходить в режим сна автоматически при выключенном дисплее».

## Render

1. render.com → New → Background Worker → этот репозиторий, папка `connect-app`.
2. Start command: `node sunnet-connect.mjs`.
3. Environment: `SUNNET_CONNECT_CODE=ваш код`.
4. Оплачиваете Render вы сами; Sunnet не списывает деньги за серверы.

## VPS (Linux, systemd)

```ini
# /etc/systemd/system/sunnet-connect.service
[Unit]
Description=Sunnet Connect
After=network-online.target

[Service]
Environment=SUNNET_CONNECT_CODE=XXXX-XXXX-XXXX
ExecStart=/usr/bin/node /opt/sunnet-connect/sunnet-connect.mjs
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sunnet-connect
```

## Безопасность

Программа только сообщает Sunnet о состоянии устройства (имя, ОС, загрузка, свободная память и диск, задержка). Она не принимает команд извне, не открывает портов наружу (страница статуса доступна только с этого же компьютера) и не трогает ваши файлы.
