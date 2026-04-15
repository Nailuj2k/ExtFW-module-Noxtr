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
    <p>Noxtr is a web-based <a href="https://nostr.com">Nostr</a> client integrated into the ExtFW PHP framework. It runs as a module within a self-hosted website, combining Nostr protocol access with server-side features like user accounts, Lightning address hosting, and NIP-05 identity verification.</p>
    <p>It is designed as a single-page application with no external JavaScript frameworks &mdash; vanilla JS with a lightweight DOM helper (wquery).</p>

    <h3>Key Characteristics</h3>
    <div class="features">
        <div class="feature-card">
            <h4>Self-hosted</h4>
            <p>Runs on your own server (Apache/nginx, PHP, MySQL/SQLite). You control your data, your relay list, and your Lightning endpoints.</p>
        </div>
        <div class="feature-card">
            <h4>Zero Dependencies</h4>
            <p>No React, no Vue, no npm, no build step. Pure vanilla JavaScript in a single file. Crypto via noble-secp256k1 and noble-ciphers.</p>
        </div>
        <div class="feature-card">
            <h4>Integrated Identity</h4>
            <p>NIP-05 verification and LNURL-pay Lightning addresses are auto-configured from your server's user accounts.</p>
        </div>
        <div class="feature-card">
            <h4>Multi-auth</h4>
            <p>Supports NIP-07 browser extensions, nsec private key entry, NIP-46 Nostr Connect (remote signing with QR), and npub read-only mode.</p>
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
        <div class="nip-chip"><strong>NIP-23</strong><span>Long-form content</span></div>
        <div class="nip-chip"><strong>NIP-19</strong><span>Bech32 entities</span></div>
        <div class="nip-chip"><strong>NIP-25</strong><span>Reactions</span></div>
        <div class="nip-chip"><strong>NIP-28</strong><span>Public channels</span></div>
        <div class="nip-chip"><strong>NIP-44</strong><span>Versioned encryption</span></div>
        <div class="nip-chip"><strong>NIP-46</strong><span>Nostr Connect</span></div>
        <div class="nip-chip"><strong>NIP-50</strong><span>Search</span></div>
        <div class="nip-chip"><strong>NIP-56</strong><span>Reporting</span></div>
        <div class="nip-chip"><strong>NIP-57</strong><span>Lightning Zaps</span></div>
        <div class="nip-chip"><strong>NIP-65</strong><span>Relay list metadata</span></div>
        <div class="nip-chip"><strong>NIP-69</strong><span>P2P orders (Mostro)</span></div>
    </div>

    <h3>Event Kinds</h3>
    <div class="table-wrap">
    <table>
        <tr><th>Kind</th><th>Description</th><th>Usage</th></tr>
        <tr><td>0</td><td>Profile Metadata</td><td>Name, avatar, banner, about, nip05, lud16</td></tr>
        <tr><td>1</td><td>Text Note</td><td>Main feed content, hashtags, mentions</td></tr>
        <tr><td>3</td><td>Contact List</td><td>Follow/unfollow, petnames, relay hints</td></tr>
        <tr><td>4</td><td>Encrypted DM</td><td>AES-CBC with IV, NIP-07 or privkey decryption</td></tr>
        <tr><td>5</td><td>Deletion</td><td>Delete own notes and own channel messages (kind 42)</td></tr>
        <tr><td>6</td><td>Repost</td><td>Repost notes</td></tr>
        <tr><td>7</td><td>Reaction</td><td>Like/unlike notes</td></tr>
        <tr><td>40</td><td>Channel Create</td><td>NIP-28 public chat channel</td></tr>
        <tr><td>41</td><td>Channel Metadata</td><td>Channel name, about, picture</td></tr>
        <tr><td>42</td><td>Channel Message</td><td>Messages in public channels (own messages deletable via kind 5)</td></tr>
        <tr><td>1984</td><td>Report</td><td>NIP-56 spam reports</td></tr>
        <tr><td>30023</td><td>Article (NIP-23)</td><td>Long-form content: mixed into feed with &ldquo;Read&rdquo; badge, full Markdown view, article composer</td></tr>
        <tr><td>38383</td><td>P2P Order (NIP-69)</td><td>Bitcoin buy/sell orders from Mostro robots. P2P &#8383; tab with order listing, plain-language explanation per order, and guided buy flow</td></tr>
        <tr><td>9734</td><td>Zap Request</td><td>Lightning payment metadata</td></tr>
        <tr><td>9735</td><td>Zap Receipt</td><td>Payment confirmation from server</td></tr>
        <tr><td>24133</td><td>Nostr Connect</td><td>NIP-46 remote signing</td></tr>
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
            <h4>Direct Messages</h4>
            <p>NIP-04 encrypted DMs with conversation threads, local DB caching, and extension-based decryption.</p>
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
            <p>Dedicated tab for buying Bitcoin without intermediaries using the <a href="https://mostro.network" target="_blank">Mostro</a> protocol over Nostr. Displays sell orders (kind 38383, NIP-69) with a plain-language explanation for each. Guided flow: take order &rarr; encrypted DM to robot &rarr; submit Lightning receive invoice &rarr; get sats. No Lightning node required; works with Phoenix, Breez, Zeus.</p>
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
        <li><strong>NIP-17 (Modern DMs)</strong> &mdash; Still uses NIP-04. Most modern clients have moved to NIP-17/NIP-44 for DMs, which provides better metadata protection.</li>
        <li><strong>NIP-96 (File Upload)</strong> &mdash; No support for decentralized file storage. Image uploads go to the host server only.</li>
        <li><strong>NIP-47 (Wallet Connect)</strong> &mdash; No NWC integration. Zaps rely on internal balance or BTCPay.</li>
        <li><strong>NIP-72/29 (Communities/Groups)</strong> &mdash; No moderated communities or relay-based group support.</li>
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
        <tr><td>Storage</td><td>Server DB (contacts, topics, bookmarks, DMs, relays, muted, channels) + localStorage/IndexedDB (keys, UI state)</td></tr>
    </table>
    </div>
</section>

</div>

<footer>
    Noxtr &mdash; a ExtFW framework module. Last updated: March 2026.<br>
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
