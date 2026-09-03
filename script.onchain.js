// ==========================================================================
// NostrEscrow on-chain extension for Noxtr.
//
// Browser-first: subscribe to relays directly and keep all Bitcoin private-key
// operations client-side. PHP provides persistence and chain/PoW/broadcast proxies.
//
// Coexiste con script.mostro.js (Lightning P2P). No toca su namespace.
// Reusa Noxtr.Pool, Noxtr.Nip04, Noxtr.Events, Noxtr.Profiles del script.js base.
//
// Spec: _modules_/noxtr/NIP-NOSTRESCROW.md and NOSTR_ONCHAIN.md (kinds 39383-39389)
// ==========================================================================

(function () {
    'use strict';

    // ==================== DEBUG ====================

    function _debug() {
        return window.NOXTR_DEBUG === true || localStorage.getItem('noxtr_debug') === '1';
    }
    function _log() {
        if (!_debug()) return;
        var args = ['[Onchain]'].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
    }
    // Eventos historicos de los relays pueden pertenecer a una version anterior del
    // contrato, y una misma cuenta puede conservar trades creados con otra raiz local.
    // Son descartes esperables, no avisos operativos: solo se muestran al auditar el
    // protocolo expresamente con noxtr_debug_verbose=1.
    function _trace() {
        var enabled = window.NOXTR_DEBUG_VERBOSE === true;
        try { enabled = enabled || localStorage.getItem('noxtr_debug_verbose') === '1'; } catch(e) {}
        if (!enabled) return;
        var args = ['[Onchain]'].concat(Array.prototype.slice.call(arguments));
        console.debug.apply(console, args);
    }
    function _warn() {
        var args = ['[Onchain]'].concat(Array.prototype.slice.call(arguments));
        console.warn.apply(console, args);
    }
    function _escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
        });
    }

    // ==================== CONFIG ====================

    var Config = {
        pubkey:        '',
        userId:        0,
        ajaxUrl:       '',
        // Red Bitcoin activa: 'mainnet' | 'testnet' | 'signet'. Define qué órdenes se ven/operan,
        // el HRP de las direcciones y el backend de verificación. Se carga de localStorage en init.
        network:       'mainnet',
        // Pubkey Bitcoin (x-only, 64 hex) del ADMIN DE LA WEB (tier site_admin), usada por defecto
        // como arb1 en órdenes on-chain. null = sin default → selección determinista pura.
        // Se rellena desde CFG vía footer.php / Onchain.init().
        defaultSiteArbitrator: null,
        // ¿El usuario actual es Root/Administradores? Habilita el botón "Usar como árbitro del sitio".
        isOnchainAdmin: false,
        // Set { nostrPubkeyHex: true } de arbitros ocultados por el operador del sitio. Se siembra en
        // init desde footer.php y el admin lo puede mutar en vivo via set_arbitrator_block.
        blockedArbitrators: {},
        // Referencias a módulos de Noxtr (se rellenan en init).
        pool:          null,
        nip04:         null,
        events:        null,
        profiles:      null,
        // Constantes del protocolo.
        KIND_ORDER:        39383,
        KIND_RATING:       39384,
        KIND_TRADE_STATE:  39385,
        KIND_DISPUTE:      39386,
        KIND_ARBITRATION:  39387,
        KIND_ARB_ADV:      39388,
        KIND_FUNDING:      39389,
        Y_TAG:             'nostrescrow',
        // NUMS point fijo (BIP341 sec "Constructing and spending Taproot outputs")
        NUMS_POINT:        '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
        // ===== TEST MODE: CSVs cortos para validar el cascade en una jornada =====
        // PRODUCCION: ARB2=288 (~2d), ARB3=576 (~4d), RECOVERY=4320 (~30d).
        // TEST:       ARB2=6   (~1h), ARB3=12  (~2h), RECOVERY=36  (~6h).
        // Estos valores entran en el script Taproot -> CAMBIAN LA DIRECCION DEL ESCROW.
        // Ambas partes (y los arbitros) DEBEN ejecutar la misma version o la direccion no coincide.
        // Revertir antes de mainnet con fondos reales.
        CSV_ARB2:          6,
        CSV_ARB3:          12,
        CSV_RECOVERY:      36
    };

    // ==================== SUBMODULES (placeholders Phase 1) ====================

    // Helpers de metadatos on-chain en trade_json. Parte 1.2 del plan: leer/escribir sin perder
    // campos. _mergeMeta NUNCA machaca el objeto entero; aplica un patch sobre lo que ya hay, de
    // modo que campos como maker_nostr_pubkey, network o premium sobreviven a writes posteriores.
    function _readMeta(trade) {
        try { return (trade && trade.trade_json) ? (JSON.parse(trade.trade_json) || {}) : {}; }
        catch(e) { return {}; }
    }
    function _mergeMeta(trade, patch) {
        var meta = _readMeta(trade);
        if (patch) for (var k in patch) { if (patch.hasOwnProperty(k)) meta[k] = patch[k]; }
        return JSON.stringify(meta);
    }

    // ==================== RED (network) ====================
    // Parte 1.3 del plan. testnet y signet comparten HRP 'tb' (no comparten cadena ni mempool):
    // el único guardia entre ambas es Config.network + el backend correcto, NO la dirección.
    var _NETWORKS = ['mainnet', 'testnet', 'signet'];
    var _NET_LS_KEY = 'noxtr_onchain_network';
    function _normalizeNetwork(net) {
        net = String(net || '').toLowerCase();
        return _NETWORKS.indexOf(net) !== -1 ? net : 'mainnet';
    }
    function _activeNetwork() { return _normalizeNetwork(Config.network); }
    function _networkHrp(net) { return _normalizeNetwork(net) === 'mainnet' ? 'bc' : 'tb'; }
    // El trade puede traer su red en trade_json.network; si no, asumimos la activa (compat trades viejos).
    function _tradeNetwork(trade) {
        var n = _readMeta(trade).network;
        return n ? _normalizeNetwork(n) : _activeNetwork();
    }
    function _addressMatchesNetwork(addr, net) {
        var hrp = _networkHrp(net);
        return new RegExp('^' + hrp + '1', 'i').test(String(addr || '').trim());
    }
    // Filtro rápido de formato/red para UX. Antes de persistir, firmar o aceptar datos remotos se
    // usa _isValidPayoutAddressStrict, que decodifica la dirección y verifica su checksum.
    function _isValidPayoutAddress(addr, net) {
        addr = String(addr || '').trim();
        if (!addr) return false;
        if (_normalizeNetwork(net) === 'mainnet') {
            return /^bc1[a-z0-9]{25,87}$/i.test(addr) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr);
        }
        return /^tb1[a-z0-9]{25,87}$/i.test(addr) || /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr);
    }
    async function _isValidPayoutAddressStrict(addr, net) {
        if (!_isValidPayoutAddress(addr, net)) return false;
        try { await _addressToScriptPubKey(String(addr).trim(), net); return true; }
        catch(e) { return false; }
    }
    // Limite dust universal (sats). 546 cubre todos los tipos de salida (P2PKH 546, P2SH 540, P2TR ~330,
    // P2WPKH ~294). Un output por debajo de esto hace la TX no estandar y los nodos no la propagan.
    var _DUST_SATS = 546;

    // Polls consecutivos de tx_status sin encontrar una TX de liberacion ya difundida antes de asumir
    // que se cayo del mempool sin confirmar (poll cada 30s -> ~3 min de gracia). Conservador: evita
    // reabrir un trade por un hipo transitorio del backend, pero detecta la caida real.
    var _RELEASE_DROP_MISSES = 6;

    // Traduce un CSV en bloques a un string aproximado de tiempo humano (asumiendo ~10 min/bloque).
    // Se usa en los textos de UI/notify de recovery para que en TEST MODE no diga siempre "~30 dias".
    function _csvApproxTime(blocks) {
        var mins = (parseInt(blocks, 10) || 0) * 10;
        if (mins < 60) return mins + ' min';
        if (mins < 60 * 48) return Math.round(mins / 60) + ' h';
        return Math.round(mins / 1440) + ' dias';
    }

    // Comisión de arb1 = max(fee_min_sats, round(sat_amount * fee_rate/100)), leída de su anuncio
    // 39388 en el pool local. El maker la congela en el accept para que ambas partes usen el mismo
    // valor (el pool de cada cliente podría diferir). La comision se paga como un output P2TR aparte,
    // asi que si es >0 debe ser >= dust; la elevamos al minimo dust para no producir TX no estandar.
    function _computeArbFee(arb1Pubkey, satAmount) {
        if (typeof Arbitrators === 'undefined' || !Arbitrators.pool) return 0;
        var a = Arbitrators.pool[String(arb1Pubkey || '').toLowerCase()];
        if (!a) return 0;
        var rate = parseFloat(a.fee_rate) || 0;
        var minSats = parseInt(a.fee_min_sats, 10) || 0;
        var pct = Math.round((parseInt(satAmount, 10) || 0) * rate / 100);
        var fee = Math.max(minSats, pct);
        return fee > 0 ? Math.max(fee, _DUST_SATS) : 0;
    }

    // Importe que el VENDEDOR debe depositar en el escrow = sat_amount + la comision COMPLETA del
    // arbitro. La comision la asume integramente el vendedor (el que aporta los BTC), no se reparte.
    // Por eso el arbitro cobra arb_fee gane quien gane la disputa (el output del ganador es siempre
    // prevValue - arbFee - fee), asi que no tiene incentivo economico para inclinarse a un lado. En
    // recovery (sin arbitraje) el vendedor recupera todo el escrow, incluida la comision prefondeada.
    // arb_fee se congela en el accept (trade_json.arb_fee_sats) para que ambas partes calculen el mismo
    // target sin negociar (NOSTR_ONCHAIN sec 10).
    function _fundingTargetSats(trade) {
        var amount = parseInt((trade && trade.sat_amount), 10) || 0;
        if (amount <= 0) return 0;
        var arbFee = parseInt(_readMeta(trade).arb_fee_sats, 10) || 0;
        return amount + arbFee;
    }

    // sats -> string BTC (8 decimales, sin ceros sobrantes ni notacion cientifica). Para el amount
    // del URI BIP21, que se expresa en BTC. Ej: 1875 -> "0.00001875".
    function _satsToBtc(sats) {
        var s = String(Math.max(0, parseInt(sats, 10) || 0));
        while (s.length < 9) s = '0' + s;
        var intPart = s.slice(0, s.length - 8);
        var frac = s.slice(s.length - 8).replace(/0+$/, '');
        return frac ? intPart + '.' + frac : intPart;
    }

    // Concepto de la transferencia fiat (anti-triangulacion / MITM). Coincide con el #ID visible de
    // la ficha (order_id[0:8]) para que ambas partes puedan verificarlo a simple vista.
    function _fiatRef(trade) {
        var oid = String((trade && trade.order_id) || '').slice(0, 8);
        return oid ? 'NXTR-' + oid : '';
    }

    // Caja "Proteccion anti-fraude" del paso fiat. mode: 'buyer' | 'seller_wait' | 'seller_confirm'.
    // Reusa las clases .nxoc-funding-guide / .nxoc-guide-title (sin CSS nuevo). El emoji va fuera del
    // string traducible (ver I18N.md).
    function _mitmHtml(trade, mode) {
        var ref = _fiatRef(trade);
        if (!ref) return '';
        var body;
        if (mode === 'buyer') {
            body = '<p class="nxoc-guide-lead">' + _escHtml(str_mitm_buyer_concept) + '</p>' +
                '<div class="nxoc-funding-row">' +
                    '<code class="nxoc-funding-address">' + _escHtml(ref) + '</code>' +
                    '<button class="btn btn-noxtr btn-sm nxoc-copy-concept" data-concept="' + _escHtml(ref) + '">' + str_copy + '</button>' +
                '</div>' +
                '<p class="nxoc-guide-lead">' + _escHtml(str_mitm_buyer_verify) + '</p>';
        } else if (mode === 'seller_confirm') {
            body = '<p class="nxoc-guide-lead">' + _escHtml(t(str_mitm_seller_confirm, ref)) + '</p>';
        } else { // seller_wait
            body = '<p class="nxoc-guide-lead">' + _escHtml(t(str_mitm_seller_wait, ref)) + '</p>';
        }
        return '<div class="nxoc-funding-guide nxoc-mitm-box">' +
            '<div class="nxoc-guide-title">🛡 ' + _escHtml(str_mitm_title) + '</div>' +
            body +
        '</div>';
    }

    // Pubkey NOSTR de la contraparte (para dirigirle un DM kind 4). Por rol: si soy el maker
    // (trade_role='created') el peer es el taker; si soy el taker, el maker. Ambos lados guardan
    // taker_nostr_pubkey / maker_nostr_pubkey en trade_json al aceptar (acceptTake / takeOrder).
    function _peerNostrPubkey(trade) {
        var meta = _readMeta(trade);
        var pk = (trade && trade.trade_role === 'created') ? meta.taker_nostr_pubkey : meta.maker_nostr_pubkey;
        pk = String(pk || '').toLowerCase();
        return /^[a-f0-9]{64}$/.test(pk) ? pk : '';
    }

    // txid de una TX a partir de su serializacion LEGACY (sin testigos): double-sha256 y revertido.
    // El tx_hex que produce buildCooperative es justo la forma legacy, asi que su hash es el txid
    // (el witness no entra en el txid, solo en el wtxid). Sirve para anticipar el txid de liberacion
    // antes incluso de difundir, y reconocer la TX on-chain la difunda quien la difunda.
    async function _txidFromLegacyHex(legacyHex) {
        var h1 = await _sha256Bytes(_hexToBytes(legacyHex));
        var h2 = await _sha256Bytes(h1);
        return _bytesToHex(_revBytes(h2));
    }

    // URL del explorador para una TX en la red dada (link que abren las partes para ver confirmaciones).
    function _explorerTxUrl(net, txid) {
        net = _normalizeNetwork(net);
        var base = (net === 'mainnet') ? 'https://mempool.space' : ('https://mempool.space/' + net);
        return base + '/tx/' + String(txid || '');
    }

    // Helpers para parsear tags de eventos Nostr.
    function _findTag(ev, name) {
        if (!ev || !ev.tags) return null;
        for (var i = 0; i < ev.tags.length; i++) {
            if (ev.tags[i] && ev.tags[i][0] === name) return ev.tags[i];
        }
        return null;
    }
    function _getTagValue(ev, name) {
        var t = _findTag(ev, name);
        return t ? t[1] : null;
    }
    function _getTagValues(ev, name) {
        var out = [];
        if (!ev || !ev.tags) return out;
        for (var i = 0; i < ev.tags.length; i++) {
            if (ev.tags[i] && ev.tags[i][0] === name && ev.tags[i][1]) out.push(ev.tags[i][1]);
        }
        return out;
    }
    function _eventOrderId(ev) {
        var explicit = _getTagValue(ev, 'order_id');
        return String(explicit || _getTagValue(ev, 'd') || '').split(':')[0];
    }
    function _isArchivedTrade(trade) {
        return !!(trade && (parseInt(trade.archived, 10) === 1 ||
            String(trade.internal_status || '').toLowerCase() === 'archivado'));
    }
    function _eventMatchesTrade(ev, trade) {
        if (!ev || !trade || _isArchivedTrade(trade)) return false;
        var network = _getTagValue(ev, 'network');
        if (!network || _NETWORKS.indexOf(String(network).toLowerCase()) === -1 ||
            _normalizeNetwork(network) !== _tradeNetwork(trade)) return false;
        var expectedTradeId = String(_readMeta(trade).trade_id || '');
        if (expectedTradeId && String(_getTagValue(ev, 'trade_id') || '') !== expectedTradeId) return false;
        return true;
    }
    function _normalizeArbitrators(input) {
        var list = Array.isArray(input) ? input : [];
        var valid = [];
        list.forEach(function(pk) {
            pk = String(pk || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (/^[a-f0-9]{64}$/.test(pk)) valid.push(pk);
        });
        if (valid.length === 1) return [valid[0], valid[0], valid[0]];
        return valid.slice(0, 3);
    }
    function _arbitratorsCsv(input) {
        var normalized = _normalizeArbitrators(input);
        return normalized.length === 3 ? normalized.join(',') : '';
    }

    // SHA-256 hex (Web Crypto). Para derivar trade_id según spec sec 4.2.
    async function _sha256hex(str) {
        var enc = new TextEncoder().encode(str);
        var hash = await crypto.subtle.digest('SHA-256', enc);
        var bytes = new Uint8Array(hash);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
        return hex;
    }

    function _leadingZeroBits(hex) {
        var bits = 0;
        hex = String(hex || '').toLowerCase();
        for (var i = 0; i < hex.length; i++) {
            var n = parseInt(hex[i], 16);
            if (!Number.isFinite(n)) return -1;
            if (n === 0) { bits += 4; continue; }
            if (n < 2) bits += 3;
            else if (n < 4) bits += 2;
            else if (n < 8) bits += 1;
            break;
        }
        return bits;
    }

    // Los relays no son una frontera de confianza. Recalculamos el id NIP-01, verificamos
    // la firma Schnorr y, para los kinds del protocolo, el PoW real (no solo lo declarado
    // en la tag nonce). Devuelve false ante cualquier evento mal formado.
    async function _verifyProtocolEvent(ev, minPow) {
        try {
            if (!ev || !/^[a-f0-9]{64}$/i.test(String(ev.pubkey || '')) ||
                !/^[a-f0-9]{64}$/i.test(String(ev.id || '')) ||
                !/^[a-f0-9]{128}$/i.test(String(ev.sig || '')) ||
                !Array.isArray(ev.tags) || typeof ev.content !== 'string') return false;
            var computed = await _sha256hex(JSON.stringify([
                0, ev.pubkey, Number(ev.created_at), Number(ev.kind), ev.tags, ev.content
            ]));
            if (computed !== String(ev.id).toLowerCase()) return false;
            if (typeof nobleSecp256k1 === 'undefined' || !nobleSecp256k1.schnorr) return false;
            if (!(await nobleSecp256k1.schnorr.verify(ev.sig, computed, ev.pubkey))) return false;
            minPow = parseInt(minPow, 10) || 0;
            if (minPow > 0) {
                var nonce = _findTag(ev, 'nonce');
                var declared = nonce && nonce.length > 2 ? parseInt(nonce[2], 10) : 0;
                if (declared < minPow || _leadingZeroBits(computed) < minPow) return false;
            }
            return true;
        } catch(e) { return false; }
    }
    function _minimumPowForKind(kind) {
        kind = Number(kind);
        if (kind === Config.KIND_ORDER || kind === Config.KIND_ARB_ADV) return 16;
        if (kind === Config.KIND_RATING) return 8;
        if (kind === 4 || kind === 5) return 0;
        return 12;
    }

    function _hexToBytes(hex) {
        hex = String(hex || '').toLowerCase();
        if (hex.length % 2 !== 0 || /[^a-f0-9]/.test(hex)) throw new Error('Hex invalido');
        var arr = new Uint8Array(hex.length / 2);
        for (var i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return arr;
    }
    function _bytesToHex(bytes) {
        return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    function _concatBytes() {
        var len = 0;
        for (var i = 0; i < arguments.length; i++) len += arguments[i].length;
        var out = new Uint8Array(len), pos = 0;
        for (var j = 0; j < arguments.length; j++) {
            out.set(arguments[j], pos);
            pos += arguments[j].length;
        }
        return out;
    }
    async function _sha256Bytes(bytes) {
        return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    }
    async function _taggedHash(tag, data) {
        var tagHash = await _sha256Bytes(new TextEncoder().encode(tag));
        return await _sha256Bytes(_concatBytes(tagHash, tagHash, data));
    }

    // Derivación determinista del trade_id (spec sec 4.2):
    // trade_id = lowercase(hex(sha256(order_id || ":" || taker_pubkey))[0:32])
    async function _computeTradeId(orderId, takerPubkey) {
        var hex = await _sha256hex(orderId + ':' + takerPubkey);
        return hex.slice(0, 32).toLowerCase();
    }

    // Helper AJAX: replica el patrón de MostroTrader._ajax (flatten fields[k]=v).
    async function _ajax(action, data) {
        var params = Object.assign({ action: action }, data || {});
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
        var resp = await fetch(Config.ajaxUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams(params).toString()
        });
        var json = await resp.json();
        if (action === 'mostro_trade_get' && json && json.trade &&
            typeof _hydrateTradeKey === 'function') await _hydrateTradeKey(json.trade);
        if (action === 'mostro_trade_list' && json && Array.isArray(json.trades) &&
            typeof _hydrateTrades === 'function') await _hydrateTrades(json.trades);
        return json;
    }

    // Order book on-chain (kind 39383 con #y=nostrescrow).
    // Subscribe directo a relays via Noxtr.Pool. Sin cache server-side: el navegador es autoridad.
    var Book = {
        orders: {},                     // { orderId: parsedOrder }
        _subId: null,
        _initialized: false,
        _eoseReached: false,
        _onUpdate: null,                // callback opcional para UI: function(order) {...}

        init: function () {
            if (this._initialized) return;
            this._initialized = true;
            _log('Book.init');
        },

        // Suscribirse al kind 39383 con filtro #y=nostrescrow.
        // sinceSeconds: ventana inicial en segundos (default 48h).
        subscribe: function (sinceSeconds) {
            if (this._subId) {
                _warn('Book.subscribe: ya hay suscripción activa, ignorando');
                return;
            }
            if (!Config.pool) {
                _warn('Book.subscribe: Config.pool no disponible');
                return;
            }
            var since = Math.floor(Date.now() / 1000) - (sinceSeconds || 48 * 3600);
            var self = this;
            var filter = {
                kinds: [Config.KIND_ORDER],
                '#y':  [Config.Y_TAG],
                since: since,
                limit: 100
            };
            this._subId = Config.pool.subscribe(
                [filter],
                function (ev, relayUrl) { self._handleEvent(ev, relayUrl); },
                function () {
                    self._eoseReached = true;
                    _log('Book.subscribe: EOSE, ' + Object.keys(self.orders).length + ' órdenes en cache');
                }
            );
            _log('Book.subscribe: kind ' + Config.KIND_ORDER + ', #y=' + Config.Y_TAG + ', since=' + since);
        },

        unsubscribe: function () {
            if (this._subId && Config.pool) {
                Config.pool.unsubscribe(this._subId);
                this._subId = null;
                this._eoseReached = false;
                _log('Book.unsubscribe');
            }
        },

        // Parser de eventos kind 39383. Devuelve un objeto plano con los campos relevantes.
        // Si la versión recibida es más antigua que la cacheada, ignora (replaceable).
        _handleEvent: async function (ev, relayUrl) {
            if (!ev || ev.kind !== Config.KIND_ORDER || !(await _verifyProtocolEvent(ev, 16))) return;

            // Defensa: descartar eventos no-NostrEscrow (otros protocolos pueden usar el mismo
            // rango de kinds en el futuro; el filtro server-side por #y debería bastar pero
            // verificamos en cliente igualmente).
            var yTag = _getTagValue(ev, 'y');
            if (yTag !== Config.Y_TAG) return;

            var orderId = _getTagValue(ev, 'd');
            if (!/^[a-zA-Z0-9_-]{16,64}$/.test(String(orderId || ''))) return;
            if (!Number.isFinite(Number(ev.created_at)) || ev.created_at > Math.floor(Date.now()/1000) + 300) return;
            var existing = this.orders[orderId];
            if (existing && existing.makerPubkey !== ev.pubkey) {
                delete this.orders[orderId];
                this._collidedOrderIds = this._collidedOrderIds || {};
                this._collidedOrderIds[orderId] = true;
                _warn('order_id usado por dos autores; se ocultan ambas ordenes', orderId);
                return;
            }
            if (this._collidedOrderIds && this._collidedOrderIds[orderId]) return;
            var tombstone = this._expiredOrderIds && this._expiredOrderIds[orderId];
            if (tombstone && tombstone.pubkey === ev.pubkey && tombstone.created_at >= ev.created_at) return;
            if (existing && existing.created_at >= ev.created_at) return;
            var expiresRaw = parseInt(_getTagValue(ev, 'expires_at') || '0', 10);
            if (expiresRaw > 0 && expiresRaw <= Math.floor(Date.now()/1000)) {
                this._expiredOrderIds = this._expiredOrderIds || {};
                this._expiredOrderIds[orderId] = { pubkey: ev.pubkey, created_at: ev.created_at };
                if (existing && existing.makerPubkey === ev.pubkey) delete this.orders[orderId];
                return;
            }
            var orderKind = _getTagValue(ev, 'k');
            var amountRaw = Number(_getTagValue(ev, 'amount'));
            var fiatRaw = String(_getTagValue(ev, 'fiat_code') || '');
            var networkRaw = _getTagValue(ev, 'network');
            if ((orderKind !== 'buy' && orderKind !== 'sell') || !Number.isSafeInteger(amountRaw) || amountRaw < 0 ||
                !/^[A-Z]{2,10}$/.test(fiatRaw) || !networkRaw || _NETWORKS.indexOf(networkRaw) === -1) return;

            var fiatAmtTag = _findTag(ev, 'fiat_amount');
            var isRange = !!(fiatAmtTag && fiatAmtTag.length >= 3 && fiatAmtTag[2]);
            var arbitratorsRaw = _getTagValue(ev, 'arbitrators');
            if (_arbitratorsCsv(String(arbitratorsRaw || '').split(',')) === '') return;
            if (!fiatAmtTag || !(Number(fiatAmtTag[1]) > 0) ||
                (isRange && (!(Number(fiatAmtTag[2]) >= Number(fiatAmtTag[1]))))) return;

            var order = {
                eventId:       ev.id,
                makerPubkey:   ev.pubkey,
                orderId:       orderId,
                kind:          orderKind,
                amountSats:    amountRaw,
                fiatCode:      fiatRaw,
                fiatAmount:    !isRange && fiatAmtTag ? fiatAmtTag[1] : null,
                fiatMin:       isRange ? parseFloat(fiatAmtTag[1]) : null,
                fiatMax:       isRange ? parseFloat(fiatAmtTag[2]) : null,
                isRange:       isRange,
                paymentMethod: _getTagValue(ev, 'payment_method') || '',
                premium:       parseFloat(_getTagValue(ev, 'premium') || '0'),
                expiresAt:     parseInt(_getTagValue(ev, 'expires_at') || '0', 10),
                // Red de la orden. Sin tag (órdenes legacy) = mainnet por defecto.
                network:       _normalizeNetwork(_getTagValue(ev, 'network') || 'mainnet'),
                arbitrators:   arbitratorsRaw ? arbitratorsRaw.split(',').map(function (s) { return s.trim(); }) : [],
                content:       ev.content || '',
                created_at:    ev.created_at,
                _relay:        relayUrl || ''
            };

            this.orders[orderId] = order;
            if (this._onUpdate) {
                try { this._onUpdate(order); } catch (e) { _warn('Book._onUpdate threw:', e); }
            }
            _log('Book: order parsed', {
                orderId:    orderId,
                kind:       order.kind,
                amount:     order.amountSats,
                fiat:       (order.fiatAmount || (order.fiatMin + '-' + order.fiatMax)) + ' ' + order.fiatCode,
                pm:         order.paymentMethod
            });
        },

        // Lista de órdenes ordenadas por más recientes primero.
        // Útil para inspección desde consola; UI usará _onUpdate callback.
        list: function () {
            var arr = [];
            for (var k in this.orders) if (this.orders.hasOwnProperty(k)) arr.push(this.orders[k]);
            arr.sort(function (a, b) { return b.created_at - a.created_at; });
            return arr;
        },

        // Filtra orders por kind ('buy' o 'sell'), payment_method, fiat_code, importe.
        filter: function (criteria) {
            criteria = criteria || {};
            return this.list().filter(function (o) {
                if (criteria.kind && o.kind !== criteria.kind) return false;
                if (criteria.fiatCode && o.fiatCode !== criteria.fiatCode) return false;
                if (criteria.paymentMethod && o.paymentMethod.toLowerCase().indexOf(criteria.paymentMethod.toLowerCase()) === -1) return false;
                return true;
            });
        }
    };

    // Mis trades on-chain (kinds 39385/39386/39387/39389 sobre mis trade_ids).
    // En Phase 2: createOrder publica kind 39383 (Order). Suscripción a updates pendiente.
    var Trader = {
        trades: {},
        _subId: null,
        _initialized: false,

        init: async function () {
            if (this._initialized) return;
            this._initialized = true;
            // Restaurar solicitudes pendientes de makers (persisten entre recargas)
            try {
                var _pt = JSON.parse(localStorage.getItem('nxoc_pending_takes') || '{}');
                if (_pt && typeof _pt === 'object') this._pendingTakeRequests = _pt;
            } catch(e) {}
            _log('Trader.init (Phase 2: createOrder operativo, suscripciones pendientes)');
        },

        // Guarda el último evento público antes de enviarlo. Al recargar se puede volver a
        // publicar exactamente el mismo id (idempotente) si el navegador cayó entre BD y relay.
        _publishDurable: async function(trade, signed) {
            if (!trade || !signed || !signed.id) throw new Error('Evento durable invalido');
            if (!(await _verifyProtocolEvent(signed, _minimumPowForKind(signed.kind)))) {
                throw new Error('Evento saliente con id/firma/PoW invalido');
            }
            var merged = _mergeMeta(trade, { nostr_outbox_event: signed });
            var saved = await _ajax('mostro_trade_update', { order_id: trade.order_id, fields: { trade_json: merged } });
            if (!saved || saved.error) throw new Error((saved && saved.msg) || 'No se pudo guardar el evento saliente');
            trade.trade_json = merged;
            Config.pool.publish(signed);
            return signed;
        },

        _replayOutbox: async function(trade) {
            if (_isArchivedTrade(trade)) return;
            var ev = _readMeta(trade).nostr_outbox_event;
            if (!ev || !ev.id || ev.pubkey !== (Config.events && Config.events.pubkey)) return;
            if (await _verifyProtocolEvent(ev, _minimumPowForKind(ev.kind))) Config.pool.publish(ev);
        },

        // Índice BIP32 no endurecido aleatorio (índice 0 reservado para arbitraje). Evita
        // colisiones entre dispositivos/pestañas y tras borrar localStorage. Se persiste con
        // el trade para poder rederivar la misma clave desde el backup de la semilla.
        _nextTradeIndex: function () {
            var used = {};
            if (window.MostroTrader && MostroTrader._trades) Object.values(MostroTrader._trades).forEach(function(t) {
                if (t && t.method === 'onchain') used[parseInt(t.trade_index, 10) || 0] = true;
            });
            for (var tries = 0; tries < 32; tries++) {
                var raw = new Uint32Array(1); crypto.getRandomValues(raw);
                var idx = raw[0] & 0x7fffffff;
                if (idx > 0 && !used[idx]) return idx;
            }
            throw new Error('No se pudo reservar un trade_index unico');
        },

        // Genera un order_id aleatorio de 32 hex chars (128 bits).
        _genOrderId: function () {
            var arr = new Uint8Array(16);
            crypto.getRandomValues(arr);
            return Array.from(arr).map(function (b) {
                return b.toString(16).padStart(2, '0');
            }).join('');
        },

        // Crea y publica una orden on-chain (kind 39383 NostrEscrow).
        //
        // params: {
        //     kind:          'buy' | 'sell',
        //     amountSats:    int (0 = precio de mercado),
        //     fiatCode:      'EUR' | 'USD' | ...,
        //     fiatAmount:    number (importe fijo) o [min, max] (rango),
        //     paymentMethod: string libre (opcional),
        //     premium:       number en % (opcional, default 0),
        //     content:       string descriptivo (opcional)
        // }
        //
        // Returns: { orderId, eventId, tradePubkey }
        createOrder: async function (params) {
            // ---- Validaciones ----
            if (!Keys.isUnlocked()) {
                throw new Error('Escrow locked. Llama Onchain.Keys.unlock() primero.');
            }
            if (!Config.events || !Config.events.canSign()) {
                throw new Error('Noxtr.Events no puede firmar. Configura nsec/NIP-07/NIP-46 primero.');
            }
            if (!Config.events.pubkey) {
                throw new Error('Noxtr.Events no tiene pubkey. Login primero.');
            }
            if (['buy', 'sell'].indexOf(params.kind) === -1) {
                throw new Error('params.kind debe ser "buy" o "sell"');
            }
            var amount = parseInt(params.amountSats, 10);
            if (!Number.isFinite(amount) || amount < 0) {
                throw new Error('params.amountSats inválido');
            }
            var fiatCode = (params.fiatCode || '').toUpperCase().replace(/[^A-Z]/g, '');
            if (!fiatCode) throw new Error('params.fiatCode requerido');

            var fiatAmountTag;
            if (typeof params.fiatAmount === 'number') {
                if (!Number.isFinite(params.fiatAmount) || params.fiatAmount <= 0) {
                    throw new Error('params.fiatAmount debe ser mayor que cero');
                }
                fiatAmountTag = ['fiat_amount', String(params.fiatAmount)];
            } else if (Array.isArray(params.fiatAmount) && params.fiatAmount.length === 2) {
                var fiatMin = Number(params.fiatAmount[0]), fiatMax = Number(params.fiatAmount[1]);
                if (!Number.isFinite(fiatMin) || !Number.isFinite(fiatMax) || fiatMin <= 0 || fiatMax < fiatMin) {
                    throw new Error('Rango fiat inválido');
                }
                fiatAmountTag = ['fiat_amount', String(fiatMin), String(fiatMax)];
            } else {
                throw new Error('params.fiatAmount debe ser number o [min, max]');
            }

            // ---- Derivar trade key BIP86 ----
            var tradeIndex = this._nextTradeIndex();
            var tradePrivkey = await Bip86.deriveCurrentTradeKey(tradeIndex);
            var tradePubkey  = Bip86.privkeyToTradePubkey(tradePrivkey);

            // ---- Construir evento kind 39383 sin firmar ni minar ----
            var orderId = this._genOrderId();
            var tags = [
                ['d', orderId],
                ['y', Config.Y_TAG],
                ['k', params.kind],                    // 'buy' | 'sell' — mismo convenio que Mostro
                ['amount', String(amount)],
                ['fiat_code', fiatCode],
                fiatAmountTag
            ];
            if (params.paymentMethod) tags.push(['payment_method', String(params.paymentMethod).slice(0, 255)]);
            if (params.premium) tags.push(['premium', String(parseFloat(params.premium) || 0)]);
            // Red de la orden: la del selector activo al crearla. Congela en qué cadena se opera.
            var orderNetwork = _normalizeNetwork(params.network || _activeNetwork());
            tags.push(['network', orderNetwork]);
            var arbitrators = _normalizeArbitrators(params.arbitrators);
            if (arbitrators.length !== 3) {
                throw new Error('Selecciona 1 o 3 arbitros para la oferta on-chain.');
            }
            tags.push(['arbitrators', arbitrators.join(',')]);

            var unsignedEvent = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_ORDER,
                created_at: Math.floor(Date.now() / 1000),
                tags:       tags,
                content:    String(params.content || '')
            };

            // ---- Minar PoW server-side (16 bits NIP-13 mínimo NostrEscrow) ----
            var mined = await PowMiner.mineRemote(unsignedEvent, 16);
            // mined.event tiene la tag nonce añadida; mined.id es el sha256 del serializado
            var eventForSigning = Object.assign({}, mined.event, { id: mined.id });

            // ---- Firmar con la identidad del user (NIP-07/NIP-46/nsec) ----
            var signed = await Config.events.sign(eventForSigning);

            // ---- Persistir en server (NSTR_TRADES con method='onchain') ----
            var fiatAmountStr = fiatAmountTag.length === 3
                ? fiatAmountTag[1] + '-' + fiatAmountTag[2]
                : fiatAmountTag[1];
            // trade_json arranca con metadata propia del maker (premium del orderbook + red) para que
            // acceptTake pueda congelar el sat_amount sin volver a buscar el evento Order.
            var initialTradeJson = JSON.stringify({
                premium: String(parseFloat(params.premium) || 0),
                network: orderNetwork,
                maker_nostr_pubkey: Config.events.pubkey,
                nostr_outbox_event: signed
            });
            try {
                var resp = await fetch(Config.ajaxUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        action:        'onchain_trade_add',
                        order_id:      orderId,
                        trade_kind:    params.kind,
                        trade_role:    'created',
                        trade_privkey: '',
                        trade_key_pub: tradePubkey,
                        trade_index:   String(tradeIndex),
                        is_seller:     params.kind === 'sell' ? '1' : '0',
                        sat_amount:    String(amount),
                        fiat_code:     fiatCode,
                        fiat_amount:   fiatAmountStr,
                        payment_method: params.paymentMethod || '',
                        arbitrators:   arbitrators.join(','),
                        internal_status: 'creado',
                        trade_json:    initialTradeJson
                    }).toString()
                }).then(function (r) { return r.json(); });
                if (!resp || resp.error || !resp.ok) throw new Error((resp && resp.msg) || 'Error al guardar la orden');
                _log('createOrder: persisted', resp);
            } catch (e) {
                _warn('createOrder: persist failed; no se publica:', e.message);
                throw e;
            }
            Config.pool.publish(signed);
            _log('createOrder: published', { orderId: orderId, eventId: signed.id, tradeIndex: tradeIndex,
                kind: params.kind, amount: amount, pow_iters: mined.iterations, pow_ms: mined.ms });
            if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                MostroTrader._trades[orderId] = {
                    method: 'onchain',
                    order_id: orderId,
                    trade_kind: params.kind,
                    trade_role: 'created',
                    trade_privkey: tradePrivkey,
                    trade_key_pub: tradePubkey,
                    trade_index: tradeIndex,
                    is_seller: params.kind === 'sell' ? 1 : 0,
                    sat_amount: amount,
                    fiat_code: fiatCode,
                    fiat_amount: fiatAmountStr,
                    payment_method: params.paymentMethod || '',
                    arbitrators: arbitrators.join(','),
                    internal_status: 'creado',
                    status: 'creado',
                    archived: 0,
                    trade_json: initialTradeJson,
                    updated_at: Math.floor(Date.now() / 1000)
                };
                if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            }

            return {
                orderId:     orderId,
                eventId:     signed.id,
                tradePubkey: tradePubkey,
                tradeIndex:  tradeIndex
            };
        },

        // Cancela una orden propia. Publica un evento NIP-09 (kind 5) con tag `a`
        // (`<kind>:<pubkey>:<d>`) que es la forma correcta de borrar eventos replaceable
        // addressable (kind 30000-39999). Borra también la fila local de NSTR_TRADES
        // y la caché en memoria de Book.
        //
        // Solo el creador de la orden puede cancelarla (los relays validan que la firma
        // del evento de borrado coincide con el pubkey del a-tag).
        cancelOrder: async function (orderId) {
            if (!Config.events || !Config.events.canSign()) {
                throw new Error('Noxtr.Events no puede firmar');
            }
            if (!Config.events.pubkey) {
                throw new Error('No hay pubkey de identidad cargada');
            }
            if (!orderId) throw new Error('orderId requerido');
            // Verificar que somos el maker (el creador de la orden)
            var _orderInBook = Book.orders[orderId];
            if (_orderInBook && _orderInBook.makerPubkey && _orderInBook.makerPubkey !== Config.events.pubkey) {
                throw new Error('Solo el maker puede cancelar su propia orden.');
            }

            var aTag = Config.KIND_ORDER + ':' + Config.events.pubkey + ':' + orderId;

            // 1. Publicar kind 5 (NIP-09) para relays que lo soportan
            var unsigned = await Config.events.create(5, '', [['a', aTag]]);
            var signed = await Config.events.sign(unsigned);
            Config.pool.publish(signed);
            _log('cancelOrder: NIP-09 deletion published', { orderId: orderId, eventId: signed.id });

            // 2. Publicar reemplazo kind 39383 con expires_at=0 (cancelación NIP-33).
            // Los relays NIP-33 compliant reemplazan el evento original con este.
            // _handleOnchainEvent descarta eventos expirados → orden desaparece al recargar.
            try {
                var existing = Book.orders[orderId];
                var orderType = (existing && existing.kind) ? existing.kind : 'sell';
                var cancelUnsigned = {
                    pubkey:     Config.events.pubkey,
                    kind:       Config.KIND_ORDER,
                    created_at: Math.floor(Date.now() / 1000),
                    tags:       [['d', orderId], ['y', Config.Y_TAG], ['k', orderType], ['expires_at', '1']],
                    content:    ''
                };
                var minedCancel = await PowMiner.mineRemote(cancelUnsigned, 16);
                var cancelEvent = Object.assign({}, minedCancel.event, { id: minedCancel.id });
                var signedCancel = await Config.events.sign(cancelEvent);
                Config.pool.publish(signedCancel);
                _log('cancelOrder: replacement event published', { orderId: orderId, replaceId: signedCancel.id });
            } catch (e) {
                _warn('cancelOrder: replacement event failed (kind 5 still sent):', e.message);
            }

            // 3. Borrar fila local en NSTR_TRADES (reusa endpoint Mostro existente)
            var deleted = false;
            try {
                var resp = await fetch(Config.ajaxUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        action:   'mostro_trade_delete',
                        order_id: orderId
                    }).toString()
                }).then(function (r) { return r.json(); });
                deleted = !!resp.ok;
                _log('cancelOrder: local row deleted', resp);
            } catch (e) {
                _warn('cancelOrder: local delete failed', e);
            }

            // 4. Borrar del cache en memoria de Book
            if (Book.orders[orderId]) delete Book.orders[orderId];

            return { eventId: signed.id, deleted: deleted };
        },

        // Retira el EVENTO de orden (kind 39383) del orderbook sin borrar la fila local de NSTR_TRADES.
        // Se usa al aceptar una toma: la fila order_id ya es el trade, pero su evento publico seguiria
        // mostrandose como disponible. Publica kind 5 (NIP-09) + reemplazo 39383 con expires_at=1
        // (NIP-33). A diferencia de cancelOrder, NO toca la BD (la fila es ahora el trade).
        _retireOrderEvent: async function (orderId, orderType) {
            if (!Config.events || !Config.events.canSign() || !Config.events.pubkey || !orderId) return;
            var aTag = Config.KIND_ORDER + ':' + Config.events.pubkey + ':' + orderId;
            try {
                var unsigned = await Config.events.create(5, '', [['a', aTag]]);
                Config.pool.publish(await Config.events.sign(unsigned));
            } catch (e) { _warn('_retireOrderEvent: kind5 failed', e); }
            try {
                var cancelUnsigned = {
                    pubkey:     Config.events.pubkey,
                    kind:       Config.KIND_ORDER,
                    created_at: Math.floor(Date.now() / 1000),
                    tags:       [['d', orderId], ['y', Config.Y_TAG], ['k', orderType || 'sell'], ['expires_at', '1']],
                    content:    ''
                };
                var minedCancel = await PowMiner.mineRemote(cancelUnsigned, 16);
                var cancelEvent = Object.assign({}, minedCancel.event, { id: minedCancel.id });
                Config.pool.publish(await Config.events.sign(cancelEvent));
            } catch (e) { _warn('_retireOrderEvent: replacement failed', e); }
            if (Book.orders[orderId]) delete Book.orders[orderId];
        },

        // ==================== HANDSHAKE: take_request + accept ====================

        _dmHandlerInitialized:        false,
        _dmSubId:                     null,
        _seenDmIds:                   {},          // dedup eventos kind 4 ya procesados
        _pendingTakeRequests:         {},          // orderId → [takeRequestData, ...]
        _tradeEventSubId:             null,
        _tradeEventListenerActive:    false,
        _seenTradeEventIds:           {},          // dedup eventos kinds 39385/86/87/89

        // Suscribe a kind 4 DMs dirigidos a nuestra pubkey y dispatcha mensajes
        // del protocolo NostrEscrow (type=take_request, etc.) a sus handlers.
        // Llamado automáticamente en Trader.init() si el user está logueado.
        _initDmHandler: function () {
            if (this._dmHandlerInitialized) return;
            if (!Config.events || !Config.events.pubkey) {
                _log('Trader._initDmHandler: sin pubkey identidad, listener inactivo');
                return;
            }
            if (!Config.pool) return;
            var DMs = window.Noxtr && window.Noxtr.DMs;
            if (!DMs || !DMs.decrypt) {
                _warn('Noxtr.DMs no disponible; take_request listener inactivo');
                return;
            }

            this._dmHandlerInitialized = true;
            var self = this;
            var since = Math.floor(Date.now() / 1000) - 90 * 86400;

            // Restaurar IDs ya procesados para no repetir notifs tras recarga
            try {
                var _saved = JSON.parse(localStorage.getItem('nxoc_seen_dms') || '[]');
                _saved.forEach(function(id) { self._seenDmIds[id] = true; });
            } catch(e) {}

            this._dmSubId = Config.pool.subscribe(
                [{ kinds: [4], '#p': [Config.events.pubkey], '#y': [Config.Y_TAG], since: since, limit: 1000 }],
                async function (ev, relayUrl) {
                    if (!ev || ev.kind !== 4) return;
                    if (ev.pubkey === Config.events.pubkey) return;       // ignorar mis propios envíos
                    if (self._seenDmIds[ev.id]) return;
                    if (!(await _verifyProtocolEvent(ev, 0))) {
                        _warn('DM NostrEscrow con firma/id invalido descartado', relayUrl || '');
                        return;
                    }
                    self._seenDmIds[ev.id] = true;
                    // Persistir suficientes IDs para que un historial grande no vuelva a pedir al
                    // firmador NIP-46 los mismos descifrados en cada recarga.
                    try {
                        var _ids = Object.keys(self._seenDmIds);
                        if (_ids.length > 6000) _ids = _ids.slice(-5000);
                        localStorage.setItem('nxoc_seen_dms', JSON.stringify(_ids));
                    } catch(e) {}

                    var plaintext;
                    try {
                        plaintext = await DMs.decrypt(ev.content, ev.pubkey);
                    } catch (e) { return; }
                    if (!plaintext || plaintext === '[encrypted]' || plaintext === '[encrypted - need privkey]' || plaintext === '[decryption failed]') return;

                    var msg;
                    try { msg = JSON.parse(plaintext); } catch (e) { return; }
                    if (!msg || typeof msg !== 'object' || !msg.type) return;

                    // Dispatch por tipo de mensaje del protocolo
                    if (msg.type === 'take_request') {
                        self._handleTakeRequestDm(ev, msg);
                    } else if (msg.type === 'coop_sign') {
                        if (UI && UI._receiveCoopSign) {
                            try { await UI._receiveCoopSign(ev, msg); } catch (e) { _warn('coop_sign handler failed', e); }
                        }
                    } else if (msg.type === 'arb_signature') {
                        try { await self._handleArbSignatureDm(ev, msg); } catch (e) { _warn('arb_signature handler failed', e); }
                    } else if (msg.type === 'dispute_request') {
                        // Lado arbitro (panel): se procesa en la fase B. Aqui solo lo registramos.
                        if (typeof Arbitrators !== 'undefined' && Arbitrators._handleDisputeRequest) {
                            try { await Arbitrators._handleDisputeRequest(ev, msg); } catch (e) { _warn('dispute_request handler failed', e); }
                        }
                    }
                }
            );
            _log('Trader._initDmHandler: listener kind 4 activo');
        },

        _handleTakeRequestDm: function (ev, msg) {
            var orderId = String(msg.order_id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            if (!orderId) return;
            var knownTrade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades)
                ? MostroTrader._trades[orderId] : null;
            if (_isArchivedTrade(knownTrade)) return;
            if (typeof msg.trade_pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(msg.trade_pubkey.toLowerCase())) {
                _warn('take_request DM con trade_pubkey inválido', msg);
                return;
            }
            try { nobleSecp256k1.Point.fromHex('02' + msg.trade_pubkey.toLowerCase()); }
            catch(e) { _warn('take_request DM con trade_pubkey fuera de curva'); return; }
            var requestedFiat = Number(msg.fiat_amount);
            if (!Number.isFinite(requestedFiat) || requestedFiat <= 0) return;

            var data = {
                orderId:           orderId,
                takerPubkey:       ev.pubkey,
                takerTradePubkey:  msg.trade_pubkey.toLowerCase(),
                takerTradeIndex:   parseInt(msg.trade_index, 10) || 0,
                fiatAmount:        requestedFiat,
                _eventId:          ev.id,
                received_at:       ev.created_at
            };
            if (!this._pendingTakeRequests[orderId]) this._pendingTakeRequests[orderId] = [];
            // Evitar duplicados por mismo event ID
            var _alreadyQueued = this._pendingTakeRequests[orderId].some(function(r) { return r._eventId === ev.id; });
            if (_alreadyQueued) return;
            this._pendingTakeRequests[orderId].push(data);
            try { localStorage.setItem('nxoc_pending_takes', JSON.stringify(this._pendingTakeRequests)); } catch(e) {}
            _log('take_request received', {
                orderId:    orderId.slice(0, 8),
                fromTaker:  ev.pubkey.slice(0, 8) + '…',
                fiat:       msg.fiat_amount,
                tradePub:   data.takerTradePubkey.slice(0, 8) + '…'
            });
            if (typeof notify === 'function') {
                notify(t(str_onchain_take_request, orderId.slice(0, 8), (data.fiatAmount || '?')), 'info', 0);
                if (window.NoxtrNotify) window.NoxtrNotify.push('📥 ' + t(str_notif_order_taken, orderId.slice(0, 8)),
                    t(str_onchain_take_request, orderId.slice(0, 8), (data.fiatAmount || '?')), { tag: 'noxtr-oc-' + orderId });
            }
            // Refrescar UI: orderbook (donde aparece el botón "N solicitudes") y mis trades.
            // Defer mínimo para que el evento DM termine de procesarse antes de re-render.
            setTimeout(async function () {
                if (typeof MostroTrader !== 'undefined' && MostroTrader._trades && !MostroTrader._trades[orderId] && MostroTrader.loadMyTrades) {
                    try { await MostroTrader.loadMyTrades(); } catch (e) { _warn('take_request loadMyTrades', e); }
                }
                if (typeof MostroBook !== 'undefined' && MostroBook.render) MostroBook.render();
                if (typeof MostroTrader !== 'undefined' && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            }, 50);
        },

        // Muestra un dialog con las solicitudes pendientes de toma para una orden propia.
        // El maker puede aceptar o rechazar cada una.
        openPendingTakesDialog: function (orderId) {
            var self = this;
            var reqs = this.getPendingTakeRequests(orderId);
            if (!reqs.length) {
                if (typeof notify === 'function') notify(str_no_pending_requests, 'info', 3000);
                return;
            }
            var html = '<div style="padding:4px">' +
                reqs.map(function (req, i) {
                    return '<div style="border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin-bottom:8px">' +
                        '<div style="font-size:0.82em;color:#888;margin-bottom:3px">' + str_from + ': <code style="font-size:0.95em">' +
                            req.takerPubkey.slice(0, 8) + '&hellip;' + req.takerPubkey.slice(-6) +
                        '</code></div>' +
                        '<div style="font-weight:600;font-size:1em;margin-bottom:8px">' + (req.fiatAmount || '?') + '</div>' +
                        '<button class="btn secondary nxoc-accept-btn" data-i="' + i + '" style="margin-right:8px;font-size:0.85em">' + str_accept + '</button>' +
                        '<button class="btn nxoc-reject-btn" data-i="' + i + '" style="color:#c62828;background:none;font-size:0.85em;border:1px solid #c62828">' + str_reject + '</button>' +
                        '</div>';
                }).join('') +
                '</div>';

            var _dc = $('body').dialog({
                title:   t(str_requests_offer_title, orderId.slice(0, 8)),
                type:    'html',
                content: html,
                width:   '400px',
                buttons: []
            });

            var _closeDialog = function() {
                if (_dc && _dc._dialogInstance) { try { _dc._dialogInstance.close(); } catch(e) {} }
                else {
                    var ov = document.querySelector('.wq-dialog-overlay:last-child');
                    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
                }
            };

            setTimeout(function () {
                var over = document.querySelector('.wq-dialog-overlay:last-child');
                if (!over) return;

                over.querySelectorAll('.nxoc-accept-btn').forEach(function (btn) {
                    btn.onclick = async function () {
                        var idx = parseInt(btn.dataset.i, 10);
                        var reqs = self.getPendingTakeRequests(orderId);
                        var req  = reqs[idx];
                        if (!req) return;
                        btn.disabled = true;
                        btn.textContent = str_accepting;
                        try {
                            await self.acceptTake(req);
                            _closeDialog();
                            if (typeof notify === 'function') {
                                notify(str_trade_accepted_chat_buyer, 'success', 6000);
                            }
                        } catch (e) {
                            btn.disabled = false;
                            btn.textContent = str_accept;
                            alert(t(str_accept_error, e.message));
                        }
                    };
                });

                over.querySelectorAll('.nxoc-reject-btn').forEach(function (btn) {
                    btn.onclick = function () {
                        var idx  = parseInt(btn.dataset.i, 10);
                        var list = self._pendingTakeRequests[orderId] || [];
                        list.splice(idx, 1);
                        if (!list.length) delete self._pendingTakeRequests[orderId];
                        try { localStorage.setItem('nxoc_pending_takes', JSON.stringify(self._pendingTakeRequests)); } catch(e) {}
                        _closeDialog();
                        if (!self.getPendingTakeRequests(orderId).length) {
                            if (typeof MostroTrader !== 'undefined' && MostroTrader.renderMyTrades) {
                                MostroTrader.renderMyTrades();
                            }
                        } else {
                            self.openPendingTakesDialog(orderId);
                        }
                    };
                });
            }, 50);
        },

        // Devuelve los take_requests pendientes (recibidos vía DM) para una orden propia.
        getPendingTakeRequests: function (orderId) {
            var list = this._pendingTakeRequests[orderId] || [];
            if (!list.length) return list;
            // La orden solo es tomable mientras su trade local no haya pasado de la fase de
            // aceptacion. Si ya esta aceptado/fondeado/completado, las solicitudes pendientes son
            // obsoletas: un take_request reentregado por el relay no debe revivir el boton
            // "N solicitudes" en una orden ya tomada o finalizada.
            var tr = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            if (tr && ['creado', 'pendiente_aceptacion'].indexOf(tr.internal_status) === -1) {
                return [];
            }
            return list;
        },

        // Listener de eventos públicos del protocolo: kinds 39385 (Trade State),
        // 39386 (Dispute), 39387 (Arbitration), 39389 (Funding Commitment).
        // Phase 2.4b: solo procesa kind 39385 action='accept' (taker actualiza estado).
        // Phase 2.5+ y Phase 4: añadirá fiat_sent, dispute, arbitration, etc.
        _initTradeEventListener: function () {
            if (this._tradeEventListenerActive) return;
            if (!Config.pool || !Config.events.pubkey) return;

            this._tradeEventListenerActive = true;
            var self = this;
            var since = Math.floor(Date.now() / 1000) - 365 * 86400;

            var tradeKinds = [Config.KIND_TRADE_STATE, Config.KIND_DISPUTE, Config.KIND_ARBITRATION, Config.KIND_FUNDING];
            this._tradeEventSubId = Config.pool.subscribe(
                [
                    // Eventos recibidos por esta identidad. Todos los eventos de trade emitidos
                    // por NostrEscrow llevan `p` para su contraparte (y las decisiones arbitrales,
                    // para ambas partes).
                    {
                        kinds: tradeKinds,
                        '#y':  [Config.Y_TAG],
                        '#p':  [Config.events.pubkey],
                        since: since,
                        limit: 5000
                    },
                    // Eventos propios necesarios al reconstruir el estado tras una recarga. El
                    // autor no se incluye a si mismo en `p`, por eso este segundo filtro.
                    {
                        kinds: tradeKinds,
                        '#y':  [Config.Y_TAG],
                        authors: [Config.events.pubkey],
                        since: since,
                        limit: 5000
                    }
                ],
                function (ev, relayUrl) {
                    if (!ev || !ev.id) return;
                    if (self._seenTradeEventIds[ev.id]) return;
                    self._handleTradeEvent(ev, relayUrl);
                }
            );
            _log('Trader._initTradeEventListener: kinds 39385/39386/39387/39389 subscribed');
        },

        _handleTradeEvent: async function (ev, relayUrl) {
            var minPow = ev && ev.kind === Config.KIND_RATING ? 8 : 12;
            if (!(await _verifyProtocolEvent(ev, minPow))) {
                _warn('Evento NostrEscrow invalido descartado', { kind: ev && ev.kind, relay: relayUrl || '' });
                return;
            }
            // No marcar como visto antes de verificar: una copia con el mismo id pero firma
            // inválida podría llegar primero desde otro relay y bloquear el evento auténtico.
            if (this._seenTradeEventIds[ev.id]) return;
            this._seenTradeEventIds[ev.id] = true;
            var y = _getTagValue(ev, 'y');
            if (y !== Config.Y_TAG) return;
            var eventOrderId = _eventOrderId(ev);
            var knownTrade = eventOrderId && typeof MostroTrader !== 'undefined' && MostroTrader._trades
                ? MostroTrader._trades[eventOrderId] : null;
            if (_isArchivedTrade(knownTrade)) return;
            var action = _getTagValue(ev, 'action');

            // Phase 2.4b: solo accept event para el taker
            if (ev.kind === Config.KIND_TRADE_STATE && action === 'accept') {
                await this._handleAcceptEventAsTaker(ev);
            }
            if (ev.kind === Config.KIND_TRADE_STATE && action === 'arbitrators') {
                await this._handleArbitratorsEvent(ev);
            }
            if (ev.kind === Config.KIND_TRADE_STATE && action === 'address_check') {
                await this._handleAddressCheckEvent(ev);
            }
            if (ev.kind === Config.KIND_TRADE_STATE && (action === 'fiat_sent' || action === 'fiat_received')) {
                await this._handleFiatStateEvent(ev, action);
            }
            if (ev.kind === Config.KIND_TRADE_STATE && action === 'buyer_payout') {
                await this._handleBuyerPayoutEvent(ev);
            }
            if (ev.kind === Config.KIND_TRADE_STATE && action === 'complete') {
                await this._handleCompleteEvent(ev);
            }
            if (ev.kind === Config.KIND_FUNDING) {
                await this._handleFundingEvent(ev);
            }
            if (ev.kind === Config.KIND_DISPUTE) {
                await this._handleDisputeEvent(ev);
            }
            if (ev.kind === Config.KIND_ARBITRATION) {
                await this._handleArbitrationEvent(ev);
            }
            // Phase 2.x posterior: cancel
        },

        // Construye y publica un kind 39385 de estado de trade (fiat_sent | fiat_received |
        // buyer_payout | ...). d = order_id (el resto de handlers buscan el trade local por order_id).
        // Incluye maker/taker/p/network para que el receptor valide procedencia (mismo guard que el
        // resto). extraTags: tags adicionales especificas de la accion.
        _publishTradeAction: async function (trade, action, extraTags) {
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            var meta = _readMeta(trade);
            var peerNostrPubkey = (trade.trade_role === 'taken')
                ? meta.maker_nostr_pubkey : meta.taker_nostr_pubkey;
            var tags = [
                ['d',       trade.order_id + ':' + action],
                ['order_id', trade.order_id],
                ['y',       Config.Y_TAG],
                ['action',  action],
                ['network', _tradeNetwork(trade)]
            ];
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            if (meta.maker_nostr_pubkey) tags.push(['maker', String(meta.maker_nostr_pubkey)]);
            else if (trade.trade_role === 'created') tags.push(['maker', Config.events.pubkey]);
            if (meta.taker_nostr_pubkey) tags.push(['taker', String(meta.taker_nostr_pubkey)]);
            else if (trade.trade_role === 'taken') tags.push(['taker', Config.events.pubkey]);
            if (peerNostrPubkey) tags.push(['p', String(peerNostrPubkey)]);
            if (Array.isArray(extraTags)) extraTags.forEach(function(tg) { if (tg) tags.push(tg); });
            var unsigned = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_TRADE_STATE,
                created_at: Math.floor(Date.now() / 1000),
                tags:       tags,
                content:    ''
            };
            var mined  = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });
            var signed = await Config.events.sign(withId);
            await this._publishDurable(trade, signed);
            _log('publishTradeAction:', action, { orderId: trade.order_id.slice(0, 8), eventId: signed.id });
            return signed;
        },
        publishFiatSent:     function (trade) { return this._publishTradeAction(trade, 'fiat_sent'); },
        publishFiatReceived: function (trade) { return this._publishTradeAction(trade, 'fiat_received'); },
        publishBuyerPayout:  function (trade, address) {
            return this._publishTradeAction(trade, 'buyer_payout', [['payout_address', String(address || '')]]);
        },
        publishComplete:     function (trade, txid) {
            return this._publishTradeAction(trade, 'complete', [['txid', String(txid || '')]]);
        },

        // ==================== RATINGS (kind 39384) ====================

        // Publica una valoracion (kind 39384) tras un trade on-chain. Replaceable por (rater, ratee, trade)
        // gracias al `d` compuesto: la misma persona puede actualizar su rating publicando otra vez.
        // role='trader' = valoracion de contraparte; 'arbiter' = valoracion del arbitro que medio (Fase 2).
        // stars 1-5 + bucket positive|neutral|negative (1-2 neg, 3 neu, 4-5 pos) para que
        // Arbitrators._fetchReputation siga sumando con su esquema actual sin reescribirlo todo.
        publishOnchainRating: async function (trade, stars, comment, role) {
            if (!Config.events || !Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            stars = parseInt(stars, 10);
            if ([1, 2, 3, 4, 5].indexOf(stars) === -1) throw new Error('stars debe ser 1..5');
            role = (role === 'arbiter') ? 'arbiter' : 'trader';
            var ratee = '';
            if (role === 'trader') {
                ratee = _peerNostrPubkey(trade);
                if (!ratee) throw new Error('Sin pubkey nostr de la contraparte');
            } else {
                // Fase 2: derivar arbitro ganador desde meta.dispute_winner + arb_index. Stub por ahora.
                throw new Error('Rating al arbitro no implementado todavia');
            }
            var bucket = stars >= 4 ? 'positive' : (stars <= 2 ? 'negative' : 'neutral');
            var meta = _readMeta(trade);
            var tags = [
                ['d',       trade.order_id + ':' + ratee],
                ['order_id', trade.order_id],
                ['p',       ratee],
                ['y',       Config.Y_TAG],
                ['network', _tradeNetwork(trade)],
                ['stars',   String(stars)],
                ['rating',  bucket],
                ['role',    role]
            ];
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            // Dato del trade real al que se ancla la valoracion: permite auditar on-chain (el funding
            // existe en la cadena pagando la direccion escrow derivada de ambas trade keys).
            if (trade.funding_txid) tags.push(['funding_txid', String(trade.funding_txid)]);
            var unsigned = {
                pubkey: Config.events.pubkey,
                kind: Config.KIND_RATING,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: String(comment || '').slice(0, 240)
            };
            var mined  = await PowMiner.mineRemote(unsigned, 12);
            var signed = await Config.events.sign(Object.assign({}, mined.event, { id: mined.id }));
            await this._publishDurable(trade, signed);
            _log('onchain rating publicada', { orderId: trade.order_id.slice(0, 8), ratee: ratee.slice(0, 8) + '…', stars: stars, role: role });
            return signed;
        },

        // Listener de ratings entrantes (kind 39384 con #p = mi pubkey). Notifica + loguea en
        // NSTR_EVENTS (action 'onchain-rate-received') para que el widget de reputacion los lea.
        _initRatingListener: function () {
            if (this._ratingListenerActive) return;
            if (!Config.pool || !Config.events || !Config.events.pubkey) return;
            this._ratingListenerActive = true;
            var self = this;
            this._seenRatingIds = this._seenRatingIds || {};
            // Restaurar ids ya vistos para no repetir el aviso tras recargar: la suscripcion re-pide el
            // ultimo mes en cada arranque y el relay reentrega los ratings (eventos persistentes). Sin
            // esto, cada recarga re-notificaba todas las valoraciones del ultimo mes.
            try {
                JSON.parse(localStorage.getItem('nxoc_seen_ratings') || '[]').forEach(function (id) { self._seenRatingIds[id] = true; });
            } catch (e) {}
            var since = Math.floor(Date.now() / 1000) - 30 * 86400;     // ultimo mes
            this._ratingSubId = Config.pool.subscribe(
                [{ kinds: [Config.KIND_RATING], '#y': [Config.Y_TAG], '#p': [Config.events.pubkey], since: since, limit: 500 }],
                function (ev) { self._handleRatingEvent(ev); }
            );
            _log('Trader._initRatingListener: kind 39384 subscribed');
        },

        _handleRatingEvent: async function (ev) {
            if (!ev || ev.kind !== Config.KIND_RATING) return;
            if (!(await _verifyProtocolEvent(ev, 8))) return;
            if (ev.pubkey === Config.events.pubkey) return;        // mis propios envios
            if (_getTagValue(ev, 'y') !== Config.Y_TAG) return;
            if (this._seenRatingIds[ev.id]) return;
            this._seenRatingIds[ev.id] = true;
            try {
                var _rids = Object.keys(this._seenRatingIds);
                if (_rids.length > 600) _rids = _rids.slice(-500);
                localStorage.setItem('nxoc_seen_ratings', JSON.stringify(_rids));
            } catch (e) {}
            var orderId = _eventOrderId(ev);
            var stars = parseInt(_getTagValue(ev, 'stars'), 10);
            var role = (_getTagValue(ev, 'role') || 'trader').toLowerCase();
            if (!orderId || !(stars >= 1 && stars <= 5)) return;
            try {
                await _ajax('log_mostro_event', {
                    event_id:         ev.id,
                    kind:             ev.kind,
                    order_id:         orderId,
                    event_created_at: ev.created_at,
                    source:           'client_in',
                    status:           'onchain-rate-received',
                    raw_json:         JSON.stringify({ stars: stars, role: role, from: ev.pubkey, content: ev.content || '' })
                });
            } catch(e) { _warn('rate log failed', e); }
            if (typeof notify === 'function') {
                notify((stars === 1 ? window.t(str_oc_rated_you_one, stars, orderId.slice(0, 8)) : window.t(str_oc_rated_you_many, stars, orderId.slice(0, 8))) + (role === 'arbiter' ? str_oc_as_arbiter : ''),
                    'info', 8000);
            }
        },

        // ==================== DISPUTA (paso 15, lado partes) ====================

        // Nostr pubkeys de los arbitros del trade (desde el pool de Arbitrators, por pubkey_btc).
        _arbNostrPubkeys: function (trade) {
            var out = [];
            if (typeof Arbitrators === 'undefined' || !Arbitrators.pool) return out;
            UI.arbitrators(trade).forEach(function (btc) {
                var e = Arbitrators.pool[btc];
                if (e && /^[a-f0-9]{64}$/.test(String(e.nostr_pubkey || ''))) out.push(e.nostr_pubkey);
            });
            return out;
        },

        // Abre una disputa: publica kind 39386 (reason/initiator) y manda un dispute_request DM a arb1
        // con todo el contexto del trade (el arbitro no es parte y no tiene la fila local). Estado -> disputado.
        publishDispute: async function (trade, reason) {
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            var meta = _readMeta(trade);
            var initiator = parseInt(trade.is_seller, 10) ? 'seller' : 'buyer';
            var peerNostr = _peerNostrPubkey(trade);
            var tags = [
                ['d',         trade.order_id + ':dispute'],
                ['order_id',  trade.order_id],
                ['y',         Config.Y_TAG],
                ['reason',    String(reason || '')],
                ['initiator', initiator],
                ['network',   _tradeNetwork(trade)]
            ];
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            if (peerNostr) tags.push(['p', peerNostr]);
            var unsigned = {
                pubkey: Config.events.pubkey, kind: Config.KIND_DISPUTE,
                created_at: Math.floor(Date.now() / 1000), tags: tags, content: String(reason || '')
            };
            var mined  = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });
            var signed = await Config.events.sign(withId);
            await this._publishDurable(trade, signed);
            _log('publishDispute', { orderId: trade.order_id.slice(0, 8), initiator: initiator });
            try { await this._sendDisputeRequest(trade, reason, initiator); }
            catch(e) { _warn('dispute_request DM failed', e); }
            return signed;
        },

        // DM 'dispute_request' a los tres árbitros. Cada uno solo podrá crear una transacción
        // válida cuando madure el CSV de su slot; entregar el expediente desde el principio evita
        // que la cascada dependa de que arb1 reenvíe nada cuando está ausente.
        _sendDisputeRequest: async function (trade, reason, initiator) {
            var DMs = window.Noxtr && window.Noxtr.DMs;
            if (!DMs || !DMs.encrypt) throw new Error('Noxtr.DMs no disponible');
            var keys = UI.fundingKeys(trade);
            var arbs = UI.arbitrators(trade);
            if (!keys || arbs.length !== 3) throw new Error('Faltan claves o arbitros');
            var meta = _readMeta(trade);
            var iAmSeller = !!parseInt(trade.is_seller, 10);
            var payload = {
                type:                  'dispute_request',
                order_id:              trade.order_id,
                trade_id:              meta.trade_id || '',
                network:               _tradeNetwork(trade),
                reason:                String(reason || ''),
                initiator:             initiator,
                taproot_address:       trade.taproot_address,
                funding_txid:          trade.funding_txid,
                funding_vout:          parseInt(trade.funding_vout, 10) || 0,
                funding_value:         parseInt(meta.funding_value, 10) || 0,
                sat_amount:            parseInt(trade.sat_amount, 10) || 0,
                arb_fee_sats:          parseInt(meta.arb_fee_sats, 10) || 0,
                arbitrators:           arbs.join(','),
                seller_trade_pubkey:   keys.seller,
                buyer_trade_pubkey:    keys.buyer,
                buyer_payout_address:  meta.buyer_payout_address || '',
                seller_payout_address: meta.seller_payout_address || '',
                seller_nostr_pubkey:   iAmSeller ? Config.events.pubkey : _peerNostrPubkey(trade),
                buyer_nostr_pubkey:    iAmSeller ? _peerNostrPubkey(trade) : Config.events.pubkey,
                maker_nostr_pubkey:    trade.trade_role === 'created' ? Config.events.pubkey : _peerNostrPubkey(trade),
                taker_nostr_pubkey:    trade.trade_role === 'taken' ? Config.events.pubkey : _peerNostrPubkey(trade)
            };
            var delivered = {}, sent = 0;
            for (var i = 0; i < arbs.length; i++) {
                var arbEntry = (typeof Arbitrators !== 'undefined' && Arbitrators.pool) ? Arbitrators.pool[arbs[i]] : null;
                var arbNostr = arbEntry && arbEntry.nostr_pubkey;
                if (!/^[a-f0-9]{64}$/.test(String(arbNostr || '')) || delivered[arbNostr]) continue;
                delivered[arbNostr] = true;
                var perArb = Object.assign({}, payload, { arb_index: i + 1 });
                var ciphertext = await DMs.encrypt(JSON.stringify(perArb), arbNostr);
                var unsigned   = await Config.events.create(4, ciphertext, [['p', arbNostr], ['y', Config.Y_TAG]]);
                Config.pool.publish(await Config.events.sign(unsigned));
                sent++;
            }
            if (!sent) throw new Error('Ningun arbitro tiene pubkey Nostr verificable en el pool');
            _log('dispute_request enviado a arbitros', { orderId: trade.order_id.slice(0, 8), sent: sent });
        },

        // kind 39386 entrante de la contraparte: marca el trade local como disputado.
        _handleDisputeEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            if (!orderId || ev.pubkey === Config.events.pubkey) return;
            var localResp;
            try { localResp = await _ajax('mostro_trade_get', { order_id: orderId }); } catch(e) { return; }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('dispute: contract mismatch', orderId.slice(0, 8)); return; }
            var expectedPeer = _peerNostrPubkey(trade);
            if (expectedPeer && ev.pubkey !== expectedPeer) { _warn('dispute: untrusted', orderId.slice(0, 8)); return; }
            if (['completado', 'cancelado', 'disputado'].indexOf(trade.internal_status) !== -1) return;
            var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            if (UI && UI._saveCoop) await UI._saveCoop(live || trade, {}, 'disputado');
            if (typeof notify === 'function') notify(str_dispute_opened_by_peer, 'warn', 0);
            if (window.NoxtrNotify) window.NoxtrNotify.push('⚖️ ' + t(str_notif_dispute_n, (orderId||'').slice(0, 8)),
                str_dispute_opened_by_peer, { tag: 'noxtr-oc-dispute-' + orderId });
        },

        // kind 39387 entrante (decision publica del arbitro): registra el ganador (informativo; la
        // liquidacion la dispara el DM arb_signature). Valida que el emisor sea un arbitro del trade.
        _handleArbitrationEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            var winner  = _getTagValue(ev, 'winner');
            if (!orderId) return;
            var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            if (!live || live.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, live)) { _trace('arbitration: contract mismatch', orderId.slice(0, 8)); return; }
            var arbIndex = parseInt(_getTagValue(ev, 'arb_index'), 10);
            var arbBtc = [1, 2, 3].indexOf(arbIndex) !== -1 ? UI.arbitrators(live)[arbIndex - 1] : '';
            var arbEntry = arbBtc && Arbitrators.pool ? Arbitrators.pool[arbBtc] : null;
            if (!arbEntry || arbEntry.nostr_pubkey !== ev.pubkey) { _warn('arbitration: untrusted arb/slot', orderId.slice(0, 8)); return; }
            live._arbWinner = (winner === 'seller' || winner === 'buyer') ? winner : '';
            if (typeof notify === 'function') notify(t(str_arbitration_decided, live._arbWinner || '?'), 'info', 0);
            if (window.NoxtrNotify) window.NoxtrNotify.push('⚖️ ' + t(str_notif_trade_update, (orderId||'').slice(0, 8)),
                t(str_arbitration_decided, live._arbWinner || '?'), { tag: 'noxtr-oc-arb-' + orderId });
            if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
        },

        // DM 'arb_signature': el arbitro envia su firma de la hoja al ganador. Si soy el ganador,
        // delego en UI.settleArbitration (reconstruye, verifica, firma, ensambla, difunde y cierra).
        _handleArbSignatureDm: async function (ev, msg) {
            var orderId = String(msg.order_id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            if (!orderId) return;
            var trade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            if (!trade) { try { var r = await _ajax('mostro_trade_get', { order_id: orderId }); if (!r.error) trade = r.trade; } catch(e) {} }
            if (!trade || trade.method !== 'onchain' || _isArchivedTrade(trade)) return;
            var dmMeta = _readMeta(trade);
            if (String(msg.network || '') !== _tradeNetwork(trade) ||
                (dmMeta.trade_id && String(msg.trade_id || '') !== String(dmMeta.trade_id))) {
                _warn('arb_signature: contrato/red no coinciden', orderId.slice(0, 8)); return;
            }
            var arbIndex   = parseInt(msg.arb_index, 10);
            var winnerSide = (msg.winner_side === 'seller') ? 'seller' : 'buyer';
            var mySide     = parseInt(trade.is_seller, 10) ? 'seller' : 'buyer';
            if (winnerSide !== mySide) { _log('arb_signature: no soy el ganador', orderId.slice(0, 8)); return; }
            if ([1, 2, 3].indexOf(arbIndex) === -1) { _warn('arb_signature: arb_index invalido'); return; }
            var arbBtc   = UI.arbitrators(trade)[arbIndex - 1];
            var arbEntry = (typeof Arbitrators !== 'undefined' && Arbitrators.pool) ? Arbitrators.pool[arbBtc] : null;
            if (!arbEntry || ev.pubkey !== arbEntry.nostr_pubkey) { _warn('arb_signature: emisor no es el arbitro esperado', orderId.slice(0, 8)); return; }
            var arbSig = String(msg.arb_sig || '');
            if (!/^[a-f0-9]{128}$/i.test(arbSig)) { _warn('arb_signature: sig invalida'); return; }
            var payoutAddr = String(msg.winner_payout_address || '');
            if (UI && UI.settleArbitration) await UI.settleArbitration(trade, winnerSide, arbIndex, parseInt(msg.fee_sats, 10) || 0, msg.tx_hex, arbSig, payoutAddr);
        },

        // Recibe un fiat_sent (lo procesa el vendedor) o fiat_received (lo procesa el comprador).
        // Valida procedencia (peer esperado) + red + rol, y avanza el estado local.
        _handleFiatStateEvent: async function (ev, action) {
            var orderId = _eventOrderId(ev);
            if (!orderId) return;
            var isSelfEvent = ev.pubkey === Config.events.pubkey;

            var localResp;
            try { localResp = await _ajax('mostro_trade_get', { order_id: orderId }); }
            catch(e) { _warn('handleFiatStateEvent: AJAX error', e); return; }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleFiatStateEvent: contract mismatch', orderId.slice(0, 8)); return; }

            // Red: el evento debe coincidir con la red del trade.
            var evNet = _normalizeNetwork(_getTagValue(ev, 'network') || _tradeNetwork(trade));
            if (evNet !== _tradeNetwork(trade)) {
                _warn('handleFiatStateEvent: network mismatch', { orderId: orderId.slice(0,8), ev: evNet, trade: _tradeNetwork(trade) });
                return;
            }

            // Procedencia: solo aceptamos el evento del peer conocido.
            var meta = _readMeta(trade);
            var expectedPeer = (trade.trade_role === 'created') ? meta.taker_nostr_pubkey : meta.maker_nostr_pubkey;
            var tagMaker = _getTagValue(ev, 'maker');
            var tagTaker = _getTagValue(ev, 'taker');
            var pTags = _getTagValues(ev, 'p');
            var concernsMe = pTags.indexOf(Config.events.pubkey) !== -1 || tagMaker === Config.events.pubkey || tagTaker === Config.events.pubkey;
            var peerMatches = expectedPeer ? (ev.pubkey === expectedPeer) : (ev.pubkey === tagMaker || ev.pubkey === tagTaker);
            if (!isSelfEvent && (!concernsMe || !peerMatches)) {
                _warn('handleFiatStateEvent: ignored unrelated/untrusted', { orderId: orderId.slice(0,8), from: ev.pubkey.slice(0,8) });
                return;
            }

            var isSeller = parseInt(trade.is_seller, 10) === 1;
            var newStatus = null;
            if (action === 'fiat_sent') {
                // Peer: lo procesa el vendedor. Replay propio: lo emitió el comprador.
                if ((!isSelfEvent && !isSeller) || (isSelfEvent && isSeller)) return;
                if (['fiat_enviado','fiat_received','completado','cancelado','disputado'].indexOf(trade.internal_status) !== -1) return;
                newStatus = 'fiat_enviado';
            } else { // fiat_received
                // Peer: lo procesa el comprador. Replay propio: lo emitió el vendedor.
                if ((!isSelfEvent && isSeller) || (isSelfEvent && !isSeller)) return;
                if (['fiat_received','firmando','completado','cancelado','disputado'].indexOf(trade.internal_status) !== -1) return;
                newStatus = 'fiat_received';
            }

            try {
                // Escribimos los tres campos iguales: el normalizador promociona internal_status al
                // mayor rank entre internal/status/action, y fiat_received(13) < fiat_enviado(14);
                // igualarlos evita que una lectura revierta el estado.
                await _ajax('mostro_trade_update', {
                    order_id: orderId,
                    fields: { internal_status: newStatus, status: newStatus, trade_action: newStatus }
                });
                var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
                if (live) {
                    live.internal_status = newStatus; live.status = newStatus; live.trade_action = newStatus;
                    live.updated_at = Math.floor(Date.now() / 1000);
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                if (typeof notify === 'function') {
                    notify(action === 'fiat_sent' ? str_buyer_marked_fiat_sent : str_fiat_received_unlocks_sign, 'info', 7000);
                }
                if (window.NoxtrNotify) window.NoxtrNotify.push('⚠️ ' + t(str_notif_action_needed, (orderId||'').slice(0, 8)),
                    action === 'fiat_sent' ? str_buyer_marked_fiat_sent : str_fiat_received_unlocks_sign, { tag: 'noxtr-oc-fiat-' + orderId });
            } catch(e) {
                _warn('handleFiatStateEvent: persist failed', e);
            }
        },

        // Recibe un kind 39385 action=complete: la contraparte ha difundido la TX de liberacion.
        // Marca el trade como completado (terminal) y guarda el release txid. Lo puede emitir
        // cualquiera de las dos partes tras el broadcast (sec 12.1 paso 16).
        _handleCompleteEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            var txid    = String(_getTagValue(ev, 'txid') || '').toLowerCase();
            if (!orderId) return;
            if (ev.pubkey === Config.events.pubkey) return;     // evento propio: ya marcamos al difundir
            var localResp;
            try { localResp = await _ajax('mostro_trade_get', { order_id: orderId }); }
            catch(e) { _warn('handleCompleteEvent: AJAX error', e); return; }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleCompleteEvent: contract mismatch', orderId.slice(0, 8)); return; }
            // Procedencia: solo la contraparte conocida.
            var expectedPeer = _peerNostrPubkey(trade);
            if (expectedPeer && ev.pubkey !== expectedPeer) { _warn('handleCompleteEvent: untrusted', orderId.slice(0,8)); return; }
            if (['completado','cancelado'].indexOf(trade.internal_status) !== -1) return;
            var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            var target = live || trade;
            // La contraparte dice haber difundido, pero NO marcamos 'completado' a ciegas: guardamos el
            // txid y lo verificamos en cadena. _refreshReleaseTx promueve a 'completado' solo con >=1 conf.
            if (!/^[0-9a-f]{64}$/.test(txid)) return;
            if (UI && UI._saveCoop) await UI._saveCoop(target, { release_txid: txid, release_dropped: 0 });
            if (UI && UI._refreshReleaseTx) { try { await UI._refreshReleaseTx(target); } catch(e) {} }
            if (typeof notify === 'function') notify(str_release_awaiting, 'info', 7000);
        },

        // El comprador anuncia su direccion de cobro (kind 39385 action=buyer_payout). Lo procesa el
        // vendedor, que la guarda en su trade_json para construir luego el gasto cooperativo (Parte 2.3).
        _handleBuyerPayoutEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            var addr    = String(_getTagValue(ev, 'payout_address') || '').trim();
            if (!orderId || !addr) return;
            if (ev.pubkey === Config.events.pubkey) return;

            var localResp;
            try { localResp = await _ajax('mostro_trade_get', { order_id: orderId }); }
            catch(e) { _warn('handleBuyerPayoutEvent: AJAX error', e); return; }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleBuyerPayoutEvent: contract mismatch', orderId.slice(0, 8)); return; }
            if (parseInt(trade.is_seller, 10) !== 1) return;   // solo el vendedor guarda la dir del comprador

            var net = _tradeNetwork(trade);
            var evNet = _normalizeNetwork(_getTagValue(ev, 'network') || net);
            if (evNet !== net) { _warn('handleBuyerPayoutEvent: network mismatch', orderId.slice(0,8)); return; }
            if (!(await _isValidPayoutAddressStrict(addr, net))) { _warn('handleBuyerPayoutEvent: invalid address', orderId.slice(0,8)); return; }

            // Procedencia: el vendedor espera al comprador (peer). Mismo guard que el resto.
            var meta = _readMeta(trade);
            var expectedPeer = (trade.trade_role === 'created') ? meta.taker_nostr_pubkey : meta.maker_nostr_pubkey;
            var tagMaker = _getTagValue(ev, 'maker');
            var tagTaker = _getTagValue(ev, 'taker');
            var pTags = _getTagValues(ev, 'p');
            var concernsMe = pTags.indexOf(Config.events.pubkey) !== -1 || tagMaker === Config.events.pubkey || tagTaker === Config.events.pubkey;
            var peerMatches = expectedPeer ? (ev.pubkey === expectedPeer) : (ev.pubkey === tagMaker || ev.pubkey === tagTaker);
            if (!concernsMe || !peerMatches) {
                _warn('handleBuyerPayoutEvent: ignored unrelated/untrusted', { orderId: orderId.slice(0,8), from: ev.pubkey.slice(0,8) });
                return;
            }

            try {
                var merged = _mergeMeta(trade, { buyer_payout_address: addr });
                await _ajax('mostro_trade_update', { order_id: orderId, fields: { trade_json: merged } });
                var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
                if (live) {
                    live.trade_json = merged;
                    live.updated_at = Math.floor(Date.now() / 1000);
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                if (typeof notify === 'function') notify(t(str_payout_buyer_set, addr), 'info', 6000);
            } catch(e) {
                _warn('handleBuyerPayoutEvent: persist failed', e);
            }
        },

        publishArbitratorsUpdate: async function (trade, arbitrators) {
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            if (trade.taproot_address || trade.funding_txid) {
                throw new Error('No se pueden cambiar arbitros con direccion/funding ya generado');
            }
            var csv = _arbitratorsCsv(arbitrators || String(trade.arbitrators || '').split(','));
            if (!csv) throw new Error('Arbitros invalidos');
            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var peerNostrPubkey = meta.taker_nostr_pubkey || meta.maker_nostr_pubkey || '';
            var tags = [
                ['d',          trade.order_id + ':arbitrators'],
                ['order_id',   trade.order_id],
                ['y',          Config.Y_TAG],
                ['action',     'arbitrators'],
                ['arbitrators', csv]
            ];
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            if (meta.maker_nostr_pubkey) tags.push(['maker', String(meta.maker_nostr_pubkey)]);
            else if (parseInt(trade.trade_role === 'created' ? 1 : 0, 10)) tags.push(['maker', Config.events.pubkey]);
            if (meta.taker_nostr_pubkey) tags.push(['taker', String(meta.taker_nostr_pubkey)]);
            else if (trade.trade_role === 'taken') tags.push(['taker', Config.events.pubkey]);
            if (peerNostrPubkey) tags.push(['p', String(peerNostrPubkey)]);

            var unsigned = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_TRADE_STATE,
                created_at: Math.floor(Date.now() / 1000),
                tags:       tags,
                content:    ''
            };
            var mined = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });
            var signed = await Config.events.sign(withId);
            await this._publishDurable(trade, signed);
            _log('publishArbitratorsUpdate: event published', {
                orderId: trade.order_id.slice(0, 8),
                eventId: signed.id
            });
            if (typeof notify === 'function') notify(str_arbs_updated_published, 'info', 6000);
            return signed;
        },

        // Spec v2.7: verificacion bilateral de la direccion escrow. Cada parte publica la direccion
        // derivada localmente; el peer compara con la suya y, si coincide, marca verificado y a su vez
        // emite el suyo para cerrar el ciclo. Si no coincide → notify y ninguno marca verificado.
        // No persistimos flags en BD: los eventos viven en los relays y se re-procesan al recargar.
        publishAddressCheck: async function (trade) {
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            if (trade._addressCheckPublished) return null;
            var address = String(trade.taproot_address || '').trim();
            if (!address) throw new Error('No hay direccion escrow derivada todavia');

            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var peerNostrPubkey = meta.taker_nostr_pubkey || meta.maker_nostr_pubkey || '';
            var tags = [
                ['d',       trade.order_id + ':address_check'],
                ['order_id', trade.order_id],
                ['y',       Config.Y_TAG],
                ['action',  'address_check'],
                ['address', address]
            ];
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            if (meta.maker_nostr_pubkey) tags.push(['maker', String(meta.maker_nostr_pubkey)]);
            else if (trade.trade_role === 'created') tags.push(['maker', Config.events.pubkey]);
            if (meta.taker_nostr_pubkey) tags.push(['taker', String(meta.taker_nostr_pubkey)]);
            else if (trade.trade_role === 'taken') tags.push(['taker', Config.events.pubkey]);
            if (peerNostrPubkey) tags.push(['p', String(peerNostrPubkey)]);

            var unsigned = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_TRADE_STATE,
                created_at: Math.floor(Date.now() / 1000),
                tags:       tags,
                content:    ''
            };
            var mined = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });
            var signed = await Config.events.sign(withId);
            await this._publishDurable(trade, signed);
            trade._addressCheckPublished = true;
            _log('publishAddressCheck: event published', {
                orderId: trade.order_id.slice(0, 8),
                eventId: signed.id,
                address: address.slice(0, 12)
            });
            if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            return signed;
        },

        _handleArbitratorsEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            var csv = _arbitratorsCsv(String(_getTagValue(ev, 'arbitrators') || '').split(','));
            if (!orderId || !csv) return;
            if (ev.pubkey === Config.events.pubkey) return;

            var localResp;
            try {
                localResp = await _ajax('mostro_trade_get', { order_id: orderId });
            } catch (e) {
                _warn('handleArbitratorsEvent: AJAX error', e);
                return;
            }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleArbitratorsEvent: contract mismatch', orderId.slice(0, 8)); return; }
            if (trade.taproot_address || trade.funding_txid) {
                _warn('handleArbitratorsEvent: ignored locked trade', orderId);
                return;
            }

            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var expectedPeer = parseInt(trade.trade_role === 'created' ? 1 : 0, 10)
                ? meta.taker_nostr_pubkey
                : meta.maker_nostr_pubkey;
            var tagMaker = _getTagValue(ev, 'maker');
            var tagTaker = _getTagValue(ev, 'taker');
            var pTags = _getTagValues(ev, 'p');
            var concernsMe = pTags.indexOf(Config.events.pubkey) !== -1 ||
                tagMaker === Config.events.pubkey ||
                tagTaker === Config.events.pubkey;
            var peerMatches = expectedPeer
                ? ev.pubkey === expectedPeer
                : (ev.pubkey === tagMaker || ev.pubkey === tagTaker);
            if (!concernsMe || !peerMatches) {
                _warn('handleArbitratorsEvent: ignored unrelated/untrusted event', {
                    orderId: orderId,
                    from: ev.pubkey,
                    expectedPeer: expectedPeer || '',
                    maker: tagMaker || '',
                    taker: tagTaker || ''
                });
                return;
            }

            try {
                await _ajax('mostro_trade_update', {
                    order_id: orderId,
                    fields: { arbitrators: csv, taproot_address: '' }
                });
                if (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[orderId]) {
                    MostroTrader._trades[orderId].arbitrators = csv;
                    MostroTrader._trades[orderId].taproot_address = '';
                    MostroTrader._trades[orderId]._taprootDetails = null;
                    MostroTrader._trades[orderId]._taprootError = '';
                    // El set cambio: cualquier verificacion previa de direccion queda invalidada.
                    MostroTrader._trades[orderId]._addressCheckPublished = false;
                    MostroTrader._trades[orderId]._addressVerified = false;
                    MostroTrader._trades[orderId]._addressMismatch = false;
                    MostroTrader._trades[orderId].updated_at = Math.floor(Date.now() / 1000);
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                // Si el dialog "Ver arbitros" está abierto para este trade, que se refresque
                // sin que el usuario tenga que pulsar 'Actualizar'.
                try {
                    window.dispatchEvent(new CustomEvent('nxoc:arbitrators-updated', { detail: { order_id: orderId } }));
                } catch(e) {}
                if (typeof notify === 'function') {
                    notify(str_arbs_updated_by_peer, 'info', 8000);
                }
            } catch (e) {
                _warn('handleArbitratorsEvent: persist update failed', e);
            }
        },

        // Spec v2.7: procesa kind 39385 action=address_check.
        // - Evento propio: marca _addressCheckPublished (util tras reload).
        // - Evento del peer cuya address coincide con la local: marca _addressVerified;
        //   ademas si aun no habiamos publicado el nuestro, lo emitimos para cerrar el ciclo.
        // - Evento del peer con address distinta: notify y se marca _addressMismatch (no verificado).
        _handleAddressCheckEvent: async function (ev) {
            var orderId   = _eventOrderId(ev);
            var peerAddr  = String(_getTagValue(ev, 'address') || '').trim();
            if (!orderId || !peerAddr) return;

            var localResp;
            try {
                localResp = await _ajax('mostro_trade_get', { order_id: orderId });
            } catch (e) {
                _warn('handleAddressCheckEvent: AJAX error', e);
                return;
            }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleAddressCheckEvent: contract mismatch', orderId.slice(0, 8)); return; }
            var liveTrade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[orderId])
                ? MostroTrader._trades[orderId] : null;

            var isSelf = (ev.pubkey === Config.events.pubkey);
            if (isSelf) {
                if (liveTrade) {
                    liveTrade._addressCheckPublished = true;
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                _log('handleAddressCheckEvent: self-check reflected', orderId.slice(0, 8));
                return;
            }

            // Validamos que viene de la contraparte conocida (mismo guard que _handleArbitratorsEvent).
            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var expectedPeer = parseInt(trade.trade_role === 'created' ? 1 : 0, 10)
                ? meta.taker_nostr_pubkey
                : meta.maker_nostr_pubkey;
            var tagMaker = _getTagValue(ev, 'maker');
            var tagTaker = _getTagValue(ev, 'taker');
            var pTags = _getTagValues(ev, 'p');
            var concernsMe = pTags.indexOf(Config.events.pubkey) !== -1 ||
                tagMaker === Config.events.pubkey ||
                tagTaker === Config.events.pubkey;
            var peerMatches = expectedPeer
                ? ev.pubkey === expectedPeer
                : (ev.pubkey === tagMaker || ev.pubkey === tagTaker);
            if (!concernsMe || !peerMatches) {
                _warn('handleAddressCheckEvent: ignored unrelated/untrusted', {
                    orderId: orderId,
                    from: ev.pubkey,
                    expectedPeer: expectedPeer || ''
                });
                return;
            }

            var myAddr = String(trade.taproot_address || '').trim();
            if (!myAddr) {
                // El peer publico su check antes de que nosotros derivasemos la nuestra. No descartar:
                // si lo descartamos, _seenTradeEventIds lo marca como visto y no se vuelve a procesar
                // ni siquiera tras derivar (taker se queda en "Esperando a la otra parte" hasta reload).
                // Lo bufferamos para re-procesarlo cuando ensureFundingAddress complete.
                if (liveTrade) {
                    if (!Array.isArray(liveTrade._pendingAddressChecks)) liveTrade._pendingAddressChecks = [];
                    var alreadyQueued = liveTrade._pendingAddressChecks.some(function(p) { return p && p.id === ev.id; });
                    if (!alreadyQueued) liveTrade._pendingAddressChecks.push(ev);
                }
                _warn('handleAddressCheckEvent: no local address yet, deferred peer event', orderId.slice(0, 8));
                return;
            }

            if (myAddr !== peerAddr) {
                _warn('handleAddressCheckEvent: ADDRESS MISMATCH', {
                    orderId: orderId.slice(0, 8),
                    mine:    myAddr.slice(0, 16),
                    peer:    peerAddr.slice(0, 16)
                });
                if (liveTrade) {
                    liveTrade._addressMismatch = true;
                    liveTrade._addressVerified = false;
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                if (typeof notify === 'function') notify(str_address_mismatch, 'warn', 10000);
                return;
            }

            if (liveTrade) {
                liveTrade._addressVerified = true;
                liveTrade._addressMismatch = false;
                try {
                    var verifiedMeta = _mergeMeta(liveTrade, { peer_address_verified: true, peer_address_event_id: ev.id });
                    await _ajax('mostro_trade_update', { order_id: orderId, fields: { trade_json: verifiedMeta } });
                    liveTrade.trade_json = verifiedMeta;
                } catch(e) { _warn('No se pudo persistir address_check bilateral', e); }
                if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            }
            if (typeof notify === 'function') notify(str_address_peer_verified, 'info', 6000);
            _log('handleAddressCheckEvent: peer check verified', orderId.slice(0, 8));

            // Cerrar ciclo: si aun no habiamos publicado el nuestro, hacerlo ahora para que el peer
            // tambien pueda marcar verificado.
            if (liveTrade && !liveTrade._addressCheckPublished) {
                try {
                    await this.publishAddressCheck(liveTrade);
                } catch(e) {
                    _warn('handleAddressCheckEvent: auto-reply failed', e);
                }
            }
        },

        // Funding commitment (kind 39389): el vendedor lo publica una vez detectada la TX que paga
        // a la direccion escrow. Sirve como anclaje publico de (direccion, txid, amount) para que
        // arbitros y comprador puedan auditar facilmente la cadena.
        publishFundingCommitment: async function (trade) {
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!trade || !trade.order_id) throw new Error('Trade invalido');
            if (!trade.taproot_address) throw new Error('Sin direccion escrow');
            if (!trade.funding_txid)    throw new Error('Sin funding_txid');
            if ((parseInt(trade.sat_amount, 10) || 0) <= 0) throw new Error('sat_amount invalido');
            // amount = lo realmente depositado (sat_amount + comision completa del arbitro), no solo
            // sat_amount: es el valor del UTXO escrow que ancla el 39389 y que el comprador cross-verifica.
            var amount = _fundingTargetSats(trade);

            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var peerNostrPubkey = meta.taker_nostr_pubkey || meta.maker_nostr_pubkey || '';
            var tags = [
                ['d',       trade.order_id + ':funding'],
                ['order_id', trade.order_id],
                ['y',       Config.Y_TAG],
                ['txid',    String(trade.funding_txid)],
                ['vout',    String(parseInt(trade.funding_vout, 10) || 0)],
                ['amount',  String(amount)],
                ['address', String(trade.taproot_address)]
            ];
            if (parseInt(trade.funding_block, 10) > 0) tags.push(['block', String(parseInt(trade.funding_block, 10))]);
            if (meta.trade_id) tags.push(['trade_id', String(meta.trade_id)]);
            if (peerNostrPubkey) tags.push(['p', String(peerNostrPubkey)]);

            var unsigned = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_FUNDING,
                created_at: Math.floor(Date.now() / 1000),
                tags:       tags,
                content:    ''
            };
            var mined  = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });
            var signed = await Config.events.sign(withId);
            await this._publishDurable(trade, signed);
            trade._fundingCommitmentPublished = true;
            _log('publishFundingCommitment: published', {
                orderId: trade.order_id.slice(0, 8),
                txid:    String(trade.funding_txid).slice(0, 16)
            });
            return signed;
        },

        // Procesa un kind 39389 entrante. Para nuestro propio evento: marca el flag.
        // Para evento del peer (vendedor): cross-verifica via verify_funding antes de fiarnos.
        _handleFundingEvent: async function (ev) {
            var orderId = _eventOrderId(ev);
            var evTxid  = _getTagValue(ev, 'txid');
            var evAddr  = _getTagValue(ev, 'address');
            var evAmt   = parseInt(_getTagValue(ev, 'amount'), 10) || 0;
            if (!orderId || !evTxid || !evAddr) return;

            var localResp;
            try { localResp = await _ajax('mostro_trade_get', { order_id: orderId }); }
            catch(e) { _warn('handleFundingEvent: AJAX error', e); return; }
            if (localResp.error || !localResp.trade) return;
            var trade = localResp.trade;
            if (trade.method && trade.method !== 'onchain') return;
            if (!_eventMatchesTrade(ev, trade)) { _trace('handleFundingEvent: contract mismatch', orderId.slice(0, 8)); return; }

            var liveTrade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[orderId])
                ? MostroTrader._trades[orderId] : null;
            var isSelf = (ev.pubkey === Config.events.pubkey);
            if (isSelf) {
                if (liveTrade) {
                    liveTrade._fundingCommitmentPublished = true;
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
                return;
            }

            // Si ya conocemos el funding (txid guardado) o el trade esta cerrado/archivado, este 39389
            // del peer es historico: el relay lo reentrega en cada recarga. Ignorarlo evita el notify
            // "El vendedor ha anunciado el deposito..." fantasma y un verify_funding inutil.
            if (trade.funding_txid || ['completado', 'cancelado', 'archivado'].indexOf(trade.internal_status) !== -1) {
                return;
            }

            // Validamos que el emisor es la contraparte conocida. Sin esto, cualquiera podria
            // publicar un 39389 espurio con nuestra direccion y disparar un verify_funding inutil.
            var meta = {};
            try { meta = trade.trade_json ? JSON.parse(trade.trade_json) : {}; } catch(e) {}
            var expectedPeer = parseInt(trade.trade_role === 'created' ? 1 : 0, 10)
                ? meta.taker_nostr_pubkey
                : meta.maker_nostr_pubkey;
            if (expectedPeer && ev.pubkey !== expectedPeer) {
                _warn('handleFundingEvent: ignored from untrusted pubkey', {
                    orderId: orderId.slice(0, 8),
                    from:    ev.pubkey.slice(0, 8),
                    expected: expectedPeer.slice(0, 8)
                });
                return;
            }

            // Sanity: la direccion anunciada por el peer debe coincidir con la nuestra.
            if (String(trade.taproot_address || '') !== String(evAddr)) {
                _warn('handleFundingEvent: address mismatch', {
                    mine: String(trade.taproot_address || '').slice(0, 16),
                    peer: String(evAddr).slice(0, 16)
                });
                if (typeof notify === 'function') notify(str_address_mismatch, 'warn', 10000);
                return;
            }
            // Sanity: el amount del evento debe ser el target de funding (sat_amount + comision completa).
            // Si no, dejamos que verify_funding decida.
            if (_fundingTargetSats(trade) !== evAmt) {
                _warn('handleFundingEvent: amount mismatch in peer 39389', {
                    expected: _fundingTargetSats(trade),
                    peer:     evAmt
                });
            }
            if (typeof notify === 'function') notify(str_funding_announced_by_seller, 'info', 6000);

            // Disparar nuestra propia verificacion contra mempool/RPC en vez de confiar en el evento.
            if (window.Onchain && Onchain.UI && Onchain.UI._checkFundingFor && liveTrade) {
                try { await Onchain.UI._checkFundingFor(liveTrade); }
                catch(e) { _warn('handleFundingEvent: verify_funding failed', e); }
            }
        },

        // Procesa un kind 39385 action=accept: si SOMOS el taker (tag taker == nuestra pubkey),
        // actualiza el estado del trade local a 'aceptado' y guarda maker_trade_pubkey + trade_id.
        _handleAcceptEventAsTaker: async function (ev) {
            var orderId       = _eventOrderId(ev);
            var takerPubkey   = _getTagValue(ev, 'taker');
            var makerTradePub = _getTagValue(ev, 'maker_trade_pubkey');
            var tradeId       = _getTagValue(ev, 'trade_id');

            if (!orderId || !takerPubkey || !makerTradePub || !tradeId) return;
            if (takerPubkey !== Config.events.pubkey) return;          // no nos concierne

            // Buscar trade local: debe ser nuestro y tener role='taken' en estado 'creado'
            var localResp;
            try {
                localResp = await _ajax('mostro_trade_get', { order_id: orderId });
            } catch (e) {
                _warn('handleAcceptEventAsTaker: AJAX error', e);
                return;
            }
            if (localResp.error) return;
            var trade = localResp.trade;
            if (!trade || trade.trade_role !== 'taken' || _isArchivedTrade(trade)) return;
            if (['creado', 'pendiente_aceptacion'].indexOf(trade.internal_status) === -1) return; // ya procesado o cancelado

            // Parte 1.1: validar que el accept lo firma el maker REAL de la orden que tomamos,
            // no un tercero que conozca el order_id. La identidad del maker se congeló en takeOrder
            // dentro de trade_json.maker_nostr_pubkey.
            var expectedMaker = _readMeta(trade).maker_nostr_pubkey || '';
            if (expectedMaker) {
                if (ev.pubkey !== expectedMaker) {
                    _warn('handleAcceptEventAsTaker: accept de pubkey != maker esperado, ignorado', {
                        orderId:  orderId.slice(0, 8),
                        from:     ev.pubkey.slice(0, 8) + '…',
                        expected: expectedMaker.slice(0, 8) + '…'
                    });
                    return;
                }
            } else {
                // Trade antiguo sin maker congelado: no auto-aceptamos a ciegas. Avisamos para que
                // el usuario recargue (reconstruye contexto desde el orderbook) y vuelva a intentarlo.
                _warn('handleAcceptEventAsTaker: trade sin maker_nostr_pubkey guardado, no auto-acepto', orderId.slice(0, 8));
                if (typeof notify === 'function') notify(str_accept_maker_unknown, 'warn', 9000);
                return;
            }
            var takerArbitratorsCsv = _arbitratorsCsv(String(trade.arbitrators || '').split(','));
            if (_getTagValue(ev, 'taker') !== Config.events.pubkey ||
                _getTagValue(ev, 'p') !== Config.events.pubkey) {
                _warn('handleAcceptEventAsTaker: accept no dirigido a este taker'); return;
            }
            var acceptNetwork = _getTagValue(ev, 'network');
            if (!acceptNetwork || _NETWORKS.indexOf(String(acceptNetwork).toLowerCase()) === -1 ||
                _normalizeNetwork(acceptNetwork) !== _tradeNetwork(trade)) {
                _warn('handleAcceptEventAsTaker: network ausente o distinta'); return;
            }
            var expectedTradeId = await _computeTradeId(orderId, Config.events.pubkey);
            if (tradeId !== expectedTradeId) { _warn('handleAcceptEventAsTaker: trade_id invalido'); return; }
            try { nobleSecp256k1.Point.fromHex('02' + makerTradePub); }
            catch(e) { _warn('handleAcceptEventAsTaker: maker_trade_pubkey fuera de curva'); return; }
            var acceptArbs = _arbitratorsCsv(String(_getTagValue(ev, 'arbitrators') || '').split(','));
            if (!acceptArbs || acceptArbs !== takerArbitratorsCsv) {
                _warn('handleAcceptEventAsTaker: arbitros distintos a la orden tomada'); return;
            }

            // Leer sat_amount / fiat_amount / arb_fee congelados por el maker en el accept event.
            var acceptSat  = parseInt(_getTagValue(ev, 'sat_amount'),  10) || 0;
            var acceptFiat = String(_getTagValue(ev, 'fiat_amount') || '').trim();
            var acceptArbFee = parseInt(_getTagValue(ev, 'arb_fee'), 10) || 0;
            var frozen = _readMeta(trade);
            var requestedFiat = Number(frozen.requested_fiat_amount);
            if (!(acceptSat > 0) || !(Number(acceptFiat) > 0) || !Number.isFinite(requestedFiat) ||
                Math.abs(Number(acceptFiat) - requestedFiat) > 0.00000001) {
                _warn('handleAcceptEventAsTaker: contrato monetario no coincide con la solicitud'); return;
            }
            if ((parseInt(frozen.order_amount_sats, 10) || 0) > 0 && frozen.order_fiat_min === null &&
                acceptSat !== parseInt(frozen.order_amount_sats, 10)) {
                _warn('handleAcceptEventAsTaker: sat_amount fijo alterado'); return;
            }
            if (acceptArbFee < _DUST_SATS || acceptArbFee > acceptSat) {
                _warn('handleAcceptEventAsTaker: arb_fee fuera de limites'); return;
            }

            _log('Trader: accept event recibido para nuestro take', {
                orderId:        orderId.slice(0, 8),
                makerTradePub:  makerTradePub.slice(0, 8) + '…',
                tradeId:        tradeId,
                fromMaker:      ev.pubkey.slice(0, 8) + '…',
                satAmount:      acceptSat,
                fiatAmount:     acceptFiat
            });

            // Persistir estado aceptado + datos del maker. Mergeamos sobre el trade_json existente
            // (preserva maker_nostr_pubkey congelado en takeOrder y cualquier otro campo futuro
            // como network/premium) en vez de machacarlo.
            try {
                var mergedJson = _mergeMeta(trade, {
                    trade_id:           tradeId,
                    maker_nostr_pubkey: ev.pubkey,
                    maker_trade_pubkey: makerTradePub,
                    arb_fee_sats:       acceptArbFee
                });

                var fields = {
                    internal_status: 'aceptado',
                    status:          'aceptado',
                    peer_pubkey:     makerTradePub,
                    arbitrators:     takerArbitratorsCsv,
                    trade_json:      mergedJson
                };
                // Solo sobrescribimos sat_amount / fiat_amount si el accept los trae (>0/non-empty).
                if (acceptSat > 0)   fields.sat_amount  = acceptSat;
                if (acceptFiat)      fields.fiat_amount = acceptFiat;

                await _ajax('mostro_trade_update', { order_id: orderId, fields: fields });

                if (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[orderId]) {
                    MostroTrader._trades[orderId].internal_status = 'aceptado';
                    MostroTrader._trades[orderId].status = 'aceptado';
                    MostroTrader._trades[orderId].peer_pubkey = makerTradePub;
                    if (takerArbitratorsCsv) MostroTrader._trades[orderId].arbitrators = takerArbitratorsCsv;
                    if (acceptSat > 0)  MostroTrader._trades[orderId].sat_amount  = acceptSat;
                    if (acceptFiat)     MostroTrader._trades[orderId].fiat_amount = acceptFiat;
                    MostroTrader._trades[orderId].trade_json = mergedJson;
                    MostroTrader._trades[orderId].updated_at = Math.floor(Date.now() / 1000);
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
            } catch (e) {
                _warn('handleAcceptEventAsTaker: persist update failed', e);
                return;
            }

            // Refrescar UI: recargar trades y re-renderizar (loadMyTrades llama subscribeMyTrades → chat activado)
            if (typeof MostroTrader !== 'undefined' && MostroTrader.loadMyTrades) {
                try { await MostroTrader.loadMyTrades(); } catch (e) { _warn('reload UI failed', e); }
            }
            if (typeof notify === 'function') {
                notify(t(str_trade_request_accepted, orderId.slice(0, 8)), 'success', 0);
            }
        },

        // ==================== TAKER SIDE: tomar una orden ajena ====================

        // Toma una orden publicada por otro user. Envía DM cifrado (NIP-04) al maker
        // con el take_request, y persiste localmente como trade pendiente.
        // params:
        //   orderId:    string — id de la orden (debe estar en Onchain.Book.orders).
        //   fiatAmount: number — importe a tomar (igual al de la orden, o dentro del rango).
        takeOrder: async function (params) {
            if (!Keys.isUnlocked()) throw new Error('Escrow locked. Onchain.Keys.unlock() primero.');
            if (!Config.events.canSign()) throw new Error('Noxtr.Events no puede firmar.');
            if (!Config.events.pubkey) throw new Error('Sin pubkey identidad cargada.');

            var orderId = params && params.orderId;
            var fiatAmount = params && params.fiatAmount;
            if (!orderId) throw new Error('orderId requerido');
            if (typeof fiatAmount !== 'number' || fiatAmount <= 0) throw new Error('fiatAmount requerido (number > 0)');

            var order = Book.orders[orderId];
            if (!order) throw new Error('Orden verificada no encontrada en el orderbook. Recarga antes de tomarla.');
            var makerPubkey = order.makerPubkey;
            if (params.makerPubkey && params.makerPubkey !== makerPubkey) throw new Error('makerPubkey no coincide con la orden firmada');
            if (makerPubkey === Config.events.pubkey) throw new Error('Es tu propia orden, no puedes tomarla.');
            // No mezclar redes: solo se toman órdenes de la red activa.
            var _orderNet = _normalizeNetwork(order.network);
            if (_orderNet !== _activeNetwork()) {
                throw new Error('Esta orden es de la red ' + _orderNet + ' y tu red activa es ' + _activeNetwork() + '. Cambia de red para tomarla.');
            }
            if (order) {
                if (order.isRange && !(fiatAmount >= order.fiatMin && fiatAmount <= order.fiatMax)) {
                    throw new Error('El importe debe estar dentro del rango publicado');
                }
                if (!order.isRange && Number.isFinite(parseFloat(order.fiatAmount)) &&
                    Math.abs(fiatAmount - parseFloat(order.fiatAmount)) > 0.00000001) {
                    throw new Error('El importe no coincide con la orden publicada');
                }
            }

            // Evitar doble take del mismo order_id
            var _existCheck = await _ajax('mostro_trade_get', { order_id: orderId });
            if (!_existCheck.error && _existCheck.trade && !parseInt(_existCheck.trade.archived || '0')) {
                throw new Error('Ya tienes una solicitud activa para esta orden. Espera a que el maker responda.');
            }

            var DMs = window.Noxtr && window.Noxtr.DMs;
            if (!DMs || !DMs.encrypt) throw new Error('Noxtr.DMs no disponible.');

            // Derivar trade key BIP86
            var tradeIndex = this._nextTradeIndex();
            var tradePrivkey = await Bip86.deriveCurrentTradeKey(tradeIndex);
            var tradePubkey  = Bip86.privkeyToTradePubkey(tradePrivkey);

            // Construir y cifrar take_request
            var msg = {
                type:         'take_request',
                order_id:     orderId,
                trade_pubkey: tradePubkey,
                trade_index:  tradeIndex,
                fiat_amount:  fiatAmount
            };
            var ciphertext = await DMs.encrypt(JSON.stringify(msg), makerPubkey);

            // Publicar kind 4 dirigido al maker
            var unsigned = await Config.events.create(4, ciphertext, [['p', makerPubkey], ['y', Config.Y_TAG]]);
            var signed = await Config.events.sign(unsigned);
            // Persistir trade local (role=taken, internal_status=pendiente_aceptacion)
            // Lado del taker es el OPUESTO al maker: si maker vende, taker compra y viceversa.
            var makerKind = order.kind;
            var takerKind = makerKind === 'sell' ? 'buy' : 'sell';
            var takerIsSeller = makerKind === 'buy' ? 1 : 0;
            var satAmount = order.amountSats;
            var fiatCode = order.fiatCode;
            var paymentMethod = order.paymentMethod || '';
            var orderArbitrators = order.arbitrators || order._arbitrators || [];
            // Congelar la identidad Nostr del maker de la orden tomada. Sin esto, el handler de
            // accept tendría que confiar en ev.pubkey del propio evento accept (circular) y un
            // tercero podría inyectar un accept falso para este order_id (Parte 1.1 del plan).
            // Congelar también la red de la orden (no la activa: la del trade que tomamos).
            var takeNetwork = _normalizeNetwork(order.network);
            var takeTradeJson = JSON.stringify({
                maker_nostr_pubkey: makerPubkey,
                taker_nostr_pubkey: Config.events.pubkey,
                network: takeNetwork,
                nostr_outbox_event: signed,
                requested_fiat_amount: fiatAmount,
                order_event_id: order && order.eventId || '',
                order_amount_sats: parseInt(order && order.amountSats, 10) || 0,
                order_fiat_min: order && order.isRange ? Number(order.fiatMin) : null,
                order_fiat_max: order && order.isRange ? Number(order.fiatMax) : null,
                order_fiat_amount: order && !order.isRange ? Number(order.fiatAmount) : null,
                order_arbitrators: Array.isArray(orderArbitrators) ? orderArbitrators.join(',') : String(orderArbitrators || '')
            });
            var persisted = false;
            try {
                var resp = await _ajax('onchain_trade_add', {
                    order_id:        orderId,
                    trade_kind:      takerKind,
                    trade_role:      'taken',
                    trade_privkey:   '',
                    trade_key_pub:   tradePubkey,
                    trade_index:     String(tradeIndex),
                    is_seller:       String(takerIsSeller),
                    sat_amount:      String(satAmount),
                    fiat_code:       fiatCode,
                    fiat_amount:     String(fiatAmount),
                    payment_method:  paymentMethod,
                    arbitrators:     Array.isArray(orderArbitrators) ? orderArbitrators.join(',') : String(orderArbitrators || ''),
                    trade_json:      takeTradeJson,
                    internal_status: 'pendiente_aceptacion'
                });
                _log('takeOrder: persisted', resp);
                persisted = !!(resp && resp.ok);
                if (!persisted) {
                    _warn('takeOrder: persist returned error', resp);
                    if (typeof notify === 'function') notify(t(str_take_persist_failed, (resp && resp.msg) || 'error'), 'error', 18000);
                    throw new Error((resp && resp.msg) || 'No se pudo guardar la solicitud');
                }
            } catch (e) {
                _warn('takeOrder: persist failed; no se envia DM:', e.message);
                if (typeof notify === 'function') notify(t(str_take_persist_failed, (e && e.message) || String(e)), 'error', 18000);
                throw e;
            }
            Config.pool.publish(signed);
            _log('takeOrder: take_request DM enviado', { orderId: orderId.slice(0, 8),
                toMaker: makerPubkey.slice(0, 8) + '…', myTradeIndex: tradeIndex });
            if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                MostroTrader._trades[orderId] = {
                    method: 'onchain',
                    order_id: orderId,
                    trade_kind: takerKind,
                    trade_role: 'taken',
                    trade_privkey: tradePrivkey,
                    trade_key_pub: tradePubkey,
                    trade_index: tradeIndex,
                    is_seller: takerIsSeller,
                    sat_amount: satAmount,
                    fiat_code: fiatCode,
                    fiat_amount: String(fiatAmount),
                    payment_method: paymentMethod,
                    arbitrators: Array.isArray(orderArbitrators) ? orderArbitrators.join(',') : String(orderArbitrators || ''),
                    trade_json: takeTradeJson,
                    internal_status: 'pendiente_aceptacion',
                    status: 'pendiente_aceptacion',
                    peer_pubkey: '',
                    archived: 0,
                    updated_at: Math.floor(Date.now() / 1000)
                };
                if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            }

            // Refrescar UI: cache _trades + render Mis trades.
            if (persisted && typeof MostroTrader !== 'undefined' && MostroTrader.loadMyTrades) {
                try { await MostroTrader.loadMyTrades(); } catch (e) { _warn('takeOrder: loadMyTrades', e); }
            }

            return { orderId: orderId, tradePubkey: tradePubkey, tradeIndex: tradeIndex, dmEventId: signed.id };
        },

        // ==================== MAKER SIDE: aceptar un take_request ====================

        // Acepta un take_request previamente recibido vía DM. Publica kind 39385 con
        // action='accept' incluyendo el trade_id derivado deterministicamente.
        // takeRequestData: objeto del array Trader._pendingTakeRequests[orderId].
        acceptTake: async function (takeRequestData) {
            // No necesita Keys: usa trade_key_pub guardado en server + nsec para firmar el evento.
            if (!Config.events.canSign()) throw new Error('Cannot sign.');
            if (!takeRequestData || !takeRequestData.orderId || !takeRequestData.takerPubkey) {
                throw new Error('takeRequestData inválido');
            }
            var orderId     = takeRequestData.orderId;
            var takerPubkey = takeRequestData.takerPubkey;
            var takerFiat   = parseFloat(takeRequestData.fiatAmount) || 0;
            if (takerFiat <= 0) throw new Error('take_request sin fiat_amount válido');

            // 1. Recuperar nuestro trade local (necesitamos maker_trade_pubkey)
            var localResp = await _ajax('mostro_trade_get', { order_id: orderId });
            if (localResp.error) throw new Error('No tengo trade local: ' + (localResp.msg || ''));
            var trade = localResp.trade || {};
            if (trade.method !== 'onchain' || trade.trade_role !== 'created' ||
                ['creado', 'pendiente_aceptacion'].indexOf(trade.internal_status) === -1) {
                throw new Error('La solicitud no corresponde a una orden on-chain propia y abierta');
            }
            var makerTradePubkey = trade.trade_key_pub;
            if (!makerTradePubkey) throw new Error('Local trade sin trade_key_pub');
            var makerArbitratorsCsv = _arbitratorsCsv(String(trade.arbitrators || '').split(','));
            if (!makerArbitratorsCsv && Book.orders && Book.orders[orderId]) {
                makerArbitratorsCsv = _arbitratorsCsv(Book.orders[orderId].arbitrators || Book.orders[orderId]._arbitrators || []);
            }
            if (!makerArbitratorsCsv && typeof MostroBook !== 'undefined' && MostroBook.orders && MostroBook.orders[orderId]) {
                makerArbitratorsCsv = _arbitratorsCsv(MostroBook.orders[orderId]._arbitrators || []);
            }

            // Congelar el contrato monetario (sec 7.2 / changelog v2.7):
            // - sat_amount > 0 al crear: lo respetamos tal cual.
            // - sat_amount === 0 (precio de mercado): computamos sats con (fiat / (rate * (1+premium/100))) * 1e8
            //   leyendo rate de la caché yadio y premium del trade_json del maker o del orderbook.
            var fiatCode = String(trade.fiat_code || '').toUpperCase();
            if (!fiatCode && typeof MostroBook !== 'undefined' && MostroBook.orders && MostroBook.orders[orderId]) {
                fiatCode = String(MostroBook.orders[orderId].fiatCode || '').toUpperCase();
            }
            var existingMeta = _readMeta(trade);
            var premium = parseFloat(existingMeta.premium);
            if (!isFinite(premium) && typeof MostroBook !== 'undefined' && MostroBook.orders && MostroBook.orders[orderId]) {
                premium = parseFloat(MostroBook.orders[orderId].premium);
            }
            if (!isFinite(premium)) premium = 0;

            var orderSat = parseInt(trade.sat_amount, 10) || 0;
            var orderFiatStr = String(trade.fiat_amount || '').trim();
            var isRange = orderFiatStr.indexOf('-') !== -1;
            // Capturar el rango ANTES de que el update de mas abajo sobrescriba fiat_amount con el
            // importe tomado. Se usa para publicar la oferta con el resto del rango (6b).
            var rangeMin = isRange ? parseFloat(orderFiatStr.split('-')[0]) : NaN;
            var rangeMax = isRange ? parseFloat(orderFiatStr.split('-')[1]) : NaN;
            if (isRange && !(takerFiat >= rangeMin && takerFiat <= rangeMax)) {
                throw new Error('fiat_amount fuera del rango publicado');
            }
            if (!isRange) {
                var fixedFiat = parseFloat(orderFiatStr);
                if (isFinite(fixedFiat) && Math.abs(takerFiat - fixedFiat) > 0.00000001) {
                    throw new Error('fiat_amount no coincide con la orden fija');
                }
            }
            var frozenSats = 0;
            if (orderSat > 0 && !isRange) {
                // Precio fijo no-range: el sat_amount original es vinculante.
                frozenSats = orderSat;
            } else {
                // Precio de mercado o range: necesitamos cotización para calcular sats sobre el fiat real.
                var rates = (typeof MostroBook !== 'undefined' && MostroBook._priceCache) ? MostroBook._priceCache.rates : null;
                if ((!rates || !rates[fiatCode]) && typeof MostroBook !== 'undefined' && MostroBook._fetchYadioRates) {
                    MostroBook._fetchYadioRates();
                    await new Promise(function(r) { setTimeout(r, 2500); });
                    rates = MostroBook._priceCache ? MostroBook._priceCache.rates : null;
                }
                if (!rates || !rates[fiatCode]) {
                    throw new Error('No hay cotización disponible para ' + fiatCode + '. Reintenta en unos segundos.');
                }
                var rate = parseFloat(rates[fiatCode]);
                if (!isFinite(rate) || rate <= 0) throw new Error('Cotización inválida para ' + fiatCode);
                var effectiveRate = rate * (1 + premium / 100);
                frozenSats = Math.round((takerFiat / effectiveRate) * 1e8);
            }
            if (frozenSats <= 0) throw new Error('No se pudo computar sat_amount (>0)');

            // 2. Computar trade_id determinista
            var tradeId = await _computeTradeId(orderId, takerPubkey);

            // 2b. Congelar la comisión de arb1 (Variant C). arb1 = primer arbitro del set. Se lee de
            //     su 39388 y se fija aquí para que ambas partes usen el mismo importe.
            var arb1Pubkey = (makerArbitratorsCsv || '').split(',')[0] || '';
            var arbFeeSats = _computeArbFee(arb1Pubkey, frozenSats);
            if (arbFeeSats < _DUST_SATS || arbFeeSats > frozenSats) {
                throw new Error('La comision del arbitro debe estar entre dust y el importe del trade');
            }

            // 3. Construir evento kind 39385 action=accept (`d` por acción + `order_id` estable).
            var unsigned = {
                pubkey:     Config.events.pubkey,
                kind:       Config.KIND_TRADE_STATE,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d',                   orderId + ':accept'],
                    ['order_id',            orderId],
                    ['y',                   Config.Y_TAG],
                    ['action',              'accept'],
                    ['taker',               takerPubkey],
                    ['maker_trade_pubkey',  makerTradePubkey],
                    ['trade_id',            tradeId],
                    ['network',             _tradeNetwork(trade)],
                    ['maker',               Config.events.pubkey],
                    ['p',                   takerPubkey],
                    ['sat_amount',          String(frozenSats)],
                    ['fiat_amount',         String(takerFiat)],
                    ['arb_fee',             String(arbFeeSats)]
                ],
                content: ''
            };
            if (makerArbitratorsCsv) unsigned.tags.push(['arbitrators', makerArbitratorsCsv]);

            // 4. PoW 12 bits (kind 39385 mínimo según spec sec 5)
            var mined = await PowMiner.mineRemote(unsigned, 12);
            var withId = Object.assign({}, mined.event, { id: mined.id });

            // 5. Firmar. Se publica solo después de persistir el estado local.
            var signed = await Config.events.sign(withId);

            // 6. Actualizar trade local: estado aceptado + peer_pubkey + sat_amount + fiat_amount
            //    + trade_id en trade_json (preservamos premium del trade_json original).
            var mergedMetaStr = _mergeMeta(trade, {
                trade_id:           tradeId,
                taker_nostr_pubkey: takerPubkey,
                taker_trade_pubkey: takeRequestData.takerTradePubkey,
                arb_fee_sats:       arbFeeSats
            });
            try {
                var updateResp = await _ajax('mostro_trade_update', {
                    order_id: orderId,
                    fields: {
                        internal_status: 'aceptado',
                        status:          'aceptado',
                        peer_pubkey:     takeRequestData.takerTradePubkey,
                        arbitrators:     makerArbitratorsCsv,
                        sat_amount:      frozenSats,
                        fiat_amount:     String(takerFiat),
                        trade_json:      mergedMetaStr
                    }
                });
                if (!updateResp || updateResp.error) throw new Error((updateResp && updateResp.msg) || 'No se pudo guardar el accept');
                trade.trade_json = mergedMetaStr;
                if (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[orderId]) {
                    MostroTrader._trades[orderId].internal_status = 'aceptado';
                    MostroTrader._trades[orderId].status = 'aceptado';
                    MostroTrader._trades[orderId].peer_pubkey = takeRequestData.takerTradePubkey;
                    if (makerArbitratorsCsv) MostroTrader._trades[orderId].arbitrators = makerArbitratorsCsv;
                    MostroTrader._trades[orderId].sat_amount  = frozenSats;
                    MostroTrader._trades[orderId].fiat_amount = String(takerFiat);
                    MostroTrader._trades[orderId].trade_json  = mergedMetaStr;
                    MostroTrader._trades[orderId].updated_at = Math.floor(Date.now() / 1000);
                    if (MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                }
            } catch (e) {
                _warn('acceptTake: persist failed', e);
                throw e;
            }
            await this._publishDurable(trade, signed);
            _log('acceptTake: accept event published', { orderId: orderId.slice(0, 8), tradeId: tradeId,
                taker: takerPubkey.slice(0, 8) + '…', eventId: signed.id });

            // 6b. Retirar la orden original del libro: la fila local (order_id) ya se convirtio en el
            //     trade, pero su EVENTO publico seguiria mostrandose como disponible. Aplica tanto a
            //     precio fijo como a rango. En rango, antes de retirar publicamos una oferta nueva
            //     (child, otro order_id) con el resto [min, max - tomado]; si el resto < min no hay
            //     child y solo se retira. Si la publicacion del child falla (p.ej. escrow bloqueado),
            //     NO retiramos la original para no perder la capacidad.
            var orderKind = trade.trade_kind === 'sell' ? 'sell' : 'buy';
            var retireOriginal = true;
            if (isRange && isFinite(rangeMin) && isFinite(rangeMax)) {
                var remaining = Math.round((rangeMax - takerFiat) * 100) / 100;
                var makeChild = remaining >= rangeMin;
                if (makeChild) {
                    try {
                        if (!Keys.isUnlocked()) await Keys.unlock();
                        await this.createOrder({
                            kind:          orderKind,
                            amountSats:    parseInt(trade.sat_amount, 10) || 0,
                            fiatCode:      fiatCode,
                            fiatAmount:    [rangeMin, remaining],
                            paymentMethod: trade.payment_method || '',
                            premium:       premium,
                            arbitrators:   (makerArbitratorsCsv || '').split(',').filter(Boolean),
                            network:       _tradeNetwork(trade)
                        });
                    } catch (e) {
                        _warn('acceptTake: child order publish failed', e);
                        if (typeof notify === 'function') notify(t(str_range_remainder_failed, (e && e.message) || String(e)), 'warning', 13000);
                        retireOriginal = false;
                    }
                }
            }
            if (retireOriginal) {
                try { await this._retireOrderEvent(orderId, orderKind); }
                catch (e) { _warn('acceptTake: retire original order failed', e); }
            }

            // 7. Limpiar pending para esta orden
            if (this._pendingTakeRequests[orderId]) delete this._pendingTakeRequests[orderId];
            try { localStorage.setItem('nxoc_pending_takes', JSON.stringify(this._pendingTakeRequests)); } catch(e) {}

            // 8. Refrescar UI: recarga trades (incluye subscribeMyTrades → chat activado)
            if (typeof MostroTrader !== 'undefined' && MostroTrader.loadMyTrades) {
                try { await MostroTrader.loadMyTrades(); } catch (e) { _warn('acceptTake: UI reload failed', e); }
            }

            return { tradeId: tradeId, eventId: signed.id };
        }
    };

    // Pool de árbitros (kind 39388 con #y=nostrescrow).
    // Browser consulta directo a relays, verifica bonds en mempool.space, computa selección.
    // En Phase 4 implementa subscribe + bond verification + selección determinista.
    var Arbitrators = {
        pool: {},
        _subId: null,
        _initialized: false,
        _profileRefreshTimer: null,
        _reputation: {},

        init: function () {
            if (this._initialized) return;
            this._initialized = true;
            if (Config.defaultSiteArbitrator) {
                this.pool[Config.defaultSiteArbitrator] = {
                    pubkey_btc: Config.defaultSiteArbitrator,
                    nostr_pubkey: '',
                    tier: 'site_admin',
                    max_amount: 0,
                    fee_rate: 0,
                    fee_min_sats: 546,
                    languages: '',
                    bond_txid: '',
                    bond_vout: '',
                    bond_amount: 0,
                    content: 'Arbitro del sitio (admin web)',
                    created_at: Math.floor(Date.now() / 1000),
                    relay: ''
                };
            }
            this.subscribe();
            this._loadDisputes();
            _log('Arbitrators.init');
        },

        subscribe: function (sinceSeconds) {
            if (this._subId || !Config.pool) return;
            var since = Math.floor(Date.now() / 1000) - (sinceSeconds || 30 * 86400);
            var self = this;
            this._subId = Config.pool.subscribe(
                [{ kinds: [Config.KIND_ARB_ADV], '#y': [Config.Y_TAG], since: since, limit: 300 }],
                function (ev, relayUrl) { self._handleEvent(ev, relayUrl); },
                function () {
                    _log('Arbitrators.subscribe: EOSE, ' + Object.keys(self.pool).length + ' arbitros');
                    self._refreshOpenSelectors();
                }
            );
        },

        _handleEvent: async function (ev, relayUrl) {
            if (!ev || ev.kind !== Config.KIND_ARB_ADV || !(await _verifyProtocolEvent(ev, 16))) return;
            if (_getTagValue(ev, 'y') !== Config.Y_TAG) return;
            var pubkeyBtc = (_getTagValue(ev, 'pubkey_btc') || _getTagValue(ev, 'btc_pubkey') || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(pubkeyBtc)) return;
            try { nobleSecp256k1.Point.fromHex('02' + pubkeyBtc); } catch(e) { return; }
            // Si revocamos este anuncio (kind 5), algunos relays siguen sirviendo el ARB_ADV viejo y
            // reaparecia tras recargar. Ignoramos cualquier evento anterior o igual al momento de la
            // revocacion. Una re-publicacion genuina (created_at posterior) si se acepta.
            var revokedAt = this._revoked()[pubkeyBtc];
            if (revokedAt && ev.created_at <= revokedAt) return;
            var existing = this.pool[pubkeyBtc];
            if (existing && existing.created_at >= ev.created_at) return;
            var tier = (_getTagValue(ev, 'tier') || (_getTagValue(ev, 'bond_txid') ? 'professional' : 'regular')).toLowerCase();
            if (['regular', 'professional', 'site_admin'].indexOf(tier) === -1) tier = 'regular';
            // El bond/slashing aún no tiene un script verificable publicado. Hasta que exista,
            // una autodeclaración "professional" no obtiene privilegios de confianza/selección.
            var declaredTier = tier;
            if (tier === 'professional') tier = 'regular';
            // El admin de la web (clave configurada) es SIEMPRE site_admin (arb1 por defecto), aunque
            // publique su anuncio con otro tier: no se deja degradar.
            if (Config.defaultSiteArbitrator && pubkeyBtc === Config.defaultSiteArbitrator) tier = 'site_admin';
            var bondTxid = (_getTagValue(ev, 'bond_txid') || '').toLowerCase();
            this.pool[pubkeyBtc] = {
                pubkey_btc: pubkeyBtc,
                nostr_pubkey: ev.pubkey,
                tier: tier,
                declared_tier: declaredTier,
                bond_verified: false,
                max_amount: parseInt(_getTagValue(ev, 'max_amount') || '0', 10) || 0,
                fee_rate: parseFloat(_getTagValue(ev, 'fee_rate') || '0') || 0,
                fee_min_sats: parseInt(_getTagValue(ev, 'fee_min_sats') || _getTagValue(ev, 'min_fee_sats') || '0', 10) || 0,
                status: (_getTagValue(ev, 'status') || 'active').toLowerCase(),
                languages: _getTagValue(ev, 'languages') || '',
                bond_txid: /^[a-f0-9]{64}$/.test(bondTxid) ? bondTxid : '',
                bond_vout: _getTagValue(ev, 'bond_vout') || '',
                bond_amount: parseInt(_getTagValue(ev, 'bond_amount') || '0', 10) || 0,
                content: ev.content || '',
                created_at: ev.created_at,
                relay: relayUrl || ''
            };
            if (Config.profiles && Config.profiles.request && ev.pubkey) {
                try { Config.profiles.request(ev.pubkey); } catch(e) {}
            }
            this._refreshOpenSelectors();
        },

        list: function () {
            var blocked = (Config && Config.blockedArbitrators) || {};
            // Deduplicar por identidad Nostr: un mismo arbitro no debe aparecer varias veces aunque
            // haya publicado anuncios con distintas pubkey BTC. Conservamos el mas reciente. Las
            // entradas sin nostr_pubkey (p.ej. el arbitro del sitio sembrado por config) no se colapsan.
            var arr = [];
            var byId = {};
            for (var k in this.pool) {
                if (!this.pool.hasOwnProperty(k)) continue;
                var a = this.pool[k];
                // Solo se muestran los activos: 'unavailable' (pausado) y 'deleted' (revocado) se ocultan.
                if ((a.status || 'active') !== 'active') continue;
                if (a.nostr_pubkey && blocked[a.nostr_pubkey]) continue;
                if (a.nostr_pubkey) {
                    var prev = byId[a.nostr_pubkey];
                    if (!prev || (a.created_at || 0) > (prev.created_at || 0)) byId[a.nostr_pubkey] = a;
                } else {
                    arr.push(a);
                }
            }
            for (var id in byId) { if (byId.hasOwnProperty(id)) arr.push(byId[id]); }
            arr.sort(function (a, b) {
                var rank = { site_admin: 0, professional: 1, regular: 2 };
                var ra = rank[a.tier] == null ? 9 : rank[a.tier];
                var rb = rank[b.tier] == null ? 9 : rank[b.tier];
                if (ra !== rb) return ra - rb;
                return (b.created_at || 0) - (a.created_at || 0);
            });
            return arr;
        },

        _label: function (a) {
            var name = '';
            if (a.nostr_pubkey && Config.profiles && Config.profiles.displayName) {
                try { name = Config.profiles.displayName(a.nostr_pubkey); } catch(e) {}
            }
            if (!name || name === 'unknown') {
                name = a.content ? String(a.content).slice(0, 28) : '';
            }
            if (!name) name = a.nostr_pubkey ? ('npub ' + a.nostr_pubkey.slice(0, 8) + '...') : 'Arbitro';
            var tier = a.tier === 'site_admin' ? 'Sitio' : (a.tier === 'professional' ? 'Pro' : 'Regular');
            var fee = (a.fee_min_sats ? Number(a.fee_min_sats).toLocaleString() + ' sats + ' : '') + (a.fee_rate || 0) + '%';
            var bond = a.bond_txid ? 'bond' : str_oc_no_bond;
            var status = (a.status || 'active') === 'unavailable' ? ' · no disponible' : '';
            return name + ' · ' + tier + ' · ' + fee + ' · ' + bond + status;
        },

        renderSelector: function (containerId) {
            var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
            if (!el) return;
            var list = this.list();
            var needsProfileRefresh = false;
            if (Config.profiles && Config.profiles.request) {
                list.forEach(function(a) {
                    if (!a.nostr_pubkey) return;
                    try {
                        if (Config.profiles.cache && !Config.profiles.cache[a.nostr_pubkey]) needsProfileRefresh = true;
                        Config.profiles.request(a.nostr_pubkey);
                    } catch(e) {}
                });
            }
            var opts = '<option value="">' + str_oc_select_arbitrator + '</option>' + list.map(function (a) {
                var title = a.nostr_pubkey ? ('Nostr: ' + a.nostr_pubkey + ' | BTC: ' + a.pubkey_btc) : ('BTC: ' + a.pubkey_btc);
                return '<option value="' + a.pubkey_btc + '" title="' + _escHtml(title) + '">' + _escHtml(Arbitrators._label(a)) + '</option>';
            }).join('');
            el.innerHTML =
                '<div class="nxoc-arb-toolbar">' +
                    '<button type="button" class="btn btn-small secondary nxoc-arb-refresh">' + str_oc_refresh + '</button>' +
                    '<span class="nxoc-arb-count">' + window.t(str_oc_n_available, list.length) + '</span>' +
                '</div>' +
                '<small class="mo-hint nxoc-arb-explain">' + _escHtml(str_arb_explainer) + '</small>' +
                '<small class="mo-hint">' + str_oc_select_3_arbs_hint + '</small>' +
                '<div class="nxoc-arb-slot"><select class="mo-input nxoc-arb-select" data-slot="0">' + opts + '</select><button type="button" class="btn btn-small secondary nxoc-arb-info" data-slot="0">Ver</button></div>' +
                '<div class="nxoc-arb-slot"><select class="mo-input nxoc-arb-select" data-slot="1">' + opts + '</select><button type="button" class="btn btn-small secondary nxoc-arb-info" data-slot="1">Ver</button></div>' +
                '<div class="nxoc-arb-slot"><select class="mo-input nxoc-arb-select" data-slot="2">' + opts + '</select><button type="button" class="btn btn-small secondary nxoc-arb-info" data-slot="2">Ver</button></div>' +
                '<div class="nxoc-arb-warning" style="display:none"></div>';
            el.querySelector('.nxoc-arb-refresh').onclick = function () {
                if (Arbitrators._subId && Config.pool) { Config.pool.unsubscribe(Arbitrators._subId); Arbitrators._subId = null; }
                Arbitrators.subscribe();
                Arbitrators.renderSelector(containerId);
            };
            el.querySelectorAll('.nxoc-arb-info').forEach(function(btn) {
                btn.onclick = function() {
                    var row = btn.closest('.nxoc-arb-slot');
                    var sel = row ? row.querySelector('.nxoc-arb-select') : null;
                    var pk = sel ? (sel.value || '').toLowerCase() : '';
                    if (!pk || !Arbitrators.pool[pk]) {
                        alert(str_select_arbitrator_first);
                        return;
                    }
                    Arbitrators.openInfoDialog(pk);
                };
            });
            this._applySavedSelection(el);
            this._updateSelectionWarning(el);
            if (needsProfileRefresh && !this._profileRefreshTimer) {
                this._profileRefreshTimer = setTimeout(function() {
                    Arbitrators._profileRefreshTimer = null;
                    Arbitrators._refreshOpenSelectors();
                }, 1600);
            }
        },

        _selectedRawFrom: function (containerId) {
            var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
            if (!el) return [];
            var selected = [];
            el.querySelectorAll('.nxoc-arb-select').forEach(function (s) {
                var pk = (s.value || '').toLowerCase();
                if (/^[a-f0-9]{64}$/.test(pk)) selected.push(pk);
            });
            return selected;
        },

        selectedFrom: function (containerId) {
            var selected = this._selectedRawFrom(containerId);
            if (!selected.length) {
                var available = this.list();
                if (available.length === 1 && available[0] && /^[a-f0-9]{64}$/.test(available[0].pubkey_btc || '')) {
                    selected = [available[0].pubkey_btc];
                }
            }
            var normalized = _normalizeArbitrators(selected);
            try { localStorage.setItem('nxoc_selected_arbitrators', JSON.stringify(normalized)); } catch(e) {}
            return normalized;
        },

        _updateSelectionWarning: function (containerId) {
            var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
            if (!el) return;
            var warn = el.querySelector('.nxoc-arb-warning');
            if (!warn) return;
            var raw = this._selectedRawFrom(el);
            var uniq = [];
            raw.forEach(function(pk) { if (uniq.indexOf(pk) === -1) uniq.push(pk); });
            var messages = [];
            if (uniq.length === 1) {
                messages.push('Modo bootstrap: los 3 slots Taproot usaran el mismo arbitro. No hay cascada real si no responde.');
            }
            var myPubkey = (Config.events && Config.events.pubkey) || Config.pubkey || '';
            if (myPubkey) {
                uniq.forEach(function(pk) {
                    var a = Arbitrators.pool[pk];
                    if (a && a.nostr_pubkey && a.nostr_pubkey === myPubkey) {
                        messages.push('Aviso: estas seleccionando como arbitro una identidad Nostr que parece ser la tuya. No se bloquea, pero la otra parte deberia verlo y aceptarlo explicitamente.');
                    }
                });
            }
            warn.innerHTML = messages.map(function(m) { return '<div>' + _escHtml(m) + '</div>'; }).join('');
            warn.style.display = messages.length ? '' : 'none';
        },

        _applySavedSelection: function (el) {
            var saved = [];
            try { saved = JSON.parse(localStorage.getItem('nxoc_selected_arbitrators') || '[]'); } catch(e) {}
            el.querySelectorAll('.nxoc-arb-select').forEach(function (s, i) {
                if (saved[i]) s.value = saved[i];
                s.onchange = function () {
                    Arbitrators.selectedFrom(el);
                    Arbitrators._updateSelectionWarning(el);
                };
            });
            var available = this.list();
            if (!saved.length && available.length === 1 && /^[a-f0-9]{64}$/.test(available[0].pubkey_btc || '')) {
                var first = el.querySelector('.nxoc-arb-select');
                if (first) first.value = available[0].pubkey_btc;
                this._updateSelectionWarning(el);
            }
        },

        _profileName: function (a) {
            var name = '';
            if (a && a.nostr_pubkey && Config.profiles && Config.profiles.displayName) {
                try { name = Config.profiles.displayName(a.nostr_pubkey); } catch(e) {}
            }
            return name || '';
        },

        _reputationKey: function (a) {
            return (a && a.nostr_pubkey) ? a.nostr_pubkey : ((a && a.pubkey_btc) || '');
        },

        _reputationText: function (a) {
            var rep = this._reputation[this._reputationKey(a)];
            if (!rep) return 'Buscando reputacion publica...';
            var totalRatings = rep.positive + rep.neutral + rep.negative;
            if (!totalRatings && !rep.arbitrations) return 'Sin reputacion publica encontrada en los relays conectados.';
            var bits = [];
            if (totalRatings) {
                var score = ((rep.positive - 2 * rep.negative) / Math.max(1, totalRatings)).toFixed(2);
                bits.push(rep.positive + ' positivas, ' + rep.neutral + ' neutrales, ' + rep.negative + ' negativas');
                bits.push('score ' + score);
            }
            if (rep.arbitrations) bits.push(rep.arbitrations + ' decisiones de arbitraje publicas');
            return bits.join(' · ');
        },

        _infoHtml: function (a) {
            var name = this._profileName(a) || 'Arbitro';
            var avatar = '';
            if (a.nostr_pubkey && Config.profiles && Config.profiles.avatar) {
                try { avatar = Config.profiles.avatar(a.nostr_pubkey) || ''; } catch(e) {}
            }
            var tier = a.tier === 'site_admin' ? 'Sitio (admin web)' : (a.tier === 'professional' ? 'Profesional' : 'Regular');
            var fee = (a.fee_min_sats ? Number(a.fee_min_sats).toLocaleString() + ' sats + ' : '') + (a.fee_rate || 0) + '%';
            var max = a.max_amount ? Number(a.max_amount).toLocaleString() + ' sats' : str_oc_no_max_announced;
            var bond = a.bond_txid
                ? (Number(a.bond_amount || 0).toLocaleString() + ' sats · ' + a.bond_txid.slice(0, 10) + '...' + a.bond_txid.slice(-8) + ':' + (a.bond_vout || '0'))
                : str_oc_no_bond_announced;
            var npub = a.nostr_pubkey || str_oc_not_available;
            var status = (a.status || 'active') === 'unavailable' ? str_oc_unavailable_paused : str_oc_available;
            var rep = this._reputationText(a);
            return '<div class="nxoc-arb-card">' +
                '<div class="nxoc-arb-card-head">' +
                    '<div class="nxoc-arb-card-title">' +
                        (avatar ? '<img class="nxoc-arb-avatar" src="' + _escHtml(avatar) + '" alt="">' : '<span class="nxoc-arb-avatar nxoc-arb-avatar-empty"></span>') +
                        '<strong>' + _escHtml(name) + '</strong>' +
                    '</div>' +
                    '<span>' + _escHtml(tier) + '</span>' +
                '</div>' +
                '<div class="nxoc-arb-card-grid">' +
                    '<div><label>' + str_oc_reputation + '</label><p id="nxoc-arb-info-rep">' + _escHtml(rep) + '</p></div>' +
                    '<div><label>' + str_oc_state + '</label><p>' + _escHtml(status) + '</p></div>' +
                    '<div><label>' + str_oc_commission + '</label><p>' + _escHtml(fee) + '</p></div>' +
                    '<div><label>' + str_oc_max_sats + '</label><p>' + _escHtml(max) + '</p></div>' +
                    '<div><label>' + str_oc_languages + '</label><p>' + _escHtml(a.languages || str_oc_not_specified) + '</p></div>' +
                    '<div><label>' + str_oc_bond + '</label><p>' + _escHtml(bond) + '</p></div>' +
                    '<div><label>' + str_oc_pubkey_btc + '</label><p class="nxoc-mono">' + _escHtml(a.pubkey_btc) + '</p></div>' +
                    '<div class="nxoc-arb-card-wide"><label>' + str_oc_nostr_identity + '</label><p class="nxoc-mono">' + _escHtml(npub) + '</p></div>' +
                    '<div class="nxoc-arb-card-wide"><label>' + str_oc_bio_conditions + '</label><p>' + _escHtml(a.content || str_oc_no_bio) + '</p></div>' +
                '</div>' +
            '</div>';
        },

        openInfoDialog: function (pubkeyBtc) {
            var a = this.pool[String(pubkeyBtc || '').toLowerCase()];
            if (!a) { alert(str_arbitrator_not_found); return; }
            var self = this;
            // Boton admin "Quitar arbitro de este sitio" (solo Root/Admins, y solo si el arbitro tiene
            // identidad Nostr; los sembrados por config se gestionan con "Quitar arbitro del sitio").
            var buttons = [];
            if (Config.isOnchainAdmin && a.nostr_pubkey) {
                var isBlocked = !!(Config.blockedArbitrators && Config.blockedArbitrators[a.nostr_pubkey]);
                buttons.push({
                    text: isBlocked ? str_arb_readmit_to_site : str_arb_remove_from_site,
                    class: 'btn ' + (isBlocked ? 'btn-noxtr' : 'btn-danger'),
                    action: async function(_e, overlay) {
                        if (!isBlocked && !(await confirm(str_arb_remove_confirm))) return;
                        try {
                            await self._setArbitratorBlock(a.nostr_pubkey, !isBlocked);
                            if (typeof notify === 'function') notify(isBlocked ? str_arb_readmitted : str_arb_removed_from_site, 'success', 5000);
                            document.body.removeChild(overlay);
                        } catch(e) {
                            alert(t(str_arb_block_error, e.message || e));
                        }
                    }
                });
            }
            buttons.push({ text: 'Cerrar', class: 'btn', action: function(_e, overlay) { document.body.removeChild(overlay); } });
            $('body').dialog({
                title: 'Info del arbitro',
                type: 'html',
                width: '620px',
                content: self._infoHtml(a),
                buttons: buttons
            });
            this._fetchReputation(a, function() {
                var el = document.getElementById('nxoc-arb-info-rep');
                if (el) el.textContent = self._reputationText(a);
            });
        },

        // Bloquea/desbloquea una identidad Nostr de arbitro para todo el sitio (solo admin). Persiste en
        // CFG via ajax y refleja el cambio en vivo: muta Config.blockedArbitrators y refresca selectores.
        _setArbitratorBlock: async function (nostrPubkey, blocked) {
            nostrPubkey = String(nostrPubkey || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(nostrPubkey)) throw new Error('nostr_pubkey invalido');
            var r = await _ajax('set_arbitrator_block', { nostr_pubkey: nostrPubkey, blocked: blocked ? 1 : 0 });
            if (!r || r.error) throw new Error((r && r.msg) || 'rechazado por el servidor');
            if (!Config.blockedArbitrators) Config.blockedArbitrators = {};
            if (blocked) Config.blockedArbitrators[nostrPubkey] = true;
            else delete Config.blockedArbitrators[nostrPubkey];
            this._refreshOpenSelectors();
            this._renderBlockedList();
            return r;
        },

        _fetchReputation: function (a, done) {
            if (!Config.pool || !a || !a.nostr_pubkey) {
                this._reputation[this._reputationKey(a)] = { positive: 0, neutral: 0, negative: 0, arbitrations: 0 };
                if (done) done();
                return;
            }
            var key = this._reputationKey(a);
            if (this._reputation[key] && this._reputation[key]._complete) {
                if (done) done();
                return;
            }
            var rep = { positive: 0, neutral: 0, negative: 0, arbitrations: 0, _seen: {}, _complete: false };
            this._reputation[key] = rep;
            var since = Math.floor(Date.now() / 1000) - 365 * 86400;
            var subId = Config.pool.subscribe([
                { kinds: [Config.KIND_RATING], '#y': [Config.Y_TAG], '#p': [a.nostr_pubkey], since: since, limit: 200 },
                { kinds: [Config.KIND_ARBITRATION], '#y': [Config.Y_TAG], authors: [a.nostr_pubkey], since: since, limit: 100 }
            ], async function(ev) {
                if (!ev || rep._seen[ev.id]) return;
                if (!(await _verifyProtocolEvent(ev, ev.kind === Config.KIND_RATING ? 8 : 12))) return;
                rep._seen[ev.id] = true;
                if (ev.kind === Config.KIND_RATING) {
                    // Solo cuentan las valoraciones de role=arbiter (el mismo pubkey puede recibir
                    // ratings como trader Y como arbitro; estos eventos llevan tag role para distinguir).
                    if ((_getTagValue(ev, 'role') || '').toLowerCase() !== 'arbiter') return;
                    var rating = (_getTagValue(ev, 'rating') || '').toLowerCase();
                    if (rating === 'positive') rep.positive++;
                    else if (rating === 'negative') rep.negative++;
                    else if (rating === 'neutral') rep.neutral++;
                } else if (ev.kind === Config.KIND_ARBITRATION) {
                    rep.arbitrations++;
                }
                if (done) done();
            }, function() {});
            setTimeout(function() {
                if (!rep._complete) {
                    rep._complete = true;
                    if (Config.pool) Config.pool.unsubscribe(subId);
                    if (done) done();
                }
            }, 3500);
        },

        _refreshOpenSelectors: function () {
            var els = document.querySelectorAll('.nxoc-arb-selector');
            for (var i = 0; i < els.length; i++) this.renderSelector(els[i]);
            // Si el panel admin de gestion de arbitros esta abierto, refrescarlo: el pool llega async.
            if (document.getElementById('nxoc-arb-blocked-list')) this._renderBlockedList();
            // Mantener el banner de estado y el boton pausar/reanudar en sync si el estado cambia en vivo.
            if (document.getElementById('nxoc-arb-self-status')) this._renderSelfStatus();
        },

        openRegisterDialog: async function (refreshTarget) {
            if (!Config.events || !Config.events.canSign()) { alert(str_need_sign_nostr_events); return; }
            var defaultBtc = '';
            try {
                if (Keys.isUnlocked()) {
                    var priv = await Bip86.deriveCurrentTradeKey(0);
                    defaultBtc = Bip86.privkeyToTradePubkey(priv);
                }
            } catch(e) {}
            var html = '<div class="mo-form nxoc-arb-form">' +
                '<div id="nxoc-arb-tabs" class="nxoc-arb-tabs">' +
                    '<ul><li><a href="#nxoc-arb-tab-form">' + _escHtml(str_arb_tab_profile) + '</a></li><li><a href="#nxoc-arb-tab-info">' + _escHtml(str_arb_tab_what) + '</a></li></ul>' +
                    '<div id="nxoc-arb-tab-form">' +
                        '<div id="nxoc-arb-self-status" class="nxoc-arb-self-status"></div>' +
                        '<div class="nxoc-arb-fee-summary"><strong>' + _escHtml(str_arb_fee_summary_title) + '</strong><span>' + str_arb_fee_summary_body + '</span></div>' +
                        '<div class="nxoc-arb-fields">' +
                            '<label class="nxoc-field nxoc-field-wide"><span title="' + _escHtml(str_arb_pubkey_btc_title) + '">' + _escHtml(str_arb_label_pubkey_btc) + '</span><input id="nxoc-arb-btc" class="mo-input" maxlength="64" value="' + _escHtml(defaultBtc) + '" placeholder="' + _escHtml(str_arb_pubkey_btc_ph) + '" title="' + _escHtml(str_arb_pubkey_btc_input_title) + '">' +
                            '<div class="nxoc-field nxoc-field-wide nxoc-arb-key-row"><small class="mo-hint">' + _escHtml(str_arb_btc_key_hint) + '</small><button type="button" id="nxoc-arb-btc-setup" class="btn btn-small secondary">' + _escHtml(str_arb_create_btc_key) + '</button></div></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_tier_title) + '">' + _escHtml(str_arb_label_tier) + '</span><select id="nxoc-arb-tier" class="mo-input nxoc-arb-tier" title="' + _escHtml(str_arb_tier_select_title) + '"><option value="regular">' + _escHtml(str_arb_tier_regular) + '</option><option value="professional">' + _escHtml(str_arb_tier_professional) + '</option></select></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_max_sats_title) + '">' + _escHtml(str_arb_label_max_sats) + '</span><input id="nxoc-arb-max" class="mo-input" type="number" min="0" value="0" title="' + _escHtml(str_arb_max_sats_input_title) + '"></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_min_sats_title) + '">' + _escHtml(str_arb_label_min_sats) + '</span><input id="nxoc-arb-fee-min" class="mo-input" type="number" min="546" step="50" value="546" title="' + _escHtml(str_arb_min_sats_input_title) + '"></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_fee_pct_title) + '">' + _escHtml(str_arb_label_fee_pct) + '</span><input id="nxoc-arb-fee" class="mo-input" type="number" step="0.1" min="0" value="0.2" title="' + _escHtml(str_arb_fee_pct_input_title) + '"></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_langs_title) + '">' + _escHtml(str_arb_label_langs) + '</span><input id="nxoc-arb-langs" class="mo-input" value="es" placeholder="es,en" title="' + _escHtml(str_arb_langs_input_title) + '"></label>' +
                        '</div>' +
                        '<div class="nxoc-arb-bond-row">' +
                            '<label class="nxoc-field nxoc-field-bond-tx"><span title="' + _escHtml(str_arb_bond_txid_title) + '">' + _escHtml(str_arb_label_bond_txid) + '</span><input id="nxoc-arb-bond-txid" class="mo-input" maxlength="64" placeholder="' + _escHtml(str_arb_optional_ph) + '" title="' + _escHtml(str_arb_bond_txid_input_title) + '"></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_vout_title) + '">' + _escHtml(str_arb_label_vout) + '</span><input id="nxoc-arb-bond-vout" class="mo-input" type="number" min="0" placeholder="' + _escHtml(str_arb_optional_ph) + '" title="' + _escHtml(str_arb_vout_input_title) + '"></label>' +
                            '<label class="nxoc-field"><span title="' + _escHtml(str_arb_bond_sats_title) + '">' + _escHtml(str_arb_label_bond_sats) + '</span><input id="nxoc-arb-bond-amount" class="mo-input" type="number" min="0" placeholder="' + _escHtml(str_arb_optional_ph) + '" title="' + _escHtml(str_arb_bond_sats_input_title) + '"></label>' +
                        '</div>' +
                        '<label class="nxoc-field nxoc-field-wide nxoc-field-bio"><span title="' + _escHtml(str_arb_bio_title) + '">' + _escHtml(str_arb_label_bio) + '</span><textarea id="nxoc-arb-bio" class="mo-input" maxlength="240" rows="3" placeholder="' + _escHtml(str_arb_bio_ph) + '" title="' + _escHtml(str_arb_bio_input_title) + '"></textarea></label>' +
                        '<div class="nxoc-arb-note">' + _escHtml(str_arb_bond_note) + '</div>' +
                        '<div class="nxoc-arb-actions-hint">' + _escHtml(str_arb_actions_hint) + '</div>' +
                        (Config.isOnchainAdmin
                            ? '<div class="nxoc-arb-sitebox">' +
                                '<strong>' + _escHtml(str_arb_sitebox_title) + '</strong>' +
                                '<p>' + str_arb_sitebox_body + '</p>' +
                                '<button type="button" id="nxoc-arb-setsite" class="btn btn-noxtr btn-sm">' + _escHtml(str_arb_sitebox_use) + '</button>' +
                                '<button type="button" id="nxoc-arb-unsetsite" class="btn btn-noxtr btn-sm">' + _escHtml(str_arb_sitebox_unset) + '</button>' +
                                '<div class="nxoc-arb-site-status" id="nxoc-arb-site-status"></div>' +
                                '<div class="nxoc-arb-blocked" id="nxoc-arb-blocked-list"></div>' +
                              '</div>'
                            : '') +
                    '</div>' +
                    '<div id="nxoc-arb-tab-info">' +
                        '<div class="nxoc-arb-intro">' +
                            '<strong>' + _escHtml(str_arb_info_intro_title) + '</strong>' +
                            '<p>' + _escHtml(str_arb_info_intro_p1) + '</p>' +
                            '<p>' + _escHtml(str_arb_info_intro_p2) + '</p>' +
                        '</div>' +
                        '<h4 class="nxoc-arb-section-title">' + _escHtml(str_arb_info_types_title) + '</h4>' +
                        '<div class="nxoc-arb-info-grid">' +
                            '<div><strong>' + _escHtml(str_arb_info_type_site_t) + '</strong><span>' + _escHtml(str_arb_info_type_site_d) + '</span></div>' +
                            '<div><strong>' + _escHtml(str_arb_info_type_reg_t) + '</strong><span>' + _escHtml(str_arb_info_type_reg_d) + '</span></div>' +
                            '<div><strong>' + _escHtml(str_arb_info_type_pro_t) + '</strong><span>' + _escHtml(str_arb_info_type_pro_d) + '</span></div>' +
                        '</div>' +
                        '<div class="nxoc-arb-commitments">' +
                            '<strong>' + _escHtml(str_arb_info_recovery_title) + '</strong>' +
                            '<p>' + _escHtml(str_arb_info_recovery_body) + '</p>' +
                            '<strong>' + _escHtml(str_arb_info_accept_title) + '</strong>' +
                            '<ul><li>' + _escHtml(str_arb_info_accept_li1) + '</li><li>' + _escHtml(str_arb_info_accept_li2) + '</li><li>' + _escHtml(str_arb_info_accept_li3) + '</li><li>' + _escHtml(str_arb_info_accept_li4) + '</li><li>' + _escHtml(str_arb_info_accept_li5) + '</li></ul>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
            $('body').dialog({
                title: str_arb_dialog_title,
                type: 'html',
                width: '700px',
                content: html,
                buttons: [
                    // Botones contextuales: la visibilidad/etiqueta la ajusta _refreshDialogButtons() segun
                    // el estado (sin publicar / activo / pausado). Ninguna accion cierra el dialog (salvo
                    // Cerrar): cada accion publica a Nostr y refresca el estado en sitio.
                    { text: str_be_arbitrator, class: 'btn btn-primary nxoc-arb-publishbtn', action: async function(ev) {
                        var btn = ev.target;
                        var pk = document.getElementById('nxoc-arb-btc').value;
                        var keepPaused = Arbitrators._isPaused(pk);
                        var prevLabel = btn.textContent;
                        btn.disabled = true; btn.textContent = str_publishing;
                        try {
                            await Arbitrators.publishAdvertisement({
                                pubkey_btc: pk,
                                tier: document.getElementById('nxoc-arb-tier').value,
                                max_amount: document.getElementById('nxoc-arb-max').value,
                                fee_min_sats: document.getElementById('nxoc-arb-fee-min').value,
                                fee_rate: document.getElementById('nxoc-arb-fee').value,
                                languages: document.getElementById('nxoc-arb-langs').value,
                                bond_txid: document.getElementById('nxoc-arb-bond-txid').value,
                                bond_vout: document.getElementById('nxoc-arb-bond-vout').value,
                                bond_amount: document.getElementById('nxoc-arb-bond-amount').value,
                                content: document.getElementById('nxoc-arb-bio').value,
                                // Si estaba pausado, "Guardar cambios" no debe reactivar sin querer.
                                status: keepPaused ? 'unavailable' : 'active'
                            });
                            if (typeof notify === 'function') notify(str_arbitrator_published, 'success', 5000);
                            if (refreshTarget) Arbitrators.renderSelector(refreshTarget);
                        } catch(e) {
                            alert(t(str_publish_error, e.message));
                        }
                        btn.disabled = false; btn.textContent = prevLabel;
                        Arbitrators._renderSelfStatus();
                    }},
                    { text: str_pause_unavailable, class: 'btn btn-warning nxoc-arb-pausebtn', action: async function(ev) {
                        var btn = ev.target;
                        var pk = document.getElementById('nxoc-arb-btc').value;
                        if (Arbitrators._isPaused(pk)) {
                            btn.disabled = true; btn.textContent = str_resuming;
                            try {
                                await Arbitrators.resumeAdvertisement(pk);
                                if (typeof notify === 'function') notify(str_arbitrator_resumed, 'success', 5000);
                                if (refreshTarget) Arbitrators.renderSelector(refreshTarget);
                            } catch(e) { alert(t(str_resume_ad_error, e.message)); }
                            btn.disabled = false; Arbitrators._renderSelfStatus();
                            return;
                        }
                        if (!(await confirm(str_pause_arbitrator_confirm))) return;
                        btn.disabled = true; btn.textContent = str_pausing;
                        try {
                            await Arbitrators.pauseAdvertisement(pk);
                            if (typeof notify === 'function') notify(str_arbitrator_paused, 'success', 5000);
                            if (refreshTarget) Arbitrators.renderSelector(refreshTarget);
                        } catch(e) { alert(t(str_pause_ad_error, e.message)); }
                        btn.disabled = false; Arbitrators._renderSelfStatus();
                    }},
                    { text: str_stop_being_arbitrator, class: 'btn btn-danger nxoc-arb-revokebtn', action: async function(ev) {
                        var btn = ev.target;
                        var pk = document.getElementById('nxoc-arb-btc').value;
                        if (!(await confirm(str_revoke_arbitrator_confirm))) return;
                        btn.disabled = true; btn.textContent = str_deleting;
                        try {
                            await Arbitrators.revokeAllMine(pk);
                            if (typeof notify === 'function') notify(str_arbitrator_revoked, 'success', 5000);
                            if (refreshTarget) Arbitrators.renderSelector(refreshTarget);
                        } catch(e) { alert(t(str_revoke_ad_error, e.message)); }
                        btn.disabled = false; btn.textContent = str_stop_being_arbitrator;
                        Arbitrators._renderSelfStatus();
                    }},
                    { text: str_arb_disputes_btn + (this.pendingDisputeCount() ? ' (' + this.pendingDisputeCount() + ')' : ''), class: 'btn' + (this.pendingDisputeCount() ? ' btn-danger' : ''), action: function() { Arbitrators.openDisputePanel(); } },
                    { text: str_close, class: 'btn', action: function(_e, overlay) { document.body.removeChild(overlay); } }
                ]
            });
            setTimeout(function() {
                if (typeof SimpleTabs === 'function') {
                    new SimpleTabs('#nxoc-arb-tabs', { active: 0, breakpoint: 620 });
                }
                if (typeof tooltip === 'function') {
                    tooltip('.nxoc-arb-form [title]', { theme: 'default', delay: 300 });
                }
                Arbitrators._renderSelfStatus();
                var btcInput = document.getElementById('nxoc-arb-btc');
                if (btcInput) btcInput.addEventListener('input', function () { Arbitrators._renderSelfStatus(); });
                // Si hay clave configurada pero el campo esta vacio (clave bloqueada al abrir), intenta
                // rellenarla. Si no hay clave, el boton la crea.
                if (btcInput && !btcInput.value) Arbitrators._fillBtcFromKeys();
                var keyBtn = document.getElementById('nxoc-arb-btc-setup');
                if (keyBtn) keyBtn.onclick = function () { Arbitrators._setupBtcKey(); };
                if (Config.isOnchainAdmin) Arbitrators._wireSiteArbitratorButtons();
            }, 80);
        },

        // Cablea los botones admin-only "Usar/Quitar arbitro del sitio" del dialog de arbitro. Escribe la
        // CFG via ajax set_site_arbitrator (el endpoint re-verifica rol Root/Administradores) y refleja el
        // cambio en vivo: Config.defaultSiteArbitrator + re-siembra del pool con tier site_admin.
        _wireSiteArbitratorButtons: function() {
            var statusEl = document.getElementById('nxoc-arb-site-status');
            function renderStatus() {
                if (!statusEl) return;
                var cur = Config.defaultSiteArbitrator || '';
                statusEl.textContent = cur ? t(str_arb_site_current, cur.slice(0, 12)) : str_arb_site_none;
            }
            renderStatus();
            var setBtn = document.getElementById('nxoc-arb-setsite');
            var unsetBtn = document.getElementById('nxoc-arb-unsetsite');
            async function apply(pk) {
                var r;
                try { r = await _ajax('set_site_arbitrator', { pubkey_btc: pk }); }
                catch(e) { if (typeof notify === 'function') notify(t(str_error_prefix, (e.message || e)), 'error', 8000); return; }
                if (!r || r.error) { if (typeof notify === 'function') notify((r && r.msg) || str_arb_site_save_error, 'error', 9000); return; }
                Config.defaultSiteArbitrator = (r.pubkey_btc && /^[a-f0-9]{64}$/.test(r.pubkey_btc)) ? r.pubkey_btc : null;
                // Re-sembrar el pool: quitar el viejo site_admin y marcar el nuevo.
                // La entrada sintetica (sin nostr_pubkey, sembrada solo por la config del sitio) se borra:
                // si no, seguiria saliendo en el selector como arbitro 'regular' aun sin sitio configurado.
                // Una entrada con anuncio real publicado (nostr_pubkey) solo se degrada a 'regular'.
                Object.keys(Arbitrators.pool).forEach(function(k) {
                    var p = Arbitrators.pool[k];
                    if (!p || p.tier !== 'site_admin') return;
                    if (!p.nostr_pubkey) delete Arbitrators.pool[k];
                    else p.tier = 'regular';
                });
                if (Config.defaultSiteArbitrator) {
                    var a = Arbitrators.pool[Config.defaultSiteArbitrator] || { pubkey_btc: Config.defaultSiteArbitrator, nostr_pubkey: '', max_amount: 0, fee_rate: 0, fee_min_sats: 546, languages: '', bond_txid: '', bond_vout: '', bond_amount: 0, content: 'Arbitro del sitio (admin web)', created_at: Math.floor(Date.now()/1000), relay: '' };
                    a.tier = 'site_admin';
                    Arbitrators.pool[Config.defaultSiteArbitrator] = a;
                }
                Arbitrators._refreshOpenSelectors();
                renderStatus();
                if (typeof notify === 'function') notify(Config.defaultSiteArbitrator ? str_arb_site_updated : str_arb_site_removed, 'success', 6000);
            }
            if (setBtn) setBtn.onclick = function() {
                var pk = (document.getElementById('nxoc-arb-btc').value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
                if (!/^[a-f0-9]{64}$/.test(pk)) { if (typeof notify === 'function') notify(str_arb_site_bad_pubkey, 'warn', 6000); return; }
                apply(pk);
            };
            if (unsetBtn) unsetBtn.onclick = function() { apply(''); };
            this._renderBlockedList();
        },

        // Panel admin de gestion de arbitros del sitio: lista TODAS las identidades Nostr de arbitros
        // conocidas (las del pool + las ya bloqueadas), cada una con boton Quitar/Readmitir. Es el punto
        // visible para que el operador quite arbitros sin tener que entrar a "Ver" de cada uno.
        _renderBlockedList: function () {
            var el = document.getElementById('nxoc-arb-blocked-list');
            if (!el) return;
            var self = this;
            var blocked = (Config && Config.blockedArbitrators) || {};
            // Recolectar identidades unicas por nostr_pubkey: del pool (con identidad) + las bloqueadas.
            var ids = {};
            for (var k in this.pool) {
                if (!this.pool.hasOwnProperty(k)) continue;
                var a = this.pool[k];
                if (a && a.nostr_pubkey) ids[a.nostr_pubkey] = true;
            }
            Object.keys(blocked).forEach(function (npub) { ids[npub] = true; });
            var list = Object.keys(ids);
            if (!list.length) { el.innerHTML = ''; return; }
            var rows = list.map(function (npub) {
                var name = '';
                if (Config.profiles && Config.profiles.displayName) { try { name = Config.profiles.displayName(npub); } catch(e) {} }
                if (!name || name === 'unknown') name = 'npub ' + npub.slice(0, 10) + '…';
                var isB = !!blocked[npub];
                return '<div class="nxoc-arb-blocked-row"><span>' + (isB ? '🚫 ' : '') + _escHtml(name) + '</span>' +
                    '<button type="button" class="btn btn-small ' + (isB ? 'secondary' : 'btn-danger') + '" data-npub="' + _escHtml(npub) + '" data-block="' + (isB ? '0' : '1') + '">' +
                    _escHtml(isB ? str_arb_readmit_to_site : str_arb_remove_from_site) + '</button></div>';
            }).join('');
            el.innerHTML = '<strong>' + _escHtml(str_arb_site_list_title) + '</strong>' + rows;
            el.querySelectorAll('button[data-npub]').forEach(function (btn) {
                btn.onclick = async function () {
                    var willBlock = btn.getAttribute('data-block') === '1';
                    if (willBlock && !(await confirm(str_arb_remove_confirm))) return;
                    btn.disabled = true;
                    try {
                        await self._setArbitratorBlock(btn.getAttribute('data-npub'), willBlock);
                        if (typeof notify === 'function') notify(willBlock ? str_arb_removed_from_site : str_arb_readmitted, 'success', 5000);
                        self._renderBlockedList();
                    } catch(e) {
                        btn.disabled = false;
                        alert(t(str_arb_block_error, e.message || e));
                    }
                };
            });
        },

        // Banner de estado del dialog "Quiero ser arbitro on-chain": indica si la pubkey BTC del
        // formulario corresponde a un anuncio propio activo, pausado, o si todavia no estas anunciado.
        // Solo cuenta como propio si el anuncio en el pool lo firmo tu identidad Nostr actual.
        _renderSelfStatus: function () {
            var el = document.getElementById('nxoc-arb-self-status');
            if (!el) return;
            var btc = ((document.getElementById('nxoc-arb-btc') || {}).value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            var myNostr = (Config.events && Config.events.pubkey) || '';
            var a = this.pool[btc];
            var mine = !!(a && myNostr && a.nostr_pubkey === myNostr);
            var cls, text;
            if (mine && (a.status || 'active') === 'unavailable') { cls = 'paused'; text = str_arb_status_paused; }
            else if (mine) { cls = 'active'; text = str_arb_status_active; }
            else { cls = 'none'; text = str_arb_status_none; }
            el.className = 'nxoc-arb-self-status nxoc-arb-self-status-' + cls;
            el.textContent = text;
            this._refreshDialogButtons();
        },

        // Deriva la pubkey BTC (BIP86 idx 0) de la clave escrow desbloqueada y la mete en el campo.
        // Si esta configurada pero bloqueada, intenta desbloquear (auto-unlock sin contrasena). No-op
        // si no hay clave: en ese caso el usuario debe pulsar "Crear / configurar clave BTC".
        _fillBtcFromKeys: async function () {
            try {
                if (!Keys.isUnlocked()) {
                    if (!(await Keys.isConfigured())) return;
                    try { await Keys.unlock(); } catch(e) { return; }
                }
                var priv = await Bip86.deriveCurrentTradeKey(0);
                var pub  = Bip86.privkeyToTradePubkey(priv);
                var input = document.getElementById('nxoc-arb-btc');
                if (input && !input.value) { input.value = pub; this._renderSelfStatus(); }
            } catch(e) { _warn('_fillBtcFromKeys', e.message); }
        },

        // Boton "Crear / configurar clave BTC": reusa el mismo dialog que el flujo de crear oferta
        // (Keys.openSetupDialog -> html_onchain_keys.php). Tras configurar, rellena el campo idx 0.
        _setupBtcKey: function () {
            var self = this;
            Keys.openSetupDialog(function () {
                var input = document.getElementById('nxoc-arb-btc');
                if (input) input.value = '';
                self._fillBtcFromKeys();
            });
        },

        // Set persistente { pubkeyBtc: revokedAtSec } de anuncios que YO he revocado, para no volver a
        // mostrarlos si un relay reenvia el ARB_ADV viejo tras recargar. Cache en _revokedCache.
        _REVOKED_LS: 'nxoc_arb_revoked',
        _revokedCache: null,
        _revoked: function () {
            if (this._revokedCache) return this._revokedCache;
            try { this._revokedCache = JSON.parse(localStorage.getItem(this._REVOKED_LS) || '{}') || {}; }
            catch(e) { this._revokedCache = {}; }
            return this._revokedCache;
        },
        _markRevoked: function (pubkeyBtc, on) {
            var m = this._revoked();
            if (on) m[pubkeyBtc] = Math.floor(Date.now() / 1000);
            else delete m[pubkeyBtc];
            try { localStorage.setItem(this._REVOKED_LS, JSON.stringify(m)); } catch(e) {}
        },

        publishAdvertisement: async function (params) {
            params = params || {};
            var pubkeyBtc = String(params.pubkey_btc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!/^[a-f0-9]{64}$/.test(pubkeyBtc)) throw new Error('pubkey_btc debe ser 64 hex.');
            var tier = String(params.tier || 'regular').toLowerCase();
            // El usuario solo puede registrarse como regular o professional. site_admin es la clave del
            // admin de la web (se siembra por config, no se publica con este formulario).
            if (['regular', 'professional'].indexOf(tier) === -1) tier = 'regular';
            var pubStatus = (params.status === 'unavailable') ? 'unavailable' : 'active';
            var tags = [
                ['d', pubkeyBtc],
                ['y', Config.Y_TAG],
                ['pubkey_btc', pubkeyBtc],
                ['tier', tier],
                ['status', pubStatus],
                ['max_amount', String(Math.max(0, parseInt(params.max_amount || '0', 10) || 0))],
                ['fee_min_sats', String(Math.max(0, parseInt(params.fee_min_sats || '200', 10) || 0))],
                ['fee_rate', String(Math.max(0, parseFloat(params.fee_rate || '0') || 0))],
                ['languages', String(params.languages || '').replace(/[^a-zA-Z,\-_]/g, '').slice(0, 80)]
            ];
            var bondTxid = String(params.bond_txid || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (/^[a-f0-9]{64}$/.test(bondTxid)) {
                tags.push(['bond_txid', bondTxid]);
                tags.push(['bond_vout', String(Math.max(0, parseInt(params.bond_vout || '0', 10) || 0))]);
                tags.push(['bond_amount', String(Math.max(0, parseInt(params.bond_amount || '0', 10) || 0))]);
            }
            var unsigned = {
                pubkey: Config.events.pubkey,
                kind: Config.KIND_ARB_ADV,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: String(params.content || '').slice(0, 240)
            };
            var mined = await PowMiner.mineRemote(unsigned, 16);
            var signed = await Config.events.sign(Object.assign({}, mined.event, { id: mined.id }));
            Config.pool.publish(signed);
            this._markRevoked(pubkeyBtc, false);
            this._handleEvent(signed, '');
            // Un arbitro = una sola clave: revocar mis otros anuncios con distinta pubkey BTC para no
            // aparecer duplicado en el selector con varias claves.
            var myNostr = Config.events.pubkey;
            var others = [];
            for (var k in this.pool) {
                if (!this.pool.hasOwnProperty(k)) continue;
                if (k !== pubkeyBtc && this.pool[k] && this.pool[k].nostr_pubkey === myNostr) others.push(k);
            }
            for (var i = 0; i < others.length; i++) {
                try { await this.revokeAdvertisement(others[i]); } catch(e) { _warn('publish: revoke stale own ad', others[i].slice(0, 8), e.message); }
            }
            this._refreshOpenSelectors();
            return signed;
        },

        pauseAdvertisement: async function (pubkeyBtc) {
            pubkeyBtc = String(pubkeyBtc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!/^[a-f0-9]{64}$/.test(pubkeyBtc)) throw new Error('pubkey_btc debe ser 64 hex.');
            if (!Config.events || !Config.events.canSign() || !Config.events.pubkey) {
                throw new Error('Necesitas poder firmar con tu identidad Nostr.');
            }
            var existing = this.pool[pubkeyBtc];
            if (existing && existing.nostr_pubkey && existing.nostr_pubkey !== Config.events.pubkey) {
                throw new Error('Este anuncio pertenece a otra identidad Nostr.');
            }
            var unsigned = {
                pubkey: Config.events.pubkey,
                kind: Config.KIND_ARB_ADV,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', pubkeyBtc],
                    ['y', Config.Y_TAG],
                    ['pubkey_btc', pubkeyBtc],
                    ['tier', existing ? (existing.tier || 'regular') : 'regular'],
                    ['status', 'unavailable'],
                    ['max_amount', existing ? String(existing.max_amount || 0) : '0'],
                    ['fee_min_sats', existing ? String(existing.fee_min_sats || 200) : '200'],
                    ['fee_rate', existing ? String(existing.fee_rate || 0) : '0'],
                    ['languages', existing ? String(existing.languages || '') : '']
                ],
                content: existing ? String(existing.content || '').slice(0, 240) : str_oc_temporarily_unavailable
            };
            var mined = await PowMiner.mineRemote(unsigned, 16);
            var signed = await Config.events.sign(Object.assign({}, mined.event, { id: mined.id }));
            Config.pool.publish(signed);
            this._handleEvent(signed, '');
            this._refreshOpenSelectors();
            return signed;
        },

        // Inverso de pausar: republica el anuncio existente con status='active' conservando sus datos
        // (tier, comision, bond, idiomas, bio). Propaga en tiempo real igual que pausar.
        resumeAdvertisement: async function (pubkeyBtc) {
            pubkeyBtc = String(pubkeyBtc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!/^[a-f0-9]{64}$/.test(pubkeyBtc)) throw new Error('pubkey_btc debe ser 64 hex.');
            if (!Config.events || !Config.events.canSign() || !Config.events.pubkey) {
                throw new Error('Necesitas poder firmar con tu identidad Nostr.');
            }
            var existing = this.pool[pubkeyBtc];
            if (existing && existing.nostr_pubkey && existing.nostr_pubkey !== Config.events.pubkey) {
                throw new Error('Este anuncio pertenece a otra identidad Nostr.');
            }
            var tags = [
                ['d', pubkeyBtc],
                ['y', Config.Y_TAG],
                ['pubkey_btc', pubkeyBtc],
                ['tier', existing ? (existing.tier || 'regular') : 'regular'],
                ['status', 'active'],
                ['max_amount', existing ? String(existing.max_amount || 0) : '0'],
                ['fee_min_sats', existing ? String(existing.fee_min_sats || 200) : '200'],
                ['fee_rate', existing ? String(existing.fee_rate || 0) : '0'],
                ['languages', existing ? String(existing.languages || '') : '']
            ];
            if (existing && /^[a-f0-9]{64}$/.test(existing.bond_txid || '')) {
                tags.push(['bond_txid', existing.bond_txid]);
                tags.push(['bond_vout', String(existing.bond_vout || 0)]);
                tags.push(['bond_amount', String(existing.bond_amount || 0)]);
            }
            var unsigned = {
                pubkey: Config.events.pubkey,
                kind: Config.KIND_ARB_ADV,
                created_at: Math.floor(Date.now() / 1000),
                tags: tags,
                content: existing ? String(existing.content || '').slice(0, 240) : ''
            };
            var mined = await PowMiner.mineRemote(unsigned, 16);
            var signed = await Config.events.sign(Object.assign({}, mined.event, { id: mined.id }));
            Config.pool.publish(signed);
            this._markRevoked(pubkeyBtc, false);
            this._handleEvent(signed, '');
            this._refreshOpenSelectors();
            return signed;
        },

        // ¿La pubkey BTC del campo corresponde a un anuncio MIO actualmente pausado?
        _isPaused: function (pubkeyBtc) {
            pubkeyBtc = String(pubkeyBtc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            var a = this.pool[pubkeyBtc];
            var myNostr = (Config.events && Config.events.pubkey) || '';
            return !!(a && myNostr && a.nostr_pubkey === myNostr && (a.status || 'active') === 'unavailable');
        },

        // Ajusta etiquetas y visibilidad de los botones del dialog segun el estado del anuncio del campo
        // BTC: sin publicar / activo / pausado. Botones contextuales (ver buttons[] de openRegisterDialog).
        _refreshDialogButtons: function () {
            var pk = (document.getElementById('nxoc-arb-btc') || {}).value || '';
            var myNostr = (Config.events && Config.events.pubkey) || '';
            var a = this.pool[String(pk || '').toLowerCase().replace(/[^a-f0-9]/g, '')];
            var published = !!(a && myNostr && a.nostr_pubkey === myNostr && (a.status || 'active') !== 'deleted');
            var paused = this._isPaused(pk);

            var pubBtn = document.querySelector('.nxoc-arb-publishbtn');
            if (pubBtn && pubBtn.disabled === false) pubBtn.textContent = published ? str_save_changes : str_be_arbitrator;

            var pauseBtn = document.querySelector('.nxoc-arb-pausebtn');
            if (pauseBtn) {
                pauseBtn.style.display = published ? '' : 'none';
                if (pauseBtn.disabled === false) {
                    pauseBtn.textContent = paused ? str_resume_arbitrator : str_pause_unavailable;
                    pauseBtn.classList.toggle('btn-noxtr', paused);
                    pauseBtn.classList.toggle('btn-warning', !paused);
                }
            }
            var revokeBtn = document.querySelector('.nxoc-arb-revokebtn');
            if (revokeBtn) revokeBtn.style.display = published ? '' : 'none';
        },

        revokeAdvertisement: async function (pubkeyBtc) {
            pubkeyBtc = String(pubkeyBtc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!/^[a-f0-9]{64}$/.test(pubkeyBtc)) throw new Error('pubkey_btc debe ser 64 hex.');
            if (!Config.events || !Config.events.canSign() || !Config.events.pubkey) {
                throw new Error('Necesitas poder firmar con tu identidad Nostr.');
            }
            var existing = this.pool[pubkeyBtc];
            if (existing && existing.nostr_pubkey && existing.nostr_pubkey !== Config.events.pubkey) {
                throw new Error('Este anuncio pertenece a otra identidad Nostr.');
            }
            // 1) Publicar un ARB_ADV de reemplazo con status='deleted'. Igual que pausar, este evento SI
            //    se propaga a los demas clientes (estan suscritos a KIND_ARB_ADV, no a kind 5), asi que el
            //    arbitro desaparece de su selector en tiempo real. El kind 5 por si solo no lo lograba:
            //    nadie escucha borrados de arbitros y muchos relays no respetan NIP-09.
            var delAd = {
                pubkey: Config.events.pubkey,
                kind: Config.KIND_ARB_ADV,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['d', pubkeyBtc],
                    ['y', Config.Y_TAG],
                    ['pubkey_btc', pubkeyBtc],
                    ['tier', existing ? (existing.tier || 'regular') : 'regular'],
                    ['status', 'deleted']
                ],
                content: ''
            };
            var minedDel = await PowMiner.mineRemote(delAd, 16);
            var signedDel = await Config.events.sign(Object.assign({}, minedDel.event, { id: minedDel.id }));
            Config.pool.publish(signedDel);
            // 2) Ademas, kind 5 (NIP-09) para que los relays que lo respeten purguen el anuncio del todo.
            var aTag = Config.KIND_ARB_ADV + ':' + Config.events.pubkey + ':' + pubkeyBtc;
            var unsigned = await Config.events.create(5, 'Arbitrator advertisement deleted', [['a', aTag], ['y', Config.Y_TAG]]);
            var signed = await Config.events.sign(unsigned);
            Config.pool.publish(signed);
            this._markRevoked(pubkeyBtc, true);
            delete this.pool[pubkeyBtc];
            this._refreshOpenSelectors();
            return signed;
        },

        // "Dejar de ser arbitro": revoca TODOS mis anuncios (todas las pubkey BTC de mi identidad Nostr),
        // no solo la del campo. Asi no queda ninguno publicado si tenia varios con distintas claves.
        revokeAllMine: async function (fallbackBtc) {
            if (!Config.events || !Config.events.canSign() || !Config.events.pubkey) {
                throw new Error('Necesitas poder firmar con tu identidad Nostr.');
            }
            var myNostr = Config.events.pubkey;
            var mine = [];
            for (var k in this.pool) {
                if (!this.pool.hasOwnProperty(k)) continue;
                if (this.pool[k] && this.pool[k].nostr_pubkey === myNostr) mine.push(k);
            }
            var fb = String(fallbackBtc || '').toLowerCase().replace(/[^a-f0-9]/g, '');
            if (/^[a-f0-9]{64}$/.test(fb) && mine.indexOf(fb) === -1) mine.push(fb);
            if (!mine.length) throw new Error('No se encontro ningun anuncio tuyo que revocar.');
            for (var i = 0; i < mine.length; i++) await this.revokeAdvertisement(mine[i]);
            return mine.length;
        },

        // ==================== PANEL DEL ARBITRO (disputas entrantes) ====================
        //
        // El arbitro recibe un DM 'dispute_request' (lo despacha Trader._initDmHandler) con todo el
        // contrato del trade: no es parte, no tiene fila local en NSTR_TRADES. Guardamos cada solicitud
        // en localStorage ('nxoc_arb_disputes') porque los DMs ya vistos no se re-despachan tras recarga
        // (Trader._seenDmIds filtra antes del dispatch), asi que el panel debe sobrevivir al reload.

        _disputes: {},          // order_id -> solicitud + estado de resolucion
        _disputesLoaded: false,
        _DISPUTES_LS: 'nxoc_arb_disputes',

        _loadDisputes: function () {
            if (this._disputesLoaded) return;
            this._disputesLoaded = true;
            try { this._disputes = JSON.parse(localStorage.getItem(this._DISPUTES_LS) || '{}') || {}; }
            catch(e) { this._disputes = {}; }
        },
        _saveDisputes: function () {
            try { localStorage.setItem(this._DISPUTES_LS, JSON.stringify(this._disputes)); } catch(e) {}
        },

        pendingDisputeCount: function () {
            this._loadDisputes();
            var n = 0;
            for (var k in this._disputes) {
                if (this._disputes.hasOwnProperty(k) && !this._disputes[k].resolved) n++;
            }
            return n;
        },

        // DM 'dispute_request' entrante. Valida campos y procedencia (debe venir de una de las dos
        // partes del trade), lo guarda y avisa. La comprobacion de que YO soy arbitro (mi pubkey BIP86
        // idx 0 esta en el set) se hace al resolver, porque requiere desbloquear Keys; aqui el DM ya
        // venia cifrado a mi identidad Nostr, asi que basta con validar que es coherente.
        _handleDisputeRequest: async function (ev, msg) {
            this._loadDisputes();
            var orderId = String((msg && msg.order_id) || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            if (!orderId) return;
            var arbs = _normalizeArbitrators(String(msg.arbitrators || '').split(','));
            if (arbs.length !== 3) { _warn('dispute_request: arbitros invalidos', orderId.slice(0, 8)); return; }
            var txid = String(msg.funding_txid || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(txid)) { _warn('dispute_request: funding_txid invalido', orderId.slice(0, 8)); return; }
            if (!msg.taproot_address) { _warn('dispute_request: sin taproot_address', orderId.slice(0, 8)); return; }
            var sellerTrade = String(msg.seller_trade_pubkey || '').toLowerCase();
            var buyerTrade  = String(msg.buyer_trade_pubkey || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(sellerTrade) || !/^[a-f0-9]{64}$/.test(buyerTrade)) {
                _warn('dispute_request: trade pubkeys invalidas', orderId.slice(0, 8)); return;
            }
            var sellerNostr = String(msg.seller_nostr_pubkey || '').toLowerCase();
            var buyerNostr  = String(msg.buyer_nostr_pubkey || '').toLowerCase();
            var makerNostr  = String(msg.maker_nostr_pubkey || '').toLowerCase();
            var takerNostr  = String(msg.taker_nostr_pubkey || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(sellerNostr) || !/^[a-f0-9]{64}$/.test(buyerNostr) ||
                !/^[a-f0-9]{64}$/.test(makerNostr) || !/^[a-f0-9]{64}$/.test(takerNostr) ||
                [makerNostr, takerNostr].indexOf(sellerNostr) === -1 ||
                [makerNostr, takerNostr].indexOf(buyerNostr) === -1 || sellerNostr === buyerNostr) {
                _warn('dispute_request: identidades invalidas', orderId.slice(0, 8)); return;
            }
            // Procedencia: el DM debe venir de una de las dos partes del trade.
            if (ev.pubkey !== sellerNostr && ev.pubkey !== buyerNostr) {
                _warn('dispute_request: emisor no es parte del trade', orderId.slice(0, 8)); return;
            }
            if (msg.initiator !== 'seller' && msg.initiator !== 'buyer') {
                _warn('dispute_request: initiator invalido', orderId.slice(0, 8)); return;
            }
            if ((msg.initiator === 'seller' && ev.pubkey !== sellerNostr) ||
                (msg.initiator === 'buyer' && ev.pubkey !== buyerNostr)) {
                _warn('dispute_request: initiator no coincide con el emisor', orderId.slice(0, 8)); return;
            }
            var network = String(msg.network || '').toLowerCase();
            if (_NETWORKS.indexOf(network) === -1) { _warn('dispute_request: red invalida', orderId.slice(0, 8)); return; }
            var tradeId = String(msg.trade_id || '').toLowerCase();
            if (!/^[a-f0-9]{32}$/.test(tradeId) || tradeId !== await _computeTradeId(orderId, takerNostr)) {
                _warn('dispute_request: trade_id invalido', orderId.slice(0, 8)); return;
            }
            var satAmount = parseInt(msg.sat_amount, 10) || 0;
            var arbFee = parseInt(msg.arb_fee_sats, 10) || 0;
            var fundingValue = parseInt(msg.funding_value, 10) || 0;
            var fundingVout = parseInt(msg.funding_vout, 10);
            if (!(satAmount > 0) || arbFee < _DUST_SATS || arbFee > satAmount ||
                fundingValue !== satAmount + arbFee || !(fundingVout >= 0)) {
                _warn('dispute_request: importes/outpoint incoherentes', orderId.slice(0, 8)); return;
            }
            try {
                nobleSecp256k1.Point.fromHex('02' + sellerTrade);
                nobleSecp256k1.Point.fromHex('02' + buyerTrade);
                var derivedAddress = await Taproot.buildAddress(sellerTrade, buyerTrade, arbs, network);
                if (derivedAddress !== String(msg.taproot_address)) throw new Error('address mismatch');
            } catch(e) { _warn('dispute_request: contrato Taproot invalido', orderId.slice(0, 8)); return; }
            var existing = this._disputes[orderId];
            if (existing && existing.resolved) return;   // ya resuelta: ignorar re-llegada
            this._disputes[orderId] = {
                order_id:              orderId,
                trade_id:              tradeId,
                network:               network,
                reason:                String(msg.reason || ''),
                initiator:             (msg.initiator === 'seller') ? 'seller' : 'buyer',
                taproot_address:       String(msg.taproot_address),
                funding_txid:          txid,
                funding_vout:          fundingVout,
                funding_value:         fundingValue,
                sat_amount:            satAmount,
                arb_fee_sats:          arbFee,
                arbitrators:           arbs.join(','),
                seller_trade_pubkey:   sellerTrade,
                buyer_trade_pubkey:    buyerTrade,
                buyer_payout_address:  String(msg.buyer_payout_address || ''),
                seller_payout_address: String(msg.seller_payout_address || ''),
                seller_nostr_pubkey:   sellerNostr,
                buyer_nostr_pubkey:    buyerNostr,
                maker_nostr_pubkey:    makerNostr,
                taker_nostr_pubkey:    takerNostr,
                from:                  ev.pubkey,
                received_at:           ev.created_at || Math.floor(Date.now() / 1000),
                resolved:              false,
                resolution:            null
            };
            this._saveDisputes();
            _log('dispute_request recibido', { orderId: orderId.slice(0, 8), from: ev.pubkey.slice(0, 8) + '…' });
            if (typeof notify === 'function') {
                notify(window.t(str_oc_dispute_to_arbitrate, orderId.slice(0, 8)), 'warn', 0);
            }
            this._refreshDisputePanel();
        },

        // Objeto compatible con Spend.buildArbitration a partir de una solicitud (el arbitro no tiene
        // fila local). Mapeo deliberado para que UI.fundingKeys/_peerOnchainTradePubkey devuelvan las
        // pubkeys correctas: is_seller=1 + trade_role='created' -> seller=trade_key_pub, buyer=peer
        // (=taker_trade_pubkey). UI.arbitrators lee el csv. _readMeta/_tradeNetwork leen trade_json.
        _disputeToTrade: function (d) {
            return {
                method:         'onchain',
                order_id:       d.order_id,
                is_seller:      1,
                trade_role:     'created',
                trade_key_pub:  d.seller_trade_pubkey,
                funding_txid:   d.funding_txid,
                funding_vout:   d.funding_vout,
                taproot_address: d.taproot_address,
                sat_amount:     d.sat_amount,
                arbitrators:    d.arbitrators,
                trade_json: JSON.stringify({
                    network:               d.network,
                    funding_value:         d.funding_value,
                    arb_fee_sats:          d.arb_fee_sats,
                    buyer_payout_address:  d.buyer_payout_address,
                    seller_payout_address: d.seller_payout_address,
                    taker_trade_pubkey:    d.buyer_trade_pubkey
                })
            };
        },

        // Mi clave de arbitro (BIP86 idx 0, la que el dialog de registro pre-rellena como pubkey_btc)
        // y el indice de slot que ocupo en este trade. Devuelve el slot mas bajo que coincide (menor
        // CSV -> el ganador puede difundir antes). null si no estoy en el set o Keys bloqueado.
        _myArbInfo: async function (d) {
            if (!Keys.isUnlocked()) {
                try { await Keys.unlock(); } catch(e) { return null; }
            }
            var priv = await Bip86.deriveCurrentTradeKey(0);
            var pub  = Bip86.privkeyToTradePubkey(priv).toLowerCase();
            var arbs = d.arbitrators.split(',');
            for (var i = 0; i < arbs.length; i++) {
                if (String(arbs[i] || '').toLowerCase() === pub) {
                    return { privkey: priv, pubkey: pub, arbIndex: i + 1 };
                }
            }
            return null;
        },

        // Publica la decision publica del arbitro (kind 39387): winner + arb_index + network.
        _publishArbDecision: async function (d, winnerSide, arbIndex) {
            var tags = [
                ['d',         d.order_id + ':arbitration:' + String(arbIndex)],
                ['order_id',  d.order_id],
                ['y',         Config.Y_TAG],
                ['winner',    winnerSide],
                ['arb_index', String(arbIndex)],
                ['network',   d.network]
            ];
            if (d.trade_id) tags.push(['trade_id', String(d.trade_id)]);
            [d.seller_nostr_pubkey, d.buyer_nostr_pubkey].forEach(function(pk) {
                if (/^[a-f0-9]{64}$/.test(String(pk || '')) && !tags.some(function(tg) { return tg[0] === 'p' && tg[1] === pk; })) {
                    tags.push(['p', pk]);
                }
            });
            var unsigned = {
                pubkey: Config.events.pubkey, kind: Config.KIND_ARBITRATION,
                created_at: Math.floor(Date.now() / 1000), tags: tags, content: ''
            };
            var mined  = await PowMiner.mineRemote(unsigned, 12);
            var signed = await Config.events.sign(Object.assign({}, mined.event, { id: mined.id }));
            Config.pool.publish(signed);
            return signed;
        },

        // DM 'arb_signature' al ganador con la firma de la hoja. El formato lo consume
        // Trader._handleArbSignatureDm (espera order_id, arb_index, winner_side, fee_sats, tx_hex, arb_sig).
        _sendArbSignature: async function (d, winnerSide, arbIndex, feeSats, arbSpend, arbSig) {
            var DMs = window.Noxtr && window.Noxtr.DMs;
            if (!DMs || !DMs.encrypt) throw new Error('Noxtr.DMs no disponible');
            var winnerNostr = (winnerSide === 'seller') ? d.seller_nostr_pubkey : d.buyer_nostr_pubkey;
            if (!/^[a-f0-9]{64}$/.test(String(winnerNostr || ''))) throw new Error('Sin pubkey Nostr del ganador');
            // La direccion de cobro usada para construir el sighash. Si gana el vendedor, su cliente no
            // la tiene (solo se recogia la del comprador en el happy path): la enviamos para que la
            // persista y reconstruya la MISMA TX. El ganador la valida antes de difundir.
            var winnerAddr = (winnerSide === 'seller') ? d.seller_payout_address : d.buyer_payout_address;
            var payload = {
                type:                  'arb_signature',
                order_id:              d.order_id,
                trade_id:              d.trade_id || '',
                network:               d.network,
                arb_index:             arbIndex,
                winner_side:           winnerSide,
                fee_sats:              feeSats,
                tx_hex:                arbSpend.tx_hex,
                arb_sig:               arbSig,
                winner_payout_address: winnerAddr
            };
            var ciphertext = await DMs.encrypt(JSON.stringify(payload), winnerNostr);
            var unsigned   = await Config.events.create(4, ciphertext, [['p', winnerNostr], ['y', Config.Y_TAG]]);
            var signed     = await Config.events.sign(unsigned);
            Config.pool.publish(signed);
            _log('arb_signature DM enviado al ganador', { orderId: d.order_id.slice(0, 8), to: winnerNostr.slice(0, 8) + '…' });
        },

        // Resuelve una disputa a favor de winnerSide ('buyer'|'seller'). Deriva la clave de arbitro,
        // construye el gasto de la hoja de arbitraje, lo firma, publica 39387 y manda arb_signature al
        // ganador (que ensambla, difunde y cierra en Trader._handleArbSignatureDm -> UI.settleArbitration).
        resolveDispute: async function (orderId, winnerSide, feeSats) {
            this._loadDisputes();
            var d = this._disputes[orderId];
            if (!d) { if (typeof notify === 'function') notify(str_oc_dispute_not_found, 'error', 6000); return; }
            if (d.resolved) { if (typeof notify === 'function') notify(str_oc_dispute_already_resolved, 'info', 5000); return; }
            if (!Config.events || !Config.events.canSign()) { alert(str_need_sign_nostr_events); return; }
            winnerSide = (winnerSide === 'seller') ? 'seller' : 'buyer';
            var fee = parseInt(feeSats, 10) || 0;
            if (!(fee > 0)) { if (typeof notify === 'function') notify(str_oc_mining_fee_invalid, 'warn', 5000); return; }

            var info = await this._myArbInfo(d);
            if (!info) {
                if (typeof notify === 'function') notify(str_oc_not_arbitrator, 'error', 9000);
                return;
            }

            // El contrato recibido por DM no es autoridad. Antes de firmar, comprobamos que
            // el UTXO indicado existe, sigue sin gastar, paga la dirección y tiene el valor exacto.
            try {
                var chain = await _ajax('verify_funding', {
                    address: d.taproot_address,
                    expected_sats: d.funding_value,
                    expected_txid: d.funding_txid,
                    expected_vout: d.funding_vout,
                    network: d.network
                });
                if (!chain || !chain.found || chain.txid !== d.funding_txid ||
                    parseInt(chain.vout, 10) !== d.funding_vout ||
                    parseInt(chain.value_sats, 10) !== d.funding_value) {
                    throw new Error('el UTXO no coincide con el contrato de la disputa');
                }
                var requiredCsv = info.arbIndex === 2 ? Config.CSV_ARB2 : (info.arbIndex === 3 ? Config.CSV_ARB3 : 0);
                if ((parseInt(chain.confirmations, 10) || 0) < requiredCsv) {
                    throw new Error('el turno de arb' + info.arbIndex + ' aún no ha madurado (' + requiredCsv + ' bloques)');
                }
            } catch(e) {
                if (typeof notify === 'function') notify('No se puede arbitrar: ' + (e.message || String(e)), 'error', 11000);
                return;
            }

            // Si gana el vendedor necesitamos su direccion de cobro; el contrato cooperativo solo
            // exigia la del comprador, asi que en disputa la pedimos aqui si falta.
            if (winnerSide === 'seller' && !_isValidPayoutAddress(d.seller_payout_address, d.network)) {
                var addr = await prompt(window.t(str_oc_seller_payout_prompt, d.network), d.seller_payout_address || '');
                if (addr === null) return;
                addr = String(addr).trim();
                if (!_isValidPayoutAddress(addr, d.network)) { alert(window.t(str_oc_invalid_address_for, d.network)); return; }
                d.seller_payout_address = addr;
                this._saveDisputes();
            }

            var synthTrade = this._disputeToTrade(d);
            var arb, arbSig;
            try {
                arb = await Spend.buildArbitration(synthTrade, winnerSide, info.arbIndex, fee);
                arbSig = await Schnorr.sign(arb.sighash, info.privkey);
                var ok = await Schnorr.verify(arbSig, arb.sighash, info.pubkey);
                if (!ok) throw new Error('La firma del arbitro no verifica localmente');
            } catch(e) {
                if (typeof notify === 'function') notify(window.t(str_oc_sign_resolution_failed, (e.message || String(e))), 'error', 11000);
                return;
            }

            try { await this._publishArbDecision(d, winnerSide, info.arbIndex); }
            catch(e) { _warn('39387 publish failed', e); }
            try { await this._sendArbSignature(d, winnerSide, info.arbIndex, fee, arb, arbSig); }
            catch(e) {
                if (typeof notify === 'function') notify(window.t(str_oc_dm_winner_failed, (e.message || String(e))), 'warn', 11000);
                return;
            }

            d.resolved = true;
            d.resolution = { winner_side: winnerSide, arb_index: info.arbIndex, fee_sats: fee, at: Math.floor(Date.now() / 1000) };
            this._saveDisputes();
            if (typeof notify === 'function') notify(window.t(str_oc_dispute_resolved_favor, (winnerSide === 'seller' ? str_seller : str_buyer)), 'success', 0);
            this._refreshDisputePanel();
        },

        _refreshDisputePanel: async function () {
            await this._warmDisputeFees();
            var el = document.getElementById('nxoc-disputes-list');
            if (el) el.innerHTML = this._disputeListHtml();
            this._wireDisputePanel();
        },

        // Precarga la cache de fees recomendadas para cada red presente en las disputas pendientes,
        // para que _disputeListHtml (sync) pueda leer un default sensato del input "Fee mineria".
        _warmDisputeFees: async function () {
            this._loadDisputes();
            var nets = {};
            for (var k in this._disputes) {
                if (this._disputes.hasOwnProperty(k) && !this._disputes[k].resolved) {
                    nets[this._disputes[k].network] = true;
                }
            }
            var promises = [];
            for (var n in nets) if (UI && UI._recommendedFee) promises.push(UI._recommendedFee(n, _VBYTES_ARB));
            try { await Promise.all(promises); } catch(e) {}
        },

        _disputeListHtml: function () {
            this._loadDisputes();
            var ids = Object.keys(this._disputes).sort(function (a, b) {
                return (this._disputes[b].received_at || 0) - (this._disputes[a].received_at || 0);
            }.bind(this));
            if (!ids.length) return '<p class="mo-hint">' + str_oc_no_disputes + '</p>';
            var self = this;
            return ids.map(function (id) {
                var d = self._disputes[id];
                var net = d.network;
                var amount = (Number(d.sat_amount).toLocaleString());
                var arbFee = d.arb_fee_sats ? (' + ' + Number(d.arb_fee_sats).toLocaleString() + ' sats comision') : '';
                var initiator = d.initiator === 'seller' ? 'vendedor' : 'comprador';
                var explorerHref = _explorerTxUrl(net, d.funding_txid);
                var statusLine = d.resolved
                    ? '<div class="nxoc-dispute-resolved">' + window.t(str_oc_resolved_in_favor, (d.resolution && d.resolution.winner_side === 'seller' ? str_seller : str_buyer)) + '</div>'
                    : '';
                var feeDefault = 400, feeHint = '';
                var cached = (UI && UI._feeCache) ? UI._feeCache[d.network] : null;
                if (cached) { feeDefault = Math.max(cached.rate * _VBYTES_ARB, _VBYTES_ARB); feeHint = ' (' + cached.rate + ' sat/vB)'; }
                var actions = d.resolved ? '' :
                    '<div class="nxoc-dispute-actions">' +
                        '<label class="nxoc-dispute-fee">Fee mineria (sats)' + _escHtml(feeHint) + ' <input type="number" min="1" step="50" value="' + feeDefault + '" class="mo-input nxoc-dispute-fee-input" data-id="' + _escHtml(id) + '"></label>' +
                        '<div class="nxoc-dispute-btns">' +
                            '<button class="btn btn-small nxoc-dispute-win" data-id="' + _escHtml(id) + '" data-side="buyer">' + window.t(str_oc_in_favor_of, str_buyer) + '</button>' +
                            '<button class="btn btn-small nxoc-dispute-win" data-id="' + _escHtml(id) + '" data-side="seller">' + window.t(str_oc_in_favor_of, str_seller) + '</button>' +
                        '</div>' +
                    '</div>';
                return '<div class="nxoc-dispute-card' + (d.resolved ? ' nxoc-dispute-card-done' : '') + '">' +
                    '<div class="nxoc-dispute-head"><strong>#' + _escHtml(id.slice(0, 8)) + '</strong>' +
                        '<span class="nxoc-dispute-net">' + _escHtml(net) + '</span></div>' +
                    '<div class="nxoc-dispute-grid">' +
                        '<div><label>' + str_oc_amount + '</label><p>' + _escHtml(amount) + ' sats' + _escHtml(arbFee) + '</p></div>' +
                        '<div><label>' + str_oc_initiated_by + '</label><p>' + _escHtml(initiator) + '</p></div>' +
                        '<div class="nxoc-dispute-wide"><label>' + str_oc_reason + '</label><p>' + _escHtml(d.reason || '(sin motivo)') + '</p></div>' +
                        '<div class="nxoc-dispute-wide"><label>' + str_oc_buyer_payout_lbl + '</label><p class="nxoc-mono">' + _escHtml(d.buyer_payout_address || 'no facilitada') + '</p></div>' +
                        '<div class="nxoc-dispute-wide"><label>' + str_oc_seller_payout_lbl + '</label><p class="nxoc-mono">' + _escHtml(d.seller_payout_address || 'se pedira al resolver') + '</p></div>' +
                        '<div class="nxoc-dispute-wide"><label>' + str_oc_funding + '</label><p class="nxoc-mono"><a href="' + _escHtml(explorerHref) + '" target="_blank" rel="noopener">' + _escHtml(d.funding_txid.slice(0, 16)) + '…:' + d.funding_vout + '</a></p></div>' +
                    '</div>' +
                    statusLine +
                    actions +
                '</div>';
            }).join('');
        },

        _wireDisputePanel: function () {
            var self = this;
            document.querySelectorAll('.nxoc-dispute-win').forEach(function (btn) {
                btn.onclick = async function () {
                    var id   = btn.dataset.id;
                    var side = btn.dataset.side;
                    var feeInput = document.querySelector('.nxoc-dispute-fee-input[data-id="' + id + '"]');
                    var fee = feeInput ? parseInt(feeInput.value, 10) : 0;
                    var sideTxt = side === 'seller' ? str_seller : str_buyer;
                    if (!await confirm(window.t(str_oc_confirm_resolve, id.slice(0, 8), sideTxt))) return;
                    var all = document.querySelectorAll('.nxoc-dispute-win');
                    all.forEach(function (b) { b.disabled = true; });
                    try { await self.resolveDispute(id, side, fee); }
                    finally { self._refreshDisputePanel(); }
                };
            });
        },

        // Panel de disputas pendientes. Lo abre el boton del dialog de registro de arbitro.
        openDisputePanel: async function () {
            await this._warmDisputeFees();
            var html = '<div class="nxoc-disputes-panel">' +
                '<p class="mo-hint">' + str_oc_arbitrate_hint + '</p>' +
                '<div id="nxoc-disputes-list">' + this._disputeListHtml() + '</div>' +
            '</div>';
            $('body').dialog({
                title: 'Disputas on-chain',
                type: 'html',
                width: '680px',
                content: html,
                buttons: [
                    { text: 'Cerrar', class: 'btn', action: function(_e, overlay) { document.body.removeChild(overlay); } }
                ]
            });
            var self = this;
            setTimeout(function () { self._wireDisputePanel(); }, 60);
        }
    };

    // ==================== KEYS: gestión de escrow_xprv ====================
    //
    // El usuario tiene un mnemonic BIP39 (12 o 24 palabras) propio para escrow on-chain.
    // De ahí se deriva por BIP86 una trade key efímera por trade (ver Bip86 más abajo).
    // El mnemonic se guarda CIFRADO en IndexedDB (AES-GCM). La clave de cifrado se deriva de:
    //   - Si el user tiene nsec en memoria: HKDF(nsec_bytes)   → keyType:'nsec'
    //   - Si usa NIP-07/NIP-46 (sin nsec): HKDF(device_key)   → keyType:'device'
    //     donde device_key es un random de 32 bytes generado una vez y guardado en IDB.
    // Nunca cruza al servidor. No se pide contraseña adicional.
    //
    // Storage: IndexedDB database 'NoxtrOnchainKeys', object store 'keys', key='escrow_xprv'.
    // Valor: { ciphertext: Uint8Array, iv: Uint8Array, salt: Uint8Array, version: 1 }.

    var IDB_NAME      = 'NoxtrOnchainKeys';
    var IDB_STORE     = 'keys';
    var IDB_VERSION   = 1;
    var IDB_RECORD_KEY = 'escrow_xprv';

    function _idbOpen() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror   = function () { reject(req.error); };
        });
    }

    function _idbGet(key) {
        return _idbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readonly');
                var st = tx.objectStore(IDB_STORE);
                var rq = st.get(key);
                rq.onsuccess = function () { resolve(rq.result); };
                rq.onerror   = function () { reject(rq.error); };
            });
        });
    }

    function _idbPut(key, value) {
        return _idbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                var st = tx.objectStore(IDB_STORE);
                var rq = st.put(value, key);
                rq.onsuccess = function () { resolve(); };
                rq.onerror   = function () { reject(rq.error); };
            });
        });
    }

    function _idbDelete(key) {
        return _idbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                var st = tx.objectStore(IDB_STORE);
                var rq = st.delete(key);
                rq.onsuccess = function () { resolve(); };
                rq.onerror   = function () { reject(rq.error); };
            });
        });
    }

    // PBKDF2 (SHA-256, 250000 iter) → 32 bytes para AES-GCM-256.
    // Devuelve la clave de cifrado AES-GCM derivada del nsec (si disponible) o de la device_key.
    async function _getEncryptionKey(salt, keyType) {
        var rawBytes;
        if (keyType === 'nsec') {
            var privHex = Config.events && Config.events.privkey;
            if (!privHex) throw new Error('nsec no disponible para descifrar. Inicia sesión con nsec.');
            rawBytes = new Uint8Array(privHex.match(/.{2}/g).map(function(h){ return parseInt(h, 16); }));
        } else {
            // 'device': clave aleatoria persistida en IDB
            rawBytes = await _getOrCreateDeviceKey();
        }
        var baseKey = await crypto.subtle.importKey('raw', rawBytes, 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'HKDF', salt: salt, info: new TextEncoder().encode('NoxtrOnchainEscrow'), hash: 'SHA-256' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    var IDB_DEVICE_KEY = 'device_key';
    async function _getOrCreateDeviceKey() {
        var existing = await _idbGet(IDB_DEVICE_KEY);
        if (existing instanceof Uint8Array && existing.length === 32) return existing;
        var newKey = crypto.getRandomValues(new Uint8Array(32));
        await _idbPut(IDB_DEVICE_KEY, newKey);
        return newKey;
    }

    async function _encryptKey(value, format) {
        var keyType = (Config.events && Config.events.privkey) ? 'nsec' : 'device';
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var iv   = crypto.getRandomValues(new Uint8Array(12));
        var key  = await _getEncryptionKey(salt, keyType);
        var ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            new TextEncoder().encode(value)
        );
        return { version: 2, keyType: keyType, format: format || 'mnemonic', ciphertext: new Uint8Array(ciphertext), iv: iv, salt: salt };
    }

    async function _decryptKey(record) {
        if (record.version === 1) {
            throw new Error('Formato antiguo (v1). Abre el diálogo de claves y vuelve a guardar para migrar al nuevo formato.');
        }
        var key = await _getEncryptionKey(record.salt, record.keyType || 'device');
        var plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: record.iv },
            key,
            record.ciphertext
        );
        return new TextDecoder().decode(plaintext);
    }

    // Pre-filtro de forma; Keys.setup completa la validación con wordlist + checksum BIP39.
    function _validateMnemonicShape(mnemonic) {
        if (typeof mnemonic !== 'string') return false;
        var words = mnemonic.trim().toLowerCase().split(/\s+/);
        return words.length === 12 || words.length === 24;
    }

    // WIF: empieza por 5 (uncompressed) o K/L (compressed), 51-52 chars base58.
    function _isWIF(s) {
        return typeof s === 'string' && /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s.trim());
    }

    // Decodifica WIF a privkey hex de 64 chars. Keys.setup valida antes el checksum Base58Check.
    var _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function _wifToPrivHex(wif) {
        wif = wif.trim();
        var n = BigInt(0);
        for (var i = 0; i < wif.length; i++) {
            var c = _B58.indexOf(wif[i]);
            if (c < 0) throw new Error('Carácter WIF inválido: ' + wif[i]);
            n = n * BigInt(58) + BigInt(c);
        }
        var hex = n.toString(16);
        if (hex.length % 2) hex = '0' + hex;
        var leading = 0;
        for (var i = 0; i < wif.length && wif[i] === '1'; i++) leading++;
        var bytes = new Uint8Array(leading + hex.length / 2);
        for (var i = 0; i < hex.length / 2; i++)
            bytes[leading + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        // bytes[0] = 0x80 (version), bytes[-4..] = checksum
        var priv = bytes.slice(1, bytes.length - 4);
        if (priv.length === 33) priv = priv.slice(0, 32); // quitar flag de compresión
        return Array.from(priv).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
    }
    async function _validWifChecksum(wif) {
        try {
            var n = 0n;
            for (var i = 0; i < wif.length; i++) {
                var c = _B58.indexOf(wif[i]); if (c < 0) return false;
                n = n * 58n + BigInt(c);
            }
            var hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
            var leading = 0; while (leading < wif.length && wif[leading] === '1') leading++;
            var raw = new Uint8Array(leading + hex.length / 2);
            for (var j = 0; j < hex.length / 2; j++) raw[leading + j] = parseInt(hex.slice(j*2,j*2+2),16);
            if (raw.length < 5) return false;
            var body = raw.slice(0, -4), expected = raw.slice(-4);
            var h1 = await _sha256Bytes(body), h2 = await _sha256Bytes(h1);
            return _bytesToHex(expected) === _bytesToHex(h2.slice(0,4));
        } catch(e) { return false; }
    }

    var Keys = {
        _mnemonic: null,    // valor en memoria mientras unlocked (mnemónica o WIF). Se borra en lock().
        _keyFormat: null,   // 'mnemonic' | 'wif'
        _passphrase: '',    // BIP39; vive dentro del payload cifrado, nunca en metadata/servidor
        _initialized: false,

        init: function () {
            if (this._initialized) return;
            this._initialized = true;
            _log('Keys.init');
            // Auto-unlock sin contraseña (usa nsec o device_key automáticamente)
            var self = this;
            self.isConfigured().then(function(ok) {
                if (ok) return self.unlock().catch(function(e) { _warn('Keys.init: auto-unlock', e.message); });
            });
        },

        // Comprueba si hay un mnemonic cifrado guardado en IndexedDB.
        isConfigured: async function () {
            try {
                var rec = await _idbGet(IDB_RECORD_KEY);
                return !!(rec && rec.ciphertext);
            } catch (e) {
                _warn('isConfigured: IndexedDB error', e);
                return false;
            }
        },

        // Está desbloqueado en esta sesión del navegador (mnemonic en memoria).
        isUnlocked: function () {
            return !!this._mnemonic;
        },

        // Guarda el mnemonic cifrado en IndexedDB. La clave de cifrado se deriva
        // automáticamente del nsec del user (si está disponible) o de una device_key aleatoria.
        setup: async function (key, options) {
            options = options || {};
            var trimmed = (typeof key === 'string' ? key : '').trim();
            var format, normalized;
            if (_isWIF(trimmed)) {
                if (!(await _validWifChecksum(trimmed))) throw new Error('WIF con checksum invalido');
                format     = 'wif';
                normalized = trimmed;           // WIF es case-sensitive, no normalizar
            } else if (_validateMnemonicShape(trimmed)) {
                if (!window.bip39 || typeof window.bip39.validateMnemonic !== 'function') {
                    throw new Error('No se puede validar el checksum BIP39: libreria no disponible');
                }
                if (!window.bip39.validateMnemonic(trimmed.toLowerCase().split(/\s+/).join(' '))) {
                    throw new Error('Mnemónica BIP39 con checksum invalido');
                }
                format     = 'mnemonic';
                normalized = trimmed.toLowerCase().split(/\s+/).join(' ');
            } else {
                throw new Error('Clave inválida: debe ser mnemónica de 12/24 palabras o clave WIF (K.../L.../5...).');
            }
            var passphrase = format === 'mnemonic' ? String(options.passphrase || '') : '';
            var payload = JSON.stringify({ value: normalized, format: format, passphrase: passphrase });
            var record = await _encryptKey(payload, format);
            record.version = 3;
            await _idbPut(IDB_RECORD_KEY, record);
            this._mnemonic  = normalized;
            this._keyFormat = format;
            this._passphrase = passphrase;
            _log('Keys.setup: clave guardada (' + record.keyType + ', ' + format + ')');
            return true;
        },

        // Descifra y carga el mnemonic en memoria. Sin contraseña: usa nsec o device_key.
        unlock: async function () {
            var rec = await _idbGet(IDB_RECORD_KEY);
            if (!rec || !rec.ciphertext) {
                throw new Error('No hay clave escrow configurada. Usa Keys.setup() primero.');
            }
            try {
                var value = await _decryptKey(rec), payload = null;
                if (rec.version >= 3) payload = JSON.parse(value);
                this._mnemonic  = payload ? payload.value : value;
                this._keyFormat = payload ? payload.format : (rec.format || 'mnemonic');
                this._passphrase = payload ? String(payload.passphrase || '') : '';
                _log('Keys.unlock: clave desbloqueada en memoria (' + this._keyFormat + ')');
                return true;
            } catch (e) {
                this._mnemonic  = null;
                this._keyFormat = null;
                this._passphrase = '';
                throw e;
            }
        },

        // Olvida el mnemonic en memoria sin borrar el cifrado.
        lock: function () {
            this._mnemonic  = null;
            this._keyFormat = null;
            this._passphrase = '';
            _log('Keys.lock: clave borrada de memoria');
        },

        // Borra completamente el escrow_xprv del IndexedDB. Acción destructiva.
        // El user pierde acceso a los trades on-chain en curso si no tenía backup del mnemonic.
        clear: async function () {
            await _idbDelete(IDB_RECORD_KEY);
            this._mnemonic  = null;
            this._keyFormat = null;
            this._passphrase = '';
            _log('Keys.clear: clave escrow borrada de IndexedDB');
        },

        // Acceso al mnemonic. Lanza si no está unlocked o si el formato guardado es WIF.
        getMnemonic: function () {
            if (!this._mnemonic) throw new Error('Escrow locked. Llama Keys.unlock() primero.');
            if (this._keyFormat === 'wif') throw new Error('La clave guardada es un WIF. Usa Keys.getKey().');
            return this._mnemonic;
        },

        // Acceso genérico — devuelve { value, format } tanto para mnemónica como para WIF.
        getKey: function () {
            if (!this._mnemonic) throw new Error('Escrow locked. Llama Keys.unlock() primero.');
            return { value: this._mnemonic, format: this._keyFormat || 'mnemonic', passphrase: this._passphrase || '' };
        },

        // Abre el dialog de setup/importación de mnemónica (wquery.dialog, AJAX).
        // onDone: callback que se llama tras setup correcto (opcional).
        openSetupDialog: function (onDone) {
            window._noxtrOnchainKeysDone = typeof onDone === 'function' ? onDone : null;
            var base = (Config.ajaxUrl || '').replace(/\/ajax.*$/, '');
            $('body').dialog({
                title:  'Clave Bitcoin para trades',
                width:  '600px',
                type:   'ajax',
                content: base + '/op=onchain_keys/html'
            });
        }
    };

    // BIP86 derivation de trade keys: m/86'/0'/0'/0/<trade_index>.
    // Usa los helpers BIP32/BIP39 que script.mostro.js expone via window.NoxtrCrypto.
    var Bip86 = {
        // mnemonic (12-24 palabras) → privkey hex de 64 chars en path m/86'/0'/0'/0/<n>
        deriveTradeKeyFromMnemonic: async function (mnemonic, tradeIndex, passphrase) {
            if (!window.NoxtrCrypto || !window.NoxtrCrypto.bip39Seed || !window.NoxtrCrypto.bip32DerivePath) {
                throw new Error('NoxtrCrypto no disponible. ¿script.mostro.js cargado?');
            }
            var idx = parseInt(tradeIndex, 10);
            if (!Number.isFinite(idx) || idx < 0) throw new Error('trade_index inválido');
            var seed = await window.NoxtrCrypto.bip39Seed(mnemonic, passphrase || '');
            var path = "m/86'/0'/0'/0/" + idx;
            var privHex = await window.NoxtrCrypto.bip32DerivePath(seed, path);
            // Limpieza best-effort del seed en memoria (JS no garantiza zeroización pero al menos rompemos referencias).
            for (var i = 0; i < seed.length; i++) seed[i] = 0;
            return privHex;
        },
        // Acceso al pubkey x-only (32 bytes hex) desde un privkey hex.
        // Usa noble-secp256k1 v1.2.14 ya cargado por noxtr.
        privkeyToTradePubkey: function (privHex) {
            if (typeof nobleSecp256k1 === 'undefined') {
                throw new Error('noble-secp256k1 no disponible');
            }
            // En noble v1.2.14 getPublicKey(hex, true) devuelve 33-byte compressed (string hex).
            var compressed = nobleSecp256k1.getPublicKey(privHex, true);
            var hex = typeof compressed === 'string' ? compressed : window.NoxtrCrypto.bytesToHex(compressed);
            // x-only = quitar el primer byte (paridad)
            return hex.slice(2);
        },
        // Conveniencia: usa el mnemonic actualmente desbloqueado en Keys.
        // Lanza si Keys está locked.
        deriveCurrentTradeKey: async function (tradeIndex) {
            var key = Keys.getKey();
            if (key.format === 'wif') {
                // Un WIF se trata como raíz, no como clave de trade reutilizable. HMAC produce
                // una clave independiente y recuperable para cada índice.
                var root = _hexToBytes(_wifToPrivHex(key.value));
                var hkey = await crypto.subtle.importKey('raw', root, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                var msg = new TextEncoder().encode('nostrescrow:wif:v1:' + String(tradeIndex));
                var digest = new Uint8Array(await crypto.subtle.sign('HMAC', hkey, msg));
                var n = window.NoxtrCrypto && window.NoxtrCrypto.SECP256K1_N
                    ? window.NoxtrCrypto.SECP256K1_N
                    : BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
                var x = BigInt('0x' + _bytesToHex(digest));
                return ((x % (n - 1n)) + 1n).toString(16).padStart(64, '0');
            }
            return await this.deriveTradeKeyFromMnemonic(key.value, tradeIndex, key.passphrase);
        }
    };

    async function _hydrateTradeKey(trade) {
        if (!trade || trade.method !== 'onchain') return trade;
        // Ignorar incluso una privada legacy devuelta por la BD: la única fuente de verdad es
        // la raíz cifrada del navegador y su derivación verificable contra trade_key_pub.
        trade.trade_privkey = '';
        if (_isArchivedTrade(trade)) return trade;
        // Un trade terminal ya no puede firmar ningún gasto nuevo desde la interfaz. Evitar la
        // derivación de todo el histórico mantiene constante el coste al crecer NSTR_TRADES.
        if (['completado', 'cancelado'].indexOf(String(trade.internal_status || '').toLowerCase()) !== -1) return trade;
        var idx = parseInt(trade.trade_index, 10);
        if (!(idx >= 0) || !Keys.isUnlocked()) return trade;
        try {
            var priv = await Bip86.deriveCurrentTradeKey(idx);
            var pub = Bip86.privkeyToTradePubkey(priv).toLowerCase();
            if (String(trade.trade_key_pub || '').toLowerCase() !== pub) {
                trade._keyDerivationError = true;
                _trace('Clave local no coincide con trade_key_pub', (trade.order_id || '').slice(0, 8));
                return trade;
            }
            trade.trade_privkey = priv; // solo memoria; nunca se devuelve al servidor
            trade._keyDerivationError = false;
        } catch(e) { trade._keyDerivationError = true; }
        return trade;
    }
    async function _hydrateTrades(trades) {
        trades = Array.isArray(trades) ? trades : [];
        if (!Keys.isUnlocked() && await Keys.isConfigured()) {
            try { await Keys.unlock(); } catch(e) {}
        }
        await Promise.all(trades.map(_hydrateTradeKey));
        if (typeof Trader !== 'undefined' && Trader._replayOutbox) {
            await Promise.all(trades.filter(function(t){ return t && t.method === 'onchain'; }).map(function(t) {
                return Trader._replayOutbox(t).catch(function(){});
            }));
        }
        return trades;
    }

    // Construcción y verificación de dirección Taproot (README sec. 9).
    var TAPLEAF_VERSION = 0xc0;
    var OP_CHECKSIG = 0xac;
    var OP_CHECKSIGVERIFY = 0xad;
    var OP_CHECKSEQUENCEVERIFY = 0xb2;
    var OP_DROP = 0x75;
    var SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    var BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    function _xOnlyPubkey(pk, label) {
        pk = String(pk || '').toLowerCase().trim();
        if (!/^[a-f0-9]{64}$/.test(pk)) throw new Error((label || 'pubkey') + ' debe ser x-only 64 hex');
        return pk;
    }
    function _scriptNumBytes(n) {
        n = parseInt(n, 10);
        if (!Number.isFinite(n) || n < 0) throw new Error('CSV invalido');
        if (n === 0) return new Uint8Array([]);
        var bytes = [];
        while (n > 0) {
            bytes.push(n & 0xff);
            n = Math.floor(n / 256);
        }
        if (bytes[bytes.length - 1] & 0x80) bytes.push(0x00);
        return new Uint8Array(bytes);
    }
    function _pushData(bytes) {
        if (bytes.length > 75) throw new Error('pushdata largo no soportado');
        return _concatBytes(new Uint8Array([bytes.length]), bytes);
    }
    function _pushXOnly(pk) {
        return _pushData(_hexToBytes(_xOnlyPubkey(pk)));
    }
    function _pushScriptNum(n) {
        return _pushData(_scriptNumBytes(n));
    }
    function _compactSize(n) {
        n = parseInt(n, 10);
        if (!Number.isFinite(n) || n < 0) throw new Error('compactSize invalido');
        if (n < 253) return new Uint8Array([n]);
        if (n <= 0xffff) return new Uint8Array([253, n & 0xff, (n >> 8) & 0xff]);
        if (n <= 0xffffffff) return new Uint8Array([254, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
        throw new Error('compactSize demasiado grande');
    }
    function _withCsv(csv) {
        if (!csv) return new Uint8Array([]);
        return _concatBytes(_pushScriptNum(csv), new Uint8Array([OP_CHECKSEQUENCEVERIFY, OP_DROP]));
    }
    function _cooperativeScript(sellerPk, buyerPk) {
        return _concatBytes(
            _pushXOnly(sellerPk),
            new Uint8Array([OP_CHECKSIGVERIFY]),
            _pushXOnly(buyerPk),
            new Uint8Array([OP_CHECKSIG])
        );
    }
    function _singleSigScript(csv, signerPk) {
        return _concatBytes(
            _withCsv(csv),
            _pushXOnly(signerPk),
            new Uint8Array([OP_CHECKSIG])
        );
    }
    function _arbitrationScript(csv, arbPk, winnerPk) {
        return _concatBytes(
            _withCsv(csv),
            _pushXOnly(arbPk),
            new Uint8Array([OP_CHECKSIGVERIFY]),
            _pushXOnly(winnerPk),
            new Uint8Array([OP_CHECKSIG])
        );
    }
    function _taprootScripts(sellerPk, buyerPk, arbitrators) {
        var arbs = _normalizeArbitrators(arbitrators);
        if (arbs.length !== 3) throw new Error('Se necesitan 3 arbitros x-only para Taproot');
        sellerPk = _xOnlyPubkey(sellerPk, 'sellerPk');
        buyerPk = _xOnlyPubkey(buyerPk, 'buyerPk');
        var c2 = Config.CSV_ARB2, c3 = Config.CSV_ARB3, cr = Config.CSV_RECOVERY;
        return [
            { name: 'cooperative',       csv: 0,  script: _cooperativeScript(sellerPk, buyerPk) },
            { name: 'recovery',          csv: cr, script: _singleSigScript(cr, sellerPk) },
            { name: 'arb1_to_seller',    csv: 0,  script: _arbitrationScript(0, arbs[0], sellerPk) },
            { name: 'arb1_to_buyer',     csv: 0,  script: _arbitrationScript(0, arbs[0], buyerPk) },
            { name: 'arb2_to_seller',    csv: c2, script: _arbitrationScript(c2, arbs[1], sellerPk) },
            { name: 'arb2_to_buyer',     csv: c2, script: _arbitrationScript(c2, arbs[1], buyerPk) },
            { name: 'arb3_to_seller',    csv: c3, script: _arbitrationScript(c3, arbs[2], sellerPk) },
            { name: 'arb3_to_buyer',     csv: c3, script: _arbitrationScript(c3, arbs[2], buyerPk) }
        ];
    }
    async function _tapLeafHash(script) {
        return await _taggedHash('TapLeaf', _concatBytes(new Uint8Array([TAPLEAF_VERSION]), _compactSize(script.length), script));
    }
    function _compareBytes(a, b) {
        for (var i = 0; i < a.length && i < b.length; i++) {
            if (a[i] !== b[i]) return a[i] - b[i];
        }
        return a.length - b.length;
    }
    async function _tapBranchHash(a, b) {
        return await _taggedHash('TapBranch', _compareBytes(a, b) <= 0 ? _concatBytes(a, b) : _concatBytes(b, a));
    }
    async function _tapMerkleRoot(leafHashes) {
        var level = leafHashes.slice();
        while (level.length > 1) {
            var next = [];
            for (var i = 0; i < level.length; i += 2) next.push(await _tapBranchHash(level[i], level[i + 1]));
            level = next;
        }
        return level[0];
    }
    function _bech32Polymod(values) {
        var gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        var chk = 1;
        for (var i = 0; i < values.length; i++) {
            var top = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ values[i];
            for (var j = 0; j < 5; j++) if ((top >> j) & 1) chk ^= gen[j];
        }
        return chk;
    }
    function _bech32HrpExpand(hrp) {
        var out = [];
        for (var i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
        out.push(0);
        for (var j = 0; j < hrp.length; j++) out.push(hrp.charCodeAt(j) & 31);
        return out;
    }
    function _convertBits(data, from, to, pad) {
        var acc = 0, bits = 0, ret = [], maxv = (1 << to) - 1;
        for (var i = 0; i < data.length; i++) {
            var value = data[i];
            if (value < 0 || (value >> from)) throw new Error('convertBits valor invalido');
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) {
                bits -= to;
                ret.push((acc >> bits) & maxv);
            }
        }
        if (pad) {
            if (bits > 0) ret.push((acc << (to - bits)) & maxv);
        } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
            throw new Error('convertBits padding invalido');
        }
        return ret;
    }
    function _bech32mEncode(hrp, witnessVersion, program) {
        var data = [witnessVersion].concat(_convertBits(Array.from(program), 8, 5, true));
        var values = _bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
        var polymod = _bech32Polymod(values) ^ 0x2bc830a3;
        var checksum = [];
        for (var i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
        var combined = data.concat(checksum);
        var out = hrp + '1';
        for (var j = 0; j < combined.length; j++) out += BECH32_ALPHABET[combined[j]];
        return out;
    }
    function _pointXOnlyHex(point) {
        var hex = point.toHex.length ? point.toHex(true) : point.toHex();
        if (hex.length === 66) return hex.slice(2);
        if (hex.length === 130 && hex.slice(0, 2) === '04') return hex.slice(2, 66);
        return hex.slice(2, 66);
    }
    async function _taprootOutputKey(internalKeyHex, merkleRoot) {
        if (typeof nobleSecp256k1 === 'undefined' || !nobleSecp256k1.Point) {
            throw new Error('noble-secp256k1 no disponible');
        }
        internalKeyHex = _xOnlyPubkey(internalKeyHex, 'internal_key');
        var tweak = await _taggedHash('TapTweak', _concatBytes(_hexToBytes(internalKeyHex), merkleRoot));
        var tweakBig = BigInt('0x' + _bytesToHex(tweak));
        if (tweakBig >= SECP256K1_N) throw new Error('TapTweak fuera de rango secp256k1');
        var Pt = nobleSecp256k1.Point;
        var internal = Pt.fromHex('02' + internalKeyHex);
        var output = internal.add(Pt.BASE.multiply(tweakBig));
        return _pointXOnlyHex(output);
    }

    var Taproot = {
        // network: 'mainnet'|'testnet'|'signet'. El script tree, merkle root y output key son
        // idénticos entre redes: SOLO cambia el HRP del bech32m (bc vs tb). Default = red activa.
        buildDetails: async function (sellerPk, buyerPk, arbitrators, network) {
            var scripts = _taprootScripts(sellerPk, buyerPk, arbitrators);
            for (var i = 0; i < scripts.length; i++) {
                scripts[i].script_hex = _bytesToHex(scripts[i].script);
                scripts[i].leaf_hash = _bytesToHex(await _tapLeafHash(scripts[i].script));
            }
            var leafHashes = scripts.map(function (leaf) { return _hexToBytes(leaf.leaf_hash); });
            var merkleRoot = await _tapMerkleRoot(leafHashes);
            var outputKey = await _taprootOutputKey(Config.NUMS_POINT, merkleRoot);
            var net = _normalizeNetwork(network || _activeNetwork());
            return {
                address:     _bech32mEncode(_networkHrp(net), 1, _hexToBytes(outputKey)),
                network:     net,
                output_key:  outputKey,
                merkle_root: _bytesToHex(merkleRoot),
                internal_key: Config.NUMS_POINT,
                leaves:      scripts.map(function (leaf) {
                    return {
                        name: leaf.name,
                        csv: leaf.csv,
                        script_hex: leaf.script_hex,
                        leaf_hash: leaf.leaf_hash
                    };
                })
            };
        },
        buildAddress: async function (sellerPk, buyerPk, arbitrators, network) {
            var details = await this.buildDetails(sellerPk, buyerPk, arbitrators, network);
            return details.address;
        },
        verifyAddress: async function (serverResponse, sellerPk, buyerPk, arbitrators, network) {
            var actual = '';
            if (typeof serverResponse === 'string') {
                actual = serverResponse;
            } else if (serverResponse) {
                actual = serverResponse.address || serverResponse.taproot_address || serverResponse.funding_address || '';
            }
            var expected = await this.buildAddress(sellerPk, buyerPk, arbitrators, network);
            return {
                ok: String(actual || '').toLowerCase() === expected.toLowerCase(),
                expected: expected,
                actual: actual
            };
        }
    };

    // ==================== GASTO COOPERATIVO — Parte 2.3 ====================
    // Construye la TX (sin firmar) que gasta el UTXO escrow por la hoja cooperativa y computa el
    // sighash BIP341 (script-path, SIGHASH_DEFAULT). NO firma (eso es 2.4) ni hace broadcast (2.6).
    // CONSENSO-CRÍTICO: un error aquí = fondos bloqueados. Validar SIEMPRE en signet con un ciclo
    // fund->spend real antes de usar mainnet (lo dice el plan). El criterio de 2.3 es que ambos
    // navegadores produzcan el mismo tx_hex/sighash para los mismos datos.

    function _u32le(n) {
        return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
    }
    function _u64le(n) {
        var b = new Uint8Array(8), big = BigInt(n);
        for (var i = 0; i < 8; i++) { b[i] = Number(big & 0xffn); big >>= 8n; }
        return b;
    }
    function _revBytes(bytes) {
        var r = new Uint8Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) r[i] = bytes[bytes.length - 1 - i];
        return r;
    }
    // bech32/bech32m decode → { hrp, witver, program }. Valida checksum (bech32 si witver==0,
    // bech32m si witver>=1, como exige BIP350).
    function _bech32Decode(addr) {
        addr = String(addr || '').trim();
        if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) throw new Error('bech32 mixed case');
        addr = addr.toLowerCase();
        var pos = addr.lastIndexOf('1');
        if (pos < 1 || pos + 7 > addr.length) throw new Error('bech32 separador invalido');
        var hrp = addr.slice(0, pos);
        var dataPart = addr.slice(pos + 1);
        var data = [];
        for (var i = 0; i < dataPart.length; i++) {
            var v = BECH32_ALPHABET.indexOf(dataPart[i]);
            if (v === -1) throw new Error('bech32 char invalido');
            data.push(v);
        }
        var witver = data[0];
        var pm = _bech32Polymod(_bech32HrpExpand(hrp).concat(data));
        var expected = (witver === 0) ? 1 : 0x2bc830a3;
        if (pm !== expected) throw new Error('bech32 checksum invalido');
        var program = _convertBits(data.slice(1, data.length - 6), 5, 8, false);
        return { hrp: hrp, witver: witver, program: new Uint8Array(program) };
    }
    async function _base58CheckDecode(s) {
        s = String(s || '').trim();
        var n = BigInt(0);
        for (var i = 0; i < s.length; i++) {
            var c = _B58.indexOf(s[i]);
            if (c < 0) throw new Error('base58 char invalido');
            n = n * 58n + BigInt(c);
        }
        var hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
        var body = (n === 0n) ? [] : Array.from(_hexToBytes(hex));
        var leading = 0; for (var j = 0; j < s.length && s[j] === '1'; j++) leading++;
        var full = new Uint8Array(leading + body.length);
        full.set(body, leading);
        if (full.length < 5) throw new Error('base58 corto');
        var payload  = full.slice(0, full.length - 4);
        var checksum = full.slice(full.length - 4);
        var h2 = await _sha256Bytes(await _sha256Bytes(payload));
        for (var k = 0; k < 4; k++) if (h2[k] !== checksum[k]) throw new Error('base58 checksum invalido');
        return payload;
    }
    // Dirección Bitcoin → scriptPubKey (Uint8Array), validando que corresponde a la red.
    async function _addressToScriptPubKey(addr, network) {
        addr = String(addr || '').trim();
        var net = _normalizeNetwork(network);
        if (/^(bc1|tb1)/i.test(addr)) {
            var dec = _bech32Decode(addr);
            if (dec.hrp !== _networkHrp(net)) throw new Error('HRP no corresponde a la red ' + net);
            if (dec.witver === 0) {
                if (dec.program.length !== 20 && dec.program.length !== 32) throw new Error('programa v0 invalido');
                return _concatBytes(new Uint8Array([0x00, dec.program.length]), dec.program);
            }
            if (dec.witver >= 1 && dec.witver <= 16) {
                if (dec.program.length < 2 || dec.program.length > 40) throw new Error('programa witness invalido');
                return _concatBytes(new Uint8Array([0x50 + dec.witver, dec.program.length]), dec.program);
            }
            throw new Error('witness version no soportada');
        }
        var payload = await _base58CheckDecode(addr);
        if (payload.length !== 21) throw new Error('base58 payload invalido');
        var ver = payload[0], hash = payload.slice(1);
        var p2pkhVer = (net === 'mainnet') ? 0x00 : 0x6f;
        var p2shVer  = (net === 'mainnet') ? 0x05 : 0xc4;
        if (ver === p2pkhVer) return _concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), hash, new Uint8Array([0x88, 0xac]));
        if (ver === p2shVer)  return _concatBytes(new Uint8Array([0xa9, 0x14]), hash, new Uint8Array([0x87]));
        throw new Error('version base58 no corresponde a la red ' + net);
    }
    // scriptPubKey P2TR key-path (sin script tree) de una x-only pubkey. Usado para la salida de
    // comisión de arb1: tr(arb1_pubkey_btc), gastable por el árbitro con su clave (spec sec 10.1).
    async function _p2trKeyPathSpk(xonlyHex) {
        var out = await _taprootOutputKey(xonlyHex, new Uint8Array(0));
        return _concatBytes(new Uint8Array([0x51, 0x20]), _hexToBytes(out));
    }
    // Output key tweaked + bit de paridad (para el control block del script-path spend).
    async function _taprootOutputKeyParity(internalKeyHex, merkleRoot) {
        internalKeyHex = _xOnlyPubkey(internalKeyHex, 'internal_key');
        var tweak = await _taggedHash('TapTweak', _concatBytes(_hexToBytes(internalKeyHex), merkleRoot));
        var tweakBig = BigInt('0x' + _bytesToHex(tweak));
        if (tweakBig >= SECP256K1_N) throw new Error('TapTweak fuera de rango');
        var Pt = nobleSecp256k1.Point;
        var output = Pt.fromHex('02' + internalKeyHex).add(Pt.BASE.multiply(tweakBig));
        // Paridad de la Y de la clave de salida (bit del control block, BIP341). OJO: el guard anterior
        // `output.toHex.length ? toHex(true) : toHex()` estaba ROTO: toHex(isCompressed=false) tiene
        // .length===0 por el parametro por defecto, asi que caia a toHex() SIN flag y devolvia la clave
        // SIN comprimir (04||x||y) -> slice(0,2) nunca era '03' -> paridad SIEMPRE 0 -> control block
        // invalido en ~50% de direcciones (Y impar) -> "Witness program hash mismatch" al gastar.
        var comp = output.toHex(true);                       // pedimos comprimido explicitamente
        var parity, xonly;
        if (comp.length === 66 && (comp.slice(0, 2) === '02' || comp.slice(0, 2) === '03')) {
            parity = (comp.slice(0, 2) === '03') ? 1 : 0;    // 02/03: paridad directa
            xonly  = comp.slice(2);
        } else if (typeof output.y === 'bigint') {
            parity = Number(output.y & 1n);                  // fallback robusto: Y impar?
            xonly  = comp.slice(2, 66);
        } else {
            parity = parseInt(comp.slice(-2), 16) & 1;       // 04||x||y: ultimo byte de Y
            xonly  = comp.slice(2, 66);
        }
        return { xonly: xonly, parity: parity };
    }
    // Proof Merkle (BIP341) de la hoja en `index` dentro del árbol balanceado de 8 hojas.
    async function _tapMerkleProof(leafHashes, index) {
        var level = leafHashes.slice(), idx = index, proof = [];
        while (level.length > 1) {
            var sib = (idx % 2 === 0) ? idx + 1 : idx - 1;
            proof.push(level[sib]);
            var next = [];
            for (var i = 0; i < level.length; i += 2) next.push(await _tapBranchHash(level[i], level[i + 1]));
            idx = Math.floor(idx / 2);
            level = next;
        }
        return proof;
    }

    var Spend = {
        // Construye la TX de gasto cooperativo (sin testigos) + el sighash de la hoja cooperativa.
        // feeSats: fee de minería que paga el comprador (sale de su output). Lo propone el iniciador
        // y la contraparte reusa el mismo valor para reconstruir y verificar (spec sec 9.6/9.9).
        buildCooperative: async function (trade, feeSats) {
            if (!trade || trade.method !== 'onchain') throw new Error('Trade no on-chain');
            if (!trade.funding_txid) throw new Error('Sin funding_txid');
            if (!trade.taproot_address) throw new Error('Sin direccion escrow');
            var meta = _readMeta(trade);
            var net = _tradeNetwork(trade);
            var buyerAddr = String(meta.buyer_payout_address || '').trim();
            if (!buyerAddr) throw new Error('Falta la direccion de cobro del comprador');
            if (!_isValidPayoutAddress(buyerAddr, net)) throw new Error('Direccion de cobro invalida para ' + net);

            var prevValue = parseInt(meta.funding_value, 10) || parseInt(trade.sat_amount, 10) || 0;
            if (prevValue <= 0) throw new Error('Valor del UTXO escrow desconocido');
            var arbFee = parseInt(meta.arb_fee_sats, 10) || 0;
            if (arbFee > 0 && arbFee < _DUST_SATS) throw new Error('Comision del arbitro (' + arbFee + ' sats) por debajo de dust (' + _DUST_SATS + '); este trade se acordo con un minimo invalido y no se puede liberar on-chain. Crea un trade nuevo.');
            var fee = parseInt(feeSats, 10) || 0;
            if (fee <= 0) throw new Error('feeSats requerido (>0)');
            if (fee < _VBYTES_COOP) throw new Error('Fee ' + fee + ' sats por debajo del relay minimo para una TX cooperativa (~' + _VBYTES_COOP + ' vbytes); el nodo no la difundira. Sube a >= ' + _VBYTES_COOP + ' sats.');
            var buyerValue = prevValue - arbFee - fee;
            if (buyerValue < _DUST_SATS) throw new Error('Output del comprador por debajo de dust tras comision+fee');

            // Claves y árbitros (mismo set con que se derivó la direccion escrow).
            var keys = UI.fundingKeys(trade);
            var arbs = UI.arbitrators(trade);
            if (!keys || arbs.length !== 3) throw new Error('Faltan trade pubkeys o arbitros');
            var scripts = _taprootScripts(keys.seller, keys.buyer, arbs);
            var leafHashes = [];
            for (var i = 0; i < scripts.length; i++) leafHashes.push(await _tapLeafHash(scripts[i].script));
            var coopScript = scripts[0].script;            // hoja 0 = cooperative
            var coopLeafHash = leafHashes[0];
            var merkleRoot = await _tapMerkleRoot(leafHashes);

            // Salidas: [comprador, arb1?]. Orden canónico fijo para que ambas partes coincidan.
            var outputs = [{ value: buyerValue, spk: await _addressToScriptPubKey(buyerAddr, net) }];
            if (arbFee > 0) outputs.push({ value: arbFee, spk: await _p2trKeyPathSpk(arbs[0]) });

            var prevTxidLE = _revBytes(_hexToBytes(trade.funding_txid));
            var vout = parseInt(trade.funding_vout, 10) || 0;
            var seq  = 0xfffffffd;                          // habilita RBF por si el fee se queda corto
            var escrowSpk = await _addressToScriptPubKey(trade.taproot_address, net);

            // --- TX legacy (sin witness): version|vin|vout|locktime. El witness se ensambla en 2.6. ---
            var txParts = [];
            txParts.push(_u32le(2));                        // nVersion
            txParts.push(_compactSize(1));                  // vin count
            txParts.push(prevTxidLE); txParts.push(_u32le(vout));
            txParts.push(_compactSize(0));                  // scriptSig vacío
            txParts.push(_u32le(seq));
            txParts.push(_compactSize(outputs.length));     // vout count
            outputs.forEach(function (o) {
                txParts.push(_u64le(o.value));
                txParts.push(_compactSize(o.spk.length));
                txParts.push(o.spk);
            });
            txParts.push(_u32le(0));                        // nLockTime
            var txHex = _bytesToHex(_concatBytes.apply(null, txParts));

            // --- Sighash BIP341 (script-path, SIGHASH_DEFAULT) ---
            var shaPrevouts = await _sha256Bytes(_concatBytes(prevTxidLE, _u32le(vout)));
            var shaAmounts  = await _sha256Bytes(_u64le(prevValue));
            var shaSpks     = await _sha256Bytes(_concatBytes(_compactSize(escrowSpk.length), escrowSpk));
            var shaSeqs     = await _sha256Bytes(_u32le(seq));
            var outParts = [];
            outputs.forEach(function (o) {
                outParts.push(_u64le(o.value), _compactSize(o.spk.length), o.spk);
            });
            var shaOutputs  = await _sha256Bytes(_concatBytes.apply(null, outParts));
            var sigMsg = _concatBytes(
                new Uint8Array([0x00]),                     // hash_type = SIGHASH_DEFAULT
                _u32le(2), _u32le(0),                       // nVersion, nLockTime
                shaPrevouts, shaAmounts, shaSpks, shaSeqs, shaOutputs,
                new Uint8Array([0x02]),                     // spend_type (script-path, sin annex)
                _u32le(0),                                  // input_index
                coopLeafHash,
                new Uint8Array([0x00]),                     // key_version
                _u32le(0xffffffff)                          // codesep_pos (sin OP_CODESEPARATOR)
            );
            var sighash = await _taggedHash('TapSighash', _concatBytes(new Uint8Array([0x00]), sigMsg)); // epoch 0x00

            // --- Control block para gastar por la hoja cooperativa ---
            var okp = await _taprootOutputKeyParity(Config.NUMS_POINT, merkleRoot);
            var proof = await _tapMerkleProof(leafHashes, 0);
            var cbParts = [new Uint8Array([TAPLEAF_VERSION | okp.parity]), _hexToBytes(Config.NUMS_POINT)];
            proof.forEach(function (h) { cbParts.push(h); });
            var controlBlock = _concatBytes.apply(null, cbParts);

            return {
                network:        net,
                tx_hex:         txHex,
                sighash:        _bytesToHex(sighash),
                leaf_script:    _bytesToHex(coopScript),
                control_block:  _bytesToHex(controlBlock),
                prev_value:     prevValue,
                buyer_value:    buyerValue,
                arb_fee:        arbFee,
                fee_sats:       fee,
                outputs:        outputs.map(function (o) { return { value: o.value, spk: _bytesToHex(o.spk) }; })
            };
        },

        // Ensambla la TX segwit final firmada a partir del coopSpend (de buildCooperative) y las dos
        // firmas Schnorr. Witness de la hoja cooperativa: [buyer_sig, seller_sig, leaf_script, control_block]
        // (stack abajo-arriba; ver NOSTR_ONCHAIN sec 8.3). Toma el tx_hex legacy (sin testigos) y le
        // inserta el marker/flag (00 01) tras la version + el witness antes del locktime. 1 solo input.
        assembleCooperative: function (coopSpend, buyerSigHex, sellerSigHex) {
            if (!coopSpend || !coopSpend.tx_hex) throw new Error('coopSpend invalido');
            if (!/^[a-f0-9]{128}$/i.test(String(buyerSigHex)))  throw new Error('buyer_sig no es Schnorr 64B');
            if (!/^[a-f0-9]{128}$/i.test(String(sellerSigHex))) throw new Error('seller_sig no es Schnorr 64B');
            var witnessItems = [
                _hexToBytes(buyerSigHex),
                _hexToBytes(sellerSigHex),
                _hexToBytes(coopSpend.leaf_script),
                _hexToBytes(coopSpend.control_block)
            ];
            var b = _hexToBytes(coopSpend.tx_hex);
            var version  = b.slice(0, 4);
            var middle   = b.slice(4, b.length - 4);   // vin (1) + vout, sin testigos
            var locktime = b.slice(b.length - 4);
            var witParts = [_compactSize(witnessItems.length)];
            witnessItems.forEach(function (it) {
                witParts.push(_compactSize(it.length));
                witParts.push(it);
            });
            var witness = _concatBytes.apply(null, witParts);
            return _bytesToHex(_concatBytes(version, new Uint8Array([0x00, 0x01]), middle, witness, locktime));
        },

        // Construye la TX de gasto por una hoja de ARBITRAJE (disputa) + su sighash. winnerSide:
        // 'buyer'|'seller' (a quien va el dinero); arbIndex: 1|2|3 (que arbitro firma). El witness sera
        // [winner_sig, arb_sig, leaf_script, control_block]. El árbitro que firma la resolución cobra
        // la comisión; el ganador recibe el resto. Si gana el vendedor, la
        // direccion de cobro sale de trade_json.seller_payout_address. Las hojas arb2/arb3 (csv 288/576)
        // exigen relative-locktime BIP68: la TX solo sera valida tras csv bloques desde el funding.
        buildArbitration: async function (trade, winnerSide, arbIndex, feeSats) {
            if (!trade || trade.method !== 'onchain') throw new Error('Trade no on-chain');
            if (!trade.funding_txid) throw new Error('Sin funding_txid');
            if (!trade.taproot_address) throw new Error('Sin direccion escrow');
            winnerSide = (winnerSide === 'seller') ? 'seller' : 'buyer';
            arbIndex = parseInt(arbIndex, 10);
            if ([1, 2, 3].indexOf(arbIndex) === -1) throw new Error('arbIndex debe ser 1, 2 o 3');
            var meta = _readMeta(trade);
            var net = _tradeNetwork(trade);
            var winnerAddr = String((winnerSide === 'buyer' ? meta.buyer_payout_address : meta.seller_payout_address) || '').trim();
            if (!winnerAddr) throw new Error('Falta la direccion de cobro del ' + winnerSide);
            if (!_isValidPayoutAddress(winnerAddr, net)) throw new Error('Direccion de cobro invalida para ' + net);

            var prevValue = parseInt(meta.funding_value, 10) || parseInt(trade.sat_amount, 10) || 0;
            if (prevValue <= 0) throw new Error('Valor del UTXO escrow desconocido');
            var arbFee = parseInt(meta.arb_fee_sats, 10) || 0;
            if (arbFee > 0 && arbFee < _DUST_SATS) throw new Error('Comision del arbitro (' + arbFee + ' sats) por debajo de dust (' + _DUST_SATS + '); trade con minimo invalido, no liberable on-chain.');
            var fee = parseInt(feeSats, 10) || 0;
            if (fee <= 0) throw new Error('feeSats requerido (>0)');
            if (fee < _VBYTES_ARB) throw new Error('Fee ' + fee + ' sats por debajo del relay minimo para una TX de arbitraje (~' + _VBYTES_ARB + ' vbytes); el nodo no la difundira. Sube a >= ' + _VBYTES_ARB + ' sats.');
            var winnerValue = prevValue - arbFee - fee;
            if (winnerValue < _DUST_SATS) throw new Error('Output del ganador por debajo de dust tras comision+fee');

            var keys = UI.fundingKeys(trade);
            var arbs = UI.arbitrators(trade);
            if (!keys || arbs.length !== 3) throw new Error('Faltan trade pubkeys o arbitros');
            var scripts = _taprootScripts(keys.seller, keys.buyer, arbs);
            var leafHashes = [];
            for (var i = 0; i < scripts.length; i++) leafHashes.push(await _tapLeafHash(scripts[i].script));
            // 0=coop, 1=recovery, 2=arb1->seller, 3=arb1->buyer, 4=arb2->seller, 5=arb2->buyer, 6/7=arb3.
            var leafIndex = 2 + (arbIndex - 1) * 2 + (winnerSide === 'buyer' ? 1 : 0);
            var leaf = scripts[leafIndex];
            var leafHash = leafHashes[leafIndex];
            var merkleRoot = await _tapMerkleRoot(leafHashes);

            var outputs = [{ value: winnerValue, spk: await _addressToScriptPubKey(winnerAddr, net) }];
            if (arbFee > 0) outputs.push({ value: arbFee, spk: await _p2trKeyPathSpk(arbs[arbIndex - 1]) });

            var prevTxidLE = _revBytes(_hexToBytes(trade.funding_txid));
            var vout = parseInt(trade.funding_vout, 10) || 0;
            // BIP68: hojas con csv>0 fijan nSequence = csv (en bloques); arb1 (csv 0) usa RBF.
            var seq = leaf.csv > 0 ? (leaf.csv & 0x0000ffff) : 0xfffffffd;
            var escrowSpk = await _addressToScriptPubKey(trade.taproot_address, net);

            var txParts = [];
            txParts.push(_u32le(2));
            txParts.push(_compactSize(1));
            txParts.push(prevTxidLE); txParts.push(_u32le(vout));
            txParts.push(_compactSize(0));
            txParts.push(_u32le(seq));
            txParts.push(_compactSize(outputs.length));
            outputs.forEach(function (o) {
                txParts.push(_u64le(o.value));
                txParts.push(_compactSize(o.spk.length));
                txParts.push(o.spk);
            });
            txParts.push(_u32le(0));
            var txHex = _bytesToHex(_concatBytes.apply(null, txParts));

            var shaPrevouts = await _sha256Bytes(_concatBytes(prevTxidLE, _u32le(vout)));
            var shaAmounts  = await _sha256Bytes(_u64le(prevValue));
            var shaSpks     = await _sha256Bytes(_concatBytes(_compactSize(escrowSpk.length), escrowSpk));
            var shaSeqs     = await _sha256Bytes(_u32le(seq));
            var outParts = [];
            outputs.forEach(function (o) { outParts.push(_u64le(o.value), _compactSize(o.spk.length), o.spk); });
            var shaOutputs  = await _sha256Bytes(_concatBytes.apply(null, outParts));
            var sigMsg = _concatBytes(
                new Uint8Array([0x00]),
                _u32le(2), _u32le(0),
                shaPrevouts, shaAmounts, shaSpks, shaSeqs, shaOutputs,
                new Uint8Array([0x02]),
                _u32le(0),
                leafHash,
                new Uint8Array([0x00]),
                _u32le(0xffffffff)
            );
            var sighash = await _taggedHash('TapSighash', _concatBytes(new Uint8Array([0x00]), sigMsg));

            var okp = await _taprootOutputKeyParity(Config.NUMS_POINT, merkleRoot);
            var proof = await _tapMerkleProof(leafHashes, leafIndex);
            var cbParts = [new Uint8Array([TAPLEAF_VERSION | okp.parity]), _hexToBytes(Config.NUMS_POINT)];
            proof.forEach(function (h) { cbParts.push(h); });
            var controlBlock = _concatBytes.apply(null, cbParts);

            return {
                network:       net,
                tx_hex:        txHex,
                sighash:       _bytesToHex(sighash),
                leaf_script:   _bytesToHex(leaf.script),
                control_block: _bytesToHex(controlBlock),
                leaf_index:    leafIndex,
                winner_side:   winnerSide,
                arb_index:     arbIndex,
                csv:           leaf.csv,
                prev_value:    prevValue,
                winner_value:  winnerValue,
                arb_fee:       arbFee,
                fee_sats:      fee,
                outputs:       outputs.map(function (o) { return { value: o.value, spk: _bytesToHex(o.spk) }; })
            };
        },

        // Ensambla la TX segwit final de una hoja de arbitraje. Witness: [winner_sig, arb_sig,
        // leaf_script, control_block] (stack abajo-arriba; sec 8.7).
        assembleArbitration: function (arbSpend, winnerSigHex, arbSigHex) {
            if (!arbSpend || !arbSpend.tx_hex) throw new Error('arbSpend invalido');
            if (!/^[a-f0-9]{128}$/i.test(String(winnerSigHex))) throw new Error('winner_sig no es Schnorr 64B');
            if (!/^[a-f0-9]{128}$/i.test(String(arbSigHex)))    throw new Error('arb_sig no es Schnorr 64B');
            var witnessItems = [
                _hexToBytes(winnerSigHex),
                _hexToBytes(arbSigHex),
                _hexToBytes(arbSpend.leaf_script),
                _hexToBytes(arbSpend.control_block)
            ];
            var b = _hexToBytes(arbSpend.tx_hex);
            var version  = b.slice(0, 4);
            var middle   = b.slice(4, b.length - 4);
            var locktime = b.slice(b.length - 4);
            var witParts = [_compactSize(witnessItems.length)];
            witnessItems.forEach(function (it) { witParts.push(_compactSize(it.length)); witParts.push(it); });
            var witness = _concatBytes.apply(null, witParts);
            return _bytesToHex(_concatBytes(version, new Uint8Array([0x00, 0x01]), middle, witness, locktime));
        },

        // Construye la TX de RECOVERY (paso 16) + su sighash. La gasta el VENDEDOR solo, por la hoja 1
        // (single-sig con CSV 4320), cuando nadie resuelve el trade. No hay comision de arbitro: el
        // vendedor recupera el escrow entero menos la fee de mineria. nSequence = 4320 (BIP68): la TX
        // solo es valida tras 4320 confirmaciones del funding. Witness: [seller_sig, leaf_script, control_block].
        buildRecovery: async function (trade, feeSats) {
            if (!trade || trade.method !== 'onchain') throw new Error('Trade no on-chain');
            if (!trade.funding_txid) throw new Error('Sin funding_txid');
            if (!trade.taproot_address) throw new Error('Sin direccion escrow');
            var meta = _readMeta(trade);
            var net = _tradeNetwork(trade);
            var sellerAddr = String(meta.seller_payout_address || '').trim();
            if (!sellerAddr) throw new Error('Falta la direccion de cobro del vendedor');
            if (!_isValidPayoutAddress(sellerAddr, net)) throw new Error('Direccion de cobro invalida para ' + net);

            var prevValue = parseInt(meta.funding_value, 10) || parseInt(trade.sat_amount, 10) || 0;
            if (prevValue <= 0) throw new Error('Valor del UTXO escrow desconocido');
            var fee = parseInt(feeSats, 10) || 0;
            if (fee <= 0) throw new Error('feeSats requerido (>0)');
            if (fee < _VBYTES_RECOVERY) throw new Error('Fee ' + fee + ' sats por debajo del relay minimo para una TX recovery (~' + _VBYTES_RECOVERY + ' vbytes); el nodo no la difundira. Sube a >= ' + _VBYTES_RECOVERY + ' sats.');
            var sellerValue = prevValue - fee;     // recovery: sin comision de arbitro
            if (sellerValue < _DUST_SATS) throw new Error('Output del vendedor por debajo de dust tras fee');

            var keys = UI.fundingKeys(trade);
            var arbs = UI.arbitrators(trade);
            if (!keys || arbs.length !== 3) throw new Error('Faltan trade pubkeys o arbitros');
            var scripts = _taprootScripts(keys.seller, keys.buyer, arbs);
            var leafHashes = [];
            for (var i = 0; i < scripts.length; i++) leafHashes.push(await _tapLeafHash(scripts[i].script));
            var leafIndex = 1;                     // hoja 1 = recovery
            var leaf = scripts[leafIndex];
            var leafHash = leafHashes[leafIndex];
            var merkleRoot = await _tapMerkleRoot(leafHashes);

            var outputs = [{ value: sellerValue, spk: await _addressToScriptPubKey(sellerAddr, net) }];

            var prevTxidLE = _revBytes(_hexToBytes(trade.funding_txid));
            var vout = parseInt(trade.funding_vout, 10) || 0;
            var seq = leaf.csv & 0x0000ffff;       // BIP68: 4320 bloques relativos
            var escrowSpk = await _addressToScriptPubKey(trade.taproot_address, net);

            var txParts = [];
            txParts.push(_u32le(2));
            txParts.push(_compactSize(1));
            txParts.push(prevTxidLE); txParts.push(_u32le(vout));
            txParts.push(_compactSize(0));
            txParts.push(_u32le(seq));
            txParts.push(_compactSize(outputs.length));
            outputs.forEach(function (o) {
                txParts.push(_u64le(o.value));
                txParts.push(_compactSize(o.spk.length));
                txParts.push(o.spk);
            });
            txParts.push(_u32le(0));
            var txHex = _bytesToHex(_concatBytes.apply(null, txParts));

            var shaPrevouts = await _sha256Bytes(_concatBytes(prevTxidLE, _u32le(vout)));
            var shaAmounts  = await _sha256Bytes(_u64le(prevValue));
            var shaSpks     = await _sha256Bytes(_concatBytes(_compactSize(escrowSpk.length), escrowSpk));
            var shaSeqs     = await _sha256Bytes(_u32le(seq));
            var outParts = [];
            outputs.forEach(function (o) { outParts.push(_u64le(o.value), _compactSize(o.spk.length), o.spk); });
            var shaOutputs  = await _sha256Bytes(_concatBytes.apply(null, outParts));
            var sigMsg = _concatBytes(
                new Uint8Array([0x00]),
                _u32le(2), _u32le(0),
                shaPrevouts, shaAmounts, shaSpks, shaSeqs, shaOutputs,
                new Uint8Array([0x02]),
                _u32le(0),
                leafHash,
                new Uint8Array([0x00]),
                _u32le(0xffffffff)
            );
            var sighash = await _taggedHash('TapSighash', _concatBytes(new Uint8Array([0x00]), sigMsg));

            var okp = await _taprootOutputKeyParity(Config.NUMS_POINT, merkleRoot);
            var proof = await _tapMerkleProof(leafHashes, leafIndex);
            var cbParts = [new Uint8Array([TAPLEAF_VERSION | okp.parity]), _hexToBytes(Config.NUMS_POINT)];
            proof.forEach(function (h) { cbParts.push(h); });
            var controlBlock = _concatBytes.apply(null, cbParts);

            return {
                network:       net,
                tx_hex:        txHex,
                sighash:       _bytesToHex(sighash),
                leaf_script:   _bytesToHex(leaf.script),
                control_block: _bytesToHex(controlBlock),
                leaf_index:    leafIndex,
                csv:           leaf.csv,
                prev_value:    prevValue,
                seller_value:  sellerValue,
                fee_sats:      fee,
                outputs:       outputs.map(function (o) { return { value: o.value, spk: _bytesToHex(o.spk) }; })
            };
        },

        // Ensambla la TX segwit final de recovery. Witness de hoja single-sig: [seller_sig, leaf_script,
        // control_block] (sec 8.8).
        assembleRecovery: function (recSpend, sellerSigHex) {
            if (!recSpend || !recSpend.tx_hex) throw new Error('recSpend invalido');
            if (!/^[a-f0-9]{128}$/i.test(String(sellerSigHex))) throw new Error('seller_sig no es Schnorr 64B');
            var witnessItems = [
                _hexToBytes(sellerSigHex),
                _hexToBytes(recSpend.leaf_script),
                _hexToBytes(recSpend.control_block)
            ];
            var b = _hexToBytes(recSpend.tx_hex);
            var version  = b.slice(0, 4);
            var middle   = b.slice(4, b.length - 4);
            var locktime = b.slice(b.length - 4);
            var witParts = [_compactSize(witnessItems.length)];
            witnessItems.forEach(function (it) { witParts.push(_compactSize(it.length)); witParts.push(it); });
            var witness = _concatBytes.apply(null, witParts);
            return _bytesToHex(_concatBytes(version, new Uint8Array([0x00, 0x01]), middle, witness, locktime));
        }
    };

    // Schnorr sign/verify (BIP340) sobre noble-secp256k1 v1.2.14 (global nobleSecp256k1).
    // Firma directa sobre el sighash de 32 bytes (igual que la firma de eventos Nostr): noble NO
    // re-hashea el mensaje, lo trata como el hash a firmar. La trade privkey, NUNCA la clave Nostr.
    var Schnorr = {
        // msgHex = sighash Taproot (32B hex). privHex = trade privkey (32B hex). Devuelve sig 64B hex.
        sign: async function (msgHex, privHex) {
            if (typeof nobleSecp256k1 === 'undefined') throw new Error('noble-secp256k1 no disponible');
            // Pasar el mensaje como string hex hace que noble devuelva la firma en hex (lib v1.2.14, L882).
            var sig = await nobleSecp256k1.schnorr.sign(String(msgHex), String(privHex));
            return typeof sig === 'string' ? sig : _bytesToHex(sig);
        },
        // sigHex = firma 64B hex. msgHex = sighash 32B hex. pubHex = x-only trade pubkey 32B hex.
        verify: async function (sigHex, msgHex, pubHex) {
            if (typeof nobleSecp256k1 === 'undefined') throw new Error('noble-secp256k1 no disponible');
            return await nobleSecp256k1.schnorr.verify(String(sigHex), String(msgHex), String(pubHex));
        }
    };

    // ==================== POW MINER (NIP-13) ====================
    // El server tiene la implementación rápida en PHP (mine_pow endpoint).
    // El navegador llama al server para minar PoW de un evento sin firmar.
    // Tras recibirlo, el navegador firma con Events.publish() y publica.
    var PowMiner = {
        // Mina PoW server-side. Devuelve el evento con tag nonce añadida + el id resultante.
        // event: objeto Nostr sin firma (pubkey, kind, created_at, tags, content).
        // difficulty: bits cero líderes mínimos (12-24, default 16).
        mineRemote: async function (event, difficulty) {
            difficulty = difficulty || 16;
            var resp = await fetch(Config.ajaxUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action:     'mine_pow',
                    event_json: JSON.stringify(event),
                    difficulty: String(difficulty)
                }).toString()
            });
            var data = await resp.json();
            if (data.error) throw new Error(data.msg || 'PoW mining failed');
            var mined = data.event || {};
            var cleanTags = function(tags) { return (tags || []).filter(function(t) { return t && t[0] !== 'nonce'; }); };
            if (mined.pubkey !== event.pubkey || Number(mined.kind) !== Number(event.kind) ||
                Number(mined.created_at) !== Number(event.created_at) || mined.content !== event.content ||
                JSON.stringify(cleanTags(mined.tags)) !== JSON.stringify(cleanTags(event.tags))) {
                throw new Error('El minero PoW devolvio un evento alterado');
            }
            var computed = await _sha256hex(JSON.stringify([0, mined.pubkey, mined.created_at, mined.kind, mined.tags, mined.content]));
            var nonce = _findTag(mined, 'nonce');
            if (computed !== String(data.id || '').toLowerCase() || !nonce ||
                (parseInt(nonce[2], 10) || 0) < difficulty || _leadingZeroBits(computed) < difficulty) {
                throw new Error('PoW devuelto invalido');
            }
            _log('PowMiner.mineRemote', { difficulty: difficulty, iterations: data.iterations, ms: data.ms });
            return { event: mined, id: computed, iterations: data.iterations, ms: data.ms };
        }
    };

    // ==================== INIT ====================

    function init(config) {
        config = config || {};
        Config.pubkey   = config.pubkey   || '';
        Config.userId   = config.userId   || 0;
        Config.ajaxUrl  = config.ajaxUrl  || '';
        // Validar el default Mostro arbitrator: pubkey x-only de 64 hex chars o null.
        var defArb = (config.defaultSiteArbitrator || config.defaultMostroArbitrator || '').toString().toLowerCase();
        Config.defaultSiteArbitrator = /^[a-f0-9]{64}$/.test(defArb) ? defArb : null;
        Config.isOnchainAdmin = !!config.onchainIsAdmin;
        Config.blockedArbitrators = {};
        (config.blockedArbitrators || []).forEach(function (h) {
            h = String(h || '').toLowerCase();
            if (/^[a-f0-9]{64}$/.test(h)) Config.blockedArbitrators[h] = true;
        });
        // Red activa: localStorage > config > 'mainnet'.
        var savedNet = '';
        try { savedNet = localStorage.getItem(_NET_LS_KEY) || ''; } catch(e) {}
        Config.network = _normalizeNetwork(savedNet || config.network || 'mainnet');
        Config.pool     = config.pool     || (window.Noxtr && window.Noxtr.Pool);
        Config.nip04    = config.nip04    || (window.Noxtr && window.Noxtr.Nip04);
        Config.events   = config.events   || (window.Noxtr && window.Noxtr.Events);
        Config.profiles = config.profiles || (window.Noxtr && window.Noxtr.Profiles);

        if (!Config.pool) {
            _warn('Noxtr.Pool no disponible. On-chain deshabilitado en este page load.');
            return;
        }
        if (!Config.userId) {
            _log('init: userId=0 (anónimo). On-chain solo en modo lectura.');
        }

        _log('init', {
            userId: Config.userId,
            pubkey: Config.pubkey ? Config.pubkey.slice(0, 8) + '…' : '(none)',
            defaultSiteArb: Config.defaultSiteArbitrator
                ? Config.defaultSiteArbitrator.slice(0, 8) + '…'
                : '(none)',
            poolReady: !!Config.pool
        });

        // Inicialización de submódulos.
        Keys.init();
        Book.init();
        Book.subscribe(48 * 3600);
        Trader.init();
        Arbitrators.init();
        // Poll global de verify_funding (refresca confirmaciones de trades onchain en curso) +
        // ticker de 1s para el "detectado hace X" en la UI sin re-render completo.
        if (UI && UI.startFundingPolling) UI.startFundingPolling();
        if (UI && UI.startFundingTicker)  UI.startFundingTicker();

        // Phase 2.4: escuchar DMs y eventos de trade cuando haya identidad Nostr disponible.
        // Reintenta hasta 12 veces (cada 3s) para cubrir logins asíncronos (nsec, NIP-07, NIP-46).
        var _handlerInitAttempts = 0;
        var _retryInitHandlers = function () {
            if (Trader._dmHandlerInitialized) return;
            _handlerInitAttempts++;
            if (Config.events && Config.events.pubkey) {
                Trader._initDmHandler();
                Trader._initTradeEventListener();
                Trader._initRatingListener();
            } else if (_handlerInitAttempts < 12) {
                setTimeout(_retryInitHandlers, 3000);
            }
        };
        setTimeout(_retryInitHandlers, 1500);

        _log('init done');
    }

    // ==================== UI: render de la ficha on-chain ====================
    //
    // Helpers de UI específicos del método on-chain. Viven aquí (no en script.mostro.js)
    // porque pertenecen a NostrEscrow. MostroTrader.renderMyTrades los llama vía
    // window.Onchain.UI cuando trade.method === 'onchain', y los handlers de botones
    // (.nxoc-trade-arbs-btn / .nxoc-confirm-address-btn) los invocan igual.
    // Apoyo en MostroTrader._trades / _ajax / renderMyTrades y MostroBook.orders
    // como dispatcher unificado del trade card.

    function _peerOnchainTradePubkey(trade) {
        if (!trade || trade.method !== 'onchain') return '';
        try {
            var data = trade.trade_json ? JSON.parse(trade.trade_json) : null;
            var pk = trade.trade_role === 'taken'
                ? (data && data.maker_trade_pubkey)
                : (data && data.taker_trade_pubkey);
            if (pk && /^[a-f0-9]{64}$/i.test(pk)) return pk.toLowerCase();
        } catch(e) {}
        return (trade.peer_pubkey && /^[a-f0-9]{64}$/i.test(trade.peer_pubkey))
            ? trade.peer_pubkey.toLowerCase() : '';
    }

    // Tamanos aproximados (vbytes) de los gastos Taproot por script-path, para multiplicar por la
    // fee rate recomendada. Sobre-estiman ligeramente para que la TX siempre supere el relay min.
    // Coop: 2 outputs (buyer + arb1). Arb: 2 outputs (winner + arb1). Recovery: 1 output (seller).
    var _VBYTES_COOP     = 220;
    var _VBYTES_ARB      = 250;
    var _VBYTES_RECOVERY = 180;

    var UI = {
        // Cache en memoria (60s) de la fee rate recomendada por red, para no martillar el endpoint
        // cada vez que abrimos el prompt de fee. Devuelve { rate (sat/vB), sats (rate*vbytes), source }.
        // Si todo falla, devuelve un fallback razonable (3 sat/vB) en vez de bloquear el flujo.
        _feeCache: {},
        _recommendedFee: async function(network, vbytes) {
            network = String(network || 'mainnet').toLowerCase();
            vbytes  = parseInt(vbytes, 10) || _VBYTES_COOP;
            var now = Date.now();
            var c = this._feeCache[network];
            if (!c || (now - c.at) > 60000) {
                var rate = 3, source = 'fallback';
                try {
                    var r = await _ajax('recommended_fees', { network: network });
                    if (r && r.ok) {
                        // halfHourFee es el punto razonable para liberar BTC sin urgencia.
                        rate = parseInt(r.halfHourFee, 10) || parseInt(r.hourFee, 10) || rate;
                        source = String(r.source || 'remote');
                    }
                } catch(e) { _warn('_recommendedFee: ajax error', e); }
                c = this._feeCache[network] = { rate: rate, source: source, at: now };
            }
            return { rate: c.rate, sats: Math.max(c.rate * vbytes, vbytes), source: c.source };
        },

        // Dialogo de seleccion de comision (presets por prioridad + slider personalizado, sats en vivo).
        // Reemplaza el prompt() crudo. Devuelve Promise<sats|null> (null = cancelado). sats = rate * vbytes,
        // con suelo en vbytes (relay minimo ~1 sat/vB). Reutilizable por liberacion/recovery/arbitraje.
        _promptFee: async function(network, vbytes) {
            var vb = parseInt(vbytes, 10) || _VBYTES_COOP;
            var tiers = { fastestFee: 5, halfHourFee: 3, hourFee: 2, economyFee: 1, minimumFee: 1 };
            try { var r = await _ajax('recommended_fees', { network: network }); if (r && r.ok) tiers = r; } catch(e) {}
            var f  = Math.max(1, parseInt(tiers.fastestFee, 10)  || 5);
            var hh = Math.max(1, parseInt(tiers.halfHourFee, 10) || 3);
            var h  = Math.max(1, parseInt(tiers.hourFee, 10)     || 2);
            var ec = Math.max(1, parseInt(tiers.economyFee, 10)  || 1);
            var defRate = hh, maxRate = Math.max(f * 2, 10);
            var presets = [
                { label: str_fee_tier_fastest,  rate: f  },
                { label: str_fee_tier_halfhour, rate: hh },
                { label: str_fee_tier_hour,     rate: h  },
                { label: str_fee_tier_economy,  rate: ec }
            ];
            return new Promise(function(resolve) {
                var done = false; function fin(v) { if (!done) { done = true; resolve(v); } }
                var rows = presets.map(function(p) {
                    return '<label class="nxoc-fee-opt"><input type="radio" name="nxoc-fee-tier" value="' + p.rate + '"' +
                        (p.rate === defRate ? ' checked' : '') + '>' +
                        '<span><strong>' + _escHtml(p.label) + '</strong> · ' + p.rate + ' sat/vB · ' + (p.rate * vb).toLocaleString() + ' sats</span></label>';
                }).join('');
                var content = '<div class="nxoc-fee-dialog">' +
                    '<p class="nxoc-fee-intro">' + _escHtml(str_fee_dialog_intro) + '</p>' +
                    '<div class="nxoc-fee-opts">' + rows + '</div>' +
                    '<div class="nxoc-fee-slider-row"><span>' + _escHtml(str_fee_custom_label) + '</span>' +
                        '<input type="range" id="nxoc-fee-slider" min="1" max="' + maxRate + '" value="' + defRate + '" step="1"></div>' +
                    '<div class="nxoc-fee-total" id="nxoc-fee-total"></div>' +
                '</div>';
                $('body').dialog({
                    title: str_fee_dialog_title, type: 'html', width: '460px', content: content,
                    buttons: [
                        { text: str_cancel, class: 'btn', action: function(_e, ov) { document.body.removeChild(ov); fin(null); } },
                        { text: str_fee_use_btn, class: 'btn btn-primary', action: function(_e, ov) {
                            var sl = document.getElementById('nxoc-fee-slider');
                            var rate = parseInt(sl && sl.value, 10) || defRate;
                            document.body.removeChild(ov); fin(Math.max(rate * vb, vb));
                        } }
                    ],
                    onLoad: function() {
                        var slider = document.getElementById('nxoc-fee-slider');
                        var total  = document.getElementById('nxoc-fee-total');
                        var radios = document.querySelectorAll('input[name="nxoc-fee-tier"]');
                        function refresh(rate) { if (total) total.textContent = t(str_fee_total_line, (rate * vb).toLocaleString(), rate, vb); }
                        radios.forEach(function(rb) { rb.onchange = function() { if (rb.checked && slider) { slider.value = rb.value; refresh(parseInt(rb.value, 10)); } }; });
                        if (slider) slider.oninput = function() {
                            var rate = parseInt(slider.value, 10) || 1;
                            radios.forEach(function(rb) { rb.checked = (parseInt(rb.value, 10) === rate); });
                            refresh(rate);
                        };
                        refresh(defRate);
                    }
                });
            });
        },

        arbitrators: function(trade) {
            var raw = String((trade && trade.arbitrators) || '').split(',').map(function(s) {
                return s.trim().toLowerCase();
            }).filter(function(pk) {
                return /^[a-f0-9]{64}$/.test(pk);
            });
            if (!raw.length && trade && trade.order_id
                && typeof MostroBook !== 'undefined' && MostroBook.orders
                && MostroBook.orders[trade.order_id]) {
                raw = (MostroBook.orders[trade.order_id]._arbitrators || []).map(function(pk) {
                    return String(pk || '').trim().toLowerCase();
                }).filter(function(pk) {
                    return /^[a-f0-9]{64}$/.test(pk);
                });
                if (raw.length && window.MostroTrader && MostroTrader._ajax) {
                    trade.arbitrators = raw.join(',');
                    MostroTrader._ajax('mostro_trade_update', {
                        order_id: trade.order_id,
                        fields: { arbitrators: trade.arbitrators }
                    });
                }
            }
            if (raw.length === 1) return [raw[0], raw[0], raw[0]];
            return raw.slice(0, 3);
        },

        arbSummaryHtml: function(trade) {
            if (!trade || trade.method !== 'onchain') return '';
            var arbs = this.arbitrators(trade);
            if (!arbs.length) return '';
            var uniqueCount = arbs.filter(function(pk, i) { return arbs.indexOf(pk) === i; }).length;
            return '<span class="mostro-trade-pm" title="' + _escHtml(arbs.join(', ')) + '">' +
                uniqueCount + ' arbitro' + (uniqueCount === 1 ? '' : 's') +
                '</span>' +
                '<button class="btn btn-noxtr btn-sm nxoc-trade-arbs-btn" data-id="' +
                _escHtml(trade.order_id) + '">' + str_view_arbitrators + '</button>';
        },

        openArbsDialog: function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            var self = this;
            var arbs = this.arbitrators(trade);
            if (!arbs.length) { alert(str_no_saved_arbitrators); return; }
            var locked = !!(trade.taproot_address || trade.funding_txid);
            // Antes de aceptar la solicitud no existe trade publico (no hay accept ni trade_id ni
            // pubkeys Nostr de la contraparte en trade_json). action=arbitrators viaja pero el listener
            // del peer lo descarta como "unrelated/untrusted". Bloqueamos el cambio aqui.
            var notAccepted = trade.internal_status !== 'aceptado';
            var warningHtml = '';
            if (locked) warningHtml = '<p class="nxoc-arb-warning">' + str_arbs_locked_warning + '</p>';
            else if (notAccepted) warningHtml = '<p class="nxoc-arb-warning">' + str_arbs_before_accept_hint + '</p>';
            var selectorHtml = warningHtml +
                '<div class="nxoc-change-arbs"><div id="nxoc-trade-arbs-selector"></div></div>';
            var canChange = !locked && !notAccepted;
            $('body').dialog({
                title: str_trade_arbitrators,
                type: 'html',
                width: '720px',
                content: '<div class="nxoc-trade-arbs-dialog">' + selectorHtml + '</div>',
                buttons: [
                    { text: str_close, class: 'btn', action: function(_e, overlay) { document.body.removeChild(overlay); } },
                    (canChange ? { text: str_change_arbitrators, class: 'btn btn-primary', action: async function(_e, overlay) {
                        var next = Arbitrators && Arbitrators.selectedFrom
                            ? Arbitrators.selectedFrom('nxoc-trade-arbs-selector')
                            : [];
                        if (next.length !== 3) { alert(str_select_1_or_3_arbs); return; }
                        trade.arbitrators = next.join(',');
                        trade.taproot_address = '';
                        trade._taprootDetails = null;
                        trade._taprootError = '';
                        // Cambiar arbitros invalida cualquier verificacion previa de direccion.
                        trade._addressCheckPublished = false;
                        trade._addressVerified = false;
                        trade._addressMismatch = false;
                        if (window.MostroTrader && MostroTrader._ajax) {
                            await MostroTrader._ajax('mostro_trade_update', {
                                order_id: trade.order_id,
                                fields: { arbitrators: trade.arbitrators, taproot_address: '' }
                            });
                        }
                        if (Trader && Trader.publishArbitratorsUpdate) {
                            try {
                                await Trader.publishArbitratorsUpdate(trade, next);
                            } catch(e) {
                                console.warn('[Onchain] No se pudo publicar cambio de arbitros:', e);
                                if (typeof notify === 'function') notify(t(str_arbs_saved_warn_peer, e.message), 'warn', 8000);
                            }
                        }
                        document.body.removeChild(overlay);
                        if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                    }} : null)
                ].filter(Boolean)
            });
            if (Arbitrators && Arbitrators.renderSelector) {
                Arbitrators.renderSelector('nxoc-trade-arbs-selector');
                // Re-aplica los arbitros del trade actual a los selects, los deshabilita si toca,
                // y vuelve a engancharse al boton 'Actualizar' tras cada re-render para que al
                // pulsarlo se vea el ultimo estado (incluido lo que haya cambiado la contraparte).
                var applyTradeArbs = function() {
                    setTimeout(function() {
                        var current = (window.MostroTrader && MostroTrader._trades && MostroTrader._trades[trade.order_id])
                            ? MostroTrader._trades[trade.order_id] : trade;
                        var arbsNow = self.arbitrators(current);
                        var sels = document.querySelectorAll('#nxoc-trade-arbs-selector .nxoc-arb-select');
                        arbsNow.forEach(function(pk, i) { if (sels[i]) sels[i].value = pk; });
                        if (!canChange) {
                            document.querySelectorAll('#nxoc-trade-arbs-selector select, #nxoc-trade-arbs-selector .nxoc-arb-refresh').forEach(function(el) {
                                el.disabled = true;
                            });
                        }
                        var refreshBtn = document.querySelector('#nxoc-trade-arbs-selector .nxoc-arb-refresh');
                        if (refreshBtn && canChange && !refreshBtn._tradeArbsHooked) {
                            refreshBtn._tradeArbsHooked = true;
                            var origClick = refreshBtn.onclick;
                            refreshBtn.onclick = function() {
                                if (origClick) origClick.call(refreshBtn);
                                applyTradeArbs();
                            };
                        }
                    }, 0);
                };
                applyTradeArbs();
                // Si el peer cambia arbitros mientras el dialog está abierto, _handleArbitratorsEvent
                // dispara 'nxoc:arbitrators-updated'. Refrescamos los selects automaticamente sin
                // que el usuario tenga que pulsar 'Actualizar'. Auto-cleanup cuando el dialog ya
                // no existe en el DOM.
                var onArbsUpdated = function(ev) {
                    if (!ev || !ev.detail || ev.detail.order_id !== trade.order_id) return;
                    if (!document.getElementById('nxoc-trade-arbs-selector')) {
                        window.removeEventListener('nxoc:arbitrators-updated', onArbsUpdated);
                        return;
                    }
                    applyTradeArbs();
                };
                window.addEventListener('nxoc:arbitrators-updated', onArbsUpdated);
            }
        },

        fundingKeys: function(trade) {
            if (!trade || trade.method !== 'onchain') return null;
            var myTradePub = String(trade.trade_key_pub || '').toLowerCase();
            var peerTradePub = _peerOnchainTradePubkey(trade);
            if (!/^[a-f0-9]{64}$/.test(myTradePub) || !/^[a-f0-9]{64}$/.test(peerTradePub)) return null;
            return parseInt(trade.is_seller, 10)
                ? { seller: myTradePub, buyer: peerTradePub }
                : { seller: peerTradePub, buyer: myTradePub };
        },

        ensureFundingAddress: async function(trade) {
            if (!trade || trade.method !== 'onchain' || trade.internal_status !== 'aceptado') return null;
            if (trade.taproot_address) return trade.taproot_address;
            if (trade._taprootInFlight) return null;
            trade._taprootInFlight = true;
            trade._taprootError = '';
            try {
                if (!Taproot || !Taproot.buildDetails) {
                    throw new Error(str_taproot_unavailable);
                }
                var keys = this.fundingKeys(trade);
                var arbitrators = this.arbitrators(trade);
                if (!keys) throw new Error(str_missing_trade_pubkeys);
                if (arbitrators.length !== 3) throw new Error(str_missing_arbitrators_err);
                var details = await Taproot.buildDetails(keys.seller, keys.buyer, arbitrators, _tradeNetwork(trade));
                trade._taprootDetails = details;
                trade.taproot_address = details.address;
                if (window.MostroTrader && MostroTrader._ajax) {
                    await MostroTrader._ajax('mostro_trade_update', {
                        order_id: trade.order_id,
                        fields: { taproot_address: details.address }
                    });
                }
                // Re-procesar address_check del peer que llegaron antes de derivar (si los hubo).
                // Sin esto, _seenTradeEventIds los marca como vistos y el taker se queda en
                // "Esperando a la otra parte" hasta recargar la pagina.
                if (Array.isArray(trade._pendingAddressChecks) && trade._pendingAddressChecks.length
                    && Trader && Trader._handleAddressCheckEvent) {
                    var pending = trade._pendingAddressChecks.slice();
                    trade._pendingAddressChecks = [];
                    for (var i = 0; i < pending.length; i++) {
                        try { await Trader._handleAddressCheckEvent(pending[i]); }
                        catch(e) { _warn('ensureFundingAddress: replay address_check failed', e); }
                    }
                }
                return details.address;
            } catch(e) {
                trade._taprootError = e.message || String(e);
                console.warn('[Onchain] funding address failed', trade.order_id, e);
                return null;
            } finally {
                trade._taprootInFlight = false;
                if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            }
        },

        confirmFundingAddress: async function(trade) {
            if (!trade || trade.method !== 'onchain' || trade.internal_status !== 'aceptado') return;
            if (trade.taproot_address) return;
            var msg = parseInt(trade.is_seller, 10) ? str_confirm_arbs_escrow_buyer : str_confirm_arbs_escrow_seller;
            if (!await confirm(msg)) return;
            await this.ensureFundingAddress(trade);
        },

        // Comprador: marca el fiat como enviado (kind 39385 action=fiat_sent) y avanza a fiat_enviado.
        confirmFiatSent: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (parseInt(trade.is_seller, 10)) return;                      // solo el comprador envia fiat
            if (trade.internal_status !== 'aceptado') return;               // requiere funding (el botón solo sale tras confirmar)
            if (!await confirm(str_confirm_fiat_sent_onchain)) return;
            try { await Trader.publishFiatSent(trade); }
            catch(e) { if (typeof notify === 'function') notify(t(str_fiat_publish_failed, e.message || String(e)), 'error', 7000); return; }
            await this._setLocalState(trade, 'fiat_enviado');
            if (typeof notify === 'function') notify(str_fiat_sent_notified_seller, 'info', 6000);
        },

        // Vendedor: confirma que recibio el fiat (kind 39385 action=fiat_received) → fiat_received.
        confirmFiatReceived: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (!parseInt(trade.is_seller, 10)) return;                     // solo el vendedor confirma recepcion
            if (trade.internal_status !== 'fiat_enviado') return;           // requiere que el comprador haya marcado enviado
            if (!await confirm(str_confirm_fiat_received_onchain)) return;
            try { await Trader.publishFiatReceived(trade); }
            catch(e) { if (typeof notify === 'function') notify(t(str_fiat_publish_failed, e.message || String(e)), 'error', 7000); return; }
            await this._setLocalState(trade, 'fiat_received');
            if (typeof notify === 'function') notify(str_fiat_received_unlocks_sign, 'info', 7000);
        },

        // Escribe los tres campos de estado iguales (ver _handleFiatStateEvent: evita que el
        // normalizador revierta por rank) y refresca la UI.
        _setLocalState: async function(trade, status) {
            if (window.MostroTrader && MostroTrader._ajax) {
                await MostroTrader._ajax('mostro_trade_update', {
                    order_id: trade.order_id,
                    fields: { internal_status: status, status: status, trade_action: status }
                });
            }
            trade.internal_status = status; trade.status = status; trade.trade_action = status;
            trade.updated_at = Math.floor(Date.now() / 1000);
            if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
        },

        // ==================== GASTO COOPERATIVO (coop_sign, paso 12) ====================

        // Persiste campos coop en trade_json (+ opcionalmente el estado) y refresca la UI.
        _saveCoop: async function(trade, metaPatch, status) {
            var merged = _mergeMeta(trade, metaPatch);
            var fields = { trade_json: merged };
            if (status) { fields.internal_status = status; fields.status = status; fields.trade_action = status; }
            if (window.MostroTrader && MostroTrader._ajax) {
                await MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: fields });
            }
            trade.trade_json = merged;
            if (status) { trade.internal_status = status; trade.status = status; trade.trade_action = status; }
            trade.updated_at = Math.floor(Date.now() / 1000);
            if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
        },

        // Envia un DM coop_sign (kind 4, NIP-04) a la contraparte con tx_hex + fee + nuestra firma.
        _sendCoopSign: async function(trade, coop, sigHex) {
            var DMs = window.Noxtr && window.Noxtr.DMs;
            if (!DMs || !DMs.encrypt) throw new Error('Noxtr.DMs no disponible');
            var peerNostr = _peerNostrPubkey(trade);
            if (!peerNostr) throw new Error('Sin pubkey nostr de la contraparte');
            var msg = {
                type:     'coop_sign',
                order_id: trade.order_id,
                trade_id: _readMeta(trade).trade_id || '',
                network:  _tradeNetwork(trade),
                tx_hex:   coop.tx_hex,
                fee_sats: coop.fee_sats,
                sig:      sigHex
            };
            var ciphertext = await DMs.encrypt(JSON.stringify(msg), peerNostr);
            var unsigned   = await Config.events.create(4, ciphertext, [['p', peerNostr], ['y', Config.Y_TAG]]);
            var signed     = await Config.events.sign(unsigned);
            await Trader._publishDurable(trade, signed);
            _log('coop_sign DM sent', { orderId: trade.order_id.slice(0, 8), to: peerNostr.slice(0, 8) + '…' });
        },

        // Comprador: inicia la liberacion. Propone el fee, construye el gasto cooperativo, firma con su
        // trade privkey y envia coop_sign al vendedor (spec sec 8.6: el beneficiario propone el fee).
        startCoopSign: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (parseInt(trade.is_seller, 10)) return;                          // solo el comprador inicia
            if (trade.internal_status !== 'fiat_received' && trade.internal_status !== 'firmando') return;
            if (_readMeta(trade).coop_signed_tx) { if (typeof notify === 'function') notify(str_coop_signed_ready, 'info', 6000); return; }
            // La direccion de cobro la valida buildCooperative (lanza si falta); no la chequeamos aqui.
            var fee = await this._promptFee(_tradeNetwork(trade), _VBYTES_COOP);
            if (fee === null) return;
            if (!(fee > 0)) { if (typeof notify === 'function') notify(str_coop_fee_invalid, 'warn', 5000); return; }
            var coop, mySig;
            try {
                coop  = await Spend.buildCooperative(trade, fee);
                mySig = await Schnorr.sign(coop.sighash, trade.trade_privkey);
            } catch(e) {
                if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000);
                return;
            }
            await this._saveCoop(trade, { coop_fee_sats: fee, coop_my_sig: mySig }, 'firmando');
            try { await this._sendCoopSign(trade, coop, mySig); }
            catch(e) { if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            if (typeof notify === 'function') notify(str_coop_waiting_seller, 'info', 7000);
        },

        // Recibe un coop_sign de la contraparte: verifica el tx_hex y la firma del peer, firma nuestra
        // parte (si falta), ensambla la TX final y la persiste. El vendedor (responder) devuelve su
        // firma al comprador; el comprador (iniciador) no responde, para no crear un bucle.
        _receiveCoopSign: async function(ev, msg) {
            var orderId = String((msg && msg.order_id) || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            if (!orderId) return;
            var trade = (window.MostroTrader && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
            if (!trade) {
                try { var r = await MostroTrader._ajax('mostro_trade_get', { order_id: orderId }); if (r && !r.error) trade = r.trade; } catch(e) {}
            }
            if (!trade || trade.method !== 'onchain' || _isArchivedTrade(trade)) return;
            if (ev.pubkey !== _peerNostrPubkey(trade)) { _warn('coop_sign: from untrusted pubkey', orderId.slice(0, 8)); return; }
            var peerSig = String(msg.sig || '');
            if (!/^[a-f0-9]{128}$/i.test(peerSig)) { _warn('coop_sign: peer sig invalida'); return; }
            var isSeller = !!parseInt(trade.is_seller, 10);
            // El fee lo propone el comprador (iniciador) y queda congelado. Si ya tenemos coop_fee_sats
            // (somos el comprador que inicio, o un re-procesado), usamos ESE, no el del mensaje: asi una
            // respuesta con fee distinto produce un tx_hex que no casa con el nuestro y se aborta, en vez
            // de ensamblar nuestra firma (de otro sighash) sobre una TX distinta.
            var fee = parseInt(_readMeta(trade).coop_fee_sats, 10) || parseInt(msg.fee_sats, 10) || 0;

            var coop;
            try { coop = await Spend.buildCooperative(trade, fee); }
            catch(e) { _warn('coop_sign: buildCooperative failed', e); if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            // Ambas partes MUST acordar el tx_hex antes de firmar (spec sec 8.6).
            if (String(msg.tx_hex || '') !== coop.tx_hex) {
                _warn('coop_sign: tx_hex mismatch', orderId.slice(0, 8));
                if (typeof notify === 'function') notify(str_coop_tx_mismatch, 'error', 12000);
                return;
            }
            var keys = this.fundingKeys(trade);
            if (!keys) { _warn('coop_sign: sin trade pubkeys'); return; }
            var peerTradePub = isSeller ? keys.buyer : keys.seller;   // la firma del peer verifica contra SU pubkey
            var ok = false;
            try { ok = await Schnorr.verify(peerSig, coop.sighash, peerTradePub); } catch(e) {}
            if (!ok) { if (typeof notify === 'function') notify(str_coop_sig_invalid, 'error', 10000); return; }

            // Nuestra firma (el vendedor la genera aqui la primera vez que recibe coop_sign).
            var mySig = _readMeta(trade).coop_my_sig;
            if (!mySig) {
                try { mySig = await Schnorr.sign(coop.sighash, trade.trade_privkey); }
                catch(e) { if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            }
            var buyerSig  = isSeller ? peerSig : mySig;
            var sellerSig = isSeller ? mySig   : peerSig;
            var signedTx, coopTxid = '';
            try { signedTx = Spend.assembleCooperative(coop, buyerSig, sellerSig); }
            catch(e) { _warn('coop_sign: assemble failed', e); if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            // txid esperado de la liberacion (del tx_hex legacy): permite reconocer la TX on-chain
            // aunque la difunda el peer o se haga manualmente, y cerrar el trade solo.
            try { coopTxid = await _txidFromLegacyHex(coop.tx_hex); } catch(e) {}

            await this._saveCoop(trade, { coop_fee_sats: fee, coop_my_sig: mySig, coop_peer_sig: peerSig, coop_signed_tx: signedTx, coop_txid: coopTxid }, 'firmando');
            if (isSeller) { try { await this._sendCoopSign(trade, coop, mySig); } catch(e) { _warn('coop_sign: reply failed', e); } }
            if (typeof notify === 'function') notify(str_coop_signed_ready, 'success', 9000);
            _log('coop_sign: signed tx ready', { orderId: orderId.slice(0, 8), bytes: signedTx.length / 2 });
        },

        // Difunde la TX cooperativa firmada (paso 13). Si entra, marca completado, guarda el release
        // txid y publica el evento complete (kind 39385 action=complete) para que la otra parte cierre.
        broadcastCoop: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            var _m = _readMeta(trade);
            var signedTx = String(_m.coop_signed_tx || '');
            // Re-ensamblar desde las firmas guardadas con el control block ACTUAL antes de difundir. Las
            // firmas (coop_my_sig/coop_peer_sig) firman el sighash, que no cambia; solo el witness podia
            // estar mal (bug de paridad pre-1.3.526). Asi "Re-difundir" arregla TX firmadas antes del fix
            // sin re-firmar ni repetir el intercambio. Si falta material, usa la TX guardada.
            if (_m.coop_my_sig && _m.coop_peer_sig && parseInt(_m.coop_fee_sats, 10) > 0) {
                try {
                    var coopRe = await Spend.buildCooperative(trade, parseInt(_m.coop_fee_sats, 10));
                    var isS = !!parseInt(trade.is_seller, 10);
                    var bSig = isS ? _m.coop_peer_sig : _m.coop_my_sig;
                    var sSig = isS ? _m.coop_my_sig  : _m.coop_peer_sig;
                    var fresh = Spend.assembleCooperative(coopRe, bSig, sSig);
                    if (fresh && fresh !== signedTx) { signedTx = fresh; await this._saveCoop(trade, { coop_signed_tx: fresh }); }
                } catch(e) { _warn('broadcastCoop: re-ensamblado fallo, uso la TX guardada', e); }
            }
            if (!signedTx) { if (typeof notify === 'function') notify(str_coop_broadcast_no_tx, 'warn', 6000); return; }
            if (!await confirm(str_coop_broadcast_confirm)) return;
            var resp;
            try { resp = await _ajax('broadcast_tx', { tx_hex: signedTx, network: _tradeNetwork(trade) }); }
            catch(e) { if (typeof notify === 'function') notify(t(str_coop_broadcast_failed, e.message || String(e)), 'error', 14000); return; }
            if (!resp || resp.error || !resp.ok || !resp.txid) {
                // Pudo fallar porque ya estaba difundida (peer / manual / doble click): si la TX ya
                // esta on-chain, cerramos como completado en vez de mostrar un error confuso.
                var known = String(_readMeta(trade).coop_txid || '');
                if (/^[0-9a-f]{64}$/.test(known)) {
                    try {
                        var st = await _ajax('tx_status', { txid: known, network: _tradeNetwork(trade) });
                        if (st && st.ok && st.found) {
                            // Ya en la red: registramos la liberacion pero NO la damos por completada
                            // hasta que confirme (>=1 conf). _refreshReleaseTx promueve a 'completado'.
                            await this._saveCoop(trade, { release_txid: known, release_broadcast_at: Math.floor(Date.now() / 1000), release_seen: 1, release_dropped: 0 });
                            try { await Trader.publishComplete(trade, known); } catch(e) {}
                            try { await this._refreshReleaseTx(trade); } catch(e) {}
                            if (typeof notify === 'function') notify(str_release_awaiting, 'info', 8000);
                            return;
                        }
                    } catch(e) {}
                }
                if (typeof notify === 'function') notify(t(str_coop_broadcast_failed, (resp && resp.msg) || 'error'), 'error', 16000);
                return;
            }
            var txid = String(resp.txid);
            // Difundida = aceptada por el backend, pero aun sin confirmar. NO marcamos 'completado' ni
            // 'release_seen' aqui: que el endpoint devuelva un txid NO garantiza que la TX quede en el
            // mempool (testnet a veces la acepta y no la retiene). release_seen lo pone _refreshReleaseTx
            // SOLO cuando tx_status la encuentra de verdad. _refreshReleaseTx promueve a 'completado' al
            // ver >=1 confirmacion, y si la TX no aparece reabre el trade para volver a difundir.
            await this._saveCoop(trade, { release_txid: txid, release_broadcast_at: Math.floor(Date.now() / 1000), release_dropped: 0 });
            if (typeof notify === 'function') notify(t(str_coop_broadcast_ok, txid.slice(0, 16) + '…'), 'success', 0);
            try { await Trader.publishComplete(trade, txid); }
            catch(e) { _warn('broadcastCoop: publishComplete failed', e); }
            this._verifyAndRetryBroadcast(trade, txid, signedTx);
        },

        // Verifica que una TX recien difundida aparece de verdad en la red y, si no, la reenvia (hasta 3
        // intentos, ~3.5s entre cada uno). testnet a veces "acepta" la TX (devuelve txid) pero no la
        // retiene en el mempool a la primera; esto automatiza el "redifundir manual" que si la mete.
        // Reenviar es idempotente (misma TX firmada, mismo txid). Fire-and-forget: no bloquea la UI.
        _verifyAndRetryBroadcast: async function(trade, txid, signedHex) {
            var net = _tradeNetwork(trade);
            for (var i = 0; i < 3; i++) {
                await new Promise(function(r) { setTimeout(r, 3500); });
                var st = null;
                try { st = await _ajax('tx_status', { txid: txid, network: net }); } catch(e) {}
                if (st && st.ok && st.found) { try { await this._refreshReleaseTx(trade); } catch(e) {} return; }
                if (signedHex) { try { await _ajax('broadcast_tx', { tx_hex: signedHex, network: net }); } catch(e) {} }
            }
            try { await this._refreshReleaseTx(trade); } catch(e) {}
        },

        // Recovery (paso 16): el vendedor recupera el escrow por la hoja 1 (single-sig, CSV 4320) cuando
        // el trade quedo bloqueado y nadie resolvio. Gate del CSV via tx_status (confirmaciones del
        // funding >= 4320). Reusa los campos coop_*/release_* + flag recovery para el poll y el render.
        recoverFunds: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (!parseInt(trade.is_seller, 10)) return;                  // solo el vendedor
            if (['completado', 'cancelado'].indexOf(trade.internal_status) !== -1) return;
            if (!String(trade.funding_txid || '').trim()) { if (typeof notify === 'function') notify(str_oc_no_funding_recover, 'warn', 6000); return; }
            var net = _tradeNetwork(trade);
            var CSV = Config.CSV_RECOVERY;
            // Gate: el funding debe tener >= CSV_RECOVERY confirmaciones (el poll normal se detiene
            // antes, asi que lo comprobamos en fresco al pulsar).
            var st;
            try { st = await _ajax('tx_status', { txid: trade.funding_txid, network: net }); }
            catch(e) { if (typeof notify === 'function') notify(str_oc_check_confirmations_failed, 'error', 9000); return; }
            var confs = (st && st.ok && st.found) ? (parseInt(st.confirmations, 10) || 0) : 0;
            if (confs < CSV) {
                var remaining = CSV - confs;
                if (typeof notify === 'function') notify(window.t(str_oc_recovery_not_available, confs, CSV, _csvApproxTime(remaining)), 'warn', 13000);
                return;
            }
            // Direccion de cobro del vendedor (no se recogia en el happy path).
            var addr = String(_readMeta(trade).seller_payout_address || '').trim();
            if (!_isValidPayoutAddress(addr, net)) {
                var input = await prompt(window.t(str_oc_payout_prompt, net), addr || '');
                if (input === null) return;
                addr = String(input).trim();
                if (!_isValidPayoutAddress(addr, net)) { alert(window.t(str_oc_invalid_address_for, net)); return; }
                var merged = _mergeMeta(trade, { seller_payout_address: addr });
                if (window.MostroTrader && MostroTrader._ajax) {
                    try { await MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { trade_json: merged } }); } catch(e) {}
                }
                trade.trade_json = merged;
            }
            if (!await confirm(str_oc_confirm_recover)) return;
            var estRec = await this._recommendedFee(net, _VBYTES_RECOVERY);
            var feeStr = await prompt(window.t(str_oc_mining_fee_prompt, estRec.sats, estRec.rate), String(estRec.sats));
            if (feeStr === null) return;
            var fee = parseInt(feeStr, 10);
            if (!(fee > 0)) { if (typeof notify === 'function') notify(str_oc_mining_fee_invalid, 'warn', 5000); return; }
            var rec, sig, signedTx;
            try {
                rec = await Spend.buildRecovery(trade, fee);
                sig = await Schnorr.sign(rec.sighash, trade.trade_privkey);
                signedTx = Spend.assembleRecovery(rec, sig);
            } catch(e) { if (typeof notify === 'function') notify(window.t(str_oc_recovery_build_failed, (e.message || String(e))), 'error', 12000); return; }
            var txid = await _txidFromLegacyHex(rec.tx_hex);
            await this._saveCoop(trade, { coop_signed_tx: signedTx, coop_txid: txid, coop_fee_sats: fee, recovery: true }, 'firmando');
            try {
                var resp = await _ajax('broadcast_tx', { tx_hex: signedTx, network: net });
                if (resp && resp.ok && resp.txid) {
                    // Difundida pero sin confirmar: no se da por recuperada hasta que confirme.
                    await this._saveCoop(trade, { release_txid: String(resp.txid), release_broadcast_at: Math.floor(Date.now() / 1000), release_dropped: 0, recovery: true });
                    if (typeof notify === 'function') notify(window.t(str_oc_recovery_sent, String(resp.txid).slice(0, 16)), 'info', 0);
                    try { await this._refreshReleaseTx(trade); } catch(e) {}
                    return;
                }
                _warn('recoverFunds: broadcast no ok', resp && resp.msg);
                if (typeof notify === 'function') notify(window.t(str_oc_recovery_broadcast_failed, ((resp && resp.msg) || 'error')), 'error', 16000);
            } catch(e) { if (typeof notify === 'function') notify(window.t(str_oc_recovery_broadcast_error, (e.message || String(e))), 'error', 13000); }
        },

        // Bloque de recovery para el vendedor: aparece mientras haya funding y el trade no sea terminal
        // ni este ya en recovery. El gate real del CSV 4320 se comprueba al pulsar (tx_status).
        recoveryHtml: function(trade) {
            if (!trade || trade.method !== 'onchain') return '';
            if (!parseInt(trade.is_seller, 10)) return '';
            if (!String(trade.funding_txid || '').trim()) return '';
            if (['completado', 'cancelado'].indexOf(trade.internal_status) !== -1) return '';
            if (_readMeta(trade).recovery) return '';
            return '<div class="nxoc-funding-box nxoc-recovery-box">' +
                '<div class="nxoc-funding-label">' + _escHtml('Recuperacion de emergencia (recovery)') + '</div>' +
                '<div class="nxoc-funding-help">' + _escHtml(window.t(str_oc_recovery_help, _csvApproxTime(Config.CSV_RECOVERY), Config.CSV_RECOVERY)) + '</div>' +
                '<button class="btn btn-noxtr btn-sm btn-warning nxoc-recover-btn" data-id="' + _escHtml(trade.order_id) + '">' + _escHtml(str_oc_recover_funds) + '</button>' +
            '</div>';
        },

        // Abre una disputa (paso 15): confirma, pide motivo y publica 39386 + dispute_request a arb1.
        openDispute: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (['completado', 'cancelado', 'disputado'].indexOf(trade.internal_status) !== -1) return;
            if (!trade.funding_txid) { if (typeof notify === 'function') notify(str_dispute_needs_funding, 'warn', 6000); return; }
            if (!await confirm(str_dispute_confirm)) return;
            var reason = await prompt(str_dispute_reason_prompt, '');
            if (reason === null) return;
            try { await Trader.publishDispute(trade, reason); }
            catch(e) { if (typeof notify === 'function') notify(t(str_dispute_failed, e.message || String(e)), 'error', 9000); return; }
            await this._saveCoop(trade, {}, 'disputado');
            if (typeof notify === 'function') notify(str_dispute_opened_ok, 'info', 7000);
        },

        // Liquidacion de disputa (lado ganador): reconstruye el gasto de la hoja de arbitraje, verifica
        // la firma del arbitro, firma la propia, ensambla, difunde y cierra. Reusa los campos coop_* para
        // que el poll de confirmaciones y el render de "completado" funcionen igual que en el cooperativo.
        settleArbitration: async function(trade, winnerSide, arbIndex, fee, peerTxHex, arbSig, payoutAddress) {
            // Si gana el vendedor, su trade local no tiene seller_payout_address (solo se recogia la del
            // comprador): el arbitro la envia en el DM. La persistimos antes de construir para que el
            // sighash coincida con el del arbitro. Solo se acepta si es valida para la red del trade.
            var net = _tradeNetwork(trade);
            var addrKey = (winnerSide === 'seller') ? 'seller_payout_address' : 'buyer_payout_address';
            if (payoutAddress && await _isValidPayoutAddressStrict(payoutAddress, net) && _readMeta(trade)[addrKey] !== payoutAddress) {
                var patch = {}; patch[addrKey] = payoutAddress;
                var merged = _mergeMeta(trade, patch);
                if (window.MostroTrader && MostroTrader._ajax) {
                    try { await MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { trade_json: merged } }); } catch(e) {}
                }
                trade.trade_json = merged;
            }
            var arb;
            try { arb = await Spend.buildArbitration(trade, winnerSide, arbIndex, fee); }
            catch(e) { if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            if (peerTxHex && String(peerTxHex) !== arb.tx_hex) { if (typeof notify === 'function') notify(str_coop_tx_mismatch, 'error', 12000); return; }
            var arbBtc = UI.arbitrators(trade)[arbIndex - 1];
            var okArb = false;
            try { okArb = await Schnorr.verify(arbSig, arb.sighash, arbBtc); } catch(e) {}
            if (!okArb) { if (typeof notify === 'function') notify(str_coop_sig_invalid, 'error', 10000); return; }
            var winnerSig, signedTx;
            try {
                winnerSig = await Schnorr.sign(arb.sighash, trade.trade_privkey);
                signedTx  = Spend.assembleArbitration(arb, winnerSig, arbSig);
            } catch(e) { if (typeof notify === 'function') notify(t(str_coop_sign_failed, e.message || String(e)), 'error', 9000); return; }
            var txid = await _txidFromLegacyHex(arb.tx_hex);
            await this._saveCoop(trade, { coop_signed_tx: signedTx, coop_txid: txid, coop_fee_sats: fee, dispute_winner: winnerSide }, 'firmando');
            // Difundir. Si falla (p.ej. CSV de arb2/arb3 no cumplido), el poll _refreshReleaseTx la detectara luego.
            try {
                var resp = await _ajax('broadcast_tx', { tx_hex: signedTx, network: _tradeNetwork(trade) });
                if (resp && resp.ok && resp.txid) {
                    // Difundida pero sin confirmar: no se da por liberada hasta que confirme.
                    await this._saveCoop(trade, { release_txid: String(resp.txid), release_broadcast_at: Math.floor(Date.now() / 1000), release_dropped: 0, dispute_winner: winnerSide });
                    if (typeof notify === 'function') notify(t(str_coop_broadcast_ok, String(resp.txid).slice(0, 16) + '…'), 'success', 0);
                    try { await Trader.publishComplete(trade, String(resp.txid)); } catch(e) {}
                    try { await this._refreshReleaseTx(trade); } catch(e) {}
                    return;
                }
                _warn('settleArbitration: broadcast no ok', resp && resp.msg);
            } catch(e) { _warn('settleArbitration broadcast', e); }
            if (typeof notify === 'function') notify(str_coop_signed_ready, 'info', 9000);
        },

        // Comprador: guarda su direccion de cobro y la anuncia al vendedor (kind 39385 buyer_payout).
        setBuyerPayout: async function(trade, address) {
            if (!trade || trade.method !== 'onchain') return;
            if (parseInt(trade.is_seller, 10)) return;             // solo el comprador
            var net = _tradeNetwork(trade);
            var addr = String(address || '').trim();
            if (!(await _isValidPayoutAddressStrict(addr, net))) { alert(t(str_payout_invalid, net)); return; }
            var merged = _mergeMeta(trade, { buyer_payout_address: addr });
            if (window.MostroTrader && MostroTrader._ajax) {
                await MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { trade_json: merged } });
            }
            trade.trade_json = merged;
            trade._payoutEditing = false;        // mostrar el estado "guardada" tras guardar
            try { await Trader.publishBuyerPayout(trade, addr); }
            catch(e) { if (typeof notify === 'function') notify(t(str_fiat_publish_failed, e.message || String(e)), 'warn', 6000); }
            if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            if (typeof notify === 'function') notify(str_payout_saved, 'info', 5000);
        },

        // Sub-bloque de direccion de cobro del comprador. Comprador: input editable. Vendedor: la ve
        // cuando el comprador la ha enviado.
        _payoutHtml: function(trade) {
            var net  = _tradeNetwork(trade);
            var meta = _readMeta(trade);
            var addr = String(meta.buyer_payout_address || '');
            if (parseInt(trade.is_seller, 10)) {
                return '<div class="nxoc-funding-box"><div class="nxoc-funding-help">' +
                    _escHtml(addr ? t(str_payout_buyer_set, addr) : str_payout_waiting_buyer) +
                '</div></div>';
            }
            // Una vez difundida la liberacion (o firmada la TX cooperativa), la direccion ya esta baked
            // en la transaccion: editarla no haria nada. La mostramos en solo lectura para no confundir.
            var locked = /^[0-9a-f]{64}$/.test(String(meta.release_txid || '')) || !!meta.coop_signed_tx;
            if (locked) {
                return '<div class="nxoc-funding-box"><div class="nxoc-funding-help">' +
                    _escHtml(addr ? t(str_payout_buyer_locked, addr) : str_payout_waiting_buyer) +
                '</div></div>';
            }
            // Ya guardada y no estamos editando: confirmacion + boton Cambiar (editable hasta liberar).
            if (addr && !trade._payoutEditing) {
                return '<div class="nxoc-funding-box">' +
                    '<div class="nxoc-funding-status-ok">' + _escHtml(t(str_payout_buyer_saved, addr)) + '</div>' +
                    '<button class="btn btn-noxtr btn-sm nxoc-payout-edit-btn" data-id="' + _escHtml(trade.order_id) + '" style="margin-top:6px">' + str_payout_change + '</button>' +
                '</div>';
            }
            // Sin direccion aun, o el comprador pidio cambiarla: input editable.
            return '<div class="nxoc-funding-box">' +
                '<div class="nxoc-funding-label">' + _escHtml(t(str_payout_address_label, net)) + '</div>' +
                '<div class="mostro-lnaddr-inline-row">' +
                    '<input id="nxoc-payout-' + _escHtml(trade.order_id) + '" type="text" class="mostro-invoice-input" placeholder="' + _escHtml(str_payout_address_placeholder) + '" value="' + _escHtml(addr) + '">' +
                    '<button class="btn btn-noxtr btn-sm btn-primary nxoc-payout-save-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_payout_save + '</button>' +
                '</div>' +
                '<div class="nxoc-funding-help">' + _escHtml(str_payout_self_custody_hint) + '</div>' +
            '</div>';
        },

        // Bloque de fase fiat (tras funding confirmado): fiat_enviado / fiat_received / firmando /
        // completado / disputado.
        fiatPhaseHtml: function(trade) {
            if (!trade || trade.method !== 'onchain') return '';
            var st = trade.internal_status;
            if (['fiat_enviado', 'fiat_received', 'firmando', 'completado', 'disputado'].indexOf(st) === -1) return '';
            var sellerSide = parseInt(trade.is_seller, 10);
            if (st === 'disputado') return this._disputeStatusHtml(trade) + this.recoveryHtml(trade);
            var html;
            if (st === 'fiat_enviado') {
                if (sellerSide) {
                    html = '<div class="nxoc-funding-box">' +
                        '<div class="nxoc-funding-status-prog">' + _escHtml(str_buyer_marked_fiat_sent) + '</div>' +
                        _mitmHtml(trade, 'seller_confirm') +
                        '<button class="btn btn-noxtr btn-success nxoc-fiat-received-btn" data-id="' + _escHtml(trade.order_id) + '" style="margin-top:6px">' + str_confirm_fiat_received_btn + '</button>' +
                    '</div>';
                } else {
                    html = '<div class="nxoc-funding-box"><div class="nxoc-funding-label">' + _escHtml(str_fiat_sent_waiting_seller) + '</div></div>';
                }
            } else {
                // fiat_received / firmando / completado: firma cooperativa + broadcast (pasos 12-14).
                html = this._coopSignHtml(trade, sellerSide);
            }
            // Boton "Disputar" mientras el trade siga vivo (no completado): abre la via arbitral.
            var disputeBtn = (st !== 'completado')
                ? '<div class="nxoc-funding-box"><button class="btn btn-noxtr btn-sm btn-warning nxoc-dispute-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_dispute_btn + '</button></div>'
                : '';
            // La direccion de cobro hace falta para el gasto cooperativo: la pedimos/mostramos mientras
            // no este completado (ya no aporta nada una vez liberado). En la fase de firma del comprador
            // va ARRIBA (es contexto: "tu direccion de cobro") y la accion "Firmar y liberar" debajo,
            // como paso final claro. En el resto de estados, la accion primero.
            var payout = (st === 'completado') ? '' : this._payoutHtml(trade);
            var buyerSigning = !sellerSide && (st === 'fiat_received' || st === 'firmando');
            var body = buyerSigning ? (payout + html) : (html + payout);
            return body + disputeBtn + this.recoveryHtml(trade);
        },

        // Estado de disputa: en curso, o el resultado del arbitro (informativo; si ganaste, la
        // liquidacion se dispara sola al recibir el DM arb_signature y la ficha pasara a completado).
        _disputeStatusHtml: function(trade) {
            var live = (typeof MostroTrader !== 'undefined' && MostroTrader._trades && MostroTrader._trades[trade.order_id])
                ? MostroTrader._trades[trade.order_id] : trade;
            var winner = live._arbWinner || '';
            var mySide = parseInt(trade.is_seller, 10) ? 'seller' : 'buyer';
            var msg = !winner ? str_dispute_in_progress : (winner === mySide ? str_dispute_won_self : str_dispute_lost_self);
            return '<div class="nxoc-funding-box">' +
                '<div class="nxoc-funding-status-prog">' + _escHtml(str_dispute_label) + '</div>' +
                '<div class="nxoc-funding-help">' + _escHtml(msg) + '</div>' +
            '</div>';
        },

        // Sub-bloque de firma cooperativa. Estados: completado (release txid), ambas firmas listas
        // (boton difundir), comprador sin firmar (boton firmar), o a la espera de la otra parte.
        _coopSignHtml: function(trade, sellerSide) {
            var meta = _readMeta(trade);
            var releaseTxid = String(meta.release_txid || '');
            var signedTx = String(meta.coop_signed_tx || '');
            if (releaseTxid || trade.internal_status === 'completado') {
                var shortRt = releaseTxid ? (releaseTxid.slice(0, 16) + '…' + releaseTxid.slice(-8)) : '';
                var confs = parseInt(meta.release_confirmations, 10) || 0;
                var seen  = parseInt(meta.release_seen, 10) ? true : false;
                // Estado de la TX: confirmada / en mempool / no se ve en la red (evictada o propagando).
                var statusTxt = confs > 0 ? t(str_release_confirmations, confs)
                              : (seen ? str_release_in_mempool : str_release_not_in_mempool);
                var statusCls = confs > 0 ? 'nxoc-funding-status-ok'
                              : (seen ? 'nxoc-funding-status-prog' : 'nxoc-funding-status-bad');
                // En mempool sin confirmar: span que rellena renderReleaseEtas con la estimacion de
                // tiempo (compara el fee de la TX = coop_fee_sats/vbytes con los tiers de la mempool).
                var etaSpan = '';
                if (releaseTxid && seen && confs === 0) {
                    var feeSats = parseInt(meta.coop_fee_sats, 10) || 0;
                    if (feeSats > 0) {
                        var txRate = feeSats / _VBYTES_COOP;
                        etaSpan = '<span class="nxoc-release-eta" data-rate="' + txRate.toFixed(2) + '" data-net="' + _escHtml(_tradeNetwork(trade)) + '"></span>';
                    }
                }
                var confHtml = releaseTxid
                    ? '<div class="nxoc-funding-help ' + statusCls + '">' + _escHtml(statusTxt) + etaSpan + '</div>'
                    : '';
                // Solo "completado" de verdad con >=1 confirmacion (o trades antiguos ya cerrados).
                // Con 0 conf mostramos "enviada, esperando confirmacion" para no mentir como antes.
                var confirmed = confs > 0 || trade.internal_status === 'completado';
                var headLabel = confirmed
                    ? (meta.recovery ? 'Fondos recuperados (recovery)' : str_coop_completed)
                    : str_release_awaiting;
                return '<div class="nxoc-funding-box">' +
                    '<div class="' + (confirmed ? 'nxoc-funding-status-ok' : 'nxoc-funding-status-prog') + '">' + _escHtml(headLabel) + '</div>' +
                    confHtml +
                    (!confirmed ? '<div class="nxoc-funding-help">' + _escHtml(str_release_wait_hint) + '</div>' : '') +
                    (releaseTxid
                        ? '<div class="nxoc-funding-row">' +
                            '<code class="nxoc-funding-address">' + _escHtml(str_release_txid_label) + ' ' + _escHtml(shortRt) + '</code>' +
                            '<button class="btn btn-noxtr btn-sm nxoc-copy-address" data-address="' + _escHtml(releaseTxid) + '">' + str_copy + '</button>' +
                            '<a class="btn btn-noxtr btn-sm" href="' + _escHtml(_explorerTxUrl(_tradeNetwork(trade), releaseTxid)) + '" target="_blank" rel="noopener">' + str_view_explorer + '</a>' +
                          '</div>'
                        : '') +
                    // Boton Re-difundir SIEMPRE disponible mientras no este confirmada. Re-difundir es
                    // idempotente (misma TX firmada, mismo txid); si ya esta en mempool el nodo responde
                    // "ya conocida" sin efecto. Lo dejamos visible porque testnet evicta TX sin confirmar
                    // y el `seen` se quedaba pegado a 1, escondiendo el boton justo cuando hacia falta.
                    (!confirmed && signedTx
                        ? '<button class="btn btn-noxtr btn-sm nxoc-coop-broadcast-btn" data-id="' + _escHtml(trade.order_id) + '" style="margin-top:6px">' + str_release_rebroadcast_btn + '</button>' +
                          '<div class="nxoc-funding-help">' + _escHtml(seen ? str_release_in_mempool : str_release_rebroadcast_hint) + '</div>'
                        : '') +
                '</div>';
            }
            if (signedTx) {
                var shortTx = signedTx.length > 40 ? (signedTx.slice(0, 24) + '…' + signedTx.slice(-12)) : signedTx;
                var droppedHtml = parseInt(meta.release_dropped, 10)
                    ? '<div class="nxoc-funding-status-bad">' + _escHtml(str_release_dropped_warn) +
                        (meta.release_drop_reason ? '<br><small>' + _escHtml(t(str_release_drop_reason_line, meta.release_drop_reason)) + '</small>' : '') +
                      '</div>'
                    : '';
                return '<div class="nxoc-funding-box">' +
                    droppedHtml +
                    '<div class="nxoc-funding-status-ok">' + _escHtml(str_coop_signed_ready) + '</div>' +
                    '<button class="btn btn-noxtr btn-sm btn-success nxoc-coop-broadcast-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_coop_broadcast_btn + '</button>' +
                    '<div class="nxoc-funding-help">' + _escHtml(str_coop_broadcast_pending) + '</div>' +
                    '<div class="nxoc-funding-row">' +
                        '<code class="nxoc-funding-address">' + _escHtml(shortTx) + '</code>' +
                        '<button class="btn btn-noxtr btn-sm nxoc-copy-address" data-address="' + _escHtml(signedTx) + '">' + str_copy + '</button>' +
                    '</div>' +
                '</div>';
            }
            if (sellerSide) {
                return '<div class="nxoc-funding-box"><div class="nxoc-funding-label">' + _escHtml(str_coop_waiting_buyer) + '</div></div>';
            }
            if (meta.coop_my_sig) {
                return '<div class="nxoc-funding-box"><div class="nxoc-funding-label">' + _escHtml(str_coop_waiting_seller) + '</div></div>';
            }
            return '<div class="nxoc-funding-box">' +
                '<div class="nxoc-funding-status-ok">' + _escHtml(str_fiat_confirmed_sign_next) + '</div>' +
                '<button class="btn btn-noxtr btn-sm btn-success nxoc-coop-sign-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_coop_sign_btn + '</button>' +
            '</div>';
        },

        // Paso de verificacion (v2.7): publica la direccion derivada para que el peer la compare.
        // Si el peer ya publico la suya y coincide, _handleAddressCheckEvent ya marco verificado.
        checkAddress: async function(trade) {
            if (!trade || trade.method !== 'onchain') return;
            if (!trade.taproot_address) {
                // Aun no derivada: la generamos primero. El click implicito vale como confirmacion.
                var addr = await this.ensureFundingAddress(trade);
                if (!addr) return;
            }
            if (trade._addressCheckPublished) return;
            if (!Trader || !Trader.publishAddressCheck) return;
            try {
                await Trader.publishAddressCheck(trade);
            } catch(e) {
                console.warn('[Onchain] No se pudo publicar address_check:', e);
                if (typeof notify === 'function') notify(t(str_address_check_self_warn, e.message || String(e)), 'warn', 8000);
            }
        },

        fundingHtml: function(trade) {
            if (!trade || trade.method !== 'onchain' || trade.internal_status !== 'aceptado') return '';
            var address = trade.taproot_address || (trade._taprootDetails && trade._taprootDetails.address) || '';
            var sellerSide = parseInt(trade.is_seller, 10);
            if (trade._taprootInFlight || trade._taprootError) {
                return '<div class="nxoc-funding-box">' +
                    '<div class="nxoc-funding-label">' +
                        (trade._taprootError ? _escHtml(t(str_escrow_calc_failed, trade._taprootError)) : str_calculating_escrow) +
                    '</div>' +
                '</div>';
            }
            if (!address) {
                // No hay direccion aun: el boton genera Y comprueba en un solo paso.
                var beforeText = sellerSide ? str_warn_before_btc : str_warn_before_fiat;
                return '<div class="nxoc-funding-box">' +
                    '<div class="nxoc-funding-label">' + _escHtml(beforeText) + '</div>' +
                    '<button class="btn btn-noxtr btn-sm btn-primary nxoc-check-address-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_confirm_arbs_generate_addr + '</button>' +
                '</div>';
            }

            // Direccion ya derivada: bloque con direccion + estado de verificacion.
            var verified = !!trade._addressVerified || _readMeta(trade).peer_address_verified === true;
            var mismatch = !!trade._addressMismatch;
            var published = !!trade._addressCheckPublished;
            // ¿Ya hay deposito real on-chain? Si lo hay, los textos cambian de "deposita / esperando
            // deposito" a "depositado", porque mantener el imperativo confunde una vez visto el BTC.
            var depositSeen = verified && !!String(trade.funding_txid || '').trim() && !trade._fundingAmountMismatch;
            var label = depositSeen
                ? (sellerSide ? str_btc_deposited_escrow : str_peer_deposited_btc)
                : (sellerSide ? str_send_btc_to_escrow   : str_waiting_btc_deposit);
            var statusHtml;
            if (mismatch) {
                statusHtml = '<span class="nxoc-verify-bad">' + _escHtml(str_address_mismatch) + '</span>';
            } else if (verified) {
                statusHtml = '<span class="nxoc-verify-ok">' + _escHtml(str_address_verified) + '</span>';
            } else if (published) {
                statusHtml = '<span class="nxoc-verify-wait">' + _escHtml(str_address_waiting_peer) + '</span>';
            } else {
                statusHtml = '<div class="nxoc-funding-help">' + _escHtml(str_address_check_help) + '</div>' +
                    '<button class="btn btn-noxtr btn-sm btn-primary nxoc-check-address-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_check_address + '</button>';
            }
            var afterText = sellerSide ? str_next_step_send_btc : str_next_step_wait_btc;
            var satAmount = parseInt(trade.sat_amount, 10) || 0;
            // El vendedor deposita sat_amount + la comision completa del arbitro (la asume el vendedor).
            var fundTarget    = _fundingTargetSats(trade);
            var sellerArbFee  = Math.max(0, fundTarget - satAmount);
            var fiatAmount = String(trade.fiat_amount || '').trim();
            var fiatCode   = String(trade.fiat_code   || '').trim();
            var amountHtml = '';
            if (satAmount > 0) {
                var amountText = depositSeen
                    ? t(str_amount_deposited, fundTarget.toLocaleString())
                    : t(str_amount_to_deposit, fundTarget.toLocaleString());
                var feeHintHtml = (sellerArbFee > 0 && sellerSide && !depositSeen)
                    ? '<div class="nxoc-funding-help">' + _escHtml(t(str_funding_fee_split_hint, sellerArbFee.toLocaleString())) + '</div>'
                    : '';
                amountHtml = '<div class="nxoc-funding-amount">' +
                    _escHtml(amountText) + '</div>' + feeHintHtml;
            } else if (fiatAmount && fiatCode) {
                // Orden a precio de mercado (amountSats = 0 al crear): mostramos al menos la cantidad fiat
                // acordada para que la parte pueda calcular los sats con su wallet al tipo pactado.
                amountHtml = '<div class="nxoc-funding-amount">' +
                    _escHtml(t(str_amount_to_deposit_fiat, fiatAmount, fiatCode)) + '</div>';
            }
            // Si la direccion ya esta verificada bilateralmente, mostramos tambien el estado del
            // funding on-chain (poll global verify_funding actualiza confirmaciones cada N seg).
            var fundingStatusHtml = '';
            if (verified) {
                var target = this.fundingConfirmTarget(satAmount);
                var fundingTxid = String(trade.funding_txid || '').trim();
                var confs       = parseInt(trade.confirmations, 10) || 0;
                var detectedAt  = parseInt(trade._fundingDetectedAt, 10) || 0;
                if (trade._fundingAmountMismatch) {
                    // Hay deposito pero con cantidad distinta a la negociada: aviso en rojo.
                    var received = parseInt(trade._fundingReceivedSats, 10) || 0;
                    fundingStatusHtml = '<div class="nxoc-funding-status-bad">' +
                        _escHtml(t(str_funding_amount_mismatch, received.toLocaleString(), satAmount.toLocaleString())) +
                    '</div>';
                } else if (!fundingTxid) {
                    fundingStatusHtml = '<div class="nxoc-funding-help nxoc-funding-status-wait">' +
                        _escHtml(str_funding_waiting) + '</div>';
                } else if (confs >= target) {
                    // Funding completo: confirmacion + accion siguiente segun rol. El comprador
                    // puede marcar el fiat como enviado (boton); el vendedor solo espera.
                    var okLine = '<div class="nxoc-funding-status-ok">' + _escHtml(t(str_funding_verified, confs)) + '</div>';
                    if (sellerSide) {
                        fundingStatusHtml = okLine +
                            '<div class="nxoc-funding-action">' + _escHtml(str_funding_seller_waits_fiat) + '</div>' +
                            _mitmHtml(trade, 'seller_wait');
                    } else {
                        fundingStatusHtml = okLine +
                            '<div class="nxoc-funding-action">' + _escHtml(str_funding_ready_send_fiat) + '</div>' +
                            _mitmHtml(trade, 'buyer') +
                            '<button class="btn btn-noxtr btn-sm btn-success nxoc-fiat-sent-btn" data-id="' + _escHtml(trade.order_id) + '">' + str_i_sent_fiat + '</button>';
                    }
                } else {
                    // Funding en progreso. Texto base + reloj "detectado hace ...". El reloj se
                    // refresca cada segundo via UI.startFundingTicker (data-since en el span).
                    var baseText = confs === 0
                        ? str_funding_detected_mempool
                        : t(str_funding_n_of_t_confs, confs, target);
                    var elapsedSpan = '';
                    if (detectedAt && typeof MostroTrader !== 'undefined' && MostroTrader._relTime) {
                        var elapsedRaw   = MostroTrader._relTime(detectedAt) || '';
                        var elapsedShort = elapsedRaw.replace(/^hace\s+/i, '');
                        elapsedSpan = ' · detectado hace <span class="nxoc-funding-elapsed" data-since="' +
                            detectedAt + '">' + _escHtml(elapsedShort) + '</span>';
                    }
                    var waitLead = sellerSide
                        ? t(str_funding_wait_info_seller, target)
                        : t(str_funding_wait_info_buyer, target);
                    var isTestNet = _tradeNetwork(trade) !== 'mainnet';
                    var guideHtml = '<div class="nxoc-funding-guide">' +
                        '<div class="nxoc-guide-title">⏳ ' + _escHtml(str_funding_wait_title) + '</div>' +
                        '<p class="nxoc-guide-lead">' + _escHtml(waitLead) + '</p>' +
                        '<ul>' +
                            '<li>' + _escHtml(str_funding_wait_what) + '</li>' +
                            '<li>' + _escHtml(str_funding_wait_do) + '</li>' +
                        '</ul>' +
                        (isTestNet ? '<div class="nxoc-guide-testnet">' + _escHtml(str_funding_wait_testnet) + '</div>' : '') +
                    '</div>';
                    fundingStatusHtml = '<div class="nxoc-funding-status-prog">' +
                        _escHtml(baseText) + elapsedSpan +
                    '</div>' + guideHtml;
                }
            }
            // QR de pago (BIP21) solo para el vendedor, con la direccion verificada y aun sin deposito.
            // Incluye el importe exacto a depositar (fundTarget) para que el wallet lo prerrellene; el
            // scheme es "bitcoin:" tambien en testnet/signet (el HRP tb1p ya identifica la red).
            var qrHtml = '';
            if (sellerSide && verified && !depositSeen && address) {
                var bip21 = 'bitcoin:' + address + (fundTarget > 0 ? '?amount=' + _satsToBtc(fundTarget) : '');
                qrHtml = '<div class="nxoc-funding-qr" data-bip21="' + _escHtml(bip21) + '"></div>';
            }
            return '<div class="nxoc-funding-box">' +
                '<div class="nxoc-funding-label">' + _escHtml(label) + '</div>' +
                amountHtml +
                qrHtml +
                '<div class="nxoc-funding-row">' +
                    '<code class="nxoc-funding-address">' + _escHtml(address) + '</code>' +
                    '<button class="btn btn-noxtr btn-sm nxoc-copy-address" data-address="' + _escHtml(address) + '">' + str_copy + '</button>' +
                '</div>' +
                '<div class="nxoc-funding-help">' + statusHtml + '</div>' +
                fundingStatusHtml +
                // El "Siguiente paso..." generico solo aporta antes de que empiece el funding.
                // Una vez verificada la direccion y detectado el deposito, el bloque fundingStatusHtml
                // ya lleva el mensaje contextual (incl. "ya puedes enviar el fiat").
                (verified && !trade.funding_txid ? '<div class="nxoc-funding-help">' + _escHtml(afterText) + '</div>' : '') +
            '</div>' + this.recoveryHtml(trade);
        },

        // Renderiza los QR BIP21 en los contenedores .nxoc-funding-qr ya insertados en el DOM.
        // fundingHtml devuelve string, asi que el QR se pinta despues del innerHTML del trade card.
        // Idempotente: marca cada contenedor para no repintar en cada poll.
        renderFundingQRs: function() {
            if (typeof QRCode === 'undefined') return;
            var els = document.querySelectorAll('.nxoc-funding-qr[data-bip21]');
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (el._qrRendered) continue;
                var uri = el.getAttribute('data-bip21');
                if (!uri) continue;
                el._qrRendered = true;
                try {
                    new QRCode(el, { text: uri, width: 180, height: 180, colorDark: '#000', colorLight: '#fff' });
                } catch (e) { el._qrRendered = false; }
            }
        },

        // Tiers de fee de la mempool por red, cacheados 60s. Devuelve Promise<tiers|null>.
        _tiersCache: {},
        _recommendedTiers: function(network) {
            network = String(network || 'mainnet').toLowerCase();
            var now = Date.now();
            var c = this._tiersCache[network];
            if (c && (now - c.at) < 60000) return Promise.resolve(c.tiers);
            var self = this;
            return _ajax('recommended_fees', { network: network }).then(function(r) {
                var tiers = (r && r.ok) ? r : null;
                if (tiers) self._tiersCache[network] = { tiers: tiers, at: now };
                return tiers;
            }).catch(function() { return c ? c.tiers : null; });
        },

        // Traduce el fee rate de la TX (sat/vB) a un texto de estimacion comparando con los tiers.
        _etaText: function(rate, tiers) {
            if (!(rate > 0) || !tiers) return '';
            var f  = parseInt(tiers.fastestFee, 10)  || 0;
            var hh = parseInt(tiers.halfHourFee, 10) || 0;
            var h  = parseInt(tiers.hourFee, 10)     || 0;
            var ec = parseInt(tiers.economyFee, 10)  || 0;
            if (f  && rate >= f)  return str_release_eta_next;
            if (hh && rate >= hh) return str_release_eta_30m;
            if (h  && rate >= h)  return str_release_eta_1h;
            if (ec && rate >= ec) return str_release_eta_hours;
            return str_release_eta_slow;
        },

        // Rellena los span .nxoc-release-eta (insertados por _coopSignHtml) con la estimacion de
        // tiempo. Se llama tras pintar el trade card, junto a renderFundingQRs. Una llamada por red.
        renderReleaseEtas: function() {
            var els = document.querySelectorAll('.nxoc-release-eta[data-rate]');
            if (!els.length) return;
            var self = this;
            var byNet = {};
            for (var i = 0; i < els.length; i++) {
                var net = els[i].getAttribute('data-net') || 'mainnet';
                (byNet[net] = byNet[net] || []).push(els[i]);
            }
            Object.keys(byNet).forEach(function(net) {
                self._recommendedTiers(net).then(function(tiers) {
                    if (!tiers) return;
                    byNet[net].forEach(function(el) {
                        var txt = self._etaText(parseFloat(el.getAttribute('data-rate')) || 0, tiers);
                        if (txt) el.textContent = ' · ' + txt;
                    });
                });
            });
        },

        // ==================== FUNDING POLL ====================

        // Target de confirmaciones segun amount (spec sec 8.5).
        fundingConfirmTarget: function(satAmount) {
            var n = parseInt(satAmount, 10) || 0;
            if (n <= 100000)  return 1;
            if (n <= 1000000) return 3;
            return 6;
        },

        _fundingPollTimer:    null,
        _fundingPollInterval: 30000,
        _fundingTickerTimer:  null,

        // Tick cada 1s para refrescar el "detectado hace X" sin re-renderizar todo el trade card.
        // Solo toca textContent de los span con data-since presentes en el DOM.
        startFundingTicker: function() {
            if (this._fundingTickerTimer) return;
            this._fundingTickerTimer = setInterval(function() {
                var els = document.querySelectorAll('.nxoc-funding-elapsed[data-since]');
                if (!els.length) return;
                if (typeof MostroTrader === 'undefined' || !MostroTrader._relTime) return;
                for (var i = 0; i < els.length; i++) {
                    var since = parseInt(els[i].getAttribute('data-since'), 10) || 0;
                    if (!since) continue;
                    var raw = MostroTrader._relTime(since) || '';
                    els[i].textContent = raw.replace(/^hace\s+/i, '');
                }
            }, 1000);
        },

        // Arranca el loop global. Idempotente: si ya hay timer, no hace nada.
        startFundingPolling: function() {
            if (this._fundingPollTimer) return;
            var self = this;
            this._fundingPollTimer = setInterval(function() { self._fundingPollTick(); }, this._fundingPollInterval);
            // Tick inmediato para no esperar al primer intervalo.
            setTimeout(function() { self._fundingPollTick(); }, 1500);
            _log('UI.startFundingPolling: timer started (every ' + this._fundingPollInterval + 'ms)');
        },

        // Recorre los trades onchain con direccion ya verificada y dispara verify_funding para
        // refrescar confs. Stops cuando se alcanzan suficientes confirmaciones "seguras" — no en
        // target estricto, asi la UI sigue actualizando el contador unos bloques mas para que se
        // vea vivo. Cap a 6 confs (umbral de "settled" universal) para no machacar la API.
        // Re-deriva la dirección Taproot desde las trade pubkeys + arbitros (todo persistido en BD)
        // y la compara con la taproot_address guardada. Si coincide, el escrow es self-consistente
        // y damos la dirección por verificada sin necesidad del address_check del peer. Esto cierra
        // el agujero cross-device: en otro ordenador _addressVerified arranca en false y el peer
        // address_check puede no re-recibirse (>24h fuera de 'since'), dejando al taker sin avisos
        // de funding. La detección de funding en sí sigue siendo on-chain (verify_funding), que es
        // la fuente autoritativa.
        _selfVerifyAddress: async function(trade) {
            if (!trade) return false;
            if (trade._addressVerified) return true;
            if (_readMeta(trade).peer_address_verified !== true) return false;
            if (trade._addressMismatch) return false;
            if (trade._selfVerifyInFlight) return false;
            var stored = String(trade.taproot_address || '').trim();
            if (!stored || !Taproot || !Taproot.buildDetails) return false;
            var keys = this.fundingKeys(trade);
            var arbs = this.arbitrators(trade);
            if (!keys || arbs.length !== 3) return false;
            trade._selfVerifyInFlight = true;
            try {
                var details = await Taproot.buildDetails(keys.seller, keys.buyer, arbs, _tradeNetwork(trade));
                if (details && String(details.address) === stored) {
                    trade._addressVerified = true;
                    trade._addressMismatch = false;
                    return true;
                }
                _warn('selfVerifyAddress: derived address != stored', { orderId: (trade.order_id || '').slice(0, 8) });
                return false;
            } catch(e) {
                _warn('selfVerifyAddress failed', e);
                return false;
            } finally {
                trade._selfVerifyInFlight = false;
            }
        },

        _fundingPollTick: async function() {
            if (typeof MostroTrader === 'undefined' || !MostroTrader._trades) return;
            var orderIds = Object.keys(MostroTrader._trades);
            for (var i = 0; i < orderIds.length; i++) {
                var t = MostroTrader._trades[orderIds[i]];
                if (!t || t.method !== 'onchain' || _isArchivedTrade(t)) continue;
                // No mezclar cadenas: solo trades de la red activa.
                if (_tradeNetwork(t) !== _activeNetwork()) continue;
                // Liberacion: si el trade ya tiene material de firma cooperativa (en cualquier estado:
                // firmando, fiat_received, o completado), detectar/confirmar la TX de gasto en la red.
                // Cubre que la difunda quien la difunda (boton, peer o manual) y refresca confirmaciones.
                var _cm = _readMeta(t);
                if (t.internal_status === 'completado') {
                    if ((parseInt(_cm.release_confirmations, 10) || 0) < 6) await this._refreshReleaseTx(t);
                    continue;
                }
                if (_cm.coop_signed_tx || _cm.coop_txid || _cm.release_txid) { await this._refreshReleaseTx(t); continue; }
                if (t.internal_status !== 'aceptado') continue;
                if (!t.taproot_address) continue;
                // _addressVerified es solo en memoria: tras reload o login en otro dispositivo se
                // pierde. Si no está, intentamos auto-verificar re-derivando la dirección localmente
                // (self-consistente: no depende de volver a recibir el address_check del peer, que
                // puede haber caído fuera de la ventana 'since' de la suscripción).
                if (!t._addressVerified) {
                    var selfOk = await this._selfVerifyAddress(t);
                    if (!selfOk) continue;
                }
                var target = this.fundingConfirmTarget(parseInt(t.sat_amount, 10) || 0);
                var stopAt = Math.max(target, 6);
                if (t.funding_txid && (parseInt(t.confirmations, 10) || 0) >= stopAt) continue;
                await this._checkFundingFor(t);
            }
        },

        // Detecta/confirma la TX de gasto (liberacion / recovery / arbitraje) on-chain. Consulta
        // tx_status y:
        //   - encontrada con >=1 confirmacion -> cierra a 'completado' (terminal de verdad).
        //   - encontrada en mempool (0 conf)  -> registra release_seen, refresca confs, NO cierra.
        //   - NO encontrada habiendo difundido (release_txid) y sin confirmar -> tras varios intentos
        //     asume que la TX se cayo del mempool sin confirmar: limpia release_txid + marca dropped
        //     para que la ficha vuelva a ofrecer "Difundir". Evita dar por liberado un escrow intacto.
        // Reconoce la TX la difunda quien la difunda (boton, peer o manual). Idempotente.
        _refreshReleaseTx: async function(trade) {
            if (!trade || trade._releaseCheckInFlight) return;
            var meta = _readMeta(trade);
            var hasBroadcast = /^[0-9a-f]{64}$/.test(String(meta.release_txid || ''));
            var txid = String(meta.release_txid || meta.coop_txid || '');
            // Solo recalculamos desde el tx firmado si nunca difundimos y no esta marcado como caido
            // (si esta dropped, hay que volver a pulsar Difundir, no auto-resucitar el txid viejo).
            if (!/^[0-9a-f]{64}$/.test(txid) && !parseInt(meta.release_dropped, 10) && meta.coop_signed_tx && parseInt(meta.coop_fee_sats, 10) > 0) {
                try {
                    var coop = await Spend.buildCooperative(trade, parseInt(meta.coop_fee_sats, 10));
                    txid = await _txidFromLegacyHex(coop.tx_hex);
                } catch(e) { return; }
            }
            if (!/^[0-9a-f]{64}$/.test(txid)) return;
            trade._releaseCheckInFlight = true;
            try {
                var resp = await _ajax('tx_status', { txid: txid, network: _tradeNetwork(trade) });
                if (resp && resp.ok && resp.found) {
                    trade._releaseMissCount = 0;
                    var confs = parseInt(resp.confirmations, 10) || 0;
                    var becameComplete = confs >= 1 && trade.internal_status !== 'completado';
                    var prevConfs = parseInt(meta.release_confirmations, 10) || 0;
                    var needSave = becameComplete || confs !== prevConfs || meta.release_txid !== txid
                        || meta.coop_txid !== txid || !parseInt(meta.release_seen, 10);
                    if (!needSave) return;
                    var patch = { release_txid: txid, coop_txid: txid, release_confirmations: confs, release_seen: 1, release_dropped: 0 };
                    await this._saveCoop(trade, patch, becameComplete ? 'completado' : null);
                    if (becameComplete && typeof notify === 'function') notify(str_coop_completed, 'success', 0);
                    return;
                }
                // No encontrada. Solo es senal de "caida" si realmente difundimos y aun no confirmamos.
                if (!hasBroadcast || trade.internal_status === 'completado') return;
                // El sondeo no la ve en la red: reflejarlo (release_seen=0) para que reaparezca el boton
                // Re-difundir de inmediato, sin esperar al umbral de rebroadcast automatico.
                if (parseInt(meta.release_seen, 10)) { await this._saveCoop(trade, { release_seen: 0 }); }
                trade._releaseMissCount = (trade._releaseMissCount || 0) + 1;
                if (trade._releaseMissCount < _RELEASE_DROP_MISSES) return;
                trade._releaseMissCount = 0;
                // No declaramos "caida" a ciegas: reenviamos el tx firmado para averiguar el motivo REAL.
                // testnet evicta TX sin confirmar (fee bajo / reset de mempool) y al reenviarla vuelve a
                // entrar; si el nodo la rechaza, su mensaje es la causa (input ya gastado, fee insuficiente,
                // ya confirmada en otro sitio...). Asi el usuario ve el porque, no un generico "se perdio".
                var signedHex = String(meta.coop_signed_tx || '');
                if (!signedHex) {
                    await this._saveCoop(trade, { release_txid: '', release_dropped: 1 });
                    if (typeof notify === 'function') notify(str_release_dropped_warn, 'warning', 16000);
                    return;
                }
                var rb;
                try { rb = await _ajax('broadcast_tx', { tx_hex: signedHex, network: _tradeNetwork(trade) }); }
                catch(e) { return; }   // fallo de red transitorio: reintentamos en el siguiente poll
                if (rb && rb.ok && /^[0-9a-f]{64}$/.test(String(rb.txid || ''))) {
                    // Re-entro en el mempool: eviccion transitoria de testnet, no una caida real.
                    await this._saveCoop(trade, { release_txid: String(rb.txid), coop_txid: String(rb.txid),
                        release_seen: 1, release_dropped: 0, release_drop_reason: '', release_broadcast_at: Math.floor(Date.now() / 1000) });
                    if (typeof notify === 'function') notify(str_release_rebroadcast, 'info', 12000);
                    return;
                }
                // El nodo rechaza la TX: su mensaje es el motivo real.
                var why = String((rb && rb.msg) || '').trim();
                await this._saveCoop(trade, { release_txid: '', release_dropped: 1, release_drop_reason: why });
                if (typeof notify === 'function') notify(t(str_release_dropped_reason, why || '—'), 'warning', 0);
            } catch(e) { _warn('refreshReleaseTx', e); }
            finally { trade._releaseCheckInFlight = false; }
        },

        // Una verificacion concreta para un trade. Side-effects: persiste funding_txid/vout/block
        // y confirmaciones en BD; vendedor publica kind 39389 la primera vez que detecta el deposito.
        _checkFundingFor: async function(trade) {
            if (!trade || trade._fundingCheckInFlight) return;
            if (!trade.taproot_address) return;
            // El vendedor deposita sat_amount + la comision completa del arbitro. verify_funding hace
            // match exacto, asi que el target debe incluir esa comision o nunca daria por fondeado.
            var expected = _fundingTargetSats(trade);
            if (expected <= 0) return;
            trade._fundingCheckInFlight = true;
            try {
                var resp = await _ajax('verify_funding', {
                    address:       trade.taproot_address,
                    expected_sats: expected,
                    network:       _tradeNetwork(trade)
                });
                if (!resp || resp.error || !resp.ok) return;
                // Caso "hay deposito pero con cantidad incorrecta": pintamos aviso explicito.
                if (!resp.found && resp.amount_mismatch) {
                    var receivedNow = parseInt(resp.received_sats, 10) || 0;
                    var changed = !trade._fundingAmountMismatch
                                  || (parseInt(trade._fundingReceivedSats, 10) || 0) !== receivedNow;
                    trade._fundingAmountMismatch = true;
                    trade._fundingReceivedSats   = receivedNow;
                    if (changed && window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                    return;
                }
                // No hay deposito ni mismatch: limpiamos cualquier aviso previo (caso recuperacion).
                if (!resp.found) {
                    if (trade._fundingAmountMismatch) {
                        trade._fundingAmountMismatch = false;
                        trade._fundingReceivedSats   = 0;
                        if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
                    }
                    return;
                }
                // Match. Si veniamos de un mismatch, limpiar el aviso.
                if (trade._fundingAmountMismatch) {
                    trade._fundingAmountMismatch = false;
                    trade._fundingReceivedSats   = 0;
                }

                var newTxid  = String(resp.txid || '');
                var newVout  = parseInt(resp.vout, 10) || 0;
                var newConfs = parseInt(resp.confirmations, 10) || 0;
                var newBlock = parseInt(resp.block_height, 10) || 0;

                var changed = false;
                if (String(trade.funding_txid || '') !== newTxid) {
                    // Primera deteccion: marcar timestamp para el "hace X" en la UI.
                    if (!trade.funding_txid && !trade._fundingDetectedAt) {
                        trade._fundingDetectedAt = Math.floor(Date.now() / 1000);
                    }
                    trade.funding_txid = newTxid;
                    trade.funding_vout = newVout;
                    changed = true;
                }
                if ((parseInt(trade.confirmations, 10) || 0) !== newConfs) {
                    trade.confirmations = newConfs;
                    changed = true;
                }
                if ((parseInt(trade.funding_block, 10) || 0) !== newBlock) {
                    trade.funding_block = newBlock;
                    changed = true;
                }
                // Valor real del UTXO escrow (lo necesita el gasto cooperativo para el sighash).
                // Se persiste en trade_json para sobrevivir recargas.
                var newValue = parseInt(resp.value_sats, 10) || 0;
                var mergedJson = null;
                if (newValue > 0 && parseInt(_readMeta(trade).funding_value, 10) !== newValue) {
                    mergedJson = _mergeMeta(trade, { funding_value: newValue });
                    trade.trade_json = mergedJson;
                    changed = true;
                }
                if (!changed) return;

                if (window.MostroTrader && MostroTrader._ajax) {
                    var fields = {
                        funding_txid:  newTxid,
                        funding_vout:  newVout,
                        funding_block: newBlock,
                        confirmations: newConfs
                    };
                    if (mergedJson) fields.trade_json = mergedJson;
                    await MostroTrader._ajax('mostro_trade_update', {
                        order_id: trade.order_id,
                        fields: fields
                    });
                }
                // Vendedor: anuncia publicamente la primera vez que detecta el deposito.
                if (parseInt(trade.is_seller, 10) && !trade._fundingCommitmentPublished
                    && Trader && Trader.publishFundingCommitment) {
                    try { await Trader.publishFundingCommitment(trade); }
                    catch(e) { _warn('publishFundingCommitment failed', e); }
                }
                if (window.MostroTrader && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
            } catch(e) {
                _warn('UI._checkFundingFor: error', e);
            } finally {
                trade._fundingCheckInFlight = false;
            }
        }
    };

    // ==================== EXPOSE ====================

    // Helper de consola para verificar el criterio de 2.3: ambos navegadores deben obtener el mismo
    // sighash/tx_hex para el mismo trade y feeSats. Uso: await Onchain.debugCoopSpend('<orderId>', 500)
    async function debugCoopSpend(orderId, feeSats) {
        var trade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
        if (!trade) { console.warn('[Onchain] debugCoopSpend: trade no encontrado', orderId); return null; }
        var res = await Spend.buildCooperative(trade, feeSats);
        console.log('[Onchain] coop spend', {
            sighash: res.sighash, tx_hex: res.tx_hex, prev_value: res.prev_value,
            buyer_value: res.buyer_value, arb_fee: res.arb_fee, fee_sats: res.fee_sats, outputs: res.outputs
        });
        return res;
    }

    // Self-test del wrapper Schnorr (BIP340): firma un sighash dummy con una clave aleatoria y
    // comprueba que verify acepta la firma buena y rechaza un mensaje distinto. Uso: await Onchain.debugSchnorr()
    async function debugSchnorr() {
        var priv = _bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        var pub  = nobleSecp256k1.schnorr.getPublicKey(priv);
        if (typeof pub !== 'string') pub = _bytesToHex(pub);
        var msg  = _bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        var sig  = await Schnorr.sign(msg, priv);
        var ok   = await Schnorr.verify(sig, msg, pub);
        var other = _bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        var bad  = await Schnorr.verify(sig, other, pub);
        var pass = (ok === true && bad === false && sig.length === 128);
        console.log('[Onchain] debugSchnorr', { sig: sig, verify_ok: ok, verify_tampered: bad, pass: pass });
        return pass;
    }

    // Self-test del gasto por hoja de ARBITRAJE. Se ejecuta en la instancia del GANADOR (usa su
    // trade_privkey) y se le pasa la privkey del arbitro para simular el DM arb_signature, ensamblando
    // la TX final para difundirla a mano en testnet (igual que validamos el cooperativo).
    // Uso: await Onchain.debugArbSpend('<orderId>', 'buyer'|'seller', 1, 400, '<arbPrivHex>')
    async function debugArbSpend(orderId, winnerSide, arbIndex, feeSats, arbPrivHex) {
        var trade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
        if (!trade) { console.warn('[Onchain] debugArbSpend: trade no encontrado', orderId); return null; }
        if (!/^[a-f0-9]{64}$/i.test(String(arbPrivHex || ''))) { console.warn('[Onchain] debugArbSpend: arbPrivHex (64 hex) requerido'); return null; }
        var arb = await Spend.buildArbitration(trade, winnerSide, arbIndex, feeSats);
        var winnerSig = await Schnorr.sign(arb.sighash, trade.trade_privkey);   // la instancia debe ser la del ganador
        var arbSig    = await Schnorr.sign(arb.sighash, String(arbPrivHex));
        var signed    = Spend.assembleArbitration(arb, winnerSig, arbSig);
        console.log('[Onchain] arb spend', {
            leaf_index: arb.leaf_index, csv: arb.csv, winner_side: arb.winner_side, arb_index: arb.arb_index,
            winner_value: arb.winner_value, arb_fee: arb.arb_fee, fee_sats: arb.fee_sats,
            sighash: arb.sighash, signed_tx: signed
        });
        return { arb: arb, signed_tx: signed };
    }

    // Devuelve la privkey Bitcoin del arbitro por defecto (BIP86 indice 0, la que el dialog de registro
    // pre-rellena como pubkey_btc). SOLO para validar debugArbSpend en testnet: se ejecuta en la
    // instancia del arbitro, devuelve la privkey y loguea el pubkey para confirmar que coincide con el
    // arbitro del trade. NO compartir esta clave. Requiere Keys desbloqueado. idx por si usaste otro indice.
    async function debugArbPrivkey(idx) {
        if (!Keys.isUnlocked()) { console.warn('[Onchain] Keys bloqueado: Onchain.Keys.unlock() primero'); return null; }
        idx = parseInt(idx, 10) || 0;
        var priv = await Bip86.deriveCurrentTradeKey(idx);
        console.log('[Onchain] arb key BIP86 idx ' + idx + ' -> pubkey_btc:', Bip86.privkeyToTradePubkey(priv));
        return priv;
    }

    // Self-test del gasto de RECOVERY. Se ejecuta en la instancia del VENDEDOR (usa su trade_privkey).
    // Construye + firma + ensambla la TX para inspeccionarla. OJO: el broadcast lo rechaza el nodo
    // ('non-BIP68-final') hasta que el funding tenga 4320 confirmaciones; eso confirma que el CSV se
    // enforce. Requiere seller_payout_address en trade_json (o setéala antes en Mis trades / recoverFunds).
    // Uso: await Onchain.debugRecoverySpend('<orderId>', 400)
    async function debugRecoverySpend(orderId, feeSats) {
        var trade = (typeof MostroTrader !== 'undefined' && MostroTrader._trades) ? MostroTrader._trades[orderId] : null;
        if (!trade) { console.warn('[Onchain] debugRecoverySpend: trade no encontrado', orderId); return null; }
        var rec = await Spend.buildRecovery(trade, feeSats);
        var sig = await Schnorr.sign(rec.sighash, trade.trade_privkey);
        var signed = Spend.assembleRecovery(rec, sig);
        console.log('[Onchain] recovery spend', {
            leaf_index: rec.leaf_index, csv: rec.csv, seller_value: rec.seller_value, fee_sats: rec.fee_sats,
            sighash: rec.sighash, signed_tx: signed
        });
        return { rec: rec, signed_tx: signed };
    }

    function getNetwork() { return _activeNetwork(); }
    function setNetwork(net) {
        var n = _normalizeNetwork(net);
        Config.network = n;
        try { localStorage.setItem(_NET_LS_KEY, n); } catch(e) {}
        _log('setNetwork:', n);
        // Refrescar orderbook (filtra por red) y Mis trades (badge/guard por red).
        try {
            if (typeof MostroBook !== 'undefined' && MostroBook.render) MostroBook.render();
            if (typeof MostroTrader !== 'undefined' && MostroTrader.renderMyTrades) MostroTrader.renderMyTrades();
        } catch(e) {}
        return n;
    }

    // ==================== REPUTACION DE TRADER (kind 39384, role=trader) ====================
    // Version "ligera": cuenta una valoracion solo si el valorador fue REALMENTE la contraparte del
    // trade, cruzando contra el evento publico `accept` (kind 39385) de ese order_id. El accept lo
    // firma el maker y etiqueta al taker, asi que {firmante, taker} son las dos identidades del trade.
    // Una valoracion de un tercero, o sobre una orden sin accept publico, NO se cuenta. NO verifica el
    // funding on-chain aqui (eso es la auditoria detallada, openAudit); solo el cruce de eventos.
    var Reputation = {
        _cache: {},   // makerPubkey -> { count, sum, avg, firstAt, lastAt, ratings:[], _complete, _inflight, _cbs }

        get: function (maker) {
            return this._cache[String(maker || '').toLowerCase()] || null;
        },

        fetch: function (maker, done) {
            maker = String(maker || '').toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(maker) || !Config.pool) { if (done) done(null); return; }
            var cached = this._cache[maker];
            if (cached && cached._complete) { if (done) done(cached); return; }
            if (cached && cached._inflight) { if (done) cached._cbs.push(done); return; }

            var rep = { count: 0, sum: 0, avg: 0, firstAt: 0, lastAt: 0, ratings: [],
                        _complete: false, _inflight: true, _cbs: done ? [done] : [], _seen: {} };
            this._cache[maker] = rep;
            var self = this;
            var since = Math.floor(Date.now() / 1000) - 365 * 86400;
            var ratingEvs = [];

            // Fase 1: valoraciones recibidas por el maker.
            var sub1 = Config.pool.subscribe(
                [{ kinds: [Config.KIND_RATING], '#y': [Config.Y_TAG], '#p': [maker], since: since, limit: 300 }],
                async function (ev) {
                    if (!ev || rep._seen[ev.id]) return;
                    if (!(await _verifyProtocolEvent(ev, 8))) return;
                    rep._seen[ev.id] = true;
                    if ((_getTagValue(ev, 'role') || 'trader').toLowerCase() !== 'trader') return;
                    if (String(ev.pubkey).toLowerCase() === maker) return;   // no auto-valoracion
                    ratingEvs.push(ev);
                },
                function () {}
            );
            setTimeout(function () {
                if (Config.pool) Config.pool.unsubscribe(sub1);
                self._crossCheck(maker, rep, ratingEvs);
            }, 3000);
        },

        _crossCheck: function (maker, rep, ratingEvs) {
            var self = this;
            if (!ratingEvs.length) { this._finalize(rep); return; }
            // Una valoracion por (order_id, valorador): nos quedamos la mas reciente.
            var byKey = {}, orderIds = [];
            ratingEvs.forEach(function (ev) {
                var orderId = _eventOrderId(ev);
                if (!orderId) return;
                var key = orderId + '|' + String(ev.pubkey).toLowerCase();
                if (!byKey[key] || byKey[key].created_at < ev.created_at) byKey[key] = ev;
                if (orderIds.indexOf(orderId) === -1) orderIds.push(orderId);
            });
            // Fase 2: cualquier evento 39385 de esas ordenes. Una valoracion cuenta solo si TANTO el
            // valorado (maker) como el valorador han FIRMADO algun 39385 de la orden: prueba criptografica
            // de que ambos fueron las dos partes (mas fuerte que el tag 'taker' del accept, que es un
            // claim). Sirve cualquier accion (address_check, fiat_*, buyer_payout, complete, accept): el
            // accept a menudo no sobrevive en los relays, pero address_check/fiat/complete suelen estar.
            var orders = {}, seen2 = {};
            var sub2 = Config.pool.subscribe(
                [{ kinds: [Config.KIND_TRADE_STATE], '#y': [Config.Y_TAG], '#order_id': orderIds, limit: 800 }],
                async function (ev) {
                    if (!ev || seen2[ev.id]) return;
                    if (!(await _verifyProtocolEvent(ev, 12))) return;
                    seen2[ev.id] = true;
                    var oid = _eventOrderId(ev);
                    if (!oid || orderIds.indexOf(oid) === -1) return;
                    if (!orders[oid]) orders[oid] = { signers: {}, satAmount: 0, fiatAmount: '' };
                    var o = orders[oid];
                    o.signers[String(ev.pubkey).toLowerCase()] = true;
                    var sa = parseInt(_getTagValue(ev, 'sat_amount'), 10) || 0;
                    if (sa > 0 && !o.satAmount) o.satAmount = sa;
                    var fa = _getTagValue(ev, 'fiat_amount') || '';
                    if (fa && !o.fiatAmount) o.fiatAmount = fa;
                },
                function () {}
            );
            setTimeout(function () {
                if (Config.pool) Config.pool.unsubscribe(sub2);
                Object.keys(byKey).forEach(function (key) {
                    var ev = byKey[key];
                    var orderId = key.split('|')[0];
                    var rater = String(ev.pubkey).toLowerCase();
                    var o = orders[orderId];
                    if (!o) return;                                     // sin eventos publicos: no contable
                    if (maker === rater) return;                        // no auto-valoracion
                    if (!o.signers[maker] || !o.signers[rater]) return; // ambos deben haber firmado un 39385
                    var stars = parseInt(_getTagValue(ev, 'stars'), 10);
                    if (!(stars >= 1 && stars <= 5)) return;
                    rep.count++;
                    rep.sum += stars;
                    if (!rep.firstAt || ev.created_at < rep.firstAt) rep.firstAt = ev.created_at;
                    if (ev.created_at > rep.lastAt) rep.lastAt = ev.created_at;
                    rep.ratings.push({
                        rater:       rater,
                        orderId:     orderId,
                        stars:       stars,
                        at:          ev.created_at,
                        satAmount:   o.satAmount,
                        fiatAmount:  o.fiatAmount,
                        fundingTxid: _getTagValue(ev, 'funding_txid') || '',
                        tradeId:     _getTagValue(ev, 'trade_id') || ''
                    });
                });
                rep.avg = rep.count ? (rep.sum / rep.count) : 0;
                rep.ratings.sort(function (a, b) { return b.at - a.at; });
                self._finalize(rep);
            }, 3000);
        },

        _finalize: function (rep) {
            rep._complete = true;
            rep._inflight = false;
            var cbs = rep._cbs || [];
            rep._cbs = [];
            cbs.forEach(function (cb) { try { cb(rep); } catch (e) {} });
        },

        // Señales heuristicas para detectar perfiles sospechosos (auto-trading / inflado de reputacion).
        _signals: function (rep) {
            var out = [];
            if (!rep || !rep.count) return out;
            // 1. Concentracion de contraparte: si una sola identidad emite >40% de las valoraciones.
            var byRater = {};
            rep.ratings.forEach(function (r) { byRater[r.rater] = (byRater[r.rater] || 0) + 1; });
            var maxRater = 0, raters = Object.keys(byRater);
            raters.forEach(function (k) { if (byRater[k] > maxRater) maxRater = byRater[k]; });
            if (rep.count >= 3 && maxRater / rep.count > 0.4) {
                out.push({ level: 'warn', text: 'Una sola contraparte concentra ' + maxRater + ' de ' + rep.count + ' valoraciones (posible auto-trading).' });
            }
            if (raters.length === 1 && rep.count >= 2) {
                out.push({ level: 'bad', text: 'Todas las valoraciones vienen de la MISMA contraparte.' });
            }
            // 2. Rafagas: valoraciones muy juntas en el tiempo (mediana de hueco < 1h con >=3 ratings).
            if (rep.count >= 3) {
                var ts = rep.ratings.map(function (r) { return r.at; }).sort(function (a, b) { return a - b; });
                var gaps = [];
                for (var i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
                gaps.sort(function (a, b) { return a - b; });
                var medGap = gaps[Math.floor(gaps.length / 2)] || 0;
                if (medGap < 3600) out.push({ level: 'warn', text: 'Valoraciones en rafaga (hueco mediano ' + Math.round(medGap / 60) + ' min): patron poco natural.' });
            }
            // 3. Importes minimos: si la media de sats esta cerca del dust, son trades baratos de fabricar.
            var amounts = rep.ratings.map(function (r) { return r.satAmount; }).filter(function (s) { return s > 0; });
            if (amounts.length) {
                var avgSats = amounts.reduce(function (a, b) { return a + b; }, 0) / amounts.length;
                if (avgSats > 0 && avgSats < 3 * _DUST_SATS) {
                    out.push({ level: 'warn', text: 'Importe medio muy bajo (' + Math.round(avgSats).toLocaleString() + ' sats): trades baratos de simular.' });
                }
            }
            // 4. Cuenta joven con muchas valoraciones de golpe.
            if (rep.firstAt && rep.lastAt && rep.count >= 5) {
                var spanDays = (rep.lastAt - rep.firstAt) / 86400;
                if (spanDays < 2) out.push({ level: 'warn', text: rep.count + ' valoraciones en menos de 2 dias.' });
            }
            return out;
        },

        // Auditoria detallada (la "opcion de auditar"): resumen + señales + tabla de valoraciones.
        // La verificacion on-chain del funding_txid (cruzar contra la cadena) queda como TODO estricto.
        openAudit: function (maker) {
            var self = this;
            maker = String(maker || '').toLowerCase();
            var render = function (rep) {
                var name = (Config.profiles && Config.profiles.displayName) ? (Config.profiles.displayName(maker) || '') : '';
                var head = '<div style="font-size:0.85em;color:#888;margin-bottom:6px">' +
                    (name ? _escHtml(name) + ' · ' : '') + '<code>' + maker.slice(0, 12) + '…' + maker.slice(-8) + '</code></div>';
                if (!rep || !rep._complete) return head + '<p>' + str_oc_computing_reputation + '</p>';
                if (!rep.count) return head + '<p>Sin valoraciones verificables (ninguna ligada a un accept publico de las dos partes).</p>';
                var first = rep.firstAt ? new Date(rep.firstAt * 1000).toISOString().slice(0, 10) : '?';
                var last  = rep.lastAt ? new Date(rep.lastAt * 1000).toISOString().slice(0, 10) : '?';
                var spanD = (rep.firstAt && rep.lastAt) ? Math.round((rep.lastAt - rep.firstAt) / 86400) : 0;
                var summary = '<div style="margin-bottom:10px">' +
                    '<strong>' + rep.avg.toFixed(2) + ' ★</strong> · ' + rep.count + ' valoraciones verificadas · ' +
                    'primera ' + first + ' · ultima ' + last + ' · activo ' + spanD + ' dias</div>';
                var sigs = self._signals(rep);
                var sigsHtml = sigs.length
                    ? '<div style="margin-bottom:10px">' + sigs.map(function (s) {
                        var col = s.level === 'bad' ? '#c62828' : '#b8860b';
                        return '<div style="color:' + col + ';font-size:0.85em">⚠ ' + _escHtml(s.text) + '</div>';
                      }).join('') + '</div>'
                    : '<div style="color:#2e7d32;font-size:0.85em;margin-bottom:10px">✓ Sin señales de patron sospechoso.</div>';
                var rows = rep.ratings.map(function (r) {
                    var d = new Date(r.at * 1000).toISOString().slice(0, 10);
                    var amt = r.satAmount ? r.satAmount.toLocaleString() + ' sats' : '?';
                    var tx = r.fundingTxid ? '<a href="' + _explorerTxUrl(getNetwork(), r.fundingTxid) + '" target="_blank" rel="noopener">' + r.fundingTxid.slice(0, 8) + '…</a>' : '—';
                    return '<tr>' +
                        '<td>' + r.stars + '★</td>' +
                        '<td><code>' + r.rater.slice(0, 8) + '…</code></td>' +
                        '<td>' + _escHtml(d) + '</td>' +
                        '<td>' + _escHtml(amt) + '</td>' +
                        '<td><code>' + _escHtml(String(r.orderId).slice(0, 8)) + '…</code></td>' +
                        '<td>' + tx + '</td>' +
                    '</tr>';
                }).join('');
                var table = '<table class="nxoc-audit-table" style="width:100%;border-collapse:collapse;font-size:0.8em">' +
                    '<thead><tr><th>★</th><th>' + str_counterparty + '</th><th>' + str_oc_date + '</th><th>' + str_oc_amount + '</th><th>' + str_oc_order + '</th><th>' + str_oc_funding + '</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody></table>';
                return head + summary + sigsHtml + table +
                    '<p style="font-size:0.75em;color:#999;margin-top:8px">' + str_oc_rating_verification_note + '</p>';
            };
            $('body').dialog({
                title:   'Auditoria de reputacion',
                type:    'html',
                width:   '640px',
                content: '<div id="nxoc-audit-body">' + render(this.get(maker)) + '</div>',
                buttons: [{ text: 'Cerrar', class: 'btn', action: function (_e, overlay) { try { document.body.removeChild(overlay); } catch (e) {} } }]
            });
            this.fetch(maker, function (rep) {
                var body = document.getElementById('nxoc-audit-body');
                if (body) body.innerHTML = render(rep);
            });
        }
    };

    window.Onchain = {
        init:        init,
        Config:      Config,
        Book:        Book,
        Trader:      Trader,
        Arbitrators: Arbitrators,
        Reputation:  Reputation,
        Keys:        Keys,
        Bip86:       Bip86,
        Taproot:     Taproot,
        Spend:       Spend,
        Schnorr:     Schnorr,
        PowMiner:    PowMiner,
        UI:          UI,
        getNetwork:  getNetwork,
        setNetwork:  setNetwork,
        debugCoopSpend: debugCoopSpend,
        debugSchnorr: debugSchnorr,
        debugArbSpend: debugArbSpend,
        debugArbPrivkey: debugArbPrivkey,
        debugRecoverySpend: debugRecoverySpend,
        NETWORKS:    _NETWORKS.slice(),
        networkHrp:  _networkHrp,
        tradeNetwork: _tradeNetwork,
        addressMatchesNetwork: _addressMatchesNetwork
        ,hydrateTrade: _hydrateTradeKey
        ,hydrateTrades: _hydrateTrades
        ,verifyEvent: _verifyProtocolEvent
    };

})();
