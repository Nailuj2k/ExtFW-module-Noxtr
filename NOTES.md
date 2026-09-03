

## Crear Orden Venta en MM. (no hay q meter lnaddress en MM)

1. se toma en noxtr, dando a COMPRAR
2. noxtr pide lnddres
3. MM muestra qrcode
4. pago holdinvoice lnbc
5. MM detecta pago holdinvoice y cierra qrcode y muestra CONTACTAR
6. CHAT funciona perfectamente en los dos sentidos
7. en Noxtr aparece 'Enviar Fiat'. se eenvia fiat
8. MM aparec 'Liberar', y libero. 
  Nota No Importante: ahora el chat noxtr pone 'sin mensajes', pero si escribes 
                      desde mm funciona perfecto, en los dos sentidos
9. Calificar funciona perfecto


## Crear orden Compra en MM                
1. Creo orden compra en MM
2. NOXTR aparece en Order book. le doy a 'Vender'. Apatrece qrcode, Pago con WOS
3. desparece qrcode en NOXTR
4. En MM parece button 'Fiat enviado'
5. En NOXTR aparece 'Librera sats'
6. CHAT funciona PEFECTO!!!! 
7. Pulsamos Fiat enviado en MM
8. En Noxtr y MM sale para calificar


## Crear orden de Compra en NOXTR y tomar con NOXTR             *
1. NOXTR0  le ponemos lnaddess en el form
2. NOXTR1 tomamos orden, ùlsando en Vender, sale qrcode y pagamos                  // Pagado
3. NOXTR1. sale msg 'esperando fiat'                                               //
4. NOXTR0. sale Btn 'Fiat enviado'                                                 // Maker: Fiat enviado   // En take tenemos 'esperndo fiat del comprador no sale Liberar sats
5. NOXTR0 y NOXTR1 CHAT funciona perfecto                                          // He tenido que darle 'Reenviar fiat enviado'
6. Enviamos  fiat y liberamos sats,TODO PERFECTO           // Taker:  Damas a Liberar sats, sale ' Sigue en liberando desde hace 0 s. Reabre el trade para volver a intentar el release. 
                                                              Liberacion atscada ' + Button [Recuperar liberacion]
                                                              Damos a Recuperar liberacion y a Liberar sdats y el maker recibe 'El robot está enviando tus sats. Si el pago no llega, te pedirá una nueva dirección Lightning — puedes usar cualquier wallet. Tus sats están a salvo.' + El pago no llegó — introduce una LN address o factura bolt11 con importe: [input]



## Crear orden de Venta en Noxtr.

0. Cremaos orden de Venta en NOXTR0 (tienda)
1. se topma en NOXTR1 (noxtr), dando a COMPRAR. 
2. NOXTR1 Pide lnaddress 
3. en NOXTR0 sale qrcode y pago invoice con WOS
4. en NOXTR1 sale btn 'Fiat enviado'
5. en NOXTR1 pulso 'fiat enviado' y en NOXTR0 sale boton 'Loiberrar Sats' libero y todo termina bien
6. PERFECTO

## bugs conocidos pendientes:

Echo en chat — mensajes propios aparecen con "Contraparte:"          ARREGLADO!!!
Card desaparece al recargar (flujo noxtr↔noxtr, NOXTR1 step 4)
"Tomada por ti" incorrecto en NOXTR0 hasta recargar


# TO-DO

## ExtFW 
---
name: CLI_USER client-side encryption idea
description: Idea pendiente de evaluar: cifrar columnas sensibles de CLI_USER en el navegador
type: project
---

Cifrar ciertas columnas de CLI_USER (ej. nwc_uri, nostr privkey) de forma que solo se descifren en el navegador del usuario.

**Why:** Si el servidor es comprometido, los datos sensibles no son legibles en claro. La secret NWC y claves privadas nunca estarían en texto plano en BD.

**Mecanismo propuesto:**
- Login passwordless: descifrar con la contraseña/clave local del usuario
- Login Nostr: usar la privkey Nostr como clave de descifrado (está en el navegador, nunca en servidor)
- El servidor guarda solo el ciphertext; no puede descifrar sin la clave del usuario

**How to apply:** Evaluar cuando se aborde seguridad avanzada o login Nostr. No bloquea la implementación actual de nwc_uri en claro (igual que nostr_pubkey hoy).

















el protocolo no permite enviar una lnaddress o invoice q sustituya a la anterior?
no dice cuanto tiempo hay que esperar en el estado 'liberando sats' ??

He preguntado al protocolo directamente. Las dos respuestas son negativas y son carencias reales del protocolo:

1. Reemplazar invoice/LN address proactivamente:

"If all payment attempts fail, Mostro sends add-invoice action requesting the buyer to provide a new Lightning invoice."

El protocolo es estrictamente bi-direccional: Mostro pregunta, el comprador responde. No existe mecanismo para que el comprador sustituya su invoice por iniciativa propia mientras la instancia sigue reintentando la anterior. Punto.

2. Tiempo máximo en estado liberando/settled-hold-invoice:

"The protocol does not specify a maximum time an order can remain in the 'released' or 'settled-hold-invoice' state, nor does it define automatic cancellation, dispute, or escalation procedures for this phase."

Tampoco. Solo dice que la instancia reintenta según payment_attempts × payment_retries_interval, pero no impone ningún timeout global ni define qué pasa si los retries se agotan pero add-invoice nunca llega. Es un agujero en el protocolo.

Conclusión cruda
Estás en una situación donde el protocolo no te ampara:

Si la instancia agotó retries y por lo que sea no manda add-invoice (bug, caída, lo que sea) → trade huérfano, sats en escrow indefinidamente.
No puedes mandar invoice nueva por tu cuenta para forzar el rescate — la instancia la ignora.
No puedes abrir disputa (solo permitida en active/fiat-sent).
Recursos prácticos cuando esto pasa:

Contactar al admin de la instancia Mostro (Mostro 🤖 oficial: Telegram/Nostr). El admin sí tiene comandos para mover trades atascados manualmente.
Esperar más — algunas instancias tienen retries muy largos (1h+ por intento) y eventualmente piden add-invoice. No lo sabemos sin ver la config.
Hablar con la contraparte por chat — si la conoces, podéis coordinar un acuerdo extra-protocolo (te paga en otro sitio, ella te garantiza, etc.). El chat sigue funcionando aunque el trade esté congelado.
Lo del trade 53e89ae1 no es bug ni tuyo ni del código — es un gap del protocolo Mostro.






# Ver logs en consola

localStorage.setItem('noxtr_debug','1'); location.reload()

## Visor de eventos en tiempo real
Overlay (esquina inf. der.) con una matriz **kind x relay** de eventos recibidos + una tabla de totales por relay (`sent`/`recv`/`ok`/`rej`/`rl`). Refresca cada 1s.

- **Abrir/cerrar**: click en `#noxtr-version` (el "Noxtr vX.Y.Z" al final). También `Noxtr.Pool.toggleMetrics()` desde consola, o se abre solo con `noxtr_debug`.
- **Reset contadores**: click derecho sobre el overlay (o `Noxtr.Pool.resetMetrics()`). Útil para medir qué dispara una acción concreta (abrir Mensajes, crear orden...).
- **Señales de baneo**: `rej` (rechazados) y `rl` (rate-limited) se pintan en **rojo** cuando >0. Un relay actualmente en throttle sale en **ámbar** con `THROTTLE Ns` (cuenta atrás de `_throttledUntil`).
- Estilo en `style.css` (`#noxtr-metrics`), no inline. Datos en `Noxtr.Pool.metrics`.

## msg recibidos (a cientos)
script.js?ver=1.3.576:378 [Pool._msg][OK] wss://relay.noswhere.com {event_id: '11e480bd0e9ca63cf30c16e38d0a3adeb24d11b837a85af3b877e2bd8c23d1e1', accepted: false, message: 'mute: no one was listening for this'}

[Pool._msg][OK] wss://relay.damus.io {event_id: '30ae6aed1b37e542e55790b495a2b05b8abc31f1eef3b7e19c27b29ca780b43d', accepted: false, message: 'rate-limited: you are noting too much'}



# INCIDENCIA: DM entre users falla con signer remoto (NIP-46)  — seguir en casa

Fecha: 2026-06-16. Versión cuando se detectó: 1.3.576. Fix en 1.3.578.

## Síntomas observados
- DM en trades (onchain/Mostro): PERFECTOS. (Los manda el cliente nsec con AES local, no tocan el signer.)
- Mensajes en Canales (NIP-28): PERFECTOS. (kind 42, sin cifrar.)
- DM entre users (pestaña Mensajes): MAL, solo con el cliente que entra por signer remoto (signer.noxtr.net):
  - signer ENVIA: pulsas Enviar, se vacía el input, 20-30s después `Error: NIP-46 request timeout: nip04_encrypt`. El mensaje ni se añade al chat (el texto se restaura tras el alert).
  - nsec ENVIA (NIP-17): el mensaje se añade a tu chat pero NO llega al cliente signer.
  - En la consola del cliente signer: ~70 líneas de golpe `[noxtr] NIP-17 unwrap failed ...: NIP-46 request timeout: nip44_decrypt`.

## Causa raíz (confirmada por logs de relays)
Las peticiones NIP-46 (kind 24133) se publicaban con `Pool.publish` a TODOS los relays del feed. Esos relays:
- bloquean kind 24133: `wss://purplepag.es {accepted:false, 'blocked: kind 24133 is not allowed'}` (y típicamente nostr.band).
- rate-limitan la ráfaga: `wss://relay.damus.io {accepted:false, 'rate-limited: you are noting too much'}`.
- no tienen listener: `wss://relay.noswhere.com {accepted:false, 'mute: no one was listening for this'}`.
Además, abrir la bandeja NIP-17 dispara ~70 `nip44_decrypt` A LA VEZ (2 por gift wrap). `sign_event` va bien porque es 1 a 1.

Por qué trades sí y Mensajes no: trades usan NIP-04 mandado por el cliente nsec (AES local). El problema es exclusivo del canal NIP-46 del cliente con signer remoto.

## Fix aplicado (1.3.578, en script.js)
1. `NIP46_RELAYS = [relay.nsec.app, relay.damus.io, nos.lol]` — relays dedicados que aceptan 24133.
2. `Pool.publishToRelays(urls, ev)` — publica el 24133 SOLO a esos relays (no al feed entero).
3. `connect()` URI anuncia NIP46_RELAYS; `restore()` conecta el Pool a ellos.
4. `Nip46._request` reescrito como cola con `_maxInflight = 2` (serializa las peticiones; mata el rate-limit por ráfaga).
5. `_unwrapNip17` ya no traga el fallo en silencio: loguea con `noxtr_debug`.

### Anti-baneo añadido (1.3.579)
Para que un `rate-limited` no escale a baneo:
- `Pool._msg` detecta `rate-limited` en el `OK` del relay y marca `relay._throttledUntil = now+15s`. `Pool.publish` y `Pool.publishToRelays` saltan los relays throttled (no insisten). La redundancia de los 3 `NIP46_RELAYS` cubre el envío mientras uno está en pausa.
- La cola NIP-46 (`Nip46._pump`) fuerza un hueco mínimo `_minGap = 150ms` entre envíos consecutivos, además del `_maxInflight = 2`. Reparte la ráfaga en el tiempo en vez de mandar 2 sin pausa en cuanto resuelve la anterior.

Nota sobre lazy decrypt: NIP-04 ya es perezoso (solo descifra al abrir el chat o cache-hit). NIP-17 (kind 1059) NO puede serlo: el peer va dentro del gift wrap, hay que desempaquetar para saber a qué conversación pertenece. La ráfaga NIP-17 es de una sola vez (tras el primer unwrap se cachea en claro en DB y no se vuelve a golpear al signer).

## PENDIENTE DE PROBAR EN CASA
- [ ] **RE-EMPAREJAR el signer** tras subir 1.3.578 (desconectar NIP-46 + reescanear QR). Sin esto el signer sigue en los relays viejos del feed y el cliente publica en los nuevos → no se encuentran.
- [ ] Probar signer -> nsec (enviar DM desde el cliente signer): no debe dar timeout.
- [ ] Probar nsec -> signer (NIP-17): debe llegar al cliente signer.
- [ ] Revisar consola del cliente signer: ya no debe haber ráfaga de `nip44_decrypt timeout`.
- [ ] Confirmar que `relay.nsec.app` va bien; si no, cambiar la lista `NIP46_RELAYS` (solo relays que acepten kind 24133).
- [ ] Ver en signer.noxtr.net cuántos relays conecta (debería ser ~3, no "5 de 6").




## IDEAS para considerar

NSTR_EVENTS dejamos dejamos de usarlo. Le hacemos un DROP o un TRUNCATE
  - Ojocuidao: _logMostroEv lo usa también el monitor y hay lógica de deduplicación de eventos

NSTR_TRADES podoemos eliminar las claves en los trades finalizados
  - Cuando internal_status pasa a completado o cancelado, y tras la ventana de valoración, trade_privkey = ''. Deja de existir el material que descifra ese trade.
  - Nota: el chat de un trade completado sigue siendo legítimo (subscribeMyTrades lo mantiene vivo tras completado), así que borrar la clave se o carga
  - Nota: Una disputa puede reabrirse tarde. Tal vez una ventana de gracia de días pal borrado.

Modo seguro ON:
  - semilla nueva generada en el navegador, 12 palabras mostradas y confirmadas
  - guardada en IndexedDB, nunca en save_mostro_seed
  - al crear/tomar trade: trade_privkey: '' en el POST
  - al cargar trades: rederivar la clave desde la semilla + seed_index de la fila
  - avisar: sin notificaciones por email, y otro dispositivo requiere las 12 palabras

  - Opción: Seed = Seed en el server + Seed en el navegador, derivando con HDF sobre ambas  para sacar el BIP32 de 64bytes
  - En 'Modo seguro' el monitor no funcionará, para ese user
  - ponemos el dialog para generar la semilla del navegadpr, con guardado en el pc o donde sea (Advirtiendo que es una seed sólo para la generacion de claves de trades) 
  - En 'Modo seguro' para usar en otro dispositivo necesitrá las 12 palabras o seed del navegador 

  - Sugerencia de Claude (creo que va drogao): cifra la mitad local con una passphrase del usuario y guarda ese blob en el servidor. El servidor almacena algo que no puede abrir, y el usuario recupera desde cualquier dispositivo con su passphrase. Sigue habiendo algo que memorizar, pero una passphrase es más manejable que 12 palabras, y ganas el multi-dispositivo que el modo seguro perdía.

Modo paranoico:
  - instruciones para poner un debian pelado+niginx+extfw+noxtr en tu propia raspberry y entrar a ella por localhost