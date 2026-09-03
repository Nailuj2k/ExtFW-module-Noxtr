# Traspaso — Mensajes instructivos en el flujo on-chain (noxtr)

Sesión: 2026-06-05. Objetivo: añadir/mejorar mensajes instructivos para principiantes en el
flujo de trade on-chain (escrow Taproot), tras un trade real exitoso entre el usuario y un amigo.

Todo lo de abajo está **implementado y guardado** en el working tree (sin desplegar). No se usa git
en este proyecto; los archivos sincronizan por OneDrive.

---

## Cache-bust

`$version` en `_modules_/noxtr/head.php` subido a **`1.3.533`**. Cubre todos los cambios de JS/CSS de
esta sesión (un solo lote). Si tocas más JS/CSS antes de desplegar, súbelo otra vez.

---

## Cambios hechos

### 1. Diálogo de creación de clave/wallet on-chain (paso "crear dirección")
Archivo: `_modules_/noxtr/html_onchain_keys.php`
- Nuevo recuadro azul `.okd-info` arriba del todo (clave i18n inline `NOXTR_OKD_INFO_BANNER`).
- Explica a principiante: qué es (el monedero/semilla para trades on-chain) y, en negrita, que la
  dirección que se ve debajo **NO** es donde recibirá los BTC comprados; esa dirección de cobro se
  pide después (puede ser la misma, pero no tiene por qué).
- El HTML (`<strong>`) se emite con `<?= ?>` sin escapar, así que renderiza.

### 2. Diálogo de fees (al liberar / recovery / arbitraje)
Archivo: `_modules_/noxtr/i18n.php`, const `str_fee_dialog_intro` (`NOXTR_FEE_DIALOG_INTRO`)
- Reescrito: ahora explica que es la comisión de minería que se paga a la red Bitcoin para mover los
  fondos **desde la dirección escrow hasta la dirección de cobro**, que no se la queda la plataforma,
  y mantiene la explicación de prioridad (sat/vB). Texto plano (se inserta con `_escHtml`).

### 3. Verificación bilateral de dirección (paso de seguridad, el hueco principal detectado)
Archivos: `i18n.php` + `script.onchain.js`
- Nuevo `NOXTR_ADDRESS_CHECK_HELP` (`str_address_check_help`).
- Renderizado encima del botón "Comprobar dirección" en `fundingHtml` (rama del `else` donde se
  muestra el botón de check). Explica que es un paso de seguridad para confirmar que ambas partes
  derivaron la MISMA dirección escrow, y que si no coinciden no se deposite nada.

### 4. Selector de árbitros (al tomar la orden) — migrado a i18n
Archivos: `i18n.php` + `script.onchain.js`
- Nuevo `NOXTR_ARB_EXPLAINER` (`str_arb_explainer`).
- Renderizado con `_escHtml(str_arb_explainer)` encima del hint existente en `Arbitrators.renderSelector`
  (el `<small class="mo-hint nxoc-arb-explain">`). Explica qué es un árbitro, por qué se eligen hasta 3,
  y que arb1 cobra comisión por disponibilidad.
- NOTA: el resto de ese bloque sigue hardcoded en español ("Seleccionar arbitro...", "Actualizar",
  "Selecciona 3 arbitros...", etc.). `script.onchain.js` no está migrado a i18n del todo (ver
  CLAUDE.md → I18N). Pendiente migrar el resto si se quiere.

### 5. Consejo de auto-custodia en la dirección de cobro
Archivos: `i18n.php` + `script.onchain.js`
- Nuevo `NOXTR_PAYOUT_SELF_CUSTODY_HINT` (`str_payout_self_custody_hint`).
- Añadido como `.nxoc-funding-help` bajo el input de dirección en `_payoutHtml` (rama editable).
- Aconseja usar una wallet propia (con tus claves), no un exchange, porque podría no aceptar fondos de
  trades P2P, retenerlos, o pedir datos sobre la otra parte.

### 6. Estimación de tiempo de confirmación de la tx de liberación (feature del TODO de i18n L560)
La cadena `NOXTR_RELEASE_IN_MEMPOOL` tenía dentro una nota TODO en mayúsculas (se mostraba al usuario):
"OBTENER LOS FEES DE LA MEMPOOL y COMPARANDO CON LOS FEES DE LA TRANSACCIÓN PONER AQUI MENSAJE CON
ESTIMACIÓN DE CUANDO PODRÍA ENTRAR". Implementado:

- `i18n.php`:
  - `NOXTR_RELEASE_IN_MEMPOOL` limpiado a "En la mempool, esperando confirmación...".
  - 5 strings nuevos de estimación: `NOXTR_RELEASE_ETA_NEXT` / `_30M` / `_1H` / `_HOURS` / `_SLOW`.
- `script.onchain.js`:
  - En `_coopSignHtml`, estado mempool sin confirmar (`releaseTxid && seen && confs === 0`): inserta
    `<span class="nxoc-release-eta" data-rate="..." data-net="...">`. `data-rate` = `coop_fee_sats / _VBYTES_COOP`.
  - Métodos nuevos en `UI` (tras `renderFundingQRs`):
    - `_tiersCache` + `_recommendedTiers(net)`: tiers de mempool por red, cache 60s, vía el ajax
      `recommended_fees` ya existente.
    - `_etaText(rate, tiers)`: mapea el fee rate de la tx a uno de los 5 textos comparando con
      fastestFee / halfHourFee / hourFee / economyFee.
    - `renderReleaseEtas()`: rellena los span post-render (una llamada por red).
- `script.mostro.js`: llama a `Onchain.UI.renderReleaseEtas()` justo después de `renderFundingQRs()`
  (en el render de las fichas de trade). Como el poll de funding re-renderiza, el ETA se refresca solo.

Detalle: el fee rate es una estimación (`coop_fee_sats/220` vbytes COOP); el tamaño real puede variar
un poco. Si `coop_fee_sats` falta (trade reconstruido), el span queda vacío y solo se ve el texto base.

---

## Estado / pendiente

- [ ] **Probar en navegador** todos los mensajes (recargar con `$version` nuevo). En concreto el ETA:
      forzar un trade con tx en mempool y ver que el span se rellena. Para activar logs:
      `localStorage.setItem('noxtr_debug','1'); location.reload()`.
- [ ] (Opcional) Migrar a i18n el resto del bloque del selector de árbitros en `script.onchain.js`.
- [ ] (Opcional) Afinar el cálculo del ETA usando los vbytes reales de la tx en vez de `_VBYTES_COOP`
      fijo, si se quiere más precisión.

## Archivos tocados
- `_modules_/noxtr/head.php` (version 1.3.533)
- `_modules_/noxtr/html_onchain_keys.php`
- `_modules_/noxtr/i18n.php`
- `_modules_/noxtr/script.onchain.js`
- `_modules_/noxtr/script.mostro.js`

## Diagnostics IDE
Hints `80006` ("may be converted to async function") en `script.onchain.js` ~líneas 3371/3383/3395 son
preexistentes, no relacionados con estos cambios.
