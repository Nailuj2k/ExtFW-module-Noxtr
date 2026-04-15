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
    <p>Noxtr es un cliente <a href="https://nostr.com">Nostr</a> web integrado en el framework PHP ExtFW. Funciona como un m&oacute;dulo dentro de un sitio web auto-alojado, combinando el acceso al protocolo Nostr con funcionalidades del servidor como cuentas de usuario, hosting de direcciones Lightning y verificaci&oacute;n de identidad NIP-05.</p>
    <p>Est&aacute; dise&ntilde;ado como una aplicaci&oacute;n de p&aacute;gina &uacute;nica sin frameworks JavaScript externos &mdash; vanilla JS con un helper DOM ligero (wquery).</p>

    <h3>Caracter&iacute;sticas Clave</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Auto-alojado</h4>
            <p>Se ejecuta en tu propio servidor (Apache/nginx, PHP, MySQL/SQLite). T&uacute; controlas tus datos, tu lista de relays y tus endpoints Lightning.</p>
        </div>
        <div class="feature-card">
            <h4>Cero Dependencias</h4>
            <p>Sin React, sin Vue, sin npm, sin paso de compilaci&oacute;n. JavaScript vanilla puro en un solo archivo. Criptograf&iacute;a v&iacute;a noble-secp256k1 y noble-ciphers.</p>
        </div>
        <div class="feature-card">
            <h4>Identidad Integrada</h4>
            <p>La verificaci&oacute;n NIP-05 y las direcciones Lightning LNURL-pay se auto-configuran desde las cuentas de usuario del servidor.</p>
        </div>
        <div class="feature-card">
            <h4>Multi-autenticaci&oacute;n</h4>
            <p>Soporta extensiones de navegador NIP-07, clave privada nsec, NIP-46 Nostr Connect (firma remota con QR) y modo s&oacute;lo lectura con npub.</p>
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
        <div class="nip-chip"><strong>NIP-23</strong><span>Contenido largo</span></div>
        <div class="nip-chip"><strong>NIP-19</strong><span>Entidades Bech32</span></div>
        <div class="nip-chip"><strong>NIP-25</strong><span>Reacciones</span></div>
        <div class="nip-chip"><strong>NIP-28</strong><span>Canales p&uacute;blicos</span></div>
        <div class="nip-chip"><strong>NIP-44</strong><span>Cifrado versionado</span></div>
        <div class="nip-chip"><strong>NIP-46</strong><span>Nostr Connect</span></div>
        <div class="nip-chip"><strong>NIP-50</strong><span>B&uacute;squeda</span></div>
        <div class="nip-chip"><strong>NIP-56</strong><span>Reportes</span></div>
        <div class="nip-chip"><strong>NIP-57</strong><span>Zaps Lightning</span></div>
        <div class="nip-chip"><strong>NIP-65</strong><span>Metadatos de relays</span></div>
        <div class="nip-chip"><strong>NIP-69</strong><span>&#8383;rdenes P2P (Mostro)</span></div>
    </div>

    <h3>Tipos de Evento (Kinds)</h3>
    <div class="table-wrap">
    <table>
        <tr><th>Kind</th><th>Descripci&oacute;n</th><th>Uso</th></tr>
        <tr><td>0</td><td>Metadatos de perfil</td><td>Nombre, avatar, banner, bio, nip05, lud16</td></tr>
        <tr><td>1</td><td>Nota de texto</td><td>Contenido principal del feed, hashtags, menciones</td></tr>
        <tr><td>3</td><td>Lista de contactos</td><td>Seguir/dejar de seguir, petnames, hints de relay</td></tr>
        <tr><td>4</td><td>DM cifrado</td><td>AES-CBC con IV, descifrado v&iacute;a NIP-07 o privkey</td></tr>
        <tr><td>5</td><td>Eliminaci&oacute;n</td><td>Borrar notas propias y mensajes de canal propios (kind 42)</td></tr>
        <tr><td>6</td><td>Repost</td><td>Compartir notas</td></tr>
        <tr><td>7</td><td>Reacci&oacute;n</td><td>Like/unlike en notas</td></tr>
        <tr><td>40</td><td>Crear canal</td><td>Canal de chat p&uacute;blico NIP-28</td></tr>
        <tr><td>41</td><td>Metadatos de canal</td><td>Nombre, descripci&oacute;n, imagen del canal</td></tr>
        <tr><td>42</td><td>Mensaje de canal</td><td>Mensajes en canales p&uacute;blicos (eliminaci&oacute;n propia v&iacute;a kind 5)</td></tr>
        <tr><td>1984</td><td>Reporte</td><td>Reportes de spam NIP-56</td></tr>
        <tr><td>30023</td><td>Art&iacute;culo (NIP-23)</td><td>Contenido largo: mezclado en el feed con badge &ldquo;Read&rdquo;, vista completa con Markdown, composici&oacute;n de art&iacute;culos</td></tr>
        <tr><td>38383</td><td>Orden P2P (NIP-69)</td><td>&#211;rdenes de compraventa Bitcoin de robots Mostro. Tab P2P &#8383; con listado de &oacute;rdenes, explicaci&oacute;n did&aacute;ctica y flujo de compra guiado</td></tr>
        <tr><td>9734</td><td>Solicitud de Zap</td><td>Metadatos de pago Lightning</td></tr>
        <tr><td>9735</td><td>Recibo de Zap</td><td>Confirmaci&oacute;n de pago desde el servidor</td></tr>
        <tr><td>24133</td><td>Nostr Connect</td><td>Firma remota NIP-46</td></tr>
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
            <h4>Mensajes Directos</h4>
            <p>DMs cifrados con NIP-04 con hilos de conversaci&oacute;n, cach&eacute; en base de datos local y descifrado v&iacute;a extensi&oacute;n.</p>
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
            <p>Tab dedicado para comprar Bitcoin sin intermediarios usando el protocolo <a href="https://mostro.network" target="_blank">Mostro</a> sobre Nostr. Muestra &oacute;rdenes de venta (kind 38383, NIP-69) con explicaci&oacute;n did&aacute;ctica en lenguaje llano. Flujo guiado: tomar orden &rarr; DM cifrado al robot &rarr; enviar factura Lightning de cobro &rarr; recibir sats. Sin nodo Lightning propio; compatible con Phoenix, Breez, Zeus.</p>
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
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
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
            <td class="noxtr-col"><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
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
        <li><strong>NIP-17 (DMs Modernos)</strong> &mdash; A&uacute;n usa NIP-04. La mayor&iacute;a de clientes modernos han migrado a NIP-17/NIP-44 para DMs, que ofrece mejor protecci&oacute;n de metadatos.</li>
        <li><strong>NIP-96 (Subida de Archivos)</strong> &mdash; Sin soporte para almacenamiento de archivos descentralizado. Las subidas de im&aacute;genes van solo al servidor propio.</li>
        <li><strong>NIP-47 (Wallet Connect)</strong> &mdash; Sin integraci&oacute;n NWC. Los zaps dependen del balance interno o BTCPay.</li>
        <li><strong>NIP-72/29 (Comunidades/Grupos)</strong> &mdash; Sin soporte para comunidades moderadas ni grupos basados en relays.</li>
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
        <tr><td>Almacenamiento</td><td>BD del servidor (contactos, temas, favoritos, DMs, relays, silenciados, canales) + localStorage/IndexedDB (claves, estado UI)</td></tr>
    </table>
    </div>
</section>

</div>

<footer>
    Noxtr &mdash; un m&oacute;dulo del framework ExtFW. &Uacute;ltima actualizaci&oacute;n: marzo 2026.<br>
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
