<?php

/**
 * 
 * 
 * 
 * 
 * 
 *   "reparar" cuenta vinculada a nsec con claves nuevas (ejemplo para pruebas):
 * 
var nsec = 'nsec1tzwt58thca2ld0mnku4agz3axevnd9zwpd64scjdacj284uxs2eqq73hj3';
var privHex = Noxtr.nsecDecode(nsec);
var pubHex = '6100e88c0468eaa3eae8c65fae137b94ce9b15438ab76e0898d4cf5425d490a4';
var npub = 'npub1vyqw3rqydr4286hgce06uymmjn8fk92r32mkuzyc6n84gfw5jzjqpr36nv';

var req = indexedDB.open('JuxNostrKeys', 1);
req.onsuccess = function(e) {
    var db = e.target.result;
    var tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put({
        id: 'user_1',
        visitorId: 'user_1',
        privkeyHex: privHex,
        pubkeyHex: pubHex,
        nsec: nsec,
        npub: npub,
        userId: 1
    });
    tx.oncomplete = function() { 
        console.log('Claves actualizadas! Recarga la página.');
        alert('Claves actualizadas! Recarga la página.');
    };
};



1. CREAR .well-known/lnurlp/.htaccess
Rewrite para que /.well-known/lnurlp/username vaya al handler local:


RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^(.*)$ index.php [L,QSA]



location /.well-known/lnurlp/ {
    try_files $uri /.well-known/lnurlp/index.php?$query_string;
}
Eso hace lo mismo que el .htaccess: redirige /.well-known/lnurlp/username al index.php manteniendo los query params (?amount=...).




 * 
 * 
 * 
 * 
 */