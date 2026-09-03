# Noxtr Server Monitor (`server_monitor.php`)

Versión documentada: **NostrMonitor v1.0.8**

---

## Qué es

`server_monitor.php` es un proceso CLI de larga duración que actúa como daemon de vigilancia del módulo Mostro P2P dentro de noxtr.

Su función es mantenerse conectado a relays Nostr en segundo plano —sin que ningún usuario tenga la web abierta— y reaccionar a eventos del protocolo Mostro v2 (kind 14, NIP-44 directo) para:

- **Notificar al usuario por email** cuando ocurre algo relevante en sus trades activos.
- **Notificar a los admins por Nostr DM** sobre nuevas órdenes en el order book.
- **Aceptar comandos de control** enviados por DM por admins autorizados.

El archivo está diseñado para ejecutarse exclusivamente por CLI (`php index.php noxtr/server/action=monitor`). Si se accede desde un navegador, el proceso se niega a ejecutar y termina con error.

---

## Arquitectura

El monitor sigue un diseño de interfaces desacopladas:

```
NostrMonitor (orquestador)
  ├── MonitorDataSourceInterface  ← fuente de datos (trades, emails, eventos)
  │     ├── FrameworkDbDataSource  (MySQL / SQLite via PDO — producción)
  │     └── JsonFileDataSource     (JSON plano — pruebas / standalone)
  ├── MonitorNotifierInterface    ← canal de salida de notificaciones
  │     ├── FrameworkEmailNotifier  (envío real via NoxtrStore::sendEmail)
  │     └── NullNotifier            (dry-run: solo imprime en consola)
  ├── RelayClientInterface        ← cliente WebSocket Nostr
  │     └── NostrRelayClient        (implementación real, en nostrcrypto.class.php)
  └── MonitorOptions              ← parámetros de arranque (parseados de $argv)
```

### Clases de datos

| Clase | Descripción |
|---|---|
| `MonitorOptions` | Configuración en tiempo de ejecución (flags CLI). |
| `MonitoredTrade` | Un trade activo cargado desde BD: claves, rol, estado, peerPubkey. |
| `MonitorEvent` | Un evento Nostr recibido del relay (id, kind, tags, content). |

---

## Flujo de ejecución principal

```
main()
  └── NostrMonitor::run()
        ├── refreshState()           ← carga trades activos desde BD
        ├── buildFilters()           ← construye filtros REQ para el relay
        │     ├── kind:14    #p:[trade_key_pub...]   (mensajes Mostro v2 al usuario)
        │     ├── kind:4     #p:[monitor_pubkey]     (comandos de control)
        │     └── kind:38383 #s:pending #y:mostro    (order book)
        ├── relayClient->connect()
        ├── maybePublishMonitorProfile()
        ├── maybeSendStartupDm()
        ├── relayClient->subscribe(filters)
        └── relayClient->run(handleRelayMessage, shouldStop)
              ├── handleRelayMessage()
              │     ├── kind 4      → handleControlDm()
              │     ├── kind 38383  → handleOrderBookEvent()
              │     └── kind 14    → descifrar NIP-44 → maybeNotify()
              └── shouldStop: cada refreshIntervalSeconds (defecto: 30s)
                    → reconecta con estado actualizado
```

El bucle principal se repite indefinidamente hasta recibir SIGTERM, SIGINT, SIGHUP, o un comando `stop` via DM de admin.

---

## Fuentes de datos

### `FrameworkDbDataSource` (producción)

Lee y escribe en las tablas del framework usando el PDO singleton del proyecto:

| Tabla | Uso |
|---|---|
| `NSTR_TRADES` | Lee trades activos (no archivados, con claves presentes, no terminales). |
| `CLI_USER` | Lee el email del usuario por `user_id` o por `nostr_pubkey`. |
| `NSTR_EVENTS` | Deduplicación de eventos procesados; registro de notificaciones enviadas. |
| `CFG_CFG` | Lee la configuración del perfil y de admins del monitor. |

La tabla `NSTR_EVENTS` se crea automáticamente si no existe (compatible MySQL y SQLite).

### `JsonFileDataSource` (pruebas)

Alternativa standalone que lee un fichero JSON local. Estructura esperada:

```json
{
  "relays": ["wss://relay.mostro.network"],
  "users": { "12": { "email": "a@b.com", "pubkey": "hex64..." } },
  "trades": [
    {
      "user_id": 12,
      "order_id": "uuid...",
      "robot_pubkey": "hex64...",
      "trade_key_pub": "hex64...",
      "trade_privkey": "hex64...",
      "trade_role": "created",
      "trade_kind": "sell",
      "is_seller": 1,
      "internal_status": "publicado"
    }
  ],
  "events": []
}
```

Activar con `--source=json` o `--json=/ruta/fichero.json`.

---

## Notificaciones por email

El monitor envía emails al usuario que tiene el trade abierto. Los eventos monitorizados y el tipo de notificación generada son:

| Acción Mostro | Condición | Tipo de notificación | Asunto |
|---|---|---|---|
| `buyer-took-order` | Trade creado por el usuario | `order_taken` | "han tomado tu orden" |
| `pay-invoice` | El usuario es vendedor (`is_seller=1`) | `pay_invoice` | "debes pagar la hold invoice" |
| `fiat-sent` / `fiat-sent-ok` | El usuario es vendedor | `fiat_sent` | "el comprador ha enviado el fiat" |
| `success` / `purchase-completed` / `hold-invoice-payment-settled` | Cualquier rol | `trade_completed` | "trade completado" |
| `dispute-initiated-by-you` | Iniciador (cualquier rol) | `dispute_started_by_you` | "has iniciado una disputa" |
| `dispute-initiated-by-peer` | Receptor (cualquier rol) | `dispute_started_by_peer` | "⚠️ la contraparte ha iniciado una disputa" |
| `admin-took-dispute` | Cualquier rol con disputa abierta | `dispute_admin_assigned` | "🛡️ un admin ha tomado la disputa" |

Reglas anti-ruido:
- `order_taken` **no** se envía si ya se enviaron `pay_invoice`, `fiat_sent` o `trade_completed` para ese trade (el evento llegó tarde).
- Cada tipo de notificación se envía **una sola vez por orden** (guardado en `NSTR_EVENTS.notification_type`).
- Para que las notificaciones de disputa lleguen, el query `loadActiveTrades` mantiene los trades en estado `disputado` suscritos (solo se descartan al pasar a `cancelado`/`completado`/`archivado`). De lo contrario el `admin-took-dispute` no se vería nunca.

Configuración: la clave `modules.noxtr.trade_notification_email` en `CFG_CFG` (valores: `1`, `true`, `yes`, `on`) activa el envío real. Si está desactivada se usa `NullNotifier`.

---

## Notificaciones del order book

Además de los trades propios, el monitor suscribe el order book (`kind:38383`). Para cada orden nueva (posterior al arranque del proceso) envía:

1. **DM por Nostr** a todos los admins configurados: `orden | #shortId | BUY/SELL | importe fiat | método de pago | antigüedad robot`.
2. **Email** a los admins (resuelto por pubkey → email en `CLI_USER`, o fallback a `site.email` / `smtp.from_email`).

Solo notifica órdenes cuyo `created_at` es posterior al momento de arranque del proceso, evitando el flood de las últimas 48h al reconectar.

---

## Canal de control por DM (Nostr kind:4)

El monitor tiene su propia identidad Nostr (generada y persistida por `NoxtrStore::ensureMonitorIdentity()`). Los admins autorizados pueden enviarle DMs cifrados (NIP-04 AES-256-CBC) con comandos de texto plano o JSON.

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `ping` | Comprueba que el canal responde. Devuelve `pong`. |
| `status` | Versión, trades monitorizados, uptime, npub. |
| `trades [opciones]` | Consulta viva del order book en los relays del monitor. |
| `relays` | Relays configurados y conectados en la sesión actual. |
| `email [destino]` | Envía un email de prueba. |
| `profile` | Publica el perfil Nostr del monitor (kind:0). |
| `reload` / `restart` | Reinicia la sesión de relays sin relanzar el proceso. |
| `stop` / `shutdown` / `close` | Detiene el proceso limpiamente. |
| `help [tema]` | Ayuda contextual. |

### Subcomandos de `trades`

```
trades                         # órdenes de las últimas 8h (defecto)
trades age 8h                  # filtro por antigüedad (s, m, h, d)
trades age all                 # sin filtro de antigüedad
trades status pending          # filtro por estado
trades amount 44               # filtro por importe fijo
trades amount 44 EUR           # filtro por importe + moneda
```

La consulta es en tiempo real contra los relays configurados (no usa caché ni BD). Muestra hasta 20 resultados, ordenados por `created_at DESC`.

### Seguridad del canal de control

- Solo pubkeys en `admin_pubkeys` (configurado en la identidad del monitor) pueden enviar comandos.
- El evento se verifica criptográficamente (firma Schnorr via `NostrAuth::verifyEvent`).
- Los comandos con más de `monitor_command_max_age` segundos de antigüedad (defecto: 300s) se ignoran y registran en `NSTR_EVENTS` como `stale`.

---

## Configuración

### Parámetros relevantes en `CFG_CFG`

| Clave | Descripción |
|---|---|
| `modules.noxtr.trade_notification_email` | `1` / `true` para activar envío de email. |
| `modules.noxtr.monitor_command_max_age` | Tiempo máximo (segundos) para comandos de control. Defecto: 300. |
| `modules.noxtr.monitor_profile_name` | Nombre del perfil Nostr del monitor. Defecto: `NoxtrMonitor`. |
| `modules.noxtr.monitor_profile_about` | Bio del perfil Nostr del monitor. |
| `modules.noxtr.monitor_profile_picture` | Avatar del perfil Nostr del monitor. |
| `server.ssh.host/username/password/port` | Credenciales SSH para el panel de control web. |

### Identidad del monitor

Generada automáticamente por `NoxtrStore::ensureMonitorIdentity()` en el primer arranque. Almacenada en `CFG_CFG`. Incluye:
- `privkey` / `pubkey` hex
- `npub` bech32
- `relays`: lista de relays donde escuchar y publicar
- `admin_pubkeys`: lista de pubkeys (hex o npub1...) autorizadas para enviar comandos de control y recibir notificaciones DM

---

## Cómo se arranca

### Comando directo

```bash
php /ruta/public_html/index.php noxtr/server/action=monitor
```

Con opciones:

```bash
php index.php noxtr/server/action=monitor --dry-run --verbose
php index.php noxtr/server/action=monitor --once
php index.php noxtr/server/action=monitor --source=json --json=/tmp/monitor.json
```

### Desde el panel web

El módulo define en `after_init.php` las constantes de control del proceso:

```php
define('BOT_START',  'DISPLAY=:0 php /ruta/index.php noxtr/server/action=monitor > /dev/null &');
define('BOT_STATUS', "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print $2}'");
define('BOT_STOP',   "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print $2}' | xargs kill -9");
```

El panel de administración web (`server_admin.php`) muestra botones **Status**, **Start** y **Stop** que ejecutan estos comandos, opcionalmente via SSH si `BOT_HOST` está configurado.

El enrutador `server.php` despacha según `?action=`:
- `action=test` → `server_test.php` (echo de ticks durante 20s)
- `action=monitor` → `server_monitor.php` (el daemon)

---

## Flags CLI disponibles

| Flag | Descripción |
|---|---|
| `--dry-run` | No envía emails ni publica eventos. Imprime en consola lo que haría. |
| `--once` | Carga el estado y muestra el resumen sin conectar a relays. Útil para depurar configuración. |
| `--verbose` | Imprime log detallado de cada evento procesado. |
| `--debug-wide` | Amplía las suscripciones del monitor para depuración. El transporte Mostro activo es kind:14 v2. |
| `--debug-relays` | Imprime el estado de trades y filtros en cada ciclo. |
| `--startup-dm` | (defecto: activo) Envía DM de arranque a los admins. |
| `--no-startup-dm` | No envía DM al arrancar. |
| `--startup-dm=Texto` | DM de arranque personalizado. |
| `--source=db` | (defecto) Carga trades desde base de datos. |
| `--source=json` | Carga trades desde fichero JSON. |
| `--json=/ruta/fichero.json` | Ruta del JSON (implica `--source=json`). |
| `--idle=N` | Segundos de espera cuando no hay trades activos. Defecto: 10. |
| `--refresh=N` | Duración de cada sesión de relay antes de reconectar. Defecto: 30. |
| `--reconnect=N` | Segundos de espera entre sesiones de relay. Defecto: 5. |

---

## Tabla NSTR_EVENTS

Creada automáticamente por `FrameworkDbDataSource::ensureEventsTable()`. Registra todos los eventos procesados y las notificaciones enviadas.

| Columna | Descripción |
|---|---|
| `event_id` | ID del evento Nostr (unique). |
| `kind` | Kind del evento (1059, 38383, 4...). |
| `order_id` | UUID del trade Mostro. |
| `user_id` | ID del usuario propietario del trade. |
| `event_created_at` | Timestamp del evento Nostr. |
| `source` | `mostro`, `filter`, `control`, `monitor`. |
| `status` | Acción Mostro o estado de procesado. |
| `raw_json` | Evento completo en JSON. |
| `notification_type` | Tipo de notificación enviada (`order_taken`, `pay_invoice`, etc.). |
| `notification_sent_at` | Timestamp de envío de la notificación. |
| `processed_at` | Cuándo lo procesó el monitor. |

---

## Señales del proceso

| Señal | Efecto |
|---|---|
| `SIGTERM` | Para el proceso limpiamente. |
| `SIGINT` | Para el proceso limpiamente (Ctrl+C). |
| `SIGHUP` | Para el proceso limpiamente. |

Si `pcntl` no está disponible, las señales no funcionan y el proceso solo se puede parar con `kill`.

---

## Compatibilidad PHP

El archivo mantiene sintaxis PHP 7.3 porque el CLI del servidor puede usar esa versión. Incluye polyfill de `str_starts_with`. Las migraciones pendientes a PHP 8.4 están marcadas con comentarios `// PHP 8.4 migration:` (typed properties, readonly, constructor property promotion, match expressions).

---

## Estado actual y limitaciones conocidas

- `RelayClientInterface` está implementada (`NostrRelayClient` en `nostrcrypto.class.php`). El modo `--once` no abre WebSocket real, solo muestra el resumen de configuración.
- El command `trades` hace una consulta en tiempo real a los relays; puede tardar hasta 12 segundos si hay latencia de red.

---

## Monitor multi-sitio (propuesta de arquitectura)

### Problema

El monitor actual está acoplado a la BD del servidor donde se ejecuta. Si se quiere monitorizar una instalación noxtr en otra web (ej. `noxtr.net` desde el monitor de `tienda.extralab.net`) no es posible sin acceso directo a esa BD.

El objetivo es que **un único proceso monitor** pueda atender varios sitios noxtr independientes.

---

### Qué necesita el monitor de cada sitio remoto

| Dato | Tabla origen | Frecuencia de acceso |
|---|---|---|
| Trades activos con `trade_privkey` | `NSTR_TRADES` | Cada ciclo (`refreshState`) |
| Email del usuario | `CLI_USER.USER_EMAIL` | Al notificar |
| nostr_pubkey del usuario | `CLI_USER.nostr_pubkey` | Al construir filtro DMs |
| Eventos ya procesados | `NSTR_MONITOR_EVENTS` | Por cada evento recibido |
| Registrar evento procesado | `NSTR_MONITOR_EVENTS` | Al procesar evento |
| Chat_id de Telegram | `TGRAM_CHATS` | Al notificar |

Y de configuración:

| Dato | Origen actual | Notas |
|---|---|---|
| Bot token Telegram | `CFG_CFG` | Puede ser el bot del sitio monitor |
| Admin pubkeys | `CFG_CFG` | Idem |
| SCRIPT_HOST (URL del sitio) | `configuration.php` | Necesario para los links en notificaciones |
| SMTP | `CFG_CFG` | Puede usar el SMTP del sitio monitor |
| Relays | `NSTR_RELAYS` | Puede usar los del sitio monitor — Mostro publica en relays públicos |

---

### Propuesta de arquitectura

#### 1. Tabla `NSTR_NOXTR_SITES` (local, en el monitor)

Almacena la configuración de cada sitio remoto monitorizado:

```sql
CREATE TABLE NSTR_NOXTR_SITES (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    site_id     VARCHAR(64) NOT NULL UNIQUE,   -- slug identificador, ej 'noxtr_net'
    site_url    VARCHAR(255) NOT NULL,          -- https://noxtr.net
    api_key     VARCHAR(128) NOT NULL,          -- clave secreta compartida con ese sitio
    active      TINYINT DEFAULT 1,
    created_at  INT DEFAULT 0
)
```

El monitor carga esta tabla en `refreshState()` y para cada sitio activo llama a su API.

---

#### 2. API en el sitio remoto (`/noxtr/api/monitor/...`)

El sitio remoto expone un endpoint autenticado con la `api_key` de `NSTR_NOXTR_SITES`. Todos los requests llevan el header `X-Monitor-Key: <api_key>`.

##### `GET /noxtr/api/monitor/trades`

Devuelve los trades activos. **Nunca devuelve `trade_privkey` en claro.**

```json
{
  "trades": [
    {
      "order_id": "uuid...",
      "user_id": 42,
      "trade_key_pub": "hex64...",
      "trade_role": "created",
      "trade_kind": "sell",
      "is_seller": 1,
      "internal_status": "publicado",
      "robot_pubkey": "hex64..."
    }
  ]
}
```

##### `POST /noxtr/api/monitor/unwrap`

El monitor recibe un evento kind:14 cifrado con NIP-44 y lo descifra con la `trade_privkey` local del trade.

Request:
```json
{
  "event": { ...evento kind:14 raw... }
}
```

Response (si el evento corresponde a un trade del sitio):
```json
{
  "found": true,
  "order_id": "uuid...",
  "user_id": 42,
  "action": "buyer-took-order",
  "payload": { ... }
}
```

Response (si no corresponde a ningún trade):
```json
{ "found": false }
```

**La `trade_privkey` nunca sale del sitio remoto.** El descifrado NIP-59 se hace localmente en ese servidor. El monitor solo recibe la acción ya resuelta.

##### `GET /noxtr/api/monitor/user?user_id=42`

```json
{
  "email": "user@example.com",
  "nostr_pubkey": "hex64...",
  "telegram_chat_id": "4980379"
}
```

##### `POST /noxtr/api/monitor/event`

El monitor registra un evento procesado en la BD remota (equivalente a `storeEvent` + `markNotificationSent`).

Request:
```json
{
  "event_id": "hex64...",
  "order_id": "uuid...",
  "notification_type": "order_taken",
  "notification_sent_at": 1713000000
}
```

##### `GET /noxtr/api/monitor/event?event_id=hex64`

Comprueba si un evento ya fue procesado (equivalente a `isEventProcessed`).

```json
{ "processed": false }
```

---

#### 3. Nueva implementación: `RemoteSiteDataSource`

Implementa `MonitorDataSourceInterface` usando la API anterior en lugar de acceso directo a BD.

```
MonitorDataSourceInterface
  ├── FrameworkDbDataSource   (BD local — sitio actual, ya implementado)
  ├── JsonFileDataSource      (JSON plano — pruebas, ya implementado)
  └── RemoteSiteDataSource    (API remota — NUEVO)
```

El monitor carga múltiples instancias de `RemoteSiteDataSource`, una por cada fila activa en `NSTR_NOXTR_SITES`, y las combina en un `MultiSiteDataSource` que agrega los resultados.

---

#### 4. Datos que NO necesitan API

| Dato | Solución |
|---|---|
| **Relays** | El monitor usa sus propios relays de `NSTR_RELAYS`. Los trades de Mostro se publican en relays públicos comunes. |
| **Bot token Telegram** | El monitor usa el bot de su propio sitio. Un mismo bot puede notificar a usuarios de distintos sitios si todos se vinculan a ese bot. |
| **SMTP / email** | El monitor usa su propia configuración SMTP. |
| **Admin pubkeys** | Configuradas en la BD local del monitor. |

---

#### 5. TGRAM_CHATS — cómo obtiene el monitor el chat_id

El usuario de `noxtr.net` se vincula a Telegram desde `noxtr.net/telegram` usando el bot que tenga configurado ese sitio. El `chat_id` queda guardado en la `TGRAM_CHATS` de `noxtr.net`.

El monitor no tiene acceso directo a esa tabla, pero el endpoint `/noxtr/api/monitor/user` ya la incluye en el response:

```json
{
  "email": "user@example.com",
  "nostr_pubkey": "hex64...",
  "telegram_chat_id": "4980379"
}
```

El monitor recibe el `chat_id` y envía el mensaje de Telegram usando **su propio bot token** (el del sitio donde corre el monitor). Esto significa que el usuario recibirá el aviso del bot del monitor, no del bot de `noxtr.net`.

**Decisión: bot único compartido.** Un solo bot de Telegram configurado en el monitor. Todos los sitios remotos configuran ese mismo bot. El usuario se vincula una sola vez en cualquier sitio y el `chat_id` resultante sirve para recibir notificaciones de todos los sitios monitorizados.

Implicación práctica: `modules.telegram.bot_token` en `CFG_CFG` del monitor es el token que se usa para todos los envíos. Los sitios remotos deben tener ese mismo bot configurado en su módulo telegram para que los usuarios puedan vincularse desde su web.

---

### Resumen del trabajo a implementar

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla `NSTR_NOXTR_SITES` | BD del monitor | Por hacer |
| `RemoteSiteDataSource` | `server_monitor.php` | Por hacer |
| `MultiSiteDataSource` | `server_monitor.php` | Por hacer |
| Endpoint `/noxtr/api/monitor/*` | `ajax.php` del sitio remoto | Por hacer |
| Autenticación por `api_key` en el endpoint | `ajax.php` del sitio remoto | Por hacer |
| Descifrado NIP-59 en el sitio remoto (`unwrap`) | `ajax.php` del sitio remoto | Por hacer |
| Carga de sitios remotos en `refreshState()` | `server_monitor.php` | Por hacer |
| Flag `--site=noxtr_net` para debug de un sitio concreto | `server_monitor.php` | Opcional |

---

### Consideraciones de seguridad

- La `api_key` debe ser un secreto largo (mínimo 32 chars hex) generado aleatoriamente por sitio.
- El endpoint debe validar la `api_key` en cada request antes de devolver cualquier dato.
- El endpoint `unwrap` recibe eventos cifrados — nunca devuelve claves privadas.
- La comunicación debe ser siempre HTTPS.
- El endpoint `monitor/trades` no incluye `trade_privkey` — el descifrado siempre ocurre en el sitio que tiene la clave.

---

## Guía de administrador

### Arrancar el monitor

```bash
php /home/tienda/domains/tienda.extralab.net/private_html/index.php noxtr/server/action=monitor --verbose
```

Sin `--verbose` corre en silencio. Para dejarlo como daemon en background:

```bash
nohup php .../index.php noxtr/server/action=monitor > /var/log/noxtr-monitor.log 2>&1 &
```

O desde el panel web de administración (`/noxtr/server_admin`): botones **Start** / **Stop** / **Status**.

### Verificar que está vivo

Enviar un DM al npub del monitor (visible en la salida de arranque o en el panel) con el texto:

```
ping
```

Respuesta esperada: `pong`

Si no responde en 30 segundos, el proceso está caído o el relay no llega.

### Comandos de uso habitual

Todos se envían como DM NIP-04 al npub del monitor desde una pubkey autorizada en `admin_pubkeys`.

**Ver estado general**
```
status
```
Devuelve: versión, trades monitorizados, uptime, relays conectados, npub.

**Ver órdenes actuales del order book**
```
trades
trades age 4h
trades amount 50 EUR
trades status pending
```
Consulta en tiempo real los relays. Puede tardar hasta 12 segundos.

**Ver relays conectados en esta sesión**
```
relays
```

**Enviar email de prueba**
```
email
email otro@dominio.com
```

**Republicar el perfil Nostr del monitor**
```
profile
```

**Reiniciar la sesión de relays** (sin matar el proceso)
```
reload
```
Útil si un relay se ha caído y quieres reconectar sin reiniciar.

**Parar el proceso limpiamente**
```
stop
```

### Qué hacer si el proceso muere

1. Comprobar el log: `tail -50 /var/log/noxtr-monitor.log`
2. Causas habituales: relay inaccesible al arrancar, timeout de PHP, SIGKILL externo.
3. Relanzar con el mismo comando. El monitor retoma donde lo dejó: los eventos ya procesados están en `NSTR_EVENTS` y no se duplican notificaciones.
4. Si hay muchos trades activos y el relay tarda, aumentar el timeout con `--idle=30 --refresh=60`.

### Configurar Telegram para admins

1. El admin vincula su cuenta Telegram en `/noxtr` (botón de Telegram, o via el módulo telegram).
2. Su `chat_id` queda en `TGRAM_CHATS`.
3. El monitor lo detecta automáticamente al arrancar (carga `dmNotifyIndex`).
4. A partir de ahí recibe notificaciones de:
   - Nuevas órdenes en el order book (con todos los detalles).
   - DMs entrantes de otros usuarios (si su pubkey está en el índice).

### Dry-run (probar sin enviar nada)

```bash
php .../index.php noxtr/server/action=monitor --dry-run --verbose
```

Simula todo el flujo pero no envía emails ni publica eventos Nostr. Los logs muestran exactamente qué haría.

---

## Guía de usuario

### Qué es el monitor (explicación sin tecnicismos)

El monitor es un programa que corre en el servidor en segundo plano y vigila tus operaciones de compraventa de Bitcoin en Mostro. Como Mostro funciona con mensajes cifrados en la red Nostr, alguien tiene que estar escuchando aunque tú no tengas la web abierta. Eso es lo que hace el monitor.

### Qué notificaciones recibirás

El monitor te avisa por **email** cuando ocurre algo importante en tus trades. No te mandará spam: cada tipo de aviso se envía una sola vez por operación.

| Cuándo | Qué recibes |
|---|---|
| Alguien toma tu orden publicada | Email: "Han tomado tu orden #XXXXXXXX" |
| El robot te pide pagar la hold invoice (vendes BTC) | Email: "Debes pagar la hold invoice para el trade #XXXXXXXX" |
| El comprador confirma que envió el fiat (vendes BTC) | Email: "El comprador ha enviado el pago — trade #XXXXXXXX" |
| El trade se completa | Email: "Trade #XXXXXXXX completado" |

### Qué significa cada email

**"Han tomado tu orden"**
Alguien del order book ha aceptado tu oferta. Entra en noxtr para ver el estado del trade y seguir los pasos. Si vendías BTC, la instancia te enviará en breve la hold invoice que debes pagar.

**"Debes pagar la hold invoice"**
El robot ha generado una factura Lightning especial (hold invoice) que debes pagar desde tu wallet para garantizar que tienes los fondos. La factura está visible en la ficha del trade en noxtr. El importe quedará retenido —no se cobra— hasta que el comprador confirme el pago en fiat.

**"El comprador ha enviado el pago"**
El comprador dice que ya te ha enviado el dinero fiat. Comprueba tu cuenta bancaria / wallet fiat y, si todo es correcto, entra en noxtr y pulsa **Liberar sats** para que la instancia envíe los Bitcoin al comprador.

**"Trade completado"**
Todo ha ido bien. Los sats han llegado a su destino. Puedes valorar a la contraparte desde la ficha del trade en noxtr.

### Qué hacer si no recibes el email

1. Comprueba la carpeta de spam.
2. Asegúrate de que tienes un email verificado en tu perfil de la web.
3. El monitor solo envía emails para trades que tengas **activos** en `NSTR_TRADES`. Si tomaste la orden desde otra app (Mostro Mobile), el monitor no la conoce; la restauración entre clientes todavía no está implementada.
4. El monitor debe estar corriendo: si el administrador lo paró, no hay vigilancia. En ese caso verás los cambios cuando entres manualmente en noxtr.

### Notificaciones por Telegram (si lo tienes vinculado)

Si has vinculado tu cuenta de Telegram en noxtr recibirás además un mensaje en Telegram cada vez que llegue un DM privado nuevo en tu buzón de noxtr. El mensaje dice:

> Tienes un mensaje privado nuevo en https://tudominio.com/noxtr

Esto incluye mensajes de otros usuarios. **No incluye** los mensajes de la instancia Mostro (van cifrados en kind:14 v2 y el monitor los procesa internamente, solo te avisa por email).

### El monitor no sustituye a entrar en noxtr

El monitor te avisa, pero las acciones (pagar la hold invoice, confirmar fiat enviado, liberar sats, valorar) las tienes que hacer tú desde la interfaz web. El monitor no actúa en tu nombre: solo notifica.

---

## Alta en el monitor y en el bot de Telegram

### Para usuarios: recibir notificaciones por email

No hace falta hacer nada especial. El monitor vigila automáticamente cualquier trade que tengas activo en noxtr. Solo necesitas:

1. **Tener un email válido** en tu perfil de la web (ajustes de cuenta).
2. **Tener el trade abierto en noxtr** — por ahora, un trade iniciado en Mostro Mobile no puede importarse al monitor de noxtr.

Cuando el monitor detecte un evento relevante en tus trades, te llegará un email al correo de tu cuenta.

### Para usuarios: recibir notificaciones por Telegram

1. Ve a la sección **Telegram** de la web (`/telegram`).
2. Pulsa **Vincular Telegram**.
3. Elige cómo vincular:
   - **Desde el móvil**: pulsa el enlace "Abrir bot en Telegram". Se abrirá directamente la conversación con el bot y bastará con pulsar _Iniciar_ (Start).
   - **Desde el ordenador**: copia el comando que aparece en pantalla (algo como `/start abc123def456`) y pégalo en la conversación con el bot en Telegram.
4. El bot confirmará que la vinculación fue correcta.

A partir de ese momento recibirás un aviso en Telegram cuando llegue un mensaje privado nuevo en tu buzón de noxtr.

> Si no sabes cómo encontrar el bot en Telegram, el administrador del sitio te proporcionará el nombre del bot (algo como `@MiSitioBot`).

### Para admins: recibir notificaciones del order book por Telegram

Además de las notificaciones de usuario, los admins reciben por Telegram las alertas de nuevas órdenes del order book. Para activarlo:

1. **Vincular Telegram** igual que un usuario (pasos anteriores). El `chat_id` queda registrado en la BD.
2. **Añadir tu pubkey Nostr** como admin del monitor. Hay dos formas:
   - Desde el panel web de administración del monitor (`/noxtr/server_admin`): campo de admin pubkeys.
   - Directamente en `CFG_CFG` bajo la clave `modules.noxtr.monitor_identity`, campo `admin_pubkeys` (array de pubkeys hex o npub1...).
3. **Reiniciar el monitor** (o esperar al siguiente ciclo de refresh) para que cargue el nuevo `dmNotifyIndex`.

A partir de ahí, cada nueva orden en el order book generará un mensaje Telegram con todos los detalles (ID, tipo, importe, método de pago, antigüedad de la instancia).

### Para admins: enviar comandos al monitor por Telegram / Nostr DM

El canal de control funciona por **DM Nostr (kind:4)**, no por Telegram. Para usar los comandos:

1. Necesitas un cliente Nostr que soporte DMs (noxtr, Amethyst, Damus, etc.).
2. Abre una conversación con el npub del monitor (visible en la salida de arranque o en el panel web).
3. Envía el comando en texto plano, por ejemplo: `ping`, `status`, `trades`, etc.
4. El monitor responderá por DM al mismo cliente.

> El npub del monitor también aparece en el mensaje de arranque que llega por Telegram si tienes Telegram vinculado como admin.

### Tabla resumen de requisitos

| Quiero... | Necesito... |
|---|---|
| Recibir emails de mis trades | Email válido en mi perfil |
| Recibir avisos Telegram de mis DMs | Vincular Telegram en `/telegram` |
| Recibir alertas Telegram de nuevas órdenes | Telegram vinculado + pubkey en `admin_pubkeys` del monitor |
| Enviar comandos al monitor | Cliente Nostr + pubkey en `admin_pubkeys` |
