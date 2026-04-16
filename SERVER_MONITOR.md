# Noxtr Server Monitor (`server_monitor.php`)

Versión documentada: **NostrMonitor v1.0.8**

---

## Qué es

`server_monitor.php` es un proceso CLI de larga duración que actúa como daemon de vigilancia del módulo Mostro P2P dentro de noxtr.

Su función es mantenerse conectado a relays Nostr en segundo plano —sin que ningún usuario tenga la web abierta— y reaccionar a eventos del protocolo Mostro (kind 1059 gift-wrapped) para:

- **Notificar al usuario por email** cuando ocurre algo relevante en sus trades activos.
- **Notificar a los admins por Nostr DM** sobre nuevas órdenes en el order book o sobre la activación de filtros.
- **Tomar órdenes automáticamente** (auto-take efímero) cuando una orden del order book coincide con reglas configuradas.
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
        ├── refreshState()           ← carga trades activos + reglas auto-take desde BD
        ├── buildFilters()           ← construye filtros REQ para el relay
        │     ├── kind:1059  #p:[trade_key_pub...]   (mensajes Mostro al usuario)
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
              │     └── kind 1059   → unwrap gift-wrap → maybeNotify()
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
| `NSTR_MOSTRO_TRADES` | Lee trades activos (no archivados, con claves presentes, no terminales). |
| `CLI_USER` | Lee el email del usuario por `user_id` o por `nostr_pubkey`. |
| `NSTR_EVENTS` | Deduplicación de eventos procesados; registro de notificaciones enviadas. |
| `CFG_CFG` | Lee/escribe reglas `monitor_take_filters` y configuración del perfil. |

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

Reglas anti-ruido:
- `order_taken` **no** se envía si ya se enviaron `pay_invoice`, `fiat_sent` o `trade_completed` para ese trade (el evento llegó tarde).
- Cada tipo de notificación se envía **una sola vez por orden** (guardado en `NSTR_EVENTS.notification_type`).

Configuración: la clave `modules.noxtr.trade_notification_email` en `CFG_CFG` (valores: `1`, `true`, `yes`, `on`) activa el envío real. Si está desactivada se usa `NullNotifier`.

---

## Notificaciones del order book

Además de los trades propios, el monitor suscribe el order book (`kind:38383`). Para cada orden nueva (posterior al arranque del proceso) envía:

1. **DM por Nostr** a todos los admins configurados: `orden | #shortId | BUY/SELL | importe fiat | método de pago | antigüedad robot`.
2. **Email** a los admins (resuelto por pubkey → email en `CLI_USER`, o fallback a `site.email` / `smtp.from_email`).

Solo notifica órdenes cuyo `created_at` es posterior al momento de arranque del proceso, evitando el flood de las últimas 48h al reconectar.

---

## Auto-take efímero

Cuando hay reglas de auto-take configuradas, si una orden del order book coincide, el monitor:

1. Genera un keypair efímero (`NostrCrypto::generateKeypair()`).
2. Construye el mensaje `take-sell` o `take-buy` en formato gift-wrap NIP-59.
3. Lo publica en los relays.
4. **No guarda ningún trade local** en `NSTR_MOSTRO_TRADES`.
5. Notifica a los admins por DM y email.

Las reglas son persistidas en `CFG_CFG` bajo la clave `modules.noxtr.monitor_take_filters` como JSON. Solo se aplican a órdenes de **importe fijo** (no rangos).

### Tipos de reglas

| Tipo | Descripción | Ejemplo |
|---|---|---|
| `amount` | Coincide si el importe fiat es igual al valor. Opcionalmente filtra por moneda. | `filter_trade amount 88 EUR` |
| `days` | Coincide si el robot tiene exactamente N días de antigüedad. | `filter_trade days 0` |
| `days_missing` | Coincide si el evento no tiene campo de antigüedad. | `filter_trade days missing` |

---

## Canal de control por DM (Nostr kind:4)

El monitor tiene su propia identidad Nostr (generada y persistida por `NoxtrStore::ensureMonitorIdentity()`). Los admins autorizados pueden enviarle DMs cifrados (NIP-04 AES-256-CBC) con comandos de texto plano o JSON.

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `ping` | Comprueba que el canal responde. Devuelve `pong`. |
| `status` | Versión, trades monitorizados, filtros activos, uptime, npub. |
| `trades [opciones]` | Consulta viva del order book en los relays del monitor. |
| `relays` | Relays configurados y conectados en la sesión actual. |
| `email [destino]` | Envía un email de prueba. |
| `profile` | Publica el perfil Nostr del monitor (kind:0). |
| `filter_trade [subcomando]` | Gestiona reglas de auto-take. |
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

### Subcomandos de `filter_trade`

```
filter_trade list              # reglas activas
filter_trade amount 88 EUR     # añadir regla por importe
filter_trade days 0            # añadir regla por antigüedad (N días)
filter_trade days missing      # añadir regla para robots sin días
filter_trade remove amount 88  # eliminar regla
filter_trade remove days 0
filter_trade remove days missing
filter_trade clear             # eliminar todas las reglas
```

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
| `modules.noxtr.monitor_take_filters` | JSON con reglas auto-take (gestionado via DM). |
| `modules.noxtr.monitor_command_max_age` | Tiempo máximo (segundos) para comandos de control. Defecto: 300. |
| `modules.noxtr.monitor_profile_name` | Nombre del perfil Nostr del monitor. Defecto: `MostroMonitor`. |
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
| `--debug-wide` | Suscribe kind:1059 globalmente (no solo para los trades propios). Para depuración. |
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
- El **auto-take efímero** no crea trade local: el monitor toma la orden sin guardarla en `NSTR_MOSTRO_TRADES`. Es intencional para evitar complejidad de estado, pero significa que no hay seguimiento posterior del trade tomado automaticamente.
- El command `trades` hace una consulta en tiempo real a los relays; puede tardar hasta 12 segundos si hay latencia de red.
- Los filtros `days` / `days_missing` dependen de que el robot publique el tag `rating` en la orden kind:38383. Si no lo incluye, la orden no tiene `account_days` y solo coincide con `days_missing`.
