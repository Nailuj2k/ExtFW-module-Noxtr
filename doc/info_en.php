<h3>What is noxtr?</h3>
<p>A simple <strong>Nostr</strong> client. Nostr is a decentralized social network &mdash; no company owns your data, no one can ban you, and your identity is yours forever.</p>
<h4>How to use it</h4>
<ul>
    <li><strong>Topics</strong> &mdash; Add hashtags you're interested in (#bitcoin, #nostr, #music...). The feed shows posts matching your active topics. Toggle "All" to see everything.</li>
    <li><strong>Following</strong> &mdash; Follow people to see their posts. Add them by their npub or use the follow button on any post.</li>
    <li><strong>Messages</strong> &mdash; Private encrypted conversations. You need your nsec (private key) to read and send messages.</li>
    <li><strong>Bookmarks</strong> &mdash; Save posts you want to read later.</li>
    <li><strong>Zaps</strong> &mdash; Send Bitcoin tips (sats) to other users. If the recipient is registered on this site, the transfer is instant. Otherwise, a Lightning invoice is generated.</li>
</ul>
<p>💡 Click on topics, Following, Followers, and Relays to activate/deactivate them without deleting!</p>
<h4>Your identity</h4>
<p>If you logged in with Nostr, your key is loaded automatically. If your account is not linked to Nostr, paste your <em>nsec</em> (private key) in the login field to publish posts, reply, and send messages.</p>
<h4>Benefits of registering</h4>
<ul>
    <li><strong>Verified identity (NIP-05)</strong> &mdash; You get a verifiable identity (<em>username@<?=$_SERVER['HTTP_HOST']?></em>) that shows a check mark on Damus, Primal, and other Nostr clients.</li>
    <li><strong>Lightning Address</strong> &mdash; You receive a Lightning address (<em>username@<?=$_SERVER['HTTP_HOST']?></em>) to receive zaps from any Nostr client or Lightning wallet.</li>
    <li><strong>Built-in wallet</strong> &mdash; Received sats accumulate in your balance and you can withdraw them anytime.</li>
</ul>
<p class="noxtr-info-tip"><strong>🔒 Your nsec is safe here:</strong> Your private key <strong>never leaves your browser</strong>. It is not sent to any server. All encryption and signing happens locally on your device.</p>
<p class="noxtr-info-tip">More information at <a target="_blank" href="https://nostrfacil.com">https://nostrfacil.com</a> . <a class="open_href" data-type="html" data-href="/noxtr/html/en/html">Specifications</a></p>