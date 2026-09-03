# Manual del administrador — noxtr + monitor + Telegram

Guía para administrar todo el conjunto: el cliente noxtr, el monitor de notificaciones,
el bot de Telegram y la configuración compartida.

> - Manual de usuario final: [`MANUAL_USUARIO.md`](MANUAL_USUARIO.md)
> - Operación y referencia técnica del monitor: [`MANUAL_MONITOR.md`](MANUAL_MONITOR.md)
> - Referencia técnica del monitor (clases/flujo): [`SERVER_MONITOR.md`](SERVER_MONITOR.md)

---

## 1. Las piezas y cómo encajan

```
┌─────────────────────────────────────────────────────────────────┐
│  noxtr (módulo web)  —  _modules_/noxtr                         │
│  Cliente Nostr: social, Mostro P2P (Lightning), trades on-chain.│
│  Los usuarios entran, operan, vinculan Telegram.                │
│  Tablas NSTR_* (trades, relays, eventos, mensajes...).          │
└───────────────┬─────────────────────────────────────────────────┘
                │ comparte BD + relays (NSTR_RELAYS) + identidad de usuario
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  server_monitor.php  —  proceso CLI (daemon)                    │
│  Escucha los relays 24/7 aunque nadie tenga la web abierta.     │
│  Notifica eventos por EMAIL y por TELEGRAM.                     │
│  Admite control por DM Nostr de admins autorizados.             │
└───────────────┬─────────────────────────────────────────────────┘
                │ usa el bot para enviar Telegram
                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Telegram  —  _modules_/telegram                                │
│  Bot API: vincula usuarios (TGRAM_CHATS), envía notificaciones, │
│  responde por palabras clave y/o IA. Webhook para recibir.      │
└─────────────────────────────────────────────────────────────────┘
```

Idea clave: **todo comparte la misma base de datos y los mismos relays.** El monitor no
tiene config de relays propia — usa los de noxtr (`NSTR_RELAYS`). El bot es uno solo
para web y monitor (`modules.telegram.bot_token`).

---

## 2. Puesta en marcha (orden recomendado)

1. **Instalar módulos** (como admin, desde el navegador):
   - `https://tu-dominio.com/noxtr/install`
   - `https://tu-dominio.com/telegram/install`
2. **Configurar el bot de Telegram** (sección 4).
3. **Arrancar el monitor** y autorizarte como admin (sección 5).
4. **Vincular tu Telegram** como admin para recibir alertas (sección 6).
5. (Opcional) activar emails, donaciones, filtros auto-take, on-chain (secciones 7+).

---

## 3. El cliente noxtr

- **Funciones**: feed social, DMs, canales, zaps, Mostro P2P, trades on-chain. Detalle
  para el usuario en [`MANUAL_USUARIO.md`](MANUAL_USUARIO.md).
- **Tablas** `NSTR_*` (trades, relays, contactos, eventos, mensajes…). Se crean solas.
- **Relays**: gestionados por usuario en la pestaña Relays. Estos relays son también los
  que usa el monitor (ver sección 5.3).
- **Debug del cliente** (consola del navegador):
  ```js
  localStorage.setItem('noxtr_debug','1'); location.reload();  // activar
  localStorage.removeItem('noxtr_debug'); location.reload();   // desactivar
  ```
- **Bloque de donaciones**: botón `[zap]` al final del módulo. Se activa poniendo una
  Lightning Address en `modules.noxtr.donate_lnaddress` (si está vacía, no se muestra).

---

## 4. Configurar el bot de Telegram

Resumen (guía completa en `_modules_/telegram/README.md`):

1. **Crear el bot**: habla con **@BotFather** → `/newbot` → te da un **token**.
2. **Guardar el token** en `CFG_CFG`:
   ```sql
   UPDATE CFG_CFG SET V='TOKEN_DE_BOTFATHER', ACTIVE=1
   WHERE K='modules.telegram.bot_token';
   ```
3. **Registrar el webhook**: `https://tu-dominio.com/telegram/admin` → tab **Setup** →
   **Registrar webhook**. URL: `https://tu-dominio.com/telegram/raw/webhook`.
   - Requiere **HTTPS con certificado válido** (Telegram no acepta http ni autofirmados).
   - Vuelve a registrarlo si cambias dominio o token.
4. (Opcional) **IA y respuestas por palabras clave**: panel `telegram/admin` (tabs
   Textos / Setup). Claves `modules.telegram.ai_service` + las `ai.*` del proveedor.

**Importante:** el bot es el mismo para los avisos de la web y los del monitor (ambos
leen `modules.telegram.bot_token`).

---

## 5. El monitor (daemon de notificaciones)

> Referencia completa: [`MANUAL_MONITOR.md`](MANUAL_MONITOR.md). Aquí, lo esencial.

### 5.1. Arrancar

```bash
php /ruta/public_html/index.php noxtr/server/action=monitor --verbose
```

En el bootstrap verás `npub`, `relays : N` y `admins : N`. Para verificar config sin
conectar: `--once`. Para dejarlo permanente: nohup, panel `/noxtr/server_admin`
(Start/Stop/Status), o **systemd** (recomendado — plantilla en `MANUAL_MONITOR.md` §2).

### 5.2. Autorizar admins (control por DM)

El monitor tiene su **propia identidad Nostr** (npub, auto-generada). Solo las pubkeys en
`modules.noxtr.monitor_admin_pubkeys` pueden mandarle comandos. Añádelas (npub o hex, coma):

```sql
UPDATE CFG_CFG SET V='npub1tuadmin,npub1otro', ACTIVE=1
WHERE K='modules.noxtr.monitor_admin_pubkeys';
```

Reinicia (o `reload`). Comprueba con `--once`: `admins : N`. Prueba mandando `ping` por
DM Nostr a la npub del monitor → responde `pong`.

### 5.3. Relays — config compartida con noxtr (¡importante!)

El monitor **NO tiene clave CFG de relays propia**. Usa los **relays activos de noxtr**
(`NSTR_RELAYS`, de todos los usuarios), con un fallback hardcodeado
(`NoxtrStore::DEFAULT_MONITOR_RELAYS`) solo si la tabla está vacía.

- Para que el monitor escuche/publique en un relay → **añádelo/actívalo en la web de
  noxtr** (pestaña Relays).
- Los cambios de relays se aplican **al reiniciar el proceso** (un `reload` no basta).
- Esto garantiza que el monitor ve los mismos eventos (Mostro, on-chain, DMs) que la web.

### 5.4. Comandos de control (DM Nostr kind:4/NIP-04)

`ping`, `status`, `trades [age/amount/status]`, `relays`, `email [destino]`, `profile`,
`filter_trade …`, `reload`, `stop`. El monitor responde por NIP-04.

### 5.5. Auto-take (toma automática de órdenes)

Reglas que toman órdenes del order book automáticamente cuando coinciden. Se gestionan
por DM: `filter_trade amount 88 EUR`, `filter_trade days 0`, `filter_trade list`,
`filter_trade clear`. Persistidas en `modules.noxtr.monitor_take_filters` (JSON). Solo
órdenes de importe fijo (no rangos). El auto-take **no guarda trade local**.

---

## 6. Quién recibe qué notificación

| Notificación | Canal | Destinatario | Requisito |
|---|---|---|---|
| Eventos de un trade (tomado, pagar invoice, fiat, completado, disputa) | Email | Dueño del trade | Email válido en su perfil |
| Lo mismo + eventos on-chain | Telegram | Dueño del trade | Telegram vinculado |
| **Nueva orden en el order book** | Telegram | **Admins** | pubkey en `monitor_admin_pubkeys` **+** Telegram vinculado |
| Filtro auto-take disparado | DM Nostr + email + Telegram | Admins | Igual |
| DM Nostr entrante a un usuario | Telegram | Ese usuario | Telegram vinculado |

**Para que un ADMIN reciba alertas de order book por Telegram necesita las dos cosas:**
1. Telegram vinculado (`/telegram`) → su `chat_id` en `TGRAM_CHATS`.
2. Su `CLI_USER.nostr_pubkey` debe coincidir con una pubkey de `monitor_admin_pubkeys`.

El monitor cruza ambas tablas. Tras vincular, **reinicia/`reload`** para recargar el índice.

> Las alertas de "nueva orden del order book" solo salen si está activado el flag de
> new-offer notifications (lo ves como `new-offer notif` en el bootstrap).

---

## 7. Email

Pon `modules.noxtr.trade_notification_email` a `1`/`true`/`yes`/`on` para activar el
envío real (si no, el monitor usa un notificador nulo y solo registra). El SMTP es el del
sitio (config del framework).

---

## 8. Trades on-chain (NostrEscrow)

- El monitor vigila los eventos públicos on-chain (kinds 39385/39386/39387/39389 con
  `#y=nostrescrow`) además de Mostro. Avisa al dueño del trade local cuya identidad Nostr
  coincide con el destinatario del evento.
- **Requisito**: los relays donde publican los clientes on-chain deben estar en
  `NSTR_RELAYS` (ahora que el monitor los hereda, basta con que estén en la web).
- **Árbitro del sitio**: hay un panel para registrar el sitio como árbitro on-chain y
  gestionar disputas (`modules.noxtr.onchain_site_arbitrator` y relacionados).
- **Limitación**: los DMs cifrados iniciales (`take_request`, `arb_signature`) no se
  notifican (el monitor no tiene esa privkey); la visibilidad empieza en el `accept` público.

---

## 9. Referencia de claves CFG (tabla `CFG_CFG`, columnas K / V / DESCRIPTION / ACTIVE)

| Clave | Para qué |
|---|---|
| `modules.noxtr.monitor_privkey` / `monitor_pubkey` | Identidad Nostr del monitor (auto-generada). **No compartir la privkey.** |
| `modules.noxtr.monitor_admin_pubkeys` | Admins autorizados a controlar el monitor (npub/hex, coma). |
| `modules.noxtr.monitor_command_max_age` | Antigüedad máx. de comandos (s). Defecto 300. |
| `modules.noxtr.monitor_take_filters` | Reglas auto-take (JSON; gestionar por DM). |
| `modules.noxtr.monitor_profile_name` / `_about` / `_picture` | Perfil Nostr del monitor. |
| `modules.noxtr.monitor_dm_ttl_hours` | Purga DMs del monitor más viejos que N horas (0 = sin TTL). |
| `modules.noxtr.trade_notification_email` | `1` activa los emails de trades. |
| `modules.noxtr.donate_lnaddress` | Lightning Address del botón `[zap]` de apoyo (vacío = oculto). |
| `modules.telegram.bot_token` | Token del bot de @BotFather (web + monitor). |
| `modules.telegram.webhook_secret` | Secreto del webhook (auto-generado). |
| `modules.telegram.ai_service` + `ai.*` | IA del bot (opcional). |

> Los **relays del monitor NO son una clave CFG** — se derivan de `NSTR_RELAYS`. Ver §5.3.
>
> `CFG_CFG.K` **no tiene índice UNIQUE**: para cambiar un valor usa `SELECT` + `UPDATE`
> (o el panel de configuración), nunca `INSERT` a ciegas (crearía duplicados).

---

## 10. Operación diaria y mantenimiento

- **¿Monitor vivo?** `ps -ef | grep 'noxtr/server' | grep -v grep` (debe dar un PID), o
  el botón Status del panel, o `ping`→`pong` por DM.
- **Logs**: si arrancaste con nohup/systemd → `tail -50 /var/log/noxtr-monitor.log`.
- **Tras cambiar relays / admins / vincular Telegram de admin**: reinicia el monitor
  (restart completo para relays; `reload` basta para admins/sesión).
- **Si el proceso muere**: revisa el log, relanza. No duplica avisos (dedup en `NSTR_EVENTS`).

---

## 11. Resolución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| `admins : 0` / `ping` sin respuesta | Sin admins autorizados o sin relay común | Añade tu npub a `monitor_admin_pubkeys`; asegúrate de compartir relay (NSTR_RELAYS). |
| Email no llega | `trade_notification_email` off o sin email en perfil | Activa la clave; revisa spam. |
| Telegram no llega | Sin token, webhook no registrado, o usuario sin vincular | Revisa token, registra webhook, vincula en `/telegram`. |
| Admin sin alertas de order book | Falta Telegram vinculado **o** pubkey no en `monitor_admin_pubkeys` | Necesita ambas; luego `reload`. |
| No avisa on-chain / pierde eventos | Faltan relays donde publican los clientes | Añádelos/actívalos en la web (NSTR_RELAYS) y reinicia el monitor. |
| Monitor muere al cerrar SSH | Lanzado en primer plano | nohup / systemd. |
| Duplicados en `CFG_CFG` | `INSERT` repetido (K sin UNIQUE) | Dedup: dejar `MIN(id)` por K y borrar el resto. |

---

## 12. Multi-sitio (avanzado)

El monitor puede atender varios sitios noxtr remotos vía API (`RemoteSiteDataSource` +
`MultiSiteDataSource`, tabla `NSTR_NOXTR_SITES`). Las `trade_privkey` nunca salen del
sitio remoto: el descifrado se hace allí. Diseño y estado en `SERVER_MONITOR.md` §"Monitor
multi-sitio".

---

## 13. Seguridad

- La **privkey del monitor** y el **bot_token** son secretos: protégelos.
- Las `monitor_admin_pubkeys` dan control total del monitor — añade solo pubkeys de confianza.
- Todo el control del monitor va firmado (Schnorr) y caduca (`monitor_command_max_age`).
- Webhook de Telegram protegido por `webhook_secret` — siempre HTTPS válido.
