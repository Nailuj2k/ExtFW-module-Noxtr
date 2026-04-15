# Noxtr

`noxtr` es un modulo de [`ExtFW`](https://github.com/Nailuj2k/ExtFW).

Este repositorio contiene el codigo del modulo `noxtr`.
Para instalarlo en tu servidor web, necesitas instalar el framework `ExtFW`.
La instalacion, ejecucion y gestion del modulo se realizan dentro del framework.
Además tenerlo en tu propio server pudes usarlo cualquier web que lo tenga instaldo, como en 'https://noxtr.net'.

Demo: https://noxtr.net (puedes hacer login una identidad Nostr)


## Que hace

`noxtr` es un cliente web de `Nostr` integrado en `ExtFW`. Reune en un solo modulo el feed social, perfiles, follows, topics, mensajes directos, canales publicos, articulos largos, zaps Lightning, NIP-05 y gestion de relays.

Segun la documentacion del propio modulo, `noxtr` soporta al menos 18 NIPs: `NIP-01`, `NIP-02`, `NIP-04`, `NIP-05`, `NIP-07`, `NIP-09`, `NIP-10`, `NIP-19`, `NIP-23`, `NIP-25`, `NIP-28`, `NIP-44`, `NIP-46`, `NIP-50`, `NIP-56`, `NIP-57`, `NIP-65` y `NIP-69`.

### Caracteristicas

- feed social Nostr integrado en una web `ExtFW`
- follows, topics, bookmarks y gestion de relays
- mensajes directos, canales publicos y articulos largos
- identidad `NIP-05` y zaps Lightning
- cliente `Mostro` integrado para compraventa P2P de bitcoin sobre Nostr
- soporte para ordenes `NIP-69`
- importacion de identidad desde `Mostro Mobile`

## Instalacion

Si ya tienes una web funcionando con `ExtFW`, `noxtr` se instala desde el marketplace del framework:

1. entra en `https://tuweb/marketplace`
2. localiza la fila correspondiente a `noxtr`
3. pulsa en `Instalar`
