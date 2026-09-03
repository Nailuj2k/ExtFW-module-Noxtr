# Noxtr — Backlog

Lista de ideas y mejoras pendientes sin fecha. Sin orden de prioridad.

---

## NIP-51 — Sincronización de listas via relays

Hoy las listas (topics, bookmarks, muted, channels, relays) viven solo en la BD local del servidor PHP. Implementar NIP-51 las haría portables entre clientes Nostr y entre instancias de Noxtr.

**Kinds a implementar:**
- `kind 10000` — mute list (NSTR_MUTED)
- `kind 10003` — bookmark list (NSTR_BOOKMARKS)
- `kind 10005` — public chat list (NSTR_CHANNELS)
- `kind 10015` — interests/topics list (NSTR_TOPICS)
- `kind 10002` — relay list metadata (NSTR_RELAYS) — esto es NIP-65

**Following (kind 3, NIP-02) ya está implementado** — `Contacts.publishContactList()`.

**Estrategia de sincronización (acordada):**

| Situación | Acción |
|---|---|
| Login + BD local vacía + Nostr tiene datos | Importar todo de Nostr |
| Login + BD local vacía + Nostr no tiene evento | No hacer nada |
| Login + BD local con datos + Nostr no tiene evento | No tocar local. Publicar local al primer cambio |
| Login + BD local con datos + Nostr tiene evento más reciente | Reemplazar local con Nostr (autoritativo) |
| Login + BD local con datos + Nostr tiene evento más antiguo | Mantener local, publicar si hay cambios |
| Usuario pulsa X | Borrar local + publicar lista actualizada inmediatamente |
| Usuario añade item | Añadir local + publicar lista actualizada inmediatamente |

**Caso ambiguo:** si el evento remoto está vacío pero el local tiene >5 items, mostrar confirmación antes de borrar local.

**Para sync NIP-51 a relays, solo guardar IDs en `e` tags** (slim, alineado con el estándar). El export/import local sigue guardando contenido completo (fat, autocontenido).

**Estimación:** 1-2 días. La primera lista cuesta el grueso del trabajo, las demás son mecánicas.

**Why:** Permite portabilidad real entre clientes (Damus, Amethyst, Coracle...) y entre instancias Noxtr. Hoy solo funciona el export/import manual.

---

## NIP-ED2K — Indexador eMule/ed2k sobre Nostr

Propuesta de NIP propio (no existente en el estándar) para directorio descentralizado de servers ed2k y enlaces ed2k.

**Spec completa:** [NIP-ED2K.md](NIP-ED2K.md)

**Resumen:**
- `kind 2010` — ed2k server (replaceable por `d` tag)
- `kind 2011` — ed2k file link
- Reputación por reacciones (kind 7) y pubkey
- Posible export a `server.met` para importar directo en eMule/aMule

**Why:** No existe directorio descentralizado de servers/links ed2k. Las webs centralizadas tipo server-met.de aparecen y desaparecen. Nostr encaja: cualquiera publica, reputación por pubkey, sin servidor central.

---

## NIP-35 — Indexador de torrents

Implementación sencilla de `kind 2003` con tags magnet/nombre/tamaño/ficheros. Tab o sección nueva, feed simple, formulario de publicación, magnet link clicable. Sin BD propia necesaria.

**Estimación:** medio día.

**Why:** Implementación trivial, pero el ecosistema está casi vacío hoy. Probado contra los relays activos: 0 eventos kind 2003 encontrados. Solo merece la pena si aparecen relays con contenido relevante o si lo combinas con NIP-ED2K en un tab unificado de "compartir archivos".

---

## NIP-72 — Comunidades moderadas

Comunidades tipo subreddit con moderación criptográfica (no centralizada en un relay como NIP-29).

- `kind 34550` — definición de comunidad
- `kind 1` con tag `a` — post enviado a la comunidad
- `kind 4550` — aprobación de moderador (wrapping del post)

**Implementación:** tab separado "Communities" (no mezclar con Channels NIP-28). Tabla `NSTR_COMMUNITIES`. Suscripción a `kind 4550` por `#a` para feed curado. UI de moderador para aprobar posts pendientes.

**Estimación:** complejidad media, comparable a NIP-28.

**Why:** No hay caso de uso concreto ahora mismo. NIP-28 cubre chat, Mostro tiene sus propias comunidades. NIP-72 aportaría feeds curados tipo foro/subreddit. Útil si en el futuro se quiere agregador de contenido moderado (noticias, artículos).

---

## Mostro — aviso de timeout en `enviando`

Si una orden lleva > 2-3 min en `internal_status='enviando'` (gift wrap publicado pero sin respuesta `new-order`/`order` de la instancia), mostrar aviso en la ficha del trade del estilo "Sin respuesta de la instancia. Puede estar caído. ¿Reintentar / Cancelar?".

**Why:** Hoy si la instancia Mostro está caída, la orden se queda colgada en `enviando` indefinidamente sin pista para el usuario. Visto una sola vez (NostroMostro caída momentáneamente). Posponer hasta que ocurra con frecuencia.

**Estimación:** trivial. Reusar `_tradeAgeSec()` y patrón similar a `_isReleaseStuck()` que ya existen en `script.mostro.js`.

**Estado:** baja prioridad, esperar a que vuelva a aparecer antes de implementar.

---

## CLI_USER — cifrado client-side de columnas sensibles

Cifrar columnas sensibles de la tabla CLI_USER en el navegador, de manera que si se inicia sesión passwordless se desencripten en el cliente.

**Why:** Aumenta privacidad — el servidor no ve datos sensibles del perfil del usuario en claro.

**Estado:** idea futura, sin urgencia. Necesita diseño previo (qué columnas, qué clave de cifrado, qué hacer si el usuario pierde la clave, cómo migrar usuarios existentes).

---

## Mostro — huecos de conformidad con el protocolo (auditoría 2026-08-31)

Revisión del cliente contra las fuentes reales, no contra la documentación: `message.rs`,
`order.rs`, `error.rs`, `transport.rs` y `prelude.rs` de `MostroP2P/mostro-core@main`, y
`app.rs` de `MostroP2P/mostro@main`.

**El núcleo está conforme** y no necesita tocarse: orden de campos de `MessageKind`
(`script.mostro.js:1648` vs el struct real), `version: 2` = `PROTOCOL_VER` (`prelude.rs:61`),
transporte v2 kind 14 NIP-44 con la 3-tupla (`transport.rs:177`), esquema de firma
Schnorr-sobre-SHA256 (`message.rs:356`), payload de la prueba de identidad
(`transport.rs:63`), formas de payload contra `MessageKind::verify()`, orden de campos de
`SmallOrder`, y los 35 `CantDoReason` mapeados en snake_case. Lo que queda son huecos de
COBERTURA, no de conformidad: nada de lo que noxtr envía está mal formado.

### 1. `buyer-invoice-accepted` sin manejar — el único con consecuencia funcional

`Action::BuyerInvoiceAccepted` existe en el enum y no aparece **ni una vez** en
`script.mostro.js`. Cae en el caso por defecto de `_processRobotAction`, donde
`updates = { status: action, trade_action: action }` pisa `trade_action` sin tocar
`internal_status`.

**Por qué importa:** el gate del input inline de factura exige
`trade_action === 'add-invoice'`. Es exactamente el patrón que ya provocó el bug de
`invoice-updated` — el acuse de recibo hacía desaparecer el campo para cobrar —, arreglado
en `script.mostro.js:2674` conservando el `trade_action` anterior. Aquí falta el mismo
tratamiento.

**Arreglo:** añadirla junto a `invoice-updated` en ese bloque (`delete updates.trade_action`
y `delete updates.status`), y decidir si merece notificación propia.

**Estimación:** trivial. Es el primero que hay que hacer de los tres.

### 2. Familia Cashu sin implementar

`add-cashu-escrow`, `cashu-escrow-locked` y `cashu-pm-signature`, con sus payloads
`Payload::CashuLockProof` y `Payload::CashuSignatures(Vec<CashuProofSignature>)`. Son
nuevas en `mostro-core`. `MessageKind::verify()` exige `id` y el payload exacto en las tres.

**Consecuencia:** contra una instancia que use escrow Cashu, noxtr no puede operar. Hoy no
se conoce ninguna en producción, así que no corre prisa — pero es la única de las tres que
es trabajo de verdad (multisig 2-de-3, NUT-11 P2PK, firmas por proof).

**Estimación:** días, no horas. Requiere diseño previo.

### 3. Seis `Status` sin mapear en `_applyPublicOrderStatus`

Faltan `active`, `settled-hold-invoice`, `waiting-buyer-invoice`, `waiting-payment` y
`waiting-maker-bond` (`pending` se maneja aparte en `script.mostro.js:6138`, no cuenta).
Caen en el `_mostroDebugWarn` de status desconocido y no cambian nada, así que no son
peligrosos.

**Pero `active` ausente sí tiene consecuencia**, y hay una incoherencia que arreglar en
cualquier caso: tras el cambio de 1.4.190 —el canal público ya no declara `activo` para
ningún rol, ver CHANGELOG— **no queda ninguna vía por la que el canal público pueda llevar
un trade a `activo`**. Los comentarios de esa función siguen diciendo que es «la red de
seguridad si se perdió el DM», y eso ya no es cierto.

**Decisión pendiente, una de las dos:**
- Mapear `active` → `activo`. Recupera la red de seguridad, pero hay que comprobar antes
  que el daemon publique ese status solo cuando la hold invoice está realmente pagada.
- O corregir el comentario y asumir que el canal del nodo es la única autoridad para
  `activo`.

**Estimación:** trivial la segunda opción, media hora la primera (hay que leer el daemon).

---

## Mostro (aguas arriba) — el validador acepta LN address en `add-bond-invoice`, el pagador no

Incoherencia encontrada en el daemon al implementar el cobro de fianza slasheada (1.4.193).
No es un problema de noxtr: aquí ya se exige bolt11 y está comentado el porqué en el handler
de `add-bond-invoice` en `script.mostro.js`. Se anota por si merece un issue en
`MostroP2P/mostro`.

**El validador la acepta.** `add_bond_invoice_action` (`src/app/bond/payout.rs:1391`) llama a
`is_valid_invoice`, y esta (`src/lightning/invoice.rs:266-270`) desvía cualquier LN address o
LNURL a `validate_lightning_address`, que solo comprueba que la dirección existe
(`invoice.rs:133-138`) — ni siquiera valida el importe, cosa que sí hace la rama bolt11.

**El pagador no la sabe usar.** `pay_counterparty` (`src/app/bond/payout.rs:538`) decodifica la
cadena como bolt11 para sacar el `payment_hash`, y su propio comentario dice que un fallo de
decodificación «is an invariant violation». El módulo de fianzas no resuelve direcciones
Lightning en ningún punto: cero ocurrencias de `resolv_ln_address` en `app/bond/payout.rs`,
frente a las 3 de `app/release.rs`, donde `do_payment` sí las resuelve para el pago del trade.

**Consecuencia para un cliente que mande LN address:** pasa la validación, se persiste como
factura de cobro y revienta al pagar con `PaymentFailureKind::Terminal` (`payout.rs:542-557`),
quemando un intento del presupuesto de reintentos mientras corre la ventana de reclamación
(`payout_claim_window_days`). Si la ventana se agota, `forfeit_bond` y el cobro se pierde.

**Arreglo aguas arriba, cualquiera de los dos:** que `add_bond_invoice_action` rechace lo que no
sea bolt11, o que `pay_counterparty` resuelva la LN address como ya hace `do_payment`.

**Estado:** nota informativa. noxtr no está afectado.
