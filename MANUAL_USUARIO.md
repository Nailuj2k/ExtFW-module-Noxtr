# Manual de usuario — noxtr

Guía para el usuario: qué puedes hacer con noxtr, las operaciones P2P de Bitcoin
(Mostro y on-chain), las notificaciones por email/Telegram y el bot.

> ¿Eres administrador del sitio? Mira [`MANUAL_ADMIN.md`](MANUAL_ADMIN.md).

---

## 1. ¿Qué es noxtr?

noxtr es un **cliente de Nostr** integrado en la web. Nostr es una red social
descentralizada: no hay una empresa dueña de tus datos; tú tienes una **identidad**
(un par de claves) y publicas en **relays** (servidores que reparten los mensajes).

Con noxtr puedes:
- **Publicar notas** (las "notas" son como los tuits de Twitter/X o los posts de
  Facebook: Nostr es un sustituto libre y descentralizado de ese tipo de redes), leer un
  feed, seguir a gente y usar hashtags.
- **Mensajes privados (DM)** y **chats de grupo (canales)** — el equivalente libre a
  Telegram o WhatsApp, sin un dueño central.
- Enviar y recibir **zaps** (propinas en Bitcoin Lightning).
- **Comprar y vender Bitcoin entre particulares (P2P)** con Mostro y con trades on-chain.

---

## 2. Tu identidad Nostr

Tu identidad es un par de claves:
- **npub** (clave pública): es tu "nombre de usuario", puedes compartirla.
- **nsec** (clave privada): es tu **llave maestra**. Quien la tenga, es tú. Guárdala bien
  y no la compartas con nadie.

### Formas de entrar

| Método | Qué implica |
|---|---|
| **nsec** | Entras con tu clave privada. Es tu llave maestra: el sitio la usa para firmar. |
| **Extensión del navegador (NIP-07)** | Alby, nos2x… La firma la hace la extensión: el sitio **nunca ve** tu clave privada. |
| **Nostr Connect (NIP-46)** | Firmas desde otra app (un "firmador"), normalmente escaneando un QR. El sitio tampoco ve tu clave. |
| **Solo npub** | Modo lectura: ves perfiles y feed, pero no puedes firmar ni publicar. |

> Las opciones NIP-07/NIP-46 existen para quien prefiera que el
> sitio web no maneje su clave; no son obligatorias.

### Tu perfil

Puedes editar nombre, bio, **avatar** y **banner**. Al cambiar la imagen se publica
automáticamente en Nostr.

También puedes tener una **dirección `usuario@dominio`** en este sitio, que te sirve para
dos cosas a la vez:
- **Identidad verificada (NIP-05)**: muchos clientes muestran la "marca de verificado"
  (✔️) cuando tu dirección está alojada en un dominio.
- **Dirección Lightning**: para **recibir zaps** (propinas) en esa misma dirección.

---

## 3. Funciones sociales

La navegación se organiza en pestañas: **Temas**, **Siguiendo**, **Seguidores**,
**Mensajes**, **Canales**, **Marcadores** y **Relays**.

| Función | Qué hace |
|---|---|
| **Feed** | Las notas (tuits/posts) de la gente que sigues y de los hashtags que te interesan. |
| **Siguiendo / Seguidores** | Tu lista de contactos (a quién sigues) y quién te sigue. |
| **Temas (hashtags)** | Te suscribes a `#actualidad`, `#motos`, `#bitcoin`, etc. y ves esas notas. |
| **Mensajes (DM)** | Mensajes privados cifrados con otra persona. |
| **Canales** | Salas de chat públicas estilo grupo (NIP-28): crear, unirse, escribir, invitar. |
| **Marcadores** | Guardas notas para releerlas. |
| **Silenciar / reportar** | Ocultas a un usuario (local) o reportas spam. |
| **Relays** | Eliges en qué servidores Nostr te conectas. |

### Acciones sobre una nota

Responder, dar like (❤️), repostear (🔁), **zap** (⚡ propina), guardar, seguir al
autor, mandarle DM, compartir enlace, y silenciar/reportar. Las tuyas las puedes borrar.

### Zaps (propinas Lightning ⚡)

- Si zapeas a un usuario **registrado en este sitio** y tienes saldo, se hace una
  **transferencia interna** instantánea (sin pasar por la red Lightning).
- Si no, se genera una **factura Lightning** que pagas desde tu wallet.

---

## 4. Comprar y vender Bitcoin P2P (Mostro)

Mostro es un protocolo para intercambiar Bitcoin por dinero fiat (euros, etc.) entre
particulares, con una instancia que hace de garante. **Mostro opera solo por Lightning** (sats
fuera de cadena); para Bitcoin en la blockchain, mira la sección 5 (on-chain). Todo ocurre
por mensajes cifrados en Nostr.

### Lo básico

- **Order book**: la lista de ofertas de compra/venta publicadas.
- Puedes **tomar una oferta** existente o **crear la tuya** (compra o venta).
- La instancia Mostro retiene los sats (hold invoice) hasta que ambas partes cumplen.

### Flujo típico (vendes BTC)

1. Creas o tomas una orden de venta.
2. La instancia te pide pagar una **hold invoice** (factura que retiene tus sats, no los cobra).
3. El comprador te envía el **fiat** (transferencia bancaria, etc.).
4. Compruebas que llegó el dinero y pulsas **Liberar sats**.
5. La instancia envía los Bitcoin al comprador. Trade completado ✅.

### Flujo típico (compras BTC)

1. Creas o tomas una orden de compra.
2. La instancia te pide una **factura Lightning** para recibir los sats.
3. Envías el **fiat** al vendedor y pulsas **Fiat enviado**.
4. El vendedor libera y recibes tus Bitcoin ✅.

### "Mis trades" y reputación

- Cada trade tiene una ficha con su estado, fechas y avisos si se queda atascado.
- Al terminar, **valoras a la contraparte** con estrellas. Tu reputación (⭐ media +
  nº de valoraciones) se muestra en tu panel.

### Disputas

Si algo va mal, pulsa **Disputar**. Un administrador (solver) tomará la disputa y
podrás **chatear con él** directamente desde la ficha del trade para resolverlo.

### Cancelación cooperativa

Si la contraparte pide cancelar, te aparece **Aceptar cancelación** o **Disputar**.

---

## 5. Trades on-chain (NostrEscrow)

A diferencia de Mostro (que es Lightning), los trades **on-chain** mueven Bitcoin
directamente en la blockchain. **No usan la instancia Mostro**: la garantía es una
**transacción multifirma** (multisig) entre las partes y uno o varios **árbitros**.

El flujo es parecido (crear/tomar, financiar el escrow, enviar fiat, recibir, completar),
pero el papel de garante lo cumple el multisig + árbitros en vez de la instancia. Si hay
conflicto, interviene un **árbitro** que ayuda a desbloquear los fondos.

---

## 6. Notificaciones: que no se te escape nada

Como Mostro funciona con mensajes cifrados en Nostr, hace falta que **algo esté
escuchando** aunque tú no tengas la web abierta. De eso se encarga el **monitor** del
servidor. Te avisa cuando pasa algo importante en tus operaciones.

### Por email (automático)

No tienes que hacer nada salvo **tener un email válido en tu perfil**. Recibirás un
correo (una sola vez por evento, sin spam) cuando:

| Cuándo | Email |
|---|---|
| Alguien toma tu orden | "Han tomado tu orden #XXXXXXXX" |
| Debes pagar la hold invoice (vendes BTC) | "Debes pagar la hold invoice…" |
| El comprador envió el fiat (vendes BTC) | "El comprador ha enviado el pago…" |
| El trade se completa | "Trade #XXXXXXXX completado" |
| Se inicia / asigna una disputa | Avisos de disputa |

### Por Telegram (si lo vinculas)

Ver sección 7. Recibirás avisos de tus trades y de **DMs privados nuevos** en tu buzón
de noxtr.

### ⚠️ El monitor NO actúa por ti

El monitor solo **avisa**. Las acciones (pagar la hold invoice, confirmar fiat enviado,
liberar sats, valorar) las haces tú desde la web. Si tomaste un trade en otra app
(Mostro Mobile), el monitor no lo conoce; la restauración entre clientes aún está pendiente.

---

## 7. Telegram

### Vincular tu cuenta

No necesitas saber de antemano "cuál es el bot": **la propia web te lleva a él**.

1. Ve a la sección **Telegram** de la web (`/telegram`).
2. Pulsa **Vincular Telegram**. La web genera un **código de un solo uso** (válido 10 min)
   y te muestra un enlace que abre **directamente el bot correcto** en Telegram.
3. Elige cómo:
   - **Móvil**: pulsa el enlace "Abrir bot en Telegram" → se abre el chat con el bot →
     pulsa **Iniciar/Start**.
   - **Ordenador**: copia el comando que te muestra (`/start CODIGO`) y pégalo en el chat
     del bot.
4. Al pulsar Start, Telegram le envía al bot tu identidad (tu chat y tu @username) junto
   con el código. El bot lo casa con tu cuenta de la web y queda vinculado. ✅

> En resumen: tú no buscas el bot ni configuras nada manualmente; el botón de la web te
> abre el bot exacto y el código de un solo uso es lo que asocia tu Telegram a tu cuenta.

### Qué recibes por Telegram

- Aviso cuando llega un **DM privado nuevo** a tu buzón de noxtr.
- Avisos de tus **trades** (igual que por email).

> No recibes por Telegram los mensajes cifrados de la instancia Mostro (esos van por dentro;
> el monitor te avisa por email).

### El bot también habla

El bot de Telegram puede **responder a tus mensajes** (respuestas automáticas por
palabras clave y/o con IA, según lo haya configurado el administrador). Comandos útiles:

| Comando | Qué hace |
|---|---|
| `/status` | Te dice si tu cuenta está vinculada. |
| `/unlink` | Desvincula tu Telegram. |
| `/help` | Ayuda. |
| `/ai` | (Si la IA está activa) muestra el servicio; charla escribiéndole normal. |

---

## 8. Consejos de seguridad

- Tu **nsec (o tus 12 palabras)** son tu llave maestra: guárdalas tú y no las compartas
  con nadie. Nadie legítimo te las pedirá.
- Si prefieres que el sitio web no maneje tu clave, puedes entrar con una **extensión
  (NIP-07)** o con **Nostr Connect (NIP-46)**: firman sin exponer tu clave privada al sitio.
- En un trade, **confirma que el fiat llegó de verdad** a tu banco antes de liberar sats.
- Revisa el **spam** si esperas un email del monitor y no llega.

---

## 9. Preguntas frecuentes

**No me llega el email de un trade.**
Comprueba: email válido en tu perfil, carpeta de spam, y que el trade esté **activo en
noxtr** (los iniciados en otra app aún no se pueden restaurar aquí). El monitor debe estar corriendo (eso lo
gestiona el administrador).

**Tomé un trade en Mostro Mobile, ¿lo veo aquí?**
No por ahora. La restauración de una sesión Mostro completa todavía no está implementada;
hasta entonces, gestiona ese trade desde el cliente donde lo iniciaste.

**¿Puedo usar la misma identidad en el móvil y en noxtr?**
La identidad Mostro procede de su propia semilla y no es la identidad social Nostr del login.
La importación/restauración interoperable con Mostro Mobile queda pendiente.

**¿Qué pasa si la instancia Mostro está caído?**
Puedes leer órdenes igual (se publican en relays generales), pero **enviar acciones al
robot** requiere que su relay esté activo. Si falla un pago final, suele ser un problema
de enrutado del nodo, no de noxtr.
