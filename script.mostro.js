// Mostro P2P — extensión de Noxtr. NO modificar script.js.

(function () {

    // ==================== BECH32 / HEX (local, no depende del IIFE de script.js) ====================

    var _BC = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    function _bpolymod(v) {
        var G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], c = 1;
        for (var i = 0; i < v.length; i++) {
            var t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ v[i];
            for (var j = 0; j < 5; j++) if ((t >> j) & 1) c ^= G[j];
        } return c;
    }
    function _bhrp(h) {
        var r = []; for (var i = 0; i < h.length; i++) r.push(h.charCodeAt(i) >> 5);
        r.push(0); for (var i = 0; i < h.length; i++) r.push(h.charCodeAt(i) & 31); return r;
    }
    function _bech32Encode(hrp, data) {
        var v = _bhrp(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
        var p = _bpolymod(v) ^ 1, cs = [];
        for (var i = 0; i < 6; i++) cs.push((p >> (5 * (5 - i))) & 31);
        var all = data.concat(cs), r = hrp + '1';
        for (var i = 0; i < all.length; i++) r += _BC[all[i]]; return r;
    }
    function _convertBits(data, from, to, pad) {
        var a = 0, b = 0, r = [], m = (1 << to) - 1;
        for (var i = 0; i < data.length; i++) { a = (a << from) | data[i]; b += from; while (b >= to) { b -= to; r.push((a >> b) & m); } }
        if (pad && b > 0) r.push((a << (to - b)) & m); return r;
    }
    function _hexToBytes(hex) {
        var arr = new Uint8Array(hex.length / 2);
        for (var i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return arr;
    }
    function _bytesToHex(bytes) {
        return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    function _nsecEncode(hexPrivkey) {
        return _bech32Encode('nsec', _convertBits(Array.from(_hexToBytes(hexPrivkey)), 8, 5, true));
    }

    // Exponer globalmente: script.js usa nsecEncode() en btn-show-nsec
    window.nsecEncode = _nsecEncode;

    // ==================== BIP39 / BIP32 ====================

    // BIP39: mnemónico → seed de 64 bytes (PBKDF2-SHA512, 2048 iteraciones)
    async function _bip39Seed(mnemonic) {
        var enc = new TextEncoder();
        var key = await crypto.subtle.importKey('raw', enc.encode(mnemonic.normalize('NFKD')), 'PBKDF2', false, ['deriveBits']);
        var bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode('mnemonic'), iterations: 2048, hash: 'SHA-512' },
            key, 512
        );
        return new Uint8Array(bits);
    }

    // HMAC-SHA512
    async function _hmacSha512(keyBytes, dataBytes) {
        var k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', k, dataBytes));
    }

    var _N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

    // BIP32: derivar hijo a partir de privkey (hex), chainCode (Uint8Array) e índice
    async function _deriveChild(parentPrivHex, parentChain, index) {
        var parentPriv = _hexToBytes(parentPrivHex);
        var isHardened = index >= 0x80000000;
        var idxBuf = new Uint8Array(4);
        new DataView(idxBuf.buffer).setUint32(0, index >>> 0, false);
        var data = new Uint8Array(37);
        if (isHardened) {
            data[0] = 0x00;
            data.set(parentPriv, 1);
            data.set(idxBuf, 33);
        } else {
            var pub = nobleSecp256k1.getPublicKey(parentPrivHex, true);
            data.set(typeof pub === 'string' ? _hexToBytes(pub) : pub, 0);
            data.set(idxBuf, 33);
        }
        var IL_IR = await _hmacSha512(parentChain, data);
        var childBig = (BigInt('0x' + _bytesToHex(IL_IR.slice(0, 32))) + BigInt('0x' + parentPrivHex)) % _N;
        return { privkey: childBig.toString(16).padStart(64, '0'), chainCode: IL_IR.slice(32) };
    }

    // Derivar usando ruta, p.ej. "m/44'/1237'/38383'/0/0"
    async function _bip32DerivePath(seedBytes, path) {
        var IL_IR = await _hmacSha512(new TextEncoder().encode('Bitcoin seed'), seedBytes);
        var cur = { privkey: _bytesToHex(IL_IR.slice(0, 32)), chainCode: IL_IR.slice(32) };
        for (var seg of path.replace('m/', '').split('/')) {
            var hardened = seg.endsWith("'");
            cur = await _deriveChild(cur.privkey, cur.chainCode, parseInt(seg) + (hardened ? 0x80000000 : 0));
        }
        return cur.privkey;
    }

    // ==================== IMPORTAR IDENTIDAD MOSTRO MOBILE ====================

    async function _importMostroMobileIdentity() {
        var words = await prompt('Introduce las 12 palabras de Mostro Mobile (separadas por espacios):');
        if (words === null) return;
        words = words.trim().toLowerCase();
        var parts = words.split(/\s+/);
        if (parts.length !== 12) {
            alert('Se necesitan exactamente 12 palabras. Se han introducido ' + parts.length + '.');
            return;
        }
        try {
            var seed = await _bip39Seed(parts.join(' '));
            var privHex = await _bip32DerivePath(seed, "m/44'/1237'/38383'/0/0");
            var nsec = _nsecEncode(privHex);
            var nsecInput = document.getElementById('nsec-input');
            var btnNsec = document.getElementById('btn-nsec-login');
            if (!nsecInput || !btnNsec) { alert('Error: no se encontró el formulario de login.'); return; }
            nsecInput.value = nsec;
            btnNsec.click();
        } catch (e) {
            alert('Error al derivar la clave: ' + e.message);
        }
    }

    function _escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function _mostroDebugEnabled() {
        try {
            if (window.NOXTR_DEBUG === true) return true;
            return localStorage.getItem('noxtr_debug') === '1';
        } catch(e) {
            return false;
        }
    }

    function _mostroDebug() {
        if (!_mostroDebugEnabled()) return;
        console.log.apply(console, arguments);
    }

    function _mostroDebugWarn() {
        if (!_mostroDebugEnabled()) return;
        console.warn.apply(console, arguments);
    }

    function _mostroTradeSnapshot(trade) {
        if (!trade) return null;
        return {
            order_id: trade.order_id || null,
            internal_status: trade.internal_status || null,
            status: trade.status || null,
            trade_action: trade.trade_action || null,
            trade_role: trade.trade_role || null,
            trade_kind: trade.trade_kind || null,
            is_seller: parseInt(trade.is_seller, 10) || 0,
            trade_index: parseInt(trade.trade_index, 10) || 0,
            fiat_amount: trade.fiat_amount || null,
            fiat_code: trade.fiat_code || null,
            sat_amount: trade.sat_amount || null,
            payment_method: trade.payment_method || null,
            robot_pubkey: trade.robot_pubkey ? trade.robot_pubkey.slice(0, 12) + '...' : null,
            peer_pubkey: trade.peer_pubkey ? trade.peer_pubkey.slice(0, 12) + '...' : null,
            trade_key_pub: trade.trade_key_pub ? trade.trade_key_pub.slice(0, 12) + '...' : null,
            pending_next_trade: trade._pendingNextTrade ? {
                pub: trade._pendingNextTrade.pub ? trade._pendingNextTrade.pub.slice(0, 12) + '...' : null,
                index: trade._pendingNextTrade.index || null,
                tempId: trade._pendingNextTrade.tempId || null
            } : null,
            range_order: !!trade._rangeOrder,
            range_min: trade._rangeMin != null ? trade._rangeMin : null,
            range_max: trade._rangeMax != null ? trade._rangeMax : null,
            selected_fiat: trade._selectedFiatAmount != null ? trade._selectedFiatAmount : null,
            release_in_flight: !!trade._releaseInFlight,
            updated_at: trade.updated_at || null
        };
    }

    // ==================== NIP-59 GIFT WRAP HELPERS ====================

    async function _sha256hex(str) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return _bytesToHex(new Uint8Array(buf));
    }

    function _getPubkeyHex(privkeyHex) {
        var pk = nobleSecp256k1.getPublicKey(privkeyHex, true);
        return (typeof pk === 'string' ? pk : _bytesToHex(pk)).slice(2);
    }

    function _generateKeypair() {
        var privBytes = crypto.getRandomValues(new Uint8Array(32));
        var privHex = _bytesToHex(privBytes);
        return { priv: privHex, pub: _getPubkeyHex(privHex) };
    }

    async function _signEventWith(ev, privkeyHex) {
        ev.id = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
        var sig = await nobleSecp256k1.schnorr.sign(ev.id, privkeyHex);
        ev.sig = typeof sig === 'string' ? sig : _bytesToHex(sig);
        return ev;
    }

    // NIP-59 / Mostro: build gift wrap targeting recipientPubkeyHex
    // - rumorContent: JSON string (the array [msgObj, tradeSig])
    // - tradePrivkeyHex: private key for this trade (rumor pubkey = trade key)
    // - Seal is signed by identity key (Events.privkey) — links reputation to user
    async function _giftWrap(rumorContent, recipientPubkeyHex, tradePrivkeyHex) {
        var tradePub = _getPubkeyHex(tradePrivkeyHex);
        var randomNow = function() { return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 7200); };

        // 1. Rumor — kind 1, pubkey = trade key, signed with trade key
        var rumor = { kind: 1, pubkey: tradePub, content: rumorContent,
            tags: [['p', recipientPubkeyHex]], created_at: Math.floor(Date.now() / 1000) };
        rumor.id = await _sha256hex(JSON.stringify([0, rumor.pubkey, rumor.created_at, rumor.kind, rumor.tags, rumor.content]));
        rumor = await _signEventWith(rumor, tradePrivkeyHex);

        // 2. Seal — kind 13, empty tags, encrypted with trade key → recipient, signed by trade key
        var sealConvKey = await Noxtr.Nip44.getConversationKey(tradePrivkeyHex, recipientPubkeyHex);
        var seal = { kind: 13, pubkey: tradePub, content: await Noxtr.Nip44.encrypt(JSON.stringify(rumor), sealConvKey),
            tags: [], created_at: randomNow() };
        seal = await _signEventWith(seal, tradePrivkeyHex);

        // 3. Gift Wrap — kind 1059, ephemeral key, only robot p-tag
        var eph = _generateKeypair();
        var wrapConvKey = await Noxtr.Nip44.getConversationKey(eph.priv, recipientPubkeyHex);
        var wrap = { kind: 1059, pubkey: eph.pub, content: await Noxtr.Nip44.encrypt(JSON.stringify(seal), wrapConvKey),
            tags: [['p', recipientPubkeyHex]], created_at: Math.floor(Date.now() / 1000) };
        wrap = await _signEventWith(wrap, eph.priv);
        return wrap;
    }

    // NIP-59: decrypt gift wrap using our private key
    async function _unwrapGiftWrap(giftWrapEv, ourPrivkeyHex) {
        try {
            var wrapConvKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, giftWrapEv.pubkey);
            var seal = JSON.parse(await Noxtr.Nip44.decrypt(giftWrapEv.content, wrapConvKey));
            var sealConvKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, seal.pubkey);
            return JSON.parse(await Noxtr.Nip44.decrypt(seal.content, sealConvKey));
        } catch(e) { return null; }
    }

    // ==================== MOSTRO P2P CHAT (Mostro Mobile protocol) ====================
    // Derive ECDH shared keypair from the two trade keys.
    // sharedPriv = x-coord of (myTradePriv * peerTradePub), sharedPub = sharedPriv * G
    function _chatSharedKey(tradePrivHex, peerPubHex) {
        var shared = nobleSecp256k1.getSharedSecret(tradePrivHex, '02' + peerPubHex);
        if (typeof shared === 'string') shared = _hexToBytes(shared);
        var sharedPrivHex = _bytesToHex(shared.slice(1, 33));
        var sharedPubHex = _getPubkeyHex(sharedPrivHex);
        return { priv: sharedPrivHex, pub: sharedPubHex };
    }

    // Simplified NIP-59 gift wrap for P2P chat: kind:1 directly into kind:1059 (no seal layer)
    async function _p2pWrap(text, tradePrivHex, tradePubHex, sharedPrivHex, sharedPubHex) {
        var randomNow = function() { return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 7200); };
        var inner = { kind: 1, pubkey: tradePubHex, content: text,
            tags: [['p', sharedPubHex]], created_at: Math.floor(Date.now() / 1000) };
        inner = await _signEventWith(inner, tradePrivHex);
        var eph = _generateKeypair();
        var convKey = await Noxtr.Nip44.getConversationKey(eph.priv, sharedPubHex);
        var wrap = { kind: 1059, pubkey: eph.pub,
            content: await Noxtr.Nip44.encrypt(JSON.stringify(inner), convKey),
            tags: [['p', sharedPubHex]], created_at: randomNow() };
        wrap = await _signEventWith(wrap, eph.priv);
        return wrap;
    }

    // Unwrap a P2P chat gift wrap using the shared private key
    async function _p2pUnwrap(wrapEv, sharedPrivHex) {
        try {
            var convKey = await Noxtr.Nip44.getConversationKey(sharedPrivHex, wrapEv.pubkey);
            var inner = JSON.parse(await Noxtr.Nip44.decrypt(wrapEv.content, convKey));
            if (!inner || typeof inner.content !== 'string') return null;
            return {
                text: inner.content,
                senderPub: inner.pubkey || null,
                created_at: parseInt(inner.created_at, 10) || 0
            };
        } catch(e) { return null; }
    }

    // ==================== MOSTRO TRADER ====================

    var MostroTrader = {
        _trades: {},      // orderId → trade object
        _seenEvIds: {},   // dedup gift wraps from multiple relays
        _eoseReceived: false, // true after relay sends EOSE — events after this are live
        _subId: null,     // kind 1059 subscription
        _reqId: 0,
        _chatNotifyCutoffTs: Math.floor(Date.now() / 1000),
        _stuckReleaseThresholdSec: 600,

        _ajax: async function(action, data) {
            var params = Object.assign({ action: action }, data || {});
            // Flatten nested 'fields' object (mostro_trade_update) into fields[key]=val
            if (params.fields && typeof params.fields === 'object') {
                var flat = { action: action };
                for (var k in params) {
                    if (k === 'fields') {
                        for (var fk in params.fields) flat['fields[' + fk + ']'] = params.fields[fk];
                    } else {
                        flat[k] = params[k];
                    }
                }
                params = flat;
            }
            var r = await fetch('/' + _MODULE_ + '/ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params)
            });
            return r.json();
        },

        _tradeIndexOrDefault: function(trade, fallback) {
            var idx = parseInt(trade && trade.trade_index, 10) || 0;
            return idx > 0 ? idx : (fallback || 1);
        },

        _tradeAgeSec: function(trade) {
            var updatedAt = parseInt(trade && trade.updated_at, 10) || 0;
            if (!updatedAt) return 0;
            return Math.max(0, Math.floor(Date.now() / 1000) - updatedAt);
        },

        _formatAgeShort: function(seconds) {
            var s = Math.max(0, parseInt(seconds, 10) || 0);
            if (s < 60) return s + ' s';
            if (s < 3600) return Math.floor(s / 60) + ' min';
            return Math.floor(s / 3600) + ' h';
        },

        _isReleaseStuck: function(trade) {
            return !!trade &&
                trade.internal_status === 'liberando' &&
                this._tradeAgeSec(trade) >= this._stuckReleaseThresholdSec;
        },

        _canRecoverStuckRelease: function(trade) {
            return this._isReleaseStuck(trade) && parseInt(trade.is_seller, 10) && !trade._releaseInFlight;
        },

        _looksLikeRangeAmount: function(value) {
            return typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*$/.test(value);
        },

        _parseNumeric: function(value) {
            if (value === null || value === undefined || value === '') return null;
            var n = parseFloat(String(value).replace(',', '.'));
            return isFinite(n) ? n : null;
        },

        _parsePositiveInteger: function(value) {
            if (value === null || value === undefined) return null;
            var str = String(value).trim();
            if (!/^\d+$/.test(str)) return null;
            var n = parseInt(str, 10);
            return n >= 1 ? n : null;
        },

        _extractRangeBounds: function(trade) {
            var min = this._parseNumeric(trade && trade._rangeMin);
            var max = this._parseNumeric(trade && trade._rangeMax);
            if (min != null && max != null) return { min: min, max: max };
            try {
                var parsed = trade && trade.trade_json ? JSON.parse(trade.trade_json) : null;
                var ord = parsed && parsed.payload && parsed.payload.order;
                min = this._parseNumeric(ord && ord.min_amount);
                max = this._parseNumeric(ord && ord.max_amount);
                if (min != null && max != null) return { min: min, max: max };
            } catch(e) {}
            if (trade && this._looksLikeRangeAmount(trade.fiat_amount)) {
                var m = String(trade.fiat_amount).match(/^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
                if (m) {
                    min = this._parseNumeric(m[1]);
                    max = this._parseNumeric(m[2]);
                    if (min != null && max != null) return { min: min, max: max };
                }
            }
            return null;
        },

        _getSelectedFiatAmount: function(trade) {
            var selected = this._parseNumeric(trade && trade._selectedFiatAmount);
            if (selected != null) return selected;
            try {
                var parsed = trade && trade.trade_json ? JSON.parse(trade.trade_json) : null;
                var ord = parsed && parsed.payload && parsed.payload.order;
                selected = this._parseNumeric(ord && ord.fiat_amount);
                if (selected != null) return selected;
            } catch(e) {}
            if (trade && this._looksLikeRangeAmount(trade.fiat_amount)) return null;
            return this._parseNumeric(trade && trade.fiat_amount);
        },

        _isRangeMakerTrade: function(trade) {
            if (!trade || trade.trade_role !== 'created') return false;
            if (trade._rangeOrder) return true;
            if (this._extractRangeBounds(trade)) return true;
            return false;
        },

        _prepareChildOrderIfNeeded: async function(trade, callerLabel) {
            if (!this._isRangeMakerTrade(trade)) return null;
            var bounds = this._extractRangeBounds(trade);
            var selected = this._getSelectedFiatAmount(trade);
            if (!bounds || selected == null) {
                console.warn('[Mostro][' + callerLabel + '] Range order without enough data to prepare child order', trade && trade.order_id);
                return null;
            }
            if (!isFinite(bounds.min) || bounds.min < 1) {
                console.warn('[Mostro][' + callerLabel + '] Range order minimum below 1; refusing to prepare child order', trade && trade.order_id, 'min=', bounds.min);
                return null;
            }
            var remaining = bounds.max - selected;
            if (!isFinite(remaining) || remaining < bounds.min || remaining < 1) {
                console.log('[Mostro][' + callerLabel + '] Range order exhausted; no child order needed', trade && trade.order_id, 'remaining=', remaining, 'min=', bounds.min);
                return null;
            }
            if (!trade._pendingNextTrade) {
                var nextKp = _generateKeypair();
                var nextIndex = this._tradeIndexOrDefault(trade, 1) + 1;
                var childTempId = 'tmp-child-' + (trade.order_id || 'order') + '-' + nextIndex;
                var childFiatAmount = String(bounds.min) + '-' + String(remaining);
                trade._pendingNextTrade = {
                    pub: nextKp.pub,
                    priv: nextKp.priv,
                    index: nextIndex,
                    tempId: childTempId,
                };
                this._trades[childTempId] = {
                    order_id: childTempId,
                    robot_pubkey: trade.robot_pubkey,
                    trade_kind: trade.trade_kind,
                    trade_role: 'created',
                    is_seller: trade.is_seller,
                    fiat_amount: childFiatAmount,
                    fiat_code: trade.fiat_code,
                    sat_amount: 0,
                    payment_method: trade.payment_method,
                    trade_key_pub: nextKp.pub,
                    trade_privkey: nextKp.priv,
                    trade_index: nextIndex,
                    internal_status: 'publicado',
                    _rangeOrder: true,
                    _rangeMin: bounds.min,
                    _rangeMax: remaining,
                    updated_at: Math.floor(Date.now()/1000)
                };
                try {
                    await this._ajax('mostro_trade_add', {
                        order_id: childTempId,
                        robot_pubkey: trade.robot_pubkey,
                        trade_kind: trade.trade_kind,
                        trade_role: 'created',
                        is_seller: trade.is_seller,
                        fiat_amount: childFiatAmount,
                        fiat_code: trade.fiat_code,
                        sat_amount: 0,
                        payment_method: trade.payment_method,
                        trade_privkey: nextKp.priv,
                        trade_key_pub: nextKp.pub,
                        trade_index: nextIndex,
                        internal_status: 'publicado',
                    });
                } catch(e) {
                    console.error('[Mostro][' + callerLabel + '] Error preparing child trade row', e);
                }
                this.subscribeMyTrades();
                this.renderMyTrades();
            }
            return { next_trade: [trade._pendingNextTrade.pub, trade._pendingNextTrade.index] };
        },

        _clearPreparedChildReference: function(childPub) {
            if (!childPub) return;
            Object.values(this._trades).forEach(function(t) {
                if (t && t._pendingNextTrade && t._pendingNextTrade.pub === childPub) {
                    delete t._pendingNextTrade;
                }
            });
        },

        _collectTakeSellInputs: function(order) {
            var self = this;
            return new Promise(function(resolve) {
                var shortId = (order && order.id ? order.id : '').slice(0, 8);
                var myPubkey = Noxtr.Events && Noxtr.Events.pubkey ? Noxtr.Events.pubkey : '';
                var myLnAddress = myPubkey ? Noxtr.Profiles.lnAddress(myPubkey) : '';
                if (!myLnAddress && myPubkey) {
                    try { Noxtr.Profiles.request(myPubkey); } catch(e) {}
                }
                var amountHtml = '';
                if (order && order.isRange) {
                    amountHtml =
                        '<p class="mo-label">Elige un importe entre ' +
                        _escHtml(MostroBook._formatFiatValue(order.fiatMin)) + ' y ' +
                        _escHtml(MostroBook._formatFiatValue(order.fiatMax)) + ' ' +
                        _escHtml(order.fiatCode || '') + '.</p>' +
                        '<input id="mo-take-amount-' + shortId + '" type="text" class="mostro-invoice-input mo-input mo-input-lg" placeholder="' + _escHtml(MostroBook._formatFiatValue(order.fiatMin)) + '">';
                }
                $('body').dialog({
                    title: 'Comprar BTC — #' + shortId,
                    type: 'html',
                    content:
                        '<p><strong>' + _escHtml(MostroBook._formatOrderFiatLabel(order)) + '</strong> · ' + _escHtml(order.paymentMethod || '') + '</p>' +
                        amountHtml +
                        '<p class="mo-label">Tu Lightning Address o factura bolt11 para recibir los sats.</p>' +
                        '<input id="mo-take-lnaddr-' + shortId + '" type="text" class="mostro-invoice-input mo-input mo-input-lg" placeholder="usuario@dominio.com">',
                    buttons: [
                        { text: 'Cancelar', action: function(e, overlay) {
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            resolve(null);
                        }},
                        { text: 'Continuar', action: function(e, overlay) {
                            var chosen = null;
                            if (order && order.isRange) {
                                var amountRaw = document.getElementById('mo-take-amount-' + shortId).value.trim();
                                chosen = parseFloat(String(amountRaw).replace(',', '.'));
                                if (!isFinite(chosen) || chosen < parseFloat(order.fiatMin) || chosen > parseFloat(order.fiatMax)) {
                                    alert('El importe debe estar entre ' + MostroBook._formatFiatValue(order.fiatMin) + ' y ' + MostroBook._formatFiatValue(order.fiatMax) + ' ' + (order.fiatCode || '') + '.');
                                    return;
                                }
                            }
                            var invoiceInput = document.getElementById('mo-take-lnaddr-' + shortId).value.trim();
                            if (!invoiceInput) {
                                alert('Introduce tu Lightning Address o una factura bolt11.');
                                return;
                            }
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            resolve({ amount: chosen, invoiceInput: invoiceInput });
                        }}
                    ],
                    onLoad: function() {
                        var applyProfileLnAddress = function() {
                            var inp = document.getElementById('mo-take-lnaddr-' + shortId);
                            if (!inp) return false;
                            if ((inp.value || '').trim()) return false;
                            var lnAddr = myPubkey ? Noxtr.Profiles.lnAddress(myPubkey) : '';
                            if (!lnAddr) return false;
                            inp.value = lnAddr;
                            return true;
                        };
                        var amountInp = document.getElementById('mo-take-amount-' + shortId);
                        if (amountInp) {
                            amountInp.value = MostroBook._formatFiatValue(order.fiatMin);
                            setTimeout(function() { amountInp.focus(); }, 80);
                        } else {
                            var lnInp = document.getElementById('mo-take-lnaddr-' + shortId);
                            if (lnInp) setTimeout(function() { lnInp.focus(); }, 80);
                        }
                        applyProfileLnAddress();
                        setTimeout(applyProfileLnAddress, 350);
                        setTimeout(applyProfileLnAddress, 1200);
                    }
                });
            });
        },

        _submitBuyerInvoiceInput: async function(trade, invoiceInput, sats) {
            var val = (invoiceInput || '').trim();
            if (!val) return false;
            var rangeFiatAmount = (trade._rangeOrder && trade._rangeFiatAmount != null) ? trade._rangeFiatAmount : null;
            var invoicePayload = { payment_request: [null, val, rangeFiatAmount != null ? rangeFiatAmount : (sats || null)] };
            await this._sendToRobot('add-invoice', invoicePayload, trade.robot_pubkey, trade.trade_privkey, trade.order_id, this._tradeIndexOrDefault(trade, 1));
            await this._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'esperando_pago_vendedor', status: 'add-invoice' } });
            delete trade._pendingInvoiceInput;
            trade.internal_status = 'esperando_pago_vendedor';
            trade.status = 'add-invoice';
            trade.trade_action = 'add-invoice';
            trade.updated_at = Math.floor(Date.now() / 1000);
            this.renderMyTrades();
            return true;
        },

        _buildMsg: function(action, payload, orderId, reqId, tradeIndex) {
            return { order: { version: 1, id: orderId || null,
                action: action, payload: payload || null,
                request_id: reqId || 0, trade_index: tradeIndex || null } };
        },

        _sendToRobot: async function(action, payload, robotPubkey, tradePrivkey, orderId, tradeIndex) {
            if (!Noxtr.Events.privkey) { console.error('[Mostro] nsec requerido para enviar al robot'); return; }
            var msgObj = this._buildMsg(action, payload, orderId, ++this._reqId, tradeIndex);
            // Contenido del rumor: [mensaje, null] — modo privacidad total (como Mostro Mobile)
            var rumorContent = JSON.stringify([msgObj, null]);
            console.log('[Mostro] _sendToRobot msg:', JSON.stringify(msgObj));
            if (action === 'release' || action === 'fiat-sent') {
                _mostroDebug('[Mostro][SEND]', action, {
                    order_id: orderId || null,
                    trade_index: tradeIndex || null,
                    payload: payload || null,
                    robot_pubkey: robotPubkey ? robotPubkey.slice(0, 12) + '...' : null
                });
            }
            var wrap = await _giftWrap(rumorContent, robotPubkey, tradePrivkey);
            Noxtr.Pool.publish(wrap);
            // Also publish directly to mostro relay in case it's not in the pool
            Noxtr.Pool.publishTo('wss://relay.mostro.network', wrap);
            return wrap;
        },

        // Subscribe to kind 1059 for all active trade pubkeys
        subscribeMyTrades: function() {
            var TERMINAL_NO_ROBOT = { 'cancelado': true, 'cancelando': true };
            var TERMINAL_NO_CHAT  = { 'cancelado': true };
            var pubs = [];
            Object.values(this._trades).forEach(function(t) {
                if (parseInt(t.archived)) return;
                // Robot messages: skip all terminal states
                if (!TERMINAL_NO_ROBOT[t.internal_status] && t.internal_status !== 'completado') {
                    if (t.trade_key_pub && t.trade_key_pub.length === 64) pubs.push(t.trade_key_pub);
                }
                // P2P chat: keep even after completado (chat is still valid after trade ends)
                if (!TERMINAL_NO_CHAT[t.internal_status]) {
                    if (t.peer_pubkey && t.peer_pubkey.length === 64 && !t._chatKey) {
                        try { t._chatKey = _chatSharedKey(t.trade_privkey, t.peer_pubkey); } catch(e) {}
                    }
                    if (t._chatKey && t._chatKey.pub) pubs.push(t._chatKey.pub);
                }
            });
            console.log('[Mostro] subscribeMyTrades pubs=', pubs);
            if (!pubs.length) return;
            if (this._subId) Noxtr.Pool.unsubscribe(this._subId);
            var self = this;
            this._eoseReceived = false;
            this._subId = Noxtr.Pool.subscribe(
                [{ kinds: [1059], '#p': pubs, since: Math.floor(Date.now() / 1000) - 86400 * 7 }],
                function(ev) { self._handleGiftWrap(ev); },
                function() { self._eoseReceived = true; }
            );
        },

        _handleGiftWrap: async function(ev) {
            console.log('[Mostro] _handleGiftWrap called ev.id=', ev.id, 'seen=', !!this._seenEvIds[ev.id]);
            if (this._seenEvIds[ev.id]) return;
            this._seenEvIds[ev.id] = true;
            // Find matching trade first to check timestamp
            var pTags = (ev.tags || []).filter(function(t) { return t[0]==='p'; }).map(function(t) { return t[1]; });
            console.log('[Mostro] gift wrap received ev.id=', ev.id, 'p-tags=', pTags);
            // Match by trade_key_pub → robot message
            var trade = null, isP2P = false, tradePrivForUnwrap = null;
            for (var oid in this._trades) {
                var t = this._trades[oid];
                if (t.trade_key_pub && pTags.indexOf(t.trade_key_pub) !== -1) {
                    trade = t;
                    tradePrivForUnwrap = t.trade_privkey;
                    break;
                }
            }
            // Match by chat shared key → P2P message
            if (!trade) {
                for (var oid in this._trades) {
                    var t = this._trades[oid];
                    if (t._chatKey && t._chatKey.pub && pTags.indexOf(t._chatKey.pub) !== -1) {
                        trade = t; isP2P = true; break;
                    }
                }
            }
            if (!trade) { console.log('[Mostro] gift wrap no matching trade'); return; }

            if (isP2P) {
                var p2p = await _p2pUnwrap(ev, trade._chatKey.priv);
                if (p2p && p2p.senderPub !== trade.trade_key_pub) {
                    var msgTs = parseInt(p2p && p2p.created_at, 10) || 0;
                    var shouldNotifyChat = this._eoseReceived && (!msgTs || msgTs >= this._chatNotifyCutoffTs);
                    this._receiveChatMsg(trade, p2p.text, !shouldNotifyChat);
                }
                return;
            }

            var rumor = await _unwrapGiftWrap(ev, tradePrivForUnwrap || trade.trade_privkey);
            if (!rumor) return;
            try {
                var msg = JSON.parse(rumor.content);
                var msgObj = Array.isArray(msg) ? msg[0] : msg;
                var order = (msgObj && msgObj.order) || {};
                var action = order.action;
                var payload = order.payload || null;
                if (action) {
                    if (action === 'releasing' || action === 'released' || action === 'success' || action === 'hold-invoice-payment-settled' || action === 'purchase-completed' || action === 'cant-do' || action === 'fiat-sent' || action === 'fiat-sent-ok') {
                        _mostroDebug('[Mostro][RECV]', action, {
                            matched_order_id: trade && trade.order_id,
                            current_status: trade && trade.internal_status,
                            trade_index: order.trade_index || null,
                            payload: payload || null
                        });
                    }
                    this._processRobotAction(action, payload, trade, order);
                }
            } catch(e) {}
        },

        _receiveChatMsg: function(trade, text, silent) {
            if (!trade._chatMsgs) trade._chatMsgs = [];
            trade._chatMsgs.push({ from: 'peer', text: text, ts: Date.now() });
            this._renderChatBox(trade);
            if (!silent) {
                // Auto-open chat only for genuinely new messages, not for history loaded on refresh.
                var el = document.getElementById('mostro-trades');
                if (el) {
                    var box = el.querySelector('.mostro-chat-box[data-id="' + trade.order_id + '"]');
                    if (box) box.classList.add('mostro-chat-open');
                }
                notify('💬 Mensaje de la contraparte en #' + (trade.order_id||'').slice(0,8), 'info', 5000);
            }
        },

        _renderChatBox: function(trade) {
            var el = document.getElementById('mostro-trades');
            if (!el) return;
            var box = el.querySelector('.mostro-chat-box[data-id="' + trade.order_id + '"]');
            if (!box) return;
            var msgs = box.querySelector('.mostro-chat-msgs');
            if (!msgs) return;
            msgs.innerHTML = (trade._chatMsgs || []).map(function(m) {
                var timeStr = m.ts ? new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
                return '<div class="mostro-chat-msg mostro-chat-' + m.from + '">' +
                    '<span class="mostro-chat-who">' + (m.from === 'me' ? 'Tú' : 'Contraparte') + ':</span> ' +
                    _escHtml(m.text) +
                    (timeStr ? '<span class="mostro-chat-ts">' + timeStr + '</span>' : '') +
                    '</div>';
            }).join('');
            msgs.scrollTop = msgs.scrollHeight;
        },

        _sendChatMsg: async function(trade, text) {
            if (!text) return;
            if (!trade.peer_pubkey) { notify('Aún no se conoce la clave del par. Espera a que el trade esté activo.', 'warning', 4000); return; }
            if (!trade.trade_privkey) { notify('No se encontró la clave del trade.', 'error', 3000); return; }
            if (!trade._chatKey) {
                try { trade._chatKey = _chatSharedKey(trade.trade_privkey, trade.peer_pubkey); } catch(e) {}
            }
            if (!trade._chatKey) { notify('Error al preparar el cifrado del chat.', 'error', 3000); return; }
            if (!trade._chatMsgs) trade._chatMsgs = [];
            trade._chatMsgs.push({ from: 'me', text: text, ts: Date.now() });
            this._renderChatBox(trade);
            try {
                var tradePubHex = trade.trade_key_pub || _getPubkeyHex(trade.trade_privkey);
                var wrap = await _p2pWrap(text, trade.trade_privkey, tradePubHex, trade._chatKey.priv, trade._chatKey.pub);
                Noxtr.Pool.publish(wrap);
            } catch(e) {
                console.error('[Mostro] Error enviando chat:', e);
                notify('No se pudo enviar el mensaje.', 'error', 3000);
            }
        },

        _processRobotAction: async function(action, payload, trade, orderMeta, matchInfo) {
            orderMeta = orderMeta || {};
            matchInfo = matchInfo || {};
            var updates = { status: action, trade_action: action };
            var isCreatedSellMaker = parseInt(trade.is_seller) && trade.trade_role === 'created' && trade.trade_kind === 'sell';
            var isTakenSellBuyer = !parseInt(trade.is_seller) && trade.trade_role === 'taken' && trade.trade_kind === 'sell';
            var ord = payload && payload.order;
            var buyerPub = ord && (ord.buyer_trade_pubkey || ord.buyer_pubkey);
            var sellerPub = ord && (ord.seller_trade_pubkey || ord.seller_pubkey);
            var hasPeerPubkeys = !!(buyerPub || sellerPub);
            var payloadStatus = ((ord && ord.status) || (payload && payload.status) || '').toLowerCase().replace(/_/g, '-');
            var payloadIndicatesActive = payloadStatus === 'active' || hasPeerPubkeys;
            var reportedTradeIndex = parseInt(orderMeta.trade_index, 10) || 0;
            // Persist the last private robot payload for debugging edge cases between clients.
            try { updates.trade_json = JSON.stringify({ action: action, payload: payload || null }); } catch(e) {}
            if (reportedTradeIndex > 0) updates.trade_index = reportedTradeIndex;

            if (ord) {
                if (ord.amount !== undefined && ord.amount !== null) updates.sat_amount = ord.amount;
                var fiatValue = this._parseNumeric(ord.fiat_amount);
                var hasRangeBounds = ord.min_amount !== undefined && ord.min_amount !== null &&
                    ord.max_amount !== undefined && ord.max_amount !== null;
                if (fiatValue !== null && (fiatValue > 0 || !hasRangeBounds)) {
                    updates.fiat_amount = String(ord.fiat_amount);
                }
                if (ord.fiat_code) updates.fiat_code = ord.fiat_code;
                if (ord.payment_method) updates.payment_method = ord.payment_method;

                if (hasRangeBounds) {
                    trade._rangeOrder = true;
                    trade._rangeMin = ord.min_amount;
                    trade._rangeMax = ord.max_amount;
                }
                if (fiatValue !== null && fiatValue > 0) {
                    trade._selectedFiatAmount = ord.fiat_amount;
                }
            }

            // Generic robot action → internal_status.
            // Seller-created sell offers need a contextual override below: `buyer-took-order`
            // only means "taken", not "hold invoice already confirmed".
            var statusMap = {
                'new-order': 'publicado', 'order': 'publicado', 'order-published': 'publicado',
                'buyer-took-order': 'activo', 'pay-invoice': 'tomado', 'waiting-seller-to-pay': 'tomado',
                'add-invoice': 'tomado', 'waiting-buyer-invoice': 'activo',
                'hold-invoice-payment-accepted': 'activo', 'active': 'activo',
                'fiat-sent': 'fiat_enviado', 'fiat-sent-ok': 'fiat_enviado', 'released': 'liberando',
                'releasing': 'fiat_enviado',
                'success': 'completado', 'hold-invoice-payment-settled': 'completado', 'purchase-completed': 'completado',
                'canceled': 'cancelado', 'cancel': 'cancelacion_solicitada',
                'dispute': 'disputado',
                'dispute-initiated-by-peer': 'disputado',
                'hold-invoice-payment-canceled': 'cancelado',
            };
            var statusPriority = ['creado','enviando','publicado','esperando_hold_invoice','cancelando','tomado','esperando_pago_vendedor','cancelacion_solicitada','activo','fiat_enviado','liberando','completado','cancelado','disputado'];
            if (statusMap[action]) {
                var newStatus = statusMap[action];
                // Localized fix for NOTES.md flow 4:
                // when we created a sell order and a buyer takes it, we must wait for the
                // robot's `pay-invoice` before showing the trade as active.
                if (action === 'buyer-took-order' && isCreatedSellMaker) {
                    newStatus = payloadIndicatesActive ? 'activo' : 'esperando_hold_invoice';
                }
                // Some Mostro implementations reuse `waiting-buyer-invoice` while already revealing
                // peer pubkeys after the hold invoice is paid. Treat that as active only once the
                // payload actually contains the counterparty pubkeys.
                if (action === 'waiting-buyer-invoice' && isCreatedSellMaker) {
                    newStatus = payloadIndicatesActive ? 'activo' : 'esperando_hold_invoice';
                }
                // Buyer side of a sell order: once the LN invoice was sent, the next real step
                // is waiting for the seller to pay the hold invoice, not sending fiat yet.
                if (action === 'waiting-seller-to-pay' && isTakenSellBuyer) {
                    newStatus = payloadIndicatesActive ? 'activo' : 'esperando_pago_vendedor';
                }
                var curPrio = statusPriority.indexOf(trade.internal_status);
                var newPrio = statusPriority.indexOf(newStatus);
                if (newPrio >= curPrio) {
                    updates.internal_status = newStatus;
                }
                // else: don't downgrade (e.g. pay-invoice arriving again after activo)
            }

            // cant-do: robot rejected our last action — revert cancelando → publicado
            if (action === 'cant-do' && trade.internal_status === 'cancelando') {
                updates.internal_status = 'publicado';
                alert('El robot no pudo cancelar la orden (posiblemente ya fue tomada).');
            }

            // payment-failed: NOT a status change — buyer invoice failed, robot will retry or send add-invoice again
            // Do NOT change internal_status; just notify and let subsequent add-invoice restart the flow
            if (action === 'payment-failed') {
                var attempts = payload && payload.payment_failed && payload.payment_failed.payment_attempts;
                var interval = payload && payload.payment_failed && payload.payment_failed.payment_retries_interval;
                var msg = '⚠️ El pago de tu factura ha fallado';
                if (attempts) msg += ' (intento ' + attempts + ')';
                if (interval) msg += '. El robot reintentará en ' + interval + ' min';
                notify(msg + '.', 'warning', 7000);
                delete updates.internal_status; // no status change
            }

            // hold-invoice-payment-canceled: escrow canceled — trade ends
            if (action === 'hold-invoice-payment-canceled') {
                notify('El escrow (hold invoice) ha sido cancelado. La orden #' + (trade.order_id||'').slice(0,8) + ' ha finalizado.', 'warning', 7000);
                // Close QR if still open
                var _qrOv = trade._qrOverlay ||
                    document.querySelector('.wq-dialog-overlay[data-mostro-order-id="' + trade.order_id + '"]');
                if (_qrOv) {
                    var _qrDc = _qrOv.querySelector && _qrOv.querySelector('.wq-dialog-content');
                    if (_qrDc && _qrDc._dialogInstance) _qrDc._dialogInstance.close();
                    else if (_qrOv.parentNode) _qrOv.parentNode.removeChild(_qrOv);
                    trade._qrOverlay = null;
                }
            }

            // send-dm: admin/robot direct message (dispute, info, etc.)
            if (action === 'send-dm') {
                var dmText = payload && (payload.dm || payload.message || payload.text || JSON.stringify(payload));
                if (dmText) {
                    if (!trade._chatMsgs) trade._chatMsgs = [];
                    trade._chatMsgs.push({ from: 'peer', text: dmText, ts: Date.now() });
                    this._renderChatBox(trade);
                    notify('💬 Mensaje del robot en #' + (trade.order_id||'').slice(0,8), 'info', 5000);
                }
                delete updates.internal_status; // no status change from DM
            }

            // Robot gives us real UUID on new-order confirmation
            if ((action === 'new-order' || action === 'order') && payload) {
                var realId = (payload.order && payload.order.id) || payload.id;
                if (realId && realId !== trade.order_id && realId.indexOf('tmp-') !== 0) {
                    updates.order_id = realId;
                }
            }
            // Close QR + extract peer pubkeys only once the hold invoice is really confirmed.
            // `buyer-took-order` is too early for locally created sell offers: the seller still
            // has to receive and pay the hold invoice first.
            var isHoldConfirmed = action === 'hold-invoice-payment-accepted' || action === 'active' ||
                                  (payloadIndicatesActive && (isCreatedSellMaker || isTakenSellBuyer)) ||
                                  (action === 'buyer-took-order' && !isCreatedSellMaker);
            if (isHoldConfirmed) {
                var ourPub = trade.trade_key_pub;
                console.log('[Mostro] isHoldConfirmed action=', action, 'ord=', JSON.stringify(ord), 'buyerPub=', buyerPub, 'sellerPub=', sellerPub, 'ourPub=', ourPub);
                var pp = (buyerPub && buyerPub !== ourPub) ? buyerPub :
                         (sellerPub && sellerPub !== ourPub) ? sellerPub : null;
                if (pp) {
                    updates.peer_pubkey = pp;
                    if (trade.trade_privkey) {
                        try { trade._chatKey = _chatSharedKey(trade.trade_privkey, pp); this.subscribeMyTrades(); } catch(e) {}
                    }
                }
                // Close all pay-invoice QR dialogs for this order. Relay duplicates can open more
                // than one overlay if the same action is replayed before the first one closes.
                var _sid = (trade.order_id || '').slice(0, 8);
                var qrOverlays = Array.prototype.slice.call(
                    document.querySelectorAll('.wq-dialog-overlay[data-mostro-order-id="' + trade.order_id + '"]')
                );
                if (!qrOverlays.length && trade._qrOverlay) qrOverlays.push(trade._qrOverlay);
                if (!qrOverlays.length) {
                    Array.prototype.forEach.call(document.querySelectorAll('#mo-qr-dialog-' + _sid), function(_inner) {
                        var _el = _inner;
                        while (_el && !(_el.classList && _el.classList.contains('wq-dialog-overlay'))) _el = _el.parentNode;
                        if (_el && _el.classList && _el.classList.contains('wq-dialog-overlay') && qrOverlays.indexOf(_el) === -1) {
                            qrOverlays.push(_el);
                        }
                    });
                }
                console.log('[Mostro] QR close action=', action, 'count=', qrOverlays.length, '_qrOverlay=', !!trade._qrOverlay);
                qrOverlays.forEach(function(qrOverlay) {
                    var _dc = qrOverlay.querySelector && qrOverlay.querySelector('.wq-dialog-content');
                    if (_dc && _dc._dialogInstance) { _dc._dialogInstance.close(); }
                    else if (qrOverlay.parentNode) { qrOverlay.parentNode.removeChild(qrOverlay); }
                });
                if (qrOverlays.length) {
                    trade._qrOverlay = null;
                }
                if (parseInt(trade.is_seller) &&
                    ((action === 'buyer-took-order' && !isCreatedSellMaker) ||
                     (action === 'waiting-buyer-invoice' && isCreatedSellMaker && hasPeerPubkeys))) {
                    notify('Hold invoice confirmada. Espera que el comprador envíe el fiat.', 'success', 6000);
                }
            }

            // Persist to DB
            var dbRes = await this._ajax('mostro_trade_update', { order_id: trade.order_id, fields: updates });
            console.log('[Mostro] trade_update', action, trade.order_id, updates, dbRes);

            // If UUID changed, rename in memory
            if (updates.order_id) {
                delete this._trades[trade.order_id];
                trade.order_id = updates.order_id;
                this._trades[trade.order_id] = trade;
            }
            var prevStatus = trade.internal_status;
            Object.assign(trade, updates);
            if ((action === 'new-order' || action === 'order') && trade.trade_key_pub) {
                this._clearPreparedChildReference(trade.trade_key_pub);
            }
            this.renderMyTrades();
            // Re-render order book so own orders show "Cancelar" once UUID is known
            if (MostroBook && MostroBook.render) MostroBook.render();
            // Show UI for actions that require user interaction
            this._showTradeAction(action, payload, trade, prevStatus);
        },

        _showTradeAction: function(action, payload, trade, prevStatus) {
            var preStatus = prevStatus || trade.internal_status;
            var self = this;
            var shortId = (trade.order_id || '').slice(0, 8);

            if (action === 'buyer-took-order' || action === 'waiting-seller-to-pay') {
                if (parseInt(trade.is_seller) && trade.trade_role === 'created') {
                    notify('Un comprador ha tomado tu oferta <strong>#' + shortId + '</strong>. El robot te enviará la hold invoice en breve.', 'info', 6000);
                }
            }

            var _noQr = ['activo','fiat_enviado','liberando','completado','cancelado','cancelando','cancelacion_solicitada','disputado'];
            if (action === 'pay-invoice' && parseInt(trade.is_seller) &&
                _noQr.indexOf(preStatus) === -1 && _noQr.indexOf(trade.internal_status) === -1) {
                var existingQrOverlay = trade._qrOverlay ||
                    document.querySelector('.wq-dialog-overlay[data-mostro-order-id="' + trade.order_id + '"]');
                if (existingQrOverlay && existingQrOverlay.parentNode) {
                    trade._qrOverlay = existingQrOverlay;
                    return;
                }
                var pr = payload && payload.payment_request;
                var bolt11 = Array.isArray(pr) ? pr[1] : pr;
                var sats = Array.isArray(pr) ? pr[2] : null;
                if (!bolt11) return;
                var satsInfo = sats ? '<p class="mostro-qr-sats"><strong>' + Number(sats).toLocaleString() + ' sats</strong></p>' : '';
                var qrDialogId = 'mo-qr-dialog-' + shortId;
                // Keep QR popup structure class-based so presentation lives in style.mostro.css.
                $('body').dialog({ title: 'Paga la hold invoice — #' + shortId, type: 'html',
                    content: '<div id="' + qrDialogId + '" class="mostro-qr-dialog">' + satsInfo +
                        '<p class="mostro-qr-help">Escanea el QR con tu wallet Lightning o copia la factura. Tienes 15 minutos antes de que la toma expire.</p>' +
                        '<div id="mo-qr-' + shortId + '" class="mostro-qr-code"></div>' +
                        '<p class="mostro-qr-bolt11">' + bolt11 + '</p>' +
                        '</div>',
                    buttons: [
                        { text: 'Copiar factura', action: function(e, overlay) {
                            navigator.clipboard.writeText(bolt11).then(function() { notify('Factura copiada', 'success', 3000); });
                        }},
                        { text: 'Cancelar trade', action: async function(e, overlay) {
                            var _dc = overlay.querySelector('.wq-dialog-content');
                            if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            trade._qrOverlay = null;
                            await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, trade.trade_index || 1);
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando', status: 'cancel' } });
                            trade.internal_status = 'cancelando'; self.renderMyTrades();
                        }},
                        { text: 'Ya pagué la factura', action: async function(e, overlay) {
                            var _dc = overlay.querySelector('.wq-dialog-content');
                            if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            trade._qrOverlay = null;
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'activo' } });
                            trade.internal_status = 'activo'; self.renderMyTrades();
                            notify('Esperando confirmación del robot…', 'info', 4000);
                        }},
                        { text: 'Cerrar', action: function(e, overlay) {
                            var _dc = overlay.querySelector('.wq-dialog-content');
                            if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            trade._qrOverlay = null;
                        }}
                    ],
                    onLoad: function(dlg) {
                        new QRCode(document.getElementById('mo-qr-' + shortId), {
                            text: bolt11.toUpperCase(),
                            width: 200, height: 200,
                            colorDark: '#000', colorLight: '#fff'
                        });
                    }
                });
                // Store overlay reference after render tick (wquery may render asynchronously)
                (function(t) {
                    setTimeout(function() {
                        var ov = document.querySelector('.wq-dialog-overlay:last-child');
                        if (ov) { ov.dataset.mostroOrderId = t.order_id; t._qrOverlay = ov; }
                    }, 50);
                })(trade);
            }

            if (action === 'add-invoice' && !parseInt(trade.is_seller) &&
                ['activo','fiat_enviado','liberando','completado','cancelado'].indexOf(preStatus) === -1) {
                // Robot asks buyer for their LN address or invoice
                var myPubkey = Noxtr.Events && Noxtr.Events.pubkey ? Noxtr.Events.pubkey : '';
                var myLnAddress = myPubkey ? Noxtr.Profiles.lnAddress(myPubkey) : '';
                var sats = payload && payload.payment_request && payload.payment_request[2];
                var pendingInvoiceInput = (trade._pendingInvoiceInput || '').trim();
                if (!myLnAddress && myPubkey) {
                    try { Noxtr.Profiles.request(myPubkey); } catch(e) {}
                }
                if (pendingInvoiceInput) {
                    (async function() {
                        try {
                            await self._submitBuyerInvoiceInput(trade, pendingInvoiceInput, sats);
                            notify('Usando la Lightning Address/factura indicada al tomar la orden.', 'info', 5000);
                        } catch(e) {
                            console.error('[Mostro] Error enviando add-invoice automático:', e);
                            notify('No se pudo usar automáticamente la Lightning Address guardada. Introdúcela manualmente.', 'warning', 6000);
                            delete trade._pendingInvoiceInput;
                            self._showTradeAction(action, payload, trade, 'tomado');
                        }
                    })();
                    return;
                }
                var existingLnAddrOverlay = trade._lnAddrOverlay ||
                    document.querySelector('.wq-dialog-overlay[data-mostro-lnaddr-order-id="' + trade.order_id + '"]');
                if (existingLnAddrOverlay && existingLnAddrOverlay.parentNode) {
                    trade._lnAddrOverlay = existingLnAddrOverlay;
                    var existingInput = document.getElementById('mo-lnaddr-' + shortId);
                    if (existingInput) setTimeout(function() { existingInput.focus(); }, 50);
                    return;
                }
                var satsInfo = sats ? '<p><strong>' + Number(sats).toLocaleString() + ' sats</strong> a recibir</p>' : '';
                $('body').dialog({ title: 'Introduce tu dirección Lightning — #' + shortId, type: 'html',
                    content: satsInfo +
                        '<p class="mo-label">Introduce tu Lightning Address (ej: usuario@wallet.com) o una factura bolt11.</p>' +
                        '<input id="mo-lnaddr-' + shortId + '" type="text" class="mostro-invoice-input mo-input mo-input-lg" placeholder="usuario@dominio.com">',
                    buttons: [
                        { text: 'Enviar', action: async function(e, overlay) {
                            var val = document.getElementById('mo-lnaddr-' + shortId).value.trim();
                            if (!val) return;
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            trade._lnAddrOverlay = null;
                            await self._submitBuyerInvoiceInput(trade, val, sats);
                        }},
                        { text: 'Cancelar', action: async function(e, overlay) {
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            trade._lnAddrOverlay = null;
                            await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, self._tradeIndexOrDefault(trade, 1));
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando' } });
                            trade.internal_status = 'cancelando'; self.renderMyTrades();
                        }}
                    ],
                    onLoad: function() {
                        var applyProfileLnAddress = function() {
                            var inp = document.getElementById('mo-lnaddr-' + shortId);
                            if (!inp) return false;
                            if ((inp.value || '').trim()) return false;
                            var lnAddr = myPubkey ? Noxtr.Profiles.lnAddress(myPubkey) : '';
                            if (!lnAddr) return false;
                            inp.value = lnAddr;
                            return true;
                        };
                        var inp = document.getElementById('mo-lnaddr-' + shortId);
                        if (inp) {
                            if (myLnAddress) inp.value = myLnAddress;
                            setTimeout(function() { inp.focus(); }, 100);
                            setTimeout(applyProfileLnAddress, 350);
                            setTimeout(applyProfileLnAddress, 1200);
                        }
                    }
                });
                // Relay duplicates can re-trigger `add-invoice`; keep only one dialog per order.
                (function(t) {
                    setTimeout(function() {
                        var ov = document.querySelector('.wq-dialog-overlay:last-child');
                        if (ov) { ov.dataset.mostroLnaddrOrderId = t.order_id; t._lnAddrOverlay = ov; }
                    }, 50);
                })(trade);
            }

            if ((action === 'fiat-sent' || action === 'fiat-sent-ok') && parseInt(trade.is_seller)) {
                if (['liberando','completado','cancelado'].indexOf(preStatus) === -1) {
                    trade._fiatSentReceived = true;
                    self.renderMyTrades();
                    $('body').dialog({ title: '💸 El comprador envió el fiat — #' + shortId, type: 'html',
                        content: '<p>El comprador confirma que ha enviado el pago en fiat. Verifica el pago y libera los sats.</p>',
                        buttons: [
                            { text: 'Cerrar', action: function(e, overlay) {
                                var _dc = overlay.querySelector('.wq-dialog-content');
                                if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            }}
                        ]
                    });
                }
            }

            if (['releasing','released','success','hold-invoice-payment-settled','purchase-completed','cant-do','canceled','hold-invoice-payment-canceled'].indexOf(action) !== -1) {
                delete trade._releaseInFlight;
            }

            if (action === 'cancel') {
                $('body').dialog({ title: 'Cancelación solicitada — #' + shortId, type: 'html',
                    content: '<p>La contraparte ha solicitado cancelar este trade.</p>',
                    buttons: [
                        { text: 'Aceptar cancelación', action: async function(e, overlay) {
                            document.body.removeChild(overlay);
                            await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, trade.trade_index || 1);
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando', status: 'cancel' } });
                            trade.internal_status = 'cancelando'; self.renderMyTrades();
                        }},
                        { text: 'Disputar', action: async function(e, overlay) {
                            document.body.removeChild(overlay);
                            await self._sendToRobot('dispute', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, trade.trade_index || 1);
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'disputado', status: 'dispute' } });
                            trade.internal_status = 'disputado'; self.renderMyTrades();
                        }}
                    ]
                });
            }

            if (action === 'success' || action === 'hold-invoice-payment-settled' || action === 'purchase-completed') {
                if (parseInt(trade.is_seller) && trade._fiatSentReceived) {
                    notify('¡Los sats han sido liberados y el trade está completado! (#' + shortId + ')', 'success', 8000);
                } else {
                    notify('¡Trade completado con éxito! (#' + shortId + ')', 'success', 8000);
                }
            }

            if (action === 'canceled' || action === 'hold-invoice-payment-canceled') {
                notify('La orden #' + shortId + ' ha sido cancelada.', 'warning', 5000);
            }
        },

        // Load trades from DB and subscribe
        loadMyTrades: async function() {
            var self = this;
            try {
                var res = await this._ajax('mostro_trade_list', { limit: 200 });
                if (res.ok && res.trades) {
                    this._trades = {};
                    var now = Math.floor(Date.now() / 1000);
                    var stale = ['creado', 'cancelando', 'enviando'];
                    res.trades.forEach(function(t) {
                        t.trade_index = parseInt(t.trade_index, 10) || 0;
                        // Auto-expire orphaned trades after 24h without robot response
                        if (stale.indexOf(t.internal_status) !== -1 && t.updated_at && (now - t.updated_at) > 86400) {
                            t.internal_status = 'cancelado';
                            self._ajax('mostro_trade_update', { order_id: t.order_id, fields: { internal_status: 'cancelado' } });
                        }
                        self._trades[t.order_id] = t;
                    });
                    this.subscribeMyTrades();
                    this.renderMyTrades();
                    if (MostroBook && MostroBook.render) MostroBook.render();
                }
            } catch(e) { console.error('[Mostro] loadMyTrades error', e); }
        },

        // Render "Mis trades activos" section
        renderMyTrades: function() {
            var el = document.getElementById('mostro-trades');
            if (!el) return;
            // Keep archived rows in the DB for /mostro/trades, but hide them from the main UI.
            var hiddenStatuses = { 'publicado': true };
            var active = Object.values(this._trades).filter(function(t) { return !hiddenStatuses[t.internal_status] && !parseInt(t.archived); });
            active.sort(function(a, b) { return (b.updated_at||0) - (a.updated_at||0); });
            console.log('[Mostro] renderMyTrades active=', active.map(function(t){ return {id:(t.order_id||'').slice(0,8), role:t.trade_role, st:t.internal_status}; }));
            if (!active.length) { el.innerHTML = ''; return; }

            var STATUS_LABELS = {
                'creado':'⏳ Preparando…', 'enviando':'📡 Enviando…', 'publicado':'✅ Publicada',
                'esperando_hold_invoice':'⏳ Esperando hold invoice del robot',
                'esperando_pago_vendedor':'⏳ Esperando que el vendedor pague la hold invoice',
                'cancelando':'🔄 Cancelando…', 'cancelacion_solicitada':'⚠️ Cancelación solicitada', 'liberando':'🔄 Liberando sats…',
                'tomado':'🤝 Tomada', 'activo':'⚡ Activa', 'fiat_enviado':'💸 Fiat enviado',
                'completado':'✅ Completado', 'cancelado':'❌ Cancelada', 'disputado':'⚠️ Disputado', 'archivado':'🗃️ Archivado'
            };
            var self = this;
            el.innerHTML = '<div class="mostro-my-trades">' +
                '<div class="mostro-section-title">Mis trades activos</div>' +
                active.map(function(t) {
                    var roleLabel = t.trade_role === 'created' ? 'Creada por ti' : 'Tomada por ti';
                    var sideLabel = parseInt(t.is_seller) ? 'Vendiendo BTC' : 'Comprando BTC';
                    var statusLabel = STATUS_LABELS[t.internal_status] || t.internal_status;
                    var isStuckRelease = self._isReleaseStuck(t);
                    var stuckAgeLabel = self._formatAgeShort(self._tradeAgeSec(t));
                    var canArchive = ['cancelado', 'completado', 'disputado'].indexOf(t.internal_status) !== -1 && !parseInt(t.archived);
                    if (t.internal_status === 'activo') {
                        statusLabel = parseInt(t.is_seller) ? '⏳ Esperando fiat del comprador' : '⚡ Activa — envía el fiat';
                    }
                    if (isStuckRelease) {
                        statusLabel = '⚠️ Liberación atascada';
                    }
                    var shortId = (t.order_id||'').replace(/^tmp-[^-]+-/,'').slice(0,8);
                    return '<div class="mostro-trade-card" data-id="' + _escHtml(t.order_id) + '">' +
                        '<div class="mostro-trade-top">' +
                            '<span class="mostro-trade-role ' + (t.trade_role==='created'?'role-created':'role-taken') + '">' + _escHtml(roleLabel) + '</span>' +
                            '<span class="mostro-trade-side ' + (parseInt(t.is_seller)?'side-sell':'side-buy') + '">' + _escHtml(sideLabel) + '</span>' +
                            '<span class="mostro-trade-id" title="' + _escHtml(t.order_id||'') + '">#' + _escHtml(shortId) + '</span>' +
                        '</div>' +
                        '<div class="mostro-trade-mid">' +
                            '<span class="mostro-trade-amount">' + _escHtml(String(t.fiat_amount)) + ' ' + _escHtml(t.fiat_code) + '</span>' +
                            '<span class="mostro-trade-pm">' + _escHtml(t.payment_method) + '</span>' +
                        '</div>' +
                        (isStuckRelease
                            ? '<div class="mostro-trade-mid">' +
                                '<span class="mostro-trade-status">⚠️ Sigue en liberando desde hace ' + _escHtml(stuckAgeLabel) + '. Reabre el trade para volver a intentar el release.</span>' +
                              '</div>'
                            : '') +
                        '<div class="mostro-trade-foot">' +
                            '<span class="mostro-trade-status">' + _escHtml(statusLabel) + '</span>' +
                            (t.internal_status === 'tomado' && !parseInt(t.is_seller)
                                ? '<button class="btn btn-noxtr btn-sm btn-primary mostro-trade-lnaddr-btn" data-id="' + _escHtml(t.order_id) + '" title="El robot necesita tu dirección Lightning para enviarte los sats">Enviar LN address</button>'
                                : '') +
                            (t.internal_status === 'activo' && !parseInt(t.is_seller)
                                ? '<button class="btn btn-noxtr btn-sm btn-success mostro-trade-fiatsent-btn" data-id="' + _escHtml(t.order_id) + '">Fiat enviado</button>'
                                : '') +
                            (t.internal_status === 'fiat_enviado' && parseInt(t.is_seller) && !t._releaseInFlight
                                ? '<button class="btn btn-noxtr btn-sm btn-success mostro-trade-release-btn" data-id="' + _escHtml(t.order_id) + '">Liberar sats</button>'
                                : '') +
                            (t.internal_status === 'fiat_enviado' && parseInt(t.is_seller) && t._releaseInFlight
                                ? '<span class="mostro-trade-status">🔄 Enviando liberación…</span>'
                                : '') +
                            (self._canRecoverStuckRelease(t)
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-recover-release-btn" data-id="' + _escHtml(t.order_id) + '" title="Vuelve el trade a fiat enviado para poder reintentar la liberación">Recuperar liberación</button>'
                                : '') +
                            (['enviando','tomado','cancelacion_solicitada'].indexOf(t.internal_status) !== -1
                                ? '<button class="btn btn-noxtr btn-sm btn-danger mostro-trade-cancel-btn" data-id="' + _escHtml(t.order_id) + '">Cancelar</button>'
                                : '') +
                            (t.internal_status === 'disputado' && t.trade_action !== 'dispute-initiated-by-peer'
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-canceldispute-btn" data-id="' + _escHtml(t.order_id) + '">Anular disputa</button>'
                                : '') +
                            (t.internal_status === 'disputado' && t.trade_action === 'dispute-initiated-by-peer'
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-canceldispute-btn" data-id="' + _escHtml(t.order_id) + '">Aceptar resolución</button>'
                                : '') +
                            (t.internal_status === 'completado' && !parseInt(t.my_rating)
                                ? '<span class="mostro-rate-stars" data-id="' + _escHtml(t.order_id) + '">' +
                                  [1,2,3,4,5].map(function(n){ return '<span class="mostro-star" data-rate="' + n + '">☆</span>'; }).join('') +
                                  '</span>'
                                : '') +
                            (t.internal_status === 'completado' && parseInt(t.my_rating)
                                ? '<span class="mostro-rated-stars">' + [1,2,3,4,5].map(function(n){ return n <= parseInt(t.my_rating) ? '★' : '☆'; }).join('') + '</span>'
                                : '') +
                            (canArchive
                                ? '<a class="mostro-trade-del" data-id="' + _escHtml(t.order_id) + '" title="Archivar trade">✕</a>'
                                : '') +
                            (t.internal_status !== 'cancelado'
                                ? '<button class="mostro-chat-toggle btn-noxtr" data-id="' + _escHtml(t.order_id) + '" title="Chat">💬</button>'
                                : '') +
                        '</div>' +
                    '</div>' +
                    (t.internal_status !== 'cancelado'
                        ? '<div class="mostro-chat-box" data-id="' + _escHtml(t.order_id) + '">' +
                            '<div class="mostro-chat-msgs"></div>' +
                            '<div class="mostro-chat-input-row">' +
                              '<input type="text" class="mostro-chat-input" placeholder="Escribe un mensaje…" data-id="' + _escHtml(t.order_id) + '">' +
                              '<button class="btn btn-noxtr btn-sm mostro-chat-send" data-id="' + _escHtml(t.order_id) + '">Enviar</button>' +
                            '</div>' +
                          '</div>'
                        : '');
                }).join('') +
            '</div>';

            el.querySelectorAll('.mostro-trade-lnaddr-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var trade = self._trades[btn.dataset.id];
                    if (!trade) return;
                    self._showTradeAction('add-invoice', { payment_request: [null, null, null] }, trade);
                };
            });

            el.querySelectorAll('.mostro-trade-fiatsent-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm('¿Confirmas que has enviado el pago en fiat?')) return;
                    var fiatPayload = (!parseInt(trade.is_seller) && trade.trade_role === 'created')
                        ? await self._prepareChildOrderIfNeeded(trade, 'fiat-sent')
                        : null;
                    await self._sendToRobot('fiat-sent', fiatPayload, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'fiat_enviado', status: 'fiat-sent' } });
                    trade.internal_status = 'fiat_enviado'; self.renderMyTrades();
                    notify('Confirmación enviada al robot. Esperando que el vendedor libere los sats.', 'info', 5000);
                };
            });

            el.querySelectorAll('.mostro-trade-release-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade || trade._releaseInFlight) return;
                    if (!await confirm('¿Liberar los sats al comprador?')) return;
                    _mostroDebug('[Mostro][UI] release click', _mostroTradeSnapshot(trade));
                    trade._releaseInFlight = true;
                    self.renderMyTrades();
                    try {
                        trade._fiatSentReceived = false;
                        // Skip if robot already released (success arrived first via race condition)
                        if (trade.internal_status !== 'completado') {
                            var releasePayload = (parseInt(trade.is_seller) && trade.trade_role === 'created')
                                ? await self._prepareChildOrderIfNeeded(trade, 'release')
                                : null;
                            _mostroDebug('[Mostro][UI] release payload ready', {
                                order_id: oid,
                                trade_index: self._tradeIndexOrDefault(trade, 1),
                                payload: releasePayload,
                                trade: _mostroTradeSnapshot(trade)
                            });
                            await self._sendToRobot('release', releasePayload, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                            var releaseUpdateRes = await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'liberando', status: 'release' } });
                            _mostroDebug('[Mostro][UI] release local update', {
                                order_id: oid,
                                ajax_result: releaseUpdateRes || null
                            });
                            trade.internal_status = 'liberando';
                        }
                    } catch (e) {
                        console.error('[Mostro] Error enviando release:', e);
                        _mostroDebugWarn('[Mostro][UI] release failed', {
                            order_id: oid,
                            error: e && e.message ? e.message : String(e),
                            trade: _mostroTradeSnapshot(trade)
                        });
                        delete trade._releaseInFlight;
                        self.renderMyTrades();
                        notify('No se pudo enviar la liberación al robot. Revisa la conexión o vuelve a intentarlo.', 'error', 5000);
                        return;
                    }
                    delete trade._releaseInFlight;
                    self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-trade-recover-release-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade || !self._canRecoverStuckRelease(trade)) return;
                    if (!await confirm('Esto no marca el trade como completado ni mueve sats. Sólo lo devuelve a "fiat enviado" para que puedas reintentar la liberación. ¿Continuar?')) return;
                    var recoverRes = await self._ajax('mostro_trade_update', {
                        order_id: oid,
                        fields: {
                            internal_status: 'fiat_enviado',
                            status: 'fiat-sent',
                            trade_action: 'fiat-sent'
                        }
                    });
                    _mostroDebug('[Mostro][UI] release recovery local update', {
                        order_id: oid,
                        ajax_result: recoverRes || null,
                        trade: _mostroTradeSnapshot(trade)
                    });
                    delete trade._releaseInFlight;
                    trade._fiatSentReceived = true;
                    trade.internal_status = 'fiat_enviado';
                    trade.status = 'fiat-sent';
                    trade.trade_action = 'fiat-sent';
                    trade.updated_at = Math.floor(Date.now() / 1000);
                    self.renderMyTrades();
                    notify('Trade reabierto en "Fiat enviado". Ya puedes pulsar "Liberar sats" otra vez.', 'warning', 7000);
                };
            });

            el.querySelectorAll('.mostro-trade-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm('¿Cancelar este trade?')) return;
                    await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'cancelando' } });
                    trade.internal_status = 'cancelando'; self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-trade-canceldispute-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm('¿Anular la disputa y volver al estado activo?')) return;
                    await self._sendToRobot('cancel-dispute', null, trade.robot_pubkey, trade.trade_privkey, oid, trade.trade_index || 1);
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'activo', status: 'cancel-dispute' } });
                    trade.internal_status = 'activo'; self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-rate-stars').forEach(function(container) {
                var oid = container.dataset.id;
                var trade = self._trades[oid];
                if (!trade) return;
                var stars = container.querySelectorAll('.mostro-star');
                stars.forEach(function(star) {
                    star.onmouseover = function() {
                        var n = parseInt(star.dataset.rate);
                        stars.forEach(function(s) { s.textContent = parseInt(s.dataset.rate) <= n ? '★' : '☆'; });
                    };
                    star.onmouseout = function() {
                        stars.forEach(function(s) { s.textContent = '☆'; });
                    };
                    star.onclick = async function() {
                        var rating = parseInt(star.dataset.rate);
                        stars.forEach(function(s) { s.textContent = parseInt(s.dataset.rate) <= rating ? '★' : '☆'; s.style.pointerEvents = 'none'; });
                        await self._sendToRobot('rate', { rating_user: rating }, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                        await self._ajax('mostro_trade_update', { order_id: oid, fields: { my_rating: rating } });
                        trade.my_rating = rating; self.renderMyTrades();
                        notify('¡Valoración enviada!', 'success', 3000);
                    };
                });
            });

            el.querySelectorAll('.mostro-trade-del').forEach(function(btn) {
                btn.onclick = async function() {
                    if (!await confirm('¿Archivar este trade? Seguirá en la tabla, pero dejará de verse aquí.')) return;
                    var oid = btn.dataset.id;
                    var res = await self._ajax('mostro_trade_update', { order_id: oid, fields: { archived: 1 } });
                    if (!res || !res.ok) {
                        notify('No se pudo archivar el trade.', 'error', 3000);
                        return;
                    }
                    if (self._trades[oid]) self._trades[oid].archived = 1;
                    self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-chat-toggle').forEach(function(btn) {
                btn.onclick = function() {
                    var box = el.querySelector('.mostro-chat-box[data-id="' + btn.dataset.id + '"]');
                    if (!box) return;
                    box.classList.toggle('mostro-chat-open');
                };
            });

            el.querySelectorAll('.mostro-chat-send').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    var input = el.querySelector('.mostro-chat-input[data-id="' + oid + '"]');
                    if (!input) return;
                    var text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    await self._sendChatMsg(trade, text);
                };
            });

            el.querySelectorAll('.mostro-chat-input').forEach(function(input) {
                input.onkeydown = async function(e) {
                    if (e.key !== 'Enter') return;
                    var oid = input.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    var text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    await self._sendChatMsg(trade, text);
                };
            });
        },

        // Create order: wquery dialog → save DB → send to robot
        createOrder: function(robotPubkey) {
            if (!Noxtr.Events.pubkey) { alert('Debes iniciar sesión para crear una oferta.'); return; }
            if (!robotPubkey) {
                var comms = MostroCommunities._list.filter(function(c) { return c.active; });
                robotPubkey = comms.length ? comms[0].hex : '';
            }
            if (!robotPubkey) { alert('Activa primero un robot Mostro para publicar la oferta.'); return; }

            var self = this;
            var html =
                '<div class="mo-form">' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">Tipo</span>' +
                        '<div class="mo-radios">' +
                            '<label><input type="radio" name="mo-kind" value="sell" checked> <span class="mo-badge-sell">VENTA</span> <small>vendo BTC</small></label>' +
                            '<label><input type="radio" name="mo-kind" value="buy"> <span class="mo-badge-buy">COMPRA</span> <small>compro BTC</small></label>' +
                        '</div>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">Moneda</span>' +
                        '<select id="mo-fiat-code" class="mo-input mo-input-sm">' +
                            '<option value="EUR">🇪🇺 EUR</option>' +
                            '<option value="USD">🇺🇸 USD</option>' +
                            '<option value="GBP">🇬🇧 GBP</option>' +
                            '<option value="ARS">🇦🇷 ARS</option>' +
                            '<option value="COP">🇨🇴 COP</option>' +
                            '<option value="MXN">🇲🇽 MXN</option>' +
                            '<option value="VES">🇻🇪 VES</option>' +
                            '<option value="BRL">🇧🇷 BRL</option>' +
                            '<option value="CLP">🇨🇱 CLP</option>' +
                            '<option value="PEN">🇵🇪 PEN</option>' +
                            '<option value="CRC">🇨🇷 CRC</option>' +
                            '<option value="GTQ">🇬🇹 GTQ</option>' +
                            '<option value="HNL">🇭🇳 HNL</option>' +
                            '<option value="BOB">🇧🇴 BOB</option>' +
                            '<option value="NGN">🇳🇬 NGN</option>' +
                            '<option value="TRY">🇹🇷 TRY</option>' +
                            '<option value="CAD">🇨🇦 CAD</option>' +
                            '<option value="CHF">🇨🇭 CHF</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="mo-row mo-row-amount">' +
                        '<span class="mo-label">Importe</span>' +
                        '<div class="mo-amount-group">' +
                            '<input id="mo-fiat-min" type="number" min="1" placeholder="importe" class="mo-input mo-input-sm">' +
                            '<span class="mo-sep"> a </span>' +
                            '<input id="mo-fiat-max" type="number" min="1" placeholder="Importe máximo" class="mo-input mo-input-sm">' +
                        '</div>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">Método de pago</span>' +
                        '<input id="mo-pm" type="text" maxlength="100" placeholder="Bizum, Revolut, Transferencia…" class="mo-input mo-input-lg">' +
                    '</div>' +
                    '<div class="mo-row" id="mo-lnaddr-row" style="display:none">' +
                        '<span class="mo-label">Lightning address</span>' +
                        '<input id="mo-lnaddr" type="text" maxlength="120" placeholder="tu@wallet.com" class="mo-input mo-input-lg">' +
                        '<small class="mo-hint">Opcional — el robot te pagará directo</small>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">Prima (%)</span>' +
                        '<div class="mo-premium-wrap">' +
                            '<input id="mo-premium" type="range" min="-10" max="10" step="1" value="0" class="mo-range">' +
                            '<span id="mo-premium-label" class="mo-premium-val">0%</span>' +
                        '</div>' +
                        '<small class="mo-hint">negativo = descuento</small>' +
                    '</div>' +
                '</div>';

            $('body').dialog({
                title: '₿ Crear oferta Mostro',
                type: 'html',
                width: '440px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: html,
                buttons: [
                    {
                        text: 'Cancelar',
                        class: 'btn',
                        action: function(_e, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: 'Publicar oferta',
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var kind = overlay.querySelector('input[name="mo-kind"]:checked').value;
                            var fiatCode = (document.getElementById('mo-fiat-code').value || '').trim();
                            var fiatMin = (document.getElementById('mo-fiat-min').value || '').trim();
                            var fiatMax = (document.getElementById('mo-fiat-max').value || '').trim();
                            var pm = (document.getElementById('mo-pm').value || '').trim();
                            var lnAddr = (document.getElementById('mo-lnaddr').value || '').trim();
                            var premium = document.getElementById('mo-premium').value || '0';

                            if (!fiatCode) { alert('Indica la moneda fiat.'); return; }
                            if (!pm) { alert('Indica el método de pago.'); return; }
                            if (!fiatMin) { alert('Indica el importe.'); return; }

                            var minInt = self._parsePositiveInteger(fiatMin);
                            var maxInt = fiatMax ? self._parsePositiveInteger(fiatMax) : null;
                            var isRange = maxInt !== null;
                            if (minInt === null) {
                                alert('El importe debe ser un número entero mayor o igual que 1.');
                                return;
                            }
                            if (fiatMax && maxInt === null) {
                                alert('El importe máximo debe ser un número entero mayor o igual que 1.');
                                return;
                            }
                            if (isRange && maxInt <= minInt) {
                                alert('El importe máximo debe ser mayor que el mínimo.');
                                return;
                            }
                            var fiatVal = isRange ? (String(minInt) + '-' + String(maxInt)) : String(minInt);
                            var isSeller = kind === 'sell' ? 1 : 0;

                            var orderPayload = { order: {
                                kind: kind, status: 'pending', amount: 0,
                                fiat_code: fiatCode,
                                fiat_amount: isRange ? 0 : minInt,
                                min_amount: isRange ? minInt : null,
                                max_amount: isRange ? maxInt : null,
                                payment_method: pm,
                                premium: parseFloat(premium),
                                created_at: 0,
                            }};
                            if (lnAddr && kind === 'buy') orderPayload.order.buyer_invoice = lnAddr;

                            var kp = _generateKeypair();
                            var tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

                            var submitBtn = event.target; submitBtn.disabled = true; submitBtn.textContent = 'Publicando…';

                            var res = await self._ajax('mostro_trade_add', {
                                order_id: tempId, robot_pubkey: robotPubkey,
                                trade_kind: kind, trade_role: 'created', is_seller: isSeller,
                                fiat_amount: fiatVal, fiat_code: fiatCode, sat_amount: 0,
                                payment_method: pm, trade_privkey: kp.priv, trade_key_pub: kp.pub,
                                trade_index: 1, internal_status: 'enviando',
                            });
                            if (!res.ok) { alert('Error al guardar: ' + (res.msg || '')); submitBtn.disabled = false; submitBtn.textContent = 'Publicar oferta'; return; }

                            self._trades[tempId] = { order_id: tempId, robot_pubkey: robotPubkey,
                                trade_kind: kind, trade_role: 'created', is_seller: isSeller,
                                fiat_amount: fiatVal, fiat_code: fiatCode, sat_amount: 0,
                                payment_method: pm, trade_key_pub: kp.pub, trade_privkey: kp.priv,
                                trade_index: 1, _rangeOrder: isRange,
                                internal_status: 'enviando', updated_at: Math.floor(Date.now()/1000) };
                            self.subscribeMyTrades();
                            self.renderMyTrades();
                            document.body.removeChild(overlay);

                            try {
                                await self._sendToRobot('new-order', orderPayload, robotPubkey, kp.priv, null, 1);
                            } catch(e) { console.error('[Mostro] Error enviando new-order:', e); }
                        }
                    }
                ]
            });

            // Handlers post-render: LN address visibility + range prima
            setTimeout(function() {
                document.querySelectorAll('input[name="mo-kind"]').forEach(function(r) {
                    r.onchange = function() {
                        var row = document.getElementById('mo-lnaddr-row');
                        if (row) row.style.display = r.value === 'buy' ? '' : 'none';
                    };
                });
                var range = document.getElementById('mo-premium');
                var lbl = document.getElementById('mo-premium-label');
                if (range && lbl) {
                    range.oninput = function() {
                        var v = parseFloat(range.value);
                        lbl.textContent = (v > 0 ? '+' : '') + v + '%';
                        lbl.className = 'mo-premium-val' + (v > 0 ? ' mo-prem-pos' : v < 0 ? ' mo-prem-neg' : '');
                    };
                }
            }, 50);
        },

        // Take an order from the order book
        takeOrder: async function(order) {
            if (!Noxtr.Events.pubkey) { alert('Debes iniciar sesión para tomar una oferta.'); return; }
            // isSell order → we are buyer → action = take-sell-order, is_seller = 0
            // isBuy order  → we are seller → action = take-buy-order, is_seller = 1
            var isSell = order.orderType === 'sell';
            var action = isSell ? 'take-sell' : 'take-buy';
            var isSeller = isSell ? 0 : 1;
            var sideMsg = isSell ? 'Comprar BTC' : 'Vender BTC';
            var chosenRangeFiat = null;
            var pendingInvoiceInput = '';
            if (isSell) {
                var takeSellInputs = await this._collectTakeSellInputs(order);
                if (!takeSellInputs) return;
                chosenRangeFiat = order.isRange ? takeSellInputs.amount : null;
                pendingInvoiceInput = (takeSellInputs.invoiceInput || '').trim();
            } else {
                if (order.isRange) {
                    chosenRangeFiat = await MostroBook._pickRangeFiatAmount(order);
                    if (chosenRangeFiat === null) return;
                }
                var fiatLabel = order.isRange
                    ? MostroBook._formatFiatValue(chosenRangeFiat) + ' ' + order.fiatCode
                    : MostroBook._formatOrderFiatLabel(order);
                var ok = await Promise.resolve(confirm('¿' + sideMsg + '?\n\n' + fiatLabel + ' · ' + order.paymentMethod));
                if (!ok) return;
            }

            // Remove any terminal trade in memory for this order_id (allows re-take after cancel)
            var _termSt = { 'cancelado': true, 'completado': true, 'disputado': true };
            if (this._trades[order.id] && _termSt[this._trades[order.id].internal_status]) {
                delete this._trades[order.id];
            }

            var kp = _generateKeypair();
            var takePayload = order.isRange ? { amount: chosenRangeFiat } : null;
            var localFiatAmount = order.isRange ? MostroBook._formatFiatValue(chosenRangeFiat) : String(order.fiatAmount);

            var res = await this._ajax('mostro_trade_add', {
                order_id: order.id, robot_pubkey: order.robotPubkey,
                trade_kind: order.orderType, trade_role: 'taken', is_seller: isSeller,
                fiat_amount: localFiatAmount, fiat_code: order.fiatCode,
                sat_amount: order.satAmount || 0, payment_method: order.paymentMethod,
                trade_privkey: kp.priv, trade_key_pub: kp.pub, trade_index: 1, internal_status: 'enviando',
            });
            if (!res.ok) { alert('Error al guardar: ' + (res.msg || '')); return; }

            var trade = { order_id: order.id, robot_pubkey: order.robotPubkey, trade_kind: order.orderType,
                trade_role: 'taken', is_seller: isSeller, fiat_amount: localFiatAmount,
                fiat_code: order.fiatCode, sat_amount: order.satAmount || 0, payment_method: order.paymentMethod,
                trade_key_pub: kp.pub, trade_privkey: kp.priv, trade_index: 1, internal_status: 'enviando',
                _rangeOrder: !!order.isRange, _rangeFiatAmount: chosenRangeFiat, _pendingInvoiceInput: pendingInvoiceInput,
                updated_at: Math.floor(Date.now()/1000) };
            this._trades[order.id] = trade;
            this.subscribeMyTrades();
            this.renderMyTrades();

            try {
                await this._sendToRobot(action, takePayload, order.robotPubkey, kp.priv, order.id, 1);
            } catch(e) {
                console.error('[Mostro] Error enviando ' + action + ':', e);
            }
        },
    };

    // ==================== ROBOTS MOSTRO (Communities) ====================

    var MostroCommunities = {
        _LS_KEY: 'noxtr_mostro_communities',
        _list: null, // [{ name, hex, active }]

        _DEFAULTS: [
            { name: 'NostroMostro 🇪🇸',     npub: 'npub1qqqvcqssrmpfa65uuc3jtp6jh8ta5ekz0pz76f5ydhgtplrnddqqrqe7xr', active: true },
            { name: 'MostroColomBia 🇨🇴',   npub: 'npub1qqqqj79vck2v2p5hd3j4km0vhuk54ujllk4xdq8j49tgkz5ggsdsvgn7vr', active: true },
            { name: 'Kmbalache 🇨🇺',        hex:  '00000235a3e904cfe1213a8a54d6f1ec1bef7cc6bfaabd6193e82931ccf1366a', active: true },
            { name: 'Mostro ₿oliviano 🇧🇴',  npub: 'npub1qqq8evest7uh9awvs0ur4rau58nyay7f6ymf3q9fl43wl9wj87gsrk6xv3', active: true },
        ],

        load: function () {
            try {
                var saved = JSON.parse(localStorage.getItem(this._LS_KEY) || 'null');
                if (Array.isArray(saved)) { this._list = saved; return; }
                // Primera vez: decodificar defaults y guardar
                this._list = this._DEFAULTS.map(function (c) {
                    var hex = c.hex || null;
                    if (!hex && c.npub) { try { hex = Noxtr.npubDecode(c.npub); } catch (e) {} }
                    return { name: c.name, hex: hex, active: c.active };
                }).filter(function (c) { return c.hex; });
                this._save();
            } catch (e) { this._list = []; }
        },

        _save: function () {
            try { localStorage.setItem(this._LS_KEY, JSON.stringify(this._list)); } catch (e) {}
        },

        // Devuelve array de hex de robots activos, o null si todos están inactivos
        activeHexList: function () {
            if (!this._list) this.load();
            var active = this._list.filter(function (c) { return c.active && c.hex; });
            return active.length ? active.map(function (c) { return c.hex; }) : null;
        },

        render: function () {
            var el = document.getElementById('mostro-communities');
            if (!el) return;
            if (!this._list) this.load();
            var self = this;

            // Solicitar perfiles para avatares
            this._list.forEach(function (c) { if (c.hex) Noxtr.Profiles.request(c.hex); });

            var itemsHtml = this._list.map(function (c, i) {
                var avatarUrl = c.hex ? Noxtr.Profiles.avatar(c.hex) : null;
                var name = c.name || (c.hex ? Noxtr.Profiles.displayName(c.hex) : '?');
                var avatarHtml = avatarUrl
                    ? '<img class="mostro-comm-avatar" src="' + _escHtml(avatarUrl) + '" alt="">'
                    : '<span class="mostro-comm-avatar mostro-comm-avatar-ph">' + _escHtml(name.charAt(0).toUpperCase()) + '</span>';
                return '<span class="mostro-comm-item' + (c.active ? ' mostro-comm-active' : '') + '" data-idx="' + i + '">' +
                    avatarHtml +
                    '<span class="mostro-comm-name">' + _escHtml(name) + '</span>' +
                    '<a class="mostro-comm-rm" data-idx="' + i + '" title="Eliminar">×</a>' +
                '</span>';
            }).join('');

            var addHtml = '<a class="mostro-comm-toggle" title="Añadir robot">⚙</a>' +
                '<span class="mostro-comm-add-wrap" style="display:none">' +
                '<input type="text" id="mostro-comm-name-in" class="mostro-comm-input" placeholder="Nombre" maxlength="30" style="width:80px">' +
                '<input type="text" id="mostro-comm-npub-in" class="mostro-comm-input" placeholder="npub1…" maxlength="120" style="width:160px">' +
                '<a id="btn-mostro-add-comm" class="btn btn-noxtr btn-sm">Añadir</a>' +
                '</span>';

            el.innerHTML = '<div class="mostro-comm-bar">' + itemsHtml + addHtml + '</div>';

            // Toggle formulario de añadir
            var toggleBtn = el.querySelector('.mostro-comm-toggle');
            var addWrap = el.querySelector('.mostro-comm-add-wrap');
            if (toggleBtn) toggleBtn.onclick = function () {
                var hidden = addWrap.style.display === 'none';
                addWrap.style.display = hidden ? '' : 'none';
                toggleBtn.classList.toggle('mostro-comm-toggle-active', hidden);
            };

            // Toggle activo/inactivo al hacer click en el chip
            el.querySelectorAll('.mostro-comm-item').forEach(function (item) {
                item.onclick = function (e) {
                    if (e.target.classList.contains('mostro-comm-rm')) return;
                    var idx = parseInt(item.dataset.idx);
                    self._list[idx].active = !self._list[idx].active;
                    self._save();
                    self._reloadWithFilter();
                };
            });

            // Eliminar robot
            el.querySelectorAll('.mostro-comm-rm').forEach(function (btn) {
                btn.onclick = function (e) {
                    e.stopPropagation();
                    self._list.splice(parseInt(btn.dataset.idx), 1);
                    self._save();
                    self._reloadWithFilter();
                };
            });

            // Añadir robot
            var nameIn = document.getElementById('mostro-comm-name-in');
            var npubIn = document.getElementById('mostro-comm-npub-in');
            var addBtn = document.getElementById('btn-mostro-add-comm');
            var doAdd = function () {
                var npubVal = npubIn ? npubIn.value.trim() : '';
                if (!npubVal) return;
                var hex = null;
                if (npubVal.indexOf('npub') === 0) { try { hex = Noxtr.npubDecode(npubVal); } catch (e) {} }
                else if (/^[0-9a-f]{64}$/i.test(npubVal)) hex = npubVal.toLowerCase();
                if (!hex) return;
                var name = (nameIn ? nameIn.value.trim() : '') || npubVal.slice(0, 10) + '…';
                self._list.push({ name: name, hex: hex, active: false });
                self._save();
                if (nameIn) nameIn.value = '';
                if (npubIn) npubIn.value = '';
                Noxtr.Profiles.request(hex);
                self.render();
            };
            if (addBtn) addBtn.onclick = doAdd;
            if (npubIn) npubIn.onkeydown = function (e) { if (e.key === 'Enter') doAdd(); };
        }
    };

    // ==================== ORDER BOOK ====================

    var MostroBook = {
        orders: {},
        _closedOrders: {},
        _subId: null,
        _oldestAt: null,
        _eoseReached: false,
        _newRecentCount: 0,
        _latestAtEose: 0,
        _freshIds: null,
        _visibleCount: 10,
        _loadingMore: false,
        _pmChips: null,
        _showLnp2pbot: null,
        _showBuy: null,
        _showSell: null,
        _PM_LS_KEY:  'noxtr_mostro_pm_chips',
        _LNP_LS_KEY: 'noxtr_mostro_lnp2pbot',
        _SIDE_LS_KEY: 'noxtr_mostro_side',
        _PM_DEFAULTS: ['Bizum','SEPA','Transferencia','Revolut','N26','Halcash','BBVA','PayPal','Wise','Efectivo','MercadoPago','Zelle','Strike'],

        // ---- persistencia ----
        _loadPmChips: function() {
            try {
                var raw = localStorage.getItem(this._PM_LS_KEY);
                if (raw) { this._pmChips = JSON.parse(raw); return; }
            } catch(e) {}
            this._pmChips = this._PM_DEFAULTS.map(function(l) { return { label: l, active: false }; });
        },
        _savePmChips: function() {
            try { localStorage.setItem(this._PM_LS_KEY, JSON.stringify(this._pmChips)); } catch(e) {}
        },
        _loadLnp2pbot: function() {
            this._showLnp2pbot = localStorage.getItem(this._LNP_LS_KEY) === '1';
        },
        _saveLnp2pbot: function() {
            try { localStorage.setItem(this._LNP_LS_KEY, this._showLnp2pbot ? '1' : '0'); } catch(e) {}
        },
        _loadSide: function() {
            try {
                var s = JSON.parse(localStorage.getItem(this._SIDE_LS_KEY) || '{}');
                this._showBuy  = s.buy  !== false;
                this._showSell = s.sell !== false;
            } catch(e) { this._showBuy = true; this._showSell = true; }
        },
        _saveSide: function() {
            try { localStorage.setItem(this._SIDE_LS_KEY, JSON.stringify({ buy: this._showBuy, sell: this._showSell })); } catch(e) {}
        },
        _formatFiatValue: function(value) {
            var n = parseFloat(value);
            if (!isFinite(n)) return String(value || '?');
            return Math.floor(n) === n ? String(n) : String(n).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
        },
        _formatOrderFiatLabel: function(order) {
            if (order && order.isRange && isFinite(order.fiatMin) && isFinite(order.fiatMax)) {
                return this._formatFiatValue(order.fiatMin) + ' - ' + this._formatFiatValue(order.fiatMax) + ' ' + (order.fiatCode || '');
            }
            return String(order && order.fiatAmount || '?') + ' ' + (order && order.fiatCode || '');
        },
        _pickRangeFiatAmount: async function(order) {
            var min = parseFloat(order && order.fiatMin);
            var max = parseFloat(order && order.fiatMax);
            if (!isFinite(min) || !isFinite(max)) return null;
            while (true) {
                var raw = await prompt(
                    'La oferta es con rango.\n\nElige un importe entre ' +
                    this._formatFiatValue(min) + ' y ' + this._formatFiatValue(max) + ' ' + (order.fiatCode || '') + '.',
                    this._formatFiatValue(min)
                );
                if (raw === null) return null;
                var chosen = parseFloat(String(raw).replace(',', '.').trim());
                if (!isFinite(chosen) || chosen < min || chosen > max) {
                    alert('El importe debe estar entre ' + this._formatFiatValue(min) + ' y ' + this._formatFiatValue(max) + ' ' + (order.fiatCode || '') + '.');
                    continue;
                }
                return chosen;
            }
        },

        // ---- suscripción ----
        subscribe: function() {
            var self = this;
            if (this._subId) Noxtr.Pool.unsubscribe(this._subId);
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            var yFilter = this._showLnp2pbot ? ['mostro', 'lnp2pbot'] : ['mostro'];
            var since48h = Math.floor(Date.now() / 1000) - 48 * 3600;
            var filter = { kinds: [38383], '#s': ['pending'], '#y': yFilter, limit: 100, since: since48h };
            var authors = MostroCommunities.activeHexList();
            if (authors) filter.authors = authors;
            // Segundo filtro: cambios de estado en tiempo real (cancels, taken, etc.) sin filtrar por #s
            var liveFilter = { kinds: [38383], since: this._latestAtEose };
            if (authors) liveFilter.authors = authors;
            this._oldestAt = null;
            this._eoseReached = false;
            this._newRecentCount = 0;
            this._freshIds = null;
            this._visibleCount = 10;
            this._closedOrders = {};
            this._latestAtEose = Math.floor(Date.now() / 1000);
            this._subId = Noxtr.Pool.subscribe(
                [filter, liveFilter],
                function(ev) {
                    self._handleEvent(ev);
                    if (self._oldestAt === null || ev.created_at < self._oldestAt) self._oldestAt = ev.created_at;
                },
                function() {
                    self._eoseReached = true;
                    var pendingIds = Object.keys(self.orders);
                    if (pendingIds.length) {
                        var vid = Noxtr.Pool.subscribe(
                            [{ kinds: [38383], '#d': pendingIds, limit: pendingIds.length + 10 }],
                            function(ev) { self._handleEvent(ev); },
                            function() { Noxtr.Pool.unsubscribe(vid); self.render(); }
                        );
                    } else {
                        self.render();
                    }
                }
            );
        },

        resubscribe: function() {
            this.orders = {};
            this._closedOrders = {};
            if (this._subId) { Noxtr.Pool.unsubscribe(this._subId); this._subId = null; }
            this.subscribe();
            this.render();
        },

        loadMore: function() {
            if (this._loadingMore || !this._oldestAt) return;
            this._loadingMore = true;
            var self = this;
            var countBefore = Object.keys(this.orders).length;
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            var yFilter = this._showLnp2pbot ? ['mostro', 'lnp2pbot'] : ['mostro'];
            var filter = { kinds: [38383], '#s': ['pending'], '#y': yFilter, limit: 100, until: this._oldestAt - 1 };
            var sid = Noxtr.Pool.subscribe(
                [filter],
                function(ev) { self._handleEvent(ev); if (ev.created_at < self._oldestAt) self._oldestAt = ev.created_at; },
                function() {
                    Noxtr.Pool.unsubscribe(sid);
                    self._loadingMore = false;
                    if (Object.keys(self.orders).length === countBefore) {
                        var btn = document.getElementById('mostro-load-more');
                        if (btn) btn.style.display = 'none';
                    } else {
                        self.render();
                    }
                }
            );
        },

        // ---- parseo de eventos ----
        _handleEvent: function(ev) {
            var t = {}, pm = [];
            (ev.tags || []).forEach(function(tag) {
                if (!tag[0]) return;
                if (tag[0] === 'pm') pm = pm.concat(tag.slice(1));
                else t[tag[0]] = tag[1];
            });
            t.pm = pm.length ? pm.join(', ') : null;
            var faTag = (ev.tags || []).find(function(tag) { return tag[0] === 'fa'; });
            if (faTag && faTag[2]) t.fa = faTag[1] + ' — ' + faTag[2];
            else if (faTag) t.fa = faTag[1];

            var id = t.d || t.name;
            if (!id || (t.k !== 'sell' && t.k !== 'buy')) return;
            if (t.y && t.y !== 'mostro' && t.y !== 'lnp2pbot') return;
            var status = (t.s || 'pending').toLowerCase();
            var closedMeta = this._closedOrders[id];

            if (status !== 'pending') {
                if (!closedMeta || closedMeta._created_at < ev.created_at) {
                    this._closedOrders[id] = { _created_at: ev.created_at, status: status };
                }
                var ex = this.orders[id];
                if (ex && ex._created_at < ev.created_at) {
                    delete this.orders[id];
                    if (this._eoseReached) this.render();
                }
                return;
            }
            // Relays can deliver an old `pending` after a newer `in-progress/success/canceled`
            // event for the same order id. Remember the closing status so stale pending events
            // do not resurrect the mother order in the book.
            if (closedMeta && closedMeta._created_at >= ev.created_at) {
                return;
            }
            // If a newer pending arrives after a previously closed status, allow it. This keeps
            // compatibility with protocol evolutions where a remnant order might reuse the id.
            if (closedMeta && closedMeta._created_at < ev.created_at) {
                delete this._closedOrders[id];
            }

            var ratingObj = null;
            try {
                if (t.rating) {
                    var parsed = JSON.parse(t.rating);
                    // El robot serializa como ["rating", {...}] — tomamos el índice 1
                    ratingObj = Array.isArray(parsed) ? parsed[1] : parsed;
                }
            } catch(e) {}

            var isRange = !!(faTag && faTag[2] !== undefined && faTag[2] !== null && faTag[2] !== '');
            var order = {
                id: id, orderType: t.k, daemon: t.y || 'mostro',
                source: t.source || '', fiatCode: t.f || '?',
                fiatAmount: isRange ? String(faTag[1]) + '-' + String(faTag[2]) : (faTag ? String(faTag[1]) : (t.fa || '?')),
                fiatMin: faTag ? parseFloat(faTag[1]) : null,
                fiatMax: faTag && faTag[2] ? parseFloat(faTag[2]) : null,
                isRange: isRange,
                satAmount: parseInt(t.amt) || 0,
                paymentMethod: t.pm || 'cualquiera',
                premium: t.premium || t.p || '0',
                robotPubkey: ev.pubkey, rating: ratingObj,
                status: t.s || 'pending',
                _created_at: ev.created_at,
                _expiration: parseInt(t.expiration) || 0
            };

            // Si expiration está muy lejos de created_at (>2 días) es el TTL del relay (NIP-40),
            // no la ventana real para tomar la orden. En ese caso la ventana real es 24h.
            var ORDER_WINDOW = 86400;
            if (order._expiration && (order._expiration - order._created_at) > ORDER_WINDOW * 2) {
                order._orderExpiry = order._created_at + ORDER_WINDOW;
            } else {
                order._orderExpiry = order._expiration || (order._created_at + ORDER_WINDOW);
            }

            var nowTs = Math.floor(Date.now() / 1000);
            if (order._orderExpiry && order._orderExpiry <= nowTs) return;
            var existing = this.orders[id];
            if (existing && existing._created_at >= ev.created_at) return;

            if (this._eoseReached && !existing && order._created_at > this._latestAtEose) {
                this._newRecentCount++;
                if (!this._freshIds) this._freshIds = {};
                this._freshIds[id] = true;
                this._updateBanner();
            }
            this.orders[id] = order;
        },

        // ---- banner "N nuevas ofertas" ----
        _updateBanner: function(visible, total) {
            if (visible !== undefined) { this._lastVisible = visible; this._lastTotal = total; }
            var el = document.getElementById('mostro-new-banner');
            if (!el) return;
            var self = this, n = this._newRecentCount;
            if (n > 0) {
                el.textContent = n === 1 ? '1 nueva oferta — pulsa para ver' : n + ' nuevas ofertas — pulsa para ver';
                el.style.cursor = 'pointer';
                el.onclick = function() { self._newRecentCount = 0; self.render(); };
            } else {
                el.textContent = this._lastVisible !== undefined ? 'Mostrando ' + this._lastVisible + ' de ' + this._lastTotal + ' disponibles' : '';
                el.style.cursor = '';
                el.onclick = null;
            }
            el.style.display = '';
        },

        // ---- render principal ----
        render: function() {
            var el = document.getElementById('mostro-orders');
            if (!el) return;
            var now = Math.floor(Date.now() / 1000);
            if (!this._pmChips)    this._loadPmChips();
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            if (this._showBuy === null)      this._loadSide();
            var activeChips = this._pmChips.filter(function(c) { return c.active; });
            var showLnp = this._showLnp2pbot, showBuy = this._showBuy, showSell = this._showSell;

            var orders = Object.values(this.orders).filter(function(o) {
                if (o._orderExpiry && o._orderExpiry <= now) return false;
                if (!showLnp && o.daemon === 'lnp2pbot') return false;
                if (o.orderType === 'sell' && !showBuy)  return false;
                if (o.orderType === 'buy'  && !showSell) return false;
                if (activeChips.length) {
                    var pm = (o.paymentMethod || '').toLowerCase();
                    if (!activeChips.some(function(c) { return pm.indexOf(c.label.toLowerCase()) !== -1; })) return false;
                }
                return true;
            });
            orders.sort(function(a, b) { return b._created_at - a._created_at; });
            var total = orders.length;
            orders = orders.slice(0, this._visibleCount);

            this._renderPmFilters();
            this._updateBanner(orders.length, total);
            MostroCommunities.render();

            if (!orders.length) {
                el.innerHTML = '<div class="noxtr-empty">Buscando órdenes en los relays de Mostro…</div>';
                return;
            }

            var self = this;
            el.innerHTML = orders.map(function(o) {
                var isSell = o.orderType === 'sell';
                var isLnp  = o.daemon === 'lnp2pbot';
                var eid    = 'mostro-explain-' + o.id.replace(/[^a-z0-9]/gi, '');
                var premium = parseFloat(o.premium);
                var premiumHtml = premium !== 0
                    ? '<span class="mostro-premium">' + (premium > 0 ? '+' : '') + _escHtml(String(o.premium)) + '%</span>' : '';
                var satsHtml = o.satAmount > 0
                    ? '<span class="mostro-sats">' + o.satAmount.toLocaleString() + ' sats</span>'
                    : '<span class="mostro-sats">precio de mercado</span>';
                var badgeHtml = isSell
                    ? '<span class="mostro-badge mostro-badge-sell">VENTA</span>'
                    : '<span class="mostro-badge mostro-badge-buy">COMPRA</span>';
                if (isLnp) badgeHtml += '<span class="mostro-daemon-badge">lnp2pbot</span>';

                var _ownTrade = MostroTrader._trades[o.id];
                var _ownTerminal = { 'cancelado': true, 'completado': true, 'disputado': true };
                var isOwn = !!_ownTrade && _ownTrade.trade_role === 'created' && !_ownTerminal[_ownTrade.internal_status];
                var btnHtml;
                if (isLnp) {
                    var tgUrl = o.source ? _escHtml(o.source) : 'https://t.me/lnp2pbot';
                    btnHtml = '<a class="btn btn-noxtr btn-tg mostro-tg-btn" href="' + tgUrl + '" target="_blank" rel="noopener">Ver en Telegram</a>';
                } else if (isOwn) {
                    btnHtml = '<button class="btn btn-noxtr btn-danger mostro-cancel-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">Cancelar</button>';
                } else if (isSell) {
                    btnHtml = '<button class="btn btn-noxtr btn-primary mostro-buy-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">Comprar</button>';
                } else {
                    btnHtml = '<button class="btn btn-noxtr btn-success mostro-sell-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">Vender</button>';
                }

                var robotShort = o.robotPubkey ? o.robotPubkey.slice(0, 8) + '…' : '?';
                var orderShort = o.id ? o.id.slice(0, 8) : '?';
                var ageSec = Math.floor(Date.now() / 1000) - o._created_at;
                var ageText = ageSec < 3600 ? Math.floor(ageSec/60)+'m' : ageSec < 86400 ? Math.floor(ageSec/3600)+'h' : Math.floor(ageSec/86400)+'d';

                var expiryHtml = '', gaugeHtml = '';
                if (o._orderExpiry) {
                    var rem = o._orderExpiry - now;
                    if (rem > 0) {
                        var rH = Math.floor(rem/3600), rM = Math.floor((rem%3600)/60), rS = rem%60;
                        var remLabel = rH > 0
                            ? rH + ':' + (rM<10?'0':'')+rM + ':' + (rS<10?'0':'')+rS
                            : (rM<10?'0':'')+rM + ':' + (rS<10?'0':'')+rS;
                        expiryHtml = '<span class="mostro-order-expiry' + (rem < 3600 ? ' mostro-expiry-soon' : '') +
                            '" data-expiry="' + o._orderExpiry + '" data-created="' + o._created_at + '">⌛ ' + remLabel + '</span>';
                        var total = o._orderExpiry - o._created_at;
                        var pct = Math.max(0, Math.min(100, (rem / total) * 100));
                        var barColor = pct > 50 ? '#4caf50' : pct > 20 ? '#f7931a' : '#e53935';
                        gaugeHtml = '<div class="mostro-expiry-gauge"><div class="mostro-expiry-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + barColor + '"></div></div>';
                    }
                }
                var ratingHtml;
                if (o.rating && o.rating.total_reviews > 0) {
                    var avg = o.rating.total_rating; // total_rating ya ES el promedio
                    var stars = '';
                    for (var si = 1; si <= 5; si++) stars += si <= Math.round(avg) ? '★' : '☆';
                    var daysHtml = o.rating.days ? ' <small title="Días activo en Mostro">📅 ' + o.rating.days + 'd</small>' : '';
                    ratingHtml = '<span class="mostro-rating" title="' + avg.toFixed(2) + ' · ' + o.rating.total_reviews + ' trades · ' + (o.rating.days || 0) + ' días activo">' +
                        '<span class="mostro-stars">' + stars + '</span> ' + avg.toFixed(1) +
                        ' <small>(' + o.rating.total_reviews + ')</small>' + daysHtml + '</span>';
                } else {
                    ratingHtml = '<span class="mostro-rating mostro-rating-new" title="Sin valoraciones aún"><span class="mostro-stars">☆☆☆☆☆</span></span>';
                }

                var domId = 'mostro-order-' + o.id.replace(/[^a-z0-9]/gi, '');
                var ownBadge = isOwn ? '<span class="mostro-own-badge">Creada por mí</span>' : '';
                return '<div class="mostro-order ' + (isSell ? 'mostro-order-sell' : 'mostro-order-buy') + (isOwn ? ' mostro-order-own' : '') + '" id="' + domId + '">' +
                    '<div class="mostro-card-body">' +
                        '<span class="mostro-order-id" title="' + _escHtml(o.id || '') + '">#' + _escHtml(orderShort) + '</span>' +
                        '<div class="mostro-card-top">' + badgeHtml + ownBadge +
                            '<span class="mostro-fiat">' + _escHtml(self._formatOrderFiatLabel(o)) + '</span>' +
                            '<span class="mostro-card-sats">' + satsHtml + premiumHtml + '</span>' +
                        '</div>' +
                        '<div class="mostro-card-pm">' + (o.paymentMethod || '').split(', ').map(function(pm) {
                            var slug = pm.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
                            return '<span class="mostro-pm mostro-pm-' + slug + '">' + _escHtml(pm) + '</span>';
                        }).join('') + '</div>' +
                        '<div class="mostro-card-footer">' +
                            '<span class="mostro-order-age">⏱ ' + ageText + '</span>' + expiryHtml +
                            '<span class="mostro-robot-id" title="' + _escHtml(o.robotPubkey) + '">🤖 ' + _escHtml(robotShort) + '</span>' +
                            '<a class="mostro-share-btn" data-id="' + _escHtml(o.id) + '" title="Copiar enlace"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                            ratingHtml +
                        '</div>' +
                        gaugeHtml +
                    '</div>' +
                    '<div class="mostro-card-side">' + btnHtml +
                        '<a class="mostro-tip-toggle" data-eid="' + eid + '">¿Cómo funciona?</a>' +
                    '</div>' +
                '</div>' + self._explainOrder(o, isOwn);
            }).join('');

            // Eventos — tomar orden
            el.querySelectorAll('.mostro-buy-btn, .mostro-sell-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var orderId = btn.dataset.id;
                    var order = self.orders[orderId];
                    if (!order) return;
                    MostroTrader.takeOrder(order);
                };
            });
            el.querySelectorAll('.mostro-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var orderId = btn.dataset.id;
                    var robotPubkey = btn.dataset.robot;
                    var trade = MostroTrader._trades[orderId];
                    if (!trade) return;
                    if (!await confirm('¿Cancelar esta orden?')) return;
                    // Mark as cancelling immediately, wait for robot to confirm
                    await MostroTrader._ajax('mostro_trade_update', { order_id: orderId, fields: { internal_status: 'cancelando' } });
                    trade.internal_status = 'cancelando';
                    MostroTrader.renderMyTrades();
                    await MostroTrader._sendToRobot('cancel', null, robotPubkey, trade.trade_privkey, orderId, trade.trade_index || 1);
                };
            });
            el.querySelectorAll('.mostro-share-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var url = location.origin + '/' + _MODULE_ + '/mostro/' + btn.dataset.id;
                    navigator.clipboard.writeText(url).then(function() {
                        var orig = btn.innerHTML; btn.textContent = '✓';
                        setTimeout(function() { btn.innerHTML = orig; }, 1500);
                    });
                };
            });
            this._bindExplainToggles();
            this._startCountdown();

            // Indicador "nueva orden"
            if (self._freshIds) {
                var fids = self._freshIds; self._freshIds = null;
                Object.keys(fids).forEach(function(fid) {
                    var oel = document.getElementById('mostro-order-' + fid.replace(/[^a-z0-9]/gi, ''));
                    if (oel) oel.classList.add('mostro-order-fresh');
                });
            }

            // Botón "Cargar más"
            var loadMoreEl = document.getElementById('mostro-load-more');
            if (!loadMoreEl) {
                loadMoreEl = document.createElement('div');
                loadMoreEl.id = 'mostro-load-more';
                el.parentNode.insertBefore(loadMoreEl, el.nextSibling);
            }
            if (total > this._visibleCount) {
                var remaining = total - this._visibleCount;
                loadMoreEl.style.display = '';
                loadMoreEl.innerHTML = '<a class="mostro-load-more-btn">Ver 10 más (' + remaining + ' pendientes)</a>';
                loadMoreEl.querySelector('.mostro-load-more-btn').onclick = function() { self._visibleCount += 10; self.render(); };
            } else {
                loadMoreEl.style.display = '';
                loadMoreEl.innerHTML = '<a class="mostro-load-more-btn">Cargar más ofertas…</a>';
                loadMoreEl.querySelector('.mostro-load-more-btn').onclick = function() {
                    loadMoreEl.innerHTML = '<span class="mo-load-more">Cargando…</span>';
                    self.loadMore();
                };
            }
        },

        // ---- countdown timer ----
        _countdownTimer: null,
        _startCountdown: function() {
            if (this._countdownTimer) clearInterval(this._countdownTimer);
            this._countdownTimer = setInterval(function() {
                var now = Math.floor(Date.now() / 1000);
                document.querySelectorAll('.mostro-order-expiry[data-expiry]').forEach(function(el) {
                    var expiry = parseInt(el.dataset.expiry);
                    var created = parseInt(el.dataset.created);
                    var rem = expiry - now;
                    if (rem <= 0) {
                        el.textContent = '⌛ Expirada';
                        el.classList.add('mostro-expiry-soon');
                        var cb = el.closest('.mostro-card-body');
                        if (cb) { var f = cb.querySelector('.mostro-expiry-bar-fill'); if (f) f.style.width = '0%'; }
                        return;
                    }
                    var rH = Math.floor(rem/3600), rM = Math.floor((rem%3600)/60), rS = rem%60;
                    el.textContent = '⌛ ' + (rH > 0
                        ? rH+':'+(rM<10?'0':'')+rM+':'+(rS<10?'0':'')+rS
                        : (rM<10?'0':'')+rM+':'+(rS<10?'0':'')+rS);
                    if (rem < 3600) el.classList.add('mostro-expiry-soon'); else el.classList.remove('mostro-expiry-soon');
                    var cb = el.closest('.mostro-card-body');
                    if (cb) {
                        var f = cb.querySelector('.mostro-expiry-bar-fill');
                        if (f) {
                            var total = expiry - created;
                            var pct = Math.max(0, Math.min(100, (rem / total) * 100));
                            f.style.width = pct.toFixed(1) + '%';
                            f.style.background = pct > 50 ? '#4caf50' : pct > 20 ? '#f7931a' : '#e53935';
                        }
                    }
                });
            }, 1000);
        },
        _stopCountdown: function() {
            if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
        },

        // ---- filtros de método de pago ----
        _renderPmFilters: function() {
            var el = document.getElementById('mostro-pm-filters');
            if (!el) return;
            if (!this._pmChips)          this._loadPmChips();
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            if (this._showBuy === null)      this._loadSide();
            var self = this;
            var noneActive = !this._pmChips.some(function(c) { return c.active; });
            el.innerHTML = '<div class="mostro-pm-chips">' +
                '<span class="mostro-pm-chip mostro-side-chip' + (self._showBuy  ? ' mostro-pm-active' : '') + '" id="mostro-side-buy">Comprar</span>' +
                '<span class="mostro-pm-chip mostro-side-chip' + (self._showSell ? ' mostro-pm-active' : '') + '" id="mostro-side-sell">Vender</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-pm-all' + (noneActive ? ' mostro-pm-active' : '') + '" id="mostro-pm-all">Todos</span>' +
                this._pmChips.map(function(c, i) {
                    return '<span class="mostro-pm-chip' + (c.active ? ' mostro-pm-active' : '') + '" data-idx="' + i + '">' +
                        _escHtml(c.label) + '<a class="mostro-chip-rm" data-idx="' + i + '">×</a></span>';
                }).join('') +
                '<span class="mostro-chip-add-wrap"><input type="text" id="mostro-pm-add-input" class="mostro-chip-input" placeholder="+ añadir…" maxlength="30"></span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-lnp-chip' + (self._showLnp2pbot ? ' mostro-pm-active' : '') + '" id="mostro-lnp-toggle">lnp2pbot</span>' +
                '</div>';

            var sideBuy = document.getElementById('mostro-side-buy');
            var sideSell = document.getElementById('mostro-side-sell');
            if (sideBuy) sideBuy.onclick = function() {
                self._showBuy = !self._showBuy;
                if (!self._showBuy && !self._showSell) self._showSell = true;
                self._saveSide(); self.render();
            };
            if (sideSell) sideSell.onclick = function() {
                self._showSell = !self._showSell;
                if (!self._showSell && !self._showBuy) self._showBuy = true;
                self._saveSide(); self.render();
            };
            var allBtn = document.getElementById('mostro-pm-all');
            if (allBtn) allBtn.onclick = function() {
                self._pmChips.forEach(function(c) { c.active = false; }); self._savePmChips(); self.render();
            };
            el.querySelectorAll('.mostro-pm-chip:not(.mostro-lnp-chip):not(.mostro-pm-all):not(.mostro-side-chip)').forEach(function(chip) {
                chip.onclick = function(e) {
                    if (e.target.classList.contains('mostro-chip-rm')) return;
                    var idx = parseInt(chip.dataset.idx);
                    self._pmChips[idx].active = !self._pmChips[idx].active;
                    self._savePmChips(); self.render();
                };
            });
            el.querySelectorAll('.mostro-chip-rm').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    self._pmChips.splice(parseInt(btn.dataset.idx), 1); self._savePmChips(); self.render();
                };
            });
            var inp = document.getElementById('mostro-pm-add-input');
            if (inp) inp.onkeydown = function(e) {
                if (e.key !== 'Enter') return;
                var val = inp.value.trim(); if (!val) return;
                if (!self._pmChips.some(function(c) { return c.label.toLowerCase() === val.toLowerCase(); }))
                    self._pmChips.push({ label: val, active: true });
                self._savePmChips(); inp.value = ''; self.render();
            };
            var lnpToggle = document.getElementById('mostro-lnp-toggle');
            if (lnpToggle) lnpToggle.onclick = function() {
                self._showLnp2pbot = !self._showLnp2pbot; self._saveLnp2pbot();
                self.orders = {}; self._closedOrders = {}; self.subscribe(); self.render();
            };
        },

        // ---- tooltip "¿Cómo funciona?" ----
        _explainOrder: function(o, isOwn) {
            var fiat = _escHtml(this._formatOrderFiatLabel(o));
            var pm = _escHtml(o.paymentMethod);
            var premium = parseFloat(o.premium);
            var isSell = o.orderType === 'sell';
            var eid = 'mostro-explain-' + o.id.replace(/[^a-z0-9]/gi, '');
            var headline, steps, note;
            if (o.daemon === 'lnp2pbot') {
                headline = '💡 Oferta de <strong>lnp2pbot</strong> (Telegram). Pago: <strong>' + fiat + '</strong>. Método: <strong>' + pm + '</strong>.';
                steps = '<li>Pulsa "Ver en Telegram" para abrir la oferta.</li><li>En Telegram escribe <code>/take ' + _escHtml(o.id) + '</code> al bot @lnp2pbot.</li>';
                note = 'Necesitas Telegram y una wallet Lightning.';
            } else if (isOwn && isSell) {
                headline = '💡 Esta es <strong>una orden de venta</strong> creada por ti, publicada por <strong>' + fiat + '</strong> mediante <strong>' + pm + '</strong>.';
                steps = '<li>La orden queda visible en el order book hasta que alguien la tome o la canceles.</li><li>Cuando alguien la tome, se abrirá un trade y el robot te pedirá poner los sats en escrow.</li><li>Luego recibirás el pago fiat y, cuando lo confirmes, el robot liberará los sats al comprador.</li>';
                note = 'Mientras siga pendiente puedes cancelarla con el botón "Cancelar".';
            } else if (isOwn) {
                headline = '💡 Esta es <strong>una orden de compra</strong> creada por ti, publicada por <strong>' + fiat + '</strong> mediante <strong>' + pm + '</strong>.';
                steps = '<li>La orden queda visible en el order book hasta que alguien la tome o la canceles.</li><li>Cuando alguien la tome, se abrirá un trade para que puedas comprar los sats.</li><li>Tras pagar el fiat, el vendedor confirmará y el robot te liberará el Bitcoin.</li>';
                note = 'Mientras siga pendiente puedes cancelarla con el botón "Cancelar".';
            } else if (isSell) {
                var premTxt = premium < 0 ? ' (' + Math.abs(premium) + '% por debajo del mercado)' : premium > 0 ? ' (+' + premium + '% sobre el mercado)' : '';
                headline = '💡 Alguien quiere <strong>venderte Bitcoin</strong>. Pagarías <strong>' + fiat + premTxt + '</strong> por <strong>' + pm + '</strong> y recibirías ' + (o.satAmount > 0 ? '<strong>' + o.satAmount.toLocaleString() + ' sats</strong>' : 'BTC a precio de mercado') + '.';
                steps = '<li>Noxtr envía un mensaje cifrado al robot reservando la orden.</li><li>El robot te pide una <strong>factura Lightning</strong>.</li><li>El vendedor deposita los sats en escrow.</li><li>El vendedor te pasa los datos de pago. Le envías los <strong>' + fiat + '</strong>.</li><li>El vendedor confirma → el robot libera los sats a tu wallet.</li>';
                note = 'Solo necesitas una wallet Lightning para recibir (Phoenix, Breez…).';
            } else {
                var premTxt2 = premium > 0 ? ' (+' + premium + '% sobre el mercado)' : premium < 0 ? ' (' + Math.abs(premium) + '% por debajo)' : '';
                headline = '💡 Alguien quiere <strong>comprarte Bitcoin</strong>. Recibirías <strong>' + fiat + premTxt2 + '</strong> por <strong>' + pm + '</strong> y enviarías ' + (o.satAmount > 0 ? '<strong>' + o.satAmount.toLocaleString() + ' sats</strong>' : 'BTC a precio de mercado') + '.';
                steps = '<li>Noxtr envía un mensaje cifrado al robot reservando la orden.</li><li>El robot te pide depositar los sats en escrow.</li><li>El comprador te envía los <strong>' + fiat + '</strong>.</li><li>Confirmas recepción → el robot libera los sats al comprador.</li>';
                note = 'Necesitas wallet Lightning con saldo para el escrow (Phoenix, Breez…).';
            }
            return '<div class="mostro-explain" id="' + eid + '" style="display:none">' +
                '<p class="mostro-explain-headline">' + headline + '</p>' +
                '<ol>' + steps + '</ol>' +
                '<p class="mostro-explain-note">' + note + '</p>' +
                '<a class="mostro-gotit" data-eid="' + eid + '">Ocultar ↑</a>' +
                '</div>';
        },

        _bindExplainToggles: function() {
            document.querySelectorAll('.mostro-gotit').forEach(function(a) {
                if (a._bound) return; a._bound = true;
                a.onclick = function() {
                    document.querySelectorAll('.mostro-explain').forEach(function(el) { el.style.display = 'none'; });
                    try { localStorage.setItem('noxtr_mostro_tips', 'hidden'); } catch(e) {}
                };
            });
            document.querySelectorAll('.mostro-tip-toggle').forEach(function(a) {
                if (a._bound) return; a._bound = true;
                a.onclick = function() {
                    var el = document.getElementById(a.dataset.eid);
                    if (!el) return;
                    el.style.display = el.style.display === 'none' ? '' : 'none';
                };
            });
        }
    };

    // Conectar resubscribe desde MostroCommunities
    MostroCommunities._reloadWithFilter = function() {
        MostroBook.resubscribe();
        MostroCommunities.render();
    };

    // ==================== INICIALIZACIÓN ====================

    document.addEventListener('DOMContentLoaded', function () {
        // Usamos setTimeout(0) para que se ejecute DESPUÉS de footer.php → Noxtr.init() → UI.init()
        setTimeout(function () {

            // 1. Monkey-patch switchTab para gestionar panel-mostro
            //    (evita tocar script.js y cubre todos los caminos: clicks, llamadas directas, etc.)
            if (window.Noxtr && Noxtr.UI && typeof Noxtr.UI.switchTab === 'function') {
                var _origSwitchTab = Noxtr.UI.switchTab.bind(Noxtr.UI);
                Noxtr.UI.switchTab = function (tab, pushHistory) {
                    var panelMostro = document.getElementById('panel-mostro');
                    if (panelMostro && tab !== 'mostro') { panelMostro.style.display = 'none'; MostroBook._stopCountdown(); }
                    _origSwitchTab(tab, pushHistory);
                    if (tab === 'mostro') {
                        var feedEl = document.getElementById('feed');
                        var feedLoading = document.getElementById('feed-loading');
                        if (feedEl) feedEl.style.display = 'none';
                        if (feedLoading) feedLoading.style.display = 'none';
                        if (panelMostro) panelMostro.style.display = '';
                    }
                };
            }

            // 2. Arrancar suscripción de órdenes
            MostroBook.subscribe();

            // 3. Robots Mostro (communities)
            MostroCommunities.render();

            // 4. Cargar mis trades de DB + suscribir gift wraps
            MostroTrader.loadMyTrades();

            // 5. Botón "📲 Mostro Mobile" → importar identidad BIP39
            var btnImport = document.getElementById('btn-import-mostro-mobile');
            if (btnImport) btnImport.onclick = function(e) { e.preventDefault(); _importMostroMobileIdentity(); };

            // 6. Botón "+ Crear oferta"
            var btnCreate = document.getElementById('btn-mostro-create-order');
            if (btnCreate) btnCreate.onclick = function() { MostroTrader.createOrder(); };

        }, 0);
    });

    // Debug helpers (remove in production)
    window._MostroTrader = MostroTrader;
    window._MostroBook   = MostroBook;
    window._MostroTradeSnapshot = function(orderId) {
        if (!orderId || !MostroTrader || !MostroTrader._trades) return null;
        return _mostroTradeSnapshot(MostroTrader._trades[orderId] || null);
    };

})();
