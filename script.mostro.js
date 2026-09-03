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
    async function _bip39Seed(mnemonic, passphrase) {
        var enc = new TextEncoder();
        var key = await crypto.subtle.importKey('raw', enc.encode(mnemonic.normalize('NFKD')), 'PBKDF2', false, ['deriveBits']);
        var bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode('mnemonic' + String(passphrase || '').normalize('NFKD')), iterations: 2048, hash: 'SHA-512' },
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

    // Trazas de muy alta frecuencia (un mensaje por evento, render o escritura). Se separan del
    // debug normal para que una auditoría puntual no convierta la consola en un volcado del replay.
    function _mostroTraceEnabled() {
        try {
            if (window.NOXTR_DEBUG_VERBOSE === true) return true;
            return localStorage.getItem('noxtr_debug_verbose') === '1';
        } catch(e) {
            return false;
        }
    }

    function _mostroTrace() {
        if (!_mostroTraceEnabled()) return;
        console.debug.apply(console, arguments);
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

    // ==================== MOSTRO EVENT HELPERS ====================

    async function _sha256hex(str) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return _bytesToHex(new Uint8Array(buf));
    }

    // NIP-13: count leading zero bits in a hex event id
    function _countLeadingZeroBits(hexStr) {
        var bits = 0;
        for (var i = 0; i < hexStr.length; i++) {
            var n = parseInt(hexStr[i], 16);
            if (n === 0) { bits += 4; continue; }
            if (n < 2)  { bits += 3; } else
            if (n < 4)  { bits += 2; } else
            if (n < 8)  { bits += 1; }
            break;
        }
        return bits;
    }

    // NIP-13: mine PoW on an unsigned event (adds/updates nonce tag, sets ev.id)
    async function _minePoW(ev, difficulty) {
        if (!difficulty || difficulty <= 0) return ev;
        var nonce = 0;
        var nonceIdx = ev.tags.findIndex(function(t) { return t[0] === 'nonce'; });
        while (true) {
            if (nonceIdx === -1) {
                ev.tags.push(['nonce', String(nonce), String(difficulty)]);
                nonceIdx = ev.tags.length - 1;
            } else {
                ev.tags[nonceIdx][1] = String(nonce);
            }
            var id = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            if (_countLeadingZeroBits(id) >= difficulty) {
                ev.id = id; // pre-set so _signEventWith doesn't need to recompute
                return ev;
            }
            nonce++;
        }
    }

    // NIP-13: get required PoW difficulty from relay NIP-11 documents
    function _powDifficulty() { return Noxtr.Pool.maxPowDifficulty(); }

    // NIP-13: get PoW difficulty required by a specific robot (from its kind 38385 status event)
    function _robotPowDifficulty(robotPubkeyHex) {
        if (!robotPubkeyHex || !MostroBook) return 0;
        var d = MostroBook._robotPow[robotPubkeyHex];
        return (isFinite(d) && d > 0) ? d : 0;
    }

    // NIP-13, "first contact" (spam_gate.rs del daemon, verificado leyendo el código real): un
    // trade key NUNCA visto antes por el nodo (es decir, new-order/take-* — siempre estrenan clave)
    // cae en el carril "first contact" y debe minar pow_first_contact, no el pow base. Mensajes
    // posteriores del mismo trade (add-invoice, fiat-sent, release, cancel...) usan esa misma
    // trade key, que para entonces ya es "conocida" (participante de un trade activo) → pow base.
    // El tag pow_first_contact que publica el 38385 ya viene como max(pow, pow_first_contact)
    // (nip33.rs::advertised_first_contact_pow), así que no hace falta max() aquí también.
    function _robotFirstContactPowDifficulty(robotPubkeyHex) {
        if (!robotPubkeyHex || !MostroBook) return 0;
        var d = MostroBook._robotPowFirstContact[robotPubkeyHex];
        if (isFinite(d) && d > 0) return d;
        // Sin el tag (daemon viejo, o el 38385 aún no ha llegado): no hay forma de saber el
        // valor real ni de detectar un rechazo silencioso para reintentar automáticamente, así
        // que se dobla el pow base como cobertura defensiva mientras tanto.
        var base = _robotPowDifficulty(robotPubkeyHex);
        return base > 0 ? base * 2 : 0;
    }

    // ==================== ORDEN DE PRIORIDAD DE ESTADOS ====================
    // Dos listas, NO una. Difieren en un punto y la diferencia es DELIBERADA: unificarlas
    // reintroduce dos bugs distintos, uno en cada dirección. Antes eran idénticas y estaban
    // duplicadas literalmente, que es lo que invitaba a "arreglarlo".
    //
    // La diferencia está en dónde caen 'cancelando' y 'cancelacion_solicitada' respecto de 'activo'.
    // Ambas listas se usan igual: se compara indexOf(estado actual) con indexOf(estado nuevo) y no
    // se permite retroceder.

    // Canal PÚBLICO (kind 38383) — usado por _applyPublicOrderStatus.
    // 'cancelando' y 'cancelacion_solicitada' van POR ENCIMA de 'activo' para proteger estado local
    // optimista: son peticiones que el usuario acaba de hacer y que el daemon todavía no refleja en
    // el status público (la orden se sigue publicando como in-progress). Sin esto, el primer 38383
    // que llegara después borraría de la ficha que el usuario pidió cancelar.
    // Ninguno de los dos es NUNCA el estado nuevo en esa función: el statusMap público no los
    // produce, solo aparecen como estado actual, así que subirlos no puede provocar un ascenso
    // indebido — únicamente blinda lo que ya hay.
    // Contrapartida en el canal del nodo: ver _NODE_STATUS_PRIORITY.
    var _PUBLIC_STATUS_PRIORITY = ['creado','enviando','publicado','esperando_hold_invoice','tomado','esperando_pago_vendedor','activo','cancelando','cancelacion_solicitada','fiat_enviado','liberando','completado','cancelado','disputado'];

    // Canal del NODO (kind 14, DM del daemon) — usado por _processRobotAction.
    // Aquí manda el daemon, que es la autoridad: si sigue moviendo el trade, la cancelación no
    // prosperó, y su estado debe ganar. Por eso 'cancelacion_solicitada' se queda POR DEBAJO de
    // 'activo' y no se copia el orden de _PUBLIC_STATUS_PRIORITY.
    // Subirla aquí tendría dos efectos indeseados: degradaría un trade en curso a un estado que
    // está en _noQrStatuses (le quitaría el QR de la hold invoice), y duplicaría con otra semántica
    // el workaround de _peerCancelRequested, que es justo el mecanismo que existe para no perder la
    // petición del peer sin tocar internal_status (ver su comentario, ~línea 2557).
    var _NODE_STATUS_PRIORITY = ['creado','enviando','publicado','esperando_hold_invoice','cancelando','tomado','esperando_pago_vendedor','cancelacion_solicitada','activo','fiat_enviado','liberando','completado','cancelado','disputado'];

    // Bonds anti-abuse (kind 38385): ¿el robot exige fianza para esta acción?
    // side: 'take' (tomar orden ajena) | 'make' (crear orden propia).
    function _robotRequiresBond(robotPubkeyHex, side) {
        if (!robotPubkeyHex || !MostroBook) return false;
        var b = MostroBook._robotBond[robotPubkeyHex];
        if (!b || !b.enabled) return false;
        var at = b.applyTo || 'both';
        return at === 'both' || at === side;
    }

    // Cuantía estimada de la fianza para una orden concreta, según la política publicada en el 38385
    // (bond_amount_pct / bond_base_amount_sats). Devuelve null si la instancia no publica ninguno de
    // los dos: solo los emite con las fianzas ACTIVADAS, así que su ausencia significa "no lo
    // sabemos", nunca "cero" — quien llame no debe enseñar importe en ese caso.
    // bond_base_amount_sats actúa de SUELO del porcentaje. Cuando gana el suelo (órdenes pequeñas)
    // se devuelve pct:null, porque el importe ya no sale de ese porcentaje y anunciarlo como
    // "N sats (X% del importe)" sería sencillamente falso.
    function _bondEstimate(robotPubkeyHex, orderSats) {
        if (!robotPubkeyHex || !MostroBook) return null;
        var b = MostroBook._robotBond[robotPubkeyHex];
        if (!b || !b.enabled) return null;
        var sats = parseInt(orderSats, 10) || 0;
        // compute_bond_amount (app/bond/math.rs): max(amount_pct * order_sats, base_amount_sats).
        // amount_pct es una FRACCIÓN, no un porcentaje: 0.01 = 1% (config/types.rs:47).
        // La base es un suelo, no una alternativa — con órdenes pequeñas es la que manda.
        var pctSats = (b.amountPct != null && sats > 0) ? Math.round(sats * b.amountPct) : 0;
        var baseSats = b.baseSats != null ? b.baseSats : 0;
        var bond = Math.max(pctSats, baseSats);
        if (bond <= 0) return null;
        // Solo se menciona el porcentaje si es de donde sale la cifra: cuando gana el suelo,
        // decir "(1% del importe)" contradice al número que se enseña al lado.
        var usedPct = pctSats > 0 && pctSats >= baseSats;
        return {
            sats: bond,
            pct: (usedPct && b.amountPct != null) ? Math.round(b.amountPct * 10000) / 100 : null
        };
    }

    // Texto ya localizado del aviso de fianza para una orden concreta, o '' si la instancia no exige
    // fianza para tomarla o no publica la cuantía.
    // Va DENTRO de los diálogos de tomar oferta, nunca en un notify: el notify se pinta por debajo
    // del overlay del diálogo, así que el usuario no llegaba a verlo.
    function _bondNoticeText(order) {
        if (!order || !_robotRequiresBond(order.robotPubkey, 'take')) return '';
        var est = _bondEstimate(order.robotPubkey, order.satAmount);
        if (!est) return '';
        return est.pct != null
            ? t(str_bond_estimate_pct, Number(est.sats).toLocaleString(), String(est.pct))
            : t(str_bond_estimate_base, Number(est.sats).toLocaleString());
    }

    // Flag enable_bonds: ON por defecto. noxtr paga la fianza y maneja slash/payout.
    // Para desactivarlo (volver al comportamiento previo sin soporte de bonds):
    // localStorage 'noxtr_mostro_bonds' === '0'.
    function _bondsEnabled() {
        try { return localStorage.getItem('noxtr_mostro_bonds') !== '0'; } catch(e) { return true; }
    }

    // ¿Hay que BLOQUEAR la operación por bond? Solo si la instancia lo exige Y bonds está OFF.
    function _bondsBlock(robotPubkeyHex, side) {
        return _robotRequiresBond(robotPubkeyHex, side) && !_bondsEnabled();
    }

    // ¿Instancia con transporte v1 confirmado? (protocol_version del kind 38385, tag ausente = 1,
    // verificado leyendo transport_migration.html: "Old daemons that predate the tag emit nothing;
    // treat their absence as v1"). Sin 38385 recibido aún no se bloquea (ventana de duda corta,
    // el heartbeat llega cada pocos minutos) — solo cuando ya sabemos que es v1 de verdad.
    // Auditoría 2026-08-22, hallazgo Alto: esta detección estaba documentada en CLAUDE.md pero no
    // existía en el código; se envíaba kind 14 a cualquier nodo, v1 incluido, sin aviso.
    function _robotOldProtocol(robotPubkeyHex) {
        if (!robotPubkeyHex || !MostroBook) return false;
        var v = MostroBook._robotProto[robotPubkeyHex];
        return v != null && v !== 2;
    }

    // Reputación de la CONTRAPARTE en la ficha del trade. Único dato fiable del protocolo: el tag
    // `rating` del evento 38383 de la orden (campos total_reviews, total_rating=promedio, days), que el
    // taker conoce al tomar la orden del maker. La reputación del taker hacia el maker NO la expone el
    // protocolo (confirmado por el dev de Mostro), así que NO se inventa: solo se muestra cuando hay dato.
    // Persistido en localStorage por order_id para sobrevivir recargas (la orden desaparece del book al tomarse).
    function _savePeerRep(orderId, ratingObj) {
        if (!orderId || !ratingObj) return;
        try { localStorage.setItem('noxtr_mostro_peerrep_' + orderId, JSON.stringify(ratingObj)); } catch(e) {}
    }
    function _loadPeerRep(orderId) {
        try { var s = localStorage.getItem('noxtr_mostro_peerrep_' + orderId); return s ? JSON.parse(s) : null; } catch(e) { return null; }
    }
    function _clearPeerRep(orderId) {
        try { localStorage.removeItem('noxtr_mostro_peerrep_' + orderId); } catch(e) {}
    }
    // Hold invoice pendiente del vendedor (payload de `pay-invoice`). Persistida por order_id para
    // poder reabrir su QR desde la ficha: si el usuario cierra el diálogo, el evento original no se
    // puede dar por recuperable — el replay depende de la marca de agua global
    // `noxtr_mostro_chat_since`, que cualquier evento posterior (otro trade, un mensaje de chat)
    // empuja por delante de este pay-invoice, y del backlog que conserve el relay.
    function _saveHoldInvoice(orderId, inv) {
        if (!orderId || !inv || !inv.bolt11) return;
        try { localStorage.setItem('noxtr_mostro_holdinv_' + orderId, JSON.stringify(inv)); } catch(e) {}
    }
    function _loadHoldInvoice(orderId) {
        try { var s = localStorage.getItem('noxtr_mostro_holdinv_' + orderId); return s ? JSON.parse(s) : null; } catch(e) { return null; }
    }
    function _clearHoldInvoice(orderId) {
        try { localStorage.removeItem('noxtr_mostro_holdinv_' + orderId); } catch(e) {}
    }
    // Petición de factura para cobrar una fianza slasheada (payload de `add-bond-invoice`).
    // Se persiste por la misma razón que la hold invoice, y con más motivo: si el usuario cierra el
    // diálogo y no vuelve a verlo, al agotarse `payout_claim_window_days` el daemon ejecuta
    // forfeit_bond y el nodo se queda con la fianza entera. El daemon reintenta la petición cada
    // `payout_invoice_window_seconds` (300 por defecto), pero solo la recibe quien tenga la pestaña
    // abierta en ese momento.
    function _saveBondPayout(orderId, obj) {
        if (!orderId || !obj) return;
        try { localStorage.setItem('noxtr_mostro_bondpayout_' + orderId, JSON.stringify(obj)); } catch(e) {}
    }
    function _loadBondPayout(orderId) {
        try { var s = localStorage.getItem('noxtr_mostro_bondpayout_' + orderId); return s ? JSON.parse(s) : null; } catch(e) { return null; }
    }
    function _clearBondPayout(orderId) {
        try { localStorage.removeItem('noxtr_mostro_bondpayout_' + orderId); } catch(e) {}
    }
    // ¿Sigue siendo posible que llegue un `add-bond-invoice` para este trade? Decide si hay que
    // mantener abierta la suscripción al canal del nodo aunque el trade ya esté cerrado.
    // Tres casos, de más a menos concluyente:
    //   1. Ya hay un cobro pendiente guardado → obviamente sí.
    //   2. El trade no llegó a tener fianza → no puede haber payout, nunca.
    //   3. Hubo fianza: se escucha mientras la ventana de reclamación pueda seguir abierta.
    // OJO con el 15 de reserva: es SOLO para decidir cuánto tiempo escuchar, y tira por lo largo a
    // propósito (quedarse escuchando de más no cuesta nada; dejar de escuchar de menos cuesta el
    // cobro). NO se usa jamás para decirle al usuario una fecha límite: eso sale exclusivamente del
    // tag `bond_payout_claim_window_days` que publique la instancia, y si no lo publica no se
    // muestra plazo ninguno.
    function _bondPayoutWindowOpen(trade) {
        if (!trade || !_bondsEnabled()) return false;
        var storedPayout = _loadBondPayout(trade.order_id);
        if (storedPayout && !storedPayout.inactiveAt) return true;
        if (!_isBondPaid(trade)) return false;
        var days = (MostroBook && MostroBook._robotBond && MostroBook._robotBond[trade.robot_pubkey]
                    && MostroBook._robotBond[trade.robot_pubkey].payoutClaimWindowDays) || 15;
        var closedAt = parseInt(trade.updated_at, 10) || 0;
        if (!closedAt) return false;
        return (Math.floor(Date.now() / 1000) - closedAt) < (days * 86400);
    }
    // LN address / bolt11 que el comprador tecleó al tomar la orden. Se guarda aparte de
    // _pendingInvoiceInput (que se consume y se borra al enviarla) y sobrevive a recargas, para
    // poder prerellenar el input de la ficha si hay que volver a pedirla. Nunca se usa en estado
    // 'liberando': ahí el pago anterior falló y reofrecer lo mismo volvería a fallar.
    function _saveInvoiceInput(orderId, val) {
        if (!orderId || !val) return;
        try { localStorage.setItem('noxtr_mostro_invin_' + orderId, String(val)); } catch(e) {}
    }
    function _loadInvoiceInput(orderId) {
        try { return localStorage.getItem('noxtr_mostro_invin_' + orderId) || ''; } catch(e) { return ''; }
    }
    // Ciclos de pago fallidos al comprador. Verificado contra release.rs del daemon: la instancia
    // manda `payment-failed` SOLO en el primer fallo de cada ciclo (los reintentos posteriores del
    // mismo ciclo no notifican), así que cada `payment-failed` recibido == un ciclo agotado con una
    // factura distinta. Se guardan los created_at ya vistos en vez de un contador: reprocesar el
    // histórico al recargar volvería a sumar y la cuenta se dispararía.
    function _addPayFailCycle(orderId, ts) {
        if (!orderId || !ts) return 0;
        try {
            var arr = JSON.parse(localStorage.getItem('noxtr_mostro_payfail_' + orderId) || '[]');
            if (!Array.isArray(arr)) arr = [];
            if (arr.indexOf(ts) === -1) {
                arr.push(ts);
                localStorage.setItem('noxtr_mostro_payfail_' + orderId, JSON.stringify(arr.slice(-20)));
            }
            return arr.length;
        } catch(e) { return 0; }
    }
    function _payFailCycles(orderId) {
        if (!orderId) return 0;
        try {
            var a = JSON.parse(localStorage.getItem('noxtr_mostro_payfail_' + orderId) || '[]');
            return Array.isArray(a) ? a.length : 0;
        } catch(e) { return 0; }
    }
    function _clearPayFailCycles(orderId) {
        try { localStorage.removeItem('noxtr_mostro_payfail_' + orderId); } catch(e) {}
    }
    // ── Fase de cobro (payout) ────────────────────────────────────────────────────────────────
    // La orden ya está liquidada y lo único que falta es que el comprador cobre. Espejo de
    // `isPayoutInvoice` de Mostro Mobile (order_status.dart, v1.4.0, PR #667):
    //     bool get isPayoutInvoice =>
    //         this == Status.paymentFailed || this == Status.settledHoldInvoice;
    //
    // Verificado contra mostro-core: `settled-hold-invoice` SÍ es un Status del protocolo
    // (order.rs, `#[serde(rename_all = "kebab-case")]`); `payment-failed` NO es Status sino Action
    // (message.rs), así que ese lado se refleja con la marca que deja el handler de esa acción.
    // Se persiste porque decide qué UI ve el comprador y debe sobrevivir a recargas.
    function _setPayoutPhase(orderId) {
        if (!orderId) return;
        try { localStorage.setItem('noxtr_mostro_payout_' + orderId, '1'); } catch(e) {}
    }
    function _isPayoutPhase(orderId) {
        if (!orderId) return false;
        try { return localStorage.getItem('noxtr_mostro_payout_' + orderId) === '1'; } catch(e) { return false; }
    }
    function _clearPayoutPhase(orderId) {
        try { localStorage.removeItem('noxtr_mostro_payout_' + orderId); } catch(e) {}
    }
    // ── Cursor `since` POR CONVERSACIÓN ───────────────────────────────────────────────────────
    // Calco de lib/services/chat_cursor_store.dart de Mostro Mobile, cuyo doc de clase dice:
    //   "Persists the per-conversation `since` cursor for chat subscriptions, as the chat spec
    //    requires"
    // Dos almacenes, con las mismas claves que ellos: chat de pares por orderId
    // ('chat_since_'), chat de disputa por disputeId ('dispute_chat_since_').
    // advance(): monotónico (nunca retrocede) y acotado al reloj local, como su
    //   `final clamped = clamp(accepted, now)` — requisito NORMATIVO del protocolo
    //   (protocol/chat.html: el cursor MUST NOT pasar del reloj propio, o un evento con fecha
    //   futura deja al cliente sin recibir nada hasta esa fecha).
    // cursorFor(): devuelve 0 si no hay nada guardado; el llamante cae entonces al lookback por
    //   defecto, igual que en su implementación ("callers fall back to the default lookback").
    //
    // Antes noxtr tenía UN SOLO cursor global para todos los trades y todos los chats: la
    // actividad de una conversación empujaba el cursor por delante de eventos aún pendientes de
    // otra, y esos ya no se volvían a pedir nunca.
    function _cursorKey(kind, id) {
        return (kind === 'dispute' ? 'noxtr_mostro_dispute_chat_since_' : 'noxtr_mostro_chat_since_') + id;
    }
    function _cursorFor(kind, id) {
        if (!id) return 0;
        try { return parseInt(localStorage.getItem(_cursorKey(kind, id)), 10) || 0; } catch(e) { return 0; }
    }
    function _advanceCursor(kind, id, acceptedTs) {
        if (!id || !acceptedTs) return;
        var clamped = Math.min(parseInt(acceptedTs, 10) || 0, Math.floor(Date.now() / 1000));
        if (clamped <= 0) return;
        try {
            var current = _cursorFor(kind, id);
            if (current && clamped <= current) return; // monotónico
            localStorage.setItem(_cursorKey(kind, id), String(clamped));
        } catch(e) {}
    }
    // ¿La respuesta de ajax.php dice que no hay sesión web? `code` es lo estable; el match por
    // `msg` cubre un servidor aún sin actualizar (los archivos se suben a mano, el JS puede ir
    // por delante del PHP).
    function _isNotLoggedIn(res) {
        if (!res) return false;
        if (res.code === 'not_logged_in') return true;
        return /not logged in|no user id in session/i.test(String(res.msg || ''));
    }
    function _looksLikeBolt11(s) { return typeof s === 'string' && /^ln(bc|tb|bcrt)[0-9]/i.test(s); }
    // Importe declarado en una bolt11, en sats. null = factura sin importe (amountless), HRP no
    // reconocido, o importe que no cae en un número entero de sats — en los tres casos no se compara
    // nada y decide el daemon.
    // Solo se lee la parte legible (BOLT-11, human-readable part): `ln` + prefijo de red + número +
    // multiplicador opcional (m=10⁻³, u=10⁻⁶, n=10⁻⁹, p=10⁻¹² BTC). El separador bech32 es el ÚLTIMO
    // '1' de la cadena: el charset de la parte de datos no incluye el '1', pero el importe del HRP sí
    // puede llevarlo (p.ej. `lnbc14820n1p4f...` → HRP `lnbc14820n`).
    // Las conversiones van con multiplicadores/divisores enteros a propósito: encadenar 1e-9 * 1e8 en
    // coma flotante da 1482.0000000000002 y rompería la comparación por igualdad.
    function _bolt11AmountSats(bolt11) {
        var s = String(bolt11 || '').trim().toLowerCase();
        var sep = s.lastIndexOf('1');
        if (sep < 1) return null;
        var m = /^ln(?:bc|tb|bcrt)(\d+)([munp])?$/.exec(s.slice(0, sep));
        if (!m) return null;
        var n = parseInt(m[1], 10);
        if (!isFinite(n) || n <= 0) return null;
        var sats;
        switch (m[2]) {
            case 'm': sats = n * 1e5; break;   // 10⁻³ BTC
            case 'u': sats = n * 1e2; break;   // 10⁻⁶ BTC
            case 'n': sats = n / 10;  break;   // 10⁻⁹ BTC
            case 'p': sats = n / 1e4; break;   // 10⁻¹² BTC
            default:  sats = n * 1e8;          // sin multiplicador: el número es BTC
        }
        return Number.isInteger(sats) ? sats : null;
    }
    // Saca {bolt11, sats} del raw_json de un rumor `pay-invoice` guardado en NSTR_EVENTS. Escanea en
    // profundidad en vez de asumir una ruta fija: el payload varía entre versiones de la instancia
    // (payment_request[1] normalmente, pero no siempre) y aquí solo interesa encontrar la factura.
    function _extractHoldInvoice(rawJson) {
        var root;
        try { root = JSON.parse(rawJson); } catch(e) { return null; }
        // El contenido del rumor es a su vez un JSON serializado.
        if (root && typeof root.content === 'string') {
            try { root = JSON.parse(root.content); } catch(e) {}
        }
        var found = null;
        (function scan(v, depth) {
            if (found || depth > 12 || v == null) return;
            if (_looksLikeBolt11(v)) {
                found = { bolt11: v, sats: null };
                return;
            }
            if (Array.isArray(v)) {
                for (var i = 0; i < v.length && !found; i++) scan(v[i], depth + 1);
                // payment_request = [order, bolt11, sats]: si la factura salió de este array,
                // el importe es el siguiente elemento numérico.
                if (found && !found.sats) {
                    var at = v.indexOf(found.bolt11);
                    if (at !== -1 && typeof v[at + 1] === 'number') found.sats = v[at + 1];
                }
                return;
            }
            if (typeof v === 'object') { for (var k in v) { if (found) break; scan(v[k], depth + 1); } }
        })(root, 0);
        return found;
    }
    // Fianza (bond) pagada: persistido para que el QR no reaparezca en cada recarga. El cliente no
    // responde al pay-bond-invoice (Mostro detecta el HTLC), y si la orden se queda pendiente en el
    // book sin que la instancia mande otra acción, no hay otra señal para cerrar el QR.
    // Clave = trade_key_pub (estable; el order_id cambia de tmp-... al UUID real entre el cierre en
    // vivo y la recarga, así que keyear por order_id perdía la marca). Fallback a order_id si no hay key.
    function _bondPaidKey(trade) {
        if (!trade) return null;
        var k = trade.trade_key_pub || trade.order_id;
        // Sufijo v2 (2026-08-23): las marcas v1 quedaron envenenadas por trade keys duplicadas
        // (bug de seed_index reusado, ver _generateKeypair) — un trade nuevo que reusara la clave
        // de uno con fianza ya pagada heredaba la marca y su QR de fianza no salía NUNCA (ni al
        // recargar, en cualquier instancia). Versionar la clave invalida todas las marcas viejas;
        // peor caso benigno: reaparece una vez el QR de una orden ya fondeada → botón "Ya pagada".
        return k ? ('noxtr_mostro_bondpaid2_' + k) : null;
    }
    // Persistencia del estado "fianza pagada". Antes vivia SOLO en localStorage (por dispositivo), lo
    // que hacia que la misma orden se viera distinta en cada PC del mismo usuario. Ahora se guarda
    // tambien en NSTR_TRADES.bond_paid (server-side, consistente entre dispositivos); localStorage se
    // mantiene como cache rapida.
    function _persistBondPaid(trade, val) {
        if (!trade) return;
        trade.bond_paid = val;
        if (trade.order_id && typeof MostroTrader !== 'undefined' && MostroTrader._ajax) {
            try { MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { bond_paid: val } }); } catch(e) {}
        }
    }
    function _markBondPaid(trade) {
        var k = _bondPaidKey(trade);
        if (k) { try { localStorage.setItem(k, '1'); } catch(e) {} }
        _persistBondPaid(trade, 1);
    }
    function _isBondPaid(trade) {
        if (trade && parseInt(trade.bond_paid, 10) === 1) return true; // server-side (cross-device)
        var k = _bondPaidKey(trade);
        if (!k) return false;
        try { return localStorage.getItem(k) === '1'; } catch(e) { return false; }
    }
    function _clearBondPaid(trade) {
        var k = _bondPaidKey(trade);
        if (k) { try { localStorage.removeItem(k); } catch(e) {} }
        _persistBondPaid(trade, 0);
    }
    // HTML del badge de reputación de la contraparte. Devuelve '' si no hay dato (no se inventa nada).
    function _peerRepHtml(orderId) {
        var r = _loadPeerRep(orderId);
        if (!r) return '';
        var reviews = parseInt(r.total_reviews, 10) || 0;
        if (!reviews) {
            return '<span class="mostro-trade-peerrep mostro-rating-new" title="' + str_peer_rep_none + '">👤 <span class="mostro-stars">☆☆☆☆☆</span></span>';
        }
        var avg = parseFloat(r.total_rating) || 0; // total_rating ya ES el promedio (protocolo)
        var days = parseInt(r.days, 10) || 0;
        var stars = '';
        for (var i = 1; i <= 5; i++) stars += (i <= Math.round(avg)) ? '★' : '☆';
        var title = avg.toFixed(2) + ' · ' + reviews + ' · ' + days + ' ' + str_days_active_mostro;
        return '<span class="mostro-trade-peerrep" title="' + _escHtml(t(str_peer_rep_label, title)) + '">👤 <span class="mostro-stars">' + stars + '</span> ' + avg.toFixed(1) +
            ' <small>(' + reviews + ')</small>' + (days ? ' <small title="' + str_days_active_mostro + '">📅' + days + 'd</small>' : '') + '</span>';
    }

    function _getPubkeyHex(privkeyHex) {
        var pk = nobleSecp256k1.getPublicKey(privkeyHex, true);
        return (typeof pk === 'string' ? pk : _bytesToHex(pk)).slice(2);
    }

    // Genera una trade key conforme al esquema Mostro/NIP-06:
    // m/44'/1237'/38383'/0/N. En reputación, N DEBE ser exactamente trade_index;
    // en privacidad se reserva el siguiente índice local aunque el campo no viaje por el wire.
    // Ya no existe fallback aleatorio: crear una operación sin la semilla o antes de cargar el
    // almacén podría romper la restauración o reutilizar una clave, así que falla de forma segura.
    async function _generateKeypair(requiredIndex) {
        if (MostroTrader._startupPromise) await MostroTrader._startupPromise;
        if (!MostroTrader._tradesLoaded) throw new Error('Los trades locales todavía no están cargados');
        if (!(await MostroTrader.ensureSeed())) throw new Error('No se pudo cargar la semilla Mostro');

        var used = {};
        Object.values(MostroTrader._trades || {}).forEach(function(t) {
            if (t.trade_key_pub) used[String(t.trade_key_pub).toLowerCase()] = 1;
        });

        var fixed = Number.isSafeInteger(requiredIndex) && requiredIndex > 0;
        var idx = fixed ? requiredIndex : await MostroTrader._reserveDerivationIndex(1);
        var privHex = await _bip32DerivePath(MostroTrader._seedBytes, "m/44'/1237'/38383'/0/" + idx);
        var pubHex = _getPubkeyHex(privHex);

        var guard = 0;
        while (used[pubHex.toLowerCase()] && guard++ < 100) {
            idx = await MostroTrader._reserveDerivationIndex(idx + 1);
            privHex = await _bip32DerivePath(MostroTrader._seedBytes, "m/44'/1237'/38383'/0/" + idx);
            pubHex = _getPubkeyHex(privHex);
        }
        if (used[pubHex.toLowerCase()]) throw new Error('No se pudo reservar una trade key Mostro única');
        if (!(MostroTrader._maxSeedIndex >= idx)) MostroTrader._maxSeedIndex = idx;
        return { priv: privHex, pub: pubHex, seedIndex: idx };
    }

    async function _signEventWith(ev, privkeyHex) {
        ev.id = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
        var sig = await nobleSecp256k1.schnorr.sign(ev.id, privkeyHex);
        ev.sig = typeof sig === 'string' ? sig : _bytesToHex(sig);
        return ev;
    }

    // Verifica un evento firmado con _signEventWith: recalcula el id (NIP-01) en vez de confiar en
    // el que trae el objeto, y comprueba la firma Schnorr contra ese id recalculado y ev.pubkey.
    // Usado tanto para el kind 14 externo del chat (protocol/chat.html: "Clients MUST verify the
    // event signature") como para el rumor kind 1 interno (chat.md: omitir esto "accepts forged
    // senders" — antes de esta auditoría, script.mostro.js nunca lo comprobaba).
    async function _verifyNostrSig(ev) {
        try {
            if (!ev || !ev.sig || !ev.pubkey) return false;
            var id = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            return await nobleSecp256k1.schnorr.verify(ev.sig, id, ev.pubkey);
        } catch(e) { return false; }
    }

    // Firma "a la Mostro": Schnorr sobre el hex del SHA-256 del mensaje (no sobre un evento).
    // Compartida por la firma del mensaje (tuple[1]) y el identity proof (tuple[2]) del transporte
    // v2, para que el daemon las verifique igual. Ver mostro-core transport.rs / Mostro Mobile
    // mostro_message.dart:_mostroSign (v1.3.0).
    async function _mostroSign(message, privkeyHex) {
        var hashHex = await _sha256hex(message);
        var sig = await nobleSecp256k1.schnorr.sign(hashHex, privkeyHex);
        return typeof sig === 'string' ? sig : _bytesToHex(sig);
    }

    // Transporte Mostro v2 (protocol/transport_migration.html + key_management.html): evento kind 14
    // NIP-44 directo, autor = trade key (firmado). El contenido
    // cifrado es el 3-tuple [mensaje, tradeSig, identityProof]:
    //  - privacidad total: [msgObj, null, null] (la firma del propio kind 14 prueba la trade key)
    //  - reputación: tradeSig = _mostroSign(messageJson, tradeKey); identityProof =
    //    [masterPub, _mostroSign('mostro-transport-v2-identity:'+tradePub+':'+messageJson, masterKey)]
    // repCtx = { masterPub, masterPriv } o null.
    async function _wrapV2(msgObj, recipientPubkeyHex, tradePrivkeyHex, repCtx) {
        var tradePub = _getPubkeyHex(tradePrivkeyHex);
        var messageJson = JSON.stringify(msgObj);
        var tradeSig = null, identityProof = null;
        if (repCtx && repCtx.masterPriv && repCtx.masterPub) {
            tradeSig = await _mostroSign(messageJson, tradePrivkeyHex);
            var idPayload = 'mostro-transport-v2-identity:' + tradePub + ':' + messageJson;
            identityProof = [repCtx.masterPub, await _mostroSign(idPayload, repCtx.masterPriv)];
        }
        var tuple = JSON.stringify([msgObj, tradeSig, identityProof]);
        var convKey = await Noxtr.Nip44.getConversationKey(tradePrivkeyHex, recipientPubkeyHex);
        var content = await Noxtr.Nip44.encrypt(tuple, convKey);
        var now = Math.floor(Date.now() / 1000);
        // NIP-40: el protocolo exige `expiration` siempre presente (2 días de margen).
        var ev = { kind: 14, pubkey: tradePub, content: content,
            tags: [['p', recipientPubkeyHex], ['expiration', String(now + 86400 * 2)]],
            created_at: now };
        // La acción va dentro del sobre, y el sobre NO es siempre "order": last-trade-index viaja
        // en "restore" (Message::Restore). Se lee del primer sobre que traiga msgObj, igual que
        // hace _handleGiftWrap al recibir.
        var _msgEnvelope = null;
        if (msgObj && typeof msgObj === 'object') {
            var _envKeys = Object.keys(msgObj);
            if (_envKeys.length && msgObj[_envKeys[0]] && typeof msgObj[_envKeys[0]] === 'object') {
                _msgEnvelope = msgObj[_envKeys[0]];
            }
        }
        var _msgAction = _msgEnvelope && _msgEnvelope.action;
        // Acciones que estrenan una clave que el nodo no ha visto nunca → carril "first contact"
        // (ver _robotFirstContactPowDifficulty). Cualquier otra reutiliza una trade key ya conocida
        // por el nodo (participante de un trade activo) → pow base.
        // last-trade-index entra aquí porque va firmada con una clave efímera de un solo uso:
        // app.rs:377 elige el carril con gate.is_known(event.pubkey), no por la acción, así que con
        // el pow base el evento se descarta ANTES de descifrarse y sin cant-do — timeout mudo.
        var _isFirstContact = ['new-order', 'take-sell', 'take-buy', 'last-trade-index'].indexOf(_msgAction) !== -1;
        var powDiff = Math.max(_powDifficulty(), _isFirstContact
            ? _robotFirstContactPowDifficulty(recipientPubkeyHex)
            : _robotPowDifficulty(recipientPubkeyHex)); // NIP-13: relay + robot
        ev = await _minePoW(ev, powDiff);
        ev = await _signEventWith(ev, tradePrivkeyHex);
        return ev;
    }

    // Transporte v2: descifra un kind 14 del nodo (1 capa NIP-44) y devuelve msgObj (tuple[0]).
    async function _unwrapV2(ev, ourPrivkeyHex) {
        try {
            var convKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, ev.pubkey);
            var tuple = JSON.parse(await Noxtr.Nip44.decrypt(ev.content, convKey));
            return Array.isArray(tuple) ? tuple[0] : tuple;
        } catch(e) { return null; }
    }

    // ==================== MOSTRO P2P CHAT (protocol/chat.html + dispute_chat.html) ====================
    // HKDF-SHA256 (RFC 5869) with an empty salt, per protocol/chat.html. An HMAC key shorter than the
    // hash block size (64 bytes for SHA-256) is zero-padded internally, so passing 64 zero bytes as
    // the "salt" key is bit-identical to an empty key — avoids depending on WebCrypto's handling of a
    // zero-length importKey (untested in this codebase; this sidesteps the question entirely).
    var _HKDF_EMPTY_SALT = new Uint8Array(64);
    var _SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

    async function _hmacSha256Raw(keyBytes, dataBytes) {
        var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
    }

    function _isValidPrivkeyBytes(bytes) {
        var v = 0n;
        for (var i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
        return v > 0n && v < _SECP256K1_ORDER;
    }

    // Deriva K_conv o K_sign (protocol/chat.html §HKDF) a partir del secreto ECDH (32 bytes, x-coord).
    // Si el resultado no es una clave secp256k1 válida, reintenta añadiendo un byte incremental a
    // `info` hasta encontrar una válida (caso extremadamente improbable, previsto por el protocolo).
    async function _mostroChatDeriveKey(sharedXBytes, infoStr) {
        var infoBytes = new TextEncoder().encode(infoStr);
        var prk = await _hmacSha256Raw(_HKDF_EMPTY_SALT, sharedXBytes);
        for (var counter = 0; counter <= 255; counter++) {
            var labelled = infoBytes;
            if (counter > 0) {
                labelled = new Uint8Array(infoBytes.length + 1);
                labelled.set(infoBytes);
                labelled[infoBytes.length] = counter;
            }
            var block = new Uint8Array(labelled.length + 1);
            block.set(labelled);
            block[labelled.length] = 1;
            var okm = (await _hmacSha256Raw(prk, block)).slice(0, 32);
            if (_isValidPrivkeyBytes(okm)) return _bytesToHex(okm);
        }
        throw new Error('HKDF: no valid key found');
    }

    // Deriva K_conv/K_sign del chat P2P o de disputa a partir del ECDH entre la trade key propia y la
    // pubkey de la contraparte (peer o admin/solver). Mismo par de claves para ambos lados del canal
    // (ECDH es simétrico), por eso K_sign puede firmar el evento externo sin identificar al emisor real
    // — la identidad real del emisor la prueba la firma del rumor interno con su propia trade key.
    async function _chatDerivedKeys(tradePrivHex, peerPubHex) {
        var shared = nobleSecp256k1.getSharedSecret(tradePrivHex, '02' + peerPubHex);
        if (typeof shared === 'string') shared = _hexToBytes(shared);
        var sharedX = shared.slice(1, 33);
        var convPrivHex = await _mostroChatDeriveKey(sharedX, 'mostro:chat:conv:v1');
        var signPrivHex = await _mostroChatDeriveKey(sharedX, 'mostro:chat:sign:v1');
        return {
            conv: { priv: convPrivHex, pub: _getPubkeyHex(convPrivHex) },
            sign: { priv: signPrivHex, pub: _getPubkeyHex(signPrivHex) }
        };
    }

    function _peerChatPubkey(trade) {
        if (!trade) return '';
        if (trade.method === 'onchain') {
            try {
                var data = trade.trade_json ? JSON.parse(trade.trade_json) : null;
                var pk = trade.trade_role === 'taken'
                    ? (data && data.maker_trade_pubkey)
                    : (data && data.taker_trade_pubkey);
                if (pk && /^[a-f0-9]{64}$/i.test(pk)) return pk.toLowerCase();
            } catch(e) {}
        }
        return (trade.peer_pubkey && /^[a-f0-9]{64}$/i.test(trade.peer_pubkey)) ? trade.peer_pubkey.toLowerCase() : '';
    }

    // Chat P2P/disputa: kind 1 (inner, firmado con la trade key real del emisor) cifrado NIP-44
    // dentro de kind 14 (outer, firmado con K_sign, #p = pub(K_conv)). Sin clave efímera.
    async function _p2pConversationKey(convPrivHex) {
        // "Self-encryption": conversation_key = NIP44_conversation_key(K_conv_priv, pub(K_conv)).
        return Noxtr.Nip44.getConversationKey(convPrivHex, _getPubkeyHex(convPrivHex));
    }

    async function _p2pWrap(text, tradePrivHex, tradePubHex, keys) {
        var now = Math.floor(Date.now() / 1000);
        var inner = { kind: 1, pubkey: tradePubHex, content: text, tags: [], created_at: now };
        inner = await _signEventWith(inner, tradePrivHex);
        var convKey = await _p2pConversationKey(keys.conv.priv);
        var wrap = { kind: 14, pubkey: keys.sign.pub,
            content: await Noxtr.Nip44.encrypt(JSON.stringify(inner), convKey),
            tags: [['p', keys.conv.pub]], created_at: now };
        wrap = await _minePoW(wrap, _powDifficulty()); // NIP-13
        wrap = await _signEventWith(wrap, keys.sign.priv);
        return wrap;
    }

    // Dedup durable por conversación. Se conserva todo el intervalo que la suscripción puede volver
    // a pedir (7 días), no un número arbitrario de mensajes: un chat activo no debe expulsar del
    // dedup mensajes todavía incluidos en el replay.
    function _p2pSeenInnerId(id, conversationId, createdAt) {
        if (!id) return false;
        try {
            var key = 'noxtr_mostro_chat_seen_' + String(conversationId || 'unknown');
            var seen = JSON.parse(localStorage.getItem(key) || '{}');
            var cutoff = Math.floor(Date.now() / 1000) - 86400 * 8;
            Object.keys(seen).forEach(function(k) { if ((parseInt(seen[k], 10) || 0) < cutoff) delete seen[k]; });
            if (seen[id]) return true;
            seen[id] = parseInt(createdAt, 10) || Math.floor(Date.now() / 1000);
            localStorage.setItem(key, JSON.stringify(seen));
            return false;
        } catch(e) { return false; }
    }

    var _chatRateBuckets = {};
    function _chatRateAllowed(conversationId) {
        var key = String(conversationId || 'unknown');
        var now = Date.now() / 1000;
        var b = _chatRateBuckets[key] || { tokens: 60, at: now };
        b.tokens = Math.min(60, b.tokens + Math.max(0, now - b.at) * 0.5); // 30/min, burst 60
        b.at = now;
        if (b.tokens < 1) { _chatRateBuckets[key] = b; return false; }
        b.tokens -= 1;
        _chatRateBuckets[key] = b;
        return true;
    }

    // Unwrap a P2P/dispute chat kind:14 event using the derived K_conv/K_sign pair. Verificación
    // completa (protocol/chat.html): cota de tamaño del cifrado, firma del rumor interno contra su
    // propio pubkey (el emisor real de ese mensaje concreto — el kind 14 externo solo prueba K_sign,
    // que ambas partes del trade comparten por el ECDH simétrico), cota de reloj entre el timestamp
    // interno y el del wrap externo, y dedup durable por inner.id. Antes de esta auditoría (2026-08-22)
    // nada de esto se comprobaba: cualquiera que pasara el filtro de suscripción (ahora por authors,
    // ver subscribeMyTrades) podía hacer pasar contenido no autenticado.
    async function _p2pUnwrap(wrapEv, keys, options) {
        options = options || {};
        try {
            if (!wrapEv || wrapEv.kind !== 14 || !wrapEv.content) return null;
            var contentBytes = typeof TextEncoder !== 'undefined'
                ? new TextEncoder().encode(wrapEv.content).length : wrapEv.content.length;
            if (contentBytes > 65536) return null;
            var expectedAuthor = String(options.expectedAuthor || keys.sign.pub || '').toLowerCase();
            if (!expectedAuthor || String(wrapEv.pubkey || '').toLowerCase() !== expectedAuthor) return null;
            var pTags = (wrapEv.tags || []).filter(function(t) { return t[0] === 'p'; });
            if (pTags.length !== 1 || String(pTags[0][1] || '').toLowerCase() !== String(keys.conv.pub).toLowerCase()) return null;
            var now = Math.floor(Date.now() / 1000);
            var outerCreatedAt = parseInt(wrapEv.created_at, 10) || 0;
            if (!outerCreatedAt || outerCreatedAt > now + 60) return null;
            if (!options.skipRate && !_chatRateAllowed(options.conversationId)) return null;
            if (!(await _verifyNostrSig(wrapEv))) return null;
            var convKey = await _p2pConversationKey(keys.conv.priv);
            var inner = JSON.parse(await Noxtr.Nip44.decrypt(wrapEv.content, convKey));
            if (!inner || inner.kind !== 1 || typeof inner.content !== 'string' || !inner.pubkey) return null;
            if (!(await _verifyNostrSig(inner))) {
                console.warn('[Mostro] chat: firma del rumor interno inválida, descartado', inner.id);
                return null;
            }
            var createdAt = parseInt(inner.created_at, 10) || 0;
            if (!createdAt || createdAt > now + 60) return null;
            if (Math.abs(createdAt - outerCreatedAt) > 60) {
                console.warn('[Mostro] chat: desfase de reloj entre rumor y wrap, descartado', inner.id);
                return null;
            }
            var allowed = (options.allowedSigners || []).map(function(p) { return String(p || '').toLowerCase(); });
            if (allowed.length && allowed.indexOf(String(inner.pubkey).toLowerCase()) === -1) return null;
            if (!options.skipDedup && _p2pSeenInnerId(inner.id, options.conversationId, createdAt)) return null;
            return {
                text: inner.content,
                senderPub: inner.pubkey,
                created_at: createdAt,
                innerId: inner.id
            };
        } catch(e) { return null; }
    }

    // ==================== NIP-47 NOSTR WALLET CONNECT ====================

    var Nip47 = {
        _walletPubkey: null,
        _secret: null,
        _clientPubkey: null,
        _relay: null,
        _ws: null,
        _pending: {},   // eventId → { resolve, reject, timer }

        parseUri: function(uri) {
            var m = (uri || '').match(/^nostrwalletconnect:\/\/([0-9a-f]{64})\??(.*)$/i);
            if (!m) return null;
            var params = {};
            (m[2] || '').split('&').forEach(function(p) {
                var kv = p.split('='); if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
            });
            return { pubkey: m[1], relay: params.relay, secret: params.secret };
        },

        load: async function(ajaxFn) {
            try {
                var r = await ajaxFn('get_nwc', {});
                if (r.data && r.data.uri) this.init(r.data.uri);
            } catch(e) {}
        },

        init: function(uri) {
            var p = this.parseUri(uri);
            if (!p || !p.pubkey || !p.secret || !p.relay) return false;
            this._walletPubkey = p.pubkey;
            this._secret = p.secret;
            this._relay = p.relay;
            var pkRaw = nobleSecp256k1.getPublicKey(p.secret, true);
            this._clientPubkey = (typeof pkRaw === 'string' ? pkRaw : _bytesToHex(pkRaw)).slice(2);
            return true;
        },

        isConfigured: function() { return !!(this._walletPubkey && this._secret); },

        _connect: function() {
            if (this._ws && this._ws.readyState < 2) return;
            var self = this;
            this._ws = new WebSocket(this._relay);
            this._ws.onopen = function() {
                self._ws.send(JSON.stringify(['REQ', 'nwc', { kinds: [23195], '#p': [self._clientPubkey], limit: 0 }]));
            };
            this._ws.onmessage = function(e) {
                try { var m = JSON.parse(e.data); if (m[0] === 'EVENT' && m[2]) self._handleResponse(m[2]); } catch(err) {}
            };
            this._ws.onclose = function() { self._ws = null; };
            this._ws.onerror = function() {};
        },

        _nip04Encrypt: async function(plaintext) {
            var shared = nobleSecp256k1.getSharedSecret(this._secret, '02' + this._walletPubkey);
            var key = shared.slice(1, 33);
            var iv = crypto.getRandomValues(new Uint8Array(16));
            var ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
            var enc = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv }, ck, new TextEncoder().encode(plaintext));
            return btoa(String.fromCharCode.apply(null, new Uint8Array(enc))) + '?iv=' + btoa(String.fromCharCode.apply(null, iv));
        },

        _nip04Decrypt: async function(ciphertext) {
            var shared = nobleSecp256k1.getSharedSecret(this._secret, '02' + this._walletPubkey);
            var key = shared.slice(1, 33);
            var parts = ciphertext.split('?iv=');
            var ct = Uint8Array.from(atob(parts[0]), function(c) { return c.charCodeAt(0); });
            var iv = Uint8Array.from(atob(parts[1]), function(c) { return c.charCodeAt(0); });
            var ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
            var dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, ck, ct);
            return new TextDecoder().decode(dec);
        },

        _handleResponse: async function(ev) {
            if (ev.kind !== 23195) return;
            var reqId = null;
            for (var i = 0; i < (ev.tags || []).length; i++) {
                if (ev.tags[i][0] === 'e') { reqId = ev.tags[i][1]; break; }
            }
            if (!reqId || !this._pending[reqId]) return;
            var p = this._pending[reqId];
            delete this._pending[reqId];
            clearTimeout(p.timer);
            try {
                var plain = await this._nip04Decrypt(ev.content);
                var data = JSON.parse(plain);
                if (data.error) p.reject(new Error(data.error.message || 'NWC error'));
                else p.resolve(data.result || {});
            } catch(e) { p.reject(e); }
        },

        payInvoice: async function(bolt11) {
            if (!this.isConfigured()) throw new Error(str_nwc_not_configured);
            this._connect();
            var payload = JSON.stringify({ method: 'pay_invoice', params: { invoice: bolt11 } });
            var enc = await this._nip04Encrypt(payload);
            var ev = { pubkey: this._clientPubkey, created_at: Math.floor(Date.now() / 1000), kind: 23194, tags: [['p', this._walletPubkey]], content: enc };
            ev.id = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            var sig = await nobleSecp256k1.schnorr.sign(ev.id, this._secret);
            ev.sig = typeof sig === 'string' ? sig : _bytesToHex(sig);
            var self = this;
            return new Promise(function(resolve, reject) {
                var timer = setTimeout(function() {
                    delete self._pending[ev.id];
                    reject(new Error(str_wallet_30s_timeout));
                }, 30000);
                self._pending[ev.id] = { resolve: resolve, reject: reject, timer: timer };
                if (self._ws && self._ws.readyState === 1) {
                    self._ws.send(JSON.stringify(['EVENT', ev]));
                } else {
                    // onopen enviará el REQ; enviamos el EVENT tras conectar
                    var origOnOpen = self._ws.onopen;
                    self._ws.onopen = function() { origOnOpen && origOnOpen(); self._ws.send(JSON.stringify(['EVENT', ev])); };
                }
            });
        },

        configure: async function(ajaxFn) {
            var current = (this._walletPubkey ? 'nostrwalletconnect://' + this._walletPubkey + '?relay=' + encodeURIComponent(this._relay) + '&secret=' + this._secret : '');
            var uri = await Promise.resolve(prompt(str_nwc_uri_prompt, current));
            if (uri === null) return;
            uri = (uri || '').trim();
            if (uri !== '' && !this.init(uri)) { alert(str_invalid_uri); return; }
            if (uri === '') { this._walletPubkey = this._secret = this._clientPubkey = this._relay = null; }
            await ajaxFn('save_nwc', { uri: uri });
        },

        disconnect: function() {
            if (this._ws) { try { this._ws.close(); } catch(e) {} this._ws = null; }
            this._walletPubkey = this._secret = this._clientPubkey = this._relay = null;
            this._pending = {};
        }
    };

    // ==================== MOSTRO TRADER ====================

    var MostroTrader = {
        _trades: {},      // orderId → trade object
        _seenEvIds: {},   // dedup eventos kind 14 recibidos desde varios relays
        _seenEvOrder: [], // mantiene el dedup anterior acotado frente a relays hostiles
        _processingEvFingerprints: {}, // reserva temporal id+sig; no bloquea una copia legítima
        _deferredAdminEvents: {}, // admin-* llegado antes que su disputa; se reintenta al hidratarla
        _rejectedEvFingerprints: {}, // id+sig inválidos; no envenenan el id de una copia legítima
        _rejectedEvOrder: [],
        _eoseReceived: false, // true after relay sends EOSE — events after this are live
        _subId: null,     // suscripción de mensajes de trade
        _reqId: 0,
        _chatNotifyCutoffTs: Math.floor(Date.now() / 1000),

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

            // Persiste un evento Nostr (kind 14 entrante, rumor desempaquetado o kind 14 saliente)
        // en NSTR_TRADES.NSTR_EVENTS. Fire-and-forget: errores se ignoran, no bloquean el flujo.
        // sources: 'client_in' (kind:14 entrante)
        //          'client_rumor' (rumor decifrado de la instancia, contiene action+payload)
        //          'client_out' (kind:14 saliente, antes del publish)
        _logMostroEv: function(source, ev, orderId, status) {
            if (!ev || !ev.id) return;
            try {
                this._ajax('log_mostro_event', {
                    event_id: ev.id,
                    kind: parseInt(ev.kind, 10) || 0,
                    order_id: orderId || '',
                    event_created_at: parseInt(ev.created_at, 10) || Math.floor(Date.now() / 1000),
                    source: source,
                    status: status || '',
                    raw_json: JSON.stringify(ev)
                });
            } catch(e) {}
        },

        // Auditoría 2026-08-22, hallazgo menor: en privacidad total el protocolo espera trade_index
        // vacío (Mostro no lo necesita — identity == sender); antes se mandaba `1` fijo siempre,
        // tolerado por el daemon pero no conforme. Ahora se manda null en TODA la vida del trade en
        // privacidad total (no solo al crearlo) — de ahí que este único punto centralizado sea el que
        // hay que arreglar: todos los envíos de acciones ya pasan por aquí o por _nextTradeIndex().
        _tradeUsesReputation: function(trade) {
            if (!trade) return this._isReputationMode();
            var fp = String(trade.identity_fingerprint || '').toLowerCase();
            if (fp === 'privacy') return false;
            if (/^[a-f0-9]{64}$/.test(fp)) return true;
            // Fila histórica: antes no se persistía el modo. Mantener el comportamiento global
            // anterior es la única compatibilidad posible sin inventar una identidad.
            return (parseInt(trade.trade_index, 10) > 0) && this._isReputationMode();
        },
        _tradeIndexOrDefault: function(trade, fallback) {
            var idx = parseInt(trade && trade.trade_index, 10) || 0;
            // Un trade conserva durante toda su vida el modo con el que nació. Cambiar el toggle
            // solo afecta a operaciones nuevas; nunca puede quitar la identidad a una ya iniciada.
            if (trade) return this._tradeUsesReputation(trade) && idx > 0 ? idx : null;
            return this._isReputationMode() ? (fallback || 1) : null;
        },

        // ---- Modo reputación (transporte v2, identity proof — protocol/key_management.html) ----
        // OFF: [msgObj,null,null], privacidad total. ON: identidad Mostro = índice 0 y cada trade
        // usa la clave del mismo mnemonic en el índice indicado por trade_index. La identidad social
        // del login NO interviene. Esto permite reputación también con NIP-07/NIP-46 y, sobre todo,
        // hace portable la sesión entre clientes Mostro conformes.
        _maxTradeIndex: null,
        _currentUserId: function() {
            try { return (window.Noxtr && Noxtr.Api && parseInt(Noxtr.Api.userId, 10)) || 0; } catch(e) { return 0; }
        },
        _repFlagKey: function() { return 'noxtr_mostro_reputation_u' + this._currentUserId(); },
        _isReputationMode: function() {
            try { return localStorage.getItem(this._repFlagKey()) === '1'; } catch(e) { return false; }
        },
        _setReputationMode: function(on) {
            try { localStorage.setItem(this._repFlagKey(), on ? '1' : '0'); } catch(e) {}
        },
        // Calcula (y memoiza) el mayor trade_index que consta en los trades locales, SIN consumirlo.
        // Separado de _nextTradeIndex() para poder subir el suelo con lo que diga el nodo antes de
        // repartir el siguiente índice (ver syncTradeIndex).
        _ensureMaxTradeIndex: function() {
            if (this._maxTradeIndex == null) {
                var mx = parseInt(this._storedMaxDerivationIndex, 10) || 0;
                Object.values(this._trades || {}).forEach(function(t) {
                    // Ambos comparten el mismo espacio de derivación en la semilla. Incluir
                    // seed_index evita reutilizar una clave que un trade privado anterior ya usó.
                    var ti = parseInt(t.trade_index, 10) || 0;
                    var si = parseInt(t.seed_index, 10) || 0;
                    if (ti > mx) mx = ti;
                    if (si > mx) mx = si;
                });
                this._maxTradeIndex = mx;
            }
            return this._maxTradeIndex;
        },

        _nextTradeIndex: async function(forceReputation) {
            // Auditoría 2026-08-22: en privacidad total el campo va vacío (Option<i64> en el struct
            // real, sin valor por defecto útil) — antes se mandaba `1` fijo, tolerado por el daemon
            // pero no conforme. Mismo criterio que _tradeIndexOrDefault().
            if (!forceReputation && !this._isReputationMode()) return null;
            this._ensureMaxTradeIndex();
            return this._reserveDerivationIndex(this._maxTradeIndex + 1);
        },

        _reserveDerivationIndex: async function(minimum) {
            minimum = Math.max(1, parseInt(minimum, 10) || 1);
            var res = await this._ajax('reserve_mostro_derivation_index', { minimum: minimum });
            var idx = res && Number(res.index);
            if (!res || !res.ok || !Number.isSafeInteger(idx) || idx < minimum) {
                throw new Error('No se pudo reservar un índice de derivación Mostro');
            }
            this._storedMaxDerivationIndex = Math.max(this._storedMaxDerivationIndex || 0, idx);
            this._maxSeedIndex = Math.max(this._maxSeedIndex || 0, idx);
            this._maxTradeIndex = Math.max(this._maxTradeIndex || 0, idx);
            return idx;
        },

        // ---- last-trade-index (roadmap #9) ----
        // El contador de trade_index no vive aquí: lo lleva CADA NODO en su propia tabla `users`. Si
        // la misma identidad ya operó desde Mostro Mobile u otra instalación de noxtr, el máximo que
        // sacamos de los trades locales se queda corto y el siguiente new-order/take-* se lo come
        // CantDoReason::InvalidTradeIndex. Esto pregunta al nodo por dónde va antes de repartir índice.
        //
        // Protocolo verificado en mostro/src/app/last_trade_index.rs y app.rs:
        //  - Petición sobre "restore" (Message::Restore), NO "order": es la única variante que el
        //    daemon usa de verdad para esta acción. payload null (MessageKind::verify lo exige), sin
        //    `id` y sin trade_index — check_trade_index solo se aplica a new-order/take-*, la
        //    petición no lleva índice que validar.
        //  - Respuesta: mismo sobre y misma acción, el valor viene en el campo trade_index y el
        //    payload es null.
        //  - El nodo identifica al solicitante por event.identity, así que solo contesta en modo
        //    reputación. Sin identity proof responde cant-do NotFound: es lo normal para una
        //    identidad que ese nodo no ha visto nunca y significa "sigue con tu contador local".
        //  - Responde a event.sender, de modo que la petición puede ir firmada con una clave
        //    aleatoria de un solo uso — no gastamos índice de la semilla NIP-06 en un mensaje que
        //    no es un trade y cuya clave no vuelve a usarse.
        //  - El contador es por nodo (cada instancia tiene su tabla), de ahí la caché por
        //    robot_pubkey: una consulta por instancia y sesión.
        _nodeTradeIndex: {},

        // El índice es por nodo pero nuestro contador local es único: quedarnos con el máximo entre
        // ambos nunca reutiliza un índice ya gastado en ninguna instancia, que es justo lo que el
        // daemon rechaza. Puede dejar huecos en la numeración de otro nodo; el daemon solo exige que
        // sea estrictamente creciente, no consecutivo.
        _applyNodeTradeIndex: function(val) {
            if (!(val > 0)) return;
            this._ensureMaxTradeIndex();
            if (val > this._maxTradeIndex) this._maxTradeIndex = val;
        },

        syncTradeIndex: async function(robotPubkey, trade) {
            if (!robotPubkey || !/^[a-f0-9]{64}$/i.test(robotPubkey)) return null;
            robotPubkey = robotPubkey.toLowerCase();
            // Sin reputación no hay identity proof y el nodo no sabría a quién contestar: el índice
            // que mandamos es null de todas formas (privacidad total), así que no hay nada que sincronizar.
            if (!trade && !this._isReputationMode()) return null;
            if (trade && !this._tradeUsesReputation(trade)) return null;
            var repCtx = await this._reputationContext(trade || null);
            if (!repCtx) return null;
            // El contador pertenece a (instancia, identidad), no solo a la instancia.
            var cacheKey = robotPubkey + ':' + repCtx.masterPub;
            var cached = this._nodeTradeIndex[cacheKey];
            if (cached != null) { this._applyNodeTradeIndex(cached); return cached || null; }

            var self = this;
            // Clave efímera de un solo uso (aleatoria, NO derivada de la semilla): el nodo responde
            // a event.sender y esta clave no vuelve a aparecer en ningún trade.
            var ephPriv = _bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
            var ephPub = _getPubkeyHex(ephPriv);
            var requestId = ++this._reqId;
            var inner = this._buildMsg('last-trade-index', null, null, requestId, null).order;
            var msgObj = { restore: inner };

            return new Promise(function(resolve) {
                var subId = null, done = false, timer = null;
                var finish = function(val) {
                    if (done) return;
                    done = true;
                    if (timer) clearTimeout(timer);
                    if (subId) { try { Noxtr.Pool.unsubscribe(subId); } catch(e) {} }
                    resolve(val);
                };
                try {
                    // Suscripción propia y efímera: authors fijado al robot (un tercero no puede
                    // colarnos un índice) y #p a la clave de un solo uso.
                    subId = Noxtr.Pool.subscribe(
                        [{ kinds: [14], authors: [robotPubkey], '#p': [ephPub],
                           since: Math.floor(Date.now() / 1000) - 300, limit: 10 }],
                        async function(ev) {
                            // Mismo criterio que _handleGiftWrap: autor esperado y firma verificada
                            // (recalculando el id, sin fiarse del que trae el evento) ANTES de descifrar.
                            if (done || !ev || !ev.pubkey || ev.pubkey.toLowerCase() !== robotPubkey) return;
                            if (!(await _verifyNostrSig(ev))) return;
                            var msg = await _unwrapV2(ev, ephPriv);
                            // El sobre lleva el nombre de la acción: la respuesta buena llega como
                            // {"restore":{...}} pero un cant-do llega como {"cant-do":{...}}. Buscar
                            // solo restore/order dejaba muerta la rama del NotFound, que es el caso
                            // más habitual. Se coge el primer sobre, como en _handleGiftWrap.
                            var body = null;
                            if (msg && typeof msg === 'object') {
                                var mk = Object.keys(msg);
                                if (mk.length && msg[mk[0]] && typeof msg[mk[0]] === 'object') body = msg[mk[0]];
                            }
                            if (!body) return;

                            // La respuesta tiene que corresponder exactamente a ESTA consulta.
                            // Aceptar un request_id ausente o distinto permitiría aplicar una
                            // respuesta vieja/no relacionada recibida por el mismo listener.
                            var responseRequestId = Number(body.request_id);
                            if (!Number.isSafeInteger(responseRequestId) || responseRequestId !== requestId) {
                                _mostroDebugWarn('[Mostro] last-trade-index: respuesta no correlacionada descartada', {
                                    esperado: requestId,
                                    recibido: body.request_id == null ? null : body.request_id
                                });
                                return;
                            }

                            if (body.action === 'last-trade-index') {
                                // En una respuesta correcta el campo existe y es positivo. No
                                // convertir null/ausente en 0: 0 significa exclusivamente que el
                                // nodo contestó CantDo::NotFound.
                                var val = Number(body.trade_index);
                                if (body.trade_index == null || body.trade_index === ''
                                        || !Number.isSafeInteger(val) || val <= 0) {
                                    _mostroDebugWarn('[Mostro] last-trade-index: trade_index ausente o inválido; respuesta descartada', body.trade_index);
                                    return;
                                }
                                self._nodeTradeIndex[cacheKey] = val;
                                self._applyNodeTradeIndex(val);
                                _mostroDebug('[Mostro] last-trade-index', robotPubkey.slice(0, 12) + '…', '=', val);
                                finish(val);
                                return;
                            }

                            // Solo CantDo::NotFound significa realmente que esta identidad no tiene
                            // historial. Cualquier otra razón se deja sin cachear para no convertir
                            // un rechazo transitorio o de validación en un falso "contador cero".
                            if (body.action === 'cant-do') {
                                var reason = body.payload && body.payload.cant_do
                                    ? String(body.payload.cant_do).toLowerCase().replace(/-/g, '_')
                                    : '';
                                if (reason === 'not_found') {
                                    self._nodeTradeIndex[cacheKey] = 0;
                                    _mostroDebug('[Mostro] last-trade-index: el nodo no conoce esta identidad todavía');
                                    finish(null);
                                    return;
                                }
                                _mostroDebugWarn('[Mostro] last-trade-index: cant-do inesperado; no se cachea', reason || '(sin motivo)');
                                finish(null);
                            }
                        },
                        function() {}
                    );
                } catch(e) {
                    console.warn('[Mostro] last-trade-index: no se pudo suscribir:', e);
                    return finish(null);
                }
                // El nodo puede no contestar (versión antigua sin la acción, relay lento). No es
                // bloqueante: se sigue con el contador local, que es el comportamiento de siempre.
                // Un timeout no demuestra que el nodo carezca de historial: continuar con el
                // contador local mantiene el comportamiento no bloqueante, pero no se cachea un
                // falso cero. Una operación posterior podrá volver a intentar la sincronización.
                timer = setTimeout(function() {
                    _mostroDebug('[Mostro] last-trade-index: sin respuesta del nodo, se usa el contador local');
                    finish(null);
                }, 4000);
                (async function() {
                    try {
                        var wrap = await _wrapV2(msgObj, robotPubkey, ephPriv, repCtx);
                        self._logMostroEv('client_out', wrap, '', 'last-trade-index');
                        Noxtr.Pool.publish(wrap);
                        Noxtr.Pool.publishTo('wss://relay.mostro.network', wrap);
                    } catch(e) {
                        console.warn('[Mostro] last-trade-index: fallo al enviar:', e);
                        finish(null);
                    }
                })();
            });
        },

        // ---- Sesión Mostro propia: una semilla, identidad 0 y trade keys N ----
        // Independiente de la identidad Nostr del login. En reputación, _identityPriv/_identityPub
        // firman el identity proof; en privacidad no se publican, pero las trade keys siguen siendo
        // deterministas. Es la base exigida por restore-session y la interoperabilidad entre clientes.
        _seedBytes: null,
        _identityPriv: null,
        _identityPub: null,
        _maxSeedIndex: null,
        _storedMaxDerivationIndex: 0,
        _tradesLoaded: false, // true cuando loadMyTrades pobló _trades; gate de la derivación NIP-06
        ensureSeed: async function() {
            if (this._seedBytes && this._identityPriv && this._identityPub) return true;
            try {
                var mnemonic = '';
                var r1 = await this._ajax('get_mostro_seed', {});
                if (r1 && r1.mnemonic) {
                    mnemonic = r1.mnemonic;
                } else if (window.bip39 && typeof window.bip39.generateMnemonic === 'function') {
                    mnemonic = window.bip39.generateMnemonic();
                    var r2 = await this._ajax('save_mostro_seed', { mnemonic: mnemonic });
                    // save_mostro_seed no sobreescribe si ya había una (carrera entre pestañas): usar
                    // siempre la que el servidor confirme como buena.
                    if (r2 && r2.mnemonic) mnemonic = r2.mnemonic;
                    else return false;
                }
                if (!mnemonic) return false;
                if (!window.bip39 || typeof window.bip39.validateMnemonic !== 'function'
                        || !window.bip39.validateMnemonic(mnemonic)) {
                    throw new Error('La semilla Mostro guardada no es un mnemónico BIP39 válido');
                }
                this._seedBytes = await _bip39Seed(mnemonic);
                this._identityPriv = await _bip32DerivePath(this._seedBytes, "m/44'/1237'/38383'/0/0");
                this._identityPub = _getPubkeyHex(this._identityPriv);
                return true;
            } catch(e) {
                this._seedBytes = null;
                this._identityPriv = null;
                this._identityPub = null;
                console.warn('[Mostro] ensureSeed falló:', e);
                return false;
            }
        },
        // Tiempo relativo "hace X" y fecha corta, para las fichas de Mis trades.
        _relTime: function(tsSec) {
            var ts = parseInt(tsSec, 10) || 0;
            if (!ts) return '';
            var diff = Math.floor(Date.now() / 1000) - ts;
            if (diff < 0) diff = 0;
            if (diff < 60) return 'hace ' + diff + ' s';
            if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
            if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + ' h';
            return 'hace ' + Math.floor(diff / 86400) + ' d';
        },
        _fmtDate: function(tsSec) {
            var ts = parseInt(tsSec, 10) || 0;
            if (!ts) return '';
            try { return new Date(ts * 1000).toLocaleDateString(); } catch(e) { return ''; }
        },

        _applyPublicOrderStatus: async function(orderId, robotPubkey, publicStatus, ev) {
            if (!orderId || !publicStatus || !this._trades[orderId]) return false;
            var trade = this._trades[orderId];
            if (robotPubkey && trade.robot_pubkey && robotPubkey !== trade.robot_pubkey) return false;
            // Valores reales del enum Status (order.rs, kebab-case) — 'settled'/'cancelled' (con
            // doble ele) no existen en el protocolo, nunca iban a casar con nada; corregido junto
            // con las variantes -by-admin y cooperatively-canceled que faltaban.
            var statusMap = {
                'waiting-taker-bond': 'tomado',
                'in-progress': 'activo',
                'fiat-sent': 'fiat_enviado',
                'success': 'completado',
                'settled-by-admin': 'completado',
                'completed-by-admin': 'completado',
                'canceled': 'cancelado',
                'canceled-by-admin': 'cancelado',
                'cooperatively-canceled': 'cancelado',
                'expired': 'cancelado',
                'dispute': 'disputado'
            };
            var newStatus = statusMap[String(publicStatus || '').toLowerCase()];
            if (!newStatus) {
                // Un status del enum que no esté aquí se ignora en silencio y deja el trade colgado
                // en el estado anterior hasta que llegue un DM — el patrón que ya provocó los cuelgues
                // de cooperative-cancel-accepted y admin-settled. Si el daemon estrena un valor nuevo,
                // que al menos quede rastro en vez de desaparecer.
                _mostroDebugWarn('[Mostro] status público del 38383 sin mapear:', publicStatus, 'order_id=', orderId);
                return false;
            }
            // El canal PÚBLICO no puede declarar 'activo' del lado del vendedor. El daemon publica
            // `in-progress` en cuanto la orden sale del book —con fianzas, en cuanto entra la del
            // taker—, y en ese momento el vendedor TODAVÍA debe la hold invoice. Como 'activo' está
            // en _noQrStatuses, el `pay-invoice` que llega justo después se queda sin QR y sin el
            // botón "ver QR de nuevo" de la ficha: el vendedor no tiene forma de pagar y el trade
            // muere. Es la misma trampa que ya se arregló en el canal del nodo para
            // buyer-took-order / waiting-buyer-invoice (ver _processRobotAction) y que el mapa de
            // 1.4.145 reintrodujo por el otro canal.
            //
            // Verificado sobre la orden d97129eb (vendedor maker, rango 1-2 EUR): is_seller=1,
            // trade_role='created', trade_kind='sell' —así que los overrides del canal DM SÍ
            // actuaron y ese canal no pudo producir el 'activo'—, peer_pubkey vacío —así que
            // hold-invoice-payment-accepted/active nunca llegaron, porque traen las pubkeys y
            // isHoldConfirmed las captura— y trade_action='pay-invoice' —así que la factura llegó y
            // se procesó, pero 'tomado' no pudo bajar de 'activo'—. Solo queda este camino, que
            // además es el único que sube a 'activo' sin tocar peer_pubkey.
            //
            // El paso real a 'activo' lo da el nodo (hold-invoice-payment-accepted / active), que es
            // la autoridad.
            //
            // CORRECCIÓN: esto llegó a estar limitado a `parseInt(trade.is_seller)`, con el argumento
            // de que del lado comprador 'activo' es "manda el fiat" y este canal era su red de
            // seguridad. Ese razonamiento era falso: al comprador `in-progress` también le llega
            // ANTES de haber mandado su factura, y marcarlo 'activo' le quita las dos vías de
            // mandarla (ver el override de buyer-took-order/waiting-buyer-invoice en
            // _processRobotAction). Pasó en una venta creada en Mostro Mobile y tomada aquí: la
            // contraparte se quedó en "esperando factura del comprador" indefinidamente.
            // Ahora se degrada para los dos lados, cada uno al estado donde su UI sí funciona.
            // La guarda de prioridad impide que esto baje un 'activo' legítimo ya confirmado por DM.
            if (newStatus === 'activo' && trade.method !== 'onchain') {
                newStatus = parseInt(trade.is_seller) ? 'esperando_hold_invoice' : 'tomado';
            }
            // Orden del canal público: NO es el mismo que el del canal del nodo, a propósito.
            // El porqué, en el comentario de _PUBLIC_STATUS_PRIORITY.
            var curPrio = _PUBLIC_STATUS_PRIORITY.indexOf(trade.internal_status);
            var newPrio = _PUBLIC_STATUS_PRIORITY.indexOf(newStatus);
            // Un evento público histórico tampoco puede reabrir un desenlace local terminal.
            if (['completado','cancelado','archivado'].indexOf(trade.internal_status) !== -1
                    && newStatus !== trade.internal_status) return false;
            // Una resolución pública firmada por la instancia es autoridad suficiente para sacar
            // una ficha de `disputado`. La prioridad normal no lo permitía porque `disputado` está
            // deliberadamente al final de la lista: se ignoraban `success`/`settled-by-admin` y la
            // ficha quedaba eternamente con botones de una disputa ya cerrada.
            var publicDisputeResolution = trade.internal_status === 'disputado'
                && ['completado','cancelado'].indexOf(newStatus) !== -1;
            if (!publicDisputeResolution && curPrio !== -1 && newPrio !== -1 && newPrio < curPrio) return false;
            // El `amt` del 38383 lo firma la instancia y sí representa los sats del TRADE. Es la
            // fuente idónea para reparar filas antiguas contaminadas por un amount de fianza.
            var publicSats = 0;
            (ev && ev.tags || []).some(function(tag) {
                if (tag[0] !== 'amt') return false;
                publicSats = parseInt(tag[1], 10) || 0;
                return true;
            });
            var statusChanged = trade.internal_status !== newStatus;
            var amountChanged = publicSats > 0 && parseInt(trade.sat_amount, 10) !== publicSats;
            if (!statusChanged && !amountChanged) return false;

            var publicFields = {};
            if (statusChanged) {
                trade.internal_status = newStatus;
                trade.status = publicStatus;
                trade.trade_action = publicStatus;
                publicFields.internal_status = newStatus;
                publicFields.status = publicStatus;
                publicFields.trade_action = publicStatus;
            }
            if (amountChanged) {
                trade.sat_amount = publicSats;
                publicFields.sat_amount = publicSats;
            }
            trade.updated_at = Math.max(
                parseInt(trade.updated_at, 10) || 0,
                ev && parseInt(ev.created_at, 10) || Math.floor(Date.now() / 1000)
            );
            await this._ajax('mostro_trade_update', {
                order_id: orderId,
                fields: publicFields
            });
            _mostroDebug('[Mostro][PUBLIC_STATUS]', {
                order_id: orderId,
                public_status: publicStatus,
                internal_status: newStatus,
                sat_amount: amountChanged ? publicSats : undefined,
                robot_pubkey: robotPubkey ? robotPubkey.slice(0, 12) + '...' : null
            });
            this.renderMyTrades();
            return true;
        },

        _parseTradeJson: function(trade) {
            try { return trade && trade.trade_json ? JSON.parse(trade.trade_json) : {}; }
            catch(e) { return {}; }
        },

        // Helpers on-chain extraídos a window.Onchain.UI (script.onchain.js). Aquí solo queda
        // el dispatch desde renderMyTrades / handlers. Si Onchain.UI no está cargado por algún
        // motivo, los métodos devuelven HTML/acciones vacías sin romper la ficha Lightning.

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
                _mostroDebug('[Mostro][' + callerLabel + '] Range order exhausted; no child order needed', trade && trade.order_id, 'remaining=', remaining, 'min=', bounds.min);
                return null;
            }
            if (!trade._pendingNextTrade) {
                var rangeUsesReputation = this._tradeUsesReputation(trade);
                var nextIndex = null;
                if (rangeUsesReputation) {
                    await this.syncTradeIndex(trade.robot_pubkey, trade);
                    nextIndex = await this._nextTradeIndex(true);
                }
                var nextKp = await _generateKeypair(nextIndex);
                // El índice de next_trade (Payload::NextTrade, u32 NO opcional en el protocolo — a
                // diferencia de MessageKind.trade_index, este SIEMPRE tiene que ser un número real,
                // en privacidad total también) es exactamente el índice de derivación NIP-06.
                nextIndex = nextKp.seedIndex;
                var childIdentityFingerprint = rangeUsesReputation
                    ? (trade.identity_fingerprint || '') : 'privacy';
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
                    seed_index: nextKp.seedIndex,
                    identity_fingerprint: childIdentityFingerprint,
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
                        seed_index: nextKp.seedIndex,
                        identity_fingerprint: childIdentityFingerprint,
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
                        '<p class="mo-label">' +
                        _escHtml(t(str_pick_amount_between,
                            MostroBook._formatFiatValue(order.fiatMin),
                            MostroBook._formatFiatValue(order.fiatMax),
                            order.fiatCode || '')) +
                        '</p>' +
                        '<input id="mo-take-amount-' + shortId + '" type="text" class="mostro-invoice-input mo-input mo-input-lg" placeholder="' + _escHtml(MostroBook._formatFiatValue(order.fiatMin)) + '">';
                }
                // Fianza: dentro del diálogo, no en un notify (quedaría bajo el overlay).
                var bondNotice = _bondNoticeText(order);
                var bondHtml = bondNotice
                    ? '<p class="mo-bond-notice">⚠️ ' + _escHtml(bondNotice) + '</p>'
                    : '';
                $('body').dialog({
                    title: str_buy_btc + ' — #' + shortId,
                    type: 'html',
                    content:
                        '<p><strong>' + _escHtml(MostroBook._formatOrderFiatLabel(order)) + '</strong> · ' + _escHtml(order.paymentMethod || '') + '</p>' +
                        bondHtml +
                        amountHtml +
                        '<p class="mo-label">' + str_lnaddr_or_bolt11_receive + '</p>' +
                        '<input id="mo-take-lnaddr-' + shortId + '" type="text" class="mostro-invoice-input mo-input mo-input-lg" placeholder="' + str_user_at_domain_example + '">',
                    buttons: [
                        { text: str_cancel, action: function(e, overlay) {
                            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            resolve(null);
                        }},
                        { text: str_continue, action: function(e, overlay) {
                            var chosen = null;
                            if (order && order.isRange) {
                                var amountRaw = document.getElementById('mo-take-amount-' + shortId).value.trim();
                                chosen = parseFloat(String(amountRaw).replace(',', '.'));
                                if (!isFinite(chosen) || chosen < parseFloat(order.fiatMin) || chosen > parseFloat(order.fiatMax)) {
                                    alert(t(str_fiat_amount_between, MostroBook._formatFiatValue(order.fiatMin), MostroBook._formatFiatValue(order.fiatMax), (order.fiatCode || '')));
                                    return;
                                }
                            }
                            var invoiceInput = document.getElementById('mo-take-lnaddr-' + shortId).value.trim();
                            if (!invoiceInput) {
                                alert(str_enter_lnaddr_or_bolt11);
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
            // Un único payload para bolt11 y para LN address. `Payload::PaymentRequest` de
            // mostro-core es una tupla de TRES elementos: con dos, serde falla al deserializar
            // ("invalid length 2") y el daemon descarta el mensaje sin devolver ni un cant-do.
            // El tercer elemento va siempre null porque `get_amount()` solo lo lee en
            // take-sell/take-buy; en add-invoice el daemon valida contra el `order.amount` de
            // su propia BD y resuelve la LN address él mismo (`is_valid_invoice` →
            // LightningAddress/LnUrl), así que no necesita que le mandemos los sats.
            // Fuente: código de mostro-core/mostro. La doc publicada en mostro.network/protocol/
            // va por detrás del código desde 2024 — no usarla como referencia aquí.
            await this._sendToRobot('add-invoice', { payment_request: [null, val, null] }, trade.robot_pubkey, trade.trade_privkey, trade.order_id, this._tradeIndexOrDefault(trade, 1));
            if (['activo','fiat_enviado','liberando','completado','cancelado','disputado'].indexOf(trade.internal_status) !== -1) {
                delete trade._pendingInvoiceInput;
                if (trade.internal_status === 'liberando') {
                    trade._invoiceSubmitted = true;
                }
                this.renderMyTrades();
                return true;
            }
            // trade_action debe pisar el 'released'/'payment-failed' anterior; si no, normalizeMostroTradeRow re-promueve internal_status a 'liberando' en la siguiente lectura.
            await this._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'esperando_pago_vendedor', status: 'add-invoice', trade_action: 'add-invoice' } });
            delete trade._pendingInvoiceInput;
            trade.internal_status = 'esperando_pago_vendedor';
            trade.status = 'add-invoice';
            trade.trade_action = 'add-invoice';
            trade.updated_at = Math.floor(Date.now() / 1000);
            this.renderMyTrades();
            return true;
        },

        // Orden de campos = struct real MessageKind de mostro-core (message.rs), verificado leyendo
        // el código fuente (no la spec): version, request_id, trade_index, id (omitido si no hay,
        // como el #[serde(skip_serializing_if = "Option::is_none")] real), action, payload. Importa
        // porque el daemon NO verifica la firma contra los bytes recibidos: deserializa a Message y
        // re-serializa con serde_json::to_string(&self) para hashear (transport.rs::unwrap_message_nip44).
        // Si el orden no coincide byte a byte, tradeSig/identityProof (modo reputación) se descartan
        // en silencio — bug real encontrado en la auditoría 2026-08-22, corregido aquí.
        _buildMsg: function(action, payload, orderId, reqId, tradeIndex) {
            var inner = { version: 2, request_id: reqId || 0, trade_index: tradeIndex || null };
            if (orderId) inner.id = orderId;
            inner.action = action;
            inner.payload = payload || null;
            return { order: inner };
        },

        // Solo se conserva para finalizar trades históricos creados antes del esquema conforme.
        // Los nuevos nunca usan la clave social del login como identidad Mostro.
        _hasLocalNsec: function() {
            var E = Noxtr.Events;
            return !!(E && E.privkey && /^[0-9a-f]{64}$/i.test(E.privkey) && E.pubkey);
        },
        _reputationContext: async function(trade) {
            // Para acciones de un trade manda el modo con el que nació, no el toggle actual.
            // trade_index=0/null identifica privacidad total.
            if (trade && !this._tradeUsesReputation(trade)) return null;
            if (!trade && !this._isReputationMode()) return null;

            var fingerprint = trade && /^[a-f0-9]{64}$/i.test(trade.identity_fingerprint || '')
                ? String(trade.identity_fingerprint).toLowerCase() : '';
            if (await this.ensureSeed()) {
                // Nuevos trades conformes y consultas de la sesión actual.
                if (!trade || fingerprint === this._identityPub) {
                    return { masterPub: this._identityPub, masterPriv: this._identityPriv };
                }
            }

            // Compatibilidad exclusivamente para operaciones antiguas: antes no se guardaba
            // identity_fingerprint y el identity proof se firmaba con el nsec social.
            if (trade && !fingerprint && this._hasLocalNsec()) {
                return { masterPub: Noxtr.Events.pubkey, masterPriv: Noxtr.Events.privkey, legacy: true };
            }
            console.warn('[Mostro] No se encuentra la identidad asociada al trade', trade && trade.order_id);
            return null;
        },

        // Toggle de reputación para trades NUEVOS. La clave se deriva de la semilla Mostro, por lo
        // que funciona igual con nsec, NIP-07, NIP-46 o una sesión de lectura Nostr.
        setupReputation: async function() {
            if (!(await this.ensureSeed())) {
                notify('⚠️ No se pudo cargar la semilla de la sesión Mostro.', 'warning', 9000);
                return;
            }
            if (this._isReputationMode()) {
                if (await confirm('¿Desactivar la reputación? Volverás a operar en privacidad total (anónimo).')) {
                    this._setReputationMode(false);
                    notify('Reputación desactivada (privacidad total).', 'info', 4000);
                }
                return;
            }
            var msg = 'Al activar la reputación, los trades nuevos quedan ligados a la identidad de tu sesión Mostro (' +
                this._identityPub.slice(0, 12) + '…), derivada de su semilla como exige el protocolo. ' +
                'No se utiliza tu identidad social Nostr. Si prefieres anonimato, déjalo desactivado.\n\n¿Activar reputación?';
            if (!(await confirm(msg))) return;
            this._setReputationMode(true);
            this._maxTradeIndex = null; // recalcular índice monotónico
            notify('✅ Reputación activada con tu identidad Mostro ' + this._identityPub.slice(0, 12) + '…', 'success', 6000);
        },

        _sendToRobot: async function(action, payload, robotPubkey, tradePrivkey, orderId, tradeIndex) {
            if (!tradePrivkey) { console.error('[Mostro] falta trade key para enviar a la instancia'); return; }
            // Resolver el trade por pubkey también cubre new-order, cuyo UUID aún no existe y por
            // tanto se envía con orderId=null mientras la fila local tiene un id temporal.
            var tradePub = _getPubkeyHex(tradePrivkey);
            var identityTrade = orderId && this._trades[orderId] ? this._trades[orderId] : null;
            if (!identityTrade) {
                identityTrade = Object.values(this._trades || {}).find(function(t) {
                    return t && String(t.trade_key_pub || '').toLowerCase() === tradePub.toLowerCase();
                }) || null;
            }
            // repCtx no-null solo para trades de reputación. La identidad queda fijada por trade;
            // en privacidad total el tuple sigue siendo [msgObj,null,null].
            var repCtx = await this._reputationContext(identityTrade);
            if (identityTrade && this._tradeUsesReputation(identityTrade) && !repCtx) {
                throw new Error('No se puede firmar con la identidad Mostro asociada a este trade');
            }
            var thisReqId = ++this._reqId;
            var msgObj = this._buildMsg(action, payload, orderId, thisReqId, tradeIndex);
            // Para poder comparar request_id de la respuesta más tarde (ver _handleGiftWrap).
            if (orderId && this._trades[orderId]) {
                this._trades[orderId]._lastSentReqId = thisReqId;
                this._trades[orderId]._lastSentAction = action;
            }
            // Auditoría 2026-08-22, hallazgo menor: este console.log iba siempre activo (incluye
            // payload — invoices, LN address...). Ahora solo con noxtr_debug activado.
            _mostroDebug('[Mostro] _sendToRobot msg:', JSON.stringify(msgObj), 'rep=', !!repCtx);
            if (action === 'release' || action === 'fiat-sent') {
                _mostroDebug('[Mostro][SEND]', action, {
                    order_id: orderId || null,
                    trade_index: tradeIndex || null,
                    payload: payload || null,
                    robot_pubkey: robotPubkey ? robotPubkey.slice(0, 12) + '...' : null
                });
            }
            var wrap = await _wrapV2(msgObj, robotPubkey, tradePrivkey, repCtx);
            // Log saliente: el evento kind 14 firmado, antes del publish. raw_json sirve para auditar
            // qué se envió exactamente (action + payload van dentro cifrados, no en claro aquí).
            this._logMostroEv('client_out', wrap, orderId || '', action || '');
            // client_out_plain: pseudo-evento con el contenido EN CLARO (puede incluir invoices/LN
            // address) persistido en NSTR_EVENTS. Antes siempre activo; auditoría 2026-08-22 lo marcó
            // como riesgo menor de exposición en la BD — ahora opt-in, solo con noxtr_debug (mismo
            // flag que ya gobierna el resto del logging detallado de este módulo).
            if (_mostroDebugEnabled()) {
                try {
                    this._logMostroEv('client_out_plain', {
                        id: wrap.id + '_plain',
                        kind: 1,
                        pubkey: _getPubkeyHex(tradePrivkey),
                        created_at: wrap.created_at,
                        content: JSON.stringify(msgObj)
                    }, orderId || '', action || '');
                } catch(e) {}
            }
            Noxtr.Pool.publish(wrap);
            // Also publish directly to mostro relay in case it's not in the pool
            Noxtr.Pool.publishTo('wss://relay.mostro.network', wrap);
            return wrap;
        },

        // Suscripción a los mensajes de trades activos. Transporte v2 (protocol/transport_migration):
        //  - Canal instancia: kind 14 (NIP-44 directo) autoría fijada a los robots (authors) y #p = trade keys.
        //  - Chat peer: kind 14, #p = pub(K_conv) (protocol/chat.html).
        //  - Chat disputa: kind 14, filtrado por authors = pub(K_sign) del canal, no por #p
        //    (protocol/dispute_chat.html: evita que un tercero que observó el tag inunde el canal).
        subscribeMyTrades: async function() {
            var TERMINAL_NO_ROBOT = { 'cancelado': true, 'cancelando': true };
            var TERMINAL_NO_CHAT  = { 'cancelado': true };
            var robotPubs = [], chatAuthors = [], disputeAuthors = [], authorsSet = {};
            var trades = Object.values(this._trades);
            for (var i = 0; i < trades.length; i++) {
                var t = trades[i];
                if (parseInt(t.archived)) continue;
                // Robot messages: skip all terminal states... SALVO que aún pueda llegar el cobro de
                // una fianza. `add-bond-invoice` se pide DESPUÉS de que el trade muera —
                // admin-settled/admin-canceled lo dejan en completado/cancelado y solo entonces el
                // scheduler del daemon reclama la factura del payout, reintentando cada
                // `payout_invoice_window_seconds` durante toda la ventana de reclamación. Cortando
                // la suscripción en terminal, esos reintentos no llegaban NUNCA y el ganador de la
                // disputa se quedaba sin cobrar sin enterarse. Mismo criterio que repTargets más
                // abajo con las valoraciones, que también llegan después de 'completado'.
                if ((!TERMINAL_NO_ROBOT[t.internal_status] && t.internal_status !== 'completado')
                        || _bondPayoutWindowOpen(t)) {
                    if (t.trade_key_pub && t.trade_key_pub.length === 64) {
                        robotPubs.push(t.trade_key_pub);
                        if (t.robot_pubkey && t.robot_pubkey.length === 64) authorsSet[t.robot_pubkey] = 1;
                    }
                }
                // P2P chat: keep even after completado (chat is still valid after trade ends)
                if (!TERMINAL_NO_CHAT[t.internal_status]) {
                    var peerChatPub = _peerChatPubkey(t);
                    if (peerChatPub && !t._chatKey) {
                        if (t.method === 'onchain' && t.peer_pubkey !== peerChatPub) t.peer_pubkey = peerChatPub;
                        try { t._chatKey = await _chatDerivedKeys(t.trade_privkey, peerChatPub); } catch(e) {}
                    }
                    // authors = pub(K_sign), no #p: protocol/chat.html exige suscribir por autor —
                    // filtrar solo por el tag #p (pub(K_conv), observable por cualquiera que vea el
                    // evento) deja el canal abierto a que un tercero lo inunde con eventos ajenos.
                    // {pub, id}: cada chat lleva su conversationId (orderId) para poder pedirlo
                    // con SU propio cursor, como hace chat_cursor_store.dart.
                    if (t._chatKey && t._chatKey.sign.pub) chatAuthors.push({ pub: t._chatKey.sign.pub, id: t.order_id });
                }
                // Dispute chat with admin/solver (Mostro protocol /protocol/dispute_chat.html)
                if (t.solver_pubkey && t.solver_pubkey.length === 64 && t.trade_privkey && !t._disputeChatKey) {
                    try { t._disputeChatKey = await _chatDerivedKeys(t.trade_privkey, t.solver_pubkey); } catch(e) {}
                }
                // El chat de disputa se keyea por disputeId ('dispute_chat_since_'), no por orden.
                if (t._disputeChatKey && t._disputeChatKey.sign.pub) disputeAuthors.push({ pub: t._disputeChatKey.sign.pub, id: t.dispute_id || t.order_id });
            }
            // Auditoría 2026-08-22, alto #8: 38384 (rating global firmado por Mostro). Verificado
            // contra el daemon real (rate_user.rs::prepare_variables_for_vote/util.rs): el tag `d`
            // del 38384 es la TRADE pubkey de la orden que disparó la valoración (order.get_buyer/
            // seller_pubkey()), NO la identidad master del login — Mostro nunca publica un 38384
            // direccionado por Noxtr.Events.pubkey. Para "mi" reputación miramos nuestras propias
            // trade pubkeys de trades hechos en modo reputación (el marcador persistido es
            // identity_fingerprint); para la contraparte, peer_pubkey ya es su trade pubkey. A diferencia de
            // robotPubs (arriba), aquí NO se excluye 'completado': la valoración (rate-user → 38384)
            // llega típicamente DESPUÉS de completar el trade, así que ese es justo el estado en que
            // más falta hace seguir suscritos. Solo se excluyen los archivados (t.archived ya
            // filtrado por el `continue` del bucle principal, pero repTargets es un bucle aparte).
            var repTargets = {};
            for (var j = 0; j < trades.length; j++) {
                var tj = trades[j];
                if (parseInt(tj.archived)) continue;
                if (this._tradeUsesReputation(tj)
                        && tj.trade_key_pub && /^[a-f0-9]{64}$/i.test(tj.trade_key_pub)) {
                    repTargets[tj.trade_key_pub] = 1;
                }
                if (tj.peer_pubkey && /^[a-f0-9]{64}$/i.test(tj.peer_pubkey)) {
                    repTargets[tj.peer_pubkey] = 1;
                }
            }
            var repPubs = Object.keys(repTargets);
            _mostroTrace('[Mostro] subscribeMyTrades robot=', robotPubs, 'chatAuthors=', chatAuthors, 'disputeAuthors=', disputeAuthors, 'repPubs=', repPubs);
            if (!robotPubs.length && !chatAuthors.length && !disputeAuthors.length && !repPubs.length) return;
            if (this._subId) Noxtr.Pool.unsubscribe(this._subId);
            var self = this;
            this._eoseReceived = false;
            // Timestamp en que se abre esta suscripción. Usado como referencia para distinguir
            // eventos "live" (created_at posterior o casi simultáneo) de "histórico"
            // (created_at muy anterior). El callback de EOSE no es fiable porque se dispara
            // per relay y un relay rápido lo dispara antes de que los demás envíen su histórico.
            this._subStartTs = Math.floor(Date.now() / 1000);
            // Lookback por defecto, usado cuando una conversación aún no tiene cursor guardado
            // ("callers fall back to the default lookback" — chat_cursor_store.dart).
            var sevenDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 7;
            // since de una conversación concreta: su cursor si lo hay, acotado por el lookback.
            var _sinceFor = function(kind, id) {
                var c = _cursorFor(kind, id);
                return c > 0 ? Math.max(c, sevenDaysAgo) : sevenDaysAgo;
            };

            // BEGIN EDITADO 20260825
            /* Esto lo añadió Claude pero ese día había bebido y no se dio cuenta de era una cagada
            // Pero la marca es GLOBAL (todos los trades y todos los chats), así que la actividad de
            // unos trades la empuja por delante de eventos aún pendientes de otros. Caso real: un
            // trade se queda en 'liberando' porque el pago al comprador falló; Mostro reintenta a las
            // 2 h y esta vez sí paga, mandando el purchase-completed. Mientras tanto otros trades han
            // movido la marca más allá de ese momento, así que ese evento sale del rango pedido y NO
            // vuelve a pedirse jamás: el trade se queda en 'liberando' para siempre aunque los sats
            // hayan llegado, y sin poder valorar a la contraparte.
            // Solución: retroceder hasta el updated_at más antiguo de los trades sin cerrar. El
            // backlog sigue acotado por el tope de 7 días.
            var oldestOpen = 0;
            for (var oi = 0; oi < trades.length; oi++) {
                var ot = trades[oi];
                if (parseInt(ot.archived)) continue;
                if (TERMINAL_NO_ROBOT[ot.internal_status] || ot.internal_status === 'completado') continue;
                var ots = parseInt(ot.updated_at, 10) || 0;
                if (ots > 0 && (!oldestOpen || ots < oldestOpen)) oldestOpen = ots;
            }
            // Margen de 1 h hacia atrás: updated_at es el del último evento procesado, y el que falta
            // puede ser inmediatamente anterior a él por desorden de entrega del relay.
            if (oldestOpen > 0) since = Math.min(since, Math.max(oldestOpen - 3600, sevenDaysAgo));
            */
            // END EDITADO 20260825

            var filters = [];
            if (robotPubs.length) {
                // Canal de la instancia: lookback completo, SIN cursor. El `since` persistido que
                // especifica el protocolo es para los chats (protocol/chat.html, y el store de
                // Mostro Mobile es explícitamente "for chat subscriptions"); aplicarlo también aquí
                // fue cosa de noxtr, sin fuente, y es lo que hacía que un mensaje de trade pendiente
                // (p.ej. el purchase-completed de un pago reintentado horas después) quedara fuera
                // del rango pedido y no se volviera a pedir nunca.
                var f = { kinds: [14], '#p': robotPubs, since: sevenDaysAgo, limit: 200 };
                var authors = Object.keys(authorsSet);
                if (authors.length) f.authors = authors; // §3.4: desambigua v2 del kind 14 de otros usos
                filters.push(f);
            }
            // Un filtro por conversación, cada uno con SU cursor. Van todos en el mismo REQ (el
            // protocolo Nostr admite varios filtros por suscripción), así que no se abren más
            // suscripciones: solo dejan de compartir un `since` que no les corresponde.
            chatAuthors.forEach(function(c) {
                filters.push({ kinds: [14], authors: [c.pub], since: _sinceFor('chat', c.id), limit: 200 });
            });
            disputeAuthors.forEach(function(d) {
                filters.push({ kinds: [14], authors: [d.pub], since: _sinceFor('dispute', d.id), limit: 200 });
            });
            if (repPubs.length) filters.push({ kinds: [38384], '#d': repPubs, limit: 50 });
            this._subId = Noxtr.Pool.subscribe(
                filters,
                function(ev) { self._handleGiftWrap(ev); },
                function() { self._eoseReceived = true; }
            );
        },

        // Kind 38384: rating global firmado por Mostro. Contenido del evento = "" (vacío) —
        // verificado contra el daemon real (rate_user.rs / util.rs::update_user_rating_event):
        // los datos van en TAGS (Rating::to_tags(): total_reviews, total_rating, last_rating,
        // max_rate, min_rate, más un tag `days` añadido aparte en rate_user.rs), no en content.
        // El tag `d` es la TRADE pubkey de la orden que disparó la valoración, no la identidad
        // master de quien es valorado. La firma la garantiza Mostro (misma pubkey que el robot
        // que emite los 38385/38383) — verificarla contra el conjunto de robots conocidos sería
        // lo ideal, pero ni siquiera guardamos esa lista fuera del 38385 recibido; nos
        // conformamos con confiar en (kind 38384, firma Nostr válida), igual que MostroBook
        // confía en el rating del 38383 sin cotejo cruzado.
        _handle38384: async function(ev) {
            try {
                if (!ev || ev.kind !== 38384 || !(await _verifyNostrSig(ev))) return;
                var tags = ev.tags || [];
                var dTag = tags.find(function(t) { return t[0] === 'd'; });
                if (!dTag || !dTag[1] || !/^[a-f0-9]{64}$/i.test(dTag[1])) return;
                var pub = dTag[1].toLowerCase();
                // La valoración de una trade key la firma la instancia de ese trade. La firma
                // Nostr por sí sola solo demuestra que el evento pertenece a *alguna* pubkey.
                var trustedRobot = false;
                for (var toid in this._trades) {
                    var tt = this._trades[toid];
                    if (!tt) continue;
                    var targets = [tt.trade_key_pub, tt.peer_pubkey].map(function(p) { return String(p || '').toLowerCase(); });
                    if (targets.indexOf(pub) !== -1 && String(tt.robot_pubkey || '').toLowerCase() === String(ev.pubkey).toLowerCase()) {
                        trustedRobot = true; break;
                    }
                }
                if (!trustedRobot) return;
                // 38384 es addressable (NIP-33) pero UNA pubkey (una trade key) por evento — con
                // varios trades en modo reputación llegan varios 38384 de distintas trade keys, cada
                // uno con el agregado vigente EN LA FECHA en que se publicó. Mismo guard que
                // MostroBook._robotStatusAt usa con el 38385: descartar si ya hay uno más nuevo
                // guardado para esa misma pubkey (un relay rezagado puede servir una generación vieja).
                var prevRep = MostroBook._reputation38384[pub];
                if (prevRep && prevRep._created_at != null && ev.created_at < prevRep._created_at) return;
                var getTag = function(k) {
                    var t = tags.find(function(x) { return x[0] === k; });
                    return t ? t[1] : null;
                };
                var reviews = parseInt(getTag('total_reviews'), 10) || 0;
                var avg = parseFloat(getTag('total_rating')) || 0;
                var days = parseInt(getTag('days'), 10) || 0;
                if (!reviews && !days) return; // dato vacío, no informativo
                var rating = { total_reviews: reviews, total_rating: avg, days: days, _created_at: ev.created_at };
                MostroBook._reputation38384[pub] = rating;
                // Si esta pubkey coincide con la peer de algún trade activo, guardarla también
                // como peer rep (mismo helper que usa el maker vía 38383) — así la tarjeta la
                // pinta sin tocar el render. Para nuestra propia reputación no aplica: se lee
                // directamente de MostroBook._reputation38384 en renderMyTrades (ver PARTE C).
                for (var oid in this._trades) {
                    var tr = this._trades[oid];
                    if (tr && tr.peer_pubkey && tr.peer_pubkey.toLowerCase() === pub) {
                        var existing = _loadPeerRep(tr.order_id);
                        if (!existing || (parseInt(existing.total_reviews, 10) || 0) < reviews) {
                            _savePeerRep(tr.order_id, rating);
                        }
                    }
                }
                this.renderMyTrades();
            } catch(e) {}
        },

        _handleGiftWrap: async function(ev) {
            if (ev && ev.kind === 38384) { this._handle38384(ev); return; }
            if (!ev || !ev.id) return;
            var _eventFingerprint = ev.id + ':' + String(ev.sig || '');
            _mostroTrace('[Mostro] _handleGiftWrap called ev.id=', ev.id,
                'seen=', !!this._seenEvIds[ev.id], 'processing=', !!this._processingEvFingerprints[_eventFingerprint]);
            if (this._seenEvIds[ev.id] || this._processingEvFingerprints[_eventFingerprint]
                    || this._rejectedEvFingerprints[_eventFingerprint]) return;
            // Una copia simultánea llegada por otro relay queda reservada mientras se procesa la
            // primera. A diferencia de `_seenEvIds`, esta marca SIEMPRE se retira en finally: si no
            // había trade cargado, faltaba la clave o falló el descifrado, un replay posterior debe
            // poder intentarlo otra vez. Es el mismo criterio adoptado por MostroMobile v1.4.1.
            this._processingEvFingerprints[_eventFingerprint] = true;
            var _markProcessed = false;
            var _markRejectedFingerprint = false;
            try {
            // isLive basado en el timestamp del evento, no en el flag EOSE. El flag EOSE se dispara
            // per relay (script.js:363) — un relay rápido lo pone a true mientras otros aún envían
            // histórico, marcando esos eventos como "en vivo" erróneamente. Comparamos con el
            // timestamp de apertura de la suscripción: eventos creados antes son histórico,
            // eventos creados después (con margen de 30s para clock drift) son live.
            var evCreatedAt = parseInt(ev && ev.created_at, 10) || 0;
            var subStart = this._subStartTs || 0;
            var isLive = subStart > 0 && evCreatedAt >= (subStart - 30);
            // Marca de agua para acotar el backlog en la próxima suscripción (protocol/chat.html:
            // "bound the backlog"). Se actualiza con cualquier evento nuevo entregado por el canal
            // autenticado (authors-filtered), llegue a desempaquetarse bien o no: si un evento no
            // verifica, no vamos a recuperarlo pidiéndolo de nuevo la próxima vez.
            // El cursor ya NO se avanza aquí. Se hacía antes de saber a qué conversación pertenecía
            // el evento, con una única marca global: cualquier evento adelantaba el cursor de TODAS
            // las conversaciones. Ahora se avanza por conversación y solo al aceptar el evento
            // (_advanceCursor), como en chat_cursor_store.dart de Mostro Mobile.
            // Log el evento crudo (cifrado). order_id se asigna cuando el rumor se desempaqueta.
            this._logMostroEv('client_in', ev, '', 'received');
            // Find matching trade first to check timestamp
            var pTags = (ev.tags || []).filter(function(t) { return t[0]==='p'; }).map(function(t) { return t[1]; });
            _mostroTrace('[Mostro] kind 14 received ev.id=', ev.id, 'p-tags=', pTags);
            // Match by trade_key_pub → robot message
            var trade = null, isP2P = false, tradePrivForUnwrap = null;
            // Si hay varios trades con la MISMA trade_key_pub (filas históricas con seed_index
            // reusado, bug 2026-08-23), preferir el no terminal: quedarse con el primero que
            // casara podía atribuir un pay-bond-invoice en vivo a un gemelo viejo cancelado
            // ('cancelado' ∈ _noQr) y el QR de fianza no salía hasta recargar (al recargar
            // loadMyTrades reinserta los activos primero y el match cambiaba de ganador).
            var _termMatch = { 'cancelado': 1, 'completado': 1 };
            for (var oid in this._trades) {
                var t = this._trades[oid];
                if (t.trade_key_pub && pTags.indexOf(t.trade_key_pub) !== -1) {
                    if (!trade || (_termMatch[trade.internal_status] && !_termMatch[t.internal_status])) {
                        trade = t;
                        tradePrivForUnwrap = t.trade_privkey;
                    }
                    if (!_termMatch[trade.internal_status]) break;
                }
            }
            // Match by chat derived key (K_conv) → P2P message
            if (!trade) {
                for (var oid in this._trades) {
                    var t = this._trades[oid];
                    if (t._chatKey && t._chatKey.conv.pub && pTags.indexOf(t._chatKey.conv.pub) !== -1) {
                        trade = t; isP2P = true; break;
                    }
                }
            }
            // Match by dispute chat derived key (K_conv) → solver/admin message
            var isDispute = false;
            if (!trade) {
                for (var oid in this._trades) {
                    var t = this._trades[oid];
                    if (t._disputeChatKey && t._disputeChatKey.conv.pub && pTags.indexOf(t._disputeChatKey.conv.pub) !== -1) {
                        trade = t; isDispute = true; break;
                    }
                }
            }
            if (!trade) { _mostroTrace('[Mostro] kind 14 no matching trade (retryable)'); return; }

            if (isP2P || isDispute) {
                // La validación completa del outer y el inner se hace atómicamente en _p2pUnwrap.
            }

            if (isP2P) {
                var expectedPeer = _peerChatPubkey(trade);
                var p2p = await _p2pUnwrap(ev, trade._chatKey, {
                    expectedAuthor: trade._chatKey.sign.pub,
                    conversationId: 'peer-' + trade.order_id,
                    allowedSigners: [expectedPeer, trade.trade_key_pub]
                });
                if (p2p) {
                    // Exigir exactamente la contraparte conocida del trade (no "cualquiera que no sea
                    // yo"): rechaza remitentes forjados y de paso sigue filtrando el eco de mensajes
                    // propios, ya que la propia trade key nunca coincide con la del peer.
                    if (!expectedPeer || p2p.senderPub.toLowerCase() !== expectedPeer.toLowerCase()) {
                        console.warn('[Mostro] P2P chat: descartando mensaje de pubkey inesperada', p2p.senderPub);
                        _markProcessed = true; // válido pero concluyentemente ajeno/eco
                        return;
                    }
                    var msgTs = parseInt(p2p && p2p.created_at, 10) || 0;
                    // El rumor interno (kind:1) lleva la hora real del envío (msgTs), así que la usamos
                    // para decidir si es "nuevo" (después de cargar la página) y por tanto notificar
                    // y auto-abrir el chat.
                    var shouldNotifyChat = msgTs > 0 ? (msgTs >= this._chatNotifyCutoffTs) : isLive;
                    this._receiveChatMsg(trade, p2p.text, !shouldNotifyChat);
                    // "Moves the cursor forward after accepting an event" (chat_cursor_store.dart):
                    // solo tras aceptarlo, y solo el de ESTA conversación.
                    _advanceCursor('chat', trade.order_id, evCreatedAt);
                    _markProcessed = true;
                }
                return;
            }

            if (isDispute) {
                var ownDisputePub = trade.trade_key_pub || (trade.trade_privkey ? _getPubkeyHex(trade.trade_privkey) : '');
                var dmsg = await _p2pUnwrap(ev, trade._disputeChatKey, {
                    expectedAuthor: trade._disputeChatKey.sign.pub,
                    conversationId: 'dispute-' + (trade.dispute_id || trade.order_id),
                    allowedSigners: [ownDisputePub, trade.solver_pubkey]
                });
                if (dmsg && String(dmsg.senderPub).toLowerCase() !== String(ownDisputePub).toLowerCase()) {
                    var sender = String(dmsg.senderPub || '').toLowerCase();
                    if (!trade.solver_pubkey || sender !== String(trade.solver_pubkey).toLowerCase()) {
                        console.warn('[Mostro] dispute chat: discarding message from unknown pubkey', sender);
                        _markProcessed = true;
                        return;
                    }
                    var msgTs2 = parseInt(dmsg && dmsg.created_at, 10) || 0;
                    var shouldNotifyDispute = isLive && (!msgTs2 || msgTs2 >= this._chatNotifyCutoffTs);
                    this._receiveDisputeChatMsg(trade, dmsg.text, !shouldNotifyDispute, {
                        ts: dmsg.created_at * 1000, id: dmsg.innerId, from: 'admin'
                    });
                    this._storeDisputeChatEnvelope(trade, ev, 'in');
                    // Store separado y keyeado por disputeId, igual que su 'dispute_chat_since_'.
                    _advanceCursor('dispute', trade.dispute_id, evCreatedAt);
                }
                if (dmsg) _markProcessed = true; // incluye el eco propio, que es concluyente
                return;
            }

            // Canal instancia v2: verificar la firma del kind 14 antes de descifrar. El filtro
            // authors de la suscripción ya restringe qué debería llegar, pero un relay no está
            // obligado a respetarlo (es una petición, no una garantía criptográfica) — la única
            // prueba real de que el mensaje lo firmó el nodo es esta verificación local.
            if (!(await _verifyNostrSig(ev))) {
                console.warn('[Mostro] firma del kind 14 del nodo inválida, descartado', ev.id);
                this._logMostroEv('client_in', ev, trade && trade.order_id, 'bad_signature');
                // La firma NO forma parte del event id. Un relay hostil puede copiar id+contenido
                // legítimos y sustituir solo la firma: marcar el ID como visto bloquearía después
                // la copia auténtica. Se deduplica la combinación id+sig rechazada, no el id solo.
                _markRejectedFingerprint = true;
                return;
            }
            
            // La firma prueba que el evento no está manipulado, NO quién lo mandó. El match del
            // trade es por tag #p = trade_key_pub, que es pública (es el autor de nuestros propios
            // kind 14), así que cualquiera puede cifrarnos un kind 14 bien firmado y colar acciones
            // del nodo. El filtro `authors` de la suscripción es una petición al relay, no una
            // garantía. Única prueba real: el autor es el robot de ESTE trade.
            if (!trade.robot_pubkey ||
                String(ev.pubkey).toLowerCase() !== String(trade.robot_pubkey).toLowerCase()) {
                console.warn('[Mostro] kind 14 con autor distinto del nodo del trade, descartado',
                    ev.pubkey, '!=', trade.robot_pubkey);
                this._logMostroEv('client_in', ev, trade && trade.order_id, 'bad_author');
                _markProcessed = true; // autor ajeno: rechazo criptográfico concluyente
                return;
            }

            // Canal instancia v2: kind 14 NIP-44 directo. Se descifra en 1 capa (tuple[0] = msgObj).
            // El created_at del kind 14 es real, así que sirve
            // de rumor sintético para el resto del flujo (log, isLive) sin cambios aguas abajo.
            var msgObj = await _unwrapV2(ev, tradePrivForUnwrap || trade.trade_privkey);
            if (!msgObj) {
                _mostroTrace('[Mostro] _unwrapV2 null (decryption failed) ev.id=', ev.id);
                this._logMostroEv('client_in', ev, trade && trade.order_id, 'unwrap_failed');
                return;
            }
            var rumor = { content: JSON.stringify(msgObj), created_at: ev.created_at, pubkey: ev.pubkey, id: ev.id };
            try {
                // Mostro usa el nombre de la acción como clave del wrapper:
                // {"order": {...}} para órdenes, {"cant-do": {...}} para errores,
                // {"dispute": {...}} para disputas, etc. La estructura interna es uniforme
                // (id, action, payload, request_id, ...), solo cambia el nombre de la clave externa.
                var order = {};
                if (msgObj && typeof msgObj === 'object') {
                    if (msgObj.order && typeof msgObj.order === 'object') {
                        order = msgObj.order;
                    } else {
                        var keys = Object.keys(msgObj);
                        if (keys.length > 0 && msgObj[keys[0]] && typeof msgObj[keys[0]] === 'object') {
                            order = msgObj[keys[0]];
                        }
                    }
                }
                var action = order.action;
                // Correlación de request_id (auditoría 2026-08-22, hallazgo menor: se incrementaba
                // pero nunca se comprobaba contra la respuesta). No bloqueante — MessageKind.request_id
                // es "echoed back on responses" según el struct real, así que un mensaje del daemon SIN
                // relación con nuestra última petición a ESTE trade es una señal real de desorden
                // (relay entregando fuera de orden, replay, etc.), útil para detectar bugs de protocolo
                // sin necesitar un mecanismo nuevo de petición/respuesta que reemplace el despacho por
                // acción ya existente.
                if (trade && trade._lastSentReqId != null && order.request_id != null
                        && order.request_id !== trade._lastSentReqId) {
                    _mostroDebugWarn('[Mostro] request_id de la respuesta no coincide con la última petición',
                        { trade: trade.order_id, action: action, esperado: trade._lastSentReqId, recibido: order.request_id });
                }
                // Log el rumor desempaquetado (legible). order.id puede no estar en mensajes tempranos.
                this._logMostroEv('client_rumor', rumor, order.id || (trade && trade.order_id) || '', action || '');
                if (order.id && this._trades[order.id] && this._trades[order.id] !== trade) {
                    _mostroDebug('[Mostro][RECV] rematched by order.id', {
                        event_id: ev.id,
                        from_order_id: trade && trade.order_id,
                        to_order_id: order.id,
                        action: action || null
                    });
                    trade = this._trades[order.id];
                }
                _mostroTrace('[Mostro] action=', action, 'order_id=', (order.id || '').slice(0,8), 'trade=', trade && trade.order_id ? trade.order_id.slice(0,8) : '?');
                var payload = order.payload || null;
                if (action) {
                    var adminGuard = this._checkAdminDisputeMessage(action, payload, trade, order);
                    if (!adminGuard.allowed) {
                        var adminRejectLog = adminGuard.reason === 'dispute_already_terminal'
                            ? _mostroTrace : _mostroDebugWarn;
                        adminRejectLog('[Mostro] acción admin rechazada antes de tocar estado/UI', {
                            action: action,
                            order_id: order.id || (trade && trade.order_id) || null,
                            tracked_dispute: trade && trade.dispute_id || null,
                            reason: adminGuard.reason
                        });
                        this._logMostroEv('client_in', ev, trade && trade.order_id,
                            'rejected_admin_' + adminGuard.reason);
                        if (adminGuard.retryable) {
                            this._deferAdminEvent(ev, trade, adminGuard.reason);
                            // No deduplicar todavía: al hidratarse la disputa se reintentará el
                            // mismo evento desde _deferredAdminEvents.
                            return;
                        }
                        // Mismatch o replay terminal: rechazo definitivo, no repetir ni ejecutar
                        // notificaciones, cambios de estado, timers o chats.
                        _markProcessed = true;
                        return;
                    }
                    if (action === 'releasing' || action === 'released' || action === 'success' || action === 'hold-invoice-payment-settled' || action === 'purchase-completed' || action === 'cant-do' || action === 'fiat-sent' || action === 'fiat-sent-ok') {
                        _mostroDebug('[Mostro][RECV]', action, {
                            matched_order_id: trade && trade.order_id,
                            current_status: trade && trade.internal_status,
                            trade_index: order.trade_index || null,
                            payload: payload || null
                        });
                    }
                    // Esperar también la persistencia en BD. Antes el evento quedaba deduplicado
                    // mientras esta promesa seguía en vuelo; un fallo de AJAX lo perdía hasta
                    // recargar la página.
                    await this._processRobotAction(action, payload, trade, order, null, isLive, parseInt(rumor.created_at, 10) || 0);
                    if (action === 'dispute-initiated-by-you' || action === 'dispute-initiated-by-peer') {
                        this._retryDeferredAdminEvents(trade.order_id);
                    }
                }
                // Un sobre correctamente autenticado y descifrado ya es concluyente, incluso si su
                // payload no trae action: no tiene sentido gastar CPU repitiendo basura del nodo.
                _markProcessed = true;
            } catch(e) {
                console.error('[Mostro] fallo procesando kind 14; se deja reintentable', ev.id, e);
            }
            } finally {
                delete this._processingEvFingerprints[_eventFingerprint];
                if (_markProcessed && !this._seenEvIds[ev.id]) {
                    this._seenEvIds[ev.id] = true;
                    this._seenEvOrder.push(ev.id);
                    if (this._seenEvOrder.length > 2000) {
                        delete this._seenEvIds[this._seenEvOrder.shift()];
                    }
                }
                if (_markRejectedFingerprint && !this._rejectedEvFingerprints[_eventFingerprint]) {
                    this._rejectedEvFingerprints[_eventFingerprint] = true;
                    this._rejectedEvOrder.push(_eventFingerprint);
                    if (this._rejectedEvOrder.length > 500) {
                        delete this._rejectedEvFingerprints[this._rejectedEvOrder.shift()];
                    }
                }
            }
        },

        // Notificación de escritorio para un cambio de estado del trade (orden tomada, acción
        // requerida, liberado, disputa). Al hacer click abre la pestaña Mercado.
        _notifyDesktop: function(action, trade) {
            var id = (trade.order_id || '').slice(0, 8);
            var title;
            switch (action) {
                case 'buyer-took-order': case 'waiting-buyer-invoice':
                case 'pay-invoice': case 'waiting-seller-to-pay': case 'add-invoice':
                    title = '✅ ' + (trade.trade_role === 'created' ? t(str_notif_order_taken, id) : t(str_notif_action_needed, id));
                    break;
                case 'fiat-sent': case 'fiat-sent-ok':
                    title = '⚠️ ' + t(str_notif_action_needed, id); break;
                case 'released': case 'releasing': case 'success':
                case 'hold-invoice-payment-settled': case 'purchase-completed':
                    title = '💸 ' + t(str_notif_released_n, id); break;
                case 'dispute': case 'dispute-initiated-by-peer': case 'dispute-initiated-by-you':
                    title = '⚖️ ' + t(str_notif_dispute_n, id); break;
                default:
                    title = '🔄 ' + t(str_notif_trade_update, id);
            }
            window.NoxtrNotify.push(title, str_notif_body_open, {
                tag: 'noxtr-trade-' + trade.order_id,
                onclick: function(){ var tab = document.querySelector('.noxtr-tab[data-tab="mostro"]'); if (tab) tab.click(); }
            });
        },

        // Los mensajes nuevos no roban el foco ni despliegan la ficha. Se acumula un contador en
        // memoria y se refleja inmediatamente en la cabecera; desaparece solo cuando el usuario
        // abre/activa expresamente ese trade.
        _markTradeUnread: function(trade) {
            if (!trade || !trade.order_id) return;
            trade._unreadMessages = (parseInt(trade._unreadMessages, 10) || 0) + 1;
            try { localStorage.setItem('noxtr_mostro_unread_' + trade.order_id, String(trade._unreadMessages)); } catch(e) {}
            var el = document.getElementById('mostro-trades');
            if (!el) return;
            var card = el.querySelector('.mostro-trade-card[data-id="' + trade.order_id + '"]');
            if (!card) return;
            card.classList.add('mostro-trade-has-unread');
            var badge = card.querySelector('.mostro-trade-unread-badge');
            if (badge) {
                badge.textContent = '💬 ' + trade._unreadMessages;
                badge.hidden = false;
            }
        },

        _clearTradeUnread: function(trade, card) {
            if (!trade) return;
            trade._unreadMessages = 0;
            try { localStorage.removeItem('noxtr_mostro_unread_' + trade.order_id); } catch(e) {}
            if (!card) {
                var el = document.getElementById('mostro-trades');
                card = el && el.querySelector('.mostro-trade-card[data-id="' + trade.order_id + '"]');
            }
            if (!card) return;
            card.classList.remove('mostro-trade-has-unread', 'mostro-trade-flash');
            var badge = card.querySelector('.mostro-trade-unread-badge');
            if (badge) badge.hidden = true;
        },

        _receiveChatMsg: function(trade, text, silent) {
            if (!trade._chatMsgs) trade._chatMsgs = [];
            trade._chatMsgs.push({ from: 'peer', text: text, ts: Date.now() });
            this._renderChatBox(trade);
            if (!silent) {
                var el = document.getElementById('mostro-trades');
                var card = el && el.querySelector('.mostro-trade-card[data-id="' + trade.order_id + '"]');
                var isOpen = !!(card && card.classList.contains('active-trade')
                    && !card.classList.contains('mostro-trade-collapsed'));
                if (isOpen) {
                    // Si el usuario ya está mirando este trade, mostrar directamente el chat.
                    var box = card.querySelector('.mostro-chat-box[data-id="' + trade.order_id + '"]');
                    if (box) box.classList.add('mostro-chat-open');
                } else this._markTradeUnread(trade);
                this._flashTradeCard(trade.order_id);
                notify('💬 ' + t(str_chat_msg_from_peer, (trade.order_id||'').slice(0,8)), 'info', 5000);
                if (typeof window !== 'undefined' && window.NoxtrNotify) {
                    window.NoxtrNotify.push('💬 ' + t(str_notif_chat_n, (trade.order_id||'').slice(0,8)),
                        String(text || '').slice(0, 120), { tag: 'noxtr-chat-' + trade.order_id });
                }
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
                    '<span class="mostro-chat-who">' + (m.from === 'me' ? str_you : str_counterparty) + ':</span> ' +
                    _escHtml(m.text) +
                    (timeStr ? '<span class="mostro-chat-ts">' + timeStr + '</span>' : '') +
                    '</div>';
            }).join('');
            msgs.scrollTop = msgs.scrollHeight;
        },

        _sendChatMsg: async function(trade, text) {
            if (!text) return;
            var peerChatPub = _peerChatPubkey(trade);
            if (!peerChatPub) { notify(str_peer_key_unknown_yet, 'warning', 4000); return; }
            if (!trade.trade_privkey) { notify(str_trade_key_not_found, 'error', 3000); return; }
            if (!trade._chatKey) {
                if (trade.method === 'onchain' && trade.peer_pubkey !== peerChatPub) trade.peer_pubkey = peerChatPub;
                try { trade._chatKey = await _chatDerivedKeys(trade.trade_privkey, peerChatPub); } catch(e) {}
            }
            if (!trade._chatKey) { notify(str_chat_crypto_prepare_err, 'error', 3000); return; }
            if (!trade._chatMsgs) trade._chatMsgs = [];
            trade._chatMsgs.push({ from: 'me', text: text, ts: Date.now() });
            this._renderChatBox(trade);
            try {
                var tradePubHex = trade.trade_key_pub || _getPubkeyHex(trade.trade_privkey);
                var wrap = await _p2pWrap(text, trade.trade_privkey, tradePubHex, trade._chatKey);
                Noxtr.Pool.publish(wrap);
            } catch(e) {
                console.error('[Mostro] Error enviando chat:', e);
                notify(str_chat_send_err, 'error', 3000);
            }
        },

        // ── Dispute chat (admin/solver) — Mostro protocol /protocol/dispute_chat.html ──
        _receiveDisputeChatMsg: function(trade, text, silent, meta) {
            meta = meta || {};
            if (!trade._disputeChatMsgs) trade._disputeChatMsgs = [];
            if (meta.id && trade._disputeChatMsgs.some(function(m) { return m.id === meta.id; })) return;
            trade._disputeChatMsgs.push({
                from: meta.from || 'admin', text: text,
                ts: meta.ts || Date.now(), id: meta.id || ''
            });
            trade._disputeChatMsgs.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
            this._renderDisputeChatBox(trade);
            if (!silent) {
                var el = document.getElementById('mostro-trades');
                var card = el && el.querySelector('.mostro-trade-card[data-id="' + trade.order_id + '"]');
                var isOpen = !!(card && card.classList.contains('active-trade')
                    && !card.classList.contains('mostro-trade-collapsed'));
                if (isOpen) {
                    var box = card.querySelector('.mostro-dispute-chat-box[data-id="' + trade.order_id + '"]');
                    if (box) box.classList.add('mostro-chat-open');
                } else this._markTradeUnread(trade);
                this._flashTradeCard(trade.order_id);
                notify('🛡️ ' + t(str_admin_msg_in_dispute, (trade.order_id||'').slice(0,8)), 'info', 6000);
                if (typeof window !== 'undefined' && window.NoxtrNotify) {
                    window.NoxtrNotify.push('🛡️ ' + t(str_notif_dispute_n, (trade.order_id||'').slice(0,8)),
                        String(text || '').slice(0, 120), { tag: 'noxtr-dispute-chat-' + trade.order_id });
                }
            }
        },

        _storeDisputeChatEnvelope: function(trade, wrap, direction) {
            if (!trade || !wrap || !wrap.id) return;
            try {
                this._ajax('mostro_dispute_chat_store', {
                    order_id: trade.order_id,
                    direction: direction === 'out' ? 'out' : 'in',
                    raw_json: JSON.stringify(wrap)
                });
            } catch(e) {}
        },

        _loadDisputeChatHistory: async function(trade) {
            if (!trade || !trade.solver_pubkey || !trade.trade_privkey) return;
            try {
                if (!trade._disputeChatKey) {
                    trade._disputeChatKey = await _chatDerivedKeys(trade.trade_privkey, trade.solver_pubkey);
                }
                var ownPub = trade.trade_key_pub || _getPubkeyHex(trade.trade_privkey);
                var res = await this._ajax('mostro_dispute_chat_history', { order_id: trade.order_id });
                if (!res || !res.ok || !Array.isArray(res.events)) return;
                for (var i = 0; i < res.events.length; i++) {
                    var row = res.events[i], wrap = null;
                    try { wrap = JSON.parse(row.raw_json || ''); } catch(e) { continue; }
                    var msg = await _p2pUnwrap(wrap, trade._disputeChatKey, {
                        expectedAuthor: trade._disputeChatKey.sign.pub,
                        conversationId: 'dispute-' + (trade.dispute_id || trade.order_id),
                        allowedSigners: [ownPub, trade.solver_pubkey],
                        skipRate: true,
                        skipDedup: true
                    });
                    if (!msg) continue;
                    _p2pSeenInnerId(msg.innerId, 'dispute-' + (trade.dispute_id || trade.order_id), msg.created_at);
                    this._receiveDisputeChatMsg(trade, msg.text, true, {
                        ts: msg.created_at * 1000,
                        id: msg.innerId,
                        from: String(msg.senderPub).toLowerCase() === String(ownPub).toLowerCase() ? 'me' : 'admin'
                    });
                }
            } catch(e) { console.warn('[Mostro] no se pudo reconstruir el chat de disputa', e); }
        },

        _renderDisputeChatBox: function(trade) {
            var el = document.getElementById('mostro-trades');
            if (!el) return;
            var box = el.querySelector('.mostro-dispute-chat-box[data-id="' + trade.order_id + '"]');
            if (!box) return;
            var msgs = box.querySelector('.mostro-chat-msgs');
            if (!msgs) return;
            msgs.innerHTML = (trade._disputeChatMsgs || []).map(function(m) {
                var timeStr = m.ts ? new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
                var who = m.from === 'me' ? str_you : str_admin;
                return '<div class="mostro-chat-msg mostro-chat-' + m.from + '">' +
                    '<span class="mostro-chat-who">' + who + ':</span> ' +
                    _escHtml(m.text) +
                    (timeStr ? '<span class="mostro-chat-ts">' + timeStr + '</span>' : '') +
                    '</div>';
            }).join('');
            msgs.scrollTop = msgs.scrollHeight;
        },

        _sendDisputeChatMsg: async function(trade, text) {
            if (!text) return;
            if (!trade.solver_pubkey) { notify(str_no_admin_in_dispute_yet, 'warning', 4000); return; }
            if (!trade.trade_privkey) { notify(str_trade_key_not_found, 'error', 3000); return; }
            if (!trade._disputeChatKey) {
                try { trade._disputeChatKey = await _chatDerivedKeys(trade.trade_privkey, trade.solver_pubkey); } catch(e) {}
            }
            if (!trade._disputeChatKey) { notify(str_dispute_chat_crypto_err, 'error', 3000); return; }
            try {
                var tradePubHex = trade.trade_key_pub || _getPubkeyHex(trade.trade_privkey);
                var wrap = await _p2pWrap(text, trade.trade_privkey, tradePubHex, trade._disputeChatKey);
                var sent = await _p2pUnwrap(wrap, trade._disputeChatKey, {
                    expectedAuthor: trade._disputeChatKey.sign.pub,
                    conversationId: 'dispute-' + (trade.dispute_id || trade.order_id),
                    allowedSigners: [tradePubHex, trade.solver_pubkey],
                    skipRate: true,
                    skipDedup: true
                });
                Noxtr.Pool.publish(wrap);
                this._storeDisputeChatEnvelope(trade, wrap, 'out');
                if (sent) {
                    _p2pSeenInnerId(sent.innerId, 'dispute-' + (trade.dispute_id || trade.order_id), sent.created_at);
                    this._receiveDisputeChatMsg(trade, sent.text, true, {
                        ts: sent.created_at * 1000, id: sent.innerId, from: 'me'
                    });
                }
            } catch(e) {
                console.error('[Mostro] Error enviando chat de disputa:', e);
                notify(str_dispute_chat_send_err, 'error', 3000);
            }
        },

        // MostroMobile v1.4.1 endureció esta misma frontera: un admin-* firmado por el nodo solo
        // tiene sentido como continuación de una disputa que ESTE trade ya conoce. La firma del
        // nodo evita falsificaciones de terceros, pero no basta contra mensajes auténticos
        // reproducidos, fuera de orden o asociados por error a otra orden/disputa.
        _checkAdminDisputeMessage: function(action, payload, trade, orderMeta) {
            var adminActions = [
                'admin-took-dispute', 'admin-take-dispute',
                'admin-settled', 'admin-settle',
                'admin-canceled', 'admin-cancel'
            ];
            if (adminActions.indexOf(action) === -1) return { allowed: true, admin: false };
            if (!trade) return { allowed: false, admin: true, retryable: true, reason: 'trade_not_loaded' };

            var orderId = String(orderMeta && orderMeta.id || '');
            if (orderId && orderId !== String(trade.order_id || '')) {
                return { allowed: false, admin: true, retryable: false, reason: 'order_id_mismatch' };
            }

            var trackedId = String(trade.dispute_id || '');
            if (!trackedId) {
                // Puede ser simple desorden entre relays: guardar y reintentar cuando llegue el
                // dispute-initiated que contiene el UUID. Nunca se aplica mientras falte evidencia.
                return { allowed: false, admin: true, retryable: true, reason: 'no_tracked_dispute' };
            }

            var raw = payload && (payload.dispute || payload.dispute_id);
            var payloadId = '';
            if (Array.isArray(raw)) payloadId = String(raw[0] || '');
            else if (raw && typeof raw === 'object') payloadId = String(raw.dispute_id || raw.id || '');
            else if (raw) payloadId = String(raw);
            // Las confirmaciones legítimas suelen llevar payload=null. Si deciden nombrar una
            // disputa, tiene que ser exactamente la que ya sigue la orden.
            if (payloadId && payloadId !== trackedId) {
                return { allowed: false, admin: true, retryable: false, reason: 'dispute_id_mismatch' };
            }

            var publicState = (typeof MostroBook !== 'undefined' && MostroBook.disputeStatus
                && MostroBook.disputeStatus[trackedId])
                ? String(MostroBook.disputeStatus[trackedId].status || '').toLowerCase() : '';
            var terminalPublic = ['settled','released','resolved','seller-refunded','closed','canceled','cancelled'];
            var terminalLocal = ['completado','cancelado','archivado'];
            if (terminalLocal.indexOf(trade.internal_status) !== -1
                    || terminalPublic.indexOf(publicState) !== -1) {
                return { allowed: false, admin: true, retryable: false, reason: 'dispute_already_terminal' };
            }
            return { allowed: true, admin: true };
        },

        // Reconciliar la fila local con el kind 38386 firmado por la instancia. Es independiente
        // del orden de carga: puede llamarse tanto al recibir el evento como después de hidratar la
        // BD. `released` cierra la disputa pero no da por terminado el pago al comprador, por eso
        // conserva la fase local `liberando`; `settled` y `seller-refunded` sí son desenlaces finales.
        _reconcileTerminalDispute: async function(trade, publicDispute) {
            if (!trade || !trade.dispute_id || !publicDispute) return false;
            var disputeState = String(publicDispute.status || '').toLowerCase();
            var resolvedStatus = disputeState === 'settled' ? 'completado'
                : disputeState === 'seller-refunded' ? 'cancelado'
                : disputeState === 'released' ? 'liberando'
                : null;
            if (!resolvedStatus) return false;
            // Nunca degradar un desenlace local ya terminal; puede contener información posterior
            // al 38386 (p.ej. purchase-completed después de released).
            if (['completado','cancelado','archivado'].indexOf(trade.internal_status) !== -1) return false;
            if (trade.internal_status === resolvedStatus
                    && trade.status === disputeState && trade.trade_action === disputeState) return false;

            trade.internal_status = resolvedStatus;
            trade.status = disputeState === 'settled' ? 'admin-settled'
                : disputeState === 'seller-refunded' ? 'admin-canceled' : 'released';
            trade.trade_action = trade.status;
            trade.updated_at = Math.max(
                parseInt(trade.updated_at, 10) || 0,
                parseInt(publicDispute._created_at, 10) || 0
            );
            delete trade._releaseInFlight;
            delete trade._cancelInFlight;
            delete trade._peerCancelRequested;
            delete trade._lastOptimistic;
            var res = await this._ajax('mostro_trade_update', {
                order_id: trade.order_id,
                fields: {
                    internal_status: trade.internal_status,
                    status: trade.status,
                    trade_action: trade.trade_action
                }
            });
            if (!res || res.error || !res.ok) {
                throw new Error((res && res.msg) || 'No se pudo reconciliar la disputa terminal');
            }
            _mostroDebug('[Mostro] disputa terminal reconciliada', {
                order_id: trade.order_id, dispute_id: trade.dispute_id,
                public_status: disputeState, local_status: resolvedStatus
            });
            return true;
        },

        _deferAdminEvent: function(ev, trade, reason) {
            if (!ev || !ev.id || !trade) return;
            // Acotado frente a un relay hostil. Solo guarda ciphertext público, nunca claves.
            var ids = Object.keys(this._deferredAdminEvents);
            if (ids.length >= 100) delete this._deferredAdminEvents[ids[0]];
            this._deferredAdminEvents[ev.id] = { ev: ev, orderId: trade.order_id, reason: reason };
        },

        _retryDeferredAdminEvents: function(orderId) {
            var self = this;
            Object.keys(this._deferredAdminEvents).forEach(function(id) {
                var item = self._deferredAdminEvents[id];
                if (!item || item.orderId !== orderId) return;
                delete self._deferredAdminEvents[id];
                // El evento rechazado nunca entró en _seenEvIds. Esperar al siguiente tick evita
                // entrelazarlo con la persistencia/finally del dispute-initiated que lo desbloquea.
                setTimeout(function() { self._handleGiftWrap(item.ev); }, 0);
            });
        },

        _processRobotAction: async function(action, payload, trade, orderMeta, matchInfo, isLive, eventTs) {
            orderMeta = orderMeta || {};
            matchInfo = matchInfo || {};
            // Fallback al estado actual si la llamada no propaga isLive (compatibilidad).
            if (typeof isLive === 'undefined') isLive = !!this._eoseReceived;
            var updates = { status: action, trade_action: action };
            var isCreatedSellMaker = parseInt(trade.is_seller) && trade.trade_role === 'created' && trade.trade_kind === 'sell';
            var isTakenSellBuyer = !parseInt(trade.is_seller) && trade.trade_role === 'taken' && trade.trade_kind === 'sell';
            var ord = payload && payload.order;
            var buyerPub = ord && (ord.buyer_trade_pubkey || ord.buyer_pubkey);
            var sellerPub = ord && (ord.seller_trade_pubkey || ord.seller_pubkey);
            // Red de seguridad: si por lo que sea no capturamos el peer en hold-invoice-payment-accepted/active,
            // algunos mensajes posteriores traen la peer pubkey en payload.peer.pubkey (fiat-sent-ok, etc.).
            // Ver mostro.network/protocol/fiatsent.html.
            if (!trade.peer_pubkey && payload && payload.peer && /^[a-f0-9]{64}$/i.test(payload.peer.pubkey || '')
                && payload.peer.pubkey !== trade.trade_key_pub) {
                updates.peer_pubkey = payload.peer.pubkey;
                if (trade.trade_privkey) {
                    try {
                        trade._chatKey = await _chatDerivedKeys(trade.trade_privkey, payload.peer.pubkey);
                        this.subscribeMyTrades();
                    } catch(e) {}
                }
            }
            // Auditoría 2026-08-22, alto #8: la contraparte puede llegar con su reputación en
            // payload.peer.reputation (Peer.reputation: Option<UserInfo> en mostro-core — verificado
            // en message.rs/user.rs/util.rs::notify_taker_reputation, que la manda con las acciones
            // pay-invoice/add-invoice). UserInfo usa nombres distintos a los que ya persiste
            // _savePeerRep (rating/reviews/operating_days, no total_rating/total_reviews/days) —
            // se traducen aquí. Reutilizamos el mismo helper que usa MostroBook con el tag `rating`
            // del 38383, así _peerRepHtml pinta el badge sin cambios aguas abajo.
            var peerRep = payload && payload.peer && payload.peer.reputation;
            if (peerRep && trade.order_id) {
                var repReviews = parseInt(peerRep.reviews, 10) || 0;
                var repDays = parseInt(peerRep.operating_days, 10) || 0;
                if (repReviews || repDays) { // dato vacío, no informativo: no llenar el mapa de basura
                    var existingRep = _loadPeerRep(trade.order_id);
                    if (!existingRep || (parseInt(existingRep.total_reviews, 10) || 0) < repReviews) {
                        _savePeerRep(trade.order_id, {
                            total_reviews: repReviews,
                            total_rating: parseFloat(peerRep.rating) || 0,
                            days: repDays,
                        });
                    }
                }
            }
            var hasPeerPubkeys = !!(buyerPub || sellerPub);
            var payloadStatus = ((ord && ord.status) || (payload && payload.status) || '').toLowerCase().replace(/_/g, '-');
            var payloadIndicatesActive = payloadStatus === 'active' || hasPeerPubkeys;
            // Detección de la fase de cobro DESDE EL PAYLOAD, no desde la acción. Es el cambio de
            // Mostro Mobile en ca094ca ("detect the payout add-invoice from the message payload"):
            // apoyarse en el aviso de `payment-failed` no es fiable porque la instancia solo lo manda
            // en el primer fallo de cada ciclo (verificado en release.rs). `settled-hold-invoice` es
            // el Status del protocolo que dice que la hold invoice ya se liquidó: a partir de ahí,
            // cualquier `add-invoice` es una factura de COBRO, no la inicial del trade.
            if (payloadStatus === 'settled-hold-invoice' && !parseInt(trade.is_seller)) {
                trade._payoutPhase = true;
                _setPayoutPhase(trade.order_id);
            }
            var reportedTradeIndex = parseInt(orderMeta.trade_index, 10) || 0;
            // Persist the last private robot payload for debugging edge cases between clients.
            try { updates.trade_json = JSON.stringify({ action: action, payload: payload || null }); } catch(e) {}
            if (reportedTradeIndex > 0) updates.trade_index = reportedTradeIndex;

            // En las acciones de fianza, SmallOrder es solo CONTEXTO del bond. En particular,
            // bond-slashed / bond-invoice-accepted / bond-payout-completed usan `order.amount`
            // para los sats de la fianza o su payout, no para los sats negociados. Copiarlo aquí
            // corrompía la ficha (caso real: trade 1470 sats mostrado como fianza de 2500 sats).
            var _isBondContextAction = String(action || '').indexOf('bond') !== -1;
            if (ord && !_isBondContextAction) {
                // No sobrescribir sat_amount con 0. Range orders y algunos estados intermedios
                // mandan ord.amount=0 antes de fijar el importe real; si pisamos el valor
                // bueno se pierde el dato que el comprador necesita para pagar la LN address.
                if (ord.amount !== undefined && ord.amount !== null && Number(ord.amount) > 0) {
                    updates.sat_amount = ord.amount;
                }
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
                // admin-settled/admin-canceled: lo que Mostro manda a comprador Y vendedor cuando un
                // admin resuelve una disputa (mostro-core Action::AdminSettled/AdminCanceled, ver
                // admin_settle.rs/admin_cancel.rs). Payload siempre null; el significado lo da el
                // nombre de la acción. Sin esta entrada el trade se queda en 'disputado' para
                // siempre en el lado que no recibe ningún otro mensaje posterior (el vendedor en
                // admin-settled; ambos en admin-canceled, que no dispara do_payment).
                'admin-settled': 'completado', 'admin-canceled': 'cancelado',
                // cooperative-cancel-accepted: verificado contra el cancel.rs real de mostrod — tras
                // aceptar la cancelación cooperativa NO manda ningún `canceled` posterior a ninguna
                // parte (solo dos CooperativeCancelAccepted, uno a cada lado). Sin esta entrada el
                // trade se quedaba colgado para siempre en el estado anterior (ver comentario viejo,
                // incorrecto, más abajo en el handler de esta acción).
                'cooperative-cancel-accepted': 'cancelado',
                'dispute': 'disputado',
                'dispute-initiated-by-peer': 'disputado',
                'dispute-initiated-by-you': 'disputado',
                'hold-invoice-payment-canceled': 'cancelado',
            };
            // Orden del canal del nodo: NO es el mismo que el del canal público, a propósito.
            // El porqué, en el comentario de _NODE_STATUS_PRIORITY.
            if (statusMap[action]) {
                var newStatus = statusMap[action];
                // Localized fix for NOTES.md flow 4:
                // when we created a sell order and a buyer takes it, we must wait for the
                // robot's `pay-invoice` before showing the trade as active.
                // `buyer-took-order` y `waiting-buyer-invoice` significan "tomada / esperando factura
                // del comprador" — NO que la hold invoice esté pagada. En órdenes de rango la instancia
                // suele incluir buyer/seller_trade_pubkey ANTES de que la hold esté pagada, así que
                // tener peer pubkeys SOLOS no implica active. Solo subimos a 'activo' si el payload
                // declara explícitamente status='active' (el paso real lo hace hold-invoice-payment-accepted).
                // Antes esto pasaba prematuramente a 'activo' → 'activo' está en _noQr → bloqueaba el
                // QR de la hold invoice que llega justo después.
                if (action === 'buyer-took-order' && isCreatedSellMaker) {
                    newStatus = (payloadStatus === 'active') ? 'activo' : 'esperando_hold_invoice';
                }
                if (action === 'waiting-buyer-invoice' && isCreatedSellMaker) {
                    newStatus = (payloadStatus === 'active') ? 'activo' : 'esperando_hold_invoice';
                }
                // Buyer side of a sell order: once the LN invoice was sent, the next real step
                // is waiting for the seller to pay the hold invoice, not sending fiat yet.
                if (action === 'waiting-seller-to-pay' && isTakenSellBuyer) {
                    newStatus = payloadIndicatesActive ? 'activo' : 'esperando_pago_vendedor';
                }
                // Mismo problema que arriba, del lado del COMPRADOR. `buyer-took-order` y
                // `waiting-buyer-invoice` significan "esperando la factura del comprador". Para el
                // VENDEDOR que tomó una orden de compra llegan justo después de que entre su hold
                // invoice, y ahí 'activo' es correcto (ver isHoldConfirmed). Para el comprador
                // significan literalmente que la instancia espera SU factura, o sea lo contrario de
                // 'activo' — y marcarlo 'activo' le quita las DOS vías de mandarla: el handler de
                // `add-invoice` se salta entero con preStatus 'activo' (donde va el envío automático
                // de la lnaddr capturada al tomar) y el input inline de la ficha solo se pinta en
                // 'tomado'/'liberando'. Resultado: el comprador sin forma de mandar la factura y la
                // contraparte esperándola indefinidamente.
                // El override de arriba solo cubría isCreatedSellMaker, así que el comprador se
                // quedaba fuera. Se respeta payloadStatus==='active' igual que los otros dos.
                if ((action === 'buyer-took-order' || action === 'waiting-buyer-invoice')
                        && !parseInt(trade.is_seller)) {
                    newStatus = (payloadStatus === 'active') ? 'activo' : 'tomado';
                }
                var curPrio = _NODE_STATUS_PRIORITY.indexOf(trade.internal_status);
                var newPrio = _NODE_STATUS_PRIORITY.indexOf(newStatus);
                // Excepción: cuando estamos en 'disputado', el admin tiene autoridad final.
                // admin-settle-dispute → success/completado, admin-cancel-dispute → canceled,
                // y cualquier resolución del admin debe poder pasar la guarda de prioridad.
                var fromDisputeResolution = trade.internal_status === 'disputado'
                    && ['completado','cancelado'].indexOf(newStatus) !== -1;
                // Invariante terminal: el backlog del relay no puede "reabrir" un trade. Antes,
                // `disputado` tenía la prioridad numérica más alta y un dispute-initiated antiguo
                // reproducido después de settled devolvía la ficha a Disputado.
                var alreadyTerminal = ['completado','cancelado','archivado'].indexOf(trade.internal_status) !== -1;
                if (!alreadyTerminal && (newPrio >= curPrio || fromDisputeResolution)) {
                    updates.internal_status = newStatus;
                }
                // else: don't downgrade (e.g. pay-invoice arriving again after activo)
            }

            // Notificación de escritorio (OS) para transiciones en vivo. push() ya la limita a la
            // pestaña en segundo plano; solo avisamos si hubo avance real de estado.
            if (isLive && updates.internal_status && typeof window !== 'undefined' && window.NoxtrNotify) {
                try { this._notifyDesktop(action, trade); } catch(e) {}
            }

            // CantDoReason -> i18n. Auditoria 2026-08-22: antes se mostraba el slug crudo
            // (p.ej. "out_of_range_fiat_amount") al usuario. Enum completo verificado contra
            // mostro-core src/error.rs (snake_case real -- NO kebab-case).
            var CANT_DO_I18N = {
                'invalid_signature': str_cantdo_invalid_signature,
                'invalid_trade_index': str_cantdo_invalid_trade_index,
                'invalid_amount': str_cantdo_invalid_amount,
                'invalid_invoice': str_cantdo_invalid_invoice,
                'invalid_payment_request': str_cantdo_invalid_payment_request,
                'invalid_peer': str_cantdo_invalid_peer,
                'invalid_rating': str_cantdo_invalid_rating,
                'invalid_text_message': str_cantdo_invalid_text_message,
                'invalid_order_kind': str_cantdo_invalid_order_kind,
                'invalid_order_status': str_cantdo_invalid_order_status,
                'invalid_pubkey': str_cantdo_invalid_pubkey,
                'invalid_parameters': str_cantdo_invalid_parameters,
                'invalid_payload': str_cantdo_invalid_payload,
                'order_already_canceled': str_cantdo_order_already_canceled,
                'cant_create_user': str_cantdo_cant_create_user,
                'is_not_your_order': str_cantdo_is_not_your_order,
                'not_allowed_by_status': str_cantdo_not_allowed_by_status,
                'out_of_range_fiat_amount': str_cantdo_out_of_range_fiat_amount,
                'out_of_range_sats_amount': str_cantdo_out_of_range_sats_amount,
                'price_too_stale': str_cantdo_price_too_stale,
                'is_not_your_dispute': str_cantdo_is_not_your_dispute,
                'dispute_taken_by_admin': str_cantdo_dispute_taken_by_admin,
                'not_authorized': str_cantdo_not_authorized,
                'dispute_creation_error': str_cantdo_dispute_creation_error,
                'not_found': str_cantdo_not_found,
                'invalid_dispute_status': str_cantdo_invalid_dispute_status,
                'invalid_action': str_cantdo_invalid_action,
                'pending_order_exists': str_cantdo_pending_order_exists,
                'invalid_fiat_currency': str_cantdo_invalid_fiat_currency,
                'too_many_requests': str_cantdo_too_many_requests,
                'invalid_cashu_token': str_cantdo_invalid_cashu_token,
                'cashu_mint_unavailable': str_cantdo_cashu_mint_unavailable,
                'invalid_mint_url': str_cantdo_invalid_mint_url,
                'cashu_escrow_not_locked': str_cantdo_cashu_escrow_not_locked,
                'cashu_signature_missing': str_cantdo_cashu_signature_missing,
            };

            // cant-do: el robot rechazó nuestro último cancel. Restaurar el estado exacto
            // anterior: una cancelación también es válida mientras esperamos que el vendedor
            // deposite el escrow, y devolver ese caso a `publicado` falsearía el flujo local.
            if (action === 'cant-do' && trade.internal_status === 'cancelando') {
                var _cancelPrev = trade._lastOptimistic && trade._lastOptimistic.action === 'cancel'
                    ? trade._lastOptimistic : null;
                updates.internal_status = _cancelPrev ? _cancelPrev.prevStatus : 'publicado';
                if (_cancelPrev) {
                    updates.trade_action = _cancelPrev.prevTradeAction;
                    updates.status = _cancelPrev.prevStatusField;
                    delete trade._lastOptimistic;
                }
                alert(str_robot_cancel_order_failed);
            } else if (action === 'cant-do') {
                var reasonRaw = payload && payload.cant_do ? String(payload.cant_do) : '';
                var reason = CANT_DO_I18N[reasonRaw] || reasonRaw || 'desconocido';
                var _cantReqId = parseInt(orderMeta.request_id, 10);
                var _lastReqId = parseInt(trade._lastSentReqId, 10);
                var _isBondInvoiceRejection = trade._lastSentAction === 'add-bond-invoice'
                    && _cantReqId > 0 && _lastReqId > 0 && _cantReqId === _lastReqId;
                // Revert defensivo: si hicimos una actualización optimista local antes del envío
                // (botón Disputar y similares) y la instancia rechaza con cant-do, deshacemos.
                // Sin esto, la UI muestra un estado que no corresponde con el de la instancia.
                if (_isBondInvoiceRejection) {
                    // Mostro usa NotAllowedByStatus tanto si la petición ya no existe/expiró como
                    // si esta misma invoice ya fue almacenada (doble envío). En ninguno de esos
                    // casos debe quedar un botón que invite a repetir una acción imposible. Si el
                    // daemon necesita otra factura, enviará un nuevo `add-bond-invoice` y el flujo
                    // se reconstruirá desde ese mensaje.
                    var _rejectedBp = this._pendingBondPayout(trade);
                    if (_rejectedBp) {
                        _rejectedBp.inactiveAt = Math.floor(Date.now() / 1000);
                        trade._bondPayout = _rejectedBp;
                        _saveBondPayout(trade.order_id, _rejectedBp);
                    }
                    if (trade._bondPayoutOverlay && trade._bondPayoutOverlay.parentNode) {
                        trade._bondPayoutOverlay.parentNode.removeChild(trade._bondPayoutOverlay);
                    }
                    trade._bondPayoutOverlay = null;
                    delete trade._lastSentAction;
                    // Si ya vimos BondInvoiceAccepted, este cant-do es solo el segundo procesado
                    // de un evento duplicado entre relays: no contradecir la confirmación buena.
                    if (isLive && !(_rejectedBp && _rejectedBp.acceptedAt)) {
                        notify(str_bond_payout_not_active, 'warning', 9000);
                    }
                    this.renderMyTrades();
                } else if (trade._lastOptimistic) {
                    var p = trade._lastOptimistic;
                    updates.internal_status = p.prevStatus;
                    updates.trade_action = p.prevTradeAction;
                    updates.status = p.prevStatusField;
                    delete trade._lastOptimistic;
                    if (isLive) {
                        notify(t(str_robot_rejected_action_full, p.action, reason, p.prevStatus), 'warning', 7000);
                    }
                } else if (isLive) {
                    // Sin acción optimista pendiente: solo notificar el rechazo.
                    notify(t(str_robot_rejected_action, reason), 'warning', 6000);
                }
            }

            // payment-failed: NOT a status change — buyer invoice failed, robot will retry or send add-invoice again
            // Do NOT change internal_status; just notify and let subsequent add-invoice restart the flow
            if (action === 'payment-failed') {
                var attempts = payload && payload.payment_failed && payload.payment_failed.payment_attempts;
                var interval = payload && payload.payment_failed && payload.payment_failed.payment_retries_interval;
                trade._paymentFailed = { attempts: attempts || null, retryMin: interval || null, at: Math.floor(Date.now() / 1000) };
                // Cuántas facturas distintas lleva ya sin poder cobrarse. A partir de 2 la ficha
                // cambia el aviso genérico por uno que dice que el fallo es de la red Lightning.
                trade._payFailCycles = _addPayFailCycle(trade.order_id, parseInt(eventTs, 10) || 0);
                // Segunda mitad de `isPayoutInvoice`: Status.paymentFailed en Mostro Mobile. Aquí
                // `payment-failed` es una Action, no un Status, así que la fase se marca al recibirla.
                if (!parseInt(trade.is_seller)) {
                    trade._payoutPhase = true;
                    _setPayoutPhase(trade.order_id);
                }
                delete trade._invoiceSubmitted;
                delete updates.internal_status; // no status change
            }

            // hold-invoice-payment-canceled: escrow canceled — trade ends
            if (action === 'hold-invoice-payment-canceled') {
                if (isLive) notify(t(str_hold_canceled_order_ended, (trade.order_id||'').slice(0,8)), 'warning', 7000);
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
                    if (isLive) {
                        var dmPanel = document.getElementById('mostro-trades');
                        var dmCard = dmPanel && dmPanel.querySelector('.mostro-trade-card[data-id="' + trade.order_id + '"]');
                        var dmIsOpen = !!(dmCard && dmCard.classList.contains('active-trade')
                            && !dmCard.classList.contains('mostro-trade-collapsed'));
                        if (dmIsOpen) {
                            var dmBox = dmCard.querySelector('.mostro-chat-box[data-id="' + trade.order_id + '"]');
                            if (dmBox) dmBox.classList.add('mostro-chat-open');
                        } else this._markTradeUnread(trade);
                        notify('💬 ' + t(str_robot_msg_in_order, (trade.order_id||'').slice(0,8)), 'info', 5000);
                    }
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

            // Dispute lifecycle (Mostro protocol /protocol/dispute.html)
            if (action === 'dispute-initiated-by-you' || action === 'dispute-initiated-by-peer') {
                // Confirmación positiva: limpiar el revert pendiente que dejó el botón Disputar.
                if (trade._lastOptimistic && trade._lastOptimistic.action === 'dispute') {
                    delete trade._lastOptimistic;
                }
                // Payload::Dispute(Uuid, Option<SolverDisputeInfo>) serializa como tupla
                // ["<uuid>", null] (verificado en message.rs), no como string suelto — sin esto
                // String(payload.dispute) guardaba "<uuid>," y no casaba con el tag `d` del 38386.
                var disputeRaw = payload && (payload.dispute || payload.dispute_id);
                var disputeId = Array.isArray(disputeRaw) ? disputeRaw[0] : disputeRaw;
                if (disputeId) {
                    updates.dispute_id = String(disputeId);
                    trade.dispute_id = String(disputeId);
                }
                if (isLive) {
                    var who = action === 'dispute-initiated-by-you' ? str_dispute_initiated_by_you : str_dispute_initiated_by_peer;
                    var dIdSuffix = disputeId ? t(str_dispute_id_suffix, String(disputeId).slice(0,8)) : '';
                    notify('⚠️ ' + t(str_dispute_started_in, who, (trade.order_id||'').slice(0,8), dIdSuffix), 'warning', 7000);
                }
            }

            // Admin took the dispute → solver pubkey assigned, set up dispute chat (NIP-17 style ECDH).
            if (action === 'admin-took-dispute') {
                var solverPub = payload && payload.peer && payload.peer.pubkey;
                if (solverPub && /^[0-9a-f]{64}$/i.test(String(solverPub))) {
                    solverPub = String(solverPub).toLowerCase();
                    updates.solver_pubkey = solverPub;
                    trade.solver_pubkey = solverPub;
                    try {
                        trade._disputeChatKey = await _chatDerivedKeys(trade.trade_privkey, solverPub);
                        this.subscribeMyTrades();
                    } catch(e) { console.error('[Mostro] dispute chat key derivation failed:', e); }
                    if (isLive) {
                        notify('🛡️ ' + t(str_admin_took_dispute, (trade.order_id||'').slice(0,8)), 'info', 7000);
                    }
                }
            }

            // Admin resolvió la disputa (mostro-core admin_settle_action/admin_cancel_action).
            // Llega a AMBAS partes con payload=null (el estado real lo fija statusMap más arriba,
            // incluida la excepción fromDisputeResolution). admin-settled = fondos liberados al
            // comprador (hold invoice del vendedor liquidada); admin-canceled = hold invoice
            // cancelada y fondos devueltos al vendedor. Solo notificamos aquí; el cambio de estado
            // ya ocurrió en el bloque de arriba.
            if (action === 'admin-settled' || action === 'admin-canceled') {
                if (isLive) {
                    var _resolMsg = action === 'admin-settled' ? str_dispute_resolved_settled : str_dispute_resolved_canceled;
                    notify('⚖️ ' + t(_resolMsg, (trade.order_id||'').slice(0,8)), action === 'admin-settled' ? 'success' : 'warning', 9000);
                }
            }

            // Cooperative cancel lifecycle (mostro-core: cooperative-cancel-*)
            // El robot también puede notificar al peer con `cancel` (visto en pruebas); ese caso
            // se maneja más abajo. Aquí cubrimos las confirmaciones documentadas del protocolo.
            // Nota: `shortId` se asigna más abajo en esta función, así que aquí calculamos uno local.
            var _sid = (trade.order_id || '').slice(0, 8);
            if (['cooperative-cancel-initiated-by-you','cooperative-cancel-accepted','cant-do','canceled','admin-canceled'].indexOf(action) !== -1) {
                delete trade._cancelInFlight;
            }
            if (['cooperative-cancel-accepted','canceled','admin-canceled'].indexOf(action) !== -1
                    && trade._lastOptimistic && trade._lastOptimistic.action === 'cancel') {
                delete trade._lastOptimistic;
            }
            if (action === 'cooperative-cancel-initiated-by-you') {
                if (trade._lastOptimistic && trade._lastOptimistic.action === 'cancel') delete trade._lastOptimistic;
                delete trade._cancelInFlight;
                if (isLive) notify(t(str_coop_cancel_by_you, _sid), 'info', 6000);
                delete updates.internal_status;
            }
            if (action === 'cooperative-cancel-accepted') {
                if (isLive) notify(t(str_coop_cancel_accepted, _sid), 'success', 6000);
                // El estado terminal (cancelado) ya lo puso el statusMap de arriba. Mostro NO manda
                // ningún `canceled` después de esto (verificado contra cancel.rs del daemon) — el
                // comentario anterior era incorrecto y dejaba el trade colgado indefinidamente.
                // Cerrar el diálogo "Aceptar cancelación / Disputar" si sigue abierto (p.ej. la OTRA
                // parte aceptó mientras lo teníamos en pantalla) — sus botones ya no tienen sentido.
                if (trade._coopCancelOverlay) {
                    var _ccOv = trade._coopCancelOverlay;
                    var _ccDc = _ccOv.querySelector && _ccOv.querySelector('.wq-dialog-content');
                    if (_ccDc && _ccDc._dialogInstance) _ccDc._dialogInstance.close();
                    else if (_ccOv.parentNode) _ccOv.parentNode.removeChild(_ccOv);
                    trade._coopCancelOverlay = null;
                }
            }

            // Petición de cancelación cooperativa del peer. En 'activo'/'fiat_enviado' el estado no
            // puede bajar a 'cancelacion_solicitada' (menor prioridad en _NODE_STATUS_PRIORITY, y
            // ahí se queda a propósito — ver su comentario), así que la petición se perdía: solo
            // salía un popup, que además se salta en replay al recargar.
            // NO se puede marcar vía trade_action/status: `updates` los reinicia con la última acción
            // (ver arriba `var updates = { status: action, trade_action: action }`) y el backfill del
            // relay no es cronológico, así que un evento anterior reprocesado después (p.ej.
            // pay-bond-invoice) pisaría el marcador. Usamos una marca transitoria que los demás eventos
            // no tocan y se re-establece en cada sesión al reprocesar este evento desde el relay.
            if (action === 'cooperative-cancel-initiated-by-peer' || action === 'cancel') {
                if (['activo','fiat_enviado','disputado'].indexOf(trade.internal_status) !== -1) {
                    trade._peerCancelRequested = true;
                }
            }

            // BEGIN EDITADO 20260825
            // `rate`: Mostro pide que valoremos a la contraparte, y solo lo pide cuando la orden ya
            // está liquidada — es una señal fiable de que el trade terminó. Estaba SIN manejar (ni en
            // statusMap ni aquí), así que un trade cuyo mensaje de cierre no llegó — pago al comprador
            // reintentado horas después, con la página cerrada o el backlog del relay ya acotado por
            // `noxtr_mostro_chat_since` — se quedaba en 'liberando' para siempre: con el aviso de "el
            // pago falló" ya obsoleto y sin poder valorar, aunque los sats hubieran llegado.
            //
            // Se exige estar ya en un estado tardío: la guarda de prioridad impide bajar de estado,
            // pero no subir, y un `rate` inesperado no debe dar por completado un trade que aún no
            // ha llegado ahí.
            if (action === 'rate') {
                if ([/*'activo',*/'fiat_enviado','liberando'].indexOf(trade.internal_status) !== -1) {
                    updates.internal_status = 'completado';
                    if (isLive) notify('🟢 ' + str_trade_completed_rate, 'success', 9000);
                } else {
                    delete updates.internal_status;
                }
            }
            // Este bloque es idea de Claude, pero hay que comprobar q no sea una cagada
            // END EDITADO 20260825

            // rate-received: la contraparte nos ha valorado (feature que Mostro Mobile no tiene)
            if (action === 'rate-received') {
                var _rcv = payload && (payload.rating_user != null ? payload.rating_user
                        : (payload.rating != null ? payload.rating
                        : (payload.order && payload.order.rating)));
                var _stars = parseInt(_rcv, 10);
                if (isLive) {
                    notify('⭐ ' + ((_stars >= 1 && _stars <= 5)
                        ? t(str_rating_received_stars, _stars, _sid)
                        : t(str_rating_received_generic, _sid)), 'success', 7000);
                }
                delete updates.internal_status;
            }

            // trade-pubkey / invoice-updated: acciones del protocolo aún no integradas en la UI.
            // No cambian el estado; NSTR_EVENTS ya las loguea. Se registran para no perderlas.
            // `invoice-updated`: la instancia acusa recibo de la factura nueva. Mostro Mobile lo
            // trata como transición que MANTIENE add-invoice disponible (PR #667):
            //     Action.invoiceUpdated: [ Action.addInvoice ],
            // En noxtr pasaba lo contrario: `updates = { status: action, trade_action: action }`
            // pisaba trade_action con 'invoice-updated', y el gate del input inline exige
            // trade_action === 'add-invoice', así que el acuse de recibo HACÍA DESAPARECER el campo
            // para cobrar. Se conserva el trade_action anterior y se avisa del acuse.
            if (action === 'invoice-updated') {
                delete updates.trade_action;
                delete updates.status;
                if (isLive) notify('📨 ' + str_invoice_accepted_by_instance, 'success', 6000);
            }
            if (action === 'trade-pubkey' || action === 'invoice-updated') {
                _mostroDebug('[Mostro] acción no integrada en UI:', action, payload);
                delete updates.internal_status;
            }

            // Bonds (anti-spam, mostro-core 0.10.0). Si la instancia los tiene activados, tras tomar/crear
            // una orden manda `pay-bond-invoice` (paga la fianza) o, tras un slash, `add-bond-invoice`
            // (pide factura para cobrar la parte no slasheada).
            if (action === 'pay-bond-invoice' || action === 'add-bond-invoice') {
                if (!_bondsEnabled()) {
                    // enable_bonds OFF: comportamiento previo. noxtr no paga la fianza, así que la instancia
                    // retiene la orden y no puede avanzar. La marcamos terminal para sacarla de activos.
                    if (isLive) notify('⚠️ ' + str_robot_requires_bond, 'error', 12000);
                    console.warn('[Mostro] robot con bonds; enable_bonds OFF; acción no soportada:', action, payload);
                    trade._bondIncompatible = true;
                    updates.internal_status = 'cancelado';
                } else {
                    // enable_bonds ON: no cancelamos ni avanzamos el estado interno. La UI (QR de fianza
                    // o formulario de factura) se muestra en _showTradeAction. Marca transitoria para
                    // que la ficha indique que se espera la fianza.
                    if (action === 'pay-bond-invoice') trade._awaitingBond = true;
                    _mostroTrace('[Mostro] bond action (enable_bonds ON):', action, payload);
                    delete updates.internal_status;
                }
            }

            // Close QR + extract peer pubkeys only once the hold invoice is really confirmed.
            // `buyer-took-order` is too early for locally created sell offers: the seller still
            // has to receive and pay the hold invoice first.
            // `waiting-buyer-invoice` sigue el mismo criterio que `buyer-took-order`: para un maker
            // que creó la venta llega ANTES de que pague la hold invoice (de ahí el override a
            // 'esperando_hold_invoice' más abajo), pero para el vendedor que TOMÓ una orden de
            // compra llega justo después de que su pago entre — es el acuse de "tu hold invoice
            // está dentro, ahora espero la factura del comprador". Sin esta cláusula el estado
            // pasaba a 'activo' pero el QR se quedaba abierto hasta recargar la página.
            var isHoldConfirmed = action === 'hold-invoice-payment-accepted' || action === 'active' ||
                                  (payloadIndicatesActive && (isCreatedSellMaker || isTakenSellBuyer)) ||
                                  (action === 'buyer-took-order' && !isCreatedSellMaker) ||
                                  (action === 'waiting-buyer-invoice' && !isCreatedSellMaker);
            if (isHoldConfirmed) {
                var ourPub = trade.trade_key_pub;
                _mostroTrace('[Mostro] isHoldConfirmed action=', action, 'ord=', JSON.stringify(ord), 'buyerPub=', buyerPub, 'sellerPub=', sellerPub, 'ourPub=', ourPub);
                var pp = (buyerPub && buyerPub !== ourPub) ? buyerPub :
                         (sellerPub && sellerPub !== ourPub) ? sellerPub : null;
                if (pp) {
                    updates.peer_pubkey = pp;
                    if (trade.trade_privkey) {
                        try { trade._chatKey = await _chatDerivedKeys(trade.trade_privkey, pp); this.subscribeMyTrades(); } catch(e) {}
                    }
                }
                this._closeHoldInvoiceQr(trade, action);
                if (parseInt(trade.is_seller) &&
                    ((action === 'buyer-took-order' && !isCreatedSellMaker) ||
                     (action === 'waiting-buyer-invoice' && isCreatedSellMaker && hasPeerPubkeys))) {
                    if (isLive) notify(str_hold_confirmed_wait_fiat, 'success', 6000);
                }
            }

            // updated_at refleja la hora del ÚLTIMO mensaje real de la instancia, no la del último write en BD.
            // En vivo: ahora. Histórico (replay al recargar): la hora del mensaje (rumor.created_at).
            // Tomamos el máximo visto en esta sesión (robusto al orden de llegada) y nunca futuro. Esto
            // evita que recargar "rejuvenezca" la fila y rompa el aviso de atasco.
            var _nowTs = Math.floor(Date.now() / 1000);
            var _evTs = isLive ? _nowTs : (parseInt(eventTs, 10) || 0);
            if (_evTs > 0) {
                trade._maxRobotTs = Math.max(parseInt(trade._maxRobotTs, 10) || 0, _evTs);
                updates.updated_at = Math.min(trade._maxRobotTs, _nowTs);
            }

            // Persist to DB
            var dbRes = await this._ajax('mostro_trade_update', { order_id: trade.order_id, fields: updates });
            _mostroTrace('[Mostro] trade_update', action, trade.order_id, updates, dbRes);
            if (!dbRes || dbRes.error || !dbRes.ok) {
                throw new Error((dbRes && dbRes.msg) || 'No se pudo persistir el estado del trade');
            }

            // If UUID changed, rename in memory
            if (updates.order_id) {
                // Si el trade activo era este (bajo su id tmp-), seguirlo bajo el UUID real.
                if (this._activeTradeId === trade.order_id) {
                    this._activeTradeId = updates.order_id;
                    try { localStorage.setItem('noxtr_mostro_active_trade', updates.order_id); } catch(e) {}
                }
                delete this._trades[trade.order_id];
                trade.order_id = updates.order_id;
                this._trades[trade.order_id] = trade;
            }
            var prevStatus = trade.internal_status;
            Object.assign(trade, updates);
            // BEGIN EDITADO 20260825
            /* Le dejas las manos libres a Claude y te mete cosas como esta, que no valean pa ná.
            // Marcadores de la fase de pago al comprador: solo tienen sentido mientras se paga.
            // _paymentFailed no se borraba en ningún sitio, así que el aviso de "el pago falló,
            // quedan N reintentos" sobrevivía al cierre del trade y volvía a aparecer en cada
            // recarga, al reprocesar el payment-failed histórico desde el relay.
            if (['completado','cancelado'].indexOf(trade.internal_status) !== -1) {
                delete trade._paymentFailed;
                delete trade._invoiceSubmitted;
                delete trade._payFailCycles;
                _clearPayFailCycles(trade.order_id);
                delete trade._payoutPhase;
                _clearPayoutPhase(trade.order_id);
            }
            */
            // END EDITADO 20260825

            if ((action === 'new-order' || action === 'order') && trade.trade_key_pub) {
                this._clearPreparedChildReference(trade.trade_key_pub);
            }
            // Novedad en vivo sobre un trade que NO es el activo: destello (solo en vivo — en
            // replay al recargar destellaría todo el historial).
            if (isLive) this._flashTradeCard(trade.order_id);
            // Red de seguridad: si el trade ya está en un estado donde la hold invoice no procede,
            // no puede quedar un QR pidiendo pagarla. isHoldConfirmed enumera acciones concretas y
            // una que falte (le pasó a `waiting-buyer-invoice`) dejaba el diálogo abierto hasta
            // recargar. Esto lo ata al estado, que es el invariante de verdad.
            if (this._noQrStatuses.indexOf(trade.internal_status) !== -1) {
                try { this._closeHoldInvoiceQr(trade, action); } catch(e) {}
            }
            // Cada paso de UI va aislado: ninguno debe impedir los siguientes ni dejar el mensaje
            // a medio procesar. Un fallo pintando "Mis trades" llegó a impedir que desapareciera la
            // oferta del book y que saliera el QR de la fianza al tomar una orden.
            try { this.renderMyTrades(); }
            catch(e) { console.error('[Mostro] renderMyTrades falló tras', action, trade.order_id, e); }
            // Re-render order book so own orders show "Cancelar" once UUID is known
            try { if (MostroBook && MostroBook.render) MostroBook.render(); }
            catch(e) { console.error('[Mostro] MostroBook.render falló tras', action, trade.order_id, e); }
            // Show UI for actions that require user interaction.
            // Aislado: un fallo pintando UI no debe tumbar el procesado del mensaje. Un
            // ReferenceError aquí dejó durante tiempo el envío automático de la factura del
            // comprador sin ejecutarse, visible solo como un "Uncaught (in promise)" en consola.
            try {
                this._showTradeAction(action, payload, trade, prevStatus, isLive, eventTs);
            } catch(e) {
                console.error('[Mostro] _showTradeAction falló para', action, trade.order_id, e);
            }
        },

        // Cierra los diálogos del QR de la hold invoice de este trade. Los duplicados del relay
        // pueden abrir más de un overlay si la misma acción se reprocesa antes de cerrar el primero.
        _closeHoldInvoiceQr: function(trade, action) {
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
            if (!qrOverlays.length) return false;
            _mostroTrace('[Mostro] QR close action=', action, 'count=', qrOverlays.length, '_qrOverlay=', !!trade._qrOverlay);
            qrOverlays.forEach(function(qrOverlay) {
                var _dc = qrOverlay.querySelector && qrOverlay.querySelector('.wq-dialog-content');
                if (_dc && _dc._dialogInstance) { _dc._dialogInstance.close(); }
                else if (qrOverlay.parentNode) { qrOverlay.parentNode.removeChild(qrOverlay); }
            });
            trade._qrOverlay = null;
            return true;
        },

        // Estados en los que la hold invoice ya no procede: o está pagada y confirmada por la
        // instancia ('activo' y posteriores) o el trade se está cerrando. Compartido entre el
        // gate de `pay-invoice` y el botón "ver QR de nuevo" de la ficha, para que ambos
        // aparezcan y desaparezcan exactamente a la vez.
        _noQrStatuses: ['activo','fiat_enviado','liberando','completado','cancelado','cancelando','cancelacion_solicitada','disputado'],

        // ¿Este vendedor sigue debiendo la hold invoice, estando en `status`?
        //
        // _noQrStatuses dice "aquí ya no procede", pero 'activo'/'fiat_enviado' solo lo dicen de
        // verdad si además conocemos la contraparte: `peer_pubkey` se captura en el MISMO mensaje
        // que confirma el pago (hold-invoice-payment-accepted / active → isHoldConfirmed). Un
        // 'activo' sin peer_pubkey es un estado imposible —alguien lo subió de más— y tomárselo en
        // serio dejaba al vendedor sin NINGUNA forma de pagar: sin QR automático, sin botón en la
        // ficha y con la factura borrada de localStorage. Le pasó a la orden d97129eb.
        //
        // Solo se exceptúan esos dos estados, que son los que AFIRMAN que la factura ya está
        // pagada. En los de cierre (cancelando / cancelacion_solicitada / disputado / terminales)
        // no hay contradicción que detectar: ahí se oculta como siempre.
        _holdInvoiceStillDue: function(trade, status) {
            if (this._noQrStatuses.indexOf(status) === -1) return true;
            return ['activo','fiat_enviado'].indexOf(status) !== -1 && !trade.peer_pubkey;
        },

        // Hold invoice todavía pagable por este vendedor, o null. Hidrata desde localStorage la
        // primera vez (tras recargar, _trades viene de la BD y no trae la factura). Al pasar el
        // trade a un estado en que ya no procede, limpia el rastro persistido.
        _pendingHoldInvoice: function(trade) {
            if (!trade || !parseInt(trade.is_seller) || trade.method === 'onchain') return null;
            if (!this._holdInvoiceStillDue(trade, trade.internal_status)) {
                // El rastro persistido solo se borra en los estados TERMINALES. Borrarlo en
                // cualquier _noQrStatus convertía un estado mal subido en un trade irrecuperable:
                // la factura desaparecía de localStorage y ya no había forma de reabrir el QR ni
                // aunque se corrigiera el estado después.
                if (['completado','cancelado'].indexOf(trade.internal_status) !== -1 && trade._holdInvoice) {
                    delete trade._holdInvoice; _clearHoldInvoice(trade.order_id);
                }
                return null;
            }
            // `undefined` = aún sin mirar; `null` = mirado y no hay. Distinguirlos evita releer
            // localStorage en cada render de cada ficha de venta sin factura pendiente.
            if (trade._holdInvoice === undefined) trade._holdInvoice = _loadHoldInvoice(trade.order_id);
            if (trade._holdInvoice && trade._holdInvoice.bolt11) return trade._holdInvoice;
            // Nada en localStorage (otro navegador, o se limpió). Antes de ir a NSTR_EVENTS: la
            // propia fila ya trae el último payload del nodo en `trade_json`, y si el último fue el
            // `pay-invoice` la bolt11 está ahí. Es la fuente más robusta —viaja con la fila, no
            // depende del log de eventos ni de localStorage— y es síncrona, así que el botón aparece
            // en el primer render en vez de tras un round-trip. Verificado sobre la orden d97129eb,
            // donde la factura estaba en trade_json todo el tiempo mientras la UI la escondía.
            if (trade.trade_json) {
                var _fromRow = _extractHoldInvoice(trade.trade_json);
                if (_fromRow && _fromRow.bolt11) {
                    // `payment_request` del pay-invoice es [order, bolt11, sats] y el tercer elemento
                    // suele venir null: el importe real está en el SmallOrder del primer elemento.
                    if (!_fromRow.sats) {
                        var _pj = this._parseTradeJson(trade);
                        var _pr = _pj && _pj.payload && _pj.payload.payment_request;
                        var _amt = Array.isArray(_pr) && _pr[0] && parseInt(_pr[0].amount, 10);
                        if (_amt > 0) _fromRow.sats = _amt;
                    }
                    trade._holdInvoice = _fromRow;
                    _saveHoldInvoice(trade.order_id, _fromRow);
                    return _fromRow;
                }
            }
            // Ni en local ni en la fila: trade anterior a esta función, o `trade_json` ya pisado por
            // una acción posterior. El rumor del `pay-invoice` sigue en NSTR_EVENTS; se pide una sola
            // vez y se repinta al llegar.
            this._fetchHoldInvoice(trade);
            return null;
        },

        // Cobro de fianza slasheada todavía pendiente para este trade, o null. Hidrata desde
        // localStorage la primera vez (tras recargar, _trades viene de la BD y no lo trae).
        //
        // NO se condiciona al estado del trade, y es deliberado: el cobro de la fianza ocurre
        // JUSTO DESPUÉS de que el trade muera. El daemon manda `admin-settled`/`admin-canceled`
        // —que mapean a completado/cancelado— y solo entonces, desde el tick del scheduler,
        // pide la factura del payout (admin_settle.rs → apply_bond_resolution →
        // request_payout_invoice). Una versión anterior de esta función limpiaba en los estados
        // terminales y se cargaba el marcador en el mismo instante de guardarlo: el diálogo no
        // llegaba a abrirse nunca. Es la misma trampa que _noQrStatuses con la hold invoice.
        //
        // `bond-payout-completed` es el único acuse de que el COBRO terminó y por eso es quien
        // elimina normalmente el marcador. Enviar/aceptar la factura solo cambia su fase y oculta
        // el botón; si el pago falla, un nuevo `add-bond-invoice` la vuelve a abrir.
        _pendingBondPayout: function(trade) {
            if (!trade || !_bondsEnabled()) return null;
            if (trade._bondPayout === undefined) trade._bondPayout = _loadBondPayout(trade.order_id);
            return trade._bondPayout || null;
        },

        // Una petición de payout puede seguir pendiente hasta `bond-payout-completed`, pero eso no
        // significa que siga faltando la factura. En cuanto se publica nuestra respuesta se oculta
        // el botón para impedir dobles envíos. Si el pago falla, el siguiente `add-bond-invoice`
        // del daemon sustituye el marcador y vuelve a habilitarlo.
        _bondPayoutNeedsInvoice: function(trade) {
            var bp = this._pendingBondPayout(trade);
            if (!bp || bp.submittedAt || bp.acceptedAt || bp.inactiveAt) return null;
            // Migración de sesiones que recibieron el rechazo antes de esta corrección. El último
            // mensaje persistido permite retirar ya el botón viejo al recargar. Si ese cant-do era
            // de otra acción, el siguiente reintento periódico `add-bond-invoice` del daemon
            // reemplazará el marcador y lo habilitará otra vez, por lo que no se pierde el cobro.
            var last = this._parseTradeJson(trade);
            if (last && last.action === 'cant-do' && last.payload
                    && last.payload.cant_do === 'not_allowed_by_status') {
                // Usar AHORA, no trade.updated_at: la reconciliación pública de la disputa puede
                // haber restaurado una fecha anterior (la del 38386 settled). El objetivo de esta
                // marca es separar todo el backlog ya reproducido de una petición futura real.
                bp.inactiveAt = Math.floor(Date.now() / 1000);
                trade._bondPayout = bp;
                _saveBondPayout(trade.order_id, bp);
                return null;
            }
            return bp;
        },

        // Abre (o reabre) la petición de factura para cobrar una fianza slasheada. Los datos viven en
        // trade._bondPayout, guardados al llegar el `add-bond-invoice`, así que el diálogo se puede
        // reabrir desde la ficha sin depender de que el daemon reintente la petición.
        _showBondPayoutDialog: function(trade) {
            var self = this;
            var bp = this._bondPayoutNeedsInvoice(trade);
            if (!bp) return false;
            var shortId = (trade.order_id || '').slice(0, 8);
            var payoutSats = bp.sats || null;

            // Guarda de duplicados. El daemon reintenta la petición cada
            // `payout_invoice_window_seconds` (300 por defecto) durante TODA la ventana de
            // reclamación, y cada reintento entra por aquí: sin esto se apilan diálogos idénticos
            // uno encima de otro. Mismo criterio que _showHoldInvoiceQr: solo cuenta como abierto
            // si está en el documento Y realmente pintado (getClientRects y no offsetParent, que
            // en un position:fixed siempre es null); si son restos de un cierre a medias, se
            // descartan y se abre uno limpio.
            var _bpDialogId = 'mo-bondpayout-dialog-' + shortId;
            var _bpExisting = trade._bondPayoutOverlay ||
                document.querySelector('.wq-dialog-overlay[data-mostro-bondpayout-id="' + trade.order_id + '"]');
            if (_bpExisting && document.body.contains(_bpExisting) && _bpExisting.getClientRects().length > 0) {
                trade._bondPayoutOverlay = _bpExisting;
                return true;
            }
            if (_bpExisting) {
                if (_bpExisting.parentNode) _bpExisting.parentNode.removeChild(_bpExisting);
                trade._bondPayoutOverlay = null;
            }

            // Fecha límite = slashed_at + bond_payout_claim_window_days * 86400, el mismo cálculo del
            // daemon (app/bond/payout.rs). Los dos valores vienen del protocolo: `slashed_at` en el
            // BondPayoutRequest y los días en el tag del 38385 (nip33.rs::bond_policy_tags). Si la
            // instancia no publica el tag NO se inventa un plazo: simplemente no se muestra.
            var windowDays = (MostroBook && MostroBook._robotBond && MostroBook._robotBond[trade.robot_pubkey]
                              && MostroBook._robotBond[trade.robot_pubkey].payoutClaimWindowDays) || null;
            var deadlineTs = (bp.slashedAt && windowDays) ? (bp.slashedAt + windowDays * 86400) : null;

            var amountHtml = payoutSats
                ? '<p class="mostro-qr-sats"><strong>' + Number(payoutSats).toLocaleString() + ' sats</strong></p>' +
                  '<p class="mostro-bond-payout-exact">' + t(str_bond_payout_exact_amount, Number(payoutSats).toLocaleString()) + '</p>'
                : '';
            var deadlineHtml = deadlineTs
                ? '<p class="mostro-bond-payout-deadline">⏳ ' +
                  t(str_bond_payout_deadline, new Date(deadlineTs * 1000).toLocaleString()) + '</p>'
                : '';

            $('body').dialog({ title: t(str_add_bond_invoice_title, shortId), type: 'html',
                content: '<div class="mostro-bond-payout" id="' + _bpDialogId + '">' +
                    '<p>' + str_add_bond_invoice_prompt + '</p>' +
                    amountHtml +
                    deadlineHtml +
                    '<input type="text" id="mo-bondpayout-' + shortId + '" class="mo-input" placeholder="lnbc..." style="width:100%">' +
                    '</div>',
                buttons: [
                    { text: str_send, action: async function(e, overlay) {
                        var inp = document.getElementById('mo-bondpayout-' + shortId);
                        var val = (inp && inp.value || '').trim();
                        // SOLO bolt11. NO admitir LN address aquí, aunque el resto del módulo sí la
                        // acepte y parezca una limitación gratuita — verificado leyendo el daemon:
                        //   - `is_valid_invoice` (lightning/invoice.rs:266-270) SÍ la acepta: se
                        //     desvía a `validate_lightning_address`, que solo comprueba que la
                        //     dirección existe y ni siquiera mira el importe.
                        //   - Pero el pago posterior da la bolt11 por sentada: `pay_counterparty`
                        //     (app/bond/payout.rs:538) la decodifica para sacar el payment_hash y
                        //     documenta que "a decode failure here is an invariant violation". El
                        //     módulo de fianzas no resuelve direcciones Lightning en ningún punto
                        //     (cero `resolv_ln_address`, frente a las 3 de release.rs).
                        // Una LN address pasaría la validación y reventaría al pagar con
                        // PaymentFailureKind::Terminal, mientras corre la ventana de reclamación.
                        if (!/^ln(bc|tb|bcrt)[0-9]/i.test(val)) { alert(str_enter_lnaddr_or_bolt11); return; }
                        // Validación del importe en cliente, para no gastar un ciclo contra un
                        // cant-do. Solo se bloquea si la factura declara un importe DISTINTO del
                        // exigido; una bolt11 sin importe (amountless) se deja pasar: esa decisión
                        // es del daemon, no nuestra.
                        if (payoutSats) {
                            var invSats = _bolt11AmountSats(val);
                            if (invSats !== null && invSats !== payoutSats) {
                                alert(t(str_bond_payout_amount_mismatch,
                                        Number(invSats).toLocaleString(),
                                        Number(payoutSats).toLocaleString()));
                                return;
                            }
                        }
                        var _dc = overlay.querySelector('.wq-dialog-content');
                        if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                        trade._bondPayoutOverlay = null;
                        try {
                            await self._sendToRobot('add-bond-invoice', { payment_request: [null, val, null] },
                                trade.robot_pubkey, trade.trade_privkey, trade.order_id, self._tradeIndexOrDefault(trade, 1));
                            // Publicar no equivale todavía a que Mostro la haya aceptado, pero sí a
                            // que no debemos ofrecer un segundo envío. Si necesita otra invoice, el
                            // daemon mandará un nuevo `add-bond-invoice` y su handler reabrirá el flujo.
                            bp.submittedAt = Math.floor(Date.now() / 1000);
                            trade._bondPayout = bp;
                            _saveBondPayout(trade.order_id, bp);
                            self.renderMyTrades();
                            notify(str_bond_payout_invoice_sent, 'success', 6000);
                        } catch(err) {
                            console.error('[Mostro] Error enviando add-bond-invoice:', err);
                            notify(t(str_pay_error, err.message), 'error', 7000);
                        }
                    }},
                    { text: str_close, action: function(e, overlay) {
                        var _dc = overlay.querySelector('.wq-dialog-content');
                        if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                        trade._bondPayoutOverlay = null;
                    }}
                ]
            });
            // Captura del overlay subiendo desde el div de contenido, mismo criterio que el QR de
            // la hold invoice: el setTimeout + :last-child falla si otro dialog se monta despues.
            var _bpOv = document.getElementById(_bpDialogId);
            while (_bpOv && !(_bpOv.classList && _bpOv.classList.contains('wq-dialog-overlay'))) _bpOv = _bpOv.parentNode;
            if (_bpOv && _bpOv.classList && _bpOv.classList.contains('wq-dialog-overlay')) {
                _bpOv.dataset.mostroBondpayoutId = trade.order_id;
                trade._bondPayoutOverlay = _bpOv;
            }
            return true;
        },

        // Rescata la hold invoice del log de eventos del propio usuario (NSTR_EVENTS). Fire-and-forget
        // desde el render: al encontrarla la persiste y vuelve a pintar para que aparezca el botón.
        _fetchHoldInvoice: async function(trade) {
            if (!trade || trade._holdInvoiceFetched) return;
            if (!trade.order_id || /^tmp-/.test(trade.order_id)) return;
            trade._holdInvoiceFetched = true;
            try {
                var r = await this._ajax('mostro_get_rumors', { order_id: trade.order_id, rumor_action: 'pay-invoice' });
                var rows = (r && r.data) || [];
                for (var i = 0; i < rows.length; i++) {
                    var inv = _extractHoldInvoice(rows[i].raw_json);
                    if (inv) {
                        trade._holdInvoice = inv;
                        _saveHoldInvoice(trade.order_id, inv);
                        this.renderMyTrades();
                        return;
                    }
                }
            } catch(e) {}
        },

        // Abre (o reabre) el QR de la hold invoice que el vendedor tiene que pagar. La factura vive
        // en trade._holdInvoice, guardada al llegar el `pay-invoice`; así el diálogo se puede volver
        // a abrir desde la ficha si el usuario lo cierra sin querer, sin depender de que el relay
        // reenvíe el evento (la marca de agua `noxtr_mostro_chat_since` puede haberlo dejado atrás).
        _showHoldInvoiceQr: function(trade) {
            var self = this;
            var inv = trade && trade._holdInvoice;
            if (!inv || !inv.bolt11) return false;
            var bolt11 = inv.bolt11, sats = inv.sats;
            var shortId = (trade.order_id || '').slice(0, 8);

            var existingQrOverlay = trade._qrOverlay ||
                document.querySelector('.wq-dialog-overlay[data-mostro-order-id="' + trade.order_id + '"]');
            // Solo cuenta como "ya abierto" si está en el documento Y realmente pintado. Antes
            // bastaba con tener `parentNode`, así que un nodo huérfano —o los restos de un cierre a
            // medias— hacían que esto devolviera true sin mostrar nada: el vendedor no veía el QR y
            // no quedaba ni rastro en consola, porque la función informaba de éxito.
            // getClientRects() y no offsetParent: los overlays son position:fixed, y ahí
            // offsetParent es null aunque el diálogo sea perfectamente visible.
            if (existingQrOverlay && document.body.contains(existingQrOverlay)
                    && existingQrOverlay.getClientRects().length > 0) {
                trade._qrOverlay = existingQrOverlay;
                return true;
            }
            if (existingQrOverlay) {
                // Restos de un diálogo anterior: se limpian y se abre uno nuevo.
                console.warn('[Mostro] overlay de QR previo no visible, se descarta y se reabre:', trade.order_id);
                if (existingQrOverlay.parentNode) existingQrOverlay.parentNode.removeChild(existingQrOverlay);
                trade._qrOverlay = null;
            }

            var satsInfo = sats ? '<p class="mostro-qr-sats"><strong>' + Number(sats).toLocaleString() + ' sats</strong></p>' : '';
            var qrDialogId = 'mo-qr-dialog-' + shortId;
            var nwcHint = Nip47.isConfigured()
                ? ''
                : '<p class="mostro-qr-nwc-hint"><a href="#" id="mo-nwc-cfg-' + shortId + '">⚡ ' + str_connect_wallet_auto_pay + '</a></p>';
            // Keep QR popup structure class-based so presentation lives in style.mostro.css.
            var dlgButtons = [];
            if (Nip47.isConfigured()) {
                dlgButtons.push({ text: '⚡ ' + str_pay_with_wallet, action: async function(e, overlay) {
                    var btn = overlay.querySelector('button');
                    if (btn) { btn.disabled = true; btn.textContent = str_paying; }
                    try {
                        await Nip47.payInvoice(bolt11);
                        notify(str_payment_sent_to_wallet, 'success', 5000);
                        var _dc = overlay.querySelector('.wq-dialog-content');
                        if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                        trade._qrOverlay = null;
                        await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'activo' } });
                        trade.internal_status = 'activo'; self.renderMyTrades();
                    } catch(err) {
                        notify(t(str_pay_error, err.message), 'error', 7000);
                        if (btn) { btn.disabled = false; btn.textContent = '⚡ ' + str_pay_with_wallet; }
                    }
                }});
            }
            dlgButtons = dlgButtons.concat([
                { text: str_copy_invoice, action: function(e, overlay) {
                    navigator.clipboard.writeText(bolt11).then(function() { notify(str_invoice_copied, 'success', 3000); });
                }},
                { text: str_cancel_trade, action: async function(e, overlay) {
                    var _dc = overlay.querySelector('.wq-dialog-content');
                    if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                    trade._qrOverlay = null;
                    await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando', status: 'cancel' } });
                    trade.internal_status = 'cancelando'; self.renderMyTrades();
                }},
                // Aquí había un botón "Ya pagué la factura" que fijaba internal_status='activo'. Se
                // quitó: 'activo' significa "hold invoice pagada Y CONFIRMADA por la instancia", así
                // que declararlo por nuestra cuenta era una mentira que además bloqueaba el QR para
                // siempre (es uno de los _noQrStatuses) y dejaba la ficha mostrando un trade avanzado
                // que no lo estaba — bastaba un misclick, porque estaba pegado a "Cerrar". Quien fija
                // ese estado es `hold-invoice-payment-accepted`/`active` y nadie más.
                { text: str_close, action: function(e, overlay) {
                    var _dc = overlay.querySelector('.wq-dialog-content');
                    if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                    trade._qrOverlay = null;
                    // La ficha muestra "Ver QR de pago" mientras siga habiendo factura pendiente.
                    self.renderMyTrades();
                }}
            ]);
            // Este QR sale inmediatamente después del de la fianza y son casi idénticos: sin una
            // marca clara parece que el primero falló y sigue ahí. Se distinguen por color, por
            // etiqueta, y sobre todo diciendo que la fianza ya está pagada y esto es otro pago.
            var _bondDone = _isBondPaid(trade);
            var holdBanner = '<div class="mostro-qr-banner mostro-qr-banner-hold">' +
                    (_bondDone ? '<span class="mostro-qr-step">2/2</span>' : '') +
                    '<span class="mostro-qr-kind">' + str_qr_kind_hold + '</span>' +
                '</div>' +
                (_bondDone ? '<p class="mostro-qr-prevdone">✅ ' + str_qr_bond_done + '</p>' : '');
            $('body').dialog({ title: t(str_pay_hold_invoice_title, shortId), type: 'html',
                content: '<div id="' + qrDialogId + '" class="mostro-qr-dialog mostro-qr-hold">' + holdBanner + satsInfo +
                    '<p class="mostro-qr-help">' + str_hold_invoice_qr_help + '</p>' +
                    '<div id="mo-qr-' + shortId + '" class="mostro-qr-code"></div>' +
                    '<p class="mostro-qr-bolt11">' + bolt11 + '</p>' +
                    nwcHint +
                    '</div>',
                buttons: dlgButtons,
                onLoad: function(dlg) {
                    new QRCode(document.getElementById('mo-qr-' + shortId), {
                        text: bolt11.toUpperCase(),
                        width: 200, height: 200,
                        colorDark: '#000', colorLight: '#fff'
                    });
                    var cfgLink = document.getElementById('mo-nwc-cfg-' + shortId);
                    if (cfgLink) cfgLink.onclick = async function(e) {
                        e.preventDefault();
                        await Nip47.configure(self._ajax.bind(self));
                    };
                    // Captura fiable del overlay subiendo desde el div de contenido (mismo criterio
                    // que el QR de fianza; el setTimeout + :last-child fallaba si otro dialog se
                    // montaba después, dejando el QR sin handle → no se cerraba solo).
                    var _ov = document.getElementById(qrDialogId);
                    while (_ov && !(_ov.classList && _ov.classList.contains('wq-dialog-overlay'))) _ov = _ov.parentNode;
                    if (_ov && _ov.classList && _ov.classList.contains('wq-dialog-overlay')) {
                        _ov.dataset.mostroOrderId = trade.order_id;
                        trade._qrOverlay = _ov;
                    }
                }
            });
            return true;
        },

        _showTradeAction: function(action, payload, trade, prevStatus, isLive, eventTs) {
            // Fallback al estado actual si no se propaga (compatibilidad).
            if (typeof isLive === 'undefined') isLive = !!this._eoseReceived;
            // El QR de la hold invoice (pay-invoice) DEBE mostrarse incluso en replays históricos:
            // si el vendedor recarga a mitad del flujo, necesita ver el QR para pagarla. Para el
            // resto de UI (notificaciones one-shot, diálogos de aviso) seguimos saltándonos los
            // replays para no spamear al recargar.
            // pay-bond-invoice se trata como pay-invoice: el QR de la fianza debe re-mostrarse en
            // replays (si el usuario recarga antes de pagarla).
            // add-bond-invoice va por el mismo carril, y aquí el coste de perderlo es DINERO: es la
            // petición de factura para cobrar una fianza slasheada, y si la ventana de reclamación
            // se agota sin factura el daemon ejecuta forfeit_bond y el nodo se queda con todo
            // (app/bond/payout.rs). Descartarlo en replay dejaba al ganador sin ver la petición al
            // recargar; solo reaparecía si la pestaña estaba abierta cuando el daemon reintentaba.
            if (!isLive && action !== 'pay-invoice' && action !== 'pay-bond-invoice'
                        && action !== 'add-bond-invoice') {
                // add-invoice descartado aquí = el envío automático de la lnaddr del take nunca corre
                // y al comprador se le vuelve a pedir en la ficha. Dejar rastro: es una de las dos
                // causas posibles de ese sintoma y sin traza no se distingue de la otra.
                if (action === 'add-invoice') _mostroTrace('[Mostro] add-invoice descartado por no-live', trade.order_id);
                return;
            }
            var preStatus = prevStatus || trade.internal_status;
            var self = this;
            var shortId = (trade.order_id || '').slice(0, 8);

            // Si llega cualquier acción posterior a pay-bond-invoice, la fianza ya se pagó (Mostro
            // siguió el flujo): cerramos el QR de fianza que pudiera quedar abierto.
            if (action !== 'pay-bond-invoice') {
                var _staleBond = trade._bondQrOverlay ||
                    document.querySelector('.wq-dialog-overlay[data-mostro-bond-id="' + trade.order_id + '"]');
                if (_staleBond) {
                    var _bdc = _staleBond.querySelector && _staleBond.querySelector('.wq-dialog-content');
                    if (_bdc && _bdc._dialogInstance) _bdc._dialogInstance.close();
                    else if (_staleBond.parentNode) _staleBond.parentNode.removeChild(_staleBond);
                    trade._bondQrOverlay = null; delete trade._awaitingBond;
                    _markBondPaid(trade);
                }
            }

            if (action === 'buyer-took-order' || action === 'waiting-seller-to-pay') {
                if (parseInt(trade.is_seller) && trade.trade_role === 'created') {
                    notify(t(str_buyer_took_your_offer, shortId), 'info', 6000);
                }
            }

            // 'activo' significa "hold invoice pagada y confirmada por la instancia". Con el fix del
            // override de buyer-took-order/waiting-buyer-invoice ya NO se llega a 'activo' antes
            // de tiempo, así que es seguro bloquear el QR cuando el estado es 'activo'.
            // Lo usa también el bloque de `pay-bond-invoice` más abajo (la fianza sí se rige por el
            // estado a secas: no tiene el invariante de peer_pubkey que sí tiene la hold invoice).
            var _noQr = this._noQrStatuses;
            // Mismo criterio que el botón "ver QR de nuevo" de la ficha (_pendingHoldInvoice), para
            // que los dos aparezcan y desaparezcan exactamente a la vez.
            var _due = this._holdInvoiceStillDue(trade, preStatus) &&
                       this._holdInvoiceStillDue(trade, trade.internal_status);
            // Sin esta traza, un `pay-invoice` bloqueado por el gate es indistinguible de un
            // `pay-invoice` que nunca llegó: en los dos casos el vendedor simplemente no ve el QR.
            // Es lo que costó encontrar el mapeo `in-progress → activo` del canal público.
            if (action === 'pay-invoice' && parseInt(trade.is_seller) && !_due) {
                _mostroTrace('[Mostro] pay-invoice recibido pero el QR está bloqueado por el estado:',
                    trade.order_id, 'preStatus=', preStatus, 'internal_status=', trade.internal_status,
                    'peer_pubkey=', trade.peer_pubkey || '(vacío)');
            }
            if (action === 'pay-invoice' && parseInt(trade.is_seller) && _due) {
                var pr = payload && payload.payment_request;
                var bolt11 = Array.isArray(pr) ? pr[1] : pr;
                var sats = Array.isArray(pr) ? pr[2] : null;
                // Robustez: si la bolt11 no está en pr[1] (órdenes de rango / variantes de la instancia),
                // buscar cualquier string de factura Lightning en el payment_request o en el payload.
                var _looksLikeBolt11 = function(s) { return typeof s === 'string' && /^ln(bc|tb|bcrt)[0-9]/i.test(s); };
                if (!_looksLikeBolt11(bolt11)) {
                    var _scanInvoice = function(v) {
                        if (_looksLikeBolt11(v)) return v;
                        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var r = _scanInvoice(v[i]); if (r) return r; } }
                        else if (v && typeof v === 'object') { for (var k in v) { var r2 = _scanInvoice(v[k]); if (r2) return r2; } }
                        return null;
                    };
                    var _found = _scanInvoice(pr) || _scanInvoice(payload);
                    if (_found) bolt11 = _found;
                }
                if (!_looksLikeBolt11(bolt11)) {
                    console.warn('[Mostro] pay-invoice sin bolt11 reconocible para', trade.order_id, 'payload=', JSON.stringify(payload));
                    return;
                }
                // Guardar la factura ANTES de abrir nada: es lo que permite reabrir el QR desde la
                // ficha si el usuario cierra el diálogo, y sobrevive a recargas vía localStorage
                // (el replay del relay no es fiable: la marca `noxtr_mostro_chat_since` es global y
                // cualquier evento posterior de otro trade o del chat deja este pay-invoice atrás).
                trade._holdInvoice = { bolt11: bolt11, sats: sats || null };
                _saveHoldInvoice(trade.order_id, trade._holdInvoice);
                this._showHoldInvoiceQr(trade);
                this.renderMyTrades();
            }

            if (action === 'add-invoice' && !parseInt(trade.is_seller) &&
                ['activo','fiat_enviado','completado','cancelado','esperando_pago_vendedor'].indexOf(preStatus) === -1) {
                var myPubkey = Noxtr.Events && Noxtr.Events.pubkey ? Noxtr.Events.pubkey : '';
                // La instancia envía payload.order.amount con los sats a recibir (comportamiento
                // del daemon; la doc de mostro.network/protocol/ va por detrás del código desde
                // 2024). Fallback a payment_request[2] por si alguna versión lo manda ahí.
                var sats = (payload && payload.order && parseInt(payload.order.amount, 10))
                        || (payload && payload.payment_request && parseInt(payload.payment_request[2], 10))
                        || null;
                var pendingInvoiceInput = (trade._pendingInvoiceInput || '').trim();
                if (myPubkey) { try { Noxtr.Profiles.request(myPubkey); } catch(e) {} }
                if (sats) {
                    trade._lastAddInvoiceSats = sats;
                    // Persistir para que sobreviva a recargas. Antes era `updates.sat_amount`, pero
                    // `updates` vive en _processRobotAction y aquí no existe: lanzaba ReferenceError
                    // justo antes del envío automático de la lnaddr capturada al tomar la orden, así
                    // que ese envío NUNCA corría y al comprador se le volvía a pedir en la ficha.
                    trade.sat_amount = sats;
                    self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { sat_amount: sats } });
                }
                // Fallback: si no hay _pendingInvoiceInput (tomada en otra sesión, recarga, rangos
                // tomados desde botones rápidos, etc.) pero el perfil ya tiene lnaddress, usarlo
                // automáticamente. Solo en estado 'tomado' (primer add-invoice del flujo). En
                // 'liberando' el pago anterior falló: reenviar el mismo lnaddress fallaría igual,
                // así que ahí seguimos mostrando el input manual.
                if (!pendingInvoiceInput && trade.internal_status === 'tomado' && myPubkey) {
                    var profileLnAddr = Noxtr.Profiles.lnAddress(myPubkey) || '';
                    if (profileLnAddr) pendingInvoiceInput = profileLnAddr;
                }
                if (pendingInvoiceInput) {
                    // Marca el envío en vuelo: el input inline de la ficha se pinta solo con mirar
                    // internal_status, así que sin esto aparecía mientras el automático seguía en
                    // curso y el usuario tecleaba la misma lnaddr encima (doble add-invoice).
                    trade._invoiceAutoSubmitting = true;
                    self.renderMyTrades();
                    (async function() {
                        var sent = false;
                        try {
                            sent = await self._submitBuyerInvoiceInput(trade, pendingInvoiceInput, sats);
                        } catch(e) {
                            console.error('[Mostro] Error enviando add-invoice automático:', e);
                        }
                        delete trade._invoiceAutoSubmitting;
                        // _submitBuyerInvoiceInput devuelve false SIN lanzar cuando no puede enviar
                        // (lnaddr sin sats conocidos, input vacío). Antes solo se miraba el catch: se
                        // notificaba "usando la lnaddr del take" y se volvía dando el envío por hecho,
                        // dejando al usuario ante el mismo input otra vez y sin explicación.
                        if (sent) {
                            notify(str_using_lnaddr_from_take, 'info', 5000);
                        } else {
                            notify(str_lnaddr_auto_failed_manual, 'warning', 6000);
                            delete trade._pendingInvoiceInput;
                        }
                        self.renderMyTrades();
                    })();
                    return;
                }
                // Show inline input in the trade card — no dialog
                _mostroDebug('[Mostro] add-invoice sin envío automático', {
                    order: trade.order_id,
                    pendingInput: !!(trade._pendingInvoiceInput || '').trim(),
                    profileLnAddr: !!(myPubkey && Noxtr.Profiles.lnAddress(myPubkey)),
                    status: trade.internal_status, preStatus: preStatus, sats: sats
                });
                self.renderMyTrades();
                if (trade.internal_status === 'liberando') {
                    notify('⚠️ ' + str_payment_failed_provide_new, 'warning', 7000);
                } else {
                    notify('📥 ' + str_robot_needs_your_lnaddr, 'info', 5000);
                }
            }

            if ((action === 'fiat-sent' || action === 'fiat-sent-ok') && parseInt(trade.is_seller)) {
                if (['fiat_enviado','liberando','completado','cancelado'].indexOf(preStatus) === -1) {
                    trade._fiatSentReceived = true;
                    self.renderMyTrades();
                    $('body').dialog({ title: '💸 ' + t(str_buyer_sent_fiat_title, shortId), type: 'html',
                        content: '<p>' + str_buyer_sent_fiat_text + '</p>',
                        buttons: [
                            { text: str_close, action: function(e, overlay) {
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

            if (action === 'cancel' || action === 'cooperative-cancel-initiated-by-peer') {
                var cancelDialogButtons = [
                    { text: str_accept_cancel, action: async function(e, overlay) {
                        document.body.removeChild(overlay);
                        trade._coopCancelOverlay = null;
                        var wasDisputed = trade.internal_status === 'disputado';
                        await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, self._tradeIndexOrDefault(trade, 1));
                        if (!wasDisputed) {
                            await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando', status: 'cancel' } });
                            trade.internal_status = 'cancelando';
                        }
                        self.renderMyTrades();
                    }}
                ];
                // Si la disputa ya existe, volver a mandar `dispute` no es una alternativa válida.
                if (trade.internal_status !== 'disputado') cancelDialogButtons.push(
                    { text: str_dispute, action: async function(e, overlay) {
                        document.body.removeChild(overlay);
                        trade._coopCancelOverlay = null;
                        await self._sendToRobot('dispute', null, trade.robot_pubkey, trade.trade_privkey, trade.order_id, self._tradeIndexOrDefault(trade, 1));
                        await self._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'disputado', status: 'dispute' } });
                        trade.internal_status = 'disputado'; self.renderMyTrades();
                    }}
                );
                $('body').dialog({ title: t(str_cancel_requested_title, shortId), type: 'html',
                    content: '<p>' + str_cancel_requested_text + '</p>',
                    buttons: cancelDialogButtons
                });
                // Guardar referencia (mismo patrón que trade._qrOverlay, script.mostro.js:2089-2095):
                // si la OTRA parte acepta la cancelación mientras este diálogo sigue abierto,
                // cooperative-cancel-accepted lo cierra más abajo en vez de dejarlo colgado con
                // botones que ya no tienen sentido (el trade pasa a terminal).
                (function(t) {
                    setTimeout(function() {
                        var ov = document.querySelector('.wq-dialog-overlay:last-child');
                        if (ov) t._coopCancelOverlay = ov;
                    }, 50);
                })(trade);
            }

            if (action === 'success' || action === 'hold-invoice-payment-settled' || action === 'purchase-completed') {
                if (parseInt(trade.is_seller) && trade._fiatSentReceived) {
                    notify(t(str_sats_released_completed, shortId), 'success', 8000);
                } else {
                    notify(t(str_trade_completed, shortId), 'success', 8000);
                }
            }

            if (action === 'canceled' || action === 'hold-invoice-payment-canceled') {
                notify(t(str_order_canceled, shortId), 'warning', 5000);
            }

            // ---- Bonds (enable_bonds ON) ----
            // pay-bond-invoice: la instancia pide pagar la fianza (hold invoice). QR igual que la hold
            // invoice del trade, pero etiquetado como FIANZA. Protocolo: payment_request = [SmallOrder,
            // bolt11]; el importe del bond va embebido en la bolt11 (NO en SmallOrder.amount, que es el
            // del trade). El cliente NO responde: Mostro detecta el HTLC y continúa el flujo.
            if (action === 'pay-bond-invoice' && _bondsEnabled()) {
                // No re-mostrar el QR de fianza si el trade ya avanzó: la fianza se pagó hace rato
                // (Mostro no habría seguido el flujo si no). En replay al recargar, este
                // pay-bond-invoice histórico se reprocesa antes que las acciones posteriores, que
                // además están bloqueadas por el guard !isLive de arriba y no lo cerrarían. Sin esto
                // el QR reaparece en cada recarga.
                if (_noQr.indexOf(trade.internal_status) !== -1) { delete trade._awaitingBond; return; }
                // Fianza ya pagada/confirmada en una sesión anterior: el maker pudo pagarla con wallet
                // externa (WOS/BTCPay) y quedar la orden 'publicado' (fuera de _noQr) esperando taker.
                // Sin esto el QR reaparece en cada recarga.
                if (_isBondPaid(trade)) { delete trade._awaitingBond; return; }
                var _bondExisting = trade._bondQrOverlay ||
                    document.querySelector('.wq-dialog-overlay[data-mostro-bond-id="' + trade.order_id + '"]');
                if (_bondExisting && _bondExisting.parentNode) { trade._bondQrOverlay = _bondExisting; return; }
                var bpr = payload && payload.payment_request;
                var bondBolt11 = Array.isArray(bpr) ? bpr[1] : bpr;
                var _looksLikeBolt11b = function(s) { return typeof s === 'string' && /^ln(bc|tb|bcrt)[0-9]/i.test(s); };
                if (!_looksLikeBolt11b(bondBolt11)) {
                    var _scanInv = function(v) {
                        if (_looksLikeBolt11b(v)) return v;
                        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var r = _scanInv(v[i]); if (r) return r; } }
                        else if (v && typeof v === 'object') { for (var k in v) { var r2 = _scanInv(v[k]); if (r2) return r2; } }
                        return null;
                    };
                    bondBolt11 = _scanInv(bpr) || _scanInv(payload);
                }
                if (!_looksLikeBolt11b(bondBolt11)) {
                    console.warn('[Mostro] pay-bond-invoice sin bolt11 reconocible para', trade.order_id, 'payload=', JSON.stringify(payload));
                    return;
                }
                trade._awaitingBond = true;
                var bondDialogId = 'mo-bondqr-dialog-' + shortId;
                var bondNwcHint = Nip47.isConfigured()
                    ? ''
                    : '<p class="mostro-qr-nwc-hint"><a href="#" id="mo-bond-nwc-cfg-' + shortId + '">⚡ ' + str_connect_wallet_auto_pay + '</a></p>';
                var bondBtns = [];
                if (Nip47.isConfigured()) {
                    bondBtns.push({ text: '⚡ ' + str_pay_with_wallet, action: async function(e, overlay) {
                        var btn = overlay.querySelector('button');
                        if (btn) { btn.disabled = true; btn.textContent = str_paying; }
                        try {
                            await Nip47.payInvoice(bondBolt11);
                            notify(str_bond_paid_notice, 'success', 6000);
                            _markBondPaid(trade);
                            var _dc = overlay.querySelector('.wq-dialog-content');
                            if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            trade._bondQrOverlay = null; delete trade._awaitingBond; self.renderMyTrades();
                        } catch(err) {
                            notify(t(str_pay_error, err.message), 'error', 7000);
                            if (btn) { btn.disabled = false; btn.textContent = '⚡ ' + str_pay_with_wallet; }
                        }
                    }});
                }
                bondBtns = bondBtns.concat([
                    { text: str_copy_invoice, action: function(e, overlay) {
                        navigator.clipboard.writeText(bondBolt11).then(function() { notify(str_invoice_copied, 'success', 3000); });
                    }},
                    { text: str_close, action: function(e, overlay) {
                        var _dc = overlay.querySelector('.wq-dialog-content');
                        if (_dc && _dc._dialogInstance) _dc._dialogInstance.close(); else overlay.parentNode && overlay.parentNode.removeChild(overlay);
                        trade._bondQrOverlay = null;
                    }}
                ]);
                // "1/2" solo para el vendedor: es el único al que le sigue otro QR (la hold invoice).
                // Al comprador le sigue la factura de cobro, que no es un QR de pago.
                var bondBanner = '<div class="mostro-qr-banner mostro-qr-banner-bond">' +
                        (parseInt(trade.is_seller) ? '<span class="mostro-qr-step">1/2</span>' : '') +
                        '<span class="mostro-qr-kind">' + str_qr_kind_bond + '</span>' +
                    '</div>';
                $('body').dialog({ title: t(str_pay_bond_title, shortId), type: 'html',
                    content: '<div id="' + bondDialogId + '" class="mostro-qr-dialog mostro-qr-bond">' + bondBanner +
                        '<p class="mostro-qr-help">' + str_bond_qr_help + '</p>' +
                        '<div id="mo-bondqr-' + shortId + '" class="mostro-qr-code"></div>' +
                        '<p class="mostro-qr-bolt11">' + bondBolt11 + '</p>' +
                        bondNwcHint +
                        '</div>',
                    buttons: bondBtns,
                    onLoad: function(dlg) {
                        new QRCode(document.getElementById('mo-bondqr-' + shortId), {
                            text: bondBolt11.toUpperCase(),
                            width: 200, height: 200,
                            colorDark: '#000', colorLight: '#fff'
                        });
                        var cfgLink = document.getElementById('mo-bond-nwc-cfg-' + shortId);
                        if (cfgLink) cfgLink.onclick = async function(e) { e.preventDefault(); await Nip47.configure(self._ajax.bind(self)); };
                        // Captura fiable del overlay subiendo desde el div de contenido (el setTimeout +
                        // :last-child anterior fallaba si otro dialog se montaba después, dejando el QR sin
                        // handle → no se cerraba al publicarse la orden ni al llegar otra acción).
                        var _ov = document.getElementById(bondDialogId);
                        while (_ov && !(_ov.classList && _ov.classList.contains('wq-dialog-overlay'))) _ov = _ov.parentNode;
                        if (_ov && _ov.classList && _ov.classList.contains('wq-dialog-overlay')) {
                            _ov.dataset.mostroBondId = trade.order_id;
                            trade._bondQrOverlay = _ov;
                        }
                    }
                });
            }

            // add-bond-invoice: tras un slash, la instancia pide al lado no slasheado una factura para
            // cobrar su parte del bond. Protocolo: Mostro manda bond_payout_request {order, slashed_at};
            // el cliente responde con la MISMA acción add-bond-invoice y payment_request = [null, bolt11],
            // firmado con la trade key (lo hace _sendToRobot).
            if (action === 'add-bond-invoice' && _bondsEnabled()) {
                // Los relays vuelven a entregar el historial al recargar. No convertir una petición
                // antigua en una acción pendiente otra vez si ya enviamos/aceptamos/rechazamos una
                // factura DESPUÉS de aquel evento. Un reintento auténtico del daemon tendrá un
                // created_at posterior y sí reemplazará el marcador.
                var _existingBp = this._pendingBondPayout(trade);
                var _requestTs = parseInt(eventTs, 10) || 0;
                var _handledAt = _existingBp && Math.max(
                    parseInt(_existingBp.submittedAt, 10) || 0,
                    parseInt(_existingBp.acceptedAt, 10) || 0,
                    parseInt(_existingBp.inactiveAt, 10) || 0
                );
                // En una actualización desde 1.4.204 puede que el primer render todavía no haya
                // migrado el marcador. Hacer aquí la misma detección, pero solo durante replay:
                // una petición EN VIVO siempre debe poder reabrir el flujo tras un rechazo previo.
                if (!_handledAt && !isLive && _existingBp) {
                    var _lastBeforeReplay = this._parseTradeJson(trade);
                    if (_lastBeforeReplay && _lastBeforeReplay.action === 'cant-do'
                            && _lastBeforeReplay.payload
                            && _lastBeforeReplay.payload.cant_do === 'not_allowed_by_status') {
                        _existingBp.inactiveAt = Math.floor(Date.now() / 1000);
                        trade._bondPayout = _existingBp;
                        _saveBondPayout(trade.order_id, _existingBp);
                        _handledAt = _existingBp.inactiveAt;
                    }
                }
                if (_handledAt && (!_requestTs || _requestTs <= _handledAt)) {
                    _mostroTrace('[Mostro] add-bond-invoice histórico ignorado', {
                        order_id: trade.order_id,
                        request_at: _requestTs,
                        handled_at: _handledAt
                    });
                    return;
                }
                // Payload::BondPayoutRequest { order: SmallOrder, slashed_at: i64 }. El enum Payload
                // serializa en snake_case, así que la clave es `bond_payout_request`.
                // `order.amount` NO es el importe del trade: el doc del struct en mostro-core dice
                // literalmente "amount = counterparty share in sats".
                var _bpr = payload && payload.bond_payout_request;
                var _payoutSats = _bpr && _bpr.order && parseInt(_bpr.order.amount, 10);
                var _slashedAt = _bpr && parseInt(_bpr.slashed_at, 10);
                trade._bondPayout = {
                    sats: (_payoutSats > 0) ? _payoutSats : null,
                    slashedAt: (_slashedAt > 0) ? _slashedAt : null,
                    submittedAt: null,
                    acceptedAt: null
                };
                // Persistir ANTES de abrir nada, mismo criterio que la hold invoice: si el usuario
                // cierra el diálogo, el evento original no se puede dar por recuperable y aquí lo que
                // se pierde es dinero (forfeit_bond al agotarse la ventana de reclamación).
                _saveBondPayout(trade.order_id, trade._bondPayout);
                this._showBondPayoutDialog(trade);
                this.renderMyTrades();
            }

            // bond-slashed: la instancia ya cobró el HTLC de la fianza. Solo se notifica al usuario.
            // Protocolo: payload.order.amount = sats slasheados (no el importe del trade).
            if (action === 'bond-slashed' && _bondsEnabled()) {
                var slashedSats = payload && payload.order && parseInt(payload.order.amount, 10);
                notify('⚠️ ' + t(str_bond_slashed_notice, slashedSats ? Number(slashedSats).toLocaleString() : '?'), 'error', 12000);
            }

            // Confirmaciones del payout del bond slasheado (el cliente no responde).
            if (action === 'bond-invoice-accepted' && _bondsEnabled()) {
                var _acceptedBp = this._pendingBondPayout(trade);
                if (_acceptedBp) {
                    _acceptedBp.acceptedAt = Math.floor(Date.now() / 1000);
                    _acceptedBp.inactiveAt = null;
                    trade._bondPayout = _acceptedBp;
                    _saveBondPayout(trade.order_id, _acceptedBp);
                }
                if (trade._bondPayoutOverlay && trade._bondPayoutOverlay.parentNode) {
                    trade._bondPayoutOverlay.parentNode.removeChild(trade._bondPayoutOverlay);
                }
                trade._bondPayoutOverlay = null;
                notify(str_bond_invoice_accepted, 'info', 6000);
                this.renderMyTrades();
            }
            if (action === 'bond-payout-completed' && _bondsEnabled()) {
                // El cobro ya está hecho: se retira el marcador y con él el botón de la ficha.
                // Haber mandado/aceptado la factura no bastaba para declarar el pago hecho; si el
                // send_payment del daemon falla, este vuelve a pedirla (app/bond/payout.rs).
                delete trade._bondPayout;
                _clearBondPayout(trade.order_id);
                notify(str_bond_payout_completed, 'success', 8000);
                this.renderMyTrades();
            }
        },

        // Aviso "en pruebas" del panel Mostro P2P (auditoría 2026-08-22). Dismissible por navegador
        // (no por usuario: es un aviso genérico de riesgo, no ligado a una cuenta), versionado en la
        // key de localStorage para poder reactivarlo si el texto cambia en el futuro. Mismo patrón
        // que ProfileNudge.render() en script.js, pero independiente (ver nota de cabecera: este
        // archivo no depende del IIFE de script.js).
        _renderBetaBanner: function() {
            var el = document.getElementById('mostro-beta-banner');
            if (!el) return;
            var dismissKey = 'noxtr_mostro_beta_notice_dismissed_v1';
            try { if (localStorage.getItem(dismissKey) === '1') { el.style.display = 'none'; return; } } catch(e) {}
            el.innerHTML = '<span class="noxtr-notif-msg">🧪 ' + _escHtml(str_mostro_beta_notice) + ' Telegram: <a target="_blank" href="https://t.me/noxtr_client">https://t.me/noxtr_client</a></span>' +
                '<button type="button" class="btn btn-sm" id="mostro-beta-banner-dismiss">' + _escHtml(str_mostro_beta_dismiss) + '</button>';
            el.style.display = 'flex';
            var dismissBtn = document.getElementById('mostro-beta-banner-dismiss');
            if (dismissBtn) dismissBtn.onclick = function() {
                try { localStorage.setItem(dismissKey, '1'); } catch(e) {}
                el.style.display = 'none';
            };
        },

        _renderNwcBar: function() {
            var btn = document.getElementById('btn-nwc');
            if (!btn) return;
            var self = this;
            if (Nip47.isConfigured()) {
                btn.innerHTML = '&#9889; NWC';
                btn.title = str_nwc_connected_title;
                btn.classList.add('nwc-on');
            } else {
                btn.innerHTML = '&#9889; NWC';
                btn.title = str_nwc_connect_title;
                btn.classList.remove('nwc-on');
            }
            btn.onclick = async function(e) {
                e.preventDefault();
                await Nip47.configure(self._ajax.bind(self));
                self._renderNwcBar();
            };
        },

        // Load trades from DB and subscribe
        loadMyTrades: async function() {
            var self = this;
            await Nip47.load(this._ajax.bind(this));
            this._renderNwcBar();
            try {
                var res = await this._ajax('mostro_trade_list', { limit: 200 });
                if (res.ok && res.trades) {
                    this._trades = {};
                    // El listado se limita por rendimiento, pero este máximo procede de TODAS las
                    // filas lightning, incluidas archivadas, y evita reutilizar una clave NIP-06.
                    this._storedMaxDerivationIndex = Math.max(
                        0,
                        parseInt(res.max_derivation_index, 10) || 0
                    );
                    this._maxTradeIndex = null;
                    this._maxSeedIndex = this._storedMaxDerivationIndex;
                    var now = Math.floor(Date.now() / 1000);
                    var stale = ['creado', 'cancelando', 'enviando'];
                    res.trades.forEach(function(t) {
                        t.trade_index = parseInt(t.trade_index, 10) || 0;
                        // Auto-expire orphaned trades after 24h without robot response.
                        // NO expirar si la fianza esta pagada: la orden esta viva/fondeada en Mostro
                        // aunque el estado interno se haya quedado atras (evita el bug de "orden viva
                        // que sale como cancelada/ajena" al recargar).
                        if (!parseInt(t.archived, 10) && stale.indexOf(t.internal_status) !== -1 &&
                            t.updated_at && (now - t.updated_at) > 86400 && !_isBondPaid(t)) {
                            t.internal_status = 'cancelado';
                            self._ajax('mostro_trade_update', { order_id: t.order_id, fields: { internal_status: 'cancelado' } });
                        }
                        self._trades[t.order_id] = t;
                    });
                    // NostrEscrow no guarda ya las claves Bitcoin privadas en el servidor. Se
                    // reconstruyen desde la semilla local + trade_index y se coteja la pubkey.
                    if (window.Onchain && Onchain.hydrateTrades) {
                        await Onchain.hydrateTrades(Object.values(this._trades));
                    }
                    this._tradesLoaded = true;
                    // Un 38386 puede haber llegado antes que mostro_trade_list. En ese caso el
                    // handler no tenía aún fila que corregir y el relay no tiene por qué repetirlo.
                    // Reaplicar ahora el estado público cacheado evita fichas `disputado · settled`.
                    if (typeof MostroBook !== 'undefined' && MostroBook.disputeStatus) {
                        await Promise.all(Object.values(this._trades).map(function(t) {
                            if (parseInt(t.archived, 10)) return Promise.resolve(false);
                            var publicDispute = t.dispute_id && MostroBook.disputeStatus[t.dispute_id];
                            return publicDispute
                                ? self._reconcileTerminalDispute(t, publicDispute).catch(function(e) {
                                    console.error('[Mostro] no se pudo reconciliar disputa al cargar', t.order_id, e);
                                  })
                                : Promise.resolve(false);
                        }));
                    }
                    await Promise.all(Object.values(this._trades).map(function(t) {
                        return !parseInt(t.archived, 10) && t.solver_pubkey
                            ? self._loadDisputeChatHistory(t) : Promise.resolve();
                    }));
                    this.subscribeMyTrades();
                    this.renderMyTrades();
                    if (MostroBook && MostroBook.render) MostroBook.render();
                    // Consulta dirigida por `d` después de cargar la BD. Además del estado, el
                    // `amt` firmado repara cantidades antiguas que un evento bond pudo contaminar.
                    if (MostroBook && MostroBook.verifyLocalTradeStatuses) MostroBook.verifyLocalTradeStatuses();
                } else if (_isNotLoggedIn(res)) {
                    // Sesión web caída (causa mucho más frecuente que el limiter). Reintentar no
                    // arregla nada: hay que volver a entrar. Se avisa de eso y NO se programa el
                    // reintento, que solo serviría para repetir el mismo aviso cada minuto.
                    console.warn('[Mostro] loadMyTrades: sesión no válida', res);
                    notify('🔒 ' + str_session_expired_login, 'warning', 12000);
                } else {
                    // Antes esto fallaba EN SILENCIO (p.ej. 429 del rate limiter de extFW):
                    // _trades quedaba vacío, sin suscripción, sin replay → sin fichas ni QR de
                    // fianza al recargar, y sin ninguna pista de por qué. Ahora se avisa y se
                    // reintenta una vez pasada la ventana del limiter.
                    console.warn('[Mostro] loadMyTrades: respuesta sin trades', res);
                    this._scheduleTradesRetry();
                }
            } catch(e) {
                console.error('[Mostro] loadMyTrades error', e);
                this._scheduleTradesRetry();
            }
        },
        _tradesRetryTimer: null,
        _scheduleTradesRetry: function() {
            if (this._tradesLoaded || this._tradesRetryTimer) return;
            var self = this;
            notify('⚠️ ' + str_trades_load_retry, 'warning', 8000);
            this._tradesRetryTimer = setTimeout(function() {
                self._tradesRetryTimer = null;
                self.loadMyTrades();
            }, 65000);
        },

        // Maker pagó la fianza: Mostro solo publica la orden en el book público DESPUÉS de bloquear
        // el HTLC del bond. Por eso ver nuestra propia orden en MostroBook es señal fiable de fianza
        // pagada, incluso si se pagó con wallet externa (sin callback NWC) y la orden queda 'publicado'
        // esperando taker (Mostro no manda otra acción que cierre el QR). Lo llama MostroBook al ingerir.
        // Recibe el objeto order del book. El match por id puede fallar si el trade sigue bajo tmp-...
        // (la confirmación new-order con UUID aún no llegó cuando Mostro publica el 38383); en ese caso
        // se busca cualquier trade propio con el bond abierto que coincida en tipo+fiat.
        _onOwnOrderPublished: function(order) {
            if (!order) return;
            var orderType = String(order.orderType || '');
            var fiatCode = String(order.fiatCode || '');
            var trade = order.id && this._trades[order.id];
            var awaiting = function(t) { return t && (t._awaitingBond || t._bondQrOverlay); };
            if (!awaiting(trade)) {
                // fiat_amount NO se compara: el formato guardado puede diferir del publicado y haría
                // fallar el cierre. tipo+moneda basta (un maker rara vez espera 2 fianzas a la vez).
                trade = null;
                for (var oid in this._trades) {
                    var t = this._trades[oid];
                    if (!awaiting(t) || t.trade_role !== 'created') continue;
                    if (String(t.trade_kind || '') !== orderType) continue;
                    if (fiatCode && String(t.fiat_code || '') !== fiatCode) continue;
                    trade = t; break;
                }
            }
            if (!trade) return;
            var overlay = trade._bondQrOverlay ||
                document.querySelector('.wq-dialog-overlay[data-mostro-bond-id="' + trade.order_id + '"]');
            _mostroDebug('[Mostro] own order published, closing bond QR', trade.order_id, !!overlay);
            _markBondPaid(trade);
            if (overlay) {
                var _dc = overlay.querySelector && overlay.querySelector('.wq-dialog-content');
                if (_dc && _dc._dialogInstance) _dc._dialogInstance.close();
                else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
            trade._bondQrOverlay = null;
            delete trade._awaitingBond;
        },

        // Destello en la ficha de un trade NO activo que recibe novedades en vivo (mensaje del
        // robot, chat...). No roba el foco al trade activo: solo llama la atención visualmente;
        // el cambio de trade activo lo decide el usuario con su click.
        _flashTradeCard: function(orderId) {
            if (!orderId || orderId === this._activeTradeId) return;
            var trade = this._trades[orderId];
            if (trade) trade._flashUntil = Date.now() + 5000;
            var card = document.querySelector('.mostro-trade-card[data-id="' + orderId + '"]');
            if (card && !card.classList.contains('active-trade')) {
                // Retrigger de la animación CSS si ya estaba puesta.
                card.classList.remove('mostro-trade-flash');
                void card.offsetWidth;
                card.classList.add('mostro-trade-flash');
            }
        },

        // Render "Mis trades activos" section
        renderMyTrades: function() {
            var el = document.getElementById('mostro-trades');
            if (!el) return;
            // Keep archived rows in the DB for /mostro/trades, but hide them from the main UI.
            var hiddenStatuses = { 'publicado': true };
            var active = Object.values(this._trades).filter(function(t) {
                if (parseInt(t.archived)) return false;
                // Ocultar órdenes on-chain del maker aún no tomadas, pero mostrar solicitudes del taker
                if (t.method === 'onchain' && t.internal_status === 'creado' && t.trade_role !== 'taken') {
                    var pendingReqs = (typeof window.Onchain !== 'undefined' && window.Onchain.Trader)
                        ? (window.Onchain.Trader.getPendingTakeRequests(t.order_id) || []).length
                        : 0;
                    if (!pendingReqs) return false;
                }
                return !hiddenStatuses[t.internal_status];
            });
            active.sort(function(a, b) { return (b.updated_at||0) - (a.updated_at||0); });
            _mostroTrace('[Mostro] renderMyTrades active=', active.map(function(t){ return {id:(t.order_id||'').slice(0,8), role:t.trade_role, st:t.internal_status}; }));
            if (!active.length) { el.innerHTML = ''; return; }

            // Trade activo (el que ocupa la atención del usuario): siempre hay exactamente uno,
            // resaltado con .active-trade. Se adjudica al hacer click en su ficha (persistido en
            // localStorage); si no hay ninguno válido, el más recientemente actualizado. Un trade
            // NO activo que recibe novedades en vivo hace un destello (ver _flashTradeCard) en vez
            // de robar el foco — cambiarlo solo lo decide el usuario con su click.
            if (!this._activeTradeId) {
                try { this._activeTradeId = localStorage.getItem('noxtr_mostro_active_trade') || null; } catch(e) {}
            }
            var _visIds = active.map(function(t) { return t.order_id; });
            if (!this._activeTradeId || _visIds.indexOf(this._activeTradeId) === -1) {
                this._activeTradeId = _visIds[0] || null;
            }

            var STATUS_LABELS = {
                'creado':'⏳ ' + str_status_preparing, 'enviando':'📡 ' + str_status_sending, 'publicado':'✅ ' + str_status_published,
                'pendiente_aceptacion':'⏳ ' + str_status_request_sent,
                'esperando_hold_invoice':'⏳ ' + str_status_waiting_hold,
                'esperando_pago_vendedor':'⏳ ' + str_status_waiting_seller,
                'cancelando':'🔄 ' + str_status_canceling, 'cancelacion_solicitada':'⚠️ ' + str_status_cancel_requested, 'liberando':'🔄 '+str_status_releasing,
                'tomado':'🤝 '+  str_status_taken, 'activo':'⚡ '+  str_status_active, 'fiat_enviado':'💸 ' + str_status_fiat_sent,
                'completado':'✅ '+str_status_completed, 'cancelado':'❌ ' + str_status_canceled, 'disputado':'⚠️ ' + str_status_disputed, 'archivado':'🗃️ ' + str_status_archived
            };
            // Umbral (seg) tras el cual un trade en estado no terminal se considera atascado (sin respuesta
            // de la instancia/contraparte). 'activo' se excluye: espera pago fiat humano, puede tardar legítimamente.
            var STALE_THRESH = {
                'liberando': 86400, 'tomado': 86400, 'esperando_hold_invoice': 86400,
                'esperando_pago_vendedor': 86400, 'cancelacion_solicitada': 86400,
                'fiat_enviado': 3 * 86400
            };
            var self = this;
            // Auditoría 2026-08-22, alto #8: "Mi reputación" a partir del kind 38384. El evento
            // direcciona por TRADE pubkey (verificado en rate_user.rs del daemon real), no por
            // identidad master, así que se busca entre nuestras propias trade pubkeys de trades en
            // modo reputación (identity_fingerprint). Cada 38384 lleva el agregado vigente EN LA
            // FECHA en que se publicó (no un total histórico) — con varios trades se reciben varios
            // agregados de fechas distintas, así que nos quedamos con el de _created_at más alto,
            // no con el de más reviews (uno de fecha más vieja podría tener más reviews acumuladas
            // hasta ese momento y aun así estar desactualizado frente a uno más reciente).
            var myRepHtml = '';
            if (this._tradeUsesReputation) {
                var myRep = null;
                for (var oidRep in this._trades) {
                    var trRep = this._trades[oidRep];
                    if (trRep && this._tradeUsesReputation(trRep) && trRep.trade_key_pub) {
                        var cand = MostroBook._reputation38384[trRep.trade_key_pub.toLowerCase()];
                        if (cand && (!myRep || (parseInt(cand._created_at, 10) || 0) > (parseInt(myRep._created_at, 10) || 0))) {
                            myRep = cand;
                        }
                    }
                }
                if (myRep && (myRep.total_reviews > 0 || myRep.days > 0)) {
                    var myStars = '';
                    var myAvg = parseFloat(myRep.total_rating) || 0;
                    for (var si = 1; si <= 5; si++) myStars += (si <= Math.round(myAvg)) ? '★' : '☆';
                    myRepHtml = '<div class="mostro-my-reputation" title="' +
                        _escHtml(t(str_my_rep_tooltip, myAvg.toFixed(2), myRep.total_reviews, myRep.days)) +
                        '">👤 <strong>' + str_my_rep_label + ':</strong> ' +
                        '<span class="mostro-stars">' + myStars + '</span> ' +
                        myAvg.toFixed(1) + ' <small>(' + myRep.total_reviews + ' · ' + myRep.days + 'd)</small>' +
                        '</div>';
                }
            }
            el.innerHTML = '<div class="mostro-my-trades">' +
                myRepHtml +
                '<div class="mostro-section-title">' + str_my_active_trades + '</div>' +
                active.map(function(t) {
                  // Cada ficha se construye aislada. Antes, un solo trade con datos raros (una fila
                  // vieja/cancelada, un campo que falta) lanzaba dentro de este map y se llevaba por
                  // delante la asignación entera de innerHTML: el panel se quedaba con el HTML
                  // anterior — ficha vieja visible, la nueva sin aparecer — y, peor, la excepción
                  // subía por _processRobotAction y mataba MostroBook.render() y _showTradeAction,
                  // así que tampoco salía el QR de la fianza ni desaparecía la oferta del book.
                  try {
                    var roleLabel = t.trade_role === 'created' ? str_created_by_you : str_taken_by_you;
                    var sideLabel = parseInt(t.is_seller) ? str_selling_btc : str_buying_btc;
                    var statusLabel = STATUS_LABELS[t.internal_status] || t.internal_status;
                    var pendingOnchainReqs = (t.method === 'onchain' && typeof window.Onchain !== 'undefined' && window.Onchain.Trader)
                        ? (window.Onchain.Trader.getPendingTakeRequests(t.order_id) || []).length
                        : 0;
                    if (t.method === 'onchain' && t.internal_status === 'creado' && t.trade_role !== 'taken' && pendingOnchainReqs > 0) {
                        statusLabel = pendingOnchainReqs === 1
                            ? str_pending_request_received
                            : window.t(str_pending_requests_received, pendingOnchainReqs);
                    }
                    if (t.method === 'onchain' && t.internal_status === 'aceptado') {
                        // El chip generico "coordinad por chat" solo aporta antes de que haya
                        // direccion escrow derivada. Una vez existe direccion, la propia caja de
                        // funding ya muestra el estado real (esperando comprobacion / verificada /
                        // funding detectado / N confirmaciones), asi que evitamos el ruido.
                        if (!t.taproot_address) statusLabel = '🤝 '+str_trade_accepted_coordinate;
                        else statusLabel = '';
                    }
                    var _nowSec = Math.floor(Date.now() / 1000);
                    var _staleSec = STALE_THRESH[t.internal_status] || 0;
                    var _isStale = !!(_staleSec && t.updated_at && (_nowSec - parseInt(t.updated_at, 10)) > _staleSec);
                    // Archivar equivale a dejar de escuchar y procesar el trade. Solo se ofrece
                    // cuando el estado local ya es inequívocamente terminal.
                    var canArchive = ['cancelado', 'completado'].indexOf(t.internal_status) !== -1 && !parseInt(t.archived);
                    if (t.internal_status === 'activo') {
                        statusLabel = parseInt(t.is_seller) ? '⚠️ '+str_waiting_fiat_buyer : '⚡ '+str_active_send_fiat;
                    }
                    var shortId = (t.order_id||'').replace(/^tmp-[^-]+-/,'').slice(0,8);
                    var tradeArbs = t.method === 'onchain'
                        ? String(t.arbitrators || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean)
                        : [];
                    var tradeArbsHtml = (window.Onchain && Onchain.UI) ? Onchain.UI.arbSummaryHtml(t) : '';
                    var onchainFundingHtml = (window.Onchain && Onchain.UI)
                        ? (Onchain.UI.fundingHtml(t) + Onchain.UI.fiatPhaseHtml(t))
                        : '';
                    var _topStatus = String(statusLabel || t.internal_status || '').trim();
                    var _topSummary = _escHtml(String(t.fiat_amount)) + ' ' + _escHtml(t.fiat_code || '') +
                                      (_topStatus ? ' · ' + _escHtml(_topStatus) : '');
                    // Barra de progreso del trade: ancho según avance del flujo (de menos a más).
                    // Completado = verde; calificado = 100%; disputa/cancelación en curso = ámbar;
                    // cancelado = gris. Visible también con la ficha colapsada (exenta en el CSS).
                    var PROGRESS = { 'creado':8, 'enviando':8, 'publicado':15, 'pendiente_aceptacion':15,
                        'tomado':35, 'esperando_hold_invoice':35, 'esperando_pago_vendedor':35, 'aceptado':35,
                        'activo':55, 'fiat_enviado':70, 'liberando':85, 'completado':95,
                        'cancelacion_solicitada':50, 'cancelando':50, 'cancelado':100, 'disputado':100 };
                    var _pgW = PROGRESS[t.internal_status] != null ? PROGRESS[t.internal_status] : 8;
                    var _pgCls = '';
                    if (t.internal_status === 'completado') { _pgCls = ' pg-done'; if (parseInt(t.my_rating)) _pgW = 100; }
                    else if (t.internal_status === 'disputado' || t.internal_status === 'cancelando' || t.internal_status === 'cancelacion_solicitada') _pgCls = ' pg-warn';
                    else if (t.internal_status === 'cancelado') _pgCls = ' pg-off';
                    var _pgHtml = '<div class="mostro-trade-progress"><span class="mostro-trade-progress-fill' + _pgCls + '" style="width:' + _pgW + '%"></span></div>';
                    var _isActiveCard = t.order_id === self._activeTradeId;
                    // Acordeón: el trade que el usuario ha activado es el único desplegado.
                    var _collapsed = !_isActiveCard;
                    var _disputePublicState = (t.dispute_id && typeof MostroBook !== 'undefined'
                        && MostroBook.disputeStatus && MostroBook.disputeStatus[t.dispute_id])
                        ? String(MostroBook.disputeStatus[t.dispute_id].status || '').toLowerCase() : '';
                    var _hasOpenDispute = !!t.dispute_id
                        && ['completado','cancelado','archivado'].indexOf(t.internal_status) === -1
                        && ['settled','released','seller-refunded','resolved','closed','canceled','cancelled'].indexOf(_disputePublicState) === -1;
                    if (t._unreadMessages == null) {
                        try { t._unreadMessages = parseInt(localStorage.getItem('noxtr_mostro_unread_' + t.order_id), 10) || 0; }
                        catch(e) { t._unreadMessages = 0; }
                    }
                    var _unreadCount = parseInt(t._unreadMessages, 10) || 0;
                    // Si la ficha ya aparece abierta al entrar/recargar, sus mensajes son visibles.
                    if (_isActiveCard && _unreadCount) {
                        t._unreadMessages = _unreadCount = 0;
                        try { localStorage.removeItem('noxtr_mostro_unread_' + t.order_id); } catch(e) {}
                    }
                    var _flash = !_isActiveCard && t._flashUntil && t._flashUntil > Date.now();
                    return '<div class="mostro-trade-card' + (_collapsed ? ' mostro-trade-collapsed' : '') +
                        (_isActiveCard ? ' active-trade' : '') + (_flash ? ' mostro-trade-flash' : '') +
                        (_hasOpenDispute ? ' mostro-trade-dispute-open' : '') +
                        (_unreadCount ? ' mostro-trade-has-unread' : '') +
                        '" data-id="' + _escHtml(t.order_id) + '">' +
                        _pgHtml +
                        '<div class="mostro-trade-top" role="button" tabindex="0" aria-expanded="' + (_collapsed ? 'false' : 'true') + '">' +
                            '<span class="mostro-trade-chevron" aria-hidden="true">▸</span>' +
                            '<span class="mostro-trade-role ' + (t.trade_role==='created'?'role-created':'role-taken') + '">' + _escHtml(roleLabel) + '</span>' +
                            '<span class="mostro-trade-side ' + (parseInt(t.is_seller)?'side-sell':'side-buy') + '">' + _escHtml(sideLabel) + '</span>' +
                            (t.method === 'onchain'
                                ? '<span class="mostro-trade-method-onchain">ON-CHAIN' +
                                  (function() {
                                      var net = (window.Onchain && Onchain.tradeNetwork) ? Onchain.tradeNetwork(t) : 'mainnet';
                                      return net && net !== 'mainnet' ? ' · ' + _escHtml(net) : '';
                                  })() +
                                  '</span>'
                                : '') +
                            (_hasOpenDispute
                                ? '<span class="mostro-trade-dispute-badge">' + _escHtml(str_status_disputed) + '</span>'
                                : '') +
                            '<span class="mostro-trade-id" title="' + _escHtml(t.order_id||'') + '">#' + _escHtml(shortId) + '</span>' +
                            (t.trade_key_pub
                                ? '<span class="mostro-trade-keypub" title="' + _escHtml(str_trade_keypub_prompt + ' ' + t.trade_key_pub) + '" style="font-size:0.65em;opacity:0.5;cursor:pointer;margin-left:4px;" data-keypub="' + _escHtml(t.trade_key_pub) + '">🔑</span>'
                                : '') +
                            '<span class="mostro-trade-unread-badge" title="' + _escHtml(str_chat) + '"' + (_unreadCount ? '' : ' hidden') + '>💬 ' + _unreadCount + '</span>' +
                            '<span class="mostro-trade-top-summary">' + _topSummary + '</span>' +
                        '</div>' +
                        '<div class="mostro-trade-mid">' +
                            '<span class="mostro-trade-amount">' + _escHtml(String(t.fiat_amount)) + ' ' + _escHtml(t.fiat_code) +
                                (t.sat_amount && parseInt(t.sat_amount) > 0 ? ' · ' + Number(t.sat_amount).toLocaleString() + ' sats' : '') +
                            '</span>' +
                            '<span class="mostro-trade-pm">' + _escHtml(t.payment_method) + '</span>' +
                            _peerRepHtml(t.order_id) +
                            tradeArbsHtml +
                        '</div>' +
                        onchainFundingHtml +
                        // Cabecera de COBRO. Equivalente al PayoutInvoiceScreen de Mostro Mobile
                        // (PR #667): cuando la orden ya está liquidada, esto deja de ser una avería
                        // y pasa a ser "aquí cobras tus sats". Antes el mismo momento se presentaba
                        // como un banner rojo de pago fallido, que se lee como que algo se rompió.
                        (_isPayoutPhase(t.order_id) && !parseInt(t.is_seller)
                         && ['completado','cancelado','archivado'].indexOf(t.internal_status) === -1
                            ? '<div class="mostro-payout-head">' +
                                '<span class="mostro-payout-title">💰 ' + str_payout_collect_title + '</span>' +
                                '<span class="mostro-payout-sub">' + str_payout_collect_sub + '</span>' +
                              '</div>'
                            : '') +
                        // Comprador en 'liberando'. A partir del 2º ciclo fallido el aviso genérico
                        // deja de ayudar: la contraparte ya cumplió y lo que falla es el pago
                        // Lightning a ESTA wallet, así que reenviar la misma factura no va a
                        // funcionar. Se dice explícitamente, con el número de intentos.
                        (t.internal_status === 'liberando' && !parseInt(t.is_seller)
                            ? '<div class="mostro-trade-mid"><span class="mostro-trade-status-info">' +
                              (_payFailCycles(t.order_id) >= 2
                                  ? '⚡ '+window.t(str_ln_payout_stuck, _payFailCycles(t.order_id))
                                  : t.trade_action === 'add-invoice'
                                  ? '📥 '+str_robot_exhausted_retry
                                  : t._paymentFailed
                                  ? '⚠️ '+str_payment_failed_short +
                                    (t._paymentFailed.attempts ? window.t(str_remaining_auto_retries, t._paymentFailed.attempts) : '') +
                                    (t._paymentFailed.retryMin ? window.t(str_next_retry_min, t._paymentFailed.retryMin) : '') +
                                    str_sats_safe
                                  : str_robot_sending_sats) +
                              '</span></div>'
                            : '') +
                        // Vendedor en 'liberando': él ya liberó y sus sats salieron del escrow. Que
                        // el comprador no cobre no es culpa suya ni algo que pueda arreglar — se le
                        // dice para que no lo lea como que la contraparte no responde.
                        (t.internal_status === 'liberando' && parseInt(t.is_seller)
                            ? '<div class="mostro-trade-mid"><span class="mostro-trade-status-info">' +
                              (_payFailCycles(t.order_id) >= 2
                                  ? '⚡ '+window.t(str_ln_payout_stuck_seller, _payFailCycles(t.order_id))
                                  : t.trade_action === 'add-invoice'
                                  ? '📥 '+str_buyer_new_invoice_needed
                                  : t._paymentFailed
                                  ? '⚠️ '+str_robot_could_not_pay_buyer +
                                    (t._paymentFailed.attempts ? window.t(str_remaining_auto_retries, t._paymentFailed.attempts) : '') +
                                    (t._paymentFailed.retryMin ? window.t(str_next_retry_min, t._paymentFailed.retryMin) : '') +
                                    str_buyer_can_send_invoice
                                  : '⏳ '+str_sats_released_paying_buyer) +
                              '</span></div>'
                            : '') +
                        (function() {
                            if ((['tomado','liberando'].indexOf(t.internal_status) !== -1) && !parseInt(t.is_seller)) {
                                var myPub = Noxtr.Events && Noxtr.Events.pubkey ? Noxtr.Events.pubkey : '';
                                var isLiberando = t.internal_status === 'liberando';
                                var sats = t._lastAddInvoiceSats ? Number(t._lastAddInvoiceSats)
                                         : (t.sat_amount ? Number(t.sat_amount) : null);
                                var satsStr = sats ? sats.toLocaleString() + ' sats' : null;
                                // Envío automático en vuelo (lnaddr capturada al tomar la orden): no
                                // pedir lo mismo otra vez mientras tanto. Si acaba fallando, el
                                // handler borra la marca y el input vuelve con su aviso.
                                if (t._invoiceAutoSubmitting) {
                                    return '<div class="mostro-lnaddr-inline-wrap">' +
                                        '<span class="mostro-lnaddr-inline-label">' + str_invoice_sent_waiting + '</span>' +
                                        '</div>';
                                }
                                // After submitting a new invoice in liberando state, show waiting message
                                // until robot responds (payment-failed clears this flag)
                                if (isLiberando && t._invoiceSubmitted) {
                                    return '<div class="mostro-lnaddr-inline-wrap">' +
                                        '<span class="mostro-lnaddr-inline-label">' + str_invoice_sent_waiting + '</span>' +
                                        '</div>';
                                }
                                // Protocolo Mostro (release.html + payment_failed.html): en estado
                                // liberando, mientras la instancia está reintentando el pago el comprador
                                // espera pasivo. Solo cuando la instancia agota retries y manda
                                // `add-invoice` se le pide otra factura. La condición es entonces
                                // trade_action === 'add-invoice' (lo persiste _processRobotAction y
                                // sobrevive recargas). Antes de eso no se muestra input — un
                                // add-invoice unsolicited del comprador la instancia lo ignora.
                                // Excepción a lo anterior: en fase de cobro el campo se mantiene
                                // disponible pase lo que pase con trade_action. Es el arreglo
                                // 281331 de Mostro Mobile ("keep the payout invoice reachable after
                                // the invoice-updated ack") junto con 8dc4004 ("keep the invoice
                                // available while the order is settled"): el acuse de recibo de la
                                // instancia no debe quitarle al comprador el sitio donde cobrar.
                                if (isLiberando && t.trade_action !== 'add-invoice' && !_isPayoutPhase(t.order_id)) {
                                    return '';
                                }
                                var label, placeholder, defAddr;
                                if (isLiberando) {
                                    label = satsStr
                                        ? '⚠️ '+window.t(str_payment_not_arrived_exact, _escHtml(satsStr))
                                        : '⚠️ '+str_payment_not_arrived_amount;
                                    placeholder = str_user_at_wallet_or_lnbc;
                                    defAddr = myPub ? (Noxtr.Profiles.lnAddress(myPub) || '') : '';
                                } else {
                                    label = satsStr
                                        ? window.t(str_lnaddr_invoice_for_sats, _escHtml(satsStr))
                                        : str_lnaddr_or_bolt11_recv_colon;
                                    placeholder = str_user_at_wallet_example;
                                    // Primero lo que ya tecleó al tomar la orden: si el envío automático
                                    // no salió, volver a pedirle lo mismo en blanco es hacerle repetir
                                    // el trabajo. En 'liberando' no se hace (rama de arriba): allí ese
                                    // valor es justo el que acaba de fallar.
                                    defAddr = (t._pendingInvoiceInput || '').trim()
                                        || _loadInvoiceInput(t.order_id)
                                        || (myPub ? (Noxtr.Profiles.lnAddress(myPub) || '') : '');
                                }
                                return '<div class="mostro-lnaddr-inline-wrap">' +
                                    '<span class="mostro-lnaddr-inline-label">' + label + '</span>' +
                                    '<div class="mostro-lnaddr-inline-row">' +
                                    '<input id="mo-lnaddr-inline-' + _escHtml(t.order_id) + '" type="text" class="mostro-invoice-input" placeholder="' + _escHtml(placeholder) + '" value="' + _escHtml(defAddr) + '">' +
                                    '<button class="btn btn-noxtr btn-sm btn-primary mostro-trade-lnaddr-send-btn" data-id="' + _escHtml(t.order_id) + '">' + str_send + '</button>' +
                                    '</div></div>';
                            }
                            return '';
                        })() +
                        '<div class="mostro-trade-dates" style="font-size:0.72em;opacity:0.6;margin:2px 0;">' +
                            (t.created_at ? str_created_prefix + ' ' + _escHtml(self._fmtDate(t.created_at)) + ' · ' : '') +
                            str_updated_lower + ' ' + _escHtml(self._relTime(t.updated_at) || '—') +
                        '</div>' +
                        (_isStale
                            ? '<div class="mostro-trade-stale" style="background:#fdecea;border:1px solid #f5c6cb;color:#a3271f;border-radius:6px;padding:6px 8px;margin:4px 0;font-size:0.8em;">' +
                              '⚠️ ' + window.t(str_stale_no_response_since, _escHtml(self._relTime(t.updated_at))) + ' ' +
                              window.t(str_stale_recover_hint, '🔑', '✕') +
                              '</div>'
                            : '') +
                        '<div class="mostro-trade-foot">' +
                            '<span class="mostro-trade-status">' + _escHtml(statusLabel) + '</span>' +
                            (t.internal_status === 'activo' && !parseInt(t.is_seller)
                                ? '<button class="btn btn-noxtr btn-sm btn-success mostro-trade-fiatsent-btn" data-id="' + _escHtml(t.order_id) + '">' + str_status_fiat_sent + '</button>'
                                : '') +
                            // Cancelación cooperativa pedida por el peer en estado activo/fiat_enviado:
                            // botón persistente para aceptarla (el popup se salta en replay).
                            (t.method !== 'onchain' && t._peerCancelRequested
                             && ['activo','fiat_enviado','disputado'].indexOf(t.internal_status) !== -1
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-accept-cancel-btn" data-id="' + _escHtml(t.order_id) + '">' + str_accept_cancel + '</button>'
                                : '') +
                            (t.method !== 'onchain' && t.internal_status === 'fiat_enviado' && !parseInt(t.is_seller)
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-fiatsent-retry-btn" data-id="' + _escHtml(t.order_id) + '">' + str_resend_fiat_sent_btn + '</button>'
                                : '') +
                            (t.method !== 'onchain' && ['fiat_enviado','disputado'].indexOf(t.internal_status) !== -1 && parseInt(t.is_seller) && !t._releaseInFlight
                                ? '<button class="btn btn-noxtr btn-sm btn-success mostro-trade-release-btn" data-id="' + _escHtml(t.order_id) + '">' + str_release_sats + '</button>'
                                : '') +
                            (t.method !== 'onchain' && ['fiat_enviado','disputado'].indexOf(t.internal_status) !== -1 && parseInt(t.is_seller) && t._releaseInFlight
                                ? '<span class="mostro-trade-status">🔄 ' + str_sending_release + '</span>'
                                : '') +
                            // Reabrir el QR de la hold invoice: el vendedor puede haber cerrado el
                            // diálogo sin pagar, y el evento original no se puede dar por recuperable.
                            // Desaparece solo cuando la instancia confirma el pago (estado 'activo'),
                            // nunca porque el usuario diga que ya pagó.
                            (self._pendingHoldInvoice(t)
                                ? '<button class="btn btn-noxtr btn-sm btn-primary mostro-trade-holdqr-btn" data-id="' + _escHtml(t.order_id) + '">⚡ ' + str_show_payment_qr + '</button>'
                                : '') +
                            // Cobro de fianza slasheada pendiente: reabrir la petición de factura.
                            // Persiste hasta `bond-payout-completed` porque perderla cuesta dinero
                            // (forfeit_bond al agotarse la ventana de reclamación).
                            (self._bondPayoutNeedsInvoice(t)
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-bondpayout-btn" data-id="' + _escHtml(t.order_id) + '">💰 ' + str_bond_payout_claim_btn + '</button>'
                                : '') +
                            (['enviando','tomado','esperando_hold_invoice','esperando_pago_vendedor','cancelacion_solicitada','disputado'].indexOf(t.internal_status) !== -1 && !t._cancelInFlight
                                ? '<button class="btn btn-noxtr btn-sm btn-danger mostro-trade-cancel-btn" data-id="' + _escHtml(t.order_id) + '">' + str_cancel + '</button>'
                                : '') +
                            (pendingOnchainReqs > 0
                                ? '<button class="btn btn-noxtr btn-sm btn-warning nxoc-req-btn" data-id="' + _escHtml(t.order_id) + '">' + window.t(str_requests_count, pendingOnchainReqs) + '</button>'
                                : '') +
                            // NostrEscrow on-chain: taker cancela solicitud pendiente (sin publicar nada)
                            (t.method === 'onchain' && t.trade_role === 'taken'
                             && (t.internal_status === 'pendiente_aceptacion' || t.internal_status === 'creado')
                                ? '<button class="btn btn-noxtr btn-sm btn-danger mostro-trade-cancel-pending-btn" data-id="' + _escHtml(t.order_id) + '">' + str_cancel_request + '</button>'
                                : '') +
                            // NostrEscrow on-chain: solicitud ya aceptada pero SIN funding todavia; permite limpiar
                            // localmente si el maker cancelo/desaparecio o el trade queda huerfano. Una vez
                            // detectado el funding ya no es seguro "olvidar" el trade: hace falta cooperativa,
                            // disputa o recovery para mover los fondos.
                            (t.method === 'onchain' && t.trade_role === 'taken' && t.internal_status === 'aceptado' && !t.funding_txid
                                ? '<button class="btn btn-noxtr btn-sm btn-danger mostro-trade-close-onchain-local-btn" data-id="' + _escHtml(t.order_id) + '">' + str_close_local + '</button>'
                                : '') +
                            // NostrEscrow on-chain: maker cancela orden propia (publica NIP-09 + reemplazo).
                            // Solo si no hay funding aun por la misma razon que el boton "Cerrar local" del taker.
                            (t.method === 'onchain' && t.trade_role !== 'taken' && ['creado','aceptado'].indexOf(t.internal_status) !== -1 && !t.funding_txid
                                ? '<button class="btn btn-noxtr btn-sm btn-danger mostro-trade-onchain-cancel-btn" data-id="' + _escHtml(t.order_id) + '">' + str_cancel + '</button>'
                                : '') +
                            // Iniciar disputa: solo Lightning por ahora (activo / fiat_enviado). La disputa
                            // on-chain (kind 39386 + arbitraje Taproot) es Parte 2.8, aún sin implementar.
                            ((t.method !== 'onchain' && ['activo','fiat_enviado'].indexOf(t.internal_status) !== -1 && !t.dispute_id && !t.solver_pubkey
                                ? '<button class="btn btn-noxtr btn-sm btn-warning mostro-trade-dispute-btn" data-id="' + _escHtml(t.order_id) + '" title="' + str_start_dispute_title + '">' + str_dispute + '</button>'
                                : '')) +
                            (t.dispute_id
                                ? (function() {
                                    var isTerminal = ['completado','cancelado','archivado'].indexOf(t.internal_status) !== -1;
                                    if (isTerminal) {
                                        // Trade finalizado: dejamos constancia discreta de que hubo disputa,
                                        // con el ID completo en el title por si hace falta auditar.
                                        return '<span class="mostro-trade-status" title="' + _escHtml(str_dispute_id_label + ': ' + t.dispute_id) + '">⚠️ ' + str_had_a_dispute + '</span>';
                                    }
                                    var pubSt = (typeof MostroBook !== 'undefined' && MostroBook.disputeStatus && MostroBook.disputeStatus[t.dispute_id])
                                        ? MostroBook.disputeStatus[t.dispute_id].status : null;
                                    var label = window.t(str_dispute_hash, String(t.dispute_id).slice(0,8));
                                    if (pubSt) label += ' · ' + pubSt;
                                    return '<span class="mostro-trade-status" title="' + str_dispute_id_label + '">' + _escHtml(label) + '</span>';
                                })()
                                : '') +
                            (t.solver_pubkey && _hasOpenDispute
                                ? '<span class="mostro-trade-status" title="' + _escHtml(t.solver_pubkey) + '">🛡️ ' + str_admin_assigned + '</span>'
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
                                ? '<a class="mostro-trade-del" data-id="' + _escHtml(t.order_id) + '" title="' + str_archive_trade_title + '">✕</a>'
                                : '') +
                            (t.internal_status !== 'cancelado' && t.internal_status !== 'pendiente_aceptacion'
                             && !(t.method === 'onchain' && !t.peer_pubkey)
                                ? '<button class="mostro-chat-toggle btn-noxtr" data-id="' + _escHtml(t.order_id) + '" title="' + str_chat + '">💬</button>'
                                : '') +
                        '</div>' +
                    (t.internal_status !== 'cancelado' && t.internal_status !== 'pendiente_aceptacion'
                     && !(t.method === 'onchain' && !t.peer_pubkey)
                        ? '<div class="mostro-chat-box" data-id="' + _escHtml(t.order_id) + '">' +
                            // Solo aparece cuando ya se derivó trade._chatKey (peer_pubkey conocida).
                            // Ver protocol/chat.html + Mostro Mobile user_information_tab.dart: el admin
                            // NO es parte de este ECDH (es entre comprador y vendedor), así que si necesita
                            // leer esta conversación en una disputa, una de las partes debe compartírsela.
                            (t._chatKey && t._chatKey.conv && t._chatKey.conv.priv
                                ? '<div class="mostro-chat-sharekey-row">' +
                                    '<button class="mostro-chat-sharekey-btn btn-noxtr" data-id="' + _escHtml(t.order_id) + '" title="' + str_share_chat_key_title + '">🔑 ' + str_share_chat_key_btn + '</button>' +
                                  '</div>'
                                : '') +
                            '<div class="mostro-chat-msgs"></div>' +
                            '<div class="mostro-chat-input-row">' +
                              '<input type="text" class="mostro-chat-input" placeholder="' + str_chat_msg_placeholder + '" data-id="' + _escHtml(t.order_id) + '">' +
                              '<button class="btn btn-noxtr btn-primary btn-sm mostro-chat-send" data-id="' + _escHtml(t.order_id) + '">' + str_send + '</button>' +
                            '</div>' +
                          '</div>'
                        : '') +
                    // Chat con el admin: solo mientras la disputa esté VIVA. `solver_pubkey` no se
                    // borra al resolverse, así que por sí solo dejaba la caja ahí para siempre —
                    // ocupando sitio y ofreciendo escribir a un solver que ya cerró el caso.
                    // Un estado terminal es exactamente "disputa resuelta": el daemon cierra con
                    // admin-settled → completado o admin-canceled → cancelado (admin_settle.rs /
                    // admin_cancel.rs), y ese es el único desenlace posible de una disputa.
                    (t.solver_pubkey && _hasOpenDispute
                        ? '<div class="mostro-dispute-chat-box mostro-chat-open" data-id="' + _escHtml(t.order_id) + '">' +
                            '<div class="mostro-chat-header">🛡️ ' + str_admin_chat_header + '</div>' +
                            '<div class="mostro-chat-msgs"></div>' +
                            '<div class="mostro-chat-input-row">' +
                              '<input type="text" class="mostro-dispute-chat-input" placeholder="' + str_admin_chat_placeholder + '" data-id="' + _escHtml(t.order_id) + '">' +
                              '<button class="btn btn-noxtr btn-sm mostro-dispute-chat-send" data-id="' + _escHtml(t.order_id) + '">' + str_send + '</button>' +
                            '</div>' +
                          '</div>'
                        : '') +
                    '</div>';
                  } catch(e) {
                    console.error('[Mostro] Error pintando la ficha del trade', t && t.order_id, e);
                    // Degradar a una tarjeta mínima con su id: el usuario ve que ese trade existe y
                    // sigue pudiendo archivarlo, en vez de perder el panel entero por su culpa.
                    return '<div class="mostro-trade-card">' +
                        '<div class="mostro-trade-foot">' +
                            '<span class="mostro-trade-status">⚠️ #' + _escHtml((t && t.order_id || '?').slice(0, 8)) + '</span>' +
                            '<a class="mostro-trade-del" data-id="' + _escHtml(t && t.order_id || '') + '" title="' + str_archive_trade_title + '">✕</a>' +
                        '</div></div>';
                  }
                }).join('') +
            '</div>';

            // Acordeón de trades: activar una ficha la despliega y pliega todas las demás. Se hace
            // directamente sobre el DOM para no perder inputs o la posición de los chats.
            el.querySelectorAll('.mostro-trade-card').forEach(function(card) {
                card.addEventListener('click', function() {
                    var id = card.dataset.id;
                    if (!id) return;
                    self._activeTradeId = id;
                    try { localStorage.setItem('noxtr_mostro_active_trade', id); } catch(e) {}
                    el.querySelectorAll('.mostro-trade-card').forEach(function(c) {
                        var selected = c === card;
                        c.classList.toggle('active-trade', selected);
                        c.classList.toggle('mostro-trade-collapsed', !selected);
                        var head = c.querySelector('.mostro-trade-top');
                        if (head) head.setAttribute('aria-expanded', selected ? 'true' : 'false');
                        if (!selected) {
                            var peerChat = c.querySelector('.mostro-chat-box');
                            if (peerChat) peerChat.classList.remove('mostro-chat-open');
                        }
                    });
                    var tr = self._trades[id];
                    if (tr) {
                        delete tr._flashUntil;
                        self._clearTradeUnread(tr, card);
                    }
                });
                var top = card.querySelector('.mostro-trade-top');
                if (top) top.addEventListener('keydown', function(e) {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    card.click();
                });
            });

            el.querySelectorAll('.mostro-trade-lnaddr-send-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (!trade) return;
                    var inp = document.getElementById('mo-lnaddr-inline-' + btn.dataset.id);
                    var val = inp ? inp.value.trim() : '';
                    var isLiberandoState = trade.internal_status === 'liberando';
                    if (!val) {
                        alert(isLiberandoState
                            ? str_enter_exact_bolt11
                            : str_enter_bolt11_or_lnaddr);
                        return;
                    }
                    // In liberando state warn if LN address — some robots don't support LNURL-pay
                    if (isLiberandoState && val.indexOf('@') !== -1) {
                        var sats = trade._lastAddInvoiceSats || trade.sat_amount;
                        var satsHint = sats ? t(str_exact_sats_hint, Number(sats).toLocaleString()) : '';
                        var ok = await confirm(
                            t(str_lnaddr_failed_warning, satsHint)
                        );
                        if (!ok) return;
                    }
                    await self._submitBuyerInvoiceInput(trade, val, trade._lastAddInvoiceSats || null);
                };
            });

            el.querySelectorAll('.mostro-trade-keypub').forEach(function(span) {
                span.onclick = async function() {
                    var keypub = span.dataset.keypub;
                    if (!keypub) return;
                    try {
                        await navigator.clipboard.writeText(keypub);
                        notify(str_trade_keypub_copied, 'success', 4000);
                    } catch(e) {
                        window.prompt(str_trade_keypub_prompt, keypub);
                    }
                };
            });

            el.querySelectorAll('.nxoc-copy-address').forEach(function(btn) {
                btn.onclick = async function() {
                    var address = btn.dataset.address || '';
                    if (!address) return;
                    try {
                        await navigator.clipboard.writeText(address);
                        if (typeof notify === 'function') notify(str_address_copied, 'success', 2500);
                    } catch(e) {
                        window.prompt(str_copy_escrow_addr_prompt, address);
                    }
                };
            });

            el.querySelectorAll('.nxoc-copy-concept').forEach(function(btn) {
                btn.onclick = async function() {
                    var concept = btn.dataset.concept || '';
                    if (!concept) return;
                    try {
                        await navigator.clipboard.writeText(concept);
                        if (typeof notify === 'function') notify(str_mitm_concept_copied, 'success', 2500);
                    } catch(e) {
                        window.prompt(str_mitm_concept_copied, concept);
                    }
                };
            });

            el.querySelectorAll('.nxoc-trade-arbs-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) Onchain.UI.openArbsDialog(trade);
                };
            });

            el.querySelectorAll('.nxoc-confirm-address-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.confirmFundingAddress(trade);
                };
            });

            el.querySelectorAll('.nxoc-fiat-sent-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.confirmFiatSent(trade);
                };
            });

            el.querySelectorAll('.nxoc-fiat-received-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.confirmFiatReceived(trade);
                };
            });

            el.querySelectorAll('.nxoc-payout-save-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    var inp = document.getElementById('nxoc-payout-' + btn.dataset.id);
                    if (trade && inp && window.Onchain && Onchain.UI) await Onchain.UI.setBuyerPayout(trade, inp.value);
                };
            });

            // Comprador: reabrir el input para cambiar la direccion de cobro ya guardada.
            el.querySelectorAll('.nxoc-payout-edit-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade) { trade._payoutEditing = true; self.renderMyTrades(); }
                };
            });

            // Comprador: inicia la firma cooperativa (coop_sign) tras fiat_received.
            el.querySelectorAll('.nxoc-coop-sign-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.startCoopSign(trade);
                };
            });

            // Difundir la TX cooperativa firmada a la red (paso 13) y cerrar el trade.
            el.querySelectorAll('.nxoc-coop-broadcast-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.broadcastCoop(trade);
                };
            });

            // Abrir una disputa on-chain (paso 15).
            el.querySelectorAll('.nxoc-dispute-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.openDispute(trade);
                };
            });

            // Recuperar fondos del escrow (paso 16, recovery): solo el vendedor, tras CSV 4320.
            el.querySelectorAll('.nxoc-recover-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.recoverFunds(trade);
                };
            });

            // Spec v2.7: verificacion bilateral. Genera direccion (si falta) y publica address_check.
            el.querySelectorAll('.nxoc-check-address-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var trade = self._trades[btn.dataset.id];
                    if (trade && window.Onchain && Onchain.UI) await Onchain.UI.checkAddress(trade);
                };
            });

            el.querySelectorAll('.mostro-trade-fiatsent-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm(str_confirm_fiat_sent)) return;
                    var fiatPayload = (!parseInt(trade.is_seller) && trade.trade_role === 'created')
                        ? await self._prepareChildOrderIfNeeded(trade, 'fiat-sent')
                        : null;
                    await self._sendToRobot('fiat-sent', fiatPayload, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'fiat_enviado', status: 'fiat-sent' } });
                    trade.internal_status = 'fiat_enviado'; self.renderMyTrades();
                    notify(str_fiat_sent_confirm_to_robot, 'info', 5000);
                };
            });

            el.querySelectorAll('.mostro-trade-fiatsent-retry-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm(str_resend_fiat_sent)) return;
                    await self._sendToRobot('fiat-sent', null, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'fiat_enviado', status: 'fiat-sent', trade_action: 'fiat-sent' } });
                    trade.internal_status = 'fiat_enviado';
                    trade.status = 'fiat-sent';
                    trade.trade_action = 'fiat-sent';
                    self.renderMyTrades();
                    notify(str_fiat_sent_resent, 'info', 5000);
                };
            });

            el.querySelectorAll('.mostro-trade-release-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade || trade._releaseInFlight) return;
                    if (!await confirm(str_release_sats_to_buyer)) return;
                    _mostroDebug('[Mostro][UI] release click', _mostroTradeSnapshot(trade));
                    trade._releaseInFlight = true;
                    self.renderMyTrades();
                    try {
                        trade._fiatSentReceived = false;
                        // Skip if robot already released (success arrived first via race condition)
                        if (trade.internal_status !== 'completado') {
                            var releaseFromDispute = trade.internal_status === 'disputado';
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
                            var releaseUpdateRes = null;
                            // En Dispute el daemon mantiene ese estado hasta resolver/liberar. No lo
                            // ocultamos localmente con un optimista "liberando", porque desaparecerían
                            // el chat, el id de disputa y las demás acciones mientras llega la respuesta.
                            if (!releaseFromDispute) {
                                releaseUpdateRes = await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'liberando', status: 'release' } });
                                trade.internal_status = 'liberando';
                            }
                            _mostroDebug('[Mostro][UI] release local update', {
                                order_id: oid,
                                ajax_result: releaseUpdateRes || null
                            });
                            trade.updated_at = Math.floor(Date.now() / 1000);
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
                        notify(str_release_send_err, 'error', 5000);
                        return;
                    }
                    delete trade._releaseInFlight;
                    self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-trade-holdqr-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var trade = self._trades[btn.dataset.id];
                    if (!trade) return;
                    if (!self._pendingHoldInvoice(trade)) { self.renderMyTrades(); return; }
                    self._showHoldInvoiceQr(trade);
                };
            });

            el.querySelectorAll('.mostro-trade-bondpayout-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var trade = self._trades[btn.dataset.id];
                    if (!trade) return;
                    if (!self._showBondPayoutDialog(trade)) self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-trade-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm(str_cancel_trade_confirm)) return;
                    // Orden nunca confirmada por la instancia (order_id aun tmp-): no existe en su lado
                    // y un `cancel` con ese id no casaria con nada. Cancelacion puramente local;
                    // enviarlo dejaria la ficha en "Cancelando…" esperando una respuesta imposible.
                    if (/^tmp-/.test(oid)) {
                        await self._ajax('mostro_trade_update', { order_id: oid, fields: { archived: 1, internal_status: 'cancelado' } });
                        trade.archived = 1; trade.internal_status = 'cancelado';
                        self.renderMyTrades();
                        return;
                    }
                    var wasDisputed = trade.internal_status === 'disputado';
                    // La respuesta del robot es asíncrona. Guardamos el estado preciso para no
                    // convertir erróneamente en `publicado` un trade rechazado que estaba esperando
                    // el escrow del vendedor (ni cualquier otro estado desde el que se pueda cancelar).
                    trade._lastOptimistic = {
                        action: 'cancel',
                        prevStatus: trade.internal_status,
                        prevTradeAction: trade.trade_action || '',
                        prevStatusField: trade.status || '',
                        ts: Math.floor(Date.now() / 1000)
                    };
                    trade._cancelInFlight = true;
                    self.renderMyTrades();
                    try {
                        await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                        if (!wasDisputed) {
                            await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'cancelando' } });
                            trade.internal_status = 'cancelando';
                        }
                    } catch(e) {
                        delete trade._cancelInFlight;
                        if (trade._lastOptimistic && trade._lastOptimistic.action === 'cancel') {
                            delete trade._lastOptimistic;
                        }
                        notify(str_cancel_error, 'error', 4000);
                    }
                    self.renderMyTrades();
                };
            });

            // Aceptar la cancelación cooperativa pedida por el peer (manda nuestro `cancel`).
            el.querySelectorAll('.mostro-trade-accept-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm(str_cancel_trade_confirm)) return;
                    var wasDisputed = trade.internal_status === 'disputado';
                    await self._sendToRobot('cancel', null, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    if (!wasDisputed) {
                        await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'cancelando', status: 'cancel' } });
                        trade.internal_status = 'cancelando';
                    }
                    delete trade._peerCancelRequested;
                    self.renderMyTrades();
                };
            });

            // NostrEscrow on-chain: handler de cancel propio (publica NIP-09 + borra fila local)
            el.querySelectorAll('.mostro-trade-onchain-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    if (!await confirm(str_cancel_onchain_order_nip09)) return;
                    if (typeof Onchain === 'undefined' || !Onchain.Trader || !Onchain.Trader.cancelOrder) {
                        alert(str_onchain_module_unavailable);
                        return;
                    }
                    try {
                        await Onchain.Trader.cancelOrder(oid);
                        delete self._trades[oid];
                        self.renderMyTrades();
                    } catch (e) {
                        alert(t(str_cancel_error, e.message));
                    }
                };
            });

            el.querySelectorAll('.mostro-trade-cancel-pending-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    if (!await confirm(str_cancel_trade_request)) return;
                    var res = await self._ajax('mostro_trade_update', { order_id: oid, fields: { archived: 1, internal_status: 'cancelado' } });
                    if (self._trades[oid]) { self._trades[oid].archived = 1; self._trades[oid].internal_status = 'cancelado'; }
                    self.renderMyTrades();
                };
            });

            el.querySelectorAll('.mostro-trade-close-onchain-local-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    if (!await confirm(str_close_local_onchain_trade)) return;
                    var res = await self._ajax('mostro_trade_update', {
                        order_id: oid,
                        fields: { archived: 1, internal_status: 'cancelado', status: 'cancelado' }
                    });
                    if (!res || res.error) {
                        notify(str_local_close_err, 'error', 3000);
                        return;
                    }
                    if (self._trades[oid]) {
                        self._trades[oid].archived = 1;
                        self._trades[oid].internal_status = 'cancelado';
                        self._trades[oid].status = 'cancelado';
                    }
                    self.renderMyTrades();
                };
            });

            el.querySelectorAll('.nxoc-req-btn').forEach(function(btn) {
                btn.onclick = function() {
                    if (typeof window.Onchain !== 'undefined' && window.Onchain.Trader) {
                        window.Onchain.Trader.openPendingTakesDialog(btn.dataset.id);
                    }
                };
            });

            el.querySelectorAll('.mostro-trade-dispute-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    if (!await confirm(str_start_dispute_confirm)) return;
                    // Guardamos el estado previo por si la instancia rechaza con cant-do, para revertir.
                    trade._lastOptimistic = {
                        action: 'dispute',
                        prevStatus: trade.internal_status,
                        prevTradeAction: trade.trade_action || '',
                        prevStatusField: trade.status || '',
                        ts: Math.floor(Date.now() / 1000)
                    };
                    await self._sendToRobot('dispute', null, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                    await self._ajax('mostro_trade_update', { order_id: oid, fields: { internal_status: 'disputado', status: 'dispute', trade_action: 'dispute' } });
                    trade.internal_status = 'disputado';
                    trade.trade_action = 'dispute';
                    self.renderMyTrades();
                    notify(str_dispute_requested_to_robot, 'info', 6000);
                };
            });

            el.querySelectorAll('.mostro-dispute-chat-send').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    var input = el.querySelector('.mostro-dispute-chat-input[data-id="' + oid + '"]');
                    if (!input) return;
                    var text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    await self._sendDisputeChatMsg(trade, text);
                };
            });

            el.querySelectorAll('.mostro-dispute-chat-input').forEach(function(input) {
                input.onkeydown = async function(e) {
                    if (e.key !== 'Enter') return;
                    var oid = input.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade) return;
                    var text = input.value.trim();
                    if (!text) return;
                    input.value = '';
                    await self._sendDisputeChatMsg(trade, text);
                };
            });

            // Re-render chat history after rebuilding the cards. Both chat containers now live
            // inside their trade card, so state updates cannot leave their message lists blank.
            Object.values(self._trades).forEach(function(t) {
                if (t._chatMsgs && t._chatMsgs.length) self._renderChatBox(t);
                if (t.solver_pubkey && t._disputeChatMsgs && t._disputeChatMsgs.length) {
                    self._renderDisputeChatBox(t);
                }
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
                        try {
                            if (trade.method === 'onchain') {
                                if (!window.Onchain || !Onchain.Trader || !Onchain.Trader.publishOnchainRating) {
                                    notify(str_onchain_rating_unavailable, 'error', 5000); return;
                                }
                                await Onchain.Trader.publishOnchainRating(trade, rating);
                            } else {
                                await self._sendToRobot('rate-user', { rating_user: rating }, trade.robot_pubkey, trade.trade_privkey, oid, self._tradeIndexOrDefault(trade, 1));
                            }
                        } catch(e) {
                            stars.forEach(function(s) { s.style.pointerEvents = ''; });
                            notify(window.t(str_rating_publish_failed, (e.message || e)), 'error', 8000);
                            return;
                        }
                        await self._ajax('mostro_trade_update', { order_id: oid, fields: { my_rating: rating } });
                        trade.my_rating = rating; self.renderMyTrades();
                        notify(str_rating_sent, 'success', 3000);
                    };
                });
            });

            el.querySelectorAll('.mostro-trade-del').forEach(function(btn) {
                btn.onclick = async function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    if (!trade || ['cancelado', 'completado'].indexOf(trade.internal_status) === -1) {
                        notify(str_archive_trade_not_allowed, 'warning', 6000);
                        self.renderMyTrades();
                        return;
                    }
                    if (!await confirm(str_archive_trade_confirm)) return;
                    var res = await self._ajax('mostro_trade_update', { order_id: oid, fields: { archived: 1 } });
                    if (!res || !res.ok) {
                        notify(str_archive_err, 'error', 3000);
                        return;
                    }
                    if (self._trades[oid]) self._trades[oid].archived = 1;
                    _clearPeerRep(oid);
                    _clearBondPaid(self._trades[oid] || { order_id: oid });
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

            // Compartir la shared key del chat P2P (K_conv privada) con un admin en disputa.
            // El admin NO es parte de este ECDH (es entre comprador y vendedor), así que no puede
            // derivarla solo — a diferencia del chat de disputa, donde sí puede. Se comparte SOLO
            // K_conv (descifrado), nunca K_sign ni el secreto ECDH crudo (permitirían firmar/falsear
            // mensajes), mismo criterio que Mostro Mobile (user_information_tab.dart).
            el.querySelectorAll('.mostro-chat-sharekey-btn').forEach(function(btn) {
                btn.onclick = function() {
                    var oid = btn.dataset.id;
                    var trade = self._trades[oid];
                    var key = trade && trade._chatKey && trade._chatKey.conv && trade._chatKey.conv.priv;
                    if (!key) { alert(str_share_chat_key_unavailable); return; }
                    var content = '<div class="nsec-qr-dialog">'
                        + '<p class="nsec-qr-warning">⚠️ ' + _escHtml(str_share_chat_key_warning) + '</p>'
                        + '<div class="nsec-qr-text">' + _escHtml(key) + '</div>'
                        + '<p class="nsec-qr-hint">' + _escHtml(str_share_chat_key_hint) + '</p>'
                        + '</div>';
                    $('body').dialog({
                        title: '🔑 ' + str_share_chat_key_title,
                        type: 'html',
                        width: '340px',
                        openAnimation: 'zoom',
                        closeAnimation: 'fade',
                        content: content,
                        buttons: [
                            { text: str_copy, class: 'btn', action: function() {
                                navigator.clipboard.writeText(key).then(function() {
                                    if (typeof notify !== 'undefined') notify(str_copied, 'success', 2000);
                                });
                            } },
                            { text: str_close, class: 'btn btn-primary', action: function(_e, overlay) {
                                if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            } }
                        ]
                    });
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

            // QR BIP21 de funding on-chain: fundingHtml devuelve string, asi que se pintan aqui,
            // una vez el HTML del trade card esta en el DOM.
            if (window.Onchain && Onchain.UI && Onchain.UI.renderFundingQRs) Onchain.UI.renderFundingQRs();
            if (window.Onchain && Onchain.UI && Onchain.UI.renderReleaseEtas) Onchain.UI.renderReleaseEtas();
        },

        // Create order: wquery dialog → save DB → send to robot
        createOrder: function(robotPubkey) {
            if (!Noxtr.Events.pubkey) { alert(str_login_to_create_offer); return; }
            var comms = MostroCommunities._list.filter(function(c) { return c.active && c.hex; });
            if (!robotPubkey) {
                robotPubkey = comms.length ? comms[0].hex : '';
            }
            if (!robotPubkey) { alert(str_activate_mostro_robot); return; }

            // Con más de una instancia activa, la orden solo puede vivir en UNA: selector explícito
            // (antes se publicaba en silencio en la primera de la lista). Cada opción muestra
            // si exige fianza. Solo aplica a LN-Mostro (se oculta en on-chain).
            var robotRowHtml = '';
            if (comms.length > 1) {
                robotRowHtml =
                    '<div class="mo-row" id="mo-robot-row">' +
                        '<span class="mo-label">' + str_instance_label + '</span>' +
                        '<select id="mo-robot" class="mo-input">' +
                        comms.map(function(c) {
                            var extras = [];
                            if (_robotRequiresBond(c.hex, 'make')) extras.push(str_bond_required_badge);
                            var name = c.name || Noxtr.Profiles.displayName(c.hex);
                            return '<option value="' + _escHtml(c.hex) + '"' + (c.hex === robotPubkey ? ' selected' : '') + '>' +
                                _escHtml(name + (extras.length ? ' · ' + extras.join(' · ') : '')) + '</option>';
                        }).join('') +
                        '</select>' +
                    '</div>';
            }

            var self = this;
            var html =
                '<div class="mo-form">' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">' + str_network + '</span>' +
                        '<div class="mo-radios">' +
                            '<label><input type="radio" name="mo-network" value="ln" checked> ⚡ Lightning</label>' +
                            '<label><input type="radio" name="mo-network" value="onchain"> ₿ On-chain</label>' +
                        '</div>' +
                    '</div>' +
                    robotRowHtml +
                    '<div class="mo-row">' +
                        '<span class="mo-label">' + str_type + '</span>' +
                        '<div class="mo-radios">' +
                            '<label><input type="radio" name="mo-kind" value="sell" checked> <span class="mo-badge-sell">' + str_sell + '</span> <small>' + str_i_sell_btc + '</small></label>' +
                            '<label><input type="radio" name="mo-kind" value="buy"> <span class="mo-badge-buy">' + str_buy + '</span> <small>' + str_i_buy_btc + '</small></label>' +
                        '</div>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">' + str_currency + '</span>' +
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
                        '<small id="mo-price-source-info" class="mo-price-source-info">' + MostroBook._priceReferenceInfoHtml('EUR') + '</small>' +
                    '</div>' +
                    '<div class="mo-row mo-row-amount">' +
                        '<span class="mo-label">' + str_amount + '</span>' +
                        '<div class="mo-amount-group">' +
                            '<input id="mo-fiat-min" type="number" min="1" placeholder="' + str_amount_placeholder + '" class="mo-input mo-input-sm">' +
                            '<span class="mo-sep"> ' + str_to + ' </span>' +
                            '<input id="mo-fiat-max" type="number" min="1" placeholder="' + str_max_amount + '" class="mo-input mo-input-sm">' +
                        '</div>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">' + str_payment_method + '</span>' +
                        '<input id="mo-pm" type="text" maxlength="100" placeholder="' + str_payment_method_examples + '" class="mo-input mo-input-lg">' +
                    '</div>' +
                    '<div class="mo-row" id="mo-lnaddr-row" style="display:none">' +
                        '<span class="mo-label">' + str_lightning_address + '</span>' +
                        '<input id="mo-lnaddr" type="text" maxlength="120" placeholder="' + str_user_at_wallet_example + '" class="mo-input mo-input-lg">' +
                        '<small class="mo-hint">' + str_optional_robot_pay_direct + '</small>' +
                    '</div>' +
                    '<div class="mo-row">' +
                        '<span class="mo-label">' + str_premium + ' (%)</span>' +
                        '<div class="mo-premium-wrap">' +
                            '<input id="mo-premium" type="range" min="-10" max="10" step="1" value="0" class="mo-range">' +
                            '<span id="mo-premium-label" class="mo-premium-val">0%</span>' +
                        '</div>' +
                        '<small class="mo-hint">' + str_negative_discount + '</small>' +
                    '</div>' +
                    '<div class="mo-row" id="mo-onchain-keys-row" style="display:none">' +
                        '<span class="mo-label">' + str_bitcoin_key + '</span>' +
                        '<div id="mo-onchain-keys-status"></div>' +
                    '</div>' +
                    '<div class="mo-row" id="mo-onchain-arbs-row" style="display:none">' +
                        '<span class="mo-label">' + str_arbitrators + '</span>' +
                        '<div id="mo-onchain-arbs-selector" class="nxoc-arb-selector"></div>' +
                    '</div>' +
                '</div>';

            $('body').dialog({
                title: '₿ ' + str_create_offer,
                type: 'html',
                width: '440px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: html,
                buttons: [
                    {
                        text: str_cancel,
                        class: 'btn',
                        action: function(_e, overlay) { document.body.removeChild(overlay); }
                    },
                    {
                        text: str_publish_offer,
                        class: 'btn btn-primary',
                        action: async function(event, overlay) {
                            var robotSel = overlay.querySelector('#mo-robot');
                            if (robotSel && robotSel.value) robotPubkey = robotSel.value;
                            var network = (overlay.querySelector('input[name="mo-network"]:checked') || {}).value || 'ln';
                            var kind = overlay.querySelector('input[name="mo-kind"]:checked').value;
                            var fiatCode = (document.getElementById('mo-fiat-code').value || '').trim();
                            var fiatMin = (document.getElementById('mo-fiat-min').value || '').trim();
                            var fiatMax = (document.getElementById('mo-fiat-max').value || '').trim();
                            var pm = (document.getElementById('mo-pm').value || '').trim();
                            var lnAddr = (document.getElementById('mo-lnaddr').value || '').trim();
                            var premium = document.getElementById('mo-premium').value || '0';

                            if (!fiatCode) { alert(str_fiat_currency_required); return; }
                            if (!pm) { alert(str_payment_method_required); return; }
                            if (!fiatMin) { alert(str_amount_required); return; }

                            var minInt = self._parsePositiveInteger(fiatMin);
                            var maxInt = fiatMax ? self._parsePositiveInteger(fiatMax) : null;
                            var isRange = maxInt !== null;
                            if (minInt === null) {
                                alert(str_amount_positive_integer);
                                return;
                            }
                            if (fiatMax && maxInt === null) {
                                alert(str_max_amount_positive_integer);
                                return;
                            }
                            if (isRange && maxInt <= minInt) {
                                alert(str_max_amount_gt_min);
                                return;
                            }
                            var fiatVal = isRange ? (String(minInt) + '-' + String(maxInt)) : String(minInt);
                            var isSeller = kind === 'sell' ? 1 : 0;
                            var submitBtn = event.target;

                            // ---- ON-CHAIN PATH ----
                            if (network === 'onchain') {
                                if (!window.Onchain || !window.Onchain.Keys || !window.Onchain.Keys.isUnlocked()) {
                                    alert(str_configure_btc_key_first);
                                    return;
                                }
                                submitBtn.disabled = true; submitBtn.textContent = str_publishing;
                                var arbitrators = (window.Onchain.Arbitrators && window.Onchain.Arbitrators.selectedFrom)
                                    ? window.Onchain.Arbitrators.selectedFrom('mo-onchain-arbs-selector')
                                    : [];
                                if (arbitrators.length !== 3) {
                                    alert(str_select_arbs_for_offer);
                                    submitBtn.disabled = false;
                                    submitBtn.textContent = str_publish_offer;
                                    return;
                                }
                                try {
                                    await window.Onchain.Trader.createOrder({
                                        kind:          kind,
                                        amountSats:    0,
                                        fiatCode:      fiatCode,
                                        fiatAmount:    isRange ? [minInt, maxInt] : minInt,
                                        paymentMethod: pm,
                                        premium:       parseFloat(premium),
                                        arbitrators:   arbitrators,
                                        content:       ''
                                    });
                                    document.body.removeChild(overlay);
                                } catch(e) {
                                    alert(t(str_onchain_offer_publish_err, e.message));
                                    submitBtn.disabled = false; submitBtn.textContent = str_publish_offer;
                                }
                                return;
                            }

                            // ---- LN PATH ----
                            // Robot con bonds y enable_bonds OFF: en Lightning no se puede operar.
                            // Como ya conocemos su política (kind 38385), abortamos ANTES de crear el
                            // trade local y mandar new-order. Con enable_bonds ON noxtr paga la fianza
                            // (pay-bond-invoice) y sigue el flujo normal, así que no se bloquea.
                            if (_bondsBlock(robotPubkey, 'make')) {
                                notify('⚠️ ' + str_robot_requires_bond_pre, 'error', 12000);
                                return;
                            }
                            // Instancia confirmada v1: mismo motivo que en takeOrder — mostrod ≥ 0.19
                            // no habla v1, el new-order se perdería en silencio.
                            if (_robotOldProtocol(robotPubkey)) {
                                notify('⚠️ ' + str_robot_old_protocol, 'error', 12000);
                                return;
                            }
                            // Auditoría 2026-08-22, alto #7: contrastar con los límites publicados en
                            // el 38385 antes de mandar new-order. Solo se aplican los criterios que
                            // la instancia efectivamente publica; si un tag falta, no se comprueba
                            // ese criterio (política conservadora — no romper cuando desconocemos el
                            // límite). La divisa sí bloquea (es un dato exacto, sin conversión de por
                            // medio); los importes solo avisan, ver más abajo.
                            var limits = MostroBook._robotLimits && MostroBook._robotLimits[robotPubkey];
                            if (limits) {
                                // Divisa: solo si la instancia publica un allowlist de currencies.
                                if (limits.fiatCurrencies && limits.fiatCurrencies.indexOf(String(fiatCode).toUpperCase()) === -1) {
                                    notify('⚠️ ' + t(str_currency_not_supported, fiatCode, limits.fiatCurrencies.join(', ')), 'error', 10000);
                                    return;
                                }
                                // Importe fiat: el mínimo del rango o el importe único no debe estar
                                // por debajo del mínimo publicado; el máximo del rango o el importe
                                // único no debe superar el máximo publicado.
                                // OJO: min_order_amount/max_order_amount del 38385 están en SATOSHIS
                                // (protocol/other_events.html: "The minimum/maximum amount of Satoshis
                                // allowed for exchange", límite global de la instancia, no por divisa),
                                // NO en la divisa fiat de la orden — hay que convertir con la cotización
                                // vigente antes de comparar. Bug real (2026-08-23): comparar sats crudos
                                // contra el importe en EUR bloqueaba órdenes válidas de 20€ con un
                                // "mínimo 100" que en realidad eran 100 sats.
                                // Este aviso es ORIENTATIVO, nunca bloqueante: el daemon valida el
                                // importe en SATOSHIS con SU proveedor de precio (app/order.rs:38-41
                                // → cant-do OutOfRangeSatsAmount, que el cliente ya sabe mostrar) y
                                // aquí se convierte con la cotización local. Las dos cuentas no son
                                // la misma, así que cerca del borde discrepan en ambos sentidos:
                                // bloquear con la nuestra rechazaría órdenes que el nodo aceptaría.
                                // De ahí también el colchón del 3% antes de decir nada.
                                var _EDGE = 0.03;
                                var _rate = parseFloat((MostroBook._priceCache.rates || {})[String(fiatCode).toUpperCase()]);
                                if (isFinite(_rate) && _rate > 0) {
                                    if (limits.minOrder != null) {
                                        var minFiat = (limits.minOrder / 100000000) * _rate;
                                        if (minInt < minFiat * (1 - _EDGE)) {
                                            var strLow = isRange ? str_range_below_min : str_amount_below_min;
                                            notify('⚠️ ' + t(strLow, MostroBook._formatFiatValue(minFiat), fiatCode) +
                                                ' ' + str_limit_estimate_note, 'warning', 10000);
                                        }
                                    }
                                    if (limits.maxOrder != null) {
                                        var maxFiat = (limits.maxOrder / 100000000) * _rate;
                                        var checkMax = isRange ? maxInt : minInt;
                                        if (checkMax > maxFiat * (1 + _EDGE)) {
                                            notify('⚠️ ' + t(str_amount_above_max, MostroBook._formatFiatValue(maxFiat), fiatCode) +
                                                ' ' + str_limit_estimate_note, 'warning', 10000);
                                        }
                                    }
                                }
                                // Sin cotización disponible: no se puede convertir sats→fiat con
                                // fiabilidad, así que no se bloquea por este criterio (misma política
                                // conservadora que cuando el tag no viene).
                            }

                            // Orden de campos = struct real SmallOrder de mostro-core (order.rs), verificado
                            // leyendo el código fuente: id?, kind, status, amount, fiat_code, min_amount,
                            // max_amount, fiat_amount, payment_method, premium, buyer_trade_pubkey?,
                            // seller_trade_pubkey?, buyer_invoice?, created_at, expires_at. Importa para que
                            // el hash que se firma en modo reputación coincida con el que recalcula mostrod
                            // (ver _buildMsg más arriba). expires_at no tiene skip_serializing_if en el
                            // struct real (a diferencia de created_at), así que el daemon siempre lo espera
                            // como clave presente aunque sea null.
                            var orderInner = {
                                kind: kind, status: 'pending', amount: 0,
                                fiat_code: fiatCode,
                                min_amount: isRange ? minInt : null,
                                max_amount: isRange ? maxInt : null,
                                fiat_amount: isRange ? 0 : minInt,
                                payment_method: pm,
                                // premium es i64 en el struct real: un decimal rompería la deserialización
                                // en el daemon (no solo la firma), de ahí el redondeo.
                                premium: Math.round(parseFloat(premium) || 0),
                            };
                            if (lnAddr && kind === 'buy') orderInner.buyer_invoice = lnAddr;
                            orderInner.created_at = 0;
                            orderInner.expires_at = null;
                            var orderPayload = { order: orderInner };

                            // Igual que en takeOrder: primero sincronizar/reservar el índice y
                            // después derivar EXACTAMENTE su clave NIP-06. Generar la clave antes
                            // podía hacer que seed_index y trade_index pertenecieran a dos N distintos.
                            await self.syncTradeIndex(robotPubkey);
                            var tIdx = await self._nextTradeIndex();
                            var kp = await _generateKeypair(tIdx);
                            if (tIdx) tIdx = kp.seedIndex;
                            var identityFingerprint = tIdx ? self._identityPub : 'privacy';
                            var tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

                            submitBtn.disabled = true; submitBtn.textContent = str_publishing;

                            var res = await self._ajax('mostro_trade_add', {
                                order_id: tempId, robot_pubkey: robotPubkey,
                                trade_kind: kind, trade_role: 'created', is_seller: isSeller,
                                fiat_amount: fiatVal, fiat_code: fiatCode, sat_amount: 0,
                                payment_method: pm, trade_privkey: kp.priv, trade_key_pub: kp.pub,
                                trade_index: tIdx, seed_index: kp.seedIndex,
                                identity_fingerprint: identityFingerprint, internal_status: 'enviando',
                            });
                            if (!res.ok) { alert(t(str_save_error, (res.msg || ''))); submitBtn.disabled = false; submitBtn.textContent = str_publish_offer; return; }

                            self._trades[tempId] = { order_id: tempId, robot_pubkey: robotPubkey,
                                trade_kind: kind, trade_role: 'created', is_seller: isSeller,
                                fiat_amount: fiatVal, fiat_code: fiatCode, sat_amount: 0,
                                payment_method: pm, trade_key_pub: kp.pub, trade_privkey: kp.priv,
                                trade_index: tIdx, seed_index: kp.seedIndex,
                                identity_fingerprint: identityFingerprint, _rangeOrder: isRange,
                                internal_status: 'enviando', updated_at: Math.floor(Date.now()/1000) };
                            self.subscribeMyTrades();
                            self.renderMyTrades();
                            document.body.removeChild(overlay);

                            try {
                                await self._sendToRobot('new-order', orderPayload, robotPubkey, kp.priv, null, tIdx);
                                if (_robotRequiresBond(robotPubkey, 'make')) {
                                    notify('⏳ ' + str_bond_waiting_invoice, 'info', 10000);
                                }
                            } catch(e) { console.error('[Mostro] Error enviando new-order:', e); }
                        }
                    }
                ]
            });

            // Handlers post-render: LN address visibility + range prima + red toggle
            setTimeout(function() {
                function _isOnchainSelected() {
                    var n = document.querySelector('input[name="mo-network"]:checked');
                    return n && n.value === 'onchain';
                }
                async function _updateOnchainKeysStatus() {
                    var el = document.getElementById('mo-onchain-keys-status');
                    if (!el) return;
                    var ok = window.Onchain && window.Onchain.Keys && window.Onchain.Keys.isUnlocked();
                    if (ok) {
                        var pubStr = '';
                        try {
                            var priv = await window.Onchain.Bip86.deriveCurrentTradeKey(0);
                            var pub  = window.Onchain.Bip86.privkeyToTradePubkey(priv);
                            pubStr   = pub.slice(0, 8) + '…' + pub.slice(-6);
                        } catch(e) {}
                        el.innerHTML = '<span style="color:#1b5e20;font-size:0.85em">&#10003; Clave configurada'
                            + (pubStr ? ' <code style="font-size:0.88em;color:#555;background:none">' + pubStr + '</code>' : '')
                            + '</span>'
                            + ' <button class="btn secondary" style="font-size:0.8em;padding:2px 8px" id="mo-btn-manage-keys">' + str_change_ellipsis + '</button>';
                        var mBtn = document.getElementById('mo-btn-manage-keys');
                        if (mBtn) mBtn.onclick = function() {
                            window.Onchain.Keys.openSetupDialog(function() { _updateOnchainKeysStatus(); });
                        };
                    } else {
                        el.innerHTML = '<span style="color:#e65100;font-size:0.85em">' + str_no_escrow_key + '</span>'
                            + '<button class="btn secondary" style="font-size:0.8em;padding:2px 8px" id="mo-btn-setup-keys">' + str_configure_ellipsis + '</button>';
                        var btn = document.getElementById('mo-btn-setup-keys');
                        if (btn) btn.onclick = function() {
                            window.Onchain.Keys.openSetupDialog(function() { _updateOnchainKeysStatus(); });
                        };
                    }
                }

                document.querySelectorAll('input[name="mo-kind"]').forEach(function(r) {
                    r.onchange = function() {
                        var row = document.getElementById('mo-lnaddr-row');
                        if (row) row.style.display = (!_isOnchainSelected() && r.value === 'buy') ? '' : 'none';
                    };
                });
                document.querySelectorAll('input[name="mo-network"]').forEach(function(r) {
                    r.onchange = function() {
                        var onchain = r.value === 'onchain';
                        var keysRow   = document.getElementById('mo-onchain-keys-row');
                        var arbsRow   = document.getElementById('mo-onchain-arbs-row');
                        var lnaddrRow = document.getElementById('mo-lnaddr-row');
                        var robotRow  = document.getElementById('mo-robot-row');
                        var kindVal   = document.querySelector('input[name="mo-kind"]:checked');
                        if (keysRow)   keysRow.style.display   = onchain ? '' : 'none';
                        if (arbsRow)   arbsRow.style.display   = onchain ? '' : 'none';
                        if (robotRow)  robotRow.style.display  = onchain ? 'none' : '';
                        if (lnaddrRow) lnaddrRow.style.display = (!onchain && kindVal && kindVal.value === 'buy') ? '' : 'none';
                        if (onchain) {
                            _updateOnchainKeysStatus();
                            if (window.Onchain && window.Onchain.Arbitrators && window.Onchain.Arbitrators.renderSelector) {
                                window.Onchain.Arbitrators.renderSelector('mo-onchain-arbs-selector');
                            }
                        }
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
                var fiatSelect = document.getElementById('mo-fiat-code');
                var sourceInfo = document.getElementById('mo-price-source-info');
                if (fiatSelect && sourceInfo) {
                    var refreshPriceInfo = function() {
                        sourceInfo.innerHTML = MostroBook._priceReferenceInfoHtml(fiatSelect.value);
                    };
                    fiatSelect.onchange = function() {
                        refreshPriceInfo();
                        MostroBook._fetchPriceRates([fiatSelect.value]);
                        setTimeout(refreshPriceInfo, 800);
                    };
                    MostroBook._fetchPriceRates([fiatSelect.value]);
                }
            }, 50);
        },

        // Take an order from the order book
        takeOrder: async function(order) {
            if (!Noxtr.Events.pubkey) { alert(str_login_to_take_offer); return; }
            // Bonds anti-abuse: si la instancia exige fianza y enable_bonds está OFF, no podemos operarla.
            // Avisamos antes de tomarla y sugerimos otro cliente u ofertas on-chain (sin bond).
            // Con enable_bonds ON noxtr paga la fianza tras tomar (pay-bond-invoice): no se bloquea.
            if (_bondsBlock(order.robotPubkey, 'take')) {
                notify('⚠️ ' + str_robot_requires_bond_pre, 'error', 12000);
                return;
            }
            // Instancia confirmada v1 (auditoría 2026-08-22): mostrod ≥ 0.19 no habla v1, el take se
            // perdería en silencio (recibe el kind 14 y calla). Abortar ANTES de crear el trade local.
            if (_robotOldProtocol(order.robotPubkey)) {
                notify('⚠️ ' + str_robot_old_protocol, 'error', 12000);
                return;
            }
            // El aviso de la fianza (importe estimado, antes de tomar) va dentro de los diálogos que
            // vienen a continuación — _collectTakeSellInputs y el confirm de más abajo — vía
            // _bondNoticeText. Aquí no cabe un notify: quedaría tapado por el overlay del diálogo.
            // isSell order → we are buyer → action = take-sell-order, is_seller = 0
            // isBuy order  → we are seller → action = take-buy-order, is_seller = 1
            var isSell = order.orderType === 'sell';
            var action = isSell ? 'take-sell' : 'take-buy';
            var isSeller = isSell ? 0 : 1;
            var sideMsg = isSell ? str_buy_btc : str_sell_btc;
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
                var confirmMsg = t(str_confirm_take_order, sideMsg, fiatLabel, order.paymentMethod);
                // Fianza: se dice aquí, en el propio confirm, para que se lea antes de aceptar.
                var bondNotice = _bondNoticeText(order);
                if (bondNotice) confirmMsg += '\n\n⚠️ ' + bondNotice;
                var ok = await Promise.resolve(confirm(confirmMsg));
                if (!ok) return;
            }

            // Remove any terminal trade in memory for this order_id (allows re-take after cancel)
            var _termSt = { 'cancelado': true, 'completado': true, 'disputado': true };
            if (this._trades[order.id] && _termSt[this._trades[order.id].internal_status]) {
                delete this._trades[order.id];
            }

            // Reputación de la contraparte (el maker): la orden 38383 trae el tag `rating`. La guardamos
            // ahora porque al tomarse la orden desaparece del book. Se mostrará en la ficha del trade.
            if (order.rating) _savePeerRep(order.id, order.rating);

            // Antes de gastar índice: preguntar al nodo por dónde va su contador para esta identidad
            // (ver syncTradeIndex). Sin esto, un take desde una identidad que ya operó en Mostro
            // Mobile sale con un índice ya usado y el daemon lo rechaza con InvalidTradeIndex.
            await this.syncTradeIndex(order.robotPubkey);
            var tIdx = await this._nextTradeIndex();
            var kp = await _generateKeypair(tIdx);
            if (tIdx) tIdx = kp.seedIndex;
            var identityFingerprint = tIdx ? this._identityPub : 'privacy';
            // Payload::Amount es i64 en el struct real: un decimal rompe la deserialización en el
            // daemon (el take falla sin cant-do). chosenRangeFiat puede venir con decimales.
            var takePayload = order.isRange ? { amount: Math.round(chosenRangeFiat) } : null;
            var localFiatAmount = order.isRange ? MostroBook._formatFiatValue(chosenRangeFiat) : String(order.fiatAmount);

            var res = await this._ajax('mostro_trade_add', {
                order_id: order.id, robot_pubkey: order.robotPubkey,
                trade_kind: order.orderType, trade_role: 'taken', is_seller: isSeller,
                fiat_amount: localFiatAmount, fiat_code: order.fiatCode,
                sat_amount: order.satAmount || 0, payment_method: order.paymentMethod,
                trade_privkey: kp.priv, trade_key_pub: kp.pub, trade_index: tIdx,
                seed_index: kp.seedIndex, identity_fingerprint: identityFingerprint,
                internal_status: 'enviando',
            });
            if (!res.ok) { alert(t(str_save_error, (res.msg || ''))); return; }

            var trade = { order_id: order.id, robot_pubkey: order.robotPubkey, trade_kind: order.orderType,
                trade_role: 'taken', is_seller: isSeller, fiat_amount: localFiatAmount,
                fiat_code: order.fiatCode, sat_amount: order.satAmount || 0, payment_method: order.paymentMethod,
                trade_key_pub: kp.pub, trade_privkey: kp.priv, trade_index: tIdx, seed_index: kp.seedIndex,
                identity_fingerprint: identityFingerprint,
                internal_status: 'enviando',
                _rangeOrder: !!order.isRange, _rangeFiatAmount: chosenRangeFiat, _pendingInvoiceInput: pendingInvoiceInput,
                updated_at: Math.floor(Date.now()/1000) };
            this._trades[order.id] = trade;
            // Se guarda aparte para poder prerellenar el input de la ficha si el envío automático
            // no llega a salir: _pendingInvoiceInput se consume y se borra, este no.
            if (pendingInvoiceInput) _saveInvoiceInput(order.id, pendingInvoiceInput);
            this.subscribeMyTrades();
            this.renderMyTrades();

            try {
                await this._sendToRobot(action, takePayload, order.robotPubkey, kp.priv, order.id, tIdx);
                // Robot con bonds: avisamos de que esperamos su factura de fianza (pay-bond-invoice).
                // La factura la genera el nodo de la instancia; noxtr no puede fabricarla. Si no llega, es
                // que la instancia no contestó al take.
                if (_robotRequiresBond(order.robotPubkey, 'take')) {
                    notify('⏳ ' + str_bond_waiting_invoice, 'info', 10000);
                }
            } catch(e) {
                console.error('[Mostro] Error enviando ' + action + ':', e);
            }
        },
    };

    // ==================== ROBOTS MOSTRO (Communities) ====================

    var MostroCommunities = {
        _LS_KEY: 'noxtr_mostro_communities',
        _LS_REMOTE_KEY: 'noxtr_mostro_communities_remote', // cache de la última lista remota: { fetchedAt, items }
        _SHOW_UNVERIFIED_KEY: 'noxtr_mostro_show_unverified',
        // No repetir el auto-fetch en carga de página más de 1 vez cada 15 min. Estaba en 6 h, que
        // es demasiado para una lista curada que se edita a mano: una instancia añadida al JSON no
        // aparecía hasta pasadas horas, y recargar la página no servía de nada (el botón ↻ sí, que
        // fuerza el fetch). El coste de bajarlo es una petición a NOXTR_MOSTRO_INSTANCES_URL por
        // carga de página, como mucho una cada cuarto de hora.
        _REMOTE_TTL_MS: 15 * 60 * 1000,
        _list: null, // [{ name, hex, active, verified }]
        _showUnverified: null,
        _refreshing: false,

        _decodeCommunity: function (c) {
            var hex = c.hex || null;
            if (!hex && c.npub) { try { hex = Noxtr.npubDecode(c.npub); } catch (e) {} }
            hex = hex ? String(hex).toLowerCase() : '';
            return /^[a-f0-9]{64}$/.test(hex)
                ? { name: c.name || '', hex: hex, active: c.active !== false, verified: c.verified === true }
                : null;
        },

        isVerified: function (hex) {
            hex = String(hex || '').toLowerCase();
            var c = (this._list || []).find(function (item) { return item && item.hex === hex; });
            return !!(c && c.verified === true);
        },

        // Identidad corta de una instancia para las fichas de ofertas.
        // Chip vN del protocol_version (38385): v1 rojo (vieja, no operable), v2 verde (actual),
        // >2 ámbar (más nueva que este cliente — no es "vieja", pero tampoco la hablamos aún).
        // Genérico: una futura v3 se pinta sola sin tocar nada. '' si aún no llegó el 38385.
        protoChipHtml: function (hex) {
            var proto = MostroBook._robotProto[String(hex || '').toLowerCase()];
            if (proto == null) return '';
            var cls = proto === 2 ? 'mostro-proto-ok' : (proto < 2 ? 'mostro-proto-old' : 'mostro-proto-new');
            return '<span class="mostro-proto-chip ' + cls + '" data-hex="' + _escHtml(hex) + '" ' +
                'title="' + _escHtml(t(str_robot_proto_tip, String(proto))) + '">v' + _escHtml(String(proto)) + '</span>';
        },

        robotIdentityHtml: function (hex) {
            hex = String(hex || '').toLowerCase();
            var c = (this._list || []).find(function (item) { return item && item.hex === hex; });
            var name = c && c.name ? c.name : (hex ? Noxtr.Profiles.displayName(hex) : '?');
            var avatar = hex ? Noxtr.Profiles.avatar(hex) : null;
            var avatarHtml = avatar
                ? '<img class="mostro-robot-avatar" src="' + _escHtml(avatar) + '" alt="">'
                : '<span class="mostro-robot-avatar mostro-robot-avatar-ph">🤖</span>';
            var verificationClass = this.isVerified(hex) ? '' : ' instance-not-verified';
            return '<span class="mostro-robot-id' + verificationClass + '" data-robot="' + _escHtml(hex) + '" title="' + _escHtml(hex) + '">' +
                avatarHtml + '<span class="mostro-robot-name">' + _escHtml(name) + '</span>' + this.protoChipHtml(hex) + '</span>';
        },

        // Cache de la última lista válida leída del directorio. Solo acelera el primer pintado;
        // cada carga comprueba después la URL configurada y reconstruye la lista exactamente.
        _loadRemoteCache: function () {
            try {
                var raw = JSON.parse(localStorage.getItem(this._LS_REMOTE_KEY) || 'null');
                // Las caches creadas antes de `verified` no sirven como directorio de confianza:
                // invalidarlas fuerza un JSON nuevo y evita marcar temporalmente todo como no verificado.
                if (raw && Array.isArray(raw.items) && raw.items.every(function(c) {
                    return c && typeof c.verified === 'boolean';
                })) return raw;
            } catch (e) {}
            return null;
        },

        _saveRemoteCache: function (items) {
            try { localStorage.setItem(this._LS_REMOTE_KEY, JSON.stringify({ fetchedAt: Date.now(), items: items })); } catch (e) {}
        },

        // Sincroniza la lista con una respuesta remota válida. El JSON remoto es la fuente
        // de verdad: añade, modifica y elimina para reproducirlo exactamente. Solo se conserva
        // la preferencia activo/inactivo del usuario para las pubkeys que siguen existiendo.
        _syncRemoteList: function (items) {
            var current = {};
            (this._list || []).forEach(function (c) {
                if (c && c.hex) current[c.hex] = c;
            });
            var before = JSON.stringify(this._list || []);
            this._list = (items || []).map(function (remote) {
                var local = current[remote.hex];
                return {
                    name: remote.name || '',
                    hex: remote.hex,
                    active: local ? local.active !== false : remote.active !== false,
                    verified: remote.verified === true
                };
            });
            this._save();
            return before !== JSON.stringify(this._list);
        },

        load: function () {
            try {
                var saved = JSON.parse(localStorage.getItem(this._LS_KEY) || 'null');
                var cache = this._loadRemoteCache();
                var source = Array.isArray(saved) ? saved : ((cache && cache.items) || []);
                this._list = source.map(function(c) {
                    var norm = MostroCommunities._decodeCommunity(c);
                    if (norm) norm.active = c.active !== false;
                    return norm;
                }).filter(function(c, i, arr) {
                    return !!c && arr.findIndex(function(x) { return x && x.hex === c.hex; }) === i;
                });
                // Migración: versiones antiguas guardaban una blacklist de instancias borradas.
                localStorage.removeItem('noxtr_mostro_communities_removed');
            } catch (e) { this._list = this._list || []; }
            this._loadShowUnverified();
        },

        _loadShowUnverified: function () {
            try {
                this._showUnverified = localStorage.getItem(this._SHOW_UNVERIFIED_KEY) !== '0';
                localStorage.removeItem('noxtr_mostro_show_verified');
            }
            catch (e) { this._showUnverified = true; }
        },

        _saveShowUnverified: function () {
            try { localStorage.setItem(this._SHOW_UNVERIFIED_KEY, this._showUnverified ? '1' : '0'); } catch (e) {}
        },

        _save: function () {
            try { localStorage.setItem(this._LS_KEY, JSON.stringify(this._list)); } catch (e) {}
        },

        // Lee primero NOXTR_MOSTRO_INSTANCES_URL. Si falla HTTP, JSON o validación, reintenta
        // directamente contra el json.php del módulo. Una respuesta válida reemplaza la lista.
        refreshRemote: function (opts) {
            opts = opts || {};
            var self = this;
            var primaryUrl = window.NOXTR_MOSTRO_INSTANCES_URL;
            var fallbackUrl = window.NOXTR_MOSTRO_INSTANCES_FALLBACK_URL;
            if ((!primaryUrl && !fallbackUrl) || this._refreshing) return Promise.resolve(false);

            if (!opts.force) {
                var cache = this._loadRemoteCache();
                if (cache && (Date.now() - cache.fetchedAt) < this._REMOTE_TTL_MS) return Promise.resolve(false);
            }

            this._refreshing = true;
            var fetchDirectory = function(url) {
                if (!url) return Promise.reject(new Error('URL de instancias vacía'));
                return fetch(url, { cache: 'no-store' }).then(async function (r) {
                    var body = await r.text();
                    if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
                    var data;
                    try { data = JSON.parse(body); }
                    catch (e) {
                        var summary = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
                        throw new Error('La URL no devolvió JSON' + (summary ? ': ' + summary : ''));
                    }
                    if (!Array.isArray(data) || !data.length) throw new Error('Directorio de instancias vacío');
                    return data;
                }).then(function(data) {
                var items = data.map(function (c) { return self._decodeCommunity(c); }).filter(function (c) { return !!c; });
                    if (items.length !== data.length) throw new Error('Directorio con entradas inválidas');
                    return items;
                });
            };

            return fetchDirectory(primaryUrl || fallbackUrl).catch(function(primaryError) {
                if (!fallbackUrl || fallbackUrl === primaryUrl) throw primaryError;
                _mostroDebugWarn('[Mostro] Directorio principal no disponible; usando json.php:', primaryError.message || primaryError);
                return fetchDirectory(fallbackUrl);
            }).then(function (items) {
                self._saveRemoteCache(items);
                if (!self._list) self.load();
                var changed = self._syncRemoteList(items);
                if (changed) self._reloadWithFilter();
                else self.render();
                return true;
            }).catch(function (e) {
                console.error('[Mostro] Error actualizando instancias:', e);
                return false;
            }).finally(function () { self._refreshing = false; });
        },

        // Devuelve array de hex de robots activos, o null si todos están inactivos
        activeHexList: function () {
            if (!this._list) this.load();
            var active = this._list.filter(function (c) { return c.active && c.hex; });
            return active.length ? active.map(function (c) { return c.hex; }) : null;
        },

        // Diálogo de info de la instancia: vuelca el último 38385 recibido (equivalente a la
        // sección "Nodo Mostro" de Mostro Mobile). Los nombres de campo son los tags técnicos
        // del protocolo (no se traducen); los tags multi-valor se unen con comas.
        openInstanceInfo: function (hex) {
            var c = (this._list || []).find(function (x) { return x.hex === hex; });
            var name = (c && c.name) || Noxtr.Profiles.displayName(hex);
            var ev = MostroBook._robotStatus[hex];
            var body;
            if (!ev) {
                body = '<div class="mo-hint">' + str_instance_no_status + '</div>';
            } else {
                var rows = [
                    ['pubkey', hex],
                    ['updated_at', new Date(ev.created_at * 1000).toLocaleString()]
                ];
                (ev.tags || []).forEach(function (tg) {
                    if (!tg || tg.length < 2 || tg[0] === 'd') return; // d = pubkey, ya mostrado
                    rows.push([tg[0], tg.slice(1).join(', ')]);
                });
                body = '<div class="mostro-inst-info">' + rows.map(function (r) {
                    return '<div class="mostro-inst-row"><span class="mostro-inst-k">' + _escHtml(r[0]) +
                        '</span><span class="mostro-inst-v">' + _escHtml(r[1]) + '</span></div>';
                }).join('') + '</div>';
            }
            $('body').dialog({
                title: 'ⓘ ' + _escHtml(str_instance_label + ' — ' + name),
                type: 'html',
                width: '480px',
                openAnimation: 'zoom',
                closeAnimation: 'fade',
                content: body,
                buttons: [{
                    text: str_close,
                    class: 'btn',
                    action: function (_e, overlay) { document.body.removeChild(overlay); }
                }]
            });
        },

        render: function () {
            var el = document.getElementById('mostro-communities');
            if (!el) return;
            if (!this._list) this.load();
            if (this._showUnverified === null) this._loadShowUnverified();
            var self = this;

            // Solicitar perfiles para avatares
            this._list.forEach(function (c) { if (c.hex) Noxtr.Profiles.request(c.hex); });

            var itemsHtml = this._list.map(function (c, i) {
                if (c.verified !== true && !self._showUnverified) return '';
                var avatarUrl = c.hex ? Noxtr.Profiles.avatar(c.hex) : null;
                var name = c.name || (c.hex ? Noxtr.Profiles.displayName(c.hex) : '?');
                var avatarHtml = avatarUrl
                    ? '<img class="mostro-comm-avatar" src="' + _escHtml(avatarUrl) + '" alt="">'
                    : '<span class="mostro-comm-avatar mostro-comm-avatar-ph">' + _escHtml(name.charAt(0).toUpperCase()) + '</span>';
                // Chip vN (clickable → diálogo de info) en cuanto conocemos el protocol_version;
                // mientras no haya llegado el 38385, ⓘ como acceso alternativo al diálogo.
                var protoChip = c.hex ? self.protoChipHtml(c.hex) : '';
                return '<span class="mostro-comm-item' + (c.active ? ' mostro-comm-active' : '') + (c.verified === true ? '' : ' instance-not-verified') + '" data-idx="' + i + '">' +
                    avatarHtml +
                    '<span class="mostro-comm-name">' + _escHtml(name) + '</span>' +
                    (protoChip || (c.hex ? '<a class="mostro-comm-info" data-hex="' + _escHtml(c.hex) + '" title="' + _escHtml(str_instance_label) + '">ⓘ</a>' : '')) +
                '</span>';
            }).join('');

            var addHtml = '<label class="mostro-comm-unverified-filter"><input type="checkbox" id="mostro-show-unverified"' + (this._showUnverified ? ' checked' : '') + '> ' + str_show_unverified_instances + '</label>' +
                '<a class="mostro-comm-refresh" title="' + str_refresh_instances_title + '">🔄</a>';

            el.innerHTML = '<div class="mostro-comm-bar">' + itemsHtml + addHtml + '</div>';

            var unverifiedCheck = document.getElementById('mostro-show-unverified');
            if (unverifiedCheck) unverifiedCheck.onchange = function () {
                self._showUnverified = !!this.checked;
                self._saveShowUnverified();
                self.render();
            };

            // Actualizar: vuelve a leer el directorio principal (o json.php si falla).
            var refreshBtn = el.querySelector('.mostro-comm-refresh');
            if (refreshBtn) refreshBtn.onclick = function (e) {
                if (e) e.preventDefault();
                if (self._refreshing) return;
                refreshBtn.classList.add('mostro-comm-spin');
                self.refreshRemote({ force: true }).then(function (ok) {
                    refreshBtn.classList.remove('mostro-comm-spin');
                    notify(ok ? '✅ ' + str_instances_refreshed : '⚠️ ' + str_instances_refresh_error, ok ? 'success' : 'warning', 4000);
                }).catch(function (e) {
                    refreshBtn.classList.remove('mostro-comm-spin');
                    console.error('[Mostro] Error al pulsar actualizar instancias:', e);
                    notify('⚠️ ' + str_instances_refresh_error, 'warning', 4000);
                });
            };

            // Toggle activo/inactivo al hacer click en el chip
            el.querySelectorAll('.mostro-comm-item').forEach(function (item) {
                item.onclick = function (e) {
                    if (e.target.classList.contains('mostro-comm-info')) return;
                    if (e.target.classList.contains('mostro-proto-chip')) return;
                    var idx = parseInt(item.dataset.idx);
                    self._list[idx].active = !self._list[idx].active;
                    self._save();
                    self._reloadWithFilter();
                };
            });

            // Chip vN / ⓘ de cada instancia → diálogo de info (openInstanceInfo, que estaba
            // huérfano desde que se quitó su disparador original).
            el.querySelectorAll('.mostro-comm-info, .mostro-comm-item .mostro-proto-chip').forEach(function (btn) {
                btn.onclick = function (e) {
                    e.stopPropagation();
                    self.openInstanceInfo(btn.dataset.hex);
                };
            });

            // Segundo acceso: click en la identidad del robot (avatar + nombre + chip v1/v2)
            // dentro de las tarjetas del order book. Delegado a document una sola vez para
            // sobrevivir a los re-render del book.
            if (!this._infoDelegated) {
                this._infoDelegated = true;
                document.addEventListener('click', function (e) {
                    var idEl = e.target.closest && e.target.closest('.mostro-robot-id[data-robot]');
                    if (idEl && idEl.dataset.robot) MostroCommunities.openInstanceInfo(idEl.dataset.robot);
                });
            }

        }
    };

    // ==================== ORDER BOOK ====================

    var MostroBook = {
        orders: {},
        _closedOrders: {},
        _robotPow: {},   // robotPubkeyHex → required PoW difficulty (from kind 38385)
        _robotPowFirstContact: {}, // robotPubkeyHex → pow_first_contact (tag "pow_first_contact" del kind 38385)
        _robotProto: {}, // robotPubkeyHex → protocol_version (tag "protocol_version" del kind 38385; 1 si el tag no está)
        _robotBond: {},  // robotPubkeyHex → { enabled, applyTo } política de bonds (kind 38385)
        _robotLimits: {}, // robotPubkeyHex → { minOrder, maxOrder, fiatCurrencies, expirationHours } del kind 38385
        _robotStatus: {},  // robotPubkeyHex → último evento 38385 crudo (para el diálogo de info)
        _robotStatusAt: {}, // robotPubkeyHex → created_at del último 38385 procesado (descarta rancios)
        _reputation38384: {}, // tradePubkeyHex → {total_reviews, total_rating, days} del kind 38384 firmado por Mostro
        _subId: null,
        _oldestAt: null,
        _eoseReached: false,
        _newRecentCount: 0,
        _latestAtEose: 0,
        _freshIds: null,
        _deepLinkId: null,   // order id llegado en la URL (/noxtr/mostro/ID): expandir + resaltar
        _deepLinkDone: false,
        _visibleCount: 10,
        _loadingMore: false,
        _noMoreToLoad: false,
        _pmChips: null,
        _fiatFilter: null,
        _showLnp2pbot: null,
        _showBuy: null,
        _showSell: null,
        _showMostro: null,
        _showOnchain: null,
        _adminShown: false,
        _minDays: null,
        _PM_LS_KEY:   'noxtr_mostro_pm_chips',
        _LNP_LS_KEY:  'noxtr_mostro_lnp2pbot',
        _SIDE_LS_KEY: 'noxtr_mostro_side',
        _SRC_LS_KEY:  'noxtr_mostro_src',
        _DAYS_LS_KEY: 'noxtr_mostro_min_days',
        _PM_DEFAULTS: ['Bizum','SEPA','Transferencia','Revolut','N26','Halcash','BBVA','PayPal','Wise','Efectivo','MercadoPago','Zelle','Strike'],

        _isTrustedMostroAuthor: function(pubkey, orderOrDisputeId, allowDiscovery) {
            pubkey = String(pubkey || '').toLowerCase();
            var active = MostroCommunities.activeHexList() || [];
            if (active.map(function(p) { return String(p).toLowerCase(); }).indexOf(pubkey) !== -1) return true;
            // Sin ninguna instancia activa, el orderbook entra en modo descubrimiento. Solo los
            // eventos de órdenes llaman con allowDiscovery=true; las disputas públicas mantienen
            // el control estricto para que un autor desconocido no pueda reconciliar un trade local.
            if (allowDiscovery && active.length === 0) return true;
            // Los eventos de un trade propio siguen siendo válidos aunque su instancia se haya
            // desactivado después: se cotejan contra el robot persistido en ese trade.
            if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                for (var oid in MostroTrader._trades) {
                    var tr = MostroTrader._trades[oid];
                    if (!tr || String(tr.robot_pubkey || '').toLowerCase() !== pubkey) continue;
                    if (!orderOrDisputeId || oid === orderOrDisputeId || tr.dispute_id === orderOrDisputeId) return true;
                }
            }
            return false;
        },

        // Cotización fiat/BTC para órdenes a precio de mercado. Solo visual; TTL 60s.
        _PRICE_SOURCE_KEY: 'noxtr_mostro_price_source',
        _PRICE_SOURCES: [
            { id: 'yadio',    label: 'Yadio',     icon: 'Y' },
            { id: 'kraken',   label: 'Kraken',    icon: 'K' },
            { id: 'bitfinex', label: 'Bitfinex',  icon: 'B' },
            { id: 'coinbase', label: 'Coinbase',  icon: 'C' },
            { id: 'coingecko', label: 'CoinGecko', icon: 'G' }
        ],
        _priceSource: 'yadio',
        _priceCache: { rates: null, fetchedAt: 0, fetching: false, bySource: {} },

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
        // Fuente de verdad: CLI_USER_CFG (server). Ya NO se usa localStorage: guardaba el
        // filtro por PC y pisaba al de servidor, provocando desync entre equipos.
        _loadFiatFilter: function() {
            // Fallback sincrono (usado por render/menu antes de que resuelva _fetchFiatFilter).
            if (!Array.isArray(this._fiatFilter)) this._fiatFilter = [];
        },
        _fetchFiatFilter: async function() {
            try {
                var res = await MostroTrader._ajax('get_fiat_filter', {});
                this._fiatFilter = (res && Array.isArray(res.codes)) ? res.codes : [];
            } catch(e) { if (!Array.isArray(this._fiatFilter)) this._fiatFilter = []; }
            this.render();
        },
        _saveFiatFilter: function() {
            // Persiste en CLI_USER_CFG; el monitor lo usa para filtrar avisos de nuevas ofertas.
            try { MostroTrader._ajax('save_fiat_filter', { codes: this._fiatFilter.join(',') }); } catch(e) {}
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
        // Filtro de fuente: Mostro (Lightning P2P, incluye lnp2pbot) vs on-chain. Por defecto ambos ON.
        _loadSrc: function() {
            try {
                var s = JSON.parse(localStorage.getItem(this._SRC_LS_KEY) || '{}');
                this._showMostro  = s.mostro  !== false;
                this._showOnchain = s.onchain !== false;
            } catch(e) { this._showMostro = true; this._showOnchain = true; }
        },
        _saveSrc: function() {
            try { localStorage.setItem(this._SRC_LS_KEY, JSON.stringify({ mostro: this._showMostro, onchain: this._showOnchain })); } catch(e) {}
        },
        // Con la fuente Mostro desactivada se ocultan las comunidades (instancias robot) y el panel
        // admin de Mostro: son especificos de Mostro/Lightning, no aplican a on-chain.
        _applySourceVisibility: function() {
            if (this._showMostro === null) this._loadSrc();
            var comm  = document.getElementById('mostro-communities');
            var admin = document.getElementById('mostro-admin-panel');
            if (comm)  comm.style.display  = this._showMostro ? '' : 'none';
            if (admin) admin.style.display = (this._showMostro && this._adminShown) ? '' : 'none';
        },
        _loadMinDays: function() {
            this._minDays = parseInt(localStorage.getItem(this._DAYS_LS_KEY) || '0') || 0;
        },
        _saveMinDays: function() {
            try { localStorage.setItem(this._DAYS_LS_KEY, String(this._minDays)); } catch(e) {}
        },
        _loadPriceSource: function() {
            var saved = '';
            try { saved = localStorage.getItem(this._PRICE_SOURCE_KEY) || ''; } catch(e) {}
            if (this._PRICE_SOURCES.some(function(s) { return s.id === saved; })) this._priceSource = saved;
        },
        _priceSourceLabel: function(id) {
            var s = this._PRICE_SOURCES.filter(function(x) { return x.id === id; })[0];
            return s ? s.label : id;
        },
        _formatFiatValue: function(value) {
            var n = parseFloat(value);
            if (!isFinite(n)) return String(value || '?');
            return Math.floor(n) === n ? String(n) : String(n).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
        },
        // Formato exclusivamente visual para las fichas del order book.
        // No usar para cálculos ni para enviar importes al protocolo.
        _formatFiatCardValue: function(value) {
            if (value === null || value === undefined || value === '') return '?';
            var n = parseFloat(String(value).replace(',', '.'));
            if (!isFinite(n)) return String(value || '?');
            try {
                return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
            } catch(e) {
                return this._formatFiatValue(n);
            }
        },
        _formatOrderFiatLabel: function(order) {
            if (order && order.isRange && isFinite(order.fiatMin) && isFinite(order.fiatMax)) {
                return this._formatFiatCardValue(order.fiatMin) + ' - ' + this._formatFiatCardValue(order.fiatMax) + ' ' + (order.fiatCode || '');
            }
            return this._formatFiatCardValue(order && order.fiatAmount) + ' ' + (order && order.fiatCode || '');
        },
        // En Mostro una orden de rango siempre cotiza a mercado: el cliente oficial impide
        // combinar rango fiat con precio fijo y envía amount=0. Algunas instancias/órdenes
        // antiguas publican, pese a ello, un `amt` positivo (normalmente una referencia al
        // máximo del rango). No convertir ese valor en precio fijo: dividir fiatMin/amt
        // inventaría una cotización que no pertenece a la orden.
        _isFixedPriceOrder: function(o) {
            if (!o || !(o.satAmount > 0)) return false;
            if (o.daemon === 'mostro' && o.isRange) return false;
            return true;
        },
        // Devuelve precio estimado fiat/BTC para una orden. Null si no se puede calcular.
        // - precio fijo: exacto = (fiat / sats) * 1e8.
        // - precio de mercado: fuente seleccionada * (1 + premium/100).
        _estimatePrice: function(o) {
            if (!o) return null;
            if (this._isFixedPriceOrder(o)) {
                var fiatAmt = o.isRange ? parseFloat(o.fiatMin) : parseFloat(o.fiatAmount);
                if (!isFinite(fiatAmt) || fiatAmt <= 0) return null;
                return (fiatAmt / o.satAmount) * 100000000;
            }
            var rates = this._priceCache.rates;
            if (!rates || !o.fiatCode) return null;
            var rate = parseFloat(rates[o.fiatCode]);
            if (!isFinite(rate) || rate <= 0) return null;
            var prem = parseFloat(o.premium) || 0;
            return rate * (1 + prem / 100);
        },
        _priceComparisonClass: function(o, price) {
            var rates = this._priceCache.rates || {};
            var market = parseFloat(rates[o && o.fiatCode]);
            if (!isFinite(market) || market <= 0 || !isFinite(price) || price <= 0) return '';
            var difference = (price / market) - 1;
            if (difference > 0.01) return ' mostro-price-above';
            if (difference < -0.01) return ' mostro-price-below';
            return '';
        },
        _priceReferenceInfoHtml: function(code) {
            this._loadPriceSource();
            var source = this._priceSourceLabel(this._priceSource);
            var rate = parseFloat((this._priceCache.rates || {})[String(code || '').toUpperCase()]);
            var quote = isFinite(rate) && rate > 0
                ? ' · ' + _escHtml(Math.round(rate).toLocaleString()) + ' ' + _escHtml(String(code).toUpperCase()) + '/BTC'
                : '';
            return '<span>' + str_active_price_source + ': <strong>' + _escHtml(source) + '</strong>' + quote + '</span>';
        },
        _formatPriceQuote: function(price, fiatCode) {
            if (!isFinite(price) || price <= 0) return '';
            var rounded = Math.round(price);
            var formatted;
            try { formatted = rounded.toLocaleString(); } catch(e) { formatted = String(rounded); }
            return '≈ ' + formatted + ' ' + (fiatCode || '') + '/BTC';
        },
        _fetchJson: function(url) {
            return fetch(url).then(function(r) {
                if (!r.ok) throw new Error('http ' + r.status);
                return r.json();
            });
        },
        _sourceRate: function(source, code) {
            var pair = String(code || '').toUpperCase();
            var url = '';
            if (source === 'kraken') {
                var krakenPairs = { USD: 'XBTUSD', EUR: 'XXBTZEUR', GBP: 'XXBTZGBP', CAD: 'XBTCAD', AUD: 'XBTAUD', JPY: 'XBTJPY' };
                if (!krakenPairs[pair]) return Promise.resolve(null);
                url = 'https://api.kraken.com/0/public/Ticker?pair=' + krakenPairs[pair];
                return this._fetchJson(url).then(function(data) {
                    var result = data && data.result ? data.result : {};
                    var keys = Object.keys(result);
                    var ticker = keys.length ? result[keys[0]] : null;
                    return ticker && ticker.c ? parseFloat(ticker.c[0]) : null;
                });
            }
            if (source === 'bitfinex') {
                if (['USD','EUR','GBP','JPY'].indexOf(pair) === -1) return Promise.resolve(null);
                url = 'https://api-pub.bitfinex.com/v2/tickers?symbols=tBTC' + pair;
                return this._fetchJson(url).then(function(data) {
                    return Array.isArray(data) && Array.isArray(data[0]) ? parseFloat(data[0][7]) : null;
                });
            }
            if (source === 'coinbase') {
                if (['USD','EUR','GBP'].indexOf(pair) === -1) return Promise.resolve(null);
                url = 'https://api.exchange.coinbase.com/products/BTC-' + pair + '/ticker';
                return this._fetchJson(url).then(function(data) { return data && data.price ? parseFloat(data.price) : null; });
            }
            return Promise.resolve(null);
        },
        _fetchPriceRates: function(codes, refreshOnly) {
            var self = this;
            var now = Date.now();
            codes = (codes || []).map(function(c) { return String(c || '').toUpperCase(); }).filter(Boolean);
            codes = codes.filter(function(c, i, a) { return a.indexOf(c) === i; });
            if (!codes.length || this._priceCache.fetching) return;
            var source = this._priceSource;
            var key = codes.slice().sort().join(',');
            var cached = this._priceCache.bySource[source];
            if (cached && cached.key === key && (now - cached.fetchedAt) < 5000) {
                this._priceCache.rates = cached.rates;
                this._priceCache.fetchedAt = cached.fetchedAt;
                return;
            }
            this._priceCache.fetching = true;
            var request;
            if (source === 'yadio') {
                // exrates/BTC devuelve fiat por 1 BTC.
                request = this._fetchJson('https://api.yadio.io/exrates/BTC').then(function(data) {
                    var all = data && data.BTC && typeof data.BTC === 'object' ? data.BTC : data;
                    var rates = {};
                    codes.forEach(function(c) { if (all && all[c] != null) rates[c] = parseFloat(all[c]); });
                    return rates;
                });
            } else if (source === 'bitfinex') {
                // Bitfinex no permite CORS: se consulta mediante el proxy same-origin de Noxtr.
                request = MostroTrader._ajax('get_bitfinex_rates', { codes: codes.join(',') })
                    .then(function(data) { return data && data.rates ? data.rates : {}; });
            } else if (source === 'coingecko') {
                // API pública keyless; una sola llamada permite pedir varias monedas fiat.
                request = this._fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=' + encodeURIComponent(codes.join(',')))
                    .then(function(data) {
                        var btc = data && data.bitcoin ? data.bitcoin : {};
                        var rates = {};
                        codes.forEach(function(c) { if (btc[c.toLowerCase()] != null) rates[c] = parseFloat(btc[c.toLowerCase()]); });
                        return rates;
                    });
            } else {
                request = Promise.all(codes.map(function(c) {
                    return self._sourceRate(source, c).then(function(rate) { return { code: c, rate: rate }; });
                })).then(function(items) {
                    var rates = {};
                    items.forEach(function(x) { if (isFinite(x.rate) && x.rate > 0) rates[x.code] = x.rate; });
                    return rates;
                });
            }
            request.then(function(rates) {
                var ts = Date.now();
                self._priceCache.rates = rates || {};
                self._priceCache.fetchedAt = ts;
                self._priceCache.bySource[source] = { rates: rates || {}, fetchedAt: ts, key: key };
                if (refreshOnly) self._updateDisplayedPrices(codes);
                else self.render();
            }).catch(function() {
                self._priceCache.rates = {};
                self._priceCache.fetchedAt = 0;
                if (refreshOnly) self._updateDisplayedPrices(codes);
                else self.render();
            }).then(function() {
                self._priceCache.fetching = false;
            });
        },
        _flashPriceNode: function(node) {
            node.classList.remove('mostro-price-reference-value-changed', 'mostro-price-value-changed');
            void node.offsetWidth;
            node.classList.add(node.classList.contains('mostro-price-value')
                ? 'mostro-price-value-changed'
                : 'mostro-price-reference-value-changed');
        },
        _updateDisplayedPrices: function(codes) {
            var self = this;
            var rates = this._priceCache.rates || {};
            var singleCode = codes && codes.length === 1;

            document.querySelectorAll('.mostro-price-reference-value[data-price-code]').forEach(function(node) {
                var code = String(node.getAttribute('data-price-code') || '').toUpperCase();
                var n = parseFloat(rates[code]);
                if (!isFinite(n) || n <= 0) {
                    if (singleCode) {
                        var unavailable = String(str_price_unavailable);
                        if (node.textContent !== unavailable) {
                            node.textContent = unavailable;
                            self._flashPriceNode(node);
                        }
                        node.style.display = '';
                    } else {
                        node.style.display = 'none';
                    }
                    return;
                }
                var next = n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + code + '/BTC';
                if (node.textContent !== next) {
                    node.textContent = next;
                    self._flashPriceNode(node);
                }
                node.style.display = '';
            });

            document.querySelectorAll('.mostro-price-value[data-order-id]').forEach(function(node) {
                var order = self.orders[node.getAttribute('data-order-id')];
                if (!order) return;
                var price = self._estimatePrice(order);
                if (!price) return;
                var quote = self._formatPriceQuote(price, order.fiatCode).replace(/^≈\s*/, '');
                var parts = quote.match(/^(.+)\s([A-Za-z?]+\/BTC)$/);
                var next = parts ? parts[1] : quote;
                var nextClass = 'mostro-price-value' + self._priceComparisonClass(order, price);
                var changed = node.textContent !== next;
                node.className = nextClass;
                if (changed) {
                    node.textContent = next;
                    self._flashPriceNode(node);
                }
            });
        },
        _refreshDisplayedPrices: function() {
            if (this._marketCodes && this._marketCodes.length) {
                this._fetchPriceRates(this._marketCodes, true);
            }
        },
        _renderPriceReference: function(codes) {
            var el = document.getElementById('mostro-price-reference');
            if (!el) return;
            this._loadPriceSource();
            var self = this, rates = this._priceCache.rates || {};
            var previousValues = Array.prototype.map.call(
                el.querySelectorAll('.mostro-price-reference-value'),
                function(node) { return node.textContent; }
            );
            var options = this._PRICE_SOURCES.map(function(s) {
                return '<option value="' + s.id + '"' + (s.id === self._priceSource ? ' selected' : '') + '>' + s.label + '</option>';
            }).join('');
            var source = this._PRICE_SOURCES.filter(function(s) { return s.id === self._priceSource; })[0] || this._PRICE_SOURCES[0];
            var values = codes.map(function(c) {
                var n = parseFloat(rates[c]);
                if (!isFinite(n) || n <= 0) return '';
                return '<span class="mostro-price-reference-value" data-price-code="' + _escHtml(c) + '">' + _escHtml(n.toLocaleString(undefined, { maximumFractionDigits: 2 })) + ' ' + _escHtml(c) + '/BTC</span>';
            }).filter(Boolean).join('');
            el.innerHTML = '<div class="mostro-price-reference">' +
                '<span class="mostro-price-reference-label">' + str_btc_reference_price + '</span>' +
                '<span class="mostro-price-source-icon mostro-price-source-icon-' + source.id + '" aria-hidden="true">' + source.icon + '</span>' +
                '<select id="mostro-price-source" aria-label="' + str_btc_reference_price + '">' + options + '</select>' +
                '<span class="mostro-price-reference-values">' + (values || (codes.length === 1 ? '<span class="mostro-price-reference-value" data-price-code="' + _escHtml(codes[0]) + '">' + str_price_unavailable + '</span>' : '')) + '</span>' +
                '</div>';
            Array.prototype.forEach.call(el.querySelectorAll('.mostro-price-reference-value'), function(node, index) {
                if (previousValues[index] !== undefined && previousValues[index] !== node.textContent) {
                    node.classList.add('mostro-price-reference-value-changed');
                }
            });
            var select = document.getElementById('mostro-price-source');
            if (select) select.onchange = function() {
                self._priceSource = this.value;
                try { localStorage.setItem(self._PRICE_SOURCE_KEY, self._priceSource); } catch(e) {}
                var cached = self._priceCache.bySource[self._priceSource];
                self._priceCache.rates = cached ? cached.rates : null;
                self._priceCache.fetchedAt = cached ? cached.fetchedAt : 0;
                self.render();
            };
        },
        _pickRangeFiatAmount: async function(order) {
            var min = parseFloat(order && order.fiatMin);
            var max = parseFloat(order && order.fiatMax);
            if (!isFinite(min) || !isFinite(max)) return null;
            while (true) {
                var raw = await prompt(
                    t(str_range_offer_pick_amount, this._formatFiatValue(min), this._formatFiatValue(max), (order.fiatCode || '')),
                    this._formatFiatValue(min)
                );
                if (raw === null) return null;
                var chosen = parseFloat(String(raw).replace(',', '.').trim());
                if (!isFinite(chosen) || chosen < min || chosen > max) {
                    alert(t(str_fiat_amount_between, this._formatFiatValue(min), this._formatFiatValue(max), (order.fiatCode || '')));
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
            var since48h = Math.floor(Date.now() / 1000) - 48 * 3600;
            // Órdenes Mostro: SÍ se restringen a los robots activos (authors). lnp2pbot va en un filtro
            // aparte (más abajo) SIN authors, porque sus órdenes las firma su propio bot, no los robots
            // seleccionados — si no, al activar una instancia dejaban de verse las de lnp2pbot.
            var filter = { kinds: [38383], '#s': ['pending'], '#y': ['mostro'], limit: 100, since: since48h };
            var authors = MostroCommunities.activeHexList();
            if (authors) filter.authors = authors;
            // Segundo filtro: cambios de estado en tiempo real (cancels, taken, etc.) sin filtrar por #s
            var liveFilter = { kinds: [38383], since: this._latestAtEose };
            if (authors) liveFilter.authors = authors;
            // Tercer filtro: kind 38385 (Mostro instance status): PoW, bonds y datos de la instancia.
            // #z=info confirmado en el código real del daemon (nip33.rs: Tag::custom("z","info")) —
            // auditoría 2026-08-22, hallazgo menor. Sin `authors` a propósito (no es un descuido): a
            // diferencia de `filter`/`disputeFilter`, este necesita ver TODAS las instancias para
            // conocer su versión de protocolo, no solo las activas/seleccionadas por el usuario.
            var statusFilter = { kinds: [38385], '#z': ['info'], limit: 50 };
            // Cuarto filtro: kind 38386 (disputas públicas) para conocer el estado público de cada disputa
            var disputeFilter = { kinds: [38386], '#z': ['dispute'], limit: 200, since: since48h };
            if (authors) disputeFilter.authors = authors;
            // Quinto filtro: kind 39383 NostrEscrow on-chain (#y=nostrescrow). Sin authors filter
            // porque las órdenes on-chain las firman users normales, no robots Mostro.
            var onchainFilter = { kinds: [39383], '#y': ['nostrescrow'], limit: 100, since: since48h };
            this._oldestAt = null;
            this._eoseReached = false;
            this._newRecentCount = 0;
            this._freshIds = null;
            this._visibleCount = 10;
            this._noMoreToLoad = false;
            this._closedOrders = {};
            this._latestAtEose = Math.floor(Date.now() / 1000);
            var subFilters = [filter, liveFilter, statusFilter, disputeFilter, onchainFilter];
            if (this._showLnp2pbot) {
                // lnp2pbot SIN authors: el tag #y=lnp2pbot los identifica; el bot no es una instancia Mostro.
                subFilters.push({ kinds: [38383], '#s': ['pending'], '#y': ['lnp2pbot'], limit: 100, since: since48h });
                subFilters.push({ kinds: [38383], '#y': ['lnp2pbot'], since: this._latestAtEose });
            }
            this._subId = Noxtr.Pool.subscribe(
                subFilters,
                function(ev, relayUrl) {
                    if (ev.kind === 38385) { self._handleStatusEvent(ev, relayUrl); return; }
                    if (ev.kind === 38386) { self._handleDisputeEvent(ev); return; }
                    if (ev.kind === 39383) { self._handleOnchainEvent(ev); return; }
                    self._handleEvent(ev);
                },
                function() {
                    self._eoseReached = true;
                    var pendingIds = Object.keys(self.orders);
                    if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                        Object.keys(MostroTrader._trades).forEach(function(oid) {
                            if (pendingIds.indexOf(oid) === -1) pendingIds.push(oid);
                        });
                    }
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

        verifyLocalTradeStatuses: function() {
            if (typeof MostroTrader === 'undefined' || !MostroTrader._trades) return;
            var ids = Object.keys(MostroTrader._trades).filter(function(oid) {
                var t = MostroTrader._trades[oid];
                // Incluir terminales: su último 38383 contiene el `amt` definitivo del trade y es
                // precisamente lo que permite reparar una ficha completada contaminada por bonds.
                return t && !parseInt(t.archived) && t.method !== 'onchain';
            });
            if (!ids.length) return;
            var authors = [];
            ids.forEach(function(oid) {
                var pk = MostroTrader._trades[oid] && MostroTrader._trades[oid].robot_pubkey;
                if (pk && authors.indexOf(pk) === -1) authors.push(pk);
            });
            var filter = { kinds: [38383], '#d': ids, limit: ids.length + 20 };
            if (authors.length) filter.authors = authors;
            var sid = Noxtr.Pool.subscribe(
                [filter],
                function(ev) { MostroBook._handleEvent(ev); },
                function() { Noxtr.Pool.unsubscribe(sid); MostroBook.render(); }
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
                function(ev) { self._handleEvent(ev); },
                function() {
                    Noxtr.Pool.unsubscribe(sid);
                    self._loadingMore = false;
                    if (Object.keys(self.orders).length === countBefore) {
                        self._noMoreToLoad = true;
                        var btn = document.getElementById('mostro-load-more');
                        if (btn) btn.style.display = 'none';
                    } else {
                        self.render();
                    }
                }
            );
        },

        // ---- kind 38385: Mostro instance status (lee PoW, bonds y datos de la instancia) ----
        _handleStatusEvent: async function(ev, relayUrl) {
            if (!ev || ev.kind !== 38385 || !(await _verifyNostrSig(ev))) {
                _mostroDebugWarn('[Mostro][38385] firma inválida; evento descartado');
                return;
            }
            // El 38385 es addressable: cada relay sirve el último QUE LE LLEGÓ. Un relay rezagado
            // puede seguir sirviendo una generación antigua (p.ej. de antes de que la instancia
            // actualizara a v2), y sin este guard el último en llegar pisaba al más nuevo.
            var prevAt = this._robotStatusAt[ev.pubkey] || 0;
            if (ev.created_at < prevAt) {
                _mostroTrace('[Mostro][38385] DESCARTADO (rancio)', ev.pubkey.slice(0, 12),
                    'de', relayUrl || '?', 'created_at', ev.created_at, '<', prevAt);
                return;
            }
            this._robotStatusAt[ev.pubkey] = ev.created_at;
            this._robotStatus[ev.pubkey] = ev;
            var tags = ev.tags || [];
            var powTag = tags.find(function(t) { return t[0] === 'pow'; });
            var d = powTag ? parseInt(powTag[1]) : 0;
            if (isFinite(d) && d >= 0) {
                this._robotPow[ev.pubkey] = d;
                _mostroTrace('[Mostro] robot', ev.pubkey.slice(0, 12), 'pow =', d);
            }
            // pow_first_contact (protocol/other_events.html, spam_gate.rs del daemon): dificultad
            // exigida a un trade key nunca visto por el nodo — new-order/take-* siempre lo son.
            var powFcTag = tags.find(function(t) { return t[0] === 'pow_first_contact'; });
            var dFc = powFcTag ? parseInt(powFcTag[1]) : 0;
            if (isFinite(dFc) && dFc >= 0) {
                this._robotPowFirstContact[ev.pubkey] = dFc;
            }
            // protocol_version (transport_migration.html): tag ausente = daemon previo al tag = v1.
            var protoTag = tags.find(function(t) { return t[0] === 'protocol_version'; });
            var proto = protoTag ? parseInt(protoTag[1]) : 1;
            var prevProto = this._robotProto[ev.pubkey];
            this._robotProto[ev.pubkey] = isFinite(proto) ? proto : 1;
            if (prevProto !== this._robotProto[ev.pubkey]) {
                clearTimeout(this._statusRenderTimer);
                var _selfMB = this;
                this._statusRenderTimer = setTimeout(function() {
                    _selfMB.render();
                    // La barra de instancias también pinta el chip vN (clickable → info):
                    // repintarla para que aparezca/actualice en cuanto se conoce la versión.
                    if (typeof MostroCommunities !== 'undefined' && MostroCommunities.render) MostroCommunities.render();
                }, 300);
            }
            // Política de bonds anti-abuse (mostro-core, ver protocol/other_events.html).
            // bond_enabled ausente = daemon previo a la feature (sin bonds); "false" = soportado
            // pero no activado; "true" = exige fianza (ver bond_apply_to: take|make|both).
            // noxtr NO soporta bonds: solo se detecta para avisar al usuario antes de operar.
            var beTag = tags.find(function(t) { return t[0] === 'bond_enabled'; });
            var atTag = tags.find(function(t) { return t[0] === 'bond_apply_to'; });
            var bondOn = !!(beTag && String(beTag[1]).toLowerCase() === 'true');
            var applyTo = atTag ? String(atTag[1]).toLowerCase() : 'both';
            // Cuantía de la fianza (nip33.rs::bond_policy_tags): estos tags SOLO se emiten cuando las
            // fianzas están activadas — con bond_enabled=false va únicamente el marcador. Por eso se
            // guardan como null cuando faltan y quien los use no debe dar por hecho que están.
            var bpTag = tags.find(function(t) { return t[0] === 'bond_amount_pct'; });
            var bbTag = tags.find(function(t) { return t[0] === 'bond_base_amount_sats'; });
            var bondPct = bpTag ? parseFloat(bpTag[1]) : NaN;
            var bondBase = bbTag ? parseInt(bbTag[1], 10) : NaN;
            // Ventana para reclamar el cobro de una fianza slasheada. La instancia la publica en
            // este mismo bloque (nip33.rs::bond_policy_tags), así que NO hay que suponerla: con
            // `slashed_at` del BondPayoutRequest da la fecha límite exacta que el daemon aplica en
            // app/bond/payout.rs (`claim_window_seconds = payout_claim_window_days * 86_400`;
            // pasado ese plazo sin factura, forfeit_bond y el cobro se pierde). El daemon no manda
            // texto: espera que el cliente pinte el aviso a partir de estos dos números.
            var bwTag = tags.find(function(t) { return t[0] === 'bond_payout_claim_window_days'; });
            var bondWindowDays = bwTag ? parseInt(bwTag[1], 10) : NaN;
            // Fracción de una fianza ejecutada que retiene el nodo; el resto va al ganador
            // (payout.rs::counterparty_share_sats = bond.amount_sats - node_share_sats). Default
            // del daemon 0.5, pero cada instancia lo configura, así que sin este tag no hay forma
            // de saber si el importe que te piden facturar es el que toca.
            var bnTag = tags.find(function(t) { return t[0] === 'bond_slash_node_share_pct'; });
            var bondNodeShare = bnTag ? parseFloat(bnTag[1]) : NaN;
            var prevBond = this._robotBond[ev.pubkey];
            this._robotBond[ev.pubkey] = {
                enabled: bondOn,
                applyTo: applyTo,
                amountPct: (isFinite(bondPct) && bondPct > 0) ? bondPct : null,
                baseSats: (isFinite(bondBase) && bondBase > 0) ? bondBase : null,
                payoutClaimWindowDays: (isFinite(bondWindowDays) && bondWindowDays > 0) ? bondWindowDays : null,
                slashNodeSharePct: (isFinite(bondNodeShare) && bondNodeShare >= 0 && bondNodeShare <= 1) ? bondNodeShare : null
            };
            // Log solo en la primera transición a "exige bond" (el 38385 llega repetido por relay/re-sub)
            // y solo con debug activo: es el estado público de la instancia, no un evento de nuestra oferta.
            if (bondOn && (!prevBond || !prevBond.enabled)) {
                _mostroDebugWarn('[Mostro] robot', ev.pubkey.slice(0, 12), 'exige bond (apply_to=' + applyTo + ')');
            }
            // El 38385 puede llegar DESPUÉS de pintar las órdenes (carga inicial o tras togglear un
            // robot, que re-suscribe). Como el badge "EXIGE FIANZA" depende de esta política, repintamos
            // el order book cuando la política cambia (debounced: el 38385 llega repetido por relay).
            var bondChanged = !prevBond || prevBond.enabled !== bondOn || prevBond.applyTo !== applyTo;
            if (bondChanged) {
                var self = this;
                clearTimeout(this._statusRenderTimer);
                this._statusRenderTimer = setTimeout(function() { self.render(); }, 300);
            }
            // Auditoría 2026-08-22, alto #7: la instancia publica sus límites
            // operativos en el 38385. Guardarlos aquí permite a createOrder abortar
            // antes de mandar new-order en lugar de esperar un cant-do.
            var minOrderTag = tags.find(function(t) { return t[0] === 'min_order_amount'; });
            var maxOrderTag = tags.find(function(t) { return t[0] === 'max_order_amount'; });
            var expHoursTag = tags.find(function(t) { return t[0] === 'expiration_hours'; });
            var currTag     = tags.find(function(t) { return t[0] === 'fiat_currencies_accepted'; });
            var minOrder = minOrderTag ? parseInt(minOrderTag[1], 10) : NaN;
            var maxOrder = maxOrderTag ? parseInt(maxOrderTag[1], 10) : NaN;
            var expHours = expHoursTag ? parseInt(expHoursTag[1], 10) : NaN;
            var currencies = null;
            if (currTag && currTag[1]) {
                // El tag puede venir como CSV en [1] o como valores extra [1], [2], …
                // Aceptar ambas formas; normalizar a array de códigos UPPERCASE.
                var raw = currTag.slice(1).filter(Boolean);
                if (raw.length === 1 && raw[0].indexOf(',') !== -1) raw = raw[0].split(',');
                currencies = raw.map(function(c) { return String(c).trim().toUpperCase(); }).filter(Boolean);
            }
            this._robotLimits[ev.pubkey] = {
                minOrder: (isFinite(minOrder) && minOrder > 0) ? minOrder : null,
                maxOrder: (isFinite(maxOrder) && maxOrder > 0) ? maxOrder : null,
                fiatCurrencies: (currencies && currencies.length) ? currencies : null,
                expirationHours: (isFinite(expHours) && expHours > 0) ? expHours : null,
            };
        },

        // Public dispute events (kind 38386) — addressable by `d` tag (dispute_id).
        // Tags per protocol: ["d", id], ["s", status], ["initiator", "buyer"|"seller"], ["y","mostro",...], ["z","dispute"]
        _handleDisputeEvent: async function(ev) {
            if (!ev || ev.kind !== 38386 || !(await _verifyNostrSig(ev))) return;
            if (!this.disputeStatus) this.disputeStatus = {};
            var tags = ev.tags || [];
            var d = null, s = null, initiator = null;
            for (var i = 0; i < tags.length; i++) {
                if (tags[i][0] === 'd') d = tags[i][1];
                else if (tags[i][0] === 's') s = tags[i][1];
                else if (tags[i][0] === 'initiator') initiator = tags[i][1];
            }
            if (!d) return;
            if (!this._isTrustedMostroAuthor(ev.pubkey, d)) return;
            var prev = this.disputeStatus[d];
            if (!prev || prev._created_at < ev.created_at) {
                this.disputeStatus[d] = {
                    status: (s || 'unknown').toLowerCase(),
                    initiator: initiator || null,
                    _created_at: ev.created_at
                };
            }
            // Aunque el evento ya estuviera cacheado, hay que ejecutar la reconciliación de abajo:
            // el 38386 puede llegar antes de que AJAX termine de cargar `_trades`; al repetirse
            // desde otro relay ya no es nuevo, pero para la ficha recién cargada sí es necesario.
            var effectiveDispute = this.disputeStatus[d];
            // El estado público firmado reconcilia el local incluso si se perdió el DM terminal.
            if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                for (var oid in MostroTrader._trades) {
                    var localTrade = MostroTrader._trades[oid];
                    if (localTrade.dispute_id === d) {
                        try { await MostroTrader._reconcileTerminalDispute(localTrade, effectiveDispute); }
                        catch(e) { console.error('[Mostro] no se pudo reconciliar disputa pública', localTrade.order_id, e); }
                        MostroTrader.renderMyTrades();
                        break;
                    }
                }
            }
        },

        // ---- parseo de eventos ----
        _handleEvent: async function(ev) {
            if (!ev || ev.kind !== 38383 || !(await _verifyNostrSig(ev))) return;
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
            if ((t.y || 'mostro') === 'mostro' && !this._isTrustedMostroAuthor(ev.pubkey, id, true)) return;
            // Auditoría 2026-08-22, hallazgo menor: order_event.html marca el tag z=order como parte
            // de la identidad del evento; sin comprobarlo, cualquier 38383 con y=mostro entraba al
            // book aunque llevara otro z (p.ej. z=dispute, que ya usa el mismo kind con otro propósito).
            if (t.z && t.z !== 'order') return;
            if (this._oldestAt === null || ev.created_at < this._oldestAt) this._oldestAt = ev.created_at;
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
                // Estado público del 38383 → "Mis trades" (auditoría 2026-08-22, hallazgo Alto:
                // _applyPublicOrderStatus existía pero nadie la llamaba). Cubre sobre todo lo que el
                // canal DM directo no manda nunca: expired (orden nunca tomada, no hay trade key del
                // otro lado para avisarnos) y las variantes -by-admin/cooperatively-canceled, que a
                // veces solo se ven aquí si se perdió el DM correspondiente.
                if (typeof MostroTrader !== 'undefined' && MostroTrader._applyPublicOrderStatus) {
                    MostroTrader._applyPublicOrderStatus(id, ev.pubkey, status, ev);
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

            this.orders[id] = order;
            if (this._eoseReached && !existing && order._created_at > this._latestAtEose) {
                if (this._isOwn(order)) {
                    // Nuestra propia orden recién publicada: no es una "oferta nueva" que descubrir; ya
                    // se muestra en "Mis trades" y en el book. No spamear el banner: render directo + aviso.
                    this.render();
                    if (!this._ownPublishNotified) this._ownPublishNotified = {};
                    if (typeof notify === 'function' && !this._ownPublishNotified[id]) {
                        this._ownPublishNotified[id] = true;
                        notify(str_order_published, 'success', 4000);
                    }
                } else {
                    // Orden nueva de otro cliente: aparece al instante en el book (la fila se resalta
                    // sola vía mostroFreshBg). El banner pulsa como aviso pero auto-desaparece a los 6s
                    // (ya no es "pulsa para ver"; la orden ya se ve). Sigue siendo pulsable para descartar.
                    this._newRecentCount++;
                    if (!this._freshIds) this._freshIds = {};
                    this._freshIds[id] = true;
                    this.render();
                    var self2 = this;
                    clearTimeout(this._bannerAutoClear);
                    this._bannerAutoClear = setTimeout(function() {
                        self2._newRecentCount = 0; self2._updateBanner();
                    }, 6000);
                }
            }
            // Nuestra propia orden apareció publicada → fianza pagada: cierra el QR del bond si sigue abierto.
            if (MostroTrader && MostroTrader._onOwnOrderPublished) MostroTrader._onOwnOrderPublished(order);
        },

        // Parser de eventos NostrEscrow on-chain (kind 39383, #y=nostrescrow).
        // Adapta el evento al mismo shape que las órdenes Mostro para que el render existente
        // las dibuje uniformemente; añade flag _method='onchain' para badges/handlers.
        _handleOnchainEvent: async function(ev) {
            if (!(await _verifyNostrSig(ev))) return;
            var computedId = await _sha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            var nonceTag = (ev.tags || []).find(function(tag) { return tag && tag[0] === 'nonce'; });
            if (computedId !== String(ev.id || '').toLowerCase() || !nonceTag ||
                (parseInt(nonceTag[2], 10) || 0) < 16 || _countLeadingZeroBits(computedId) < 16) return;
            var tagY = null, tagD = null, tagK = null, tagAmount = null, tagFiatCode = null,
                tagFiatAmount = null, tagPm = null, tagPremium = null, tagExpires = null, tagArbitrators = null,
                tagNetwork = null;
            for (var i = 0; i < (ev.tags || []).length; i++) {
                var t = ev.tags[i];
                if (!t || !t[0]) continue;
                if (t[0] === 'y')              tagY = t[1];
                else if (t[0] === 'd')         tagD = t[1];
                else if (t[0] === 'k')         tagK = t[1];
                else if (t[0] === 'amount')    tagAmount = t[1];
                else if (t[0] === 'fiat_code') tagFiatCode = t[1];
                else if (t[0] === 'fiat_amount') tagFiatAmount = t;
                else if (t[0] === 'payment_method') tagPm = t[1];
                else if (t[0] === 'premium')   tagPremium = t[1];
                else if (t[0] === 'expires_at') tagExpires = parseInt(t[1], 10);
                else if (t[0] === 'arbitrators') tagArbitrators = t[1];
                else if (t[0] === 'network')   tagNetwork = t[1];
            }
            if (tagY !== 'nostrescrow') return;
            if (!/^[a-zA-Z0-9_-]{16,64}$/.test(String(tagD || ''))) return;
            if (tagK !== 'buy' && tagK !== 'sell') return;
            if (!Number.isFinite(Number(ev.created_at)) || ev.created_at > Math.floor(Date.now()/1000) + 300) return;
            var amountNumber = Number(tagAmount);
            if (!Number.isSafeInteger(amountNumber) || amountNumber < 0 || !/^[A-Z]{2,10}$/.test(String(tagFiatCode || ''))) return;
            var normalizedNetwork = String(tagNetwork || '').toLowerCase();
            if (['mainnet','testnet','signet'].indexOf(normalizedNetwork) === -1) return;

            var isRange = !!(tagFiatAmount && tagFiatAmount.length >= 3 && tagFiatAmount[2]);
            if (!tagFiatAmount || !(Number(tagFiatAmount[1]) > 0) ||
                (isRange && !(Number(tagFiatAmount[2]) >= Number(tagFiatAmount[1])))) return;
            var parsedArbs = String(tagArbitrators || '').split(',').map(function(s) { return s.trim().toLowerCase(); });
            if (parsedArbs.length === 1 && /^[a-f0-9]{64}$/.test(parsedArbs[0])) parsedArbs = [parsedArbs[0], parsedArbs[0], parsedArbs[0]];
            if (parsedArbs.length !== 3 || parsedArbs.some(function(pk) {
                if (!/^[a-f0-9]{64}$/.test(pk)) return true;
                try { nobleSecp256k1.Point.fromHex('02' + pk); return false; } catch(e) { return true; }
            })) return;
            var nowTs = Math.floor(Date.now() / 1000);
            var orderWindow = 86400;
            var orderExpiry = (tagExpires !== null && !isNaN(tagExpires)) ? tagExpires : (ev.created_at + orderWindow);

            var existing = this.orders[tagD];
            if (existing && existing.robotPubkey !== ev.pubkey) {
                delete this.orders[tagD];
                if (!this._onchainCollisions) this._onchainCollisions = {};
                this._onchainCollisions[tagD] = true;
                this.render();
                return;
            }
            if (this._onchainCollisions && this._onchainCollisions[tagD]) return;
            if (existing && existing._created_at >= ev.created_at) return;
            if (orderExpiry <= nowTs) {
                // Orden cancelada/retirada (reemplazo NIP-33 con expires_at en el pasado). Dejamos una
                // "lapida" (tombstone) keyed por order_id+pubkey para que un evento original mas viejo
                // del mismo maker que llegue despues (relay atrasado, llegada desordenada) NO resucite la
                // orden. Sin esto, el original se re-anadia y la orden reaparecia pese a estar retirada.
                if (!this._onchainExpired) this._onchainExpired = {};
                var prevTomb = this._onchainExpired[tagD];
                if (!prevTomb || ev.created_at > prevTomb.created_at) {
                    this._onchainExpired[tagD] = { pubkey: ev.pubkey, created_at: ev.created_at };
                }
                // Solo eliminar si el evento viene del mismo pubkey que creó la orden (anti-griefing)
                if (existing && existing.robotPubkey === ev.pubkey) { delete this.orders[tagD]; this.render(); }
                return;
            }
            // Si hay lapida del mismo maker con fecha >= este evento, la orden ya fue retirada: ignorar.
            var tomb = this._onchainExpired && this._onchainExpired[tagD];
            if (tomb && tomb.pubkey === ev.pubkey && tomb.created_at >= ev.created_at) return;

            var order = {
                id:            tagD,
                orderType:     tagK,
                daemon:        'nostrescrow',         // distinto a 'mostro'/'lnp2pbot'
                source:        '',
                fiatCode:      tagFiatCode || '?',
                fiatAmount:    isRange ? String(tagFiatAmount[1]) + '-' + String(tagFiatAmount[2])
                                       : (tagFiatAmount ? String(tagFiatAmount[1]) : '?'),
                fiatMin:       tagFiatAmount ? parseFloat(tagFiatAmount[1]) : null,
                fiatMax:       isRange ? parseFloat(tagFiatAmount[2]) : null,
                isRange:       isRange,
                satAmount:     amountNumber,
                paymentMethod: tagPm || 'cualquiera',
                premium:       tagPremium || '0',
                robotPubkey:   ev.pubkey,            // para on-chain es la pubkey del maker
                rating:        null,
                status:        'pending',
                _created_at:   ev.created_at,
                _expiration:   tagExpires || 0,
                _orderExpiry:  orderExpiry,
                _method:       'onchain',
                _network:      normalizedNetwork,
                _arbitrators:  parsedArbs
            };

            this.orders[tagD] = order;
            if (this._eoseReached && !existing && order._created_at > this._latestAtEose) {
                if (this._isOwn(order)) {
                    this.render();
                    if (!this._ownPublishNotified) this._ownPublishNotified = {};
                    if (typeof notify === 'function' && !this._ownPublishNotified[tagD]) {
                        this._ownPublishNotified[tagD] = true;
                        notify(str_order_published, 'success', 4000);
                    }
                } else {
                    this._newRecentCount++;
                    if (!this._freshIds) this._freshIds = {};
                    this._freshIds[tagD] = true;
                    this.render();
                    var self3 = this;
                    clearTimeout(this._bannerAutoClear);
                    this._bannerAutoClear = setTimeout(function() {
                        self3._newRecentCount = 0; self3._updateBanner();
                    }, 6000);
                }
            }
        },

        // Render del badge de reputacion on-chain del maker para el orderbook. rep = objeto de
        // Onchain.Reputation.get() (o null si aun no calculado).
        _onchainRepHtml: function(rep) {
            if (!rep || !rep._complete) return '<span class="mostro-stars">···</span>';
            if (!rep.count) return '<span class="mostro-rating-new" title="' + str_no_ratings_yet + '"><span class="mostro-stars">☆☆☆☆☆</span></span>';
            var avg = rep.avg, stars = '';
            for (var si = 1; si <= 5; si++) stars += si <= Math.round(avg) ? '★' : '☆';
            return '<span class="mostro-stars">' + stars + '</span> ' + avg.toFixed(1) + ' <small>(' + rep.count + ')</small>';
        },

        // ---- banner "N nuevas ofertas" ----
        _updateBanner: function(visible, total) {
            if (visible !== undefined) { this._lastVisible = visible; this._lastTotal = total; }
            var el = document.getElementById('mostro-new-banner');
            if (!el) return;
            var self = this, n = this._newRecentCount;
            if (n > 0) {
                el.textContent = n === 1 ? str_new_offer_click_one : window.t(str_new_offers_click_many, n);
                el.style.cursor = 'pointer';
                el.classList.add('is-fresh');
                el.onclick = function() { clearTimeout(self._bannerAutoClear); self._newRecentCount = 0; el.classList.remove('is-fresh'); self.render(); };
            } else {
                el.textContent = this._lastVisible !== undefined ? t(str_showing_x_of_y, this._lastVisible, this._lastTotal) : '';
                el.style.cursor = '';
                el.classList.remove('is-fresh');
                el.onclick = null;
            }
            el.style.display = '';
        },

        // Detecta si una orden del book es propia del usuario actual (creada por mí, no terminal).
        _localTradeForOrder: function(o) {
            if (typeof MostroTrader === 'undefined' || !MostroTrader._trades || !o) return null;
            if (MostroTrader._trades[o.id]) return MostroTrader._trades[o.id];
            var term = { 'cancelado': true, 'completado': true, 'disputado': true };
            for (var oid in MostroTrader._trades) {
                var lt = MostroTrader._trades[oid];
                if (!lt || lt.trade_role !== 'created' || term[lt.internal_status]) continue;
                if (String(lt.order_id || '').indexOf('tmp-child-') !== 0) continue;
                if (String(lt.trade_kind || '') !== String(o.orderType || '')) continue;
                if (String(lt.fiat_amount || '') !== String(o.fiatAmount || '')) continue;
                if (String(lt.fiat_code || '') !== String(o.fiatCode || '')) continue;
                if (String(lt.payment_method || '') !== String(o.paymentMethod || '')) continue;
                if (o.robotPubkey && String(lt.robot_pubkey || '') !== String(o.robotPubkey || '')) continue;
                return lt;
            }
            return null;
        },

        _isOwn: function(o) {
            var t = (typeof MostroTrader !== 'undefined') ? MostroTrader._trades[o.id] : null;
            var term = { 'cancelado': true, 'completado': true, 'disputado': true };
            if (t && t.trade_role === 'created' && !term[t.internal_status]) return true;
            if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                var orderFiat = String(o.fiatAmount || '');
                var orderPm = String(o.paymentMethod || '');
                var orderCode = String(o.fiatCode || '');
                var orderKind = String(o.orderType || '');
                var orderRobot = String(o.robotPubkey || '');
                for (var oid in MostroTrader._trades) {
                    var lt = MostroTrader._trades[oid];
                    if (!lt || lt.trade_role !== 'created' || term[lt.internal_status]) continue;
                    if (String(lt.order_id || '').indexOf('tmp-child-') !== 0) continue;
                    if (String(lt.trade_kind || '') !== orderKind) continue;
                    if (String(lt.fiat_amount || '') !== orderFiat) continue;
                    if (String(lt.fiat_code || '') !== orderCode) continue;
                    if (String(lt.payment_method || '') !== orderPm) continue;
                    if (orderRobot && String(lt.robot_pubkey || '') !== orderRobot) continue;
                    return true;
                }
            }
            if (o._method === 'onchain' && o.robotPubkey && Noxtr.Events && Noxtr.Events.pubkey && o.robotPubkey === Noxtr.Events.pubkey) return true;
            return false;
        },

        // ---- render principal ----
        render: function() {
            var el = document.getElementById('mostro-orders');
            if (!el) return;
            var previousPriceValues = Array.prototype.map.call(
                el.querySelectorAll('.mostro-price-value'),
                function(node) { return node.textContent; }
            );
            var now = Math.floor(Date.now() / 1000);
            if (!this._pmChips)    this._loadPmChips();
            if (!this._fiatFilter) this._loadFiatFilter();
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            if (this._showBuy === null)      this._loadSide();
            if (this._showMostro === null)   this._loadSrc();
            if (this._minDays === null)      this._loadMinDays();
            var activeChips = this._pmChips.filter(function(c) { return c.active; });
            var fiatFilter = this._fiatFilter;
            var showLnp = this._showLnp2pbot, showBuy = this._showBuy, showSell = this._showSell;
            var showMostro = this._showMostro, showOnchain = this._showOnchain;
            var minDays = this._minDays;

            var self = this;
            var orders = Object.values(this.orders).filter(function(o) {
                if (o._orderExpiry && o._orderExpiry <= now) return false;
                // Enlace directo: la orden enlazada salta los filtros de preferencia del usuario
                if (self._deepLinkId && o.id === self._deepLinkId) return true;
                // Filtro de fuente: cada fuente con su propio chip, independientes entre sí.
                // lnp2pbot NO depende del chip Mostro (antes caía en el else de !showMostro y se ocultaba).
                if (o._method === 'onchain') {
                    if (!showOnchain) return false;
                } else if (o.daemon === 'lnp2pbot') {
                    if (!showLnp) return false;
                } else {
                    if (!showMostro) return false;
                }
                if (o.orderType === 'sell' && !showBuy)  return false;
                if (o.orderType === 'buy'  && !showSell) return false;
                // On-chain: solo se muestran órdenes de la red activa (no mezclar cadenas). Aplica
                // también a las propias: una orden mainnet no aparece en el orderbook testnet.
                if (o._method === 'onchain' && typeof window.Onchain !== 'undefined' && window.Onchain.getNetwork
                    && (o._network || 'mainnet') !== window.Onchain.getNetwork()) return false;
                // Las propias se saltan filtros de preferencia (pm/reputación/moneda): no eres contraparte de ti mismo.
                if (self._isOwn(o)) return true;
                if (fiatFilter.length && fiatFilter.indexOf(String(o.fiatCode || '').toUpperCase()) === -1) return false;
                if (activeChips.length) {
                    var pm = (o.paymentMethod || '').toLowerCase();
                    if (!activeChips.some(function(c) { return pm.indexOf(c.label.toLowerCase()) !== -1; })) return false;
                }
                if (minDays > 0 && (!o.rating || (o.rating.days || 0) < minDays)) return false;
                return true;
            });
            orders.sort(function(a, b) { return b._created_at - a._created_at; });
            var total = orders.length;
            var marketCodes = orders.filter(function(o) { return !self._isFixedPriceOrder(o) && o.fiatCode; })
                .map(function(o) { return String(o.fiatCode).toUpperCase(); })
                .filter(function(c, i, a) { return a.indexOf(c) === i; });
            this._marketCodes = marketCodes.slice();
            orders = orders.slice(0, this._visibleCount);
            // Enlace directo: si el recorte de visibles dejó fuera la orden enlazada, añadirla
            if (this._deepLinkId) {
                var dlo = this.orders[this._deepLinkId];
                if (dlo && orders.indexOf(dlo) === -1 && !(dlo._orderExpiry && dlo._orderExpiry <= now)) orders.push(dlo);
            }

            this._renderPmFilters();
            this._renderPriceReference(marketCodes);
            this._updateBanner(orders.length, total);
            MostroCommunities.render();
            this._applySourceVisibility();

            if (!orders.length) {
                el.innerHTML = '<div class="noxtr-empty">' + str_searching_mostro_orders + '</div>';
                return;
            }

            // Si hay órdenes a precio de mercado, pedir la cotización de la fuente seleccionada.
            if (marketCodes.length) this._fetchPriceRates(marketCodes);

            el.innerHTML = orders.map(function(o) {
                var isSell = o.orderType === 'sell';
                var isLnp  = o.daemon === 'lnp2pbot';
                var eid    = 'mostro-explain-' + o.id.replace(/[^a-z0-9]/gi, '');
                var premium = parseFloat(o.premium);
                var premiumHtml = premium !== 0
                    ? '<span class="mostro-premium">' + (premium > 0 ? '+' : '') + _escHtml(String(o.premium)) + '%</span>' : '';
                var isFixedPrice = self._isFixedPriceOrder(o);
                var price = self._estimatePrice(o);
                var comparisonClass = price ? self._priceComparisonClass(o, price) : '';
                var priceTitle = isFixedPrice
                    ? str_implicit_order_quote
                    : self._priceSourceLabel(self._priceSource) + ' + premium';
                var formattedPrice = price ? self._formatPriceQuote(price, o.fiatCode) : '';
                var quoteText = formattedPrice.replace(/^≈\s*/, '');
                var quoteParts = quoteText.match(/^(.+)\s([A-Za-z?]+\/BTC)$/);
                var quoteNumber = quoteParts ? quoteParts[1] : quoteText;
                var quotePair = quoteParts ? quoteParts[2] : '';
                var priceHtml = price
                    ? '<span class="mostro-price-quote" title="' + priceTitle + '">≈ <span class="mostro-price-value' + comparisonClass + '" data-order-id="' + _escHtml(o.id) + '">' + _escHtml(quoteNumber) + '</span>' + (quotePair ? ' <span class="mostro-price-pair">' + _escHtml(quotePair) + '</span>' : '') + '</span>'
                    : '';
                var satsHtml = isFixedPrice
                    ? '<span class="mostro-sats">' + o.satAmount.toLocaleString() + ' sats</span><span class="mostro-fixed-price-badge">' + str_fixed_price + '</span>'
                    : '<span class="mostro-sats">' + str_market_price + '</span>';
                var isOnchain = o._method === 'onchain';
                var orderArbCount = (o._arbitrators || []).filter(function(pk, i, arr) { return arr.indexOf(pk) === i; }).length;
                var arbHtml = isOnchain
                    ? '<span class="mostro-pm mostro-pm-arbitros" title="' + _escHtml((o._arbitrators || []).join(', ')) + '">' + t(str_arbitrators_count, orderArbCount, orderArbCount === 1 ? '' : 's') + '</span>'
                    : '';
                var badgeHtml = isSell
                    ? '<span class="mostro-badge mostro-badge-sell">' + str_sell + '</span>'
                    : '<span class="mostro-badge mostro-badge-buy">' + str_buy + '</span>';
                if (isLnp) badgeHtml += '<span class="mostro-daemon-badge">lnp2pbot</span>';
                if (isOnchain) badgeHtml += '<span class="mostro-daemon-badge" style="background:#9b59b6;color:white;">ON-CHAIN</span>';
                // Robot Mostro con bonds activados: badge "EXIGE FIANZA".
                // Color naranja si enable_bonds ON (noxtr puede operarla pagando la fianza),
                // rojo si OFF (bloqueante: noxtr no paga la fianza).
                if (!isLnp && !isOnchain && _robotRequiresBond(o.robotPubkey, 'take')) {
                    var _bp = MostroBook._robotBond[o.robotPubkey] || {};
                    var _bondTip = _escHtml(t(str_bond_badge_tooltip, _bp.applyTo || 'both'));
                    var _bondStyle = _bondsEnabled() ? 'background:#f0ad4e;color:#222;' : 'background:#e53935;color:white;';
                    badgeHtml += '<span class="mostro-daemon-badge" style="' + _bondStyle + '" title="' + _bondTip + '">' + str_bond_required_badge + '</span>';
                }

                var isOwn = self._isOwn(o);
                var btnHtml;
                if (isLnp) {
                    var tgUrl = o.source ? _escHtml(o.source) : 'https://t.me/lnp2pbot';
                    btnHtml = '<a class="btn btn-noxtr btn-tg mostro-tg-btn" href="' + tgUrl + '" target="_blank" rel="noopener">' + str_view_on_telegram + '</a>';
                } else if (isOwn && isOnchain) {
                    var _nReqs = (typeof window.Onchain !== 'undefined' && window.Onchain.Trader)
                        ? (window.Onchain.Trader.getPendingTakeRequests(o.id) || []).length : 0;
                    btnHtml = (_nReqs > 0
                        ? '<button class="btn btn-noxtr btn-sm btn-warning nxoc-req-btn" data-id="' + _escHtml(o.id) + '" style="margin-right:4px">' + t(str_requests_count, _nReqs) + '</button>'
                        : '') +
                        '<button class="btn btn-noxtr btn-danger mostro-onchain-cancel-btn" data-id="' + _escHtml(o.id) + '">' + str_cancel + '</button>';
                } else if (isOwn) {
                    btnHtml = '<button class="btn btn-noxtr btn-danger mostro-cancel-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">' + str_cancel + '</button>';
                } else if (isOnchain && isSell) {
                    btnHtml = '<button class="btn btn-noxtr btn-primary mostro-onchain-take-btn" data-id="' + _escHtml(o.id) + '" data-maker="' + _escHtml(o.robotPubkey) + '">' + str_buy_btc + '</button>';
                } else if (isOnchain) {
                    btnHtml = '<button class="btn btn-noxtr btn-success mostro-onchain-take-btn" data-id="' + _escHtml(o.id) + '" data-maker="' + _escHtml(o.robotPubkey) + '">' + str_sell_btc + '</button>';
                } else if (isSell) {
                    btnHtml = '<button class="btn btn-noxtr btn-primary mostro-buy-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">' + str_buy_btc + '</button>';
                } else {
                    btnHtml = '<button class="btn btn-noxtr btn-success mostro-sell-btn" data-id="' + _escHtml(o.id) + '" data-robot="' + _escHtml(o.robotPubkey) + '">' + str_sell_btc + '</button>';
                }

                if (o.robotPubkey) Noxtr.Profiles.request(o.robotPubkey);
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
                if (o._method === 'onchain') {
                    // Reputacion on-chain del maker (kind 39384 verificadas contra el accept publico).
                    // Placeholder + relleno asincrono (cacheado en Onchain.Reputation). Click = auditoria.
                    var _repId = 'nxoc-rep-' + o.id.replace(/[^a-z0-9]/gi, '');
                    var _rep = (window.Onchain && Onchain.Reputation) ? Onchain.Reputation.get(o.robotPubkey) : null;
                    ratingHtml = '<span class="mostro-rating nxoc-trader-rep" id="' + _repId + '" data-maker="' + _escHtml(o.robotPubkey || '') +
                        '" title="' + str_onchain_reputation_title + '" style="cursor:pointer">' + self._onchainRepHtml(_rep) + '</span>';
                    if (window.Onchain && Onchain.Reputation && (!_rep || !_rep._complete)) {
                        Onchain.Reputation.fetch(o.robotPubkey, function(rep) {
                            var el2 = document.getElementById(_repId);
                            if (el2) el2.innerHTML = self._onchainRepHtml(rep);
                        });
                    }
                } else if (o.rating && o.rating.total_reviews > 0) {
                    var avg = o.rating.total_rating; // total_rating ya ES el promedio
                    var stars = '';
                    for (var si = 1; si <= 5; si++) stars += si <= Math.round(avg) ? '★' : '☆';
                    var daysHtml = o.rating.days ? ' <small title="' + str_days_active_mostro + '">📅 ' + o.rating.days + 'd</small>' : '';
                    ratingHtml = '<span class="mostro-rating" title="' + avg.toFixed(2) + ' · ' + o.rating.total_reviews + ' trades · ' + (o.rating.days || 0) + ' ' + str_days_active_mostro + '">' +
                        '<span class="mostro-stars">' + stars + '</span> ' + avg.toFixed(1) +
                        ' <small>(' + o.rating.total_reviews + ')</small>' + daysHtml + '</span>';
                } else {
                    ratingHtml = '<span class="mostro-rating mostro-rating-new" title="' + str_no_ratings_yet + '"><span class="mostro-stars">☆☆☆☆☆</span></span>';
                }

                var domId = 'mostro-order-' + o.id.replace(/[^a-z0-9]/gi, '');
                var ownBadge = isOwn ? '<span class="mostro-own-badge">' + str_created_by_me + '</span>' : '';
                return '<div class="mostro-order ' + (isSell ? 'mostro-order-sell' : 'mostro-order-buy') + (isOwn ? ' mostro-order-own' : '') + '" id="' + domId + '">' +
                    '<div class="mostro-card-body">' +
                        '<span class="mostro-order-id" title="' + _escHtml(o.id || '') + '">#' + _escHtml(orderShort) + '</span>' +
                        '<div class="mostro-card-top">' + badgeHtml + ownBadge +
                            '<span class="mostro-fiat">' + _escHtml(self._formatOrderFiatLabel(o)) + '</span>' +
                            '<span class="mostro-card-sats">' + satsHtml + premiumHtml + priceHtml + '</span>' +
                        '</div>' +
                        '<div class="mostro-card-pm">' + (o.paymentMethod || '').split(', ').map(function(pm) {
                            var slug = pm.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
                            return '<span class="mostro-pm mostro-pm-' + slug + '">' + _escHtml(pm) + '</span>';
                        }).join('') + arbHtml + '</div>' +
                        '<div class="mostro-card-footer">' +
                            '<span class="mostro-order-age">⏱ ' + ageText + '</span>' + expiryHtml +
                            MostroCommunities.robotIdentityHtml(o.robotPubkey) +
                            '<a class="mostro-share-btn" data-id="' + _escHtml(o.id) + '" title="' + str_copy_link + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>' +
                            ratingHtml +
                        '</div>' +
                        gaugeHtml +
                    '</div>' +
                    '<div class="mostro-card-side">' + btnHtml +
                        '<a class="mostro-tip-toggle" data-eid="' + eid + '">' + str_how_does_it_work + '</a>' +
                    '</div>' +
                '</div>' + self._explainOrder(o, isOwn);
            }).join('');

            // Destacar también las cotizaciones recalculadas dentro de las fichas.
            Array.prototype.forEach.call(el.querySelectorAll('.mostro-price-value'), function(node, index) {
                if (previousPriceValues[index] !== undefined && previousPriceValues[index] !== node.textContent) {
                    node.classList.add('mostro-price-value-changed');
                }
            });

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
                    var trade = MostroTrader._trades[orderId] || self._localTradeForOrder(self.orders[orderId]);
                    if (!trade) return;
                    if (!await confirm(str_cancel_order_confirm)) return;
                    // Mark as cancelling immediately, wait for robot to confirm
                    await MostroTrader._ajax('mostro_trade_update', { order_id: trade.order_id, fields: { internal_status: 'cancelando' } });
                    trade.internal_status = 'cancelando';
                    MostroTrader.renderMyTrades();
                    await MostroTrader._sendToRobot('cancel', null, robotPubkey, trade.trade_privkey, orderId, MostroTrader._tradeIndexOrDefault(trade, 1));
                };
            });

            // ---- NostrEscrow on-chain: auditar reputacion del maker ----
            el.querySelectorAll('.nxoc-trader-rep').forEach(function(span) {
                span.onclick = function(e) {
                    e.stopPropagation();
                    var maker = span.dataset.maker;
                    if (maker && window.Onchain && Onchain.Reputation) Onchain.Reputation.openAudit(maker);
                };
            });

            // ---- NostrEscrow on-chain: tomar orden ajena ----
            el.querySelectorAll('.mostro-onchain-take-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var orderId = btn.dataset.id;
                    var order = self.orders[orderId];
                    if (!order || order._method !== 'onchain') return;
                    if (typeof Onchain === 'undefined' || !Onchain.Trader) {
                        alert(str_onchain_module_unavailable);
                        return;
                    }
                    var arbWarnings = [];
                    if (window.Onchain && Onchain.Arbitrators && Onchain.Arbitrators.pool) {
                        var arbPool = Onchain.Arbitrators.pool;
                        var seenArbWarn = {};
                        (order._arbitrators || []).forEach(function(pk) {
                            var a = arbPool[pk];
                            if (!a || !a.nostr_pubkey || seenArbWarn[a.nostr_pubkey]) return;
                            seenArbWarn[a.nostr_pubkey] = true;
                            if (a.nostr_pubkey === order.robotPubkey) {
                                arbWarnings.push(str_arbitrator_warning_maker);
                            }
                            if (Noxtr.Events && Noxtr.Events.pubkey && a.nostr_pubkey === Noxtr.Events.pubkey) {
                                arbWarnings.push(str_arbitrator_warning_self);
                            }
                        });
                    }
                    if (arbWarnings.length) {
                        var proceed = await confirm(t(str_arbitrator_warning_confirm, arbWarnings.join('\n')));
                        if (!proceed) return;
                    }
                    if (!Onchain.Keys.isUnlocked()) {
                        try {
                            await Onchain.Keys.unlock();
                        } catch(e) {
                            Onchain.Keys.openSetupDialog(async function() {
                                try { await Onchain.Keys.unlock(); } catch(e2) { return; }
                                btn.onclick();
                            });
                            return;
                        }
                    }
                    var defaultFiat = order.isRange ? order.fiatMin : parseFloat(order.fiatAmount) || 0;
                    var promptLabel = order.isRange
                        ? t(str_take_amount_range_prompt, order.fiatMin, order.fiatMax, order.fiatCode)
                        : t(str_confirm_amount_prompt, defaultFiat, order.fiatCode);
                    var input = await prompt(promptLabel, String(defaultFiat));
                    if (input === null) return;
                    var fiatAmount = parseFloat(input);
                    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
                        alert(str_invalid_amount);
                        return;
                    }
                    if (order.isRange && (fiatAmount < order.fiatMin || fiatAmount > order.fiatMax)) {
                        alert(t(str_amount_out_of_range, order.fiatMin, order.fiatMax));
                        return;
                    }
                    try {
                        var r = await Onchain.Trader.takeOrder({
                            orderId:       orderId,
                            fiatAmount:    fiatAmount,
                            makerPubkey:   btn.dataset.maker,
                            orderKind:     order.orderType,
                            satAmount:     order.satAmount || 0,
                            fiatCode:      order.fiatCode,
                            paymentMethod: order.paymentMethod,
                            arbitrators:   order._arbitrators || []
                        });
                        if (typeof notify === 'function') notify(str_take_request_sent_to_maker, 'success', 5000);
                        if (typeof MostroTrader !== 'undefined' && MostroTrader.loadMyTrades) await MostroTrader.loadMyTrades();
                    } catch (e) {
                        alert(t(str_take_order_error, e.message));
                    }
                };
            });

            // ---- NostrEscrow on-chain: ver solicitudes de take (maker) desde el orderbook ----
            el.querySelectorAll('.nxoc-req-btn').forEach(function(btn) {
                btn.onclick = function() {
                    if (typeof window.Onchain !== 'undefined' && window.Onchain.Trader) {
                        window.Onchain.Trader.openPendingTakesDialog(btn.dataset.id);
                    }
                };
            });

            // ---- NostrEscrow on-chain: cancelar orden propia desde el orderbook ----
            el.querySelectorAll('.mostro-onchain-cancel-btn').forEach(function(btn) {
                btn.onclick = async function() {
                    var orderId = btn.dataset.id;
                    if (!await confirm(str_cancel_onchain_order)) return;
                    if (typeof Onchain === 'undefined' || !Onchain.Trader || !Onchain.Trader.cancelOrder) {
                        alert(str_onchain_module_unavailable);
                        return;
                    }
                    try {
                        await Onchain.Trader.cancelOrder(orderId);
                        delete self.orders[orderId];
                        if (typeof MostroTrader !== 'undefined' && MostroTrader._trades) {
                            delete MostroTrader._trades[orderId];
                            MostroTrader.renderMyTrades();
                        }
                        self.render();
                    } catch (e) {
                        alert(t(str_cancel_error, e.message));
                    }
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
            el.querySelectorAll('.mostro-order-id').forEach(function(span) {
                span.onclick = function() {
                    var fullId = span.getAttribute('title') || '';
                    if (!fullId) return;
                    navigator.clipboard.writeText(fullId).then(function() {
                        var orig = span.textContent; span.textContent = '✓ ' + str_copied;
                        setTimeout(function() { span.textContent = orig; }, 1200);
                    });
                };
            });
            this._bindExplainToggles();
            this._startCountdown();
            this._applyDeepLink();

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
                loadMoreEl.innerHTML = '<a class="mostro-load-more-btn">' + t(str_view_n_more_pending, remaining) + '</a>';
                loadMoreEl.querySelector('.mostro-load-more-btn').onclick = function() { self._visibleCount += 10; self.render(); };
            } else if (!this._noMoreToLoad && this._oldestAt) {
                loadMoreEl.style.display = '';
                loadMoreEl.innerHTML = '<a class="mostro-load-more-btn">' + str_load_more_offers + '</a>';
                loadMoreEl.querySelector('.mostro-load-more-btn').onclick = function() {
                    loadMoreEl.innerHTML = '<span class="mo-load-more">' + str_loading + '</span>';
                    self.loadMore();
                };
            } else {
                loadMoreEl.style.display = 'none';
                loadMoreEl.innerHTML = '';
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
            if (!this._fiatFilter)       this._loadFiatFilter();
            if (this._showLnp2pbot === null) this._loadLnp2pbot();
            if (this._showBuy === null)      this._loadSide();
            if (this._showMostro === null)   this._loadSrc();
            if (this._minDays === null)      this._loadMinDays();
            var self = this;
            var noneActive = !this._pmChips.some(function(c) { return c.active; });
            var fiatActive = self._fiatFilter.length > 0;
            var fiatLabel  = fiatActive ? self._fiatFilter.join(' ') : str_coins_all;
            var daysActive = self._minDays > 0;
            el.innerHTML = '<div class="mostro-pm-chips">' +
                '<span class="mostro-pm-chip mostro-side-chip' + (self._showBuy  ? ' mostro-pm-active' : '') + '" id="mostro-side-buy">'+str_buy+'</span>' +
                '<span class="mostro-pm-chip mostro-side-chip' + (self._showSell ? ' mostro-pm-active' : '') + '" id="mostro-side-sell">'+str_sell+'</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-src-chip' + (self._showMostro  ? ' mostro-pm-active' : '') + '" id="mostro-src-mostro" title="' + str_tab_mostro_title + '">Mostro<span class="mostro-rep-star' + (MostroTrader._isReputationMode() ? ' mostro-rep-star-on' : '') + '" title="Reputación: liga los trades nuevos a la identidad índice 0 de tu sesión Mostro. No utiliza tu identidad social Nostr y funciona también con extensión o firmador remoto. Estrella gris = privacidad total.">★</span></span>' +
                '<span class="mostro-pm-chip mostro-src-chip' + (self._showOnchain ? ' mostro-pm-active' : '') + '" id="mostro-src-onchain" title="' + str_tab_onchain_title + '">on-chain</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-pm-all' + (noneActive ? ' mostro-pm-active' : '') + '" id="mostro-pm-all">'+str_all+'</span>' +
                this._pmChips.map(function(c, i) {
                    return '<span class="mostro-pm-chip' + (c.active ? ' mostro-pm-active' : '') + '" data-idx="' + i + '">' +
                        _escHtml(c.label) + '<a class="mostro-chip-rm" data-idx="' + i + '">×</a></span>';
                }).join('') +
                '<span class="mostro-chip-add-wrap"><input type="text" id="mostro-pm-add-input" class="mostro-chip-input" placeholder="' + str_add_placeholder + '" maxlength="30"></span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-fiat-chip' + (fiatActive ? ' mostro-pm-active' : '') + '" id="mostro-fiat-chip" title="' + str_coins_filter_title + '">💱 ' + _escHtml(fiatLabel) + '</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-pm-chip mostro-lnp-chip' + (self._showLnp2pbot ? ' mostro-pm-active' : '') + '" id="mostro-lnp-toggle">lnp2pbot</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-days-filter' + (daysActive ? ' mostro-days-active' : '') + '" title="' + str_days_filter_title + '">' +
                    '<span class="mostro-days-label" id="mostro-days-label">📅' + (daysActive ? ' ≥' + self._minDays + 'd' : '') + '</span>' +
                    '<input type="range" id="mostro-days-slider" class="mostro-days-slider" min="0" max="30" step="1" value="' + self._minDays + '">' +
                '</span>' +
                '<span class="mostro-chip-sep">|</span>' +
                '<span class="mostro-net-filter" title="' + str_onchain_network + '">⛓ <select id="mostro-net-select" class="mostro-net-select">' +
                    ['mainnet','testnet','signet'].map(function(n) {
                        var active = (typeof window.Onchain !== 'undefined' && window.Onchain.getNetwork) ? window.Onchain.getNetwork() : 'mainnet';
                        return '<option value="' + n + '"' + (n === active ? ' selected' : '') + '>' + n + '</option>';
                    }).join('') +
                '</select></span>' +
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
            var srcMostro  = document.getElementById('mostro-src-mostro');
            var srcOnchain = document.getElementById('mostro-src-onchain');
            if (srcMostro) srcMostro.onclick = function() {
                self._showMostro = !self._showMostro;
                if (!self._showMostro && !self._showOnchain) self._showOnchain = true;
                self._saveSrc(); self.render();
            };
            // Estrella de reputación dentro del chip Mostro: toggle independiente del filtro de fuente.
            var repStar = srcMostro ? srcMostro.querySelector('.mostro-rep-star') : null;
            if (repStar) repStar.onclick = async function(e) {
                e.stopPropagation();
                await MostroTrader.setupReputation();
                self.render();
            };
            if (srcOnchain) srcOnchain.onclick = function() {
                self._showOnchain = !self._showOnchain;
                if (!self._showOnchain && !self._showMostro) self._showMostro = true;
                self._saveSrc(); self.render();
            };
            var allBtn = document.getElementById('mostro-pm-all');
            if (allBtn) allBtn.onclick = function() {
                self._pmChips.forEach(function(c) { c.active = false; }); self._savePmChips(); self.render();
            };
            var fiatChip = document.getElementById('mostro-fiat-chip');
            if (fiatChip) fiatChip.onclick = function() { self._openFiatDialog(); };
            el.querySelectorAll('.mostro-pm-chip:not(.mostro-lnp-chip):not(.mostro-pm-all):not(.mostro-side-chip):not(.mostro-src-chip):not(.mostro-fiat-chip)').forEach(function(chip) {
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
                // Re-suscribir para aplicar el nuevo filtro #y (lnp2pbot on/off). subscribe() resetea
                // _closedOrders (tombstones de canceladas), pero esa info NO se puede re-capturar: el
                // filtro principal es #s:pending (no trae cancelaciones) y liveFilter solo trae eventos
                // futuros. Sin la lápida, un relay que aún sirva el pending obsoleto resucita la orden
                // cancelada. Preservamos los tombstones y NO vaciamos orders.
                var keepClosed = self._closedOrders;
                self.subscribe();
                self._closedOrders = keepClosed;
                self.render();
            };
            var daysSlider = document.getElementById('mostro-days-slider');
            var daysLabel  = document.getElementById('mostro-days-label');
            if (daysSlider) daysSlider.oninput = function() {
                var v = parseInt(daysSlider.value) || 0;
                daysLabel.textContent = v > 0 ? '📅 ≥' + v + 'd' : '📅';
                daysSlider.closest('.mostro-days-filter').classList.toggle('mostro-days-active', v > 0);
                self._minDays = v; self._saveMinDays(); self.render();
            };
            var netSel = document.getElementById('mostro-net-select');
            if (netSel) netSel.onchange = function() {
                if (typeof window.Onchain !== 'undefined' && window.Onchain.setNetwork) {
                    window.Onchain.setNetwork(netSel.value);  // re-renderiza book + Mis trades
                }
            };
        },

        // ---- dialog de selección de monedas (filtro 💱) ----
        _openFiatDialog: function() {
            var self = this;
            if (!this._fiatFilter) this._loadFiatFilter();
            var coins = window.NOXTR_COINS || {};
            var codes = Object.keys(coins);
            var sel = this._fiatFilter;
            var allDefault = sel.length === 0;  // vacío = todas
            var rows = codes.map(function(code) {
                var checked = (allDefault || sel.indexOf(code) !== -1) ? ' checked' : '';
                return '<label class="mostro-fiat-row"><input type="checkbox" value="' + _escHtml(code) + '"' + checked + '> ' +
                    '<strong>' + _escHtml(code) + '</strong> <span>' + _escHtml(coins[code]) + '</span></label>';
            }).join('');
            $('body').dialog({
                title: '💱 ' + str_coins_dialog_title,
                type: 'html',
                content: '<div class="mostro-fiat-actions"><a href="javascript:;" class="mostro-fiat-uncheck">' + str_coins_uncheck_all + '</a></div>' +
                    '<div class="mostro-fiat-list">' + rows + '</div>',
                onLoad: function(dialog) {
                    var link = dialog.overlay.querySelector('.mostro-fiat-uncheck');
                    if (link) link.onclick = function() {
                        dialog.overlay.querySelectorAll('.mostro-fiat-list input').forEach(function(cb) { cb.checked = false; });
                    };
                },
                buttons: [
                    { text: str_cancel, action: function(e, overlay) {
                        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    }},
                    { text: str_save, action: function(e, overlay) {
                        var picked = [];
                        (overlay || document).querySelectorAll('.mostro-fiat-list input:checked').forEach(function(cb) {
                            picked.push(cb.value);
                        });
                        // todas marcadas (o ninguna) = "todas" → filtro vacío, chip 'Monedas'
                        if (picked.length === codes.length) picked = [];
                        self._fiatFilter = picked; self._saveFiatFilter();
                        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                        self.render();
                    }}
                ]
            });
        },

        // ---- tooltip "¿Cómo funciona?" ----
        _explainOrder: function(o, isOwn) {
            var fiat = _escHtml(this._formatOrderFiatLabel(o));
            var pm = _escHtml(o.paymentMethod);
            var premium = parseFloat(o.premium);
            var isSell = o.orderType === 'sell';
            var eid = 'mostro-explain-' + o.id.replace(/[^a-z0-9]/gi, '');
            var headline, steps, note;
            var satsBlock = this._isFixedPriceOrder(o)
                ? '<strong>' + o.satAmount.toLocaleString() + ' sats</strong>'
                : str_btc_at_market_price;
            var premBelowFull  = premium < 0 ? ' (' + t(str_premium_below_market, Math.abs(premium)) + ')' : '';
            var premAbove      = premium > 0 ? ' (' + t(str_premium_above_market, premium) + ')' : '';
            var premBelowShort = premium < 0 ? ' (' + t(str_premium_below_short, Math.abs(premium)) + ')' : '';
            if (o.daemon === 'lnp2pbot') {
                headline = '💡 ' + t(str_explain_lnp2pbot_h, fiat, pm);
                steps    = t(str_explain_lnp2pbot_s, _escHtml(o.id));
                note     = str_explain_lnp2pbot_n;
            } else if (o._method === 'onchain' && isOwn && isSell) {
                headline = '💡 ' + t(str_explain_own_sell_oc_h, fiat, pm);
                steps    = str_explain_own_sell_oc_s;
                note     = str_explain_own_sell_oc_n;
            } else if (o._method === 'onchain' && isOwn) {
                headline = '💡 ' + t(str_explain_own_buy_oc_h, fiat, pm);
                steps    = str_explain_own_buy_oc_s;
                note     = str_explain_own_buy_oc_n;
            } else if (o._method === 'onchain' && isSell) {
                var premTxtOc = premium < 0 ? premBelowFull : premium > 0 ? premAbove : '';
                headline = '💡 ' + t(str_explain_sell_oc_h, fiat, premTxtOc, pm, satsBlock);
                steps    = t(str_explain_sell_oc_s, fiat, pm);
                note     = str_explain_sell_oc_n;
            } else if (o._method === 'onchain') {
                var premTxtOc2 = premium > 0 ? premAbove : premium < 0 ? premBelowShort : '';
                headline = '💡 ' + t(str_explain_buy_oc_h, fiat, premTxtOc2, pm, satsBlock);
                steps    = t(str_explain_buy_oc_s, fiat, pm);
                note     = str_explain_buy_oc_n;
            } else if (isOwn && isSell) {
                headline = '💡 ' + t(str_explain_own_sell_h, fiat, pm);
                steps    = str_explain_own_sell_s;
                note     = str_explain_own_pending_n;
            } else if (isOwn) {
                headline = '💡 ' + t(str_explain_own_buy_h, fiat, pm);
                steps    = str_explain_own_buy_s;
                note     = str_explain_own_pending_n;
            } else if (isSell) {
                var premTxt = premium < 0 ? premBelowFull : premium > 0 ? premAbove : '';
                headline = '💡 ' + t(str_explain_sell_h, fiat, premTxt, pm, satsBlock);
                steps    = t(str_explain_sell_s, fiat);
                note     = str_explain_sell_n;
            } else {
                var premTxt2 = premium > 0 ? premAbove : premium < 0 ? premBelowShort : '';
                headline = '💡 ' + t(str_explain_buy_h, fiat, premTxt2, pm, satsBlock);
                steps    = t(str_explain_buy_s, fiat);
                note     = str_explain_buy_n;
            }
            return '<div class="mostro-explain" id="' + eid + '" style="display:none">' +
                '<p class="mostro-explain-headline">' + headline + '</p>' +
                '<ol>' + steps + '</ol>' +
                '<p class="mostro-explain-note">' + note + '</p>' +
                '<a class="mostro-gotit" data-eid="' + eid + '">' + str_hide + ' ↑</a>' +
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
        },

        // ---- enlace directo /noxtr/mostro/ORDER_ID: expandir explain + resaltar ----
        _applyDeepLink: function() {
            if (!this._deepLinkId) return;
            var sid = this._deepLinkId.replace(/[^a-z0-9]/gi, '');
            var card = document.getElementById('mostro-order-' + sid);
            if (!card) return; // la orden aún no ha llegado de los relays; reintenta en el próximo render
            var explain = document.getElementById('mostro-explain-' + sid);
            if (explain) explain.style.display = '';
            card.classList.add('mostro-order-highlight');
            // El scroll solo tiene sentido con el panel visible (switchTab tarda ~800ms en abrirlo)
            if (this._deepLinkDone || card.offsetParent === null) return;
            this._deepLinkDone = true;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var self = this;
            setTimeout(function() {
                self._deepLinkId = null;
                var c = document.getElementById('mostro-order-' + sid);
                if (c) c.classList.remove('mostro-order-highlight');
            }, 8000);
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
                        MostroBook._applyDeepLink();
                        MostroTrader._renderBetaBanner();
                    }
                };
            }

            // 1b. Lo mismo con activateSearch, que NO pasa por switchTab: tiene su propia lista
            //     fija de paneles a ocultar y panel-mostro no está en ella (lo añade este módulo).
            //     Sin esto, pulsar la lupa desde la pestaña Mostro cambiaba de tab y de URL pero
            //     dejaba el order book visible, así que parecía que el botón no hacía nada.
            if (window.Noxtr && Noxtr.UI && typeof Noxtr.UI.activateSearch === 'function') {
                var _origActivateSearch = Noxtr.UI.activateSearch.bind(Noxtr.UI);
                Noxtr.UI.activateSearch = function (pushHistory) {
                    var panelMostro = document.getElementById('panel-mostro');
                    if (panelMostro) { panelMostro.style.display = 'none'; MostroBook._stopCountdown(); }
                    return _origActivateSearch(pushHistory);
                };
            }

            // Actualizar la cotización de referencia cada 5 segundos mientras el
            // panel está visible. _fetchPriceRates mantiene el mismo intervalo
            // como TTL, por lo que no se hacen peticiones redundantes.
            if (!MostroBook._priceRefreshTimer) {
                MostroBook._priceRefreshTimer = setInterval(function () {
                    var panelMostro = document.getElementById('panel-mostro');
                    if (document.visibilityState !== 'visible' || !panelMostro || panelMostro.style.display === 'none') return;
                    MostroBook._refreshDisplayedPrices();
                }, 5000);
            }

            // Enlace directo a una orden: leer el id de la URL ANTES de que switchTab la reescriba
            var dlMatch = location.pathname.match(new RegExp('^/' + _MODULE_ + '/mostro/([A-Za-z0-9-]+)'));
            if (dlMatch) MostroBook._deepLinkId = dlMatch[1];

            // 2. Arrancar suscripción de órdenes
            // Cuando llega el perfil de una instancia, refrescar su nombre/avatar en las fichas.
            var _profileUpdate = Noxtr.Profiles.onUpdate;
            Noxtr.Profiles.onUpdate = function (pk) {
                if (typeof _profileUpdate === 'function') _profileUpdate(pk);
                document.querySelectorAll('.mostro-robot-id[data-robot="' + pk + '"]').forEach(function (node) {
                    node.outerHTML = MostroCommunities.robotIdentityHtml(pk);
                });
            };
            MostroBook.subscribe();
            // Filtro de monedas desde CLI_USER_CFG (fuente de verdad, igual en cualquier PC).
            MostroBook._fetchFiatFilter();

            // 3. Robots Mostro (communities)
            MostroCommunities.render();
            // Comprobar siempre el directorio al cargar. Después se vuelve a consultar cada 15 min;
            // solo se resuscribe el orderbook cuando la lista realmente ha cambiado.
            MostroCommunities.refreshRemote({ force: true });
            if (!MostroCommunities._directoryRefreshTimer) {
                MostroCommunities._directoryRefreshTimer = setInterval(function () {
                    if (document.visibilityState !== 'visible') return;
                    MostroCommunities.refreshRemote({ force: true });
                }, MostroCommunities._REMOTE_TTL_MS);
            }

            // 4. Cargar primero los trades y después la sesión criptográfica Mostro. Las acciones
            // de crear/tomar esperan esta promesa: nunca se deriva una clave contra una lista local
            // todavía vacía ni se cae a una clave aleatoria no restaurable.
            MostroTrader._renderNwcBar();
            MostroTrader._startupPromise = (async function() {
                await MostroTrader.loadMyTrades();
                if (Noxtr.Api && Noxtr.Api.userId && !(await MostroTrader.ensureSeed())) {
                    console.error('[Mostro] No se pudo inicializar la sesión criptográfica Mostro');
                }
            })();

            // 5. Botón "+ Crear oferta"
            var btnCreate = document.getElementById('btn-mostro-create-order');
            if (btnCreate) btnCreate.onclick = function() { MostroTrader.createOrder(); };

            // El toggle de reputación (chip) se renderiza y cablea dentro de MostroCommunities.render().

        }, 0);
    });

    // Debug helpers (remove in production)
    window.MostroTrader = MostroTrader;
    window.MostroBook   = MostroBook;
    window._MostroTrader = MostroTrader;
    window._MostroBook   = MostroBook;
    window._Nip47        = Nip47;
    window._MostroTradeSnapshot = function(orderId) {
        if (!orderId || !MostroTrader || !MostroTrader._trades) return null;
        return _mostroTradeSnapshot(MostroTrader._trades[orderId] || null);
    };

    // ==================== EXPORTS PARA REUSO CROSS-MÓDULO ====================
    // Helpers BIP39/BIP32 usados por la sesión Mostro y por script.onchain.js
    // (NostrEscrow on-chain). Cuando crezcan a más
    // primitivas Bitcoin (Schnorr, Taproot, PSBT) se moverán a script.bitcoin.js
    // como librería autónoma reusable por noxtr Y otros módulos.
    window.NoxtrCrypto = window.NoxtrCrypto || {};
    window.NoxtrCrypto.bip39Seed       = _bip39Seed;
    window.NoxtrCrypto.hmacSha512      = _hmacSha512;
    window.NoxtrCrypto.bip32DerivePath = _bip32DerivePath;
    window.NoxtrCrypto.deriveChild     = _deriveChild;
    window.NoxtrCrypto.hexToBytes      = _hexToBytes;
    window.NoxtrCrypto.bytesToHex      = _bytesToHex;
    window.NoxtrCrypto.SECP256K1_N     = _N;

})();
