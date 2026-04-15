<?php

    $version = '1.3.318';
    $monitorPubkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? NoxtrStore::getCfgValue('modules.noxtr.monitor_pubkey', '')));
    $monitorDmTtlHours = (int)(CFG::$vars['modules']['noxtr']['monitor_dm_ttl_hours'] ?? NoxtrStore::getCfgValue('modules.noxtr.monitor_dm_ttl_hours', '24'));

    // PWA: manifest específico del módulo (sobreescribe el de icons.php que viene después)
    echo '<link rel="manifest" href="/'.SCRIPT_DIR_MODULE.'/manifest.json">'."\n";

    // Mobile / PWA meta tags
    echo '<meta name="mobile-web-app-capable" content="yes">'."\n";
    echo '<meta name="apple-mobile-web-app-capable" content="yes">'."\n";
    echo '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'."\n";
    echo '<meta name="apple-mobile-web-app-title" content="Noxtr">'."\n";
    echo '<meta name="theme-color" content="#1a1a2e">'."\n";
    echo '<script>window.NOXTR_MONITOR_PUBKEY = ' . json_encode($monitorPubkey, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        . '; window.NOXTR_MONITOR_DM_TTL_HOURS = ' . json_encode($monitorDmTtlHours) . ';</script>' . "\n";
 
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
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/noble-secp256k1-1.2.14.js');
    HTML::js(SCRIPT_DIR_LIB.'/bitcoin/noble-ciphers.min.js?ver=1.2.1b');
    HTML::js(SCRIPT_DIR_LIB.'/qrcode/qrcode.min.js');           // QR generation (standalone, sin jQuery)
    HTML::js(SCRIPT_DIR_LIB.'/jsqr/jsqr.min.js');               // QR scanning engine (~127 KB)
    HTML::js(SCRIPT_DIR_LIB.'/jsqr/html5qrcode-compat.js');     // Html5Qrcode wrapper sobre jsQR

    HTML::js(SCRIPT_DIR_MODULE.'/script.js?ver='.$version);
    HTML::js(SCRIPT_DIR_MODULE.'/script.mostro.js?ver='.$version);
    HTML::js(SCRIPT_DIR_MODULE.'/script.mostro.admin.js?ver='.$version);
