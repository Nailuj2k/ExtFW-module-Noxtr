(function () {

    function _maEscHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _maHexToBytes(hex) {
        var arr = new Uint8Array(hex.length / 2);
        for (var i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return arr;
    }

    function _maBytesToHex(bytes) {
        return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function _maSha256hex(str) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return _maBytesToHex(new Uint8Array(buf));
    }

    function _maGetPubkeyHex(privkeyHex) {
        var pk = nobleSecp256k1.getPublicKey(privkeyHex, true);
        return (typeof pk === 'string' ? pk : _maBytesToHex(pk)).slice(2);
    }

    function _maGenerateKeypair() {
        var privBytes = crypto.getRandomValues(new Uint8Array(32));
        var privHex = _maBytesToHex(privBytes);
        return { priv: privHex, pub: _maGetPubkeyHex(privHex) };
    }

    async function _maSignEventWith(ev, privkeyHex) {
        ev.id = await _maSha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
        var sig = await nobleSecp256k1.schnorr.sign(ev.id, privkeyHex);
        ev.sig = typeof sig === 'string' ? sig : _maBytesToHex(sig);
        return ev;
    }

    async function _maGiftWrap(messageArray, recipientPubkeyHex, senderPrivkeyHex) {
        var senderPub = _maGetPubkeyHex(senderPrivkeyHex);
        var randomNow = function() { return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 7200); };

        var rumor = {
            kind: 1,
            pubkey: senderPub,
            content: JSON.stringify(messageArray),
            tags: [['p', recipientPubkeyHex]],
            created_at: Math.floor(Date.now() / 1000)
        };
        rumor = await _maSignEventWith(rumor, senderPrivkeyHex);

        var sealConvKey = await Noxtr.Nip44.getConversationKey(senderPrivkeyHex, recipientPubkeyHex);
        var seal = {
            kind: 13,
            pubkey: senderPub,
            content: await Noxtr.Nip44.encrypt(JSON.stringify(rumor), sealConvKey),
            tags: [],
            created_at: randomNow()
        };
        seal = await _maSignEventWith(seal, senderPrivkeyHex);

        var eph = _maGenerateKeypair();
        var wrapConvKey = await Noxtr.Nip44.getConversationKey(eph.priv, recipientPubkeyHex);
        var wrap = {
            kind: 1059,
            pubkey: eph.pub,
            content: await Noxtr.Nip44.encrypt(JSON.stringify(seal), wrapConvKey),
            tags: [['p', recipientPubkeyHex]],
            created_at: Math.floor(Date.now() / 1000)
        };
        wrap = await _maSignEventWith(wrap, eph.priv);
        return wrap;
    }

    async function _maUnwrapGiftWrap(giftWrapEv, ourPrivkeyHex) {
        try {
            var wrapConvKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, giftWrapEv.pubkey);
            var seal = JSON.parse(await Noxtr.Nip44.decrypt(giftWrapEv.content, wrapConvKey));
            var sealConvKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, seal.pubkey);
            return JSON.parse(await Noxtr.Nip44.decrypt(seal.content, sealConvKey));
        } catch(e) {
            return null;
        }
    }

    var MostroAdmin = {
        _startedAt: Math.floor(Date.now() / 1000),
        _seenEvIds: {},
        _subId: null,
        _subPubkey: '',
        _pending: {},

        init: function() {
            var panel = document.getElementById('panel-mostro');
            if (!panel || document.getElementById('mostro-admin-panel')) return;

            var header = panel.querySelector('.mostro-header-bar');
            if (!header) return;

            var adminPanel = document.createElement('div');
            adminPanel.id = 'mostro-admin-panel';
            adminPanel.className = 'mostro-header-bar';
            adminPanel.style.marginTop = '8px';
            adminPanel.innerHTML =
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                    '<strong>Admin robot</strong>' +
                    '<span class="mostro-info-link" style="margin-right:0;">Sólo acciones contempladas por el protocolo: <code>admin-cancel</code> y <code>admin-settle</code>. El cliente no puede saber si tu clave es admin; lo decide el daemon.</span>' +
                    '<button id="btn-mostro-admin-toggle" class="btn btn-sm btn-noxtr" style="margin-left:auto;">Mostrar</button>' +
                '</div>' +
                '<div id="mostro-admin-body" style="display:none;margin-top:10px;">' +
                    '<div class="mo-form">' +
                        '<div class="mo-row"><span class="mo-label">Acción</span>' +
                            '<select id="mostro-admin-action" class="mo-input mo-input-lg">' +
                                '<option value="admin-cancel">admin-cancel</option>' +
                                '<option value="admin-settle">admin-settle</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">Order ID</span>' +
                            '<input id="mostro-admin-order-id" type="text" class="mo-input mo-input-lg" placeholder="UUID de la orden" style="max-width:320px;">' +
                            '<button id="btn-mostro-admin-fill-robot" class="btn btn-sm btn-noxtr" type="button">Autocompletar robot</button>' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">Robot pubkey</span>' +
                            '<input id="mostro-admin-robot-pubkey" type="text" class="mo-input mo-input-lg" placeholder="pubkey hex del robot" style="max-width:420px;">' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">Sesión actual</span>' +
                            '<span id="mostro-admin-session" class="mostro-trade-status"></span>' +
                        '</div>' +
                        '<div class="mo-row">' +
                            '<button id="btn-mostro-admin-send" class="btn btn-noxtr btn-sm btn-warning" type="button">Enviar acción admin</button>' +
                        '</div>' +
                        '<div id="mostro-admin-status" class="mostro-trade-status"></div>' +
                        '<pre id="mostro-admin-log" style="margin:6px 0 0;padding:8px 10px;border:1px solid var(--noxtr-border);border-radius:6px;background:var(--noxtr-bg-surface);color:var(--noxtr-text-soft);font-size:0.78em;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;"></pre>' +
                    '</div>' +
                '</div>';

            header.insertAdjacentElement('afterend', adminPanel);
            this._bindUi();
            this._renderSessionState();
            this._setStatus('Listo. Debes usar una sesión Nostr con clave privada cargada en el navegador.', 'info');
            this._log('Panel admin preparado. El daemon validará si la pubkey actual tiene permisos admin.');
        },

        _bindUi: function() {
            var self = this;
            var toggle = document.getElementById('btn-mostro-admin-toggle');
            var body = document.getElementById('mostro-admin-body');
            if (toggle && body) {
                toggle.onclick = function() {
                    var open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : '';
                    toggle.textContent = open ? 'Mostrar' : 'Ocultar';
                    self._renderSessionState();
                };
            }

            var fillRobotBtn = document.getElementById('btn-mostro-admin-fill-robot');
            if (fillRobotBtn) {
                fillRobotBtn.onclick = function() { self._fillRobotPubkeyFromBook(); };
            }

            var orderInput = document.getElementById('mostro-admin-order-id');
            if (orderInput) {
                orderInput.onblur = function() { self._fillRobotPubkeyFromBook(); };
            }

            var sendBtn = document.getElementById('btn-mostro-admin-send');
            if (sendBtn) {
                sendBtn.onclick = function() { self._submit(); };
            }
        },

        _renderSessionState: function() {
            var el = document.getElementById('mostro-admin-session');
            if (!el) return;
            if (!window.Noxtr || !Noxtr.Events || !Noxtr.Events.pubkey) {
                el.textContent = 'Sin sesión Nostr activa';
                return;
            }
            var pub = Noxtr.Events.pubkey;
            var mode = Noxtr.Events.privkey ? 'firma local disponible' : 'sin clave privada local';
            el.textContent = pub.slice(0, 12) + '… · ' + mode;
        },

        _setStatus: function(text, tone) {
            var el = document.getElementById('mostro-admin-status');
            if (!el) return;
            el.textContent = text || '';
            el.style.color = tone === 'error' ? '#e53935' : tone === 'success' ? '#2a7a2a' : tone === 'warning' ? '#f7931a' : '';
        },

        _log: function(text) {
            var el = document.getElementById('mostro-admin-log');
            if (!el) return;
            var now = new Date();
            var stamp = now.toLocaleTimeString();
            el.textContent = '[' + stamp + '] ' + text + '\n' + (el.textContent || '');
        },

        _fillRobotPubkeyFromBook: function() {
            var orderEl = document.getElementById('mostro-admin-order-id');
            var robotEl = document.getElementById('mostro-admin-robot-pubkey');
            if (!orderEl || !robotEl || !window._MostroBook || !_MostroBook.orders) return false;
            var orderId = (orderEl.value || '').trim();
            if (!orderId) return false;
            var order = _MostroBook.orders[orderId];
            if (!order || !order.robotPubkey) return false;
            if (!(robotEl.value || '').trim()) robotEl.value = order.robotPubkey;
            this._log('Robot pubkey autocompletada desde el order book para ' + orderId + '.');
            return true;
        },

        _validateForm: function() {
            var actionEl = document.getElementById('mostro-admin-action');
            var orderEl = document.getElementById('mostro-admin-order-id');
            var robotEl = document.getElementById('mostro-admin-robot-pubkey');
            var action = actionEl ? String(actionEl.value || '').trim() : '';
            var orderId = orderEl ? String(orderEl.value || '').trim() : '';
            var robotPubkey = robotEl ? String(robotEl.value || '').trim().toLowerCase() : '';

            if (action !== 'admin-cancel' && action !== 'admin-settle') {
                this._setStatus('Acción no válida.', 'error');
                return null;
            }
            orderId = orderId.replace(/[^a-zA-Z0-9\-_]/g, '');
            robotPubkey = robotPubkey.replace(/[^a-f0-9]/g, '');
            if (!orderId) {
                this._setStatus('Indica el order_id.', 'error');
                return null;
            }
            if (robotPubkey.length !== 64) {
                this._setStatus('Indica la pubkey hex del robot.', 'error');
                return null;
            }
            if (!window.Noxtr || !Noxtr.Events || !Noxtr.Events.pubkey || !Noxtr.Events.privkey) {
                this._setStatus('Este panel requiere una sesión Nostr con clave privada local cargada.', 'error');
                return null;
            }
            return { action: action, orderId: orderId, robotPubkey: robotPubkey };
        },

        _ensureSubscription: function() {
            if (!window.Noxtr || !Noxtr.Events || !Noxtr.Events.pubkey || !Noxtr.Events.privkey) return false;
            if (this._subId && this._subPubkey === Noxtr.Events.pubkey) return true;
            if (this._subId) {
                try { Noxtr.Pool.unsubscribe(this._subId); } catch(e) {}
                this._subId = null;
            }
            this._seenEvIds = {};
            this._startedAt = Math.floor(Date.now() / 1000);
            this._subPubkey = Noxtr.Events.pubkey;
            var self = this;
            this._subId = Noxtr.Pool.subscribe(
                [{ kinds: [1059], '#p': [Noxtr.Events.pubkey], since: this._startedAt }],
                function(ev) { self._handleGiftWrap(ev); }
            );
            this._log('Suscripción admin iniciada para ' + Noxtr.Events.pubkey.slice(0, 12) + '…');
            return true;
        },

        _handleGiftWrap: async function(ev) {
            if (!ev || this._seenEvIds[ev.id]) return;
            this._seenEvIds[ev.id] = true;
            if ((parseInt(ev.created_at, 10) || 0) < this._startedAt) return;
            if (!Noxtr.Events || !Noxtr.Events.privkey) return;

            var rumor = await _maUnwrapGiftWrap(ev, Noxtr.Events.privkey);
            if (!rumor || !rumor.content) return;

            try {
                var msg = JSON.parse(rumor.content);
                var msgObj = Array.isArray(msg) ? msg[0] : msg;
                var order = msgObj && msgObj.order ? msgObj.order : {};
                var action = order.action || '';
                var orderId = order.id || '';

                if (['admin-canceled', 'admin-settled', 'cant-do'].indexOf(action) === -1) return;

                if (action === 'admin-canceled') {
                    this._setStatus('El robot confirmó admin-cancel para ' + orderId + '.', 'success');
                    this._log('RECV admin-canceled · ' + orderId + ' · la orden debería salir del order book.');
                } else if (action === 'admin-settled') {
                    this._setStatus('El robot confirmó admin-settle para ' + orderId + '.', 'success');
                    this._log('RECV admin-settled · ' + orderId + ' · Mostro intentará pagar la invoice del comprador.');
                } else if (action === 'cant-do') {
                    this._setStatus('El robot respondió cant-do para ' + orderId + '.', 'warning');
                    this._log('RECV cant-do · ' + orderId + ' · el daemon rechazó la acción.');
                }
            } catch(e) {}
        },

        _submit: async function() {
            var data = this._validateForm();
            if (!data) return;
            if (!this._ensureSubscription()) {
                this._setStatus('No se pudo iniciar la escucha de respuestas admin.', 'error');
                return;
            }

            var payload = [{ order: {
                version: 1,
                id: data.orderId,
                action: data.action,
                payload: null
            }}, null];

            try {
                var wrap = await _maGiftWrap(payload, data.robotPubkey, Noxtr.Events.privkey);
                Noxtr.Pool.publish(wrap);
                Noxtr.Pool.publishTo('wss://relay.mostro.network', wrap);
                this._pending[data.orderId] = { action: data.action, at: Date.now() };
                this._setStatus('Enviado ' + data.action + ' para ' + data.orderId + '. Esperando respuesta del robot…', 'info');
                this._log('SEND ' + data.action + ' · order=' + data.orderId + ' · robot=' + data.robotPubkey.slice(0, 12) + '…');
            } catch (e) {
                console.error('[MostroAdmin] Error enviando acción admin:', e);
                this._setStatus('No se pudo enviar la acción admin.', 'error');
                this._log('ERROR ' + (e && e.message ? e.message : String(e)));
            }
        }
    };

    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            MostroAdmin.init();
        }, 0);
    });

    window._MostroAdmin = MostroAdmin;

})();
