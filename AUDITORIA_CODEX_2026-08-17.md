# Auditoría estática de `_modules_/noxtr`

**Fecha:** 2026-08-17  
**Auditor:** Codex  
**Versión:** copia local descargada del webserver el 2026-08-17  
**Alcance:** revisión estática. No se han modificado archivos ni se han ejecutado pruebas PHP/Node.

**Actualización posterior:** se ha eliminado del monitor el canal de control NIP-17/kind 1059. El control administrativo queda únicamente en kind 4/NIP-04, cuyo evento firmado ya se verifica.

## Resumen

Noxtr es un módulo ExtFW que combina cliente Nostr, perfiles, relays, mensajes, canales, zaps Lightning, LNURL/NIP-05, trades Mostro, escrow on-chain y un monitor CLI.

El riesgo más importante detectado inicialmente estaba en el canal de control NIP-17 del monitor. Ese canal ya ha sido eliminado; el control administrativo queda en `kind:4`/NIP-04 con firma verificada. Persisten como prioridades el almacenamiento en claro de claves privadas, los SSRF en peticiones Lightning/imágenes y la creación pública ilimitada de facturas BTCPay.

También son prioritarios el almacenamiento en claro de claves privadas, los SSRF en peticiones Lightning/imágenes y la creación pública ilimitada de facturas BTCPay.

## Hallazgos críticos

### C-01 — Bypass de autorización en control NIP-17 del monitor — RESUELTO

La versión auditada originalmente tenía este problema: `NostrCrypto::unwrapGiftWrap()` descifraba el gift wrap, el seal y el rumor, pero no verificaba firmas antes de que `handleControlGiftWrap()` confiara en el `pubkey` del rumor.

El código afectado se ha retirado del monitor. Ya no se suscribe a gift wraps para comandos, ni procesa `kind:1059` como control, ni responde por NIP-17. Los comandos usan el flujo existente `kind:4`/NIP-04, con autor filtrado y firma verificada.

Evidencias:

- `server_monitor.php:2693-2706`
- `nostrcrypto.class.php:334-347`

Medida aplicada:

- Eliminado `buildControlGiftWrapFilter()`.
- Eliminado `handleControlGiftWrap()`.
- Eliminado `sendControlGiftWrap()` y la selección de respuesta NIP-17.
- El filtro administrativo activo sigue siendo `kind:4` con `authors` autorizados.

## Hallazgos altos

### H-01 — Claves privadas almacenadas en claro — PARCIALMENTE RESUELTO (2026-08-22)

`trade_privkey` (y la semilla Mostro en `CLI_USER_CFG`) ya se guardan cifrados en reposo con AES-256-GCM — ver `CLAUDE.md` § "Custodia de claves". **Siguen en claro**: URI NWC, `monitor_privkey`, clave privada del servidor LNURL. Verificado (2026-08-22): `api.php` sigue vacío, no hay verificación de firma NIP-57 en `raw.php`, las tablas siguen en `MyISAM` — el resto de este informe sigue vigente sin cambios.

Se guardaban directamente en base de datos `trade_privkey`, URI NWC, `monitor_privkey` y la clave privada del servidor LNURL. El ocultamiento visual en el panel no es una protección criptográfica.

Evidencias:

- `noxtrstore.class.php:266`
- `noxtrstore.class.php:1414-1428`
- `noxtrstore.class.php:1670-1685`
- `ajax.php:317-328`

Impacto:

- Una filtración de DB/backups puede permitir firmar trades.
- Una URI NWC puede autorizar pagos desde el wallet conectado.
- La clave del monitor permite suplantar al monitor.

Recomendación:

- Cifrado en reposo con una clave fuera de la base de datos.
- No devolver secretos completos salvo operación explícita de recuperación.
- Separar claves por finalidad y rotarlas si han estado expuestas.

### H-02 — SSRF mediante Lightning Address

`get_ln_invoice` recibe un dominio controlado por el usuario, consulta su `.well-known/lnurlp` y luego sigue el callback devuelto por el servidor remoto.

Evidencia: `ajax.php:267-306`.

Recomendación:

- Validar hostname y esquema.
- Resolver y bloquear rangos privados, loopback, link-local, metadata cloud y redes internas.
- Desactivar redirecciones o validar cada salto.
- Aplicar límites de respuesta y rate limiting.

### H-03 — SSRF/DoS al cachear imágenes Nostr

`cache_nostr_images` acepta URLs HTTPS/HTTP, sigue redirecciones y descarga el cuerpo completo sin límite de bytes ni validación real de imagen.

Evidencia: `ajax.php:815-870`.

Recomendación:

- Bloquear IPs privadas y redirecciones hacia ellas.
- Límite estricto de tamaño.
- Validar y re-encodear la imagen con una librería de imágenes.
- Asegurar que `media/` no ejecuta scripts.

### H-04 — Creación pública de facturas BTCPay

`btcpay_pay` crea facturas usando la API key del servidor sin autenticación ni rate limit. Además, acepta una URL externa de redirección.

Evidencias: `raw.php:360-404`.

Recomendación:

- Permitir únicamente importes, monedas y destinos esperados por el shortcode.
- Firmar los parámetros o asociarlos a una sesión/nonce.
- Rate limit por IP y por sesión.
- Permitir redirecciones solo a una allowlist propia.

### H-05 — Firma NIP-57 no verificada

El zap request se valida estructuralmente y se recalcula su `id`, pero no se verifica la firma Schnorr.

Evidencias: `raw.php:210-263`, `raw.php:513-526`.

Recomendación:

- Verificar `sig` contra `pubkey` y `id` antes de incluir el zap request en la operación.
- Validar tags duplicados o contradictorios y exigir recipient/amount cuando el protocolo lo requiera.

## Hallazgos medios

### M-01 — Relays arbitrarios usados por el monitor

Un usuario autenticado puede registrar URLs `ws://` o `wss://`. El monitor agrega los relays activos de todos los usuarios y conecta desde el servidor.

Evidencias: `ajax.php:644-652`, `noxtrstore.class.php:1454-1460`.

Riesgos: SSRF, conexiones a servicios internos, consumo de recursos y relay malicioso.

Recomendación: separar relays de usuario y relays del monitor, o aplicar allowlist y validación de resolución/IP.

### M-02 — El módulo no envía el token CSRF

El framework valida todos los POST, pero `footer.php` no pasa `csrfToken` a `Noxtr.init()`. `script.js` solo añade el token si existe.

Evidencias: `footer.php:10-29`, `script.js:280-295`, `_includes_/run.php:175-185`.

Impacto actual probable: las operaciones AJAX normales fallan. Es principalmente un fallo funcional; si alguna ruta evita la validación central, también sería un riesgo CSRF.

Recomendación: pasar el token generado por ExtFW y mantener la validación server-side independiente.

### M-03 — Notificaciones Telegram de DMs sin verificar firma

El monitor puede notificar un DM `kind:4` dirigido a un usuario sin comprobar la firma del evento.

Evidencia: `server_monitor.php:2551-2597`.

Riesgo: spam y notificaciones engañosas.

Recomendación: verificar `id`, firma, pubkey, timestamps y destinatario antes de notificar.

### M-04 — Estado de trades controlado por el cliente

`mostro_trade_update` permite actualizar múltiples campos sensibles enviados desde JavaScript y devuelve `ok` aunque la actualización falle. No existe una máquina de estados server-side.

Evidencias: `ajax.php:1037-1060`, `noxtrstore.class.php:1070-1090`.

Riesgo: corrupción del estado local, pérdida de monitorización y UI incoherente. Actualmente afecta principalmente al propio usuario, pero no debe considerarse fuente de verdad para fondos.

Recomendación: validar transiciones, propietario, campos derivados y resultados SQL en servidor.

### M-05 — Logs de raw activados permanentemente

Cada petición raw escribe URI y argumentos completos en `lnurlp_.log`, incluyendo potencialmente datos sensibles y entradas de tamaño arbitrario.

Evidencia: `raw.php:55-68`, `raw.php:199-200`.

Recomendación: desactivar por defecto, rotar logs, limitar tamaño y eliminar secretos antes de registrar.

### M-06 — Proxy de broadcast Bitcoin sin rate limit ni vinculación de operación

Un usuario autenticado puede enviar una transacción arbitraria a Bitcoin Core o mempool.space.

Evidencia: `ajax.php:1460-1499`.

La transacción debe estar firmada para gastar fondos, pero el endpoint puede abusarse como proxy de difusión y consumir recursos.

Recomendación: rate limit, auditoría, asociación al trade y límites de tamaño/frecuencia más estrictos.

## Fallos funcionales y de diseño

### F-01 — `api.php` está vacío

`index.php` envía `/noxtr/api` y las acciones `monitor_*` a `api.php`, pero el archivo tiene tamaño cero. La API multisite documentada en `server_monitor.php` no puede funcionar en esta copia.

Evidencias:

- `index.php:35-45`
- `api.php` — 0 bytes
- `server_monitor.php:1033-1049`

### F-02 — Tablas MySQL `MyISAM`

Las tablas `NSTR_*`, incluida `NSTR_TRADES`, se crean con `ENGINE=MyISAM`, que no proporciona transacciones reales.

Evidencia: `noxtrstore.class.php:172-297`.

Recomendación: migrar a InnoDB y revisar operaciones compuestas.

### F-03 — Uso de `HTTP_HOST` para construir URLs operativas

LNURL callbacks, webhooks y polling se construyen usando `HTTP_HOST`.

Evidencias: `raw.php:161-178`, `raw.php:276-329`.

Recomendación: usar un host canónico de configuración y validar el `Host` en nginx/Apache.

## Controles positivos observados

- Consultas SQL principales parametrizadas.
- Operaciones normales limitadas por `user_id`.
- Transferencias internas con transacción y comprobación de filas afectadas.
- Validación de redes Bitcoin y de formatos de transacción.
- El canal NIP-04 directo del monitor sí verifica firma mediante `NostrAuth::verifyEvent()`.
- Hay límites para algunos listados y trades.

## Prioridad recomendada

1. Rotar cualquier clave que haya podido estar expuesta y diseñar cifrado de secretos.
2. Eliminar SSRF en LNURL e imágenes.
3. Proteger/rate-limitar la creación de facturas BTCPay.
4. Verificar firmas NIP-57.
5. Resolver CSRF del cliente.
6. Separar y validar los relays del monitor.
7. Implementar o retirar claramente la API vacía `api.php`.

## Limitaciones de esta auditoría

- No se ejecutó PHP ni Node porque no están instalados localmente.
- No se probaron configuraciones reales de nginx/Apache, permisos de `media/` y logs, cabeceras, firewall ni credenciales.
- No se ejecutaron pruebas contra BTCPay, Bitcoin Core, relays Nostr o Telegram.
- Los hallazgos dependientes de configuración deben confirmarse en el webserver.
