# NOSTR_ONCHAIN — Protocolo NostrEscrow

`version: 2.7` `status: draft` `target: noxtr.net`

Spec consolidada del protocolo on-chain (P2P de Bitcoin sobre Nostr, escrow Taproot 2-de-3 con árbitros) que implementa noxtr en `_modules_/noxtr/script.onchain.js`.

**Este es el documento canónico.** Los archivos en `_modules_/nostr_escrow/` (README.md, ARCHITECTURE.md, IMPLEMENTATION.md, ARBITRATORS.md, STATUS*.md) son material previo de diseño/implementación y pueden estar desactualizados. Ante discrepancia, gana este archivo y se corrige aquí.

**Versión pública en formato NIP:** `NIP-NOSTRESCROW.md` (inglés, solo el núcleo interoperable, destilado de este documento). Al cambiar el protocolo aquí, reflejar el cambio allí.

---

## 1. Resumen

Intercambio P2P **on-chain** de Bitcoin por fiat sobre Nostr. Sin custodio central, sin KYC, identidad sólo por clave Nostr. Fondos en multisig Taproot 2-de-3 con árbol de scripts para arbitraje en cascada y recovery por timelock. Resistencia a spam vía PoW NIP-13 + handshake selectivo.

Pensado para **complementar** a Mostro (que cubre Lightning), no reemplazarlo. Mismo cliente puede ofrecer ambos métodos. Rango de kinds `39xxx` específico de este protocolo, sin colisión con los `38xxx` de Mostro.

## 2. Convenciones

- MUST / MUST NOT / SHOULD / SHOULD NOT / MAY según RFC 2119.
- "Schnorr" = BIP340 sobre secp256k1, pubkeys x-only de 32 bytes.
- "Taproot" = BIP341 / BIP342, tap leaf version `0xc0`.
- Hex lowercase, sin prefijo `0x`. Timestamps en segundos UNIX. Importes BTC en sats enteros.

## 3. Identificadores

### 3.1 `order_id`

Lo elige libremente el creador de la orden. Recomendado UUIDv4 lowercase sin guiones, o `sha256(evento_pre_firma)[0:16]`. Es la `d` tag del kind 39383.

### 3.2 `trade_id`

Determinístico:

```
trade_id = lowercase(hex(sha256(order_id || ":" || taker_pubkey))[0:32])
```

Donde `taker_pubkey` es la clave pública Nostr (32B hex x-only) del taker. Ambas partes lo computan sin negociar.

### 3.3 `trade_index`

Contador entero monotónico por usuario, mantenido localmente. Se incrementa por cada trade nuevo iniciado o aceptado. Se usa como último componente de la derivación BIP86 (sección 4.2).

### 3.4 Formato de pubkeys

- En eventos Nostr y tags: hex x-only de 32 bytes lowercase.
- Pubkeys Bitcoin (taproot internal key, hoja leaves): hex x-only de 32 bytes, salvo que se indique comprimido (33B con prefijo `02`/`03`).

## 4. Arquitectura de claves

### 4.1 Dos raíces de clave separadas

| Material | Uso | Derivación |
|---|---|---|
| `nsec` | Firmar eventos Nostr y cifrar NIP-04/44 | Independiente (NIP-06 u otra) |
| `xprv` | Claves Bitcoin para escrow Taproot | BIP32 desde semilla BIP39 propia |

`nsec` MUST NOT firmar transacciones Bitcoin. Las claves Bitcoin MUST NOT firmar eventos Nostr. Reutilizar una para la otra compromete identidad y fondos simultáneamente.

En noxtr el `xprv` vive cifrado en IndexedDB (`NoxtrOnchainKeys/keys/escrow_xprv`), AES-GCM con clave derivada del `nsec` (si presente en memoria) o de una device-key aleatoria persistida en el propio IndexedDB. Nunca cruza al servidor.

### 4.2 Derivación de trade keys (BIP86)

Por cada trade se deriva una clave Bitcoin efímera:

```
m/86'/0'/0'/0/<trade_index>
```

La clave resultante se usa sólo para ese trade y NO debe reutilizarse.

### 4.3 Intercambio de trade pubkeys

Tras el handshake (sección 6), maker y taker intercambian su trade pubkey:

- El **maker** la incluye en el evento `accept` (kind 39385) como tag `["maker_trade_pubkey", "<64 hex x-only>"]`.
- El **taker** la envía en el DM `take_request` (NIP-04) inicial.

Ambas pubkeys quedan accesibles para reconstruir el contrato. En noxtr se persisten en `NSTR_TRADES.trade_json` (`maker_trade_pubkey` / `taker_trade_pubkey`) además del par `trade_key_pub` (propia) / `peer_pubkey` (contraparte).

## 5. Kinds de eventos

| Kind  | Nombre                   | Descripción                                          | PoW mínimo |
|-------|--------------------------|------------------------------------------------------|------------|
| 39383 | Order                    | Publicación de orden de compra/venta on-chain        | 16 bits    |
| 39384 | Rating                   | Calificación post-trade                              | 8 (opc.)   |
| 39385 | Trade State              | Estado del trade y acciones públicas                 | 12 bits    |
| 39386 | Dispute                  | Apertura de disputa                                  | 12 bits    |
| 39387 | Arbitration              | Decisión pública de árbitro                          | 12 bits    |
| 39388 | Arbitrator Advertisement | Auto-anuncio de árbitro disponible                   | 16 bits    |
| 39389 | Funding Commitment       | Confirmación on-chain del depósito en escrow         | 12 bits    |

**Tag obligatoria en todos los eventos del protocolo:**

```
["y", "nostrescrow"]
```

Los clientes filtran por `#y: ["nostrescrow"]`. Las kinds 39xxx están en el rango addressable de NIP-01.

## 6. Anti-spam

### 6.1 Proof of Work (NIP-13)

Cada evento del protocolo MUST incluir:

```
["nonce", "<n>", "<difficulty>"]
```

Con dificultad mínima de la tabla en sección 5. Los clientes MUST descartar eventos sin PoW válido.

### 6.2 Handshake selectivo (anti-griefing)

1. Maker publica orden pública (kind 39383). La orden permanece visible y NO queda bloqueada.
2. Taker envía DM privado (NIP-04) al maker con:

   ```json
   {
       "type":        "take_request",
       "order_id":    "<id>",
       "trade_pubkey": "<64 hex>",
       "trade_index":  <int>,
       "fiat_amount":  <int>
   }
   ```

3. Maker evalúa reputación del taker y decide.
4. Si acepta, maker publica `accept` (kind 39385) que reserva la orden y fija `trade_id`.
5. Sólo entonces empieza la fase on-chain.

La orden queda visible hasta el paso 4. Tomar y abandonar antes del paso 4 no afecta la disponibilidad de la orden.

## 7. Especificación de eventos

### 7.1 Order (kind 39383)

Replaceable parameterized event. La `d` tag MUST ser el `order_id`.

**Tags obligatorias:**

```
["d",            "<order_id>"]
["y",            "nostrescrow"]
["k",            "buy" | "sell"]
["amount",       "<sats>"]
["fiat_code",    "<EUR|USD|...>"]
["fiat_amount",  "<min>"]                 # importe fijo
["fiat_amount",  "<min>", "<max>"]        # rango
["nonce",        "<n>", "16"]
```

**Tags opcionales:**

```
["payment_method", "<métodos separados por coma>"]
["premium",        "<porcentaje>"]
["expires_at",     "<timestamp>"]
["arbitrators",    "<arb_pk_1>,<arb_pk_2>,<arb_pk_3>"]   # ver sección 9.2
["network",        "mainnet" | "testnet" | "signet"]    # default mainnet si ausente (órdenes legacy)
```

`content`: descripción libre del trade (opcional).

**Red (`network`):** congela la cadena Bitcoin de la orden. Los clientes filtran el orderbook por la red activa y NO permiten tomar una orden de otra red. La dirección Taproot usa HRP `bc` (mainnet) o `tb` (testnet/signet) — el witness program es idéntico entre redes; solo cambia el HRP del bech32m. **testnet y signet comparten HRP `tb` y por tanto producen la misma dirección con las mismas claves**: el único guardia entre ambas es la tag `network` + el backend correcto (mempool.space `/testnet/api` vs `/signet/api`), NO la dirección. Riesgo residual: no es criptográficamente forzable; un cliente que ignore `network` podría financiar en la tb-chain equivocada.

Si la tag `arbitrators` no está presente, las partes derivan determinísticamente el set (sección 9.2 modo c). En noxtr la tag `arbitrators` es obligatoria en la práctica: el dialog de creación exige 3 árbitros del pool publicado en kind 39388. Modo bootstrap: si sólo hay 1 árbitro disponible se expande a `[pk, pk, pk]` (mismo árbitro en los 3 slots Taproot).

### 7.2 Trade State (kind 39385)

Evento parametrizado reemplazable. Para no perder el historial al reemplazar estados,
la `d` tag MUST ser `<order_id>:<action>` y todos los eventos incluyen además la tag
estable `["order_id", "<order_id>"]`. En arbitraje se usa
`<order_id>:arbitration:<arb_index>` para conservar una decisión por turno.

**Tags obligatorias:**

```
["d",      "<order_id>:<action>"]
["order_id","<order_id>"]
["y",      "nostrescrow"]
["action", "accept" | "arbitrators" | "address_check" | "fiat_sent" | "fiat_received" | "buyer_payout" | "complete" | "cancel"]
["network","mainnet" | "testnet" | "signet"]   # red del trade (eventos post-accept)
["nonce",  "<n>", "12"]
```

**Tags adicionales por acción:**

| action          | tags adicionales                                                                       |
|-----------------|----------------------------------------------------------------------------------------|
| accept          | `["taker", "<pubkey>"]`, `["maker_trade_pubkey", "<64 hex>"]`, `["trade_id", "<id>"]`, `["arbitrators", "<pk1,pk2,pk3>"]`, `["sat_amount", "<sats>"]`, `["fiat_amount", "<importe concreto>"]` |
| arbitrators     | `["arbitrators", "<pk1,pk2,pk3>"]`, `["p", "<peer_pubkey>"]` (opcional pero recomendada) |
| address_check   | `["address", "<bech32m P2TR>"]`, `["p", "<peer_pubkey>"]` (opcional pero recomendada)   |
| fiat_sent       | (ninguna) — lo publica el comprador; lo procesa el vendedor                            |
| fiat_received   | (ninguna) — lo publica el vendedor; desbloquea la firma cooperativa                    |
| buyer_payout    | `["payout_address", "<dirección on-chain del comprador>"]` — lo publica el comprador; el vendedor la guarda para el gasto cooperativo |
| complete        | `["txid", "<64 hex>"]`                                                                 |
| cancel          | `["reason", "<texto>"]`                                                                |

Todos los eventos post-accept incluyen `["network", ...]` y, para validación de procedencia, `maker`/`taker`/`p` (el receptor descarta eventos cuya pubkey no sea la contraparte esperada). Los handlers buscan el trade mediante `order_id`; `trade_id` viaja como identidad determinista adicional del contrato.

`action=buyer_payout`: el comprador anuncia la dirección Bitcoin (en la red del trade) donde recibirá los BTC al liberar el escrow. El vendedor la persiste en su estado local; es un input necesario para construir la transacción de gasto cooperativo (sección 8.6). Se valida que el HRP corresponda a la red del trade.

Las tags `["sat_amount", ...]` y `["fiat_amount", ...]` del `accept` fijan el contrato monetario en el momento de la aceptación: si la orden era a precio fijo, el maker re-emite el mismo `sat_amount` que ya estaba en la `Order`; si era a precio de mercado (`amount=0` + `premium`), el maker computa `sats = (fiat / (rate * (1 + premium/100))) * 1e8` con el tipo de cambio vigente y lo congela aquí. La `fiat_amount` del accept es la **cantidad concreta** acordada (no el rango), tomada del `take_request` del taker. A partir de este evento las dos partes tratan ambos valores como inmutables; cualquier discrepancia más adelante es razón para abortar/disputar.

**Órdenes de rango — resto al aceptar (noxtr, 2026-06-01):** cuando el maker acepta una toma de una orden de rango `[min, max]`, en noxtr la fila local (`order_id`) se convierte en el trade. Por eso, al aceptar, el maker (a) **retira el evento de orden original del libro** (`_retireOrderEvent`: kind 5 NIP-09 + reemplazo kind 39383 con `expires_at=1`, sin borrar la fila local que ya es el trade) y (b) si queda resto `>= min`, **publica una orden nueva (otro `order_id`) con el rango `[min, max - tomado]`** reusando los datos del maker (modelo child-order de Mostro). Si el resto `< min`, solo se retira. Si la publicación del child falla (p. ej. escrow bloqueado), no se retira la original para no perder capacidad. Las órdenes de **precio fijo** no se retiran al tomarse (pendiente, ver ONCHAIN_PLAN.md).

`action=arbitrators` permite cambiar los 3 árbitros antes de generar la dirección Taproot. Una vez generada (existe `taproot_address`) o verificada (ver `address_check`), cambiar árbitros queda bloqueado porque alteraría el contrato.

`action=address_check` es la verificación bilateral de la dirección escrow derivada y reemplaza cualquier handshake previo sobre árbitros: como la dirección Taproot es función determinista de `(seller_trade_pubkey, buyer_trade_pubkey, arbitrators[3])`, si ambas partes derivan la misma dirección queda demostrado que acordaron también los mismos árbitros. Flujo:

1. Tras derivar la dirección localmente (sección 8.4), cada parte la publica con `action=address_check` y tag `["address", "<bc1p...>"]`.
2. Al recibir el evento del peer, el cliente compara la dirección del tag con la suya derivada localmente:
   - Si coinciden, marca el trade como verificado y, si aún no había publicado su propio `address_check`, lo emite a continuación para que el peer también pueda marcarse verificado.
   - Si no coinciden, notifica al usuario (la diferencia implica árbitros o trade pubkeys distintos) y NO marca verificado: las partes deben reconciliar (típicamente re-editando árbitros vía `action=arbitrators`) antes de fundear.
3. El vendedor SOLO debe broadcastear la transacción de funding cuando su cliente refleja "verificado". Cualquier mismatch antes del funding evita la pérdida de fondos.

Una vez verificada la dirección, las partes ya no deben emitir `action=arbitrators` ni re-derivar; cualquier intento se ignora con notificación al usuario.

### 7.3 Funding Commitment (kind 39389)

Lo emite el vendedor tras depositar los sats en la dirección Taproot.

```
["d",       "<order_id>:funding"]
["order_id","<order_id>"]
["y",       "nostrescrow"]
["txid",    "<64 hex>"]
["vout",    "<int>"]
["amount",  "<sats>"]
["address", "<bech32m P2TR>"]
["block",   "<altura del bloque que confirmó>"]   # opcional, se actualiza al confirmar
["nonce",   "<n>", "12"]
```

El comprador MUST esperar al menos 1 confirmación (recomendado 3) antes de iniciar el pago fiat. El comprador verifica:

1. La TX existe en mempool/blockchain.
2. El output `<vout>` paga `<amount>` a `<address>`.
3. `<address>` se computa correctamente desde las trade pubkeys e instrucciones del taptree (sección 8).

### 7.4 Dispute (kind 39386)

```
["d",         "<order_id>:dispute"]
["order_id",  "<order_id>"]
["y",         "nostrescrow"]
["reason",    "<texto>"]
["initiator", "buyer" | "seller"]
["nonce",     "<n>", "12"]
```

`content`: detalle y referencias a evidencias (URLs, hashes).

### 7.5 Arbitration (kind 39387)

```
["d",         "<order_id>:arbitration:<arb_index>"]
["order_id",  "<order_id>"]
["y",         "nostrescrow"]
["winner",    "seller" | "buyer"]
["arb_index", "1" | "2" | "3"]
["nonce",     "<n>", "12"]
```

`content`: justificación pública de la decisión.

Adicionalmente, el árbitro MUST enviar al ganador un DM (NIP-04) con su firma Schnorr sobre la PSBT de gasto vía la hoja correspondiente (sección 8.7). Sin ese DM, el evento público es sólo declarativo.

### 7.6 Rating (kind 39384)

Evento parametrizado reemplazable. La `d` tag MUST ser
`<order_id>:<pubkey_calificada>` y la tag estable `order_id` identifica el trade.

```
["d",      "<order_id>:<pubkey_calificada>"]
["order_id","<order_id>"]
["y",      "nostrescrow"]
["p",      "<pubkey calificada>"]
["rating", "positive" | "neutral" | "negative"]
["role",   "buyer" | "seller" | "arbitrator"]
["amount", "<sats>"]
["nonce",  "<n>", "8"]                # opcional
```

### 7.7 Arbitrator Advertisement (kind 39388)

Replaceable parameterized event. Anuncia un árbitro disponible. El "tier" se determina por las tags presentes.

**Tags obligatorias:**

```
["d",          "<pubkey_btc>"]                  # mismo valor que pubkey_btc
["y",          "nostrescrow"]
["pubkey_btc", "<64 hex x-only>"]                # clave Bitcoin del árbitro
["tier",       "site_admin" | "regular" | "professional"]   # site_admin = admin de la web (arb1 por defecto)
["status",     "active" | "unavailable"]         # los unavailable quedan fuera del selector
["max_amount", "<sats>"]                         # trades hasta este importe
["nonce",      "<n>", "16"]
```

**Tags de comisión** (sección 10):

```
["fee_min_sats", "<sats>"]                       # comisión mínima plana
["fee_rate",     "<porcentaje>"]                 # comisión variable sobre amount
```

**Tags opcionales según tier:**

```
# tier "professional" (con bond on-chain):
["bond_txid",    "<64 hex>"]
["bond_vout",    "<int>"]
["bond_amount",  "<sats>"]

# badge ⚡Mostro (NO es un tier; marca que el árbitro opera una instancia Mostro):
["mostro_admin", "<robot_pubkey_nostr_64_hex>"]

# Comunes:
["languages",    "es,en,..."]                    # ISO 639-1
```

`content`: bio o términos del árbitro.

**Determinación del tier:**

| Condición | Tier | Anclaje de confianza |
|---|---|---|
| Clave configurada como árbitro del sitio (admin web) | `site_admin` | Operador del sitio (arb1 por defecto) |
| `bond_txid`+`bond_vout`+`bond_amount` (verificados on-chain) | `professional` | Económico (slashable) |
| Ninguna de las anteriores | `regular` | Social (elección manual) |

**`mostro_admin` ya NO es un tier** (cambio 2026-06-03): es un **badge** independiente. Cualquier árbitro `regular` o `professional` que opere una instancia Mostro publica el tag `["mostro_admin", "<robot_pubkey>"]` y la UI le muestra un badge ⚡Mostro, pero su tier y su prioridad de selección no cambian. El admin de Mostro deja de ser arb1 por defecto: ahora ese papel es del `site_admin` (admin de la web).

En noxtr el alta/gestión de árbitro vive en el **editor de perfil Nostr** (botón "Árbitro on-chain"), no en el dialog de crear oferta. El dialog de crear oferta sólo selecciona del pool ya publicado.

Para pausar disponibilidad sin borrar el anuncio, se republica el kind 39388 con `status=unavailable`. Para dejar de ser árbitro definitivamente, se publica kind 5 NIP-09 sobre el anuncio.

## 8. Settlement on-chain (Taproot)

### 8.1 Internal key (NUMS point)

Este protocolo NO usa key-path spending. La internal key es un punto NUMS sin clave privada conocida, garantizando que todo gasto pase por script-path:

```
internal_key = lift_x(0x50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0)
```

NUMS point recomendado por BIP341. Cualquier implementación MUST usar exactamente este valor.

Implica que ningún spend (cooperativo, disputa o recovery) aprovecha key-path. Todo va por script-path. Renuncia consciente a la privacidad on-chain del key-path a cambio de simplicidad criptográfica: las direcciones y txids ya son públicos en kinds 39389/39387, así que el beneficio de privacidad sería marginal.

### 8.2 Taproot script tree (8 hojas)

| # | Hoja           | CSV (bloques) | Spendable por                |
|---|----------------|---------------|------------------------------|
| 1 | cooperative    | 0             | seller + buyer (2-of-2)      |
| 2 | recovery       | 4320 (~30d)   | seller solo                  |
| 3 | arb1 → seller  | 0             | árbitro 1 + seller           |
| 4 | arb1 → buyer   | 0             | árbitro 1 + buyer            |
| 5 | arb2 → seller  | 288 (~48h)    | árbitro 2 + seller           |
| 6 | arb2 → buyer   | 288 (~48h)    | árbitro 2 + buyer            |
| 7 | arb3 → seller  | 576 (~96h)    | árbitro 3 + seller           |
| 8 | arb3 → buyer   | 576 (~96h)    | árbitro 3 + buyer            |

El árbol se construye balanceado (3 niveles) con la convención BIP341: orden lexicográfico de los hashes de las hojas en cada par antes de combinarlos con `tagged_hash("TapBranch", left || right)`.

### 8.3 Scripts de cada hoja

**Cooperative (hoja 1):**

```
<seller_pubkey> OP_CHECKSIGVERIFY
<buyer_pubkey>  OP_CHECKSIG
```

Cada parte firma su Schnorr independiente. Witness final:

```
[<buyer_sig>, <seller_sig>, <leaf_script>, <control_block>]
```

(Stack se evalúa abajo-arriba: `seller_sig` consume `CHECKSIGVERIFY`, luego `buyer_sig` consume `CHECKSIG`.)

**Recovery (hoja 2):**

```
<4320> OP_CHECKSEQUENCEVERIFY OP_DROP
<seller_pubkey> OP_CHECKSIG
```

**Arbitraje (hojas 3-8)** — patrón parametrizado por `<csv>`, `<arb_pubkey>` y `<winner_pubkey>`:

```
<csv> OP_CHECKSEQUENCEVERIFY OP_DROP
<arb_pubkey>    OP_CHECKSIGVERIFY
<winner_pubkey> OP_CHECKSIG
```

Las hojas con `csv = 0` omiten las dos primeras instrucciones (no hay timelock relativo).

### 8.4 Derivación de la dirección (algoritmo determinista)

Ambas partes ejecutan idéntico procedimiento:

1. `internal_key` = NUMS point (sección 8.1).
2. Resolver set de árbitros (sección 9.2) → `[arb1_pk, arb2_pk, arb3_pk]`.
3. Construir las 8 hojas según 8.3 con los CSV de 8.2, usando las trade pubkeys del seller y buyer.
4. Computar `tap_merkle_root` (BIP341) sobre las 8 hojas balanceadas.
5. Output key tweaked: `Q = internal_key + H_tapTweak(internal_key || tap_merkle_root) * G`.
6. Codificar como bech32m mainnet con witness version 1: dirección P2TR (`bc1p...`).

Tras computarla, ambas partes intercambian la dirección por DM y verifican coincidencia byte a byte. Si difieren, abortar.

Implementación en noxtr:

```js
await Onchain.Taproot.buildAddress(sellerTradePubkey, buyerTradePubkey, [arb1, arb2, arb3]);
await Onchain.Taproot.buildDetails(...);   // devuelve {address, output_key, merkle_root, internal_key, leaves[8]}
await Onchain.Taproot.verifyAddress(serverResponse, sellerPk, buyerPk, arbs);
```

### 8.5 Funding y verificación

1. Vendedor construye y firma una TX que paga `amount` a la dirección computada.
2. Vendedor publica kind 39389 con `txid`, `vout`, `address`, `amount`.
3. Comprador, al recibir el evento:
   - Verifica TX en mempool/blockchain.
   - Verifica que el output indicado paga el importe correcto a la dirección esperada.
   - Espera N confirmaciones (default por importe: 1 hasta 100k sats, 3 hasta 1M, 6 por encima).
4. Tras N confirmaciones, comprador inicia pago fiat.

### 8.6 Gasto cooperativo (script path)

Tras `fiat_received`, ambas partes intercambian firmas Schnorr independientes vía DM cifrado.

**Mensaje único por parte:**

```json
{
    "type":     "coop_sign",
    "trade_id": "<32 hex>",
    "tx_hex":   "<unsigned tx hex>",
    "fee_sats": <int>,
    "sig":      "<128 hex>"
}
```

`tx_hex` es la transacción sin testigos: gasta el UTXO escrow `(funding_txid, vout)` (valor `amount + arb_fee`) con dos salidas: `output 1` paga `escrow - arb_fee - fee` (= `amount - fee`) a la dirección destino del comprador; `output 2` paga `arb_fee` al P2TR key-path de `arb1` (sección 10.1). Si `arb_fee = 0`, se omite `output 2`. El `fee` de minero sale del output del comprador. Ambas partes MUST acordar `tx_hex` antes de firmar; si una recibe un `tx_hex` distinto, abortar. En noxtr esto lo construye `Spend.buildCooperative(trade, feeSats)`.

Cada parte:

1. Construye `tx_hex` independientemente con los mismos parámetros.
2. Computa sighash de la hoja cooperativa (BIP341: `tap_leaf_hash` sobre script hoja 1, sighash mode `SIGHASH_DEFAULT`).
3. Firma con su trade privkey usando Schnorr (BIP340).
4. Envía `coop_sign` por DM.

Cuando ambas partes tienen la firma de la otra, cualquiera ensambla:

```
[<buyer_sig>, <seller_sig>, <cooperative_leaf_script>, <control_block_for_leaf_1>]
```

y hace broadcast. Tras broadcast, vendedor publica `complete` (kind 39385 action=complete) con la `txid` para cerrar el flujo.

A diferencia de MuSig2, aquí no hay rondas de nonces ni firmas parciales: cada parte produce una firma Schnorr completa e independiente sobre el mismo sighash. Si la firma de la contraparte no verifica, abortar.

**Implementación en noxtr (paso 12-14, hecho; happy path validado en testnet3 el 2026-06-01):** el comprador inicia con `UI.startCoopSign` (propone fee, firma, envía `coop_sign`); `UI._receiveCoopSign` (dispatch en `Trader._initDmHandler`) valida procedencia, reconstruye `buildCooperative` con el mismo fee, exige `tx_hex` idéntico, verifica la firma del peer, firma la propia y `Spend.assembleCooperative` produce la TX segwit final. El vendedor devuelve su firma; el comprador no responde (evita bucle). El fee se congela en `trade_json.coop_fee_sats`; la TX firmada en `trade_json.coop_signed_tx`. El broadcast (`UI.broadcastCoop` -> `broadcast_tx` real en `ajax.php`: RPC `sendrawtransaction` si `rpc_network` coincide, si no `MempoolApi::post`) está hecho.

**Confirmación antes de cerrar (fix 2026-06-01):** difundir != completado. El trade SOLO pasa a `completado` (terminal) cuando la TX de liberación tiene **>= 1 confirmación on-chain** (`UI._refreshReleaseTx`, poll cada 30s). Entre broadcast y confirmación el estado es no terminal y la ficha muestra "Liberación enviada, esperando confirmación". Si la TX desaparece de la red sin confirmar (~6 polls ≈ 3 min: mempool inestable, fee baja, RBF), el trade se reabre (`release_dropped`) y reaparece el botón Difundir para reintentar con la misma TX firmada. `_handleCompleteEvent` (recibir `complete` del peer) tampoco marca completado a ciegas: guarda el txid y lo verifica en cadena. Mismo gating en recovery y arbitraje. Motivo: antes se marcaba completado al ser aceptada por el mempool (0 conf), y si la TX se caía el escrow quedaba intacto con el trade "completado" — peligroso en mainnet.

### 8.7 Gasto en disputa (script path)

1. La parte agraviada publica kind 39386 (Dispute).
2. El árbitro en turno (sección 9.3) revisa, decide y publica kind 39387.
3. Adicionalmente, el árbitro envía al ganador (vía DM kind 4 NIP-04) la firma sobre una TX que gasta vía la hoja correspondiente. Formato real que consume `Trader._handleArbSignatureDm`:

   ```json
   {
       "type":                  "arb_signature",
       "order_id":              "<order_id>",
       "trade_id":              "<32 hex>",
       "network":               "signet",
       "arb_index":             1,
       "winner_side":           "buyer" | "seller",
       "fee_sats":              <fee de minería>,
       "tx_hex":                "<unsigned tx hex>",
       "arb_sig":               "<128 hex>",
       "winner_payout_address": "<dir. del ganador, solo necesaria si gana el vendedor>"
   }
   ```

   `arb_index` indica el slot (1/2/3) cuya pubkey de árbitro coincide con la mía; el ganador verifica `arb_sig` contra `arbitrators[arb_index-1]`. `fee_sats` es la fee de minería que el árbitro fijó al construir la TX: el ganador reconstruye con el mismo valor para obtener idéntico `tx_hex`/sighash. `winner_payout_address` resuelve el caso "gana el vendedor" (su cliente no tenía `seller_payout_address`): `settleArbitration` la persiste antes de reconstruir.

4. El ganador firma su parte sobre el mismo sighash, ensambla el witness con el control block de la hoja correspondiente y hace broadcast.

Witness para una hoja de arbitraje:

```
[<winner_sig>, <arb_sig>, <leaf_script>, <control_block>]
```

### 8.8 Recovery

Si pasados 4320 bloques desde la confirmación del funding ningún árbitro resuelve, el vendedor puede gastar vía la hoja 2 (índice 1 en el taptree, single-sig con CSV 4320):

```
witness = [<seller_sig>, <recovery_script>, <control_block_for_leaf_2>]
```

**Implementación en noxtr (paso 16, hecho 2026-05-29):** `Spend.buildRecovery(trade, feeSats)` arma la TX con `nSequence = 4320` (BIP68, relative-locktime en bloques) y un único output al `seller_payout_address` = escrow completo − fee de minería (sin comisión de árbitro: la red de arbitraje no actuó). `Spend.assembleRecovery` produce el witness `[seller_sig, leaf_script, control_block]`. `UI.recoverFunds` comprueba en fresco con `tx_status` que el funding tenga ≥ 4320 confirmaciones (el poll normal de funding se detiene a pocas confs), pide la dirección de cobro del vendedor y la fee, firma con `trade_privkey`, ensambla y difunde. Reusa los campos `coop_*`/`release_*` + flag `recovery` para el poll de confirmaciones y el render terminal. Botón "Recuperar fondos" en la ficha del vendedor. Helper de consola `debugRecoverySpend`. El nodo rechaza el broadcast (`non-BIP68-final`) hasta que se cumple el CSV, lo que a su vez confirma que el timelock se enforce on-chain.

### 8.9 Fees on-chain

El fee del gasto cooperativo se acuerda en `fee_sats` del mensaje `coop_sign`. La parte que más se beneficia (comprador, recibe los sats) MUST ofrecer un fee razonable acorde a mempool. Si propone fee insuficiente, el vendedor puede rechazar y forzar disputa.

En spends por script path (arbitraje o recovery), el fee lo paga quien construye la TX (ganador o vendedor en recovery).

Si la TX queda atrapada por subida de mempool, las partes pueden re-firmar con fee actualizado: cada parte vuelve a generar `coop_sign` con nuevo `tx_hex` y `fee_sats`. Las firmas viejas no son reusables (Schnorr es sobre el sighash, no hay malleabilidad).

## 9. Arbitraje

### 9.1 Tiers de árbitros

Tres tiers, diferenciados por anclaje de confianza. Maker y taker pueden mezclarlos libremente en los 3 slots del taptree:

| Tier | Anclaje | Bond | Auto-selección | Uso típico |
|---|---|---|---|---|
| `site_admin` | Operador del sitio (admin web) | No | **arb1 por defecto** (clave configurada) | Default en toda orden on-chain de la instancia |
| `professional` | Económico (bond on-chain slashable) | Sí | Sí (deterministic hash) | Trades anónimos |
| `regular` | Social (amigos, conocidos) | No | No (sólo elección manual) | Trades entre partes con contexto compartido |

**Badge `⚡Mostro`** (no es tier): un árbitro `regular`/`professional` que opera una instancia Mostro publica `["mostro_admin", "<robot_pubkey>"]` y se muestra con badge. No cambia su tier ni su prioridad. (El admin de Mostro ya NO es arb1 por defecto; ese papel es del `site_admin`.)

### 9.2 Selección de árbitros

Tres modos, en orden de prioridad:

**(a) Override explícito por la orden.** Si el kind 39383 incluye `["arbitrators", "<arb1_pk>,<arb2_pk>,<arb3_pk>"]`, ese set se usa tal cual. Pueden ser de cualquier tier (incluso `regular`). El taker MAY rechazar la orden si no reconoce alguna pubkey propuesta. Es el modo primario para tier `regular`.

**(b) Default del sitio (admin de la web).** La instancia configura la pubkey_btc de su admin (CFG `modules.noxtr.onchain_site_arbitrator`), que se siembra en el pool con tier `site_admin` y se pre-rellena como `arb1` en toda orden on-chain. Transitividad natural: si el usuario ya confía en el operador del sitio que usa, confía en él como árbitro de referencia. `arb2` y `arb3` se rellenan con modo (c). (Antes este papel lo ocupaba el admin de Mostro vía tier `mostro_admin`; desde 2026-06-03 es el `site_admin`, y los admins de Mostro son árbitros `regular`/`professional` con badge ⚡Mostro.)

**(c) Selección determinista del pool profesional.** Si no aplica (a) ni (b), ambas partes computan el set filtrando **solo tier `professional`**:

1. Suscribirse a kind 39388 con `#y: ["nostrescrow"]` y obtener árbitros activos (`status=active`).
2. Filtrar por:
   - Tier `professional`: bond confirmado on-chain.
   - `max_amount >= amount` del trade.
   - Idiomas compatibles (opcional).
   - Reputación mínima (configurable; sugerido ≥5 trades resueltos sin revocación).
3. Ordenar por `sha256(arbitrator_pubkey || trade_id)` (lexicográfico ascendente).
4. Tomar los 3 primeros como `[arb1, arb2, arb3]`.

La auto-selección (hash determinista) cubre solo `professional`. El `site_admin` no se auto-selecciona: se pre-rellena como arb1 por configuración. `regular` requiere elección manual.

Si hay menos de 3 árbitros `professional` elegibles, ambas partes MUST acordar manualmente vía DM o usar modo (a). Sin 3 árbitros, la orden on-chain no puede crearse.

**Modo bootstrap (noxtr):** si el pool sólo tiene 1 árbitro, noxtr lo expande a `[pk, pk, pk]` (el mismo en los 3 slots Taproot). Mantiene el taptree de 3 slots sin prometer cascada real. Aceptado por maker y taker explícitamente.

En todos los modos, ambas partes MUST verificar que cada arbitrator pubkey tiene un kind 39388 vigente y, si tier `professional`, bond confirmado on-chain.

### 9.3 Cascada temporal

| Turno    | Ventana Nostr | CSV on-chain  |
|----------|---------------|---------------|
| arb1     | 0–48h         | 0             |
| arb2     | 48–96h        | 288 bloques   |
| arb3     | 96–144h       | 576 bloques   |
| recovery | 30 días       | 4320 bloques  |

La cascada Nostr es la fuente de verdad. Los CSV on-chain son fallback: garantizan que ningún árbitro pueda firmar antes de su turno **si la disputa se abre en los primeros días tras el funding**. Si la disputa se abre tarde (ej. día 10), los CSV de arb2 y arb3 ya estarán cumplidos, y la cascada se enforce solo a nivel Nostr (los honestos respetan turnos; los deshonestos pueden front-run pero su decisión queda registrada en `arb_index` del kind 39387 y daña reputación / bond).

### 9.4 Bond y slashing (sólo tier `professional`)

EXCLUSIVAMENTE para tier `professional`. Los tiers `site_admin` y `regular` no tienen bond y por tanto no son slashable on-chain (su sanción es reputacional).

El árbitro `professional` deposita un bond en una dirección Taproot con dos rutas:

**Recovery:** árbitro recupera tras 4320 bloques sin actividad pendiente.

**Slashing (script path):** consenso 3-of-5 de árbitros senior firma la confiscación. Patrón Taproot-nativo:

```
<senior1_pk> OP_CHECKSIG
<senior2_pk> OP_CHECKSIGADD
<senior3_pk> OP_CHECKSIGADD
<senior4_pk> OP_CHECKSIGADD
<senior5_pk> OP_CHECKSIGADD
<3> OP_NUMEQUAL
```

El bond garantiza que la confiscación nunca es unilateral.

**Limitación de la implementación actual:** noxtr todavía no puede verificar este
script de bond en cadena. Por seguridad, una autodeclaración `professional` se conserva
como dato anunciado pero se trata como `regular`: no obtiene privilegios de confianza
ni de selección automática hasta implementar la verificación real.

## 10. Comisión del árbitro (Variant C)

**Decisión vigente:** en cierre cooperativo cobra `arb1`; en disputa cobra el árbitro
que realmente resuelve (`arb1`, `arb2` o `arb3`). **La comisión la paga íntegramente
el VENDEDOR** (el que aporta los BTC), no se reparte. Todo on-chain, nunca tocando el
importe fiat.

Modelo:

```
Funding TX (la deposita el vendedor):
  → amount + arb_fee → escrow Taproot      # el vendedor prefondea la comision completa

Spend cooperativo / disputa gana COMPRADOR:
  output 1: buyer  (amount - miner_fee)    # recibe el amount limpio; no toca la comision
  output 2: arb1   (arb_fee)               # cierre cooperativo

Disputa gana VENDEDOR:
  output 1: seller (amount - miner_fee)    # recupera su amount; pierde la comision prefondeada
  output 2: árbitro que resolvió (arb_fee)  # MISMO importe gane quien gane

Recovery (vendedor solo, CSV 4320):
  output 1: seller (amount + arb_fee - miner_fee)   # recupera todo el escrow; nadie cobra comision
```

**Por qué el vendedor paga toda la comisión (y no se reparte 50/50):**

1. **Neutralidad del árbitro (la razón de peso).** El árbitro que interviene cobra siempre `arb_fee`, gane quien gane (`output del ganador = escrow - arb_fee - miner_fee`). **No tiene incentivo económico para inclinarse hacia un lado.** Un reparto que dejara al árbitro cobrando menos cuando gana el vendedor le daría motivo para favorecer al comprador; este modelo lo elimina de raíz.
2. **Más simple de código:** desaparece el split, el `ceil/floor`, el sat impar y la asimetría cooperativo/disputa. El output del comprador es siempre `amount - miner_fee`, el del árbitro siempre `arb_fee`. Una sola fórmula.
3. **Modelo de negocio:** el comprador no toca nunca la comisión (menos fricción, fomenta compras) y el vendedor, que por definición ya tiene los BTC, la asume como coste de operar.

**Eje = comprador/vendedor, no maker/taker.** Solo el vendedor fondea y solo el comprador recibe payout, así que la regla sale por rol BTC/fiat con independencia de quién fuera maker o taker.

**Coste asumido conscientemente:** un vendedor honesto que GANA una disputa contra un comprador griefer igualmente paga la comisión. Es aceptable porque (a) la comisión es simbólica (`fee_min_sats=200` + `fee_rate=0.2%`), y (b) el griefer no gana nada (pierde la disputa, no se lleva BTC) y carga con la fricción, así que griefar solo para que el vendedor pague unos sats no es racional.

**Fee de minero:** lo paga quien recibe el payout (coste de red de su retirada). No se prefondea: se fija en `coop_sign` (después del funding).

Justificación:

- `arb1` es el árbitro de referencia elegido al crear la orden (típicamente admin Mostro de la instancia).
- Cobra siempre que el sistema funcione (cooperativo o disputa), pagado por el vendedor.
- En recovery (30 días sin que ningún árbitro actúe), el vendedor recupera todo el escrow (incluida la comisión que prefondeó) y nadie cobra: el trade falló y **el árbitro no prestó servicio**.
- Comisión simbólica: ingreso pasivo para árbitros disponibles, coste minúsculo.

**La comisión es un "seguro": el árbitro cobra siempre que presta servicio** (gasto cooperativo y resolución de disputa, gane quien gane). Recovery es la única salida sin comisión, y por dos razones que coinciden:

1. **Inforzable on-chain.** La hoja de recovery (sección 8.8) es un gasto unilateral del vendedor (`witness = [seller_sig, recovery_script, control_block]`, solo su firma tras el CSV de 4320 bloques). Sin covenants no se puede obligar al vendedor a incluir un output para el árbitro; haría recovery con una sola salida hacia sí mismo. Y no puede exigir la firma del árbitro, porque entonces unos fondos quedarían bloqueados para siempre si el árbitro desaparece (que es justo el supuesto del recovery).
2. **No hubo servicio.** Llegar al recovery significa que los 3 árbitros ignoraron la disputa 30 días. No cobran porque no trabajaron, no porque "trabajen gratis".

**Disputar NO evita la comisión** (anti-griefing): el árbitro cobra al *resolver* la disputa, no al abrirla. El único camino sin comisión es el recovery completo de 30 días, que exige que los 3 árbitros ghosteen y no le da nada al que la abrió (no se lleva los BTC salvo que el árbitro le dé la razón o haya cooperación). Bloquear fondos 30 días sin ganar nada para ahorrar la comisión no es un ataque racional.

Si en la disputa actuó `arb2` o `arb3`, la redistribución entre árbitros queda **fuera de protocolo**: es reputacional/social entre ellos.

En modo bootstrap (un único árbitro expandido a `[pk, pk, pk]`), ese árbitro es también `arb1` y cobra siempre que no haya recovery.

### 10.1 Dirección de cobro de la comisión

El árbitro NO proporciona una address aparte. El `output 2` (comisión) paga a un P2TR **key-path** derivado de la `pubkey_btc` que el árbitro ya publica en su anuncio kind 39388:

```
fee_output_spk = OP_1 || taproot_tweak(arb1_pubkey_btc)
```

Donde `taproot_tweak(P) = P + H_tapTweak(P) * G` (BIP341, sin script tree). La address resultante es `bc1p...` (o `tb1p...` en testnet/signet).

- El árbitro controla esa salida con la misma clave (`arb1_pubkey_btc`, derivada por BIP86 de su xprv escrow) y la gasta key-path con su privkey tweaked.
- Es determinista y auditable: ambas partes la computan desde el 39388, sin negociar ni intercambiar nada.
- La `pubkey_btc` ya se valida al seleccionar árbitros, así que no añade superficie de confianza nueva.

Opcional futuro: tag `["fee_address", "<bc1...>"]` en el kind 39388 para cobrar en una wallet distinta de la clave escrow. Default = derivar de `pubkey_btc`. No requerido para el MVP.

El importe de la comisión se computa al aceptar la orden: `arb_fee = max(fee_min_sats, round(amount * fee_rate / 100))`, leídos del kind 39388 de `arb1`. **Mínimo dust:** como la comisión se paga como un output P2TR aparte, `arb_fee` (si > 0) se eleva a **≥ 546 sats** (`_DUST_SATS`, límite dust universal); por debajo, la TX sería no estándar y los nodos no la propagan (`dust, tx with dust output must be 0-fee`). El diálogo de registro de árbitro exige `fee_min_sats ≥ 546`. Esto implica un **tamaño mínimo viable de trade on-chain**: el escrow debe cubrir el output del comprador (≥546) + la comisión (≥546) + el fee de minero, así que las cantidades muy pequeñas deben ir por Lightning (Mostro), no on-chain. El maker lo congela en el `accept` (tag `["arb_fee", "<sats>"]`) y ambas partes lo persisten en `trade_json.arb_fee_sats`. El funding que deposita el vendedor debe cubrir `amount + arb_fee` (la comisión completa); `verify_funding` hace match exacto contra ese target. En noxtr el cálculo vive en `_fundingTargetSats(trade)` (`script.onchain.js`), reusado por la verificación on-chain, el `amount` del kind 39389 y el texto de "cantidad a depositar".

## 11. Reputación

### 11.1 Fuentes

- Kind 39384 (Rating) emitidos por contrapartes verificadas (que aparezcan como taker/maker en un kind 39385 `complete`).
- Kind 39387 emitidos por el calificado actuando como árbitro.
- Cancelaciones y disputas en kind 39385/39386 referenciadas a la pubkey.

### 11.2 Cómputo

Cada cliente computa reputación localmente. Recomendado:

- Score base = `(positive - 2 * negative) / max(1, total_ratings)`.
- Penalización por disputas iniciadas sin resolución a favor: -5 por cada una.
- Bonificación por antigüedad: `log(días_activos)`.

### 11.3 Resistencia a Sybil

Pubkeys nuevas con reputación 0 SHOULD verse con desconfianza. Roles críticos (árbitros) requieren bond on-chain verificable, lo que ata reputación a coste económico real.

### 11.4 Implementación en noxtr (reputación de trader)

`Onchain.Reputation` (`script.onchain.js`) computa la reputación del maker de cada oferta on-chain:

- **Verificación "ligera" (orderbook):** una valoración (kind 39384, `role=trader`, `#p=maker`) solo cuenta si **tanto el valorado (`maker`) como el valorador han FIRMADO algún evento 39385** de ese `order_id` (cualquier acción: `address_check`, `fiat_sent`, `fiat_received`, `buyer_payout`, `complete`, `accept`). Que ambos hayan firmado un evento de la orden es prueba criptográfica de que fueron las dos contrapartes reales; es más fuerte que mirar el tag `taker` del `accept` (un claim) y además robusto a que el `accept` no sobreviva en los relays (caso real visto en testnet: el `accept` desaparece pero `address_check`/`fiat_*`/`complete` siguen). Una valoración de un tercero, o sobre una orden de la que no se recupera ningún 39385 firmado por ambos, se ignora. Se cuenta una por `(order_id, valorador)`. Se muestra "★ media (N)" en la oferta, con relleno asíncrono cacheado.
- **Dato del trade en la valoración:** el 39384 lleva `funding_txid` (además de `order_id` y `trade_id`) para poder auditar contra la cadena.
- **Auditoría detallada (`openAudit`, click en el badge):** resumen (media, nº, primera/última, antigüedad) + señales heurísticas de perfil sospechoso (una contraparte concentra las valoraciones, ráfagas temporales, importes mínimos cercanos a dust, muchas valoraciones en pocos días) + tabla de cada valoración (contraparte, fecha, importe, orden, link al funding).
- **Pendiente (auditoría estricta):** verificar on-chain que el `funding_txid` existe y pagó la dirección escrow derivada de las trade keys del trade. Hoy la auditoría cruza eventos públicos pero no consulta la cadena. El límite conocido: el auto-trading entre dos identidades propias no se bloquea del todo, solo se encarece a trades on-chain reales (mismo modelo "caro, no imposible" que el bond del árbitro).

## 12. Flujos de referencia

### 12.1 Happy path

```
 1. Maker  → relays:  kind 39383 (order, PoW 16)
 2. Taker  → maker:   DM take_request + trade_pubkey (NIP-04)
 3. Maker  → relays:  kind 39385 action=accept (con maker_trade_pubkey y arbitrators)
 3b. (Opcional) Cualquiera → relays: kind 39385 action=arbitrators para cambiar el set
 4. Ambos  computan dirección Taproot independientemente (sección 8.4)
 5. Ambos  → relays:  kind 39385 action=address_check con la dirección derivada; cada cliente compara
                      con la suya y marca verificado si coincide. Mismatch → abortar.
 6. Seller construye y broadcastea funding TX
 7. Seller → relays:  kind 39389 (funding commitment)
 8. Buyer  espera N confirmaciones, verifica
 9. Buyer  envía fiat off-chain
10. Buyer  → relays:  kind 39385 action=fiat_sent
11. Seller recibe fiat
12. Seller → relays:  kind 39385 action=fiat_received
13. Ambos  acuerdan tx_hex (gasto cooperativo, fee_sats negociado)
14. Cada uno firma Schnorr sobre el sighash y envía coop_sign por DM
15. Cualquiera ensambla witness [buyer_sig, seller_sig, leaf, control_block] y broadcastea
16. Seller → relays:  kind 39385 action=complete (con txid)
17. Ambos  → relays:  kind 39384 (rating)
```

### 12.2 Dispute path

```
1-9   igual que happy path
10.   Buyer reclama no haber recibido sats correctos / Seller reclama no haber recibido fiat
11.   Cualquiera → relays: kind 39386 (dispute)
12.   arb1 evalúa en 0–48h
      Caso A: arb1 decide → kind 39387 + DM arb_signature al ganador
              Ganador firma y broadcastea script-path spend (hoja 3 o 4)
      Caso B: arb1 no responde en 48h → arb2 toma turno
              On-chain: arb2 puede firmar a partir de bloque funding+288
13.   Análogo para arb3
14.   Si nadie resuelve en 30 días, seller broadcastea recovery (hoja 2)
15.   Trade cerrado por recovery; reputación de los 3 árbitros impactada negativamente
```

## 13. Consideraciones de seguridad

### 13.1 Separación de claves

Reutilizar `nsec` para Bitcoin compromete identidad Nostr al revelar la clave en una firma DER (Bitcoin) vs Schnorr puro (Nostr). MUST mantenerse separadas.

### 13.2 Verificación de dirección

Si un atacante MITM altera la dirección Taproot intercambiada por DM, el vendedor podría depositar a una dirección controlada solo por el atacante. **Mitigación:** ambas partes computan la dirección independientemente desde trade pubkeys y árbitros derivados; el DM sólo confirma coincidencia. El kind 39389 ancla públicamente la dirección y la TX, permitiendo verificación por terceros.

### 13.3 Race en cascada de disputas tardías

Si la disputa se abre en los últimos 24 días de los 30, los CSV de arb2 y arb3 ya están cumplidos. Un árbitro deshonesto podría firmar antes que arb1. **Mitigación:** el evento 39387 publica `arb_index`, y los clientes muestran si la decisión respetó el orden. Reputación + bond imponen el coste.

### 13.4 Resistencia a PoW

PoW de 16 bits requiere ~32K hashes en promedio. En CPU moderna ~0.1-1s. Para spam masivo (miles de órdenes/h) requiere recursos significativos. Los relays MAY exigir PoW mayor (24-28 bits) para órdenes que persistan en su almacenamiento.

### 13.5 Nonces Schnorr independientes

Cada parte firma independientemente con `Schnorr.sign(sighash, trade_privkey)` (BIP340). No hay nonces compartidos ni rondas interactivas: a diferencia de MuSig2, no existe el riesgo de nonce-reuse entre partes. El nonce de cada firma se deriva de `(privkey, message, aux_rand)` según BIP340; noble usa `aux_rand` aleatorio por defecto (la opción recomendada por BIP340, endurece contra fault attacks). La firma resultante es válida y verificable igual que una con `aux_rand=0`; lo único que el protocolo exige es que cada firma verifique contra la `trade_pubkey` sobre el mismo sighash. Si en algún momento se quiere reproducibilidad bit a bit, pasar `aux_rand` de 32 ceros.

### 13.6 Recovery skew

La hoja de recovery favorece al vendedor (a los 30 días recupera). Un vendedor deshonesto que recibe fiat y luego se niega a firmar la cooperativa puede esperar 30 días si los 3 árbitros fallan. **Mitigación:** bond + reputación de árbitros, evitando que un vendedor pueda apostar a la inacción de los 3.

### 13.7 Correlación de identidad

Aunque el flujo cooperativo on-chain es por script-path, las pubkeys Nostr son públicas. Quien observe los eventos correlaciona identidades. Para máxima privacidad un usuario MAY usar pubkeys Nostr distintas por trade, a costa de no acumular reputación.

### 13.8 Estafa por triangulación

La **estafa de triangulación** es un ataque social en el que el estafador actúa como intermediario entre dos partes legítimas: toma la orden de un vendedor real y, en lugar de enviarle fiat él mismo, facilita los datos de pago del vendedor a una víctima ajena. La víctima paga directamente al vendedor. El vendedor recibe fiat y libera los BTC al estafador.

Este ataque no explota ningún mecanismo criptográfico del protocolo. Es vulnerabilidad en la capa de verificación del pago fiat.

**Mitigación principal: verificación de identidad del emisor vía chat cifrado.** Antes de iniciar el pago fiat, ambas partes SHOULD acordar en el chat cifrado (NIP-04) el nombre/IBAN desde el que pagará el comprador. El vendedor MUST verificar que el nombre del emisor recibido coincide con lo declarado antes de publicar `fiat_received`. Rompe el ataque de raíz: el estafador no controla desde qué cuenta paga su víctima.

**Mitigación complementaria: código de referencia único por trade.** Los primeros 8 caracteres del `trade_id` (sección 3.2) se usan como concepto en la transferencia fiat:

```
NXTR-{trade_id[0:8]}
```

No rompe el ataque por sí sola (el estafador puede indicarle el concepto a su víctima), pero añade fricción y sirve como evidencia para el árbitro.

**Métodos de pago recomendados** (mayor a menor resistencia):

| Método | Nombre emisor visible | Reversible | Resistencia |
|---|---|---|---|
| Efectivo en persona | N/A | No | Máxima |
| Bizum (ES) | Sí (vinculado a DNI) | No | Alta |
| SEPA transfer | Sí | Raramente | Alta |
| PayPal amigos | Sí | No | Media |
| PayPal bienes | Sí | Sí (chargeback) | Baja |

Los clientes SHOULD desaconsejar métodos reversibles para reducir riesgo de chargeback independientemente de la triangulación.

## 14. Composabilidad con Mostro

Este protocolo está diseñado para **complementar** a Mostro y otros protocolos P2P Nostr (RoboSats, lnp2pbot), no competir con ellos. Su alcance se limita al método on-chain.

### 14.1 Coexistencia en mismo cliente

Un cliente Nostr puede integrar este protocolo junto a Mostro dentro de la misma UI. Los kinds distintos (`["y", "nostrescrow"]` vs `["y", "mostro"]`) eliminan colisiones. La misma infraestructura de chat, reputación y relay pool es reutilizable.

Noxtr adopta este modelo: método on-chain coexiste con flujo Mostro existente, compartiendo UI, chat cifrado y notificaciones. Las diferencias técnicas quedan ocultas al usuario mediante un badge de método en cada orden.

### 14.2 Árbitro por defecto: el admin de la WEB (tier `site_admin`); admins de Mostro = badge

**Cambio 2026-06-03.** El arb1 por defecto es el **admin de la web** (el operador del sitio noxtr), tier `site_admin`, configurado vía CFG `modules.noxtr.onchain_site_arbitrator`. El método on-chain es de noxtr, así que el operador del sitio es el árbitro de referencia natural; transitividad: si el usuario confía en la web que usa, confía en su operador como arb1.

Los **admins de instancias Mostro** dejan de ser arb1 por defecto: ahora son árbitros normales (`regular` o `professional` con bond) que, si operan una instancia Mostro, publican el tag `["mostro_admin", "<robot_pubkey>"]` y la UI los destaca con un **badge ⚡Mostro**. Conservan la transitividad de confianza Lightning→on-chain como señal, pero no prioridad de selección.

Para que cualquiera (admin de Mostro incluido) actúe como árbitro on-chain debe:

1. Generar y mantener clave Bitcoin separada (xprv) distinta de la clave Nostr.
2. Publicar kind 39388 con `tier=regular|professional`, opcionalmente `["mostro_admin", "<robot_pubkey>"]` para el badge, más max_amount, fee_min_sats, fee_rate, idiomas, bio.
3. Implementar lógica de firma Schnorr sobre sighash de hojas Taproot (BIP340) para emitir `arb_signature` en disputas.

NO requiere bond. Los admins Mostro NO están obligados a ofrecerse; quien lo haga asume la responsabilidad ante sus usuarios.

## 15. Implementación en noxtr (resumen)

El código vive en `_modules_/noxtr/` (no es módulo separado). Componentes:

| Componente | Archivo | Función |
|---|---|---|
| Cliente on-chain | `script.onchain.js` | IIFE `Onchain.*`: Keys, Bip86, Book, Trader, Arbitrators, Taproot, Schnorr |
| Integración UI | `script.mostro.js` | Orderbook unificado (badge `ON-CHAIN`), fichas de "Mis trades" branched por `method` |
| Alta árbitro | `run.php` + `script.js` | Botón "Árbitro on-chain" en editor de perfil → `Onchain.Arbitrators.openRegisterDialog()` |
| Persistencia | `noxtrstore.class.php` | Tabla unificada `NSTR_TRADES` (campo `method` distingue lightning/onchain); columnas on-chain: `arbitrators`, `taproot_address`, `funding_txid`, `funding_vout`, `funding_block`, `confirmations` |
| Endpoints | `ajax.php` | `onchain_trade_add`, `mostro_trade_update` (reusado), `mine_pow`, `verify_funding`, `prepare_trade`, `broadcast_tx` |
| Storage navegador | IndexedDB `NoxtrOnchainKeys/keys/escrow_xprv` (AES-GCM) | Mnemonic cifrado del usuario |

API pública del navegador:

```js
Onchain.init(config)
Onchain.Keys.{isConfigured, isUnlocked, setup, unlock, lock, clear, getMnemonic}
Onchain.Bip86.{deriveTradeKeyFromMnemonic, deriveCurrentTradeKey, privkeyToTradePubkey}
Onchain.Book.{subscribe, unsubscribe, list, filter, orders}
Onchain.Trader.{createOrder, cancelOrder, takeOrder, getPendingTakeRequests, acceptTake, publishFiatSent, publishFiatReceived, publishBuyerPayout, publishComplete, publishDispute}
Onchain.UI.{startCoopSign, broadcastCoop, openDispute, settleArbitration, recoverFunds}   // cooperativo + disputa (partes) + recovery
Onchain.Arbitrators.{subscribe, list, renderSelector, selectedFrom, openRegisterDialog, publishAdvertisement}
Onchain.Arbitrators.{openDisputePanel, resolveDispute}   // panel del arbitro (fase B): procesa dispute_request, firma y manda arb_signature
Onchain.Taproot.{buildAddress, buildDetails, verifyAddress}
Onchain.Spend.buildCooperative(trade, feeSats)       // tx_hex + sighash + leaf_script + control_block
Onchain.Spend.assembleCooperative(coopSpend, buyerSig, sellerSig)  // TX segwit firmada lista
Onchain.Spend.buildArbitration(trade, winnerSide, arbIndex, feeSats)   // gasto por hoja de arbitraje
Onchain.Spend.assembleArbitration(arbSpend, winnerSig, arbSig)         // witness [winner_sig, arb_sig, ...]
Onchain.Spend.buildRecovery(trade, feeSats)          // gasto por hoja recovery (single-sig vendedor, CSV 4320)
Onchain.Spend.assembleRecovery(recSpend, sellerSig)  // witness [seller_sig, recovery_script, control_block]
Onchain.Schnorr.{sign, verify}                       // BIP340 sobre noble-secp256k1 v1.2.14
Onchain.UI._receiveCoopSign / _refreshReleaseTx           // handler coop_sign + poll de confirmaciones
Onchain.PowMiner.mineRemote(unsignedEvent, difficulty)
Onchain.debugCoopSpend(orderId, feeSats)             // consola: reproducibilidad del sighash
Onchain.debugSchnorr()                               // consola: roundtrip sign/verify
Onchain.debugArbSpend(orderId, winnerSide, arbIndex, feeSats, arbPrivHex)  // consola: validar gasto arbitral
Onchain.debugArbPrivkey(idx)                         // consola (arbitro): privkey BIP86 idx (default 0)
Onchain.debugRecoverySpend(orderId, feeSats)         // consola (vendedor): validar gasto recovery
```

Principio rector: **browser-first y minimización de custodia.** La criptografía y la
construcción/firma de transacciones ocurren en el navegador. En la implementación actual,
el servidor PHP sí participa en persistencia local, proxy de cadena, PoW remoto y
broadcast; nunca necesita recibir la clave privada Bitcoin de un trade on-chain.

## 16. Estado actual de la implementación

Resumen actualizado tras la auditoría del **2026-09-01**:

**Hecho y verificado:**

- **Configuración temporal de pruebas:** esta copia usa CSV `6/12/36` para probar la
  cascada sin esperar días. La especificación de producción sigue siendo
  `288/576/4320`; cambiar esos valores cambia el script y la dirección escrow.
- **Endurecimiento de eventos Nostr:** se recomputan `id` y firma Schnorr, se valida el
  PoW declarado y real, y los eventos parametrizados usan `d` por acción más una tag
  `order_id` estable para no reemplazar el historial completo del trade.
- **Claves sin custodia del servidor:** las nuevas operaciones on-chain persisten solo
  la pubkey y el índice; la private key se rederiva en el navegador tras desbloquear el
  backup cifrado. BIP39 valida checksum y conserva passphrase; WIF deriva una clave hija
  distinta por trade en lugar de reutilizar la clave raíz.
- **Persistencia antes de publicación:** crear, tomar y aceptar se guardan antes de
  emitir el evento. Los estados firmados mantienen un outbox local y se republican con
  el mismo id después de una recarga.
- **Funding y disputa:** el fallback de mempool solo acepta el outpoint exacto si sigue
  sin gastar; la resolución arbitral vuelve a comprobar txid/vout/importe/dirección y
  respeta el CSV del árbitro. La solicitud cifrada se envía a los tres árbitros y la
  comisión de disputa se paga al árbitro que realmente resuelve.

- **Claves e identidad:** xprv cifrado en IndexedDB (AES-GCM), BIP86 (`deriveTradeKey*`), separación nsec/xprv.
- **Orderbook:** createOrder, cancelOrder, Book.subscribe, takeOrder / acceptTake, listener `accept` con validación estricta del maker (`_handleAcceptEventAsTaker` rechaza eventos cuya `ev.pubkey` no sea el `maker_nostr_pubkey` congelado en `takeOrder`).
- **Árbitros:** pool (kind 39388), selector UI, registro desde el editor de perfil, comisión Variant C.
- **Selector global de red** (`mainnet`/`testnet`/`signet`): filtra orderbook, bloquea acciones cross-red en Mis trades, persiste en `trade_json.network`, propaga tag `["network", ...]`. `verify_funding` exige `network` y valida HRP (`bc1p` mainnet / `tb1p` testnet+signet) + backend mempool correcto.
- **Dirección Taproot:** `Onchain.Taproot.buildAddress/buildDetails/verifyAddress` operativos, validados con vectores en navegador. `address_check` bilateral con validación de procedencia.
- **Funding:** detección por RPC o mempool.space (poll global), publicación automática de kind 39389 (`publishFundingCommitment`) al detectar el depósito, handler de 39389 entrante con validación de procedencia + amount.
- **Estados fiat:** `fiat_sent` (lo publica el comprador) y `fiat_received` (lo publica el vendedor) con handlers que validan rol/red, y `buyer_payout` (dirección de cobro del comprador → la guarda el vendedor).
- **Comisión a cargo del vendedor:** el vendedor deposita `amount + arb_fee` (`_fundingTargetSats`); el comprador no toca la comisión (recibe `amount - miner_fee`). El árbitro cobra `arb_fee` gane quien gane (neutralidad). Miner fee en quien recibe el payout. Reflejado en funding target, kind 39389 y UI.
- **Gasto cooperativo (construcción):** `Spend.buildCooperative` produce `tx_hex` (sin testigos), `sighash` BIP341 (script-path, SIGHASH_DEFAULT, hoja cooperativa), `leaf_script` y `control_block`. Reproducible entre navegadores (`debugCoopSpend`).
- **Schnorr (BIP340):** `Onchain.Schnorr.sign/verify` sobre noble-secp256k1 v1.2.14. Roundtrip verificado en navegador (`await Onchain.debugSchnorr() === true`).
- **DM `coop_sign` + ensamblado witness (paso 12) — VALIDADO EN TESTNET:** tras `fiat_received`, el comprador (`UI.startCoopSign`) propone el fee, firma el `sighash` con su trade privkey y envía `{type:'coop_sign', order_id, trade_id, network, tx_hex, fee_sats, sig}` por DM NIP-04 (kind 4). El receptor (`UI._receiveCoopSign`, dispatch en `_initDmHandler`) reconstruye `buildCooperative` con el MISMO fee, exige que `tx_hex` coincida, verifica la firma del peer contra su trade pubkey, firma su parte, y `Spend.assembleCooperative` ensambla la TX segwit final `[buyer_sig, seller_sig, leaf_script, control_block]`. El vendedor (responder) devuelve su firma al comprador; el comprador (iniciador) no responde (evita bucle). Estado `firmando`; el `tx_hex` firmado se guarda en `trade_json.coop_signed_tx` y se muestra con botón de copiar. Procedencia validada (solo de la contraparte). Fee congelado en `coop_fee_sats` para evitar reensamblar una firma de otro sighash.
  - **Validación real (2026-05-29):** TX cooperativa ensamblada por noxtr difundida y aceptada en **testnet**, txid `83e3a0335be93ae9f1b260fbc0c56aa4d278371400cfcc80f7d95bf6e16d85a5`. Confirma que el sighash BIP341 (script-path, hoja cooperativa), las dos firmas Schnorr BIP340 independientes, el orden del witness y el control block son correctos contra una implementación de consenso real.
- **Broadcast + complete (pasos 13-14):** `broadcast_tx` en `ajax.php` (ya no stub) difunde el `coop_signed_tx` por RPC `sendrawtransaction` (si hay RPC para esa red) o mempool.space `POST /tx` (`MempoolApi::post`), con el mismo guard de red que `verify_funding`. Cliente: `UI.broadcastCoop` (botón "Difundir y liberar" en ambos lados) difunde, guarda `release_txid`, marca `internal_status=completado` y publica `complete` (kind 39385 action=complete con `txid` vía `Trader.publishComplete`). El peer recibe `complete` (`_handleCompleteEvent`, validación de procedencia) y cierra su trade. **El happy path on-chain está completo de punta a punta en la UI.**
- **Seguimiento de la TX de liberación (`tx_status`):** al ensamblar se guarda `coop_txid` (txid esperado = hash del `tx_hex` legacy, sin testigos). El poll global (`_fundingPollTick`) cubre dos casos nuevos: (a) trade `firmando` → `_checkReleaseBroadcast` consulta `tx_status(coop_txid)` y, si la TX ya está on-chain (la difunda quien la difunda: botón, peer o **manualmente**), cierra el trade a `completado` y oculta el botón "Difundir"; (b) trade `completado` → `_checkReleaseConfs` refresca `release_confirmations` hasta 6. La ficha muestra "Confirmada (N confirmaciones)" o "en mempool" + link al explorador. `broadcast_tx` que falla por TX ya difundida también se reconcilia vía `tx_status`. Endpoint `tx_status` = mempool.space `/tx/{txid}/status` (+ tip height para el conteo) o RPC `getrawtransaction verbose`.

**Pendiente (frontera actual, en orden):**

1. **Disputa (paso 15, completa salvo prueba end-to-end):**
   - ✅ Constructor del gasto por hoja de arbitraje: `Spend.buildArbitration` + `assembleArbitration` (witness `[winner_sig, arb_sig, leaf, control_block]`). El árbitro que resuelve cobra la comisión completa y el ganador recibe el resto. Helper de consola `debugArbSpend`.
   - ✅ **Lado partes:** botón "Disputar" (`UI.openDispute`) → `Trader.publishDispute` (kind 39386 `reason`/`initiator`) + DM `dispute_request` a arb1 con el contrato completo (el árbitro no es parte y no tiene la fila local). Handlers `_handleDisputeEvent` (39386), `_handleArbitrationEvent` (39387), y DM `arb_signature` → `UI.settleArbitration` (reconstruye, verifica la firma del árbitro, firma, ensambla, difunde, cierra; reusa los campos `coop_*` para el poll de confirmaciones).
   - ✅ **Lado árbitro (fase B, 2026-05-29):** `Arbitrators._handleDisputeRequest` valida la solicitud (procedencia = una de las dos partes) y la guarda en `localStorage('nxoc_arb_disputes')` (necesario porque los DMs ya vistos no se re-despachan tras recarga). `Arbitrators.openDisputePanel()` (botón en el diálogo "Quiero ser árbitro") lista las disputas; `resolveDispute(orderId, side, fee)` deriva la privkey de árbitro (BIP86 idx 0, ver `debugArbPrivkey`), elige el slot que ocupa (`_myArbInfo`, el de menor CSV), construye la hoja con un trade sintético (`_disputeToTrade`), firma, publica 39387 (`_publishArbDecision`) y manda `arb_signature` al ganador (`_sendArbSignature`).
   - ✅ **`seller_payout_address`:** si gana el vendedor, el panel la pide (no se recogía en el happy path) y la envía en el DM como `winner_payout_address`; `settleArbitration` la persiste en `trade_json` antes de reconstruir para que el sighash coincida. El ganador valida (y firma/difunde) antes de mover fondos.
   - ⏳ Probar end-to-end en testnet (parte abre disputa → árbitro resuelve → ganador difunde).
   - Las hojas arb2/arb3 (csv 288/576) exigen relative-locktime BIP68: la TX de arbitraje solo es válida tras csv bloques desde el funding.
2. ✅ **Recovery (paso 16, 2026-05-29):** `Spend.buildRecovery`/`assembleRecovery` (hoja 1, single-sig, nSequence=4320) + `UI.recoverFunds` (gate `tx_status` ≥ 4320 confs) + botón en la ficha del vendedor + `debugRecoverySpend`. Pendiente probar en testnet (el CSV obliga a esperar 4320 confirmaciones del funding).
3. **Otros:** verificación de bonds on-chain (tier professional), cómputo de reputación (kind 39384), `prepare_trade` (stub), fee estimation automática (hoy el comprador teclea el fee).

`prepare_trade` sigue como stub en `ajax.php` (no necesario: el cliente arma el taproot). El happy path completo (crear/tomar/aceptar → dirección → funding → fiat → firma cooperativa → broadcast → complete) ya funciona en la UI, **probado el gasto cooperativo en testnet**. Antes de mainnet con fondos reales conviene: probar el broadcast desde la UI end-to-end (no solo el push manual), y completar disputa/recovery para cubrir el caso no-cooperativo.

Cuando se actualice este estado, sobrescribir esta sección (no acumular cronología — los STATUS antiguos quedan en `_modules_/nostr_escrow/` como historial).

## 17. Changelog

- **v2.8**: endurecimiento tras auditoría: verificación de id/firma/PoW de eventos,
  `order_id` estable y `d` independiente por acción, persistencia previa + outbox,
  claves Bitcoin on-chain fuera del servidor, índices aleatorios sin reutilización,
  passphrase/checksum BIP39, WIF con derivación por trade, verificación exacta de UTXO
  no gastado y de direcciones, revalidación de funding antes de arbitrar, envío del
  expediente a los tres árbitros y comisión al árbitro que resuelve. El tier profesional
  queda sin privilegios hasta verificar realmente su bond.
- **v2.7**: añade `action=address_check` a kind 39385 como verificación bilateral de la dirección escrow tras derivarla. Sustituye al handshake explícito sobre árbitros: como la dirección encodea ya la combinación de árbitros y trade pubkeys, comparar direcciones es suficiente. Si ambas partes derivan la misma dirección, el contrato está acordado; si no, ninguno marca verificado y el vendedor no fundea, eliminando la race condition de cambio de árbitros.
- **v2.6**: consolida README+ARCHITECTURE+ARBITRATORS+STATUS bajo este archivo. Añade Variant C de comisión a la spec (sección 10). Añade tag obligatoria `["k", "buy"|"sell"]` a kind 39383 y tags `["status", "active|unavailable"]` + `["fee_min_sats", "<sats>"]` a kind 39388. Añade action `arbitrators` a kind 39385. Documenta modo bootstrap (1 árbitro → [pk,pk,pk]).
- **v2.5**: scope reducido a sólo on-chain. Kinds 39xxx. Tres tiers de árbitros (`professional`, `mostro_admin`, `regular`). Tres modos de selección. Bond exclusivo del tier professional. Añadida sección de prevención de triangulación.
- **v2.4**: MuSig2 eliminado; gasto cooperativo vía hoja Taproot 2-of-2 con firmas Schnorr independientes; internal key fija en NUMS point; taptree de 8 hojas.
- **v2.3**: kinds 38389/38390 nuevos; selección determinista de árbitros; scripts completos del taptree; MuSig2 con rondas; Funding Commitment event.
- **v2.2**: separación nsec/xprv; leaf de recuperación; cascada de árbitros con timelock; PoW + handshake.
- **v1.x**: draft inicial.

## 18. Referencias

- Mostro (Lightning P2P sobre Nostr) — fuente de inspiración para el flujo P2P.
- Bisq, Hodl-Hodl — escrow on-chain con árbitros.
- BIP-341/342 (Taproot), BIP-340 (Schnorr), BIP-86 (derivación), BIP-13 (PoW Nostr), NIP-04 (DM), NIP-44 (DM versionado), NIP-86 (relay management).
