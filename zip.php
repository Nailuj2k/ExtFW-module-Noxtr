<?php

    // This file is included in control_panel/ajax.php when creating a zip file for the module. 
    // It should contain calls to addToZip() for any additional files that need to be included in the zip file.

    addToZip($hzip,SCRIPT_DIR_MODULES.'/wallet');
    addToZip($hzip,SCRIPT_DIR_LIB.'/bitcoin');
    addToZip($hzip,SCRIPT_DIR.'/.well-known/lnurlp/.htaccess');
    addToZip($hzip,SCRIPT_DIR.'/.well-known/lnurlp/index.php');
    addToZip($hzip,SCRIPT_DIR_MEDIA.'/nostr/banners/banner-default.jpg');