<style>
.okd-wrap { padding: 10px 10px; font-size: 0.93em; min-height: 677px; }
.okd-section { margin-bottom: 12px; }
.okd-label { display: block; font-weight: 600; margin-bottom: 3px; font-size: 0.88em; color: #444; }
.okd-small { display: block; font-size: 0.8em; color: #777; margin-top: 3px; }
.okd-input { width: 100%; padding: 7px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9em; }
.okd-select { width: 100%; padding: 7px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; font-size: 0.88em; background: #fafafa; }
.okd-warning { background: #fff8e1; border: 1px solid #ffe082; border-radius: 4px; padding: 8px 12px; font-size: 0.84em; color: #6d4c00; margin-bottom: 10px; }
.okd-ok { background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 4px; padding: 8px 12px; font-size: 0.84em; color: #1b5e20; margin-bottom: 10px; }
.okd-info { background: #e3f2fd; border: 1px solid #90caf9; border-radius: 4px; padding: 9px 12px; font-size: 0.84em; color: #0d3c61; margin-bottom: 12px; line-height: 1.45; }
.okd-info strong { color: #0d47a1; }
.okd-pwd-section { border-top: 1px solid #eee; padding-top: 12px; margin-top: 8px; display: none; }
.okd-entropy-area { margin: 10px 0 6px; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; display: none; }
.okd-entropy-display { width: 100%; height: 60px; font-family: monospace; font-size: 0.75em; padding: 5px 7px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; background: #1a1a1a; color: #00ff41; resize: none; overflow-y: auto; letter-spacing: 0.03em; }
.okd-entropy-bar { height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin: 8px 0 4px; }
.okd-entropy-fill { height: 100%; width: 0; background: linear-gradient(90deg, #4caf50, #8bc34a); border-radius: 4px; transition: width 0.3s; }
canvas.okd-canvas { display: none; }
.okd-btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.okd-flex { display: flex; gap: 6px; align-items: center; }
.okd-flex input, .okd-flex code { flex: 1; }
.okd-flex .btn { display: inline-flex; align-items: center; justify-content: center; padding: 6px 9px; }
.okd-flex .btn svg { display: block; }
.okd-preview { border: 1px solid #e0e0e0; border-radius: 4px; padding: 10px 12px; margin-top: 10px; background: #fafafa; display: none; }
.okd-preview-addr { font-family: monospace; font-size: 0.88em; word-break: break-all; color: #1565c0; }
.okd-msg-ok  { color: #1b5e20; font-size: 0.82em; margin-top: 4px; display: none; }
.okd-msg-err { color: #c62828; font-size: 0.82em; margin-top: 4px; display: none; }
</style>

<div class="okd-wrap">

  <div class="okd-info"><?=t('NOXTR_OKD_INFO_BANNER')?></div>

  <p style="font-size:0.86em;color:#555;margin:0 0 12px"><?=t('NOXTR_OKD_INTRO')?></p>

  <!-- Mnemónica / WIF -->
  <div class="okd-section">
    <label class="okd-label"><?=t('NOXTR_OKD_MNEMONIC_OR_WIF')?></label>
    <div class="okd-flex">
      <input type="password" id="okd-mnemonic" class="okd-input" style="font-family:monospace"
             placeholder="<?=t('NOXTR_OKD_MNEMONIC_PLACEHOLDER')?>" autocomplete="off">
      <button class="btn secondary" id="okd-btn-toggle-mn" title="<?=t('SHOW_HIDE')?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button class="btn secondary" id="okd-btn-copy-mn"   title="<?=t('COPY')?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
    </div>
    <div id="okd-msg-ok"  class="okd-msg-ok"><?=t('NOXTR_OKD_VALID_MNEMONIC')?></div>
    <div id="okd-msg-err" class="okd-msg-err"></div>
  </div>

  <!-- Passphrase -->
  <div class="okd-section">
    <label class="okd-label"><?=t('NOXTR_OKD_PASSPHRASE_LABEL')?></label>
    <div class="okd-flex">
      <input type="password" id="okd-passphrase" class="okd-input"
             placeholder="<?=t('NOXTR_OKD_PASSPHRASE_PLACEHOLDER')?>" autocomplete="new-password">
      <button class="btn secondary" id="okd-btn-toggle-pp" title="<?=t('SHOW_HIDE')?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </div>
    <span class="okd-small"><?=t('NOXTR_OKD_PASSPHRASE_HELP')?></span>
  </div>

  <!-- Ruta de derivación -->
  <div class="okd-section">
    <label class="okd-label"><?=t('NOXTR_OKD_DERIVATION_PATH')?></label>
    <select id="okd-derivpath" class="okd-select">
      <option value="m/86'/0'/0'/0/0" selected>m/86'/0'/0'/0/0 — Taproot BIP86 (NostrEscrow)</option>
    </select>
    <span class="okd-small"><?=t('NOXTR_OKD_DERIVATION_HELP')?></span>
  </div>

  <!-- Botón generar / cargar -->
  <div class="okd-btn-row">
    <button class="btn secondary" id="okd-btn-generate"><?=t('NOXTR_OKD_GENERATE_MNEMONIC')?></button>
    <button class="btn secondary" id="okd-btn-load"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><?=t('NOXTR_OKD_LOAD_FILE')?></button>
    <input type="file" id="okd-file-input" accept=".json,application/json" style="display:none">
  </div>

  <!-- Canvas (se mueve a body en _setupCanvas) -->
  <canvas id="okd-canvas" class="okd-canvas"></canvas>

  <!-- Área entropía -->
  <div id="okd-entropy-area" class="okd-entropy-area">
    <div style="font-size:0.85em;color:#555;margin-bottom:6px;" id="okd-entropy-inst"><?=t('NOXTR_OKD_MOVE_MOUSE')?></div>
    <div class="okd-section" style="margin-bottom:6px">
      <label class="okd-label" style="font-size:0.8em;"><?=t('NOXTR_OKD_ENTROPY_STREAM')?></label>
      <textarea id="okd-entropy-display" class="okd-entropy-display" readonly placeholder="<?=t('NOXTR_OKD_ENTROPY_PLACEHOLDER')?>"></textarea>
    </div>
    <div class="okd-entropy-bar"><div class="okd-entropy-fill" id="okd-entropy-fill"></div></div>
    <div style="font-size:0.8em;color:#666;margin-top:2px"><?=t('NOXTR_OKD_ENTROPY_COLLECTED')?> <strong id="okd-entropy-pct">0%</strong></div>
  </div>

  <!-- Descarga obligatoria si se generó aquí -->
  <div id="okd-download-area" style="display:none;margin-top:12px">
    <div class="okd-warning"><?=t('NOXTR_OKD_SAVE_WORDS_WARNING')?></div>
    <div class="okd-btn-row">
      <button class="btn" id="okd-btn-download"><?=t('NOXTR_OKD_SAVE_FILE_REQUIRED')?></button>
    </div>
    <div id="okd-downloaded-ok" class="okd-ok" style="display:none"><?=t('NOXTR_OKD_FILE_SAVED')?></div>
  </div>

  <!-- Vista previa de dirección y WIF -->
  <div id="okd-preview" class="okd-preview">
    <div style="font-size:0.82em;font-weight:600;color:#555;margin-bottom:8px"><?=t('NOXTR_OKD_PREVIEW_TITLE')?></div>
    <div class="okd-section" style="margin-bottom:8px">
      <label class="okd-label"><?=t('PUBLIC_ADDRESS')?></label>
      <div class="okd-preview-addr" id="okd-preview-addr">—</div>
    </div>
    <div class="okd-section" style="margin-bottom:0">
      <label class="okd-label"><?=t('PRIVATE_WIF_KEY')?></label>
      <div class="okd-flex">
        <input type="password" id="okd-preview-wif" class="okd-input" readonly style="font-family:monospace;font-size:0.85em">
        <button class="btn secondary" id="okd-btn-toggle-wif" title="<?=t('SHOW_HIDE')?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </div>
    </div>
  </div>

  <!-- Botones — wquery los mueve al footer -->
  <div class="dialog-buttons">
    <button class="btn btn-reset" id="okd-btn-cancel"><?=t('CANCEL')?></button>
    <button class="btn disabled"  id="okd-btn-confirm"><?=t('CONFIRM')?></button>
  </div>

</div>

<script>
(function() {
    var okd_str_bitcoin_lib_missing      = '<?=t('NOXTR_OKD_BITCOIN_LIB_MISSING')?>';
    var okd_str_invalid_wif              = '<?=t('NOXTR_OKD_INVALID_WIF')?>';
    var okd_str_missing                  = '<?=t('MISSING')?>';
    var okd_str_bip32_missing            = '<?=t('NOXTR_OKD_BIP32_MISSING')?>';
    var okd_str_bitcoin_missing          = '<?=t('NOXTR_OKD_BITCOIN_MISSING')?>';
    var okd_str_native_segwit            = '<?=t('NOXTR_OKD_NATIVE_SEGWIT')?>';
    var okd_str_nested_segwit            = '<?=t('NOXTR_OKD_NESTED_SEGWIT')?>';
    var okd_str_unknown_path             = '<?=t('NOXTR_OKD_UNKNOWN_PATH')?>';
    var okd_str_error                    = '<?=t('ERROR')?>';
    var okd_str_entropy_completed        = '<?=t('NOXTR_OKD_ENTROPY_COMPLETED')?>';
    var okd_str_move_mouse               = '<?=t('NOXTR_OKD_MOVE_MOUSE')?>';
    var okd_str_bip39_not_loaded         = '<?=t('NOXTR_OKD_BIP39_NOT_LOADED')?>';
    var okd_str_generate_again           = '<?=t('NOXTR_OKD_GENERATE_AGAIN')?>';
    var okd_str_generating_error         = '<?=t('NOXTR_OKD_GENERATING_ERROR')?>';
    var okd_str_valid_wif                = '<?=t('NOXTR_OKD_VALID_WIF')?>';
    var okd_str_valid_mnemonic           = '<?=t('NOXTR_OKD_VALID_MNEMONIC')?>';
    var okd_str_invalid_mnemonic         = '<?=t('NOXTR_OKD_INVALID_MNEMONIC')?>';
    var okd_str_replace_wif_confirm      = '<?=t('NOXTR_OKD_REPLACE_WIF_CONFIRM')?>';
    var okd_str_replace_mnemonic_confirm = '<?=t('NOXTR_OKD_REPLACE_MNEMONIC_CONFIRM')?>';
    var okd_str_backup_type              = '<?=t('NOXTR_OKD_BACKUP_TYPE')?>';
    var okd_str_backup_warning           = '<?=t('NOXTR_OKD_BACKUP_WARNING')?>';
    var okd_str_enter_key_first          = '<?=t('NOXTR_OKD_ENTER_KEY_FIRST')?>';
    var okd_str_save_file_first          = '<?=t('NOXTR_OKD_SAVE_FILE_FIRST')?>';
    var okd_str_onchain_unavailable      = '<?=t('NOXTR_OKD_ONCHAIN_UNAVAILABLE')?>';
    var okd_str_saving                   = '<?=t('SAVING')?>';
    var okd_str_save_error               = '<?=t('SAVE_ERROR')?>';
    var okd_str_confirm                  = '<?=t('CONFIRM')?>';
    var okd_str_load_no_key              = '<?=t('NOXTR_OKD_LOAD_NO_KEY')?>';
    var okd_str_load_error               = '<?=t('NOXTR_OKD_LOAD_ERROR')?>';

    // Iconos SVG para el botón copiar (estado normal / "copiado").
    var _svgCopy  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    var _svgCheck = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    var _mnemonic           = null;
    var _keyType            = 'mnemonic';  // 'mnemonic' | 'wif'
    var _isGenerated        = false;
    var _actuallyDownloaded = false;
    var _collecting         = false;
    var _autoGenDone        = false;

    var mnemonicEl      = document.getElementById('okd-mnemonic');
    var passphraseEl    = document.getElementById('okd-passphrase');
    var derivPathEl     = document.getElementById('okd-derivpath');
    var msgOk           = document.getElementById('okd-msg-ok');
    var msgErr          = document.getElementById('okd-msg-err');
    var btnToggleMn     = document.getElementById('okd-btn-toggle-mn');
    var btnCopyMn       = document.getElementById('okd-btn-copy-mn');
    var btnTogglePp     = document.getElementById('okd-btn-toggle-pp');
    var btnGenerate     = document.getElementById('okd-btn-generate');
    var btnLoad         = document.getElementById('okd-btn-load');
    var fileInput       = document.getElementById('okd-file-input');
    var entropyArea     = document.getElementById('okd-entropy-area');
    var entropyFill     = document.getElementById('okd-entropy-fill');
    var entropyPct      = document.getElementById('okd-entropy-pct');
    var entropyInst     = document.getElementById('okd-entropy-inst');
    var entropyDisplay  = document.getElementById('okd-entropy-display');
    var canvas          = document.getElementById('okd-canvas');
    var ctx             = canvas ? canvas.getContext('2d') : null;
    var downloadArea    = document.getElementById('okd-download-area');
    var btnDownload     = document.getElementById('okd-btn-download');
    var downloadedOk    = document.getElementById('okd-downloaded-ok');
    var previewEl       = document.getElementById('okd-preview');
    var previewAddr     = document.getElementById('okd-preview-addr');
    var previewWif      = document.getElementById('okd-preview-wif');
    var btnToggleWif    = document.getElementById('okd-btn-toggle-wif');
    var btnConfirm      = document.getElementById('okd-btn-confirm');
    var btnCancel       = document.getElementById('okd-btn-cancel');

    var sectionPassphrase = passphraseEl ? passphraseEl.closest('.okd-section') : null;
    var sectionDerivPath  = derivPathEl  ? derivPathEl.closest('.okd-section')  : null;
    var previewWifSection = previewWif   ? previewWif.closest('.okd-section')   : null;

    // ---- bech32 / bech32m ----
    var _B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    var _B32M = 0x2bc830a3;
    function _b32poly(v) {
        var g = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3], c = 1;
        for (var i=0;i<v.length;i++) { var b=c>>25; c=((c&0x1ffffff)<<5)^v[i]; for(var j=0;j<5;j++) if((b>>j)&1) c^=g[j]; }
        return c;
    }
    function _b32hrpEx(hrp) {
        var r=[]; for(var i=0;i<hrp.length;i++) r.push(hrp.charCodeAt(i)>>5);
        r.push(0); for(var i=0;i<hrp.length;i++) r.push(hrp.charCodeAt(i)&31);
        return r;
    }
    function _b32enc(hrp, data, c) {
        var vals=_b32hrpEx(hrp).concat(data);
        var pm=_b32poly(vals.concat([0,0,0,0,0,0]))^c, ck=[];
        for(var i=0;i<6;i++) ck.push((pm>>(5*(5-i)))&31);
        var s=hrp+'1'; data.concat(ck).forEach(function(v){s+=_B32[v];}); return s;
    }
    function _cvBits(data,f,t,pad) {
        var acc=0,bits=0,r=[],maxv=(1<<t)-1;
        for(var i=0;i<data.length;i++){acc=(acc<<f)|data[i];bits+=f;while(bits>=t){bits-=t;r.push((acc>>bits)&maxv);}}
        if(pad&&bits>0) r.push((acc<<(t-bits))&maxv);
        return r;
    }
    function _bech32(hrp, ver, bytes) {
        var words=[ver].concat(_cvBits(Array.from(bytes),8,5,true));
        return _b32enc(hrp, words, ver===0 ? 1 : _B32M);
    }

    // ---- SHA256 tagged hash (para P2TR) ----
    async function _tagHash(tag, data) {
        var enc = new TextEncoder();
        var tagBytes = enc.encode(tag);
        var tagHash = new Uint8Array(await crypto.subtle.digest('SHA-256', tagBytes));
        var buf = new Uint8Array(tagHash.length*2 + data.length);
        buf.set(tagHash, 0); buf.set(tagHash, tagHash.length); buf.set(data, tagHash.length*2);
        return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    }

    // ---- P2TR address from x-only pubkey ----
    async function _p2trAddr(xOnly) {
        var tweak = await _tagHash('TapTweak', xOnly);
        var hexX = Array.from(xOnly).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
        var Pt = window.nobleSecp256k1.Point;
        var internal = Pt.fromHex('02' + hexX);
        var tweakBig = BigInt('0x' + Array.from(tweak).map(function(b){return b.toString(16).padStart(2,'0');}).join(''));
        var tweaked = internal.add(Pt.BASE.multiply(tweakBig));
        var tweakedHex = tweaked.toHex(); // compressed hex, 66 chars
        var tweakedX = new Uint8Array(tweakedHex.slice(2).match(/.{2}/g).map(function(h){return parseInt(h,16);}));
        return _bech32('bc', 1, tweakedX);
    }

    // ---- WIF detection ----
    function _isWIF(s) {
        return typeof s === 'string' && /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s);
    }

    // ---- Preview desde WIF raíz: NostrEscrow deriva una clave distinta por índice ----
    async function _previewFromWIF(wif) {
        _detectLibs();
        if (!_BTClib) return '<em style="color:#888">' + okd_str_bitcoin_lib_missing + '</em>';
        try {
            var root = _BTClib.ECPair.fromWIF(wif).privateKey;
            var hk = await crypto.subtle.importKey('raw', root, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
            var digest = new Uint8Array(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode('nostrescrow:wif:v1:0')));
            var n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
            var h = Array.from(digest).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
            var scalar = ((BigInt('0x' + h) % (n - 1n)) + 1n).toString(16).padStart(64, '0');
            var child = _BTClib.ECPair.fromPrivateKey(new Uint8Array(scalar.match(/.{2}/g).map(function(x){return parseInt(x,16);}))); 
            var address = await _p2trAddr(child.publicKey.slice(1));
            return '<div style="margin-bottom:5px"><span style="font-size:0.78em;color:#888;display:block">NostrEscrow arbitro (indice 0)</span>' +
                '<span style="font-family:monospace;font-size:0.83em;word-break:break-all">' + address + '</span></div>';
        } catch(e) {
            return '<em style="color:#c62828">' + t(okd_str_invalid_wif, e.message) + '</em>';
        }
    }

    // ---- Derive keys preview ----
    var _BIP32lib = null;
    var _BTClib   = null;
    function _detectLibs() {
        _BIP32lib = window.BIP32 || window.bip32 || null;
        _BTClib   = window.bitcoin || window.Bitcoin || window.bitcoinjs || null;
        if (!_BIP32lib || !_BTClib) {
            var keys = Object.keys(window).filter(function(k){ return k.indexOf('ip') !== -1 || k.indexOf('tc') !== -1; });
            console.log('[okd] globals con ip/tc:', keys);
            console.log('[okd] BIP32:', typeof window.BIP32, 'bip32:', typeof window.bip32, 'bitcoin:', typeof window.bitcoin, 'Bitcoin:', typeof window.Bitcoin);
        }
    }
    _detectLibs();

    async function _derivePreview(mnemonic, passphrase, path) {
        _detectLibs();
        if (!window.bip39 || !_BIP32lib || !_BTClib) {
            var missing = [];
            if (!window.bip39) missing.push('bip39');
            if (!_BIP32lib)    missing.push(okd_str_bip32_missing);
            if (!_BTClib)      missing.push(okd_str_bitcoin_missing);
            return { address: '(' + okd_str_missing + ': ' + missing.join(', ') + ')', wif: '' };
        }
        try {
            var seed = await window.bip39.mnemonicToSeed(mnemonic, passphrase || '');
            var root = _BIP32lib.fromSeed(seed);
            var child = root.derivePath(path);
            var keyPair = _BTClib.ECPair.fromPrivateKey(child.privateKey);
            var wif = keyPair.toWIF();
            var pubkey = keyPair.publicKey;
            var address;
            if (path.indexOf("m/44'") === 0) {
                address = _BTClib.payments.p2pkh({ pubkey: pubkey }).address;
            } else if (path.indexOf("m/84'") === 0) {
                address = _BTClib.payments.p2wpkh({ pubkey: pubkey }).address;
            } else if (path.indexOf("m/49'") === 0) {
                var inner = _BTClib.payments.p2wpkh({ pubkey: pubkey });
                address = _BTClib.payments.p2sh({ redeem: inner }).address;
            } else if (path.indexOf("m/86'") === 0) {
                address = await _p2trAddr(pubkey.slice(1)); // drop 02/03 prefix
            } else {
                address = okd_str_unknown_path;
            }
            return { address: address, wif: wif };
        } catch(e) {
            return { address: '(' + okd_str_error + ': ' + e.message + ')', wif: '' };
        }
    }

    var _previewTimer = null;
    function _schedulePreview() {
        if (!_mnemonic) return;
        clearTimeout(_previewTimer);
        _previewTimer = setTimeout(async function() {
            if (_keyType === 'wif') {
                var addrs = await _previewFromWIF(_mnemonic);
                if (previewAddr) previewAddr.innerHTML = addrs;
                // Ocultar sección WIF del preview (redundante: ya está en el input principal)
                if (previewWifSection) previewWifSection.style.display = 'none';
            } else {
                var result = await _derivePreview(_mnemonic, passphraseEl ? passphraseEl.value : '', derivPathEl ? derivPathEl.value : "m/86'/0'/0'/0/0");
                if (previewAddr) previewAddr.textContent = result.address || '—';
                if (previewWif)        previewWif.value = result.wif || '';
                if (previewWifSection) previewWifSection.style.display = '';
            }
            if (previewEl) previewEl.style.display = 'block';
        }, 300);
    }

    // ---- Canvas ----
    function _setupCanvas() {
        if (canvas.parentNode !== document.body) document.body.appendChild(canvas);
        canvas.style.position     = 'fixed';
        canvas.style.top          = '0'; canvas.style.left = '0';
        canvas.style.zIndex       = '9999';
        canvas.style.pointerEvents = 'none';
        canvas.width              = window.innerWidth;
        canvas.height             = window.innerHeight;
        canvas.style.width        = window.innerWidth  + 'px';
        canvas.style.height       = window.innerHeight + 'px';
        canvas.style.display      = 'block';
    }
    function _clearCanvas() {
        if (!canvas) return;
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        var wrap = document.querySelector('.okd-wrap');
        if (wrap && canvas.parentNode === document.body) wrap.appendChild(canvas);
    }

    // ---- Entropía ----
    var userEntropy      = [];
    var entropyCollected = 0;
    var ENTROPY_TARGET   = 1024;
    var mouseHandler     = null;

    function _appendEntropy(bytes) {
        if (!entropyDisplay) return;
        entropyDisplay.value += bytes.map(function(b){return b.toString(16).padStart(2,'0');}).join('');
        entropyDisplay.scrollTop = entropyDisplay.scrollHeight;
    }

    function _updateEntropy() {
        var pct = Math.min(100, Math.round(entropyCollected / ENTROPY_TARGET * 100));
        if (entropyFill) entropyFill.style.width = pct + '%';
        if (entropyPct)  entropyPct.textContent   = pct + '%';
        if (entropyCollected >= ENTROPY_TARGET && !_autoGenDone) {
            _autoGenDone = true;
            if (entropyInst) entropyInst.textContent = okd_str_entropy_completed;
            setTimeout(_doGenerate, 400);
        }
    }

    function _stopCollecting() {
        _collecting = false;
        if (mouseHandler) { document.removeEventListener('mousemove', mouseHandler); mouseHandler = null; }
        _clearCanvas();
        if (entropyArea) entropyArea.style.display = 'none';
    }

    function _startCollecting() {
        _collecting      = true;
        _autoGenDone     = false;
        userEntropy      = [];
        entropyCollected = 0;
        if (entropyDisplay) entropyDisplay.value = '';
        if (entropyInst)  entropyInst.textContent = okd_str_move_mouse;
        _updateEntropy();
        _setupCanvas();
        if (entropyArea) entropyArea.style.display = 'block';

        var lastX = 0, lastY = 0, lastT = Date.now();
        mouseHandler = function(e) {
            if (!_collecting || entropyCollected >= ENTROPY_TARGET) return;
            var now = Date.now();
            var x = e.clientX, y = e.clientY;
            if (Math.abs(x - lastX) > 2 || Math.abs(y - lastY) > 2) {
                var dt = now - lastT;
                userEntropy.push(x, y, dt, e.movementX || 0, e.movementY || 0);
                entropyCollected = Math.min(entropyCollected + 2, ENTROPY_TARGET);
                _updateEntropy();
                _appendEntropy([x & 0xFF, (x>>8)&0xFF, y & 0xFF, (y>>8)&0xFF, dt & 0xFF]);
                if (ctx) {
                    var hue = (entropyCollected * 360 / ENTROPY_TARGET) % 360;
                    ctx.fillStyle = 'hsl(' + hue + ',70%,50%)';
                    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
                }
                lastX = x; lastY = y; lastT = now;
            }
        };
        document.addEventListener('mousemove', mouseHandler);

        canvas.addEventListener('touchmove', function(e) {
            if (!_collecting || entropyCollected >= ENTROPY_TARGET) return;
            var t = e.touches[0];
            userEntropy.push(Math.floor(t.clientX), Math.floor(t.clientY), Date.now());
            entropyCollected = Math.min(entropyCollected + 1, ENTROPY_TARGET);
            _updateEntropy();
            _appendEntropy([Math.floor(t.clientX)&0xFF, Math.floor(t.clientY)&0xFF]);
            if (ctx) {
                var hue = (entropyCollected * 360 / ENTROPY_TARGET) % 360;
                ctx.fillStyle = 'hsl(' + hue + ',70%,50%)';
                ctx.beginPath(); ctx.arc(t.clientX, t.clientY, 3, 0, Math.PI*2); ctx.fill();
            }
            e.preventDefault();
        }, { passive: false });

        if (window.DeviceMotionEvent) {
            var devH = function(e) {
                if (!_collecting || entropyCollected >= ENTROPY_TARGET) return;
                var a = e.accelerationIncludingGravity || {};
                userEntropy.push(Math.floor((a.x||0)*1000), Math.floor((a.y||0)*1000), Math.floor((a.z||0)*1000), Date.now());
                entropyCollected = Math.min(entropyCollected + 1, ENTROPY_TARGET);
                _updateEntropy();
            };
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                canvas.addEventListener('touchstart', function() {
                    DeviceMotionEvent.requestPermission().then(function(r) {
                        if (r === 'granted') window.addEventListener('devicemotion', devH);
                    }).catch(function(){});
                }, { once: true });
            } else {
                window.addEventListener('devicemotion', devH);
            }
        }
    }

    function _mixEntropy() {
        var random = new Uint8Array(16);
        crypto.getRandomValues(random);
        var mixed = new Uint8Array(16);
        for (var j = 0; j < 16; j++) {
            mixed[j] = random[j] ^ ((userEntropy[j % Math.max(userEntropy.length, 1)] || 0) & 0xFF);
        }
        return mixed;
    }

    function _doGenerate() {
        if (!window.bip39) { alert(okd_str_bip39_not_loaded); _stopCollecting(); return; }
        _stopCollecting();
        try {
            var mixed    = userEntropy.length ? _mixEntropy() : null;
            var mnemonic = mixed ? window.bip39.entropyToMnemonic(mixed) : window.bip39.generateMnemonic();
            _setMnemonic(mnemonic, true, 'mnemonic');
            btnGenerate.textContent = okd_str_generate_again;
        } catch(e) {
            alert(t(okd_str_generating_error, e.message));
        }
    }

    function _setMnemonic(words, generated, keyType) {
        _mnemonic           = words;
        _keyType            = keyType || 'mnemonic';
        _isGenerated        = !!generated;
        _actuallyDownloaded = false;
        mnemonicEl.value    = words;
        mnemonicEl.type     = 'password';
        msgOk.textContent    = _keyType === 'wif' ? okd_str_valid_wif : okd_str_valid_mnemonic;
        msgOk.style.display  = 'block';
        msgErr.style.display = 'none';
        // En modo WIF: ocultar passphrase y ruta de derivación (no aplican)
        var isWIFMode = _keyType === 'wif';
        if (sectionPassphrase) sectionPassphrase.style.display = isWIFMode ? 'none' : '';
        if (sectionDerivPath)  sectionDerivPath.style.display  = isWIFMode ? 'none' : '';
        if (_isGenerated) {
            downloadArea.style.display  = 'block';
            downloadedOk.style.display  = 'none';
        } else {
            downloadArea.style.display  = 'none';
        }
        _schedulePreview();
        _updateConfirm();
    }

    // ---- Validación manual ----
    if (mnemonicEl) {
        mnemonicEl.addEventListener('input', function() {
            var raw = (mnemonicEl.value || '').trim();
            msgOk.style.display = 'none'; msgErr.style.display = 'none';
            downloadArea.style.display = 'none';
            previewEl.style.display = 'none';
            _mnemonic = null;
            // Restaurar secciones por si venían ocultas de un WIF previo
            if (sectionPassphrase) sectionPassphrase.style.display = '';
            if (sectionDerivPath)  sectionDerivPath.style.display  = '';
            if (_isWIF(raw)) {
                _setMnemonic(raw, false, 'wif');
                return;
            }
            var words = raw.toLowerCase().replace(/\s+/g, ' ');
            var arr = words.split(' ');
            if (arr.length !== 12 && arr.length !== 24) { _updateConfirm(); return; }
            if (window.bip39 && !window.bip39.validateMnemonic(words)) {
                msgErr.textContent   = okd_str_invalid_mnemonic;
                msgErr.style.display = 'block';
                _updateConfirm(); return;
            }
            _setMnemonic(words, false, 'mnemonic');
        });
    }

    // ---- Botón generar ----
    if (btnGenerate) {
        btnGenerate.addEventListener('click', async function() {
            var confirmMsg = _keyType === 'wif'
                ? okd_str_replace_wif_confirm
                : okd_str_replace_mnemonic_confirm;
            if (_mnemonic && !await confirm(confirmMsg)) return;
            _mnemonic = null;
            _startCollecting();
        });
    }

    // ---- Toggles ----
    if (btnToggleMn) btnToggleMn.addEventListener('click', function() { mnemonicEl.type = mnemonicEl.type === 'password' ? 'text' : 'password'; });
    if (btnTogglePp) btnTogglePp.addEventListener('click', function() { passphraseEl.type = passphraseEl.type === 'password' ? 'text' : 'password'; });
    if (btnToggleWif) btnToggleWif.addEventListener('click', function() { previewWif.type = previewWif.type === 'password' ? 'text' : 'password'; });
    if (btnCopyMn) btnCopyMn.addEventListener('click', function() {
        if (!mnemonicEl.value) return;
        navigator.clipboard.writeText(mnemonicEl.value).then(function() {
            btnCopyMn.innerHTML = _svgCheck;
            setTimeout(function() { btnCopyMn.innerHTML = _svgCopy; }, 1500);
        });
    });

    // ---- Cargar .json con claves guardadas (mismo formato que el botón Guardar) ----
    if (btnLoad && fileInput) {
        btnLoad.addEventListener('click', function() { fileInput.value = ''; fileInput.click(); });
        fileInput.addEventListener('change', function() {
            var f = fileInput.files && fileInput.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function() {
                msgOk.style.display = 'none'; msgErr.style.display = 'none';
                try {
                    var data = JSON.parse(reader.result);
                    var key = String(data.mnemonica || data.mnemonic || data.wif || data.clave || '').trim();
                    if (!key) { msgErr.textContent = okd_str_load_no_key; msgErr.style.display = 'block'; return; }
                    // Restaurar la ruta de derivación guardada, si aplica.
                    if (data.derivacion && derivPathEl) {
                        for (var i = 0; i < derivPathEl.options.length; i++) {
                            if (derivPathEl.options[i].value === data.derivacion) { derivPathEl.value = data.derivacion; break; }
                        }
                    }
                    if (passphraseEl && typeof data.passphrase === 'string') passphraseEl.value = data.passphrase;
                    // Reutiliza la validación del input manual (detecta WIF/mnemónica,
                    // marca generated=false → no exige volver a guardar el archivo).
                    mnemonicEl.value = key;
                    mnemonicEl.dispatchEvent(new Event('input', { bubbles: true }));
                } catch(e) {
                    msgErr.textContent = t(okd_str_load_error, e.message); msgErr.style.display = 'block';
                }
            };
            reader.readAsText(f);
        });
    }

    // ---- Passphrase/path cambia → actualizar preview ----
    if (passphraseEl) passphraseEl.addEventListener('input', function() { if (_mnemonic) _schedulePreview(); });
    if (derivPathEl)  derivPathEl.addEventListener('change', function() { if (_mnemonic) _schedulePreview(); });

    // ---- Descargar ----
    if (btnDownload) {
        btnDownload.addEventListener('click', function() {
            if (!_mnemonic) return;
            var path = derivPathEl ? derivPathEl.value : "m/86'/0'/0'/0/0";
            var data = {
                tipo:       okd_str_backup_type,
                mnemonica:  _mnemonic,
                derivacion: path,
                passphrase: passphraseEl ? passphraseEl.value : '',
                fecha:      new Date().toISOString(),
                aviso:      okd_str_backup_warning
            };
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href     = url;
            a.download = 'nostr-escrow-mnemonica-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            _actuallyDownloaded        = true;
            downloadedOk.style.display = 'block';
            _updateConfirm();
        });
    }

    function _updateConfirm() {
        var ready = !!_mnemonic && (!_isGenerated || _actuallyDownloaded);
        if (btnConfirm) {
            if (ready) btnConfirm.classList.remove('disabled');
            else       btnConfirm.classList.add('disabled');
        }
    }

    // ---- Cerrar ----
    function _overlay() { var el = btnConfirm; while (el && !el.classList.contains('wq-dialog-overlay')) el = el.parentNode; return el; }
    function _closeDialog() { _stopCollecting(); var ov = _overlay(); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }

    if (btnCancel)  btnCancel.addEventListener('click',  function() { _closeDialog(); });

    if (btnConfirm) {
        btnConfirm.addEventListener('click', async function() {
            if (btnConfirm.classList.contains('disabled')) return;
            if (!_mnemonic)                           { alert(okd_str_enter_key_first); return; }
            if (_isGenerated && !_actuallyDownloaded) { alert(okd_str_save_file_first); return; }
            if (typeof window.Onchain === 'undefined' || !window.Onchain.Keys) { alert(okd_str_onchain_unavailable); return; }
            btnConfirm.disabled    = true;
            btnConfirm.textContent = okd_str_saving;
            try {
                await window.Onchain.Keys.setup(_mnemonic, {
                    passphrase: passphraseEl ? passphraseEl.value : ''
                });
                _closeDialog();
                if (typeof window._noxtrOnchainKeysDone === 'function') {
                    window._noxtrOnchainKeysDone();
                    window._noxtrOnchainKeysDone = null;
                }
            } catch(e) {
                alert(t(okd_str_save_error, e.message));
                btnConfirm.disabled    = false;
                btnConfirm.textContent = okd_str_confirm;
            }
        });
    }
})();
</script>
