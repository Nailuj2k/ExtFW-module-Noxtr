# Changelog — Noxtr

Registro de cambios del módulo. Las versiones más recientes van arriba.

## 1.4.237 — Confirmación real del pago de la fianza

- Retirado el botón local «Ya pagué la fianza». Podía ocultar la factura y marcar
  `bond_paid=1` aunque Mostro aún no hubiera recibido el pago.
- La fianza se considera pagada solamente a partir de las señales automáticas del flujo:
  confirmación de NWC, publicación de la orden propia o una acción posterior de Mostro.

## 1.4.236 — Cancelación mientras se espera el escrow

- La ficha permite enviar la acción oficial `cancel` también en
  `esperando_pago_vendedor`, cuando el comprador ya entregó su factura pero el vendedor
  todavía no ha pagado la hold invoice.
- Si la instancia rechaza la cancelación, se restaura el estado exacto que tenía el
  trade en vez de devolverlo siempre y erróneamente a `publicado`.

## 1.4.235 — Identidad Mostro conforme al protocolo

- La reputación deja de usar la clave Nostr social del login. La identidad Mostro se
  deriva ahora en `m/44'/1237'/38383'/0/0` y la clave de cada trade en
  `m/44'/1237'/38383'/0/N`, ambas desde la misma semilla BIP39.
- En modo reputación, `N` coincide exactamente con `trade_index`; en privacidad el campo
  no se publica, pero la clave sigue siendo derivada y única. Se eliminó el fallback aleatorio.
- El modo y la identidad quedan fijados por trade (`identity_fingerprint`), de modo que
  cambiar el toggle después no altera una operación en curso.
- `last-trade-index` consulta con la identidad Mostro correcta y el máximo local incluye
  todo el historial, también trades archivados fuera del límite visual de 200 filas.
- La creación concurrente de la primera semilla entre pestañas es atómica. También se
  valida el mnemónico BIP39 antes de derivar.
- Retirado el importador parcial de Mostro Mobile: no volverá hasta que pueda restaurar
  la sesión Mostro completa sin confundirla con el login social Nostr.

## 1.4.203 — Reparado el JSON de instancias Mostro

- Eliminado un carácter `0` residual al final de `json.php` que provocaba un parse error
  PHP y hacía que `refreshRemote()` recibiera HTML en lugar de JSON.
- El cliente muestra ahora el resumen de la respuesta inválida/HTTP, en vez del poco útil
  `Unexpected token '<'`.

## 1.4.202 — Endurecimiento de NostrEscrow on-chain

- Verificación completa de id, firma y PoW de los eventos; `order_id` estable y `d`
  independiente por acción para conservar el historial.
- Contrato monetario, red, identidades y árbitros comprobados en ambos extremos.
- Las private keys Bitcoin on-chain dejan de enviarse/aceptarse en el servidor y se
  rederivan en memoria desde la raíz cifrada, con passphrase y checksum BIP39/WIF.
- Persistencia previa, outbox idempotente y monitor adaptado a trades sin private key.
- Funding limitado al UTXO exacto y no gastado; arbitraje revalida contrato, outpoint,
  importe, dirección y CSV, entrega el caso a los tres árbitros y paga al que resuelve.
- El tier `professional` se trata como `regular` hasta poder verificar su bond real.

## 1.4.193 — Cobro de fianza slasheada: importe exacto y fecha límite

### Corregido

- **El diálogo de `add-bond-invoice` pedía una factura sin decir de cuánto.** Cuando un
  admin resuelve una disputa y ejecuta la fianza del perdedor, la instancia pide al otro
  lado un bolt11 para cobrarla. noxtr mostraba un campo de texto pelado: el usuario no
  tenía forma de saber el importe, y el daemon **rechaza** cualquier factura que no
  coincida — `is_valid_invoice(pr, Some(counterparty_share), Some(0))` en
  `app/bond/payout.rs`, respuesta `cant-do InvalidInvoice`. Fee 0 a propósito: las
  comisiones de routing las paga la instancia, así que la factura va por el importe íntegro.

  Ahora se lee `payload.bond_payout_request.order.amount` —el doc del struct en
  `mostro-core` dice literalmente *«amount = counterparty share in sats»*, no es el importe
  del trade— y se muestra en grande, con el aviso de que debe cuadrar exactamente.

- **No se avisaba de la fecha límite, y pasarla cuesta el cobro.** Si no llega factura
  dentro de la ventana, el daemon ejecuta `forfeit_bond` y los sats se quedan en el nodo
  (`app/bond/payout.rs`). La fecha se calcula igual que allí: `slashed_at` (del
  `BondPayoutRequest`) + el tag `bond_payout_claim_window_days` del evento 38385
  (`nip33.rs::bond_policy_tags`) × 86400. Los dos valores vienen del protocolo; si la
  instancia no publica el tag no se inventa un plazo, simplemente no se muestra el aviso.

### Añadido

- **Validación del importe en cliente antes de enviar.** Nuevo `_bolt11AmountSats()`, que
  lee el importe de la parte legible de la bolt11 (`ln` + red + número + multiplicador
  m/u/n/p). Si la factura declara un importe distinto del exigido se avisa y no se manda,
  en vez de gastar un intento contra un `cant-do`. Una factura sin importe (amountless) se
  deja pasar: esa decisión es del daemon, no del cliente. Conversiones con
  multiplicadores/divisores enteros — encadenar `1e-9 * 1e8` en coma flotante da
  1482.0000000000002 y rompería la comparación por igualdad.
- **`bond_payout_claim_window_days` se lee del 38385** y se guarda en `_robotBond`. Antes
  el cliente leía 4 de los 7 tags del bloque de fianzas.
- **La petición de cobro ya no se pierde al recargar.** `add-bond-invoice` se descartaba en
  replay histórico (el gate `!isLive` solo eximía a `pay-invoice` y `pay-bond-invoice`), así
  que quien cerrara el diálogo o recargara la página dejaba de verla: solo reaparecía si tenía
  la pestaña abierta cuando el daemon reintentaba. Aquí lo que se pierde es **dinero** —
  agotada `payout_claim_window_days`, `forfeit_bond` y el nodo se queda con la fianza entera.
  Ahora va por el mismo carril que los otros dos, y además:
  - Se persiste el `BondPayoutRequest` (importe + `slashed_at`) en localStorage, como ya se
    hacía con la hold invoice.
  - Botón **💰 Cobrar fianza** en la ficha del trade mientras el cobro siga pendiente
    (`_pendingBondPayout` / `_showBondPayoutDialog`, espejo de `_pendingHoldInvoice` /
    `_showHoldInvoiceQr`).
  - El marcador se retira **solo** con `bond-payout-completed`, no al enviar la factura: si el
    `send_payment` del daemon falla, vuelve a pedirla y el botón tiene que seguir ahí.
  - `_pendingBondPayout` **no mira el estado del trade**, y es deliberado: el cobro de la
    fianza ocurre JUSTO DESPUÉS de que el trade muera. El daemon manda `admin-settled` /
    `admin-canceled` —que mapean a `completado`/`cancelado`— y solo entonces, desde el tick del
    scheduler, pide la factura del payout. Una primera versión limpiaba en los estados
    terminales y se cargaba el marcador en el mismo instante de guardarlo: el diálogo no
    llegaba a abrirse nunca y el rastro en localStorage desaparecía. Misma trampa que
    `_noQrStatuses` con la hold invoice, cometida otra vez.
  - **`subscribeMyTrades` mantiene el canal del nodo abierto tras cerrarse el trade** cuando
    aún puede llegar un cobro. Excluía todos los estados terminales, así que la trade key
    salía del filtro `#p` y los reintentos de `add-bond-invoice` —que el daemon manda cada
    `payout_invoice_window_seconds` durante toda la ventana— no se pedían nunca al relay: el
    ganador de la disputa se quedaba sin cobrar sin enterarse. Nuevo
    `_bondPayoutWindowOpen()`: escucha si hay cobro pendiente guardado, o si hubo fianza y la
    ventana puede seguir abierta; si el trade nunca tuvo fianza, no escucha. El fallback de 15
    días que lleva dentro es SOLO para decidir cuánto escuchar (tira por lo largo a propósito),
    nunca para mostrar un plazo: la fecha límite sale exclusivamente del tag que publique la
    instancia. Es el mismo criterio que `repTargets` ya aplicaba a las valoraciones, que
    también llegan después de `completado`.
- Cuatro cadenas nuevas (`NOXTR_BOND_PAYOUT_EXACT_AMOUNT`, `NOXTR_BOND_PAYOUT_DEADLINE`,
  `NOXTR_BOND_PAYOUT_AMOUNT_MISMATCH`, `NOXTR_BOND_PAYOUT_CLAIM_BTN`) en los cinco idiomas.
- **El chat de disputa tenía media hoja de estilos sin escribir.** `.mostro-dispute-chat-box`,
  `.mostro-chat-header`, `.mostro-dispute-chat-input` y `.mostro-chat-admin` no existían en
  `style.mostro.css`: la caja salía sin marco, la cabecera sin fondo, el input con la
  apariencia por defecto del navegador y los mensajes del admin indistinguibles de los
  propios. Ahora va deliberadamente MÁS destacado que el chat P2P —marco de aviso, barra de
  cabecera con fondo propio, burbujas del admin diferenciadas— porque en una disputa hay
  dinero retenido y el usuario tiene que ver de un vistazo con quién habla.
- **El chat de disputa se cierra al resolverse.** Se pintaba con solo mirar `solver_pubkey`,
  que no se borra nunca, así que la caja se quedaba ahí para siempre ofreciendo escribir a un
  solver que ya cerró el caso. Ahora exige además que el trade no esté en estado terminal, que
  es exactamente «disputa resuelta»: el daemon cierra toda disputa con `admin-settled` →
  `completado` o `admin-canceled` → `cancelado` (`admin_settle.rs` / `admin_cancel.rs`).

## 1.4.188 — El vendedor se quedaba sin QR de la hold invoice

### Corregido

- **El canal público metía al vendedor en `activo` antes de que pagara nada, y eso le
  quitaba el QR de la hold invoice.** El mapeo `'in-progress' → 'activo'` que añadió
  1.4.145 a `_applyPublicOrderStatus` se dispara en cuanto la orden sale del book
  —con fianzas, en cuanto entra la del taker—, no cuando la hold invoice está pagada.
  Con el trade ya en `activo` (∈ `_noQrStatuses`), el `pay-invoice` que llegaba justo
  después no abría el QR, tampoco salía el botón «⚡ ver QR de nuevo», y la ficha
  ofrecía «Disputa» y un chat sin clave del par. El vendedor no tenía ninguna forma de
  pagar y el trade moría. Es la misma trampa ya arreglada en el canal del nodo para
  `buyer-took-order`/`waiting-buyer-invoice`, reintroducida por el otro canal.

  Diagnosticado sobre la orden `d97129eb` (vendedor maker, rango 1-2 EUR): `is_seller=1`
  + `trade_role='created'` + `trade_kind='sell'` descartan el canal DM (sus overrides
  estaban activos), `peer_pubkey` vacío descarta `hold-invoice-payment-accepted`/`active`
  (traen las pubkeys y `isHoldConfirmed` las captura), y `trade_action='pay-invoice'`
  demuestra que la factura llegó y se procesó pero `tomado` no pudo bajar de `activo`.
  Solo quedaba este camino, el único que sube a `activo` sin tocar `peer_pubkey`.

  Ahora el canal público nunca declara `activo`: degrada al estado que corresponde a
  cada rol (vendedor → `esperando_hold_invoice`, comprador → `tomado`). El paso real lo
  da el nodo, que es la autoridad.

- **El comprador se quedaba sin poder mandar su factura, por el mismo motivo.** Espejo
  exacto del caso anterior con el rol invertido: con el trade marcado `activo` antes de
  tiempo, el comprador pierde las DOS vías de enviar su bolt11 —el handler de
  `add-invoice` se salta entero si `preStatus` es `activo` (ahí va el envío automático de
  la lnaddr capturada al tomar) y el input inline de la ficha solo se pinta en
  `tomado`/`liberando`—, así que la contraparte se queda en «esperando factura del
  comprador» indefinidamente. Reproducido con una venta creada en Mostro Mobile y tomada
  en noxtr. Dos correcciones:
  - `buyer-took-order` y `waiting-buyer-invoice` ya no mapean a `activo` para el
    comprador. Significan literalmente «espero TU factura»; solo son `activo` para el
    vendedor que tomó una orden de compra, donde llegan tras entrar su hold invoice. El
    override existente solo cubría `isCreatedSellMaker`, así que el comprador quedaba fuera.
  - El degradado de `in-progress` se aplica ahora también al comprador. Estuvo limitado
    al vendedor con el argumento de que a él `activo` le servía de red de seguridad; era
    falso, porque `in-progress` le llega igualmente antes de mandar su factura.

  A diferencia del caso del vendedor, aquí **no** hay prueba de cuál de los dos caminos
  disparó el `activo`: el trade se completó al desbloquearlo a mano y `status`/
  `trade_action` los pisaron las acciones posteriores. Se corrigen los dos porque cada
  uno es un defecto por sí mismo, no porque conste que fueran la causa.

### Añadido

- **Red de seguridad: un `activo` sin `peer_pubkey` ya no esconde la factura.** Nuevo
  `_holdInvoiceStillDue()`, compartido por el gate de `pay-invoice` y el botón de la
  ficha. `activo`/`fiat_enviado` solo se creen si además se conoce la contraparte —se
  captura en el mismo mensaje que confirma el pago—, así que un estado subido de más
  deja de dejar al vendedor sin salida. Y el rastro persistido de la factura solo se
  borra en los estados terminales: borrarlo en cualquier `_noQrStatus` convertía un
  fallo de estado en un trade irrecuperable.
- Un `pay-invoice` bloqueado por el gate deja un `console.warn` con `order_id`, ambos
  estados y `peer_pubkey`. Sin él, un `pay-invoice` escondido por la UI es
  indistinguible de uno que nunca llegó, que es lo que hizo falta mirar en la BD a mano.
- **La ficha del trade ahora se despliega al llegar un mensaje de chat.** El chat se
  abría, pero si la ficha estaba plegada a una línea la caja quedaba dentro de una
  tarjeta sin altura y el mensaje no se veía. Nuevo `_expandTradeCard()`, usado por el
  chat P2P y por el de disputa: marca el trade en `_expandedTrades` —para que el
  siguiente re-render no lo vuelva a plegar— y quita la clase en el DOM al momento, sin
  forzar un re-render que interrumpiría lo que el usuario esté haciendo.
- **Plegar una ficha cierra su chat.** El CSS ya lo tapaba mientras estaba plegada, pero
  la clase `mostro-chat-open` sobrevivía y al volver a desplegar reaparecía abierto. El
  chat de disputa se deja intacto: se renderiza siempre abierto a propósito.
- **`_showHoldInvoiceQr` daba por abierto un diálogo que no se veía.** Le bastaba con
  que el overlay tuviera `parentNode` para hacer `return true` sin pintar nada, así que
  un nodo huérfano o los restos de un cierre a medias dejaban al vendedor sin QR y sin
  rastro en consola —la función informaba de éxito—. Ahora exige que esté en el
  documento y realmente pintado (`getClientRects()`, no `offsetParent`: los overlays son
  `position:fixed`); si no lo está, lo descarta, avisa y abre uno nuevo.

## 1.4.145 — Kind 38385 y máquina de estados

Verificado contra `MostroP2P/mostro` (fde11c3): `nip33.rs::info_to_tags`,
`nip33.rs::bond_policy_tags`, `app/order.rs:38-41`, y el enum `Status` de
`mostro-core` (`order.rs`).

### Corregido

- **Los límites del 38385 se comparaban en la unidad equivocada y bloqueaban el
  envío.** `max_order_amount` y `min_payment_amount` son **satoshis**, y el daemon
  valida el importe en sats con su propio proveedor de precio
  (`app/order.rs:38-41` → `OutOfRangeSatsAmount`). El cliente convertía a fiat con
  **su** cotización y abortaba el `new-order` si no cuadraba, de modo que cerca del
  borde las dos validaciones discrepaban en ambos sentidos y se rechazaban órdenes
  que la instancia habría aceptado. Ahora el aviso es orientativo —nunca impide
  enviar—, se aplica un colchón del 3 % a los dos extremos y el texto dice
  explícitamente que es una estimación con la cotización local. La última palabra la
  tiene el nodo, que ya responde `cant-do OutOfRangeSatsAmount` y el cliente ya sabe
  mostrar. El filtro por divisa sigue bloqueando: ahí no hay conversión de por medio.

- **Faltaban dos estados en el mapa de `_applyPublicOrderStatus`.**
  `waiting-taker-bond` e `in-progress` existen en el enum `Status` y se publican en
  el 38383, pero no estaban mapeados: caían en el `return false` por status
  desconocido y el trade se quedaba en el estado anterior hasta que llegara un DM
  —el mismo patrón que ya provocó los cuelgues de `cooperative-cancel-accepted` y
  `admin-settled`—. `waiting-taker-bond` iba a empezar a llegar en cuanto se operase
  contra una instancia con fianzas. Añadidos como `tomado` y `activo`.
- **Reordenado `statusPriority` para que `in-progress` no pise una cancelación en
  vuelo.** `cancelando` y `cancelacion_solicitada` pasan por encima de `activo`: son
  peticiones locales que el daemon no refleja en el status público (la orden se
  sigue publicando como in-progress), así que con el orden anterior el primer 38383
  posterior borraba de la ficha que el usuario había pedido cancelar. Siguen por
  debajo de `fiat_enviado` y de los terminales, que sí la superan de verdad.
- Un status del 38383 sin mapear deja ahora rastro con `_mostroDebugWarn` en vez de
  descartarse en silencio, para que un valor nuevo del daemon se detecte.

### Añadido

- **Cuantía de la fianza antes de tomar la orden.** Se leen `bond_amount_pct` y
  `bond_base_amount_sats` del 38385 (`nip33.rs::bond_policy_tags`) y se guardan en
  `_robotBond`. Si la instancia exige fianza y publica la cuantía, se avisa del
  importe estimado **antes** de tomar la orden —en los dos caminos, take-sell y
  take-buy—, en lugar de que el usuario se entere al recibir el QR con la orden ya
  tomada. Esos tags solo se emiten con las fianzas activadas: si faltan, no se
  muestra importe. Tampoco se combinan porcentaje y base, porque el daemon no
  publica cómo lo hace: se usa el porcentaje cuando se conoce el importe en sats de
  la orden y, si no, la base publicada.
- Tres cadenas nuevas (`NOXTR_BOND_ESTIMATE_PCT`, `NOXTR_BOND_ESTIMATE_BASE`,
  `NOXTR_LIMIT_ESTIMATE_NOTE`) en los cinco idiomas.

## 1.4.144 — Auditoría de cumplimiento contra mostro-core 0.14.5

Revisión del cliente Mostro contra `MostroP2P/mostro-core` (b96158d, v0.14.5) y
`MostroP2P/mostro` (fde11c3), leyendo el código fuente de ambos y no la
documentación publicada, que en algún punto va por detrás del código.

### Seguridad — corregido

- **El canal del nodo no comprobaba la autoría del kind 14** (`script.mostro.js`).
  Los mensajes entrantes se emparejaban con un trade únicamente por el tag
  `#p` = `trade_key_pub`, que es información pública (es el autor de nuestros
  propios kind 14 salientes), y la clave de conversación NIP-44 se derivaba de
  `ev.pubkey`, es decir de cualquier remitente. Cualquiera podía cifrar un kind 14
  correctamente firmado a esa trade key e inyectar acciones del nodo: un
  `pay-invoice` con su propia bolt11, un `purchase-completed` o un `canceled`
  fabricados. El filtro `authors` de la suscripción es una petición al relay, no
  una garantía criptográfica. Ahora se exige `ev.pubkey === trade.robot_pubkey`
  antes de descifrar, igual que hace el daemon con `unwrapped.sender`.

  Esto matiza lo que afirmaba la entrada 1.4.108 bajo «estado de cumplimiento»:
  la firma del evento entrante sí se verificaba, pero verificar la firma prueba
  que el evento no está manipulado, no quién lo mandó. El chat P2P y el de
  disputa sí comprobaban al remitente; el canal del nodo era el único de los tres
  sin esa comprobación.

### Protocolo — corregido

- **`payment_request` se enviaba con dos elementos.** `Payload::PaymentRequest`
  es una tupla de TRES (`Option<SmallOrder>, String, Option<Amount>` —
  `message.rs:692`; el tercer elemento existe desde mayo de 2024). Con dos, serde
  falla al deserializar con `invalid length 2` y el daemon descarta el mensaje
  entero antes de `MessageKind::verify()`, sin devolver `cant-do`: fallo mudo.
  Afectaba a `add-invoice` con bolt11 —camino crítico de toda compra— y a
  `add-bond-invoice`. Ahora `[null, bolt11, null]`; el tercer elemento debe estar
  presente y ser nulo, no ausente.

- **Unidades incorrectas en el tercer elemento.** La rama de Lightning Address
  colocaba ahí un importe en fiat cuando la orden era de rango, en un hueco que
  es `i64` en satoshis. El daemon no lee ese elemento en `add-invoice`:
  `get_amount()` solo aplica a `take-sell`/`take-buy`, la validación va contra
  `order.amount` de su propia base de datos y la Lightning Address la resuelve él
  mismo (`is_valid_invoice` → `LightningAddress`/`LnUrl`). Las dos ramas se
  unifican por tanto en un único payload con `null`, y desaparece el aviso que
  bloqueaba el envío de una Lightning Address válida cuando el cliente no conocía
  el importe en sats.

### Verificado sin cambios

- **Firmas internas del tuple v2.** El cliente descarta `trade_sig` e
  `identity_proof` de los mensajes entrantes sin validarlos. No hay nada que
  validar: el nodo envía con `signed: false` y usa el mismo par de claves como
  identidad y trade key (`util.rs:726-741`), de modo que ambos campos son siempre
  nulos. La autenticidad la garantizan la firma del kind 14 y la comprobación de
  autoría anterior.

- **Sobre `Message` de los mensajes salientes.** Todos viajan como
  `Message::Order`, incluidos `dispute` y `rate-user`. El daemon despacha por
  acción y nunca inspecciona la variante, y él mismo emite sus ratings dentro de
  `Message::Order` (`rate_user.rs:292`). La única variante con significado real
  es `Message::Restore`, usada por `last-trade-index`.

### Pendiente declarado

- **Custodia de las trade keys.** La `trade_privkey` y la semilla BIP-39 de la
  que se derivan se guardan en el servidor, cifradas en reposo con AES-256-GCM.
  Esto hace a noxtr custodial: quien controle el servidor puede firmar en nombre
  del usuario. Es una consecuencia del diseño del monitor, que necesita descifrar
  los mensajes del nodo con el navegador cerrado para poder notificar por email.
  El monitor solo descifra y nunca firma —no hay una sola llamada de firma con
  `trade_privkey` en `server_monitor.php`—, pero la capacidad existe. Ver
  `SECURITY.md`.
  
## 1.4.143 — `last-trade-index` (roadmap #9)

### Añadido

- **Sincronización del `trade_index` con el nodo antes de crear o tomar una orden.**
  El contador no lo lleva el cliente: cada instancia tiene su propia tabla `users`.
  Si la misma identidad ya había operado desde Mostro Mobile u otra instalación de
  noxtr, el máximo calculado a partir de los trades locales se quedaba corto y el
  siguiente `new-order`/`take-*` moría con `CantDoReason::InvalidTradeIndex`. Ahora
  `syncTradeIndex(robotPubkey)` pregunta al nodo y el contador local se sube al
  máximo de ambos.
- Detalles del protocolo, verificados en `mostro/src/app/last_trade_index.rs` y
  `app.rs`: la petición va en el sobre `restore` (`Message::Restore`, no `order`),
  acción `last-trade-index`, `payload` null (lo exige `MessageKind::verify`), sin
  `id` y sin `trade_index` — `check_trade_index` solo se aplica a `new-order`/`take-*`.
  La respuesta usa el mismo sobre y acción, con el valor en `trade_index`.
- La petición se firma con una **clave aleatoria de un solo uso**: el nodo responde a
  `event.sender`, así que no hace falta gastar un índice de derivación de la semilla
  NIP-06 en un mensaje que no es un trade.
- Solo aplica en **modo reputación**: el nodo identifica al solicitante por
  `event.identity`. Sin prueba de identidad responde `cant-do` NotFound, que es lo
  normal para una identidad que ese nodo no ha visto nunca y se trata como "sigue con
  el contador local" (sin aviso al usuario).
- La petición sale por el carril **`pow_first_contact`**: `app.rs:377` elige la
  dificultad con `gate.is_known(event.pubkey)`, no por la acción, y la clave efímera es
  desconocida para el nodo por definición. Con el PoW base el evento se descarta antes
  de descifrarse y sin `cant-do`, así que solo se vería un timeout mudo.
- Respuesta cacheada por `robot_pubkey` (el contador es por nodo) y timeout de 4 s. El
  timeout se cachea igual que el `cant-do`: como la consulta se espera con `await`
  antes de repartir índice, sin cachear el fallo cada operación contra un nodo mudo
  pagaría la espera entera. Una instancia antigua que no conozca la acción, o un relay
  lento, cuestan 4 s una sola vez por sesión y no bloquean nada más.
- `_nextTradeIndex()` se parte en `_ensureMaxTradeIndex()` (calcula el máximo local
  sin consumirlo) y `_nextTradeIndex()` (lo consume), para poder subir el suelo con lo
  que diga el nodo antes de repartir índice.

### Corregido

- **`_wrapV2` leía la acción de `msgObj.order.action`**, hard-codeado al sobre `order`.
  Con el sobre `restore` salía `undefined`, de modo que ni el carril de PoW ni ninguna
  otra decisión basada en la acción funcionaban para `last-trade-index`. Ahora se lee
  del primer sobre que traiga el mensaje, igual que hace `_handleGiftWrap` al recibir.
  Para los mensajes que ya existían el resultado es idéntico (su único sobre es `order`).

## 1.4.141 — DMs enviados por NIP-04 no se guardaban

### Corregido

- **Los DMs enviados por NIP-04 desaparecían al recargar la página.**
  `sendMessage` publicaba el evento y lo añadía a la conversación en memoria, pero
  nunca lo persistía: a diferencia de `_sendNip17`, no llamaba a `saveToDb`. Tampoco
  servía el eco del relay, porque cuando el kind 4 propio vuelve por la suscripción
  `authors:[pubkey]`, el id ya está en `convos` y el anti-duplicado de `handleEvent`
  corta antes de llegar a `saveToDb`. El mensaje llegaba bien a la contraparte y los
  recibidos sí se guardaban, así que el fallo solo se manifestaba en los propios
  enviados y solo con **NIP-46** (`canNip17` excluye el firmador remoto, de modo que
  es la única identidad que envía por NIP-04; con nsec o extensión con NIP-44 se
  envía por NIP-17, que sí persiste).
- El texto en claro del mensaje enviado se guarda además en la caché local por id de
  evento, para que al recargar no haya que pedirle al firmador remoto que descifre un
  mensaje escrito por uno mismo.

## 1.4.116 — Compatibilidad de DMs con extensiones sin NIP-44

### Corregido

- **DMs con extensiones NIP-07 sin soporte NIP-44** (p.ej. Nos2x-fox): la interfaz
  informa ahora de que la extensión no soporta NIP-44, en lugar de pedir la nsec de
  forma engañosa. Se distinguen dos avisos: cuando no hay ninguna capacidad de
  cifrado (se pide nsec) y cuando hay extensión pero sin NIP-44 (se recomienda
  actualizarla o usar una compatible como Alby o nsec.app).
- No se emiten mensajes NIP-04 nuevos desde extensiones sin NIP-44. NIP-04 queda
  únicamente para lectura de histórico y para el chat de Mostro (requisito del
  daemon); el envío por NIP-46 conserva su ruta NIP-04 por rendimiento.
- Aviso traducido a los cinco idiomas (es, en, fr, it, pt).


## 1.4.108 — Endurecimiento de seguridad y cumplimiento de protocolo

Cierre de los hallazgos de seguridad de servidor de la revisión interna y del
estado de cumplimiento del cliente Mostro con el protocolo publicado, en las
dimensiones que la auditoría de cumplimiento había señalado.

### Seguridad — corregido

- **SSRF en Lightning Address** (`ajax.php`): las peticiones salientes al resolver
  una Lightning Address validan ahora el destino (resolución DNS + rechazo de IPs
  internas, loopback, link-local y metadata) y no siguen redirecciones. Se valida
  también el segundo salto (el `callback` que devuelve el servidor remoto).
- **SSRF / DoS al cachear imágenes de perfil** (`ajax.php`): misma validación de
  destino, sin seguir redirecciones, y límite de tamaño de descarga.
- **Creación pública de facturas BTCPay** (`raw.php`): el endpoint del botón de
  donación sigue siendo público, pero con límite de peticiones por IP y la URL de
  redirección restringida al propio dominio (anti open-redirect).
- **Firma NIP-57 del zap request** (`raw.php`): se verifica la firma Schnorr
  (BIP-340) del zap request, reutilizando la verificación ya usada por el monitor.
  Antes solo se comprobaba el formato.
- **Escape HTML del cliente** (`script.js`): `escapeHtml` cubre también la comilla
  simple.
- **Consultas SQL** (`noxtrstore.class.php`): documentadas y justificadas las
  consultas con literal (identificadores fijos / sentencias sin parámetros
  posibles); añadida validación de formato de identificador como defensa en
  profundidad.

### Protocolo Mostro — estado de cumplimiento

Verificado contra el código actual:

- **Transporte v2 (kind 14):** la firma del evento entrante del nodo se verifica
  antes de descifrar; PoW `first_contact` implementado.
- **Modo reputación:** firma canónica con `identity_proof` estructurado (v2).
- **Órdenes 38383 / info 38385:** se lee `protocol_version` del 38385.
- **Cancelación cooperativa:** las tres variantes implementadas y verificadas contra
  `cancel.rs` del daemon.
- **Chat P2P:** verificación de firma del rumor interno, cota de tamaño, cota de reloj
  y deduplicación.
- **Reputación / ratings entrantes (38384 / `Peer.reputation`):** procesados.

### Pendiente (conocido)

- **Restauración de sesión por índice de último trade:** no implementado. Las trade
  keys se generan aleatorias; el restore queda pospuesto (justificación técnica en la
  documentación del módulo).
- **Panel de administración:** el código está migrado a transporte v2, pero el panel
  está desactivado en producción.

### Notas

- La validación anti-SSRF resuelve DNS y rechaza destinos internos; el escenario de
  *DNS rebinding* queda fuera del alcance inmediato (mitigable a nivel de
  infraestructura).
