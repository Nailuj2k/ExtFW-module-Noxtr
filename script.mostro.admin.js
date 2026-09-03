(function () {

    function _maEscHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    async function _maSignEventWith(ev, privkeyHex) {
        ev.id = await _maSha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
        var sig = await nobleSecp256k1.schnorr.sign(ev.id, privkeyHex);
        ev.sig = typeof sig === 'string' ? sig : _maBytesToHex(sig);
        return ev;
    }

    // Transporte v2 (kind 14, NIP-44 directo) — auditoría 2026-08-22: el panel admin mandaba kind
    // 1059 (v1), que mostrod >= 0.19 ignora en silencio; el panel quedaba mudo. Mismo patrón que
    // _wrapV2/_unwrapV2 de script.mostro.js, duplicado aquí a propósito (este archivo es
    // deliberadamente independiente, ver cabecera). El admin firma con su propia identidad
    // (Noxtr.Events.privkey) como autor directo del kind 14 — verificado contra admin_cancel.rs/
    // admin_settle.rs reales del daemon: usan event.identity, que sin identity_proof adjunto es
    // event.pubkey. No hace falta trade_sig ni identity_proof (tuple = [msgObj, null, null]).
    async function _maWrapV2(msgObj, recipientPubkeyHex, privkeyHex) {
        var pub = _maGetPubkeyHex(privkeyHex);
        var tuple = JSON.stringify([msgObj, null, null]);
        var convKey = await Noxtr.Nip44.getConversationKey(privkeyHex, recipientPubkeyHex);
        var content = await Noxtr.Nip44.encrypt(tuple, convKey);
        var now = Math.floor(Date.now() / 1000);
        var ev = { kind: 14, pubkey: pub, content: content,
            tags: [['p', recipientPubkeyHex], ['expiration', String(now + 86400 * 2)]],
            created_at: now };
        ev = await _maSignEventWith(ev, privkeyHex);
        return ev;
    }

    async function _maUnwrapV2(ev, ourPrivkeyHex) {
        try {
            var convKey = await Noxtr.Nip44.getConversationKey(ourPrivkeyHex, ev.pubkey);
            var tuple = JSON.parse(await Noxtr.Nip44.decrypt(ev.content, convKey));
            return Array.isArray(tuple) ? tuple[0] : tuple;
        } catch(e) {
            return null;
        }
    }

    // Verifica la firma de un kind 14 recibido: recalcula el id (NIP-01) en vez de confiar en el
    // que trae el objeto, y comprueba la firma Schnorr contra ese id recalculado y ev.pubkey. La
    // suscripción filtra solo por #p (ver nota en _ensureSubscription: este panel habla con
    // múltiples instancias, no se puede fijar un `authors` estático) — sin esta verificación,
    // cualquiera que conociera la pubkey del admin podría publicar un falso admin-canceled/-settled.
    async function _maVerifySig(ev) {
        try {
            if (!ev || !ev.sig || !ev.pubkey) return false;
            var id = await _maSha256hex(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
            return await nobleSecp256k1.schnorr.verify(ev.sig, id, ev.pubkey);
        } catch(e) {
            return false;
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
            adminPanel.style.display = 'none';
            adminPanel.innerHTML =
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                    '<strong>' + str_admin_robot + '</strong>' +
                    '<span class="mostro-info-link" style="margin-right:0;">' + str_admin_protocol_notice + '</span>' +
                    '<button id="btn-mostro-admin-toggle" class="btn btn-sm btn-noxtr" style="margin-left:auto;">' + str_show + '</button>' +
                '</div>' +
                '<div id="mostro-admin-body" style="display:none;margin-top:10px;">' +
                    '<div class="mo-form">' +
                        '<div class="mo-row"><span class="mo-label">' + str_action + '</span>' +
                            '<select id="mostro-admin-action" class="mo-input mo-input-lg">' +
                                '<option value="admin-cancel">admin-cancel</option>' +
                                '<option value="admin-settle">admin-settle</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">' + str_order_id + '</span>' +
                            '<input id="mostro-admin-order-id" type="text" class="mo-input mo-input-lg" placeholder="' + str_order_uuid_placeholder + '" style="max-width:320px;">' +
                            '<button id="btn-mostro-admin-fill-robot" class="btn btn-sm btn-noxtr" type="button">' + str_autofill_robot + '</button>' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">' + str_robot_pubkey + '</span>' +
                            '<input id="mostro-admin-robot-pubkey" type="text" class="mo-input mo-input-lg" placeholder="' + str_robot_pubkey_placeholder + '" style="max-width:420px;">' +
                        '</div>' +
                        '<div class="mo-row"><span class="mo-label">' + str_current_session + '</span>' +
                            '<span id="mostro-admin-session" class="mostro-trade-status"></span>' +
                        '</div>' +
                        '<div class="mo-row">' +
                            '<button id="btn-mostro-admin-send" class="btn btn-noxtr btn-sm btn-warning" type="button">' + str_send_admin_action + '</button>' +
                        '</div>' +
                        '<div id="mostro-admin-status" class="mostro-trade-status"></div>' +
                        '<pre id="mostro-admin-log" style="margin:6px 0 0;padding:8px 10px;border:1px solid var(--noxtr-border);border-radius:6px;background:var(--noxtr-bg-surface);color:var(--noxtr-text-soft);font-size:0.78em;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;"></pre>' +
                    '</div>' +
                '</div>';

            header.insertAdjacentElement('afterend', adminPanel);
            this._bindUi();
            this._renderSessionState();
            this._setStatus(str_admin_ready_status, 'info');
            this._log(str_admin_panel_ready_log);
        },

        _bindUi: function() {
            var self = this;
            var toggle = document.getElementById('btn-mostro-admin-toggle');
            var body = document.getElementById('mostro-admin-body');
            if (toggle && body) {
                toggle.onclick = function() {
                    var open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : '';
                    toggle.textContent = open ? str_show : str_hide;
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
                el.textContent = str_no_active_nostr_session;
                return;
            }
            var pub = Noxtr.Events.pubkey;
            var mode = Noxtr.Events.privkey ? str_local_signing_available : str_no_local_private_key;
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
            this._log(t(str_robot_pubkey_autofilled, orderId));
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
                this._setStatus(str_invalid_action, 'error');
                return null;
            }
            orderId = orderId.replace(/[^a-zA-Z0-9\-_]/g, '');
            robotPubkey = robotPubkey.replace(/[^a-f0-9]/g, '');
            if (!orderId) {
                this._setStatus(str_enter_order_id, 'error');
                return null;
            }
            if (robotPubkey.length !== 64) {
                this._setStatus(str_enter_robot_pubkey_hex, 'error');
                return null;
            }
            if (!window.Noxtr || !Noxtr.Events || !Noxtr.Events.pubkey || !Noxtr.Events.privkey) {
                this._setStatus(str_admin_requires_local_key, 'error');
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
            // Solo #p: este panel puede hablar con varias instancias en la misma sesión (el
            // robot_pubkey es un campo libre del formulario, no una lista fija como en
            // subscribeMyTrades de script.mostro.js), así que no hay un `authors` estático que
            // fijar aquí. La autenticidad real la da _maVerifySig() + el cruce contra el
            // robot_pubkey guardado en _pending al enviar (ver _handleGiftWrap).
            this._subId = Noxtr.Pool.subscribe(
                [{ kinds: [14], '#p': [Noxtr.Events.pubkey], since: this._startedAt }],
                function(ev) { self._handleGiftWrap(ev); }
            );
            this._log(t(str_admin_subscription_started, Noxtr.Events.pubkey.slice(0, 12)));
            return true;
        },

        _handleGiftWrap: async function(ev) {
            if (!ev || this._seenEvIds[ev.id]) return;
            this._seenEvIds[ev.id] = true;
            if ((parseInt(ev.created_at, 10) || 0) < this._startedAt) return;
            if (!Noxtr.Events || !Noxtr.Events.privkey) return;

            if (!(await _maVerifySig(ev))) {
                this._log('firma del kind 14 inválida, descartado: ' + ev.id);
                return;
            }

            var msgObj = await _maUnwrapV2(ev, Noxtr.Events.privkey);
            if (!msgObj) return;

            try {
                var order = msgObj && msgObj.order ? msgObj.order : {};
                var action = order.action || '';
                var orderId = order.id || '';

                if (['admin-canceled', 'admin-settled', 'cant-do'].indexOf(action) === -1) return;

                // Cruce contra el robot al que realmente le mandamos esta acción: ev.pubkey debe
                // coincidir con el robot_pubkey usado en _submit para este orderId. Sin esto,
                // cualquier instancia (o quien conozca la pubkey del admin) podría suplantar la
                // respuesta de OTRO robot para el mismo orderId.
                var pend = this._pending[orderId];
                if (pend && pend.robotPubkey && String(ev.pubkey || '').toLowerCase() !== pend.robotPubkey) {
                    this._log('respuesta de pubkey inesperada para ' + orderId + ', descartada: ' + ev.pubkey);
                    return;
                }

                if (action === 'admin-canceled') {
                    this._setStatus(t(str_robot_confirmed_cancel, orderId), 'success');
                    this._log(t(str_log_admin_canceled, orderId));
                } else if (action === 'admin-settled') {
                    this._setStatus(t(str_robot_confirmed_settle, orderId), 'success');
                    this._log(t(str_log_admin_settled, orderId));
                } else if (action === 'cant-do') {
                    this._setStatus(t(str_robot_cant_do, orderId), 'warning');
                    this._log(t(str_log_cant_do, orderId));
                }
            } catch(e) {}
        },

        _submit: async function() {
            var data = this._validateForm();
            if (!data) return;
            if (!this._ensureSubscription()) {
                this._setStatus(str_admin_subscription_failed, 'error');
                return;
            }

            // Orden de campos = struct real MessageKind (message.rs de mostro-core), igual que
            // _buildMsg de script.mostro.js: version, request_id, trade_index, id, action, payload.
            // trade_index no aplica a acciones de admin (no hay concepto de trade_index para el
            // admin) — se manda null explícito: a diferencia de `id`, ese campo no tiene
            // skip_serializing_if en el struct real, así que el daemon siempre lo espera presente.
            var msgObj = { order: {
                version: 2, request_id: 0, trade_index: null,
                id: data.orderId, action: data.action, payload: null
            }};

            try {
                var wrap = await _maWrapV2(msgObj, data.robotPubkey, Noxtr.Events.privkey);
                Noxtr.Pool.publish(wrap);
                Noxtr.Pool.publishTo('wss://relay.mostro.network', wrap);
                this._pending[data.orderId] = { action: data.action, robotPubkey: data.robotPubkey, at: Date.now() };
                this._setStatus(t(str_admin_sent_waiting, data.action, data.orderId), 'info');
                this._log(t(str_log_admin_send, data.action, data.orderId, data.robotPubkey.slice(0, 12)));
            } catch (e) {
                console.error(str_admin_console_send_error, e);
                this._setStatus(str_admin_send_error, 'error');
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
