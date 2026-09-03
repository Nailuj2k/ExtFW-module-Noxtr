

    <link rel="stylesheet" href="/_modules_/noxtr/doc/doc.css?ver=1.0.3">
    <link href="/_js_/wquery/wquery.dialog.css?v=3.0.200" media="screen" rel="stylesheet" type="text/css" />



<button class="theme-toggle" id="theme-toggle" title="Cambiar tema claro/oscuro">&#9788; Claro</button>

<div class="hero">
    <h1><span>Noxtr</span> Hoja de Especificaciones</h1>
    <p class="subtitle">Un cliente Nostr web integrado en el framework ExtFW. Resumen de funcionalidades, soporte de NIPs y comparativa con otros clientes.</p>
    <span class="badge">Cliente Web &middot; Arquitectura Abierta &middot; Self-hosted</span>
    <span class="doc-header-links"><br><a class="lang-link" href="/noxtr">Volver a Noxtr</a> · <a class="lang-link" target="_blank" href="https://software.extralab.net">ExtFW Framework</a>   ·  <a class="lang-link" href="/noxtr/html/en">Versión en inglés</a></span>
</div>

<div class="container">

<!-- ==================== QUE ES NOXTR ==================== -->
<section>
    <h2>&iquest;Qu&eacute; es Noxtr?</h2>
    <p>Noxtr es un cliente <a href="https://nostr.com">Nostr</a> web integrado en el framework ExtFW. Funciona como un m&oacute;dulo dentro de un sitio web auto-alojado, combinando el acceso al protocolo Nostr con funcionalidades del servidor como cuentas de usuario, hosting de direcciones Lightning y verificaci&oacute;n de identidad NIP-05.</p>
    <p>Est&aacute; dise&ntilde;ado como una aplicaci&oacute;n de p&aacute;gina &uacute;nica sin frameworks JavaScript externos &mdash; vanilla JS con un helper DOM ligero (wquery).</p>

    <h3>Caracter&iacute;sticas Clave</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Auto-alojado</h4>
            <p>Se ejecuta en tu propio servidor (Apache/nginx, PHP, MySQL/SQLite). T&uacute; controlas tus datos, tu lista de relays y tus endpoints Lightning.</p>
        </div>
        <div class="feature-card">
            <h4>Cero Dependencias</h4>
            <p>Sin React, sin Vue, sin npm, sin paso de compilaci&oacute;n. JavaScript vanilla organizado en unos pocos ficheros por &aacute;rea (core, Mostro, on-chain). Criptograf&iacute;a v&iacute;a noble-secp256k1 y noble-ciphers, incluidas en el repositorio (sin CDN).</p>
        </div>
        <div class="feature-card">
            <h4>Identidad Integrada</h4>
            <p>La verificaci&oacute;n NIP-05 y las direcciones Lightning LNURL-pay se auto-configuran desde las cuentas de usuario del servidor.</p>
        </div>
        <div class="feature-card">
            <h4>Multi-autenticaci&oacute;n</h4>
            <p>Soporta extensiones de navegador NIP-07, clave privada nsec, NIP-46 Nostr Connect (firma remota con QR, p.ej. con <a href="https://signer.noxtr.net" target="_blank" rel="noopener">signer.noxtr.net</a>) y modo s&oacute;lo lectura con npub. Si el firmador remoto no responde, la petici&oacute;n se reenv&iacute;a autom&aacute;ticamente durante 90s con aviso en pantalla.</p>
        </div>
        <div class="feature-card">
            <h4>Compraventa &#8383; P2P integrada</h4>
            <p>Compra y vende Bitcoin directamente con otras personas, sin intermediarios: por Lightning v&iacute;a el protocolo Mostro, o on-chain con escrow Taproot 2-de-3 (NostrEscrow). Order book, chat cifrado, disputas con arbitraje y notificaciones, todo dentro del cliente.</p>
        </div>
        <div class="feature-card">
            <h4>Anonimato por dise&ntilde;o</h4>
            <p>Registro 100% an&oacute;nimo con Nostr: sin email, sin contrase&ntilde;a, sin datos personales. En los trades P2P, modo privacidad total por defecto (claves ef&iacute;meras por operaci&oacute;n, sin rastro entre trades) y reputaci&oacute;n opcional.</p>
        </div>
    </div>
</section>

<!-- ==================== SOPORTE NIP ==================== -->
<section>
    <h2>Soporte de NIPs</h2>
    <p>Posibilidades de Implementaci&oacute;n de Nostr (NIPs) soportadas por Noxtr:</p>

    <div class="nip-grid">
        <div class="nip-chip"><strong>NIP-01</strong><span>Protocolo b&aacute;sico</span></div>
        <div class="nip-chip"><strong>NIP-02</strong><span>Lista de contactos</span></div>
        <div class="nip-chip"><strong>NIP-04</strong><span>DMs cifrados</span></div>
        <div class="nip-chip"><strong>NIP-05</strong><span>Identidad DNS</span></div>
        <div class="nip-chip"><strong>NIP-07</strong><span>Firmante del navegador</span></div>
        <div class="nip-chip"><strong>NIP-09</strong><span>Eliminaci&oacute;n de eventos</span></div>
        <div class="nip-chip"><strong>NIP-10</strong><span>Hilos de respuesta</span></div>
        <div class="nip-chip"><strong>NIP-17</strong><span>DMs privados (gift wrap)</span></div>
        <div class="nip-chip"><strong>NIP-19</strong><span>Entidades Bech32</span></div>
        <div class="nip-chip"><strong>NIP-23</strong><span>Contenido largo</span></div>
        <div class="nip-chip"><strong>NIP-25</strong><span>Reacciones</span></div>
        <div class="nip-chip"><strong>NIP-28</strong><span>Canales p&uacute;blicos</span></div>
        <div class="nip-chip"><strong>NIP-44</strong><span>Cifrado versionado</span></div>
        <div class="nip-chip"><strong>NIP-46</strong><span>Nostr Connect</span></div>
        <div class="nip-chip"><strong>NIP-47</strong><span>Wallet Connect (NWC)</span></div>
        <div class="nip-chip"><strong>NIP-50</strong><span>B&uacute;squeda</span></div>
        <div class="nip-chip"><strong>NIP-56</strong><span>Reportes</span></div>
        <div class="nip-chip"><strong>NIP-57</strong><span>Zaps Lightning</span></div>
        <div class="nip-chip"><strong>NIP-59</strong><span>Gift wrap</span></div>
        <div class="nip-chip"><strong>NIP-65</strong><span>Metadatos de relays</span></div>
        <div class="nip-chip"><strong>NIP-69</strong><span>&#8383;rdenes P2P (Mostro)</span></div>
        <div class="nip-chip"><strong>NIP-84</strong><span>Highlights</span></div>
        <div class="nip-chip"><strong>NIP-94</strong><span>Metadatos de archivos</span></div>
        <div class="nip-chip"><strong>NIP-96</strong><span>Almacenamiento HTTP</span></div>
        <div class="nip-chip"><strong>NIP-98</strong><span>Auth HTTP</span></div>
    </div>

    <h3>Tipos de Evento (Kinds)</h3>
    <div class="table-wrap">
    <table>
        <tr><th>Kind</th><th>Descripci&oacute;n</th><th>Uso</th></tr>
        <tr><td>0</td><td>Metadatos de perfil</td><td>Nombre, avatar, banner, bio, nip05, lud16</td></tr>
        <tr><td>1</td><td>Nota de texto</td><td>Contenido principal del feed, hashtags, menciones</td></tr>
        <tr><td>3</td><td>Lista de contactos</td><td>Seguir/dejar de seguir, petnames, hints de relay</td></tr>
        <tr><td>4</td><td>DM cifrado (NIP-04)</td><td>AES-CBC con IV, descifrado v&iacute;a NIP-07, NIP-46 o privkey</td></tr>
        <tr><td>5</td><td>Eliminaci&oacute;n</td><td>Borrar notas propias y mensajes de canal propios (kind 42)</td></tr>
        <tr><td>6</td><td>Repost</td><td>Compartir notas</td></tr>
        <tr><td>7</td><td>Reacci&oacute;n</td><td>Like/unlike en notas</td></tr>
        <tr><td>13</td><td>Seal (NIP-17)</td><td>Capa intermedia del gift wrap para DMs privados</td></tr>
        <tr><td>14</td><td>Rumor (NIP-17) / Transporte Mostro v2</td><td>En DMs: mensaje plano que se envuelve en el seal. En Mostro: mensaje directo firmado con la trade key y cifrado NIP-44 a la instancia</td></tr>
        <tr><td>40</td><td>Crear canal</td><td>Canal de chat p&uacute;blico NIP-28</td></tr>
        <tr><td>41</td><td>Metadatos de canal</td><td>Nombre, descripci&oacute;n, imagen del canal</td></tr>
        <tr><td>42</td><td>Mensaje de canal</td><td>Mensajes en canales p&uacute;blicos (eliminaci&oacute;n propia v&iacute;a kind 5)</td></tr>
        <tr><td>1059</td><td>Gift wrap (NIP-59)</td><td>Sobre exterior cifrado para DMs NIP-17 y mensajes Mostro. Oculta remitente y destinatario</td></tr>
        <tr><td>1063</td><td>Metadatos de archivo (NIP-94)</td><td>Devuelto por servidores NIP-96 al subir un archivo: URL, hash, mime, dimensiones</td></tr>
        <tr><td>1984</td><td>Reporte</td><td>Reportes de spam NIP-56</td></tr>
        <tr><td>9802</td><td>Highlight (NIP-84)</td><td>Citas destacadas con comentario/contexto, integradas en el feed</td></tr>
        <tr><td>9734</td><td>Solicitud de Zap</td><td>Metadatos de pago Lightning</td></tr>
        <tr><td>9735</td><td>Recibo de Zap</td><td>Confirmaci&oacute;n de pago desde el servidor</td></tr>
        <tr><td>23194</td><td>NWC request (NIP-47)</td><td>Solicitud cifrada (NIP-04) del cliente a la wallet NWC: pay_invoice, get_balance, etc.</td></tr>
        <tr><td>23195</td><td>NWC response (NIP-47)</td><td>Respuesta cifrada de la wallet con resultado o error</td></tr>
        <tr><td>24133</td><td>Nostr Connect</td><td>Firma remota NIP-46</td></tr>
        <tr><td>27235</td><td>HTTP Auth (NIP-98)</td><td>Evento de autenticaci&oacute;n para uploads NIP-96 y login web</td></tr>
        <tr><td>30023</td><td>Art&iacute;culo (NIP-23)</td><td>Contenido largo: mezclado en el feed con badge &ldquo;Read&rdquo;, vista completa con Markdown, composici&oacute;n de art&iacute;culos</td></tr>
        <tr><td>38383</td><td>Orden P2P (NIP-69)</td><td>&#211;rdenes de compraventa Bitcoin de instancias Mostro. Tab P2P &#8383; con listado de &oacute;rdenes, explicaci&oacute;n did&aacute;ctica y flujo de compra guiado</td></tr>
        <tr><td>38385</td><td>Estado de instancia Mostro</td><td>Heartbeat con versi&oacute;n del daemon, <code>protocol_version</code> del transporte, l&iacute;mites, comisi&oacute;n y pol&iacute;tica de fianza. Alimenta la etiqueta v1/v2 y la ficha de cada instancia</td></tr>
        <tr><td>38386</td><td>Disputa p&uacute;blica Mostro</td><td>Estado p&uacute;blico de las disputas (<code>initiated</code> / <code>in-progress</code>)</td></tr>
        <tr><td>39383-39389</td><td>NostrEscrow (on-chain)</td><td>Ofertas, estado de trade, disputas, arbitraje y funding del intercambio P2P on-chain con escrow Taproot</td></tr>
    </table>
    </div>
</section>

<!-- ==================== FUNCIONALIDADES ==================== -->
<section>
    <h2>Resumen de Funcionalidades</h2>

    <div class="features">
        <div class="feature-card">
            <h4>Modos de Feed</h4>
            <p>Global, Siguiendo, Seguidores, Temas (suscripciones por hashtag) y Tendencias (ranking por engagement).</p>
        </div>
        <div class="feature-card">
            <h4>Mensajes Directos (NIP-04 / NIP-17)</h4>
            <p>DMs cifrados con NIP-04 (AES-CBC) y NIP-17 con gift wrap (NIP-59 + NIP-44 XChaCha20-Poly1305). Mismo tab para ambos, distinguibles visualmente con &#128274; en los NIP-17. Hilos de conversaci&oacute;n, cach&eacute; en BD local y descifrado v&iacute;a extensi&oacute;n NIP-07, NIP-46 o nsec.</p>
        </div>
        <div class="feature-card">
            <h4>Wallet Lightning (NIP-47 NWC)</h4>
            <p>Conexi&oacute;n con wallets compatibles con Nostr Wallet Connect (Alby, Mutiny, Phoenix, Coinos, etc.). Configura tu URI <code>nostrwalletconnect://</code> una vez y paga zaps y facturas Mostro autom&aacute;ticamente desde la wallet del usuario sin pasar por BTCPay. WebSocket dedicado al relay NWC, cifrado NIP-04, timeout 30s.</p>
        </div>
        <div class="feature-card">
            <h4>Almacenamiento de Archivos (NIP-96)</h4>
            <p>Las im&aacute;genes adjuntas a notes se suben a servidores NIP-96 externos (nostr.build por defecto, configurables en el tab Relays). Auto-descubrimiento de capabilities v&iacute;a <code>/.well-known/nostr/nip96.json</code>. Auth con NIP-98 (kind 27235) firmado con la clave del usuario. Soporte para m&uacute;ltiples servidores con cadena de fallback.</p>
        </div>
        <div class="feature-card">
            <h4>Canales P&uacute;blicos (NIP-28)</h4>
            <p>Crear, unirse y chatear en canales p&uacute;blicos. Metadatos de canal, fijar canales, enlaces de invitaci&oacute;n y configuraci&oacute;n exclusiva del creador. Eliminaci&oacute;n de mensajes propios (NIP-09).</p>
        </div>
        <div class="feature-card">
            <h4>Art&iacute;culos (NIP-23)</h4>
            <p>Contenido largo (kind 30023) mezclado en el feed con badge &ldquo;Read&rdquo; y deduplicaci&oacute;n. Vista completa con renderizado Markdown. Compositor con campos de t&iacute;tulo, resumen, imagen y etiquetas.</p>
        </div>
        <div class="feature-card">
            <h4>Hilos (NIP-10)</h4>
            <p>Vista completa de hilos con marcadores root/reply, conteo de respuestas, orden cronol&oacute;gico y enlaces permanentes.</p>
        </div>
        <div class="feature-card">
            <h4>Zaps Lightning</h4>
            <p>Zaps NIP-57 con transferencias internas entre usuarios registrados y facturas externas v&iacute;a BTCPay y LNURL-pay.</p>
        </div>
        <div class="feature-card">
            <h4>Integraci&oacute;n con BTCPay Server</h4>
            <p>Infraestructura Lightning auto-alojada v&iacute;a BTCPay Server. El endpoint LNURL-pay sirve facturas, crea solicitudes de pago BOLT11 y procesa recibos de zap (kind 9735) con firmas Schnorr del servidor. Los sats recibidos se acumulan en el balance del usuario para transferencias internas o retiro.</p>
        </div>
        <div class="feature-card">
            <h4>B&uacute;squeda</h4>
            <p>B&uacute;squeda de texto NIP-50 con fallback multi-relay. B&uacute;squeda de perfiles con @usuario. Detecci&oacute;n de entidades npub/note/nevent.</p>
        </div>
        <div class="feature-card">
            <h4>Suscripci&oacute;n a Temas</h4>
            <p>Suscr&iacute;bete a hashtags (#bitcoin, #nostr, etc.) y filtra tu feed. Temas sugeridos, activaci&oacute;n masiva, filtro de tendencias.</p>
        </div>
        <div class="feature-card">
            <h4>Favoritos y Silenciados</h4>
            <p>Guarda notas como favoritos localmente. Silencia usuarios con reporte de spam NIP-56 opcional. Gesti&oacute;n de silenciados en ajustes.</p>
        </div>
        <div class="feature-card">
            <h4>Manejo de Media</h4>
            <p>Im&aacute;genes embebidas (carga diferida), reproductores de v&iacute;deo, embeds de YouTube/Vimeo. Detecci&oacute;n de dominios ca&iacute;dos con reintento a las 24h.</p>
        </div>
        <div class="feature-card">
            <h4>Gesti&oacute;n de Perfil</h4>
            <p>Editar nombre, bio, avatar, banner. NIP-05 y direcci&oacute;n Lightning auto-configurados desde la cuenta del servidor.</p>
        </div>
        <div class="feature-card">
            <h4>Gesti&oacute;n de Relays</h4>
            <p>A&ntilde;adir/eliminar/activar relays. Estado de conexi&oacute;n en tiempo real. Reconexi&oacute;n con backoff exponencial. Rebalanceo de suscripciones.</p>
        </div>
        <div class="feature-card">
            <h4>&#8383;itcoin P2P (Mostro)</h4>
            <p>Tab dedicado para comprar Bitcoin sin intermediarios usando el protocolo <a href="https://mostro.network" target="_blank">Mostro</a> sobre Nostr. Muestra &oacute;rdenes de venta (kind 38383, NIP-69) con explicaci&oacute;n did&aacute;ctica en lenguaje llano. Flujo guiado: tomar orden &rarr; DM cifrado a la instancia &rarr; enviar factura Lightning de cobro &rarr; recibir sats. Sin nodo Lightning propio; compatible con Phoenix, Breez, Zeus.</p>
        </div>
        <div class="feature-card">
            <h4>Tarjetas de Perfil AR</h4>
            <p>Parsea y renderiza broadcasts de perfiles de redes mesh AR (ar_profile, ar_collaboration) como tarjetas visuales con avatar, ubicaci&oacute;n y acciones sociales.</p>
        </div>
    </div>
</section>

<!-- ==================== COMPARATIVA ==================== -->
<section>
    <h2>Comparativa de Clientes</h2>
    <p>Una comparaci&oacute;n imparcial de Noxtr frente a clientes Nostr establecidos. Cada cliente tiene fortalezas diferentes &mdash; esta tabla pretende ser factual, no promocional.</p>

    <div class="legend">
        <span><b class="y">&#10003;</b> Soportado</span>
        <span><b class="p">~</b> Parcial</span>
        <span><b class="n">&mdash;</b> No soportado</span>
        <span><b class="na">n/a</b> No aplica</span>
    </div>

    <h3>General</h3>
    <div class="table-wrap">
    <table>
        <tr>
            <th></th>
            <th class="noxtr-col">Noxtr</th>
            <th>Damus</th>
            <th>Amethyst</th>
            <th>Primal</th>
            <th>Snort</th>
            <th>Iris</th>
            <th>Coracle</th>
            <th>Nostur</th>
        </tr>
        <tr>
            <td>Plataforma</td>
            <td class="noxtr-col">Web</td>
            <td>iOS</td>
            <td>Android</td>
            <td>Web/iOS/Android</td>
            <td>Web</td>
            <td>Web/Multi</td>
            <td>Web (PWA)</td>
            <td>iOS/macOS</td>
        </tr>
        <tr>
            <td>C&oacute;digo abierto</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Auto-alojado</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Sin paso de compilaci&oacute;n</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="na">n/a</span></td>
            <td><span class="na">n/a</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="na">n/a</span></td>
        </tr>
        <tr>
            <td>NIPs documentados</td>
            <td class="noxtr-col">18</td>
            <td>~15</td>
            <td>60+</td>
            <td>~20</td>
            <td>42</td>
            <td>~15</td>
            <td>~15</td>
            <td>~15</td>
        </tr>
    </table>
    </div>

    <h3>Soporte de NIPs Principales</h3>
    <div class="table-wrap">
    <table>
        <tr>
            <th>NIP</th>
            <th></th>
            <th class="noxtr-col">Noxtr</th>
            <th>Damus</th>
            <th>Amethyst</th>
            <th>Primal</th>
            <th>Snort</th>
            <th>Iris</th>
            <th>Coracle</th>
            <th>Nostur</th>
        </tr>
        <tr>
            <td>01</td><td>Protocolo b&aacute;sico</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>02</td><td>Lista de contactos</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>04</td><td>DMs cifrados (legacy)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">lectura</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>05</td><td>Identidad DNS</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>07</td><td>Firmante del navegador</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="na">n/a</span></td>
            <td><span class="na">n/a</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="na">n/a</span></td>
        </tr>
        <tr>
            <td>09</td><td>Eliminaci&oacute;n de eventos</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>10</td><td>Hilos de respuesta</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>17</td><td>DMs privados (gift wrap)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>19</td><td>Entidades Bech32</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>23</td><td>Contenido largo (art&iacute;culos)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>25</td><td>Reacciones</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>28</td><td>Canales p&uacute;blicos</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>44</td><td>Cifrado versionado</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>46</td><td>Nostr Connect</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>47</td><td>Nostr Wallet Connect</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>50</td><td>B&uacute;squeda</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>57</td><td>Zaps Lightning</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>65</td><td>Metadatos de relays</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>94</td><td>Metadatos de archivo</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>96</td><td>Almacenamiento HTTP de archivos</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr><td colspan="10" style="text-align:center;font-size:0.78em;color:var(--text-muted,#888);padding:6px 0;border-top:2px dashed var(--border,#444);">Pendientes de implementar en Noxtr</td></tr>
        <tr>
            <td>29</td><td>Grupos relay-based</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>35</td><td>Torrents</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>51</td><td>Listas (mute, pin, bookmarks, sets)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>72</td><td>Comunidades moderadas</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>78</td><td>App data personalizada</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
    </table>
    </div>

    <h3>Funcionalidades</h3>
    <div class="table-wrap">
    <table>
        <tr>
            <th>Funcionalidad</th>
            <th class="noxtr-col">Noxtr</th>
            <th>Damus</th>
            <th>Amethyst</th>
            <th>Primal</th>
            <th>Snort</th>
            <th>Iris</th>
            <th>Coracle</th>
            <th>Nostur</th>
        </tr>
        <tr>
            <td>DMs modernos (NIP-17/44)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Wallet integrado</td>
            <td class="noxtr-col"><span class="p">balance</span></td>
            <td><span class="p">Coinos</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">Cashu</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>B&uacute;squeda de perfiles (@user)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Canales p&uacute;blicos (NIP-28)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Feed de tendencias</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Suscripci&oacute;n a temas/hashtags</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
        </tr>
        <tr>
            <td>Hosting NIP-05</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">premium</span></td>
            <td><span class="p">pago</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Hosting direcci&oacute;n Lightning</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">pago</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>M&uacute;ltiples cuentas</td>
            <td class="noxtr-col"><span class="p">logout/login</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Contenido largo (NIP-23)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Comunidades (NIP-72)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Subida de archivos (NIP-96)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Metadatos de archivo (NIP-94)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Nostr Wallet Connect (NIP-47)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Listas sincronizadas (NIP-51)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>Grupos relay (NIP-29)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>App data en relay (NIP-78)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">~</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Torrents (NIP-35)</td>
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Integraci&oacute;n BTCPay Server</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Compra Bitcoin P2P (Mostro)</td>
            <td class="noxtr-col"><span class="u">&uacute;nico</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Renderizado de perfiles AR</td>
            <td class="noxtr-col"><span class="u">&uacute;nico</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
    </table>
    </div>

    <div class="highlight">
        <strong>Nota de imparcialidad:</strong> Amethyst lidera el ecosistema en n&uacute;mero de NIPs (60+). Primal ofrece la mejor experiencia de onboarding e infraestructura de b&uacute;squeda. Coracle destaca en gesti&oacute;n de relays. Iris fue pionero en cifrado de DMs con double ratchet. Nostur tiene la mejor integraci&oacute;n con el ecosistema Apple. El diferenciador de Noxtr es la infraestructura de identidad auto-alojada (NIP-05 + direcci&oacute;n Lightning) y la arquitectura sin dependencias &mdash; no la amplitud de NIPs.
    </div>
</section>

<!-- ==================== LIMITACIONES ==================== -->
<section>
    <h2>Limitaciones Conocidas <span style="font-size:0.7em;font-weight:300;">(no por mucho tiempo)</span></h2>
    <p>&Aacute;reas donde Noxtr est&aacute; por detr&aacute;s de otros clientes:</p>
    <ul>
        <li><strong>NIP-72/29 (Comunidades/Grupos)</strong> &mdash; Sin soporte para comunidades moderadas ni grupos basados en relays.</li>
        <li><strong>NIP-51 (Listas)</strong> &mdash; Sin sincronizaci&oacute;n de listas en relay. Mute, favoritos y canales fijados son locales (BD del servidor). No interoperables con otros clientes.</li>
        <li><strong>NIP-78 (App data)</strong> &mdash; Sin persistencia de preferencias de UI en relays (kind 30078). Ajustes solo locales en BD del servidor.</li>
        <li><strong>NIP-35 (Torrents)</strong> &mdash; Sin soporte para marketplace de torrents (kinds 2003/2004). Potencial sinergia con el esp&iacute;ritu P2P/Bitcoin de Noxtr.</li>
        <li><strong>M&uacute;ltiples cuentas</strong> &mdash; Sin selector de cuentas instant&aacute;neo. El cambio de cuenta requiere logout y nuevo login, pero es posible.</li>
        <li><strong>Modelo outbox</strong> &mdash; Sin enrutamiento de relays por usuario. Todas las suscripciones van al pool de relays configurado.</li>
        <li><strong>Sin app nativa</strong> &mdash; Solo web, pero funciona en m&oacute;vil v&iacute;a navegador y soporta &ldquo;A&ntilde;adir a pantalla de inicio&rdquo; para experiencia app-like. Sin notificaciones push.</li>
    </ul>
</section>

<!-- ==================== FORTALEZAS ==================== -->
<section>
    <h2>Fortalezas Distintivas</h2>
    <ul>
        <li><strong>Identidad auto-alojada</strong> &mdash; NIP-05 y direcciones Lightning servidas desde tu propio dominio, auto-configuradas.</li>
        <li><strong>Frontend sin dependencias</strong> &mdash; Sin npm, sin herramientas de build, sin framework. Despliegue copiando archivos.</li>
        <li><strong>Transferencias internas de zaps</strong> &mdash; Los usuarios registrados pueden hacer zaps entre s&iacute; sin comisiones de la red Lightning.</li>
        <li><strong>Canales NIP-28</strong> &mdash; Uno de los pocos clientes web con soporte completo de chat p&uacute;blico (crear, unirse, fijar, enlaces de invitaci&oacute;n, eliminar mensajes propios).</li>
        <li><strong>Art&iacute;culos NIP-23</strong> &mdash; Contenido largo integrado en el feed principal con deduplicaci&oacute;n de eventos reemplazables, renderizado Markdown y compositor dedicado con t&iacute;tulo/resumen/imagen.</li>
        <li><strong>Filtrado de feed por temas</strong> &mdash; Suscr&iacute;bete a hashtags y filtra tu feed global sin necesidad de seguir usuarios espec&iacute;ficos.</li>
        <li><strong>Renderizado de perfiles AR mesh</strong> &mdash; El &uacute;nico cliente Nostr que parsea y renderiza broadcasts de perfiles de colaboraci&oacute;n AR/mesh como tarjetas visuales.</li>
        <li><strong>Detecci&oacute;n de dominios ca&iacute;dos</strong> &mdash; Detecta autom&aacute;ticamente y gestiona con gracia CDNs de im&aacute;genes ca&iacute;dos con reintento a las 24h.</li>
        <li><strong>NIP-46 con QR + persistencia</strong> &mdash; Flujo completo de Nostr Connect con c&oacute;digo QR, persistencia en localStorage entre sesiones.</li>
        <li><strong>Lightning en el servidor</strong> &mdash; Endpoint LNURL-pay con integraci&oacute;n BTCPay y keypair del servidor auto-generado para recibos de zap.</li>
        <li><strong>Bitcoin P2P integrado (Mostro / NIP-69)</strong> &mdash; El &uacute;nico cliente Nostr web con soporte nativo para comprar Bitcoin P2P a trav&eacute;s del protocolo Mostro, con flujo guiado paso a paso y explicaciones did&aacute;cticas por orden &mdash; pensado para novatos.</li>
    </ul>
</section>

<!-- ==================== MOSTRO P2P ==================== -->
<section>
    <h2>&#8383;itcoin P2P &mdash; Mostro</h2>
    <p>Noxtr incluye soporte nativo para <a href="https://mostro.network" target="_blank" rel="noopener">Mostro</a>, un protocolo de intercambio de Bitcoin entre pares (P2P) que funciona sobre Nostr. Puedes comprar o vender Bitcoin directamente con otras personas, sin intermediarios ni custodios, pagando con transferencia bancaria, Bizum, efectivo o cualquier otro m&eacute;todo acordado.</p>
    <p>El tab <strong>P2P &#8383;</strong> en la barra de navegaci&oacute;n te da acceso al order book en tiempo real con todas las ofertas disponibles.</p>

    <div class="highlight">
        <strong>&iquest;Qu&eacute; es Mostro?</strong> una instancia (programa autom&aacute;tico) que act&uacute;a como &aacute;rbitro de confianza entre comprador y vendedor. La instancia retiene los Bitcoin del vendedor en dep&oacute;sito hasta que el comprador confirma haber enviado el dinero fiat, momento en que los libera autom&aacute;ticamente. Nadie puede robar: ni el comprador (porque los sats est&aacute;n bloqueados), ni el vendedor (porque la instancia no los libera hasta recibir la confirmaci&oacute;n).
    </div>

    <h3>Instancias y versi&oacute;n del protocolo</h3>
    <p>Puedes a&ntilde;adir y activar varias <strong>instancias Mostro</strong> (instancias) en la barra de chips del tab P2P. El order book agrega las ofertas de todas las instancias activas; al crear una oferta eliges en cu&aacute;l se publica.</p>
    <ul>
        <li>Cada chip muestra una etiqueta <strong>v1</strong> (roja) o <strong>v2</strong> (verde) con la versi&oacute;n del transporte que anuncia la instancia (tag <code>protocol_version</code> de su evento de estado, kind 38385).</li>
        <li>Noxtr habla exclusivamente el <strong>transporte v2</strong> (mensajes directos NIP-44, kind 14). El transporte v1 (gift wrap) est&aacute; obsoleto: las ofertas de instancias v1 se ocultan del order book y no se puede operar con ellas.</li>
        <li>Haciendo <strong>clic en la etiqueta v1/v2</strong> se abre la ficha completa de la instancia: versi&oacute;n del daemon, l&iacute;mites de orden, comisi&oacute;n, monedas fiat aceptadas, pol&iacute;tica de fianza anti-abuso (bond), datos del nodo Lightning, etc.</li>
    </ul>

    <div class="highlight">
        <strong>Fianza anti-abuso (bond).</strong> Algunas instancias exigen una peque&ntilde;a fianza al crear o tomar &oacute;rdenes (badge <em>FIANZA</em> en el order book). Noxtr la soporta: al operar se muestra un QR con la <em>hold invoice</em> de la fianza, que se devuelve al completar el trade correctamente. Si dejas expirar un trade sin actuar, la instancia puede quedarse parte de la fianza (<em>slash</em>).
    </div>

    <h3>C&oacute;mo comprar Bitcoin (paso a paso)</h3>
    <p>No necesitas ninguna experiencia previa con Bitcoin. Solo necesitas una <strong>wallet Lightning</strong> en el m&oacute;vil (Phoenix, Breez, Zeus, Wallet of Satoshi&hellip;).</p>
    <ol>
        <li><strong>Abre el tab P2P &#8383;</strong> &mdash; Ver&aacute;s una lista de ofertas de venta con importe, moneda y m&eacute;todo de pago.</li>
        <li><strong>Elige una oferta</strong> que se adapte a ti (importe, m&eacute;todo de pago) y pulsa <em>Comprar</em>.</li>
        <li><strong>Introduce tu Lightning Address</strong> (ej. <code>usuario@wallet.com</code>) o una factura bolt11 generada desde tu wallet &mdash; ah&iacute; es donde recibir&aacute;s los sats.</li>
        <li><strong>La instancia entra en acci&oacute;n:</strong> bloquea los Bitcoin del vendedor y te notifica cu&aacute;nto debes pagar en fiat y c&oacute;mo.</li>
        <li><strong>Env&iacute;a el dinero</strong> al vendedor por el m&eacute;todo indicado (transferencia, Bizum, etc.) y pulsa <em>Fiat enviado</em>.</li>
        <li><strong>El vendedor confirma</strong> que ha recibido el pago fiat y pulsa <em>Liberar sats</em>.</li>
        <li><strong>&iexcl;Listo!</strong> Los sats llegan a tu wallet Lightning. El trade aparece como completado en la ficha.</li>
    </ol>
    <p>Si la wallet del vendedor o el nodo de la instancia no puede enrutar el pago a tu direcci&oacute;n, la ficha del trade mostrar&aacute; un campo para introducir otra direcci&oacute;n Lightning alternativa. Tus sats est&aacute;n siempre a salvo con la instancia.</p>

    <h3>C&oacute;mo vender Bitcoin</h3>
    <ol>
        <li><strong>Pulsa <em>Nueva orden</em></strong> en el tab P2P &#8383; y elige <em>Vender BTC</em>.</li>
        <li><strong>Configura la oferta:</strong> importe en fiat, moneda, m&eacute;todo de pago aceptado y tipo de importe (fijo o rango).</li>
        <li><strong>Publica la orden.</strong> Aparecer&aacute; en el order book para que otros la tomen.</li>
        <li><strong>Cuando alguien la toma</strong>, la instancia te env&iacute;a una <em>hold invoice</em> (factura retenida). P&aacute;gala desde tu wallet Lightning &mdash; los sats quedar&aacute;n bloqueados, no cobrados, hasta finalizar el trade.</li>
        <li><strong>Da al comprador los datos de pago</strong> y espera a recibir el dinero fiat por el m&eacute;todo acordado.</li>
        <li><strong>Cuando llegue el dinero fiat</strong>, pulsa <em>Liberar sats</em>. La instancia los enviar&aacute; al comprador.</li>
    </ol>

    <h3>Reputaci&oacute;n y valoraciones</h3>
    <p>Al completar un trade puedes valorar a la contraparte de 1 a 5 estrellas. Las valoraciones recibidas aparecen en tu ficha de reputaci&oacute;n (&#11088; promedio &middot; n&uacute;mero de trades). Los instancias Mostro publican la reputaci&oacute;n acumulada de cada usuario en sus &oacute;rdenes del order book.</p>
    <p>Por defecto Noxtr opera en <strong>modo privacidad total</strong> (una clave derivada distinta para cada trade, sin ligar p&uacute;blicamente las operaciones). Si quieres <strong>acumular reputaci&oacute;n</strong>, activa el bot&oacute;n &#11088; <em>Reputaci&oacute;n</em>: los trades nuevos quedan ligados a la identidad &iacute;ndice 0 derivada de la semilla de tu sesi&oacute;n Mostro, separada de tu identidad social Nostr. Funciona tambi&eacute;n con extensi&oacute;n o firmador remoto.</p>

    <h3>Disputas</h3>
    <p>Si algo va mal en un trade en estados <code>activo</code> o <code>fiat_enviado</code> (la contraparte no responde, no env&iacute;a el dinero, niega haber recibido un pago confirmado&hellip;), puedes <strong>iniciar una disputa</strong>. La disputa la resuelve un administrador humano de la instancia Mostro.</p>

    <ol>
        <li><strong>Pulsa <em>Disputar</em></strong> en la ficha del trade. El bot&oacute;n aparece junto a las acciones cuando el trade est&aacute; en <code>activo</code> o <code>fiat_enviado</code>.</li>
        <li><strong>Confirma</strong>. Tu cliente env&iacute;a la acci&oacute;n <code>dispute</code> a la instancia.</li>
        <li><strong>La instancia publica la disputa</strong> y notifica a la contraparte. Tu trade pasa a estado <code>disputado</code> con un identificador de disputa visible en la ficha.</li>
        <li><strong>Espera a que un admin la tome.</strong> Cuando ocurra, recibir&aacute;s la acci&oacute;n <code>admin-took-dispute</code> y aparecer&aacute; un nuevo recuadro de chat directo con el admin debajo de la ficha del trade.</li>
        <li><strong>Resuelve con el admin.</strong> El chat es independiente del chat con la contraparte y est&aacute; cifrado con una clave compartida derivada espec&iacute;ficamente entre tu trade key y la pubkey del admin.</li>
        <li><strong>Veredicto del admin.</strong> El admin puede liberar los sats al comprador (<em>admin-settle-dispute</em>) o cancelar la disputa devolvi&eacute;ndolos al vendedor (<em>admin-cancel-dispute</em>). El trade se cierra autom&aacute;ticamente.</li>
    </ol>

    <p>El bot&oacute;n <em>Anular disputa</em> (visible si la iniciaste t&uacute; y a&uacute;n no hay admin asignado) solo la oculta de tu lista local: el protocolo Mostro no permite retirar una disputa, as&iacute; que en la instancia sigue abierta hasta que un admin la resuelva.</p>

    <p>Si la contraparte solicita cancelaci&oacute;n cooperativa de un trade activo y no est&aacute;s de acuerdo, puedes <em>Disputar</em> en lugar de aceptar la cancelaci&oacute;n.</p>

    <p>Listado de tus disputas en <a href="/noxtr/disputes">/noxtr/disputes</a>: muestra ID de disputa, estado p&uacute;blico (<code>initiated</code> / <code>in-progress</code>), iniciador, admin asignado y &uacute;ltima actualizaci&oacute;n.</p>

    <div class="highlight">
        <strong>Seguridad del chat de disputa.</strong> Tu cliente solo acepta mensajes en el canal de la disputa cuya pubkey real (tras desempaquetar el gift wrap NIP-59) sea la de la instancia Mostro o la del admin asignado. Cualquier intento de impersonaci&oacute;n por terceros se descarta autom&aacute;ticamente. Esto cumple el requisito del <a href="https://mostro.network/protocol/dispute_chat.html" target="_blank" rel="noopener">protocolo Mostro</a>.
    </div>

    <h3>Para administradores &mdash; Mostro P2P</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Relay obligatorio</h4>
            <p>Para enviar mensajes a la instancia es necesario que <code>wss://relay.mostro.network</code> est&eacute; activo en la lista de relays del usuario. El order book funciona con cualquier relay general, pero la comunicaci&oacute;n con la instancia requiere ese relay espec&iacute;fico. Noxtr lo a&ntilde;ade autom&aacute;ticamente como relay por defecto en las nuevas instalaciones.</p>
        </div>
        <div class="feature-card">
            <h4>Sin nodo Lightning propio</h4>
            <p>Noxtr no requiere que el servidor tenga un nodo Lightning para el flujo Mostro. La wallet Lightning es del usuario final (Phoenix, Breez, Zeus, etc.). BTCPay Server solo es necesario para el sistema de zaps y direcciones Lightning de perfil, no para Mostro.</p>
        </div>
        <div class="feature-card">
            <h4>Datos almacenados</h4>
            <p>Los trades activos se guardan en <code>NSTR_TRADES</code> y los eventos Mostro en <code>NSTR_EVENTS</code>. Ambas tablas se crean autom&aacute;ticamente. La reputaci&oacute;n de la contraparte no se calcula en local: se lee del tag <code>rating</code> del evento 38383 que publica la instancia.</p>
        </div>
    </div>
</section>

<!-- ==================== ON-CHAIN ==================== -->
<section>
    <h2>&#8383;itcoin P2P on-chain &mdash; NostrEscrow</h2>
    <p>Adem&aacute;s del flujo Lightning con Mostro, Noxtr soporta intercambios P2P <strong>on-chain</strong> mediante NostrEscrow: los fondos se depositan en una direcci&oacute;n <strong>escrow Taproot 2-de-3</strong> (comprador, vendedor y &aacute;rbitro), sin instancia custodio.</p>
    <ul>
        <li><strong>Ofertas on-chain</strong> en el mismo order book (chip <em>on-chain</em>), con importe, m&eacute;todo de pago y &aacute;rbitros propuestos.</li>
        <li><strong>Escrow Taproot</strong>: el vendedor deposita los BTC en la direcci&oacute;n 2-de-3; comprador y vendedor cooperan para liberar, y solo si hay conflicto interviene el &aacute;rbitro.</li>
        <li><strong>&Aacute;rbitros</strong>: registro p&uacute;blico de &aacute;rbitros con condiciones y fianza; el operador del sitio act&uacute;a como &aacute;rbitro por defecto.</li>
        <li><strong>Claves propias</strong>: las claves del escrow se derivan en tu navegador (BIP-86); el servidor nunca ve claves privadas.</li>
        <li>Chat cifrado entre las partes, disputas con arbitraje y notificaciones del Monitor en cada paso (tomada, funding, fiat enviado/recibido, payout, disputa).</li>
    </ul>

    <div class="highlight">
        <strong>Propuesta de NIP.</strong> El protocolo NostrEscrow est&aacute; especificado como borrador de NIP (en ingl&eacute;s, formato est&aacute;ndar del repositorio de NIPs: kinds, tags, flujos y consideraciones de seguridad), abierto a otras implementaciones:
        <a class="open_file open_file_txt" title="Propuesta NIP NostrEscrow"  data-ext="md" data-href="/_modules_/noxtr/NIP-NOSTRESCROW.md">NIP-NOSTRESCROW.md</a>.
        Los kinds <code>39383-39389</code> son provisionales hasta su eventual env&iacute;o al repositorio oficial de NIPs.
    </div>
</section>

<!-- ==================== MOSTRO MONITOR ==================== -->
<section>
    <h2>Monitor del Servidor &mdash; Notificaciones</h2>
    <p>El Monitor es un proceso PHP que corre en el servidor en segundo plano y vigila los trades Mostro activos aunque ning&uacute;n usuario tenga la web abierta. Escucha los relays Nostr continuamente y act&uacute;a cuando recibe eventos relevantes.</p>

    <h3>Para usuarios &mdash; &iquest;Qu&eacute; hace el Monitor por ti?</h3>
    <p>Si el administrador del sitio tiene el Monitor activo, recibir&aacute;s avisos autom&aacute;ticos cuando ocurra algo en tus trades:</p>

    <div class="table-wrap">
    <table>
        <tr><th>Evento</th><th>Notificaci&oacute;n recibida</th></tr>
        <tr><td>Alguien toma tu orden publicada</td><td>Email: &ldquo;Han tomado tu orden #XXXXXXXX&rdquo;</td></tr>
        <tr><td>La instancia te pide pagar la hold invoice (vendes BTC)</td><td>Email: &ldquo;Debes pagar la hold invoice&rdquo;</td></tr>
        <tr><td>El comprador confirma que envi&oacute; el fiat (vendes BTC)</td><td>Email: &ldquo;El comprador ha enviado el pago&rdquo;</td></tr>
        <tr><td>El trade se completa</td><td>Email: &ldquo;Trade completado&rdquo;</td></tr>
        <tr><td>La contraparte inicia una disputa</td><td>Email + Telegram: &ldquo;&#9888;&#65039; La contraparte ha iniciado una disputa&rdquo;</td></tr>
        <tr><td>Has iniciado t&uacute; una disputa</td><td>Email + Telegram: confirmaci&oacute;n &ldquo;Has iniciado una disputa&rdquo;</td></tr>
        <tr><td>Un admin ha tomado la disputa</td><td>Email + Telegram: &ldquo;&#128737;&#65039; Un admin ha tomado la disputa &mdash; abre la web para chatear con &eacute;l&rdquo;</td></tr>
        <tr><td>Mensaje privado nuevo en tu buzón</td><td>Telegram (si tienes el bot vinculado)</td></tr>
    </table>
    </div>

    <p>Cada notificaci&oacute;n se env&iacute;a <strong>una sola vez por trade y tipo de evento</strong> &mdash; no hay spam.</p>

    <h3>Vincular Telegram para recibir avisos</h3>
    <ol>
        <li>Con la sesi&oacute;n iniciada, abre la secci&oacute;n <a href="/telegram"><strong>/telegram</strong></a> de la web.</li>
        <li>Pulsa el bot&oacute;n <em>Vincular Telegram</em>: en esa misma pantalla aparecer&aacute;n las dos opciones siguientes, con un c&oacute;digo de un solo uso (caduca a los 10 minutos; si caduca, vuelve a pulsar el bot&oacute;n).</li>
        <li><strong>Opci&oacute;n A &mdash; desde el m&oacute;vil:</strong> pulsa el bot&oacute;n verde <em>&ldquo;Abrir bot en Telegram&rdquo;</em> que aparece bajo el bot&oacute;n de vincular. Se abre el chat del bot con el c&oacute;digo ya incluido; basta con pulsar <em>Iniciar</em>.</li>
        <li><strong>Opci&oacute;n B &mdash; desde el ordenador:</strong> copia el comando <code>/start CODIGO</code> mostrado en esa misma pantalla (bot&oacute;n <em>Copiar</em>), abre Telegram, entra en el chat del bot del sitio y env&iacute;alo como mensaje.</li>
        <li>El bot confirmar&aacute; la vinculaci&oacute;n. A partir de ese momento recibir&aacute;s los avisos (mensajes privados nuevos, eventos de tus trades...).</li>
    </ol>

    <h3>Para administradores &mdash; Arrancar y parar el Monitor</h3>
    <p>El Monitor se gestiona desde el <strong>panel de administraci&oacute;n web</strong> (<code>/noxtr/server_admin</code>) con los botones Start / Stop / Status, o directamente desde la consola del servidor:</p>
    <pre style="background:var(--bg-code,#1e1e2e);color:#cdd6f4;padding:1em;border-radius:6px;overflow-x:auto;font-size:0.85em;">php /ruta/index.php noxtr/server/action=monitor --verbose</pre>
    <p>Para dejarlo corriendo en background:</p>
    <pre style="background:var(--bg-code,#1e1e2e);color:#cdd6f4;padding:1em;border-radius:6px;overflow-x:auto;font-size:0.85em;">nohup php /ruta/index.php noxtr/server/action=monitor &gt; /var/log/monitor.log 2&gt;&amp;1 &amp;</pre>

    <h3>Para administradores &mdash; Comandos de control por DM Nostr</h3>
    <p>El Monitor tiene su propia identidad Nostr. Los administradores autorizados pueden enviarle DMs con comandos de texto plano desde cualquier cliente Nostr (incluyendo Noxtr). Su npub aparece en el mensaje de arranque y en el panel web.</p>

    <div class="table-wrap">
    <table>
        <tr><th>Comando</th><th>Acci&oacute;n</th></tr>
        <tr><td><code>ping</code></td><td>Comprueba que el canal responde. Devuelve <em>pong</em>.</td></tr>
        <tr><td><code>status</code></td><td>Versi&oacute;n, trades vigilados, uptime, relays.</td></tr>
        <tr><td><code>trades</code></td><td>Order book en tiempo real (opciones: <code>age 4h</code>, <code>amount 50 EUR</code>, <code>status pending</code>).</td></tr>
        <tr><td><code>relays</code></td><td>Relays conectados en la sesi&oacute;n actual.</td></tr>
        <tr><td><code>email</code></td><td>Env&iacute;a un email de prueba al admin.</td></tr>
        <tr><td><code>reload</code></td><td>Reconecta a los relays sin reiniciar el proceso.</td></tr>
        <tr><td><code>stop</code></td><td>Para el proceso limpiamente.</td></tr>
        <tr><td><code>help</code></td><td>Ayuda contextual completa.</td></tr>
    </table>
    </div>

    <h3>Para administradores &mdash; Notificaciones de nuevas &oacute;rdenes</h3>
    <p>Adem&aacute;s de vigilar trades propios, el Monitor notifica al administrador cada nueva orden que aparece en el order book Mostro (<strong>solo de instancias con transporte v2</strong>; las v1, obsoletas, se ignoran) y cada nueva oferta on-chain. Se puede activar/desactivar con el comando <code>notify-new-offers on|off</code>.</p>
    <ul>
        <li><strong>DM Nostr</strong> al npub del administrador con un resumen de la orden.</li>
        <li><strong>Telegram</strong> con todos los detalles: ID, tipo (BUY/SELL), importe, m&eacute;todo de pago y antig&uuml;edad de la instancia.</li>
        <li><strong>Email</strong> con la misma informaci&oacute;n en formato HTML.</li>
    </ul>
    <p>Para recibir notificaciones de nuevas &oacute;rdenes por Telegram, el administrador debe tener el bot vinculado <strong>y</strong> su pubkey Nostr a&ntilde;adida a <code>admin_pubkeys</code> en la configuraci&oacute;n del Monitor.</p>

    <div class="highlight">
        <strong>Seguridad del canal de control:</strong> Solo los administradores con pubkey en <code>admin_pubkeys</code> pueden enviar comandos. Los eventos se verifican criptogr&aacute;ficamente con firma Schnorr. Los comandos con m&aacute;s de 5 minutos de antig&uuml;edad se ignoran autom&aacute;ticamente.
    </div>
</section>

<!-- ==================== ARQUITECTURA ==================== -->
<section>
    <h2>Arquitectura T&eacute;cnica</h2>
    <div class="table-wrap">
    <table>
        <tr><th>Componente</th><th>Tecnolog&iacute;a</th></tr>
        <tr><td>Frontend</td><td>JavaScript vanilla (IIFE &uacute;nico), helper DOM wquery</td></tr>
        <tr><td>Backend</td><td>PHP (m&oacute;dulo del framework ExtFW)</td></tr>
        <tr><td>Base de datos</td><td>MySQL o SQLite (SQL dual-compatible)</td></tr>
        <tr><td>Servidor web</td><td>Apache (mod_rewrite) o nginx</td></tr>
        <tr><td>Criptograf&iacute;a</td><td>noble-secp256k1 (BIP-340 Schnorr), noble-ciphers (XChaCha20-Poly1305), Web Crypto API (AES-CBC, HKDF)</td></tr>
        <tr><td>Lightning</td><td>BTCPay Server (LNURL-pay, facturas BOLT11)</td></tr>
        <tr><td>Almacenamiento</td><td>BD del servidor (contactos, temas, favoritos, DMs, relays, silenciados, canales, servidores NIP-96, NWC URI) + localStorage/IndexedDB (claves, estado UI). Im&aacute;genes adjuntas suben a servidores NIP-96 externos &mdash; no al servidor PHP</td></tr>
    </table>
    </div>
</section>

<!-- ==================== BACKLOG / ROADMAP ==================== -->
<section>
    <h2>Backlog &mdash; Ideas y Mejoras Futuras</h2>
    <p>Funcionalidades en cola sin fecha definida. La fuente can&oacute;nica vive en <a class="open_file open_file_txt" title="BACKLOG"  data-ext="md" data-href="/_modules_/noxtr/BACKLOG.md"><code>_modules_/noxtr/BACKLOG.md</code></a> dentro del repositorio.</p>


    
    <div class="features">
        <div class="feature-card">
            <h4>NIP-51 &mdash; Sincronizaci&oacute;n de listas</h4>
            <p>Hacer portables las listas (topics, bookmarks, muted, channels, relays) entre clientes Nostr y entre instancias Noxtr v&iacute;a kinds 10000-10015. Hoy las listas viven solo en BD local; el export/import manual cubre la migraci&oacute;n. NIP-51 a&ntilde;adir&iacute;a sync continuo y bidireccional.</p>
        </div>
        <div class="feature-card">
            <h4>NIP-ED2K &mdash; Indexador eMule sobre Nostr</h4>
            <p>Propuesta de NIP propio (no estandarizado) para directorio descentralizado de servidores ed2k y enlaces ed2k. Kinds 2010 (server) y 2011 (file). Especificaci&oacute;n completa (borrador): <a class="open_file open_file_txt" title="Propuesta NIP NIP-ED2K"  data-ext="md" data-href="/_modules_/noxtr/NIP-ED2K.md">NIP-ED2K.md</a>.</p>
        </div>
        <div class="feature-card">
            <h4>NIP-35 &mdash; Indexador de Torrents</h4>
            <p>Implementaci&oacute;n sencilla de kind 2003 con tags magnet/nombre/tama&ntilde;o. Postergado: el ecosistema est&aacute; casi vac&iacute;o hoy (0 eventos kind 2003 en los relays activos). Tendr&iacute;a sentido junto con NIP-ED2K en un tab unificado de "compartir archivos".</p>
        </div>
        <div class="feature-card">
            <h4>NIP-72 &mdash; Comunidades Moderadas</h4>
            <p>Comunidades tipo subreddit con moderaci&oacute;n criptogr&aacute;fica. Kinds 34550 (definici&oacute;n) y 4550 (aprobaci&oacute;n de moderador). Tab separado de Channels (NIP-28). &Uacute;til para feeds curados tipo foro.</p>
        </div>
        <div class="feature-card">
            <h4>CLI_USER &mdash; Cifrado client-side</h4>
            <p>Cifrar columnas sensibles de la tabla CLI_USER en el navegador, de manera que el servidor no vea datos personales en claro. Requiere dise&ntilde;o previo (qu&eacute; columnas, qu&eacute; clave, qu&eacute; pasa si el usuario la pierde).</p>
        </div>
    </div>
</section>

</div>

<footer>
    Noxtr &mdash; un m&oacute;dulo del framework ExtFW. &Uacute;ltima actualizaci&oacute;n: julio 2026.<br>
    Protocolo Nostr: <a href="https://github.com/nostr-protocol/nips">github.com/nostr-protocol/nips</a>
</footer>

<script>
(function() {
    var btn = document.getElementById('theme-toggle');
    var stored = localStorage.getItem('noxtr-spec-theme');
    if (stored === 'light') { document.documentElement.classList.add('light'); btn.innerHTML = '&#9790; Oscuro'; }
    btn.onclick = function() {
        var isLight = document.documentElement.classList.toggle('light');
        btn.innerHTML = isLight ? '&#9790; Oscuro' : '&#9788; Claro';
        localStorage.setItem('noxtr-spec-theme', isLight ? 'light' : 'dark');
    };
})();
</script>


    <script type="text/javascript" src="/_js_/wquery/wquery.js?v=A3.0.200" ></script>
    <script type="text/javascript" src="/_js_/wquery/wquery.draggable.js?v=3.0.200" ></script>
    <script type="text/javascript" src="/_js_/wquery/wquery.dialog.js?v=3.0.200" ></script>
