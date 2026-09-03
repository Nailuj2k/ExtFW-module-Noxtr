# Noxtr — Nostr Client Module for ExtFW

Cliente Nostr implementado como módulo de ExtFW. Versión actual: **2.5.0**.

> **Fuente de verdad para Mostro:** el protocolo (https://mostro.network/protocol/) y el código fuente real de `mostro-core`/`mostro` (enums `Action`/`Payload` en `message.rs`, handlers en `src/app/*.rs`). Este documento puede quedar desfasado respecto al código; ante discrepancia gana el protocolo/código, y se corrige aquí. Para verificar algo del protocolo, clonar o descargar el archivo `.rs` relevante y leerlo — no asumir a partir de un comentario viejo de este documento.
>
> **Git no es la fuente de verdad de este proyecto.** El código se edita en local y se sube manualmente al webserver; no hay CI/PRs. `_modules_/noxtr` es el módulo canónico (`_modules_/noxtr_pepe` es un intento de rediseño de UI, no una copia a mantener sincronizada).

## File Map

| File | Purpose |
|---|---|
| `init.php` | Module init: CSP headers, carga `NoxtrStore`, llama a `ensureTables()` |
| `run.php` | HTML principal: header, identidad, editor de perfil, compose, hilos, tabs, paneles laterales, feed, panel Mostro P2P |
| `head.php` | CSS + JS con cache-bust `?ver=$version` (variable `$version`, súbela al cambiar cualquier JS/CSS del módulo). Incluye `style.css`, `style.mostro.css`, libs (bitcoin/qr/cropper/dropzone/bip39) y `script.js`, `script.mostro.js`, `script.onchain.js` (`script.mostro.admin.js` — ver "Panel admin", desactivado) |
| `script.js` | Lógica cliente del feed social: relay pool, eventos, perfiles, contactos, topics, bookmarks, DMs, relays, hilos, zaps, NIP-44/46, UI |
| `script.mostro.js` | Cliente Mostro P2P completo (ver secciones más abajo). IIFE independiente, no depende del de `script.js` |
| `script.onchain.js` | Cliente NostrEscrow (P2P on-chain con escrow Taproot) — ver `NOSTR_ONCHAIN.md` |
| `style.css` / `style.mostro.css` | Estilos del módulo |
| `ajax.php` | Endpoint AJAX: contactos, topics, bookmarks, mensajes, relays, perfil, zaps, publicación de artículos, acciones Mostro (`mostro_trade_*`, `get_mostro_seed`, `save_mostro_seed`, `log_mostro_event`, `save_fiat_filter`...) |
| `raw.php` | Salida raw: NIP-05 (`nostr.json`) y LNURL-pay (`lnurlp`) |
| `noxtrstore.class.php` | Capa de datos: `extends DbConnection`, tablas + CRUD (contactos, topics, bookmarks, mensajes, relays, muted, trades Mostro, config per-usuario) |
| `nostr_crypto.php` | Firmas Schnorr BIP-340 para el keypair del servidor (LNURL-pay/NIP-57) |
| `server_monitor.php` | Daemon standalone: vigila trades Mostro/on-chain en segundo plano y notifica por email/Telegram. Ver `SERVER_MONITOR.md`/`MANUAL_MONITOR.md` |
| `footer.php` | Includes JS + llamada a `Noxtr.init()` (pubkey, ajaxUrl, userId, username, noteId). Callbacks de subida de imagen (banner/avatar) |

## Database Tables (NSTR_*)

Todas soportan MySQL y SQLite (`self::isSQLite()` para bifurcar sintaxis). Creadas/migradas en `NoxtrStore::ensureTables()`, gateado por `$_SESSION['noxtr_tables_v']` (entero versionado). Migraciones de columna son aditivas (`ALTER TABLE ADD COLUMN`, idempotentes vía `tableHasColumn()`).

- **NSTR_CONTACTS** — pubkeys seguidos (pubkey, petname, relay_url, active)
- **NSTR_TOPICS** — hashtags suscritos (topic, active, sort_order)
- **NSTR_BOOKMARKS** — eventos guardados (event_id, event_pubkey, event_content, event_created_at, event_kind, event_tags)
- **NSTR_MESSAGES** — DMs en caché (event_id, peer_pubkey, sender_pubkey, content_encrypted)
- **NSTR_RELAYS** — URLs de relay (url, active), sembrada con defaults
- **NSTR_MUTED** — pubkeys silenciados (pubkey, created_at)
- **NSTR_CHANNELS** — canales NIP-28 unidos (channel_id, name, about, picture, creator_pubkey, relay_url, pinned)
- **NSTR_NIP96_SERVERS** — servidores de subida NIP-96 por usuario
- **NSTR_EVENTS** — log de eventos Nostr del cliente Mostro (gift wraps/rumores desempaquetados/mensajes salientes): `event_id`, `kind`, `order_id`, `user_id`, `event_created_at`, `source` (`client_in`/`client_rumor`/`client_out`/`client_out_plain`), `status`, `raw_json`, `notification_type`, `notification_sent_at`, `processed_at`. Mismo schema que usa `server_monitor.php` para coexistir. `client_out_plain` (contenido en claro del mensaje saliente) solo se persiste con `noxtr_debug` activo — ver "Debug".
- **NSTR_TRADES** — trades Mostro/on-chain: `order_id`, `method` (`lightning`/`onchain`), `robot_pubkey`, `trade_kind`, `trade_role`, `trade_privkey` (**cifrado en reposo**, ver "Custodia de claves"), `trade_key_pub`, `trade_index` (el que viaja en el protocolo), `seed_index` (índice de derivación NIP-06, solo local), `internal_status`, `status`, `is_seller`, `fiat_amount`, `fiat_code`, `sat_amount`, `payment_method`, `peer_pubkey`, `dispute_id`, `solver_pubkey`, campos on-chain (`arbitrators`, `taproot_address`, `funding_txid/vout/block`, `confirmations`, `trade_json`), `my_rating`, `archived`, `bond_paid`
- **CLI_USER_CFG** — tabla de framework (K/V por `user_id`), reusada para preferencias: `noxtr.fiat_filter` (filtro de monedas), `noxtr.mostro_seed` (semilla Mostro, **cifrada**)

Todas las `NSTR_*` van indexadas por `user_id`, con constraints únicos donde aplica.

## JavaScript Architecture (script.js — feed social)

IIFE único exponiendo `window.Noxtr = { init, logout, Events, ... }`.

- `Noxtr.logout()` — desconecta relays/NIP-46/Bunker, limpia identidad y datos ligados a ella en memoria, borra `noxtr_npub`/`noxtr_nip46`/cachés privadas y propaga el cierre a otras pestañas mediante `noxtr_logout_at`. `/login/logout` ejecuta el mismo contrato incluso si Noxtr no está cargado; `noxtr_logged_out` impide restaurar automáticamente IndexedDB, NIP-46 o NIP-07 al volver. Las claves de IndexedDB se preservan para que el módulo `login` pueda usarlas en un acceso posterior.
- **Api** — `call(action, params)` → POST a `ajax.php`, requiere `userId > 0`
- **Pool** — pool de relays WebSocket: `connect()`, `disconnectAll()`, `subscribe()`, `publish()`, `getStatus()`
- **Profiles** — caché de perfiles (kind 0): `request()`, `displayName()`, `avatar()`, `color()`
- **Events** — firma: NIP-07 (extensión), NIP-46 (Nostr Connect) o nsec (privkey). `publish()`, `canSign()`, `setPubkey()`, `setPrivkey()`
- **Contacts / Topics / Relays / Bookmarks / Muted** — CRUD estándar contra sus tablas
- **DMs** — NIP-04: `loadFromDb()`, `subscribe()`, `send()`, `openThread()`
- **Channels** — NIP-28 (kinds 40/41/42): ver `NOSTRCHAT.md` para la guía completa
- **Nip44** — cifrado NIP-44 (ECDH + HKDF-SHA256 + XChaCha20-Poly1305)
- **Nip46** — NIP-46 Nostr Connect (firma remota). Estado en `localStorage('noxtr_nip46')`
- **Threads** — vista de hilo NIP-10
- **Feed / UI** — render de notas, tabs, editor de perfil, flujo de zap

### Storage
- **IndexedDB** `JuxNostrKeys` (store `keys`) — claves NIP-46/nsec por `user_<id>`, persiste entre sesiones
- **localStorage** — `noxtr_npub`, `noxtr_nip46`, `noxtr_col_*` (paneles colapsables), flags per-usuario (`noxtr_mostro_reputation_u<id>`, etc.)
- **sessionStorage** — `noxtr_autologin_skip`

### Permalinks y tabs
- `/noxtr/note/HEX_ID` o `/noxtr/note/note1...` → `Threads.openById()`
- Tabs: `topics`, `following`, `followers`, `messages`, `channels`, `bookmarks`, `relays`, `mostro` (monkey-patch en `script.mostro.js`)

## Nostr Protocols Implemented

NIP-01, 02 (contact list), 04 (DMs), 05 (identidad, `raw.php`), 07 (extensión), 09 (borrado), 10 (hilos), 19 (bech32), 25 (reacciones), 28 (canales, ver `NOSTRCHAT.md`), 44 (cifrado versionado), 46 (Nostr Connect), 56 (reportes), 57 (zaps), 69 (order book Mostro), 84 (highlights). Kind 6 (reposts).

## LNURL-pay / Lightning Address (raw.php)

`/.well-known/lnurlp/USERNAME`: discovery (metadata + `allowsNostr`) y callback (`?amount=X`, valida zap request NIP-57, crea invoice BTCPay). Keypair del servidor auto-generado en `CFG_CFG` (`noxtr.server_privkey`/`server_pubkey`). Config BTCPay en `CFG_CFG` (`btcpay.url`/`store_id`/`api_key`).

## Zaps (ajax.php → create_zap)

Si el destinatario es un usuario registrado (`nostr_pubkey` en `CLI_USER`) y el emisor tiene saldo: transferencia interna. Si no: invoice BTCPay externa.

---

# Mostro P2P — Arquitectura

Cliente Mostro completo en `script.mostro.js` (módulo `MostroTrader`/`MostroBook`/`MostroCommunities`). Panel admin (`script.mostro.admin.js`) **desactivado** — ver sección propia.

## Transporte v2 (kind 14)

Único transporte soportado (v1/gift-wrap kind 1059 eliminado, sin compatibilidad hacia atrás).

- **Envío** (`_wrapV2`): evento kind 14, autor = trade key, `content` = NIP-44 (convKey `tradePriv↔mostroPub`) del 3-tuple `[msgObj, tradeSig, identityProof]`. Tags `[['p', mostroPub], ['expiration', now+2d]]` (NIP-40 obligatorio). PoW NIP-13 (ver "PoW" más abajo).
- **`_buildMsg`**: construye `{order: {version:2, request_id, trade_index, id?, action, payload}}` — **el orden de campos importa**: coincide con el struct real `MessageKind` de `mostro-core` (`version, request_id, trade_index, id (omitido si no hay), action, payload`), porque el daemon no verifica la firma contra los bytes recibidos: deserializa a `Message` y **re-serializa con serde** para hashear (`transport.rs::unwrap_message_nip44`). Un orden distinto = firma que nunca verifica, en silencio. Mismo criterio aplicado a `SmallOrder` (payload de `new-order`) — su único payload con campos con nombre que noxtr envía; el resto (`PaymentRequest`, `NextTrade`, `Amount`, `RatingUser`) son tuplas/newtypes sin riesgo de orden.
- **`trade_index`**: en privacidad total va **vacío** (`null`) durante toda la vida del trade — el protocolo lo marca opcional y Mostro lo ignora fuera de modo reputación. En modo reputación es el contador monotónico de `_nextTradeIndex()`. Ojo: el índice de `next_trade` (payload de las órdenes de rango) es un campo **distinto y no-opcional** del protocolo (`u32`) — no confundir con este.
- **Recepción** (`_unwrapV2`): descifra 1 capa NIP-44, devuelve `tuple[0]`. Antes de desempaquetar se verifica `ev.sig` (recalculando el id NIP-01, no fiándose del que trae el evento) contra `ev.pubkey` — tanto para el canal de la instancia como para el chat.
- **`subscribeMyTrades`**: tres filtros kind 14 — `{authors:[robots], '#p':[tradeKeys]}` (instancia), `{authors:[chatSignKeys]}` (chat P2P), `{authors:[disputeSignKeys]}` (chat disputa). Todos por `authors`, no por `#p` (un filtro por `#p` únicamente deja el canal abierto a que un tercero lo inunde con eventos ajenos — el tag es público, solo `authors` es una garantía real de que el relay filtra por quien realmente firmó). `since` persistido en `localStorage('noxtr_mostro_chat_since')` (marca de agua del `created_at` más alto visto) en vez de recargar siempre 7 días completos; `limit:200` por filtro.
- **`request_id`**: se incrementa por mensaje saliente y se guarda por trade (`trade._lastSentReqId`); al recibir una respuesta se compara contra `order.request_id` y se avisa por consola (no bloqueante) si no coincide — señal de desorden/replay.
- **Privacidad total** (default): tuple = `[msgObj, null, null]`, la firma del propio kind 14 prueba la trade key.
- **PoW**: `_minePoW` mina contra `max(NIP-11 del relay, pow del robot)`. Para `new-order`/`take-*` específicamente (que siempre estrenan una trade key nunca vista por el nodo — "first contact" en `spam_gate.rs` del daemon) se usa `pow_first_contact` (tag del 38385) en vez del `pow` base; sin el tag, se dobla el `pow` base como cobertura defensiva.
- **Log de eventos**: `NSTR_EVENTS` vía `_logMostroEv`. El `console.log`/`client_out_plain` con el contenido en claro del mensaje saliente solo se activan con `noxtr_debug` (ver "Debug") — no van siempre encendidos.

## Chat P2P y de disputa (kind 14 + HKDF)

Sin clave efímera ni capa "seal" (esquema simplificado, protocol/chat.html + dispute_chat.html).

- **Derivación** (`_chatDerivedKeys`): `shared = ECDH(tradePriv, peerPub)` → `K_conv = HKDF-SHA256(shared, info="mostro:chat:conv:v1")`, `K_sign = HKDF-SHA256(shared, info="mostro:chat:sign:v1")` (salt vacío, reintento incrementando `info` si el resultado no es una clave secp256k1 válida). El ECDH es simétrico → ambas partes derivan el mismo par.
- **Evento interno** (kind 1, rumor): `{kind:1, pubkey:tradePub, content, tags:[], created_at}`, firmado con la trade key real del emisor.
- **Evento externo** (kind 14): `pubkey = pub(K_sign)`, `content` = NIP-44 del rumor con `conversation_key = NIP44(K_conv_priv, pub(K_conv))` ("self-encryption"), `tags:[['p', pub(K_conv)]]`, firmado con `K_sign`.
- **Verificación al recibir** (`_p2pUnwrap`): cota de tamaño (64 KiB), firma del rumor interno verificada contra su propio `pubkey`, cota de reloj (`|inner.created_at − ev.created_at| ≤ 60s`), dedup durable por `inner.id` (`localStorage('noxtr_mostro_chat_seen_ids')`, acotado a 500). El **remitente** se exige exacto: chat P2P → `_peerChatPubkey(trade)`; chat disputa → `[trade.robot_pubkey, trade.solver_pubkey]`.
- **Suscripción**: ambos por `authors` (P2P: `K_sign` del chat; disputa: `K_sign` de la clave derivada contra `solver_pubkey`) — no por `#p`.
- **Compartir la shared key con el admin**: si el admin necesita revisar el chat P2P (comprador↔vendedor) como prueba en una disputa, no puede derivarla solo (no es parte de ese ECDH) — a diferencia del chat de disputa (usuario↔admin), donde sí puede. Botón 🔑 en `.mostro-chat-box` (visible cuando `trade._chatKey.conv.priv` ya existe) muestra **solo `K_conv` privada** (nunca el secreto ECDH crudo ni `K_sign` — esos permitirían además firmar/falsificar mensajes, no solo leerlos), mismo criterio que Mostro Mobile (`user_information_tab.dart`).

## Semilla Mostro propia y derivación NIP-06

`MostroTrader.ensureSeed()` genera una semilla BIP39 propia (12 palabras, `bip39.generateMnemonic()`) la primera vez que hace falta. Se guarda cifrada en `CLI_USER_CFG` (`K='noxtr.mostro_seed'`). De esa misma semilla se derivan la identidad Mostro en `m/44'/1237'/38383'/0/0` y las trade keys en `m/44'/1237'/38383'/0/N`. No existe fallback a claves aleatorias: si la semilla o el historial no están disponibles, la creación falla de forma segura.

`seed_index` registra localmente qué hijo produjo la trade key. En modo reputación coincide exactamente con `trade_index`; en privacidad, `trade_index` se omite del mensaje pero la clave continúa derivándose con un `seed_index` único. El máximo histórico se calcula sobre todas las filas, incluidas archivadas, no solo sobre las 200 cargadas en la UI.

### `last-trade-index` / `restore-session`

Verificado contra el código real del daemon (`last_trade_index.rs`, `restore_session.rs`):

- **`last-trade-index` está implementado** en modo reputación: consulta cada instancia con la identidad índice 0 antes de reservar el siguiente índice y correlaciona la respuesta por `request_id`.
- **`restore-session`**: la respuesta puede tardar **hasta 1 hora** (job en background del propio daemon). Reconciliar lo devuelto contra `NSTR_TRADES` sin duplicar ni pisar un trade activo es desarrollo propio, no una llamada suelta.
- La importación de una semilla externa queda deshabilitada hasta implementar `restore-session` completo.

## Modo reputación

- Identidad de reputación = clave índice 0 de la semilla Mostro. Es independiente de la identidad social del login y funciona también con NIP-07, NIP-46 o login en modo lectura.
- Flag per-usuario `noxtr_mostro_reputation_u<userId>` (localStorage), **OFF por defecto**. Toggle: botón "⭐ Reputación" → `MostroTrader.setupReputation()`.
- ON: `tradeSig = _mostroSign(messageJson, tradeKey)`; `identityProof = [identity0.pub, _mostroSign('mostro-transport-v2-identity:'+tradePub+':'+messageJson, identity0.priv)]`.
- Reputación de la **contraparte** (tag `rating` del 38383, visible al taker sobre el maker) es independiente del modo reputación propio: se ve siempre. La reputación del taker hacia el maker no la expone el protocolo (confirmado por el dev de Mostro).
- "Mi reputación" se obtiene de los kind 38384 dirigidos a las trade pubkeys propias que pertenecen a trades con reputación.

## Bonds (anti-abuso)

Detrás del flag `enable_bonds` (`localStorage('noxtr_mostro_bonds')`, default **OFF**; con OFF el comportamiento es idéntico a no tener bonds).

- **Detección** (38385, tags `bond_enabled`/`bond_apply_to`): `bond_enabled` ausente = daemon sin bonds; `"false"` = soportado no activado; `"true"` = exige fianza. `_robotRequiresBond(pubkey, 'take'|'make')`.
- **OFF**: badge rojo "EXIGE FIANZA" en el order book; `takeOrder()`/`createOrder()` bloquean vía `_bondsBlock` con aviso. Si llega `pay-bond-invoice`/`add-bond-invoice` de todos modos, se marca `_bondIncompatible` + `cancelado`.
- **ON**: badge naranja informativo, no bloqueante. `pay-bond-invoice` (Mostro→cliente): QR de fianza (mismo mecanismo que la hold invoice, NWC + QR + copiar), el cliente no responde. `add-bond-invoice` (tras slash): formulario de bolt11, responde con la misma acción. `bond-slashed`/`bond-invoice-accepted`/`bond-payout-completed`: solo notifican.

## `protocol_version` — detección de instancias v1

El 38385 publica `protocol_version` (tag ausente = v1, daemon previo al tag). `_handleStatusEvent` guarda `MostroBook._robotProto[pubkey]`; `_robotOldProtocol(pubkey)` = 38385 recibido y versión ≠ 2 (sin 38385 aún, no se bloquea — ventana de duda corta). Chip `v1` (rojo) / `v2` (verde) en `MostroCommunities.robotIdentityHtml`. `takeOrder()` y la rama LN de `createOrder()` abortan **antes** de crear el trade local si la instancia es v1 confirmada (contra un nodo v1 el mensaje se perdería en silencio: mostrod ≥ 0.19 no habla v1).

## Custodia de claves — `trade_privkey` cifrado en reposo

`NSTR_TRADES.trade_privkey` y `CLI_USER_CFG.noxtr.mostro_seed` se guardan cifrados con AES-256-GCM (`NoxtrStore::encTradePrivkey`/`decTradePrivkey`, genéricas pese al nombre — cifran/descifran cualquier string). Clave de 32 bytes auto-generada en `CFG_CFG` (`modules.noxtr.trade_privkey_enc_key`), mismo mecanismo que ya usaban `server_privkey`/`monitor_privkey`. Prefijo `enc1:` distingue valores cifrados de hex plano legacy (fallback transparente en `decTradePrivkey`, migración en segundo plano vía `migrateEncryptTradePrivkeys()`).

**Qué protege y qué no**: mitiga un dump/backup parcial de la BD (solo la tabla, o sin el resto del stack). **No** protege contra un servidor de aplicación totalmente comprometido, porque la clave vive en la misma BD que protege — decisión consciente: mover la custodia completa al cliente (que el servidor nunca vea la clave) rompería la vigilancia en segundo plano del monitor (necesita descifrar para poder avisar por email/Telegram aunque el usuario tenga la pestaña cerrada), que es una función real que se usa. Separar la clave de cifrado a un fichero fuera de la BD **no sirve si la propia BD es SQLite** (un fichero más en el mismo filesystem, mismo nivel de acceso que cualquier otro) — solo tendría sentido con un motor de BD aparte (MySQL) con sus propias credenciales.

## Panel admin (`script.mostro.admin.js`) — desactivado

Herramienta para quien administra/resuelve disputas de una instancia Mostro (no para el usuario normal — no toca el chat de un trade ni el chat de disputa del lado usuario, que están en `script.mostro.js` y funcionan). `admin-cancel`/`admin-settle` están migrados a transporte v2 (firmados con la identidad del admin directamente, sin identity proof — verificado contra `admin_cancel.rs`/`admin_settle.rs`: el daemon usa `event.identity`, que sin proof es `event.pubkey`). Falta `admin-take-dispute`, `admin-add-solver`, listado del 38386 y chat de disputa lado admin.

**Desactivado en `head.php`** (línea `HTML::js(...script.mostro.admin.js...)` comentada): no lo usa nadie hoy y ni siquiera Mostro Mobile tiene un panel de administración de disputas (confirmado en su propio README: sigue en el roadmap, sin marcar). El archivo se queda intacto en el módulo para retomarlo — descomentar esa línea cuando se complete.

## Disputas

- Botón "Disputar" en `activo`/`fiat_enviado` sin disputa abierta. `admin-took-dispute` deriva `_disputeChatKey` contra `solver_pubkey` y abre el chat.
- **`admin-settled`/`admin-canceled`**: cuando un admin resuelve una disputa, Mostro no manda las acciones normales de cierre (`success`/`canceled`) — manda literalmente estas dos, payload siempre `null`, a ambas partes (verificado contra `admin_settle.rs`/`admin_cancel.rs`). `admin-canceled` no tiene ningún mensaje posterior para nadie; `admin-settled` solo llega un `purchase-completed` posterior al comprador, nunca al vendedor. Mapeadas en `statusMap` (`→ completado`/`cancelado`) con notificación explícita.
- **`cooperative-cancel-accepted`**: verificado contra `cancel.rs` del daemon — tras aceptar una cancelación cooperativa, el daemon **no** manda ningún `canceled` posterior. Mapeada directamente a `cancelado` en `statusMap`.
- Botón "Anular disputa": `cancel-dispute` no existe en el protocolo — el botón solo oculta la disputa en local, con aviso de que en Mostro sigue abierta hasta que un admin la resuelva.
- Eventos públicos 38386 (`#z=dispute`): `_handleDisputeEvent` mantiene `MostroBook.disputeStatus[disputeId]`.
- DB: `NSTR_TRADES.dispute_id`/`solver_pubkey`. Vista pública `/noxtr/disputes` (`disputes.php`).
- Monitor: notifica `dispute_started_by_you/-by_peer`, `dispute_admin_assigned`, `dispute_resolved_settled/-canceled`. `loadActiveTrades` mantiene `disputado` como estado activo en suscripciones (se descarta solo al pasar a `cancelado`/`completado`/`archivado`) — si no, el monitor dejaría de escuchar justo cuando empieza la disputa.

## Acciones Mostro

**Enviadas:** `new-order`, `take-sell`, `take-buy`, `add-invoice`, `fiat-sent`, `release`, `cancel`, `dispute`, `rate-user` (no `rate` — eso lo manda el daemon para *pedir* valoración), `add-bond-invoice`.

**Recibidas:** `new-order`/`order`, `pay-invoice`, `waiting-seller-to-pay`, `waiting-buyer-invoice`, `add-invoice`, `hold-invoice-payment-accepted`, `active`, `buyer-took-order`, `fiat-sent`, `fiat-sent-ok`, `releasing`, `released`, `success`, `purchase-completed`, `hold-invoice-payment-settled/-canceled`, `canceled`, `cancel`, `cooperative-cancel-*`, `cant-do` (razón mostrada cruda, sin mapear los 36 valores de `CantDoReason`), `payment-failed`, `dispute-initiated-by-you/-peer`, `admin-took-dispute`, `admin-settled/-canceled`, `rate`, `rate-received`, `send-dm`, `trade-pubkey`/`invoice-updated` (solo log), `pay-bond-invoice`/`add-bond-invoice`/`bond-slashed`/`bond-invoice-accepted`/`bond-payout-completed`.

### Estructuras de payload clave

```
add-invoice (Mostro→comprador): payment_request: [null, null, <sats>]
add-invoice (comprador→Mostro): payment_request: [null, "<bolt11_o_lnaddr>", <sats>]
pay-invoice (Mostro→vendedor):  payment_request: [<order>, "<bolt11_hold_invoice>", <sats>]
hold-invoice-payment-accepted:  order: {status:'active', fiat_amount, fiat_code, payment_method, buyer/seller_trade_pubkey}
```

Secuencia típica compra: `new-order` → confirmación con UUID real → [vendedor toma] → `add-invoice` (petición) → `add-invoice` (respuesta) → `hold-invoice-payment-accepted` → `fiat-sent` → `hold-invoice-payment-settled`.

## Rangos (`next_trade`)

`_prepareChildOrderIfNeeded()` en `fiat-sent`/`release` genera la sub-orden hija. Payload `NextTrade(pubkey, index)` — el índice es el de derivación NIP-06 de la clave de la hija (`nextKp.seedIndex`), con fallback al contador monotónico (reputación) o `padre+1` (privacidad total) solo si no hay semilla cargada todavía.

## Fichas de trade / UI

- Trade cards: rol (`Creada por ti`/`Tomada por ti`), badge de estado, fecha + aviso de atasco (`STALE_THRESH` por estado), reputación de la contraparte (badge `👤★4.x`, solo visible al taker), 🔑 compartir shared key.
- Historial: 5 más recientes, link "Ver todos (N)" → `/noxtr/trades`.
- `needsAction`: borde rojo pulsante para compradores en estados que requieren su acción.
- **Estado público del 38383 → "Mis trades"**: `_applyPublicOrderStatus` actualiza el trade local cuando llega un estado público no-pending (`canceled`, `canceled-by-admin`, `settled-by-admin`, `completed-by-admin`, `expired`, `success`, `cooperatively-canceled`, `fiat-sent`, `dispute` — valores reales del enum `Status`, kebab-case). Cubre sobre todo lo que el canal DM no manda nunca (`expired`: orden nunca tomada, no hay trade key del otro lado para avisar).

## Riesgo conocido — ventana `tmp order_id` → UUID real

Al crear una orden: se guarda local con `order_id` temporal `tmp-...`, se manda `new-order`, y al llegar la confirmación con `payload.order.id` se reemplaza por el UUID real. Si ese mensaje de confirmación se pierde, la fila local podría quedarse sin reconocerse a sí misma como "propia" en el order book. En la práctica el riesgo es bajo (`order.id` viene también en varios mensajes posteriores del flujo), y no hay heurística de reconciliación agresiva a propósito (produciría falsos positivos). Sin cambios mientras no aparezca un caso real.

## Mostro Mobile — restauración pendiente

No hay importador parcial: usar la clave índice 0 como login Nostr y generar después otra semilla Mostro separada rompía la continuidad de identidad. La futura importación deberá instalar la semilla como sesión Mostro y ejecutar `restore-session` antes de anunciar compatibilidad.

## Estado de pruebas

Flujos verificados de punta a punta: tomar orden de compra/venta creada en Mostro Mobile, crear orden de compra/venta en noxtr (LN y con BTCPay como wallet del taker), noxtr↔noxtr con dos instancias.

Pendiente probar: orden con wallet Phoenix/Breez, cancel antes de tomar, timeout de orden sin tomar, reenvío de factura tras `invalid_invoice`, resolución de disputa end-to-end con un admin real.

## Perfil unificado (#profile-edit)

Un solo panel, un solo botón `#btn-save-profile`. Mapeo de campos:

| Campo | Va a |
|---|---|
| Usuario | `CLI_USER.username` (único; local-part del NIP-05 real y de la Lightning Address) |
| Email | `CLI_USER.user_email` (único; solo para notificaciones del monitor) |
| Nombre | `CLI_USER.user_fullname` **y** `name` del kind 0 |
| Bio | `about` del kind 0, espejado en `CLI_USER.BIO` |
| Foto | `picture` del kind 0, espejada en `CLI_USER.USER_URL_AVATAR` (no `NOSTR_BANNER`, que es otra imagen distinta) |
| NIP-05 | solo `nip05` del kind 0 |

`#btn-save-profile` primero llama a `update_account` (usuario/email, solo necesita sesión web) y, si `Events.canSign()`, publica el perfil Nostr. Si falla la validación de usuario/email se aborta todo; si se guarda la cuenta pero no hay firma disponible, se guarda igual y se avisa aparte. NIP-05 ya no se sobreescribe a la fuerza (solo si el campo está vacío); `lud16` sí se fuerza siempre (no hay otro sitio que sirva ese LNURL). Sin verificación por correo del email nuevo (a propósito — no hay riesgo de account-recovery, estas cuentas no usan password).

## Banner "completa tu perfil"

Invita a personalizar el username cuando sigue siendo el autogenerado (`n_<8 hex>`) y a activar avisos. `#noxtr-profile-nudge-banner`, módulo `ProfileNudge` en `script.js`. Descartable, persistido en localStorage por `user_id`; se reevalúa tras guardar la cuenta.

## Aviso "en pruebas" (panel Mostro)

Banner dismissible (`#mostro-beta-banner`, `MostroTrader._renderBetaBanner`) al abrir el panel P2P. `localStorage('noxtr_mostro_beta_notice_dismissed_v1')`.

## Bloque de apoyo / donaciones

Al final de `run.php`, shortcode `[zap]`. LN address en `CFG_CFG` (`modules.noxtr.donate_lnaddress`) — si está vacía, el bloque no se muestra.

## Debug

```js
localStorage.setItem('noxtr_debug', '1'); location.reload();  // activar
localStorage.removeItem('noxtr_debug'); location.reload();    // desactivar
```

Activa `_mostroDebug()`/`_mostroDebugWarn()` (logging detallado, incluido el contenido en claro de mensajes salientes vía `client_out_plain`).

## Rules

- Acceso a BD **solo** vía `NoxtrStore::sqlQueryPrepared()`/`sqlQuery()`/`sqlExec()`
- SQL compatible MySQL/SQLite (`self::isSQLite()` para bifurcar)
- `confirm()`/`prompt()` son async (wquery los sobreescribe) — siempre `await`
- Sin jQuery, solo wquery. `$.getJSON`/`$.post` no existen — usar `fetch()`
- JS que necesita `$()` va en `footer.php` dentro de `$(document).ready()`, no en `run.php`
- El usuario se comunica en español

## I18N

Ver `I18N.md` en la raíz del framework para el sistema general. Estado en noxtr: `script.mostro.js` completamente migrado (consts en `i18n.php`); `script.js` en gran parte; `script.onchain.js` parcial; `.php` del módulo sin migrar salvo strings nuevos.

Convenciones del módulo:
- Prefijo de clave `NOXTR_*`
- Consts comunes (`str_cancel`, `str_save`...) se reusan de `_includes_/head.php`, no se redefinen
- Emojis **siempre** fuera del string traducible (los chars 4-byte rompen `CFG_CC.cc_string`, utf8mb3) — se concatenan en el `.js`
- Identificadores técnicos hardcoded, no traducidos: nombres de acciones del protocolo, claves de estado interno, nombres de instancias

## Future: NIP-46 Login Integration

Añadir NIP-46 como método de login del sitio (no solo firma de eventos): botón "Login with Nostr Connect" en `_modules_/login/`, flujo QR → firmante prueba pubkey → servidor busca/crea usuario por `nostr_pubkey` → sesión PHP. Reusar `Nip44`/`Nip46` de `script.js`. Ojo: `login/footer.php` usa noble-secp256k1 **v1.7.1** (ESM, Uint8Arrays), distinto de la v1.2.14 UMD (hex strings) que usa el resto del módulo — no intercambiar sin adaptar el código que llama.
