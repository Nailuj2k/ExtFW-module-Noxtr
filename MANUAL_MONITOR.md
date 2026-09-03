# Manual del Monitor Mostro + Telegram

Guía práctica de puesta en marcha y operación del monitor de noxtr en un servidor.
Documenta lo que ya se hizo en `noxtr.net` y cómo enlazarlo con Telegram.

> Referencia técnica completa (clases, flujo interno, flags): [`SERVER_MONITOR.md`](SERVER_MONITOR.md).
> Este manual es la versión "operador": qué tocar y en qué orden.

---

## 0. Qué es el monitor (en una frase)

Un proceso CLI de larga duración (`server_monitor.php`) que se queda escuchando los
relays Nostr **aunque nadie tenga la web abierta**, y avisa por **email** y/o
**Telegram** cuando pasa algo en los trades Mostro / on-chain. Además admite
**comandos de control por DM Nostr** de admins autorizados.

Se ejecuta SOLO por CLI. Si se abre desde un navegador, se niega y sale.

---

## 1. Lo que ya hicimos para ponerlo en marcha ✅

### 1.1. Arrancar el monitor

```bash
php /home/noxtr/web/noxtr.net/public_html/index.php noxtr/server/action=monitor --verbose
```

En el arranque imprime un resumen como este:

```
NoxtrMonitor bootstrap
- source   : db
- trades   : 0
- relays   : 2
- dry-run  : no
- new-offer notif: no
- filters  : 0
- monitor  : 77d05a5f9b45f421...
- npub     : npub1wlg95humgh6zrgxjzg3lwc8vdmys95t53kw0satgef3yjkwuqemsksaaqq
- admins   : 0
```

Las dos líneas que importan al principio:
- **`npub`** → la identidad Nostr propia del monitor (a esta npub se le mandan los comandos).
- **`admins`** → cuántas pubkeys están autorizadas a controlarlo. Si es `0`, nadie puede.

### 1.2. La identidad del monitor

Se genera sola en el primer arranque (`NoxtrStore::ensureMonitorIdentity()`) y se guarda en `CFG_CFG`:

| Clave CFG | Qué es |
|---|---|
| `modules.noxtr.monitor_privkey` | Clave privada del monitor (**NUNCA compartir**) |
| `modules.noxtr.monitor_pubkey` | Clave pública (hex) |
| `modules.noxtr.monitor_admin_pubkeys` | Pubkeys autorizadas (npub o hex, separadas por coma) |

> **Relays:** el monitor **no** tiene una clave CFG de relays propia. Usa los mismos
> relays que noxtr (los activos de `NSTR_RELAYS`). Si esa tabla está vacía (instalación
> nueva sin usuarios), usa un fallback hardcodeado en `NoxtrStore::DEFAULT_MONITOR_RELAYS`.
> Para cambiar dónde escucha/publica el monitor, gestiona los relays desde la web de
> noxtr (pestaña Relays) y reinicia el monitor.

**npub de este server:** `npub1wlg95humgh6zrgxjzg3lwc8vdmys95t53kw0satgef3yjkwuqemsksaaqq`

### 1.3. Autorizarte como admin (esto era lo que faltaba)

Con `admins: 0` el monitor ignora cualquier DM. Hay que meter **tu npub personal**
(la del cliente Nostr desde el que escribes) en `monitor_admin_pubkeys`.

Como la fila ya existe (la crea `install.php` vacía), basta un `UPDATE` en `CFG_CFG`:

```sql
UPDATE CFG_CFG
SET V = 'npub1TU_PUBKEY_AQUI', ACTIVE = 1
WHERE K = 'modules.noxtr.monitor_admin_pubkeys';
```

- Acepta `npub1…` o hex de 64 chars.
- Varios admins: sepáralos por comas → `'npub1aaa,npub1bbb'`.

Tras cambiarlo, **reinicia el monitor** (Ctrl+C y relanzar, o `reload` por DM si ya
eres admin). Comprueba con `--once` que ahora pone `admins : 1`:

```bash
php .../index.php noxtr/server/action=monitor --once
```

### 1.4. Probar que responde

Desde un cliente Nostr (noxtr, Amethyst, Damus…) con tu pubkey ya autorizada, abre
conversación con la npub del monitor y manda un **DM (NIP-04, kind:4)** con:

```
ping
```

Respuesta esperada: `pong`. ✅ Si responde, el ciclo completo funciona
(conecta a relays → recibe → descifra → te reconoce como admin → responde).

---

## 2. Dejarlo corriendo de forma permanente

Lanzado a mano se muere al cerrar la sesión SSH. Opciones:

### Opción A — nohup (rápida)

```bash
nohup php /home/noxtr/web/noxtr.net/public_html/index.php noxtr/server/action=monitor \
  > /var/log/noxtr-monitor.log 2>&1 &
```

Mirar el log: `tail -50 /var/log/noxtr-monitor.log`

### Opción B — panel web

`/noxtr/server_admin` → botones **Start / Stop / Status**. Internamente usan los
comandos definidos en `after_init.php` (`BOT_START`, `BOT_STATUS`, `BOT_STOP`).

### Opción C — systemd (recomendada para producción)

Así revive solo si el server se reinicia. Crear `/etc/systemd/system/noxtr-monitor.service`:

```ini
[Unit]
Description=Noxtr Mostro Monitor
After=network.target mysql.service

[Service]
Type=simple
User=noxtr
ExecStart=/usr/bin/php /home/noxtr/web/noxtr.net/public_html/index.php noxtr/server/action=monitor
Restart=always
RestartSec=10
StandardOutput=append:/var/log/noxtr-monitor.log
StandardError=append:/var/log/noxtr-monitor.log

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now noxtr-monitor
systemctl status noxtr-monitor
```

### Comprobar que está vivo

```bash
ps -ef | grep 'noxtr/server' | grep -v grep   # debe salir un PID
```

---

## 3. Enlazar con Telegram

El monitor manda Telegram usando el bot del **módulo `_modules_/telegram`**. Lee el
token de la clave CFG `modules.telegram.bot_token` (mismo origen que `TelegramBot::getToken()`).

### 3.1. Configurar el bot (una sola vez en el server)

1. En Telegram, habla con **@BotFather** → `/newbot` → te da un **token**.
2. Guarda el token en `CFG_CFG`:
   ```sql
   UPDATE CFG_CFG SET V = 'TOKEN_DE_BOTFATHER', ACTIVE = 1
   WHERE K = 'modules.telegram.bot_token';
   ```
   (La fila la crea `telegram/install.php`. Si no existe, hazle `INSERT`.)
3. Registra el **webhook** para que Telegram entregue los mensajes al sitio:
   - Web: `/telegram/admin/tab=setup` → botón **"Registrar webhook"**.
   - La URL del webhook es `https://<host>/telegram/raw/webhook`.
   - Requiere **HTTPS válido** (Telegram no acepta http ni certificados malos).

### 3.2. Vincular un USUARIO (recibe avisos de SUS trades)

1. El usuario entra en `/telegram` → **"Vincular Telegram"**.
2. La web genera un token de un solo uso y muestra un deep link
   `https://t.me/<BotUsername>?start=TOKEN` (caduca a los 10 min).
3. El usuario abre el link → pulsa **Iniciar / Start** en el bot.
4. El webhook recibe `/start TOKEN` → se guarda la vinculación en `TGRAM_CHATS`.
5. El bot confirma: *"¡Cuenta vinculada correctamente!"*

A partir de ahí, ese usuario recibe por Telegram lo que el monitor le notifique.

### 3.3. Vincular un ADMIN (recibe alertas del order book)

Un admin necesita **las dos cosas a la vez**:

1. **Telegram vinculado** (pasos de 3.2) — su `chat_id` queda en `TGRAM_CHATS`.
2. **Su `nostr_pubkey` en `CLI_USER`** debe coincidir con una pubkey de
   `modules.noxtr.monitor_admin_pubkeys`.

El monitor cruza ambas tablas (`loadTelegramLinkedUsersWithPubkey`: junta
`CLI_USER.nostr_pubkey` con `TGRAM_CHATS`) y solo manda alertas de order book a los
admins que cumplen las dos condiciones. Tras vincular, **reinicia el monitor o manda
`reload`** para que recargue el índice.

### 3.4. Quién recibe qué (resumen)

| Notificación | Canal | A quién | Requisito |
|---|---|---|---|
| Eventos de tus trades (orden tomada, pagar hold invoice, fiat enviado, completado, disputa) | **Email** | Dueño del trade | Email válido en su perfil |
| Lo mismo | **Telegram** | Dueño del trade | Telegram vinculado |
| Eventos on-chain (taken, funded, fiat sent/received, payout, dispute…) | Email + Telegram | Dueño del trade | Igual que arriba |
| **Nueva orden en el order book** | **Telegram** | Admins | pubkey en `monitor_admin_pubkeys` **+** Telegram vinculado |
| Activación de filtro auto-take | DM Nostr + email + Telegram | Admins | Igual |
| DM Nostr entrante a un usuario | Telegram | Usuario destinatario | Telegram vinculado |

> Nota: las alertas de "nueva orden del order book" solo se mandan si está activado
> `new-offer notif` (lo verás en el bootstrap). Por defecto está en `no`.

---

## 4. Comandos de control por DM Nostr

Se mandan como **DM (kind:4)** a la npub del monitor, desde una pubkey en
`monitor_admin_pubkeys`. Texto plano.

| Comando | Qué hace |
|---|---|
| `ping` | Responde `pong`. Comprueba que escucha. |
| `status` | Versión, nº de trades, filtros, uptime, relays, npub. |
| `trades [age 8h \| status pending \| amount 50 EUR]` | Consulta el order book **en vivo** (puede tardar hasta ~12 s). |
| `relays` | Relays configurados y conectados en la sesión. |
| `email [destino]` | Manda un email de prueba. |
| `profile` | Republica el perfil Nostr del monitor (kind:0). |
| `filter_trade list \| amount 88 EUR \| days 0 \| remove … \| clear` | Gestiona reglas de auto-take. |
| `reload` / `restart` | Reinicia la sesión de relays sin matar el proceso. Úsalo tras cambiar admins/relays/Telegram. |
| `stop` / `shutdown` / `close` | Para el proceso limpiamente. |
| `help [tema]` | Ayuda contextual. |

> Los comandos con más de `modules.noxtr.monitor_command_max_age` segundos de
> antigüedad (defecto 300) se ignoran como `stale`.

---

## 5. Flags CLI útiles

| Flag | Para qué |
|---|---|
| `--verbose` | Log detallado de cada evento. |
| `--once` | Carga estado, imprime resumen y sale (sin conectar a relays). Ideal para verificar config. |
| `--dry-run` | Simula todo pero NO envía emails ni publica eventos. |
| `--no-startup-dm` | No manda el DM de arranque a los admins. |
| `--idle=N` / `--refresh=N` / `--reconnect=N` | Ajustan tiempos (defecto 10 / 30 / 5 s). Sube `--refresh=60` si hay muchos trades y el relay tarda. |
| `--debug-relays` | Imprime trades y filtros en cada ciclo. |

---

## 6. Tabla de claves CFG (todo en `CFG_CFG`, columnas K / V / DESCRIPTION / ACTIVE)

| Clave | Para qué |
|---|---|
| `modules.noxtr.monitor_privkey` / `monitor_pubkey` | Identidad del monitor (auto-generada). |
| `modules.noxtr.monitor_admin_pubkeys` | Admins autorizados (npub/hex, coma). |
| `modules.noxtr.monitor_command_max_age` | Antigüedad máx. de comandos (s). Defecto 300. |
| `modules.noxtr.trade_notification_email` | `1`/`true`/`yes`/`on` activa el email real (si no, se usa NullNotifier). |
| `modules.noxtr.monitor_take_filters` | Reglas auto-take (JSON, gestionado por DM). |
| `modules.noxtr.monitor_profile_name` / `_about` / `_picture` | Perfil Nostr del monitor. |
| `modules.telegram.bot_token` | Token del bot de @BotFather. |
| `modules.telegram.webhook_secret` | Secreto del webhook (auto-generado). |

Recordatorio: `CFG_CFG.K` **no tiene índice UNIQUE**, así que para cambiar un valor
usa `SELECT` + `UPDATE` (o el panel), nunca `INSERT` a ciegas (crearía duplicados).

> Los **relays del monitor NO son una clave CFG**. Se derivan de `NSTR_RELAYS` (los
> relays activos de noxtr), con fallback en `NoxtrStore::DEFAULT_MONITOR_RELAYS` si la
> tabla está vacía. Para cambiarlos, edita los relays desde la web de noxtr (pestaña
> Relays) y reinicia el monitor.

---

## 7. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `admins : 0` en el bootstrap | `monitor_admin_pubkeys` vacío | Mete tu npub (sección 1.3) y reinicia. |
| Mando `ping` y no responde | Tu pubkey no está autorizada, o tu cliente no comparte relay con el monitor | Verifica `admins ≥ 1`; asegúrate de que tu cliente y los relays de noxtr (`NSTR_RELAYS`) tengan relays en común. |
| `startup DM skipped: no admins configured` | Idem `admins : 0` | Añade admin. |
| El email no llega | `trade_notification_email` desactivado, o sin email en el perfil | Pon la clave a `1`; revisa spam. |
| Telegram no llega | Bot sin token, webhook no registrado, o usuario sin vincular | Revisa `modules.telegram.bot_token`, registra webhook, vincula en `/telegram`. |
| Admin no recibe alertas de order book por Telegram | Le falta Telegram vinculado **o** su `nostr_pubkey` no está en `monitor_admin_pubkeys` | Necesita las dos cosas; luego `reload`. |
| No avisa de trades on-chain | Los relays del monitor no incluyen los relays donde publican los clientes | Añade/activa esos relays en la web de noxtr (`NSTR_RELAYS`) y reinicia el monitor. |
| El proceso muere al cerrar SSH | Lanzado en primer plano | Usa nohup / systemd (sección 2). |
| El proceso muere solo | Relay caído al arrancar, timeout PHP, SIGKILL | `tail` del log; relanzar (no duplica avisos, se deduplican en `NSTR_EVENTS`). |

---

## 8. Checklist de puesta en marcha

- [ ] Monitor arranca y muestra su `npub`.
- [ ] Tu npub añadida a `monitor_admin_pubkeys` → bootstrap muestra `admins ≥ 1`.
- [ ] `ping` → `pong` por DM Nostr.
- [ ] Monitor corriendo como daemon (nohup / systemd / panel).
- [ ] `modules.telegram.bot_token` configurado.
- [ ] Webhook de Telegram registrado (`/telegram/admin/tab=setup`).
- [ ] Usuarios/admins vinculados en `/telegram`.
- [ ] Admins con `nostr_pubkey` en `CLI_USER` = pubkey en `monitor_admin_pubkeys`.
- [ ] Los relays de noxtr (`NSTR_RELAYS`) incluyen los relays reales de tus trades (Lightning y on-chain) — el monitor los hereda.
- [ ] (Opcional) `trade_notification_email = 1` para emails reales.
- [ ] (Opcional) `new-offer notif` activado si quieres alertas de order book.
```
