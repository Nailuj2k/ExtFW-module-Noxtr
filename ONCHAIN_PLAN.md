# Plan de trabajo on-chain para Noxtr

Fecha de redaccion: 2026-05-28

> **TEST MODE activo (2026-05-29):** los CSV del taptree estan acortados para validar la cascada en una jornada
> en lugar de un mes. Valores actuales en `Config` de `script.onchain.js`: `CSV_ARB2=6` (~1h), `CSV_ARB3=12` (~2h),
> `CSV_RECOVERY=36` (~6h). Produccion: `288 / 576 / 4320`. Cambian la direccion Taproot, asi que ambas partes y
> los arbitros deben correr la misma version. **Revertir antes de mainnet con fondos reales.**

Este documento deja por escrito el estado del modulo on-chain, las decisiones tomadas y el plan de trabajo para completarlo. La idea es poder retomarlo en otro ordenador sin tener que reconstruir todo el razonamiento.

## Auditoría y endurecimiento 2026-09-01

Se aplicó una revisión de seguridad y coherencia del protocolo sin conservar compatibilidad
de escritura con operaciones antiguas (no había trades abiertos). Resumen: validación completa
de id/firma/PoW Nostr; `order_id` estable más `d` por acción; contrato monetario y árbitros
congelados y comprobados; persistencia previa y outbox; verificación de UTXO no gastado;
revalidación del contrato/funding antes de arbitrar; expediente a los tres árbitros; y pago de
la comisión al árbitro que resuelve. Las private keys on-chain ya no se envían ni se aceptan en
el servidor: se rederivan en memoria desde la raíz cifrada y se cotejan con la pubkey persistida.

El tier `professional` se trata temporalmente como `regular`, porque el bond anunciado aún no
puede verificarse contra un script de slashing real. Siguen pendientes las pruebas completas de
disputa y recovery. La descripción normativa y el estado más reciente están en
`NOSTR_ONCHAIN.md` y `NIP-NOSTRESCROW.md`; las notas históricas posteriores de este plan pueden
describir decisiones ya sustituidas.

## Sesion 2026-06-01 — happy path validado en testnet + fixes (version JS 1.3.510)

**HITO: el happy path on-chain cooperativo se ha probado de punta a punta en testnet3 con confirmacion real
y BTC recibido en wallet.** Flujo completo verificado: crear orden (rango) -> tomar -> fondear escrow ->
esperar confirmacion del deposito -> fiat_sent/fiat_received -> direccion de cobro -> firma cooperativa ->
broadcast -> confirmacion en cadena -> fondos en la wallet del comprador. Salidas verificadas en mempool:
deposito 1877 -> comprador 1111 + arbitro 546 + fee minero 220 (modelo Variant C correcto).

**Entorno de pruebas:** wallet Blockstream Green en **testnet3**. El backend del servidor para testnet usa por
defecto `https://mempool.space/testnet/api` (= testnet3) salvo override `CFG['btcpay']['mempool_api_url_testnet']`.
testnet3 es inestable (bloques a rafagas, mempool se vacia, TX sin confirmar con fee bajo se caen). Sin nodo
propio en testnet: `rpc_network` por defecto = mainnet, asi que las TX de testnet salen por mempool.space.

**Bugs encontrados y arreglados esta sesion (todos en `script.onchain.js` + `i18n.php`):**

1. **`completado` falso (CRITICO para mainnet).** Se marcaba el trade como `completado` en cuanto el broadcast
   era aceptado por el mempool (0 conf) o solo por recibir el evento `complete` del peer. Si la TX se caia sin
   confirmar (testnet3, o fee spike/RBF en mainnet), el trade quedaba "completado" con el escrow intacto. FIX:
   solo se marca `completado` con **>=1 confirmacion real** (`_refreshReleaseTx`); entre broadcast y confirmacion
   el estado es no terminal ("Liberacion enviada, esperando confirmacion"); si la TX desaparece de la red ~3 min
   (`_RELEASE_DROP_MISSES=6` polls) se reabre el trade y reaparece el boton Difundir. Aplica a cooperativo,
   recovery y arbitraje. `_handleCompleteEvent` ya no marca completado a ciegas: guarda el txid y verifica en cadena.
2. **`takeOrder`: fallo de persist silencioso.** Si `onchain_trade_add` fallaba, se hacia solo `_warn` y la ficha
   optimista la borraba el `loadMyTrades` posterior -> no aparecia ficha en Mis trades y sin error visible. FIX:
   ahora se notifica el error (`str_take_persist_failed`). Causa tipica: `fiat_code` vacio (el server lo exige).
3. **QR BIP21 en el funding** (ficha del vendedor): incluye el importe exacto a depositar. Helper `_satsToBtc`.
4. **Mensaje informativo** mientras el deposito esta sin confirmar (rol-aware: comprador/vendedor).
5. **Input de cobro del comprador** pasaba a solo-lectura una vez difundida la liberacion (antes seguia editable
   con boton Guardar aunque ya estuviera fijada en la TX).
6. **Ordenes de rango: resto al tomar.** Al aceptar una toma de una orden de rango, ahora se retira la orden
   original del libro (`_retireOrderEvent`: kind 5 + reemplazo expires_at=1, SIN borrar la fila local que ya es
   el trade) y se publica una **orden nueva (child, otro order_id) con el resto del rango** `[min, max-tomado]`
   (modelo Mostro). Si el resto < min, solo se retira. Si el child no se puede publicar (escrow bloqueado), no se
   retira la original para no perder capacidad.

**Estado de los 2 trades de prueba previos (anteriores al fix #1):** quedaron en `completado` falso con un txid
que nunca confirmo; el fix NO los reabre (a proposito). Sus sats de testnet siguen en el escrow. Es testnet, se
ignoran.

**SIGUIENTE en casa (orden sugerido):**
- Probar el flujo de **rango con resto** (crear 1-10, tomar 1, ver que el orderbook pasa a 1-9).
- Probar **disputa** y **recovery** end-to-end en testnet (sigue siendo la frontera del paso 15/16).
- Pendientes de fondo antes de mainnet (ver lista al final de este doc y en NOSTR_ONCHAIN.md): revertir TEST MODE
  de los CSV, persistir los CSV por trade, payout via xpub, comision del arbitro en disputa ganada por vendedor.

## Sesion 2026-06-02 — BUG CRITICO de paridad del control block (JS 1.3.526)

**Encontrado y arreglado un bug que bloqueaba ~50% de los gastos on-chain** (cooperativo, recovery y
arbitraje). Sintoma: al difundir la liberacion, el nodo la rechaza con `mempool-script-verify-flag-failed
(Witness program hash mismatch)` y la TX nunca confirma. Estaba camuflado como "inestabilidad de testnet3".

**Causa raiz** (`_taprootOutputKeyParity` en `script.onchain.js`): el bit de paridad del control block
(BIP341) se sacaba de `output.toHex.length ? output.toHex(true) : output.toHex()`. Pero la libreria noble
(`_lib_/bitcoin/noble-secp256k1-1.2.14.js`, linea 303) declara `toHex(isCompressed = false)`, y una funcion
con parametro por defecto tiene `.length === 0` en JS. Asi que el guard caia a `toHex()` SIN flag, devolvia
la clave SIN comprimir (`04||x||y`), y `slice(0,2)` nunca era `'03'` -> **paridad SIEMPRE 0**. En direcciones
cuya clave de salida tiene Y impar (~50%), el control block llevaba paridad incorrecta -> rechazo del nodo.
Las direcciones de Y par funcionaban (de ahi que el happy path del dia 1 confirmara: era Y par por suerte).

**Fix:** llamar `output.toHex(true)` explicitamente y derivar la paridad del prefijo 02/03, con fallback a
`output.y & 1n`. Corrige los tres gastos (usan la misma funcion). Diagnostico hecho descargando la TX
rechazada de mempool.space, decodificando el testigo, y verificando con `Onchain.Taproot.buildDetails` que
la direccion del escrow SI se derivaba bien (el arbol era correcto; solo el control block del gasto estaba mal).

**Importante:** los trades odd-Y firmados ANTES del fix tienen el `coop_signed_tx` ya mal; re-difundir no
los arregla (hay que re-firmar con el codigo nuevo). En testnet se descartan. El fix aplica a trades nuevos.

Nota: el "Witness program hash mismatch" del recovery del dia 1 pudo ser ESTE bug (Y impar), no solo el
cambio de CSV. Con el fix, re-probar recovery/disputa.

### Continuacion 2026-06-02 (donde retomar en casa)

Estado al cerrar la sesion (version JS **1.3.528**):

- **Fix de paridad validado en vivo**: un trade odd-Y que daba "transaccion no encontrada" se recupero pulsando
  "Re-difundir". Confirmado que el bug esta cerrado y que los trades firmados antes del fix se recuperan con un clic.
- **Re-difundir robusto** (1.3.527): `broadcastCoop` re-ensambla la TX desde las firmas guardadas con el control
  block ACTUAL antes de enviar (las firmas valen; solo el witness estaba mal). Boton "Re-difundir" siempre visible
  mientras la liberacion no confirme. Verificacion+reenvio automatico tras difundir (`_verifyAndRetryBroadcast`).
- **Pasamos a MAINNET** para pruebas (testnet3 inestable + el wallet Green testnet no iba). El selector de red se
  deja visible (da aire pro); mainnet ya es el default. Los CSV siguen CORTOS (6/12/36) tambien en mainnet ->
  recovery ~6h, arb2 ~1h, arb3 ~2h reales. Pruebas con importes pequeñitos (~1€, sale a <1 sat/vB). Recordatorio:
  cerrar TODOS los trades de CSV corto antes de poner los 30 dias (si no, se bloquean: la direccion cambia con el CSV).
- **Selector de comision nuevo** (1.3.528): dialogo `_promptFee` con presets (Rapido/30min/1h/Economico, sat/vB y
  sats en vivo desde `recommended_fees`) + slider. Aplicado SOLO al gasto cooperativo (`startCoopSign`).

PENDIENTE / SIGUIENTE en casa:
1. **Migrar recovery y arbitraje al selector `_promptFee`** (hoy siguen con `prompt()` crudo: `recoverFunds`
   ~linea 4994 y `settleArbitration`). `_promptFee(network, vbytes)` es generico; vbytes: `_VBYTES_RECOVERY` (180)
   y `_VBYTES_ARB` (250). 1 linea cada uno, igual que se hizo en `startCoopSign`.
2. **Probar el cooperativo en mainnet** end-to-end (crear -> tomar -> fondear -> fiat -> firmar -> liberar ->
   confirmar). Validar que confirma a la primera (par e impar) con el fix de paridad.
3. **Probar disputa y recovery** en mainnet (con CSV cortos: recovery a las ~6h). Es la frontera real (paso 15/16).
4. Pendientes de fondo siguen abajo en "Pendientes antes de mainnet" (barrer comisiones de arbitro, etc.).

## Sesion 2026-06-03 — arb1 por defecto = admin de la WEB (tier site_admin) (JS 1.3.530)

Cambio de diseño implementado: el árbitro por defecto (arb1) ya **no es el admin de Mostro**, sino el
**admin de la web** (tier nuevo `site_admin`). Los admins de instancias Mostro pasan a ser árbitros normales
(`regular`/`professional`) y se destacan con un **badge ⚡Mostro** (el tag `mostro_admin` deja de ser un tier
y pasa a ser un distintivo independiente del tier).

Implementado en código (`script.onchain.js`) + spec (`NOSTR_ONCHAIN.md` §7.7/§9.1/§9.2/§9.4/§14.2):
- Tiers ahora: `site_admin` (rank 0, arb1 por defecto) / `professional` (rank 1) / `regular` (rank 2).
- `Config.defaultMostroArbitrator` → `Config.defaultSiteArbitrator`; se siembra el pool con tier `site_admin`.
  `_handleEvent` fuerza `site_admin` para la clave configurada aunque publique otro tier (no se deja degradar).
- CFG: `modules.noxtr.onchain_site_arbitrator` (fallback a `onchain_default_arbitrator`). En `footer.php` la
  clave JS es `defaultSiteArbitrator`.
- Diálogo de registro de árbitro: el `<select>` de tier ofrece solo `regular`/`professional`; se añadió un
  checkbox "¿Operas una instancia Mostro?" (`nxoc-arb-ismostro`) → publica el tag `mostro_admin` (badge), sin
  cambiar el tier. `publishAdvertisement` valida tier en {regular, professional} y publica el tag por `is_mostro_admin`.
- `_label`/`_infoHtml`: etiqueta tier `site_admin`="Sitio"; badge "⚡Mostro" si lleva el tag.

Designación del árbitro del sitio (quién es "el admin de la web"): NO se confía en el `tier` del evento 39388
(es autodeclarado). La fuente de verdad es la CFG `modules.noxtr.onchain_site_arbitrator` que el servidor sirve
a TODOS sus clientes vía footer.php (`Config.defaultSiteArbitrator`). Escribirla está gated por rol: endpoint
ajax `set_site_arbitrator` que verifica server-side `Root() || Administradores()` (1.3.531). En el diálogo de
árbitro, si `Config.isOnchainAdmin` (flag servido por footer.php), aparece un bloque admin-only "Usar/Quitar
árbitro del sitio" (`_wireSiteArbitratorButtons`). `_handleEvent` fuerza tier `site_admin` a la clave configurada.

Origen: la decisión venía del borrador del NIP (`_modules_/nostr_escrow/txt.php`, editado en casa el 2026-06-02);
hoy se propagó a código + spec canónica. Pendiente menor: alinear los docs de diseño de `_modules_/nostr_escrow`
(README/ARCHITECTURE/IMPLEMENTATION aún dicen "default Mostro admin como arb1").

Sigue PENDIENTE de antes (no tocado hoy): migrar recovery/arbitraje a `_promptFee`; probar cooperativo/disputa/
recovery en mainnet (con el fix de paridad de 1.3.526).

## Estado actual

El modulo on-chain vive principalmente en:

- `script.onchain.js`: logica cliente para NostrEscrow, claves, Taproot, arbitros, address check y funding check.
- `script.mostro.js`: UI compartida del orderbook y mis trades; integra las ordenes on-chain con el render existente.
- `ajax.php`: endpoints `onchain_trade_add`, `mine_pow`, `verify_funding`, y stubs de `prepare_trade` / `broadcast_tx`.
- `bitcoin_rpc.class.php`: cliente generico para Bitcoin Core RPC y mempool.space.
- `after_init.php`: inicializa RPC y base de mempool.
- `NOSTR_ONCHAIN.md`: spec viva del protocolo. La spec es nuestra y se puede cambiar si hace falta.

Lo que ya existe:

- Publicacion de ordenes on-chain como eventos Nostr.
- Toma de orden por DM cifrado.
- Aceptacion por evento publico `accept`.
- Seleccion/publicacion de arbitros.
- Derivacion local de direccion Taproot.
- Verificacion bilateral de direccion con `address_check`.
- Deteccion de funding por RPC o mempool.space.
- Publicacion de `funding_commitment`.

Lo que falta (actualizado 2026-05-28):

- ~~Estados fiat reales: `fiat_sent`, `fiat_received`.~~ HECHO (+ `buyer_payout`).
- ~~Construccion de la transaccion de gasto.~~ HECHO (`Spend.buildCooperative`: tx_hex + sighash + leaf_script + control_block).
- ~~Firma Schnorr BIP340 sobre sighash Taproot.~~ HECHO (`Onchain.Schnorr.sign/verify`, roundtrip verificado en navegador).
- ~~Intercambio de firmas por DM (`coop_sign`).~~ HECHO (+ ensamblado witness `Spend.assembleCooperative`). Validado en testnet.
- ~~Broadcast (`broadcast_tx` real en ajax.php).~~ HECHO (`MempoolApi::post` + RPC; `UI.broadcastCoop`).
- ~~Evento `complete`.~~ HECHO (`Trader.publishComplete` + `_handleCompleteEvent`).
- ~~Disputa: lado partes (abrir + handlers + liquidacion del ganador).~~ HECHO.
- ~~Disputa: panel del arbitro (fase B).~~ HECHO (2026-05-29): procesa `dispute_request`, deriva la clave de arbitro
  (BIP86 idx 0), firma la hoja, publica 39387 y manda `arb_signature` al ganador. Pendiente probar end-to-end en testnet.
- ~~Recovery (gasto unilateral del vendedor tras CSV 4320).~~ HECHO (2026-05-29): `Spend.buildRecovery`/`assembleRecovery`
  (hoja 1, single-sig, nSequence=4320 BIP68) + `UI.recoverFunds` (gate via `tx_status`: funding >= 4320 confs) +
  boton en la ficha del vendedor + `debugRecoverySpend`. Pendiente probar en testnet (el CSV obliga a esperar 4320 confs).

Conclusion importante: el happy path on-chain esta completo de punta a punta en la UI (crear/tomar/aceptar -> direccion -> funding -> fiat -> firma cooperativa -> broadcast -> complete), con el gasto cooperativo probado en testnet. La disputa (partes + arbitro) y el recovery estan implementados, sin probar todavia end-to-end. TODO el protocolo esta cubierto en codigo. Antes de mainnet con fondos reales: probar disputa y recovery en testnet/signet.

## Decisiones de diseno

### 1. Dividir el trabajo en dos partes

Primero se arregla y endurece lo que ya existe. Despues se completa el flujo que falta.

Razon: no conviene implementar gasto real encima de estados ambiguos o eventos que se puedan falsear. La parte de firmas/broadcast es la mas delicada y necesita una base consistente.

### 2. Selector global de red

Se usara un selector global de red on-chain:

- `mainnet`
- `testnet`
- `signet`

La red activa define que ordenes se muestran, que trades se pueden operar, que prefijo de direccion se usa y contra que backend se verifica funding.

No se mezclan trades de redes distintas. Cambiar de red no convierte trades; solo cambia el universo visible/operable.

Razon: esto evita errores graves como verificar una direccion testnet contra mainnet, tomar una orden de otra red o enviar fondos a una direccion que no corresponde al entorno de prueba.

Notas:

- `mainnet` usa direcciones `bc1p...`.
- `testnet` y `signet` usan direcciones `tb1p...`.
- Aunque testnet y signet comparten prefijo `tb`, no comparten cadena ni mempool. El endpoint/RPC debe ser el correcto.
- `signet` es una red de pruebas Bitcoin mas estable/controlada que testnet. Es util para pruebas repetibles de contratos Taproot, confirmaciones, fees y broadcast sin arriesgar BTC reales.

### 3. No cambiar tablas si no es necesario

Preferencia: no modificar estructura de tablas.

Usar:

- `method = 'onchain'` para distinguir estos trades.
- `internal_status` para el estado principal.
- `trade_json` para metadatos especificos on-chain.

Ejemplo de `trade_json`:

```json
{
  "network": "signet",
  "trade_id": "...",
  "maker_nostr_pubkey": "...",
  "taker_nostr_pubkey": "...",
  "maker_trade_pubkey": "...",
  "taker_trade_pubkey": "...",
  "onchain_status": "address_verified",
  "premium": "0"
}
```

Si aparecen estados nuevos que PHP no acepta, ampliar la lista blanca en `ajax.php`, pero sin alterar columnas.

Estados razonables para `internal_status`:

- `creado`
- `pendiente_aceptacion`
- `aceptado`
- `funded`
- `fiat_enviado`
- `fiat_recibido`
- `firmando`
- `completado`
- `cancelado`
- `disputado`

## Parte 1: arreglar y endurecer lo existente

Objetivo: que la parte actual sea coherente, segura y probada hasta funding detectado, sin completar todavia el gasto.

### 1. Guardar y validar identidad real del maker

Problema actual:

El taker procesa un evento `accept` si el tag `taker` coincide con su pubkey y tiene un trade local pendiente. Pero no valida que `ev.pubkey` sea el maker real de la orden que tomo.

Riesgo:

Un tercero podria publicar un `accept` falso para un `order_id` conocido y hacer que el taker guarde una contraparte incorrecta.

Tareas:

- En `takeOrder()`, guardar en `trade_json` el `maker_nostr_pubkey` de la orden tomada.
- En `_handleAcceptEventAsTaker()`, rechazar el evento si `ev.pubkey !== maker_nostr_pubkey`.
- Si falta `maker_nostr_pubkey` en trades antiguos, no aceptar automaticamente; mostrar aviso o requerir reload/orderbook para reconstruir contexto.
- Incluir `maker` y `taker` como tags en eventos publicos relevantes cuando aplique.

Criterio de aceptacion:

- Un `accept` firmado por una pubkey distinta del maker se ignora.
- Un `accept` valido del maker actualiza el trade del taker.

### 2. Normalizar metadatos on-chain

Problema:

Parte de la informacion vive en columnas, parte en memoria y parte en `trade_json`. Hay que hacer explicito que datos son obligatorios.

Tareas:

- Definir helpers para leer/escribir `trade_json` sin perder campos existentes.
- Asegurar que desde el principio se guardan:
  - `network`
  - `maker_nostr_pubkey`
  - `taker_nostr_pubkey` cuando exista
  - `maker_trade_pubkey`
  - `taker_trade_pubkey`
  - `trade_id`
  - `premium`
- Evitar sobrescribir `trade_json` completo si solo se cambia un campo; mezclar metadatos.

Criterio de aceptacion:

- Despues de crear, tomar y aceptar una orden, ambos lados tienen metadatos suficientes para validar eventos posteriores sin depender del orderbook en memoria.

### 3. Selector global de red

Tareas:

- Anadir configuracion `Onchain.Config.network`.
- Crear selector UI sencillo para `mainnet/testnet/signet`.
- Guardar seleccion en `localStorage` inicialmente.
- Publicar tag `["network", "<network>"]` en ordenes on-chain.
- Persistir `network` en `trade_json`.
- Filtrar orderbook on-chain por red activa.
- En Mis trades, mostrar claramente la red del trade y bloquear acciones si no coincide con la red activa.

Detalles:

- Direcciones:
  - `mainnet` -> HRP `bc`
  - `testnet` -> HRP `tb`
  - `signet` -> HRP `tb`
- Mempool:
  - `mainnet` -> `https://mempool.space/api`
  - `testnet` -> `https://mempool.space/testnet/api`
  - `signet` -> `https://mempool.space/signet/api`
- RPC:
  - El servidor debe saber que RPC corresponde a que red si se usa Bitcoin Core.

Criterio de aceptacion:

- Una orden `signet` no aparece en orderbook `mainnet`.
- Un trade `testnet` no permite verificar funding si la red activa es `mainnet`.
- `verify_funding` recibe la red y usa el backend correcto.

### 4. No mezclar redes en backend

Problema:

`verify_funding` valida direcciones `bc1p` y `tb1p`, pero no distingue testnet de signet por si solo.

Tareas:

- Exigir parametro `network` en `verify_funding`.
- Validar que:
  - `mainnet` solo acepta `bc1p`.
  - `testnet` y `signet` solo aceptan `tb1p`.
- Seleccionar base de mempool segun red.
- Si hay RPC configurada, asegurar que corresponde a esa red o deshabilitar RPC para redes no configuradas.
- Devolver error claro si hay inconsistencia.

Criterio de aceptacion:

- No se puede consultar una direccion `bc1p` en testnet/signet.
- No se puede consultar una direccion `tb1p` en mainnet.
- El resultado de funding incluye `network`.

### 5. Validar Taproot con vectores independientes

Explicacion:

`script.onchain.js` calcula la direccion Taproot manualmente: scripts, TapLeaf hash, Merkle root, TapTweak y bech32m. Si hay un bug pequeno, los fondos podrian ir a una direccion que luego no sepamos gastar.

La validacion independiente consiste en tomar los mismos datos de entrada y calcular la direccion con otra implementacion que no reutilice nuestras funciones.

Opciones:

- Script local Node usando `bitcoinjs-lib` si ya esta disponible o se instala para tests.
- Script Python con una libreria Bitcoin fiable.
- Herramienta externa usada solo para generar vectores, no en produccion.

Tareas:

- Crear 2-3 vectores de prueba:
  - seller pubkey
  - buyer pubkey
  - 3 arbitros
  - red
  - scripts esperados
  - merkle root esperado
  - direccion esperada
- Comparar salida de `Onchain.Taproot.buildDetails()` contra esos vectores.
- Documentar los vectores en `NOSTR_ONCHAIN.md` o en un archivo de tests.

Criterio de aceptacion:

- La direccion generada por Noxtr coincide con una implementacion independiente para mainnet y para signet/testnet.

### 6. Endurecer `address_check`

Tareas:

- Incluir y validar `network` en eventos `address_check`.
- Validar estrictamente maker/taker:
  - El evento propio marca publicado.
  - El evento del peer solo se acepta si viene de la contraparte esperada.
- Si la direccion no coincide, bloquear avance del trade y mostrar aviso persistente.
- No considerar verificada una direccion si la red no coincide.

Criterio de aceptacion:

- Dos partes en la misma red y con mismos datos llegan a `_addressVerified = true`.
- Si una parte publica direccion distinta o red distinta, el trade queda marcado como mismatch.

### 7. Endurecer `funding_commitment`

Tareas:

- Incluir `network` en kind `39389`.
- Validar que el evento viene del vendedor esperado.
- Validar que `address`, `amount` y `network` coinciden con el trade local.
- Verificar siempre en cadena con `verify_funding`; no confiar solo en el evento publico.

Criterio de aceptacion:

- Un tercero no puede disparar funding falso.
- Un funding correcto aparece en ambos lados despues de verificacion on-chain.

### 8. Reglas de importe

Decision pendiente:

Ahora `verify_funding` busca un output con importe exacto. Esto es simple y reduce ambiguedad, pero puede fallar si el usuario envia de mas por error.

Opciones:

- Mantener exact match: mas seguro y facil de razonar.
- Aceptar `>= expected`: mas flexible, pero hay que definir que ocurre con el exceso.

Recomendacion inicial:

Mantener exact match hasta completar gasto cooperativo. Si hay mismatch, mostrar aviso claro con importe recibido y esperado.

Criterio de aceptacion:

- Deposito exacto se acepta.
- Deposito incorrecto se muestra como mismatch, no como ausencia de deposito.

## Parte 2: completar el flujo

Objetivo: completar el trade on-chain de extremo a extremo: fiat, firmas, broadcast, cierre, disputa y recovery.

### 1. Eventos fiat

Tareas:

- Implementar evento `fiat_sent`:
  - Lo publica el comprador.
  - Actualiza estado a `fiat_enviado`.
  - Notifica al vendedor.
- Implementar evento `fiat_received`:
  - Lo publica el vendedor.
  - Actualiza estado a `fiat_recibido`.
  - Desbloquea fase de firma cooperativa.
- Validar maker/taker/network en ambos eventos.

Criterio de aceptacion:

- El comprador no puede enviar `fiat_sent` antes de funding suficiente.
- El vendedor no puede enviar `fiat_received` antes de `fiat_sent`.

### 2. Direccion de destino del comprador

Tareas:

- Pedir al comprador una direccion Bitcoin de recepcion en la red activa.
- Guardarla en `trade_json`.
- Publicarla o enviarla por DM segun convenga a la privacidad.
- Validar prefijo/red.

Decision a tomar:

- Si la direccion del comprador va en evento publico, arbitros pueden auditar mejor.
- Si va por DM, hay mas privacidad.

Recomendacion:

Empezar con DM y persistencia local. Publicar solo hashes o datos minimos si hace falta.

### 3. Construccion de transaccion de gasto

Tareas:

- Localizar UTXO exacto del funding (`txid`, `vout`, `value_sats`).
- Estimar fee.
- Construir gasto Taproot por hoja cooperativa:
  - Input: UTXO escrow.
  - Output: direccion del comprador.
  - Fee: descontada del importe.
- Calcular sighash Taproot correcto para la hoja cooperativa.

Notas:

- Esta parte debe probarse en signet/testnet antes de mainnet.
- Conviene implementar primero gasto cooperativo, luego arbitral y recovery.

Criterio de aceptacion:

- Ambos navegadores construyen el mismo `tx_hex`/sighash para los mismos datos.

### 4. Firma Schnorr BIP340

Tareas:

- Implementar `Onchain.Schnorr.sign`.
- Implementar `Onchain.Schnorr.verify`.
- Usar `trade_privkey`, no la clave Nostr.
- Verificar localmente la firma propia antes de enviarla.

Criterio de aceptacion:

- Firma valida contra la `trade_key_pub`.
- Firma invalida se rechaza.

### 5. Intercambio de firmas por DM

Tareas:

- Definir mensaje DM `coop_sign`.
- Campos sugeridos:
  - `type: "coop_sign"`
  - `trade_id`
  - `network`
  - `tx_hex` o identificador de propuesta
  - `sighash`
  - `signature`
  - `fee_sats`
- Validar que la firma corresponde al peer esperado.
- Persistir firma recibida en `trade_json` o memoria + BD si cabe.

Criterio de aceptacion:

- Cada parte puede recibir y verificar la firma de la otra.

### 6. Ensamblado y broadcast

Tareas:

- Ensamblar witness Taproot:
  - `buyer_sig`
  - `seller_sig`
  - `leaf_script`
  - `control_block`
- Hacer broadcast por:
  - RPC `sendrawtransaction`, o
  - mempool.space `/api/tx` de la red activa.
- Implementar `broadcast_tx` real en `ajax.php`.
- Manejar errores de mempool, fee insuficiente y tx conflictiva.

Criterio de aceptacion:

- Una transaccion cooperativa se propaga en signet/testnet.
- La UI muestra txid y estado de confirmaciones.

### 7. Evento `complete`

Tareas:

- Publicar kind `39385` con `action=complete`, `txid` y `network`.
- Validar que el txid gasta el UTXO escrow.
- Marcar `internal_status = completado`.
- Opcional: permitir rating despues de complete.

Criterio de aceptacion:

- Ambos lados cierran el trade al ver `complete` valido.

### 8. Disputa

Tareas:

- Implementar apertura de disputa.
- Definir que pruebas se comparten y como.
- Avisar arbitros seleccionados.
- Permitir firma arbitral hacia buyer o seller.
- Publicar resolucion arbitral.

Notas:

- El arbitro no debe poder mover fondos solo. Debe firmar junto con la parte ganadora segun la hoja Taproot.
- Hay turnos/CSV para arb1, arb2, arb3.

Criterio de aceptacion:

- Si una parte no coopera, un arbitro puede ayudar a gastar hacia la parte correcta en signet/testnet.

### 9. Recovery

Tareas:

- Implementar gasto unilateral del vendedor despues del CSV de recovery.
- Calcular secuencia y sighash adecuados.
- Mostrar contador/estado de disponibilidad.
- Evitar recovery antes de tiempo.

Criterio de aceptacion:

- Tras el timelock, el vendedor puede recuperar fondos si no hubo cooperacion ni arbitraje.

## Orden recomendado de implementacion

(Estado a 2026-05-29: pasos 1-16 hechos. Cooperativo validado en testnet. Disputa (partes + panel arbitro) y
recovery implementados pero sin probar end-to-end. Frontera = pruebas en testnet de disputa y recovery.)

NOTA dust (2026-05-29): la comision del arbitro se paga como output P2TR aparte, asi que debe ser >= 546 sats
(limite dust) o la TX es no estandar y no se difunde ("dust, tx with dust output must be 0-fee"). Arreglado:
`_computeArbFee` la eleva a >=546, los build* lanzan si arb_fee<546, y el registro exige fee_min>=546.
Implica un tamano minimo de trade on-chain (cantidades pequenas -> Lightning/Mostro).

1. [x] Maker validation en `accept`.
2. [x] Helpers robustos de `trade_json`.
3. [x] Selector global de red.
4. [x] Filtrado por red en orderbook y Mis trades.
5. [x] `verify_funding(network)`.
6. [x] `address_check` y `funding_commitment` con network + maker/taker estrictos.
7. [x] Vectores independientes Taproot.
8. [x] Estados `fiat_sent` / `fiat_received`.
9. [x] Direccion destino del comprador (`buyer_payout`).
10. [x] Construccion de gasto cooperativo (`Spend.buildCooperative`).
11. [x] Schnorr sign/verify (`Onchain.Schnorr`).
12. [x] DM `coop_sign` (+ ensamblado witness: `Spend.assembleCooperative`, `UI.startCoopSign`/`_receiveCoopSign`). Validado en testnet.
13. [x] Broadcast (`broadcast_tx` real en ajax.php + `MempoolApi::post`; `UI.broadcastCoop`).
14. [x] `complete` (`Trader.publishComplete` + `_handleCompleteEvent`).
15. [x] Disputa. Lado partes (openDispute/publishDispute + 39386 + dispute_request DM + handlers
       39386/39387/arb_signature + settleArbitration). Gasto arbitral `Spend.buildArbitration`/`assembleArbitration`
       + `debugArbSpend`/`debugArbPrivkey`. Panel del arbitro (fase B, 2026-05-29): `Arbitrators._handleDisputeRequest`
       guarda la solicitud (localStorage `nxoc_arb_disputes`, persiste tras recarga porque el DM ya visto no se
       re-despacha); `openDisputePanel`/`resolveDispute` derivan la privkey de arbitro (BIP86 idx 0), eligen el slot
       (`_myArbInfo`, menor CSV), construyen via trade sintetico (`_disputeToTrade`), firman, publican 39387
       (`_publishArbDecision`) y mandan `arb_signature` al ganador (`_sendArbSignature`). `seller_payout_address`:
       el panel la pide si gana el vendedor y la transmite en el DM (`winner_payout_address`); `settleArbitration`
       la persiste antes de reconstruir para que el sighash coincida. Entrada en el dialog de "Quiero ser arbitro".
       Pendiente: probar end-to-end en testnet.
16. [x] Recovery (2026-05-29). `Spend.buildRecovery`/`assembleRecovery` gastan la hoja 1 (single-sig vendedor,
       nSequence=4320 BIP68, sin comision de arbitro: el vendedor recupera el escrow entero menos fee de mineria).
       `UI.recoverFunds` comprueba el CSV en fresco con `tx_status` (el poll normal de funding se detiene a pocas
       confs), pide direccion de cobro del vendedor y fee, firma con `trade_privkey`, ensambla y difunde; reusa
       los campos coop_*/release_* + flag `recovery` para el poll de confirmaciones y el render terminal. Boton
       "Recuperar fondos" en la ficha del vendedor (fundingHtml + fiatPhaseHtml). Helper `debugRecoverySpend`.
       Pendiente: probar en testnet (requiere esperar 4320 confs del funding).   <- SIGUIENTE: pruebas testnet

## Pendientes antes de mainnet (consolidado 2026-06-01)

1. **Revertir TEST MODE de los CSV** en `Config` de `script.onchain.js`: `CSV_ARB2 6->288`, `CSV_ARB3 12->576`,
   `CSV_RECOVERY 36->4320`. Cambian la direccion Taproot; ambas partes y arbitros deben correr la misma version.
   Decision (2026-06-01): los timelocks quedan FIJOS para siempre tras mainnet; no se vuelven a tocar. El TEST MODE
   es un hack temporal solo para probar; una vez probada disputa/recovery se elimina o se comenta.
2. ~~**Persistir los CSV usados por trade**.~~ DESCARTADO (2026-06-01): solo haria falta si se cambiaran los CSV en
   mainnet, y la decision es congelarlos. Se mantiene TEST MODE hasta acabar pruebas y luego se quita; cada prueba
   en testnet es un trade nuevo (funding y gasto con los mismos CSV en la misma sesion), asi que no aplica.
3. **Payout address del comprador via xpub** (privacidad). DIFERIDO (2026-06-01): el input por trade funciona y es
   suficiente; la integracion con el modulo `_modules_/wallet` (que ya genera mnemonic+xpub con entropia y guarda
   `xpub`/`derivation_path`/`address_index`) se hace mas adelante. No bloqueante.
4. **Probar disputa y recovery end-to-end** en testnet (paso 15/16 del plan: implementados, sin probar). <- SIGUIENTE
5. ~~**Comision del arbitro en disputa ganada por el VENDEDOR**.~~ RESUELTO (2026-06-01): la comision la paga SIEMPRE
   el vendedor. `escrow = amount + arb_fee` (`_fundingTargetSats`); el output del ganador es `escrow - arb_fee - fee`
   y el arbitro cobra `arb_fee` gane quien gane (neutralidad: sin incentivo para favorecer a un lado). El comprador
   nunca toca la comision (`amount - fee`). En recovery el vendedor recupera todo. Ver NOSTR_ONCHAIN.md sec 10.
6. ~~**Ordenes de precio fijo no se retiran del libro al tomarse**.~~ HECHO (2026-06-01, JS 1.3.511): `acceptTake`
   retira la orden original (`_retireOrderEvent`) tanto en precio fijo como en rango; en rango sigue publicando la
   child con el resto. Ademas `getPendingTakeRequests` ignora solicitudes obsoletas de ordenes ya aceptadas/cerradas
   (evita el boton "N solicitudes" fantasma tras un take reentregado por el relay).
7. **Barrer comisiones de arbitro** (no bloqueante). La comision de arb1 (~546 sats/trade) se paga a un P2TR
   key-path derivado de la `pubkey_btc` del arbitro (BIP86 idx 0 del seed de escrow, `m/86'/0'/0'/0/0`). Hoy NO
   hay UI para gastarla: habria que construir un key-path spend (privkey idx 0 tweaked BIP341) hacia una direccion
   del arbitro. Irrelevante en auto-pruebas (el arbitro es el mismo usuario). Necesario cuando se opere como arbitro
   real cobrando a terceros. Util tambien: un helper que muestre la direccion `bc1p` del arbitro y su saldo.

## Riesgos principales

- Direccion Taproot mal calculada: riesgo maximo, fondos bloqueados o perdidos.
- Eventos Nostr falsos aceptados por falta de validacion de maker/taker.
- Mezcla de redes: funding o broadcast contra cadena equivocada.
- Reutilizar clave Nostr para Bitcoin: no debe hacerse.
- Construccion de sighash incorrecta: firmas aparentemente validas en UI pero transaccion invalida.
- Fee mal estimado: transaccion atascada o imposible de propagar.

## Regla practica antes de mainnet

No activar mainnet para usuarios reales hasta que se haya demostrado en signet/testnet:

- Crear orden.
- Tomar orden.
- Aceptar.
- Derivar misma direccion en ambos lados.
- Verificar direccion bilateralmente.
- Depositar funding.
- Detectar confirmaciones.
- Enviar fiat.
- Confirmar fiat recibido.
- Firmar ambos.
- Broadcast.
- Confirmar `complete`.
- Probar al menos un caso de error: amount mismatch o address mismatch.
