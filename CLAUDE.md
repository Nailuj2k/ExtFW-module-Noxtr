# Noxtr - Nostr Client Module for ExtFW

Noxtr is a Nostr protocol client implemented as a ExtFW framework module. Current version: **2.5.0**

## File Map

| File | Purpose |
|---|---|
| `init.php` | Module init: CSP headers, loads NoxtrStore, calls `ensureTables()` |
| `run.php` | Main HTML: header, identity, profile editor, compose, thread view, tabs, sidebar panels, feed |
| `head.php` | Loads CSS + JS: `style.css`, `noble-secp256k1-1.2.14.js`, `noble-ciphers.min.js`, `script.js` |
| `script.js` | All client-side logic: relay pool, events, profiles, contacts, topics, bookmarks, DMs, relays, threads, zaps, NIP-44/46, UI |
| `style.css` | All module styles |
| `ajax.php` | AJAX endpoint: contacts, topics, bookmarks, messages, relays, profile, zaps, article publishing |
| `raw.php` | Raw output: NIP-05 (`nostr.json`) and LNURL-pay (`lnurlp`) endpoints |
| `noxtrstore.class.php` | Data layer: `extends DbConnection`, tables + CRUD for contacts, topics, bookmarks, messages, relays, muted |
| `nostr_crypto.php` | BIP-340 Schnorr signatures for server keypair (used by LNURL-pay/NIP-57) |
| `footer.php` | JS includes + `Noxtr.init()` call with config (pubkey, ajaxUrl, userId, username, noteId). Two `ImageEditor.editable_images` calls: `.editable-banner` (type=banner) and `.editable-avatar` (type=avatar). `OnUploadSuccessCallback` syncs uploaded image to Nostr profile (kind 0) via `Noxtr.Events.publishProfile()` |

## Database Tables (NSTR_*)

All tables support MySQL and SQLite. Created in `NoxtrStore::ensureTables()`, gated by `$_SESSION['noxtr_tables_v']` (versioned integer, currently 4). To force re-creation: clear session (logout/login) or `unset($_SESSION['noxtr_tables_v'])`.

- **NSTR_CONTACTS** — followed pubkeys (pubkey, petname, relay_url, active)
- **NSTR_TOPICS** — hashtag subscriptions (topic, active, sort_order)
- **NSTR_BOOKMARKS** — saved events (event_id, event_pubkey, event_content, event_created_at, event_kind, event_tags)
- **NSTR_MESSAGES** — cached DMs (event_id, peer_pubkey, sender_pubkey, content_encrypted)
- **NSTR_RELAYS** — relay URLs (url, active). Seeded with defaults on first creation
- **NSTR_MUTED** — muted pubkeys (pubkey, created_at). Notes from muted users are filtered in Feed.addNote
- **NSTR_CHANNELS** — joined NIP-28 channels (channel_id, name, about, picture, creator_pubkey, relay_url, pinned)

All keyed by `user_id`. Unique constraints prevent duplicates.

## JavaScript Architecture (script.js)

Single IIFE `(function(){ ... })()` exposing `window.Noxtr = { init, logout, Events }`.

- `Noxtr.logout()` — disconnects all relays, clears identity state, removes `noxtr_npub`/`noxtr_nip46` from localStorage, clears sessionStorage `noxtr_autologin_skip`. Preserves IndexedDB keys (keyed by userId, persist across sessions). Called from `login/footer.php` on web logout
- `Noxtr.Events` — exposed for external use (e.g. `publishProfile()` from ImageEditor callback)

### Internal Modules
- **Api** — `call(action, params)` → POST to `ajax.php`, returns JSON. Requires `userId > 0`
- **Pool** — WebSocket relay pool: `connect()`, `disconnect()`, `disconnectAll()`, `subscribe()`, `publish()`, `getStatus()`. `disconnectAll()` closes all WebSockets and clears relay/subscription maps
- **Profiles** — profile cache (kind 0), `request()`, `displayName()`, `avatar()`, `color()`
- **Events** — signing: NIP-07 (extension), NIP-46 (Nostr Connect), or nsec (privkey). `publish()`, `canSign()`, `setPubkey()`, `setPrivkey()`
- **Contacts** — CRUD for followed pubkeys, `activePubkeys()`, `isFollowing()`, `publishContactList()` (publishes kind 3 NIP-02 event to relays on add/remove)
- **Topics** — CRUD for hashtags, `active()`, `showAll` toggle
- **Relays** — DB-backed relay management: `load()`, `add()`, `remove()`, `toggle()`, `activeUrls()`, `connectAll()`, `render()`
- **DEFAULT_RELAYS** — fallback array: damus, nos.lol, nostr.band, primal, snort, purplepag.es
- **Bookmarks** — CRUD for saved events
- **Muted** — DB-backed mute list: `load()`, `mute()`, `unmute()`, `has()`, `render()`. Filters in `Feed.addNote()`
- **DMs** — NIP-04 encrypted DMs: `loadFromDb()`, `subscribe()`, `send()`, `openThread()`, `renderConvos()`
- **Channels** — NIP-28 public chat (kinds 40/41/42). Core: `loadFromDb()`, `saveToDb()`, `subscribe()`, `subscribeRoom()`, `fetchMeta()`, `handleMessage()`, `sendMessage()`, `createChannel()`, `joinChannel()`, `leaveChannel()`, `openRoom()`, `renderList()`, `renderMessages()`, `closeRoom()`. Metadata: `updateMeta()` (kind 41, creator-only). Dialogs (wquery): `openEditDialog()` (name/about/picture fields, creator-only), `openCreateDialog()` (replaces prompt-based flow). `copyInviteLink()` — copies `/noxtr/channel/note1...` permalink to clipboard. `deleteChannel()` — kind 5 NIP-09 deletion of the kind 40 creation event (creator-only). **Message deletion**: each own message has a trash icon (`data-action="del-channel-msg"`, `data-id`); click → `await confirm()` → `Events.deleteNote(msgId)` (kind 5 NIP-09) → removes from DOM + `room.messages[]`. See `NOSTRCHAT.md` for full implementation guide
- **Nip44** — NIP-44 encryption/decryption: `getConversationKey()` (ECDH + HKDF-SHA256), `encrypt()`, `decrypt()`. Uses Web Crypto for HKDF/HMAC, `nobleCiphers.xchacha20poly1305` for cipher
- **Nip46** — NIP-46 Nostr Connect (remote signing): `connect()`, `disconnect()`, `restore()`, `signEvent()`, `getPublicKey()`. State persisted in `localStorage('noxtr_nip46')`
- **Stats** — reaction/reply/repost counts with `_seen` deduplication (prevents counting same event from multiple relays). `clear()` resets both `counts` and `_seen`
- **Threads** — NIP-10 thread view: `open(note)`, `openById(hexOrNote1)`, `close()`, reply threading. Thread title shows author name + content preview
- **Feed** — renders notes, handles subscriptions (global, topics, authors), buffered new notes banner
- **UI** — tab switching, compose toggle, identity display, relay dots, profile editor, zap flow

### Collapsible Lists
The `#following-list`, `#followers-list`, and `#topics-list` panels are wrapped in `.collapsible-wrap` divs with toggle buttons. State is saved in localStorage (`noxtr_col_following-list`, etc.). Default: expanded. CSS uses `max-height` transition + `overflow: hidden` for smooth animation. `Noxtr.initCollapsibles()` restores saved state on init.

### Image Upload (Banner & Avatar)
- Banner image: `<img class="editable-banner noxtr-banner">` → `ImageEditor.editable_images('.editable-banner', '...type=banner')`
- Avatar image: `<img class="editable-avatar">` → `ImageEditor.editable_images('.editable-avatar', '...type=avatar')`
- On upload success (`OnUploadSuccessCallback`): updates the DOM `src`, detects `imageId === 'noxtr-banner'` vs `'noxtr-avatar'`, and publishes the updated field to Nostr (kind 0) via `Noxtr.Events.publishProfile()`
- Backend `imagereceive()` in `TABLE_CLI_USER.php`: when `type=banner`, updates `USER_URL_BANNER` only (does NOT touch `USER_URL_AVATAR`); when `type=avatar`, updates `USER_URL_AVATAR`
- `updateIdentity()` updates both banner and avatar from Nostr profile data for users who entered an npub without being logged in

### Tab System
Tabs: `topics`, `following`, `followers`, `messages`, `channels`, `bookmarks`, `relays`

- Tabs bar (`.noxtr-tabs`) is always visible, including in thread view
- Compose toggle (`#btn-toggle-compose`) is inside `.noxtr-tabs`, right-aligned with `margin-left:auto`
- `switchTab()` calls `Threads.close()` if a thread is open, then loads the appropriate feed
- **Following tab** automatically includes user's own pubkey in the authors subscription, so own notes appear in the feed without needing to self-follow
- In thread view, all tabs are deselected (no active class)
- `cancelReply()` is called on every tab switch

### Permalinks
URL: `/noxtr/note/HEX_ID` or `/noxtr/note/note1...`
- `footer.php` passes `$_ARGS[2]` as `config.noteId` when `$_ARGS[1] === 'note'`
- `init()` calls `Threads.openById(noteId)` instead of `switchTab('topics')`
- `openById()` accepts hex or note1... bech32 (uses `noteDecode()`)
- If note not found on relays, shows "Note not found" message
- Tabs remain visible for navigation back to feed

### Note Actions
Each note has action buttons: reply, like, repost, zap, bookmark, follow, DM, share, mute/report (others only), delete (own only)

### Channel Message Actions
Each channel message (kind 42) from the current user shows a trash icon (`class="ch-msg-del"`, `data-action="del-channel-msg"`, `data-id="{msgId}"`). The icon is rendered inline next to the timestamp in `renderMessages()`, only when `m.pubkey === Events.pubkey`. Click handler is delegated on `#channel-messages` in `UI.init()`: publishes a kind 5 (NIP-09) deletion event via `Events.deleteNote(msgId)`, removes `.dm-msg[data-msg-id]` from DOM, and splices the entry from `room.messages[]`.
- **Like** — kind 7 reaction, one per note (blocked after `liked = true`)
- **Repost** — kind 6, requires `await confirm()`, one per note (blocked after `reposted` class)
- **Share** — copies permalink URL (`/noxtr/note/HEX_ID`) to clipboard, green flash feedback
- **Mute** — shows popup menu with "Mute user" (local DB) and "Report spam" (NIP-56 kind 1984 + local mute). Removes all notes by user from visible feed
- Muted users can be viewed and unmuted in the Relays tab (bottom section)

### Storage
- **IndexedDB** `JuxNostrKeys`: stores NIP-46 client keypairs keyed by `user_<id>`. Persists across sessions (NOT cleared on logout)
- **localStorage**: `noxtr_npub` (entered npub), `noxtr_nip46` (NIP-46 connect state), `noxtr_col_*` (collapsible panel states)
- **sessionStorage**: `noxtr_autologin_skip` (skip NIP-46 auto-reconnect for current tab)

### Note DOM
Each note element: `<div class="note" id="note-HEX_ID" data-id="HEX_ID" data-pubkey="PUBKEY">`

### Relay Management
- On init: `Relays.load()` fetches from DB, then `Relays.connectAll()` connects active relays (or DEFAULT_RELAYS if list empty)
- In render: DB relays show toggle (click URL) + remove (x with `await confirm()`)
- If no DB relays: shows Pool status directly
- The x button uses `await confirm()` (NOT sync `confirm()`) because wquery overrides `window.confirm` to return a Promise

## Nostr Protocols Implemented

- **NIP-01** — Basic events (kind 1), relay communication
- **NIP-04** — Encrypted DMs (kind 4)
- **NIP-05** — Identity verification (`.well-known/nostr.json`) → handled in `raw.php`
- **NIP-07** — Browser extension signing
- **NIP-10** — Thread markers (reply/root tags)
- **NIP-44** — Versioned encryption (XChaCha20-Poly1305 + HKDF-SHA256). Used by NIP-46
- **NIP-46** — Nostr Connect / Remote Signing (kind 24133). Client keypair in localStorage, signer via relay
- **NIP-02** — Contact list (kind 3): `Contacts.publishContactList()` publishes replaceable kind 3 event with all followed pubkeys as `['p', pubkey, relay, petname]` tags. Published on `add()` and `remove()`. Enables the Followers tab (which queries `{ kinds: [3], '#p': [pubkey] }`)
- **NIP-19** — bech32 encoding: `npubEncode/Decode`, `nsecDecode`, `noteEncode/Decode`
- **NIP-25** — Reactions (kind 7)
- **NIP-56** — Reporting (kind 1984) — spam reports with `['p', pubkey, 'spam']` tags
- **NIP-57** — Zap receipts (kind 9734/9735)
- **NIP-28** — Public Chat Channels (kinds 40/41/42). See `NOSTRCHAT.md` for full implementation guide
- **Kind 6** — Reposts

## LNURL-pay / Lightning Address (raw.php)

Handles `/.well-known/lnurlp/USERNAME`:
1. **Discovery** (no `?amount`): returns payRequest metadata with `allowsNostr` + server pubkey
2. **Callback** (`?amount=X`): validates NIP-57 zap request, creates BTCPay invoice, returns bolt11

Server keypair auto-generated and stored in `CFG_CFG` table (`noxtr.server_privkey`, `noxtr.server_pubkey`).
BTCPay config read from `CFG_CFG` (`btcpay.url`, `btcpay.store_id`, `btcpay.api_key`).

## Zaps (ajax.php → create_zap)

1. Check if recipient is a registered user (by `nostr_pubkey` in `CLI_USER`)
2. If registered and sender has balance: **internal transfer** (debit sender, credit recipient, record transactions type 5/6)
3. Otherwise: create BTCPay Lightning invoice for external payment

## Future: NIP-46 Login Integration (login module)

Currently NIP-46 is only in Noxtr (remote signing for Nostr events). A future enhancement would add NIP-46 as a **website login method** in `_modules_/login/`:

- Add "Login with Nostr Connect" button to the login form (alongside email/password and current "Login with Nostr")
- Flow: show QR (`nostrconnect://` URI) → user scans with signer app → signer proves pubkey → server finds/creates user account by `nostr_pubkey` in `CLI_USER` → create PHP session
- Reuse `Nip44` and `Nip46` modules from Noxtr's `script.js` (or extract to shared `_lib_/`)
- The `_lib_/bitcoin/noble-ciphers.min.js` and `noble-secp256k1-1.2.14.js` are already available
- **Important**: login/footer.php uses noble-secp256k1 **v1.7.1** (ESM from `_lib_/noble/`) — API differs from v1.2.14 (UMD in `_lib_/bitcoin/`). In v1.2.14, `getPublicKey(string)` and `schnorr.sign(string)` return hex strings; in v1.7.1 they return Uint8Arrays. Do NOT swap versions without adapting calling code
- Server-side: need endpoint to verify NIP-46 auth (check pubkey exists in `CLI_USER.nostr_pubkey`, create session)

## Mostro P2P — UI y features (estado 2026-03-25)

### Trade cards (fichas de trades activos)

Header: `fecha · ID (8 chars) ⎘ · [Creada/Tomada por ti] · [Comprar/Vender BTC] · importe · método de pago · estado`

- **Chip de rol**: "Creada por ti" (azul) si `trade_action === 'new-order'`, "Tomada por ti" (verde) si no. Depende de `o.action` o `o.trade_action` del objeto `_myOrders`. **IMPORTANTE**: `_loadMyOrders` debe mapear `action: t.trade_action` y `is_seller: t.is_seller` desde la BD — de lo contrario el chip siempre muestra "Tomada" y `needsAction` no funciona.
- **`needsAction`**: borde rojo pulsante para trades de comprador en estados `['payment-failed', 'hold-invoice-payment-settled', 'add-invoice', 'waiting-buyer-invoice']`. Usa `o.isSeller === true || parseInt(o.is_seller) === 1`.
- **Botón "Enviar nueva factura al robot"**: aparece en `_renderActiveTrade` para compradores en estados no-terminales no-factura. Permite recuperar trades con `payment-failed` sin salir de la UI.

### Historial de trades (`_renderTrades`)

- Muestra solo las **5 más recientes** (ordenadas por `updated_at DESC`)
- Título "Historial ▾" clicable para colapsar/expandir (estado en `localStorage('noxtr_hist_collapsed')`)
- Si hay más de 5: link "Ver todos (N)" alineado a la derecha del título → `/noxtr/trades`
- El link no colapsa la sección (guard `if (e.target.tagName === 'A') return`)

### Mi reputación

- Componente `<div id="mostro-my-reputation">` justo encima de `mostro-trades`
- Cargada en `Mostro.open()` via `_loadReputation()` → acción AJAX `get_mostro_reputation`
- La acción hace `AVG(JSON_EXTRACT(content, '$[0].order.payload.rating_user'))` sobre `NSTR_MOSTRO_EVENTS WHERE action='rate-received' AND direction='in'`
- Muestra: ⭐⭐⭐⭐⭐ **5.0** · 3 valoraciones recibidas
- Se oculta si `total = 0`

### Logging de eventos (NSTR_MOSTRO_EVENTS)

- Deduplicación por `ev.id` en localStorage (`noxtr_mostro_logged_ids`, máx 1000). Evita insertar 100+ filas históricas en cada recarga.
- El relay se captura del segundo argumento del callback `Pool.subscribe(fn(ev, relayUrl))` y se pasa a `_logMostroEvent`.

### Acciones AJAX nuevas (ajax.php)

- `get_mostro_reputation` → `{total, avg_rating}` calculado desde `NSTR_MOSTRO_EVENTS`

## Mostro Mobile — Importación de identidad (v1.3.108)

### Estado actual

Botón "📲 Mostro Mobile" en el área de nsec-login (junto al botón Login). Al pulsarlo:
1. Abre dialog wquery con textarea para las 12 palabras BIP39
2. Valida que sean exactamente 12 palabras
3. Deriva la clave privada Nostr usando **WebCrypto nativo** (sin librerías extra):
   - BIP39: `PBKDF2-SHA512(mnemonic.NFKD, salt="mnemonic", iterations=2048)` → 64 bytes seed
   - BIP32: `HMAC-SHA512` repetido por cada segmento de la ruta `m/44'/1237'/38383'/0/0`
   - Segmentos hardened (44', 1237', 38383'): usa `0x00 || privkey || index_BE32`
   - Segmentos no-hardened (0, 0): usa `compressedPubKey(33B) || index_BE32` → necesita `nobleSecp256k1.getPublicKey(hex, true)`
   - Child key: `(IL + parentKey) mod SECP256K1_N` con BigInt
4. Codifica como nsec bech32 → lo mete en `#nsec-input` → llama a `#btn-nsec-login.onclick()`

**Funciones helper** añadidas al inicio del IIFE (antes de `escapeHtml`):
- `_hmacSha512(keyBytes, dataBytes)` → WebCrypto HMAC-SHA512
- `_bip39Seed(mnemonic)` → WebCrypto PBKDF2
- `_bip32DerivePath(seedBytes, path)` → derivación completa
- `_SECP256K1_N` → constante BigInt del orden de secp256k1
- `_importMostroMobileIdentity()` → función UI (dialog + derivación + login)

### Estrategia futura (pendiente)

La identidad Nostr de Mostro Mobile **es** una identidad Nostr estándar. El flujo correcto a largo plazo:

1. **Integrar en el módulo `login` de ExtFW**: añadir opción "Entrar con Mostro Mobile (12 palabras)" que derive el nsec, busque o cree el usuario en `CLI_USER` por `nostr_pubkey`, y cree la sesión PHP directamente. Sin pasar por el botón Login de noxtr.
2. **Importar trades activos/en curso**: ✅ Implementado (2026-03-25). Ver sección "Restore implementado" más abajo.
3. **La reputación ya se importa sola**: se calcula desde `NSTR_MOSTRO_EVENTS` que se pobla automáticamente al recibir mensajes del robot.

**Derivación de trade keys**: misma ruta `m/44'/1237'/38383'/0/N` (N=1,2,3...). El índice actual se guarda en `SharedPreferences('keyIndex')` de Mostro Mobile, pero noxtr no tiene acceso — hay que iterar o pedírselo al robot via `restore`.

### Restore implementado (2026-03-25)

El flujo de restore se ejecuta automáticamente al importar la identidad con las 12 palabras:

- Se deriva la trade key en índice 1 (`m/44'/1237'/38383'/0/1`)
- Se envía acción `restore` al robot firmada con esa trade key (no con la identity key)
- El robot responde con acción **`restore-session`** (no `restore`) y payload `{ restore_data: { orders: [...], disputes: [...] } }`
- Se suscriben gift wraps `kind:1059 #p: tradeKey1Pub` para recibir la respuesta
- Por cada orden devuelta se deriva su trade key (`/N`) y se guarda en `NSTR_MOSTRO_TRADES`

**Limitación verificada**: el robot solo devuelve en `restore-session` las órdenes **activas/en curso**. Las órdenes canceladas o completadas **no** aparecen — el robot no las trackea para restore. Por tanto, el historial de trades terminados no se puede recuperar vía este mecanismo.

## Mostro P2P — Estado de pruebas

### Flujos probados (noxtr como usuario)

| Flujo | Estado | Notas |
|---|---|---|
| Tomar orden de **compra** creada en MM | ✅ OK | noxtr actúa como vendedor: paga hold invoice, espera fiat, libera. Re-probado 2025-03-24 tras varios fixes de FSM |
| Tomar orden de **venta** creada en MM | ✅ OK | noxtr actúa como comprador: recibe invoice, envía fiat, recibe sats |
| Crear orden de **venta** en noxtr | ✅ OK | noxtr publica, MM toma, flujo completo funciona |
| Crear orden de **compra** en noxtr | ⚠️ Por re-probar | Varios bugs corregidos — pendiente prueba real con Phoenix/Breez |
| Crear orden de **venta** — flujo completo | ✅ OK | Probado 2025-03-24: create → taken → pay hold invoice → fiat sent → release → success. Requiere relay.mostro.network activo para enviar mensajes al robot |
| **noxtr ↔ noxtr** (dos instancias, dos users) | ✅ OK | Probado 2025-03-24: flujo vendedor/comprador completo funciona. Fallo de pago final es routing del nodo del robot (no bug noxtr) |

### Bugs corregidos en orden de compra (historial)

1. **Bug `isSeller` corrupción** (v1.3.91–1.3.93) — mensajes replayed sobreescribían el rol. Fix: `pay-invoice` no sobreescribe `isSeller=false`; `_restoreTradeFromDb` recalcula rol desde `action+tradeKind`.
2. **`hold-invoice-payment-accepted` no manejado** (v1.3.92) — robot confirmaba factura pero noxtr no tenía handler. Añadido.
3. **Factura con monto incorrecto** (v1.3.91) — `add-invoice` ahora guarda `satAmount` antes de mostrar el formulario.
4. **`isSeller` no explícito al crear orden** (2025-03-24) — `createOrder()` dejaba `isSeller=undefined`, lo que anulaba el guard `isSeller !== false` en `pay-invoice`. Fix: `isSeller: result.kind === 'sell'` al crear `activeTrade`.
5. **Fiat info ausente al crear orden** (2025-03-24) — `activeTrade` no copiaba `fiatCode`/`fiatAmount`/`paymentMethod` de `orderPayload`. El handler `active` mostraba "? EUR". Fix: copiar campos desde `orderPayload` al crear `activeTrade`.
6. **Amount en índice incorrecto al recibir `add-invoice`** (2025-03-24) — según protocolo Mostro Mobile, el monto sats está en `payment_request[2]`, no en `[1]`. noxtr leía `[1]` → amount siempre 0. Fix: leer `payment_request[2]`.
7. **`satAmount` en posición [2] rompe el pago** (2025-03-24, revertido) — se intentó enviar `[null, invoice, satAmount]` en `_submitInvoice` siguiendo el protocolo de Mostro Mobile. En la práctica el robot falla el pago cuando recibe un satAmount en [2]. Fix: mantener `[null, invoice, null]` — el robot usa el importe codificado en el bolt11.
8. **Máquina de estados en BD** (2025-03-24) — `saveTrade()` sobreescribía `status` sin validar. Fix: `NoxtrStore::saveTrade()` ahora hace SELECT previo y solo avanza si el nuevo estado tiene mayor prioridad en `$stateOrder`. Protege contra replays incluso tras recargas de página.
9. **FSM en JS** (2025-03-24) — `STATE_PRIORITY` (lista lineal) reemplazada por `_fsmAllows(status, isSeller, action)` basada en `lib/core/mostro_fsm.dart` de Mostro Mobile. Valida transiciones por `(estado, rol) → [acciones_permitidas]`. Añadidos handlers para `payment-failed` y `rate-received`.
10. **Payload de rating incorrecto** (2025-03-24) — noxtr enviaba `{ rating: { max_rate:5, min_rate:1, rate:N } }`. Formato correcto (Mostro Mobile `RatingUser.toJson()`): `{ "rating_user": N }`.
11. **Rating no se mostraba en órdenes** (2025-03-24) — el robot serializa el tag como `["rating","[\"rating\",{...}]"]` (array JSON dentro de string). Fix: extraer `parsed[1]` en lugar de usar `parsed` directamente. También eliminados campos inexistentes en el tooltip (`last_rating`, `max_rate`, `min_rate`); el 38383 solo tiene `total_reviews`, `total_rating`, `days`.
12. **Relays Mostro unificados con NSTR_RELAYS** (2025-03-24) — eliminada la lista separada de "relays Mostro" (localStorage + UI propio). `relay.mostro.network` se siembra en NSTR_RELAYS (v6) junto a los defaults normales. Los mensajes al robot usan `Pool.publish()`. Conclusión verificada: leer órdenes funciona sin relay.mostro.network (los robots publican a relays generales), pero enviar mensajes al robot requiere tenerlo activo.
13. **`_resumeTrade` sobreescribía fiat_amount en BD** (2025-03-24) — al hacer click en una orden publicada para ver su estado, se creaba un `activeTrade` mínimo sin campos fiat y se guardaba en BD. Fix: copiar `fiatAmount`, `fiatCode`, `satAmount`, `paymentMethod` del order book al hacer resume.
14. **Sin botón Cerrar en trades cancelados por timeout** (2025-03-24) — el timeout de `_resumeTrade` solo mostraba "Cerrar" si el estado era `order-published`. Para `waiting-buyer-invoice` y otros estados de espera el timeout expiraba sin opción de cierre. Fix: mostrar "Cerrar" para cualquier `activeTrade`.
15. **Aviso al operar sin relay Mostro activo** (2025-03-24) — `createOrder`, `takeSellOrder`, `takeBuyOrder` comprueban via `_hasActiveMostroRelay()` si algún relay de las órdenes visibles está conectado. Si no, muestran confirm de advertencia antes de continuar. No usa relays hardcodeados: los detecta dinámicamente por `_sourceRelay` de las órdenes recibidas.
16. **FSM bloqueaba mensajes legítimos** (2025-03-24) — el robot puede saltar estados intermedios según el contexto. El FSM estricto bloqueaba `fiat-sent`, `fiat-sent-ok`, `payment-failed`, `buyer-took-order` desde ciertos estados. Fix inicial: añadir varios a UNIVERSAL. Fix final (2025-03-24 tarde): FSM convertido a **soft** — avisa en consola (`console.warn`) pero nunca bloquea. La deduplicación real la hace `_seenDmIds`.
17. **`_seenDmIds` bloqueaba re-proceso de mensajes** (2025-03-24) — el event id se añadía a `_seenDmIds` antes del switch/case. Si el FSM o cualquier guard bloqueaba el procesamiento, el mensaje quedaba silenciado permanentemente. Fix estructural: `_shouldMarkSeen = true` antes del switch, pero el write a localStorage solo ocurre **después** de que el switch/case completa con éxito.
18. **QR de hold invoice aparecía dos veces** (2025-03-24) — el mismo `pay-invoice` llegaba desde dos relays con event IDs distintos (no deduplicados por `_seenDmIds`). Fix: guard `_alreadyShown` en el case `pay-invoice` — si `activeTrade.holdInvoice === holdInvoice` ya guardada, no re-renderiza.
19. **`trade_kind = 'buy'` guardado incorrectamente para el vendedor** (2025-03-24) — `_syncTradeToDb` tenía `tradeKind || 'buy'`. Si `tradeKind` era null (reconstrucción desde `add-invoice`), se guardaba 'buy' aunque el usuario fuera el vendedor. Fix: `tradeKind || (isSeller ? 'sell' : 'buy')`.
20. **`payment-failed` mostraba formulario de factura al vendedor** (2025-03-24) — el handler `payment-failed` en switch/case y en `_resumeTrade` siempre llamaba `_showInvoiceRequestForm`. Fix: verificar `_isSeller()` — vendedor ve aviso informativo, comprador ve el formulario.
21. **`_resumeTrade` sin botón de cierre para comprador en `fiat-sent-ok`** (2025-03-24) — estado `fiat-sent-ok` solo tenía handler para el vendedor (botón liberar). Comprador caía en else genérico sin botón. Fix: añadir case explícito con mensaje "Esperando que el vendedor libere" + botón Cerrar.

### Protocolo Mostro — estructuras clave (verificadas contra Mostro Mobile)

**Robot → comprador** (`add-invoice`): pide la factura Lightning al comprador
```json
{ "payment_request": [null, null, <sats>] }
```
`[0]`=null, `[1]`=null (lo que se pide), `[2]`=sats a recibir

**Comprador → robot** (`add-invoice`): respuesta con la factura
```json
{ "payment_request": [null, "<bolt11_o_ln_address>", <sats>] }
```

**Robot → vendedor** (`pay-invoice`): hold invoice para el vendedor
```json
{ "payment_request": [<order_obj>, "<bolt11_hold_invoice>", <sats>] }
```

**Robot → comprador** (`hold-invoice-payment-accepted`): trade activo
```json
{ "order": { "status": "active", "fiat_amount": ..., "fiat_code": ..., "payment_method": ..., "buyer_trade_pubkey": ..., "seller_trade_pubkey": ... } }
```

### Secuencia de mensajes — comprador crea buy order

```
1. App → Robot:  new-order  {order: {kind:'buy', fiat_amount, fiat_code, payment_method, ...}}
2. Robot → App:  new-order  {order: {id: <uuid>, ...}}   ← confirma, orderId queda fijado
3. [vendedor toma la orden]
4. Robot → App:  add-invoice  {payment_request: [null, null, <sats>]}
5. App → Robot:  add-invoice  {payment_request: [null, "<bolt11>", <sats>]}
6. Robot → App:  hold-invoice-payment-accepted  {order: {status:'active', ...}}
7. App → Robot:  fiat-sent
8. Robot → App:  hold-invoice-payment-settled  ← trade completado
```

### Acciones Mostro implementadas

`new-order`, `order`, `pay-invoice`, `waiting-seller-to-pay`, `waiting-buyer-invoice`, `add-invoice`, `hold-invoice-payment-accepted`, `active`, `buyer-took-order`, `fiat-sent`, `fiat-sent-ok`, `releasing`, `success`, `rate`, `hold-invoice-payment-settled`, `canceled`, `cancel`, `cant-do`, `dispute`, `send-dm`

### Pendiente / por probar

- [ ] Orden de compra en noxtr con wallet Phoenix/Breez — probar flujo completo
- [x] **Cancelación cooperativa** (2026-03-26): cuando la contraparte solicita cancelar, el robot envía acción `cancel` con el trade aún activo. Ahora se muestra "Aceptar cancelación" + "Disputar" en lugar de marcar la orden como cancelada inmediatamente. `canceled` sigue siendo siempre terminal.
- [ ] Disputa desde noxtr (botón "Disputar" en cancelación cooperativa implementado, falta probar flujo completo)
- [ ] Cancel de orden antes de ser tomada
- [ ] Trade con timeout (orden expira sin ser tomada)
- [ ] Re-envío de factura cuando robot dice `invalid_invoice`
- [ ] **Importación Mostro Mobile → login ExtFW**: mover la lógica de 12 palabras al módulo `login`, crear/encontrar usuario por `nostr_pubkey`, crear sesión PHP. Ver sección "Mostro Mobile — Importación" más arriba.
- [x] **Importar trades activos desde el robot**: implementado (2026-03-25). Solo recupera trades en curso, no histórico terminal (limitación del robot)
- [ ] **Vista completa de historial** en `/noxtr/trades` (ya existe la tabla ExtFW, enlazada desde "Ver todos (N)")
- [ ] **`rate-received`**: cuando la contraparte nos califica, el robot manda esta acción con la valoración. Mostrar notify con las estrellas recibidas. Feature que MM no tiene.
- [ ] **Re-calificar**: permitir cambiar la valoración ya enviada (volver a hacer clic en las estrellas del trade completado).

### Riesgo conocido — ventana `tmp order_id` → UUID real

Al crear una orden en noxtr:

1. Primero se guarda en `NSTR_MOSTRO_TRADES` con un `order_id` temporal tipo `tmp-...`
2. Después se envía `new-order` al robot con una `trade_key_pub` efímera generada localmente
3. Cuando llega la respuesta `new-order` / `order` del robot con `payload.order.id`, noxtr reemplaza el `tmp-...` por el UUID real

Riesgo teórico: si se pierde o no se procesa ese mensaje de confirmación, la fila local puede quedarse con `tmp-...` mientras la orden pública del order book ya existe con el UUID real. Como la orden pública visible no expone un correlador reutilizable (`trade_key_pub`, fingerprint del creador, etc.), noxtr podría dejar de reconocer esa oferta como "Creada por mí".

Consecuencias posibles:

- La oferta aparece en el order book como si fuera ajena (sin badge "Creada por mí" ni botón "Cancelar")
- El usuario podría intentar tomar su propia oferta desde la UI
- En el cliente actual, `takeOrder()` crearía una segunda fila local con `trade_role='taken'` y `order_id=<uuid real>`, mientras la fila original `created` seguiría con `tmp-...`
- Si el robot rechazara el `take-*`, la segunda fila quedaría como intento fallido / pendiente hasta cancelación, timeout o limpieza manual
- Si el robot lo aceptara, el usuario podría acabar con dos sesiones locales sobre la misma operación lógica: una como creador y otra como tomador

Estado actual:

- El código intenta minimizar este riesgo re-renderizando el order book tras cargar trades y tras recibir el UUID real
- No hay heurística agresiva de reconciliación `tmp-...` ↔ UUID real porque podría producir falsos positivos y clasificar órdenes ajenas como propias
- Si este fallo reaparece en producción, la solución robusta ideal es añadir un correlador estable en el protocolo/evento público, no una heurística local ambigua
- Verificación posterior (2026-04-05): la documentación oficial de Mostro indica que `order.id` viene en la confirmación `new-order` y también en varios mensajes posteriores del flujo (`pay-invoice`, `waiting-seller-to-pay`, `waiting-buyer-invoice`, `add-invoice`, etc.). Por tanto, el riesgo práctico de quedarse sin UUID real parece bajo: para que ocurra tendrían que perderse o no procesarse varios mensajes seguidos para la misma `trade_key_pub`.
- Decisión actual: **no tocar este flujo** mientras no aparezca un caso real. Si en el futuro se quisiera endurecer sin heurísticas ambiguas, la mejora razonable sería acercarse al modelo de Mostro Mobile: crear una sesión provisional `waiting_confirmation` y solo persistir la orden definitiva cuando llegue el `order.id` real.

## Rules

- **DB access exclusively via** `NoxtrStore::sqlQueryPrepared()`, `sqlQuery()`, or `sqlExec()`
- All SQL must be MySQL/SQLite compatible. Use `self::isSQLite()` to branch syntax
- `confirm()` and `prompt()` are async (return Promise) — always use `await`
- No jQuery — wquery only. `$.getJSON` and `$.post` do NOT exist; use `fetch()` instead
- JS that needs `$()` goes in `footer.php` (inside `$(document).ready()`), NOT in `run.php`
- The user communicates in Spanish

## activar desactibvar debug

localStorage.setItem('noxtr_debug', '1')
location.reload()
Y para apagarlo:

js

localStorage.removeItem('noxtr_debug')
location.reload()
