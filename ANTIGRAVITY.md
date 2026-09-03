# Informe Técnico: Módulo `noxtr` (Cliente Nostr Descentralizado)

Este documento detalla la arquitectura, el funcionamiento interno, la estructura de base de datos y los protocolos implementados en el módulo `noxtr` dentro del ecosistema **ExtFW 3.0**.

---

## 1. Resumen y Propósito del Módulo
`noxtr` es un cliente web completo y descentralizado para el protocolo **Nostr**, totalmente integrado en la arquitectura del framework `ExtFW`. Además de proporcionar funciones sociales (feed, hilos de conversación, perfiles, seguimiento de usuarios y temas), actúa como una pasarela para operaciones financieras P2P mediante la integración del protocolo **Mostro** (compraventa de Bitcoin peer-to-peer sin custodia) y soporte experimental de monederos on-chain y Lightning (NIP-57, LNURL-pay).

---

## 2. Mapa de Archivos y Responsabilidades

El módulo se compone de los siguientes archivos clave:

| Archivo | Responsabilidad |
|---|---|
| **`init.php`** | Inicialización del módulo. Configura el motor DB en `scaffold`, llama a `NoxtrStore::ensureTables()` para verificar tablas e inicializa funciones de roles (`Administrador()`, `Root()`, `Cliente()`, `Usuario()`). |
| **`after_init.php`** | Ejecutado después del inicio del núcleo. Modifica dinámicamente las cabeceras CSP de respuesta (`connect_src`, `media_src`, `frame_src`) agregando dominios de relays Nostr y servidores multimedia. |
| **`index.php`** | Enrutador interno del módulo. Deriva la ejecución hacia controladores específicos según el valor de `OUTPUT` (`ajax`, `html`, `server`, `raw`, `api`, `pdf`) o parámetros secuenciales (`/trades`, `/disputes`, `/admin`, `/install`). |
| **`run.php`** | Controlador principal HTML. Renderiza la estructura de la aplicación cliente: barra de navegación de pestañas, barra lateral con perfiles sugeridos, temas, relays, y contenedores para el feed e hilos. |
| **`head.php`** | Inyecta las dependencias CSS y JS específicas de noxtr con control de versión (`?ver=$version`) para evitar caché obsoleta. Carga librerías criptográficas de Bitcoin y QR. |
| **`footer.php`** | Script de cierre que arranca la aplicación JS ejecutando `Noxtr.init()` con la configuración de sesión y asocia el callback de carga de imágenes para sincronizar avatars y banners. |
| **`ajax.php`** | Backend de servicios asíncronos. Gestiona suscripción a topics, bookmarks, borrado de DMs, zaps internos/externos, publicación de artículos largos, y consulta de reputación Mostro. |
| **`raw.php`** | Sirve los endpoints de integración pública: `.well-known/nostr.json` (NIP-05) y `.well-known/lnurlp/USERNAME` (Lightning Address / NIP-57). |
| **`noxtrstore.class.php`** | Capa de abstracción de datos. Contiene los métodos para crear tablas y ejecutar queries preparadas, garantizando la compatibilidad dual entre MySQL y SQLite. |
| **`nostrcrypto.class.php`** | Lógica criptográfica backend. Implementa firmas Schnorr (BIP-340) en PHP para el par de claves del servidor necesarias en interacciones NIP-57/LNURL. |
| **`server_monitor.php`** | Demonio/script que monitoriza de forma continua el estado de los canales y trades activos de los usuarios. Envía notificaciones de Telegram e email sobre cambios de estado. |
| **`script.js`** | Lógica core del cliente Nostr. Administra el Pool de WebSockets, caché de perfiles, suscripciones a eventos, cifrado NIP-04/NIP-44, firmas con extensiones NIP-07 o Nostr Connect NIP-46. |
| **`script.mostro.js`** | Lógica de la integración con Mostro P2P. Controla la derivación de claves efímeras para trades, envoltura/desenvoltura de Gift Wraps (NIP-59) y la máquina de estados. |
| **`script.onchain.js`** | Lógica cliente para operaciones on-chain avanzadas (derivación de direcciones, transacciones Taproot). |
| **`style.css` y `style.mostro.css`** | Hojas de estilo visuales para la interfaz del cliente y las fichas de trade P2P. |

---

## 3. Modelo de Datos: Tablas `NSTR_*`
La persistencia se maneja en `noxtrstore.class.php` mediante consultas preparadas compatibles tanto con SQLite como con MySQL/MariaDB:

1. **`NSTR_CONTACTS`**: Lista de usuarios seguidos por cada cuenta local. Evita tener que resolver la lista completa directamente desde relays en cada carga.
2. **`NSTR_TOPICS`**: Tags o hashtags temáticos a los que se ha suscrito el usuario.
3. **`NSTR_BOOKMARKS`**: Notas/eventos marcados como favoritos de forma persistente.
4. **`NSTR_MESSAGES`**: Historial local y caché de mensajes directos cifrados.
5. **`NSTR_RELAYS`**: Direcciones de relays WebSocket. Se autosemillas con un conjunto por defecto si la base está vacía.
6. **`NSTR_MUTED`**: Lista de pubkeys silenciadas por el usuario.
7. **`NSTR_CHANNELS`**: Canales de chat públicos (NIP-28) a los que se ha unido el usuario.
8. **`NSTR_TRADES`**: Registro y seguimiento de transacciones Mostro (Lightning) y NostrEscrow (On-chain), incluyendo estados, roles, importes, firmas Taproot y claves efímeras de trade.
9. **`NSTR_EVENTS`**: Registro histórico de eventos procesados para evitar re-procesamientos de DMs (deduplicación) y control de notificaciones de disputas.
10. **`NSTR_NOXTR_SITES`**: Sitios remotos configurados para el monitor multi-sitio.
11. **`NSTR_NIP96_SERVERS`**: Servidores multimedia (NIP-96) preferidos por el usuario para subida de archivos.

---

## 4. Arquitectura Frontend JavaScript
La lógica del lado del cliente está estructurada en módulos internos expuestos bajo el espacio de nombres global `window.Noxtr` mediante un patrón IIFE:

* **Gestión del Pool (`Noxtr.Pool`)**: Coordina las conexiones concurrentes a múltiples relays mediante WebSockets. Se encarga de multiplexar suscripciones (`REQ`) y publicar eventos (`EVENT`), deduplicando información por ID de evento (`_seen` de Stats) para evitar consumos redundantes.
* **Mapeo de Identidad y Firmas (`Noxtr.Events`)**: Soporta tres vías para firmar eventos:
  1. **NIP-07**: Extensiones de navegador (Alby, nos2x) de forma asíncrona.
  2. **NIP-46 (Nostr Connect)**: Envía solicitudes de firma remotas a través de un relay intermediario (estado guardado en `localStorage`).
  3. **nsec directo**: Entrada de clave privada en texto plano (cifrada temporalmente en memoria).
* **Cifrado y Desencriptado**:
  - Implementa **NIP-04** para DMs clásicos.
  - Implementa **NIP-44** para DMs modernos mediante XChaCha20-Poly1305 + derivación HKDF-SHA256 (necesario para NIP-46 y la mensajería interna con instancias Mostro).
* **Sesión criptográfica Mostro**: Usa una semilla BIP39 propia; deriva la identidad en `m/44'/1237'/38383'/0/0` y cada trade key en el índice `N` de la misma ruta. La restauración desde Mostro Mobile queda pendiente hasta implementar el flujo completo.

---

## 5. Integración Mostro P2P y Disputas

Mostro opera sobre un flujo de mensajería asíncrona cifrada utilizando **Gift Wraps (NIP-59)** para asegurar la máxima privacidad de los participantes.

### Flujo de Estados y FSM (Máquina de Estados)
Para evitar corrupciones por mensajes duplicados u obsoletos recibidos de relays desincronizados:
1. **Validación en BD**: `NoxtrStore::saveTrade` implementa un ranking estricto de transiciones (`$stateRank`). Un estado no puede retroceder en BD (ej. de `fiat-sent` no puede volver a `active`).
2. **Máquina de estados en JS**: Implementa una FSM suave (`_fsmAllows`) que evalúa las acciones válidas permitidas según el rol actual del usuario (comprador o vendedor) y el estado del trade. Emite advertencias en consola si se detecta un comportamiento fuera de flujo pero no interrumpe operaciones para tolerar saltos de la instancia.

### Gestión de Disputas
Sigue la especificación del protocolo de disputas de Mostro:
* **Inicio de Disputa**: Botón visible para trades activos o con fiat enviado. Publica el evento `dispute` a la instancia.
* **Asignación del Solver**: Al recibir `admin-took-dispute`, se captura la pubkey del solver (`solver_pubkey`) y se deriva la clave de chat común `_disputeChatKey = ECDH(trade_privkey, solver_pubkey)`.
* **Chat Seguro**: Se inicia un flujo de chat cifrado NIP-59 directo con el administrador (solver). noxtr implementa un filtro de seguridad estricto que descarta cualquier mensaje cuya clave de firma no provenga de la instancia o del solver asignado.
* **Resolución**: Se permite la transición forzada desde `disputado` hacia `completado` (si el admin resuelve liberar) o `cancelado` (si el admin resuelve cancelar).

---

## 6. Protocolos Nostr Soportados

| Protocolo | Detalle |
|---|---|
| **NIP-01** | Estructura básica de eventos, tags y protocolo de comunicación con relays. |
| **NIP-02** | Listas de contactos (`kind 3`). Publica la lista completa a relays al seguir/dejar de seguir a un usuario. |
| **NIP-04** | Mensajes directos cifrados tradicionales. |
| **NIP-05** | Validación de nombres de usuario mediante DNS (`nostr.json` servido por `raw.php`). |
| **NIP-07** | Interfaz con extensiones de firmas de navegador. |
| **NIP-10** | Convenciones de marcado para respuestas e hilos de notas. |
| **NIP-17** | Mensajería privada basada en Gift Wraps / Rumores. |
| **NIP-19** | Codificación y decodificación bech32 (`npub`, `nsec`, `note`). |
| **NIP-23** | Artículos largos o publicaciones de blog (`kind 30023`). |
| **NIP-25** | Reacciones (`kind 7`, Likes). |
| **NIP-28** | Canales públicos de chat (`kinds 40/41/42`) y borrado NIP-09 de mensajes de canal. |
| **NIP-44** | Cifrado seguro utilizando algoritmos criptográficos modernos. |
| **NIP-46** | Nostr Connect para control y firma remota de identidades. |
| **NIP-56** | Informes de reporte de spam/contenido malicioso (`kind 1984`). |
| **NIP-57** | Zaps Lightning a perfiles y notas (`kinds 9734/9735`). |
| **NIP-59** | Envoltura Gift Wrap (`kind 1059`) para anonimato de metadatos en DMs y Mostro. |
| **NIP-65** | Listas de relay del usuario (`kind 10002`). |
| **NIP-96** | Protocolo de servidores de almacenamiento de ficheros (nostr.build y similares). |

---

## 7. Puntos Críticos y Riesgos Detectados

1. **Riesgo en la Generación de ID de Orden (`tmp-...`)**: Al crear una orden en noxtr, se genera un ID temporal en la BD local antes de enviarlo a la instancia. Si la respuesta con el UUID definitivo se pierde o falla, el cliente no asociará la orden del order book con el usuario. Aunque el riesgo práctico es bajo gracias a las confirmaciones reiteradas, un diseño robusto futuro debería aislar estas órdenes en estado provisional antes de persistirlas.
2. **Defensa en Profundidad en CSP**: El archivo `after_init.php` amplía las directivas CSP para permitir relays externos. Si un relay WebSocket usa un puerto no estándar o un esquema inusual, podría ser bloqueado por el navegador del cliente si no se añade correctamente a la lista de orígenes válidos.
3. **Control de Duplicados en `_seenDmIds`**: Para evitar el procesamiento duplicado de Gift Wraps concurrentes desde relays diferentes, el ID del mensaje se añade a un buffer local. Si un error de ejecución en JS interrumpe el flujo a mitad del proceso, el mensaje se marcará como visto pero no se procesará su lógica asociada, silenciándolo. El cliente corrige esto marcando la confirmación de visto únicamente al completar con éxito el bloque `switch/case`.

---

## 8. Backlog e Ideas de Desarrollo Futuro

* **Sincronización NIP-51**: Migrar la persistencia local de listas (mute list `10000`, bookmarks `10003`, canales `10005`, topics `10015`) hacia los relays de forma autoritativa mediante eventos Nostr, mejorando la portabilidad del cliente.
* **Integración NIP-46 en Login**: Permitir a los usuarios loguearse directamente en el framework `ExtFW` escaneando un código QR con su aplicación firmante Nostr Connect, asociando la sesión de PHP con la pubkey Nostr del usuario.
* **Indexadores Descentralizados (eMule / Torrents)**: Implementar `NIP-ED2K` (directorio descentralizado de enlaces de eMule) y soporte básico para indexar imanes de Torrents mediante `kind 2003`.
