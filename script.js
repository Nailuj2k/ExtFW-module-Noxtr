/**
 * Noxtr - Nostr Client for ExtFW Framework
 * NIP-01 (Protocol), NIP-02 (Contacts), NIP-04 (DMs), NIP-07 (Extension), NIP-19 (Bech32)
 */
(function() {
    'use strict';

    // ==================== UTILITIES ====================

    var NoxtrDebug = {
        enabled: function() {
            try {
                if (window.NOXTR_DEBUG === true) return true;
                return localStorage.getItem('noxtr_debug') === '1';
            } catch(e) {
                return false;
            }
        },
        log: function() {
            if (!this.enabled()) return;
            console.log.apply(console, arguments);
        },
        warn: function() {
            if (!this.enabled()) return;
            console.warn.apply(console, arguments);
        },
        error: function() {
            if (!this.enabled()) return;
            console.error.apply(console, arguments);
        },
        group: function() {
            if (!this.enabled()) return;
            console.group.apply(console, arguments);
        },
        groupEnd: function() {
            if (!this.enabled()) return;
            console.groupEnd();
        }
    };

    function hexToBytes(hex) {
        var bytes = new Uint8Array(hex.length / 2);
        for (var i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        return bytes;
    }

    function bytesToHex(bytes) {
        return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function sha256(message) {
        var data = typeof message === 'string' ? new TextEncoder().encode(message) : message;
        return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    }

    async function sha256hex(str) { return bytesToHex(await sha256(str)); }

    function escapeHtml(text) {
        return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function timeAgo(ts) {
        var diff = Math.floor(Date.now() / 1000) - ts;
        if (diff < 0) return 'now';
        if (diff < 60) return 'now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd';
        return new Date(ts * 1000).toLocaleDateString();
    }

    function randomId() { return Math.random().toString(36).substr(2, 12); }
    function randomInt31() { return Math.floor(Math.random() * 2147483647); }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function(resolve, reject) {
            var ta = null;
            try {
                ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', 'readonly');
                ta.style.position = 'absolute';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                if (!document.execCommand('copy')) throw new Error('copy failed');
                document.body.removeChild(ta);
                resolve();
            } catch(err) {
                if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
                reject(err);
            }
        });
    }

    // ==================== DEAD DOMAINS ====================
    // Tracks domains that fail to load media (ERR_NAME_NOT_RESOLVED, timeouts, etc.)
    // Stored in localStorage with TTL so they auto-expire and get retried.

    var DeadDomains = {
        _KEY: 'noxtr_dead_domains',
        _TTL: 24 * 60 * 60 * 1000,  // 24h before auto-retry
        _cache: null,

        _load: function() {
            if (this._cache) return this._cache;
            try { this._cache = JSON.parse(localStorage.getItem(this._KEY)) || {}; }
            catch(e) { this._cache = {}; }
            return this._cache;
        },

        _save: function() {
            try { localStorage.setItem(this._KEY, JSON.stringify(this._cache)); } catch(e) {}
        },

        /** Mark a domain as dead */
        mark: function(domain) {
            if (!domain) return;
            var map = this._load();
            if (!map[domain]) {
                map[domain] = { ts: Date.now(), count: 1 };
            } else {
                map[domain].ts = Date.now();
                map[domain].count = (map[domain].count || 0) + 1;
            }
            this._save();
        },

        /** Check if domain is currently marked dead (respects TTL) */
        isDead: function(domain) {
            if (!domain) return false;
            var map = this._load(), entry = map[domain];
            if (!entry) return false;
            if (Date.now() - entry.ts > this._TTL) {
                delete map[domain];
                this._save();
                return false;
            }
            return true;
        },

        /** Remove a domain from the dead list (user retry) */
        revive: function(domain) {
            var map = this._load();
            delete map[domain];
            this._save();
        },

        /** Extract hostname from a URL string */
        domainOf: function(url) {
            try { return new URL(url).hostname; } catch(e) { return ''; }
        }
    };

    // ==================== BECH32 / NIP-19 ====================

    var BC = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    function bpolymod(v) {
        var G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], c = 1;
        for (var i = 0; i < v.length; i++) {
            var t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ v[i];
            for (var j = 0; j < 5; j++) if ((t >> j) & 1) c ^= G[j];
        } return c;
    }
    function bhrp(h) {
        var r = []; for (var i = 0; i < h.length; i++) r.push(h.charCodeAt(i) >> 5);
        r.push(0); for (var i = 0; i < h.length; i++) r.push(h.charCodeAt(i) & 31); return r;
    }
    function bech32Encode(hrp, data) {
        var v = bhrp(hrp).concat(data).concat([0,0,0,0,0,0]);
        var p = bpolymod(v) ^ 1, cs = [];
        for (var i = 0; i < 6; i++) cs.push((p >> (5*(5-i))) & 31);
        var all = data.concat(cs), r = hrp + '1';
        for (var i = 0; i < all.length; i++) r += BC[all[i]]; return r;
    }
    function bech32Decode(str) {
        str = str.toLowerCase(); var pos = str.lastIndexOf('1');
        if (pos < 1) return null;
        var hrp = str.slice(0, pos), data = [];
        for (var i = pos + 1; i < str.length; i++) { var d = BC.indexOf(str[i]); if (d === -1) return null; data.push(d); }
        return { hrp: hrp, data: data.slice(0, -6) };
    }
    function convertBits(data, from, to, pad) {
        var a = 0, b = 0, r = [], m = (1 << to) - 1;
        for (var i = 0; i < data.length; i++) { a = (a << from) | data[i]; b += from; while (b >= to) { b -= to; r.push((a >> b) & m); } }
        if (pad && b > 0) r.push((a << (to - b)) & m); return r;
    }

    function npubEncode(hex) { return bech32Encode('npub', convertBits(Array.from(hexToBytes(hex)), 8, 5, true)); }
    function npubDecode(npub) { var d = bech32Decode(npub); return (d && d.hrp === 'npub') ? bytesToHex(new Uint8Array(convertBits(d.data, 5, 8, false))) : null; }
    function nsecDecode(nsec) { var d = bech32Decode(nsec); return (d && d.hrp === 'nsec') ? bytesToHex(new Uint8Array(convertBits(d.data, 5, 8, false))) : null; }
    function noteEncode(hex) { return bech32Encode('note', convertBits(Array.from(hexToBytes(hex)), 8, 5, true)); }
    function noteDecode(note) { var d = bech32Decode(note); return (d && d.hrp === 'note') ? bytesToHex(new Uint8Array(convertBits(d.data, 5, 8, false))) : null; }
    function shortKey(s) { return s ? s.slice(0, 8) + ':' + s.slice(-4) : '?'; }

    // NIP-19 TLV entities (nprofile, nevent)
    function tlvDecode(bech, expectedHrp) {
        var d = bech32Decode(bech);
        if (!d || d.hrp !== expectedHrp) return null;
        var bytes = convertBits(d.data, 5, 8, false);
        var result = {}, i = 0;
        while (i < bytes.length) {
            if (i + 1 >= bytes.length) break;
            var type = bytes[i], len = bytes[i + 1];
            i += 2;
            if (i + len > bytes.length) break;
            var val = bytes.slice(i, i + len);
            i += len;
            if (type === 0) result.special = bytesToHex(new Uint8Array(val));
            else if (type === 1) { if (!result.relays) result.relays = []; result.relays.push(new TextDecoder().decode(new Uint8Array(val))); }
            else if (type === 2) result.author = bytesToHex(new Uint8Array(val));
            else if (type === 3 && val.length === 4) result.kind = (val[0] << 24) | (val[1] << 16) | (val[2] << 8) | val[3];
        }
        return result;
    }
    function nprofileDecode(s) { var r = tlvDecode(s, 'nprofile'); return r && r.special ? { pubkey: r.special, relays: r.relays || [] } : null; }
    function neventDecode(s) { var r = tlvDecode(s, 'nevent'); return r && r.special ? { id: r.special, relays: r.relays || [], author: r.author || null, kind: r.kind || null } : null; }

    // NIP-19 naddr (parameterized replaceable events — NIP-23 articles)
    function naddrDecode(s) {
        var d = bech32Decode(s);
        if (!d || d.hrp !== 'naddr') return null;
        var bytes = convertBits(d.data, 5, 8, false);
        var result = { identifier: '', relays: [], pubkey: null, kind: null };
        var i = 0;
        while (i < bytes.length) {
            if (i + 1 >= bytes.length) break;
            var type = bytes[i], len = bytes[i + 1];
            i += 2;
            if (i + len > bytes.length) break;
            var val = bytes.slice(i, i + len);
            i += len;
            if (type === 0) result.identifier = new TextDecoder().decode(new Uint8Array(val));
            else if (type === 1) result.relays.push(new TextDecoder().decode(new Uint8Array(val)));
            else if (type === 2 && val.length === 32) result.pubkey = bytesToHex(new Uint8Array(val));
            else if (type === 3 && val.length === 4) result.kind = (val[0] << 24) | (val[1] << 16) | (val[2] << 8) | val[3];
        }
        return result;
    }
    function naddrEncode(identifier, pubkey, kind, relays) {
        var bytes = [];
        var idBytes = new TextEncoder().encode(identifier || '');
        bytes.push(0, idBytes.length); for (var i = 0; i < idBytes.length; i++) bytes.push(idBytes[i]);
        if (relays) { for (var r = 0; r < relays.length; r++) { var rb = new TextEncoder().encode(relays[r]); bytes.push(1, rb.length); for (var j = 0; j < rb.length; j++) bytes.push(rb[j]); } }
        if (pubkey) { var pkBytes = Array.from(hexToBytes(pubkey)); bytes.push(2, 32); for (var k = 0; k < 32; k++) bytes.push(pkBytes[k] || 0); }
        if (kind !== null && kind !== undefined) { bytes.push(3, 4, (kind >> 24) & 0xff, (kind >> 16) & 0xff, (kind >> 8) & 0xff, kind & 0xff); }
        return bech32Encode('naddr', convertBits(bytes, 8, 5, true));
    }

    // ==================== CONFIGURE SECP256K1 ====================

    if (typeof nobleSecp256k1 !== 'undefined' && nobleSecp256k1.utils) {
        nobleSecp256k1.utils.sha256 = async function() {
            var t = 0; for (var i = 0; i < arguments.length; i++) t += arguments[i].length;
            var m = new Uint8Array(t), p = 0;
            for (var i = 0; i < arguments.length; i++) { m.set(arguments[i], p); p += arguments[i].length; }
            return new Uint8Array(await crypto.subtle.digest('SHA-256', m));
        };
    }

    // ==================== API (AJAX) ====================

    var Api = {
        url: '', csrfToken: '', userId: 0, loginAjaxUrl: '',
        call: async function(action, params) {
            if (!this.userId) return { error: 1, msg: 'Not logged in' };
            params = params || {};
            params.action = action;
            if (this.csrfToken) params.csrf_token = this.csrfToken;
            try {
                var resp = await fetch(this.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(params).toString()
                });
                return await resp.json();
            } catch (e) { return { error: 1, msg: e.message }; }
        }
    };

    // ==================== RELAY POOL ====================

    var Pool = {
        relays: {}, subs: {}, onStatusChange: null,

        connect: function(url) {
            url = url.trim().replace(/\/+$/, '');
            if (this.relays[url]) return;
            this.relays[url] = { ws: null, status: 'connecting', rc: 0, timer: null };
            this._open(url);
        },
        _open: function(url) {
            var self = this, r = this.relays[url]; if (!r) return;
            try {
                r.ws = new WebSocket(url); r.status = 'connecting'; self._notify();
                r.ws.onopen = function() {
                    r.status = 'connected'; r.rc = 0; self._notify();
                    for (var id in self.subs) { var s = self.subs[id]; r.ws.send(JSON.stringify(['REQ', id].concat(s.filters))); }
                    // Ensure DM subscription is active when relays connect
                    if (typeof DMs !== 'undefined' && DMs.ensureSubscription) DMs.ensureSubscription();
                };
                r.ws.onmessage = function(e) { try { self._msg(JSON.parse(e.data), url); } catch(er) {} };
                r.ws.onclose = function() {
                    r.status = 'disconnected'; self._notify();
                    if (r.rc < 20) { r.timer = setTimeout(function() { self._open(url); }, Math.min(30000, 1000 * Math.pow(2, r.rc++))); }
                };
                r.ws.onerror = function() {};
            } catch(e) { r.status = 'error'; self._notify(); }
        },
        disconnect: function(url) {
            var r = this.relays[url]; if (!r) return;
            clearTimeout(r.timer); r.rc = 999; if (r.ws) r.ws.close();
            delete this.relays[url]; this._notify();
        },
        disconnectAll: function() {
            for (var url in this.relays) {
                var r = this.relays[url];
                clearTimeout(r.timer); r.rc = 999; if (r.ws) r.ws.close();
            }
            this.relays = {}; this.subs = {}; this._notify();
        },
        _msg: function(msg, url) {
            if (msg[0] === 'EVENT') { var s = this.subs[msg[1]]; if (s && s.onEvent) s.onEvent(msg[2], url); }
            else if (msg[0] === 'EOSE') { var s = this.subs[msg[1]]; if (s && s.onEOSE) s.onEOSE(msg[1], url); }
            else if (msg[0] === 'OK') {
                try { console.warn('[Pool._msg][OK]', url, { event_id: msg[1], accepted: msg[2], message: msg[3] || '' }); } catch(e) {}
            }
            else if (msg[0] === 'NOTICE') {
                try { console.warn('[Pool._msg][NOTICE]', url, msg[1] || ''); } catch(e) {}
            }
        },
        subscribe: function(filters, onEvent, onEOSE) {
            var id = 'nx_' + randomId(); this.subs[id] = { filters: filters, onEvent: onEvent, onEOSE: onEOSE };
            var m = JSON.stringify(['REQ', id].concat(filters));
            for (var u in this.relays) { var r = this.relays[u]; if (r.status === 'connected') try { r.ws.send(m); } catch(e) {} }
            return id;
        },
        unsubscribe: function(id) {
            delete this.subs[id]; var m = JSON.stringify(['CLOSE', id]);
            for (var u in this.relays) { var r = this.relays[u]; if (r.status === 'connected') try { r.ws.send(m); } catch(e) {} }
        },
        publish: function(event) {
            var m = JSON.stringify(['EVENT', event]);
            for (var u in this.relays) { var r = this.relays[u]; if (r.status === 'connected') try { r.ws.send(m); } catch(e) {} }
        },
        // Publish to a specific relay URL via a fresh temp WebSocket to bypass stale Pool connections.
        // Also sends via Pool connection if available (relay deduplicates by event ID).
        publishTo: function(url, event) {
            if (!url) return;
            url = url.trim().replace(/\/+$/, '');
            var r = this.relays[url];
            if (r && r.status === 'connected' && r.ws) {
                try { r.ws.send(JSON.stringify(['EVENT', event])); } catch(e) {}
            }
            // Always open a fresh temp WebSocket too — Pool connection may be TCP-stale
            // while still showing status:'connected'. Relay deduplicates by event id.
            var self = this;
            try {
                var subs = this.subs;
                var ws = new WebSocket(url);
                var m = JSON.stringify(['EVENT', event]);
                ws.onopen = function() {
                    console.warn('[Pool.publishTo] temp WS conectado a', url);
                    // Send all active subscriptions so we can receive the robot's response
                    for (var id in subs) {
                        try { ws.send(JSON.stringify(['REQ', id].concat(subs[id].filters))); } catch(e2) {}
                    }
                    try { ws.send(m); } catch(e) {}
                    setTimeout(function() { try { ws.close(); } catch(e) {} }, 90000);
                };
                ws.onmessage = function(e) {
                    try {
                        var d = JSON.parse(e.data);
                        console.warn('[Pool.publishTo] temp WS msg de', url, d);
                        self._msg(d, url);
                    } catch(er) {}
                };
                ws.onerror = function(err) { console.warn('[Pool.publishTo] temp WS error', url, err && err.message); };
                ws.onclose = function() { console.warn('[Pool.publishTo] temp WS cerrado', url); };
            } catch(e) {}
        },
        _notify: function() { if (this.onStatusChange) this.onStatusChange(); },
        getStatus: function() { var r = []; for (var u in this.relays) r.push({ url: u, status: this.relays[u].status }); return r; }
    };

    // ==================== PROFILES ====================

    var Profiles = {
        cache: {}, pending: {}, subId: null, fetchTimer: null, onUpdate: null,
        get: function(pk) { return this.cache[pk] || null; },
        request: function(pk) { if (this.cache[pk] || this.pending[pk]) return; this.pending[pk] = true; this._schedule(); },
        _schedule: function() { if (this.fetchTimer) return; var self = this; this.fetchTimer = setTimeout(function() { self.fetchTimer = null; self._fetch(); }, 300); },
        _fetch: function() {
            var pks = Object.keys(this.pending); if (!pks.length) return; this.pending = {};
            if (this.subId) Pool.unsubscribe(this.subId);
            var self = this;
            this.subId = Pool.subscribe([{ kinds: [0], authors: pks }], function(ev) { self._handle(ev); }, function() { /* Re-schedule if new requests arrived during fetch */ if (Object.keys(self.pending).length) self._schedule(); });
        },
        _handle: function(ev) {
            if (ev.kind !== 0) return;
            try {
                var p = JSON.parse(ev.content), ex = this.cache[ev.pubkey];
                if (!ex || !ex._ts || ev.created_at > ex._ts) {
                    this.cache[ev.pubkey] = { name: p.name||p.display_name||'', display_name: p.display_name||p.name||'', picture: p.picture||'', banner: p.banner||'', about: p.about||'', nip05: p.nip05||'', lud16: p.lud16||'', lud06: p.lud06||'', _ts: ev.created_at };
                    if (this.onUpdate) this.onUpdate(ev.pubkey);
                    // Sync Nostr username to DB once per session (own profile only)
                    if (ev.pubkey === Events.pubkey && !this._usernameSynced && (p.name || p.display_name)) {
                        this._usernameSynced = true;
                        Api.call('sync_username', { name: p.name || p.display_name, nip05: p.nip05 || '' }).then(function(res) {
                            if (res && res.data && res.data.synced) {
                                var u = res.data.username;
                                var isEs = (Api.lang === 'es');
                                var msg = isEs
                                    ? '<p>Tu nombre de usuario ha sido actualizado a <strong>' + u + '</strong>.</p>' +
                                      '<p>A partir de ahora puedes hacer login escribiendo <strong>' + u + '</strong> y haciendo clic en el botón <em>Login with Nostr</em>.</p>'
                                    : '<p>Your username has been updated to <strong>' + u + '</strong>.</p>' +
                                      '<p>From now on you can log in by typing <strong>' + u + '</strong> and clicking the <em>Login with Nostr</em> button.</p>';
                                $("body").dialog({
                                    title: isEs ? '✅ Usuario actualizado' : '✅ Username updated',
                                    type: 'html',
                                    content: msg,
                                    buttons: [$.dialog.closeButton]
                                });
                            }
                        });
                    }
                }
            } catch(e) {}
        },
        displayName: function(pk) { var p = this.cache[pk]; return (p && (p.display_name || p.name)) ? (p.display_name || p.name) : shortKey(npubEncode(pk)); },
        avatar: function(pk) { var p = this.cache[pk]; return (p && p.picture) ? p.picture : null; },
        lnAddress: function(pk) {
            var p = this.cache[pk]; if (!p) return '';
            if (p.lud16) return p.lud16;
            if (p.lud06 && p.lud06.toLowerCase().startsWith('lnurl')) {
                try {
                    var d = bech32Decode(p.lud06);
                    if (!d) return '';
                    var bytes = convertBits(d.data, 5, 8, false);
                    var url = new TextDecoder().decode(new Uint8Array(bytes));
                    var u = new URL(url);
                    if (u.pathname.includes('/.well-known/lnurlp/')) {
                        var parts = u.pathname.replace(/\/+$/, '').split('/');
                        return parts[parts.length - 1] + '@' + u.hostname;
                    }
                } catch(e) {}
            }
            return '';
        },
        color: function(pk) { return 'hsl(' + (parseInt(pk.slice(0,6), 16) % 360) + ', 55%, 50%)'; }
    };

    // ==================== CONTENT PARSER ====================

    /** Placeholder HTML for media on dead domains */
    function _deadPlaceholder(url, type) {
        var domain = DeadDomains.domainOf(url);
        var icon = type === 'video' ? 'fa-film' : 'fa-image';
        var label = type === 'video' ? 'Video' : (Api.lang === 'es' ? 'Imagen' : 'Image');
        return '<div class="note-media note-dead-media" data-src="'+escapeHtml(url)+'" data-type="'+type+'">' +
            '<i class="fa '+icon+'"></i> ' +
            '<span>'+label+' — <b>'+escapeHtml(domain)+'</b> '+(Api.lang === 'es' ? 'no responde' : 'is not responding')+'</span>' +
            '<a class="dead-domain-retry" href="javascript:void(0)">'+(Api.lang === 'es' ? 'Reintentar' : 'Retry')+'</a>' +
            '</div>';
    }

    /** Called on img/video error — marks domain dead and replaces element with placeholder */
    function _mediaError(el) {
        var src = el.src || el.currentSrc || '';
        if (!src) return;
        var domain = DeadDomains.domainOf(src);
        DeadDomains.mark(domain);
        var wrap = el.closest('.note-media');
        if (wrap) {
            var type = el.tagName === 'VIDEO' ? 'video' : 'image';
            wrap.outerHTML = _deadPlaceholder(src, type);
        } else {
            el.style.display = 'none';
        }
    }

    function parseContent(text) {
        var esc = escapeHtml(text), parts = [], re = /(!\[[^\]]*\]\(https?:\/\/[^)]+\)|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s<]+|nostr:n(?:pub|ote|profile|event|addr)1[a-z0-9]+)/gi, li = 0, m;
        while ((m = re.exec(esc)) !== null) {
            if (m.index > li) parts.push(esc.slice(li, m.index));
            var t = m[1];
            // Markdown image: ![alt](url)
            if (t[0] === '!' && t[1] === '[') {
                var imgMatch = t.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
                if (imgMatch) {
                    var imgUrl = imgMatch[2], imgAlt = imgMatch[1];
                    if (DeadDomains.isDead(DeadDomains.domainOf(imgUrl))) parts.push(_deadPlaceholder(imgUrl, 'image'));
                    else parts.push('<div class="note-media"><img class="open_file_image" src="'+imgUrl+'" alt="'+escapeHtml(imgAlt)+'" loading="lazy" onerror="_mediaError(this)"></div>');
                } else parts.push(t);
                li = re.lastIndex; continue;
            }
            // Markdown link: [text](url)
            if (t[0] === '[') {
                var lnkMatch = t.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
                if (lnkMatch) {
                    var _lc = /\.pdf(\?[^\s]*)?$/i.test(lnkMatch[2]) ? ' open_file_pdf' : '';
                    parts.push('<a class="'+_lc+'" href="'+lnkMatch[2]+'" target="_blank" rel="noopener">'+lnkMatch[1]+'</a>');
                } else parts.push(t);
                li = re.lastIndex; continue;
            }
            if (t.indexOf('nostr:npub') === 0) {
                var h = npubDecode(t.slice(6));
                parts.push(h ? '<a class="noxtr-mention" data-pubkey="'+h+'">@'+Profiles.displayName(h)+'</a>' : t);
            } else if (t.indexOf('nostr:nprofile') === 0) {
                var np = nprofileDecode(t.slice(6));
                if (np) { Profiles.request(np.pubkey); parts.push('<a class="noxtr-mention" data-pubkey="'+np.pubkey+'">@'+Profiles.displayName(np.pubkey)+'</a>'); }
                else parts.push(t);
            } else if (t.indexOf('nostr:note') === 0) {
                var nid = noteDecode(t.slice(6));
                parts.push(nid ? '<a class="noxtr-notelink" data-noteid="'+nid+'">'+shortKey(t.slice(6))+'</a>' : t);
            } else if (t.indexOf('nostr:nevent') === 0) {
                var ne = neventDecode(t.slice(6));
                if (ne) parts.push('<a class="noxtr-notelink" data-noteid="'+ne.id+'">'+shortKey(noteEncode(ne.id))+'</a>');
                else parts.push(t);
            } else if (t.indexOf('nostr:naddr') === 0) {
                var na = naddrDecode(t.slice(6));
                if (na) parts.push('<a class="noxtr-articlelink" data-naddr="'+escapeHtml(t.slice(6))+'">' + escapeHtml(na.identifier || 'article') + '</a>');
                else parts.push(t);
            } else if (/\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i.test(t.split('#')[0])) {
                var imgSrc = t.split('#')[0];
                if (DeadDomains.isDead(DeadDomains.domainOf(imgSrc))) {
                    parts.push(_deadPlaceholder(imgSrc, 'image'));
                } else {
                    parts.push('<div class="note-media"><img class="open_file_image" src="'+imgSrc+'" loading="lazy" onerror="_mediaError(this)"></div>');
                }
            } else if (/video\.twimg\.com/i.test(t)) {
                parts.push('<div class="note-media note-twimg"><a href="'+escapeHtml(t)+'" class="open_file_video" title="Video (Twitter/X)"><i class="fa fa-play-circle"></i> Video (Twitter/X)</a></div>');
            } else if (/\.(mp4|webm|mov)(\?[^\s]*)?$/i.test(t)) {
                if (DeadDomains.isDead(DeadDomains.domainOf(t))) {
                    parts.push(_deadPlaceholder(t, 'video'));
                } else {
                    parts.push('<div class="note-media"><video src="'+t+'" controls preload="metadata" onerror="_mediaError(this)"></video></div>');
                }
            } else if (/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(t)) {
                var vid = t.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)[1];
                parts.push('<div class="note-media note-video-embed"><iframe src="https://www.youtube-nocookie.com/embed/'+vid+'" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
              //parts.push('<div class="note-media note-video-embed"><iframe src="https://www.youtube.com/embed/'+vid+'" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
            } else if (/vimeo\.com\/(\d+)/.test(t)) {
                var vid = t.match(/vimeo\.com\/(\d+)/)[1];
                parts.push('<div class="note-media note-video-embed"><iframe src="https://player.vimeo.com/video/'+vid+'" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
            } else if (t.indexOf('http') === 0) {
                var url = t.replace(/[.,;:!?)]+$/, ''), trail = t.slice(url.length);
                var _pc = /\.pdf(\?[^\s]*)?$/i.test(url) ? ' class="open_file_pdf"' : '';
                parts.push('<a'+_pc+' href="'+url+'" target="_blank" rel="noopener">'+(url.length > 60 ? url.slice(0,57)+'...' : url)+'</a>'+trail);
            } else parts.push(t);
            li = re.lastIndex;
        }
        if (li < esc.length) parts.push(esc.slice(li));
        var result = parts.join('').replace(/\n/g, '<br>');
        // Markdown: code blocks
        result = result.replace(/```(?:<br>)?([\s\S]*?)```/g, function(_, code) {
            return '<pre><code>' + code.replace(/<br>/g, '\n') + '</code></pre>';
        });
        // Markdown: inline code
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Markdown: headings (# and ## at start of line)
        result = result.replace(/(?:^|<br>)## ([^<]+)/g, function(m, t) { return m.replace('## ' + t, '<strong class="noxtr-md-h2">' + t + '</strong>'); });
        result = result.replace(/(?:^|<br>)# ([^<]+)/g, function(m, t) { return m.replace('# ' + t, '<strong class="noxtr-md-h1">' + t + '</strong>'); });
        // Markdown: bold
        result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Markdown: italic (single * not preceded/followed by *)
        result = result.replace(/(?:^|[^*])\*([^*]+)\*(?:[^*]|$)/g, function(match, p1) {
            return match.replace('*' + p1 + '*', '<em>' + p1 + '</em>');
        });
        // Markdown links [text](url) and images ![alt](url) are now handled in the main URL regex loop above
        // Markdown: blockquotes (> text)
        result = result.replace(/(?:^|<br>)&gt; ([^<]+)/g, function(m, t) { return m.replace('&gt; ' + t, '<blockquote>' + t + '</blockquote>'); });
        // Merge consecutive blockquotes
        result = result.replace(/<\/blockquote>(?:<br>)?<blockquote>/g, '<br>');
        // Markdown: horizontal rule (--- or ***)
        result = result.replace(/(?:^|<br>)(?:---|\*\*\*)(?:<br>|$)/g, '<hr>');
        // Markdown: unordered lists (- item or * item at start of line)
        result = result.replace(/(?:^|<br>)[\-\*] ([^<]+)/g, function(m, t) { return m.replace(m.trim(), '<li>' + t + '</li>'); });
        // Wrap consecutive <li> in <ul>
        result = result.replace(/(<li>[\s\S]*?<\/li>)(?![\s\S]*?<li>)/g, function(m) { return '<ul>' + m + '</ul>'; });
        return result;
    }

    // ==================== AR PROFILE ====================

    /** Try to parse ar_profile JSON from event content. Returns profile object or null.
     *  Supports direct ar_profile payloads and ar_collaboration/profile_card messages
     *  (optionally prefixed with [broadcast:...] or similar routing tags). */
    function _parseArProfile(content) {
        if (!content) return null;
        // Strip leading tag like [broadcast:[#49218]] to find the JSON
        var json = content;
        if (json[0] !== '{') {
            var idx = json.indexOf('{');
            if (idx === -1) return null;
            json = json.substring(idx);
        }
        try {
            var obj;
            try { obj = JSON.parse(json); } catch(e) {
                // Some clients encode JSON with doubled quotes (""key"" instead of "key").
                // Inside string values, escaped quotes appear as \\""  (not \").
                // Fix: step 1: \\""  →  \"  (restore escaped quotes inside strings)
                //      step 2: ""    →  "   (fix structural delimiters)
                var fixed = json.replace(/\\\\""/g, '\\"').replace(/""/g, '"');
                obj = JSON.parse(fixed);
            }
            // Unwrap routing envelope: { route: {...}, payload: ... }
            var payload = (obj.route && obj.payload) ? obj.payload : obj.payload || null;
            if (!payload) return null;
            // If payload is a string, parse it
            if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch(e) { return null; } }
            // Direct ar_profile
            if (payload.type === 'ar_profile') {
                // Normalize: mesh format nests data in payload.profile.p
                if (!payload.p && payload.profile && payload.profile.p) {
                    payload.p = payload.profile.p;
                    if (payload.lat == null && payload.profile.lat != null) payload.lat = payload.profile.lat;
                    if (payload.lon == null && payload.profile.lon != null) payload.lon = payload.profile.lon;
                }
                return payload;
            }
            // ar_collaboration with profile_card inside
            if (payload.type === 'ar_collaboration') {
                var inner = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
                if (inner && inner.type === 'profile_card' && inner.data && inner.data.profile) {
                    var pr = inner.data.profile;
                    return {
                        type: 'ar_profile',
                        p: {
                            n: pr.name || 'Unknown',
                            b: pr.bio || '',
                            at: pr.avatarThumb || ''
                        },
                        lat: pr.latitude != null ? pr.latitude : null,
                        lon: pr.longitude != null ? pr.longitude : null
                    };
                }
            }
        } catch(e) {}
        return null;
    }

    /** Convert base64-encoded public key to hex */
    function _b64ToHex(b64) {
        try {
            var raw = atob(b64);
            var hex = '';
            for (var i = 0; i < raw.length; i++) hex += raw.charCodeAt(i).toString(16).padStart(2, '0');
            return hex;
        } catch(e) { return ''; }
    }

    /** Render an AR profile card instead of a normal note */
    function _renderArProfileCard(ev, payload) {
        var p = payload.p || payload.profile || {};
        var name = p.n || p.name || 'Unknown';
        var bio = p.b || p.bio || '';
        var card = p.card || {};
        var headline = card.h || card.headline || '';
        var tags = card.tags || [];
        var links = p.f || p.links || [];
        var lat = payload.lat, lon = payload.lon;
        var pk = p.pk || '';
        var pkHex = pk ? (pk.length === 64 ? pk : _b64ToHex(pk)) : '';
        var at = p.at || p.avatar || '';
        var avatarSrc = at ? (at.indexOf('data:') === 0 || at.indexOf('http') === 0 ? at : 'data:image/jpeg;base64,' + at) : '';
        // Fallback: use Nostr profile avatar if no base64/url provided
        if (!avatarSrc) {
            var fallbackAv = Profiles.avatar(pkHex || ev.pubkey);
            if (fallbackAv && !DeadDomains.isDead(DeadDomains.domainOf(fallbackAv))) avatarSrc = fallbackAv;
        }
        var isFollowed = pkHex ? Contacts.isFollowing(pkHex) : false;
        var isEs = Api.lang === 'es';

        var el = document.createElement('div');
        el.className = 'note note-ar-profile';
        el.id = 'note-' + ev.id;
        el.dataset.id = ev.id;
        el.dataset.pubkey = ev.pubkey;
        if (pkHex) el.dataset.arPubkey = pkHex;

        var html = '<div class="ar-card">';

        // Avatar + name header
        html += '<div class="ar-card-header">';
        if (avatarSrc) {
            html += '<img class="ar-card-avatar" src="'+avatarSrc+'" alt="'+escapeHtml(name)+'">';
        } else {
            var col = Profiles.color(pkHex || ev.pubkey);
            html += '<div class="ar-card-avatar ar-card-avatar-letter" style="background:'+col+'"><span>'+(name[0]||'?').toUpperCase()+'</span></div>';
        }
        html += '<div class="ar-card-identity">';
        html += '<strong class="ar-card-name">'+escapeHtml(name)+'</strong>';
        if (bio && bio !== 'Add a bio...') html += '<div class="ar-card-bio">'+escapeHtml(bio)+'</div>';
        html += '</div></div>';

        // Headline
        if (headline) {
            html += '<div class="ar-card-headline">'+escapeHtml(headline)+'</div>';
        }

        // Tags
        if (tags.length) {
            html += '<div class="ar-card-tags">';
            for (var i = 0; i < tags.length; i++) {
                html += '<span class="ar-card-tag">'+escapeHtml(tags[i])+'</span>';
            }
            html += '</div>';
        }

        // Links
        if (links.length) {
            html += '<div class="ar-card-links">';
            for (var i = 0; i < links.length; i++) {
                var lk = links[i];
                var href = (lk.v && lk.v.indexOf('http') !== 0 ? 'https://' : '') + escapeHtml(lk.v || '');
                html += '<a class="ar-card-link" href="'+href+'" target="_blank" rel="noopener"><i class="fa fa-link"></i> '+escapeHtml(lk.l || lk.v || '')+'</a>';
            }
            html += '</div>';
        }

        // Location
        if (lat != null && lon != null) {
            var mapUrl = 'https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lon+'#map=14/'+lat+'/'+lon;
            html += '<div class="ar-card-location">' +
                '<a href="'+mapUrl+'" target="_blank" rel="noopener" title="'+(isEs ? 'Ver en mapa' : 'View on map')+'">' +
                '<i class="fa fa-map-marker"></i> '+lat.toFixed(4)+', '+lon.toFixed(4)+'</a></div>';
        }

        // Actions
        if (pkHex) {
            html += '<div class="ar-card-actions">';
            html += '<a class="note-action ar-card-btn ar-card-btn-follow'+(isFollowed ? ' followed' : '')+'" data-action="follow" data-pubkey="'+pkHex+'">'  +
                '<i class="fa fa-user-plus"></i> '+(isFollowed ? (isEs ? 'Siguiendo' : 'Following') : (isEs ? 'Seguir' : 'Follow'))+'</a>';
            html += '<a class="note-action ar-card-btn ar-card-btn-dm" data-action="dm" data-pubkey="'+pkHex+'">'  +
                '<i class="fa fa-envelope"></i> '+(isEs ? 'Mensaje' : 'Message')+'</a>';
            html += '</div>';
        }

        // Meta: posted by + time
        var posterName = Profiles.displayName(ev.pubkey);
        var npub = npubEncode(ev.pubkey);
        html += '<div class="ar-card-meta">' +
            '<span class="ar-card-poster" title="'+npub+'">'+(isEs ? 'Compartido por ' : 'Shared by ')+escapeHtml(posterName)+'</span>' +
            '<span class="note-time" title="'+new Date(ev.created_at*1000).toLocaleString()+'">'+timeAgo(ev.created_at)+'</span>' +
            '</div>';

        // Hidden raw content (toggle with "view raw" action)
        html += '<pre class="ar-raw-content">'+escapeHtml(ev.content)+'</pre>';

        html += '</div>'; // .ar-card

        // Standard note actions (like, repost, zap, bookmark, share, delete...)
        var isBookmarked = Bookmarks.has(ev.id);
        var posterFollowed = Contacts.isFollowing(ev.pubkey);
        var isOwn = ev.pubkey === Events.pubkey;
        html += '<div class="note-actions">' +
            '<a class="note-action action-reply" data-action="reply" data-id="'+ev.id+'" title="Reply"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><span class="count-replies"></span></a>' +
            '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Like"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
            '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Repost"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
            '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Zap"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
            '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="Bookmark"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
            '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="Share"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
            '<a class="note-action action-view-raw" data-action="view-raw" title="'+(isEs ? 'Ver texto original' : 'View raw')+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></a>' +
            (!isOwn ? '<a class="note-action action-mute" data-action="mute" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Mute / Report"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></a>' : '') +
            (isOwn ? '<a class="note-action note-action-delete" data-action="delete" data-id="'+ev.id+'" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '') +
            '</div>';
        el.innerHTML = html;
        return el;
    }

    // ==================== EVENTS ====================

    var Events = {
        privkey: null, pubkey: null, useExtension: false, useNip46: false,
        init: async function() {
            if (window.nostr) { try { this.pubkey = await window.nostr.getPublicKey(); this.useExtension = true; return { method: 'nip07', pubkey: this.pubkey }; } catch(e) {} }
            return { method: 'none', pubkey: null };
        },
        setPrivkey: function(v) {
            if (typeof nobleSecp256k1 === 'undefined') throw new Error('Crypto not loaded');
            this.privkey = v.indexOf('nsec') === 0 ? nsecDecode(v) : v;
            if (this.privkey) { var pk = nobleSecp256k1.getPublicKey(this.privkey, true); this.pubkey = (typeof pk === 'string' ? pk : bytesToHex(pk)).slice(2); this.useExtension = false; }
            return this.pubkey;
        },
        setPubkey: function(v) { this.pubkey = v.indexOf('npub') === 0 ? npubDecode(v) : v; },
        create: async function(kind, content, tags) {
            if (!this.pubkey) throw new Error('No pubkey');
            var ev = { pubkey: this.pubkey, created_at: Math.floor(Date.now()/1000), kind: kind, tags: tags||[], content: content };
            ev.id = await sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            return ev;
        },
        sign: async function(ev) {
            if (this.useExtension && window.nostr) return await window.nostr.signEvent(ev);
            if (this.useNip46) return await Nip46.signEvent(ev);
            if (!this.privkey) throw new Error('No privkey');
            var sig = await nobleSecp256k1.schnorr.sign(ev.id, this.privkey);
            ev.sig = typeof sig === 'string' ? sig : bytesToHex(sig); return ev;
        },
        publish: async function(content, replyTo, extraTags) {
            var tags = [];
            if (replyTo) { tags.push(['e', replyTo.id, '', 'reply']); tags.push(['p', replyTo.pubkey]); }
            // Extract nostr:npub mentions → p tags
            var mr = /nostr:(npub1[a-z0-9]+)/gi, mm;
            while ((mm = mr.exec(content)) !== null) { var h = npubDecode(mm[1]); if (h) tags.push(['p', h]); }
            // Extract #hashtags → t tags (standard Nostr behavior)
            var hr = /#([a-zA-Z0-9_]+)/g, hm, seen = {};
            while ((hm = hr.exec(content)) !== null) { var t = hm[1].toLowerCase(); if (!seen[t]) { tags.push(['t', t]); seen[t] = true; } }
            // Add extra tags from compose-tags input
            if (extraTags && extraTags.length) { for (var i = 0; i < extraTags.length; i++) { if (!seen[extraTags[i]]) { tags.push(['t', extraTags[i]]); seen[extraTags[i]] = true; } } }
            var ev = await this.create(1, content, tags); var signed = await this.sign(ev); Pool.publish(signed); return signed;
        },
        publishProfile: async function(profile) {
            var ev = await this.create(0, JSON.stringify(profile), []);
            var signed = await this.sign(ev); Pool.publish(signed);
            Profiles._handle(signed);
            return signed;
        },
        deleteNote: async function(eventId) {
            var ev = await this.create(5, '', [['e', eventId]]);
            var signed = await this.sign(ev);
            Pool.publish(signed);
            return signed;
        },
        canSign: function() { return this.useExtension || this.useNip46 || !!this.privkey; }
    };

    // ==================== CONTACTS (NIP-02 + DB) ====================

    function updateBadge(id, count) {
        var el = document.getElementById(id);
        if (el) { el.textContent = count > 0 ? count : ''; el.style.display = count > 0 ? '' : 'none'; }
    }

    var Contacts = {
        list: [],
        load: async function() { var r = await Api.call('get_contacts'); if (!r.error) this.list = r.data || []; updateBadge('badge-following', this.list.length); },
        add: async function(pk, name) { var r = await Api.call('add_contact', { pubkey: pk, petname: name||'' }); if (!r.error) this.list = r.data || []; updateBadge('badge-following', this.list.length); this.publishContactList(); },
        remove: async function(pk) { var r = await Api.call('remove_contact', { pubkey: pk }); if (!r.error) this.list = r.data || []; updateBadge('badge-following', this.list.length); this.publishContactList(); },
        toggle: async function(pk) { var r = await Api.call('toggle_contact', { pubkey: pk }); if (!r.error) this.list = r.data || []; },
        publishContactList: async function() {
            if (!Events.canSign()) return;
            try {
                var tags = this.list.map(function(c) {
                    return ['p', c.pubkey, c.relay_url || '', c.petname || ''];
                });
                var ev = await Events.create(3, '', tags);
                var signed = await Events.sign(ev);
                Pool.publish(signed);
            } catch(e) { console.error('Failed to publish contact list:', e); }
        },
        isFollowing: function(pk) { for (var i = 0; i < this.list.length; i++) if (this.list[i].pubkey === pk) return true; return false; },
        pubkeys: function() { return this.list.map(function(c) { return c.pubkey; }); },
        activePubkeys: function() { return this.list.filter(function(c) { return c.active == 1; }).map(function(c) { return c.pubkey; }); },
        toggleAll: async function() {
            var anyActive = this.list.some(function(c) { return c.active == 1; });
            var r = await Api.call('set_all_contacts_active', { active: anyActive ? 0 : 1 });
            if (!r.error) this.list = r.data || [];
        },
        render: function() {
            var el = document.getElementById('following-list'); if (!el) return;
            if (!this.list.length) { el.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Aún no sigues a nadie. Usa el botón de seguir en las notas.' : 'Not following anyone yet. Use the follow button on notes.') + '</div>'; return; }
            var readOnly = !Api.userId;
            var anyActive = this.list.some(function(c) { return c.active == 1; });
            var html = '';
            if (!readOnly) {
                html += '<div class="contact-item bulk-toggle-chip' + (anyActive ? ' contact-active' : '') + '">' +
                    '<span class="contact-dot' + (anyActive ? ' contact-dot-on' : '') + '"></span>' +
                    '<a class="bulk-toggle">' + (anyActive ? 'None' : 'All') + '</a></div> ';
            }
            html += this.list.map(function(c) {
                var name = Profiles.displayName(c.pubkey);
                var isActive = c.active == 1;
                Profiles.request(c.pubkey);
                if (readOnly) {
                    return '<div class="contact-item contact-active"><span class="contact-dot contact-dot-on"></span>' +
                        '<span>'+escapeHtml(name)+'</span></div>';
                }
                return '<div class="contact-item'+(isActive ? ' contact-active' : '')+'">' +
                    '<span class="contact-dot'+(isActive ? ' contact-dot-on' : '')+'"></span>' +
                    '<a class="contact-toggle" data-pubkey="'+c.pubkey+'">'+escapeHtml(name)+'</a>' +
                    '<a class="contact-remove" data-pubkey="'+c.pubkey+'">&times;</a></div>';
            }).join('');
            el.innerHTML = html;
            if (!readOnly) {
                var bulkBtn = el.querySelector('.bulk-toggle');
                if (bulkBtn) bulkBtn.onclick = async function() { await Contacts.toggleAll(); Contacts.render(); UI.switchTab('following'); };
                el.querySelectorAll('.contact-toggle').forEach(function(a) { a.onclick = async function() { await Contacts.toggle(a.dataset.pubkey); Contacts.render(); UI.switchTab('following'); }; });
                el.querySelectorAll('.contact-remove').forEach(function(a) { a.onclick = async function() { await Contacts.remove(a.dataset.pubkey); Contacts.render(); UI.switchTab('following'); }; });
            }
        }
    };

    // ==================== LOAD CONTACTS FROM RELAY (for npub read-only) ====================

    function loadContactsFromRelay() {
        if (!Events.pubkey) return;
        var subId = Pool.subscribe(
            [{ kinds: [3], authors: [Events.pubkey], limit: 1 }],
            function(ev) {
                var list = [];
                for (var i = 0; i < ev.tags.length; i++) {
                    var t = ev.tags[i];
                    if (t[0] === 'p' && t[1]) {
                        list.push({ pubkey: t[1], petname: t[3] || '', relay_url: t[2] || '', active: 1 });
                    }
                }
                Contacts.list = list;
                updateBadge('badge-following', list.length);
                if (UI.currentTab === 'following') { Contacts.render(); UI.switchTab('following'); }
            },
            function() { Pool.unsubscribe(subId); }
        );
    }

    // ==================== TOPICS (DB-backed hashtags) ====================

    var SUGGESTED_TOPICS = ['bitcoin', 'nostr', 'lightning', 'privacy', 'technology', 'ai', 'freedom', 'opensource'];

    var Topics = {
        list: [], showAll: false, showHot: false,
        load: async function() { var r = await Api.call('get_topics'); if (!r.error) this.list = r.data || []; },
        add: async function(topic) { var r = await Api.call('add_topic', { topic: topic }); if (!r.error) this.list = r.data || []; },
        remove: async function(id) { var r = await Api.call('remove_topic', { topic_id: id }); if (!r.error) this.list = r.data || []; },
        toggle: async function(id) { var r = await Api.call('toggle_topic', { topic_id: id }); if (!r.error) this.list = r.data || []; },
        active: function() { return this.list.filter(function(t) { return t.active == 1; }).map(function(t) { return t.topic; }); },
        render: function() {
            var el = document.getElementById('topics-list'); if (!el) return;
            var self = this, html = '';

            // "All" and "Hot" toggle chips (always visible)
            html += '<div class="topic-item topic-all-chip'+(this.showAll ? ' topic-active' : '')+'">' +
                '<span class="topic-dot'+(this.showAll ? ' topic-dot-on' : '')+'"></span>' +
                '<a class="topic-all-toggle">All</a></div> ';

            html += '<div class="topic-item topic-hot-chip'+(this.showHot ? ' topic-active' : '')+'">' +
                '<span class="topic-dot hot-dot'+(this.showHot ? ' hot-dot-on' : '')+'"></span>' +
                '<a class="topic-hot-toggle">Hot</a></div> ';

            if (this.list.length) {
                var dimmed = this.showAll || this.showHot;
                html += this.list.map(function(t) {
                    var isActive = t.active == 1;
                    return '<div class="topic-item'+(isActive ? ' topic-active' : '')+(dimmed ? ' topic-dimmed' : '')+'">' +
                        '<span class="topic-dot'+(isActive ? ' topic-dot-on' : '')+'"></span>' +
                        '<a class="topic-toggle" data-id="'+t.id+'">#'+escapeHtml(t.topic)+'</a>' +
                        '<a class="topic-remove" data-id="'+t.id+'">&times;</a></div>';
                }).join('');
            }
            el.innerHTML = html;

            // Render suggested topics in separate container (outside collapsible)
            var sugEl = document.getElementById('topics-suggestions');
            if (sugEl) {
                var userTopics = this.list.map(function(t) { return t.topic.toLowerCase(); });
                var remaining = SUGGESTED_TOPICS.filter(function(t) { return userTopics.indexOf(t) === -1; });
                if (remaining.length && this.list.length < 5) {
                    sugEl.innerHTML = '<div class="noxtr-suggestions"><span class="suggestions-label">Suggested:</span>' +
                        remaining.map(function(t) {
                            return '<a class="topic-suggestion" data-topic="'+t+'">#'+t+'</a>';
                        }).join('') + '</div>';
                } else {
                    sugEl.innerHTML = '';
                }
                sugEl.querySelectorAll('.topic-suggestion').forEach(function(a) {
                    a.onclick = async function() { await Topics.add(a.dataset.topic); Topics.render(); UI.switchTab('topics'); };
                });
            }

            // Bind "All" toggle (mutually exclusive with Hot)
            var allBtn = el.querySelector('.topic-all-toggle');
            if (allBtn) allBtn.onclick = function() { self.showAll = !self.showAll; if (self.showAll) self.showHot = false; self.render(); UI.switchTab('topics'); };

            // Bind "Hot" toggle (mutually exclusive with All)
            var hotBtn = el.querySelector('.topic-hot-toggle');
            if (hotBtn) hotBtn.onclick = function() { self.showHot = !self.showHot; if (self.showHot) self.showAll = false; self.render(); UI.switchTab('topics'); };

            el.querySelectorAll('.topic-toggle').forEach(function(a) {
                a.onclick = async function() {
                    // If All or Hot is active, clicking a topic chip just deactivates the override
                    if (self.showAll || self.showHot) {
                        self.showAll = false; self.showHot = false;
                        self.render(); UI.switchTab('topics');
                        return;
                    }
                    await Topics.toggle(a.dataset.id); Topics.render(); UI.switchTab('topics');
                };
            });
            el.querySelectorAll('.topic-remove').forEach(function(a) { a.onclick = async function() { await Topics.remove(a.dataset.id); Topics.render(); UI.switchTab('topics'); }; });
        }
    };

    // ==================== RELAYS (DB-backed) ====================

    var DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net', 'wss://relay.snort.social', 'wss://lang.relays.land/es', 'wss://purplepag.es'];

    var Relays = {
        list: [],
        load: async function() {
            if (!Api.userId) return;
            var r = await Api.call('get_relays');
            if (!r.error) this.list = r.data || [];
        },
        add: async function(url) {
            if (!Api.userId) { Pool.connect(url); return; }
            var r = await Api.call('add_relay', { url: url });
            if (!r.error) this.list = r.data || [];
            Pool.connect(url);
        },
        remove: async function(id, url) {
            if (!Api.userId) { Pool.disconnect(url); return; }
            var r = await Api.call('remove_relay', { relay_id: id });
            if (!r.error) this.list = r.data || [];
            Pool.disconnect(url);
        },
        toggle: async function(id, url) {
            if (!Api.userId) {
                // In-memory toggle for anonymous users
                var st = Pool.getStatus(), relay = st.find(function(r) { return r.url === url; });
                if (relay && relay.status === 'connected') Pool.disconnect(url);
                else Pool.connect(url);
                return;
            }
            var r = await Api.call('toggle_relay', { relay_id: id });
            if (!r.error) this.list = r.data || [];
            // Find updated relay to check new state
            var relay = this.list.find(function(rl) { return rl.id == id; });
            if (relay && relay.active == 1) Pool.connect(url);
            else Pool.disconnect(url);
        },
        activeUrls: function() {
            return this.list.filter(function(r) { return r.active == 1; }).map(function(r) { return r.url; });
        },
        connectAll: function() {
            var urls = this.list.length ? this.activeUrls() : DEFAULT_RELAYS;
            for (var i = 0; i < urls.length; i++) Pool.connect(urls[i]);
        },
        render: function() {
            var el = document.getElementById('relay-list'); if (!el) return;
            var self = this, st = Pool.getStatus();
            // Build a map of connection statuses
            var statusMap = {};
            for (var i = 0; i < st.length; i++) statusMap[st[i].url] = st[i].status;

            if (this.list.length) {
                el.innerHTML = this.list.map(function(r) {
                    var isActive = r.active == 1;
                    var connStatus = statusMap[r.url] || (isActive ? 'disconnected' : 'off');
                    return '<div class="relay-item'+(isActive ? '' : ' relay-inactive')+'">' +
                        '<span class="relay-dot relay-'+connStatus+'"></span>' +
                        '<span class="relay-toggle" data-id="'+r.id+'" data-url="'+escapeHtml(r.url)+'">'+escapeHtml(r.url).replace('://', '://\u200B')+'</span>' +
                        '<span class="relay-remove" data-id="'+r.id+'" data-url="'+escapeHtml(r.url)+'">&times;</span></div>';
                }).join('');
            } else {
                // No saved relays — show connected relays from Pool
                el.innerHTML = st.map(function(r) {
                    return '<div class="relay-item">' +
                        '<span class="relay-dot relay-'+r.status+'"></span>' +
                        '<span class="relay-url">'+escapeHtml(r.url).replace('://', '://\u200B')+'</span>' +
                        '<span class="relay-remove-pool" data-url="'+escapeHtml(r.url)+'">&times;</span></div>';
                }).join('');
                el.querySelectorAll('.relay-remove-pool').forEach(function(b) {
                    b.onclick = function() { Pool.disconnect(b.dataset.url); self.render(); };
                });
                return;
            }

            el.querySelectorAll('.relay-toggle').forEach(function(a) {
                a.onclick = async function() { await Relays.toggle(a.dataset.id, a.dataset.url); Relays.render(); };
            });
            el.querySelectorAll('.relay-remove').forEach(function(a) {
                a.onclick = async function() { if (!await confirm('Remove ' + a.dataset.url + '?')) return; await Relays.remove(a.dataset.id, a.dataset.url); Relays.render(); };
            });
        }
    };

    // ==================== BOOKMARKS (DB-backed) ====================

    var Bookmarks = {
        list: [], ids: {},
        load: async function() {
            var r = await Api.call('get_bookmarks'); if (!r.error) this.list = r.data || [];
            this.ids = {}; for (var i = 0; i < this.list.length; i++) this.ids[this.list[i].event_id] = true;
        },
        add: async function(ev) { await Api.call('add_bookmark', { event_id: ev.id, event_pubkey: ev.pubkey, event_content: ev.content, event_created_at: ev.created_at, event_kind: ev.kind || 1, event_tags: JSON.stringify(ev.tags || []) }); this.ids[ev.id] = true; },
        remove: async function(eid) { await Api.call('remove_bookmark', { event_id: eid }); delete this.ids[eid]; },
        has: function(eid) { return !!this.ids[eid]; }
    };

    // ==================== MUTED (DB-backed) ====================

    var Muted = {
        list: [], pks: {},
        load: async function() {
            var r = await Api.call('get_muted'); if (!r.error) this.list = r.data || [];
            this.pks = {}; for (var i = 0; i < this.list.length; i++) this.pks[this.list[i].pubkey] = true;
        },
        mute: async function(pk) {
            var r = await Api.call('mute_user', { pubkey: pk });
            if (!r.error) { this.list = r.data || []; this.pks[pk] = true; }
        },
        unmute: async function(pk) {
            var r = await Api.call('unmute_user', { pubkey: pk });
            if (!r.error) { this.list = r.data || []; delete this.pks[pk]; }
        },
        has: function(pk) { return !!this.pks[pk]; },
        render: function(retry) {
            var section = document.getElementById('muted-section');
            var el = document.getElementById('muted-list');
            if (!section || !el) return;
            if (!this.list.length) { section.style.display = 'none'; return; }
            section.style.display = '';
            var html = this.list.map(function(m) {
                var name = Profiles.displayName(m.pubkey);
                Profiles.request(m.pubkey);
                return '<div class="muted-item">' +
                    '<span class="muted-name">' + escapeHtml(name) + '</span>' +
                    '<a class="muted-unmute" data-pubkey="' + m.pubkey + '" title="Unmute">&times;</a></div>';
            }).join('');
            el.innerHTML = html;
            el.querySelectorAll('.muted-unmute').forEach(function(a) {
                a.onclick = async function() {
                    await Muted.unmute(a.dataset.pubkey);
                    Muted.render();
                };
            });
            if (!retry) setTimeout(function() { Muted.render(true); }, 2000);
        }
    };

    // ==================== FOLLOWERS (kind 3 query) ====================

    var Followers = {
        list: [],
        subId: null,
        seen: {},
        _eoseDone: false,

        subscribe: function() {
            if (!Events.pubkey) { this.render(); return; }
            this.list = [];
            this.seen = {};
            this._eoseDone = false;
            if (this.subId) Pool.unsubscribe(this.subId);
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [3], '#p': [Events.pubkey] }],
                function(ev) {
                    if (self.seen[ev.pubkey]) return;
                    self.seen[ev.pubkey] = true;
                    self.list.push({ pubkey: ev.pubkey, active: true });
                    Profiles.request(ev.pubkey);
                    if (self._eoseDone) self.render();
                },
                function() {
                    if (!self._eoseDone) {
                        self._eoseDone = true;
                        self.render();
                        self.subscribeFeed();
                    }
                }
            );
        },

        unsubscribe: function() {
            if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; }
        },

        toggle: function(pk) {
            for (var i = 0; i < this.list.length; i++) {
                if (this.list[i].pubkey === pk) { this.list[i].active = !this.list[i].active; break; }
            }
            this.render();
            this.subscribeFeed();
        },

        toggleAll: function() {
            var anyActive = this.list.some(function(f) { return f.active; });
            for (var i = 0; i < this.list.length; i++) this.list[i].active = !anyActive;
            this.render();
            this.subscribeFeed();
        },

        activePubkeys: function() {
            return this.list.filter(function(f) { return f.active; }).map(function(f) { return f.pubkey; });
        },

        subscribeFeed: function() {
            if (UI.currentTab !== 'followers') return;
            Feed.clear();
            var pks = this.activePubkeys();
            var feedEl = document.getElementById('feed');
            var loadEl = document.getElementById('feed-loading');
            if (pks.length) {
                Feed.subscribeAuthors(pks);
            } else if (this.list.length) {
                feedEl.innerHTML = '<div class="noxtr-empty">Activate followers above to see their notes.</div>';
                if (loadEl) loadEl.style.display = 'none';
            } else {
                feedEl.innerHTML = '<div class="noxtr-empty">No followers found yet.</div>';
                if (loadEl) loadEl.style.display = 'none';
            }
        },

        render: function() {
            var el = document.getElementById('followers-list'); if (!el) return;
            updateBadge('badge-followers', this.list.length);
            if (!Events.pubkey) {
                el.innerHTML = '<div class="noxtr-empty">Login with a Nostr identity to see your followers.</div>';
                return;
            }
            if (!this.list.length) {
                el.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Aún no se encontraron seguidores.' : 'No followers found yet.') + '</div>';
                return;
            }
            var self = this, readOnly = !Api.userId;
            var anyActive = this.list.some(function(f) { return f.active; });
            var html = '';
            if (!readOnly) {
                html += '<div class="contact-item bulk-toggle-chip' + (anyActive ? ' contact-active' : '') + '">' +
                    '<span class="contact-dot' + (anyActive ? ' contact-dot-on' : '') + '"></span>' +
                    '<a class="bulk-toggle">' + (anyActive ? 'None' : 'All') + '</a></div> ';
            }
            html += this.list.map(function(f) {
                var name = Profiles.displayName(f.pubkey);
                var isFollowingBack = Contacts.isFollowing(f.pubkey);
                if (readOnly) {
                    return '<div class="contact-item contact-active"><span class="contact-dot contact-dot-on"></span>' +
                        '<span>' + escapeHtml(name) + '</span></div>';
                }
                return '<div class="contact-item' + (f.active ? ' contact-active' : '') + '">' +
                    '<span class="contact-dot' + (f.active ? ' contact-dot-on' : '') + '"></span>' +
                    '<a class="follower-toggle" data-pubkey="' + f.pubkey + '">' + escapeHtml(name) + '</a>' +
                    (isFollowingBack ? '' : '<a class="follower-follow btn btn-sm" data-pubkey="' + f.pubkey + '">Follow</a>') +
                    '</div>';
            }).join('');
            el.innerHTML = html;
            if (!readOnly) {
                var bulkBtn = el.querySelector('.bulk-toggle');
                if (bulkBtn) bulkBtn.onclick = function() { self.toggleAll(); };
                el.querySelectorAll('.follower-toggle').forEach(function(a) {
                    a.onclick = function() { self.toggle(a.dataset.pubkey); };
                });
                el.querySelectorAll('.follower-follow').forEach(function(a) {
                    a.onclick = async function() {
                        var name = Profiles.displayName(a.dataset.pubkey);
                        await Contacts.add(a.dataset.pubkey, name);
                        self.render();
                    };
                });
            }
        }
    };

    // ==================== PROFILE VIEW (permalink profile page) ====================

    var ProfileView = {
        active: false,
        pubkey: null,
        _subFollowing: null,
        _subFollowers: null,
        _followingCount: 0,
        _followersCount: 0,
        _followersSeen: {},
        _savedBannerSrc: null,
        _savedAvatarSrc: null,

        open: function(pk, pushHistory) {
            if (this.active && this.pubkey === pk) return;
            this._closeSubs();
            this.active = true;
            this.pubkey = pk;
            this._followingCount = 0;
            this._followersCount = 0;
            this._followersSeen = {};

            if (pushHistory !== false) {
                history.pushState({ noxtr: 'profile', pubkey: pk }, '');
            }

            Profiles.request(pk);

            // Save own banner/avatar src before replacing
            var banEl = document.getElementById('noxtr-banner');
            var avEl = document.getElementById('noxtr-avatar');
            if (banEl) this._savedBannerSrc = banEl.src;
            if (avEl) this._savedAvatarSrc = avEl.src;

            // Show follow button (hidden if own profile)
            var btnFollow = document.getElementById('pv-btn-follow');
            if (btnFollow) btnFollow.style.display = (pk === Events.pubkey) ? 'none' : '';

            this._renderStrip(pk);

            var self = this;
            this._subFollowing = Pool.subscribe([{ kinds: [3], authors: [pk], limit: 1 }], function(ev) {
                if (ev.pubkey !== pk || !self.active || self.pubkey !== pk) return;
                var cnt = ev.tags.filter(function(t) { return t[0] === 'p'; }).length;
                if (cnt !== self._followingCount) { self._followingCount = cnt; self._renderStrip(pk); }
            }, null);

            this._subFollowers = Pool.subscribe([{ kinds: [3], '#p': [pk], limit: 1000 }], function(ev) {
                if (!self.active || self.pubkey !== pk) return;
                if (!self._followersSeen[ev.pubkey]) {
                    self._followersSeen[ev.pubkey] = true;
                    self._followersCount++;
                    self._renderStrip(pk);
                }
            }, function() { self._renderStrip(pk); });

            // Show notes in main feed
            Feed.clear();
            Feed.subscribeAuthors([pk]);
        },

        close: function() {
            if (!this.active) return;
            this.active = false;
            this.pubkey = null;
            this._closeSubs();

            // Restore own banner/avatar
            var banEl = document.getElementById('noxtr-banner');
            var avEl = document.getElementById('noxtr-avatar');
            if (banEl && this._savedBannerSrc) banEl.src = this._savedBannerSrc;
            if (avEl && this._savedAvatarSrc) avEl.src = this._savedAvatarSrc;
            this._savedBannerSrc = null;
            this._savedAvatarSrc = null;

            // Hide follow button
            var btnFollow = document.getElementById('pv-btn-follow');
            if (btnFollow) btnFollow.style.display = 'none';

            // Restore own profile strip
            this.renderOwn();
        },

        renderOwn: function() {
            if (this.active) return; // don't overwrite when viewing someone else
            var pk = Events.pubkey;
            if (!pk) {
                var n = document.getElementById('pv-name'); if (n) n.textContent = '';
                var n5 = document.getElementById('pv-nip05'); if (n5) { n5.textContent = ''; n5.style.display = 'none'; }
                var ab = document.getElementById('pv-about'); if (ab) { ab.textContent = ''; ab.style.display = 'none'; }
                var st = document.getElementById('pv-stats'); if (st) { st.innerHTML = ''; st.style.display = 'none'; }
                return;
            }
            this._renderStrip(pk);
        },

        _renderStrip: function(pk) {
            var p = Profiles.get(pk) || {};
            var npub = npubEncode(pk);
            var name = p.display_name || p.name || shortKey(npub);
            var nip05 = p.nip05 || '';
            var about = p.about || '';
            var banner = p.banner || '';
            var avatar = p.picture || '';
            var isEs = Api.lang === 'es';
            var isViewing = this.active && this.pubkey === pk;

            // Replace banner/avatar when viewing someone else
            if (isViewing) {
                var banEl = document.getElementById('noxtr-banner');
                var avEl = document.getElementById('noxtr-avatar');
                if (banEl && banner) banEl.src = banner;
                if (avEl && avatar) avEl.src = avatar;
            }

            var nameEl = document.getElementById('pv-name');
            if (nameEl) nameEl.textContent = name;

            var nip05El = document.getElementById('pv-nip05');
            if (nip05El) { nip05El.textContent = nip05 ? '\u2713 ' + nip05 : ''; nip05El.style.display = nip05 ? '' : 'none'; }

            var aboutEl = document.getElementById('pv-about');
            if (aboutEl) { aboutEl.textContent = about; aboutEl.style.display = about ? '' : 'none'; }

            var statsEl = document.getElementById('pv-stats');
            if (statsEl) {
                if (isViewing) {
                    statsEl.innerHTML = '<span><strong>' + this._followingCount + '</strong> ' + (isEs ? 'siguiendo' : 'following') + '</span>' +
                        '<span><strong>' + this._followersCount + '</strong> ' + (isEs ? 'seguidores' : 'followers') + '</span>';
                    statsEl.style.display = '';
                } else {
                    statsEl.innerHTML = '';
                    statsEl.style.display = 'none';
                }
            }

            // Update follow button when viewing someone else
            if (isViewing) {
                var btnFollow = document.getElementById('pv-btn-follow');
                if (btnFollow) {
                    var isFollowed = Contacts.isFollowing(pk);
                    btnFollow.textContent = isFollowed ? (isEs ? 'Dejar de seguir' : 'Unfollow') : (isEs ? 'Seguir' : 'Follow');
                    btnFollow.className = 'btn btn-sm ' + (isFollowed ? 'btn-danger' : 'btn-primary');
                }
            }
        },

        _closeSubs: function() {
            if (this._subFollowing) { Pool.unsubscribe(this._subFollowing); this._subFollowing = null; }
            if (this._subFollowers) { Pool.unsubscribe(this._subFollowers); this._subFollowers = null; }
        },

        share: function() {
            var pk = this.active ? this.pubkey : Events.pubkey;
            if (!pk) return;
            var npub = npubEncode(pk);
            var url = location.origin + '/' + _MODULE_ + '/profile/' + npub;
            var isEs = Api.lang === 'es';
            navigator.clipboard.writeText(url);
            var btn = document.getElementById('pv-btn-share');
            if (btn) {
                var orig = btn.innerHTML;
                btn.textContent = isEs ? '\u00a1Copiado!' : 'Copied!';
                setTimeout(function() { if (btn.parentNode) btn.innerHTML = orig; }, 1500);
            }
        }
    };

    // ==================== DMs (NIP-04) ====================

    var DMs = {
        convos: {}, subId: null, currentPeer: null, needsSubscribe: false, _pendingOpenPeer: null,
        monitorPubkey: String(window.NOXTR_MONITOR_PUBKEY || '').trim().toLowerCase(),
        monitorDmTtlHours: parseInt(window.NOXTR_MONITOR_DM_TTL_HOURS, 10) || 0,
        monitorClearLsKey: 'noxtr_monitor_dm_cleared_before',
        monitorClearedBefore: 0,
        loadMonitorClearedBefore: function() {
            try {
                this.monitorClearedBefore = parseInt(localStorage.getItem(this.monitorClearLsKey) || '0', 10) || 0;
            } catch(e) {
                this.monitorClearedBefore = 0;
            }
        },
        saveMonitorClearedBefore: function(ts) {
            this.monitorClearedBefore = parseInt(ts, 10) || 0;
            try {
                if (this.monitorClearedBefore > 0) localStorage.setItem(this.monitorClearLsKey, String(this.monitorClearedBefore));
                else localStorage.removeItem(this.monitorClearLsKey);
            } catch(e) {}
        },
        isExpiredMonitorDm: function(peerPubkey, eventCreatedAt) {
            var ttlHours = parseInt(this.monitorDmTtlHours, 10) || 0;
            var monitorPubkey = String(this.monitorPubkey || '').trim().toLowerCase();
            var ts = parseInt(eventCreatedAt, 10) || 0;
            var peer = String(peerPubkey || '').trim().toLowerCase();
            if (ttlHours <= 0 || !monitorPubkey || peer !== monitorPubkey || ts <= 0) return false;
            return ts < (Math.floor(Date.now() / 1000) - ttlHours * 3600);
        },
        isClearedMonitorDm: function(peerPubkey, eventCreatedAt) {
            var clearedBefore = parseInt(this.monitorClearedBefore, 10) || 0;
            var monitorPubkey = String(this.monitorPubkey || '').trim().toLowerCase();
            var ts = parseInt(eventCreatedAt, 10) || 0;
            var peer = String(peerPubkey || '').trim().toLowerCase();
            if (clearedBefore <= 0 || !monitorPubkey || peer !== monitorPubkey || ts <= 0) return false;
            return ts <= clearedBefore;
        },
        shouldHideMonitorDm: function(peerPubkey, eventCreatedAt) {
            return this.isExpiredMonitorDm(peerPubkey, eventCreatedAt) || this.isClearedMonitorDm(peerPubkey, eventCreatedAt);
        },
        getSharedKey: function(pk) {
            if (!Events.privkey) return null;
            var s = nobleSecp256k1.getSharedSecret(Events.privkey, '02' + pk);
            if (typeof s === 'string') s = hexToBytes(s);
            return s.slice(1, 33);
        },
        encrypt: async function(text, pk) {
            if (Events.useExtension && window.nostr && window.nostr.nip04) return await window.nostr.nip04.encrypt(pk, text);
            var key = this.getSharedKey(pk); if (!key) throw new Error('No key');
            var iv = crypto.getRandomValues(new Uint8Array(16));
            var ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
            var enc = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv }, ck, new TextEncoder().encode(text));
            return btoa(String.fromCharCode.apply(null, new Uint8Array(enc))) + '?iv=' + btoa(String.fromCharCode.apply(null, iv));
        },
        decrypt: async function(content, pk) {
            if (Events.useExtension && window.nostr && window.nostr.nip04) {
                try { return await window.nostr.nip04.decrypt(pk, content); } catch(e) { return '[encrypted]'; }
            }
            var key = this.getSharedKey(pk); if (!key) return '[encrypted - need privkey]';
            try {
                var parts = content.split('?iv=');
                var ct = Uint8Array.from(atob(parts[0]), function(c) { return c.charCodeAt(0); });
                var iv = Uint8Array.from(atob(parts[1]), function(c) { return c.charCodeAt(0); });
                var ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
                var dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, ck, ct);
                return new TextDecoder().decode(dec);
            } catch(e) { return '[decryption failed]'; }
        },
        subIdInbox: null,
        subscribe: function() {
            if (!Events.pubkey) {
                this.needsSubscribe = true;
                return;
            }
            if (this.subId) Pool.unsubscribe(this.subId);
            if (this.subIdInbox) Pool.unsubscribe(this.subIdInbox);
            this.needsSubscribe = false;
            var self = this;
            // Subscription for SENT messages (where I am author)
            this.subId = Pool.subscribe(
                [{ kinds: [4], authors: [Events.pubkey], limit: 100 }],
                function(ev) { self.handleEvent(ev, true); },
                function() {}
            );
            // Separate subscription for RECEIVED messages (where I am tagged in p)
            this.subIdInbox = Pool.subscribe(
                [{ kinds: [4], '#p': [Events.pubkey], limit: 100 }],
                function(ev) { self.handleEvent(ev, true); },
                function() { self.renderConvos(); }
            );
        },
        // Load messages from local DB
        loadFromDb: async function() {
            this.loadMonitorClearedBefore();
            var r = await Api.call('get_messages');
            if (r.error || !r.data) return;
            var self = this;
            for (var i = 0; i < r.data.length; i++) {
                var m = r.data[i];
                var peer = m.peer_pubkey;
                if (this.shouldHideMonitorDm(peer, m.event_created_at)) continue;
                if (!this.convos[peer]) this.convos[peer] = [];
                var exists = false;
                for (var j = 0; j < this.convos[peer].length; j++) {
                    if (this.convos[peer][j].id === m.event_id) { exists = true; break; }
                }
                if (!exists) {
                    var text = await this.decrypt(m.content_encrypted, peer);
                    this.convos[peer].push({
                        id: m.event_id,
                        pubkey: m.sender_pubkey,
                        content: text,
                        created_at: parseInt(m.event_created_at),
                        mine: m.sender_pubkey === Events.pubkey
                    });
                    Profiles.request(peer);
                }
            }
            // Sort all conversations
            for (var pk in this.convos) {
                this.convos[pk].sort(function(a, b) { return a.created_at - b.created_at; });
            }
        },
        clearMonitorMessages: async function() {
            if (!this.monitorPubkey || this.currentPeer !== this.monitorPubkey) return;
            var ok = await Promise.resolve(confirm('¿Borrar el historial del chat con mostro_monitor?\n\nSe eliminará de la caché local y se ocultarán los mensajes anteriores si el relay los vuelve a enviar.'));
            if (!ok) return;

            var r = await Api.call('clear_monitor_messages');
            if (r.error) {
                alert(r.msg || 'No se pudo borrar el chat del monitor.');
                return;
            }

            var cutoff = (r.data && r.data.cleared_before) ? parseInt(r.data.cleared_before, 10) : Math.floor(Date.now() / 1000);
            this.saveMonitorClearedBefore(cutoff);
            delete this.convos[this.monitorPubkey];

            if (this.currentPeer === this.monitorPubkey) {
                this.renderThread(this.monitorPubkey);
            }
            this.renderConvos();
        },
        // Save message to local DB
        saveToDb: function(eventId, peerPubkey, senderPubkey, contentEncrypted, eventCreatedAt) {
            Api.call('save_message', {
                event_id: eventId,
                peer_pubkey: peerPubkey,
                sender_pubkey: senderPubkey,
                content_encrypted: contentEncrypted,
                event_created_at: eventCreatedAt
            });
        },
        // Called when relays connect/reconnect to ensure DM subscription is active
        ensureSubscription: function() {
            if (this.needsSubscribe && Events.pubkey) {
                this.subscribe();
            }
        },
        handleEvent: async function(ev, saveDb) {
            if (ev.kind !== 4) return;
            var peer;
            var isMine = ev.pubkey === Events.pubkey;
            if (isMine) {
                var pt = null; for (var i = 0; i < ev.tags.length; i++) if (ev.tags[i][0] === 'p') { pt = ev.tags[i][1]; break; }
                peer = pt;
            } else {
                peer = ev.pubkey;
            }
            if (!peer) return;
            if (this.shouldHideMonitorDm(peer, ev.created_at)) return;
            if (!this.convos[peer]) this.convos[peer] = [];
            for (var i = 0; i < this.convos[peer].length; i++) if (this.convos[peer][i].id === ev.id) return;
            // Save to local DB for persistence
            if (saveDb && Api.userId) this.saveToDb(ev.id, peer, ev.pubkey, ev.content, ev.created_at);
            var text = await this.decrypt(ev.content, peer);
            this.convos[peer].push({ id: ev.id, pubkey: ev.pubkey, content: text, created_at: ev.created_at, mine: isMine });
            this.convos[peer].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
            Profiles.request(peer);
            if (this.currentPeer === peer) this.renderThread(peer);
            // Update conversation list if visible
            if (document.getElementById('panel-messages').style.display !== 'none' && !this.currentPeer) this.renderConvos();
        },
        sendMessage: async function(pk, text) {
            var enc = await this.encrypt(text, pk);
            var ev = await Events.create(4, enc, [['p', pk]]);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            // Add message locally immediately for better UX
            if (!this.convos[pk]) this.convos[pk] = [];
            var exists = false;
            for (var i = 0; i < this.convos[pk].length; i++) if (this.convos[pk][i].id === signed.id) { exists = true; break; }
            if (!exists) {
                this.convos[pk].push({ id: signed.id, pubkey: signed.pubkey, content: text, created_at: signed.created_at, mine: true });
                this.convos[pk].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
                if (this.currentPeer === pk) this.renderThread(pk);
            }
            return signed;
        },
        renderConvos: function() {
            var el = document.getElementById('dm-conv-list'); if (!el) return;
            var peers = Object.keys(this.convos);
            if (!peers.length) { el.innerHTML = '<div class="noxtr-empty">No messages yet.</div>'; return; }
            peers.sort(function(a, b) {
                var la = DMs.convos[a], lb = DMs.convos[b];
                return lb[lb.length-1].created_at - la[la.length-1].created_at;
            });
            el.innerHTML = peers.map(function(pk) {
                var msgs = DMs.convos[pk], last = msgs[msgs.length - 1];
                var name = Profiles.displayName(pk), av = Profiles.avatar(pk), col = Profiles.color(pk);
                var ini = (name[0] || '?').toUpperCase();
                var preview = last.content.length > 50 ? last.content.slice(0, 47) + '...' : last.content;
                return '<div class="dm-conv" data-pubkey="'+pk+'">' +
                    '<div class="dm-conv-avatar" style="background:'+col+'">'+(av ? '<img src="'+escapeHtml(av)+'">' : '<span>'+ini+'</span>')+'</div>' +
                    '<div class="dm-conv-body"><strong>'+escapeHtml(name)+'</strong><span class="dm-conv-time">'+timeAgo(last.created_at)+'</span>' +
                    '<p class="dm-conv-preview">'+escapeHtml(preview)+'</p></div></div>';
            }).join('');
            var self = this;
            el.querySelectorAll('.dm-conv').forEach(function(c) { c.onclick = function() { self.openThread(c.dataset.pubkey); }; });
        },
        openThread: function(pk, noPush) {
            this.currentPeer = pk;
            document.getElementById('dm-conv-list').style.display = 'none';
            document.getElementById('dm-new').style.display = 'none';
            document.getElementById('dm-thread').style.display = '';
            document.getElementById('dm-thread-name').textContent = Profiles.displayName(pk);
            this.renderThread(pk);
            Profiles.request(pk);
            if (!noPush) history.pushState({ noxtr: 'dm', pubkey: pk }, '', '/' + _MODULE_ + '/messages/' + npubEncode(pk));
            else history.replaceState({ noxtr: 'dm', pubkey: pk }, '', '/' + _MODULE_ + '/messages/' + npubEncode(pk));
        },
        renderThread: function(pk) {
            var el = document.getElementById('dm-messages'); if (!el) return;
            el.classList.toggle('chat-monitor', !!(this.monitorPubkey && pk && String(pk).toLowerCase() === this.monitorPubkey));
            var msgs = this.convos[pk] || [];
            el.innerHTML = msgs.map(function(m) {
                return '<div class="dm-msg '+(m.mine ? 'dm-mine' : 'dm-theirs')+'">' +
                    '<div class="dm-msg-text">'+escapeHtml(m.content)+'</div>' +
                    '<div class="dm-msg-time">'+timeAgo(m.created_at)+'</div></div>';
            }).join('');
            el.scrollTop = el.scrollHeight;
        },
        closeThread: function() {
            this.currentPeer = null;
            var el = document.getElementById('dm-messages');
            if (el) el.classList.remove('chat-monitor');
            document.getElementById('dm-thread').style.display = 'none';
            document.getElementById('dm-conv-list').style.display = '';
            document.getElementById('dm-new').style.display = '';
            history.replaceState({ noxtr: 'tab', tab: 'messages' }, '', '/' + _MODULE_ + '/messages');
        }
    };

    // ==================== CHANNELS (NIP-28 Public Chat) ====================

    var Channels = {
        rooms: {},        // { channelId: { name, about, picture, creator, messages: [] } }
        joined: [],       // array from DB
        subId: null,
        metaSubId: null,
        currentRoom: null,
        _seen: {},

        loadFromDb: async function() {
            var r = await Api.call('get_channels');
            if (r.error || !r.data) return;
            this.joined = r.data;
            for (var i = 0; i < this.joined.length; i++) {
                var ch = this.joined[i];
                if (!this.rooms[ch.channel_id]) {
                    this.rooms[ch.channel_id] = {
                        name: ch.name, about: ch.about, picture: ch.picture,
                        creator: ch.creator_pubkey, messages: []
                    };
                }
            }
        },

        saveToDb: function(channelId, name, about, picture, creatorPubkey, relayUrl) {
            Api.call('add_channel', {
                channel_id: channelId, name: name, about: about || '',
                picture: picture || '', creator_pubkey: creatorPubkey || '',
                relay_url: relayUrl || ''
            });
        },

        subscribe: function() {
            if (!this.joined.length) return;
            if (this.subId) Pool.unsubscribe(this.subId);
            var channelIds = this.joined.map(function(ch) { return ch.channel_id; });
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [42], '#e': channelIds, limit: 200 }],
                function(ev) { self.handleMessage(ev); },
                function() {
                    if (self.currentRoom) self.renderMessages(self.currentRoom);
                }
            );
        },

        subscribeRoom: function(channelId) {
            if (this.subId) Pool.unsubscribe(this.subId);
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [42], '#e': [channelId], limit: 200 }],
                function(ev) { self.handleMessage(ev); },
                function() { self.renderMessages(channelId); }
            );
        },

        fetchMeta: function(channelId) {
            if (this.metaSubId) Pool.unsubscribe(this.metaSubId);
            var self = this;
            this.metaSubId = Pool.subscribe(
                [{ ids: [channelId], kinds: [40] }, { kinds: [41], '#e': [channelId] }],
                function(ev) {
                    try {
                        var meta = JSON.parse(ev.content);
                        var room = self.rooms[channelId];
                        if (!room) {
                            self.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
                            room = self.rooms[channelId];
                        }
                        if (ev.kind === 40) {
                            room.creator = ev.pubkey;
                            if (!room.name && meta.name) room.name = meta.name;
                            if (!room.about && meta.about) room.about = meta.about;
                            if (!room.picture && meta.picture) room.picture = meta.picture;
                        } else if (ev.kind === 41 && ev.pubkey === room.creator) {
                            if (meta.name) room.name = meta.name;
                            if (meta.about) room.about = meta.about;
                            if (meta.picture !== undefined) room.picture = meta.picture;
                        }
                    } catch(e) {}
                },
                function() {
                    if (self.currentRoom === channelId) {
                        var room = self.rooms[channelId];
                        if (room) {
                            var nameEl = document.getElementById('channel-room-name');
                            var aboutEl = document.getElementById('channel-room-about');
                            if (nameEl) nameEl.textContent = room.name || channelId.slice(0, 12) + '…';
                            if (aboutEl) aboutEl.textContent = room.about || '';
                            // Show/hide edit/delete buttons based on creator
                            var isCreator = room.creator && room.creator === Events.pubkey;
                            var editBtn = document.getElementById('channel-edit');
                            if (editBtn) editBtn.style.display = isCreator ? '' : 'none';
                            var delBtn = document.getElementById('channel-delete');
                            if (delBtn) delBtn.style.display = isCreator ? '' : 'none';
                        }
                    }
                }
            );
        },

        handleMessage: function(ev) {
            if (ev.kind !== 42) return;
            if (this._seen[ev.id]) return;
            this._seen[ev.id] = true;

            if (typeof Muted !== 'undefined' && Muted.has && Muted.has(ev.pubkey)) return;

            var channelId = null;
            for (var i = 0; i < ev.tags.length; i++) {
                if (ev.tags[i][0] === 'e') {
                    if (ev.tags[i][3] === 'root') { channelId = ev.tags[i][1]; break; }
                    if (!channelId) channelId = ev.tags[i][1];
                }
            }
            if (!channelId) return;

            if (!this.rooms[channelId]) {
                this.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
            }
            var room = this.rooms[channelId];
            for (var j = 0; j < room.messages.length; j++) {
                if (room.messages[j].id === ev.id) return;
            }

            room.messages.push({
                id: ev.id, pubkey: ev.pubkey, content: ev.content,
                created_at: ev.created_at, mine: ev.pubkey === Events.pubkey
            });
            room.messages.sort(function(a, b) { return a.created_at - b.created_at; });
            Profiles.request(ev.pubkey);

            if (this.currentRoom === channelId) this.renderMessages(channelId);
        },

        sendMessage: async function(channelId, text) {
            if (!text.trim()) return;
            var tags = [['e', channelId, '', 'root']];
            var ev = await Events.create(42, text, tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            if (!this.rooms[channelId]) {
                this.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
            }
            var room = this.rooms[channelId];
            var exists = false;
            for (var i = 0; i < room.messages.length; i++) {
                if (room.messages[i].id === signed.id) { exists = true; break; }
            }
            if (!exists) {
                room.messages.push({
                    id: signed.id, pubkey: signed.pubkey,
                    content: text, created_at: signed.created_at, mine: true
                });
                room.messages.sort(function(a, b) { return a.created_at - b.created_at; });
                if (this.currentRoom === channelId) this.renderMessages(channelId);
            }
            return signed;
        },

        createChannel: async function(name, about, picture) {
            var meta = { name: name };
            if (about) meta.about = about;
            if (picture) meta.picture = picture;
            var ev = await Events.create(40, JSON.stringify(meta), []);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            var channelId = signed.id;
            this.rooms[channelId] = {
                name: name, about: about || '', picture: picture || '',
                creator: signed.pubkey, messages: []
            };
            this.saveToDb(channelId, name, about, picture, signed.pubkey, '');
            this.joined.push({
                channel_id: channelId, name: name, about: about || '',
                picture: picture || '', creator_pubkey: signed.pubkey, relay_url: '', pinned: 0
            });
            this.renderList();
            return signed;
        },

        joinChannel: async function(channelId) {
            for (var i = 0; i < this.joined.length; i++) {
                if (this.joined[i].channel_id === channelId) return;
            }
            var self = this;
            return new Promise(function(resolve) {
                var found = false;
                var tempSubId = Pool.subscribe(
                    [{ ids: [channelId], kinds: [40] }],
                    function(ev) {
                        found = true;
                        try {
                            var meta = JSON.parse(ev.content);
                            var name = meta.name || channelId.slice(0, 12);
                            var about = meta.about || '';
                            var picture = meta.picture || '';
                            self.rooms[channelId] = {
                                name: name, about: about, picture: picture,
                                creator: ev.pubkey, messages: []
                            };
                            self.saveToDb(channelId, name, about, picture, ev.pubkey, '');
                            self.joined.push({
                                channel_id: channelId, name: name, about: about,
                                picture: picture, creator_pubkey: ev.pubkey, relay_url: '', pinned: 0
                            });
                        } catch(e) {
                            self.rooms[channelId] = { name: channelId.slice(0, 12), about: '', picture: '', creator: ev.pubkey, messages: [] };
                            self.saveToDb(channelId, channelId.slice(0, 12), '', '', ev.pubkey, '');
                            self.joined.push({
                                channel_id: channelId, name: channelId.slice(0, 12), about: '',
                                picture: '', creator_pubkey: ev.pubkey, relay_url: '', pinned: 0
                            });
                        }
                    },
                    function() {
                        Pool.unsubscribe(tempSubId);
                        self.renderList();
                        self.subscribe();
                        resolve();
                    }
                );
                setTimeout(function() {
                    Pool.unsubscribe(tempSubId);
                    if (!found) {
                        var isEs = Api.lang === 'es';
                        $('body').dialog({
                            title: isEs ? 'Canal no encontrado' : 'Channel not found',
                            content: isEs
                                ? 'No se encontró el canal en los relays conectados. Añade el relay donde fue creado e inténtalo de nuevo.'
                                : 'Channel not found on connected relays. Add the relay where it was created and try again.',
                            buttons: [{ label: 'OK', action: function(_e, o) { document.body.removeChild(o); } }]
                        });
                    }
                    resolve();
                }, 5000);
            });
        },

        leaveChannel: async function(channelId) {
            Api.call('remove_channel', { channel_id: channelId });
            this.joined = this.joined.filter(function(ch) { return ch.channel_id !== channelId; });
            delete this.rooms[channelId];
            if (this.currentRoom === channelId) this.closeRoom();
            this.renderList();
            this.subscribe();
        },

        renderList: function() {
            var el = document.getElementById('channel-list'); if (!el) return;
            if (!this.joined.length) {
                el.innerHTML = '<div class="noxtr-empty">' +
                    (Api.lang === 'es' ? 'No estás en ningún canal. Únete a uno o crea uno nuevo.' : 'Not in any channels. Join one or create a new one.') +
                    '</div>';
                return;
            }
            var self = this;
            el.innerHTML = this.joined.map(function(ch) {
                var room = self.rooms[ch.channel_id] || {};
                var name = room.name || ch.name || ch.channel_id.slice(0, 12) + '…';
                var about = room.about || ch.about || '';
                var msgCount = (room.messages || []).length;
                var pic = room.picture || ch.picture;
                var avatarHtml = pic
                    ? '<img class="channel-avatar-img" src="' + escapeHtml(pic) + '">'
                    : '<span class="channel-avatar-letter">' + (name[0] || '#').toUpperCase() + '</span>';
                return '<div class="dm-conv channel-item" data-channel="' + ch.channel_id + '">' +
                    '<div class="dm-conv-avatar">' + avatarHtml + '</div>' +
                    '<div class="dm-conv-body"><strong>' + escapeHtml(name) + '</strong>' +
                    (msgCount ? '<span class="dm-conv-time">' + msgCount + ' msgs</span>' : '') +
                    (about ? '<p class="dm-conv-preview">' + escapeHtml(about.slice(0, 60)) + '</p>' : '') +
                    '</div>' +
                    '<a class="channel-leave channel-leave-btn" data-channel="' + ch.channel_id + '" title="Leave">&times;</a>' +
                    '</div>';
            }).join('');
            el.querySelectorAll('.channel-item').forEach(function(c) {
                c.onclick = function(e) {
                    if (e.target.classList.contains('channel-leave')) return;
                    self.openRoom(c.dataset.channel);
                };
            });
            el.querySelectorAll('.channel-leave').forEach(function(a) {
                a.onclick = async function(e) {
                    e.stopPropagation();
                    var ok = await confirm(Api.lang === 'es' ? '¿Salir de este canal?' : 'Leave this channel?');
                    if (ok) self.leaveChannel(a.dataset.channel);
                };
            });
        },

        openRoom: function(channelId) {
            this.currentRoom = channelId;
            document.getElementById('channel-list').style.display = 'none';
            document.getElementById('channel-actions').style.display = 'none';
            document.getElementById('channel-room').style.display = '';
            var room = this.rooms[channelId] || {};
            document.getElementById('channel-room-name').textContent = room.name || channelId.slice(0, 12) + '…';
            document.getElementById('channel-room-about').textContent = room.about || '';
            var composeEl = document.getElementById('channel-compose');
            if (composeEl) composeEl.style.display = Events.canSign() ? '' : 'none';
            // Show edit/delete buttons if user is creator
            var isCreator = room.creator && room.creator === Events.pubkey;
            var editBtn = document.getElementById('channel-edit');
            if (editBtn) editBtn.style.display = isCreator ? '' : 'none';
            var delBtn = document.getElementById('channel-delete');
            if (delBtn) delBtn.style.display = isCreator ? '' : 'none';
            this.subscribeRoom(channelId);
            this.fetchMeta(channelId);
            this.renderMessages(channelId);
            history.pushState({ noxtr: 'channel', channelId: channelId }, '', '/' + _MODULE_ + '/channels/' + noteEncode(channelId));
        },

        renderMessages: function(channelId) {
            var el = document.getElementById('channel-messages'); if (!el) return;
            var room = this.rooms[channelId];
            if (!room || !room.messages.length) {
                el.innerHTML = '<div class="noxtr-empty">' +
                    (Api.lang === 'es' ? 'No hay mensajes aún.' : 'No messages yet.') + '</div>';
                return;
            }
            var myPk = Events.pubkey;
            el.innerHTML = room.messages.map(function(m) {
                var name = Profiles.displayName(m.pubkey);
                var av = Profiles.avatar(m.pubkey);
                var col = Profiles.color(m.pubkey);
                var ini = (name[0] || '?').toUpperCase();
                var isOwn = myPk && m.pubkey === myPk;
                var delBtn = isOwn ? '<a class="ch-msg-del channel-msg-del" data-action="del-channel-msg" data-id="' + m.id + '" title="' + (Api.lang === 'es' ? 'Eliminar' : 'Delete') + '"><svg class="channel-msg-del-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '';
                return '<div class="dm-msg dm-msg-channel ' + (m.mine ? 'dm-mine dm-msg-vertical dm-msg-vertical-mine' : 'dm-theirs dm-msg-vertical dm-msg-vertical-theirs') + '" data-msg-id="' + m.id + '">' +
                    '<div class="channel-msg-head">' +
                    '<div class="dm-conv-avatar channel-msg-avatar" style="background:' + col + '">' +
                    (av ? '<img class="channel-msg-avatar-img" src="' + escapeHtml(av) + '">' : '<span class="channel-msg-avatar-letter">' + ini + '</span>') +
                    '</div>' +
                    '<strong class="channel-msg-author">' + escapeHtml(name) + '</strong>' +
                    '<span class="dm-msg-time">' + timeAgo(m.created_at) + '</span>' +
                    delBtn +
                    '</div>' +
                    '<div class="dm-msg-text">' + escapeHtml(m.content) + '</div>' +
                    '</div>';
            }).join('');
            el.scrollTop = el.scrollHeight;
        },

        closeRoom: function() {
            this.currentRoom = null;
            if (this.metaSubId) { Pool.unsubscribe(this.metaSubId); this.metaSubId = null; }
            document.getElementById('channel-room').style.display = 'none';
            document.getElementById('channel-list').style.display = '';
            document.getElementById('channel-actions').style.display = '';
            history.replaceState({ noxtr: 'tab', tab: 'channels' }, '', '/' + _MODULE_ + '/channels');
            this.subscribe();
        },

        // Publish kind 41 to update channel metadata (only creator)
        updateMeta: async function(channelId, name, about, picture) {
            var room = this.rooms[channelId];
            if (!room || room.creator !== Events.pubkey) return;
            var meta = { name: name };
            if (about) meta.about = about;
            if (picture !== undefined) meta.picture = picture;
            var tags = [['e', channelId, '']];
            var ev = await Events.create(41, JSON.stringify(meta), tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            // Update local state
            room.name = name;
            room.about = about || '';
            if (picture !== undefined) room.picture = picture;
            // Update DB
            this.saveToDb(channelId, name, about || '', picture || '', room.creator, '');
            // Update joined list
            for (var i = 0; i < this.joined.length; i++) {
                if (this.joined[i].channel_id === channelId) {
                    this.joined[i].name = name;
                    this.joined[i].about = about || '';
                    this.joined[i].picture = picture || '';
                    break;
                }
            }
            // Update header
            var nameEl = document.getElementById('channel-room-name');
            var aboutEl = document.getElementById('channel-room-about');
            if (nameEl) nameEl.textContent = name;
            if (aboutEl) aboutEl.textContent = about || '';
            return signed;
        },

        openEditDialog: function(channelId) {
            var room = this.rooms[channelId];
            if (!room) return;
            var self = this;
            var isEs = Api.lang === 'es';
            var content = '<div class="channel-dialog-form">' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Nombre del canal' : 'Channel name') + '</label>' +
                '<input type="text" id="ch-edit-name" class="channel-dialog-input" value="' + escapeHtml(room.name || '') + '"></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Descripción' : 'Description') + '</label>' +
                '<textarea id="ch-edit-about" rows="3" class="channel-dialog-input channel-dialog-textarea">' + escapeHtml(room.about || '') + '</textarea></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Imagen del canal (URL)' : 'Channel picture (URL)') + '</label>' +
                '<input type="text" id="ch-edit-picture" class="channel-dialog-input" value="' + escapeHtml(room.picture || '') + '" placeholder="https://..."></div>' +
                (room.picture ? '<div class="channel-dialog-preview"><img class="channel-dialog-preview-img" src="' + escapeHtml(room.picture) + '"></div>' : '') +
                '</div>';
            $("body").dialog({
                title: isEs ? 'Editar canal' : 'Edit channel',
                type: 'html',
                width: '420px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [
                    {
                        text: isEs ? 'Cancelar' : 'Cancel',
                        class: 'btn btn-cancel',
                        action: function(event, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: isEs ? 'Guardar' : 'Save',
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var newName = document.getElementById('ch-edit-name').value.trim();
                            var newAbout = document.getElementById('ch-edit-about').value.trim();
                            var newPicture = document.getElementById('ch-edit-picture').value.trim();
                            if (!newName) return;
                            try {
                                await self.updateMeta(channelId, newName, newAbout, newPicture);
                                document.body.removeChild(overlay);
                            } catch(e) { alert('Error: ' + e.message); }
                        }
                    }
                ]
            });
        },

        openCreateDialog: function() {
            var self = this;
            var isEs = Api.lang === 'es';
            var content = '<div class="channel-dialog-form">' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Nombre del canal' : 'Channel name') + '</label>' +
                '<input type="text" id="ch-create-name" class="channel-dialog-input" placeholder="' + (isEs ? 'Mi canal...' : 'My channel...') + '"></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Descripción (opcional)' : 'Description (optional)') + '</label>' +
                '<textarea id="ch-create-about" rows="3" class="channel-dialog-input channel-dialog-textarea"></textarea></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + (isEs ? 'Imagen del canal (URL, opcional)' : 'Channel picture (URL, optional)') + '</label>' +
                '<input type="text" id="ch-create-picture" class="channel-dialog-input" placeholder="https://..."></div>' +
                '</div>';
            $("body").dialog({
                title: isEs ? 'Crear canal' : 'Create channel',
                type: 'html',
                width: '420px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [
                    {
                        text: isEs ? 'Cancelar' : 'Cancel',
                        class: 'btn btn-cancel',
                        action: function(event, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: isEs ? 'Crear' : 'Create',
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var name = document.getElementById('ch-create-name').value.trim();
                            var about = document.getElementById('ch-create-about').value.trim();
                            var picture = document.getElementById('ch-create-picture').value.trim();
                            if (!name) return;
                            try {
                                await self.createChannel(name, about, picture);
                                document.body.removeChild(overlay);
                            } catch(e) { alert('Error: ' + e.message); }
                        }
                    }
                ]
            });
        },

        copyInviteLink: function(channelId) {
            var url = location.origin + '/' + _MODULE_ + '/channels/' + noteEncode(channelId);
            navigator.clipboard.writeText(url).then(function() {
                var btn = document.getElementById('channel-invite');
                if (btn) { btn.innerHTML = '<i class="fa fa-check"></i>'; setTimeout(function() { btn.innerHTML = '<i class="fa fa-share-alt"></i>'; }, 2000); }
            });
        },

        deleteChannel: async function(channelId) {
            var room = this.rooms[channelId];
            if (!room || room.creator !== Events.pubkey) return;
            // Publish kind 5 (NIP-09) deletion request for the kind 40 creation event
            var tags = [['e', channelId]];
            var ev = await Events.create(5, 'Channel deleted', tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            // Remove locally
            this.leaveChannel(channelId);
        }
    };

    // ==================== STATS (reactions, replies, reposts) ====================

    var Stats = {
        counts: {}, // { noteId: { likes: N, replies: N, reposts: N, zaps: N, liked: bool } }
        _seen: {},  // { eventId: true } — dedup events from multiple relays
        subId: null,
        get: function(id) { return this.counts[id] || { likes: 0, replies: 0, reposts: 0, zaps: 0, liked: false }; },
        _ensure: function(id) { if (!this.counts[id]) this.counts[id] = { likes: 0, replies: 0, reposts: 0, zaps: 0, liked: false }; },
        handle: function(ev) {
            if (this._seen[ev.id]) return;
            this._seen[ev.id] = true;
            if (ev.kind === 7) {
                // Reaction (like)
                var eTag = ev.tags.find(function(t) { return t[0] === 'e'; });
                if (eTag) {
                    this._ensure(eTag[1]);
                    this.counts[eTag[1]].likes++;
                    if (ev.pubkey === Events.pubkey) this.counts[eTag[1]].liked = true;
                    this._updateDom(eTag[1]);
                }
            } else if (ev.kind === 1) {
                // Reply
                var refs = ev.tags.filter(function(t) { return t[0] === 'e'; });
                for (var i = 0; i < refs.length; i++) {
                    if (this.counts[refs[i][1]] !== undefined || Feed.seen[refs[i][1]]) {
                        this._ensure(refs[i][1]);
                        this.counts[refs[i][1]].replies++;
                        this._updateDom(refs[i][1]);
                    }
                }
            } else if (ev.kind === 6) {
                // Repost
                var eTag = ev.tags.find(function(t) { return t[0] === 'e'; });
                if (eTag) {
                    this._ensure(eTag[1]);
                    this.counts[eTag[1]].reposts++;
                    this._updateDom(eTag[1]);
                }
            } else if (ev.kind === 9735) {
                // Zap receipt (NIP-57)
                var eTag = ev.tags.find(function(t) { return t[0] === 'e'; });
                if (eTag) {
                    this._ensure(eTag[1]);
                    this.counts[eTag[1]].zaps++;
                    this._updateDom(eTag[1]);
                }
            }
        },
        subscribe: function(noteIds) {
            if (this.subId) Pool.unsubscribe(this.subId);
            if (!noteIds.length) return;
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [7, 6, 9735], '#e': noteIds, limit: noteIds.length * 20 },
                 { kinds: [1], '#e': noteIds, limit: noteIds.length * 5 }],
                function(ev) { self.handle(ev); }
            );
        },
        _updateDom: function(noteId) {
            var el = document.querySelector('.note[data-id="' + noteId + '"]');
            if (!el) return;
            var c = this.get(noteId);
            var likeCount = el.querySelector('.count-likes');
            var replyCount = el.querySelector('.count-replies');
            var repostCount = el.querySelector('.count-reposts');
            var zapCount = el.querySelector('.count-zaps');
            if (likeCount) likeCount.textContent = c.likes || '';
            if (replyCount) replyCount.textContent = c.replies || '';
            if (repostCount) repostCount.textContent = c.reposts || '';
            if (zapCount) zapCount.textContent = c.zaps || '';
            // Highlight like if we liked it
            if (c.liked) {
                var likeBtn = el.querySelector('[data-action="like"]');
                if (likeBtn) { likeBtn.classList.add('liked'); likeBtn.querySelector('svg path').setAttribute('fill', 'currentColor'); }
            }
        },
        clear: function() { this.counts = {}; this._seen = {}; if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; } }
    };

    // ==================== ARTICLES (NIP-23 long-form content) ====================

    var Articles = {
        _repliesSubId: null,
        _currentArticle: null,

        _meta: function(ev) {
            var m = { title: '', summary: '', image: '', publishedAt: ev.created_at, dTag: '', hashtags: [] };
            for (var i = 0; i < ev.tags.length; i++) {
                var t = ev.tags[i];
                if (t[0] === 'title') m.title = t[1] || '';
                else if (t[0] === 'summary') m.summary = t[1] || '';
                else if (t[0] === 'image') m.image = t[1] || '';
                else if (t[0] === 'published_at') m.publishedAt = parseInt(t[1]) || m.publishedAt;
                else if (t[0] === 'd') m.dTag = t[1] || '';
                else if (t[0] === 't') m.hashtags.push(t[1]);
            }
            if (!m.title) m.title = ev.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || 'Untitled';
            if (!m.summary) m.summary = ev.content.replace(/[#*_`\[\]()>\-]/g, '').replace(/\n+/g, ' ').trim().slice(0, 200);
            return m;
        },

        // Full article view
        openArticle: function(ev) {
            var meta = this._meta(ev);
            this._currentArticle = ev;
            var panel = document.getElementById('article-view');
            var content = document.getElementById('article-view-content');
            var actionsEl = document.getElementById('article-view-actions');
            var repliesContainer = document.getElementById('article-replies');
            var replyCompose = document.getElementById('article-reply-compose');

            // Show article view, hide feed and panels
            panel.style.display = '';
            document.getElementById('feed').style.display = 'none';
            document.getElementById('feed-new').style.display = 'none';
            var loadEl = document.getElementById('feed-loading'); if (loadEl) loadEl.style.display = 'none';
            var compEl = document.getElementById('compose-area'); if (compEl) compEl.style.display = 'none';
            var filterEl = document.getElementById('feed-type-filter'); if (filterEl) filterEl.style.display = 'none';
            document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
            ['panel-following','panel-topics','panel-messages','panel-followers','panel-channels','panel-relays','panel-search'].forEach(function(id) {
                var p = document.getElementById(id); if (p) p.style.display = 'none';
            });

            // Render article
            var name = Profiles.displayName(ev.pubkey);
            var av = Profiles.avatar(ev.pubkey);
            var col = Profiles.color(ev.pubkey);
            var ini = (name[0] || '?').toUpperCase();
            var avOk = av && !DeadDomains.isDead(DeadDomains.domainOf(av));
            var dateStr = new Date(meta.publishedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

            content.innerHTML =
                (meta.image ? '<div class="article-hero"><img src="'+escapeHtml(meta.image)+'" onerror="this.parentNode.remove()"></div>' : '') +
                '<h1 class="article-title">' + escapeHtml(meta.title) + '</h1>' +
                '<div class="article-byline">' +
                    '<div class="note-avatar note-avatar-article" style="background:'+col+'">' +
                        (avOk ? '<img class="note-avatar-article-img" src="'+escapeHtml(av)+'" onerror="_mediaError(this)">' : '<span class="avatar-letter">'+ini+'</span>') +
                    '</div>' +
                    '<div><strong>' + escapeHtml(name) + '</strong><br><span class="article-date">' + dateStr + '</span></div>' +
                '</div>' +
                '<div class="article-body">' + parseContent(ev.content) + '</div>' +
                (meta.hashtags.length ? '<div class="article-card-tags article-card-tags-spaced">' + meta.hashtags.map(function(t) { return '<span class="article-tag">#'+escapeHtml(t)+'</span>'; }).join(' ') + '</div>' : '');

            // Action buttons
            var isBookmarked = Bookmarks.has(ev.id);
            actionsEl.innerHTML =
                '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Like"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
                '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Repost"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
                '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Zap"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
                '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="Bookmark"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
                '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="Share"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>';

            // Reply compose
            if (replyCompose) replyCompose.style.display = Events.canSign() ? '' : 'none';

            // Subscribe for replies
            repliesContainer.innerHTML = '';
            if (this._repliesSubId) { Pool.unsubscribe(this._repliesSubId); this._repliesSubId = null; }
            var replySeen = {};
            this._repliesSubId = Pool.subscribe(
                [{ kinds: [1], '#e': [ev.id], limit: 50 }],
                function(reply) {
                    if (reply.kind !== 1 || replySeen[reply.id]) return;
                    replySeen[reply.id] = true;
                    Profiles.request(reply.pubkey);
                    var rel = Feed.renderNote(reply);
                    repliesContainer.appendChild(rel);
                }
            );

            // Fetch stats for this article
            Stats.subscribe([ev.id]);

            // Push history state
            var naddr = naddrEncode(meta.dTag, ev.pubkey, 30023);
            history.pushState({ noxtr: 'article', eventId: ev.id, naddr: naddr }, '', '/' + _MODULE_ + '/article/' + naddr);
        },

        closeArticle: function() {
            var panel = document.getElementById('article-view');
            if (panel) panel.style.display = 'none';
            if (this._repliesSubId) { Pool.unsubscribe(this._repliesSubId); this._repliesSubId = null; }
            this._currentArticle = null;
            // Restore feed and related elements that openArticle hid
            document.getElementById('feed').style.display = '';
            var filterEl = document.getElementById('feed-type-filter'); if (filterEl) filterEl.style.display = '';
            // Restore search panel if we were in search mode
            if (UI.currentTab === 'search') {
                var sp = document.getElementById('panel-search'); if (sp) sp.style.display = '';
            }
        },

        openByNaddr: function(naddr) {
            var decoded = naddrDecode(naddr);
            if (!decoded || !decoded.pubkey) return;
            var self = this;
            var tmpSub = Pool.subscribe(
                [{ kinds: [30023], authors: [decoded.pubkey], '#d': [decoded.identifier], limit: 1 }],
                function(ev) {
                    Pool.unsubscribe(tmpSub);
                    if (ev.kind === 30023) {
                        Profiles.request(ev.pubkey);
                        setTimeout(function() { self.openArticle(ev); }, 300);
                    }
                }
            );
        },

        // Publish article (kind 30023)
        publishArticle: async function(title, summary, content, imageUrl, hashtags, dTag) {
            if (!Events.canSign()) return;
            if (!dTag) dTag = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || String(Date.now());

            var tags = [['d', dTag], ['title', title]];
            if (summary) tags.push(['summary', summary]);
            if (imageUrl) tags.push(['image', imageUrl]);
            tags.push(['published_at', String(Math.floor(Date.now() / 1000))]);
            if (hashtags && hashtags.length) {
                for (var i = 0; i < hashtags.length; i++) tags.push(['t', hashtags[i].toLowerCase().trim()]);
            }
            // Extract mentioned pubkeys from content
            var mr = /nostr:(npub1[a-z0-9]+)/gi, mm;
            while ((mm = mr.exec(content)) !== null) { var h = npubDecode(mm[1]); if (h) tags.push(['p', h]); }

            var ev = await Events.create(30023, content, tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            return signed;
        }
    };

    // ==================== NIP-44 (encryption) ====================

    var Nip44 = {
        getConversationKey: async function(privkey, pubkey) {
            var shared = nobleSecp256k1.getSharedSecret(privkey, '02' + pubkey);
            if (typeof shared === 'string') shared = hexToBytes(shared);
            var sharedX = shared.slice(1, 33);
            // NIP-44 v2: HKDF-Extract ONLY = HMAC-SHA256(key='nip44-v2', data=sharedX)
            var saltKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('nip44-v2'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            return new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, sharedX));
        },
        _hkdf: async function(prk, info, len) {
            // NIP-44 v2: HKDF-Expand ONLY — T(i) = HMAC(key=PRK, T(i-1) || info || counter)
            // prk = conversationKey, info = nonce
            var prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            var okm = new Uint8Array(len);
            var T = new Uint8Array(0);
            var offset = 0, counter = 1;
            while (offset < len) {
                var block = new Uint8Array(T.length + info.length + 1);
                block.set(T);
                block.set(info, T.length);
                block[T.length + info.length] = counter++;
                T = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, block));
                var copy = Math.min(T.length, len - offset);
                okm.set(T.subarray(0, copy), offset);
                offset += copy;
            }
            return okm;
        },
        _hmac: async function(key, data) {
            var k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            var sig = await crypto.subtle.sign('HMAC', k, data);
            return new Uint8Array(sig);
        },
        _calcPadding: function(len) {
            if (len <= 32) return 32;
            var nextPow2 = 1 << (32 - Math.clz32(len - 1));
            var chunk = nextPow2 <= 256 ? 32 : nextPow2 / 8;
            return chunk * (Math.floor((len - 1) / chunk) + 1);
        },
        pad: function(text) {
            var utf8 = new TextEncoder().encode(text);
            var len = utf8.length;
            if (len < 1 || len > 65535) throw new Error('invalid plaintext length');
            var padLen = this._calcPadding(len);
            var padded = new Uint8Array(2 + padLen);
            padded[0] = (len >> 8) & 0xff;
            padded[1] = len & 0xff;
            padded.set(utf8, 2);
            return padded;
        },
        unpad: function(padded) {
            var len = (padded[0] << 8) | padded[1];
            if (len < 1 || 2 + len > padded.length) throw new Error('invalid padding');
            return new TextDecoder().decode(padded.slice(2, 2 + len));
        },
        encrypt: async function(plaintext, conversationKey) {
            var nonce = crypto.getRandomValues(new Uint8Array(32));
            var mk = await this._hkdf(conversationKey, nonce, 76);
            var chachaKey = mk.slice(0, 32);
            var chachaNonce = mk.slice(32, 44);
            var hmacKey = mk.slice(44, 76);
            var padded = this.pad(plaintext);
            var ciphertext = nobleCiphers.chacha20(chachaKey, chachaNonce, padded);
            var hmacData = new Uint8Array(nonce.length + ciphertext.length);
            hmacData.set(nonce);
            hmacData.set(ciphertext, nonce.length);
            var mac = await this._hmac(hmacKey, hmacData);
            var result = new Uint8Array(1 + 32 + ciphertext.length + 32);
            result[0] = 0x02;
            result.set(nonce, 1);
            result.set(ciphertext, 33);
            result.set(mac, 33 + ciphertext.length);
            return btoa(String.fromCharCode.apply(null, result));
        },
        decrypt: async function(payload, conversationKey) {
            var raw = Uint8Array.from(atob(payload), function(c) { return c.charCodeAt(0); });
            if (raw[0] !== 0x02) throw new Error('unsupported NIP-44 version');
            var nonce = raw.slice(1, 33);
            var mac = raw.slice(raw.length - 32);
            var ciphertext = raw.slice(33, raw.length - 32);
            var mk = await this._hkdf(conversationKey, nonce, 76);
            var chachaKey = mk.slice(0, 32);
            var chachaNonce = mk.slice(32, 44);
            var hmacKey = mk.slice(44, 76);
            var hmacData = new Uint8Array(nonce.length + ciphertext.length);
            hmacData.set(nonce);
            hmacData.set(ciphertext, nonce.length);
            var expectedMac = await this._hmac(hmacKey, hmacData);
            var match = true;
            for (var i = 0; i < 32; i++) if (mac[i] !== expectedMac[i]) match = false;
            if (!match) throw new Error('invalid MAC');
            var padded = nobleCiphers.chacha20(chachaKey, chachaNonce, ciphertext);
            return this.unpad(padded);
        }
    };

    // ==================== NIP-46 (Nostr Connect) ====================

    var Nip46 = {
        clientPrivkey: null, clientPubkey: null,
        signerPubkey: null, userPubkey: null,
        conversationKey: null, connected: false,
        pending: {}, subId: null, _connectResolve: null, _connectSecret: null,

        connect: async function() {
            // Generate client keypair
            var privBytes = crypto.getRandomValues(new Uint8Array(32));
            this.clientPrivkey = bytesToHex(privBytes);
            var pk = nobleSecp256k1.getPublicKey(this.clientPrivkey, true);
            this.clientPubkey = (typeof pk === 'string' ? pk : bytesToHex(pk)).slice(2);

            // Generate secret
            var secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
            this._connectSecret = secret;

            // Build URI
            var relays = Relays.activeUrls();
            if (!relays.length) relays = DEFAULT_RELAYS.slice(0, 3);
            var uri = 'nostrconnect://' + this.clientPubkey;
            var params = [];
            for (var i = 0; i < relays.length; i++) params.push('relay=' + encodeURIComponent(relays[i]));
            params.push('secret=' + secret);
            params.push('name=Noxtr');
            uri += '?' + params.join('&');

            // Conectar a los relays del URI antes de suscribirse
            for (var i = 0; i < relays.length; i++) Pool.connect(relays[i]);

            // Show modal
            var modal = document.getElementById('nip46-modal');
            var qrEl = document.getElementById('nip46-qr');
            var uriEl = document.getElementById('nip46-uri');
            var statusEl = document.getElementById('nip46-status');
            if (modal) modal.style.display = '';
            if (uriEl) uriEl.textContent = uri;
            if (statusEl) statusEl.textContent = 'Waiting for signer...';
            // QR code (usa qrcode.min.js standalone — sin jQuery)
            if (qrEl) {
                qrEl.innerHTML = '';
                if (typeof QRCode !== 'undefined') {
                    new QRCode(qrEl, { text: uri, width: 220, height: 220,
                        colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
                } else {
                    qrEl.innerHTML = '<div class="nip46-qr-fallback">QR no disponible — copia el URI</div>';
                }
            }
            // Copy button
            var copyBtn = document.getElementById('btn-nip46-copy');
            if (copyBtn) copyBtn.onclick = function() {
                navigator.clipboard.writeText(uri).then(function() {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(function() { copyBtn.textContent = 'Copy URI'; }, 2000);
                });
            };

            // Subscribe for responses
            this._subscribe();

            // Wait for connect response
            var self = this;
            return new Promise(function(resolve, reject) {
                self._connectResolve = resolve;
                self._connectTimeout = setTimeout(function() {
                    if (statusEl) statusEl.textContent = 'Timeout — no response from signer';
                    self._connectResolve = null;
                    reject(new Error('Connection timeout'));
                }, 120000);
            });
        },

        disconnect: function() {
            this.clientPrivkey = null;
            this.clientPubkey = null;
            this.signerPubkey = null;
            this.userPubkey = null;
            this.conversationKey = null;
            this.connected = false;
            Events.useNip46 = false;
            Events.pubkey = null;
            if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; }
            try { localStorage.removeItem('noxtr_nip46'); } catch(e) {}
            UI.updateIdentity();
        },

        restore: async function() {
            try {
                var data = JSON.parse(localStorage.getItem('noxtr_nip46'));
                if (!data || !data.clientPrivkey || !data.signerPubkey || !data.userPubkey) return false;
                this.clientPrivkey = data.clientPrivkey;
                this.clientPubkey = data.clientPubkey;
                this.signerPubkey = data.signerPubkey;
                this.userPubkey = data.userPubkey;
                this.conversationKey = await Nip44.getConversationKey(this.clientPrivkey, this.signerPubkey);
                this.connected = true;
                Events.pubkey = this.userPubkey;
                Events.useNip46 = true;
                this._subscribe();
                return true;
            } catch(e) { return false; }
        },

        _save: function() {
            try {
                localStorage.setItem('noxtr_nip46', JSON.stringify({
                    clientPrivkey: this.clientPrivkey, clientPubkey: this.clientPubkey,
                    signerPubkey: this.signerPubkey, userPubkey: this.userPubkey
                }));
            } catch(e) {}
        },

        _subscribe: function() {
            if (this.subId) Pool.unsubscribe(this.subId);
            if (!this.clientPubkey) return;
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [24133], '#p': [this.clientPubkey], limit: 10 }],
                function(ev) { self._handleEvent(ev); }
            );
        },

        _handleEvent: async function(ev) {
            if (ev.kind !== 24133) return;
            try {
                // During connect handshake, signer pubkey is not yet known
                if (!this.signerPubkey && this._connectResolve) {
                    // First message from signer — learn signer pubkey
                    this.signerPubkey = ev.pubkey;
                    this.conversationKey = await Nip44.getConversationKey(this.clientPrivkey, this.signerPubkey);
                }
                if (ev.pubkey !== this.signerPubkey) return;
                var decrypted = await Nip44.decrypt(ev.content, this.conversationKey);
                var msg = JSON.parse(decrypted);

                // Handle connect response (acepta el secret del URI o 'ack')
                if (this._connectResolve && (msg.result === this._connectSecret || msg.result === 'ack')) {
                    clearTimeout(this._connectTimeout);
                    this.connected = true;
                    // Get user pubkey
                    var userPk = await this._request('get_public_key', []);
                    this.userPubkey = userPk;
                    Events.pubkey = userPk;
                    Events.useNip46 = true;
                    this._save();
                    // Close modal
                    var modal = document.getElementById('nip46-modal');
                    if (modal) modal.style.display = 'none';
                    UI.updateIdentity();

                    // Intentar web login via challenge/sign/verify (recarga si tiene éxito)
                    await this._doWebLogin(userPk);

                    var resolve = this._connectResolve;
                    this._connectResolve = null;
                    resolve(true);
                    return;
                }

                // Handle pending request response
                if (msg.id && this.pending[msg.id]) {
                    var p = this.pending[msg.id];
                    clearTimeout(p.timeout);
                    delete this.pending[msg.id];
                    if (msg.error) p.reject(new Error(msg.error));
                    else p.resolve(msg.result);
                }
            } catch(e) { /* ignore parse/decrypt errors */ }
        },

        _request: async function(method, params) {
            if (!this.connected && method !== 'get_public_key') throw new Error('NIP-46: not connected');
            var id = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
            var payload = JSON.stringify({ id: id, method: method, params: params || [] });
            var encrypted = await Nip44.encrypt(payload, this.conversationKey);

            // Create and sign kind 24133 event with client privkey
            var ev = {
                pubkey: this.clientPubkey,
                created_at: Math.floor(Date.now() / 1000),
                kind: 24133,
                tags: [['p', this.signerPubkey]],
                content: encrypted
            };
            ev.id = await sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            var sig = await nobleSecp256k1.schnorr.sign(ev.id, this.clientPrivkey);
            ev.sig = typeof sig === 'string' ? sig : bytesToHex(sig);
            Pool.publish(ev);

            var self = this;
            return new Promise(function(resolve, reject) {
                var t = setTimeout(function() { delete self.pending[id]; reject(new Error('NIP-46 request timeout: ' + method)); }, 30000);
                self.pending[id] = { resolve: resolve, reject: reject, timeout: t };
            });
        },

        signEvent: async function(ev) {
            var result = await this._request('sign_event', [JSON.stringify(ev)]);
            return JSON.parse(result);
        },

        _doWebLogin: async function(userPubkey) {
            if (!Api.loginAjaxUrl) { console.warn('[_doWebLogin] loginAjaxUrl not set'); return; }
            NoxtrDebug.log('[_doWebLogin] start, pubkey=', userPubkey, 'url=', Api.loginAjaxUrl);
            try {
                // 1. Solicitar challenge al servidor
                var chalResp = await fetch(Api.loginAjaxUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'op=nostr_challenge' + (Api.csrfToken ? '&csrf_token=' + encodeURIComponent(Api.csrfToken) : '')
                });
                var chalData = await chalResp.json();
                NoxtrDebug.log('[_doWebLogin] challenge response:', chalData);
                if (!chalData.success || !chalData.challenge) { console.warn('[_doWebLogin] challenge failed:', chalData); return; }

                // 2. Construir evento kind 27235 (NIP-98 HTTP Auth) con el challenge
                var loginEvent = {
                    kind: 27235,
                    pubkey: userPubkey,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [
                        ['challenge', chalData.challenge],
                        ['u', 'https://' + chalData.domain]
                    ],
                    content: ''
                };

                // 3. Firmar via NIP-46 (si Bunker interno: auto-aprobado; si signer externo: usuario acepta)
                NoxtrDebug.log('[_doWebLogin] requesting sign_event kind 27235...');
                var signedStr = await this._request('sign_event', [loginEvent]);
                var signed = typeof signedStr === 'string' ? JSON.parse(signedStr) : signedStr;
                NoxtrDebug.log('[_doWebLogin] signed event:', signed);

                // 4. Verificar con el servidor → establece $_SESSION
                var verifyResp = await fetch(Api.loginAjaxUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'op=nostr_verify&event=' + encodeURIComponent(JSON.stringify(signed))
                        + (Api.csrfToken ? '&csrf_token=' + encodeURIComponent(Api.csrfToken) : '')
                });
                var verifyData = await verifyResp.json();
                NoxtrDebug.log('[_doWebLogin] verify response:', verifyData);

                // 5. Recargar página → PHP ya tiene sesión activa
                if (verifyData.success) {
                    window.location.reload();
                }
            } catch(e) {
                console.warn('[_doWebLogin] failed (JS login still active):', e);
            }
        }
    };

    // ==================== NIP-46 BUNKER (Noxtr actúa como firmador para apps externas) ====================

    var Bunker = {
        clients: {},  // clientPubkey -> { convKey, name, secret, relays }
        subId: null,
        active: false,
        _seen: {},    // ev.id -> true, para deduplicar eventos de múltiples relays

        // Acepta una URI nostrconnect:// generada por una app externa (ej: aqstr.com)
        accept: async function(uriRaw) {
            if (!Events.privkey) throw new Error(Api.lang === 'es' ? 'Necesitas nsec para actuar como firmador' : 'Need nsec to act as signer');
            var uri = uriRaw.trim();
            // Decodificar si viene URL-encoded (ej: nostrconnect%3A%2F%2F...)
            if (uri.indexOf('nostrconnect://') !== 0) { try { uri = decodeURIComponent(uri); } catch(e) {} }
            if (uri.indexOf('nostrconnect://') !== 0) throw new Error(Api.lang === 'es' ? 'La URI debe empezar con nostrconnect://' : 'URI must start with nostrconnect://');

            // Parsear: nostrconnect://CLIENT_PUBKEY?relay=...&secret=...&name=...
            var fakeUrl = 'https://' + uri.slice('nostrconnect://'.length);
            var parsed;
            try { parsed = new URL(fakeUrl); } catch(e) { throw new Error(Api.lang === 'es' ? 'URI mal formada' : 'Malformed URI'); }

            var clientPubkey = parsed.hostname;
            var relays = parsed.searchParams.getAll('relay');
            var secret = parsed.searchParams.get('secret') || '';
            var name = parsed.searchParams.get('name') || 'Unknown app';

            if (!clientPubkey || clientPubkey.length !== 64 || !/^[0-9a-f]+$/i.test(clientPubkey))
                throw new Error(Api.lang === 'es' ? 'Pubkey del cliente inválida' : 'Invalid client pubkey');

            var convKey = await Nip44.getConversationKey(Events.privkey, clientPubkey);
            this.clients[clientPubkey] = { convKey: convKey, name: name, secret: secret, relays: relays };

            // Filtrar relays desactivados por el usuario (active == 0 en Relays.list)
            var disabledUrls = Relays.list.filter(function(r) { return r.active == 0; }).map(function(r) { return r.url; });
            var activeRelays = relays.filter(function(r) { return disabledUrls.indexOf(r) === -1; });
            if (!activeRelays.length) activeRelays = relays; // fallback si todos están desactivados

            // Conectar a los relays indicados en la URI (solo los no desactivados)
            for (var i = 0; i < activeRelays.length; i++) Pool.connect(activeRelays[i]);

            this._subscribe();
            this.active = true;
            this._save();

            // Esperar a que al menos una relay esté conectada (máx 5s) antes de enviar
            await this._waitForRelay(activeRelays, 5000);

            // Enviar petición "connect" al cliente: {method:"connect", params:[signerPubkey, secret]}
            // (NO es una respuesta — es el signer quien inicia el handshake en el flujo nostrconnect://)
            await this._sendConnectRequest(clientPubkey, secret, activeRelays);

            this._updateUI();
            return name;
        },

        stop: function(clientPubkey) {
            if (clientPubkey) {
                delete this.clients[clientPubkey];
            } else {
                this.clients = {};
            }
            if (!Object.keys(this.clients).length) {
                this.active = false;
                if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; }
            }
            this._save();
            this._updateUI();
        },

        restore: async function() {
            try {
                if (!Events.privkey) return false;
                var data = JSON.parse(localStorage.getItem('noxtr_bunker'));
                if (!data || !data.clients) return false;
                var keys = Object.keys(data.clients);
                if (!keys.length) return false;
                var disabledUrls = Relays.list.filter(function(r) { return r.active == 0; }).map(function(r) { return r.url; });
                for (var i = 0; i < keys.length; i++) {
                    var pk = keys[i], c = data.clients[pk];
                    var convKey = await Nip44.getConversationKey(Events.privkey, pk);
                    this.clients[pk] = { convKey: convKey, name: c.name, secret: c.secret, relays: c.relays || [] };
                    var activeRelays = (c.relays || []).filter(function(r) { return disabledUrls.indexOf(r) === -1; });
                    if (!activeRelays.length) activeRelays = c.relays || [];
                    for (var j = 0; j < activeRelays.length; j++) Pool.connect(activeRelays[j]);
                }
                this._subscribe();
                this.active = true;
                this._updateUI();
                return true;
            } catch(e) { return false; }
        },

        _save: function() {
            try {
                var toSave = {};
                Object.keys(this.clients).forEach(function(pk) {
                    toSave[pk] = { name: Bunker.clients[pk].name, secret: Bunker.clients[pk].secret, relays: Bunker.clients[pk].relays };
                });
                localStorage.setItem('noxtr_bunker', JSON.stringify({ clients: toSave }));
            } catch(e) {}
        },

        _subscribe: function() {
            if (this.subId) Pool.unsubscribe(this.subId);
            if (!Events.pubkey) return;
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [24133], '#p': [Events.pubkey], limit: 5 }],
                function(ev) { self._handleRequest(ev); }
            );
        },

        _handleRequest: async function(ev) {
            if (ev.kind !== 24133) return;
            if (this._seen[ev.id]) return;  // deduplicar: el mismo evento llega de múltiples relays
            this._seen[ev.id] = true;
            var client = this.clients[ev.pubkey];
            if (!client) return;
            var msg;
            try {
                var decrypted = await Nip44.decrypt(ev.content, client.convKey);
                msg = JSON.parse(decrypted);
            } catch(e) { return; }

            var method = msg.method || '', id = msg.id || '', params = msg.params || [];
            var isEs = Api.lang === 'es';
            try {
                if (method === 'connect') {
                    // Responder al connect request del cliente (flujo nostrconnect://)
                    // Devolver el secret del URI si existe, si no "ack" (nostrudel verifica result === secret || "ack")
                    await this._sendResponse(ev.pubkey, id, client.secret || 'ack', null);

                } else if (method === 'ping') {
                    await this._sendResponse(ev.pubkey, id, 'pong', null);

                } else if (method === 'get_public_key') {
                    await this._sendResponse(ev.pubkey, id, Events.pubkey, null);

                } else if (method === 'get_relays') {
                    // Devolver los relays del usuario en formato {url: {read, write}}
                    var userRelays = Relays && Relays.list && Relays.list.length ? Relays.list : DEFAULT_RELAYS;
                    var relayMap = {};
                    (Array.isArray(userRelays) ? userRelays : Object.keys(userRelays)).forEach(function(r) {
                        var url = typeof r === 'string' ? r : r.url;
                        if (url) relayMap[url] = { read: true, write: true };
                    });
                    await this._sendResponse(ev.pubkey, id, JSON.stringify(relayMap), null);

                } else if (method === 'sign_event') {
                    // params[0] puede ser objeto o string JSON según la implementación
                    var eventToSign = (typeof params[0] === 'string') ? JSON.parse(params[0]) : params[0];
                    if (!eventToSign.pubkey) eventToSign.pubkey = Events.pubkey;
                    // kind 27235 = HTTP Auth (NIP-98): auto-firmar sin confirmación (login web)
                    if (eventToSign.kind !== 27235) {
                        var kindNames = { 0: 'profile', 1: 'note', 3: 'contacts', 4: 'DM', 5: 'delete', 6: 'repost', 7: 'reaction', 9734: 'zap request', 22242: 'auth', 30023: 'article' };
                        var kindDesc = (kindNames[eventToSign.kind] ? kindNames[eventToSign.kind] + ' (' : '') + 'kind ' + eventToSign.kind + (kindNames[eventToSign.kind] ? ')' : '');
                        var preview = eventToSign.content ? '\n\n' + eventToSign.content.slice(0, 140) + (eventToSign.content.length > 140 ? '...' : '') : '';
                        var ok = await confirm((isEs ? client.name + ' quiere que firmes un ' + kindDesc + ':' : client.name + ' wants you to sign a ' + kindDesc + ':') + preview);
                        if (!ok) { await this._sendResponse(ev.pubkey, id, null, isEs ? 'Rechazado por el usuario' : 'Rejected by user'); return; }
                    }
                    if (!eventToSign.id) eventToSign.id = await sha256hex(JSON.stringify([0, eventToSign.pubkey, eventToSign.created_at, eventToSign.kind, eventToSign.tags, eventToSign.content]));
                    var sig = await nobleSecp256k1.schnorr.sign(eventToSign.id, Events.privkey);
                    eventToSign.sig = typeof sig === 'string' ? sig : bytesToHex(sig);
                    await this._sendResponse(ev.pubkey, id, JSON.stringify(eventToSign), null);

                } else {
                    await this._sendResponse(ev.pubkey, id, null, 'Unsupported method: ' + method);
                }
            } catch(e) {
                try { await this._sendResponse(ev.pubkey, id, null, e.message || 'Error'); } catch(e2) {}
            }
        },

        // Espera hasta que una de las relays indicadas esté conectada, o hasta maxMs
        _waitForRelay: function(relayUrls, maxMs) {
            return new Promise(function(resolve) {
                var deadline = Date.now() + maxMs;
                var check = function() {
                    for (var i = 0; i < relayUrls.length; i++) {
                        var r = Pool.relays[relayUrls[i]];
                        if (r && r.status === 'connected') { resolve(); return; }
                    }
                    if (Date.now() >= deadline) { resolve(); return; } // timeout: intentamos igualmente
                    setTimeout(check, 100);
                };
                check();
            });
        },

        // Envía la RESPUESTA de connect al cliente (formato NIP-46: {id, result, error})
        // nostrudel/applesauce cierra el popup cuando result === "ack" o result === secret
        // y re-envía a cada relay del URI cuando conecte (por si no estaban listas al publicar)
        _sendConnectRequest: async function(clientPubkey, secret, uriRelays) {
            if (!Events.privkey || !Events.pubkey) return;
            var client = this.clients[clientPubkey];
            if (!client) return;
            var id = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
            var payload = JSON.stringify({ id: id, result: secret || 'ack', error: '' });
            var encrypted = await Nip44.encrypt(payload, client.convKey);
            var ev = { pubkey: Events.pubkey, created_at: Math.floor(Date.now() / 1000), kind: 24133, tags: [['p', clientPubkey]], content: encrypted };
            ev.id = await sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            var sig = await nobleSecp256k1.schnorr.sign(ev.id, Events.privkey);
            ev.sig = typeof sig === 'string' ? sig : bytesToHex(sig);

            // Publicar a todas las relays ya conectadas
            Pool.publish(ev);

            // Para cada relay del URI, re-enviar en cuanto esté conectada (hasta 20s)
            var msg = JSON.stringify(['EVENT', ev]);
            var deadline = Date.now() + 20000;
            (uriRelays || []).forEach(function(url) {
                var sent = false;
                var check = function() {
                    if (sent || Date.now() > deadline) return;
                    var r = Pool.relays[url];
                    if (r && r.status === 'connected') {
                        try { r.ws.send(msg); sent = true; } catch(e) {}
                    } else {
                        setTimeout(check, 400);  // reintentar en cualquier estado no-conectado
                    }
                };
                setTimeout(check, 200);
            });
        },

        _sendResponse: async function(clientPubkey, id, result, error) {
            if (!Events.privkey || !Events.pubkey) return;
            var client = this.clients[clientPubkey];
            if (!client) return;
            var payload = JSON.stringify({ id: id, result: result, error: error });
            var encrypted = await Nip44.encrypt(payload, client.convKey);
            var ev = { pubkey: Events.pubkey, created_at: Math.floor(Date.now() / 1000), kind: 24133, tags: [['p', clientPubkey]], content: encrypted };
            ev.id = await sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            var sig = await nobleSecp256k1.schnorr.sign(ev.id, Events.privkey);
            ev.sig = typeof sig === 'string' ? sig : bytesToHex(sig);
            Pool.publish(ev);
        },

        _updateUI: function() {
            var panel = document.getElementById('bunker-clients');
            var keys = Object.keys(this.clients);
            if (!panel) return;
            if (!keys.length) { panel.innerHTML = ''; panel.style.display = 'none'; return; }
            var isEs = Api.lang === 'es';
            var html = '<div class="bunker-active-label">' + (isEs ? 'Conexiones:' : 'Connections:') + '</div>';
            keys.forEach(function(pk) {
                var c = Bunker.clients[pk];
                html += '<div class="bunker-client"><span class="bunker-client-name">' + escapeHtml(c.name) + '</span>'
                    + '<a class="bunker-client-disconnect" data-pk="' + pk + '">' + (isEs ? 'Desconectar' : 'Disconnect') + '</a></div>';
            });
            panel.innerHTML = html;
            panel.style.display = '';
            panel.querySelectorAll('.bunker-client-disconnect').forEach(function(btn) {
                btn.onclick = function() { Bunker.stop(btn.dataset.pk); };
            });
        }
    };

    // ==================== THREADS ====================

    var Threads = {
        notes: [], seen: {}, subId: null, statsSubId: null,
        rootId: null, focusId: null, container: null, active: false,

        open: function(note) {
            this.close();
            this.active = true;
            this.container = document.getElementById('thread-feed');
            this.focusId = note.id;

            // Find root: look for e-tag with 'root' marker, then first e-tag, else note itself is root
            this.rootId = note.id;
            if (note.tags) {
                for (var i = 0; i < note.tags.length; i++) {
                    if (note.tags[i][0] === 'e' && note.tags[i][3] === 'root') { this.rootId = note.tags[i][1]; break; }
                }
                if (this.rootId === note.id) {
                    for (var i = 0; i < note.tags.length; i++) {
                        if (note.tags[i][0] === 'e') { this.rootId = note.tags[i][1]; break; }
                    }
                }
            }

            // Show thread UI, hide feed UI (keep tabs visible for navigation)
            document.getElementById('thread-view').style.display = '';
            document.getElementById('feed').style.display = 'none';
            document.getElementById('feed-new').style.display = 'none';
            document.getElementById('feed-loading').style.display = 'none';
            var comp = document.getElementById('compose-area'); if (comp) comp.style.display = 'none';
            // Deselect all tabs (thread is not a tab)
            document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
            // Hide side panels
            ['panel-following', 'panel-topics', 'panel-messages', 'panel-followers', 'panel-channels'].forEach(function(id) {
                var p = document.getElementById(id); if (p) p.style.display = 'none';
            });

            // Show thread compose if user can sign
            var tComp = document.getElementById('thread-compose');
            if (tComp) tComp.style.display = Events.canSign() ? '' : 'none';

            // Update thread title with note preview
            var tt = document.querySelector('.thread-title');
            if (tt) {
                var author = Profiles.displayName(note.pubkey);
                var preview = (note.content || '').replace(/\n/g, ' ').slice(0, 60);
                if (note.content.length > 60) preview += '…';
                tt.innerHTML = '<strong>' + escapeHtml(author) + '</strong> <span class="thread-title-preview">' + escapeHtml(preview) + '</span>';
            }

            // Insert the clicked note if we already have it
            this._addNote(note);

            // Subscribe for root + all replies to root
            var self = this;
            this.subId = Pool.subscribe(
                [{ ids: [this.rootId], kinds: [1] }, { kinds: [1], '#e': [this.rootId], limit: 100 }],
                function(ev) { self._addNote(ev); },
                function() { self._onEose(); }
            );
        },

        _addNote: function(ev) {
            if (ev.kind !== 1 || this.seen[ev.id]) return;
            this.seen[ev.id] = true;
            Profiles.request(ev.pubkey);
            // Insert sorted by created_at (chronological)
            var idx = this.notes.length;
            for (var i = 0; i < this.notes.length; i++) {
                if (this.notes[i].created_at > ev.created_at) { idx = i; break; }
            }
            this.notes.splice(idx, 0, ev);
            // Render
            var el = Feed.renderNote(ev);
            if (ev.id === this.rootId) el.classList.add('thread-root');
            if (ev.id === this.focusId) el.classList.add('thread-focus');
            if (idx >= this.container.children.length) this.container.appendChild(el);
            else this.container.insertBefore(el, this.container.children[idx]);
        },

        _onEose: function() {
            // Subscribe for stats on all thread notes
            var ids = this.notes.map(function(n) { return n.id; });
            if (ids.length) {
                if (this.statsSubId) Pool.unsubscribe(this.statsSubId);
                this.statsSubId = Pool.subscribe(
                    [{ kinds: [7, 6], '#e': ids, limit: ids.length * 20 },
                     { kinds: [1], '#e': ids, limit: ids.length * 5 }],
                    function(ev) { Stats.handle(ev); }
                );
            }
            // Scroll to focused note
            var focused = this.container.querySelector('.thread-focus');
            if (focused) setTimeout(function() { focused.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 200);
            // Show empty state if only root
            if (!this.notes.length) this.container.innerHTML = '<div class="noxtr-empty">No replies yet.</div>';
        },

        reply: async function(text) {
            if (!text || !Events.canSign() || !this.rootId) return;
            var rootNote = null;
            for (var i = 0; i < this.notes.length; i++) { if (this.notes[i].id === this.rootId) { rootNote = this.notes[i]; break; } }
            var tags = [['e', this.rootId, '', 'root']];
            if (rootNote) tags.push(['p', rootNote.pubkey]);
            // Extract mentions
            var mr = /nostr:(npub1[a-z0-9]+)/gi, mm;
            while ((mm = mr.exec(text)) !== null) { var h = npubDecode(mm[1]); if (h) tags.push(['p', h]); }
            // Extract hashtags
            var hr = /#([a-zA-Z0-9_]+)/g, hm, seen = {};
            while ((hm = hr.exec(text)) !== null) { var t = hm[1].toLowerCase(); if (!seen[t]) { tags.push(['t', t]); seen[t] = true; } }
            var ev = await Events.create(1, text, tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            this._addNote(signed);
            return signed;
        },

        close: function() {
            if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; }
            if (this.statsSubId) { Pool.unsubscribe(this.statsSubId); this.statsSubId = null; }
            this.notes = []; this.seen = {}; this.rootId = null; this.focusId = null; this.active = false;
            var tv = document.getElementById('thread-view'); if (tv) tv.style.display = 'none';
            var tf = document.getElementById('thread-feed'); if (tf) tf.innerHTML = '';
            // Restore feed UI
            document.getElementById('feed').style.display = '';
            var ff = document.getElementById('feed-type-filter'); if (ff) ff.style.display = '';
            if (UI.currentTab === 'search') {
                var sp = document.getElementById('panel-search'); if (sp) sp.style.display = '';
            }
        },

        openById: function(id, noPush) {
            // Accept note1... bech32 or raw hex
            if (id.indexOf('note') === 0) id = noteDecode(id);
            if (!id || id.length !== 64) return;
            var self = this;
            var tmpSubId = Pool.subscribe(
                [{ ids: [id], kinds: [1] }],
                function(ev) {
                    Pool.unsubscribe(tmpSubId);
                    if (!noPush) history.pushState({ noxtr: 'thread', noteId: ev.id }, '');
                    self.open(ev);
                },
                function() {
                    // EOSE without receiving the note — show not found
                    if (!self.active) {
                        Pool.unsubscribe(tmpSubId);
                        self.active = true;
                        var tf = document.getElementById('thread-feed');
                        var msg = Api.lang === 'es' ? 'Nota no encontrada en los relays conectados.' : 'Note not found on connected relays.';
                        if (tf) tf.innerHTML = '<div class="noxtr-empty">' + msg + '<br><a class="btn btn-sm noxtr-empty-action" onclick="Noxtr.Threads.close();Noxtr.UI.switchTab(Noxtr.UI.currentTab)">' + (Api.lang === 'es' ? 'Cerrar' : 'Close') + '</a></div>';
                        document.getElementById('thread-view').style.display = '';
                        document.getElementById('feed').style.display = 'none';
                        document.getElementById('feed-new').style.display = 'none';
                        var comp = document.getElementById('compose-area'); if (comp) comp.style.display = 'none';
                        document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
                    }
                }
            );
        }
    };

    // ==================== SEARCH (NIP-50) ====================

    var NIP50_RELAYS = ['wss://search.nos.today', 'wss://nostr.wine', 'wss://relay.nostr.band'];

    var Search = {
        query: '',
        _ws: null,
        _subId: null,
        _eoseTimer: null,
        _relayIdx: 0,

        search: function(q) {
            q = (q || '').trim();
            if (!q) return;

            // Strip nostr: prefix if present
            var raw = q.indexOf('nostr:') === 0 ? q.slice(6) : q;

            // Detect npub/nprofile → show author's notes
            var pk = null;
            if (raw.indexOf('npub1') === 0) pk = npubDecode(raw);
            else if (raw.indexOf('nprofile1') === 0) { var np = nprofileDecode(raw); if (np) pk = np.pubkey; }
            if (pk) { this.searchByAuthor(pk); return; }

            // Detect @username → search profiles (kind 0)
            if (raw[0] === '@' && raw.length > 1) { this.searchProfiles(raw.slice(1)); return; }

            // Detect note/nevent → open thread
            var noteId = null;
            if (raw.indexOf('note1') === 0) noteId = noteDecode(raw);
            else if (raw.indexOf('nevent1') === 0) { var ne = neventDecode(raw); if (ne) noteId = ne.id; }
            if (noteId) { Threads.openById(noteId); return; }

            // Normal NIP-50 text search
            this.query = q;
            this._relayIdx = 0;
            Feed.clear();
            if (Feed.loading) { Feed.loading.style.display = ''; Feed.loading.textContent = (Api.lang === 'es' ? 'Buscando...' : 'Searching...'); }
            this._try(q);
        },

        _try: function(q) {
            this._closeWs();
            if (this._relayIdx >= NIP50_RELAYS.length) {
                // All search relays failed — show hint
                if (!Feed.notes.length && Feed.container) {
                    Feed.container.innerHTML = '<div class="noxtr-empty">' +
                        (Api.lang === 'es' ? 'No se pudo conectar a ningún relay de búsqueda (NIP-50).' : 'Could not connect to any search relay (NIP-50).') +
                        '<br><small class="noxtr-search-hint">' + (Api.lang === 'es'
                            ? 'Los relays de búsqueda pueden estar temporalmente caídos. Inténtalo más tarde.'
                            : 'Search relays may be temporarily down. Try again later.')
                        + '</small></div>';
                }
                if (Feed.loading) Feed.loading.style.display = 'none';
                return;
            }

            var url = NIP50_RELAYS[this._relayIdx];
            var self = this;
            var subId = 'search_' + randomId();
            this._subId = subId;

            // Timeout: 5s per relay
            this._eoseTimer = setTimeout(function() {
                console.warn('[Search] Timeout on ' + url);
                self._relayIdx++;
                self._try(q);
            }, 5000);

            var ws;
            try { ws = new WebSocket(url); } catch(e) {
                clearTimeout(this._eoseTimer);
                this._relayIdx++;
                this._try(q);
                return;
            }
            this._ws = ws;

            ws.onopen = function() {
                ws.send(JSON.stringify(['REQ', subId, { kinds: [1, 30023], search: q, limit: 40 }]));
            };
            ws.onmessage = function(e) {
                try {
                    var msg = JSON.parse(e.data);
                    if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
                        Feed.addNote(msg[2]);
                    } else if (msg[0] === 'EOSE' && msg[1] === subId) {
                        clearTimeout(self._eoseTimer);
                        Feed._onEose();
                        if (!Feed.notes.length && Feed.container) {
                            Feed.container.innerHTML = '<div class="noxtr-empty">' +
                                (Api.lang === 'es' ? 'Sin resultados para "' + escapeHtml(q) + '".' : 'No results for "' + escapeHtml(q) + '".') +
                                '<br><small class="noxtr-search-hint">' + (Api.lang === 'es'
                                    ? 'Consejo: asegúrate de tener un relay con soporte NIP-50 (ej. <strong>relay.nostr.band</strong>) en tu lista de Relays.'
                                    : 'Tip: make sure you have a NIP-50 capable relay (e.g. <strong>relay.nostr.band</strong>) in your Relays list.')
                                + '</small></div>';
                        }
                        if (Feed.loading) Feed.loading.style.display = 'none';
                    }
                } catch(er) {}
            };
            ws.onerror = function() {
                clearTimeout(self._eoseTimer);
                self._relayIdx++;
                self._try(q);
            };
            ws.onclose = function() { self._ws = null; };
        },

        _closeWs: function() {
            clearTimeout(this._eoseTimer);
            if (this._ws) { try { this._ws.close(); } catch(e) {} this._ws = null; }
            this._subId = null;
        },

        searchByAuthor: function(pk) {
            this._closeWs();
            this.query = '';
            Profiles.request(pk);
            Feed.clear();
            if (Feed.loading) { Feed.loading.style.display = ''; Feed.loading.textContent = '@' + Profiles.displayName(pk); }
            Feed.subscribeAuthors([pk]);
        },

        searchProfiles: function(name) {
            this._closeWs();
            this.query = '@' + name;
            Feed.clear();
            var isEs = Api.lang === 'es';
            if (Feed.loading) { Feed.loading.style.display = ''; Feed.loading.textContent = isEs ? 'Buscando perfiles...' : 'Searching profiles...'; }
            this._relayIdx = 0;
            this._profileResults = [];
            this._tryProfiles(name);
        },

        _tryProfiles: function(name) {
            this._closeWs();
            if (this._relayIdx >= NIP50_RELAYS.length) {
                this._renderProfileResults(name);
                return;
            }
            var url = NIP50_RELAYS[this._relayIdx];
            var self = this;
            var subId = 'psearch_' + randomId();
            this._subId = subId;

            this._eoseTimer = setTimeout(function() {
                self._relayIdx++;
                self._tryProfiles(name);
            }, 5000);

            var ws;
            try { ws = new WebSocket(url); } catch(e) {
                clearTimeout(this._eoseTimer);
                this._relayIdx++;
                this._tryProfiles(name);
                return;
            }
            this._ws = ws;

            ws.onopen = function() {
                ws.send(JSON.stringify(['REQ', subId, { kinds: [0], search: name, limit: 30 }]));
            };
            ws.onmessage = function(e) {
                try {
                    var msg = JSON.parse(e.data);
                    if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
                        var ev = msg[2];
                        try {
                            var p = JSON.parse(ev.content);
                            // Deduplicate by pubkey
                            var exists = self._profileResults.some(function(r) { return r.pubkey === ev.pubkey; });
                            if (!exists) {
                                self._profileResults.push({
                                    pubkey: ev.pubkey,
                                    name: p.display_name || p.name || '',
                                    picture: p.picture || '',
                                    about: p.about || '',
                                    nip05: p.nip05 || ''
                                });
                            }
                            // Store in Profiles cache
                            Profiles._handle(ev);
                        } catch(pe) {}
                    } else if (msg[0] === 'EOSE' && msg[1] === subId) {
                        clearTimeout(self._eoseTimer);
                        self._renderProfileResults(name);
                    }
                } catch(er) {}
            };
            ws.onerror = function() {
                clearTimeout(self._eoseTimer);
                self._relayIdx++;
                self._tryProfiles(name);
            };
            ws.onclose = function() { self._ws = null; };
        },

        _renderProfileResults: function(name) {
            if (Feed.loading) Feed.loading.style.display = 'none';
            if (!Feed.container) return;
            var isEs = Api.lang === 'es';
            var results = this._profileResults;
            if (!results.length) {
                Feed.container.innerHTML = '<div class="noxtr-empty">' +
                    (isEs ? 'No se encontraron perfiles para "' + escapeHtml(name) + '".' : 'No profiles found for "' + escapeHtml(name) + '".') + '</div>';
                return;
            }
            var html = '';
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var col = Profiles.color(r.pubkey);
                var avHtml = r.picture
                    ? '<img class="profile-result-avatar profile-result-avatar-img" src="'+escapeHtml(r.picture)+'">'
                    : '<div class="profile-result-avatar profile-result-avatar-letter" style="background:'+col+';">'+((r.name||'?')[0]||'?').toUpperCase()+'</div>';
                var displayName = r.name || shortKey(npubEncode(r.pubkey));
                var aboutTxt = r.about ? r.about.substring(0, 100) + (r.about.length > 100 ? '...' : '') : '';
                html += '<div class="note profile-result" data-pubkey="'+r.pubkey+'">' +
                    avHtml +
                    '<div class="profile-result-body">' +
                    '<div class="profile-result-name">'+escapeHtml(displayName)+'</div>' +
                    (r.nip05 ? '<div class="profile-result-nip05">'+escapeHtml(r.nip05)+'</div>' : '') +
                    (aboutTxt ? '<div class="profile-result-about">'+escapeHtml(aboutTxt)+'</div>' : '') +
                    '</div></div>';
            }
            Feed.container.innerHTML = html;

            // Click → view notes of that profile
            Feed.container.onclick = function(e) {
                var row = e.target.closest('.profile-result');
                if (!row) return;
                var pk = row.dataset.pubkey;
                document.getElementById('search-input').value = npubEncode(pk);
                Search.searchByAuthor(pk);
            };
        },

        clear: function() {
            this._closeWs();
            this.query = '';
        }
    };

    // ==================== FEED ====================

    var Feed = {
        notes: [], seen: {}, byAddr: {}, container: null, loading: null, subId: null, maxNotes: 200,
        buffered: [], eoseReached: false, bannerEl: null, _hotSubId: null, _feedFilter: 'all', _autoFlushed: false, _eoseTimeout: null,
        init: function(c, l) { this.container = c; this.loading = l; this.bannerEl = document.getElementById('feed-new'); var self = this; if (this.bannerEl) this.bannerEl.onclick = function() { self.flushBuffer(); }; },
        addNote: function(ev) {
            if (ev.kind !== 1 && ev.kind !== 30023) return;
            // Replaceable event logic for kind 30023 (NIP-23 articles)
            if (ev.kind === 30023) {
                var dTag = ''; for (var ti = 0; ti < ev.tags.length; ti++) { if (ev.tags[ti][0] === 'd') { dTag = ev.tags[ti][1] || ''; break; } }
                var addrKey = ev.pubkey + ':' + dTag;
                if (this.byAddr[addrKey]) {
                    var existing = this.byAddr[addrKey];
                    if (ev.created_at <= existing.created_at) return;
                    // Remove old version
                    delete this.seen[existing.id];
                    var oldEl = document.getElementById('note-' + existing.id);
                    if (oldEl) oldEl.remove();
                    this.notes = this.notes.filter(function(n) { return n.id !== existing.id; });
                }
                this.byAddr[addrKey] = ev;
            }
            if (this.seen[ev.id]) return;
            this.seen[ev.id] = true;
            Profiles.request(ev.pubkey);
            // After initial load, buffer new notes instead of inserting directly
            if (this.eoseReached) { this.buffered.push(ev); this._updateBanner(); return; }
            this._insertNote(ev);
            if (this.loading) this.loading.style.display = 'none';
        },
        _insertNote: function(ev) {
            var idx = 0;
            for (var i = 0; i < this.notes.length; i++) { if (this.notes[i].created_at < ev.created_at) { idx = i; break; } idx = i + 1; }
            this.notes.splice(idx, 0, ev);
            if (this.notes.length > this.maxNotes) { var rm = this.notes.pop(); delete this.seen[rm.id]; var lc = this.container.lastElementChild; if (lc) lc.remove(); }
            this._updateFilterCounts();
            // Skip DOM insert if filtered out
            if (this._feedFilter === 'notes' && ev.kind === 30023) return;
            if (this._feedFilter === 'reads' && ev.kind !== 30023) return;
            var el = this.renderNote(ev);
            // Count visible DOM children for correct position (notes array may have filtered items)
            var visIdx = 0;
            for (var j = 0; j < idx; j++) {
                var n = this.notes[j];
                if (this._feedFilter === 'notes' && n.kind === 30023) continue;
                if (this._feedFilter === 'reads' && n.kind !== 30023) continue;
                visIdx++;
            }
            if (visIdx === 0) this.container.prepend(el);
            else if (visIdx >= this.container.children.length) this.container.appendChild(el);
            else this.container.insertBefore(el, this.container.children[visIdx]);
        },
        _updateBanner: function() {
            if (!this.bannerEl) return;
            var n = this.buffered.length;
            if (n > 0 && !Threads.active) {
                if (!this._autoFlushed) { this._autoFlushed = true; this.flushBuffer(); return; }
                var bNotes = 0, bReads = 0;
                for (var bi = 0; bi < this.buffered.length; bi++) { if (this.buffered[bi].kind === 30023) bReads++; else bNotes++; }
                var parts = [];
                if (bNotes) parts.push(bNotes + ' note' + (bNotes > 1 ? 's' : ''));
                if (bReads) parts.push(bReads + ' read' + (bReads > 1 ? 's' : ''));
                this.bannerEl.textContent = parts.join(' + ') + ' — click to load';
                this.bannerEl.style.display = '';
            }
            else { this.bannerEl.style.display = 'none'; }
        },
        flushBuffer: function() {
            // Remove fresh highlight from previous batch
            this.container.querySelectorAll('.note-fresh').forEach(function(n) { n.classList.remove('note-fresh'); });
            var ids = this.buffered.map(function(ev) { return ev.id; });
            for (var i = 0; i < this.buffered.length; i++) this._insertNote(this.buffered[i]);
            this.buffered = []; this._updateBanner();
            if (this.container) this.container.scrollTop = 0;
            // Mark new notes
            for (var j = 0; j < ids.length; j++) {
                var el = document.getElementById('note-' + ids[j]);
                if (el) el.classList.add('note-fresh');
            }
        },
        renderNote: function(ev) {
            if (Muted.has(ev.pubkey)) { var m = document.createElement('div'); m.className = 'note-muted'; m.dataset.id = ev.id; m.innerHTML = '&#x1f648; Muted user'; return m; }
            // AR Profile card detection
            var arProfile = _parseArProfile(ev.content);
            if (arProfile) return _renderArProfileCard(ev, arProfile);
            var name = Profiles.displayName(ev.pubkey), npub = npubEncode(ev.pubkey);
            var av = Profiles.avatar(ev.pubkey), col = Profiles.color(ev.pubkey);
            var ini = (name[0]||'?').toUpperCase();
            var isReply = ev.tags.some(function(t) { return t[0] === 'e'; });
            var isFollowed = Contacts.isFollowing(ev.pubkey);
            var isBookmarked = Bookmarks.has(ev.id);
            var isOwn = ev.pubkey === Events.pubkey;
            var isArticle = ev.kind === 30023;
            var el = document.createElement('div');
            el.className = 'note' + (isReply && !isArticle ? ' note-is-reply' : '') + (isArticle ? ' note-article' : ''); el.id = 'note-' + ev.id; el.dataset.id = ev.id; el.dataset.pubkey = ev.pubkey;
            var avOk = av && !DeadDomains.isDead(DeadDomains.domainOf(av));
            // Article-specific content block
            var contentHtml;
            if (isArticle) {
                var meta = Articles._meta(ev);
                var tagsHtml = '';
                if (meta.hashtags.length) { tagsHtml = '<div class="article-inline-tags">'; for (var hi = 0; hi < meta.hashtags.length; hi++) tagsHtml += '<span class="article-tag">#' + escapeHtml(meta.hashtags[hi]) + '</span>'; tagsHtml += '</div>'; }
                contentHtml =
                    (meta.image ? '<div class="article-inline-image"><img class="open_file_image" src="'+escapeHtml(meta.image)+'" loading="lazy" onerror="_mediaError(this);this.parentNode.style.display=\'none\'"></div>' : '') +
                    '<h3 class="article-inline-title">'+escapeHtml(meta.title)+'</h3>' +
                    '<p class="article-inline-summary">'+escapeHtml(meta.summary)+'</p>' +
                    tagsHtml;
            } else {
                contentHtml =
                    (isReply ? '<div class="note-replying">reply</div>' : '') +
                    '<div class="note-text">'+parseContent(ev.content)+'</div>';
            }
            el.innerHTML =
                '<div class="note-avatar" style="background:'+col+'" data-pubkey="'+ev.pubkey+'">'+(avOk ? '<img src="'+escapeHtml(av)+'" loading="lazy" onerror="_mediaError(this);this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="avatar-letter" style="display:none">'+ini+'</span>' : '<span class="avatar-letter">'+ini+'</span>')+'</div>' +
                '<div class="note-body">' +
                    '<div class="note-header">' +
                        '<strong class="note-name" data-pubkey="'+ev.pubkey+'" title="'+npub+'">'+escapeHtml(name)+'</strong>' +
                        '<span class="note-npub">'+shortKey(npub)+'</span>' +
                        '<span class="note-time" title="'+new Date(ev.created_at*1000).toLocaleString()+'">'+timeAgo(ev.created_at)+'</span>' +
                        (isArticle ? '<span class="note-badge-read">Read</span>' : '') +
                    '</div>' +
                    contentHtml +
                    '<div class="note-actions">' +
                        '<a class="note-action action-reply" data-action="reply" data-id="'+ev.id+'" title="Reply"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><span class="count-replies"></span></a>' +
                        '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Like"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
                        '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Repost"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
                        '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Zap"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
                        '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="Bookmark"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
                        '<a class="note-action'+(isFollowed?' followed':'')+' action-follow" data-action="follow" data-pubkey="'+ev.pubkey+'" title="'+(isFollowed?'Unfollow':'Follow')+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/>'+(isFollowed?'':'<line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>')+'</svg></a>' +
                        '<a class="note-action action-dm" data-action="dm" data-pubkey="'+ev.pubkey+'" title="Message"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></a>' +
                        '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="Share"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                        (!isOwn ? '<a class="note-action action-mute" data-action="mute" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="Mute / Report"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></a>' : '') +
                        (isOwn ? '<a class="note-action note-action-delete" data-action="delete" data-id="'+ev.id+'" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '') +
                    '</div></div>';
            return el;
        },
        updateProfile: function(pk) {
            var nodes = this.container.querySelectorAll('.note[data-pubkey="'+pk+'"]');
            if (!nodes.length) return;
            var name = Profiles.displayName(pk), av = Profiles.avatar(pk);
            for (var i = 0; i < nodes.length; i++) {
                var ne = nodes[i].querySelector('.note-name'); if (ne) ne.textContent = name;
                if (av && !DeadDomains.isDead(DeadDomains.domainOf(av))) { var ad = nodes[i].querySelector('.note-avatar'), img = ad.querySelector('img');
                    if (!img) { img = document.createElement('img'); img.loading = 'lazy'; img.onerror = function() { _mediaError(this); this.style.display = 'none'; }; ad.prepend(img); }
                    img.src = av; img.style.display = '';
                }
            }
        },
        _onEose: function() {
            if (this._eoseTimeout) return; // already scheduled, let it fire
            if (this.loading) this.loading.textContent = '';
            // Delay eoseReached so all relays finish sending historical notes before buffering starts
            var self = this;
            this._eoseTimeout = setTimeout(function() {
                self._eoseTimeout = null;
                self.eoseReached = true;
                var ids = self.notes.map(function(n) { return n.id; });
                if (ids.length) Stats.subscribe(ids);
            }, 800);
        },
        subscribeGlobal: function() { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 30023], limit: 30 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        subscribeHot: function() {
            if (this.subId) Pool.unsubscribe(this.subId); this.subId = null;
            if (this._hotSubId) { Pool.unsubscribe(this._hotSubId); this._hotSubId = null; }
            var self = this;
            var eoseTimer = null;

            if (this.loading) { this.loading.style.display = ''; this.loading.textContent = Api.lang === 'es' ? '🔥 Buscando trending...' : '🔥 Finding trending...'; }

            // REVERSED STRATEGY: First find engagement, then load those notes
            // Step 1: Fetch recent reactions & reposts (last 24h) to discover which notes are popular
            var since24h = Math.floor(Date.now() / 1000) - 86400;
            var engagementMap = {}; // { noteId: { likes, replies, reposts } }
            var reactionSeen = {};

            this.subId = Pool.subscribe(
                [{ kinds: [7], since: since24h, limit: 2000 },
                 { kinds: [6], since: since24h, limit: 500 }],
                function(ev) {
                    if (reactionSeen[ev.id]) return;
                    reactionSeen[ev.id] = true;
                    var eTag = ev.tags.find(function(t) { return t[0] === 'e'; });
                    if (!eTag) return;
                    var nid = eTag[1];
                    if (!engagementMap[nid]) engagementMap[nid] = { likes: 0, replies: 0, reposts: 0 };
                    if (ev.kind === 7) engagementMap[nid].likes++;
                    else if (ev.kind === 6) engagementMap[nid].reposts++;
                },
                function() {
                    // EOSE — debounce to wait for all relays (fires per relay)
                    clearTimeout(eoseTimer);
                    eoseTimer = setTimeout(function() {
                        Pool.unsubscribe(self.subId); self.subId = null;

                        // Pre-populate Stats._seen with reaction events to prevent double-counting
                        Object.keys(reactionSeen).forEach(function(id) { Stats._seen[id] = true; });

                        // Rank note IDs by engagement score
                        var ranked = Object.keys(engagementMap).map(function(nid) {
                            var e = engagementMap[nid];
                            return { id: nid, score: e.likes + e.replies * 3 + e.reposts * 5, stats: e };
                        }).sort(function(a, b) { return b.score - a.score; });

                        // Keep top 50 most engaged
                        ranked = ranked.filter(function(r) { return r.score >= 2; });
                        if (ranked.length > 50) ranked = ranked.slice(0, 50);

                        if (!ranked.length) {
                            if (self.container) self.container.innerHTML = '<div class="noxtr-empty">' +
                                (Api.lang === 'es' ? '🔥 No hay notas trending en las últimas 24h. Prueba más tarde.' : '🔥 No trending notes in the last 24h. Try again later.') + '</div>';
                            if (self.loading) { self.loading.textContent = ''; self.loading.style.display = 'none'; }
                            return;
                        }

                        if (self.loading) self.loading.textContent = Api.lang === 'es' ? 'Cargando notas populares...' : 'Loading popular notes...';

                        // Pre-populate Stats with engagement data we already collected
                        ranked.forEach(function(r) {
                            Stats._ensure(r.id);
                            Stats.counts[r.id].likes = r.stats.likes;
                            Stats.counts[r.id].reposts = r.stats.reposts;
                        });

                        // Step 2: Fetch the actual note content for these popular notes
                        var hotIds = ranked.map(function(r) { return r.id; });
                        var fetchedNotes = {}, noteTimer = null;
                        self._hotSubId = Pool.subscribe(
                            [{ kinds: [1, 30023], ids: hotIds }],
                            function(ev) {
                                if (fetchedNotes[ev.id]) return;
                                fetchedNotes[ev.id] = ev;
                                Profiles.request(ev.pubkey);
                            },
                            function() {
                                // EOSE per relay — debounce render
                                clearTimeout(noteTimer);
                                noteTimer = setTimeout(function() {
                                    if (self._hotSubId) { Pool.unsubscribe(self._hotSubId); self._hotSubId = null; }

                                    var now = Math.floor(Date.now() / 1000);

                                    // Build sorted list using HN-style time decay
                                    var hotNotes = ranked
                                        .filter(function(r) { return fetchedNotes[r.id]; })
                                        .map(function(r) {
                                            var note = fetchedNotes[r.id];
                                            var ageHours = Math.max(0, (now - note.created_at)) / 3600;
                                            var gravity = Math.pow(ageHours + 2, 1.5);
                                            return { note: note, hotScore: (r.score * 1000) / gravity };
                                        })
                                        .sort(function(a, b) { return b.hotScore - a.hotScore; })
                                        .slice(0, 30);

                                    // Store in Feed.notes for thread navigation etc
                                    self.notes = hotNotes.map(function(h) { return h.note; });
                                    hotNotes.forEach(function(h) { self.seen[h.note.id] = true; });
                                    self.eoseReached = true;
                                    self.buffered = []; self._updateBanner();

                                    if (self.container) {
                                        self.container.innerHTML = '';
                                        hotNotes.forEach(function(h) {
                                            self.container.appendChild(self.renderNote(h.note));
                                            Stats._updateDom(h.note.id);
                                        });
                                    }

                                    // Subscribe for live stats updates (replies, new likes/reposts)
                                    var liveIds = hotNotes.map(function(h) { return h.note.id; });
                                    if (liveIds.length) Stats.subscribe(liveIds);

                                    if (self.loading) { self.loading.textContent = ''; self.loading.style.display = 'none'; }
                                }, 1500);
                            }
                        );
                    }, 2000);
                }
            );
        },
        subscribeAuthors: function(pks) { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 30023], authors: pks, limit: 30 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        subscribeTopics: function(topics) { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 30023], '#t': topics, limit: 30 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        clear: function() { if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; } if (this._hotSubId) { Pool.unsubscribe(this._hotSubId); this._hotSubId = null; } if (this._eoseTimeout) { clearTimeout(this._eoseTimeout); this._eoseTimeout = null; } Stats.clear(); this.notes = []; this.seen = {}; this.byAddr = {}; this.buffered = []; this.eoseReached = false; this._autoFlushed = false; this._updateBanner(); this._updateFilterCounts(); if (this.container) this.container.innerHTML = ''; if (this.loading) { this.loading.style.display = ''; this.loading.textContent = 'Loading...'; } },
        applyFilter: function(filter) {
            this._feedFilter = filter;
            if (!this.container) return;
            this.container.innerHTML = '';
            for (var i = 0; i < this.notes.length; i++) {
                var ev = this.notes[i];
                if (filter === 'notes' && ev.kind === 30023) continue;
                if (filter === 'reads' && ev.kind !== 30023) continue;
                var el = this.renderNote(ev);
                this.container.appendChild(el);
            }
        },
        _updateFilterCounts: function() {
            var notes = 0, reads = 0;
            for (var i = 0; i < this.notes.length; i++) {
                if (this.notes[i].kind === 30023) reads++; else notes++;
            }
            var cAll = document.getElementById('filter-count-all');
            var cNotes = document.getElementById('filter-count-notes');
            var cReads = document.getElementById('filter-count-reads');
            if (cAll) cAll.textContent = notes + reads;
            if (cNotes) cNotes.textContent = notes;
            if (cReads) cReads.textContent = reads;
        }
    };

    // ==================== UI ====================

    var UI = {
        replyingTo: null, currentTab: 'global',

        init: function() {
            var self = this;
            Profiles.onUpdate = function(pk) {
                Feed.updateProfile(pk); if (pk === Events.pubkey) self.updateIdentity();
                // Update names in side panels (following + followers)
                var name = Profiles.displayName(pk);
                document.querySelectorAll('.contact-toggle[data-pubkey="'+pk+'"], .follower-toggle[data-pubkey="'+pk+'"]').forEach(function(el) { el.textContent = name; });
                if (ProfileView.active && ProfileView.pubkey === pk) ProfileView._renderStrip(pk);
                else if (!ProfileView.active && pk === Events.pubkey) ProfileView.renderOwn();
                // Update DM thread name if this peer's thread is open
                if (DMs.currentPeer === pk) {
                    var nameEl = document.getElementById('dm-thread-name');
                    if (nameEl) nameEl.textContent = name;
                }
            };



            // Info panel
            
            var infoKey = 'noxtr_info_hide' + (Api.userId ? '_' + Api.userId : '');
            /*
            var btnInfo = document.getElementById('btn-info'), infoPanel = document.getElementById('info-panel');
            if (btnInfo) btnInfo.onclick = function() {
                infoPanel.style.display = infoPanel.style.display === 'none' ? '' : 'none'; 
            };

            // Show by default unless user checked "don't show again"
            if (!localStorage.getItem(infoKey)) { infoPanel.style.display = ''; }
            var chkDismiss = document.getElementById('chk-info-dismiss');
            if (chkDismiss) chkDismiss.onchange = function() {
                if (this.checked) { localStorage.setItem(infoKey, '1'); infoPanel.style.display = 'none'; }
                else { localStorage.removeItem(infoKey); }
            };
            var btnDismiss = document.getElementById('btn-info-dismiss');
            if (btnDismiss) btnDismiss.onclick = function() { infoPanel.style.display = 'none'; };
            */             


            $('#btn-info').click( function() {
                $("body").dialog({
                    title: "🔧 Información",
                    type: 'html',
                    width: "800px",
                    height: "90%",
                    content: '#info-panel',
                    openAnimation: 'slide-up',
                    closeAnimation: 'slide-down',
                //  buttons: [$.dialog.closeButton]
                    buttons: [
                        $.dialog.closeButton,
                        {
                            text: str_not_show_again,
                            class: 'btn ', 
                            action: function(event, overlay) { 
                                localStorage.setItem(infoKey, '1');
                                document.body.removeChild(overlay);  
                            } 
                        },
                    ],                    
                });
            });

            if (!localStorage.getItem(infoKey) && location.pathname.replace(/\/$/, '') === '/noxtr') { $('#btn-info').click(); }


            // Relay button → switch to relays tab
            var btnRelays = document.getElementById('btn-relays');
            if (btnRelays) btnRelays.onclick = function() { self.switchTab(self.currentTab === 'relays' ? 'topics' : 'relays', true); };

            // Add relay
            var btnAddR = document.getElementById('btn-add-relay'), relayIn = document.getElementById('relay-input');
            if (btnAddR) btnAddR.onclick = async function() {
                var u = relayIn.value.trim();
                if (u && u.indexOf('wss://') === 0) {
                    await Relays.add(u);
                    relayIn.value = '';
                    Relays.render();
                }
            };
            if (relayIn) relayIn.onkeydown = function(e) { if (e.key === 'Enter') btnAddR.onclick(); };

            // Formatting toolbar
            document.querySelectorAll('.compose-fmt').forEach(function(btn) {
                btn.onclick = function() {
                    var ta = document.getElementById('compose-text'); if (!ta) return;
                    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.substring(s, e);
                    var fmt = btn.dataset.fmt, before = '', after = '', newline = false;
                    if (fmt === 'bold')       { before = '**'; after = '**'; }
                    else if (fmt === 'italic') { before = '*'; after = '*'; }
                    else if (fmt === 'code')   { if (sel.indexOf('\n') > -1) { before = '```\n'; after = '\n```'; } else { before = '`'; after = '`'; } }
                    else if (fmt === 'h1')     { before = '# '; newline = true; }
                    else if (fmt === 'h2')     { before = '## '; newline = true; }
                    else if (fmt === 'link')   { before = '['; after = '](url)'; }
                    else if (fmt === 'video')  { return; } // handled separately below
                    // Insert newline before if needed (heading at start of line)
                    if (newline && s > 0 && v[s - 1] !== '\n') before = '\n' + before;
                    var text = sel || (fmt === 'link' ? 'text' : 'text');
                    ta.value = v.substring(0, s) + before + text + after + v.substring(e);
                    var cursorPos = s + before.length + text.length + (sel ? after.length : 0);
                    if (!sel) { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + text.length; }
                    else { ta.selectionStart = ta.selectionEnd = cursorPos; }
                    ta.focus();
                };
            });

            // Video embed button (prompt is async in wquery)
            var videoBtn = document.querySelector('.compose-fmt[data-fmt="video"]');
            if (videoBtn) videoBtn.onclick = async function() {
                var ta = document.getElementById('compose-text'); if (!ta) return;
                var url = await window.prompt('URL del video (YouTube, Vimeo, .mp4...):');
                if (!url || !(url = url.trim())) return;
                var s = ta.selectionStart, v = ta.value;
                var before = (s > 0 && v[s - 1] !== '\n') ? '\n' : '';
                ta.value = v.substring(0, s) + before + url + v.substring(s);
                ta.selectionStart = ta.selectionEnd = s + before.length + url.length;
                ta.focus();
            };

            // Image attach
            var imgInput = document.getElementById('compose-image-input');
            var imgBtn = document.getElementById('btn-attach-image');
            var imgPreview = document.getElementById('compose-image-preview');
            if (imgBtn) imgBtn.onclick = function() { imgInput.click(); };
            if (imgInput) imgInput.onchange = function() {
                var file = this.files[0]; if (!file) return;
                if (!file.type.match(/^image\/(jpeg|png|gif|webp)$/)) { alert(Api.lang === 'es' ? 'Formato no soportado. Usa JPG, PNG, GIF o WebP.' : 'Unsupported format. Use JPG, PNG, GIF or WebP.'); this.value = ''; return; }
                if (file.size > 5 * 1024 * 1024) { alert(Api.lang === 'es' ? 'Imagen demasiado grande (max 5MB)' : 'Image too large (max 5MB)'); this.value = ''; return; }
                var reader = new FileReader();
                reader.onload = function(e) {
                    imgPreview.innerHTML = '<div class="compose-preview-wrap"><img src="' + e.target.result + '"><a class="compose-preview-remove">&times;</a></div>';
                    imgPreview.style.display = '';
                    imgPreview.querySelector('.compose-preview-remove').onclick = function() {
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = '';
                    };
                };
                reader.readAsDataURL(file);
            };

            // Publish
            var btnPub = document.getElementById('btn-publish'), compTxt = document.getElementById('compose-text');
            var compTagsInput = document.getElementById('compose-tags');
            if (btnPub) btnPub.onclick = async function() {
                var text = compTxt.value.trim();
                var hasImage = imgInput && imgInput.files && imgInput.files.length > 0;
                var isArticle = self._composeMode === 'article';

                if (isArticle) {
                    var artTitle = (document.getElementById('article-title').value || '').trim();
                    if (!artTitle) { alert(Api.lang === 'es' ? 'El título es obligatorio' : 'Title is required'); return; }
                    if (!text) { alert(Api.lang === 'es' ? 'El contenido es obligatorio' : 'Content is required'); return; }
                } else {
                    if (!text && !hasImage) return;
                }
                if (!Events.canSign()) { alert('Need NIP-07 extension or nsec to publish.'); return; }

                // Parse extra tags from compose-tags input
                var extraTags = [];
                if (compTagsInput && compTagsInput.value.trim()) {
                    compTagsInput.value.split(',').forEach(function(t) {
                        t = t.trim().replace(/^#/, '').toLowerCase();
                        if (t) extraTags.push(t);
                    });
                }

                try {
                    btnPub.textContent = '...'; btnPub.style.pointerEvents = 'none';

                    // Upload image if attached
                    var uploadedUrl = '';
                    if (hasImage) {
                        btnPub.textContent = 'Uploading...';
                        var formData = new FormData();
                        formData.append('image', imgInput.files[0]);
                        formData.append('action', 'upload_image');
                        if (Api.csrfToken) formData.append('csrf_token', Api.csrfToken);
                        var upResp = await fetch(Api.url, { method: 'POST', body: formData });
                        var upData = await upResp.json();
                        if (upData.error) throw new Error(upData.msg || 'Upload failed');
                        uploadedUrl = upData.url;
                    }

                    btnPub.textContent = 'Publishing...';

                    if (isArticle) {
                        var artSummary = (document.getElementById('article-summary').value || '').trim();
                        var artImage = (document.getElementById('article-image').value || '').trim() || uploadedUrl;
                        var artDtag = (document.getElementById('article-dtag').value || '').trim();
                        var published = await Articles.publishArticle(artTitle, artSummary, text, artImage, extraTags, artDtag);
                        // Insert locally into feed
                        Feed.addNote(published);
                        // Clear fields
                        compTxt.value = '';
                        document.getElementById('article-title').value = '';
                        document.getElementById('article-summary').value = '';
                        document.getElementById('article-image').value = '';
                        document.getElementById('article-dtag').value = '';
                        if (compTagsInput) compTagsInput.value = '';
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = '';
                    } else {
                        if (uploadedUrl) text = (text ? text + '\n' : '') + uploadedUrl;
                        // Add extra tags to the note via Events.publish
                        var published = await Events.publish(text, self.replyingTo, extraTags);
                        // Clear empty message if present, then insert note locally
                        var emptyMsg = Feed.container.querySelector('.noxtr-empty'); if (emptyMsg) emptyMsg.remove();
                        Profiles.request(published.pubkey);
                        Feed._insertNote(published);
                        if (Feed.loading) Feed.loading.style.display = 'none';
                        compTxt.value = ''; self.cancelReply();
                        if (compTagsInput) compTagsInput.value = '';
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = '';
                    }
                }
                catch(e) { alert('Error: ' + e.message); }
                finally { btnPub.textContent = 'Publish'; btnPub.style.pointerEvents = ''; }
            };
            if (compTxt) compTxt.onkeydown = function(e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btnPub.onclick(); };

            // nsec / npub login (or logout when data-mode="logout")
            var btnNsec = document.getElementById('btn-nsec-login'), nsecIn = document.getElementById('nsec-input');
            if (btnNsec) btnNsec.onclick = function() {
                if (btnNsec.dataset.mode === 'logout') {
                    Events.pubkey = null; Events.privkey = null;
                    Contacts.list = []; updateBadge('badge-following', 0); updateBadge('badge-followers', 0);
                    localStorage.removeItem('noxtr_npub');
                    self.updateIdentity(); self.switchTab('topics');
                    return;
                }
                var v = nsecIn.value.trim(); if (!v) return;
                try {
                    if (v.indexOf('npub') === 0) {
                        // npub → read-only mode
                        sessionStorage.removeItem('noxtr_logged_out');
                        Events.setPubkey(v);
                        nsecIn.value = '';
                        localStorage.setItem('noxtr_npub', v);
                        self.updateIdentity();
                        Profiles.request(Events.pubkey);
                        loadContactsFromRelay();
                        Followers.subscribe();
                        // Retry profile fetch after relays deliver (ensures banner+avatar)
                        setTimeout(function() {
                            Profiles.pending[Events.pubkey] = true;
                            Profiles._schedule();
                        }, 1500);
                    } else {
                        // nsec → signing mode
                        sessionStorage.removeItem('noxtr_logged_out');
                        Events.setPrivkey(v); nsecIn.value = ''; document.getElementById('nsec-login').style.display = 'none'; self.updateIdentity();
                        if (Events.pubkey && Events.privkey) {
                            var npub = npubEncode(Events.pubkey);
                            if (Api.userId) {
                                // Already logged in: save keys to IndexedDB
                                try { saveKeysToIndexedDB(Api.userId, npub, v, Events.pubkey, Events.privkey); } catch(e2) {}
                            } else {
                                // Not logged in: save as guest, then auto-login via Nostr
                                try {
                                    var _req = indexedDB.open('JuxNostrKeys', 1);
                                    _req.onsuccess = function(e) {
                                        var _db = e.target.result;
                                        if (!_db.objectStoreNames.contains('keys')) { _db.close(); return; }
                                        var _tx = _db.transaction('keys', 'readwrite');
                                        _tx.objectStore('keys').put({ id: 'guest', userId: null, npub: npub, nsec: v, pubkeyHex: Events.pubkey, privkeyHex: Events.privkey, createdAt: new Date().toISOString(), createdOn: window.location.hostname });
                                        _tx.oncomplete = function() { _db.close(); };
                                    };
                                } catch(e3) {}
                                autoLoginNostr(); // will reload page on success
                                return;
                            }
                        }
                        // If a reply was pending, scroll to compose
                        if (self.replyingTo) {
                            var comp = document.getElementById('compose-area');
                            if (comp) { comp.style.display = ''; setTimeout(function() { comp.scrollIntoView({ behavior: 'smooth', block: 'center' }); compTxt.focus(); }, 100); }
                        }
                    }
                } catch(e) { alert('Invalid key: ' + e.message); }
            };

            // Load backup file → put nsec into the input field
            var backupLoginFile = document.getElementById('backup-login-file');
            if (backupLoginFile) backupLoginFile.onchange = async function() {
                var file = this.files[0]; if (!file) return;
                this.value = '';
                var isEs = Api.lang === 'es';
                var wrapper;
                try { wrapper = JSON.parse(await file.text()); } catch(e) {
                    alert((isEs ? 'Error al leer el backup: ' : 'Backup read error: ') + e.message);
                    return;
                }

                function _applyNsec(nsec) {
                    var inp = document.getElementById('nsec-input');
                    if (inp) { inp.value = nsec; inp.focus(); }
                }

                if (!wrapper.encrypted) {
                    var d = wrapper.data;
                    if (!d || !d.nsec) { alert(isEs ? 'El backup no contiene nsec.' : 'Backup has no nsec.'); return; }
                    _applyNsec(d.nsec);
                    return;
                }

                // Encrypted backup: show proper dialog instead of prompt()
                $("body").dialog({
                    title: isEs ? '🔒 Descifrar backup' : '🔒 Decrypt backup',
                    type: 'html',
                    width: '340px',
                    content: '<div class="backup-decrypt-dialog">'
                        + '<label class="backup-decrypt-label">'
                        + (isEs ? 'Contraseña del backup:' : 'Backup password:')
                        + '</label>'
                        + '<input type="password" id="backup-decrypt-pwd" class="backup-decrypt-input">'
                        + '</div>',
                    onLoad: function(dlg) {
                        var inp = document.getElementById('backup-decrypt-pwd');
                        if (!inp) return;
                        inp.focus();
                        inp.onkeydown = function(e) {
                            if (e.key === 'Enter') {
                                var ok = dlg.overlay.querySelector('.btn-primary');
                                if (ok) ok.click();
                            }
                        };
                    },
                    buttons: [
                        {
                            text: isEs ? 'Cancelar' : 'Cancel',
                            class: 'btn',
                            action: function(_e, overlay) { document.body.removeChild(overlay); }
                        },
                        {
                            text: isEs ? 'Descifrar' : 'Decrypt',
                            class: 'btn btn-primary',
                            action: async function(_e, overlay) {
                                var pwd = document.getElementById('backup-decrypt-pwd').value;
                                if (!pwd) return;
                                document.body.removeChild(overlay);
                                try {
                                    var fromB64 = function(s) { var b = atob(s); return new Uint8Array(b.length).map(function(_, i) { return b.charCodeAt(i); }); };
                                    var keyMat = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
                                    var aesKey = await crypto.subtle.deriveKey(
                                        { name: 'PBKDF2', salt: fromB64(wrapper.salt), iterations: 200000, hash: 'SHA-256' },
                                        keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                                    );
                                    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrapper.iv) }, aesKey, fromB64(wrapper.data));
                                    var data = JSON.parse(new TextDecoder().decode(plain));
                                    if (!data || !data.nsec) { alert(isEs ? 'El backup no contiene nsec.' : 'Backup has no nsec.'); return; }
                                    _applyNsec(data.nsec);
                                } catch(e) {
                                    alert(isEs ? 'Contraseña incorrecta o backup corrupto.' : 'Wrong password or corrupted backup.');
                                }
                            }
                        }
                    ]
                });
            };

            // Profile edit
            var btnEditProfile = document.getElementById('btn-edit-profile'), profilePanel = document.getElementById('profile-edit');
            if (btnEditProfile) btnEditProfile.onclick = async function() {
                // Load profile from DB first, fallback to Nostr cache
                var p = Profiles.get(Events.pubkey) || {};
                if (Api.userId) {
                    var r = await Api.call('get_profile');
                    if (!r.error && r.data) {
                        p.name = r.data.name || p.name || '';
                        p.about = r.data.about || p.about || '';
                        p.picture = r.data.picture || p.picture || '';
                    }
                }
                document.getElementById('profile-name').value = p.name || p.display_name || Api.username || '';
                document.getElementById('profile-about').value = p.about || '';
                document.getElementById('profile-picture').value = p.picture || '';
                document.getElementById('profile-nip05').value = p.nip05 || (Api.username ? Api.username + '@' + location.hostname : '');
                profilePanel.style.display = profilePanel.style.display === 'none' ? '' : 'none';
            };
            var btnSaveProfile = document.getElementById('btn-save-profile');
            if (btnSaveProfile) btnSaveProfile.onclick = async function() {
                if (!Events.canSign()) { alert('Need nsec or NIP-07 to update profile.'); return; }
                var existing = Profiles.get(Events.pubkey) || {};
                var profile = { name: document.getElementById('profile-name').value.trim(), display_name: document.getElementById('profile-name').value.trim(), about: document.getElementById('profile-about').value.trim(), picture: document.getElementById('profile-picture').value.trim(), nip05: document.getElementById('profile-nip05').value.trim() };
                // Preserve fields not in the editor (banner, lud16, lud06, etc.)
                profile.banner = existing.banner || '';
                if (existing.lud06) profile.lud06 = existing.lud06;
                if (existing.lud16) profile.lud16 = existing.lud16;
                // Auto-set nip05 and lud16 if user is registered
                if (Api.username) {
                    profile.nip05 = Api.username + '@' + location.hostname;
                    profile.lud16 = Api.username + '@' + location.hostname;
                }
                try {
                    btnSaveProfile.textContent = '...'; btnSaveProfile.style.pointerEvents = 'none';
                    // Save to local DB
                    if (Api.userId) {
                        await Api.call('save_profile', { name: profile.name, about: profile.about, picture: profile.picture, pubkey: Events.pubkey });
                    }
                    // Publish to Nostr
                    await Events.publishProfile(profile);
                    profilePanel.style.display = 'none';
                    self.updateIdentity();
                    // Verify LNURL-pay endpoint
                    if (profile.lud16) {
                        try {
                            var lnurl = location.protocol + '//' + location.hostname + '/.well-known/lnurlp/' + encodeURIComponent(Api.username);
                            var r = await fetch(lnurl);
                            var j = r.ok ? await r.json() : null;
                            if (!j || j.tag !== 'payRequest') throw new Error('bad response');
                        } catch(e) {
                            self.showLnurlSetupDialog(Api.username + '@' + location.hostname);
                        }
                    }
                } catch(e) { alert('Error: ' + e.message); }
                finally { btnSaveProfile.textContent = 'Save'; btnSaveProfile.style.pointerEvents = ''; }
            };
            var btnCancelProfile = document.getElementById('btn-cancel-profile');
            if (btnCancelProfile) btnCancelProfile.onclick = function() { profilePanel.style.display = 'none'; };

            // ---- Export / Import backup ----
            var btnExport = document.getElementById('btn-export-profile');
            if (btnExport) btnExport.onclick = async function() {
                var isEs = Api.lang === 'es';
                try {
                    // Get nsec from IndexedDB
                    var keys = await loadStoredKeys(Api.userId);
                    // Get server data (contacts, topics, channels, relays, bookmarks, muted)
                    var res = await Api.call('export_data');
                    if (!res || res.error) throw new Error(isEs ? 'Error al obtener datos del servidor' : 'Error fetching server data');
                    var exportObj = {
                        v: 1,
                        exported_at: new Date().toISOString(),
                        exported_from: location.hostname,
                        npub: keys ? keys.npub : (Events.pubkey ? npubEncode(Events.pubkey) : ''),
                        nsec: keys ? keys.nsec : '',
                        username: res.data.username || Api.username || '',
                        profile: Profiles.get(Events.pubkey) || {},
                        contacts: res.data.contacts,
                        topics: res.data.topics,
                        channels: res.data.channels,
                        relays: res.data.relays,
                        bookmarks: res.data.bookmarks,
                        muted: res.data.muted
                    };

                    var pwd = await prompt(isEs
                        ? 'Contraseña para cifrar el backup (dejar vacío para no cifrar):'
                        : 'Password to encrypt the backup (leave empty to skip encryption):');
                    // prompt() returns null on cancel — treat as empty
                    pwd = pwd || '';

                    var fileData;
                    if (pwd) {
                        var enc = new TextEncoder();
                        var salt = crypto.getRandomValues(new Uint8Array(16));
                        var iv   = crypto.getRandomValues(new Uint8Array(12));
                        var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
                        var aesKey = await crypto.subtle.deriveKey(
                            { name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' },
                            keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
                        );
                        var cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, enc.encode(JSON.stringify(exportObj)));
                        var toB64 = function(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); };
                        fileData = JSON.stringify({ encrypted: true, v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(cipherBuf) });
                    } else {
                        fileData = JSON.stringify({ encrypted: false, v: 1, data: exportObj }, null, 2);
                    }

                    var blob = new Blob([fileData], { type: 'application/json' });
                    var url  = URL.createObjectURL(blob);
                    var a    = document.createElement('a');
                    a.href = url; a.download = 'noxtr-backup-' + (exportObj.username || 'nostr') + '.json';
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch(e) {
                    alert((Api.lang === 'es' ? 'Error en export: ' : 'Export error: ') + e.message);
                }
            };

            var btnShowNsec = document.getElementById('btn-show-nsec');
            if (btnShowNsec) btnShowNsec.onclick = async function() {
                var keys = await loadStoredKeys(Api.userId);
                var nsec = keys ? keys.nsec : (Events.privkey ? nsecEncode(Events.privkey) : '');
                if (!nsec) { alert('No se encontró la clave privada. Inicia sesión con nsec primero.'); return; }
                alert(
                    '⚠️ CLAVE PRIVADA — No la compartas con nadie\n\n' +
                    'nsec (para importar en Nostr apps):\n\n' + nsec + '\n\n' +
                    'Nota: esta clave no tiene mnemónico de 12 palabras porque fue generada como clave aleatoria directa. Si Mostro mobile requiere mnemónico BIP-39, necesitarías crear una nueva identidad en esa app.'
                );
            };

            var importFileInput = document.getElementById('import-profile-file');
            if (importFileInput) importFileInput.onchange = async function() {
                var file = this.files[0]; if (!file) return;
                this.value = '';
                var isEs = Api.lang === 'es';
                try {
                    var text = await file.text();
                    var wrapper = JSON.parse(text);
                    var importObj;

                    if (wrapper.encrypted) {
                        var pwd = await prompt(isEs ? 'Contraseña para descifrar el backup:' : 'Password to decrypt the backup:');
                        if (!pwd) return;
                        var fromB64 = function(s) { var b = atob(s); return new Uint8Array(b.length).map(function(_, i) { return b.charCodeAt(i); }); };
                        var salt = fromB64(wrapper.salt), iv = fromB64(wrapper.iv), cipher = fromB64(wrapper.data);
                        var enc = new TextEncoder();
                        var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
                        var aesKey = await crypto.subtle.deriveKey(
                            { name: 'PBKDF2', salt: salt, iterations: 200000, hash: 'SHA-256' },
                            keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                        );
                        var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, aesKey, cipher);
                        importObj = JSON.parse(new TextDecoder().decode(plainBuf));
                    } else {
                        importObj = wrapper.data;
                    }

                    var ok = await confirm(isEs
                        ? '¿Importar backup? Esto reemplazará tus contactos, topics, relays, canales, bookmarks y silenciados actuales.'
                        : 'Import backup? This will replace your current contacts, topics, relays, channels, bookmarks and muted list.');
                    if (!ok) return;

                    // Restore nsec to IndexedDB
                    if (importObj.nsec && importObj.npub && importObj.npub.indexOf('npub') === 0) {
                        var privHex = nsecDecode(importObj.nsec);
                        if (privHex) {
                            Events.setPrivkey(privHex);
                            saveKeysToIndexedDB(Api.userId, importObj.npub, importObj.nsec, Events.pubkey, Events.privkey);
                        }
                    }

                    // Restore server data
                    var res = await Api.call('import_data', { data: JSON.stringify({
                        contacts:  importObj.contacts  || [],
                        topics:    importObj.topics    || [],
                        channels:  importObj.channels  || [],
                        relays:    importObj.relays    || [],
                        bookmarks: importObj.bookmarks || [],
                        muted:     importObj.muted     || []
                    })});

                    if (!res || res.error) throw new Error(isEs ? 'Error al importar en el servidor' : 'Server import failed');

                    alert(isEs ? '✅ Backup importado correctamente. Recarga la página para aplicar los cambios.' : '✅ Backup imported. Reload the page to apply changes.');
                } catch(e) {
                    alert((isEs ? 'Error al importar: ' : 'Import error: ') + e.message);
                }
            };

            // Tab switching
            document.querySelectorAll('.noxtr-tab[data-tab]').forEach(function(tab) {
                tab.onclick = function() { self.switchTab(tab.dataset.tab, true); };
            });

            // Search button
            var btnSearch = document.getElementById('btn-search');
            var searchIn = document.getElementById('search-input');
            var btnDoSearch = document.getElementById('btn-do-search');
            if (btnSearch) btnSearch.onclick = function() { self.activateSearch(true); };
            if (btnDoSearch) btnDoSearch.onclick = function() { Search.search(searchIn.value); };
            if (searchIn) searchIn.onkeydown = function(e) { if (e.key === 'Enter') Search.search(searchIn.value); };

            // Following: add by npub
            var btnAddF = document.getElementById('btn-add-follow'), followIn = document.getElementById('follow-input');
            if (btnAddF) btnAddF.onclick = async function() {
                var v = followIn.value.trim(); if (!v) return;
                if (v.indexOf('npub') === 0) v = npubDecode(v);
                if (v && v.length === 64 && /^[0-9a-f]+$/i.test(v)) {
                    var name = Profiles.displayName(v);
                    await Contacts.add(v, name); followIn.value = ''; Contacts.render(); self.switchTab('following');
                } else { alert('Invalid npub or hex pubkey'); }
            };
            if (followIn) followIn.onkeydown = function(e) { if (e.key === 'Enter') btnAddF.onclick(); };

            // Topics: add
            var btnAddT = document.getElementById('btn-add-topic'), topicIn = document.getElementById('topic-input');
            if (btnAddT) btnAddT.onclick = async function() {
                var t = topicIn.value.trim(); if (!t) return;
                await Topics.add(t); topicIn.value = ''; Topics.render(); self.switchTab('topics');
            };
            if (topicIn) topicIn.onkeydown = function(e) { if (e.key === 'Enter') btnAddT.onclick(); };

            // Compose: mode toggle (Note / Article)
            self._composeMode = 'note';
            var articleFields = document.getElementById('compose-article-fields');
            document.querySelectorAll('.compose-mode').forEach(function(btn) {
                btn.onclick = function() {
                    document.querySelectorAll('.compose-mode').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self._composeMode = btn.dataset.mode;
                    if (articleFields) articleFields.style.display = self._composeMode === 'article' ? '' : 'none';
                    if (compTxt) compTxt.placeholder = self._composeMode === 'article'
                        ? (Api.lang === 'es' ? 'Contenido en Markdown...' : 'Content in Markdown...')
                        : "What's on your mind?";
                    if (compTxt && self._composeMode === 'article') compTxt.rows = 10;
                    else if (compTxt) compTxt.rows = 3;
                };
            });

            // Feed type filter (All / Notes / Reads)
            document.querySelectorAll('.feed-type').forEach(function(btn) {
                btn.onclick = function() {
                    document.querySelectorAll('.feed-type').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    Feed.applyFilter(btn.dataset.type);
                };
            });

            // Article view: back button
            var articleBack = document.getElementById('article-back');
            if (articleBack) articleBack.onclick = function() {
                Articles.closeArticle();
            };
            var pvBtnShare = document.getElementById('pv-btn-share');
            if (pvBtnShare) pvBtnShare.onclick = function() { ProfileView.share(); };

            var pvBtnFollow = document.getElementById('pv-btn-follow');
            if (pvBtnFollow) pvBtnFollow.onclick = async function() {
                var pk = ProfileView.pubkey;
                if (!pk) return;
                if (Contacts.isFollowing(pk)) {
                    await Contacts.remove(pk);
                } else {
                    await Contacts.add(pk, Profiles.displayName(pk));
                }
                ProfileView._renderStrip(pk);
                document.querySelectorAll('.action-follow[data-pubkey="' + pk + '"]').forEach(function(b) {
                    b.classList.toggle('followed', Contacts.isFollowing(pk));
                    b.title = Contacts.isFollowing(pk) ? 'Unfollow' : 'Follow';
                });
            };

            // Click on banner/avatar while in profile mode → exit profile view
            var noxtrBanner = document.getElementById('noxtr-banner');
            var noxtrAvatar = document.getElementById('noxtr-avatar');
            if (noxtrBanner) noxtrBanner.addEventListener('click', function() {
                if (ProfileView.active) { ProfileView.close(); UI.switchTab('topics'); }
            }, true);
            if (noxtrAvatar) noxtrAvatar.addEventListener('click', function() {
                if (ProfileView.active) { ProfileView.close(); UI.switchTab('topics'); }
            }, true);

            // Article view: reply
            var btnArticleReply = document.getElementById('btn-article-reply');
            var articleReplyText = document.getElementById('article-reply-text');
            if (btnArticleReply) btnArticleReply.onclick = async function() {
                if (!articleReplyText || !articleReplyText.value.trim()) return;
                var ev = Articles._currentArticle;
                if (!ev || !Events.canSign()) return;
                var tags = [['e', ev.id, '', 'root'], ['p', ev.pubkey]];
                var reply = await Events.create(1, articleReplyText.value.trim(), tags);
                var signed = await Events.sign(reply);
                Pool.publish(signed);
                articleReplyText.value = '';
                var el = Feed.renderNote(signed);
                document.getElementById('article-replies').appendChild(el);
            };
            if (articleReplyText) articleReplyText.onkeydown = function(e) {
                if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); btnArticleReply.onclick(); }
            };

            // DM: nsec unlock for decryption
            var btnDmNsec = document.getElementById('btn-dm-nsec'), dmNsecIn = document.getElementById('dm-nsec-input');
            if (btnDmNsec) btnDmNsec.onclick = function() {
                var v = dmNsecIn.value.trim(); if (!v) return;
                try {
                    Events.setPrivkey(v); dmNsecIn.value = '';
                    document.getElementById('dm-nsec-notice').style.display = 'none';
                    self.updateIdentity();
                    // Re-subscribe to re-decrypt all messages
                    DMs.convos = {}; DMs.subscribe();
                } catch(e) { alert('Invalid key: ' + e.message); }
            };
            if (dmNsecIn) dmNsecIn.onkeydown = function(e) { if (e.key === 'Enter') btnDmNsec.onclick(); };

            // DM: back, send, new
            var dmBack = document.getElementById('dm-back');
            if (dmBack) dmBack.onclick = function() { DMs.closeThread(); };
            var btnDmSend = document.getElementById('btn-dm-send'), dmText = document.getElementById('dm-text');
            if (btnDmSend) btnDmSend.onclick = async function() {
                var text = dmText.value.trim(); if (!text || !DMs.currentPeer) return;
                if (DMs.monitorPubkey && DMs.currentPeer === DMs.monitorPubkey && text.toLowerCase() === 'clear') {
                    await DMs.clearMonitorMessages();
                    dmText.value = '';
                    return;
                }
                if (!Events.canSign()) { alert('Need NIP-07 or nsec for DMs.'); return; }
                try { await DMs.sendMessage(DMs.currentPeer, text); dmText.value = ''; } catch(e) { alert('Error: ' + e.message); }
            };
            if (dmText) dmText.onkeydown = function(e) { if (e.key === 'Enter') btnDmSend.onclick(); };
            var btnDmNew = document.getElementById('btn-dm-new'), dmNewPk = document.getElementById('dm-new-pubkey');
            if (btnDmNew) btnDmNew.onclick = function() {
                var v = dmNewPk.value.trim(); if (!v) return;
                if (v.indexOf('npub') === 0) v = npubDecode(v);
                if (v && v.length === 64) { dmNewPk.value = ''; if (!DMs.convos[v]) DMs.convos[v] = []; DMs.openThread(v); }
            };
            var dmContactSelect = document.getElementById('dm-contact-select');
            if (dmContactSelect) dmContactSelect.onchange = function() {
                var pk = dmContactSelect.value;
                if (pk && pk.length === 64) {
                    dmContactSelect.value = '';
                    if (!DMs.convos[pk]) DMs.convos[pk] = [];
                    DMs.openThread(pk);
                }
            };

            // NIP-46 Nostr Connect
            var btnNip46Connect = document.getElementById('btn-nip46-connect');
            if (btnNip46Connect) btnNip46Connect.onclick = function() { Nip46.connect(); };

            // Channels: back, send, join, create
            var btnChannelSend = document.getElementById('btn-channel-send');
            if (btnChannelSend) btnChannelSend.onclick = async function() {
                var input = document.getElementById('channel-text');
                if (!input || !input.value.trim() || !Channels.currentRoom) return;
                if (!Events.canSign()) { alert(Api.lang === 'es' ? 'Necesitas nsec o extensión NIP-07 para enviar.' : 'Need NIP-07 or nsec to send.'); return; }
                try { await Channels.sendMessage(Channels.currentRoom, input.value.trim()); input.value = ''; } catch(e) { alert('Error: ' + e.message); }
            };
            var channelTextInput = document.getElementById('channel-text');
            if (channelTextInput) channelTextInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnChannelSend.click(); }
            });
            var btnChannelBack = document.getElementById('channel-back');
            if (btnChannelBack) btnChannelBack.onclick = function() { history.back(); };
            var btnJoinChannel = document.getElementById('btn-join-channel');
            if (btnJoinChannel) btnJoinChannel.onclick = async function() {
                var input = document.getElementById('channel-id-input');
                if (!input || !input.value.trim()) return;
                var chId = input.value.trim();
                if (chId.indexOf('note1') === 0) { try { chId = noteDecode(chId); } catch(e) { return; } }
                if (chId.length !== 64 || !/^[0-9a-f]+$/i.test(chId)) return;
                await Channels.joinChannel(chId.toLowerCase());
                input.value = '';
            };
            var btnCreateChannel = document.getElementById('btn-create-channel');
            if (btnCreateChannel) btnCreateChannel.onclick = async function() {
                if (!Events.canSign()) { alert(Api.lang === 'es' ? 'Necesitas nsec o extensión NIP-07.' : 'Need NIP-07 or nsec.'); return; }
                Channels.openCreateDialog();
            };

            // Channel room: invite + edit buttons
            var btnChannelInvite = document.getElementById('channel-invite');
            if (btnChannelInvite) btnChannelInvite.onclick = function() {
                if (Channels.currentRoom) Channels.copyInviteLink(Channels.currentRoom);
            };
            var btnChannelEdit = document.getElementById('channel-edit');
            if (btnChannelEdit) btnChannelEdit.onclick = function() {
                if (Channels.currentRoom) Channels.openEditDialog(Channels.currentRoom);
            };
            var btnChannelDelete = document.getElementById('channel-delete');
            if (btnChannelDelete) btnChannelDelete.onclick = async function() {
                if (!Channels.currentRoom) return;
                var ok = await confirm(Api.lang === 'es' ? '¿Borrar este canal? Se enviará una solicitud de borrado a los relays.' : 'Delete this channel? A deletion request will be sent to relays.');
                if (ok) Channels.deleteChannel(Channels.currentRoom);
            };

            // Delete individual channel message (kind 5 / NIP-09)
            var channelMsgsEl = document.getElementById('channel-messages');
            if (channelMsgsEl) channelMsgsEl.addEventListener('click', async function(e) {
                var btn = e.target.closest('[data-action="del-channel-msg"]');
                if (!btn) return;
                var msgId = btn.dataset.id;
                if (!msgId) return;
                if (!await confirm(Api.lang === 'es' ? '¿Eliminar este mensaje? Los relays pueden tardar en procesarlo.' : 'Delete this message? Relays may take a moment to process.')) return;
                try {
                    await Events.deleteNote(msgId);
                    var msgEl = btn.closest('.dm-msg');
                    if (msgEl) msgEl.remove();
                    if (Channels.currentRoom && Channels.rooms[Channels.currentRoom]) {
                        var msgs = Channels.rooms[Channels.currentRoom].messages;
                        var idx = msgs.findIndex(function(m) { return m.id === msgId; });
                        if (idx !== -1) msgs.splice(idx, 1);
                    }
                } catch(err) { alert('Error: ' + err.message); }
            });

            var btnNip46Disconnect = document.getElementById('btn-nip46-disconnect');
            if (btnNip46Disconnect) btnNip46Disconnect.onclick = function() { Nip46.disconnect(); };
            var nip46ModalClose = document.getElementById('nip46-modal-close');
            if (nip46ModalClose) nip46ModalClose.onclick = function() { document.getElementById('nip46-modal').style.display = 'none'; };

            // Bunker: actuar como firmador para apps externas
            var btnBunkerOpen = document.getElementById('btn-bunker-open');
            if (btnBunkerOpen) btnBunkerOpen.onclick = function() {
                var modal = document.getElementById('bunker-modal');
                var input = document.getElementById('bunker-uri-input');
                var status = document.getElementById('bunker-status');
                if (modal) modal.style.display = '';
                if (input) { input.value = ''; input.focus(); }
                if (status) status.textContent = '';
            };
            var bunkerModalClose = document.getElementById('bunker-modal-close');
            if (bunkerModalClose) bunkerModalClose.onclick = function() { document.getElementById('bunker-modal').style.display = 'none'; };
            var btnBunkerConnect = document.getElementById('btn-bunker-connect');
            if (btnBunkerConnect) btnBunkerConnect.onclick = async function() {
                var input = document.getElementById('bunker-uri-input');
                var status = document.getElementById('bunker-status');
                var uri = input ? input.value.trim() : '';
                if (!uri) return;
                btnBunkerConnect.textContent = Api.lang === 'es' ? 'Conectando...' : 'Connecting...';
                btnBunkerConnect.style.pointerEvents = 'none';
                try {
                    var name = await Bunker.accept(uri);
                    if (status) { status.textContent = (Api.lang === 'es' ? 'Conectado a ' : 'Connected to ') + name; status.className = 'bunker-status'; }
                    setTimeout(function() { document.getElementById('bunker-modal').style.display = 'none'; }, 1200);
                } catch(e) {
                    if (status) { status.textContent = e.message; status.className = 'bunker-status error'; }
                } finally {
                    btnBunkerConnect.textContent = Api.lang === 'es' ? 'Conectar' : 'Connect';
                    btnBunkerConnect.style.pointerEvents = '';
                }
            };
            // Escáner QR con cámara (Html5Qrcode — Chrome, Firefox, iOS Safari)
            var _html5QrScanner = null;

            function _stopScanner() {
                if (_html5QrScanner) {
                    _html5QrScanner.stop().catch(function() {}).finally(function() { _html5QrScanner = null; });
                }
                var scanner = document.getElementById('bunker-qr-scanner');
                if (scanner) scanner.style.display = 'none';
            }

            var btnBunkerScan = document.getElementById('btn-bunker-scan');
            if (btnBunkerScan) btnBunkerScan.onclick = function() {
                var scanner    = document.getElementById('bunker-qr-scanner');
                var scanStatus = document.getElementById('bunker-scan-status');
                var es = Api.lang === 'es';

                if (typeof Html5Qrcode === 'undefined') {
                    if (scanStatus) { scanner.style.display = ''; scanStatus.textContent = es ? 'Librería QR no cargada.' : 'QR library not loaded.'; }
                    return;
                }
                scanner.style.display = '';
                if (scanStatus) scanStatus.textContent = es ? 'Apunta al código QR...' : 'Point at the QR code...';

                _html5QrScanner = new Html5Qrcode('bunker-scan-video');
                _html5QrScanner.start(
                    { facingMode: 'environment' },
                    { fps: 10, qrbox: { width: 200, height: 200 } },
                    function(decodedText) {
                        var input = document.getElementById('bunker-uri-input');
                        if (input) input.value = decodedText;
                        _stopScanner();
                        var btnConnect = document.getElementById('btn-bunker-connect');
                        if (btnConnect) btnConnect.click();
                    },
                    function() {}  // error de frame — ignorar
                ).catch(function() {
                    if (scanStatus) scanStatus.textContent = es ? 'No se pudo acceder a la cámara.' : 'Could not access camera.';
                });
            };

            var btnBunkerScanStop = document.getElementById('btn-bunker-scan-stop');
            if (btnBunkerScanStop) btnBunkerScanStop.onclick = _stopScanner;

            // Detener cámara al cerrar el modal
            if (bunkerModalClose) { var _origBunkerClose = bunkerModalClose.onclick; bunkerModalClose.onclick = function() { _stopScanner(); if (_origBunkerClose) _origBunkerClose(); }; }

            var btnNip46Copy = document.getElementById('btn-nip46-copy');
            if (btnNip46Copy) btnNip46Copy.onclick = function() {
                var uri = document.getElementById('nip46-uri').textContent;
                if (uri) { navigator.clipboard.writeText(uri); btnNip46Copy.textContent = 'Copied!'; setTimeout(function() { btnNip46Copy.textContent = 'Copy URI'; }, 2000); }
            };

            // Feed actions (delegation) — shared handler for feed and thread-feed
            var noteActionHandler = async function(e, notes) {
                var btn = e.target.closest('.note-action'); if (!btn) return;
                var action = btn.dataset.action;
                if (action === 'share') { var url = location.origin + '/' + _MODULE_ + '/note/' + btn.dataset.id; navigator.clipboard.writeText(url); btn.style.color = '#28a745'; createSparkles(btn); setTimeout(function() { btn.style.color = ''; }, 1500); }
                else if (action === 'reply') {
                    var note = notes.find(function(n) { return n.id === btn.dataset.id; });
                    if (note) {
                        // In thread view, use thread compose
                        if (Threads.active) {
                            var tcTxt = document.getElementById('thread-compose-text');
                            if (tcTxt) { tcTxt.focus(); tcTxt.placeholder = 'Reply to ' + Profiles.displayName(note.pubkey) + '...'; }
                        } else {
                            self.replyingTo = note;
                            var ri = document.getElementById('reply-info'); if (ri) { ri.style.display = ''; ri.querySelector('.reply-to-name').textContent = Profiles.displayName(note.pubkey); }
                            if (!Events.canSign()) {
                                var nsecDiv = document.getElementById('nsec-login');
                                if (nsecDiv) { nsecDiv.style.display = ''; nsecDiv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                            } else {
                                var comp = document.getElementById('compose-area');
                                if (comp) { comp.style.display = ''; comp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                                var ct = document.getElementById('btn-toggle-compose'); if (ct) ct.classList.add('active');
                                compTxt.focus();
                            }
                        }
                    }
                }
                else if (action === 'like') { self.sendReaction(btn.dataset.id, btn.dataset.pubkey);createSparkles(btn); }
                else if (action === 'repost') { self.sendRepost(btn.dataset.id, btn.dataset.pubkey, btn); }
                else if (action === 'zap') { self.startZap(btn.dataset.id, btn.dataset.pubkey); }
                else if (action === 'bookmark') { self.toggleBookmark(btn); createSparkles(btn);}
                else if (action === 'follow') { self.toggleFollow(btn);createSparkles(btn); }
                else if (action === 'delete') {
                    /*
                     * OLD:
                     * if (confirm('Eliminar esta nota? Los relays pueden tardar en procesarlo.')) { ... }
                     *
                     * NEW:
                     * confirm() en este framework es async (Promise), por eso usamos await.
                     */
                    if (await confirm(Api.lang === 'es' ? 'Eliminar esta nota? Los relays pueden tardar en procesarlo.' : 'Delete this note? Relays may take a moment to process.')) {
                        var eid = btn.dataset.id;
                        Events.deleteNote(eid).then(function() {
                            var noteEl = btn.closest('.note'); if (noteEl) noteEl.remove();
                            var idx = notes.findIndex(function(n) { return n.id === eid; });
                            if (idx !== -1) notes.splice(idx, 1);
                        }).catch(function(e) { alert('Error: ' + e.message); });
                    }
                }
                else if (action === 'mute') {
                    var pk = btn.dataset.pubkey;
                    var name = Profiles.displayName(pk);
                    self.showMuteMenu(btn, pk, name);
                }
                else if (action === 'view-raw') {
                    var noteEl = btn.closest('.note');
                    if (noteEl) {
                        var pre = noteEl.querySelector('.ar-raw-content');
                        if (pre) { pre.style.display = pre.style.display === 'none' ? '' : 'none'; btn.classList.toggle('active'); }
                    }
                }
                else if (action === 'dm') {
                    var pk = btn.dataset.pubkey;
                    if (!DMs.convos[pk]) DMs.convos[pk] = [];
                    if (Threads.active) Threads.close();
                    self.switchTab('messages', true);
                    setTimeout(function() { DMs.openThread(pk); }, 100);
                }
            };

            // Main feed: actions + click note body to open thread
            var feedEl = document.getElementById('feed');
            if (feedEl) feedEl.onclick = function(e) {
                // If clicking an action button, handle it
                if (e.target.closest('.note-action')) { noteActionHandler(e, Feed.notes); return; }
                // Author name/avatar click → open profile view
                var authorEl = e.target.closest('.note-name[data-pubkey], .note-avatar[data-pubkey]');
                if (authorEl) { ProfileView.open(authorEl.dataset.pubkey, true); return; }
                // Mention click → profile popup
                var mention = e.target.closest('.noxtr-mention');
                if (mention && mention.dataset.pubkey) { e.preventDefault(); self.showProfilePopup(mention.dataset.pubkey); return; }
                // Notelink click → open thread
                var notelink = e.target.closest('.noxtr-notelink');
                if (notelink && notelink.dataset.noteid) { e.preventDefault(); Threads.openById(notelink.dataset.noteid); return; }
                var articlelink = e.target.closest('.noxtr-articlelink');
                if (articlelink && articlelink.dataset.naddr) { e.preventDefault(); Articles.openByNaddr(articlelink.dataset.naddr); return; }
                // If clicking a link, let it go
                if (e.target.closest('a[href]') || e.target.closest('.note-media')) return;
                // If user was selecting text, don't open thread
                var sel = window.getSelection();
                if (sel && sel.toString().trim().length > 0) return;
                // Click on article inline content → open article view
                var artClick = e.target.closest('.article-inline-title, .article-inline-summary, .article-inline-image');
                if (artClick) {
                    var artNoteEl = artClick.closest('.note');
                    if (artNoteEl) {
                        var artEv = Feed.notes.find(function(n) { return n.id === artNoteEl.dataset.id; });
                        if (artEv) Articles.openArticle(artEv);
                    }
                    return;
                }
                // Otherwise, click on note body → open thread
                var noteEl = e.target.closest('.note');
                if (noteEl) {
                    var note = Feed.notes.find(function(n) { return n.id === noteEl.dataset.id; });
                    if (note) {
                        // Articles open in article-view, not thread
                        if (note.kind === 30023) { Articles.openArticle(note); return; }
                        history.pushState({ noxtr: 'thread', noteId: note.id }, '');
                        Threads.open(note);
                    }
                }
            };

            // Thread feed: actions + click note body (no-op, already in thread)
            var threadFeedEl = document.getElementById('thread-feed');
            if (threadFeedEl) threadFeedEl.onclick = function(e) {
                if (e.target.closest('.note-action')) { noteActionHandler(e, Threads.notes); return; }
                var authorEl = e.target.closest('.note-name[data-pubkey], .note-avatar[data-pubkey]');
                if (authorEl) { ProfileView.open(authorEl.dataset.pubkey, true); return; }
                var mention = e.target.closest('.noxtr-mention');
                if (mention && mention.dataset.pubkey) { e.preventDefault(); self.showProfilePopup(mention.dataset.pubkey); return; }
                var notelink = e.target.closest('.noxtr-notelink');
                if (notelink && notelink.dataset.noteid) { e.preventDefault(); Threads.openById(notelink.dataset.noteid); return; }
                var articlelink = e.target.closest('.noxtr-articlelink');
                if (articlelink && articlelink.dataset.naddr) { e.preventDefault(); Articles.openByNaddr(articlelink.dataset.naddr); return; }
            };

            // ---- Floating translate popup ----
            var _txRange = null, _txText = '';
            var txPopup = document.createElement('div');
            txPopup.id = 'noxtr-translate-popup';
            txPopup.textContent = 'Traducir';
            document.body.appendChild(txPopup);

            txPopup.addEventListener('mousedown', function(e) { e.preventDefault(); }); // keeps selection alive
            txPopup.addEventListener('click', function() {
                if (!_txText || !_txRange) return;
                txPopup.textContent = 'Traduciendo\u2026';
                var fd = new FormData();
                fd.append('text', _txText);
                var range = _txRange;
                _txRange = null; _txText = '';
                fetch('/' + _MODULE_ + '/ajax/action=translate', { method: 'POST', body: fd })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        txPopup.style.display = 'none';
                        txPopup.textContent = 'Traducir';
                        if (!data.error && data.translated) {
                            try {
                                range.deleteContents();
                                var span = document.createElement('span');
                                span.className = 'note-translation-inline';
                                span.textContent = data.translated;
                                range.insertNode(span);
                                setTimeout(function() { span.classList.add('note-translation-inline-done'); }, 100);
                            } catch(err) { notify('Error al insertar traducción', 'error', 3000); }
                        } else { notify('Error al traducir', 'error', 3000); }
                    })
                    .catch(function() {
                        txPopup.style.display = 'none';
                        txPopup.textContent = 'Traducir';
                        notify('Error al traducir', 'error', 3000);
                    });
            });

            document.addEventListener('mouseup', function(e) {
                if (e.target === txPopup) return;
                setTimeout(function() {
                    var sel = window.getSelection();
                    var text = sel ? sel.toString().trim() : '';
                    if (!text || !sel.rangeCount) { txPopup.style.display = 'none'; return; }
                    var range = sel.getRangeAt(0);
                    var ancestor = range.commonAncestorContainer;
                    var noteEl = (ancestor.nodeType === 1 ? ancestor : ancestor.parentElement).closest('.note');
                    if (!noteEl) { txPopup.style.display = 'none'; return; }
                    var lineCount = (text.match(/\n/g) || []).length + 1;
                    if (lineCount > 15 || text.length > 1500) { txPopup.style.display = 'none'; return; }
                    _txRange = range.cloneRange();
                    _txText  = text;
                    var rect = range.getBoundingClientRect();
                    txPopup.style.left = Math.min(rect.right, window.innerWidth - 110) + 'px';
                    txPopup.style.top  = (rect.bottom + 6) + 'px';
                    txPopup.style.display = 'block';
                }, 10);
            });
            document.addEventListener('mousedown', function(e) {
                if (e.target !== txPopup) { txPopup.style.display = 'none'; }
            });

            // Article view: action buttons (like, zap, repost, bookmark, share)
            var articleActionsEl = document.getElementById('article-view-actions');
            if (articleActionsEl) articleActionsEl.onclick = function(e) {
                if (e.target.closest('.note-action')) {
                    var ev = Articles._currentArticle;
                    noteActionHandler(e, ev ? [ev] : []);
                }
            };

            // Article replies: action buttons + mention/notelink clicks
            var articleRepliesEl = document.getElementById('article-replies');
            if (articleRepliesEl) articleRepliesEl.onclick = function(e) {
                if (e.target.closest('.note-action')) { noteActionHandler(e, []); return; }
                var authorEl = e.target.closest('.note-name[data-pubkey], .note-avatar[data-pubkey]');
                if (authorEl) { ProfileView.open(authorEl.dataset.pubkey, true); return; }
                var mention = e.target.closest('.noxtr-mention');
                if (mention && mention.dataset.pubkey) { e.preventDefault(); self.showProfilePopup(mention.dataset.pubkey); return; }
                var notelink = e.target.closest('.noxtr-notelink');
                if (notelink && notelink.dataset.noteid) { e.preventDefault(); Threads.openById(notelink.dataset.noteid); return; }
            };

            // Thread: back button — use history.back() so popstate handles it
            var threadBack = document.getElementById('thread-back');
            if (threadBack) threadBack.onclick = function() {
                history.back();
            };

            // Thread: reply
            var btnThreadReply = document.getElementById('btn-thread-reply'), threadTxt = document.getElementById('thread-compose-text');
            if (btnThreadReply) btnThreadReply.onclick = async function() {
                var text = threadTxt.value.trim(); if (!text) return;
                if (!Events.canSign()) return;
                try {
                    btnThreadReply.textContent = '...'; btnThreadReply.style.pointerEvents = 'none';
                    await Threads.reply(text);
                    threadTxt.value = '';
                } catch(e) { alert('Error: ' + e.message); }
                finally { btnThreadReply.textContent = 'Reply'; btnThreadReply.style.pointerEvents = ''; }
            };
            if (threadTxt) threadTxt.onkeydown = function(e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btnThreadReply.onclick(); };

            var btnCancel = document.getElementById('btn-cancel-reply');
            if (btnCancel) btnCancel.onclick = function() { self.cancelReply(); };

            var btnComposeToggle = document.getElementById('btn-toggle-compose');
            if (btnComposeToggle) btnComposeToggle.onclick = function() {
                var comp = document.getElementById('compose-area');
                if (!comp) return;
                var visible = comp.style.display !== 'none';
                comp.style.display = visible ? 'none' : '';
                btnComposeToggle.classList.toggle('active', !visible);
                if (!visible) { var txt = document.getElementById('compose-text'); if (txt) txt.focus(); }
            };

            // ---- AR Profile Modal ----
            var arModal = document.getElementById('ar-profile-modal');
            var btnArProfile = document.getElementById('btn-ar-profile');
            var arModalClose = document.getElementById('ar-modal-close');
            var arFormAvatar = document.getElementById('ar-form-avatar');
            var arFormPreview = document.getElementById('ar-form-avatar-preview');
            var arAddLink = document.getElementById('ar-form-add-link');
            var arPreviewBtn = document.getElementById('ar-form-preview');
            var arPublishBtn = document.getElementById('ar-form-publish');
            var arPreviewArea = document.getElementById('ar-form-preview-area');
            var _arAvatarB64 = '';

            if (btnArProfile) btnArProfile.onclick = function() {
                if (!Events.canSign()) { alert(Api.lang === 'es' ? 'Necesitas iniciar sesión para crear un AR Profile.' : 'You need to log in to create an AR Profile.'); return; }
                // Pre-fill from existing profile
                var prof = Profiles.get(Events.pubkey);
                if (prof) {
                    var nameIn = document.getElementById('ar-form-name');
                    var bioIn = document.getElementById('ar-form-bio');
                    if (nameIn && !nameIn.value) nameIn.value = prof.display_name || prof.name || '';
                    if (bioIn && !bioIn.value) bioIn.value = prof.about || '';
                    // Show existing avatar
                    if (prof.picture && arFormPreview && !arFormPreview.querySelector('img')) {
                        arFormPreview.innerHTML = '<img src="'+escapeHtml(prof.picture)+'">';
                    }
                }
                if (arModal) arModal.style.display = '';
            };

            if (arModalClose) arModalClose.onclick = function() { if (arModal) arModal.style.display = 'none'; };
            if (arModal) arModal.onclick = function(e) { if (e.target === arModal) arModal.style.display = 'none'; };

            // Avatar file → base64
            if (arFormAvatar) arFormAvatar.onchange = function() {
                var file = arFormAvatar.files[0]; if (!file) return;
                // Resize to max 128x128 and compress
                var reader = new FileReader();
                reader.onload = function(e) {
                    var img = new Image();
                    img.onload = function() {
                        var canvas = document.createElement('canvas');
                        var max = 128, w = img.width, h = img.height;
                        if (w > h) { if (w > max) { h = h * max / w; w = max; } }
                        else { if (h > max) { w = w * max / h; h = max; } }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        _arAvatarB64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
                        if (arFormPreview) arFormPreview.innerHTML = '<img src="data:image/jpeg;base64,'+_arAvatarB64+'">';
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            };

            // Location warning toggle
            var arLocCheck = document.getElementById('ar-form-location');
            if (arLocCheck) arLocCheck.onchange = function() {
                var warn = document.querySelector('.ar-form-location-warn');
                if (warn) warn.style.display = arLocCheck.checked ? '' : 'none';
            };

            // Add link row
            if (arAddLink) arAddLink.onclick = function() {
                var container = document.getElementById('ar-form-links'); if (!container) return;
                var row = document.createElement('div'); row.className = 'ar-form-link-row';
                row.innerHTML = '<input type="text" class="ar-form-input ar-link-label" placeholder="Label"><input type="text" class="ar-form-input ar-link-url" placeholder="URL"><a class="ar-form-link-remove" title="Remove">&times;</a>';
                row.querySelector('.ar-form-link-remove').onclick = function() { row.remove(); };
                container.appendChild(row);
            };

            // Build AR Profile payload from form
            function _buildArPayload(cb) {
                var name = (document.getElementById('ar-form-name').value || '').trim();
                var bio = (document.getElementById('ar-form-bio').value || '').trim();
                var headline = (document.getElementById('ar-form-headline').value || '').trim();
                var tagsRaw = (document.getElementById('ar-form-tags').value || '').trim();
                var tags = tagsRaw ? tagsRaw.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
                var linkRows = document.querySelectorAll('#ar-form-links .ar-form-link-row');
                var links = [];
                linkRows.forEach(function(r) {
                    var l = (r.querySelector('.ar-link-label').value || '').trim();
                    var v = (r.querySelector('.ar-link-url').value || '').trim();
                    if (l && v) links.push({ l: l, v: v });
                });
                var includeLocation = document.getElementById('ar-form-location').checked;

                var payload = { type: 'ar_profile', p: { n: name || 'Anonymous', b: bio } };
                if (_arAvatarB64) payload.p.at = _arAvatarB64;
                if (Events.pubkey) {
                    // Encode hex pubkey to base64
                    var bytes = [];
                    for (var i = 0; i < Events.pubkey.length; i += 2) bytes.push(parseInt(Events.pubkey.substr(i, 2), 16));
                    payload.p.pk = btoa(String.fromCharCode.apply(null, bytes));
                }
                if (headline || tags.length) { payload.p.card = {}; if (headline) payload.p.card.h = headline; if (tags.length) payload.p.card.tags = tags; }
                if (links.length) payload.p.f = links;

                if (includeLocation && navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(function(pos) {
                        payload.lat = Math.round(pos.coords.latitude * 10000) / 10000;
                        payload.lon = Math.round(pos.coords.longitude * 10000) / 10000;
                        cb({ payload: payload });
                    }, function() { cb({ payload: payload }); }, { timeout: 8000 });
                } else {
                    cb({ payload: payload });
                }
            }

            // Preview
            if (arPreviewBtn) arPreviewBtn.onclick = function() {
                _buildArPayload(function(obj) {
                    var fakeEv = { id: 'preview_' + Date.now(), pubkey: Events.pubkey || '', created_at: Math.floor(Date.now() / 1000), kind: 1, content: JSON.stringify(obj), tags: [] };
                    var el = Feed.renderNote(fakeEv);
                    if (arPreviewArea) { arPreviewArea.innerHTML = ''; arPreviewArea.style.display = ''; arPreviewArea.appendChild(el); }
                });
            };

            // Publish
            if (arPublishBtn) arPublishBtn.onclick = async function() {
                if (!Events.canSign()) return;
                arPublishBtn.textContent = '...'; arPublishBtn.style.pointerEvents = 'none';
                try {
                    await new Promise(function(resolve) {
                        _buildArPayload(async function(obj) {
                            var content = JSON.stringify(obj);
                            var published = await Events.publish(content);
                            Profiles.request(published.pubkey);
                            Feed._insertNote(published);
                            if (arModal) arModal.style.display = 'none';
                            // Reset form
                            document.getElementById('ar-form-name').value = '';
                            document.getElementById('ar-form-bio').value = '';
                            document.getElementById('ar-form-headline').value = '';
                            document.getElementById('ar-form-tags').value = '';
                            var linkContainer = document.getElementById('ar-form-links');
                            linkContainer.innerHTML = '<div class="ar-form-link-row"><input type="text" class="ar-form-input ar-link-label" placeholder="Label"><input type="text" class="ar-form-input ar-link-url" placeholder="URL"></div>';
                            document.getElementById('ar-form-location').checked = false;
                            if (arFormPreview) arFormPreview.innerHTML = '';
                            if (arPreviewArea) { arPreviewArea.innerHTML = ''; arPreviewArea.style.display = 'none'; }
                            _arAvatarB64 = '';
                            resolve();
                        });
                    });
                } catch(e) { alert('Error: ' + e.message); }
                finally { arPublishBtn.textContent = Api.lang === 'es' ? 'Publicar' : 'Publish'; arPublishBtn.style.pointerEvents = ''; }
            };

            Pool.onStatusChange = function() { self.updateRelayList(); };
            setInterval(function() { self.updateTimes(); }, 60000);

            // History management: intercept browser back/forward to navigate within Noxtr
            history.replaceState({ noxtr: 'tab', tab: 'topics' }, '');
            window.addEventListener('popstate', function(e) {
                var state = e.state;
                if (Channels.currentRoom) Channels.closeRoom();
                if (DMs.currentPeer) DMs.closeThread();
                if (Threads.active) Threads.close();
                if (Articles._currentArticle) Articles.closeArticle();
                if (ProfileView.active) ProfileView.close();
                if (state && state.noxtr === 'channel' && state.channelId) {
                    // Re-open channel room without pushing history again
                    Channels.currentRoom = state.channelId;
                    document.getElementById('channel-list').style.display = 'none';
                    document.getElementById('channel-actions').style.display = 'none';
                    document.getElementById('channel-room').style.display = '';
                    var room = Channels.rooms[state.channelId] || {};
                    document.getElementById('channel-room-name').textContent = room.name || state.channelId.slice(0, 12) + '…';
                    document.getElementById('channel-room-about').textContent = room.about || '';
                    var composeEl = document.getElementById('channel-compose');
                    if (composeEl) composeEl.style.display = Events.canSign() ? '' : 'none';
                    Channels.subscribeRoom(state.channelId);
                    Channels.fetchMeta(state.channelId);
                    Channels.renderMessages(state.channelId);
                } else if (state && state.noxtr === 'dm' && state.pubkey) {
                    self.switchTab('messages');
                    if (!DMs.convos[state.pubkey]) DMs.convos[state.pubkey] = [];
                    DMs.openThread(state.pubkey, true);
                } else if (state && state.noxtr === 'thread' && state.noteId) {
                    Threads.openById(state.noteId, true);
                } else if (state && state.noxtr === 'profile' && state.pubkey) {
                    ProfileView.open(state.pubkey, false);
                } else if (state && state.noxtr === 'article' && state.naddr) {
                    var cached = Feed.notes.find(function(a) { return a.id === state.eventId; });
                    if (cached) Articles.openArticle(cached);
                    else Articles.openByNaddr(state.naddr);
                } else if (state && state.noxtr === 'tab' && state.tab === 'search') {
                    // If already in search with results, just restore visibility (don't clear)
                    if (self.currentTab === 'search' && Feed.notes.length) {
                        document.getElementById('feed').style.display = '';
                        document.getElementById('panel-search').style.display = '';
                        var ff = document.getElementById('feed-type-filter'); if (ff) ff.style.display = '';
                    } else {
                        self.activateSearch();
                    }
                } else if (state && state.noxtr === 'tab') {
                    self.switchTab(state.tab || 'topics');
                }
            });
        },

        switchTab: function(tab, pushHistory) {
            if (Threads.active) Threads.close();
            var url = '/' + _MODULE_ + '/' + tab;
            if (pushHistory && tab !== this.currentTab) {
                history.pushState({ noxtr: 'tab', tab: tab }, '', url);
            } else {
                history.replaceState({ noxtr: 'tab', tab: tab }, '', url);
            }
            this.currentTab = tab;
            document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
            var active = document.querySelector('.noxtr-tab[data-tab="'+tab+'"]');
            if (active) active.classList.add('active');

            // Close profile view if open
            if (ProfileView.active) ProfileView.close();
            // Hide optional panels
            document.getElementById('panel-following').style.display = 'none';
            document.getElementById('panel-topics').style.display = 'none';
            document.getElementById('panel-messages').style.display = 'none';
            document.getElementById('panel-channels').style.display = 'none';
            document.getElementById('panel-followers').style.display = 'none';
            document.getElementById('panel-relays').style.display = 'none';
            document.getElementById('panel-search').style.display = 'none';
            var artView = document.getElementById('article-view'); if (artView) artView.style.display = 'none';
            Search.clear();
            Followers.unsubscribe();
            var feedEl = document.getElementById('feed');
            var loadEl = document.getElementById('feed-loading');
            var compEl = document.getElementById('compose-area');
            var compToggle = document.getElementById('btn-toggle-compose');
            var feedFilter = document.getElementById('feed-type-filter');
            feedEl.style.display = '';
            if (loadEl) loadEl.style.display = '';
            this.cancelReply();
            if (compEl) compEl.style.display = 'none';
            var showToggle = (tab === 'topics' || tab === 'following') && Events.canSign();
            if (compToggle) { compToggle.style.display = showToggle ? '' : 'none'; compToggle.classList.remove('active'); }
            // Show feed type filter on tabs that use the feed
            var showFilter = tab === 'topics' || tab === 'following' || tab === 'followers' || tab === 'bookmarks';
            if (feedFilter) feedFilter.style.display = showFilter ? '' : 'none';

            switch (tab) {
                case 'topics':
                    if (Api.userId) { document.getElementById('panel-topics').style.display = ''; Topics.render(); }
                    Feed.clear();
                    if (Topics.showHot) { Feed.subscribeHot(); }
                    else if (Topics.showAll || !Api.userId) { Feed.subscribeGlobal(); }
                    else {
                        var topics = Topics.active();
                        if (topics.length) { Feed.subscribeTopics(topics); }
                        else { feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Añade topics arriba y actívalos, o pulsa "All".' : 'Add topics above and activate them, or enable "All".') + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
                    }
                    break;
                case 'following':
                    Feed.clear();
                    if (!Api.userId && !Events.pubkey) {
                        feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? '🔒 Inicia sesión o introduce tu npub/nsec para ver a quién sigues.' : '🔒 Log in or enter your npub/nsec to see who you follow.') + '</div>';
                        if (loadEl) loadEl.style.display = 'none'; break;
                    }
                    document.getElementById('panel-following').style.display = '';
                    var followAddRow = document.querySelector('#panel-following .panel-add-row');
                    if (followAddRow) followAddRow.style.display = Api.userId ? '' : 'none';
                    Contacts.render();
                    var pks = Contacts.activePubkeys();
                    if (Events.pubkey && pks.indexOf(Events.pubkey) === -1) pks.push(Events.pubkey);
                    if (pks.length) { Feed.subscribeAuthors(pks); }
                    else if (Contacts.list.length) { feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Activa contactos arriba para ver sus notas.' : 'Activate contacts above to see their notes.') + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
                    else { feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Aún no sigues a nadie. Usa el botón de seguir en las notas.' : 'Not following anyone yet. Use the follow button on notes.') + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
                    break;
                case 'messages':
                    Feed.clear();
                    feedEl.style.display = 'none';
                    if (loadEl) loadEl.style.display = 'none';
                    if (compEl) compEl.style.display = 'none';
                    document.getElementById('panel-messages').style.display = '';
                    // Always reset to conversation list when tab is clicked (unless opening a specific peer via permalink)
                    if (DMs.currentPeer && !DMs._pendingOpenPeer) {
                        DMs.currentPeer = null;
                        var dmThread = document.getElementById('dm-thread'); if (dmThread) dmThread.style.display = 'none';
                        var dmConvList = document.getElementById('dm-conv-list'); if (dmConvList) dmConvList.style.display = '';
                        var dmNewEl = document.getElementById('dm-new'); if (dmNewEl) dmNewEl.style.display = '';
                    }
                    // Show nsec prompt if privkey not available
                    var dmNsecNotice = document.getElementById('dm-nsec-notice');
                    if (dmNsecNotice) dmNsecNotice.style.display = Events.canSign() ? 'none' : '';
                    // Populate contact selector dropdown
                    var dmContactSelect = document.getElementById('dm-contact-select');
                    if (dmContactSelect && Contacts.list.length) {
                        var opts = '<option value="">-- Select contact --</option>';
                        Contacts.list.forEach(function(c) {
                            var name = Profiles.displayName(c.pubkey);
                            opts += '<option value="'+c.pubkey+'">'+escapeHtml(name)+'</option>';
                        });
                        dmContactSelect.innerHTML = opts;
                    }
                    // Load saved messages from DB first, then subscribe for new ones
                    if (Api.userId && Events.canSign()) {
                        DMs.loadFromDb().then(function() {
                            DMs.renderConvos();
                            DMs.subscribe();
                            if (DMs._pendingOpenPeer) {
                                var pp = DMs._pendingOpenPeer; DMs._pendingOpenPeer = null;
                                if (!DMs.convos[pp]) DMs.convos[pp] = [];
                                DMs.openThread(pp, true);
                            }
                        });
                    } else {
                        DMs.subscribe();
                        if (DMs._pendingOpenPeer) {
                            var pp = DMs._pendingOpenPeer; DMs._pendingOpenPeer = null;
                            if (!DMs.convos[pp]) DMs.convos[pp] = [];
                            DMs.openThread(pp, true);
                        }
                    }
                    break;
                case 'channels':
                    Feed.clear();
                    feedEl.style.display = 'none';
                    if (loadEl) loadEl.style.display = 'none';
                    if (compEl) compEl.style.display = 'none';
                    document.getElementById('panel-channels').style.display = '';
                    if (Api.userId) {
                        Channels.loadFromDb().then(function() {
                            Channels.renderList();
                            Channels.subscribe();
                        });
                    } else {
                        Channels.renderList();
                    }
                    break;
                case 'bookmarks':
                    if (!Api.userId) {
                        Feed.clear();
                        feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? '🔒 Inicia sesión para ver tus marcadores guardados.' : '🔒 Log in to see your saved bookmarks.') + '</div>';
                        if (loadEl) loadEl.style.display = 'none'; break;
                    }
                    this.loadBookmarks(); break;
                case 'followers':
                    Feed.clear();
                    if (!Events.pubkey) {
                        feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? '🔒 Introduce tu npub o nsec para ver tus seguidores.' : '🔒 Enter your npub or nsec to see your followers.') + '</div>';
                        if (loadEl) loadEl.style.display = 'none'; break;
                    }
                    document.getElementById('panel-followers').style.display = '';
                    Followers.subscribe();
                    break;
                case 'relays':
                    Feed.clear();
                    feedEl.style.display = 'none';
                    if (loadEl) loadEl.style.display = 'none';
                    if (compEl) compEl.style.display = 'none';
                    document.getElementById('panel-relays').style.display = '';
                    Relays.render();
                    Muted.render();
                    break;
            }
        },

        loadBookmarks: async function() {
            Feed.clear(); await Bookmarks.load();
            if (!Bookmarks.list.length) {
                Feed.container.innerHTML = '<div class="noxtr-empty">No bookmarks yet. Use the bookmark icon on notes.</div>';
                Feed.loading.style.display = 'none'; return;
            }
            for (var i = 0; i < Bookmarks.list.length; i++) {
                var b = Bookmarks.list[i];
                var tags = []; try { tags = JSON.parse(b.event_tags || '[]'); } catch(e) {}
                var ev = { id: b.event_id, pubkey: b.event_pubkey, content: b.event_content, created_at: parseInt(b.event_created_at), kind: parseInt(b.event_kind) || 1, tags: tags };
                Profiles.request(ev.pubkey);
                Feed._insertNote(ev);
            }
            Feed.loading.style.display = 'none';
        },

        activateSearch: function(pushHistory) {
            if (Threads.active) Threads.close();
            if (ProfileView.active) ProfileView.close();
            if (pushHistory && this.currentTab !== 'search') {
                history.pushState({ noxtr: 'tab', tab: 'search' }, '', '/' + _MODULE_ + '/search');
            } else {
                history.replaceState({ noxtr: 'tab', tab: 'search' }, '', '/' + _MODULE_ + '/search');
            }
            this.currentTab = 'search';
            this.cancelReply();
            document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
            document.getElementById('btn-search').classList.add('active');
            // Hide all panels
            document.getElementById('panel-following').style.display = 'none';
            document.getElementById('panel-topics').style.display = 'none';
            document.getElementById('panel-messages').style.display = 'none';
            document.getElementById('panel-channels').style.display = 'none';
            document.getElementById('panel-followers').style.display = 'none';
            document.getElementById('panel-relays').style.display = 'none';
            var artView = document.getElementById('article-view'); if (artView) artView.style.display = 'none';
            Followers.unsubscribe();
            var compEl = document.getElementById('compose-area');
            var compToggle = document.getElementById('btn-toggle-compose');
            if (compEl) compEl.style.display = 'none';
            if (compToggle) { compToggle.style.display = 'none'; compToggle.classList.remove('active'); }
            // Show search panel, feed, and filter
            document.getElementById('panel-search').style.display = '';
            var feedFilter = document.getElementById('feed-type-filter');
            if (feedFilter) feedFilter.style.display = '';
            var feedEl = document.getElementById('feed');
            var loadEl = document.getElementById('feed-loading');
            feedEl.style.display = '';
            Feed.clear();
            feedEl.innerHTML = '<div class="noxtr-empty">' + (Api.lang === 'es' ? 'Escribe un término y pulsa Enter para buscar.' : 'Type a term and press Enter to search.') + '</div>';
            if (loadEl) loadEl.style.display = 'none';
            var inp = document.getElementById('search-input');
            if (inp) inp.focus();
        },

        cancelReply: function() {
            this.replyingTo = null;
            var ri = document.getElementById('reply-info'); if (ri) ri.style.display = 'none';
            var comp = document.getElementById('compose-area'); if (comp) comp.style.display = 'none';
            var ct = document.getElementById('btn-toggle-compose'); if (ct) ct.classList.remove('active');
        },

        // Helper: remove all visible notes by a pubkey (used by mute and report)
        _removeNotesByPubkey: function(pk) {
            document.querySelectorAll('.note').forEach(function(n) {
                var noteData = (Feed.notes || []).find(function(x) { return x.id === n.dataset.id; }) ||
                               (Threads.notes || []).find(function(x) { return x.id === n.dataset.id; });
                if (noteData && noteData.pubkey === pk) n.remove();
            });
        },

        showMuteMenu: function(btn, pk, name) {
            var self = this;
            // Remove any existing mute menu
            var old = document.querySelector('.noxtr-mute-menu'); if (old) old.remove();
            var menu = document.createElement('div');
            menu.className = 'noxtr-mute-menu';
            menu.innerHTML =
                '<div class="mute-menu-header">' + escapeHtml(name) + '</div>' +
                '<a class="mute-menu-item mute-menu-mute">' + (Api.lang === 'es' ? 'Silenciar usuario' : 'Mute user') + '</a>' +
                '<a class="mute-menu-item mute-menu-report">' + (Api.lang === 'es' ? 'Reportar spam' : 'Report spam') + '</a>' +
                '<a class="mute-menu-item mute-menu-cancel">' + (Api.lang === 'es' ? 'Cancelar' : 'Cancel') + '</a>';
            // Position near the button
            btn.style.position = 'relative';
            btn.appendChild(menu);
            // Close on outside click
            var closeMenu = function(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu, true); } };
            setTimeout(function() { document.addEventListener('click', closeMenu, true); }, 0);
            // Mute user
            menu.querySelector('.mute-menu-mute').onclick = async function(e) {
                e.stopPropagation(); menu.remove();
                document.removeEventListener('click', closeMenu, true);
                await Muted.mute(pk);
                self._removeNotesByPubkey(pk);
                btn.classList.add('muted');
                btn.title = 'Muted';
            };
            // Report spam (NIP-56 kind 1984)
            menu.querySelector('.mute-menu-report').onclick = async function(e) {
                e.stopPropagation(); menu.remove();
                document.removeEventListener('click', closeMenu, true);
                if (!Events.canSign()) { alert('Login with nsec or extension to report.'); return; }
                var noteId = btn.dataset.id;
                try {
                    // Mute locally too
                    await Muted.mute(pk);
                    // Publish NIP-56 report (kind 1984)
                    var tags = [['p', pk, 'spam']];
                    if (noteId) tags.push(['e', noteId, 'spam']);
                    var ev = await Events.create(1984, '', tags);
                    var signed = await Events.sign(ev);
                    Pool.publish(signed);
                    self._removeNotesByPubkey(pk);
                    btn.classList.add('muted');
                    btn.title = 'Reported & Muted';
                } catch(err) { alert('Error: ' + err.message); }
            };
            // Cancel
            menu.querySelector('.mute-menu-cancel').onclick = function(e) {
                e.stopPropagation(); menu.remove();
                document.removeEventListener('click', closeMenu, true);
            };
        },

        async sendReaction(noteId, pk) {
            if (!Events.canSign()) return;
            Stats._ensure(noteId);
            if (Stats.counts[noteId].liked) return; // already liked
            try {
                var ev = await Events.create(7, '+', [['e', noteId], ['p', pk]]);
                var s = await Events.sign(ev);
                Stats._seen[s.id] = true;
                Pool.publish(s);
                Stats.counts[noteId].likes++;
                Stats.counts[noteId].liked = true;
                Stats._updateDom(noteId);
            } catch(e) { console.warn('Like failed:', e); }
        },

        async sendRepost(noteId, pk, btn) {
            if (!Events.canSign()) return;
            if (btn.classList.contains('reposted')) return; // already reposted
            if (!await confirm(Api.lang === 'es' ? 'Repostear esta nota?' : 'Repost this note?')) return;
            try {
                var ev = await Events.create(6, '', [['e', noteId], ['p', pk]]);
                var s = await Events.sign(ev);
                Stats._seen[s.id] = true;
                Pool.publish(s);
                Stats._ensure(noteId);
                Stats.counts[noteId].reposts++;
                Stats._updateDom(noteId);
                btn.classList.add('reposted');
            } catch(e) { console.warn('Repost failed:', e); }
        },

        showLnurlSetupDialog: function(address) {
            var overlay = document.createElement('div'); overlay.className = 'noxtr-zap-overlay';
            var dialog = document.createElement('div'); dialog.className = 'noxtr-zap-dialog';
            dialog.innerHTML =
                '<div class="noxtr-zap-dialog-header"><strong>Lightning Address</strong></div>' +
                '<div class="noxtr-lnurl-help">' +
                '<p>Tu Lightning Address <code>' + escapeHtml(address) + '</code> se ha publicado en Nostr, pero el endpoint LNURL-pay no responde correctamente en este servidor.</p>' +
                '<p>Para que las Lightning Addresses funcionen, el servidor debe redirigir las peticiones <code>/.well-known/lnurlp/&lt;username&gt;</code> al handler PHP incluido en Noxtr.</p>' +
                '<hr>' +
                '<p><strong>Apache</strong></p>' +
                '<p>A\u00f1ade esta l\u00ednea en el <code>.htaccess</code> ra\u00edz, <strong>antes</strong> de la regla <code>RewriteRule ^(.*)$ index.php</code>:</p>' +
                '<pre>RewriteRule ^\\.well-known/lnurlp/ - [L]</pre>' +
                '<hr>' +
                '<p><strong>Nginx</strong></p>' +
                '<p>A\u00f1ade este bloque en la configuraci\u00f3n del server:</p>' +
                '<pre>' +
                'location /.well-known/lnurlp/ {\n    try_files $uri /.well-known/lnurlp/index.php?$query_string;\n}</pre>' +
                '<p class="noxtr-lnurl-help-note">Despu\u00e9s de configurar, guarda tu perfil de nuevo para verificar.</p>' +
                '</div>' +
                '<div class="noxtr-zap-actions"><a class="btn btn-sm noxtr-zap-close">OK</a></div>';
            dialog.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };
            overlay.appendChild(dialog); document.body.appendChild(overlay);
        },

        startZap: function(noteId, pk) {
            var lnAddr = Profiles.lnAddress(pk);
            var name = Profiles.displayName(pk);
            // Remove any existing overlay
            var old = document.querySelector('.noxtr-zap-overlay');
            if (old) old.remove();

            var overlay = document.createElement('div');
            overlay.className = 'noxtr-zap-overlay';

            // Always show amount selector — backend decides if internal or external
            overlay.innerHTML =
                '<div class="noxtr-zap-dialog">' +
                    '<div class="noxtr-zap-dialog-header">Zap <strong>' + escapeHtml(name) + '</strong></div>' +
                    (lnAddr ? '<p class="noxtr-zap-ln-info">' + escapeHtml(lnAddr) + '</p>' : '') +
                    '<div class="noxtr-zap-amounts">' +
                        '<a class="noxtr-zap-btn" data-sats="5">5 sats</a>' +
                       // '<a class="noxtr-zap-btn" data-sats="21">21 sats</a>' +
                        '<a class="noxtr-zap-btn" data-sats="100">100 sats</a>' +
                        '<a class="noxtr-zap-btn" data-sats="500">500 sats</a>' +
                        '<a class="noxtr-zap-btn" data-sats="1000">1K sats</a>' +
                        '<a class="noxtr-zap-btn" data-sats="5000">5K sats</a>' +
                    '</div>' +
                    '<div class="noxtr-zap-custom">' +
                        '<input type="number" class="noxtr-zap-custom-input" placeholder="Custom sats" min="1" max="1000000">' +
                        '<a class="btn btn-sm btn-primary noxtr-zap-custom-btn">Zap</a>' +
                    '</div>' +
                    '<div class="noxtr-zap-status" style="display:none"></div>' +
                    '<div class="noxtr-zap-actions"><a class="btn btn-sm noxtr-zap-close">Cancel</a></div>' +
                '</div>';

            document.body.appendChild(overlay);

            // Close on overlay click or close button
            var self = this;
            overlay.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };
            overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

            // Amount button clicks
            var zapHandler = function(amount) {
                self._processZap(overlay, noteId, pk, lnAddr, amount);
            };
            overlay.querySelectorAll('.noxtr-zap-btn').forEach(function(btn) {
                btn.onclick = function() { zapHandler(parseInt(btn.dataset.sats)); };
            });
            // Custom amount
            var customBtn = overlay.querySelector('.noxtr-zap-custom-btn');
            var customInput = overlay.querySelector('.noxtr-zap-custom-input');
            if (customBtn) customBtn.onclick = function() {
                var val = parseInt(customInput.value);
                if (val && val >= 1 && val <= 1000000) zapHandler(val);
            };
            if (customInput) customInput.onkeydown = function(e) { if (e.key === 'Enter') customBtn.onclick(); };
        },

        _processZap: async function(overlay, noteId, pk, lnAddr, amount) {
            var btns = overlay.querySelector('.noxtr-zap-amounts');
            var custom = overlay.querySelector('.noxtr-zap-custom');
            var status = overlay.querySelector('.noxtr-zap-status');
            if (btns) btns.style.display = 'none';
            if (custom) custom.style.display = 'none';
            if (status) { status.style.display = ''; status.textContent = 'Processing...'; }

            try {
                var r = await Api.call('create_zap', {
                    amount: amount,
                    ln_address: lnAddr,
                    note_pubkey: pk,
                    note_id: noteId
                });

                if (r.error) {
                    // Show suggestion for "no LN address" error
                    if (r.noLnAddress) {
                        var dialog = overlay.querySelector('.noxtr-zap-dialog');
                        dialog.innerHTML =
                            '<div class="noxtr-zap-dialog-header"><strong>' + escapeHtml(Profiles.displayName(pk)) + '</strong></div>' +
                            '<p class="noxtr-zap-no-ln">This user is not registered and has no Lightning Address in their Nostr profile.</p>' +
                            '<p class="noxtr-zap-suggestion">To receive zaps, they need to add a <code>lud16</code> field (e.g. <a href="https://getalby.com" target="_blank" rel="noopener">getalby.com</a>, <a href="https://walletofsatoshi.com" target="_blank" rel="noopener">walletofsatoshi.com</a>).</p>' +
                            '<div class="noxtr-zap-actions"><a class="btn btn-sm noxtr-zap-close">OK</a></div>';
                        dialog.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };
                    } else {
                        if (status) status.textContent = 'Error: ' + (r.msg || 'Could not create invoice');
                        if (btns) btns.style.display = '';
                        if (custom) custom.style.display = '';
                    }
                    return;
                }

                // Internal transfer (recipient is registered user with balance)
                if (r.data.internal) {
                    var dialog = overlay.querySelector('.noxtr-zap-dialog');
                    dialog.innerHTML =
                        '<div class="noxtr-zap-dialog-header">Zap sent!</div>' +
                        '<p class="noxtr-zap-success">' + r.data.amount + ' sats transferred</p>' +
                        '<div class="noxtr-zap-actions"><a class="btn btn-sm btn-primary noxtr-zap-close">OK</a></div>';
                    dialog.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };
                    // Highlight zap button
                    var noteEl = document.querySelector('.note[data-id="' + noteId + '"]');
                    if (noteEl) { var zb = noteEl.querySelector('[data-action="zap"]'); if (zb) zb.classList.add('zapped'); }
                    return;
                }

                var checkoutLink = r.data.checkoutLink;
                if (!checkoutLink) {
                    if (status) status.textContent = 'Error: No checkout link received';
                    return;
                }

                // Replace dialog content with BTCPay checkout iframe
                var dialog = overlay.querySelector('.noxtr-zap-dialog');
                dialog.innerHTML =
                    '<div class="noxtr-zap-dialog-header">Pay ' + amount + ' sats</div>' +
                    '<iframe class="noxtr-zap-iframe" src="' + escapeHtml(checkoutLink) + '" frameborder="0" allowfullscreen></iframe>' +
                    '<div class="noxtr-zap-actions"><a class="btn btn-sm noxtr-zap-close">Close</a></div>';

                dialog.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };

                // Highlight the zap button on the note
                var noteEl = document.querySelector('.note[data-id="' + noteId + '"]');
                if (noteEl) {
                    var zapBtn = noteEl.querySelector('[data-action="zap"]');
                    if (zapBtn) zapBtn.classList.add('zapped');
                }
            } catch(e) {
                if (status) status.textContent = 'Error: ' + e.message;
                if (btns) btns.style.display = '';
                if (custom) custom.style.display = '';
            }
        },

        async toggleBookmark(btn) {
            var evId = btn.dataset.id;
            if (Bookmarks.has(evId)) {
                await Bookmarks.remove(evId);
                btn.classList.remove('bookmarked');
                btn.querySelector('svg path').setAttribute('fill', 'none');
            } else {
                var note = Feed.notes.find(function(n) { return n.id === evId; })
                    || (Articles._currentArticle && Articles._currentArticle.id === evId ? Articles._currentArticle : null)
                    || (Threads.notes ? Threads.notes.find(function(n) { return n.id === evId; }) : null);
                if (note) { await Bookmarks.add(note); btn.classList.add('bookmarked'); btn.querySelector('svg path').setAttribute('fill', 'currentColor'); }
            }
        },

        showProfilePopup: function(pubkey) {
            var self = this;
            var isEs = Api.lang === 'es';
            var name = Profiles.displayName(pubkey);
            var npub = npubEncode(pubkey);
            var avatar = Profiles.avatar(pubkey);
            var color = Profiles.color(pubkey);
            var ini = (name[0] || '?').toUpperCase();
            var isFollowed = Contacts.isFollowing(pubkey);
            var isOwn = pubkey === Events.pubkey;
            var canAct = !!Api.userId;

            var avatarHtml = avatar
                ? '<img class="profile-popup-avatar profile-popup-avatar-img" src="'+escapeHtml(avatar)+'">'
                : '<div class="profile-popup-avatar profile-popup-avatar-letter" style="background:'+color+';">'+ini+'</div>';

            var content = '<div class="profile-popup">' +
                '<div class="profile-popup-header">' +
                avatarHtml +
                '<div class="profile-popup-meta"><div class="profile-popup-name">'+escapeHtml(name)+'</div>' +
                '<div class="profile-popup-npub">'+shortKey(npub)+'</div></div></div>' +
                '<div class="profile-popup-actions">' +
                '<a class="btn btn-sm btn-primary profile-popup-btn" id="pp-notes">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                    (isEs ? 'Ver notas' : 'View notes') + '</a>' +
                (!isOwn && canAct ? '<a class="btn btn-sm profile-popup-btn' + (isFollowed ? ' btn-danger' : '') + '" id="pp-follow">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/>' + (isFollowed ? '' : '<line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>') + '</svg>' +
                    (isFollowed ? (isEs ? 'Dejar de seguir' : 'Unfollow') : (isEs ? 'Seguir' : 'Follow')) + '</a>' : '') +
                '<a class="btn btn-sm profile-popup-btn" id="pp-copy">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                    (isEs ? 'Copiar npub' : 'Copy npub') + '</a>' +
                '</div></div>';

            $("body").dialog({
                title: isEs ? 'Perfil' : 'Profile',
                type: 'html',
                width: '320px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [{
                    text: isEs ? 'Cerrar' : 'Close',
                    class: 'btn btn-cancel',
                    action: function(event, overlay) { document.body.removeChild(overlay); }
                }]
            });

            // Bind actions after dialog is rendered
            setTimeout(function() {
                var btnNotes = document.getElementById('pp-notes');
                var btnFollow = document.getElementById('pp-follow');
                var btnCopy = document.getElementById('pp-copy');

                if (btnNotes) btnNotes.onclick = function() {
                    var ov = btnNotes.closest('.wq-dialog-overlay');
                    if (ov) document.body.removeChild(ov);
                    ProfileView.open(pubkey);
                };

                if (btnFollow) btnFollow.onclick = async function() {
                    if (Contacts.isFollowing(pubkey)) {
                        await Contacts.remove(pubkey);
                    } else {
                        await Contacts.add(pubkey, name);
                    }
                    // Close and reopen to reflect new state
                    var ov = btnFollow.closest('.wq-dialog-overlay');
                    if (ov) document.body.removeChild(ov);
                    // Refresh follow buttons in feed
                    document.querySelectorAll('.action-follow[data-pubkey="'+pubkey+'"]').forEach(function(b) {
                        var nowFollowed = Contacts.isFollowing(pubkey);
                        b.classList.toggle('followed', nowFollowed);
                        b.title = nowFollowed ? 'Unfollow' : 'Follow';
                    });
                };

                if (btnCopy) btnCopy.onclick = function() {
                    navigator.clipboard.writeText(npub);
                    btnCopy.textContent = isEs ? 'Copiado!' : 'Copied!';
                    setTimeout(function() {
                        var ov = btnCopy.closest('.wq-dialog-overlay');
                        if (ov) document.body.removeChild(ov);
                    }, 800);
                };

            }, 50);
        },

        async toggleFollow(btn) {
            var pk = btn.dataset.pubkey;
            if (Contacts.isFollowing(pk)) {
                await Contacts.remove(pk);
                btn.classList.remove('followed');
                btn.title = 'Follow';
            } else {
                var name = Profiles.displayName(pk);
                await Contacts.add(pk, name);
                btn.classList.add('followed');
                btn.title = 'Unfollow';
            }
        },

        updateRelayList: function() {
            var dots = document.getElementById('relay-dots'), st = Pool.getStatus();
            // Update header dots
            if (dots) { dots.innerHTML = st.map(function(r) { return '<span class="relay-dot relay-'+r.status+'" title="'+escapeHtml(r.url)+': '+r.status+'"></span>'; }).join(''); }
            // Re-render sidebar relay panel if visible
            if (this.currentTab === 'relays') Relays.render();
        },

        updateIdentity: function() {
            var el = document.getElementById('identity-info'), comp = document.getElementById('compose-area'), nsecDiv = document.getElementById('nsec-login'), btnProfile = document.getElementById('btn-edit-profile');
            var compToggle = document.getElementById('btn-toggle-compose');
            var nip46Connect = document.getElementById('nip46-connect');
            var btnNip46Disconnect = document.getElementById('btn-nip46-disconnect');
            var btnBunkerOpen = document.getElementById('btn-bunker-open');
            var showToggleTab = this.currentTab === 'topics' || this.currentTab === 'following';
            if (Events.pubkey) {
                var npub = npubEncode(Events.pubkey), method = Events.useExtension ? 'NIP-07' : Events.useNip46 ? 'NIP-46' : (Events.privkey ? 'nsec' : 'read-only'), cs = Events.canSign();
                var isEs = Api.lang === 'es';
                var displayName = Profiles.displayName(Events.pubkey);
                var showName = displayName !== shortKey(npub);
                var logoutBtn = '<a class="btn btn-sm btn-danger identity-logout" title="Logout Nostr">X</a>';
                el.innerHTML = '<span class="identity-dot '+(cs ? 'identity-active' : 'identity-readonly')+'"> </span>'+(showName ? '<strong class="btn btn-sm btn-info identity-name">'+escapeHtml(displayName)+'</strong>' : '')+'<span class="btn btn-sm btn-dark identity-npub" title="'+(isEs ? 'Copiar npub' : 'Copy npub')+'">'+shortKey(npub)+'</span><span class="btn btn-sm btn-gray identity-method">'+method+'</span>'+logoutBtn;
                var npubEl = el.querySelector('.identity-npub');
                if (npubEl) npubEl.onclick = function() {
                    var original = shortKey(npub);
                    copyText(npub).then(function() {
                        npubEl.textContent = isEs ? 'Copiado' : 'Copied';
                        npubEl.classList.add('identity-npub-copied');
                        npubEl.title = npub;
                        setTimeout(function() {
                            if (!npubEl.parentNode) return;
                            npubEl.textContent = original;
                            npubEl.classList.remove('identity-npub-copied');
                            npubEl.title = isEs ? 'Copiar npub' : 'Copy npub';
                        }, 1400);
                    }).catch(function() {
                        npubEl.title = npub;
                    });
                };
                var logoutEl = el.querySelector('.identity-logout');
                if (logoutEl) logoutEl.onclick = function() {
                    Events.pubkey = null; Events.privkey = null;
                    Events.useExtension = false; Events.useNip46 = false;
                    Contacts.list = []; updateBadge('badge-following', 0); updateBadge('badge-followers', 0);
                    localStorage.removeItem('noxtr_npub');
                    localStorage.removeItem('noxtr_nip46');
                    sessionStorage.setItem('noxtr_logged_out', '1');
                    // Reset avatar and banner to defaults
                    var banEl = document.getElementById('noxtr-banner'); if (banEl) banEl.src = banEl.src.replace(/\/[^\/]+$/, '/banner-default.jpg');
                    var avEl = document.getElementById('noxtr-avatar'); if (avEl) avEl.src = avEl.src.replace(/\/[^\/]+$/, '/avatar.gif');
                    // Disconnect relays
                    Pool.disconnectAll();
                    UI.updateIdentity();
                    UI.switchTab('topics');
                };
                if (comp) comp.style.display = 'none';
                if (compToggle) { compToggle.style.display = cs && showToggleTab ? '' : 'none'; compToggle.classList.remove('active'); }
                if (nsecDiv) {
                    if (cs) { nsecDiv.style.display = 'none'; }
                    else if (!Api.userId && Events.pubkey) {
                        // npub read-only without web login: hide nsec input (× button handles logout)
                        nsecDiv.style.display = 'none';
                    } else { nsecDiv.style.display = ''; }
                }
                if (btnProfile) btnProfile.style.display = cs ? '' : 'none';
                if (nip46Connect) nip46Connect.style.display = cs ? 'none' : '';
                if (btnNip46Disconnect) btnNip46Disconnect.style.display = Events.useNip46 ? '' : 'none';
                // Bunker: solo visible cuando el usuario tiene nsec (no con extensión ni NIP-46)
                if (btnBunkerOpen) btnBunkerOpen.style.display = Events.privkey ? '' : 'none';

                // Update banner and avatar from Nostr profile (fallback when DB has no custom image)
                var prof = Profiles.get(Events.pubkey);
                if (prof) {
                    if (prof.banner && !DeadDomains.isDead(DeadDomains.domainOf(prof.banner))) { var banEl = document.getElementById('noxtr-banner'); if (banEl && banEl.src.indexOf('banner-default') !== -1) banEl.src = prof.banner; }
                    if (prof.picture && !DeadDomains.isDead(DeadDomains.domainOf(prof.picture))) { var avEl = document.getElementById('noxtr-avatar'); if (avEl && (avEl.src.indexOf('avatar.gif') !== -1 || avEl.src.indexOf('avatar-default') !== -1)) avEl.src = prof.picture; }
                    // Cache images locally if not already present on server (once per session)
                    if (Api.userId && !UI._nostrImagesCached && (prof.picture || prof.banner)) {
                        UI._nostrImagesCached = true;
                        Api.call('cache_nostr_images', { avatar_url: prof.picture || '', banner_url: prof.banner || '' });
                    }
                }
            } else {
                el.innerHTML = '<span class="identity-anon">' + (Api.lang === 'es' ? 'Anónimo - solo lectura' : 'Anonymous - read only') + '</span>';
                if (comp) comp.style.display = 'none';
                if (compToggle) { compToggle.style.display = 'none'; compToggle.classList.remove('active'); }
                if (nsecDiv) {
                    nsecDiv.style.display = '';
                    var nsecInput = document.getElementById('nsec-input');
                    var btnNsec = document.getElementById('btn-nsec-login');
                    if (nsecInput) nsecInput.style.display = '';
                    if (btnNsec) { btnNsec.textContent = 'Login'; btnNsec.dataset.mode = 'login'; }
                    var safeHint = nsecDiv.querySelector('.nsec-safe-hint');
                    if (safeHint) safeHint.style.display = '';
                }
                if (btnProfile) btnProfile.style.display = 'none';
                if (nip46Connect) nip46Connect.style.display = Events.useExtension ? 'none' : '';
                if (btnNip46Disconnect) btnNip46Disconnect.style.display = 'none';
                if (btnBunkerOpen) btnBunkerOpen.style.display = 'none';
            }
            ProfileView.renderOwn();
        },

        updateTimes: function() {
            document.querySelectorAll('.note-time').forEach(function(el) {
                var note = el.closest('.note'); if (!note) return;
                var ev = Feed.notes.find(function(n) { return n.id === note.dataset.id; });
                if (ev) el.textContent = timeAgo(ev.created_at);
            });
        }
    };

    // ==================== INDEXEDDB KEY LOADER ====================

    function loadStoredKeys(userId) {
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open('JuxNostrKeys', 1);
                req.onerror = function() { resolve(null); };
                req.onupgradeneeded = function(e) { e.target.transaction.abort(); resolve(null); };
                req.onsuccess = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('keys')) { db.close(); resolve(null); return; }
                    try {
                        var tx = db.transaction('keys', 'readonly');
                        var store = tx.objectStore('keys');
                        var keyId = userId ? 'user_' + userId : 'guest';
                        var get = store.get(keyId);
                        get.onsuccess = function() {
                            if (get.result && get.result.privkeyHex) { db.close(); resolve(get.result); return; }
                            // Fallback: if logged in but key stored as 'guest' (registration timing issue)
                            if (userId) {
                                try {
                                    var tx2 = db.transaction('keys', 'readonly');
                                    var store2 = tx2.objectStore('keys');
                                    var get2 = store2.get('guest');
                                    get2.onsuccess = function() {
                                        if (get2.result && get2.result.privkeyHex) {
                                            // Migrate guest entry to user_<id>
                                            var entry = get2.result;
                                            try {
                                                var tx3 = db.transaction('keys', 'readwrite');
                                                var store3 = tx3.objectStore('keys');
                                                store3.put({ id: 'user_' + userId, userId: userId, npub: entry.npub, nsec: entry.nsec, pubkeyHex: entry.pubkeyHex, privkeyHex: entry.privkeyHex, createdAt: entry.createdAt, createdOn: entry.createdOn });
                                                store3.delete('guest');
                                                tx3.oncomplete = function() { db.close(); resolve(entry); };
                                                tx3.onerror = function() { db.close(); resolve(entry); };
                                            } catch(er) { db.close(); resolve(entry); }
                                        } else { db.close(); resolve(null); }
                                    };
                                    get2.onerror = function() { db.close(); resolve(null); };
                                } catch(er) { db.close(); resolve(null); }
                            } else { db.close(); resolve(null); }
                        };
                        get.onerror = function() { db.close(); resolve(null); };
                    } catch(er) { db.close(); resolve(null); }
                };
            } catch(er) { resolve(null); }
        });
    }

    function saveKeysToIndexedDB(userId, npub, nsec, pubkeyHex, privkeyHex) {
        try {
            var req = indexedDB.open('JuxNostrKeys', 1);
            req.onsuccess = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('keys')) { db.close(); return; }
                var tx = db.transaction('keys', 'readwrite');
                var store = tx.objectStore('keys');
                store.put({ id: 'user_' + userId, userId: userId, npub: npub, nsec: nsec, pubkeyHex: pubkeyHex, privkeyHex: privkeyHex, createdAt: new Date().toISOString(), createdOn: window.location.hostname });
                tx.oncomplete = function() { db.close(); };
                tx.onerror = function() { db.close(); };
            };
        } catch(e) { console.warn('IndexedDB save failed:', e); }
    }

    // ==================== AUTO-LOGIN VIA NOSTR ====================

    async function autoLoginNostr() {
        if (!Events.canSign() || Api.userId || !Api.loginAjaxUrl) return false;
        try {
            // Step 1: Request challenge
            var cResp = await fetch(Api.loginAjaxUrl + '/op=nostr_challenge_for_pubkey', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'pubkey=' + encodeURIComponent(Events.pubkey)
            });
            var cData = await cResp.json();
            if (!cData.success) return false;

            // Step 2: Create & sign kind 22242 auth event
            var authEvent = await Events.create(22242, '', [['challenge', cData.challenge], ['domain', window.location.hostname]]);
            var signedEvent = await Events.sign(authEvent);

            // Step 3: Verify on server (creates/logs in user, sets PHP session)
            var vResp = await fetch(Api.loginAjaxUrl + '/op=nostr_verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'event=' + encodeURIComponent(JSON.stringify(signedEvent))
            });
            var vData = await vResp.json();
            if (!vData.success) return false;

            // Step 4: Reload to pick up the new PHP session
            window.location.reload();
            return true;
        } catch (e) {
            console.error('Noxtr auto-login error:', e);
            return false;
        }
    }

    // ==================== ADD TO HOME SCREEN ====================

    var A2HS = {
        _prompt: null,

        init: function() {
            // Skip if already running as installed PWA
            if (window.matchMedia('(display-mode: standalone)').matches) return;
            if (window.navigator.standalone === true) return;
            // Skip on non-touch (desktop)
            if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
            // Skip if dismissed recently (7 days)
            try {
                var ts = localStorage.getItem('noxtr_a2hs_ts');
                if (ts && Date.now() - parseInt(ts, 10) < 7 * 86400000) return;
            } catch(e) {}

            var ua = navigator.userAgent;
            var isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
            var isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS/i.test(ua);

            // Android/Chrome: intercept native install prompt
            window.addEventListener('beforeinstallprompt', function(e) {
                e.preventDefault();
                A2HS._prompt = e;
                setTimeout(function() { A2HS._show(true); }, 3500);
            });

            // iOS Safari: manual instructions banner
            if (isIOSSafari) {
                setTimeout(function() { A2HS._show(false); }, 3500);
            }
        },

        _show: function(native) {
            if (document.getElementById('noxtr-a2hs')) return;
            var es = Api.lang === 'es';
            var msg, btn;

            if (native) {
                msg = es ? '<b>Instalar Noxtr</b> en tu pantalla de inicio para acceso r&aacute;pido'
                         : '<b>Install Noxtr</b> on your home screen for quick access';
                btn = '<button id="noxtr-a2hs-btn">' + (es ? 'Instalar' : 'Install') + '</button>';
            } else {
                msg = es ? '<b>Instala Noxtr:</b> toca el bot&oacute;n Compartir (&#9650;) y luego <b>&laquo;A&ntilde;adir a inicio&raquo;</b>'
                         : '<b>Install Noxtr:</b> tap the Share button (&#9650;) then <b>&laquo;Add to Home Screen&raquo;</b>';
                btn = '';
            }

            var el = document.createElement('div');
            el.id = 'noxtr-a2hs';
            el.innerHTML = '<span class="noxtr-a2hs-msg">' + msg + '</span>'
                + '<div class="noxtr-a2hs-actions">' + btn + '</div>'
                + '<button id="noxtr-a2hs-close" title="' + (es ? 'Cerrar' : 'Dismiss') + '">&#10005;</button>';
            document.body.appendChild(el);
            requestAnimationFrame(function() { el.classList.add('visible'); });

            if (native && A2HS._prompt) {
                document.getElementById('noxtr-a2hs-btn').onclick = async function() {
                    A2HS._prompt.prompt();
                    await A2HS._prompt.userChoice;
                    el.remove();
                    A2HS._prompt = null;
                };
            }

            document.getElementById('noxtr-a2hs-close').onclick = function() {
                el.classList.remove('visible');
                setTimeout(function() { el.remove(); }, 300);
                try { localStorage.setItem('noxtr_a2hs_ts', String(Date.now())); } catch(e) {}
            };
        }
    };

    // ==================== PUBLIC API ====================

    window.Noxtr = {
        Pool: Pool, Profiles: Profiles, Events: Events, Feed: Feed, UI: UI, Threads: Threads, Articles: Articles,
        Contacts: Contacts, Topics: Topics, Bookmarks: Bookmarks, Followers: Followers, Muted: Muted, DMs: DMs, Nip44: Nip44, Nip46: Nip46, Bunker: Bunker, Search: Search, ProfileView: ProfileView,
        npubEncode: npubEncode, npubDecode: npubDecode, nsecDecode: nsecDecode, noteEncode: noteEncode, noteDecode: noteDecode, nprofileDecode: nprofileDecode, neventDecode: neventDecode, naddrEncode: naddrEncode, naddrDecode: naddrDecode,

        initCollapsibles: function() {
            document.querySelectorAll('.collapsible-toggle').forEach(function(btn) {
                if (btn._bound) return; btn._bound = true;
                var wrap = btn.closest('.collapsible-wrap');
                var panel = wrap ? wrap.closest('[id]') : null;
                var key = panel ? 'noxtr_col_' + panel.id : null;
                // Restore saved state
                if (key) {
                    var saved = localStorage.getItem(key);
                    if (saved === '1') wrap.classList.add('collapsed');
                    else if (saved === '0') wrap.classList.remove('collapsed');
                }
                btn.onclick = function() {
                    if (wrap) {
                        wrap.classList.toggle('collapsed');
                        if (key) localStorage.setItem(key, wrap.classList.contains('collapsed') ? '1' : '0');
                    }
                };
            });
        },

        logout: function() {
            // Disconnect all relay WebSockets
            Pool.disconnectAll();

            // Disconnect NIP-46 if active
            if (Nip46.connected) Nip46.disconnect();

            // Disconnect Bunker if active
            if (Bunker.active) Bunker.stop();

            // Clear identity state
            Events.pubkey = null;
            Events.privkey = null;
            Events.useExtension = false;
            Events.useNip46 = false;

            // Clear contacts and other in-memory data
            Contacts.list = [];

            // Clear localStorage keys
            try {
                localStorage.removeItem('noxtr_npub');
                localStorage.removeItem('noxtr_nip46');
                localStorage.removeItem('noxtr_bunker');
            } catch(e) {}

            // Mark session as logged out so init() doesn't restore stale identity
            try { sessionStorage.setItem('noxtr_logged_out', '1'); } catch(e) {}

            // Note: IndexedDB keys (JuxNostrKeys) are preserved — they are keyed
            // by userId and will be used for "Login with Nostr" on the web login page.
        },

        init: async function(config) {
            config = config || {};
            Api.url = config.ajaxUrl || '';
            Api.csrfToken = config.csrfToken || '';
            Api.userId = config.userId || 0;
            Api.username = config.username || '';
            Api.lang = config.lang || 'en';
            Api.loginAjaxUrl = config.loginAjaxUrl || '';

            // Detect web user switch: if a different user is now logged in, clear stale identity
            var _prevSessionUid = sessionStorage.getItem('noxtr_session_uid');
            if (_prevSessionUid !== null && _prevSessionUid !== String(Api.userId)) {
                try { localStorage.removeItem('noxtr_npub'); localStorage.removeItem('noxtr_nip46'); } catch(e) {}
                sessionStorage.removeItem('noxtr_logged_out');
            }
            sessionStorage.setItem('noxtr_session_uid', String(Api.userId));

            Feed.init(document.getElementById('feed'), document.getElementById('feed-loading'));
            UI.init();
            Noxtr.initCollapsibles();
            A2HS.init();

            var auth = await Events.init();
            if (!auth.pubkey && config.pubkey) Events.setPubkey(config.pubkey);

            // Auto-load nsec from framework's IndexedDB if available
            if (!Events.canSign() && !sessionStorage.getItem('noxtr_logged_out')) {
                try {
                    var stored = await loadStoredKeys(config.userId);
                    if (stored && stored.privkeyHex) { Events.setPrivkey(stored.privkeyHex); }
                } catch(e) { console.error('[Noxtr init] Auto-load nsec failed:', e); }
            }

            // Restore NIP-46 session if no signing method yet
            if (!Events.canSign() && !sessionStorage.getItem('noxtr_logged_out')) {
                try { await Nip46.restore(); } catch(e) {}
            }

            // Restore npub from localStorage (read-only mode)
            if (!Events.pubkey && !sessionStorage.getItem('noxtr_logged_out')) {
                var savedNpub = localStorage.getItem('noxtr_npub');
                if (savedNpub) Events.setPubkey(savedNpub);
            }

            UI.updateIdentity();

            // Load DB data if logged in
            if (Api.userId) {
                await Contacts.load();
                await Topics.load();
                // Si no hay topics activos, activar "All" por defecto para que el usuario vea contenido
                if (!Topics.active().length) { Topics.showAll = true; }
                await Bookmarks.load();
                await Muted.load();
                await Relays.load();
            }

            // Connect to relays (from DB if available, otherwise defaults)
            Relays.connectAll();

            // Restore Bunker sessions DESPUÉS de Relays.load() para que disabledUrls esté poblado
            if (Events.privkey && !sessionStorage.getItem('noxtr_logged_out')) {
                try { await Bunker.restore(); } catch(e) {}
            }

            // Request own profile so identity-name, picture, nip05 are available immediately
            if (Events.pubkey) {
                Profiles.request(Events.pubkey);
            }

            // Update avatar from DB profile for logged-in users (fixes relative path issue in PHP)
            if (Api.userId) {
                var avatarResp = await Api.call('get_profile');
                if (!avatarResp.error && avatarResp.data && avatarResp.data.picture) {
                    var avatarEl = document.getElementById('noxtr-avatar');
                    if (avatarEl) avatarEl.src = avatarResp.data.picture;
                }
            }

            // Start with permalink note/article/profile or default topics feed
            if (config.noteId) {
                setTimeout(function() { Threads.openById(config.noteId); }, 800);
            } else if (config.articleId) {
                setTimeout(function() { Articles.openByNaddr(config.articleId); }, 800);
            } else if (config.profileId) {
                setTimeout(function() {
                    var raw = config.profileId;
                    var pk = null;
                    if (raw.indexOf('npub1') === 0) pk = npubDecode(raw);
                    else if (raw.indexOf('nprofile1') === 0) { var np = nprofileDecode(raw); if (np) pk = np.pubkey; }
                    else if (/^[0-9a-f]{64}$/.test(raw)) pk = raw;
                    if (pk) {
                        ProfileView.open(pk, false);
                    } else {
                        UI.switchTab('topics');
                    }
                }, 800);
            } else if (config.peerId) {
                setTimeout(function() {
                    var raw = config.peerId;
                    var pk = null;
                    if (raw.indexOf('npub1') === 0) pk = npubDecode(raw);
                    else if (/^[0-9a-f]{64}$/.test(raw)) pk = raw;
                    if (pk) {
                        DMs._pendingOpenPeer = pk;
                        UI.switchTab('messages', false);
                    } else {
                        UI.switchTab('messages');
                    }
                }, 800);
            } else if (config.channelId) {
                setTimeout(function() {
                    var raw = config.channelId;
                    var hexId = null;
                    if (raw.indexOf('note1') === 0) hexId = noteDecode(raw);
                    else if (/^[0-9a-f]{64}$/.test(raw)) hexId = raw;
                    if (hexId) {
                        UI.switchTab('channels', false);
                        Channels.joinChannel(hexId).then(function() { Channels.openRoom(hexId); });
                    } else {
                        UI.switchTab('channels');
                    }
                }, 800);
            } else {
                setTimeout(function() { UI.switchTab(config.tabId || 'topics'); }, 800);
            }

            // Subscribe for followers count (badge) after relays connect
            if (Events.pubkey) {
                setTimeout(function() { Followers.subscribe(); }, 1200);
            }

            // Load contacts and re-request profile for npub read-only users (no DB)
            if (Events.pubkey && !Api.userId) {
                setTimeout(function() {
                    loadContactsFromRelay();
                    // Re-request profile after relays are connected (ensures avatar/banner load)
                    Profiles.pending[Events.pubkey] = true;
                    Profiles._schedule();
                }, 1000);
            }
        }
    };

    // Expose _mediaError globally for inline onerror handlers
    window._mediaError = _mediaError;
    // Expose Feed.renderNote for testing (e.g. ar_profile cards)
    window._noxtrRenderNote = function(ev) { return Feed.renderNote(ev); };

    // Delegated click handler for dead-domain retry
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.dead-domain-retry');
        if (!btn) return;
        e.preventDefault();
        var wrap = btn.closest('.note-dead-media');
        if (!wrap) return;
        var src = wrap.dataset.src, type = wrap.dataset.type;
        var domain = DeadDomains.domainOf(src);
        DeadDomains.revive(domain);
        if (type === 'video') {
            wrap.outerHTML = '<div class="note-media"><video src="'+escapeHtml(src)+'" controls preload="metadata" onerror="_mediaError(this)"></video></div>';
        } else {
            wrap.outerHTML = '<div class="note-media"><img class="open_file_image" src="'+escapeHtml(src)+'" loading="lazy" onerror="_mediaError(this)"></div>';
        }
    });

    // Global capture-phase error handler: catch ANY img/video load failure inside noxtr
    // and mark the domain as dead (covers avatars, banners, etc.)
    document.addEventListener('error', function(e) {
        var el = e.target;
        if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO') return;
        if (!el.closest('#noxtr, .noxtr, [id^="noxtr"]')) return;
        var src = el.src || el.currentSrc || '';
        if (!src || src.indexOf('data:') === 0) return;
        var domain = DeadDomains.domainOf(src);
        if (domain) DeadDomains.mark(domain);
    }, true); // true = capture phase, fires before inline onerror

})();
