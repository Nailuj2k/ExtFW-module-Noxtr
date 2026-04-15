<?php
    // Nostr relay hosts for CSP connect-src
    // Appended AFTER DB config load (crud/init.php) so DB values are preserved
    $cfg['options']['csp_headers']['connect_src'] .= ' wss: *';// relay.damus.io nos.lol relay.nostr.band relay.primal.net relay.snort.social relay.nos.social lang.relays.land/es purplepag.es';
    $cfg['options']['csp_headers']['media_src']   .= ' video.nostr.build blossom.primal.net files.catbox.moe r2a.primal.net videos.pexels.com void.cat video.twimg.com';
    $cfg['options']['csp_headers']['frame_src']   .= ' www.youtube-nocookie.com x.com vxtwitter.com platform.twitter.com ';


    define('BOT_START'  , 'DISPLAY=:0 php '.$_SERVER['DOCUMENT_ROOT'].'/index.php noxtr/server/action=monitor > /dev/null &');
    //define('BOT_START'  , 'php '.$_SERVER['DOCUMENT_ROOT'].'/index.php noxtr/server/action=monitor');
    define('BOT_STATUS' , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}'");     
    define('BOT_STOP'   , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}' | xargs kill -9");

    define('BOT_HOST',CFG::$vars['server']['ssh']['host'] ?? false );
    define('BOT_USER',CFG::$vars['server']['ssh']['username'] ?? false );     // Estos datos se quitrñan de aqui para ponerlo en la confoguración !!!
    define('BOT_PASS',CFG::$vars['server']['ssh']['password'] ?? false );  // Ahora estñan aqui solo para probar
    define('BOT_PORT',CFG::$vars['server']['ssh']['port'] ?? '22');