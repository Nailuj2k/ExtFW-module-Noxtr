<h3>¿Qué es noxtr?</h3>
<p>Un cliente simple de <strong>Nostr</strong>. Nostr es una red social descentralizada &mdash; ninguna empresa posee tus datos, nadie puede banearte, y tu identidad es tuya para siempre.</p>
<h4>Cómo usarlo</h4>
<ul>
    <li><strong>Topics</strong> &mdash; Añade hashtags que te interesen (#bitcoin, #nostr, #music...). El feed muestra posts que coincidan con tus topics activos. Activa "All" para verlo todo.</li>
    <li><strong>Following</strong> &mdash; Sigue a personas para ver sus posts. Añádelos por su npub o usa el botón follow en cualquier post.</li>
    <li><strong>Messages</strong> &mdash; Conversaciones privadas encriptadas. Necesitas tu nsec (clave privada) para leer y enviar mensajes.</li>
    <li><strong>Bookmarks</strong> &mdash; Guarda posts para leer más tarde.</li>
    <li><strong>Zaps</strong> &mdash; Envía propinas en Bitcoin (sats) a otros usuarios. Si el destinatario está registrado en la web, la transferencia es instantánea. Si no, se genera una invoice Lightning.</li>
</ul>
<p>💡 Click en topics, Following, Followers y Relays para activar/desactivar, ¡sin borrarlos!.</p>
<h4>Tu identidad</h4>
<p>Si iniciaste sesión con Nostr, tu clave se carga automáticamente. Si no tienes tu cuenta vinculada a Nostr, pega tu <em>nsec</em> (clave privada) en el campo de login para publicar posts, responder y enviar mensajes.</p>
<h4>Ventajas de registrarte</h4>
<ul>
    <li><strong>Identidad verificada (NIP-05)</strong> &mdash; Obtienes una identidad verificable (<em>username@<?=$_SERVER['HTTP_HOST']?></em>) que aparece con un check en Damus, Primal y otros clientes Nostr.</li>
    <li><strong>Lightning Address</strong> &mdash; Recibes una dirección Lightning (<em>username@<?=$_SERVER['HTTP_HOST']?></em>) para recibir zaps desde cualquier cliente Nostr o wallet Lightning.</li>
    <li><strong>Wallet integrado</strong> &mdash; Los sats recibidos se acumulan en tu balance y puedes retirarlos cuando quieras.</li>
</ul>
<p class="noxtr-info-tip"><strong>🔒 Tu nsec es seguro aquí:</strong> La clave privada <strong>nunca sale de tu navegador</strong>. No se envía a ningún servidor. Todo el cifrado y firma se hace localmente en tu dispositivo.</p>
<p class="noxtr-info-tip">Más información en <a target="_blank" href="https://nostrfacil.com">https://nostrfacil.com</a> . <a href="/noxtr/html">Especificaciones</a></p>