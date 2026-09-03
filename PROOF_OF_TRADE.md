# Proof of Trade (PoT) — admisión al order book vía tokens ciegos

Alternativa / complemento al *security bond* anti-abuso de Mostro. **Proof of Trade (PoT)**:
para entrar al order book hay que presentar un token ciego (estilo Cashu) que prueba un
trade real previo, sin identidad, sin historial y sin reputación persistente. Simple y
respetuoso con la privacidad.

## Problema

El bond (fianza en sats) tiene dos defectos:

1. **Barrera de entrada económica**: cobrar una fianza en sats a quien viene a comprar sus
   primeros sats es absurdo para el caso de uso P2P de entrada. Si tiene que conseguir sats
   en otro sitio para pagar el bond, ¿para qué vuelve?
2. **No frena el spam que pretende frenar**: el tráfico abusivo (un cliente mal hecho o
   malicioso que repite mensajes) ocurre *antes* de pagar la fianza. El bond no lo filtra.

El ataque Sybil al order book hoy es gratis: generas un `nsec` nuevo, publicas ofertas
falsas, repites. Coste cero.

## Idea central

Para publicar o tomar una oferta, el usuario presenta un **token ciego** que la instancia
emitió como recompensa por un **trade real completado**. La instancia verifica su propia
firma y marca el token como gastado. Sin token no se entra al book.

Un novato sin token propio entra con una **invitación**: alguien que ya ha tradeado le cede
uno de sus tokens. No hay vía "gratis" (un token siempre costó un trade real acuñarlo).

No es identidad (no KYC), no es reputación persistente, no es un historial enlazable. Es un
**ticket anónimo de rate-limit** que solo se consigue habiendo tradeado.

## Por qué "ciego" es la clave

Una firma ciega (Chaumian, el primitivo de Cashu / ecash) permite que la instancia:

- **emita** un token sin ver su contenido final, y
- **verifique** más tarde "esto lo firmé yo y no está gastado" **sin** poder enlazar el
  token con el trade del que salió ni con el `npub` que lo presenta.

En Mostro las trade keys son efímeras precisamente para que las operaciones no sean
enlazables. Un token en claro (p.ej. "hash del trade #Y", o un token ligado al `npub`)
reintroduciría esa linkabilidad: cada oferta quedaría correlacionada con tus trades
pasados, rompiendo el modelo de privacidad. El token **ciego** no: la instancia sabe que es
válido, pero no de quién ni de qué trade.

## Privacidad: qué puede y qué no puede saber la instancia

Dos preguntas que definen si la propuesta se sostiene:

**¿Se puede saber a qué trade pertenece un token?** Criptográficamente **no**: es para lo
que sirve la firma ciega. Al acuñar, la instancia firma un valor *cegado* y nunca ve el
token final; cuando luego lo presentas, verifica su propia firma pero no puede enlazarlo con
el trade del que salió. Riesgo residual: **canales laterales** de timing (acuñar y gastar
casi a la vez, o un único token en juego en una ventana). Se mitiga como en cualquier ecash:
denominaciones uniformes, emisión por lotes y algo de retardo (conjunto de anonimato). La
firma no filtra; el riesgo es estadístico.

**¿Se puede saber a qué usuario pertenece un trade?** No a tu identidad, sí a una clave
efímera. Esto es del diseño base de Mostro, no de PoT: cada trade usa una **trade key de
usar y tirar**, no tu `npub`. La instancia, que coordina el trade, sí ve las dos trade keys
que operaron entre sí, el importe, el método de pago, los tiempos y las facturas Lightning.
Lo que NO ve es tu identidad persistente, salvo que la filtres tú (modo reputación que ata a
la identity key, reusar el mismo nodo LN, un NIP-05, etc.).

**La cadena completa**: trade → la instancia conoce trade keys efímeras (no tu npub) → al
completar acuña tokens ciegos → los gastas para entrar con una trade key nueva. Resultado: la
instancia **no puede construir** "este npub hizo los trades X,Y,Z y publicó las ofertas
A,B,C", porque (1) los trades usan claves desechables y (2) los tokens son ciegos, así que
las entradas no se encadenan con los trades.

En resumen: seudónimo frente a la instancia (ve operaciones con claves efímeras, no contigo)
y los tokens impiden encadenar una operación con la siguiente. La privacidad depende de las
dos piezas juntas; si una falla (token no ciego, o reusas identidad/nodo LN), se cae.

## Flujo

```
1. ACUÑACIÓN (al completar un trade)
   - La instancia, tras un trade exitoso, emite 1-2 tokens ciegos a cada parte.
   - Protocolo de firma ciega:
       a. El usuario genera un secreto, lo "ciega" (blinding factor) y lo envía.
       b. La instancia firma el valor cegado con su clave de emisión.
       c. El usuario "descega" la firma → token = (secreto, firma válida de la instancia).
   - La instancia NO aprende el secreto ni el token final.

2. PRESENTACIÓN (al publicar o tomar una oferta)
   - El usuario adjunta el token al evento/mensaje de Mostro.
   - La instancia:
       a. Verifica que la firma es suya y válida sobre el secreto.
       b. Comprueba que el secreto no está en el set de "gastados".
       c. Lo añade al set de gastados (burn) y permite la operación.

3. NOVATO (sin token propio todavía) → INVITACIÓN
   - Un usuario que ya ha tradeado le cede uno de sus tokens ciegos. Como el token es al
     portador (bearer), basta con transferírselo; la instancia no aprende quién invitó a
     quién (sigue siendo ciego).
   - Con ese token el novato publica/toma su primera oferta. Al completar su primer trade
     recibe sus propios tokens y entra en el ciclo normal, sin depender de nadie.
   - No rompe el coste anti-Sybil: ese token de invitación costó un trade real acuñarlo, así
     que el invitador "gasta" trabajo real en cada novato que mete.
```

### Economía del token (no te quedas seco al invitar)

Pregunta natural: "si regalo mi token a un novato, ¿con qué hago yo el siguiente trade?".
Nunca regalas tu **último** token: cedes el **excedente**. El ratio acuñar/gastar lo asegura:

- Entrar (publicar o tomar) **quema 1** token.
- Completar un trade **acuña 2** → neto **+1 por trade**. Ese +1 acumulado es tu presupuesto
  de invitaciones. Sigues teniendo siempre lo que necesitas para tu propia próxima oferta.
- Variante 1:1 (acuñar 1, gastar 1): te mantienes operando indefinidamente pero sin sobrante
  para invitar. En ese caso las invitaciones salen de un **cupo aparte** (ej. 1/semana por
  trader establecido), desacoplado de la recompensa por trade.

Es un parámetro de la instancia. Que cada trade deje +1 hace crecer el supply de tokens; se
acota con caducidad/rotación (ver Preguntas abiertas) o ajustando el ratio. Detalle práctico:
conviene quemar el token al **concretarse** la operación, no al publicar una oferta que nadie
toma, para no penalizar ofertas que expiran sin match.

## Análisis anti-Sybil

Para spamear N ofertas necesitas ~N/2 tokens, y cada token solo sale de un **trade real**:

- Coste por trade: sats bloqueados en hold invoices + fees de routing Lightning + fees de
  instancia + tiempo.
- Un atacante que quiera 100 ofertas necesita ~50 trades reales. Ya no es coste cero.

El multiplicador está **acotado** (1-2 tokens por trade), no es inflacionable como un
sistema de reputación.

**Transferibilidad (invitaciones) no abre un agujero.** Como los tokens son al portador, un
atacante podría intentar comprarlos en vez de tradear. Pero cada token sigue respaldado por
un trade real, así que su precio de mercado refleja ese coste: comprar N tokens equivale a
pagar ~N/2 trades. El suelo de coste lineal se mantiene; solo cambia quién hizo el trade.

### Self-farming (atenuado, no eliminado)

Dos identidades tradeando entre sí para acuñar tokens sigue siendo posible, pero:

- Cada trade cuesta sats bloqueados + fees reales.
- Rinde solo 1-2 tokens; el atacante no multiplica gratis.
- "Modo ataque": la instancia puede subir temporalmente sus fees de trade, encareciendo el
  farming masivo sin apenas afectar al usuario normal (que hace pocas trades).
- Detección de patrones circulares (dos `npub` que solo tradean entre sí) puede degradar
  esa emisión — heurístico, opcional.

## Comparativa

| Mecanismo | Coste al novato | Privacidad | Confianza en instancia | Frena Sybil | Complejidad |
|---|---|---|---|---|---|
| **Bond (sats)** | Alto (fianza) | OK | Baja (es tu dinero) | Débil (spam pre-pago) | Media |
| **PoW (NIP-13)** | CPU (bajo) | OK | Ninguna | Encarece spam masivo | Baja (ya existe) |
| **Token no ciego (ligado a identidad)** | Medio | **Mala** (identidad) | Alta (emite reputación) | Fuerte | Alta (federación) |
| **PoT / token ciego (este)** | Invitación (token cedido) | **Buena** (ciego) | Media (firma local) | Fuerte y acotado | Media |

Recomendación práctica: **token ciego para la admisión** (incluido el novato, vía
invitación) y **PoW (NIP-13) como suelo general** anti-spam de mensajes, sin cobrar fianza a
nadie. PoW solo se necesita además como arranque puntual en una instancia nueva (ver abajo).

## Relación con Cashu

Esto es, literalmente, un mint Cashu de propósito específico:

- La instancia Mostro actúa de **mint**: emite tokens ciegos y mantiene el set de gastados.
- Los tokens no son portadores de valor en sats: son **tickets de entrada** (1 token = 1
  derecho a publicar/tomar). Misma criptografía (BDHKE / blind Schnorr), distinto significado.
- Ventaja de reusar Cashu: primitivo conocido, auditado y respetado en el ecosistema
  Bitcoin/Nostr. Presentarlo como "tokens ciegos estilo Cashu" deja claro de entrada que es
  un filtro criptográfico de coste, no un sistema de reputación ni de identidad.

## Qué NO es, y objeciones frecuentes

Distinciones que conviene dejar claras antes de que las pregunten:

- **No es reputación.** La reputación es una señal blanda (te hace más o menos atractivo);
  esto es un requisito duro de admisión (entras o no). Y al ser el token **ciego**, ni
  siquiera acumula historial enlazable: no eres "un npub con 30 trades", eres alguien que
  presenta un ticket anónimo válido. Un token ligado a identidad sí dejaría rastro; el ciego
  no.
- **No es un club de permisos ni una red de confianza social.** Para entrar necesitas un
  token, que respalda **un trade real**. Un novato lo recibe como invitación (un token
  cedido), pero eso no es un aval interpersonal ni una aprobación: el token es al portador y
  ciego, así que la instancia no ve "quién avala a quién". Nadie juzga tu carácter; solo se
  comprueba que detrás de tu entrada hay un trade real. No hay reputación ni lista blanca.

Objeciones típicas:

- *"Solo sirve en redes pequeñas de confianza."* Al revés. En una red pequeña donde todos
  se conocen el filtro sobra; el spam masivo y gratuito aparece **justo cuando la red crece**
  y entran actores anónimos. El token es un filtro de admisión para redes grandes y abiertas.
- *"Es una barrera de entrada."* Solo para el primer trade, y se cubre con una invitación
  (un token cedido por alguien que ya tradea). A diferencia del bond, **no cobra sats** al
  novato: alguien le presta un token y, tras su primer trade, ya acuña los suyos. El ciclo
  se autoalimenta.
- *"La fianza ya cubre esto."* No. La fianza protege el **trade individual** (la mesa); el
  token protege el **order book colectivo** (la puerta). Son complementarios, no excluyentes:
  el bond sigue valiendo para asegurar un trade concreto de monto alto.
- *"Es Proof-of-Work económico disfrazado de historia."* Exacto, y es una virtud: convierte
  el Sybil de coste cero (generar `nsec`) en coste lineal real (capital + fees + tiempo),
  sin identidad, sin KYC y sin reputación.

## Preguntas abiertas

- **Cross-instance**: un token emitido por la instancia A no es válido en B salvo que B
  confíe en la clave de emisión de A. Planteado como **política local opcional** por
  instancia, no es bloqueante. Una federación de mints (confianza mutua entre instancias
  conocidas) sería una fase posterior, no necesaria para el MVP.
- **Génesis de instancia nueva**: aquí no hay nadie que invite (nadie tiene tokens todavía).
  Es el único punto que necesita un arranque puntual, NO una vía gratis permanente. Opciones:
  el operador siembra unos tokens iniciales (a usuarios de confianza o a un grupo semilla), o
  abre una ventana temporal con PoW alto hasta que haya suficientes traders. Una vez arrancado,
  el ciclo invitación → trade → tokens propios se autoalimenta y la ventana se cierra. En
  estado estable NO existe entrada gratis: siempre hace falta un token (propio o cedido).
- **Caducidad / rotación**: ¿los tokens caducan? Rotar la clave de emisión periódicamente
  acota el tamaño del set de gastados y limita el valor de un robo de tokens acumulados.
- **¿Protocolo o por instancia?** Empezar por instancia (cada operador decide su política
  de entrada) evita comprometer el protocolo y permite experimentar.

---

## Apéndice: ¿sirve esto para el registro en la web?

Pregunta separada: ¿se puede usar el mismo mecanismo (o parecido) para permitir el alta de
usuarios en una web, no solo la entrada al order book?

**Mismo primitivo, distinto modelo de amenaza.** Sirve, pero con matices:

- El order book tiene una población que **ya tradea**: hay de dónde acuñar tokens. El alta
  web es un **primer contacto**: el usuario nuevo no tiene historial previo de nada, así que
  el bootstrap es el problema dominante, no la excepción.
- Por eso, para registro encajan mejor variantes del mismo primitivo:

  1. **Invitaciones ciegas** (invite-only anónimo): un usuario existente "acuña" un token de
     invitación ciego; el nuevo lo presenta para registrarse. La instancia verifica su firma
     y lo quema. El invitador no queda enlazado al invitado (firma ciega), pero el cupo de
     invitaciones limita el crecimiento bot. Es el clásico "invite-only" pero sin que el
     servidor sepa quién invitó a quién.
  2. **Token de pago** (ecash de verdad): pagar una cuota mínima en sats vía un token Cashu
     para registrarse. Anti-bot por coste, privacidad por firma ciega. Sirve si quieres
     monetizar o filtrar por dinero, no por relación social.
  3. **PoW / hashcash en el alta**: encarece el registro masivo sin coste económico ni
     identidad. Es lo más barato de implementar y no necesita mint.

- **Diferencia clave**: en el order book el token *prueba que has aportado algo al sistema*
  (un trade real). En el alta web no hay "algo aportado" previo, así que el token solo puede
  probar (a) que alguien te invitó, (b) que pagaste, o (c) que gastaste CPU. No hay
  equivalente directo a "ya tradeaste".

Si el objetivo es **anti-spam de registro** en ExtFW/noxtr, lo más simple y efectivo es
PoW/hashcash en el formulario + rate-limit por IP/pubkey (esto sí lo ve el servidor web,
a diferencia del daemon Mostro sobre relays). Las invitaciones ciegas son la opción si
quieres un alta *invite-only* que no sacrifique la privacidad del invitador.

Conclusión: el token ciego es la pieza común; lo que cambia es **qué prueba el token** según
el contexto (trade hecho / invitación / pago / trabajo).
