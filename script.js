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
        verboseEnabled: function() {
            try {
                if (window.NOXTR_DEBUG_VERBOSE === true) return true;
                return localStorage.getItem('noxtr_debug_verbose') === '1';
            } catch(e) {
                return false;
            }
        },
        trace: function() {
            if (!this.verboseEnabled()) return;
            console.debug.apply(console, arguments);
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

    // NIP-89: identify the publishing client. Default ON (futuro: flag en CFG_CFG).
    // Solo en eventos publicos (notas/articulos/citas/reacciones); nunca en DMs ni gift wraps.
    var NOXTR_CLIENT_NAME = 'Noxtr';
    var NOXTR_SEND_CLIENT_TAG = true;
    function clientTag() { return NOXTR_SEND_CLIENT_TAG ? ['client', NOXTR_CLIENT_NAME] : null; }
    function pushClientTag(tags) { var c = clientTag(); if (c) tags.push(c); return tags; }

    function escapeHtml(text) {
        return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
        // Un dominio solo se da por muerto tras varios fallos distintos. Asi un unico fichero borrado o
        // prohibido (403) en un CDN compartido (p.ej. media.pubeurope.com, Mastodon) no condena el resto
        // de imagenes validas del mismo dominio. Cada imagen fallida sigue mostrando su placeholder via
        // _mediaError; este umbral solo gobierna la supresion PROACTIVA del resto del dominio.
        _THRESHOLD: 5,
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
            return (entry.count || 0) >= this._THRESHOLD;
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
        nip11: {}, // url → NIP-11 relay info document
        // Visor de eventos: matriz kind x relay (recibidos) + totales por relay
        metrics: { relays: {}, mat: {} },
        _mRelay: function(url, field) {
            var r = this.metrics.relays[url] || (this.metrics.relays[url] = { sent: 0, recv: 0, ok: 0, rejected: 0, rl: 0 });
            if (r[field] != null) r[field]++;
        },
        _mRecv: function(url, kind) {
            this._mRelay(url, 'recv');
            if (kind == null) return;
            var row = this.metrics.mat[kind] || (this.metrics.mat[kind] = {});
            row[url] = (row[url] || 0) + 1;
        },

        connect: function(url) {
            url = url.trim().replace(/\/+$/, '');
            if (this.relays[url]) return;
            this.relays[url] = { ws: null, status: 'connecting', rc: 0, timer: null };
            this._fetchNip11(url);
            this._open(url);
        },

        _nip11Promises: {}, // url → Promise (for waitNip11)
        _fetchNip11: function(url) {
            var self = this;
            // Load cached data immediately so maxPowDifficulty() works before fetch completes
            try {
                var cached = JSON.parse(localStorage.getItem('nip11_' + url) || 'null');
                if (cached) self.nip11[url] = cached;
            } catch(e) {}
            // Fetch fresh in background and update cache
            var httpUrl = url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
            this._nip11Promises[url] = fetch(httpUrl, { headers: { 'Accept': 'application/nostr+json' } })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(info) {
                    if (info) {
                        self.nip11[url] = info;
                        try { localStorage.setItem('nip11_' + url, JSON.stringify(info)); } catch(e) {}
                    }
                })
                .catch(function() {});
        },


        // Returns the highest min_pow_difficulty across all relays with NIP-11 info
        maxPowDifficulty: function() {
            var max = 0;
            for (var url in this.nip11) {
                var d = ((this.nip11[url].limitation || {}).min_pow_difficulty) || 0;
                if (d > max) max = d;
            }
            return max;
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
        // Fuerza cierre y reconexión de todos los relays conservando las suscripciones
        // (onopen las re-envía). Para sockets zombis tras un reposo del equipo: el TCP
        // está muerto pero el estado sigue 'connected' y onclose no llega a saltar, así
        // que dejan de entrar eventos (38385, orderbook, DMs...) sin ningún error visible.
        reconnectAll: function() {
            for (var url in this.relays) {
                var r = this.relays[url];
                clearTimeout(r.timer); r.rc = 0;
                try {
                    if (r.ws && (r.ws.readyState === 0 || r.ws.readyState === 1)) r.ws.close();
                    else this._open(url);
                } catch(e) { this._open(url); }
            }
        },
        _msg: function(msg, url) {
            if (msg[0] === 'EVENT') { this._mRecv(url, msg[2] && msg[2].kind); var s = this.subs[msg[1]]; if (s && s.onEvent) s.onEvent(msg[2], url); }
            else if (msg[0] === 'EOSE') { var s = this.subs[msg[1]]; if (s && s.onEOSE) s.onEOSE(msg[1], url); }
            else if (msg[0] === 'OK') {
                var _okAccepted = msg[2], _okNotice = msg[3] || '';
                if (_okAccepted) NoxtrDebug.trace('[Pool._msg][OK]', url, { event_id: msg[1], accepted: true, message: _okNotice });
                else console.warn('[Pool._msg][OK]', url, { event_id: msg[1], accepted: false, message: _okNotice });
                this._mRelay(url, _okAccepted ? 'ok' : 'rejected');
                // NIP-13: if relay rejects for PoW, extract and cache the required difficulty
                if (!_okAccepted && /pow/i.test(_okNotice)) {
                    var _powMatch = _okNotice.match(/(\d+)/);
                    if (_powMatch) {
                        var _d = parseInt(_powMatch[1], 10);
                        if (!this.nip11[url]) this.nip11[url] = {};
                        if (!this.nip11[url].limitation) this.nip11[url].limitation = {};
                        this.nip11[url].limitation.min_pow_difficulty = _d;
                        try { localStorage.setItem('nip11_' + url, JSON.stringify(this.nip11[url])); } catch(e) {}
                    }
                }
                // rate-limit: marca el relay como throttled para dejar de insistir. Seguir
                // mandando al mismo ritmo tras un 'rate-limited' es lo que escala a baneo.
                if (!_okAccepted && /rate.?limit/i.test(_okNotice)) {
                    var _rl = this.relays[url];
                    if (_rl) _rl._throttledUntil = Date.now() + 15000;
                    this._mRelay(url, 'rl');
                }
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
        // Conjunto de relays de feed ACTIVOS (lista del usuario; fallback a DEFAULT_RELAYS si vacía),
        // normalizados, para decidir a dónde se publican los eventos generales.
        _activeFeedSet: function() {
            var feed = (typeof Relays !== 'undefined' && Relays.activeUrls) ? Relays.activeUrls() : [];
            if (!feed.length) feed = DEFAULT_RELAYS;
            var set = {};
            for (var i = 0; i < feed.length; i++) set[String(feed[i]).trim().replace(/\/+$/, '')] = 1;
            return set;
        },
        publish: function(event) {
            NoxtrDebug.trace('[Pool.publish] kind=', event && event.kind, 'id=', (event && event.id || '').slice(0,8));
            var m = JSON.stringify(['EVENT', event]);
            var now = Date.now();
            // Publicar SOLO a relays activos de la lista de feed del usuario. Así se respeta cuando
            // desactiva un relay (antes se emitía a todo lo conectado, incl. relays que la capa NIP-46
            // reconecta como damus/nos.lol, ignorando la desactivación). Los destinos especiales van
            // por publishTo()/publishToRelays() (Mostro, on-chain, canal NIP-46).
            var allow = this._activeFeedSet();
            for (var u in this.relays) {
                if (!allow[u]) continue;
                var r = this.relays[u]; if (r.status === 'connected' && !(r._throttledUntil > now)) try { r.ws.send(m); this._mRelay(u, 'sent'); } catch(e) {}
            }
        },
        // Publica un evento SOLO a una lista concreta de relays conectados. Usado por el canal
        // NIP-46 (kind 24133): el resto de relays del feed lo bloquean / rate-limitan / no escuchan.
        publishToRelays: function(urls, event) {
            NoxtrDebug.trace('[Pool.publishToRelays] kind=', event && event.kind, 'id=', (event && event.id || '').slice(0,8), 'urls=', urls);
            var m = JSON.stringify(['EVENT', event]);
            for (var i = 0; i < urls.length; i++) {
                var u = String(urls[i]).trim().replace(/\/+$/, '');
                var r = this.relays[u];
                if (r && r.status === 'connected' && r.ws && !(r._throttledUntil > Date.now())) { try { r.ws.send(m); this._mRelay(u, 'sent'); } catch(e) {} }
            }
        },
        // Publish to a specific relay URL via a fresh temp WebSocket to bypass stale Pool connections.
        // Also sends via Pool connection if available (relay deduplicates by event ID).
        publishTo: function(url, event) {
            if (!url) return;
            NoxtrDebug.trace('[Pool.publishTo] kind=', event && event.kind, 'id=', (event && event.id || '').slice(0,8), 'url=', url);
            url = url.trim().replace(/\/+$/, '');
            var r = this.relays[url];
            if (r && r.status === 'connected' && r.ws) {
                try { r.ws.send(JSON.stringify(['EVENT', event])); this._mRelay(url, 'sent'); } catch(e) {}
            }
            // Always open a fresh temp WebSocket too — Pool connection may be TCP-stale
            // while still showing status:'connected'. Relay deduplicates by event id.
            var self = this;
            try {
                var subs = this.subs;
                var ws = new WebSocket(url);
                var m = JSON.stringify(['EVENT', event]);
                ws.onopen = function() {
                    NoxtrDebug.trace('[Pool.publishTo] temp WS conectado a', url);
                    // Send all active subscriptions so we can receive the instance's response
                    for (var id in subs) {
                        try { ws.send(JSON.stringify(['REQ', id].concat(subs[id].filters))); } catch(e2) {}
                    }
                    try { ws.send(m); } catch(e) {}
                    setTimeout(function() { try { ws.close(); } catch(e) {} }, 90000);
                };
                ws.onmessage = function(e) {
                    try {
                        var d = JSON.parse(e.data);
                        NoxtrDebug.trace('[Pool.publishTo] temp WS msg de', url, d);
                        self._msg(d, url);
                    } catch(er) {}
                };
                ws.onerror = function(err) { NoxtrDebug.warn('[Pool.publishTo] temp WS error', url, err && err.message); };
                ws.onclose = function() { NoxtrDebug.trace('[Pool.publishTo] temp WS cerrado', url); };
            } catch(e) {}
        },
        _notify: function() { if (this.onStatusChange) this.onStatusChange(); },
        getStatus: function() { var r = []; for (var u in this.relays) r.push({ url: u, status: this.relays[u].status }); return r; },

        // ---- Visor de eventos (matriz kind x relay de recibidos + totales por relay) ----
        resetMetrics: function() { this.metrics = { relays: {}, mat: {} }; },
        renderMetricsHtml: function() {
            var m = this.metrics;
            var urls = Object.keys(m.relays).sort();
            var kinds = Object.keys(m.mat).map(Number).sort(function(a, b) { return a - b; });
            var now = Date.now();
            var W = 9;
            function cell(s) { s = String(s); while (s.length < W) s = ' ' + s; return s; }
            function lab(s) { s = String(s); if (s.length > 6) s = s.slice(0, 6); while (s.length < 6) s += ' '; return s; }
            function shrt(u) { return u.replace(/^wss?:\/\//, '').replace(/^relay\./, '').replace(/\/$/, '').slice(0, 8); }
            function red(s) { return '<span style="color:#f55">' + s + '</span>'; }
            function amber(s) { return '<span style="color:#fb0">' + s + '</span>'; }
            var lines = [];
            var h = lab('k\\rly');
            for (var i = 0; i < urls.length; i++) {
                var thr = Pool.relays[urls[i]] && Pool.relays[urls[i]]._throttledUntil > now;
                h += thr ? amber(cell(shrt(urls[i]))) : cell(shrt(urls[i]));
            }
            lines.push(h);
            for (var j = 0; j < kinds.length; j++) {
                var k = kinds[j], row = lab(k);
                for (var a = 0; a < urls.length; a++) row += cell((m.mat[k] && m.mat[k][urls[a]]) || 0);
                lines.push(row);
            }
            lines.push('');
            lines.push(lab('') + cell('sent') + cell('recv') + cell('ok') + cell('rej') + cell('rl'));
            for (var b = 0; b < urls.length; b++) {
                var u = urls[b], r = m.relays[u], rel = Pool.relays[u];
                var thr2 = rel && rel._throttledUntil > now;
                var line = (thr2 ? amber(lab(shrt(u))) : lab(shrt(u)))
                    + cell(r.sent) + cell(r.recv) + cell(r.ok)
                    + (r.rejected > 0 ? red(cell(r.rejected)) : cell(r.rejected))
                    + (r.rl > 0 ? red(cell(r.rl)) : cell(r.rl));
                if (thr2) line += amber('  THROTTLE ' + Math.ceil((rel._throttledUntil - now) / 1000) + 's');
                lines.push(line);
            }
            return lines.join('\n');
        },
        _metricsTimer: null,
        toggleMetrics: function() {
            var el = document.getElementById('noxtr-metrics');
            if (el) { clearInterval(this._metricsTimer); this._metricsTimer = null; el.remove(); try { localStorage.setItem('noxtr_metrics', '0'); } catch(e) {} return; }
            try { localStorage.setItem('noxtr_metrics', '1'); } catch(e) {}
            el = document.createElement('pre');
            el.id = 'noxtr-metrics';
            el.title = 'Click: cerrar · Click derecho: reset contadores';
            var self = this;
            el.onclick = function() { self.toggleMetrics(); };
            el.oncontextmenu = function(e) { e.preventDefault(); self.resetMetrics(); el.innerHTML = self.renderMetricsHtml(); };
            document.body.appendChild(el);
            var upd = function() { el.innerHTML = self.renderMetricsHtml(); };
            upd();
            this._metricsTimer = setInterval(upd, 1000);
        }
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
                                var msg = t(str_username_updated_body, u);
                                $("body").dialog({
                title: str_username_updated_title,
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
        var icon = type === 'video' ? 'fa-film' : (type === 'audio' ? 'fa-music' : 'fa-image');
            var label = type === 'video' ? 'Video' : (type === 'audio' ? 'Audio' : str_image);
        return '<div class="note-media note-dead-media" data-src="'+escapeHtml(url)+'" data-type="'+type+'">' +
            '<i class="fa '+icon+'"></i> ' +
                    '<span>'+label+' — <b>'+escapeHtml(domain)+'</b> '+str_media_not_responding+'</span>' +
                    '<a class="dead-domain-retry" href="javascript:void(0)">'+str_retry+'</a>' +
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
            var type = el.tagName === 'VIDEO' ? 'video' : (el.tagName === 'AUDIO' ? 'audio' : 'image');
            wrap.outerHTML = _deadPlaceholder(src, type);
        } else {
            el.style.display = 'none';
        }
    }

    function parseContent(text) {
        var esc = escapeHtml(text), parts = [], re = /(!\[[^\]]*\]\(https?:\/\/[^)]+\)|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s<]+|nostr:n(?:pub|ote|profile|event|addr)1[a-z0-9]+|#[a-zA-Z0-9_]+)/gi, li = 0, m;
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
                    var _lc = '';
                    if      (/\.pdf(\?[^\s]*)?$/i.test(lnkMatch[2]))  _lc = ' open_file_pdf';
                    else if (/\.epub(\?[^\s]*)?$/i.test(lnkMatch[2])) _lc = ' open_file_epub';
                    parts.push('<a class="'+_lc+'" href="'+lnkMatch[2]+'" target="_blank" rel="noopener">'+lnkMatch[1]+'</a>');
                } else parts.push(t);
                li = re.lastIndex; continue;
            }
            // Hashtag: #tag → chip (estilo .article-tag). Solo si no va pegado a una palabra (evita #fff de un color, etc.)
            if (t[0] === '#') {
                var prevCh = m.index > 0 ? esc.charAt(m.index - 1) : '';
                if (/[a-zA-Z0-9_]/.test(prevCh)) parts.push(t);
                else parts.push('<span class="noxtr-hashtag">' + t + '</span>');
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
            } else if (/\.(mp4|webm|mov|mkv)(\?[^\s]*)?$/i.test(t)) {
                if (DeadDomains.isDead(DeadDomains.domainOf(t))) {
                    parts.push(_deadPlaceholder(t, 'video'));
                } else {
                    parts.push('<div class="note-media"><video src="'+t+'" controls preload="metadata" onerror="_mediaError(this)"></video></div>');
                }
            } else if (/\.(mp3|m4a|ogg|oga|wav)(\?[^\s]*)?$/i.test(t)) {
                parts.push('<div class="note-media"><audio src="'+t+'" controls preload="none"></audio></div>');
            } else if (/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.test(t)) {
                var vid = t.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)[1];
                parts.push('<div class="note-media note-video-embed"><iframe src="https://www.youtube-nocookie.com/embed/'+vid+'" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
              //parts.push('<div class="note-media note-video-embed"><iframe src="https://www.youtube.com/embed/'+vid+'" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
            } else if (/vimeo\.com\/(\d+)/.test(t)) {
                var vid = t.match(/vimeo\.com\/(\d+)/)[1];
                parts.push('<div class="note-media note-video-embed"><iframe src="https://player.vimeo.com/video/'+vid+'" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>');
            } else if (t.indexOf('http') === 0) {
                var url = t.replace(/[.,;:!?)]+$/, ''), trail = t.slice(url.length);
                var _pc = '';
                if      (/\.pdf(\?[^\s]*)?$/i.test(url))  _pc = ' class="open_file_pdf"';
                else if (/\.epub(\?[^\s]*)?$/i.test(url)) _pc = ' class="open_file_epub"';
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
        // Music card: imagen seguida inmediatamente de audio → carátula como fondo con player encima
        result = result.replace(
            /<div class="note-media"><img[^>]*\bsrc="([^"]+)"[^>]*><\/div>(?:<br>)*<div class="note-media"><audio[^>]*\bsrc="([^"]+)"[^>]*><\/audio><\/div>/g,
            function(_, imgSrc, audSrc) {
                return '<div class="note-media note-audio-card" style="background-image:url(\'' + imgSrc + '\')">' +
                       '<audio src="' + audSrc + '" controls preload="none"></audio></div>';
            }
        );
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
                        '<a href="'+mapUrl+'" target="_blank" rel="noopener" title="'+str_view_on_map+'">' +
                '<i class="fa fa-map-marker"></i> '+lat.toFixed(4)+', '+lon.toFixed(4)+'</a></div>';
        }

        // Actions
        if (pkHex) {
            html += '<div class="ar-card-actions">';
            html += '<a class="note-action ar-card-btn ar-card-btn-follow'+(isFollowed ? ' followed' : '')+'" data-action="follow" data-pubkey="'+pkHex+'">'  +
                            '<i class="fa fa-user-plus"></i> '+(isFollowed ? str_following : str_follow)+'</a>';
            html += '<a class="note-action ar-card-btn ar-card-btn-dm" data-action="dm" data-pubkey="'+pkHex+'">'  +
                            '<i class="fa fa-envelope"></i> '+str_message+'</a>';
            html += '</div>';
        }

        // Meta: posted by + time
        var posterName = Profiles.displayName(ev.pubkey);
        var npub = npubEncode(ev.pubkey);
        html += '<div class="ar-card-meta">' +
                    '<span class="ar-card-poster" title="'+npub+'">'+str_shared_by+escapeHtml(posterName)+'</span>' +
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
            '<a class="note-action action-reply" data-action="reply" data-id="'+ev.id+'" title="'+str_reply+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><span class="count-replies"></span></a>' +
            '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_like+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
            '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_repost+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
            '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_zap+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
            '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="'+str_bookmark+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
            '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="'+str_share+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                    '<a class="note-action action-view-raw" data-action="view-raw" title="'+str_view_raw+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></a>' +
            (!isOwn ? '<a class="note-action action-mute" data-action="mute" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_mute_report+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></a>' : '') +
            (isOwn ? '<a class="note-action note-action-delete" data-action="delete" data-id="'+ev.id+'" title="'+str_delete+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '') +
            '</div>';
        el.innerHTML = html;
        return el;
    }

    // ==================== EVENTS ====================

    var Events = {
        privkey: null, pubkey: null, useExtension: false, useNip46: false,
        init: async function() {
            if (window.nostr) {
                try { this.pubkey = await window.nostr.getPublicKey(); this.useExtension = true; return { method: 'nip07', pubkey: this.pubkey }; }
                catch(e) { console.warn('[Noxtr] Extension NIP-07 presente pero getPublicKey() fallo:', e); }
            }
            return { method: 'none', pubkey: null };
        },
        // Firefox (Nos2x-fox y similares) inyecta window.nostr desde un content script que puede
        // correr DESPUES del DOMContentLoaded en el que se llama a init(). Cuando eso pasa, la
        // extension esta instalada pero no se detecta: useExtension se queda en false y canSign()
        // responde que no hay firmador — de ahi el aviso "Necesitas nsec o extension NIP-07" en
        // DMs, canales y cualquier accion que firme. Chrome la inyecta en document_start y por eso
        // el fallo solo se veia en Firefox.
        //
        // Se vigila en segundo plano en vez de esperar dentro de init(): bloquear ahi retrasaria
        // el arranque de TODOS los usuarios (incluidos los que no tienen extension) el tiempo
        // completo del timeout. Aqui el coste es cero salvo para quien de verdad no tiene firmador.
        watchLateExtension: function(timeoutMs, onFound) {
            if (this.canSign() || window.nostr) return;
            var self = this, waited = 0, step = 100;
            var iv = setInterval(async function() {
                waited += step;
                // Otro metodo (nsec, NIP-46) gano la carrera, o el usuario cerro sesion: parar.
                if (self.canSign() || sessionStorage.getItem('noxtr_logged_out')) { clearInterval(iv); return; }
                if (!window.nostr) {
                    if (waited >= timeoutMs) clearInterval(iv);
                    return;
                }
                clearInterval(iv);
                try {
                    self.pubkey = await window.nostr.getPublicKey();
                    self.useExtension = true;
                    console.log('[Noxtr] Extension NIP-07 detectada tarde (' + waited + ' ms)');
                    if (typeof onFound === 'function') onFound();
                } catch(e) { console.warn('[Noxtr] Extension NIP-07 detectada tarde pero getPublicKey() fallo:', e); }
            }, step);
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
            pushClientTag(tags);
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
            if (!this.list.length) { el.innerHTML = '<div class="noxtr-empty">' + str_not_following_anyone + '</div>'; return; }
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

    var SUGGESTED_TOPICS = String(str_suggested_topics_csv || '').split(',')
        .map(function(topic) { return topic.trim(); })
        .filter(Boolean);

    // Topics por defecto para visitantes anónimos sin selección (por idioma, ver i18n.php).
    var DEFAULT_TOPICS = String((typeof str_default_topics_csv !== 'undefined' ? str_default_topics_csv : '') || '').split(',')
        .map(function(topic) { return topic.trim(); })
        .filter(Boolean);

    var Topics = {
        list: [], showAll: false, showHot: false,
        _localKey: 'noxtr_topics',
        // Visitante anónimo: los topics viven en localStorage (no hay user_id para la BD).
        _saveLocal: function() { try { localStorage.setItem(this._localKey, JSON.stringify(this.list)); } catch (e) {} },
        load: async function() {
            if (!Api.userId) {
                try { this.list = JSON.parse(localStorage.getItem(this._localKey) || '[]') || []; } catch (e) { this.list = []; }
                return;
            }
            var r = await Api.call('get_topics'); if (!r.error) this.list = r.data || [];
        },
        add: async function(topic) {
            if (!Api.userId) {
                var t = String(topic || '').replace(/^#+/, '').trim();
                if (t && !this.list.some(function(x) { return x.topic.toLowerCase() === t.toLowerCase(); })) {
                    this.list.push({ id: 'L' + Date.now() + Math.floor(Math.random() * 1000), topic: t, active: 1 });
                    this._saveLocal();
                }
                this.showAll = false; this.showHot = false;
                return;
            }
            var r = await Api.call('add_topic', { topic: topic });
            if (!r.error) {
                this.list = r.data || [];
                // Al añadir un topic, lo dejamos como filtro activo: quitamos los chips
                // "All"/"Hot" para que el usuario vea el feed del topic recién añadido.
                this.showAll = false;
                this.showHot = false;
            }
        },
        remove: async function(id) {
            if (!Api.userId) { this.list = this.list.filter(function(t) { return String(t.id) !== String(id); }); this._saveLocal(); return; }
            var r = await Api.call('remove_topic', { topic_id: id }); if (!r.error) this.list = r.data || [];
        },
        toggle: async function(id) {
            if (!Api.userId) { this.list.forEach(function(t) { if (String(t.id) === String(id)) t.active = (t.active == 1 ? 0 : 1); }); this._saveLocal(); return; }
            var r = await Api.call('toggle_topic', { topic_id: id }); if (!r.error) this.list = r.data || [];
        },
        // Al loguearse, vuelca los topics elegidos como anónimo a la cuenta (una sola vez).
        migrateLocalToDb: async function() {
            if (!Api.userId) return;
            var raw = null;
            try { raw = JSON.parse(localStorage.getItem(this._localKey) || 'null'); } catch (e) {}
            if (!raw || !raw.length) return;
            if (!this.list.length) {
                for (var i = 0; i < raw.length; i++) {
                    if (raw[i] && raw[i].topic) { try { await Api.call('add_topic', { topic: raw[i].topic }); } catch (e) {} }
                }
                await this.load();
            }
            try { localStorage.removeItem(this._localKey); } catch (e) {}
        },
        // Hashtags "de moda" para enriquecer los defaults del anónimo. Servidor: /noxtr/raw
        // (cache TTL 1h, inerte si no hay 'modules.noxtr.trending_api_url' en CFG). Aquí
        // además cacheamos en localStorage 1h para evitar el round-trip en cada carga.
        trending: [],
        loadTrending: async function() {
            if (Api.userId) return; // los logueados ya tienen sus propios topics
            try {
                var raw = localStorage.getItem('noxtr_trending_cache');
                if (raw) {
                    var c = JSON.parse(raw);
                    if (c && c.ts && (Date.now() - c.ts) < 3600000 && Array.isArray(c.tags)) { this.trending = c.tags; return; }
                }
            } catch (e) {}
            try {
                var url = '/noxtr/raw?action=trending_topics&lang=' + encodeURIComponent(String(Api.lang || '').slice(0, 5));
                var res = await fetch(url, { credentials: 'omit' });
                var json = await res.json();
                this.trending = (json && Array.isArray(json.topics)) ? json.topics.slice(0, 8) : [];
                try { localStorage.setItem('noxtr_trending_cache', JSON.stringify({ ts: Date.now(), tags: this.trending })); } catch (e) {}
            } catch (e) { this.trending = []; }
        },
        // Defaults del anónimo: estáticos por idioma + trending, deduplicado (estáticos primero).
        defaultsForAnon: function() {
            var seen = {}, out = [];
            DEFAULT_TOPICS.concat(this.trending || []).forEach(function(t) {
                var k = String(t).toLowerCase();
                if (t && !seen[k]) { seen[k] = 1; out.push(t); }
            });
            return out;
        },
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
    // Relays dedicados al canal NIP-46 (Nostr Connect, kind 24133). NO usar la lista del feed:
    // muchos relays (purplepag.es, nostr.band, noswhere...) bloquean kind 24133, otros rate-limitan
    // la rafaga de peticiones y otros responden "no one listening". Estos aceptan 24133 efimeros.
    // Relays del canal NIP-46 (kind 24133, peticiones al firmador). Configurables vía CFG
    // modules.noxtr.nip46_relays (ver Noxtr.init → config.nip46Relays). Default: lista conocida que
    // acepta 24133 (muchos relays de feed los bloquean/rate-limitan). Se reasigna en init() si hay config.
    var NIP46_RELAYS = ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol'];

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
                a.onclick = async function() { if (!await confirm(t(str_remove_url_confirm, a.dataset.url))) return; await Relays.remove(a.dataset.id, a.dataset.url); Relays.render(); };
            });
        }
    };

    // ==================== NIP-96 FILE STORAGE ====================

    var Nip96 = {
        list: [],          // [{id, url, active, sort_order}]
        capsCache: {},     // url → well-known capabilities (cached in memory)

        load: async function() {
            if (!Api.userId) return;
            var r = await Api.call('get_nip96_servers');
            if (!r.error) this.list = r.data || [];
        },

        add: async function(url) {
            if (!Api.userId) return;
            var r = await Api.call('add_nip96_server', { url: url });
            if (!r.error) this.list = r.data || [];
            return r;
        },

        remove: async function(id) {
            if (!Api.userId) return;
            var r = await Api.call('remove_nip96_server', { server_id: id });
            if (!r.error) this.list = r.data || [];
        },

        toggle: async function(id) {
            if (!Api.userId) return;
            var r = await Api.call('toggle_nip96_server', { server_id: id });
            if (!r.error) this.list = r.data || [];
        },

        activeServers: function() {
            return this.list.filter(function(s) { return s.active == 1; });
        },

        // Discover server capabilities via /.well-known/nostr/nip96.json
        discover: async function(url) {
            if (this.capsCache[url]) return this.capsCache[url];
            try {
                var r = await fetch(url.replace(/\/$/, '') + '/.well-known/nostr/nip96.json');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                var caps = await r.json();
                this.capsCache[url] = caps;
                return caps;
            } catch(e) {
                console.warn('[Nip96] discover failed for', url, e);
                return null;
            }
        },

        // Build NIP-98 (kind 27235) auth event for a given URL and method
        _buildAuth: async function(uploadUrl, method, fileBlob) {
            if (!Events.canSign()) throw new Error(str_no_signing_key_available);
            var tags = [
                ['u', uploadUrl],
                ['method', method.toUpperCase()]
            ];
            // Optional payload tag: SHA-256 of the file body (recommended by NIP-98)
            if (fileBlob) {
                var buf = await fileBlob.arrayBuffer();
                var hashBuf = await crypto.subtle.digest('SHA-256', buf);
                var hash = Array.from(new Uint8Array(hashBuf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                tags.push(['payload', hash]);
            }
            var ev = await Events.create(27235, '', tags);
            var signed = await Events.sign(ev);
            return 'Nostr ' + btoa(JSON.stringify(signed));
        },

        // Upload to a single server. Returns {url, ...} or throws.
        _uploadTo: async function(serverUrl, file) {
            var caps = await this.discover(serverUrl);
            if (!caps || !caps.api_url) throw new Error(str_nip96_caps_missing);

            // Check size and mime against capabilities (free plan if available)
            var plan = (caps.plans && (caps.plans.free || caps.plans.default)) || null;
            if (plan && plan.max_byte_size && file.size > plan.max_byte_size) {
                console.warn('[Nip96]', serverUrl, 'declara max_byte_size=' + plan.max_byte_size + ' y el archivo es ' + file.size + '; se intenta igualmente');
            }
            if (caps.content_types && Array.isArray(caps.content_types) && caps.content_types.length && file.type) {
                var fileType = file.type.split(';')[0].trim().toLowerCase();
                var fileMajor = fileType.split('/')[0];
                var accepted = caps.content_types.some(function(ct) {
                    ct = String(ct).split(';')[0].trim().toLowerCase();
                    if (ct === '*/*' || ct === '*') return true;
                    if (ct === fileType) return true;
                    var parts = ct.split('/');
                    if (parts[1] === '*' && parts[0] === fileMajor) return true;
                    return false;
                });
                if (!accepted) {
                    console.warn('[Nip96]', serverUrl, 'no declara', file.type, 'en content_types; se intenta igualmente');
                }
            }

            var auth = await this._buildAuth(caps.api_url, 'POST', file);
            var fd = new FormData();
            fd.append('file', file);

            var r = await fetch(caps.api_url, {
                method: 'POST',
                headers: { 'Authorization': auth },
                body: fd
            });
            if (!r.ok) {
                var serverMsg = '';
                try {
                    var bodyText = await r.text();
                    try {
                        var bodyJson = JSON.parse(bodyText);
                        serverMsg = bodyJson.message || bodyJson.error || '';
                    } catch (_) {
                        serverMsg = bodyText.trim().slice(0, 200);
                    }
                } catch (_) {}
                if (r.status === 413 || /too\s*large|payload.*large|file.*size|max.*size/i.test(serverMsg)) {
                    var fileMB = (file.size / 1024 / 1024).toFixed(1);
                    if (plan && plan.max_byte_size) {
                        var maxMB = (plan.max_byte_size / 1024 / 1024).toFixed(1);
                        throw new Error(t(str_upload_too_large_server, fileMB, maxMB));
                    }
                    throw new Error(t(str_upload_too_large_unknown, fileMB));
                }
                throw new Error(serverMsg || t(str_upload_failed_http, r.status));
            }
            var data = await r.json();

            // NIP-96 response: {status, message, processing_url, nip94_event: {tags: [['url', ...], ...]}}
            if (data.status === 'error') throw new Error(data.message || str_upload_rejected);

            var url = '';
            if (data.nip94_event && Array.isArray(data.nip94_event.tags)) {
                var urlTag = data.nip94_event.tags.find(function(t) { return t[0] === 'url'; });
                if (urlTag) url = urlTag[1];
            }
            if (!url) throw new Error(str_upload_no_url);
            return { url: url, server: serverUrl, nip94: data.nip94_event || null };
        },

        // Upload with fallback chain across all active servers
        upload: async function(file) {
            var servers = this.activeServers();
            if (!servers.length) {
                throw new Error(str_no_active_nip96_servers);
            }
            var lastError = null;
            for (var i = 0; i < servers.length; i++) {
                try {
                    return await this._uploadTo(servers[i].url, file);
                } catch(e) {
                    console.warn('[Nip96] upload failed on', servers[i].url, e.message);
                    lastError = e;
                }
            }
            throw lastError || new Error(str_all_nip96_failed);
        },

        render: function() {
            var el = document.getElementById('nip96-list'); if (!el) return;
            if (!this.list.length) {
                el.innerHTML = '<div class="noxtr-empty-small">' + str_no_file_storage_servers + '</div>';
                return;
            }
            el.innerHTML = this.list.map(function(s) {
                var isActive = s.active == 1;
                return '<div class="nip96-item' + (isActive ? '' : ' nip96-inactive') + '">' +
                    '<span class="nip96-toggle" data-id="' + s.id + '">' + (isActive ? '●' : '○') + '</span>' +
                    '<span class="nip96-url">' + escapeHtml(s.url) + '</span>' +
                    '<span class="nip96-remove" data-id="' + s.id + '" data-url="' + escapeHtml(s.url) + '">&times;</span>' +
                    '</div>';
            }).join('');
            el.querySelectorAll('.nip96-toggle').forEach(function(a) {
                a.onclick = async function() { await Nip96.toggle(a.dataset.id); Nip96.render(); };
            });
            el.querySelectorAll('.nip96-remove').forEach(function(a) {
                a.onclick = async function() {
                    if (!await confirm(t(str_remove_url_confirm, a.dataset.url))) return;
                    await Nip96.remove(a.dataset.id);
                    Nip96.render();
                };
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
            el.innerHTML = '<div class="noxtr-empty">' + str_no_followers_found + '</div>';
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
                    (isFollowingBack ? '' : '<a class="follower-follow btn btn-sm" data-pubkey="' + f.pubkey + '">' + str_follow + '</a>') +
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
                history.pushState({ noxtr: 'profile', pubkey: pk }, '', '/' + _MODULE_ + '/profile/' + npubEncode(pk));
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
            statsEl.innerHTML = '<span><strong>' + this._followingCount + '</strong> ' + str_following_lower + '</span>' +
                                '<span><strong>' + this._followersCount + '</strong> ' + str_followers_lower + '</span>';
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
                btnFollow.textContent = isFollowed ? str_unfollow : str_follow;
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
            navigator.clipboard.writeText(url);
            var btn = document.getElementById('pv-btn-share');
            if (btn) {
                var orig = btn.innerHTML;
                        btn.textContent = str_copied + '!';
                setTimeout(function() { if (btn.parentNode) btn.innerHTML = orig; }, 1500);
            }
        }
    };

    // ==================== DMs (NIP-04) ====================

    var DMs = {
        convos: {}, unread: {}, subId: null, subIdNip17: null, currentPeer: null, needsSubscribe: false, _pendingOpenPeer: null,
        dismissed: {}, // { peerPubkey: dismissedAtTs } — conversaciones descartadas con la X (persisten en localStorage)
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
        _dismissedKey: function() { return 'noxtr_dm_dismissed' + (Api.userId ? '_' + Api.userId : ''); },
        loadDismissed: function() {
            try { this.dismissed = JSON.parse(localStorage.getItem(this._dismissedKey()) || '{}') || {}; }
            catch(e) { this.dismissed = {}; }
        },
        saveDismissed: function() {
            try { localStorage.setItem(this._dismissedKey(), JSON.stringify(this.dismissed)); } catch(e) {}
        },
        // Una conversación está oculta si la descartaste y no ha llegado nada más nuevo que esa fecha.
        isDismissed: function(pk) {
            var d = this.dismissed[pk];
            if (!d) return false;
            var msgs = this.convos[pk];
            var last = (msgs && msgs.length) ? msgs[msgs.length - 1] : null;
            return !last || last.created_at <= d;
        },
        // Set persistente de event ids ya procesados (con éxito o no). Evita re-descifrar en cada
        // recarga los gift wraps NIP-17 que no se guardan en BD (spam o unwrap fallido), lo que
        // disparaba cientos de nip44_decrypt al firmador NIP-46 y el rate-limit del relay.
        _seenOrder: null, _seenSaveTimer: null,
        _seenWrapsKey: function() { return 'noxtr_dm_seen_' + (Api.userId || (Events.pubkey ? Events.pubkey.slice(0, 16) : 'anon')); },
        loadSeenWraps: function() {
            if (!this._seenEvents) this._seenEvents = {};
            try {
                var arr = JSON.parse(localStorage.getItem(this._seenWrapsKey()) || '[]') || [];
                for (var i = 0; i < arr.length; i++) this._seenEvents[arr[i]] = true;
                this._seenOrder = arr;
            } catch(e) { this._seenOrder = []; }
        },
        markSeenWrap: function(id) {
            if (!this._seenOrder) this._seenOrder = [];
            this._seenOrder.push(id);
            var self = this;
            if (this._seenSaveTimer) return;
            this._seenSaveTimer = setTimeout(function() {
                self._seenSaveTimer = null;
                try {
                    if (self._seenOrder.length > 6000) self._seenOrder = self._seenOrder.slice(-6000);
                    localStorage.setItem(self._seenWrapsKey(), JSON.stringify(self._seenOrder));
                } catch(e) {}
            }, 1500);
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
        // Cache de texto descifrado por event id. Con signer remoto (NIP-46) cada descifrado
        // es un round-trip de red al signer; cacheando el plaintext, cada mensaje se descifra
        // una sola vez en vez de en cada carga de la lista.
        _plainCache: null,
        _loadPlainCache: function() {
            if (this._plainCache) return this._plainCache;
            try { this._plainCache = JSON.parse(localStorage.getItem('noxtr_dm_plain') || '{}'); } catch(e) { this._plainCache = {}; }
            return this._plainCache;
        },
        _savePlainCache: function() {
            try {
                var c = this._plainCache || {};
                var keys = Object.keys(c);
                if (keys.length > 3000) { // recorte: conserva los 2000 mas recientes (por insercion)
                    var trimmed = {};
                    for (var i = keys.length - 2000; i < keys.length; i++) trimmed[keys[i]] = c[keys[i]];
                    c = this._plainCache = trimmed;
                }
                localStorage.setItem('noxtr_dm_plain', JSON.stringify(c));
            } catch(e) {}
        },
        // Lee el plaintext cacheado sin descifrar (sin tocar al signer). null si no esta.
        _plainCacheGet: function(eventId) {
            var c = this._loadPlainCache();
            return (eventId && typeof c[eventId] === 'string') ? c[eventId] : null;
        },
        // Texto a mostrar de un mensaje: placeholder si esta sin descifrar (lazy, NIP-04).
        _displayText: function(m) {
            return (m && m.decrypted === false) ? '🔒 ...' : (m ? m.content : '');
        },
        _decryptCached: async function(eventId, content, pk) {
            var c = this._loadPlainCache();
            if (eventId && typeof c[eventId] === 'string') return c[eventId];
            var text = await this.decrypt(content, pk);
            // No cachear fallos: se reintentan en la siguiente carga
            if (eventId && text && text !== '[encrypted]' && text !== '[encrypted - need privkey]' && text !== '[decryption failed]') {
                c[eventId] = text;
                this._savePlainCache();
            }
            return text;
        },
        encrypt: async function(text, pk) {
            if (Events.useExtension && window.nostr && window.nostr.nip04) return await window.nostr.nip04.encrypt(pk, text);
            if (Events.useNip46) return await Nip46.nip04Encrypt(pk, text);
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
            if (Events.useNip46) {
                try { return await Nip46.nip04Decrypt(pk, content); } catch(e) { return '[encrypted]'; }
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
        // NIP-17: unwrap gift wrap (kind 1059) → seal (kind 13) → rumor (kind 14)
        // Returns { id, peer, pubkey, content, created_at, mine } or null
        _unwrapNip17: async function(ev) {
            if (ev.kind !== 1059) return null;
            var privkey = Events.privkey;
            var useExt = Events.useExtension && window.nostr && window.nostr.nip44;
            var useNip46 = Events.useNip46;
            if (!privkey && !useExt && !useNip46) return null;
            try {
                var sealJson, rumorJson;
                if (useExt) {
                    sealJson  = await window.nostr.nip44.decrypt(ev.pubkey, ev.content);
                } else if (useNip46) {
                    sealJson  = await Nip46.nip44Decrypt(ev.pubkey, ev.content);
                } else {
                    var ck1 = await Nip44.getConversationKey(privkey, ev.pubkey);
                    sealJson  = await Nip44.decrypt(ev.content, ck1);
                }
                var seal = JSON.parse(sealJson);
                if (!seal || seal.kind !== 13) return null;

                if (useExt) {
                    rumorJson = await window.nostr.nip44.decrypt(seal.pubkey, seal.content);
                } else if (useNip46) {
                    rumorJson = await Nip46.nip44Decrypt(seal.pubkey, seal.content);
                } else {
                    var ck2 = await Nip44.getConversationKey(privkey, seal.pubkey);
                    rumorJson = await Nip44.decrypt(seal.content, ck2);
                }
                var rumor = JSON.parse(rumorJson);
                if (!rumor || rumor.kind !== 14) return null;

                var isMine = seal.pubkey === Events.pubkey;
                var peer = isMine
                    ? (function() { for (var i = 0; i < (rumor.tags || []).length; i++) if (rumor.tags[i][0] === 'p') return rumor.tags[i][1]; return null; })()
                    : seal.pubkey;
                if (!peer) return null;

                return { id: ev.id, peer: peer, pubkey: seal.pubkey, content: rumor.content, created_at: rumor.created_at || ev.created_at, mine: isMine };
            } catch(e) {
                // No tragar el fallo en silencio: con signer remoto el descifrado del gift wrap
                // necesita 2 nip44_decrypt al signer; si fallan/timeout, el DM NIP-17 se perdia
                // sin rastro. Visible con localStorage.noxtr_debug='1'.
                NoxtrDebug.log('[noxtr] NIP-17 unwrap failed id=' + (ev && ev.id ? ev.id.slice(0,12) : '?') + ': ' + (e && e.message ? e.message : e));
                return null;
            }
        },
        subIdInbox: null,
        subscribe: function() {
            if (!Events.pubkey) {
                this.needsSubscribe = true;
                return;
            }
            if (this.subId) Pool.unsubscribe(this.subId);
            if (this.subIdInbox) Pool.unsubscribe(this.subIdInbox);
            if (this.subIdNip17) Pool.unsubscribe(this.subIdNip17);
            this.needsSubscribe = false;
            // Carga (independiente de la cuenta) el set de eventos ya procesados y la lista de
            // conversaciones descartadas, ANTES de suscribir, para no re-descifrar ni re-mostrar.
            this.loadSeenWraps();
            this.loadDismissed();
            // Corte "en vivo": los mensajes que llegan con created_at anterior a este instante son
            // HISTÓRICO re-entregado por el relay (incl. al reconectar). No se descifran al vuelo aunque
            // el chat esté abierto: eso disparaba cientos de peticiones NIP-46 al firmador. El histórico
            // se descifra en lazy (últimos 10 al abrir + botón "ver anteriores").
            this._liveCutoffTs = Math.floor(Date.now() / 1000);
            var self = this;
            // Corte "en vivo" para notificaciones de escritorio: los eventos que llegan ANTES del
            // EOSE de cada suscripción son histórico re-entregado por el relay (no notificar); los de
            // después son nuevos. Se rearma en cada (re)suscripción. Es más fiable que comparar
            // created_at: NIP-17 aleatoriza el timestamp del rumor hacia el pasado y rompía el corte.
            this._dmInboxLive = false;
            this._dmNip17Live = false;
            // NIP-04: sent messages (I am author)
            this.subId = Pool.subscribe(
                [{ kinds: [4], authors: [Events.pubkey], limit: 100 }],
                function(ev) { self.handleEvent(ev, true); },
                function() {}
            );
            // NIP-04: received messages (I am tagged)
            this.subIdInbox = Pool.subscribe(
                [{ kinds: [4], '#p': [Events.pubkey], limit: 100 }],
                function(ev) { self.handleEvent(ev, true); },
                function() { self._dmInboxLive = true; self.renderConvos(); }
            );
            // NIP-17: gift wraps addressed to me (kind 1059). Acotamos con `since` (ventana de 14 días,
            // con margen para el jitter de NIP-59) para que el relay no reenvíe todo el histórico de
            // wraps en cada reconexión. El histórico anterior ya está en BD (no hace falta re-pedirlo).
            this.subIdNip17 = Pool.subscribe(
                [{ kinds: [1059], '#p': [Events.pubkey], since: Math.floor(Date.now() / 1000) - 14 * 86400, limit: 100 }],
                function(ev) { self.handleEvent(ev, true); },
                function() { self._dmNip17Live = true; }
            );
        },
        // Load messages from local DB
        loadFromDb: async function() {
            this.loadMonitorClearedBefore();
            this.loadDismissed();
            var r = await Api.call('get_messages');
            if (r.error || !r.data) return;
            var self = this;
            if (!this._seenEvents) this._seenEvents = {};
            for (var i = 0; i < r.data.length; i++) {
                var m = r.data[i];
                // Marcar como visto ANTES de nada: cuando el relay re-entregue este mensaje (kind 4 o
                // gift wrap 1059), handleEvent lo saltará por _seenEvents y NO lo volverá a descifrar/
                // desempaquetar contra el firmador. Sin esto, cada carga re-desempaquetaba todo el
                // histórico NIP-17 (cientos de nip44_decrypt al signer).
                if (m.event_id) this._seenEvents[m.event_id] = true;
                var peer = m.peer_pubkey;
                if (this.shouldHideMonitorDm(peer, m.event_created_at)) continue;
                if (!this.convos[peer]) this.convos[peer] = [];
                var exists = false;
                for (var j = 0; j < this.convos[peer].length; j++) {
                    if (this.convos[peer][j].id === m.event_id) { exists = true; break; }
                }
                if (!exists) {
                    var nip = parseInt(m.nip_version) || 4;
                    var entry = {
                        id: m.event_id,
                        pubkey: m.sender_pubkey,
                        created_at: parseInt(m.event_created_at),
                        mine: m.sender_pubkey === Events.pubkey,
                        nip: nip
                    };
                    if (nip === 17) {
                        // NIP-17 se guarda ya descifrado en la DB (el wrap no vuelve del relay)
                        entry.content = m.content_encrypted;
                    } else {
                        // NIP-04: no descifrar al cargar. Solo cache-hit local; el resto se
                        // difiere a openThread (lazy) para no golpear al signer con toda la
                        // bandeja de golpe al arrancar.
                        var cached = this._plainCacheGet(m.event_id);
                        entry.enc = m.content_encrypted;
                        entry.content = (cached !== null) ? cached : '';
                        entry.decrypted = (cached !== null);
                    }
                    this.convos[peer].push(entry);
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
            var ok = await Promise.resolve(confirm(str_clear_monitor_chat_confirm));
            if (!ok) return;

            var r = await Api.call('clear_monitor_messages');
            if (r.error) {
                alert(r.msg || str_clear_monitor_chat_failed);
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
        saveToDb: function(eventId, peerPubkey, senderPubkey, contentEncrypted, eventCreatedAt, nipVersion) {
            Api.call('save_message', {
                event_id: eventId,
                peer_pubkey: peerPubkey,
                sender_pubkey: senderPubkey,
                content_encrypted: contentEncrypted,
                event_created_at: eventCreatedAt,
                nip_version: nipVersion || 4
            });
        },
        // Called when relays connect/reconnect to ensure DM subscription is active
        ensureSubscription: function() {
            if (this.needsSubscribe && Events.pubkey) {
                this.subscribe();
            }
        },
        handleEvent: async function(ev, saveDb) {
            // Dedup SINCRONO por id antes de cualquier await. El chequeo de convos ocurre
            // antes del await de descifrado (conversacion abierta) y el push despues, asi que
            // copias del mismo evento desde varios relays en rafaga pasaban todas el chequeo y
            // se duplicaban (sintoma: respuestas del monitor repetidas N veces = N relays).
            if (!ev || !ev.id) return;
            if (!this._seenEvents) this._seenEvents = {};
            if (this._seenEvents[ev.id]) return;
            this._seenEvents[ev.id] = true;
            this.markSeenWrap(ev.id); // persiste: no re-descifrar este evento en futuras recargas
            if (ev.kind === 1059) {
                var u = await this._unwrapNip17(ev);
                if (!u) return;
                if (this.shouldHideMonitorDm(u.peer, u.created_at)) return;
                if (!this.convos[u.peer]) this.convos[u.peer] = [];
                for (var k = 0; k < this.convos[u.peer].length; k++) if (this.convos[u.peer][k].id === ev.id) return;
                if (saveDb && Api.userId) this.saveToDb(ev.id, u.peer, u.pubkey, u.content, u.created_at, 17);
                this.convos[u.peer].push({ id: ev.id, pubkey: u.pubkey, content: u.content, created_at: u.created_at, mine: u.mine, nip: 17 });
                this.convos[u.peer].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
                if (!u.mine) {
                    if (this.currentPeer !== u.peer) this.unread[u.peer] = (this.unread[u.peer] || 0) + 1;
                    if (this._dmNip17Live && window.NoxtrNotify) {
                        window.NoxtrNotify.push('💬 ' + str_notif_new_dm, t(str_notif_dm_from, Profiles.displayName(u.pubkey)),
                            { tag: 'noxtr-dm-' + u.peer, onclick: function(){ DMs.openThread(u.peer); } });
                    }
                }
                Profiles.request(u.peer);
                if (this.currentPeer === u.peer) this.renderThread(u.peer);
                if (document.getElementById('panel-messages').style.display !== 'none' && !this.currentPeer) this.renderConvos();
                return;
            }
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
            // Lazy: solo se descifra al vuelo si es la conversacion abierta o hay cache-hit;
            // en rafaga (historico del relay) se difiere a openThread y no se golpea al signer.
            var entry = { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, mine: isMine, nip: 4, enc: ev.content };
            var cached = this._plainCacheGet(ev.id);
            if (cached !== null) { entry.content = cached; entry.decrypted = true; }
            // Solo descifrar al vuelo si es un mensaje NUEVO (en vivo) de la conversación abierta. El
            // histórico re-entregado por el relay (created_at < corte) NO se descifra aquí: se deja en
            // lazy para no inundar al firmador con cientos de peticiones al abrir/reconectar.
            else if (this.currentPeer === peer && this._liveCutoffTs && ev.created_at >= this._liveCutoffTs) {
                entry.content = await this._decryptCached(ev.id, ev.content, peer); entry.decrypted = true;
            }
            else { entry.content = ''; entry.decrypted = false; }
            this.convos[peer].push(entry);
            this.convos[peer].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
            if (!isMine) {
                if (this.currentPeer !== peer) this.unread[peer] = (this.unread[peer] || 0) + 1;
                if (this._dmInboxLive && window.NoxtrNotify) {
                    window.NoxtrNotify.push('💬 ' + str_notif_new_dm, t(str_notif_dm_from, Profiles.displayName(peer)),
                        { tag: 'noxtr-dm-' + peer, onclick: function(){ DMs.openThread(peer); } });
                }
            }
            Profiles.request(peer);
            if (this.currentPeer === peer) this.renderThread(peer);
            // Update conversation list if visible
            if (document.getElementById('panel-messages').style.display !== 'none' && !this.currentPeer) this.renderConvos();
        },
        sendMessage: async function(pk, text) {
            // Con signer remoto (NIP-46) usamos NIP-04: el gift-wrap NIP-17 obliga a 2
            // round-trips al signer por mensaje (cifrar seal + firmar) tanto al enviar como
            // al leer, lo que lo vuelve lento y duplica dialogos. NIP-04 = 1 cifrar + 1 firmar.
            var canNip17 = Events.privkey || (Events.useExtension && window.nostr && window.nostr.nip44);
            if (canNip17) return await this._sendNip17(pk, text);
            // fallback NIP-04
            var enc = await this.encrypt(text, pk);
            var ev = await Events.create(4, enc, [['p', pk]]);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            if (!this.convos[pk]) this.convos[pk] = [];
            var exists = false;
            for (var i = 0; i < this.convos[pk].length; i++) if (this.convos[pk][i].id === signed.id) { exists = true; break; }
            if (!exists) {
                // Persistir aqui, igual que hace _sendNip17. NO basta con confiar en que el relay
                // nos devuelva nuestro propio kind 4 y lo guarde handleEvent: para cuando llega el
                // eco, este id ya esta en convos y el anti-duplicado de handleEvent corta ANTES de
                // llamar a saveToDb. Sin esta linea un DM enviado por NIP-04 no se guardaba nunca y
                // desaparecia al recargar (solo se notaba con NIP-46, que es quien envia por NIP-04).
                if (Api.userId) this.saveToDb(signed.id, pk, signed.pubkey, enc, signed.created_at, 4);
                // El texto en claro ya lo tenemos aqui: cachearlo evita que al recargar haya que
                // pedirle al firmador remoto que descifre un mensaje que escribimos nosotros.
                try {
                    var _pc = this._loadPlainCache();
                    _pc[signed.id] = text;
                    this._savePlainCache();
                } catch(e) {}
                this.convos[pk].push({ id: signed.id, pubkey: signed.pubkey, content: text, created_at: signed.created_at, mine: true, nip: 4 });
                this.convos[pk].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
                if (this.currentPeer === pk) this.renderThread(pk);
            }
            return signed;
        },
        _sendNip17: async function(pk, text) {
            var privkey = Events.privkey;
            var useExt = Events.useExtension && window.nostr && window.nostr.nip44;
            var now = Math.floor(Date.now() / 1000);

            // 1. Rumor (kind 14, unsigned)
            var rumor = { pubkey: Events.pubkey, created_at: now, kind: 14, tags: [['p', pk]], content: text };
            rumor.id = await sha256hex(JSON.stringify([0, rumor.pubkey, rumor.created_at, rumor.kind, rumor.tags, rumor.content]));

            // 2. Seal (kind 13): rumor cifrado al receptor, firmado por el sender
            var rumorJson = JSON.stringify(rumor);
            var sealContent = useExt
                ? await window.nostr.nip44.encrypt(pk, rumorJson)
                : await Nip44.encrypt(rumorJson, await Nip44.getConversationKey(privkey, pk));
            var seal = await Events.create(13, sealContent, []);
            seal = await Events.sign(seal);

            // 3. Gift wrap (kind 1059): clave efímera, seal cifrado al receptor
            var ephPrivBytes = crypto.getRandomValues(new Uint8Array(32));
            var ephPriv = bytesToHex(ephPrivBytes);
            var ephPubRaw = nobleSecp256k1.getPublicKey(ephPriv, true);
            var ephPub = (typeof ephPubRaw === 'string' ? ephPubRaw : bytesToHex(ephPubRaw)).slice(2);
            var wrapContent = await Nip44.encrypt(JSON.stringify(seal), await Nip44.getConversationKey(ephPriv, pk));
            var wrap = { pubkey: ephPub, created_at: now, kind: 1059, tags: [['p', pk]], content: wrapContent };
            wrap.id = await sha256hex(JSON.stringify([0, wrap.pubkey, wrap.created_at, wrap.kind, wrap.tags, wrap.content]));
            var wrapSig = await nobleSecp256k1.schnorr.sign(wrap.id, ephPriv);
            wrap.sig = typeof wrapSig === 'string' ? wrapSig : bytesToHex(wrapSig);

            Pool.publish(wrap);

            // Añadir localmente (no vuelve del relay: el gift wrap no lleva #p:sender)
            if (!this.convos[pk]) this.convos[pk] = [];
            var exists = false;
            for (var i = 0; i < this.convos[pk].length; i++) if (this.convos[pk][i].id === wrap.id) { exists = true; break; }
            if (!exists) {
                this.convos[pk].push({ id: wrap.id, pubkey: Events.pubkey, content: text, created_at: now, mine: true, nip: 17 });
                this.convos[pk].sort(function(a, b) { return a.created_at !== b.created_at ? a.created_at - b.created_at : (b.mine ? 0 : 1) - (a.mine ? 0 : 1); });
                if (this.currentPeer === pk) this.renderThread(pk);
                if (Api.userId) this.saveToDb(wrap.id, pk, Events.pubkey, text, now, 17);
            }
            return wrap;
        },
        renderConvos: function() {
            var el = document.getElementById('dm-conv-list'); if (!el) return;
            var peers = Object.keys(this.convos).filter(function(pk) { return !DMs.isDismissed(pk); });
            if (!peers.length) { el.innerHTML = '<div class="noxtr-empty">No messages yet.</div>'; return; }
            peers.sort(function(a, b) {
                var la = DMs.convos[a], lb = DMs.convos[b];
                return lb[lb.length-1].created_at - la[la.length-1].created_at;
            });
            el.innerHTML = peers.map(function(pk) {
                var msgs = DMs.convos[pk], last = msgs[msgs.length - 1];
                var name = Profiles.displayName(pk), av = Profiles.avatar(pk), col = Profiles.color(pk);
                var ini = (name[0] || '?').toUpperCase();
                var raw = DMs._displayText(last);
                var preview = raw.length > 50 ? raw.slice(0, 47) + '...' : raw;
                var unread = DMs.unread[pk] || 0;
                return '<div class="dm-conv'+(unread > 0 ? ' dm-conv-unread' : '')+'" data-pubkey="'+pk+'">' +
                    '<div class="dm-conv-avatar" style="background:'+col+'">'+(av ? '<img src="'+escapeHtml(av)+'">' : '<span>'+ini+'</span>')+'</div>' +
                    '<div class="dm-conv-body"><strong>'+escapeHtml(name)+'</strong>' +
                        (unread > 0 ? '<span class="dm-conv-badge">'+unread+'</span>' : '') +
                        '<span class="dm-conv-time">'+timeAgo(last.created_at)+'</span>' +
                    '<p class="dm-conv-preview">'+escapeHtml(preview)+'</p></div>' +
                    '<a class="dm-conv-del" data-pubkey="'+pk+'" title="'+str_delete+'">&times;</a></div>';
            }).join('');
            var self = this;
            el.querySelectorAll('.dm-conv').forEach(function(c) { c.onclick = function() { self.openThread(c.dataset.pubkey); }; });
            el.querySelectorAll('.dm-conv-del').forEach(function(b) { b.onclick = async function(e) { e.stopPropagation(); await self.deleteConversation(b.dataset.pubkey); }; });
        },
        // Descifra (lazy) los mensajes NIP-04 pendientes de una conversacion. Cache-first via
        // _decryptCached, asi que la segunda vez no vuelve a pedir al signer. Re-renderiza al
        // terminar si seguimos en ese chat.
        DECRYPT_BATCH: 10,
        decryptConversation: async function(pk) {
            var msgs = this.convos[pk] || [];
            // Lazy: con NIP-46 cada descifrado es una petición al signer. Descifrar toda una
            // conversación larga de golpe inunda el relay ("noting too much"). Solo desciframos
            // los últimos `limit` mensajes (los más recientes están al final); los anteriores se
            // descifran bajo demanda con el botón "ver anteriores" (revealOlder).
            if (!this._decryptLimit) this._decryptLimit = {};
            var limit = this._decryptLimit[pk] || this.DECRYPT_BATCH;
            var start = Math.max(0, msgs.length - limit);
            var changed = false;
            for (var i = start; i < msgs.length; i++) {
                var m = msgs[i];
                if (m.decrypted === false && m.nip !== 17) {
                    m.content = await this._decryptCached(m.id, m.enc, pk);
                    m.decrypted = true;
                    changed = true;
                }
            }
            if (changed && this.currentPeer === pk) this.renderThread(pk);
        },
        revealOlder: async function(pk) {
            if (!this._decryptLimit) this._decryptLimit = {};
            this._decryptLimit[pk] = (this._decryptLimit[pk] || this.DECRYPT_BATCH) + this.DECRYPT_BATCH;
            await this.decryptConversation(pk);
            if (this.currentPeer === pk) this.renderThread(pk);
        },
        openThread: function(pk, noPush) {
            this.currentPeer = pk;
            this.unread[pk] = 0;
            document.getElementById('dm-conv-list').style.display = 'none';
            document.getElementById('dm-new').style.display = 'none';
            document.getElementById('dm-thread').style.display = '';
            document.getElementById('dm-thread-name').textContent = Profiles.displayName(pk);
            this.renderThreadAvatar(pk);
            this.renderThread(pk);
            this.decryptConversation(pk);   // descifra el cuerpo solo al abrir el chat
            Profiles.request(pk);
            if (!noPush) history.pushState({ noxtr: 'dm', pubkey: pk }, '', '/' + _MODULE_ + '/messages/' + npubEncode(pk));
            else history.replaceState({ noxtr: 'dm', pubkey: pk }, '', '/' + _MODULE_ + '/messages/' + npubEncode(pk));
        },
        renderThreadAvatar: function(pk) {
            var el = document.getElementById('dm-thread-avatar'); if (!el) return;
            var av = Profiles.avatar(pk), col = Profiles.color(pk);
            var ini = (Profiles.displayName(pk)[0] || '?').toUpperCase();
            el.style.background = col;
            el.innerHTML = av ? '<img src="'+escapeHtml(av)+'">' : '<span>'+ini+'</span>';
        },
        renderThread: function(pk) {
            var el = document.getElementById('dm-messages'); if (!el) return;
            el.classList.toggle('chat-monitor', !!(this.monitorPubkey && pk && String(pk).toLowerCase() === this.monitorPubkey));
            var msgs = this.convos[pk] || [];
            // Lazy decrypt: los mensajes antiguos aún sin descifrar (decrypted===false) no se pintan;
            // se ofrece un botón "ver anteriores" que descifra el siguiente lote bajo demanda.
            var pending = 0;
            for (var k = 0; k < msgs.length; k++) {
                if (msgs[k].decrypted === false && msgs[k].nip !== 17) pending++;
            }
            var html = '';
            if (pending > 0) {
                html += '<div class="dm-load-older"><button type="button" class="btn secondary dm-reveal-older">' +
                    escapeHtml(t(str_dm_reveal_older, pending)) + '</button></div>';
            }
            html += msgs.map(function(m) {
                if (m.decrypted === false && m.nip !== 17) return ''; // aún sin descifrar (lazy)
                var nip17 = m.nip === 17 ? ' nip17' : '';
                return '<div class="dm-msg '+(m.mine ? 'dm-mine' : 'dm-theirs')+nip17+'">' +
                    '<div class="dm-msg-text">'+escapeHtml(DMs._displayText(m))+'</div>' +
                    '<div class="dm-msg-time">'+timeAgo(m.created_at)+(m.nip === 17 ? ' 🔒' : '')+'</div></div>';
            }).join('');
            el.innerHTML = html;
            var revealBtn = el.querySelector('.dm-reveal-older');
            if (revealBtn) revealBtn.onclick = function() { DMs.revealOlder(pk); };
            el.scrollTop = el.scrollHeight;
        },
        closeThread: function() {
            this.currentPeer = null;
            var el = document.getElementById('dm-messages');
            if (el) el.classList.remove('chat-monitor');
            document.getElementById('dm-thread').style.display = 'none';
            document.getElementById('dm-conv-list').style.display = '';
            document.getElementById('dm-new').style.display = '';
            this.renderConvos();
            history.replaceState({ noxtr: 'tab', tab: 'messages' }, '', '/' + _MODULE_ + '/messages');
        },
        deleteConversation: async function(pk) {
            var ok = await Promise.resolve(confirm(str_delete_conversation_confirm));
            if (!ok) return;
            if (Api.userId) { try { await Api.call('delete_conversation', { peer_pubkey: pk }); } catch(e) {} }
            // Marca descartada "hasta ahora": al recargar, los relays reenvían los DM y se volverían
            // a ver; isDismissed() los oculta salvo que llegue un mensaje más nuevo que esta fecha.
            this.dismissed[pk] = Math.floor(Date.now() / 1000);
            this.saveDismissed();
            delete this.convos[pk];
            delete this.unread[pk];
            if (this.currentPeer === pk) this.closeThread();
            else this.renderConvos();
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
                        $('body').dialog({
                    title: str_channel_not_found,
                            content: str_channel_not_found_hint,
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
                el.innerHTML = '<div class="noxtr-empty">' + str_not_in_channels + '</div>';
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
                    (msgCount ? '<span class="dm-conv-time">' + msgCount + ' ' + str_msgs + '</span>' : '') +
                    (about ? '<p class="dm-conv-preview">' + escapeHtml(about.slice(0, 60)) + '</p>' : '') +
                    '</div>' +
                    '<a class="channel-leave channel-leave-btn" data-channel="' + ch.channel_id + '" title="' + str_leave + '">&times;</a>' +
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
                    var ok = await confirm(str_leave_channel_confirm);
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
                el.innerHTML = '<div class="noxtr-empty">' + str_no_messages_yet + '</div>';
                return;
            }
            var myPk = Events.pubkey;
            el.innerHTML = room.messages.map(function(m) {
                var name = Profiles.displayName(m.pubkey);
                var av = Profiles.avatar(m.pubkey);
                var col = Profiles.color(m.pubkey);
                var ini = (name[0] || '?').toUpperCase();
                var isOwn = myPk && m.pubkey === myPk;
                var delBtn = isOwn ? '<a class="ch-msg-del channel-msg-del" data-action="del-channel-msg" data-id="' + m.id + '" title="' + str_delete + '"><svg class="channel-msg-del-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '';
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
            var content = '<div class="channel-dialog-form">' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_channel_name + '</label>' +
                '<input type="text" id="ch-edit-name" class="channel-dialog-input" value="' + escapeHtml(room.name || '') + '"></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_description + '</label>' +
                '<textarea id="ch-edit-about" rows="3" class="channel-dialog-input channel-dialog-textarea">' + escapeHtml(room.about || '') + '</textarea></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_channel_picture_url + '</label>' +
                '<input type="text" id="ch-edit-picture" class="channel-dialog-input" value="' + escapeHtml(room.picture || '') + '" placeholder="https://..."></div>' +
                (room.picture ? '<div class="channel-dialog-preview"><img class="channel-dialog-preview-img" src="' + escapeHtml(room.picture) + '"></div>' : '') +
                '</div>';
            $("body").dialog({
                title: str_edit_channel,
                type: 'html',
                width: '420px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [
                    {
                        text: str_cancel,
                        class: 'btn btn-cancel',
                        action: function(event, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: str_save,
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var newName = document.getElementById('ch-edit-name').value.trim();
                            var newAbout = document.getElementById('ch-edit-about').value.trim();
                            var newPicture = document.getElementById('ch-edit-picture').value.trim();
                            if (!newName) return;
                            try {
                                await self.updateMeta(channelId, newName, newAbout, newPicture);
                                document.body.removeChild(overlay);
                            } catch(e) { alert(t(str_error_generic, e.message)); }
                        }
                    }
                ]
            });
        },

        openCreateDialog: function() {
            var self = this;
            var content = '<div class="channel-dialog-form">' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_channel_name + '</label>' +
                '<input type="text" id="ch-create-name" class="channel-dialog-input" placeholder="' + str_my_channel_placeholder + '"></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_description_optional + '</label>' +
                '<textarea id="ch-create-about" rows="3" class="channel-dialog-input channel-dialog-textarea"></textarea></div>' +
                '<div class="channel-dialog-field"><label class="channel-dialog-label">' + str_channel_picture_url_optional + '</label>' +
                '<input type="text" id="ch-create-picture" class="channel-dialog-input" placeholder="https://..."></div>' +
                '</div>';
            $("body").dialog({
                title: str_create_channel,
                type: 'html',
                width: '420px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [
                    {
                        text: str_cancel,
                        class: 'btn btn-cancel',
                        action: function(event, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: str_create,
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var name = document.getElementById('ch-create-name').value.trim();
                            var about = document.getElementById('ch-create-about').value.trim();
                            var picture = document.getElementById('ch-create-picture').value.trim();
                            if (!name) return;
                            try {
                                await self.createChannel(name, about, picture);
                                document.body.removeChild(overlay);
                            } catch(e) { alert(t(str_error_generic, e.message)); }
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
                '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_like+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
                '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_repost+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
                '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_zap+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
                '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="'+str_bookmark+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
                '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="'+str_share+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>';

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
            pushClientTag(tags);

            var ev = await Events.create(30023, content, tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            return signed;
        }
    };

    // ==================== HIGHLIGHTS (NIP-84, kind 9802) ====================

    var Highlights = {
        // quote = highlighted phrase (.content), comment/context/source go in tags.
        // source: URL -> tag 'r' (NIP-84). Plain text (author/book) -> tag 'author' (noxtr
        // custom, ignored by other clients) + tag 'alt' (NIP-31 human description).
        publish: async function(quote, comment, context, source, hashtags) {
            if (!Events.canSign()) return;
            var tags = [];
            if (source) {
                if (/^https?:\/\//i.test(source)) {
                    tags.push(['r', source]);
                } else {
                    tags.push(['alt', str_quote_by + ' ' + source]);
                    tags.push(['author', source]);
                }
            }
            if (context) tags.push(['context', context]);
            if (comment) tags.push(['comment', comment]);
            if (hashtags && hashtags.length) {
                for (var i = 0; i < hashtags.length; i++) tags.push(['t', hashtags[i].toLowerCase().trim()]);
            }
            pushClientTag(tags);
            var ev = await Events.create(9802, quote, tags);
            var signed = await Events.sign(ev);
            Pool.publish(signed);
            return signed;
        },
        _meta: function(ev) {
            var m = { quote: ev.content || '', context: '', comment: '', source: '', author: '' };
            for (var i = 0; i < ev.tags.length; i++) {
                var t = ev.tags[i];
                if (t[0] === 'context') m.context = t[1] || '';
                else if (t[0] === 'comment') m.comment = t[1] || '';
                else if (t[0] === 'r' && !m.source) m.source = t[1] || '';
                else if (t[0] === 'author' && !m.author) m.author = t[1] || '';
            }
            return m;
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
            // Keypair de cliente persistente (clave que el logout NO borra): el signer
            // indexa las apps conectadas por client pubkey, así que si rotara en cada
            // login acumularía una "app conectada" duplicada por sesión.
            var storedClient = null;
            try { storedClient = JSON.parse(localStorage.getItem('noxtr_nip46_client') || 'null'); } catch(e) {}
            if (storedClient && /^[0-9a-f]{64}$/i.test(storedClient.privkey || '')) {
                this.clientPrivkey = storedClient.privkey.toLowerCase();
            } else {
                this.clientPrivkey = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
                try { localStorage.setItem('noxtr_nip46_client', JSON.stringify({ privkey: this.clientPrivkey })); } catch(e) {}
            }
            var pk = nobleSecp256k1.getPublicKey(this.clientPrivkey, true);
            this.clientPubkey = (typeof pk === 'string' ? pk : bytesToHex(pk)).slice(2);

            // Generate secret
            var secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
            this._connectSecret = secret;

            // Build URI. Canal NIP-46 sobre relays dedicados que aceptan kind 24133 (NO el feed:
            // purplepag.es/nostr.band lo bloquean, otros rate-limitan la rafaga de peticiones).
            var relays = NIP46_RELAYS.slice();
            var uri = 'nostrconnect://' + this.clientPubkey;
            var params = [];
            for (var i = 0; i < relays.length; i++) params.push('relay=' + encodeURIComponent(relays[i]));
            params.push('secret=' + secret);
            // Permisos solicitados de golpe: si el signer los respeta, los concede al
            // conectar y deja de pedir confirmacion por cada DM (cifrar/descifrar/firmar).
            params.push('perms=' + encodeURIComponent('sign_event,nip04_encrypt,nip04_decrypt,nip44_encrypt,nip44_decrypt,get_public_key'));
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
            if (statusEl) statusEl.textContent = str_waiting_for_signer;
            // QR code (usa qrcode.min.js standalone — sin jQuery)
            if (qrEl) {
                qrEl.innerHTML = '';
                if (typeof QRCode !== 'undefined') {
                    new QRCode(qrEl, { text: uri, width: 220, height: 220,
                        colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
                } else {
                    qrEl.innerHTML = '<div class="nip46-qr-fallback">' + str_qr_unavailable_copy_uri + '</div>';
                }
            }
            // Copy button
            var copyBtn = document.getElementById('btn-nip46-copy');
            if (copyBtn) copyBtn.onclick = function() {
                navigator.clipboard.writeText(uri).then(function() {
                    copyBtn.textContent = str_copied + '!';
                    setTimeout(function() { copyBtn.textContent = str_copy_uri; }, 2000);
                });
            };

            // Subscribe for responses
            this._subscribe();

            // Wait for connect response
            var self = this;
            return new Promise(function(resolve, reject) {
                self._connectResolve = resolve;
                self._connectTimeout = setTimeout(function() {
                    if (statusEl) statusEl.textContent = str_signer_timeout;
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
            this.signerRelay = null;
            this.conversationKey = null;
            this.connected = false;
            Events.useNip46 = false;
            Events.pubkey = null;
            if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; }
            this._wakeHide();
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
                this.signerRelay = data.signerRelay || null;
                this.conversationKey = await Nip44.getConversationKey(this.clientPrivkey, this.signerPubkey);
                this.connected = true;
                Events.pubkey = this.userPubkey;
                Events.useNip46 = true;
                // Conectar al canal NIP-46 (kind 24133). Si ya aprendimos el relay del firmador en una
                // sesión anterior, conectamos SOLO ese (no forzamos nsec.app/damus ni relays que el
                // usuario haya desactivado). Si aún no lo conocemos, caemos a la lista por defecto.
                var _nip46Conn = this.signerRelay ? [this.signerRelay] : NIP46_RELAYS;
                for (var ri = 0; ri < _nip46Conn.length; ri++) Pool.connect(_nip46Conn[ri]);
                this._subscribe();
                return true;
            } catch(e) { return false; }
        },

        _save: function() {
            try {
                localStorage.setItem('noxtr_nip46', JSON.stringify({
                    clientPrivkey: this.clientPrivkey, clientPubkey: this.clientPubkey,
                    signerPubkey: this.signerPubkey, userPubkey: this.userPubkey,
                    signerRelay: this.signerRelay || null
                }));
            } catch(e) {}
        },

        _subscribe: function() {
            if (this.subId) Pool.unsubscribe(this.subId);
            if (!this.clientPubkey) return;
            var self = this;
            this.subId = Pool.subscribe(
                [{ kinds: [24133], '#p': [this.clientPubkey], limit: 10 }],
                function(ev, relayUrl) { self._handleEvent(ev, relayUrl); }
            );
        },

        _handleEvent: async function(ev, relayUrl) {
            if (ev.kind !== 24133) return;
            try {
                // During connect handshake, signer pubkey is not yet known
                if (!this.signerPubkey && this._connectResolve) {
                    // First message from signer — learn signer pubkey
                    this.signerPubkey = ev.pubkey;
                    this.conversationKey = await Nip44.getConversationKey(this.clientPrivkey, this.signerPubkey);
                }
                if (ev.pubkey !== this.signerPubkey) return;
                // La llegada de cualquier kind 24133 del signer correcto demuestra que
                // el canal está activo. Ocultar el aviso antes de descifrar el contenido:
                // una respuesta dañada o de otra petición no debe dejarlo permanentemente visible.
                this._wakeHide();
                // Aprender una sola vez el relay por el que responde el firmador. Una respuesta
                // NIP-46 puede llegar duplicada desde varios relays; sobrescribir signerRelay con
                // cada copia hacía que las peticiones sucesivas fueran saltando entre ellos.
                if (relayUrl && !this.signerRelay) { this.signerRelay = relayUrl; this._save(); }
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

        // Cola con limite de concurrencia: abrir la bandeja NIP-17 dispara decenas de
        // nip44_decrypt a la vez; mandarlas todas de golpe hace que el relay rate-limite y
        // todas caigan en timeout. Las serializamos en grupos pequenos.
        _q: [], _inflight: 0, _maxInflight: 2, _minGap: 150, _lastSendAt: 0, _pumpScheduled: false,
        _decryptCooldownUntil: 0,
        _isDecryptMethod: function(method) {
            return method === 'nip04_decrypt' || method === 'nip44_decrypt';
        },
        _abortQueuedDecrypts: function(error) {
            var keep = [];
            for (var i = 0; i < this._q.length; i++) {
                var queued = this._q[i];
                if (this._isDecryptMethod(queued.method)) queued.reject(error);
                else keep.push(queued);
            }
            this._q = keep;
            this._decryptCooldownUntil = Date.now() + 60000;
        },
        _request: function(method, params) {
            var self = this;
            return new Promise(function(resolve, reject) {
                if (self._isDecryptMethod(method) && self._decryptCooldownUntil > Date.now()) {
                    reject(new Error('NIP-46 decrypt paused after signer timeout'));
                    return;
                }
                self._q.push({ method: method, params: params, resolve: resolve, reject: reject });
                self._pump();
            });
        },
        // Ademas del limite de concurrencia, se fuerza un hueco minimo (_minGap) entre envios
        // consecutivos: aunque _maxInflight sea 2, mandarlos sin pausa sostiene un ritmo que el
        // relay puede rate-limitar igual. El gap reparte la rafaga en el tiempo.
        _pump: function() {
            var self = this;
            while (this._inflight < this._maxInflight && this._q.length) {
                var since = Date.now() - this._lastSendAt;
                if (since < this._minGap) {
                    if (!this._pumpScheduled) {
                        this._pumpScheduled = true;
                        setTimeout(function() { self._pumpScheduled = false; self._pump(); }, this._minGap - since);
                    }
                    return;
                }
                this._lastSendAt = Date.now();
                this._inflight++;
                this._send(this._q.shift());
            }
        },
        _send: async function(job) {
            var self = this;
            try {
                NoxtrDebug.trace('[NIP46 _send] method=', job.method);
                if (!this.connected && job.method !== 'get_public_key') throw new Error('NIP-46: not connected');
                var id = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
                var payload = JSON.stringify({ id: id, method: job.method, params: job.params || [] });
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
                // Publicar la petición solo al relay del firmador si ya lo aprendimos (evita spam a
                // nsec.app/damus); si no, a la lista por defecto. Estos relays aceptan kind 24133.
                var _relays = this.signerRelay ? [this.signerRelay] : NIP46_RELAYS;
                Pool.publishToRelays(_relays, ev);
                // Aviso temprano: en condiciones normales el signer responde en <2s. Si a los 6s
                // no hay respuesta, lo mas probable es que no este escuchando (movil en reposo,
                // app en background) — avisar al usuario para que lo ponga en primer plano.
                var slowT = setTimeout(function() { self._wakeShow(str_signer_not_listening + ' (' + job.method + ')'); }, 6000);
                // Reintentos de transporte: el kind 24133 es efimero (los relays no lo guardan),
                // asi que si el signer estaba dormido cuando se publico, NO vera la peticion al
                // despertar. Re-publicar el MISMO evento cada 15s durante la espera hace que
                // "abrir el signer" baste para que la peticion llegue y todo continue solo.
                var repubT = setInterval(function() { try { Pool.publishToRelays(_relays, ev); } catch(e2) {} }, 15000);
                var result;
                try {
                    result = await new Promise(function(resolve, reject) {
                        // Los decrypt son lecturas automáticas/lazy y pueden llegar en lote: no deben
                        // mantener el canal publicando durante 90 s por mensaje si el signer duerme.
                        var timeoutMs = self._isDecryptMethod(job.method) ? 45000 : 90000;
                        var t = setTimeout(function() { delete self.pending[id]; reject(new Error('NIP-46 request timeout: ' + job.method)); }, timeoutMs);
                        self.pending[id] = { resolve: resolve, reject: reject, timeout: t };
                    });
                } finally {
                    clearTimeout(slowT);
                    clearInterval(repubT);
                }
                this._wakeHide();
                if (this._isDecryptMethod(job.method)) this._decryptCooldownUntil = 0;
                job.resolve(result);
            } catch(e) {
                // Agotado el plazo de la petición: se da por perdida y la acción
                // original fallo; hay que repetirla a mano con el signer ya a la escucha.
                if (String(e && e.message).indexOf('timeout') !== -1) {
                    this._wakeShow(str_signer_request_lost + ' (' + job.method + ')');
                    if (this._isDecryptMethod(job.method)) this._abortQueuedDecrypts(e);
                }
                job.reject(e);
            } finally {
                this._inflight--;
                this._pump();
            }
        },

        // Banner fijo "el firmador no responde": se muestra cuando una peticion tarda o caduca,
        // se oculta en cuanto llega cualquier respuesta del signer (o con la X).
        _wakeShow: function(text) {
            var el = document.getElementById('nip46-wake');
            if (!el) {
                var self = this;
                el = document.createElement('div');
                el.id = 'nip46-wake';
                el.innerHTML = '<span id="nip46-wake-msg"></span><button id="nip46-wake-close" title="' + str_dismiss + '">&#10005;</button>';
                document.body.appendChild(el);
                document.getElementById('nip46-wake-close').onclick = function() { self._wakeHide(); };
            }
            document.getElementById('nip46-wake-msg').textContent = '⚠️ ' + text;
            el.style.display = '';
        },
        _wakeHide: function() {
            var el = document.getElementById('nip46-wake');
            if (el) el.style.display = 'none';
        },

        signEvent: async function(ev) {
            var result = await this._request('sign_event', [JSON.stringify(ev)]);
            return JSON.parse(result);
        },

        // Cifrado delegado al signer remoto (el privkey vive en el signer, no en el cliente)
        nip04Encrypt: async function(pk, text) { return await this._request('nip04_encrypt', [pk, text]); },
        nip04Decrypt: async function(pk, content) { return await this._request('nip04_decrypt', [pk, content]); },
        nip44Encrypt: async function(pk, text) { return await this._request('nip44_encrypt', [pk, text]); },
        nip44Decrypt: async function(pk, content) { return await this._request('nip44_decrypt', [pk, content]); },

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
            if (!Events.privkey) throw new Error(str_need_nsec_signer);
            var uri = uriRaw.trim();
            // Decodificar si viene URL-encoded (ej: nostrconnect%3A%2F%2F...)
            if (uri.indexOf('nostrconnect://') !== 0) { try { uri = decodeURIComponent(uri); } catch(e) {} }
            if (uri.indexOf('nostrconnect://') !== 0) throw new Error(str_nostrconnect_uri_required);

            // Parsear: nostrconnect://CLIENT_PUBKEY?relay=...&secret=...&name=...
            var fakeUrl = 'https://' + uri.slice('nostrconnect://'.length);
            var parsed;
            try { parsed = new URL(fakeUrl); } catch(e) { throw new Error(str_malformed_uri); }

            var clientPubkey = parsed.hostname;
            var relays = parsed.searchParams.getAll('relay');
            var secret = parsed.searchParams.get('secret') || '';
            var name = parsed.searchParams.get('name') || 'Unknown app';

            if (!clientPubkey || clientPubkey.length !== 64 || !/^[0-9a-f]+$/i.test(clientPubkey))
                throw new Error(str_invalid_client_pubkey);

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
                    var ok = await confirm(t(str_client_wants_sign, client.name, kindDesc) + preview);
                    if (!ok) { await this._sendResponse(ev.pubkey, id, null, str_rejected_by_user); return; }
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
            var html = '<div class="bunker-active-label">' + str_connections + '</div>';
            keys.forEach(function(pk) {
                var c = Bunker.clients[pk];
                html += '<div class="bunker-client"><span class="bunker-client-name">' + escapeHtml(c.name) + '</span>'
                    + '<a class="bunker-client-disconnect" data-pk="' + pk + '">' + str_disconnect + '</a></div>';
            });
            panel.innerHTML = html;
            panel.style.display = '';
            panel.querySelectorAll('.bunker-client-disconnect').forEach(function(btn) {
                btn.onclick = function() { Bunker.stop(btn.dataset.pk); };
            });
        }
    };

    // ==================== THREADS ====================

    // Kinds que pueden aparecer en un thread: nota, artículo (NIP-23), cita/highlight (NIP-84).
    var THREAD_KINDS = [1, 30023, 9802];

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
            var _ftf = document.getElementById('feed-type-filter'); if (_ftf) _ftf.style.display = 'none';
            var comp = document.getElementById('compose-area'); if (comp) comp.style.display = 'none';
            // Keep the originating tab highlighted while viewing a single note (less confusing)
            // Hide side panels
            ['panel-following', 'panel-topics', 'panel-messages', 'panel-followers', 'panel-channels'].forEach(function(id) {
                var p = document.getElementById(id); if (p) p.style.display = 'none';
            });

            // Reply form: shown directly when the note has no replies yet (nothing to read),
            // otherwise hidden behind the header "Responder" button so replies stay the focus.
            var tComp = document.getElementById('thread-compose');
            if (tComp) {
                var noReplies = Stats.get(note.id).replies === 0;
                tComp.style.display = (Events.canSign() && noReplies) ? '' : 'none';
            }
            var trb = document.getElementById('thread-reply-btn');
            if (trb) trb.style.display = '';

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

            // Subscribe for root + all replies to root.
            // La raíz puede ser una Cita (9802) o un Artículo (30023), no solo kind 1: el filtro por
            // `ids` no lleva `kinds` para no descartarla. Las respuestas sí son siempre kind 1.
            var self = this;
            this.subId = Pool.subscribe(
                [{ ids: [this.rootId] }, { kinds: [1], '#e': [this.rootId], limit: 100 }],
                function(ev) { self._addNote(ev); },
                function() { self._onEose(); }
            );
        },

        _addNote: function(ev) {
            if (THREAD_KINDS.indexOf(ev.kind) === -1 || this.seen[ev.id]) return;
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

        showReply: function() {
            if (!Events.canSign()) {
                var nsecDiv = document.getElementById('nsec-login');
                if (nsecDiv) { nsecDiv.style.display = ''; nsecDiv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                return;
            }
            var tComp = document.getElementById('thread-compose');
            if (tComp) tComp.style.display = '';
            var tcTxt = document.getElementById('thread-compose-text');
            if (tcTxt) { tcTxt.focus(); tcTxt.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
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
            var settled = false, timer = null, tmpSubId = null;

            // OJO: NO se usa onEOSE para decidir "no encontrada". El EOSE llega por CADA relay
            // (Pool._msg), y en un permalink recién abierto los relays aún se están conectando
            // (Pool._open reenvía los REQ al abrir el socket). Cerrar la suscripción con el primer
            // EOSE mataba la búsqueda antes de que respondieran los demás relays.
            tmpSubId = Pool.subscribe(
                [{ ids: [id] }],
                function(ev) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    Pool.unsubscribe(tmpSubId);
                    if (!noPush) history.pushState({ noxtr: 'thread', noteId: ev.id }, '', '/' + _MODULE_ + '/note/' + ev.id);
                    self.open(ev);
                }
            );

            timer = setTimeout(function() {
                if (settled || self.active) return;
                settled = true;
                Pool.unsubscribe(tmpSubId);
                self.active = true;
                var tf = document.getElementById('thread-feed');
                var msg = str_note_not_found_relays;
                if (tf) tf.innerHTML = '<div class="noxtr-empty">' + msg + '<br><a class="btn btn-sm noxtr-empty-action" onclick="Noxtr.Threads.close();Noxtr.UI.switchTab(Noxtr.UI.currentTab)">' + str_close + '</a></div>';
                document.getElementById('thread-view').style.display = '';
                document.getElementById('feed').style.display = 'none';
                document.getElementById('feed-new').style.display = 'none';
                var _ftf = document.getElementById('feed-type-filter'); if (_ftf) _ftf.style.display = 'none';
                var comp = document.getElementById('compose-area'); if (comp) comp.style.display = 'none';
                document.querySelectorAll('.noxtr-tab').forEach(function(t) { t.classList.remove('active'); });
            }, 6000);
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
            if (Feed.loading) { Feed.loading.style.display = ''; Feed.loading.textContent = str_searching; }
            this._try(q);
        },

        _try: function(q) {
            this._closeWs();
            if (this._relayIdx >= NIP50_RELAYS.length) {
                // All search relays failed — show hint
                if (!Feed.notes.length && Feed.container) {
                    Feed.container.innerHTML = '<div class="noxtr-empty">' +
                    str_no_search_relays +
                        '<br><small class="noxtr-search-hint">' + str_search_relays_may_be_down + '</small></div>';
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
                ws.send(JSON.stringify(['REQ', subId, { kinds: [1, 30023, 9802], search: q, limit: 40 }]));
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
                t(str_no_results_for, escapeHtml(q)) +
                                '<br><small class="noxtr-search-hint">' + str_nip50_search_tip + '</small></div>';
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
            if (Feed.loading) { Feed.loading.style.display = ''; Feed.loading.textContent = str_searching_profiles; }
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
            var results = this._profileResults;
            if (!results.length) {
                Feed.container.innerHTML = '<div class="noxtr-empty">' +
                t(str_no_profiles_for, escapeHtml(name)) + '</div>';
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

    // Spam de DNS-tunneling publicado como kind 1: el contenido es un unico hostname con el payload
    // codificado en una etiqueta larga, p.ej.
    //   sp_4c43bd1d.1f01f758e61e7c18731427bf.08.AGGMI7HN...2GQ.drift.gits.net
    // Firma: un solo token sin espacios, solo caracteres de hostname, >=4 etiquetas y alguna con >=24
    // alfanumericos seguidos. Una URL normal lleva "://" y "/", asi que no entra por el charset.
    function _isDnsTunnelSpam(content) {
        var c = (content || '').trim();
        if (c.length < 50 || c.length > 512) return false;
        if (/\s/.test(c)) return false;
        if (!/^[A-Za-z0-9._-]+$/.test(c)) return false;
        var labels = c.split('.');
        if (labels.length < 4) return false;
        for (var i = 0; i < labels.length; i++) {
            if (labels[i].length >= 24 && /^[A-Za-z0-9]+$/.test(labels[i])) return true;
        }
        return false;
    }

    var Feed = {
        notes: [], seen: {}, byAddr: {}, container: null, loading: null, subId: null, maxNotes: 200,
        buffered: [], eoseReached: false, bannerEl: null, _hotSubId: null, _feedFilter: 'all', _autoFlushed: false, _eoseTimeout: null,
        init: function(c, l) { this.container = c; this.loading = l; this.bannerEl = document.getElementById('feed-new'); var self = this; if (this.bannerEl) this.bannerEl.onclick = function() { self.flushBuffer(); }; },
        addNote: function(ev) {
            if (ev.kind !== 1 && ev.kind !== 30023 && ev.kind !== 9802) return;
            // Ignorar spam de backlinks (aepiot y similares): kind 1 con un numero absurdo de
            // hashtags/enlaces (tags t y r). No es contenido real, es link farming SEO; se descarta
            // antes de entrar al feed. Umbral alto (>30) para no tocar notas legitimas con varios tags.
            if (ev.kind === 1) {
                var _spamTags = 0;
                for (var _si = 0; _si < ev.tags.length; _si++) { var _tt = ev.tags[_si][0]; if (_tt === 't' || _tt === 'r') _spamTags++; }
                if (_spamTags > 30) return;
                if (_isDnsTunnelSpam(ev.content)) return;
            }
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
            if (!this._matchesFilter(ev, this._feedFilter)) return;
            var el = this.renderNote(ev);
            // Count visible DOM children for correct position (notes array may have filtered items)
            var visIdx = 0;
            for (var j = 0; j < idx; j++) {
                if (!this._matchesFilter(this.notes[j], this._feedFilter)) continue;
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
                if (bNotes) parts.push(bNotes + ' ' + (bNotes > 1 ? str_notes_lower : str_note_lower));
                if (bReads) parts.push(bReads + ' ' + (bReads > 1 ? str_reads_lower : str_read_lower));
                this.bannerEl.textContent = parts.join(' + ') + ' — ' + str_click_to_load;
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
            var isHighlight = ev.kind === 9802;
            var clientVia = '';
            for (var ci = 0; ci < ev.tags.length; ci++) { if (ev.tags[ci][0] === 'client' && ev.tags[ci][1]) { clientVia = ev.tags[ci][1]; break; } }
            var el = document.createElement('div');
            el.className = 'note' + (isReply && !isArticle && !isHighlight ? ' note-is-reply' : '') + (isArticle ? ' note-article' : '') + (isHighlight ? ' note-highlight' : ''); el.id = 'note-' + ev.id; el.dataset.id = ev.id; el.dataset.pubkey = ev.pubkey;
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
            } else if (isHighlight) {
                var hl = Highlights._meta(ev);
                var hlSrcHtml = '';
                if (hl.author) hlSrcHtml += '<span class="highlight-author">&mdash; '+escapeHtml(hl.author)+'</span>';
                if (hl.source) hlSrcHtml += '<a href="'+escapeHtml(hl.source)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(hl.source)+'</a>';
                contentHtml =
                    (hl.comment ? '<div class="note-text highlight-comment">'+parseContent(hl.comment)+'</div>' : '') +
                    '<blockquote class="highlight-quote">'+escapeHtml(hl.quote)+'</blockquote>' +
                    (hl.context ? '<div class="highlight-context">'+escapeHtml(hl.context)+'</div>' : '') +
                    (hlSrcHtml ? '<div class="highlight-source">'+hlSrcHtml+'</div>' : '');
            } else {
                contentHtml =
                    (isReply ? '<div class="note-replying">'+str_replying_lower+'</div>' : '') +
                    '<div class="note-text">'+parseContent(ev.content)+'</div>';
            }
            el.innerHTML =
                '<div class="note-avatar" style="background:'+col+'" data-pubkey="'+ev.pubkey+'">'+(avOk ? '<img src="'+escapeHtml(av)+'" loading="lazy" onerror="_mediaError(this);this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="avatar-letter" style="display:none">'+ini+'</span>' : '<span class="avatar-letter">'+ini+'</span>')+'</div>' +
                '<div class="note-body">' +
                    '<div class="note-header">' +
                        '<strong class="note-name" data-pubkey="'+ev.pubkey+'" title="'+npub+'">'+escapeHtml(name)+'</strong>' +
                        '<span class="note-npub">'+shortKey(npub)+'</span>' +
                        (clientVia ? '<span class="note-via">'+str_via+' '+escapeHtml(clientVia)+'</span>' : '') +
                        '<span class="note-time" title="'+new Date(ev.created_at*1000).toLocaleString()+'">'+timeAgo(ev.created_at)+'</span>' +
                        (isArticle ? '<span class="note-badge-read">'+str_read+'</span>' : '') +
                        (isHighlight ? '<span class="note-badge-read note-badge-highlight">'+str_quote_badge+'</span>' : '') +
                    '</div>' +
                    contentHtml +
                    '<div class="note-actions">' +
                        '<a class="note-action action-reply" data-action="reply" data-id="'+ev.id+'" title="'+str_reply+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg><span class="count-replies"></span></a>' +
                        '<a class="note-action action-like" data-action="like" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_like+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span class="count-likes"></span></a>' +
                        '<a class="note-action action-repost" data-action="repost" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_repost+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span class="count-reposts"></span></a>' +
                        '<a class="note-action action-zap" data-action="zap" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_zap+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="count-zaps"></span></a>' +
                        '<a class="note-action'+(isBookmarked?' bookmarked':'')+' action-bookmark" data-action="bookmark" data-id="'+ev.id+'" title="'+str_bookmark+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="'+(isBookmarked?'currentColor':'none')+'" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>' +
                        '<a class="note-action'+(isFollowed?' followed':'')+' action-follow" data-action="follow" data-pubkey="'+ev.pubkey+'" title="'+(isFollowed?str_unfollow:str_follow)+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/>'+(isFollowed?'':'<line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>')+'</svg></a>' +
                        '<a class="note-action action-dm" data-action="dm" data-pubkey="'+ev.pubkey+'" title="'+str_message+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></a>' +
                        '<a class="note-action action-share" data-action="share" data-id="'+ev.id+'" title="'+str_share+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                        (!isOwn ? '<a class="note-action action-mute" data-action="mute" data-id="'+ev.id+'" data-pubkey="'+ev.pubkey+'" title="'+str_mute_report+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></a>' : '') +
                        (isOwn ? '<a class="note-action note-action-delete" data-action="delete" data-id="'+ev.id+'" title="'+str_delete+'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '') +
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
        //\ Los artículos (30023) van en un filtro APARTE: el `limit` es por filtro, y compartiéndolo
        // con kind 1 el volumen de notas se come las 30 plazas y no llega ningún artículo.
        subscribeGlobal: function() { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 9802], limit: 30 }, { kinds: [30023], limit: 20 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        subscribeHot: function() {
            if (this.subId) Pool.unsubscribe(this.subId); this.subId = null;
            if (this._hotSubId) { Pool.unsubscribe(this._hotSubId); this._hotSubId = null; }
            var self = this;
            var eoseTimer = null;

            if (this.loading) { this.loading.style.display = ''; this.loading.textContent ='🔥 ' + str_finding_trending; }

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
                            if (self.container) self.container.innerHTML = '<div class="noxtr-empty">' + '🔥 ' + str_no_trending_notes + '</div>';
                            if (self.loading) { self.loading.textContent = ''; self.loading.style.display = 'none'; }
                            return;
                        }

                if (self.loading) self.loading.textContent = str_loading_popular_notes;

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
                            [{ kinds: [1, 30023, 9802], ids: hotIds }],
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
        subscribeAuthors: function(pks) { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 9802], authors: pks, limit: 30 }, { kinds: [30023], authors: pks, limit: 20 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        subscribeTopics: function(topics) { if (this.subId) Pool.unsubscribe(this.subId); var self = this; this.subId = Pool.subscribe([{ kinds: [1, 9802], '#t': topics, limit: 30 }, { kinds: [30023], '#t': topics, limit: 20 }], function(ev) { self.addNote(ev); }, function() { self._onEose(); }); },
        clear: function() { if (this.subId) { Pool.unsubscribe(this.subId); this.subId = null; } if (this._hotSubId) { Pool.unsubscribe(this._hotSubId); this._hotSubId = null; } if (this._eoseTimeout) { clearTimeout(this._eoseTimeout); this._eoseTimeout = null; } Stats.clear(); this.notes = []; this.seen = {}; this.byAddr = {}; this.buffered = []; this.eoseReached = false; this._autoFlushed = false; this._updateBanner(); this._updateFilterCounts(); if (this.container) this.container.innerHTML = ''; if (this.loading) { this.loading.style.display = ''; this.loading.textContent = str_loading; } },
        // Predicado único del filtro de tipo. 'notes' = solo kind 1: las Citas (9802) tienen su propio
        // chip y ya no se cuelan entre las notas.
        _matchesFilter: function(ev, filter) {
            if (filter === 'notes')  return ev.kind === 1;
            if (filter === 'reads')  return ev.kind === 30023;
            if (filter === 'quotes') return ev.kind === 9802;
            return true; // 'all'
        },
        applyFilter: function(filter) {
            this._feedFilter = filter;
            if (!this.container) return;
            this.container.innerHTML = '';
            for (var i = 0; i < this.notes.length; i++) {
                var ev = this.notes[i];
                if (!this._matchesFilter(ev, filter)) continue;
                this.container.appendChild(this.renderNote(ev));
            }
        },
        _updateFilterCounts: function() {
            var notes = 0, reads = 0, quotes = 0;
            for (var i = 0; i < this.notes.length; i++) {
                var k = this.notes[i].kind;
                if (k === 30023) reads++;
                else if (k === 9802) quotes++;
                else notes++;
            }
            var cAll = document.getElementById('filter-count-all');
            var cNotes = document.getElementById('filter-count-notes');
            var cReads = document.getElementById('filter-count-reads');
            var cQuotes = document.getElementById('filter-count-quotes');
            if (cAll) cAll.textContent = notes + reads + quotes;
            if (cNotes) cNotes.textContent = notes;
            if (cReads) cReads.textContent = reads;
            if (cQuotes) cQuotes.textContent = quotes;
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
                    DMs.renderThreadAvatar(pk);
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
            $('#noxtr-version').click( function() {
                Noxtr.Pool.toggleMetrics();
            });

            $('#btn-info').click( function() {
                $("body").dialog({
                    title: "🔧 " + str_info_title,
                    type: 'html',
                    width: "800px",
                    height: "90%",
                    content: '#info-panel',
                    openAnimation: 'slide-up',
                    closeAnimation: 'slide-down',
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

            // Onboarding de topics para logueados sin topics (una sola vez).
            function showTopicPicker() {
                var chips = SUGGESTED_TOPICS.map(function(t) {
                    return '<a class="topic-suggestion onb-chip" data-topic="'+t+'">#'+t+'</a>';
                }).join(' ');
                var html = '<div class="noxtr-info" style="padding:14px 16px;">' +
                    '<p>' + str_topic_picker_intro + '</p>' +
                    '<div style="margin:10px 0;">'+chips+'</div>' +
                    '<div style="display:flex;gap:6px;margin-top:8px;">' +
                        '<input type="text" id="onb-input" placeholder="#hashtag" style="flex:1;padding:6px 8px;">' +
                        '<a class="btn btn-noxtr btn-primary" id="onb-add">+</a>' +
                    '</div>' +
                    '<p style="font-size:0.85em;opacity:0.7;margin-top:12px;">' + str_topic_picker_note + '</p>' +
                '</div>';
                $("body").dialog({
                    title: str_topic_picker_title,
                    type: 'html',
                    width: '500px',
                    height: 'auto',
                    content: html,
                    openAnimation: 'slide-up',
                    closeAnimation: 'slide-down',
                    buttons: [{
                        text: str_done,
                        class: 'btn btn-primary',
                        action: function(e, ov) {
                            localStorage.setItem('noxtr_topic_picker_seen', '1');
                            document.body.removeChild(ov);
                            Topics.render();
                            UI.switchTab('topics');
                        }
                    }],
                    onLoad: function(dialog) {
                        var $ov = $(dialog.overlay);
                        $ov.find('.onb-chip').on('click', async function() {
                            if (this.classList.contains('onb-picked')) return;
                            this.classList.add('onb-picked');
                            this.style.opacity = '0.45';
                            await Topics.add($(this).data('topic'));
                        });
                        $ov.find('#onb-add').on('click', async function() {
                            var v = $ov.find('#onb-input').val().trim();
                            if (v) { await Topics.add(v); $ov.find('#onb-input').val(''); }
                        });
                        $ov.find('#onb-input').on('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); $ov.find('#onb-add').trigger('click'); } });
                    }
                });
            }

            // Diálogo automático en /noxtr según el estado del usuario.
            var atRoot = location.pathname.replace(/\/$/, '') === '/noxtr';
            if (atRoot) {
                if (!Api.userId) {
                    // Primera visita de un anónimo: elegir topics (se guardan en localStorage).
                    // Visitas posteriores: panel de bienvenida.
                    if (!localStorage.getItem('noxtr_topic_picker_seen') && SUGGESTED_TOPICS.length) {
                        showTopicPicker();
                    } else if (document.getElementById('welcome-panel')) {
                        $("body").dialog({
                            title: "👋 " + str_welcome_title,
                            type: 'html',
                            width: "640px",
                            height: "auto",
                            content: '#welcome-panel',
                            openAnimation: 'slide-up',
                            closeAnimation: 'slide-down',
                            buttons: [$.dialog.closeButton],
                        });
                    }
                } else if (Api.userId && !Topics.list.length && !localStorage.getItem('noxtr_topic_picker_seen')) {
                    showTopicPicker();
                } else if (Api.userId && !localStorage.getItem(infoKey)) {
                    $('#btn-info').click();
                }
            }


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

            // Add NIP-96 server
            var btnAddN96 = document.getElementById('btn-add-nip96'), n96In = document.getElementById('nip96-input');
            if (btnAddN96) btnAddN96.onclick = async function() {
                var u = n96In.value.trim();
                if (u && /^https?:\/\//i.test(u)) {
                    var r = await Nip96.add(u);
                    if (r && r.error) { alert(r.msg || 'Error adding server'); return; }
                    n96In.value = '';
                    Nip96.render();
                }
            };
            if (n96In) n96In.onkeydown = function(e) { if (e.key === 'Enter') btnAddN96.onclick(); };

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
                    else if (fmt === 'nowplaying') { return; } // handled separately below
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

            // Now Playing (Spotify) button
            var npBtn = document.querySelector('.compose-fmt[data-fmt="nowplaying"]');
            if (npBtn) npBtn.onclick = async function() {
                var ta = document.getElementById('compose-text'); if (!ta) return;
                var prev = npBtn.innerHTML;
                npBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
                try {
                    var res = await fetch('/spotify/ajax/option=nowplaying', { credentials: 'same-origin' });
                    var data = await res.json();
                    if (!data || data.error !== 0) {
                alert(data && data.msg ? data.msg : str_nothing_playing);
                        return;
                    }

                    // Attach cover as compose image so it gets uploaded with the post (NIP-96).
                    // Spotify CDN URLs have no extension and won't render as image in Nostr clients otherwise.
                    var coverAttached = false;
                    if (data.cover && imgInput && imgPreview) {
                        try {
                            var imgRes = await fetch(data.cover, { credentials: 'omit' });
                            if (imgRes.ok) {
                                var blob = await imgRes.blob();
                                if (blob.size <= 5 * 1024 * 1024 && /^image\/(jpeg|png|gif|webp)$/.test(blob.type)) {
                                    var ext = blob.type.split('/')[1].replace('jpeg', 'jpg');
                                    var file = new File([blob], 'spotify-cover.' + ext, { type: blob.type });
                                    var dt = new DataTransfer();
                                    dt.items.add(file);
                                    imgInput.files = dt.files;
                                    imgInput.dispatchEvent(new Event('change'));
                                    coverAttached = true;
                                }
                            }
                        } catch (e) { /* CORS or network: fall back to URL in text */ }
                    }

                    var lines = ['Now playing: **' + data.track + '** - ' + data.artist];
                    if (data.url)   lines.push(data.url);
                    if (data.cover && !coverAttached) lines.push(data.cover);
                    if (data.context_type && data.context_url) {
                        var ctxLabel = data.context_type.charAt(0).toUpperCase() + data.context_type.slice(1);
                        lines.push(ctxLabel + (data.context_name ? ': ' + data.context_name : ''));
                        lines.push(data.context_url);
                    }
                    var block = lines.join('\n');
                    var s = ta.selectionStart, v = ta.value;
                    var pre  = (s > 0 && v[s - 1] !== '\n') ? '\n' : '';
                    var post = (v[s] && v[s] !== '\n') ? '\n' : '';
                    ta.value = v.substring(0, s) + pre + block + post + v.substring(s);
                    ta.selectionStart = ta.selectionEnd = s + pre.length + block.length + post.length;
                    ta.focus();
                } catch (err) {
            alert(str_spotify_fetch_error);
                } finally {
                    npBtn.innerHTML = prev;
                }
            };

            // File attach (image, audio, video, pdf, epub)
            var imgInput = document.getElementById('compose-image-input');
            var imgBtn = document.getElementById('btn-attach-image');
            var imgPreview = document.getElementById('compose-image-preview');
            var _audioMeta = null;   // { artist, title, album, coverFile } cuando hay ID3 con carátula
            if (imgBtn) imgBtn.onclick = function() { imgInput.click(); };
            if (imgInput) imgInput.onchange = function() {
                var file = this.files[0]; if (!file) return;
                _audioMeta = null;
                var name = file.name || '';
                var ext = (name.split('.').pop() || '').toLowerCase();
                var mime = file.type || '';
                var kind = '';
                if (/^image\/(jpeg|png|gif|webp)$/.test(mime))                              kind = 'image';
                else if (/^audio\//.test(mime) || /^(mp3|m4a|ogg|oga|wav)$/.test(ext))      kind = 'audio';
                else if (/^video\//.test(mime) || /^(mp4|webm|mkv|mov)$/.test(ext))         kind = 'video';
                else if (mime === 'application/pdf' || ext === 'pdf')                       kind = 'pdf';
                else if (mime === 'application/epub+zip' || ext === 'epub')                 kind = 'epub';
                if (!kind)                                  { alert(str_unsupported_file_format); this.value = ''; return; }
                if (file.size > 50 * 1024 * 1024)           { alert(str_compose_file_too_large); this.value = ''; return; }
                this.dataset.fileKind = kind;
                var renderPreview = function(src) {
                    var inner;
                    if      (kind === 'image') inner = '<img src="' + src + '">';
                    else if (kind === 'audio') inner = '<audio src="' + src + '" controls></audio>';
                    else if (kind === 'video') inner = '<video src="' + src + '" controls></video>';
                    else {
                        var ic = kind === 'pdf' ? 'fa-file-pdf-o' : 'fa-book';
                        inner = '<span class="compose-file-name"><i class="fa ' + ic + '"></i> ' + escapeHtml(name) + '</span>';
                    }
                    var meta = '';
                    if (kind === 'audio' && _audioMeta) {
                        var tagLine = [_audioMeta.artist, _audioMeta.title].filter(Boolean).join(' - ');
                        if (_audioMeta.album) tagLine += (tagLine ? ' ' : '') + '(' + _audioMeta.album + ')';
                        var coverImg = _audioMeta.coverDataUrl ? '<img class="compose-audio-cover" src="' + _audioMeta.coverDataUrl + '">' : '';
                        meta = '<div class="compose-audio-meta">' + coverImg + '<span class="compose-audio-tags">' + escapeHtml(tagLine) + '</span></div>';
                    }
                    imgPreview.innerHTML = '<div class="compose-preview-wrap">' + meta + inner + '<a class="compose-preview-remove">&times;</a></div>';
                    imgPreview.style.display = '';
                    imgPreview.querySelector('.compose-preview-remove').onclick = function() {
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = ''; _audioMeta = null;
                    };
                };
                if (kind === 'pdf' || kind === 'epub') {
                    renderPreview(null);
                } else if (kind === 'audio' && typeof jsmediatags !== 'undefined') {
                    // Render audio preview ya (sin esperar tags) y luego enriquecer si hay ID3
                    var reader = new FileReader();
                    reader.onload = function(e) { renderPreview(e.target.result); };
                    reader.readAsDataURL(file);
                    jsmediatags.read(file, {
                        onSuccess: function(tag) {
                            var tags = tag.tags || {};
                            var coverFile = null, coverDataUrl = '';
                            if (tags.picture && tags.picture.data && tags.picture.data.length) {
                                var pf = tags.picture.format || 'image/jpeg';
                                var bytes = new Uint8Array(tags.picture.data);
                                var b64 = ''; for (var i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
                                coverDataUrl = 'data:' + pf + ';base64,' + window.btoa(b64);
                                var coverExt = pf === 'image/png' ? 'png' : 'jpg';
                                coverFile = new File([bytes], 'cover.' + coverExt, { type: pf });
                            }
                            if (!tags.artist && !tags.title && !tags.album && !coverFile) return;  // nada útil
                            _audioMeta = { artist: tags.artist || '', title: tags.title || '', album: tags.album || '', coverFile: coverFile, coverDataUrl: coverDataUrl };
                            // Re-render con metadatos
                            var r2 = new FileReader();
                            r2.onload = function(e) { renderPreview(e.target.result); };
                            r2.readAsDataURL(file);
                        },
                        onError: function(err) { console.warn('[noxtr] jsmediatags failed:', err); }
                    });
                } else {
                    var reader = new FileReader();
                    reader.onload = function(e) { renderPreview(e.target.result); };
                    reader.readAsDataURL(file);
                }
            };

            // Publish
            var btnPub = document.getElementById('btn-publish'), compTxt = document.getElementById('compose-text');
            var compTagsInput = document.getElementById('compose-tags');
            if (btnPub) btnPub.onclick = async function() {
                var text = compTxt.value.trim();
                var hasFile = imgInput && imgInput.files && imgInput.files.length > 0;
                var fileKind = hasFile ? (imgInput.dataset.fileKind || '') : '';
                var isArticle = self._composeMode === 'article';
                var isHighlight = self._composeMode === 'highlight';
                var hlQuote, hlContext, hlSource;

                if (isArticle) {
                    var artTitle = (document.getElementById('article-title').value || '').trim();
        if (!artTitle) { alert(str_title_required); return; }
        if (!text) { alert(str_content_required); return; }
                } else if (isHighlight) {
                    hlQuote = (document.getElementById('highlight-quote').value || '').trim();
                    hlContext = (document.getElementById('highlight-context').value || '').trim();
                    hlSource = (document.getElementById('highlight-source').value || '').trim();
                    if (!hlQuote) { alert(str_highlight_quote_required); return; }
                } else {
                    if (!text && !hasFile) return;
                }
        if (!Events.canSign()) { alert(str_need_nip07_or_nsec_publish); return; }

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

                    // Upload file if attached (NIP-96). Para audio con ID3+carátula, sube primero la carátula como imagen aparte.
                    var uploadedUrl = '', coverUrl = '', audioTagLine = '';
                    if (hasFile) {
                        if (fileKind === 'audio' && _audioMeta && _audioMeta.coverFile) {
                            btnPub.textContent = 'Uploading cover...';
                            try { coverUrl = (await Nip96.upload(_audioMeta.coverFile)).url; }
                            catch (e) { console.warn('[noxtr] cover upload failed:', e.message); }
                        }
                        btnPub.textContent = 'Uploading...';
                        var upRes = await Nip96.upload(imgInput.files[0]);
                        uploadedUrl = upRes.url;
                        if (fileKind === 'audio' && _audioMeta) {
                            var l = [_audioMeta.artist, _audioMeta.title].filter(Boolean).join(' - ');
                            if (_audioMeta.album) l += (l ? ' ' : '') + '(' + _audioMeta.album + ')';
                            audioTagLine = l;
                        }
                    }

                    btnPub.textContent = 'Publishing...';

                    if (isArticle) {
                        var artSummary = (document.getElementById('article-summary').value || '').trim();
                        var coverFromUpload = (fileKind === 'image') ? uploadedUrl : (coverUrl || '');
                        var artImage = (document.getElementById('article-image').value || '').trim() || coverFromUpload;
                        var artDtag = (document.getElementById('article-dtag').value || '').trim();
                        if (uploadedUrl && fileKind !== 'image') {
                            var block = '';
                            if (audioTagLine) block += audioTagLine + '\n';
                            if (coverUrl)     block += coverUrl + '\n';
                            block += uploadedUrl;
                            text = text + '\n\n' + block;
                        }
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
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = ''; _audioMeta = null;
                    } else if (isHighlight) {
                        var ctxToSend = self._highlightSubmode === 'context' ? hlContext : '';
                        var published = await Highlights.publish(hlQuote, text, ctxToSend, hlSource, extraTags);
                        var emptyMsgH = Feed.container.querySelector('.noxtr-empty'); if (emptyMsgH) emptyMsgH.remove();
                        Profiles.request(published.pubkey);
                        Feed.seen[published.id] = true;
                        Feed._insertNote(published);
                        if (Feed.loading) Feed.loading.style.display = 'none';
                        compTxt.value = '';
                        document.getElementById('highlight-quote').value = '';
                        document.getElementById('highlight-context').value = '';
                        document.getElementById('highlight-source').value = '';
                        if (compTagsInput) compTagsInput.value = '';
                    } else {
                        if (uploadedUrl) {
                            var noteBlock = '';
                            if (audioTagLine) noteBlock += audioTagLine + '\n';
                            if (coverUrl)     noteBlock += coverUrl + '\n';
                            noteBlock += uploadedUrl;
                            text = (text ? text + '\n' : '') + noteBlock;
                        }
                        // Add extra tags to the note via Events.publish
                        var published = await Events.publish(text, self.replyingTo, extraTags);
                        // Clear empty message if present, then insert note locally
                        var emptyMsg = Feed.container.querySelector('.noxtr-empty'); if (emptyMsg) emptyMsg.remove();
                        Profiles.request(published.pubkey);
                        Feed.seen[published.id] = true;
                        Feed._insertNote(published);
                        if (Feed.loading) Feed.loading.style.display = 'none';
                        compTxt.value = ''; self.cancelReply();
                        if (compTagsInput) compTagsInput.value = '';
                        imgPreview.innerHTML = ''; imgPreview.style.display = 'none'; imgInput.value = ''; _audioMeta = null;
                    }
                }
            catch(e) { alert(t(str_error_generic, e.message)); }
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
                // Sin npub/nsec introducido, el Login util es el de la web: llevar a /login
                // (alli estan todos los metodos: Nostr/NIP-46, passwordless, password...)
                var v = nsecIn.value.trim(); if (!v) { window.location.href = '/login'; return; }
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
                                    _openNostrKeysDb().then(function(_db) {
                                        if (!_db.objectStoreNames.contains('keys')) { _db.close(); return; }
                                        var _tx = _db.transaction('keys', 'readwrite');
                                        _tx.objectStore('keys').put({ id: 'guest', userId: null, npub: npub, nsec: v, pubkeyHex: Events.pubkey, privkeyHex: Events.privkey, createdAt: new Date().toISOString(), createdOn: window.location.hostname });
                                        _tx.oncomplete = function() { _db.close(); };
                                    }).catch(function() {});
                                } catch(e3) {}
                                autoLoginNostr(pendingBackupUsername); // will reload page on success
                                return;
                            }
                        }
                        // If a reply was pending, scroll to compose
                        if (self.replyingTo) {
                            var comp = document.getElementById('compose-area');
                            if (comp) { comp.style.display = ''; setTimeout(function() { comp.scrollIntoView({ behavior: 'smooth', block: 'center' }); compTxt.focus(); }, 100); }
                        }
                    }
            } catch(e) { alert(t(str_invalid_key_error, e.message)); }
            };

            // Load backup file → put nsec into the input field.
            // pendingBackupUsername: username dueño del backup (data.username); se envía a
            // nostr_verify para iniciar sesión con la cuenta existente en vez de crear una nueva.
            var pendingBackupUsername = '';
            var backupLoginFile = document.getElementById('backup-login-file');
            if (backupLoginFile) backupLoginFile.onchange = async function() {
                var file = this.files[0]; if (!file) return;
                this.value = '';
                pendingBackupUsername = '';
                var wrapper;
                try { wrapper = JSON.parse(await file.text()); } catch(e) {
            alert(t(str_backup_read_error, e.message));
                    return;
                }

                function _applyNsec(nsec) {
                    var inp = document.getElementById('nsec-input');
                    if (inp) { inp.value = nsec; inp.focus(); }
                }

                if (!wrapper.encrypted) {
                    var d = wrapper.data;
            if (!d || !d.nsec) { alert(str_backup_no_nsec); return; }
                    pendingBackupUsername = d.username || '';
                    _applyNsec(d.nsec);
                    return;
                }

                // Encrypted backup: show proper dialog instead of prompt()
                $("body").dialog({
                    title: '🔒 ' + str_decrypt_backup,
                    type: 'html',
                    width: '340px',
                    content: '<div class="backup-decrypt-dialog">'
                        + '<label class="backup-decrypt-label">'
                        + str_backup_password
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
                            text: str_cancel,
                            class: 'btn',
                            action: function(_e, overlay) { document.body.removeChild(overlay); }
                        },
                        {
                            text: str_decrypt,
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
            if (!data || !data.nsec) { alert(str_backup_no_nsec); return; }
                                    pendingBackupUsername = data.username || '';
                                    _applyNsec(data.nsec);
                                } catch(e) {
                alert(str_wrong_backup_password);
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
                var accountUsername = Api.username || '', accountEmail = '';
                if (Api.userId) {
                    var r = await Api.call('get_profile');
                    if (!r.error && r.data) {
                        p.name = r.data.name || p.name || '';
                        p.about = r.data.about || p.about || '';
                        p.picture = r.data.picture || p.picture || '';
                        if (r.data.username) accountUsername = r.data.username;
                        accountEmail = r.data.user_email || '';
                    }
                }
                document.getElementById('profile-name').value = p.name || p.display_name || Api.username || '';
                document.getElementById('profile-about').value = p.about || '';
                document.getElementById('profile-picture').value = p.picture || '';
                document.getElementById('profile-nip05').value = p.nip05 || (Api.username ? Api.username + '@' + location.hostname : '');
                var inpUsername = document.getElementById('profile-username'), inpEmail = document.getElementById('profile-user-email');
                if (inpUsername) inpUsername.value = accountUsername;
                if (inpEmail) inpEmail.value = accountEmail;
                var usernameHint = document.getElementById('profile-username-hint');
                if (usernameHint) usernameHint.textContent = t(str_account_username_hint, location.hostname);
                profilePanel.style.display = profilePanel.style.display === 'none' ? '' : 'none';
            };
            // Guardar: un solo botón para toda la ficha (cuenta + perfil Nostr). La parte de
            // cuenta (usuario/email, solo CLI_USER) no necesita firma; la de perfil Nostr
            // (nombre/bio/foto/nip05, publica un kind 0) sí. Si no hay firma disponible se
            // guarda igualmente la cuenta y se avisa, en vez de bloquear todo el formulario.
            var btnSaveProfile = document.getElementById('btn-save-profile');
            if (btnSaveProfile) btnSaveProfile.onclick = async function() {
                var inpUsername = document.getElementById('profile-username'), inpEmail = document.getElementById('profile-user-email');
                var newUsername = (inpUsername.value || '').trim().toLowerCase();
                var newEmail = (inpEmail.value || '').trim();
                if (!newUsername || !newEmail) { alert(str_account_fields_required); return; }
                if (newUsername !== Api.username && !await confirm(t(str_account_username_change_confirm, Api.username || '-', newUsername, location.hostname))) {
                    return;
                }
                try {
                    btnSaveProfile.textContent = '...'; btnSaveProfile.style.pointerEvents = 'none';
                    if (Api.userId) {
                        var accRes = await Api.call('update_account', { username: newUsername, user_email: newEmail });
                        if (accRes.error) { alert(accRes.msg || str_error_generic); return; }
                        Api.username = accRes.data.username;
                        inpUsername.value = accRes.data.username;
                        inpEmail.value = accRes.data.user_email;
                        var usernameHint = document.getElementById('profile-username-hint');
                        if (usernameHint) usernameHint.textContent = t(str_account_username_hint, location.hostname);
                        try { ProfileNudge.render(); } catch(e) {}
                    }
                    if (!Events.canSign()) {
                        notify(str_account_saved, 'success', 3000);
                        alert(str_need_nsec_or_nip07_update_profile);
                        return;
                    }
                    var existing = Profiles.get(Events.pubkey) || {};
                    var nip05Input = document.getElementById('profile-nip05').value.trim();
                    var profile = { name: document.getElementById('profile-name').value.trim(), display_name: document.getElementById('profile-name').value.trim(), about: document.getElementById('profile-about').value.trim(), picture: document.getElementById('profile-picture').value.trim(), nip05: nip05Input };
                    // Preserve fields not in the editor (banner, lud16, lud06, etc.)
                    profile.banner = existing.banner || '';
                    if (existing.lud06) profile.lud06 = existing.lud06;
                    if (existing.lud16) profile.lud16 = existing.lud16;
                    // nip05 respeta lo que el usuario haya escrito (puede ser un NIP-05 externo);
                    // solo se rellena con usuario@dominio si lo dejó vacío. lud16 (Lightning
                    // Address) sí se fuerza siempre: no hay otro sitio que sirva ese LNURL.
                    if (!nip05Input && Api.username) profile.nip05 = Api.username + '@' + location.hostname;
                    if (Api.username) profile.lud16 = Api.username + '@' + location.hostname;
                    // Save to local DB
                    if (Api.userId) {
                        await Api.call('save_profile', { name: profile.name, about: profile.about, picture: profile.picture, pubkey: Events.pubkey });
                    }
                    // Publish to Nostr
                    await Events.publishProfile(profile);
                    profilePanel.style.display = 'none';
                    self.updateIdentity();
                    // Reflejar la imagen elegida de inmediato (updateIdentity solo la aplica
                    // como fallback cuando el avatar sigue siendo el por defecto).
                    if (profile.picture) { var avEl = document.getElementById('noxtr-avatar'); if (avEl) avEl.src = profile.picture; }
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
            } catch(e) { alert(t(str_error_generic, e.message)); }
                finally { btnSaveProfile.textContent = str_save; btnSaveProfile.style.pointerEvents = ''; }
            };
            var btnCancelProfile = document.getElementById('btn-cancel-profile');
            if (btnCancelProfile) btnCancelProfile.onclick = function() { profilePanel.style.display = 'none'; };
            var btnArbitratorProfile = document.getElementById('btn-arbitrator-profile');
            if (btnArbitratorProfile) btnArbitratorProfile.onclick = function() {
                if (!window.Onchain || !window.Onchain.Arbitrators || !window.Onchain.Arbitrators.openRegisterDialog) {
            alert(str_onchain_arbs_unavailable);
                    return;
                }
                window.Onchain.Arbitrators.openRegisterDialog();
            };

            // ---- Export / Import backup ----
            var btnExport = document.getElementById('btn-export-profile');
            if (btnExport) btnExport.onclick = async function() {
                try {
                    // Get nsec from IndexedDB
                    var keys = await loadStoredKeys(Api.userId);
                    // Get server data (contacts, topics, channels, relays, bookmarks, muted)
                    var res = await Api.call('export_data');
                    if (!res || res.error) throw new Error(str_server_data_error);
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

                    var pwd = await prompt(str_encrypt_backup_prompt);
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
        alert(t(str_export_error, e.message));
                }
            };

            var btnShowNsec = document.getElementById('btn-show-nsec');
            if (btnShowNsec) btnShowNsec.onclick = async function() {
                var keys = await loadStoredKeys(Api.userId);
                var nsec = keys ? keys.nsec : (Events.privkey ? nsecEncode(Events.privkey) : '');
        if (!nsec) { alert('⚠️ '+str_private_key_not_found); return; }
                var content = '<div class="nsec-qr-dialog">'
                    + '<p class="nsec-qr-warning">⚠️ ' + escapeHtml(str_nsec_qr_warning) + '</p>'
                    + '<div id="nsec-qr" class="nsec-qr-code"></div>'
                    + '<div class="nsec-qr-text">' + escapeHtml(nsec) + '</div>'
                    + '<p class="nsec-qr-hint">' + escapeHtml(str_nsec_qr_hint) + '</p>'
                    + '</div>';
                // El QR se pinta tras renderizarse el dialog (mismo patrón que signer)
                setTimeout(function() {
                    var qrEl = document.getElementById('nsec-qr');
                    if (qrEl && typeof QRCode !== 'undefined') {
                        new QRCode(qrEl, { text: nsec, width: 220, height: 220,
                            colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
                    }
                }, 0);
                $("body").dialog({
                    title: '🔑 ' + str_nsec_qr_title,
                    type: 'html',
                    width: '340px',
                    openAnimation: 'zoom',
                    closeAnimation: 'fade',
                    content: content,
                    buttons: [
                        { text: str_copy, class: 'btn', action: function() {
                            navigator.clipboard.writeText(nsec).then(function() {
                                if (typeof notify !== 'undefined') notify(str_copied, 'success', 2000);
                            });
                        } },
                        { text: str_close, class: 'btn btn-primary', action: function(_e, overlay) {
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                        } }
                    ]
                });
            };

            var importFileInput = document.getElementById('import-profile-file');
            if (importFileInput) importFileInput.onchange = async function() {
                var file = this.files[0]; if (!file) return;
                this.value = '';
                try {
                    var text = await file.text();
                    var wrapper = JSON.parse(text);
                    var importObj;

                    if (wrapper.encrypted) {
                        var pwd = await prompt(str_backup_password_prompt);
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

                    var ok = await confirm(str_import_backup_confirm);
                    if (!ok) return;

                    // Restore nsec to IndexedDB. El npub no es necesario en el JSON:
                    // si falta, se deriva del propio nsec.
                    var importedKey = false;
                    if (importObj.nsec) {
                        var privHex = nsecDecode(importObj.nsec);
                        if (privHex) {
                            Events.setPrivkey(privHex);
                            var importNpub = (importObj.npub && importObj.npub.indexOf('npub') === 0)
                                ? importObj.npub : npubEncode(Events.pubkey);
                            saveKeysToIndexedDB(Api.userId, importNpub, importObj.nsec, Events.pubkey, Events.privkey);
                            importedKey = true;
                        }
                    }

                    // Vincular la identidad importada a la cuenta de la sesión en el servidor
                    // (actualiza CLI_USER.nostr_pubkey vía nostr_link, verificado por firma).
                    // Sin esto, el "login con nostr" seguiría apuntando a la identidad antigua.
                    var linkMsg = '';
                    if (importedKey && Api.userId && Api.loginAjaxUrl) {
                        try {
                            var lcResp = await fetch(Api.loginAjaxUrl + '/op=nostr_link_challenge', { method: 'POST' });
                            var lcData = await lcResp.json();
                            if (lcData.success) {
                                var linkEv = await Events.create(22242, '', [['challenge', lcData.challenge], ['domain', window.location.hostname]]);
                                var signedLinkEv = await Events.sign(linkEv);
                                var lResp = await fetch(Api.loginAjaxUrl + '/op=nostr_link', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: 'event=' + encodeURIComponent(JSON.stringify(signedLinkEv))
                                });
                                var lData = await lResp.json();
                                if (!lData.success) linkMsg = '\n⚠️ ' + (lData.msg || str_link_identity_failed);
                            }
                        } catch(eLink) { console.warn('nostr_link error:', eLink); }
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

                    if (!res || res.error) throw new Error(str_server_import_failed);

            alert('✅ '+str_backup_imported_reload + linkMsg);
                } catch(e) {
            alert(t(str_import_error, e.message));
                }
            };

            // Tab switching
            document.querySelectorAll('.noxtr-tab[data-tab]').forEach(function(tab) {
                tab.onclick = function() { self.switchTab(tab.dataset.tab, true); };
            });

            // Navegación inferior: Inicio, Mercado y Perfil.
            /************/
            document.querySelectorAll('#noxtr-bottom-nav [data-nav]').forEach(function(btn) {
                btn.onclick = function() {
                    var nav = btn.dataset.nav;
                    if      (nav === 'topics'  ) {  self.switchTab('topics',   true);  }
                    else if (nav === 'mostro'  ) {  self.switchTab('mostro',   true);  }
                    else if (nav === 'search'  ) {  self.switchTab('search',   true);  }
                    else if (nav === 'messages') {  self.switchTab('messages', true);  } 
                    else if (nav === 'profile' && Events.pubkey) {  location.href = '/login/profile/'; }
                    // El marcado de activo NO se hace aquí: lo hace syncBottomNav desde switchTab
                    // y activateSearch, así que acierta igual venga el clic de este nav, de las
                    // pestañas de arriba, del botón atrás o de la carga directa de la URL.
                };
            });
            /********/
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
                } else { alert(str_invalid_npub_hex); }
            };
            if (followIn) followIn.onkeydown = function(e) { if (e.key === 'Enter') btnAddF.onclick(); };

            // Topics: add
            var btnAddT = document.getElementById('btn-add-topic'), topicIn = document.getElementById('topic-input');
            if (btnAddT) btnAddT.onclick = async function() {
                var t = topicIn.value.trim(); if (!t) return;
                await Topics.add(t); topicIn.value = ''; Topics.render(); self.switchTab('topics');
            };
            if (topicIn) topicIn.onkeydown = function(e) { if (e.key === 'Enter') btnAddT.onclick(); };

            // click en el cuerpo de la nota/articulo NO abre el hilo; se entra con el icono responder
            self._openOnBodyClick = false;
            // Compose: mode toggle (Note / Article / Highlight)
            self._composeMode = 'note';
            self._highlightSubmode = 'comment';
            var articleFields = document.getElementById('compose-article-fields');
            var highlightFields = document.getElementById('compose-highlight-fields');
            var highlightContext = document.getElementById('highlight-context');
            document.querySelectorAll('.compose-mode').forEach(function(btn) {
                btn.onclick = function() {
                    document.querySelectorAll('.compose-mode').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self._composeMode = btn.dataset.mode;
                    var isArt = self._composeMode === 'article';
                    var isHl = self._composeMode === 'highlight';
                    if (articleFields) articleFields.style.display = isArt ? '' : 'none';
                    if (highlightFields) highlightFields.style.display = isHl ? '' : 'none';
                    if (compTxt) compTxt.placeholder = isArt ? str_markdown_content
                        : (isHl ? str_highlight_comment_ph : str_whats_on_your_mind);
                    if (compTxt) compTxt.rows = isArt ? 10 : 3;
                };
            });
            // Highlight: submode toggle (comment / context)
            document.querySelectorAll('.highlight-submode').forEach(function(btn) {
                btn.onclick = function() {
                    document.querySelectorAll('.highlight-submode').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    self._highlightSubmode = btn.dataset.submode;
                    if (highlightContext) highlightContext.style.display = self._highlightSubmode === 'context' ? '' : 'none';
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
                    b.title = Contacts.isFollowing(pk) ? str_unfollow : str_follow;
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
            } catch(e) { alert(t(str_invalid_key_error, e.message)); }
            };
            if (dmNsecIn) dmNsecIn.onkeydown = function(e) { if (e.key === 'Enter') btnDmNsec.onclick(); };

            // DM: back, send, new
            var dmBack = document.getElementById('dm-back');
            if (dmBack) dmBack.onclick = function() { DMs.closeThread(); };
            var btnDmSend = document.getElementById('btn-dm-send'), dmText = document.getElementById('dm-text');
            var dmSending = false;
            if (btnDmSend) btnDmSend.onclick = async function() {
                if (dmSending) return; // evita doble envio si el signer tarda (NIP-46)
                var text = dmText.value.trim(); if (!text || !DMs.currentPeer) return;
                if (DMs.monitorPubkey && DMs.currentPeer === DMs.monitorPubkey && text.toLowerCase() === 'clear') {
                    await DMs.clearMonitorMessages();
                    dmText.value = '';
                    return;
                }
                if (!Events.canSign()) { alert(str_need_nip07_or_nsec_dms); return; }
                dmSending = true;
                dmText.value = '';           // feedback inmediato: el input se vacia al pulsar enviar
                btnDmSend.disabled = true;
                try { await DMs.sendMessage(DMs.currentPeer, text); }
                catch(e) { dmText.value = text; alert(t(str_error_generic, e.message)); }
                finally { dmSending = false; btnDmSend.disabled = false; }
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
        if (!Events.canSign()) { alert(str_need_nip07_or_nsec_send); return; }
        try { await Channels.sendMessage(Channels.currentRoom, input.value.trim()); input.value = ''; } catch(e) { alert(t(str_error_generic, e.message)); }
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
        if (!Events.canSign()) { alert(str_need_nip07_or_nsec); return; }
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
            var ok = await confirm(str_delete_channel_confirm);
                if (ok) Channels.deleteChannel(Channels.currentRoom);
            };

            // Delete individual channel message (kind 5 / NIP-09)
            var channelMsgsEl = document.getElementById('channel-messages');
            if (channelMsgsEl) channelMsgsEl.addEventListener('click', async function(e) {
                var btn = e.target.closest('[data-action="del-channel-msg"]');
                if (!btn) return;
                var msgId = btn.dataset.id;
                if (!msgId) return;
        if (!await confirm(str_delete_message_confirm)) return;
                try {
                    await Events.deleteNote(msgId);
                    var msgEl = btn.closest('.dm-msg');
                    if (msgEl) msgEl.remove();
                    if (Channels.currentRoom && Channels.rooms[Channels.currentRoom]) {
                        var msgs = Channels.rooms[Channels.currentRoom].messages;
                        var idx = msgs.findIndex(function(m) { return m.id === msgId; });
                        if (idx !== -1) msgs.splice(idx, 1);
                    }
    } catch(err) { alert(t(str_error_generic, err.message)); }
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
                btnBunkerConnect.textContent = str_connecting;
                btnBunkerConnect.style.pointerEvents = 'none';
                try {
                    var name = await Bunker.accept(uri);
                    if (status) { status.textContent = str_connected_to + name; status.className = 'bunker-status'; }
                    setTimeout(function() { document.getElementById('bunker-modal').style.display = 'none'; }, 1200);
                } catch(e) {
                    if (status) { status.textContent = e.message; status.className = 'bunker-status error'; }
                } finally {
                    btnBunkerConnect.textContent = str_connect;
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

                if (typeof Html5Qrcode === 'undefined') {
                    if (scanStatus) { scanner.style.display = ''; scanStatus.textContent = str_qr_library_not_loaded; }
                    return;
                }
                scanner.style.display = '';
                if (scanStatus) scanStatus.textContent = str_point_at_qr_code;

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
                    if (scanStatus) scanStatus.textContent = str_camera_access_failed;
                });
            };

            var btnBunkerScanStop = document.getElementById('btn-bunker-scan-stop');
            if (btnBunkerScanStop) btnBunkerScanStop.onclick = _stopScanner;

            // Detener cámara al cerrar el modal
            if (bunkerModalClose) { var _origBunkerClose = bunkerModalClose.onclick; bunkerModalClose.onclick = function() { _stopScanner(); if (_origBunkerClose) _origBunkerClose(); }; }

            var btnNip46Copy = document.getElementById('btn-nip46-copy');
            if (btnNip46Copy) btnNip46Copy.onclick = function() {
                var uri = document.getElementById('nip46-uri').textContent;
                if (uri) { navigator.clipboard.writeText(uri); btnNip46Copy.textContent = str_copied + '!'; setTimeout(function() { btnNip46Copy.textContent = str_copy_uri; }, 2000); }
            };

            // Feed actions (delegation) — shared handler for feed and thread-feed
            var noteActionHandler = async function(e, notes) {
                var btn = e.target.closest('.note-action'); if (!btn) return;
                var action = btn.dataset.action;
                if (action === 'share') { var url = location.origin + '/' + _MODULE_ + '/note/' + btn.dataset.id; navigator.clipboard.writeText(url); btn.style.color = '#28a745'; createSparkles(btn); setTimeout(function() { btn.style.color = ''; }, 1500); }
               
                else if (action === 'reply') {
                    var note = notes.find(function(n) { return n.id === btn.dataset.id; });
                    if (!note) return;
                    // Articles reply inside the article view
                    if (note.kind === 30023) { Articles.openArticle(note); return; }
                    // Already in a thread: just reveal/focus the reply form
                    if (Threads.active) { Threads.showReply(); return; }
                    if (!Events.canSign()) {
                        var nsecDiv = document.getElementById('nsec-login');
                        if (nsecDiv) { nsecDiv.style.display = ''; nsecDiv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                        return;
                    }
                    // From the feed: open the note view and show the reply form
                    history.pushState({ noxtr: 'thread', noteId: note.id }, '', '/' + _MODULE_ + '/note/' + note.id);
                    Threads.open(note);
                    Threads.showReply();
                }
                
                else if (action === 'like') { self.sendReaction(btn.dataset.id, btn.dataset.pubkey);createSparkles(btn); }
                else if (action === 'repost') { self.sendRepost(btn.dataset.id, btn.dataset.pubkey, btn); }
                else if (action === 'zap') { self.startZap(btn.dataset.id, btn.dataset.pubkey); }
                else if (action === 'bookmark') { self.toggleBookmark(btn); createSparkles(btn);}
                else if (action === 'follow') { self.toggleFollow(btn);createSparkles(btn); }
                else if (action === 'delete') {
            if (await confirm(str_delete_note_confirm)) {
                        var eid = btn.dataset.id;
                        Events.deleteNote(eid).then(function() {
                            var noteEl = btn.closest('.note'); if (noteEl) noteEl.remove();
                            var idx = notes.findIndex(function(n) { return n.id === eid; });
                            if (idx !== -1) notes.splice(idx, 1);
            }).catch(function(e) { alert(t(str_error_generic, e.message)); });
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
                var htag = e.target.closest('.noxtr-hashtag');
                if (htag) { e.preventDefault(); self.showHashtagPopup(htag.textContent.replace(/^#/, '')); return; }
                // Notelink click → open thread
                var notelink = e.target.closest('.noxtr-notelink');
                if (notelink && notelink.dataset.noteid) { e.preventDefault(); Threads.openById(notelink.dataset.noteid); return; }
                var articlelink = e.target.closest('.noxtr-articlelink');
                if (articlelink && articlelink.dataset.naddr) { e.preventDefault(); Articles.openByNaddr(articlelink.dataset.naddr); return; }
                // Inline article title/summary → open article view. Explicit clickable element,
                // funciona aunque abrir-al-pulsar-cuerpo (_openOnBodyClick) este desactivado.
                var artHead = e.target.closest('.article-inline-title, .article-inline-summary');
                if (artHead) {
                    var artHeadNote = artHead.closest('.note');
                    if (artHeadNote) {
                        var artHeadEv = Feed.notes.find(function(n) { return n.id === artHeadNote.dataset.id; });
                        if (artHeadEv) Articles.openArticle(artHeadEv);
                    }
                    return;
                }
                // If clicking a link, let it go
                if (e.target.closest('a[href]') || e.target.closest('.note-media')) return;
                // If user was selecting text, don't open thread
                var sel = window.getSelection();
                if (sel && sel.toString().trim().length > 0) return;
                // Abrir hilo/articulo al hacer click en el cuerpo esta DESACTIVADO:
                // para entrar a una nota o articulo hay que pulsar el icono responder (.action-reply).
                if (!self._openOnBodyClick) return;
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
                        history.pushState({ noxtr: 'thread', noteId: note.id }, '', '/' + _MODULE_ + '/note/' + note.id);
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
                var htag = e.target.closest('.noxtr-hashtag');
                if (htag) { e.preventDefault(); self.showHashtagPopup(htag.textContent.replace(/^#/, '')); return; }
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
                } catch(err) { notify(str_translation_insert_error, 'error', 3000); }
            } else { notify(str_translation_error, 'error', 3000); }
                    })
                    .catch(function() {
                        txPopup.style.display = 'none';
                        txPopup.textContent = 'Traducir';
            notify(str_translation_error, 'error', 3000);
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
                var htag = e.target.closest('.noxtr-hashtag');
                if (htag) { e.preventDefault(); self.showHashtagPopup(htag.textContent.replace(/^#/, '')); return; }
                var notelink = e.target.closest('.noxtr-notelink');
                if (notelink && notelink.dataset.noteid) { e.preventDefault(); Threads.openById(notelink.dataset.noteid); return; }
            };

            // Thread: back button — use history.back() so popstate handles it
            var threadBack = document.getElementById('thread-back');
            if (threadBack) threadBack.onclick = function() {
                history.back();
            };
            var threadReplyBtn = document.getElementById('thread-reply-btn');
            if (threadReplyBtn) threadReplyBtn.onclick = function() { Threads.showReply(); };

            // Thread: reply
            var btnThreadReply = document.getElementById('btn-thread-reply'), threadTxt = document.getElementById('thread-compose-text');
            if (btnThreadReply) btnThreadReply.onclick = async function() {
                var text = threadTxt.value.trim(); if (!text) return;
                if (!Events.canSign()) return;
                try {
                    btnThreadReply.textContent = '...'; btnThreadReply.style.pointerEvents = 'none';
                    await Threads.reply(text);
                    threadTxt.value = '';
        } catch(e) { alert(t(str_error_generic, e.message)); }
                finally { btnThreadReply.textContent = str_reply; btnThreadReply.style.pointerEvents = ''; }
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
        if (!Events.canSign()) { alert(str_need_login_ar_profile); return; }
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
                            Feed.seen[published.id] = true;
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
            } catch(e) { alert(t(str_error_generic, e.message)); }
                finally { arPublishBtn.textContent = str_publish; arPublishBtn.style.pointerEvents = ''; }
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

        // Refleja la pestaña activa en el nav inferior, para que pulsar arriba en .noxtr-tabs
        // marque el icono de abajo. Los nombres no coinciden 1:1 (la pestaña 'topics' es el
        // botón 'home') y varias pestañas no tienen icono abajo: en ese caso no se marca
        // ninguno, en vez de dejar encendido el anterior, que mentiría sobre dónde estás.
        // 'profile' se excluye: lo gobierna el módulo login, no la pestaña actual.
        syncBottomNav: function(tab) {
            document.querySelectorAll('#noxtr-bottom-nav [data-nav]').forEach(function(item) {
                if (item.dataset.nav === 'profile') return;
                item.classList.toggle('active', item.dataset.nav === tab);
            });
        },

        switchTab: function(tab, pushHistory) {
            // 'search' no es una pestaña de este switch: su UI la monta activateSearch (panel y
            // feed de resultados propios). Se delega aquí en vez de en cada punto de entrada
            // porque son varios — el nav inferior, y la carga directa de /noxtr/search, que
            // llega por config.tabId — y cualquiera que lo ignorase dejaba la pantalla a medias:
            // cambiaba de URL y ocultaba los paneles, pero no mostraba nada de búsqueda.
            if (tab === 'search') return this.activateSearch(pushHistory);
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
            this.syncBottomNav(tab);

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
                    document.getElementById('panel-topics').style.display = ''; Topics.render();
                    Feed.clear();
                    if (Topics.showHot) { Feed.subscribeHot(); }
                    else if (Topics.showAll) { Feed.subscribeGlobal(); }
                    else {
                        var topics = Topics.active();
                        // Visitante anónimo sin selección: feed por idioma + trending en vez de inglés global.
                        if (!topics.length && !Api.userId) { topics = Topics.defaultsForAnon(); }
                        if (topics.length) { Feed.subscribeTopics(topics); }
                        else { feedEl.innerHTML = '<div class="noxtr-empty">' + str_add_topics_hint + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
                    }
                    break;
                case 'following':
                    Feed.clear();
                    if (!Api.userId && !Events.pubkey) {
                        feedEl.innerHTML = '<div class="noxtr-empty">🔒 ' + str_login_following_hint + '</div>';
                        if (loadEl) loadEl.style.display = 'none'; break;
                    }
                    document.getElementById('panel-following').style.display = '';
                    var followAddRow = document.querySelector('#panel-following .panel-add-row');
                    if (followAddRow) followAddRow.style.display = Api.userId ? '' : 'none';
                    Contacts.render();
                    var pks = Contacts.activePubkeys();
                    if (Events.pubkey && pks.indexOf(Events.pubkey) === -1) pks.push(Events.pubkey);
                    if (pks.length) { Feed.subscribeAuthors(pks); }
                    else if (Contacts.list.length) { feedEl.innerHTML = '<div class="noxtr-empty">' + str_activate_contacts_hint + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
                    else { feedEl.innerHTML = '<div class="noxtr-empty">' + str_not_following_anyone + '</div>'; if (loadEl) loadEl.style.display = 'none'; }
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
                        var opts = '<option value="">' + str_select_contact + '</option>';
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
                        feedEl.innerHTML = '<div class="noxtr-empty">🔒 ' + str_login_bookmarks_hint + '</div>';
                        if (loadEl) loadEl.style.display = 'none'; break;
                    }
                    this.loadBookmarks(); break;
                case 'followers':
                    Feed.clear();
                    if (!Events.pubkey) {
                        feedEl.innerHTML = '<div class="noxtr-empty">🔒 ' + str_enter_npub_followers_hint + '</div>';
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
                    Nip96.render();
                    Muted.render();
                    break;
            }
        },

        loadBookmarks: async function() {
            Feed.clear(); await Bookmarks.load();
            if (!Bookmarks.list.length) {
                Feed.container.innerHTML = '<div class="noxtr-empty">' + str_no_bookmarks_yet + '</div>';
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
            this.syncBottomNav('search');
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
            feedEl.innerHTML = '<div class="noxtr-empty">' + str_search_term_hint + '</div>';
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
                '<a class="mute-menu-item mute-menu-mute">' + str_mute_user + '</a>' +
                '<a class="mute-menu-item mute-menu-report">' + str_report_spam + '</a>' +
                '<a class="mute-menu-item mute-menu-cancel">' + str_cancel + '</a>';
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
                btn.title = str_muted;
            };
            // Report spam (NIP-56 kind 1984)
            menu.querySelector('.mute-menu-report').onclick = async function(e) {
                e.stopPropagation(); menu.remove();
                document.removeEventListener('click', closeMenu, true);
        if (!Events.canSign()) { alert(str_login_to_report); return; }
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
            } catch(err) { alert(t(str_error_generic, err.message)); }
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
        if (!await confirm(str_repost_confirm)) return;
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
                // NIP-47: pay directly via wallet if configured and LN address available
                var nip47 = window._Nip47;
                if (nip47 && nip47.isConfigured() && lnAddr && lnAddr.indexOf('@') !== -1) {
                    if (status) status.textContent = 'Preparando zap…';
                    var zapEventJson = '';
                    if (Events.canSign()) {
                        try {
                            var relayTags = Relays && Relays.activeUrls ? Relays.activeUrls().slice(0, 3).map(function(u) { return ['relays', u]; }) : [];
                            var zapEv = await Events.create(9734, '', [['p', pk], ['e', noteId], ['amount', String(amount * 1000)]].concat(relayTags));
                            var signedZap = await Events.sign(zapEv);
                            zapEventJson = JSON.stringify(signedZap);
                        } catch(e) {}
                    }
                    var ri = await Api.call('get_ln_invoice', { ln_address: lnAddr, amount_msats: amount * 1000, zap_event: zapEventJson });
                    if (!ri.error && ri.data && ri.data.pr) {
                        if (status) status.textContent = 'Pagando con wallet…';
                        await nip47.payInvoice(ri.data.pr);
                        var dialog = overlay.querySelector('.noxtr-zap-dialog');
                        dialog.innerHTML =
                            '<div class="noxtr-zap-dialog-header">⚡ Zap enviado!</div>' +
                            '<p class="noxtr-zap-success">' + amount + ' sats</p>' +
                            '<div class="noxtr-zap-actions"><a class="btn btn-sm btn-primary noxtr-zap-close">OK</a></div>';
                        dialog.querySelector('.noxtr-zap-close').onclick = function() { overlay.remove(); };
                        var noteEl = document.querySelector('.note[data-id="' + noteId + '"]');
                        if (noteEl) { var zb = noteEl.querySelector('[data-action="zap"]'); if (zb) zb.classList.add('zapped'); }
                        return;
                    }
                    // fallback to BTCPay if LNURL failed
                    if (status) status.textContent = 'Processing...';
                }

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
                    '<p class="noxtr-zap-pending-note">Te avisamos cuando se confirme el pago.</p>' +
                    '<div class="noxtr-zap-actions"><a class="btn btn-sm noxtr-zap-close">Close</a></div>';

                var zapNoteEl = document.querySelector('.note[data-id="' + noteId + '"]');

                var btcpayListener = function(e) {
                    try {
                        var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                        var st = (d && d.invoice && d.invoice.status) ? d.invoice.status.toLowerCase() : '';
                        if (st === 'complete' || st === 'paid' || st === 'confirmed') {
                            window.removeEventListener('message', btcpayListener);
                            if (zapNoteEl) { var zb = zapNoteEl.querySelector('[data-action="zap"]'); if (zb) zb.classList.add('zapped'); }
            notify('⚡ ' + t(str_zap_sent, amount), 'success', 5000);
                        }
                    } catch(ex) {}
                };
                window.addEventListener('message', btcpayListener);

                var closeZapDialog = function() {
                    overlay.remove();
                };
                dialog.querySelector('.noxtr-zap-close').onclick = closeZapDialog;
                overlay.onclick = function(e) { if (e.target === overlay) closeZapDialog(); };
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

        showHashtagPopup: function(tag) {
            var self = this;
            tag = String(tag || '').replace(/^#+/, '').trim();
            if (!tag) return;
            var inTopics = Topics.list.some(function(t) { return t.topic.toLowerCase() === tag.toLowerCase(); });

            var content = '<div class="profile-popup">' +
                '<div class="profile-popup-header" style="align-items:center;">' +
                '<div class="profile-popup-meta"><div class="profile-popup-name">#'+escapeHtml(tag)+'</div></div></div>' +
                '<div class="profile-popup-actions">' +
                '<a class="btn btn-sm btn-primary profile-popup-btn" id="hp-topic">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg>' +
                    (inTopics ? str_remove_from_topics : str_add_to_topics) + '</a>' +
                '<a class="btn btn-sm profile-popup-btn" id="hp-copy">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                    str_copy + '</a>' +
                '</div></div>';

            $("body").dialog({
                title: '#'+tag,
                type: 'html',
                width: '300px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [{ text: str_close, class: 'btn btn-cancel', action: function(event, overlay) { document.body.removeChild(overlay); } }]
            });

            setTimeout(function() {
                var btnTopic = document.getElementById('hp-topic');
                var btnCopy = document.getElementById('hp-copy');

                if (btnTopic) btnTopic.onclick = async function() {
                    var ov = btnTopic.closest('.wq-dialog-overlay');
                    if (inTopics) {
                        var entry = Topics.list.filter(function(t) { return t.topic.toLowerCase() === tag.toLowerCase(); })[0];
                        if (entry) await Topics.remove(entry.id);
                        Topics.render();
                        if (ov) document.body.removeChild(ov);
                    } else {
                        await Topics.add(tag);
                        Topics.render();
                        if (ov) document.body.removeChild(ov);
                        self.switchTab('topics');
                    }
                };

                if (btnCopy) btnCopy.onclick = function() {
                    try { navigator.clipboard.writeText('#'+tag); } catch(e) {}
                    btnCopy.textContent = str_copied + '!';
                };
            }, 50);
        },

        showProfilePopup: function(pubkey) {
            var self = this;
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
                    str_view_notes + '</a>' +
                (!isOwn && canAct ? '<a class="btn btn-sm profile-popup-btn' + (isFollowed ? ' btn-danger' : '') + '" id="pp-follow">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/>' + (isFollowed ? '' : '<line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>') + '</svg>' +
                    (isFollowed ? str_unfollow : str_follow) + '</a>' : '') +
                '<a class="btn btn-sm profile-popup-btn" id="pp-copy">' +
                    '<svg class="profile-popup-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                    str_copy_npub + '</a>' +
                '</div></div>';

            $("body").dialog({
                title: str_profile,
                type: 'html',
                width: '320px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: content,
                buttons: [{
                    text: str_close,
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
                        b.title = nowFollowed ? str_unfollow : str_follow;
                    });
                };

                if (btnCopy) btnCopy.onclick = function() {
                    navigator.clipboard.writeText(npub);
                    btnCopy.textContent = str_copied + '!';
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
                btn.title = str_follow;
            } else {
                var name = Profiles.displayName(pk);
                await Contacts.add(pk, name);
                btn.classList.add('followed');
                btn.title = str_unfollow;
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
                var displayName = Profiles.displayName(Events.pubkey);
                var showName = displayName !== shortKey(npub);
                var logoutBtn = '<a class="btn btn-sm btn-danger identity-logout" title="'+str_logout_nostr+'">X</a>';
                el.innerHTML = '<span class="identity-dot '+(cs ? 'identity-active' : 'identity-readonly')+'"> </span>'+(showName ? '<strong class="btn btn-sm btn-info identity-name">'+escapeHtml(displayName)+'</strong>' : '')+'<span class="btn btn-sm btn-dark identity-npub" title="'+str_copy_npub+'">'+shortKey(npub)+'</span><span class="btn btn-sm btn-gray identity-method">'+method+'</span>'+logoutBtn;
                var npubEl = el.querySelector('.identity-npub');
                if (npubEl) npubEl.onclick = function() {
                    var original = shortKey(npub);
                    copyText(npub).then(function() {
                        npubEl.textContent = str_copied;
                        npubEl.classList.add('identity-npub-copied');
                        npubEl.title = npub;
                        setTimeout(function() {
                            if (!npubEl.parentNode) return;
                            npubEl.textContent = original;
                            npubEl.classList.remove('identity-npub-copied');
                            npubEl.title = str_copy_npub;
                        }, 1400);
                    }).catch(function() {
                        npubEl.title = npub;
                    });
                };
                // Solo lectura con identidad (p.ej. la sesión NIP-46 se perdió tras un reposo del
                // equipo): notify anclado sobre .noxtr-identity con enlace de reconexión, en vez
                // de dejar que el usuario deduzca qué significa "read-only". Una sola vez por
                // episodio (updateIdentity se llama muchas veces).
                if (!cs) {
                    if (!UI._roNotified) {
                        UI._roNotified = true;
                        if (!UI._reconnDelegated) {
                            UI._reconnDelegated = true;
                            document.addEventListener('click', function(ce) {
                                if (!ce.target || !ce.target.classList || !ce.target.classList.contains('identity-reconnect-link')) return;
                                var ov = ce.target.closest('.wq-dialog-overlay');
                                if (ov) ov.remove();
                                Nip46.connect();
                            });
                        }
                        notify(escapeHtml(str_readonly_reconnect_notice) +
                            ' <a class="identity-reconnect-link">Nostr Connect</a>',
                            'warning', null, '.noxtr-identity');
                    }
                } else {
                    UI._roNotified = false;
                }
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
                // Con identidad presente el bloque de login nsec se oculta siempre (menos ruido):
                // en solo-lectura el aviso de arriba ya ofrece reconectar via NIP-46, y para entrar
                // con nsec basta cerrar la sesión Nostr con la X.
                if (nsecDiv) nsecDiv.style.display = 'none';
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
                UI._roNotified = false;
                el.innerHTML = '<span class="identity-anon">' + str_anonymous_readonly + '</span>';
                if (comp) comp.style.display = 'none';
                if (compToggle) { compToggle.style.display = 'none'; compToggle.classList.remove('active'); }
                if (nsecDiv) {
                    nsecDiv.style.display = '';
                    var nsecInput = document.getElementById('nsec-input');
                    var btnNsec = document.getElementById('btn-nsec-login');
                    if (nsecInput) nsecInput.style.display = '';
                    if (btnNsec) { btnNsec.textContent = str_login; btnNsec.dataset.mode = 'login'; }
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

    // JuxNostrKeys es compartida con _modules_/login/footer.php (NOSTR_DB_VERSION).
    // v2 (antes v1): loadStoredKeys() abortaba la transacción de upgrade en vez de crear el
    // object store 'keys' si esta función era la primera en abrir la BD en un navegador —
    // la dejaba creada sin el store, inservible para siempre (onupgradeneeded solo se
    // dispara una vez por versión). Subir a v2 aquí y en login/footer.php fuerza que se
    // dispare de nuevo para todos, incluidos los navegadores ya afectados (autoreparación).
    function _openNostrKeysDb() {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open('JuxNostrKeys', 2);
                req.onerror = function() { reject(req.error); };
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
                };
            } catch(e) { reject(e); }
        });
    }

    function loadStoredKeys(userId) {
        return new Promise(function(resolve) {
            _openNostrKeysDb().then(function(db) {
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
            }).catch(function() { resolve(null); });
        });
    }

    function saveKeysToIndexedDB(userId, npub, nsec, pubkeyHex, privkeyHex) {
        _openNostrKeysDb().then(function(db) {
            if (!db.objectStoreNames.contains('keys')) { db.close(); return; }
            var tx = db.transaction('keys', 'readwrite');
            var store = tx.objectStore('keys');
            store.put({ id: 'user_' + userId, userId: userId, npub: npub, nsec: nsec, pubkeyHex: pubkeyHex, privkeyHex: privkeyHex, createdAt: new Date().toISOString(), createdOn: window.location.hostname });
            tx.oncomplete = function() { db.close(); };
            tx.onerror = function() { db.close(); };
        }).catch(function(e) { console.warn('IndexedDB save failed:', e); });
    }

    // ==================== AUTO-LOGIN VIA NOSTR ====================

    async function autoLoginNostr(backupUsername) {
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

            // Step 3: Verify on server (creates/logs in user, sets PHP session).
            // backupUsername (data.username del backup) evita que el servidor cree un usuario
            // nuevo si esa cuenta ya existe: si la identidad firmada no coincide con la
            // vinculada, responde account_not_linked con un aviso (usar otro método de login).
            var vBody = 'event=' + encodeURIComponent(JSON.stringify(signedEvent));
            if (backupUsername) vBody += '&username=' + encodeURIComponent(backupUsername);
            var vResp = await fetch(Api.loginAjaxUrl + '/op=nostr_verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: vBody
            });
            var vData = await vResp.json();
            if (!vData.success) {
                if (backupUsername && vData.msg) alert(vData.msg);
                return false;
            }

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
            var msg, btn;

            if (native) {
                msg = str_a2hs_native_msg;
                btn = '<button id="noxtr-a2hs-btn">' + str_install + '</button>';
            } else {
                msg = str_a2hs_ios_msg;
                btn = '';
            }

            var el = document.createElement('div');
            el.id = 'noxtr-a2hs';
            el.innerHTML = '<span class="noxtr-a2hs-msg">' + msg + '</span>'
                + '<div class="noxtr-a2hs-actions">' + btn + '</div>'
                + '<button id="noxtr-a2hs-close" title="' + str_dismiss + '">&#10005;</button>';
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

    // ==================== WATCHDOG DE SOCKETS TRAS REPOSO ====================
    // Tras dormir el equipo, los WS quedan zombis ('connected' sin tráfico ni onclose):
    // no llegan 38385/38383/DMs y la UI muestra estado rancio (p.ej. instancia como v1,
    // órdenes ausentes) hasta recargar. Al volver de un ocultamiento largo de la pestaña
    // se fuerza la reconexión completa; las suscripciones se re-envían solas en onopen.
    var _noxtrHiddenAt = 0;
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) { _noxtrHiddenAt = Date.now(); return; }
        if (_noxtrHiddenAt && Date.now() - _noxtrHiddenAt > 120000) {
            try { console.warn('[Pool] reconexión tras ' + Math.round((Date.now() - _noxtrHiddenAt) / 60000) + ' min oculto'); } catch(e) {}
            Pool.reconnectAll();
        }
        // Re-suscripción a los canales de Mostro en CADA vuelta a primer plano, no solo tras un rato
        // oculto. Mostro Mobile hace exactamente eso (lib/.../lifecycle_manager.dart, commit 66b578):
        //   ref.invalidate(disputeChatNotifierProvider);
        // con el comentario "an already-initialized notifier never re-reads storage nor re-opens its
        // relay subscription on its own". subscribeMyTrades() reabre los REQ con el `since`
        // persistido, que es la mitad de "resubscribe with the saved cursor" que hacen ellos.
        // El umbral de 2 min que había aquí antes era arbitrario: no está ni en el protocolo ni en
        // su implementación.
        try {
            if (window.MostroTrader && MostroTrader.subscribeMyTrades) MostroTrader.subscribeMyTrades();
        } catch(e) { console.error('[Mostro] resuscripción tras volver al primer plano falló', e); }
        _noxtrHiddenAt = 0;
    });
    // Cambio de red (wifi→cable, VPN, etc.): mismo tratamiento
    window.addEventListener('online', function() { Pool.reconnectAll(); });

    // ==================== DESKTOP NOTIFICATIONS (Notification API) ====================
    // Notificaciones a nivel de SO, independientes del toast in-page notify(). Solo se disparan
    // cuando la pestaña está oculta (segundo plano/minimizada), para no duplicar el toast cuando
    // el usuario está mirando. Se expone en window.NoxtrNotify para script.mostro.js / script.onchain.js.
    var Notify = {
        supported: (typeof window !== 'undefined' && 'Notification' in window),
        state: function() { return this.supported ? Notification.permission : 'unsupported'; },
        request: function() {
            if (!this.supported) return Promise.resolve('unsupported');
            var done = function(p) { try { Notify.renderBanner(); } catch(e){} return p; };
            try {
                var r = Notification.requestPermission();
                if (r && typeof r.then === 'function') return r.then(done);
                return new Promise(function(res){ Notification.requestPermission(function(p){ res(done(p)); }); });
            } catch(e) { return Promise.resolve(this.state()); }
        },
        // push(title, body, opts{ tag, onclick, force })
        push: function(title, body, opts) {
            opts = opts || {};
            if (!this.supported || Notification.permission !== 'granted') return null;
            // Se notifica SIEMPRE, tambien con la pestana en primer plano (peticion del usuario).
            try {
                var n = new Notification(title, {
                    body: body || '',
                    icon: '/media/images/logo.png',
                    tag: opts.tag || undefined,
                    renotify: opts.tag ? true : false
                });
                n.onclick = function() {
                    try { window.focus(); } catch(e){}
                    if (typeof opts.onclick === 'function') { try { opts.onclick(); } catch(e){} }
                    try { n.close(); } catch(e){}
                };
                return n;
            } catch(e) { return null; } // p.ej. Chrome Android lanza "Illegal constructor" (exige Service Worker)
        },
        renderBanner: function() {
            var el = document.getElementById('noxtr-notif-banner');
            if (!el) return;
            if (!this.supported) { el.style.display = 'none'; return; }
            var perm = Notification.permission;
            if (perm === 'granted') { el.style.display = 'none'; return; }
            if (perm === 'denied') {
                if (localStorage.getItem('noxtr_notif_blocked_dismissed') === '1') { el.style.display = 'none'; return; }
                el.className = 'noxtr-notif-banner blocked';
                el.innerHTML = '<span class="noxtr-notif-msg">🔕 ' + escapeHtml(str_notif_blocked) + '</span>' +
                    '<button type="button" class="btn btn-sm" id="noxtr-notif-blocked-ok">' + escapeHtml(str_notif_blocked_dismiss) + '</button>';
                el.style.display = 'flex';
                var ok = document.getElementById('noxtr-notif-blocked-ok');
                if (ok) ok.onclick = function() { try { localStorage.setItem('noxtr_notif_blocked_dismissed','1'); } catch(e){} el.style.display = 'none'; };
                return;
            }
            // default (aún no decidido)
            if (localStorage.getItem('noxtr_notif_prompt_dismissed') === '1') { el.style.display = 'none'; return; }
            el.className = 'noxtr-notif-banner';
            el.innerHTML = '<span class="noxtr-notif-msg">🔔 ' + escapeHtml(str_notif_enable_prompt) + '</span>' +
                '<button type="button" class="btn btn-sm btn-primary" id="noxtr-notif-enable">' + escapeHtml(str_notif_enable_btn) + '</button>' +
                '<button type="button" class="btn btn-sm" id="noxtr-notif-later">' + escapeHtml(str_notif_later) + '</button>';
            el.style.display = 'flex';
            var en = document.getElementById('noxtr-notif-enable');
            if (en) en.onclick = function() { Notify.request(); };
            var later = document.getElementById('noxtr-notif-later');
            if (later) later.onclick = function() { try { localStorage.setItem('noxtr_notif_prompt_dismissed','1'); } catch(e){} el.style.display = 'none'; };
        },
        init: function() {
            if (!this.supported) return;
            // Pide permiso automaticamente si aun no se ha decidido, para no depender de que el
            // usuario pulse el banner. Si ya esta 'granted'/'denied' no hace nada.
            try { if (Notification.permission === 'default') this.request(); } catch(e){}
            try { this.renderBanner(); } catch(e){}
        }
    };
    window.NoxtrNotify = Notify;

    // ==================== PROFILE NUDGE (banner "completa tu perfil") ====================
    // Invita a personalizar el username autogenerado ('n_' + 8 hex de sha256(pubkey), ver
    // NostrAuth::createOrUpdateUser en _classes_/nostrauth.class.php) y a activar avisos (email
    // o Telegram, ver módulo telegram). Se descarta por usuario en localStorage, mismo patrón
    // que el banner de notificaciones de escritorio de arriba.
    var ProfileNudge = {
        isAutoUsername: function(u) { return /^n_[0-9a-f]{6,}$/i.test(u || ''); },
        render: function() {
            var el = document.getElementById('noxtr-profile-nudge-banner');
            if (!el) return;
            if (!Api.userId || !this.isAutoUsername(Api.username)) { el.style.display = 'none'; return; }
            var dismissKey = 'noxtr_profile_nudge_dismissed_u' + Api.userId;
            if (localStorage.getItem(dismissKey) === '1') { el.style.display = 'none'; return; }
            el.innerHTML = '<span class="noxtr-notif-msg">👋 ' + escapeHtml(t(str_profile_nudge_msg, Api.username)) + '</span>' +
                '<button type="button" class="btn btn-sm btn-primary" id="noxtr-profile-nudge-edit">' + escapeHtml(str_profile_nudge_edit_btn) + '</button>' +
                (Api.telegramLinked ? '' : '<a href="/telegram" class="btn btn-sm" id="noxtr-profile-nudge-telegram">' + escapeHtml(str_profile_nudge_telegram_btn) + '</a>') +
                '<button type="button" class="btn btn-sm" id="noxtr-profile-nudge-dismiss">' + escapeHtml(str_profile_nudge_dismiss) + '</button>';
            el.style.display = 'flex';
            var editBtn = document.getElementById('noxtr-profile-nudge-edit');
            if (editBtn) editBtn.onclick = function() { var b = document.getElementById('btn-edit-profile'); if (b) b.click(); };
            var dismissBtn = document.getElementById('noxtr-profile-nudge-dismiss');
            if (dismissBtn) dismissBtn.onclick = function() { try { localStorage.setItem(dismissKey, '1'); } catch(e){} el.style.display = 'none'; };
        }
    };
    window.NoxtrProfileNudge = ProfileNudge;

    // ==================== PUBLIC API ====================

    window.Noxtr = {
        Pool: Pool, Profiles: Profiles, Events: Events, Feed: Feed, UI: UI, Threads: Threads, Articles: Articles,
        Contacts: Contacts, Topics: Topics, Bookmarks: Bookmarks, Followers: Followers, Muted: Muted, DMs: DMs, Nip44: Nip44, Nip46: Nip46, Bunker: Bunker, Search: Search, ProfileView: ProfileView, Api: Api,
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
                localStorage.removeItem('noxtr_dm_plain'); // cache de DMs descifrados (privacidad)
            } catch(e) {}
            DMs._plainCache = null;

            // Mark session as logged out so init() doesn't restore stale identity
            try {
                sessionStorage.setItem('noxtr_logged_out', '1');
                sessionStorage.removeItem('noxtr_autologin_tried');
            } catch(e) {}

            // Note: IndexedDB keys (JuxNostrKeys) are preserved — they are keyed
            // by userId and will be used for "Login with Nostr" on the web login page.
        },

        init: async function(config) {
            config = config || {};
            Api.url = config.ajaxUrl || '';
            Api.csrfToken = config.csrfToken || '';
            Api.userId = config.userId || 0;
            Api.username = config.username || '';
            Api.telegramLinked = !!config.telegramLinked;
            Api.lang = config.lang || 'en';
            Api.loginAjaxUrl = config.loginAjaxUrl || '';

            // Relays del canal NIP-46 configurables (CFG modules.noxtr.nip46_relays). Si se configuran,
            // sustituyen a los hardcoded por defecto. Deben aceptar kind 24133 (peticiones al firmador).
            if (Array.isArray(config.nip46Relays) && config.nip46Relays.length) {
                NIP46_RELAYS = config.nip46Relays
                    .map(function(u) { return String(u).trim().replace(/\/+$/, ''); })
                    .filter(function(u) { return /^wss?:\/\//i.test(u); });
            }

            // Detect web user switch: if a different user is now logged in, clear stale identity.
            // Excepcion: '0' -> N (un anonimo que inicia sesion, p.ej. el auto-login por NIP-46)
            // NO es un cambio entre dos usuarios: promueve la MISMA identidad Nostr de la sesion
            // anonima a la logueada. Borrar aqui tumbaria el firmador recien conectado.
            var _prevSessionUid = sessionStorage.getItem('noxtr_session_uid');
            if (_prevSessionUid !== null && _prevSessionUid !== '0' && _prevSessionUid !== String(Api.userId)) {
                try { localStorage.removeItem('noxtr_npub'); localStorage.removeItem('noxtr_nip46'); } catch(e) {}
                sessionStorage.removeItem('noxtr_logged_out');
            }
            sessionStorage.setItem('noxtr_session_uid', String(Api.userId));

            Feed.init(document.getElementById('feed'), document.getElementById('feed-loading'));
            UI.init();
            Noxtr.initCollapsibles();
            A2HS.init();
            try { if (window.NoxtrNotify) window.NoxtrNotify.init(); } catch(e) {}
            try { ProfileNudge.render(); } catch(e) {}

            // Visor de eventos en tiempo real: recuerda el estado que dejo el usuario
            // (click en #noxtr-version o Noxtr.Pool.toggleMetrics()). Oculto por defecto.
            try { if (localStorage.getItem('noxtr_metrics') === '1') Pool.toggleMetrics(); } catch(e) {}

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

            // Sin firmador tras agotar nsec y NIP-46: puede ser una extension que aun no se ha
            // inyectado (ver Events.watchLateExtension). No bloquea el arranque; si aparece, se
            // refresca la identidad y la UI deja de decir que no hay firmador.
            if (!Events.canSign() && !sessionStorage.getItem('noxtr_logged_out')) {
                Events.watchLateExtension(5000, function() {
                    try { UI.updateIdentity(); } catch(e) {}
                });
            }

            // Auto-login web si hay firmador Nostr conectado (nip46/nsec) pero no hay
            // sesion web. Sin sesion, Api.userId=0 y no se carga nada de BD (following,
            // etc.). Reutiliza el login Nostr del modulo login (challenge -> firmar ->
            // verify). existing_only=1: solo inicia sesion si la pubkey ya tiene cuenta,
            // no crea usuarios en silencio. El firmador NIP-46 pedira activar el signer.
            if (!Api.userId && Events.canSign() && Events.pubkey && Api.loginAjaxUrl
                    && !sessionStorage.getItem('noxtr_autologin_tried')) {
                try {
                    var chResp = await fetch(Api.loginAjaxUrl + '/op=nostr_challenge', { method: 'POST' });
                    var chData = await chResp.json();
                    if (chData && chData.challenge) {
                        var authEv = await Events.create(27235, '', [
                            ['challenge', chData.challenge],
                            ['domain', location.host]
                        ]);
                        var signedAuth = await Events.sign(authEv);
                        var vResp = await fetch(Api.loginAjaxUrl + '/op=nostr_verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ event: JSON.stringify(signedAuth), existing_only: '1' })
                        });
                        var vData = await vResp.json();
                        if (vData && vData.success) {
                            sessionStorage.setItem('noxtr_autologin_tried', '1');
                            location.reload();
                            return;
                        }
                        // Sin cuenta vinculada: no re-preguntar al firmador en cada carga.
                        if (vData && vData.error === 'no_account') {
                            sessionStorage.setItem('noxtr_autologin_tried', '1');
                        }
                    }
                } catch(e) {
                    if (window.NOXTR_DEBUG === true || localStorage.getItem('noxtr_debug') === '1') console.warn('[Noxtr] auto-login failed:', e);
                }
            }

            UI.updateIdentity();

            // Load DB data if logged in
            if (Api.userId) {
                await Contacts.load();
                await Topics.load();
                await Topics.migrateLocalToDb();
                await Bookmarks.load();
                await Muted.load();
                await Relays.load();
                await Nip96.load();
            } else {
                // Visitante anónimo: topics desde localStorage + hashtags de moda.
                await Topics.load();
                await Topics.loadTrending();
            }

            // Si no hay topics activos: el logueado sin topics cae a "Hot"; el visitante
            // anónimo cae a sus defaults por idioma + trending (ver switchTab). Solo forzamos
            // "Hot" cuando no hay defaults disponibles. "All" trae demasiado ruido (json,
            // kinds raros) para alguien sin filtro propio.
            if (!Topics.active().length && (Api.userId || !Topics.defaultsForAnon().length)) { Topics.showHot = true; }

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
                var noxtrApp = document.getElementById('noxtr');
                if (noxtrApp) noxtrApp.classList.add('profile-permalink');
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
