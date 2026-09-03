<?php


    $md_file = SCRIPT_DIR_MODULE . '/'. $_ARGS[1].'.md';

    //print_r($_ARGS);
    //$md_file = SCRIPT_DIR_MODULE . '/NIP-NOSTRESCROW.md';
    //$md_file = SCRIPT_DIR_MODULE . '/MANUAL_USUARIO.md';


    $markdown = file_get_contents($md_file); 