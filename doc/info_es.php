<h3>¿Qué es noxtr?</h3>
<p>Un cliente de <strong>Nostr</strong> con compraventa de Bitcoin P2P integrada. Nostr es una red social descentralizada &mdash; ninguna empresa posee tus datos, nadie puede banearte, y tu identidad es tuya para siempre.</p>

<h4>Qué puedes hacer aquí</h4>
<ul>
    <li><strong>Topics</strong> &mdash; Añade hashtags que te interesen (#bitcoin, #nostr, #music...). El feed muestra posts que coincidan con tus topics activos. Activa "All" para verlo todo.</li>
    <li><strong>Following / Followers</strong> &mdash; Sigue a personas para ver sus posts. Añádelas por su npub o con el botón follow de cualquier post.</li>
    <li><strong>Messages</strong> &mdash; Conversaciones privadas cifradas (NIP-04 y NIP-17 con gift wrap 🔒).</li>
    <li><strong>Channels</strong> &mdash; Chat público en canales (NIP-28): crea, únete, invita.</li>
    <li><strong>Artículos</strong> &mdash; Lee y publica contenido largo (NIP-23) con Markdown, integrado en el feed.</li>
    <li><strong>Zaps</strong> &mdash; Propinas en Bitcoin (sats). Si el destinatario está registrado aquí, la transferencia es instantánea; si no, se genera una invoice Lightning.</li>
    <li><strong>P2P &#8383;</strong> &mdash; Compra y vende Bitcoin sin intermediarios: por Lightning (protocolo Mostro) o on-chain con escrow Taproot y árbitros. Con chat cifrado, disputas y notificaciones.</li>
</ul>
<p>💡 Click en Topics, Following, Followers y Relays para activar/desactivar, ¡sin borrarlos!</p>

<h4>Tu identidad</h4>
<p>Puedes entrar con tu <em>nsec</em>, con una extensión NIP-07, o firmando desde el móvil con <strong>NostrConnect (NIP-46)</strong> &mdash; por ejemplo con <a target="_blank" rel="noopener" href="https://signer.noxtr.net">signer.noxtr.net</a>: tu clave nunca sale del móvil. También puedes mirar sin firmar pegando un npub (solo lectura).</p>

<h4>Ventajas de registrarte</h4>
<ul>
    <li><strong>Registro 100% anónimo</strong> &mdash; Con Nostr: sin email, sin contraseña, sin datos personales.</li>
    <li><strong>Identidad verificada (NIP-05)</strong> &mdash; <em>username@<?=$_SERVER['HTTP_HOST']?></em> con check en Damus, Primal y otros clientes.</li>
    <li><strong>Lightning Address</strong> &mdash; <em>username@<?=$_SERVER['HTTP_HOST']?></em> para recibir zaps desde cualquier cliente o wallet.</li>
    <li><strong>Wallet integrado</strong> &mdash; Los sats recibidos se acumulan en tu balance y puedes retirarlos cuando quieras.</li>
    <li><strong>Avisos fuera de la web</strong> &mdash; Notificaciones por email y Telegram de tus trades y mensajes, aunque tengas la web cerrada.</li>
</ul>

<p class="noxtr-info-tip"><strong>🔒 Tu nsec es seguro aquí:</strong> La clave privada <strong>nunca sale de tu navegador</strong>. No se envía a ningún servidor. Todo el cifrado y firma se hace localmente en tu dispositivo (o en tu firmador NIP-46).</p>

<p style="text-align:center;margin-top:14px;">
    <a class="btn btn-primary" href="/noxtr/html" style="display:inline-block;padding:9px 22px;">📖 Guía completa y especificaciones</a>
</p>
<p class="noxtr-info-tip" style="text-align:center;">¿Nuevo en Nostr? Introducción en <a target="_blank" rel="noopener" href="https://nostrfacil.com">nostrfacil.com</a></p>
