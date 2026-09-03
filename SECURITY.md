# Seguridad — Noxtr

Este documento describe el modelo de seguridad del módulo Noxtr, con especial
atención al cliente Mostro (comercio P2P de Bitcoin/Lightning sobre Nostr), y
mantiene la trazabilidad de las revisiones de seguridad realizadas y de los
puntos que siguen abiertos.

Está escrito para que cualquiera pueda verificar cada afirmación contra el
código. Donde se cita un fichero y una línea, es porque ahí se puede comprobar.

---

## 1. Qué es Noxtr y qué no es

Noxtr es un cliente Nostr con un módulo de comercio P2P que habla el protocolo
Mostro. Es una aplicación web: el código se sirve desde un servidor y se
ejecuta en el navegador del usuario.

Esto tiene una consecuencia que conviene entender antes que ninguna otra: en una
aplicación web, el operador del servidor controla el código que se ejecuta en el
navegador del usuario. Ninguna medida criptográfica del cliente protege contra
un servidor que sirva JavaScript modificado. Es una propiedad de la plataforma,
no un defecto concreto de Noxtr, y aplica igual a cualquier wallet o cliente que
se ejecute en una pestaña.

Quien necesite garantías por encima de ese límite tiene la opción de alojar
Noxtr en su propia máquina (ver §5).

---

## 2. Custodia de las claves de trade

**Declaración directa: en la instancia pública, Noxtr es custodial.**

El protocolo Mostro usa una clave distinta por trade (*trade key*), derivada por
NIP-06 de una semilla BIP-39 propia del usuario mediante la ruta
`m/44'/1237'/38383'/0/N`. Esa clave firma cada mensaje enviado al nodo Mostro,
descifra sus respuestas, y de ella se derivan por ECDH las claves del chat con
la contraparte.

En Noxtr, tanto la semilla como las trade keys derivadas se guardan en el
servidor, cifradas en reposo con AES-256-GCM. La semilla se genera en el
navegador del usuario y nunca la produce el servidor, pero éste conserva una
copia. Como la derivación es determinista, tener la semilla equivale a poder
derivar todas las trade keys del usuario, presentes y futuras.

Por tanto, quien controle el servidor tiene la capacidad técnica de firmar en
nombre de cualquier usuario.

**Por qué está diseñado así.** El monitor (`server_monitor.php`) es un proceso
independiente que vigila los relays y avisa al usuario por email cuando algo
requiere su atención, con el navegador cerrado. Para saber *qué* ha pasado
necesita descifrar los mensajes NIP-44 del nodo, y para eso necesita la clave.
Notificación con el navegador cerrado y no-custodia son incompatibles por
construcción.

**Lo que el código hace realmente.** El monitor únicamente descifra: no existe
ninguna llamada de firma con `trade_privkey` en `server_monitor.php` — su uso se
limita a `nip44GetConversationKey` y `nip44Decrypt` (`server_monitor.php:1882`).
Eso no elimina la custodia, pero acota lo que el sistema hace frente a lo que
podría hacer, y es verificable leyendo el fichero.

**Qué protege el cifrado en reposo y qué no.** La clave AES vive en la misma
base de datos que los datos cifrados (`modules.noxtr.trade_privkey_enc_key` en
`CFG_CFG`). Protege contra el escenario más habitual —un dump o backup de la
base de datos que se filtra o se accede sin el resto del stack— y no contra un
servidor de aplicación comprometido.

---

## 3. Lo que sí está protegido

Estas propiedades están implementadas y verificadas contra el código fuente del
daemon Mostro (`MostroP2P/mostro`) y de `mostro-core`, no contra la
documentación publicada:

- **Autenticidad de los mensajes del nodo.** Todo evento `kind 14` entrante se
  verifica en dos pasos antes de descifrarse: firma Schnorr recalculando el id
  del evento (sin fiarse del que trae), y comprobación de que el autor es el
  nodo Mostro de ese trade. El filtro `authors` de la suscripción se trata como
  lo que es —una petición al relay, no una garantía criptográfica.

- **Autenticidad del chat P2P.** El mensaje real viaja como *rumor* interno
  firmado con la trade key del emisor. Se verifica esa firma, se exige que el
  remitente sea la contraparte conocida del trade, y se aplican cota de tamaño,
  cota de desfase de reloj y deduplicación durable.

- **Chat de disputa.** Sólo se aceptan mensajes del nodo Mostro o del solver
  asignado; cualquier otro remitente se descarta.

- **Prueba de identidad (modo reputación).** Firma con el payload
  domain-tagged `mostro-transport-v2-identity:<trade_pubkey>:<message_json>`,
  que liga la identidad a la trade key concreta que firma el evento y hace que
  la prueba no pueda injertarse en un mensaje de otro remitente.

- **Modo privacidad total por defecto.** La reputación es opt-in. Sin activarla,
  los trades no quedan ligados a la identidad Nostr del usuario.

- **Claves distintas por trade.** Cada trade estrena su propia clave derivada,
  de modo que ni el nodo ni la contraparte pueden enlazar los trades de un mismo
  usuario entre sí.

---

## 4. Historial de revisiones

### 1.4.108 — Endurecimiento de servidor (revisión externa, 2026-08-17)

Cerrados: SSRF en la resolución de Lightning Address y en el cacheo de imágenes
de perfil (validación de destino, rechazo de IPs internas, sin seguir
redirecciones, límite de tamaño); creación pública de facturas BTCPay (límite
por IP, redirección restringida al propio dominio); verificación de la firma
Schnorr BIP-340 del zap request NIP-57; escape de comilla simple en el cliente;
revisión de las consultas SQL con literal.

### 1.4.144 — Auditoría de cumplimiento contra `mostro-core` 0.14.5

Revisión del cliente Mostro leyendo el código fuente de `mostro-core` (b96158d)
y del daemon (fde11c3).

- **Autoría del canal del nodo.** Los mensajes entrantes se emparejaban con un
  trade sólo por el tag `#p` = `trade_key_pub`, que es información pública, y la
  clave de conversación se derivaba del autor del evento, fuera quien fuera.
  Permitía inyectar acciones del nodo —por ejemplo un `pay-invoice` con una
  bolt11 ajena. Cerrado exigiendo que el autor sea el nodo de ese trade.

  Esto matiza lo que afirmaba la entrada 1.4.108: la firma del evento sí se
  verificaba, pero verificar la firma prueba que el evento no está manipulado,
  no quién lo mandó.

- **`payment_request` mal formado.** Se enviaba con dos elementos cuando
  `Payload::PaymentRequest` es una tupla de tres. El daemon descartaba el
  mensaje entero al deserializar, sin devolver `cant-do`. Afectaba al camino
  crítico de toda compra.

- **Unidades en el tercer elemento** de ese mismo payload: se colocaba un
  importe en fiat en un campo que es satoshis.

Verificado sin necesidad de cambios: las firmas internas del tuple v2 (el nodo
las envía siempre nulas) y la variante `Message` de los mensajes salientes (el
daemon despacha por acción y él mismo emite `Message::Order` para sus ratings).

### 1.4.145 — `last-trade-index`

El contador de `trade_index` lo lleva cada nodo en su propia tabla. Una
identidad que hubiera operado desde otro cliente veía rechazadas sus órdenes con
`InvalidTradeIndex`. Se consulta ahora al nodo antes de repartir índice.

---

## 5. Autoalojamiento

Noxtr puede alojarse en una máquina propia. En esa configuración desaparecen las
dos limitaciones anteriores a la vez: el servidor es el propio usuario, de modo
que no hay tercero con acceso a las claves, y el código que se ejecuta en el
navegador lo sirve su propia máquina.

Requisitos: Debian, nginx, PHP y extFW. Funciona en hardware modesto.

Instrucciones de instalación: 

- Debian (o culquier Linux) + Nginx + PHP + SQLite
- ExtFW: https://github.com/Nailuj2k/ExtFW
- Noxt:  https://github.com/Nailuj2k/ExtFW-module-Noxtr

- En RASPPBERRY.md tenemos una guía rápida (sin terminar) de instalación de 
  debian+nginx+php en una Raspi, que explica además como añadirle https con
  creación de certificado autofirmado. Mas adelante aladiremos como asociar 
  un nombre de dominio incluso con servidor dns propio, y con certificado para
  htts de LetsEncrypt

---

## 6. Puntos abiertos

Se listan aquí con su justificación, no porque no importen.

- **Custodia en la instancia pública** (§2). El diseño previsto es un esquema de
  dos mitades: una en el servidor y otra en el navegador del usuario, que se
  combinan para derivar la semilla de trades. Ninguna mitad por separado deriva
  nada, de modo que un volcado de la base de datos deja de exponer claves. La
  contrapartida es que el monitor no puede notificar el detalle de los trades
  creados en ese modo. Está previsto como opción activable por el usuario, no
  como cambio forzoso.

- **Retención de eventos en claro.** El módulo archiva eventos Nostr crudos en
  `NSTR_EVENTS` con fines de depuración. Un volcado de la base de datos contiene
  por tanto ciphertext y claves juntos. Previsto: dejar de almacenar el campo
  `content` de estos eventos.

- **Retención de claves de trades cerrados.** La `trade_privkey` se conserva tras
  finalizar el trade. Previsto: purgarla pasada una ventana de gracia, que debe
  cubrir la valoración de la contraparte y una posible reapertura de disputa.

- **Cobertura de protocolo pendiente de revisión.** El evento `kind 38385`
  (información de la instancia) y la traducción de la máquina de estados de las
  órdenes no han sido contrastados contra `order.rs` del daemon.

- **Superficie de servidor pendiente de revisión.** `server_monitor.php`,
  `ajax.php` y `noxtrstore.class.php` no han recibido una revisión completa
  posterior a la de 1.4.108.

- **Funcionalidad no implementada.** El escrow con Cashu (`AddCashuEscrow`,
  `CashuEscrowLocked`, `CashuPmSignature`) y la parte de administración de
  fianzas (`BondResolution` en `AdminSettle`/`AdminCancel`) no están
  implementados. El lado de usuario de las fianzas sí lo está.

- **Modo reputación con firmadores remotos.** No está disponible con NIP-46 ni
  con extensiones NIP-07: la prueba de identidad del transporte v2 requiere
  firmar Schnorr sobre un hash suelto, primitiva que esos firmadores no exponen.
  Es una limitación del protocolo, no de Noxtr, y afecta igualmente a otros
  clientes Mostro.

---

## 7. Reportar una vulnerabilidad

* Telegram: https://t.me/noxtr_client
* Canal Noxtr en Nostr: note1300nw6a8wqrvz6c4u83gaty6t4rqkgjacu37lwpsvmhf5zh9ndps48ltet
* DM a NPUB npub1crc3ew0agrhj9h4ry8tyle95fxyu430q87e08tl7l409wylzm90s6t3cam

Se agradece el reporte responsable. Si el hallazgo afecta a fondos o a claves de
usuarios, se agradece un margen razonable antes de la divulgación pública para
poder desplegar el arreglo en las instancias afectadas.

---

## 8. Alcance de este documento

Las revisiones descritas en §4 no son auditorías formales de terceros
independientes. Que un punto no aparezca listado significa que no se ha
encontrado, no que no exista.
