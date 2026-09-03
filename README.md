# Noxtr

`noxtr` es un módulo de [`ExtFW`](https://github.com/Nailuj2k/ExtFW): un cliente web de Nostr que reúne feed social, perfiles, follows, topics, mensajes directos, canales públicos, artículos largos, zaps Lightning, NIP-05 y gestión de relays — además de un cliente **Mostro** completo (compraventa P2P de Bitcoin sobre Nostr, Lightning y on-chain con escrow Taproot).

Demo: https://noxtr.net (login con una identidad Nostr)

## Características

- Feed social Nostr, follows, topics, bookmarks, gestión de relays
- Mensajes directos (NIP-04), canales públicos (NIP-28), artículos largos, highlights
- Identidad NIP-05 y Lightning Address, zaps
- Cliente **Mostro P2P** integrado: order book NIP-69, chat cifrado (comprador↔vendedor y con el admin en disputa) y modo reputación opcional con identidad Mostro derivada
- Cliente **on-chain** (NostrEscrow): P2P de Bitcoin con escrow Taproot 2-de-3 y árbitros, sin custodio
- Monitor en segundo plano (`server_monitor.php`) con avisos por email y Telegram

Soporta NIP-01, 02, 04, 05, 07, 09, 10, 19, 25, 28, 44, 46, 56, 57, 69, 84.

## Instalación

Requiere una web con `ExtFW` ya funcionando — la instalación, ejecución y gestión del módulo se hacen dentro del framework.

1. Entra en `https://tuweb/marketplace`
2. Localiza `noxtr`
3. Pulsa **Instalar**

## Documentación

- `CLAUDE.md` — arquitectura y referencia técnica del módulo
- `NOSTR_ONCHAIN.md` / `NIP-NOSTRESCROW.md` — protocolo del cliente on-chain
- `NOSTRCHAT.md` — implementación de canales NIP-28
- `MANUAL_USUARIO.md` / `MANUAL_ADMIN.md` / `MANUAL_MONITOR.md` — guías de uso y operación
