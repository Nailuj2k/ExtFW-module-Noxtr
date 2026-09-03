<?php

    // Nostr relay hosts for CSP connect-src
    // Appended AFTER DB config load (crud/run.php) so DB values are preserved
    $cfg['options']['csp_headers']['connect_src'] .= ' wss: *';
    $cfg['options']['csp_headers']['media_src']   .= ' http: audio.nostr.build media.pubeurope.com video.nostr.build theboard.world blossom.primal.net files.catbox.moe r2a.primal.net videos.pexels.com void.cat video.twimg.com';
    $cfg['options']['csp_headers']['frame_src']   .= ' www.youtube-nocookie.com x.com vxtwitter.com platform.twitter.com ';

    define('BOT_START'  , 'DISPLAY=:0 php '.$_SERVER['DOCUMENT_ROOT'].'/index.php noxtr/server/action=monitor > /dev/null &');
    define('BOT_STATUS' , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}'");     
    define('BOT_STOP'   , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}' | xargs kill -9");

    define('BOT_HOST',CFG::$vars['server']['ssh']['host'] ?? false );
    define('BOT_USER',CFG::$vars['server']['ssh']['username'] ?? false );
    define('BOT_PASS',CFG::$vars['server']['ssh']['password'] ?? false );
    define('BOT_PORT',CFG::$vars['server']['ssh']['port'] ?? '22');

    // Bitcoin Core RPC + mempool.space fallback (clase generica en _classes_/bitcoin_rpc.class.php).
    // Reusamos las mismas vars CFG['btcpay']['rpc_*'] que ya configuro timextamping para evitar
    // duplicar credenciales. Si no estan configuradas, BitcoinRpc::isConfigured() devuelve false
    // y el verify_funding del modulo cae directamente al fallback de mempool.space.
    BitcoinRpc::init(
        CFG::$vars['btcpay']['rpc_url']      ?? '',
        CFG::$vars['btcpay']['rpc_user']     ?? '',
        CFG::$vars['btcpay']['rpc_password'] ?? '',
        30
    );
    // Permite override del base de mempool.space (ej. testnet, signet, instancia propia).
    if (!empty(CFG::$vars['btcpay']['mempool_api_url'])) {
        MempoolApi::setBase(CFG::$vars['btcpay']['mempool_api_url']);
    }
