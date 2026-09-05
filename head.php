<?php

    $version = '1.4.242';
    
    $monitorPubkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? NoxtrStore::getCfgValue('modules.noxtr.monitor_pubkey', '')));
    $monitorDmTtlHours = (int)(CFG::$vars['modules']['noxtr']['monitor_dm_ttl_hours'] ?? NoxtrStore::getCfgValue('modules.noxtr.monitor_dm_ttl_hours', '24'));
    // Fallback hardcoded (no depende de haber visitado /noxtr/install ni de que exista fila en CFG_CFG).
    $mostroInstancesUrl = trim((string)(CFG::$vars['modules']['noxtr']['mostro_instances_url'] ?? NoxtrStore::getCfgValue('modules.noxtr.mostro_instances_url', 'https://noxtr.net/json')));
    $mostroInstancesFallbackUrl = '/' . trim(SCRIPT_DIR_MODULE, '/') . '/json.php';

    // PWA: manifest específico del módulo (sobreescribe el de icons.php que viene después)
    echo '<link rel="manifest" href="/'.SCRIPT_DIR_MODULE.'/manifest.json?ver='.$version.'">'."\n";

    // Mobile / PWA meta tags
    echo '<meta name="mobile-web-app-capable" content="yes">'."\n";
    echo '<meta name="apple-mobile-web-app-capable" content="yes">'."\n";
    echo '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'."\n";
    echo '<meta name="apple-mobile-web-app-title" content="Noxtr">'."\n";
    echo '<meta name="theme-color" content="#1a1a2e">'."\n";
    echo '<script>window.NOXTR_MONITOR_PUBKEY = ' . json_encode($monitorPubkey, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        . '; window.NOXTR_MONITOR_DM_TTL_HOURS = ' . json_encode($monitorDmTtlHours)
        . '; window.NOXTR_MOSTRO_INSTANCES_URL = ' . json_encode($mostroInstancesUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        . '; window.NOXTR_MOSTRO_INSTANCES_FALLBACK_URL = ' . json_encode($mostroInstancesFallbackUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        . '; window.NOXTR_VERSION = ' . json_encode($version)
        . '; window.NOXTR_COINS = ' . json_encode($coins ?? [], JSON_UNESCAPED_UNICODE) . ';</script>' . "\n";
 
    HTML::css(SCRIPT_DIR_JS.'/tooltip/tooltip.css');
    HTML::css(SCRIPT_DIR_MODULE.'/style.css?ver='.$version);
    HTML::css(SCRIPT_DIR_MODULE.'/style.mostro.css?ver='.$version);

    HTML::css(SCRIPT_DIR_LIB.'/animate/animate-custom.css');
    HTML::css(SCRIPT_DIR_LIB.'/dropzone/dropzone.css');                  //HTML::css('https://unpkg.com/dropzone@6.0.0-beta.1/dist/dropzone.css');
    HTML::css(SCRIPT_DIR_LIB.'/dropzone/dropzone.custom.css');           //Override some dropzone css
    HTML::css(SCRIPT_DIR_LIB.'/cropper.js/cropper.min.css');             //HTML::css('https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.css');
    HTML::css(SCRIPT_DIR_JS.'/image_editor/image_editor.css?ver=1.1.2');

    HTML::js(SCRIPT_DIR_LIB.'/cropper.js/cropper.min.js');              //HTML::js('https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.js');
    HTML::js(SCRIPT_DIR_LIB.'/dropzone/dropzone-min.js');               //HTML::js('https://unpkg.com/dropzone@6.0.0-beta.1/dist/dropzone-min.js');
    
    //HTML::js(SCRIPT_DIR_JS.'/image_editor/image_editor.js?ver=1.1.2');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/buffer-6.0.3.js');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/bip39-3.0.4.js');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/noble-secp256k1-1.2.14.js');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/noble-ciphers.min.js?ver=1.2.1b');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/bitcoin-lib.js');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/bip32-2.0.6.js');
    HTML::js(SCRIPT_DIR_LIB.'/qrcode/qrcode.min.js');           // QR generation (standalone, sin jQuery)
    HTML::js(SCRIPT_DIR_LIB.'/jsqr/jsqr.min.js');               // QR scanning engine (~127 KB)
    HTML::js(SCRIPT_DIR_LIB.'/jsqr/html5qrcode-compat.js');     // Html5Qrcode wrapper sobre jsQR

    HTML::js(SCRIPT_DIR_JS.'/tooltip/tooltip.js');
    HTML::js(SCRIPT_DIR_LIB.'/aadsm/jsmediatags.min.js');    // ID3 tags reader (audio metadata)
    HTML::js(SCRIPT_DIR_MODULE.'/script.js?ver='.$version);
    HTML::js(SCRIPT_DIR_MODULE.'/script.mostro.js?ver='.$version);
    // Desactivado a propósito (2026-08-22): nadie lo usa hoy y quedaba incompleto frente a v2
    // (admin-take-dispute/admin-add-solver/listado 38386/chat de disputa lado admin sin migrar).
    // El archivo se deja intacto en el módulo para retomarlo — solo se quita de la carga de la
    // página. Descomentar esta línea cuando se complete y se quiera reactivar el panel.
    // HTML::js(SCRIPT_DIR_MODULE.'/script.mostro.admin.js?ver='.$version);
    HTML::js(SCRIPT_DIR_MODULE.'/script.onchain.js?ver='.$version);
    
