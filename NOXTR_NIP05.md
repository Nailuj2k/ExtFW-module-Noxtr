# NIP-05 — Verificación de Identidad Nostr en Noxtr

> Este documento explica cómo funciona NIP-05 en Noxtr, tanto para **usuarios** que quieren obtener su dirección Nostr verificada, como para **desarrolladores** que necesitan entender la implementación técnica.

---

## PARA USUARIOS

### ¿Qué es NIP-05?

NIP-05 es un estándar de Nostr que permite verificar tu identidad asociando tu clave pública (pubkey) a un nombre de usuario en un dominio. Funciona de forma similar a un email:

```
usuario@dominio.com
```

Cuando otros clientes Nostr ven tu dirección NIP-05 (por ejemplo `pepe@queesbitcoin.net`), pueden verificar que realmente controlas esa clave pública preguntándole al servidor de ese dominio.

### ¿Qué dirección me asigna Noxtr?

Tu dirección NIP-05 es automáticamente:

```
tu_usuario@dominio_de_tu_web.com
```

**Ejemplos:**
- Si tu web es `queesbitcoin.net` y tu usuario es `pepe` → `pepe@queesbitcoin.net`
- Si instalas Noxtr en `laotraweb.com` y tu usuario es `pepe` → `pepe@laotraweb.com`

La dirección siempre usa **el dominio de la web donde está instalado Noxtr**, no el de ningún servicio externo.

### ¿Cómo obtengo mi NIP-05?

1. **Inicia sesión** en tu web ExtFW
2. Ve al módulo **Noxtr**
3. Haz clic en el botón de **editar perfil** (lápiz junto a tu nombre)
4. Completa tu nombre y datos
5. Haz clic en **Save**

Noxtr automáticamente:
- Asigna tu NIP-05 como `tu_usuario@tu_dominio`
- Publica tu perfil Nostr (kind 0) con el campo `nip05` configurado
- Guarda tu pubkey en la base de datos (`CLI_USER.nostr_pubkey`)

No necesitas escribir la dirección NIP-05 manualmente — se auto-rellena al guardar si estás logueado.

### ¿Cómo sé que funciona?

Cualquier cliente Nostr (Damus, Amethyst, Primal, Coracle, etc.) mostrará un check o insignia de verificación junto a tu nombre cuando detecte que tu NIP-05 es válido.

También puedes comprobarlo manualmente con esta URL en tu navegador:

```
https://tu-dominio.com/.well-known/nostr.json?name=tu_usuario
```

Debería devolver algo como:

```json
{
  "names": {
    "pepe": "a1b2c3d4e5f6...tu_pubkey_hex_64_caracteres..."
  }
}
```

### Preguntas frecuentes (usuarios)

**¿Puedo tener la misma NIP-05 en dos webs distintas?**
No. Cada instalación de Noxtr genera direcciones con su propio dominio. Si tu usuario se llama `pepe` en ambas webs, tendrás `pepe@web1.com` y `pepe@web2.com`.

**¿Qué pasa si cambio mi clave Nostr (nsec)?**
Necesitas guardar tu perfil de nuevo para que la nueva pubkey se actualice en la base de datos y el NIP-05 apunte a la clave correcta.

**¿Funciona sin BTCPay Server?**
Sí. NIP-05 es completamente independiente de Lightning/BTCPay. BTCPay solo es necesario para zaps (NIP-57) y Lightning Addresses (LNURL-pay).

**¿Y la Lightning Address?**
La Lightning Address (`pepe@queesbitcoin.net`) usa el mismo formato pero es un protocolo diferente (LNURL-pay). Noxtr también la configura automáticamente al guardar el perfil, pero requiere BTCPay Server configurado. Ver la sección de LNURL-pay en `CLAUDE.md`.

---

## PARA DESARROLLADORES

### Resumen técnico

NIP-05 define un mecanismo de verificación de identidad basado en HTTP:

1. El usuario publica un perfil Nostr (kind 0) con el campo `nip05` = `usuario@dominio.com`
2. Cualquier cliente Nostr puede verificarlo haciendo `GET https://dominio.com/.well-known/nostr.json?name=usuario`
3. El servidor responde con `{ "names": { "usuario": "<hex_pubkey>" } }`
4. El cliente compara la pubkey devuelta con la pubkey del evento kind 0

### Flujo de URL routing

La cadena completa de cómo una petición `.well-known/nostr.json` llega al handler:

```
1. Cliente Nostr hace:
   GET https://miweb.com/.well-known/nostr.json?name=pepe

2. Apache (.htaccess):
   RewriteCond %{REQUEST_URI} ^\.well-known/
   RewriteRule ^(.*)$ index.php [L,QSA]  →  pasa TODO a index.php

3. ExtFW init (_includes_/run.php, líneas 20-39):
   Detecta que REQUEST_URI empieza por /.well-known/
   Reescribe la URL interna:
     .well-known/nostr.json?name=pepe
       → noxtr/raw/wellknown/action=nostr.json/name=pepe

4. ExtFW Router:
   Parsea la URL reescrita:
     $_ARGS[0] = 'noxtr'       → módulo = noxtr
     $_ARGS[1] = 'raw'         → OUTPUT = 'raw'
     $_ARGS[2] = 'wellknown'
     $_ARGS['action'] = 'nostr.json'
     $_ARGS['name'] = 'pepe'

5. Módulo Noxtr (index.php):
   OUTPUT === 'raw'  →  include('raw.php')

6. raw.php:
   switch ($action) → case 'nostr.json':
   Consulta CLI_USER.nostr_pubkey
   Devuelve JSON NIP-05
```

### Archivos involucrados

| Archivo | Rol |
|---------|-----|
| `_includes_/run.php` | Intercepta URLs `.well-known/` y las reescribe a `noxtr/raw/wellknown/...` |
| `.htaccess` | Regla Apache: `RewriteCond %{REQUEST_URI} ^\.well-known/` → `index.php` |
| `_modules_/noxtr/index.php` | Detecta `OUTPUT === 'raw'` y carga `raw.php` |
| `_modules_/noxtr/raw.php` | Handler NIP-05: case `nostr.json` — consulta DB y devuelve JSON |
| `_modules_/noxtr/script.js` | Auto-configura `nip05` al guardar perfil (línea ~2225) |
| `_modules_/noxtr/ajax.php` | `save_profile`: guarda `nostr_pubkey` en `CLI_USER` |
| `_modules_/noxtr/run.php` | Campo `#profile-nip05` en el editor de perfil |

### Backend: raw.php — case `nostr.json`

```php
case 'nostr.json':
    // Validar nombre (solo alfanuméricos, punto, guión, guión bajo)
    if (!$name || !preg_match('/^[a-zA-Z0-9._-]+$/', $name)) {
        echo json_encode(['names' => new stdClass()]);
        exit;
    }

    // Buscar usuario activo con pubkey configurada
    $rows = NoxtrStore::sqlQueryPrepared(
        "SELECT username, nostr_pubkey FROM CLI_USER
         WHERE username = ? AND user_active = '1' AND nostr_pubkey != ''
         LIMIT 1",
        [$name]
    );
    $user = $rows[0] ?? null;

    if (!$user) {
        echo json_encode(['names' => new stdClass()]);
        exit;
    }

    echo json_encode([
        'names' => [$user['username'] => $user['nostr_pubkey']]
    ]);
    exit;
```

**Headers de respuesta:**
```
Content-Type: application/json
Access-Control-Allow-Origin: *
```

El `Access-Control-Allow-Origin: *` es obligatorio porque los clientes Nostr (que corren en otros dominios) hacen peticiones cross-origin.

### Frontend: auto-configuración al guardar perfil

En `script.js`, al guardar el perfil:

```javascript
// Auto-set nip05 and lud16 if user is registered
if (Api.username) {
    profile.nip05 = Api.username + '@' + location.hostname;
    profile.lud16 = Api.username + '@' + location.hostname;
}
```

Esto significa que:
- Si el usuario está logueado en ExtFW (`Api.username` no es vacío)
- Se fuerza `nip05` y `lud16` al formato `usuario@hostname`
- El campo `#profile-nip05` del formulario se ignora para usuarios logueados
- Solo usuarios sin sesión ExtFW (que entran con npub/nsec directamente) usan el campo manual

### Base de datos

La pubkey se guarda en `CLI_USER.nostr_pubkey` (VARCHAR 64, hex). Se actualiza en dos momentos:

1. **Al guardar perfil** (`ajax.php` → `save_profile`):
   ```php
   UPDATE CLI_USER SET NOSTR_USER = ?, BIO = ?, nostr_pubkey = ? WHERE USER_ID = ?
   ```

2. **Al hacer login con Nostr** (módulo login): guarda `auth_id` (la pubkey) en la sesión, y al registrarse se persiste en `CLI_USER`.

### Requisitos para que NIP-05 funcione

1. **Apache**: la regla `.well-known → index.php` debe estar en el `.htaccess` raíz:
   ```apache
   RewriteCond %{REQUEST_URI} ^\.well-known/
   RewriteRule ^(.*)$ index.php [L,QSA]
   ```

2. **Nginx**: equivalente en configuración del server:
   ```nginx
   location ^~ /.well-known/ {
       rewrite ^/.well-known/(.*)$ /index.php?/$1 last;
   }
   ```

3. **`_includes_/run.php`**: el bloque que reescribe `.well-known` a `noxtr/raw/wellknown` (líneas 20-39) **NO debe eliminarse**

4. **HTTPS**: obligatorio. Los clientes Nostr solo verifican NIP-05 sobre HTTPS

5. **Usuario activo**: `CLI_USER.user_active = '1'` — usuarios desactivados no responden NIP-05

6. **Pubkey guardada**: `CLI_USER.nostr_pubkey != ''` — el usuario debe haber guardado su perfil al menos una vez

### Multi-dominio / Multi-instalación

Si instalas Noxtr en varias webs:

| Web | Usuario | NIP-05 | nostr.json servido por |
|-----|---------|--------|----------------------|
| `queesbitcoin.net` | pepe | `pepe@queesbitcoin.net` | `queesbitcoin.net/.well-known/nostr.json` |
| `laotraweb.com` | pepe | `pepe@laotraweb.com` | `laotraweb.com/.well-known/nostr.json` |

- Cada instalación tiene su **propia base de datos** (`CLI_USER`)
- Cada dominio sirve su **propio `nostr.json`**
- Compartir BTCPay Server entre instalaciones **no afecta** a NIP-05
- Un mismo par de claves Nostr (nsec/npub) puede tener NIP-05 en un solo dominio a la vez (el campo `nip05` del kind 0 solo admite un valor)

### Respuestas de error

| Caso | Respuesta HTTP | Body |
|------|---------------|------|
| Nombre inválido (caracteres no permitidos) | 200 | `{"names":{}}` |
| Usuario no encontrado | 200 | `{"names":{}}` |
| Usuario inactivo | 200 | `{"names":{}}` |
| Usuario sin pubkey | 200 | `{"names":{}}` |
| Usuario válido | 200 | `{"names":{"pepe":"abc123..."}}` |

> **Nota**: NIP-05 especifica devolver 200 con `names` vacío (no 404) cuando el usuario no existe.

### Extensiones posibles

#### Relays recomendados
NIP-05 permite opcionalmente incluir relays recomendados para un usuario:

```json
{
  "names": { "pepe": "abc123..." },
  "relays": { "abc123...": ["wss://relay.damus.io", "wss://nos.lol"] }
}
```

Actualmente Noxtr **no implementa** el campo `relays`. Para añadirlo, habría que consultar `NSTR_RELAYS` del usuario y añadirlo a la respuesta en `raw.php`.

#### Wildcard `_`
Algunos servicios usan el nombre `_` como identidad raíz del dominio (`_@dominio.com` se muestra como `dominio.com`). Noxtr no lo implementa, pero se podría añadir como caso especial vinculado al administrador del sitio.

---

## Diagrama de flujo

```
┌──────────────┐    GET /.well-known/nostr.json?name=pepe    ┌──────────────┐
│ Cliente Nostr│ ───────────────────────────────────────────► │   Apache /   │
│  (Damus,     │                                              │   Nginx      │
│  Amethyst,   │ ◄─────────────────────────────────────────── │              │
│  Primal...)  │    {"names":{"pepe":"<hex_pubkey>"}}          └──────┬───────┘
└──────────────┘                                                     │
                                                                     │ Rewrite → index.php
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ init.php     │
                                                              │ Reescribe:   │
                                                              │ → noxtr/raw/ │
                                                              │   wellknown  │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ noxtr/       │
                                                              │ index.php    │
                                                              │ OUTPUT=raw   │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ raw.php      │
                                                              │ nostr.json   │
                                                              │ case         │
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ CLI_USER     │
                                                              │ .nostr_pubkey│
                                                              └──────────────┘
```

```
┌──────────────┐    Guardar perfil                            ┌──────────────┐
│ Usuario ExtFW  │ ───► script.js                               │ CLI_USER     │
│ (navegador)  │      auto-set nip05 =                        │              │
│              │      usuario@hostname   ───► ajax.php ──────►│ nostr_pubkey │
│              │                              save_profile    │              │
│              │      publishProfile(kind 0) ───► Relays      └──────────────┘
└──────────────┘      con nip05 en el JSON
```

---

## Checklist de verificación

- [ ] `.htaccess` tiene la regla `.well-known → index.php`
- [ ] `_includes_/init.php` tiene el bloque de reescritura `.well-known → noxtr/raw/wellknown`
- [ ] El usuario ha guardado su perfil al menos una vez (para que `nostr_pubkey` exista en DB)
- [ ] La web tiene HTTPS activo
- [ ] `curl https://tu-dominio.com/.well-known/nostr.json?name=tu_usuario` devuelve la pubkey correcta
- [ ] El perfil Nostr (kind 0) del usuario tiene `nip05: "usuario@dominio.com"`
