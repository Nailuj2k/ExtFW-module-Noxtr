
<link rel="stylesheet" href="/_modules_/noxtr/doc/doc.css?ver=1.0.3">
<link href="/_js_/wquery/wquery.dialog.css?v=3.0.200" media="screen" rel="stylesheet" type="text/css" />


<button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme">&#9788; Light</button>

<div class="hero">
    <h1><span>Noxtr</span> Specification Sheet</h1>
    <p class="subtitle">A web-based Nostr client built into the ExtFW framework. Feature overview, NIP support, and comparison with other clients.</p>
    <span class="badge">Web Client &middot; Open Architecture &middot; Self-hosted</span>
    <span class="doc-header-links"><br><a class="lang-link" href="/noxtr">Back to Noxtr</a>  · <a class="lang-link" target="_blank" href="https://software.extralab.net">ExtFW FrameWork</a>  ·  <a class="lang-link" href="/noxtr/html/es">Versi&oacute;n en Espa&ntilde;ol</a></span>
</div>

<div class="container">

<!-- ==================== WHAT IS NOXTR ==================== -->
<section>
    <h2>What is Noxtr?</h2>
    <p>Noxtr is a web-based <a href="https://nostr.com">Nostr</a> client integrated into the ExtFW framework. It runs as a module within a self-hosted website, combining Nostr protocol access with server-side features like user accounts, Lightning address hosting, and NIP-05 identity verification.</p>
    <p>It is designed as a single-page application with no external JavaScript frameworks &mdash; vanilla JS with a lightweight DOM helper (wquery).</p>

    <h3>Key Characteristics</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Self-hosted</h4>
            <p>Runs on your own server (Apache/nginx, PHP, MySQL/SQLite). You control your data, your relay list, and your Lightning endpoints.</p>
        </div>
        <div class="feature-card">
            <h4>Zero Dependencies</h4>
            <p>No React, no Vue, no npm, no build step. Vanilla JavaScript organized in a few per-area files (core, Mostro, on-chain). Crypto via noble-secp256k1 and noble-ciphers, vendored in the repo (no CDN).</p>
        </div>
        <div class="feature-card">
            <h4>Integrated Identity</h4>
            <p>NIP-05 verification and LNURL-pay Lightning addresses are auto-configured from your server's user accounts.</p>
        </div>
        <div class="feature-card">
            <h4>Multi-auth</h4>
            <p>Supports NIP-07 browser extensions, nsec private key entry, NIP-46 Nostr Connect (remote signing with QR, e.g. with <a href="https://signer.noxtr.net" target="_blank" rel="noopener">signer.noxtr.net</a>), and npub read-only mode. If the remote signer is not responding, requests are re-sent automatically for up to 90s with an on-screen notice.</p>
        </div>
        <div class="feature-card">
            <h4>Built-in P2P &#8383; trading</h4>
            <p>Buy and sell Bitcoin directly with other people, no intermediaries: over Lightning via the Mostro protocol, or on-chain with a 2-of-3 Taproot escrow (NostrEscrow). Order book, encrypted chat, disputes with arbitration and notifications, all inside the client.</p>
        </div>
        <div class="feature-card">
            <h4>Anonymous by design</h4>
            <p>100% anonymous registration with Nostr: no email, no password, no personal data. In P2P trades, full privacy mode by default (ephemeral keys per trade, no linkage between trades) with optional reputation.</p>
        </div>
    </div>
</section>

<!-- ==================== NIP SUPPORT ==================== -->
<section>
    <h2>NIP Support</h2>
    <p>Nostr Implementation Possibilities (NIPs) supported by Noxtr:</p>

    <div class="nip-grid">
        <div class="nip-chip"><strong>NIP-01</strong><span>Basic protocol</span></div>
        <div class="nip-chip"><strong>NIP-02</strong><span>Contact list</span></div>
        <div class="nip-chip"><strong>NIP-04</strong><span>Encrypted DMs</span></div>
        <div class="nip-chip"><strong>NIP-05</strong><span>DNS identity</span></div>
        <div class="nip-chip"><strong>NIP-07</strong><span>Browser signer</span></div>
        <div class="nip-chip"><strong>NIP-09</strong><span>Event deletion</span></div>
        <div class="nip-chip"><strong>NIP-10</strong><span>Reply threading</span></div>
        <div class="nip-chip"><strong>NIP-17</strong><span>Private DMs (gift wrap)</span></div>
        <div class="nip-chip"><strong>NIP-19</strong><span>Bech32 entities</span></div>
        <div class="nip-chip"><strong>NIP-23</strong><span>Long-form content</span></div>
        <div class="nip-chip"><strong>NIP-25</strong><span>Reactions</span></div>
        <div class="nip-chip"><strong>NIP-28</strong><span>Public channels</span></div>
        <div class="nip-chip"><strong>NIP-44</strong><span>Versioned encryption</span></div>
        <div class="nip-chip"><strong>NIP-46</strong><span>Nostr Connect</span></div>
        <div class="nip-chip"><strong>NIP-47</strong><span>Wallet Connect (NWC)</span></div>
        <div class="nip-chip"><strong>NIP-50</strong><span>Search</span></div>
        <div class="nip-chip"><strong>NIP-56</strong><span>Reporting</span></div>
        <div class="nip-chip"><strong>NIP-57</strong><span>Lightning Zaps</span></div>
        <div class="nip-chip"><strong>NIP-59</strong><span>Gift wrap</span></div>
        <div class="nip-chip"><strong>NIP-65</strong><span>Relay list metadata</span></div>
        <div class="nip-chip"><strong>NIP-69</strong><span>P2P orders (Mostro)</span></div>
        <div class="nip-chip"><strong>NIP-84</strong><span>Highlights</span></div>
        <div class="nip-chip"><strong>NIP-94</strong><span>File metadata</span></div>
        <div class="nip-chip"><strong>NIP-96</strong><span>HTTP file storage</span></div>
        <div class="nip-chip"><strong>NIP-98</strong><span>HTTP Auth</span></div>
    </div>

    <h3>Event Kinds</h3>
    <div class="table-wrap">
    <table>
        <tr><th>Kind</th><th>Description</th><th>Usage</th></tr>
        <tr><td>0</td><td>Profile Metadata</td><td>Name, avatar, banner, about, nip05, lud16</td></tr>
        <tr><td>1</td><td>Text Note</td><td>Main feed content, hashtags, mentions</td></tr>
        <tr><td>3</td><td>Contact List</td><td>Follow/unfollow, petnames, relay hints</td></tr>
        <tr><td>4</td><td>Encrypted DM (NIP-04)</td><td>AES-CBC with IV, decrypted via NIP-07, NIP-46 or privkey</td></tr>
        <tr><td>5</td><td>Deletion</td><td>Delete own notes and own channel messages (kind 42)</td></tr>
        <tr><td>6</td><td>Repost</td><td>Repost notes</td></tr>
        <tr><td>7</td><td>Reaction</td><td>Like/unlike notes</td></tr>
        <tr><td>13</td><td>Seal (NIP-17)</td><td>Inner gift wrap layer for private DMs</td></tr>
        <tr><td>14</td><td>Rumor (NIP-17) / Mostro v2 transport</td><td>In DMs: plain message wrapped in the seal. In Mostro: NIP-44 encrypted direct message to the instance, signed with the trade key</td></tr>
        <tr><td>40</td><td>Channel Create</td><td>NIP-28 public chat channel</td></tr>
        <tr><td>41</td><td>Channel Metadata</td><td>Channel name, about, picture</td></tr>
        <tr><td>42</td><td>Channel Message</td><td>Messages in public channels (own messages deletable via kind 5)</td></tr>
        <tr><td>1059</td><td>Gift wrap (NIP-59)</td><td>Outer encrypted envelope for NIP-17 DMs and Mostro messages. Hides sender and recipient</td></tr>
        <tr><td>1063</td><td>File Metadata (NIP-94)</td><td>Returned by NIP-96 servers on upload: URL, hash, mime, dimensions</td></tr>
        <tr><td>1984</td><td>Report</td><td>NIP-56 spam reports</td></tr>
        <tr><td>9802</td><td>Highlight (NIP-84)</td><td>Highlighted quotes with comment/context, integrated in the feed</td></tr>
        <tr><td>9734</td><td>Zap Request</td><td>Lightning payment metadata</td></tr>
        <tr><td>9735</td><td>Zap Receipt</td><td>Payment confirmation from server</td></tr>
        <tr><td>23194</td><td>NWC request (NIP-47)</td><td>Encrypted (NIP-04) request from client to NWC wallet: pay_invoice, get_balance, etc.</td></tr>
        <tr><td>23195</td><td>NWC response (NIP-47)</td><td>Encrypted response from wallet with result or error</td></tr>
        <tr><td>24133</td><td>Nostr Connect</td><td>NIP-46 remote signing</td></tr>
        <tr><td>27235</td><td>HTTP Auth (NIP-98)</td><td>Authentication event for NIP-96 uploads and web login</td></tr>
        <tr><td>30023</td><td>Article (NIP-23)</td><td>Long-form content: mixed into feed with &ldquo;Read&rdquo; badge, full Markdown view, article composer</td></tr>
        <tr><td>38383</td><td>P2P Order (NIP-69)</td><td>Bitcoin buy/sell orders from Mostro instances. P2P &#8383; tab with order listing, plain-language explanation per order, and guided buy flow</td></tr>
        <tr><td>38385</td><td>Mostro instance status</td><td>Heartbeat with daemon version, transport <code>protocol_version</code>, limits, fee and bond policy. Feeds the v1/v2 label and each instance's info sheet</td></tr>
        <tr><td>38386</td><td>Mostro public dispute</td><td>Public dispute state (<code>initiated</code> / <code>in-progress</code>)</td></tr>
        <tr><td>39383-39389</td><td>NostrEscrow (on-chain)</td><td>Offers, trade state, disputes, arbitration and funding for on-chain P2P trading with Taproot escrow</td></tr>
    </table>
    </div>
</section>

<!-- ==================== FEATURES ==================== -->
<section>
    <h2>Feature Overview</h2>

    <div class="features">
        <div class="feature-card">
            <h4>Feed Modes</h4>
            <p>Global, Following, Followers, Topics (hashtag subscriptions), and Hot (engagement-ranked trending).</p>
        </div>
        <div class="feature-card">
            <h4>Direct Messages (NIP-04 / NIP-17)</h4>
            <p>Encrypted DMs via NIP-04 (AES-CBC) and NIP-17 with gift wrap (NIP-59 + NIP-44 XChaCha20-Poly1305). Both share the same tab, visually distinguished by &#128274; for NIP-17. Conversation threads, local DB cache, decryption via NIP-07 extension, NIP-46 or nsec.</p>
        </div>
        <div class="feature-card">
            <h4>Lightning Wallet (NIP-47 NWC)</h4>
            <p>Connect to Nostr Wallet Connect compatible wallets (Alby, Mutiny, Phoenix, Coinos, etc.). Configure your <code>nostrwalletconnect://</code> URI once and pay zaps and Mostro hold invoices automatically from your own wallet, bypassing BTCPay. Dedicated WebSocket to NWC relay, NIP-04 encryption, 30s timeout.</p>
        </div>
        <div class="feature-card">
            <h4>File Storage (NIP-96)</h4>
            <p>Images attached to notes are uploaded to external NIP-96 servers (nostr.build by default, configurable in the Relays tab). Auto-discovery of capabilities via <code>/.well-known/nostr/nip96.json</code>. Auth via NIP-98 (kind 27235) signed with the user's key. Multi-server support with fallback chain.</p>
        </div>
        <div class="feature-card">
            <h4>Public Channels (NIP-28)</h4>
            <p>Create, join, and chat in public channels. Channel metadata, pinning, invite links, and creator-only settings. Delete own messages (NIP-09).</p>
        </div>
        <div class="feature-card">
            <h4>Articles (NIP-23)</h4>
            <p>Long-form content (kind 30023) mixed into the feed with a &ldquo;Read&rdquo; badge and deduplication. Full Markdown view. Composer with title, summary, image, and tag fields.</p>
        </div>
        <div class="feature-card">
            <h4>Threading (NIP-10)</h4>
            <p>Full thread view with root/reply markers, reply counts, chronological ordering, and permalinks.</p>
        </div>
        <div class="feature-card">
            <h4>Lightning Zaps</h4>
            <p>NIP-57 zaps with internal balance transfers between registered users and external BTCPay invoices via LNURL-pay.</p>
        </div>
        <div class="feature-card">
            <h4>BTCPay Server Integration</h4>
            <p>Self-hosted Lightning infrastructure via BTCPay Server. LNURL-pay endpoint serves invoices, creates BOLT11 payment requests, and processes zap receipts (kind 9735) with server-side Schnorr signatures. Received sats accumulate in user balance for internal transfers or withdrawal.</p>
        </div>
        <div class="feature-card">
            <h4>Search</h4>
            <p>NIP-50 text search with multi-relay fallback. Profile search via @username. Entity detection for npub/note/nevent.</p>
        </div>
        <div class="feature-card">
            <h4>Topic Subscriptions</h4>
            <p>Subscribe to hashtags (#bitcoin, #nostr, etc.) and filter your feed. Suggested topics, bulk toggle, hot filter.</p>
        </div>
        <div class="feature-card">
            <h4>Bookmarks &amp; Muting</h4>
            <p>Bookmark notes locally. Mute users with optional NIP-56 spam reporting. Unmute management in settings.</p>
        </div>
        <div class="feature-card">
            <h4>Media Handling</h4>
            <p>Embedded images (lazy-loaded), video players, YouTube/Vimeo embeds. Dead domain detection with 24h TTL auto-retry.</p>
        </div>
        <div class="feature-card">
            <h4>Profile Management</h4>
            <p>Edit name, bio, avatar, banner. NIP-05 and Lightning address auto-configured from server account.</p>
        </div>
        <div class="feature-card">
            <h4>Relay Management</h4>
            <p>Add/remove/toggle relays. Live connection status. Exponential backoff reconnection. Subscription rebalancing.</p>
        </div>
        <div class="feature-card">
            <h4>&#8383;itcoin P2P (Mostro)</h4>
            <p>Dedicated tab for buying Bitcoin without intermediaries using the <a href="https://mostro.network" target="_blank">Mostro</a> protocol over Nostr. Displays sell orders (kind 38383, NIP-69) with a plain-language explanation for each. Guided flow: take order &rarr; encrypted DM to instance &rarr; submit Lightning receive invoice &rarr; get sats. No Lightning node required; works with Phoenix, Breez, Zeus.</p>
        </div>
        <div class="feature-card">
            <h4>AR Profile Cards</h4>
            <p>Parse and render AR mesh network profile broadcasts (ar_profile, ar_collaboration) as visual cards with avatar, location, and social actions.</p>
        </div>
    </div>
</section>

<!-- ==================== COMPARISON ==================== -->
<section>
    <h2>Client Comparison</h2>
    <p>An impartial comparison of Noxtr against established Nostr clients. Each client has different strengths &mdash; this table aims to be factual, not promotional.</p>

    <div class="legend">
        <span><b class="y">&#10003;</b> Supported</span>
        <span><b class="p">~</b> Partial</span>
        <span><b class="n">&mdash;</b> Not supported</span>
        <span><b class="na">n/a</b> Not applicable</span>
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
            <td>Platform</td>
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
            <td>Open source</td>
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
            <td>Self-hosted</td>
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
            <td>No build step required</td>
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
            <td>Documented NIPs</td>
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

    <h3>Core NIP Support</h3>
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
            <td>01</td><td>Basic protocol</td>
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
            <td>02</td><td>Contact list</td>
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
            <td>04</td><td>Encrypted DMs (legacy)</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">read</span></td>
            <td><span class="y">&#10003;</span></td>
        </tr>
        <tr>
            <td>05</td><td>DNS identity</td>
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
            <td>07</td><td>Browser signer</td>
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
            <td>09</td><td>Event deletion</td>
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
            <td>10</td><td>Reply threading</td>
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
            <td>17</td><td>Private DMs (gift wrap)</td>
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
            <td>19</td><td>Bech32 entities</td>
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
            <td>23</td><td>Long-form content (articles)</td>
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
            <td>25</td><td>Reactions</td>
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
            <td>28</td><td>Public channels</td>
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
            <td>44</td><td>Versioned encryption</td>
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
            <td>50</td><td>Search</td>
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
            <td>57</td><td>Lightning Zaps</td>
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
            <td>65</td><td>Relay list metadata</td>
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
            <td>94</td><td>File metadata</td>
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
            <td>96</td><td>HTTP file storage</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr><td colspan="10" style="text-align:center;font-size:0.78em;color:var(--text-muted,#888);padding:6px 0;border-top:2px dashed var(--border,#444);">Not yet implemented in Noxtr</td></tr>
        <tr>
            <td>29</td><td>Relay-based groups</td>
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
            <td>51</td><td>Lists (mute, pin, bookmarks, sets)</td>
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
            <td>72</td><td>Moderated communities</td>
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
            <td>78</td><td>Custom app data</td>
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

    <h3>Features</h3>
    <div class="table-wrap">
    <table>
        <tr>
            <th>Feature</th>
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
            <td>Modern DMs (NIP-17/44)</td>
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
            <td>Built-in wallet</td>
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
            <td>Profile search (@user)</td>
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
            <td>Public channels (NIP-28)</td>
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
            <td>Trending / Hot feed</td>
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
            <td>Topic/hashtag subscriptions</td>
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
            <td>NIP-05 hosting</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="p">premium</span></td>
            <td><span class="p">paid</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Lightning address hosting</td>
            <td class="noxtr-col"><span class="y">&#10003;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="y">&#10003;</span></td>
            <td><span class="p">paid</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>Multiple accounts</td>
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
            <td>Long-form content (NIP-23)</td>
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
            <td>Communities (NIP-72)</td>
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
            <td>File upload (NIP-96)</td>
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
            <td>File metadata (NIP-94)</td>
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
            <td>Synced lists (NIP-51)</td>
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
            <td>Relay-based groups (NIP-29)</td>
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
            <td>App data on relay (NIP-78)</td>
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
            <td>BTCPay Server integration</td>
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
            <td>Buy Bitcoin P2P (Mostro)</td>
            <td class="noxtr-col"><span class="u">unique</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
            <td><span class="n">&mdash;</span></td>
        </tr>
        <tr>
            <td>AR profile rendering</td>
            <td class="noxtr-col"><span class="u">unique</span></td>
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
        <strong>Note on impartiality:</strong> Amethyst leads the ecosystem in raw NIP count (60+). Primal offers the best onboarding and search infrastructure. Coracle excels in relay management. Iris pioneered double-ratchet DM encryption. Nostur has the best Apple ecosystem integration. Noxtr's differentiator is self-hosted identity infrastructure (NIP-05 + Lightning address) and zero-dependency architecture &mdash; not NIP breadth.
    </div>
</section>

<!-- ==================== WHERE NOXTR FALLS SHORT ==================== -->
<section>
    <h2>Known Limitations <span style="font-size:0.7em;font-weight:300;">(not for long)</span></h2>
    <p>Areas where Noxtr is behind other clients:</p>
    <ul>
        <li><strong>NIP-72/29 (Communities/Groups)</strong> &mdash; No moderated communities or relay-based group support.</li>
        <li><strong>NIP-51 (Lists)</strong> &mdash; No relay-synced lists. Mute, bookmarks, and pinned channels are local (server DB only). Not interoperable with other clients.</li>
        <li><strong>NIP-78 (App data)</strong> &mdash; No UI preference persistence on relays (kind 30078). Settings are local to the server DB only.</li>
        <li><strong>NIP-35 (Torrents)</strong> &mdash; No torrent marketplace support (kinds 2003/2004). Natural fit with Noxtr&rsquo;s P2P/Bitcoin focus.</li>
        <li><strong>Multiple accounts</strong> &mdash; No instant account switcher. Changing accounts requires logout and re-login, but is possible.</li>
        <li><strong>Outbox model</strong> &mdash; No per-user relay routing. All subscriptions go to the configured relay pool.</li>
        <li><strong>No native app</strong> &mdash; Web only, but works on mobile via browser and supports &ldquo;Add to Home Screen&rdquo; for an app-like experience. No push notifications.</li>
    </ul>
</section>

<!-- ==================== WHERE NOXTR STANDS OUT ==================== -->
<section>
    <h2>Distinctive Strengths</h2>
    <ul>
        <li><strong>Self-hosted identity</strong> &mdash; NIP-05 and Lightning addresses served from your own domain, auto-configured.</li>
        <li><strong>Zero-dependency frontend</strong> &mdash; No npm, no build tools, no framework. Deploy by copying files.</li>
        <li><strong>Internal zap transfers</strong> &mdash; Registered users can zap each other without Lightning network fees.</li>
        <li><strong>NIP-28 channels</strong> &mdash; One of the few web clients with full public chat support (create, join, pin, invite links, delete own messages).</li>
        <li><strong>NIP-23 articles</strong> &mdash; Long-form content integrated in the main feed with replaceable-event deduplication, Markdown rendering, and a dedicated composer with title/summary/image fields.</li>
        <li><strong>Topic-based feed filtering</strong> &mdash; Subscribe to hashtags and filter your global feed without following specific users.</li>
        <li><strong>AR mesh profile rendering</strong> &mdash; The only Nostr client that parses and renders AR collaboration/mesh profile broadcasts as visual cards.</li>
        <li><strong>Dead domain detection</strong> &mdash; Automatically detects and gracefully handles dead image CDNs with 24h retry.</li>
        <li><strong>NIP-46 with QR + persistence</strong> &mdash; Full Nostr Connect flow with QR code, localStorage persistence across sessions.</li>
        <li><strong>Server-side Lightning</strong> &mdash; LNURL-pay endpoint with BTCPay integration and auto-generated server keypair for zap receipts.</li>
        <li><strong>Built-in P2P Bitcoin trading (Mostro / NIP-69)</strong> &mdash; The only web Nostr client with native support for buying Bitcoin P2P via the Mostro protocol, with a step-by-step guided flow and per-order plain-language explanations &mdash; designed to be beginner-friendly.</li>
    </ul>
</section>

<!-- ==================== MOSTRO P2P ==================== -->
<section>
    <h2>&#8383;itcoin P2P &mdash; Mostro</h2>
    <p>Noxtr includes native support for <a href="https://mostro.network" target="_blank" rel="noopener">Mostro</a>, a peer-to-peer Bitcoin exchange protocol built on top of Nostr. You can buy or sell Bitcoin directly with other people, with no intermediaries or custodians, paying by bank transfer, cash, or any other agreed method.</p>
    <p>The <strong>P2P &#8383;</strong> tab in the navigation bar gives you access to the live order book with all available offers.</p>

    <div class="highlight">
        <strong>What is Mostro?</strong> A instance (automated program) that acts as a trusted arbitrator between buyer and seller. The instance holds the seller&rsquo;s Bitcoin in escrow until the buyer confirms they have sent the fiat money, at which point it releases automatically. No one can steal: not the buyer (because the sats are locked), not the seller (because the instance won&rsquo;t release until it gets confirmation).
    </div>

    <h3>Instances and protocol version</h3>
    <p>You can add and enable several <strong>Mostro instances</strong> (instances) in the chips bar of the P2P tab. The order book aggregates offers from all active instances; when creating an offer you choose which instance it is published to.</p>
    <ul>
        <li>Each chip shows a <strong>v1</strong> (red) or <strong>v2</strong> (green) label with the transport version the instance advertises (the <code>protocol_version</code> tag of its status event, kind 38385).</li>
        <li>Noxtr speaks the <strong>v2 transport</strong> exclusively (NIP-44 direct messages, kind 14). The v1 transport (gift wrap) is obsolete: offers from v1 instances are hidden from the order book and cannot be traded with.</li>
        <li><strong>Clicking the v1/v2 label</strong> opens the full instance sheet: daemon version, order limits, fee, accepted fiat currencies, anti-abuse bond policy, Lightning node details, etc.</li>
    </ul>

    <div class="highlight">
        <strong>Anti-abuse bond.</strong> Some instances require a small bond when creating or taking orders (<em>BOND</em> badge in the order book). Noxtr supports it: a QR with the bond <em>hold invoice</em> is shown when trading, and it is returned when the trade completes correctly. If you let a trade expire without acting, the instance may keep part of the bond (<em>slash</em>).
    </div>

    <h3>How to buy Bitcoin (step by step)</h3>
    <p>No prior Bitcoin experience needed. You only need a <strong>Lightning wallet</strong> on your phone (Phoenix, Breez, Zeus, Wallet of Satoshi&hellip;).</p>
    <ol>
        <li><strong>Open the P2P &#8383; tab</strong> &mdash; You&rsquo;ll see a list of sell offers with amount, currency, and payment method.</li>
        <li><strong>Choose an offer</strong> that suits you (amount, payment method) and press <em>Buy</em>.</li>
        <li><strong>Enter your Lightning Address</strong> (e.g. <code>user@wallet.com</code>) or a bolt11 invoice generated from your wallet &mdash; that is where you will receive the sats.</li>
        <li><strong>The instance takes over:</strong> it locks the seller&rsquo;s Bitcoin and tells you how much to pay in fiat and how.</li>
        <li><strong>Send the money</strong> to the seller via the indicated method (bank transfer, cash, etc.) and press <em>Fiat sent</em>.</li>
        <li><strong>The seller confirms</strong> receipt of the fiat payment and presses <em>Release sats</em>.</li>
        <li><strong>Done!</strong> The sats arrive in your Lightning wallet. The trade appears as completed in its card.</li>
    </ol>
    <p>If the seller&rsquo;s wallet or the instance&rsquo;s node cannot route the payment to your address, the trade card will show a field to enter an alternative Lightning address. Your sats are always safe with the instance.</p>

    <h3>How to sell Bitcoin</h3>
    <ol>
        <li><strong>Press <em>New order</em></strong> in the P2P &#8383; tab and choose <em>Sell BTC</em>.</li>
        <li><strong>Configure the offer:</strong> fiat amount, currency, accepted payment method, and amount type (fixed or range).</li>
        <li><strong>Publish the order.</strong> It will appear in the order book for others to take.</li>
        <li><strong>When someone takes it</strong>, the instance sends you a <em>hold invoice</em>. Pay it from your Lightning wallet &mdash; the sats will be locked, not charged, until the trade finishes.</li>
        <li><strong>Give the buyer your payment details</strong> and wait to receive the fiat via the agreed method.</li>
        <li><strong>When the fiat arrives</strong>, press <em>Release sats</em>. The instance will send them to the buyer.</li>
    </ol>

    <h3>Reputation and ratings</h3>
    <p>After completing a trade you can rate the counterpart from 1 to 5 stars. Ratings received appear in your reputation card (&#11088; average &middot; number of trades). Mostro instances publish each user&rsquo;s accumulated reputation alongside their order book entries.</p>
    <p>By default Noxtr operates in <strong>full privacy mode</strong> (a different derived key per trade, with no public linkage between trades). To <strong>accumulate reputation</strong>, enable the &#11088; <em>Reputation</em> toggle: new trades are linked to the index-0 identity derived from your Mostro session seed, separately from your social Nostr identity. This also works with an extension or remote signer.</p>

    <h3>Disputes</h3>
    <p>If something goes wrong in a trade in the <code>active</code> or <code>fiat-sent</code> state (the counterpart does not respond, fails to send the money, denies receiving a confirmed payment&hellip;), you can <strong>open a dispute</strong>. Disputes are resolved by a human administrator of the Mostro instance.</p>

    <ol>
        <li><strong>Press <em>Dispute</em></strong> on the trade card. The button appears next to the actions when the trade is in <code>active</code> or <code>fiat-sent</code>.</li>
        <li><strong>Confirm</strong>. Your client sends the <code>dispute</code> action to the instance.</li>
        <li><strong>The instance publishes the dispute</strong> and notifies the counterpart. Your trade moves to <code>disputed</code> with a dispute ID visible in the card.</li>
        <li><strong>Wait for an admin to take it.</strong> When that happens, you receive the <code>admin-took-dispute</code> action and a new direct chat panel with the admin appears below the trade card.</li>
        <li><strong>Resolve with the admin.</strong> This chat is independent of the chat with the counterpart and is encrypted with a shared key specifically derived between your trade key and the admin&rsquo;s pubkey.</li>
        <li><strong>Admin verdict.</strong> The admin can release the sats to the buyer (<em>admin-settle-dispute</em>) or cancel the dispute returning them to the seller (<em>admin-cancel-dispute</em>). The trade closes automatically.</li>
    </ol>

    <p>The <em>Cancel dispute</em> button (visible if you opened it and no admin is assigned yet) only hides it from your local list: the Mostro protocol has no way to withdraw a dispute, so on the instance it stays open until an admin resolves it.</p>

    <p>If the counterpart asks for a cooperative cancellation on an active trade and you disagree, you can press <em>Dispute</em> instead of accepting the cancellation.</p>

    <p>Your disputes are listed at <a href="/noxtr/disputes">/noxtr/disputes</a>: dispute ID, public status (<code>initiated</code> / <code>in-progress</code>), initiator, assigned admin, and last update.</p>

    <div class="highlight">
        <strong>Dispute chat security.</strong> Your client only accepts messages on the dispute channel whose real pubkey (after unwrapping the NIP-59 gift wrap) is the Mostro instance or the assigned admin. Any impersonation attempt by third parties is automatically discarded. This satisfies the <a href="https://mostro.network/protocol/dispute_chat.html" target="_blank" rel="noopener">Mostro protocol</a> requirement.
    </div>

    <h3>For administrators &mdash; Mostro P2P</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Required relay</h4>
            <p>To send messages to the instance, <code>wss://relay.mostro.network</code> must be active in the user&rsquo;s relay list. The order book works with any general relay, but communication with the instance requires that specific relay. Noxtr adds it automatically as a default relay for new installations.</p>
        </div>
        <div class="feature-card">
            <h4>No Lightning node required</h4>
            <p>Noxtr does not require the server to run a Lightning node for the Mostro flow. The Lightning wallet belongs to the end user (Phoenix, Breez, Zeus, etc.). BTCPay Server is only needed for the zap system and profile Lightning addresses, not for Mostro.</p>
        </div>
        <div class="feature-card">
            <h4>Data stored</h4>
            <p>Active trades are stored in <code>NSTR_TRADES</code> and Mostro events in <code>NSTR_EVENTS</code>. Both tables are created automatically. Counterparty reputation is not computed locally: it is read from the <code>rating</code> tag of the 38383 event published by the instance.</p>
        </div>
    </div>
</section>

<!-- ==================== ON-CHAIN ==================== -->
<section>
    <h2>On-chain P2P &#8383;itcoin &mdash; NostrEscrow</h2>
    <p>Besides the Lightning flow with Mostro, Noxtr supports <strong>on-chain</strong> P2P trades via NostrEscrow: funds are deposited into a <strong>2-of-3 Taproot escrow</strong> address (buyer, seller and arbitrator), with no custodial instance.</p>
    <ul>
        <li><strong>On-chain offers</strong> in the same order book (<em>on-chain</em> chip), with amount, payment method and proposed arbitrators.</li>
        <li><strong>Taproot escrow</strong>: the seller deposits the BTC into the 2-of-3 address; buyer and seller cooperate to release, and the arbitrator only steps in on conflict.</li>
        <li><strong>Arbitrators</strong>: public registry of arbitrators with terms and bond; the site operator acts as the default arbitrator.</li>
        <li><strong>Your own keys</strong>: escrow keys are derived in your browser (BIP-86); the server never sees private keys.</li>
        <li>Encrypted chat between parties, disputes with arbitration and Monitor notifications at every step (taken, funding, fiat sent/received, payout, dispute).</li>
    </ul>

    <div class="highlight">
        <strong>NIP proposal.</strong> The NostrEscrow protocol is specified as a NIP draft (standard NIPs-repo format: kinds, tags, flows and security considerations), open to other implementations:
        <a class="open_file open_file_txt" title="Propuesta NIP NostrEscrow"  data-ext="md" data-href="/_modules_/noxtr/NIP-NOSTRESCROW.md">NIP-NOSTRESCROW.md</a>.
        Kinds <code>39383-39389</code> are provisional until an eventual submission to the official NIPs repository.
    </div>
</section>

<!-- ==================== MOSTRO MONITOR ==================== -->
<section>
    <h2>Server Monitor &mdash; Notifications</h2>
    <p>The Monitor is a PHP process that runs in the background on the server and watches active Mostro trades even when no user has the web app open. It listens to Nostr relays continuously and acts whenever it receives relevant events.</p>

    <h3>For users &mdash; What does the Monitor do for you?</h3>
    <p>If the site administrator has the Monitor running, you will receive automatic alerts whenever something happens in your trades:</p>

    <div class="table-wrap">
    <table>
        <tr><th>Event</th><th>Notification received</th></tr>
        <tr><td>Someone takes your published order</td><td>Email: &ldquo;Your order #XXXXXXXX has been taken&rdquo;</td></tr>
        <tr><td>The instance asks you to pay the hold invoice (selling BTC)</td><td>Email: &ldquo;You must pay the hold invoice&rdquo;</td></tr>
        <tr><td>The buyer confirms they sent the fiat (selling BTC)</td><td>Email: &ldquo;The buyer has sent the payment&rdquo;</td></tr>
        <tr><td>The trade completes</td><td>Email: &ldquo;Trade completed&rdquo;</td></tr>
        <tr><td>The counterpart opens a dispute</td><td>Email + Telegram: &ldquo;&#9888;&#65039; The counterpart has opened a dispute&rdquo;</td></tr>
        <tr><td>You opened a dispute</td><td>Email + Telegram: confirmation &ldquo;You have opened a dispute&rdquo;</td></tr>
        <tr><td>An admin took the dispute</td><td>Email + Telegram: &ldquo;&#128737;&#65039; An admin took the dispute &mdash; open the web app to chat with them&rdquo;</td></tr>
        <tr><td>New private message in your inbox</td><td>Telegram (if you have the bot linked)</td></tr>
    </table>
    </div>

    <p>Each notification is sent <strong>once per trade and event type</strong> &mdash; no spam.</p>

    <h3>Link Telegram to receive alerts</h3>
    <ol>
        <li>While logged in, open the <a href="/telegram"><strong>/telegram</strong></a> section of the web app.</li>
        <li>Press the <em>Link Telegram</em> button: the two options below appear on that same screen, with a single-use code (expires after 10 minutes; if it expires, press the button again).</li>
        <li><strong>Option A &mdash; on mobile:</strong> tap the green <em>&ldquo;Open bot in Telegram&rdquo;</em> button shown right below the link button. The bot chat opens with the code already included; just press <em>Start</em>.</li>
        <li><strong>Option B &mdash; on desktop:</strong> copy the <code>/start CODE</code> command shown on that screen (<em>Copy</em> button), open Telegram, go to the site bot's chat and send it as a message.</li>
        <li>The bot will confirm the link. From that moment on you will receive the alerts (new private messages, events on your trades...).</li>
    </ol>

    <h3>For administrators &mdash; Starting and stopping the Monitor</h3>
    <p>The Monitor is managed from the <strong>web admin panel</strong> (<code>/noxtr/server_admin</code>) via the Start / Stop / Status buttons, or directly from the server console:</p>
    <pre style="background:var(--bg-code,#1e1e2e);color:#cdd6f4;padding:1em;border-radius:6px;overflow-x:auto;font-size:0.85em;">php /path/index.php noxtr/server/action=monitor --verbose</pre>
    <p>To keep it running in the background:</p>
    <pre style="background:var(--bg-code,#1e1e2e);color:#cdd6f4;padding:1em;border-radius:6px;overflow-x:auto;font-size:0.85em;">nohup php /path/index.php noxtr/server/action=monitor &gt; /var/log/monitor.log 2&gt;&amp;1 &amp;</pre>

    <h3>For administrators &mdash; Control commands via Nostr DM</h3>
    <p>The Monitor has its own Nostr identity. Authorized administrators can send it plain-text commands via DM from any Nostr client (including Noxtr). Its npub appears in the startup message and in the web panel.</p>

    <div class="table-wrap">
    <table>
        <tr><th>Command</th><th>Action</th></tr>
        <tr><td><code>ping</code></td><td>Checks the channel is responding. Returns <em>pong</em>.</td></tr>
        <tr><td><code>status</code></td><td>Version, watched trades, uptime, relays.</td></tr>
        <tr><td><code>trades</code></td><td>Live order book (options: <code>age 4h</code>, <code>amount 50 EUR</code>, <code>status pending</code>).</td></tr>
        <tr><td><code>relays</code></td><td>Relays connected in the current session.</td></tr>
        <tr><td><code>email</code></td><td>Sends a test email to the admin.</td></tr>
        <tr><td><code>reload</code></td><td>Reconnects to relays without restarting the process.</td></tr>
        <tr><td><code>stop</code></td><td>Stops the process cleanly.</td></tr>
        <tr><td><code>help</code></td><td>Full contextual help.</td></tr>
    </table>
    </div>

    <h3>For administrators &mdash; New order notifications</h3>
    <p>In addition to watching user trades, the Monitor notifies the administrator of every new order that appears in the Mostro order book (<strong>v2-transport instances only</strong>; obsolete v1 instances are ignored) and of every new on-chain offer. It can be toggled with the <code>notify-new-offers on|off</code> command.</p>
    <ul>
        <li><strong>Nostr DM</strong> to the administrator&rsquo;s npub with an order summary.</li>
        <li><strong>Telegram</strong> with full details: ID, type (BUY/SELL), amount, payment method, and instance age.</li>
        <li><strong>Email</strong> with the same information in HTML format.</li>
    </ul>
    <p>To receive new-order notifications via Telegram, the administrator must have the bot linked <strong>and</strong> their Nostr pubkey added to <code>admin_pubkeys</code> in the Monitor configuration.</p>

    <div class="highlight">
        <strong>Control channel security:</strong> Only administrators with a pubkey listed in <code>admin_pubkeys</code> can send commands. Events are verified cryptographically with Schnorr signatures. Commands older than 5 minutes are automatically ignored.
    </div>
</section>

<!-- ==================== ARCHITECTURE ==================== -->
<section>
    <h2>Technical Architecture</h2>
    <div class="table-wrap">
    <table>
        <tr><th>Component</th><th>Technology</th></tr>
        <tr><td>Frontend</td><td>Vanilla JavaScript (single IIFE), wquery DOM helper</td></tr>
        <tr><td>Backend</td><td>PHP (ExtFW framework module)</td></tr>
        <tr><td>Database</td><td>MySQL or SQLite (dual-compatible SQL)</td></tr>
        <tr><td>Web server</td><td>Apache (mod_rewrite) or nginx</td></tr>
        <tr><td>Cryptography</td><td>noble-secp256k1 (BIP-340 Schnorr), noble-ciphers (XChaCha20-Poly1305), Web Crypto API (AES-CBC, HKDF)</td></tr>
        <tr><td>Lightning</td><td>BTCPay Server (LNURL-pay, BOLT11 invoices)</td></tr>
        <tr><td>Storage</td><td>Server DB (contacts, topics, bookmarks, DMs, relays, muted, channels, NIP-96 servers, NWC URI) + localStorage/IndexedDB (keys, UI state). Image attachments upload to external NIP-96 servers &mdash; not to the PHP server</td></tr>
    </table>
    </div>
</section>

<!-- ==================== BACKLOG / ROADMAP ==================== -->
<section>
    <h2>Backlog &mdash; Future Ideas and Improvements</h2>
    <p>Features queued without a defined date. The canonical source lives in <a class="open_file open_file_txt" title="BACKLOG"  data-ext="md" data-href="/_modules_/noxtr/BACKLOG.md"><code>_modules_/noxtr/BACKLOG.md</code></a> within the repository.</p>

    <div class="features">
        <div class="feature-card">
            <h4>NIP-51 &mdash; List Synchronization</h4>
            <p>Make lists (topics, bookmarks, muted, channels, relays) portable between Nostr clients and between Noxtr instances via kinds 10000-10015. Today lists live only in local DB; manual export/import covers migration. NIP-51 would add continuous bidirectional sync.</p>
        </div>
        <div class="feature-card">
            <h4>NIP-ED2K &mdash; eMule Indexer over Nostr</h4>
            <p>Custom NIP proposal (not standardized) for decentralized directory of ed2k servers and ed2k links. Kinds 2010 (server) and 2011 (file). Full spec (draft):  <a class="open_file open_file_txt" title="Propuesta NIP NIP-ED2K"  data-ext="md" data-href="/_modules_/noxtr/NIP-ED2K.md">NIP-ED2K.md</a>.</p>
        </div>
        <div class="feature-card">
            <h4>NIP-35 &mdash; Torrent Indexer</h4>
            <p>Simple implementation of kind 2003 with magnet/name/size tags. Postponed: ecosystem is mostly empty today (0 kind 2003 events on active relays). Would make sense alongside NIP-ED2K in a unified "file sharing" tab.</p>
        </div>
        <div class="feature-card">
            <h4>NIP-72 &mdash; Moderated Communities</h4>
            <p>Subreddit-style communities with cryptographic moderation. Kinds 34550 (definition) and 4550 (moderator approval). Separate tab from Channels (NIP-28). Useful for curated forum-style feeds.</p>
        </div>
        <div class="feature-card">
            <h4>CLI_USER &mdash; Client-side Encryption</h4>
            <p>Encrypt sensitive columns of the CLI_USER table in the browser, so the server never sees personal data in plaintext. Requires upfront design (which columns, which key, what happens if user loses it).</p>
        </div>
    </div>
</section>

</div>

<footer>
    Noxtr &mdash; a ExtFW framework module. Last updated: July 2026.<br>
    Nostr protocol: <a href="https://github.com/nostr-protocol/nips">github.com/nostr-protocol/nips</a>
</footer>

<script>
(function() {
    var btn = document.getElementById('theme-toggle');
    var stored = localStorage.getItem('noxtr-spec-theme');
    if (stored === 'light') { document.documentElement.classList.add('light'); btn.innerHTML = '&#9790; Dark'; }
    btn.onclick = function() {
        var isLight = document.documentElement.classList.toggle('light');
        btn.innerHTML = isLight ? '&#9790; Dark' : '&#9788; Light';
        localStorage.setItem('noxtr-spec-theme', isLight ? 'light' : 'dark');
    };
})();
</script>

    <script type="text/javascript" src="/_js_/wquery/wquery.js?v=A3.0.200" ></script>
    <script type="text/javascript" src="/_js_/wquery/wquery.draggable.js?v=3.0.200" ></script>
    <script type="text/javascript" src="/_js_/wquery/wquery.dialog.js?v=3.0.200" ></script>
