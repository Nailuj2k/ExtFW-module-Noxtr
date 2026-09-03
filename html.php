<?php

if (($_ARGS['op'] ?? '') === 'onchain_keys') {
    include(SCRIPT_DIR_MODULE . '/html_onchain_keys.php');
} else {

    include(SCRIPT_DIR_MODULE.'/doc/doc_'.$_SESSION['lang'].'.php');
}