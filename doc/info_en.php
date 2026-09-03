<h3>What is noxtr?</h3>
<p>A <strong>Nostr</strong> client with built-in P2P Bitcoin trading. Nostr is a decentralized social network &mdash; no company owns your data, no one can ban you, and your identity is yours forever.</p>

<h4>What you can do here</h4>
<ul>
    <li><strong>Topics</strong> &mdash; Add hashtags you're interested in (#bitcoin, #nostr, #music...). The feed shows posts matching your active topics. Toggle "All" to see everything.</li>
    <li><strong>Following / Followers</strong> &mdash; Follow people to see their posts. Add them by npub or with the follow button on any post.</li>
    <li><strong>Messages</strong> &mdash; Private encrypted conversations (NIP-04 and NIP-17 gift wrap 🔒).</li>
    <li><strong>Channels</strong> &mdash; Public chat channels (NIP-28): create, join, invite.</li>
    <li><strong>Articles</strong> &mdash; Read and publish long-form content (NIP-23) with Markdown, integrated in the feed.</li>
    <li><strong>Zaps</strong> &mdash; Bitcoin tips (sats). If the recipient is registered here, the transfer is instant; otherwise a Lightning invoice is generated.</li>
    <li><strong>P2P &#8383;</strong> &mdash; Buy and sell Bitcoin without intermediaries: over Lightning (Mostro protocol) or on-chain with Taproot escrow and arbitrators. With encrypted chat, disputes and notifications.</li>
</ul>
<p>💡 Click on Topics, Following, Followers and Relays to toggle them on/off without deleting!</p>

<h4>Your identity</h4>
<p>You can log in with your <em>nsec</em>, a NIP-07 extension, or sign from your phone with <strong>NostrConnect (NIP-46)</strong> &mdash; e.g. with <a target="_blank" rel="noopener" href="https://signer.noxtr.net">signer.noxtr.net</a>: your key never leaves your phone. You can also just browse by pasting an npub (read-only).</p>

<h4>Benefits of registering</h4>
<ul>
    <li><strong>100% anonymous registration</strong> &mdash; With Nostr: no email, no password, no personal data.</li>
    <li><strong>Verified identity (NIP-05)</strong> &mdash; <em>username@<?=$_SERVER['HTTP_HOST']?></em> with a check mark on Damus, Primal and other clients.</li>
    <li><strong>Lightning Address</strong> &mdash; <em>username@<?=$_SERVER['HTTP_HOST']?></em> to receive zaps from any client or wallet.</li>
    <li><strong>Built-in wallet</strong> &mdash; Received sats accumulate in your balance and you can withdraw them anytime.</li>
    <li><strong>Alerts outside the web</strong> &mdash; Email and Telegram notifications for your trades and messages, even with the site closed.</li>
</ul>

<p class="noxtr-info-tip"><strong>🔒 Your nsec is safe here:</strong> Your private key <strong>never leaves your browser</strong>. It is not sent to any server. All encryption and signing happens locally on your device (or in your NIP-46 signer).</p>

<p style="text-align:center;margin-top:14px;">
    <a class="btn btn-primary" href="/noxtr/html/en" style="display:inline-block;padding:9px 22px;">📖 Full guide &amp; specifications</a>
</p>
<p class="noxtr-info-tip" style="text-align:center;">New to Nostr? Introduction at <a target="_blank" rel="noopener" href="https://nostrfacil.com">nostrfacil.com</a></p>
