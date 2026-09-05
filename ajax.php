<?php

    require_once SCRIPT_DIR_CLASSES . '/btcpay_lightning.class.php';

    // `code` legible por máquina: el cliente necesita distinguir "sesión caída" de un fallo
    // cualquiera. Sin él, el JS trataba esto como un error genérico y avisaba de "servidor
    // ocupado, reintentando" — mandando al usuario a esperar por algo que solo se arregla
    // volviendo a entrar. `msg` se mantiene por compatibilidad.
    if (!isset($_SESSION['valid_user']) || !$_SESSION['valid_user']) {
        echo json_encode(['error' => 1, 'code' => 'not_logged_in', 'msg' => 'Not logged in']);
        exit;
    }
    // Sesión marcada como válida pero sin userid utilizable: todos los handlers keyean por
    // user_id, así que devolverían vacío en silencio. Mismo tratamiento que no estar logueado.
    if ((int)($_SESSION['userid'] ?? 0) <= 0) {
        echo json_encode(['error' => 1, 'code' => 'not_logged_in', 'msg' => 'No user id in session']);
        exit;
    }

    /**
     * NIP-13 Proof of Work miner para eventos Nostr sin firmar.
     * Itera el segundo elemento del tag ["nonce","<n>","<difficulty>"] hasta que el
     * sha256 del evento serializado tenga al menos $difficulty bits cero líderes.
     *
     * Uso: $r = noxtr_pow_mine($event, 16);
     * Devuelve ['event' => evento_con_nonce, 'id' => '<64 hex>', 'iterations' => N].
     * Lanza Exception si excede 5M iteraciones (cap de seguridad).
     */
    function noxtr_pow_mine(array $event, int $difficulty): array {
        // Localizar tag nonce existente o añadirlo
        $nonceIdx = null;
        $tags = $event['tags'] ?? [];
        foreach ($tags as $i => $t) {
            if (is_array($t) && ($t[0] ?? null) === 'nonce') { $nonceIdx = $i; break; }
        }
        if ($nonceIdx === null) {
            $tags[] = ['nonce', '0', (string)$difficulty];
            $nonceIdx = count($tags) - 1;
        } else {
            $tags[$nonceIdx][2] = (string)$difficulty;
        }
        $event['tags'] = $tags;

        $maxIter = 5000000;
        for ($n = 0; $n < $maxIter; $n++) {
            $event['tags'][$nonceIdx][1] = (string)$n;
            $serialized = json_encode(
                [0, $event['pubkey'], (int)$event['created_at'], (int)$event['kind'], $event['tags'], (string)($event['content'] ?? '')],
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            );
            $id = hash('sha256', $serialized);
            if (noxtr_pow_leading_zero_bits($id) >= $difficulty) {
                return ['event' => $event, 'id' => $id, 'iterations' => $n + 1];
            }
        }
        throw new Exception('PoW mining exceeded ' . $maxIter . ' iterations');
    }

    function noxtr_pow_leading_zero_bits(string $hex): int {
        $count = 0;
        $len = strlen($hex);
        for ($i = 0; $i < $len; $i++) {
            $nibble = hexdec($hex[$i]);
            if ($nibble === 0) { $count += 4; continue; }
            for ($bit = 3; $bit >= 0; $bit--) {
                if (($nibble >> $bit) & 1) return $count;
                $count++;
            }
            return $count;
        }
        return $count;
    }

    /**
     * Valida que una URL sea segura para petición saliente (anti-SSRF).
     * Resuelve el hostname y rechaza destinos internos. Devuelve true si es
     * seguro llamar a esa URL. NO sigue la URL — solo la valida.
     *
     * @param string $url URL a validar
     * @param bool   $requireHttps Si true, exige esquema https (default: permite http/https)
     * @return bool
     */
    function noxtr_url_is_safe(string $url, bool $requireHttps = false): bool {
        $parts = parse_url($url);
        if ($parts === false || empty($parts['host'])) return false;

        $scheme = strtolower($parts['scheme'] ?? '');
        if ($requireHttps) {
            if ($scheme !== 'https') return false;
        } else {
            if (!in_array($scheme, ['http', 'https'], true)) return false;
        }

        $host = $parts['host'];

        // Rechazar credenciales embebidas (user:pass@host) y puertos raros.
        if (isset($parts['user']) || isset($parts['pass'])) return false;
        if (isset($parts['port']) && !in_array((int)$parts['port'], [80, 443], true)) return false;

        // Resolver TODAS las IPs del host (A y AAAA). Si no resuelve, rechazar.
        $ips = [];
        $recA = @dns_get_record($host, DNS_A);
        foreach ($recA ?: [] as $r) { if (!empty($r['ip'])) $ips[] = $r['ip']; }
        $recAAAA = @dns_get_record($host, DNS_AAAA);
        foreach ($recAAAA ?: [] as $r) { if (!empty($r['ipv6'])) $ips[] = $r['ipv6']; }
        // Fallback si dns_get_record falla para el tipo (algunos DNS): gethostbynamel
        if (!$ips) {
            $byName = @gethostbynamel($host);
            if ($byName) $ips = $byName;
        }
        if (!$ips) return false; // no resuelve → no arriesgar

        foreach ($ips as $ip) {
            if (!noxtr_ip_is_public($ip)) return false;
        }
        return true;
    }

    /**
     * True solo si $addr es una Lightning Address con forma válida Y cuyo endpoint LNURL-pay
     * apunta a un host público. Mismo criterio anti-SSRF que ya aplica `get_ln_invoice`
     * (auditoría 2026-08-17, H-02): el host lo controla el usuario, así que se valida antes
     * de usarlo — tanto si se va a pedir por HTTP como si solo se va a guardar en el metadata
     * de una invoice BTCPay, porque de ahí lo lee después quien paga.
     *
     * El regex acota la local-part a los caracteres que admite una local-part de LNURL-pay
     * (van dentro de una ruta) y exige un dominio con TLD; sin él, cosas como `a@localhost`
     * o `a@[::1]` ni siquiera llegaban a noxtr_url_is_safe con una URL bien formada.
     */
    function noxtr_ln_address_is_safe(string $addr): bool {
        if (!preg_match('/^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}$/', $addr)) {
            return false;
        }
        [$lnUser, $lnDomain] = explode('@', $addr, 2);
        return noxtr_url_is_safe('https://' . $lnDomain . '/.well-known/lnurlp/' . rawurlencode($lnUser), true);
    }

    /**
     * True solo si $ip es una IP pública enrutable. Rechaza privadas, loopback,
     * link-local, y rangos reservados/metadata (169.254.169.254 cae en link-local).
     */
    function noxtr_ip_is_public(string $ip): bool {
        // filter_var con estos flags rechaza rangos privados y reservados
        // (RFC1918, loopback 127/8, link-local 169.254/16 y fe80::/10, etc.)
        $ok = filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
        if ($ok === false) return false;
        // Defensa extra explícita por si el build de PHP no cubre algún rango:
        // 0.0.0.0/8, 100.64/10 (CGNAT), IPv4-mapped IPv6 ::ffff:.
        if (strpos($ip, '::ffff:') === 0) return false; // IPv4-mapped
        if (strpos($ip, '0.') === 0) return false;
        return true;
    }

    $userId = (int)$_SESSION['userid'];
    $action = $_ARGS['action'] ?? '';
    $result = ['error' => 0];

    if($action){

        switch ($action) {

            case 'server':
                
                if($_ACL->userHasRoleName('Root')) {

                    function exec_enabled() {
                        $disabled = explode(', ', ini_get('disable_functions'));
                        return !in_array('exec', $disabled);
                    }

                    // Los relays del monitor se derivan de NSTR_RELAYS (los de noxtr),
                    // con fallback hardcodeado si está vacía. Ya no hace falta una
                    // clave CFG monitor_relays aparte, así que no se valida aquí.

                    if(BOT_HOST === false || BOT_USER === false || BOT_PASS === false){
                        $result['error'] = 1;
                        $result['msg'] = 'SSH credentials not configured';
                        echo json_encode($result);
                        exit;
                    }
                    
                    define('VERBOSE',false);
                    
                    $commands = array();

                    // Cliente SSH desde PHP :)

                    $ssh = new SSHClient();
                    $ssh->verbose = VERBOSE;
                    $ssh->host    = BOT_HOST;
                    $ssh->port    = intval(BOT_PORT);
                    $ssh->protocol   = 'ssh2';
                    $ssh->username   = BOT_USER;
                    $ssh->password   = BOT_PASS;
                    $ssh->connect();
                            
                    if ($_ARGS['option']=='status'){

                        $pid = $ssh->exec(BOT_STATUS);    
                        //CHECK when there are more than one pid. vg: '63636363 42356276'
                        $result['content'] =  is_numeric($pid) && $pid > 1 ? 'Monitor is running (PID '.$pid.')' : 'Monitor is stopped '.$pid.'';

                    }else if ($_ARGS['option']=='start'){
                        $result['content'] =  $ssh->exec(BOT_START);
                    }else if ($_ARGS['option']=='stop'){
                        $result['content'] =  $ssh->exec(BOT_STOP);
                    }else{ 
                        // $result['content'] =  $ssh->exec($commands[$_ARGS['option']]);
                    }

                    if ( count($ssh->getErrors())>0 ){
                        $result['error'] = 1;
                        $result['msg'] = $ssh->getLastError();
                        $result['content'] = 'Errores:'.print_r($ssh->getErrors(),true);                     
                    }
                }else{
                    $result['error'] = 1;
                    $result['msg'] = 'No permission';
                }
                break;


            // ---- CONTACTS ----
            case 'get_contacts':
                $result['data'] = NoxtrStore::getContacts($userId);
                break;

            case 'add_contact':
                $pubkey = $_ARGS['pubkey'] ?? '';
                $petname = $_ARGS['petname'] ?? '';
                if (strlen($pubkey) === 64 && ctype_xdigit($pubkey)) {
                    NoxtrStore::addContact($userId, $pubkey, $petname);
                    $result['data'] = NoxtrStore::getContacts($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid pubkey'];
                }
                break;

            case 'remove_contact':
                $pubkey = $_ARGS['pubkey'] ?? '';
                NoxtrStore::removeContact($userId, $pubkey);
                $result['data'] = NoxtrStore::getContacts($userId);
                break;

            case 'toggle_contact':
                $pubkey = $_ARGS['pubkey'] ?? '';
                if (strlen($pubkey) === 64 && ctype_xdigit($pubkey)) {
                    NoxtrStore::toggleContact($userId, $pubkey);
                    $result['data'] = NoxtrStore::getContacts($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid pubkey'];
                }
                break;

            case 'set_all_contacts_active':
                $active = (int)($_ARGS['active'] ?? 1);
                NoxtrStore::setAllContactsActive($userId, $active ? 1 : 0);
                $result['data'] = NoxtrStore::getContacts($userId);
                break;

            // ---- TOPICS ----
            case 'get_topics':
                $result['data'] = NoxtrStore::getTopics($userId);
                break;

            case 'add_topic':
                $topic = $_ARGS['topic'] ?? '';
                if (!empty($topic)) {
                    NoxtrStore::addTopic($userId, $topic);
                    $result['data'] = NoxtrStore::getTopics($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Empty topic'];
                }
                break;

            case 'remove_topic':
                $topicId = (int)($_ARGS['topic_id'] ?? 0);
                NoxtrStore::removeTopic($userId, $topicId);
                $result['data'] = NoxtrStore::getTopics($userId);
                break;

            case 'toggle_topic':
                $topicId = (int)($_ARGS['topic_id'] ?? 0);
                NoxtrStore::toggleTopic($userId, $topicId);
                $result['data'] = NoxtrStore::getTopics($userId);
                break;

            // ---- BOOKMARKS ----
            case 'get_bookmarks':
                $limit = (int)($_ARGS['limit'] ?? 50);
                $offset = (int)($_ARGS['offset'] ?? 0);
                $result['data'] = NoxtrStore::getBookmarks($userId, $limit, $offset);
                break;

            case 'add_bookmark':
                $eventId = $_ARGS['event_id'] ?? '';
                $eventPubkey = $_ARGS['event_pubkey'] ?? '';
                $eventContent = $_ARGS['event_content'] ?? '';
                $eventCreatedAt = (int)($_ARGS['event_created_at'] ?? 0);
                $eventKind = (int)($_ARGS['event_kind'] ?? 1);
                $eventTags = $_ARGS['event_tags'] ?? null;
                if (strlen($eventId) === 64 && ctype_xdigit($eventId)) {
                    NoxtrStore::addBookmark($userId, $eventId, $eventPubkey, $eventContent, $eventCreatedAt, $eventKind, $eventTags);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid event'];
                }
                break;

            case 'remove_bookmark':
                $eventId = $_ARGS['event_id'] ?? '';
                NoxtrStore::removeBookmark($userId, $eventId);
                break;

            // ---- MUTED ----
            case 'get_muted':
                $result['data'] = NoxtrStore::getMuted($userId);
                break;

            case 'mute_user':
                $pubkey = $_ARGS['pubkey'] ?? '';
                if (strlen($pubkey) === 64 && ctype_xdigit($pubkey)) {
                    NoxtrStore::addMuted($userId, $pubkey);
                    $result['data'] = NoxtrStore::getMuted($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid pubkey'];
                }
                break;

            case 'unmute_user':
                $pubkey = $_ARGS['pubkey'] ?? '';
                if (strlen($pubkey) === 64 && ctype_xdigit($pubkey)) {
                    NoxtrStore::removeMuted($userId, $pubkey);
                    $result['data'] = NoxtrStore::getMuted($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid pubkey'];
                }
                break;

            // ---- MESSAGES (DMs) ----
            case 'get_messages':
                $limit = (int)($_ARGS['limit'] ?? 200);
                $result['data'] = NoxtrStore::getMessages($userId, $limit);
                break;

            case 'save_message':
                $eventId = $_ARGS['event_id'] ?? '';
                $peerPubkey = $_ARGS['peer_pubkey'] ?? '';
                $senderPubkey = $_ARGS['sender_pubkey'] ?? '';
                $contentEncrypted = $_ARGS['content_encrypted'] ?? '';
                $eventCreatedAt = (int)($_ARGS['event_created_at'] ?? 0);
                $nipVersion = (int)($_ARGS['nip_version'] ?? 4);
                if (strlen($eventId) === 64 && ctype_xdigit($eventId)) {
                    NoxtrStore::saveMessage($userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, $eventCreatedAt, $nipVersion);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid event'];
                }
                break;

            case 'get_ln_invoice':
                $lnAddr   = trim($_ARGS['ln_address'] ?? '');
                $amtMsats = (int)($_ARGS['amount_msats'] ?? 0);
                $zapEvent = trim($_ARGS['zap_event'] ?? '');

                if (!$lnAddr || strpos($lnAddr, '@') === false) {
                    $result = ['error' => 1, 'msg' => 'Lightning Address inválida'];
                    break;
                }
                if ($amtMsats < 1000) {
                    $result = ['error' => 1, 'msg' => 'Importe mínimo: 1 sat'];
                    break;
                }

                [$lnUser, $lnDomain] = explode('@', $lnAddr, 2);
                $lnurlEndpoint = 'https://' . $lnDomain . '/.well-known/lnurlp/' . rawurlencode($lnUser);

                // Anti-SSRF (auditoría 2026-08-17, H-02): el host de la Lightning Address lo
                // controla el usuario. Validar antes de pedirlo.
                if (!noxtr_url_is_safe($lnurlEndpoint, true)) { // exige https
                    $result = ['error' => 1, 'msg' => 'Lightning Address no permitida'];
                    break;
                }

                $ctx = stream_context_create(['http' => [
                    'timeout'         => 10,
                    'header'          => "User-Agent: NoxtrZap/1.0\r\n",
                    'follow_location' => 0,      // anti-SSRF: no seguir redirect a IP interna
                    'max_redirects'   => 0,
                    'ignore_errors'   => true,
                ]]);
                $lnurlRaw = @file_get_contents($lnurlEndpoint, false, $ctx);
                $lnurlData = $lnurlRaw ? json_decode($lnurlRaw, true) : null;

                if (!$lnurlData || empty($lnurlData['callback'])) {
                    $result = ['error' => 1, 'msg' => 'No se pudo resolver la Lightning Address'];
                    break;
                }

                $min = (int)($lnurlData['minSendable'] ?? 1000);
                $max = (int)($lnurlData['maxSendable'] ?? 100000000000);
                if ($amtMsats < $min || $amtMsats > $max) {
                    $result = ['error' => 1, 'msg' => 'Importe fuera del rango permitido'];
                    break;
                }

                $sep = strpos($lnurlData['callback'], '?') !== false ? '&' : '?';
                $cbUrl = $lnurlData['callback'] . $sep . 'amount=' . $amtMsats;
                if ($zapEvent !== '') {
                    $cbUrl .= '&nostr=' . rawurlencode($zapEvent);
                }

                // Anti-SSRF: $cbUrl sale de la RESPUESTA remota (callback), no del dominio ya
                // validado arriba — es el salto crítico, un servidor malicioso podría devolver
                // cualquier callback.
                if (!noxtr_url_is_safe($cbUrl, true)) {
                    $result = ['error' => 1, 'msg' => 'Callback de la Lightning Address no permitido'];
                    break;
                }

                $invRaw  = @file_get_contents($cbUrl, false, $ctx);
                $invData = $invRaw ? json_decode($invRaw, true) : null;

                if (!$invData || empty($invData['pr'])) {
                    $result = ['error' => 1, 'msg' => 'No se pudo obtener la factura Lightning'];
                    break;
                }

                $result['data'] = ['pr' => $invData['pr']];
                break;

            case 'get_nwc':
                $result['data'] = ['uri' => NoxtrStore::getNwcUri($userId) ?? ''];
                break;

            case 'save_nwc':
                $uri = trim((string)($_ARGS['uri'] ?? ''));
                if ($uri !== '' && !preg_match('/^nostrwalletconnect:\/\//i', $uri)) {
                    $result = ['error' => 1, 'msg' => 'URI inválida'];
                    break;
                }
                NoxtrStore::setNwcUri($userId, $uri);
                $result['data'] = ['ok' => true];
                break;

            case 'clear_monitor_messages':
                $monitorPubkey = strtolower(trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? NoxtrStore::getCfgValue('modules.noxtr.monitor_pubkey', ''))));
                if (!preg_match('/^[0-9a-f]{64}$/', $monitorPubkey)) {
                    $result = ['error' => 1, 'msg' => 'Monitor pubkey not configured'];
                    break;
                }

                NoxtrStore::removeMessagesByPeer($userId, $monitorPubkey);
                $result['data'] = [
                    'peer_pubkey' => $monitorPubkey,
                    'cleared_before' => time(),
                ];
                break;

            case 'delete_conversation':
                $peerPubkey = strtolower(trim((string)($_ARGS['peer_pubkey'] ?? '')));
                if (!preg_match('/^[0-9a-f]{64}$/', $peerPubkey)) {
                    $result = ['error' => 1, 'msg' => 'Invalid peer'];
                    break;
                }
                NoxtrStore::removeMessagesByPeer($userId, $peerPubkey);
                $result['data'] = ['peer_pubkey' => $peerPubkey];
                break;

            // ---- CHANNELS (NIP-28) ----
            case 'get_channels':
                $result['data'] = NoxtrStore::getChannels($userId);
                break;

            case 'add_channel':
                $channelId = $_ARGS['channel_id'] ?? '';
                $name = trim($_ARGS['name'] ?? '');
                $about = trim($_ARGS['about'] ?? '');
                $picture = trim($_ARGS['picture'] ?? '');
                $creatorPubkey = $_ARGS['creator_pubkey'] ?? '';
                $relayUrl = $_ARGS['relay_url'] ?? '';
                if (strlen($channelId) === 64 && ctype_xdigit($channelId) && $name !== '') {
                    NoxtrStore::addChannel($userId, $channelId, $name, $about, $picture, $creatorPubkey, $relayUrl);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid channel'];
                }
                break;

            case 'remove_channel':
                $channelId = $_ARGS['channel_id'] ?? '';
                if (strlen($channelId) === 64 && ctype_xdigit($channelId)) {
                    NoxtrStore::removeChannel($userId, $channelId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid channel_id'];
                }
                break;

            case 'toggle_channel_pin':
                $channelId = $_ARGS['channel_id'] ?? '';
                if (strlen($channelId) === 64 && ctype_xdigit($channelId)) {
                    NoxtrStore::toggleChannelPin($userId, $channelId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid channel_id'];
                }
                break;

            // ---- PROFILE ----
            case 'get_profile':
                $rows = NoxtrStore::sqlQueryPrepared(
                    "SELECT user_fullname, BIO, USER_URL_AVATAR, AUTH_PROVIDER, AUTH_PICTURE, username, user_email FROM CLI_USER WHERE USER_ID = ?",
                    [$userId]
                );
                if ($rows && $rows[0]) {
                    $u = $rows[0];
                    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                    $avatar = '';
                    $img = $u['USER_URL_AVATAR'] ?? '';
                    // El avatar propio (user_url_avatar, fijado en el editor o por subida) tiene
                    // prioridad sobre AUTH_PICTURE del proveedor OAuth, que solo es fallback inicial.
                    if ($img) {
                        if (preg_match('#^https?://#i', $img)) {
                            $avatar = $img;
                        } else {
                            $avatar = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/media/avatars/' . $img;
                        }
                    } elseif ($u['AUTH_PROVIDER'] && $u['AUTH_PICTURE']) {
                        $avatar = $u['AUTH_PICTURE'];
                    }
                    $result['data'] = [
                        // El "nombre" del editor de perfil es user_fullname (nombre de sitio,
                        // usado en saludos/comentarios/etc en todo ExtFW) — ya NO la columna
                        // NOSTR_USER, legacy y duplicada, ver CLAUDE.md "Perfil unificado".
                        'name' => $u['user_fullname'] ?? '',
                        'about' => $u['BIO'] ?? '',
                        'picture' => $avatar,
                        'username' => $u['username'] ?? '',
                        'user_email' => $u['user_email'] ?? ''
                    ];
                } else {
                    $result = ['error' => 1, 'msg' => 'User not found'];
                }
                break;

            case 'update_account':
                // Username/email de CLI_USER, editables por el propio usuario (antes solo se
                // fijaban al autoregistrarse por Nostr: 'n_<hash>' y 'n_<hash>@dominio', ver
                // NostrAuth::createOrUpdateUser). El username es también el identificador NIP-05
                // (username@dominio, ver raw.php nostr.json) y la Lightning Address (lnurlp), así
                // que un cambio aquí afecta a ambos. El email solo se usa para notificaciones del
                // monitor (server_monitor.php); no se publica ni se verifica por correo.
                $rawUsername = trim($_ARGS['username'] ?? '');
                $rawEmail    = trim($_ARGS['user_email'] ?? '');
                if ($rawUsername === '' || $rawEmail === '') {
                    $result = ['error' => 1, 'msg' => t('NOXTR_ACCOUNT_FIELDS_REQUIRED')];
                    break;
                }
                $username = preg_replace('/[^a-z0-9_]/', '', strtolower($rawUsername));
                if (strlen($username) < 3 || strlen($username) > 20) {
                    $result = ['error' => 1, 'msg' => t('NOXTR_ACCOUNT_USERNAME_INVALID')];
                    break;
                }
                if (!filter_var($rawEmail, FILTER_VALIDATE_EMAIL)) {
                    $result = ['error' => 1, 'msg' => t('NOXTR_ACCOUNT_EMAIL_INVALID')];
                    break;
                }
                $takenUser = NoxtrStore::sqlQueryPrepared(
                    "SELECT user_id FROM CLI_USER WHERE username = ? AND user_id != ? LIMIT 1",
                    [$username, $userId]
                );
                if (!empty($takenUser)) {
                    $result = ['error' => 1, 'msg' => t('NOXTR_ACCOUNT_USERNAME_TAKEN')];
                    break;
                }
                $takenEmail = NoxtrStore::sqlQueryPrepared(
                    "SELECT user_id FROM CLI_USER WHERE user_email = ? AND user_id != ? LIMIT 1",
                    [$rawEmail, $userId]
                );
                if (!empty($takenEmail)) {
                    $result = ['error' => 1, 'msg' => t('NOXTR_ACCOUNT_EMAIL_TAKEN')];
                    break;
                }
                NoxtrStore::sqlQueryPrepared(
                    "UPDATE CLI_USER SET username = ?, user_email = ? WHERE USER_ID = ?",
                    [$username, $rawEmail, $userId]
                );
                $_SESSION['username']   = $username;
                $_SESSION['user_email'] = $rawEmail;
                $result['data'] = ['saved' => true, 'username' => $username, 'user_email' => $rawEmail];
                break;

            case 'sync_username':
                // Sincroniza el username de Nostr (kind 0 name/nip05) a CLI_USER.username,
                // pero SOLO si el username actual parece auto-generado (trozo de npub/nsec/hex)
                $rawName  = trim($_ARGS['name']  ?? '');
                $rawNip05 = trim($_ARGS['nip05'] ?? '');
                if (!$rawName && !$rawNip05) { $result['data'] = ['synced' => false]; break; }
                // Obtener username actual y comprobar si es auto-generado
                $currentRow      = NoxtrStore::sqlQueryPrepared("SELECT username FROM CLI_USER WHERE USER_ID = ? LIMIT 1", [$userId]);
                $currentUsername = $currentRow[0]['username'] ?? '';
                // Patrón auto-generado: 'n_' + 8 hex (NostrAuth::createOrUpdateUser, el caso real),
                // o empieza por npub1/nsec1, o es una cadena hexadecimal larga (por si acaso).
                $isAutoGenerated = (bool) preg_match('/^n_[0-9a-f]{6,}$/i', $currentUsername)
                                || (bool) preg_match('/^n(?:pub|sec)1[a-z0-9]+$/i', $currentUsername)
                                || (bool) preg_match('/^[0-9a-f]{10,}$/', $currentUsername);
                if (!$isAutoGenerated) { $result['data'] = ['synced' => false, 'reason' => 'custom_username']; break; }
                // Candidato preferente: prefijo del NIP-05 (antes del @)
                $candidate = '';
                if ($rawNip05 && strpos($rawNip05, '@') !== false) {
                    $nip05Local = explode('@', $rawNip05)[0];
                    $candidate  = preg_replace('/[^a-z0-9_]/', '', strtolower($nip05Local));
                }
                // Fallback: nombre de perfil
                if (strlen($candidate) < 3) {
                    $candidate = preg_replace('/[^a-z0-9_]/', '', strtolower($rawName));
                }
                if (strlen($candidate) < 3) { $result['data'] = ['synced' => false, 'reason' => 'too_short']; break; }
                // No actualizar si ya coincide
                if ($currentUsername === $candidate) { $result['data'] = ['synced' => false, 'reason' => 'no_change']; break; }
                // Verificar que no esté en uso por otro usuario
                $taken = NoxtrStore::sqlQueryPrepared("SELECT user_id FROM CLI_USER WHERE username = ? AND user_id != ? LIMIT 1", [$candidate, $userId]);
                if (!empty($taken)) { $result['data'] = ['synced' => false, 'reason' => 'taken']; break; }
                NoxtrStore::sqlQueryPrepared("UPDATE CLI_USER SET username = ? WHERE USER_ID = ?", [$candidate, $userId]);
                $result['data'] = ['synced' => true, 'username' => $candidate];
                break;

            case 'save_profile':
                $name = trim($_ARGS['name'] ?? '');
                $about = trim($_ARGS['about'] ?? '');
                $picture = trim($_ARGS['picture'] ?? '');
                $pubkey = trim($_ARGS['pubkey'] ?? '');
                // "Nombre" escribe en user_fullname (nombre de sitio, no NOSTR_USER: ver
                // CLAUDE.md "Perfil unificado" — NOSTR_USER queda sin usar/legacy).
                $setPic = ($picture !== '');
                if ($pubkey && preg_match('/^[0-9a-f]{64}$/', $pubkey)) {
                    if ($setPic) {
                        NoxtrStore::sqlQueryPrepared(
                            "UPDATE CLI_USER SET user_fullname = ?, BIO = ?, nostr_pubkey = ?, user_url_avatar = ? WHERE USER_ID = ?",
                            [$name, $about, $pubkey, $picture, $userId]
                        );
                    } else {
                        NoxtrStore::sqlQueryPrepared(
                            "UPDATE CLI_USER SET user_fullname = ?, BIO = ?, nostr_pubkey = ? WHERE USER_ID = ?",
                            [$name, $about, $pubkey, $userId]
                        );
                    }
                } else {
                    if ($setPic) {
                        NoxtrStore::sqlQueryPrepared(
                            "UPDATE CLI_USER SET user_fullname = ?, BIO = ?, user_url_avatar = ? WHERE USER_ID = ?",
                            [$name, $about, $picture, $userId]
                        );
                    } else {
                        NoxtrStore::sqlQueryPrepared(
                            "UPDATE CLI_USER SET user_fullname = ?, BIO = ? WHERE USER_ID = ?",
                            [$name, $about, $userId]
                        );
                    }
                }
                if ($name !== '') { $_SESSION['user_fullname'] = $name; }
                $result['data'] = ['saved' => true];
                break;

            // ---- ZAPS (Lightning Tips) ----
            case 'create_zap':
                $amount = (int)($_ARGS['amount'] ?? 0);
                $lnAddress = trim($_ARGS['ln_address'] ?? '');
                $notePubkey = $_ARGS['note_pubkey'] ?? '';
                $noteId = $_ARGS['note_id'] ?? '';
                $senderBalance = 0;

                if ($amount < 5 || $amount > 1000000) {
                    $result = ['error' => 1, 'msg' => 'Amount must be between 5 and 1,000,000 sats'];
                    break;
                }

                // A-2: note_pubkey va directo a un WHERE y al metadata de la invoice. Mismo
                // criterio que el resto del fichero: 64 hex o nada.
                if ($notePubkey !== '' && !preg_match('/^[a-f0-9]{64}$/', $notePubkey)) {
                    $result = ['error' => 1, 'msg' => 'note_pubkey inválida'];
                    break;
                }

                // A-1: la ln_address que llega del cliente se valida ANTES de usarla. Si no vale,
                // se descarta aquí en vez de arrastrarla hasta el metadata de BTCPay.
                if ($lnAddress !== '' && !noxtr_ln_address_is_safe($lnAddress)) {
                    $result = ['error' => 1, 'msg' => 'Lightning Address no permitida'];
                    break;
                }

                // Check if recipient is a registered user (by nostr_pubkey).
                // Con note_pubkey vacío NO se consulta: la cadena vacía no significa "sin
                // destinatario" para el motor, casa con cualquier fila que tenga nostr_pubkey = ''
                // (usuarios que nunca vincularon identidad Nostr) y `LIMIT 1` sin ORDER BY devuelve
                // una arbitraria — el zap acabaría en la cuenta de un desconocido por transferencia
                // interna. Saltarse la búsqueda deja $recipientUserId=0 y $recipientLnAddress='',
                // que es exactamente el flujo de "destinatario no registrado" que ya existe.
                $recipientUserId = 0;
                $recipientLnAddress = '';
                if ($notePubkey !== '') {
                    $recipientRow = NoxtrStore::sqlQueryPrepared(
                        "SELECT user_id, balance_sats, lightning_address FROM CLI_USER WHERE nostr_pubkey = ? LIMIT 1",
                        [$notePubkey]
                    );
                    $recipientUserId = ($recipientRow && $recipientRow[0]) ? (int)$recipientRow[0]['user_id'] : 0;
                    $recipientLnAddress = trim($recipientRow[0]['lightning_address'] ?? '');
                }

                // If registered recipient has an external LN address, prefer sending there.
                // A-1: la de la BD tampoco es de fiar — la escribió su propio dueño desde el perfil.
                // Si no valida se ignora y se sigue el flujo como si no tuviera dirección externa
                // (transferencia interna o error de "sin LN address"), en vez de abortar el zap por
                // un dato que el pagador no controla.
                if ($recipientUserId && $recipientLnAddress && noxtr_ln_address_is_safe($recipientLnAddress)) {
                    $lnAddress = $recipientLnAddress;
                } elseif ($recipientUserId && $recipientLnAddress) {
                    $recipientLnAddress = '';
                }

                // Internal transfer: recipient is registered, has no external LN address, sender has enough balance
                if ($recipientUserId && !$recipientLnAddress) {
                    $senderRow = NoxtrStore::sqlQueryPrepared(
                        "SELECT balance_sats FROM CLI_USER WHERE user_id = ? LIMIT 1",
                        [$userId]
                    );
                    $senderBalance = (int)($senderRow[0]['balance_sats'] ?? 0);

                    if ($senderBalance >= $amount) {
                        /*
                        * OLD:
                        * - Debit and credit were executed outside an explicit transaction.
                        * - Credit could run even if debit affected 0 rows in race conditions.
                        *
                        * NEW:
                        * - Use transaction + check affected rows in debit/credit for atomic internal transfer.
                        */
                        try {
                            NoxtrStore::beginTransaction();

                            $affectedDebit = NoxtrStore::sqlExec(
                                "UPDATE CLI_USER
                                SET balance_sats = balance_sats - " . (int)$amount . "
                                WHERE user_id = " . (int)$userId . "
                                AND balance_sats >= " . (int)$amount
                            );

                            if ((int)$affectedDebit < 1) {
                                NoxtrStore::rollBack();
                                $result = ['error' => 1, 'msg' => 'Not enough balance (' . $senderBalance . ' sats)'];
                                break;
                            }

                            $affectedCredit = NoxtrStore::sqlExec(
                                "UPDATE CLI_USER
                                SET balance_sats = COALESCE(balance_sats, 0) + " . (int)$amount . "
                                WHERE user_id = " . (int)$recipientUserId
                            );

                            if ((int)$affectedCredit < 1) {
                                NoxtrStore::rollBack();
                                $result = ['error' => 1, 'msg' => 'Internal transfer failed (recipient not credited)'];
                                break;
                            }

                            $now = time();
                            // type 5: Zap enviado (sender)
                            NoxtrStore::sqlQueryPrepared(
                                "INSERT INTO CLI_USER_TRANSACTIONS (from_user, to_user, transaction_type, amount_sats, commission_sats, invoice_id, module_id, article_id, payment_method, direct_payment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [$userId, $recipientUserId, 5, -$amount, 0, '', 5, 0, 'balance', 1, $now]
                            );
                            // type 6: Zap recibido (recipient)
                            NoxtrStore::sqlQueryPrepared(
                                "INSERT INTO CLI_USER_TRANSACTIONS (from_user, to_user, transaction_type, amount_sats, commission_sats, invoice_id, module_id, article_id, payment_method, direct_payment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                [$userId, $recipientUserId, 6, $amount, 0, '', 5, 0, 'balance', 1, $now]
                            );

                            NoxtrStore::commit();
                            $result['data'] = ['internal' => true, 'amount' => $amount];
                            break;
                        } catch (Exception $e) {
                            NoxtrStore::rollBack();
                            $result = ['error' => 1, 'msg' => 'Internal transfer exception'];
                            break;
                        }
                    }
                    // Not enough balance → fall through to BTCPay invoice
                }

                // For external payment, lnAddress is required.
                // A-1: revalidado aquí, que es el punto por el que pasa TODO lo que acaba en el
                // metadata de la invoice — venga del cliente o de la BD.
                if (!$lnAddress || !noxtr_ln_address_is_safe($lnAddress)) {
                    if (!$recipientUserId) {
                        // Not registered and no LN address — cannot zap
                        $result = ['error' => 1, 'msg' => 'No Lightning Address', 'noLnAddress' => true];
                    } else {
                        // Registered but not enough balance
                        $result = ['error' => 1, 'msg' => 'Not enough balance (' . $senderBalance . ' sats)'];
                    }
                    break;
                }

                // La transferencia interna ya se ha resuelto arriba. Solo se
                // bloquea el fallback que necesita cobrar y pagar con BTCPay LN.
                $lightningStatus = BtcpayLightning::status(BtcpayLightning::configFromGlobals());
                if (!$lightningStatus['available']) {
                    $result = [
                        'error' => 1,
                        'code' => 'lightning_unavailable',
                        'msg' => BtcpayLightning::unavailableMessage($lightningStatus),
                    ];
                    break;
                }

                // Load BTCPay functions if not already available
                if (!function_exists('btcpay_request')) {
                    require_once __DIR__ . '/../wallet/after_init.php';
                }

                // External payment: create BTCPay invoice
                $btcAmount = number_format($amount / 100000000, 8, '.', '');

                $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                $webhookUrl = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/page/checkout/bitcoin/callback/raw/';

                $invoiceMetadata = [
                    'userId'     => $userId,
                    'authorId'   => $recipientUserId,
                    'lnAddress'  => $lnAddress,
                    'moduleId'   => 5,
                    'articleId'  => 0,
                    'notePubkey' => $notePubkey,
                    'noteId'     => $noteId,
                    'amountSats' => $amount,
                    'webhook'    => $webhookUrl
                ];

                $invoice = btcpay_request('stores/' . BTCPAY_STORE_ID . '/invoices', 'POST', [
                    'amount' => $btcAmount,
                    'currency' => 'BTC',
                    'metadata' => $invoiceMetadata
                ]);

                if (!empty($invoice['error']) || empty($invoice['data']['id'])) {
                    $result = ['error' => 1, 'msg' => t('ERROR_CREATING_INVOICE').': ' . ($invoice['error'] ?? 'Unknown error')];
                } else {
                    $result['data'] = [
                        'invoiceId'    => $invoice['data']['id'],
                        'checkoutLink' => $invoice['data']['checkoutLink']
                    ];
                }
                break;

            // ---- RELAYS ----
            case 'get_relays':
                $result['data'] = NoxtrStore::getRelays($userId);
                break;

            case 'add_relay':
                $url = trim($_ARGS['url'] ?? '');
                if ($url && (strpos($url, 'wss://') === 0 || strpos($url, 'ws://') === 0)) {
                    NoxtrStore::addRelay($userId, $url);
                    $result['data'] = NoxtrStore::getRelays($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid relay URL'];
                }
                break;

            case 'remove_relay':
                $relayId = (int)($_ARGS['relay_id'] ?? 0);
                NoxtrStore::removeRelay($userId, $relayId);
                $result['data'] = NoxtrStore::getRelays($userId);
                break;

            case 'toggle_relay':
                $relayId = (int)($_ARGS['relay_id'] ?? 0);
                NoxtrStore::toggleRelay($userId, $relayId);
                $result['data'] = NoxtrStore::getRelays($userId);
                break;

            // ---- NIP-96 FILE STORAGE SERVERS ----
            case 'get_nip96_servers':
                $result['data'] = NoxtrStore::getNip96Servers($userId);
                break;

            case 'add_nip96_server':
                $url = trim($_ARGS['url'] ?? '');
                if ($url && preg_match('#^https?://#i', $url)) {
                    NoxtrStore::addNip96Server($userId, $url);
                    $result['data'] = NoxtrStore::getNip96Servers($userId);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid URL (must start with http:// or https://)'];
                }
                break;

            case 'remove_nip96_server':
                $serverId = (int)($_ARGS['server_id'] ?? 0);
                NoxtrStore::removeNip96Server($userId, $serverId);
                $result['data'] = NoxtrStore::getNip96Servers($userId);
                break;

            case 'toggle_nip96_server':
                $serverId = (int)($_ARGS['server_id'] ?? 0);
                NoxtrStore::toggleNip96Server($userId, $serverId);
                $result['data'] = NoxtrStore::getNip96Servers($userId);
                break;

            // ---- PUBLISH FROM OTHER MODULES ----
            case 'get_article':
                $module = $_ARGS['module'] ?? '';
                $articleId = (int)($_ARGS['id'] ?? 0);

                if (!in_array($module, ['news', 'blog']) || !$articleId) {
                    $result = ['error' => 1, 'msg' => 'Invalid params'];
                    break;
                }

                if ($module === 'blog') { $pfx = 'BLG'; $tbn = 'BLOG'; }
                else { $pfx = 'NOT'; $tbn = 'NEWS'; }

                $rows = NoxtrStore::sqlQueryPrepared(
                    "SELECT {$pfx}_TITLE, {$pfx}_NAME, {$pfx}_TEXT FROM {$pfx}_{$tbn} WHERE {$pfx}_ID = ? AND ACTIVE = '1'",
                    [$articleId]
                );
                if (!$rows) { $result = ['error' => 1, 'msg' => 'Article not found']; break; }
                $art = $rows[0];

                $tagRows = NoxtrStore::sqlQueryPrepared(
                    "SELECT NAME FROM {$pfx}_TAGS WHERE TAG_ID IN (SELECT TAG_ID FROM {$pfx}_{$tbn}_TAGS WHERE {$tbn}_ID = ?)",
                    [$articleId]
                );
                $tags = $tagRows ? array_column($tagRows, 'NAME') : [];

                $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                $url = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/' . $module . '/' . $art[$pfx.'_NAME'];

                // Convert HTML to markdown-friendly plain text
                $raw = $art[$pfx.'_TEXT'];
                // Code blocks: <pre> → ```
                $raw = preg_replace('#<pre[^>]*>\s*<code[^>]*>(.*?)</code>\s*</pre>#si', "\n```\n$1\n```\n", $raw);
                $raw = preg_replace('#<pre[^>]*>(.*?)</pre>#si', "\n```\n$1\n```\n", $raw);
                // Inline code: <code> → `
                $raw = preg_replace('#<code[^>]*>(.*?)</code>#si', '`$1`', $raw);
                // Headings
                $raw = preg_replace('#<h[1-3][^>]*>(.*?)</h[1-3]>#si', "\n\n**$1**\n", $raw);
                // Line breaks and paragraphs
                $raw = preg_replace('#<br\s*/?\s*>#i', "\n", $raw);
                $raw = preg_replace('#</p>\s*<p[^>]*>#i', "\n\n", $raw);
                $raw = preg_replace('#</?p[^>]*>#i', "\n", $raw);
                // Lists
                $raw = preg_replace('#<li[^>]*>#i', "\n- ", $raw);
                // Bold/italic
                $raw = preg_replace('#<(strong|b)[^>]*>(.*?)</(strong|b)>#si', '**$2**', $raw);
                $raw = preg_replace('#<(em|i)[^>]*>(.*?)</(em|i)>#si', '*$2*', $raw);
                // Strip remaining tags
                $raw = strip_tags($raw);
                $text = html_entity_decode($raw, ENT_QUOTES, 'UTF-8');
                $text = preg_replace('/\n{3,}/', "\n\n", trim($text));

                // Excerpt (plain, no markdown)
                $plain = preg_replace('/\s+/', ' ', strip_tags($art[$pfx.'_TEXT']));
                $plain = html_entity_decode($plain, ENT_QUOTES, 'UTF-8');
                $excerpt = mb_substr(trim($plain), 0, 250, 'UTF-8');
                if (mb_strlen(trim($plain), 'UTF-8') > 250) $excerpt .= '...';

                // Main image
                $image = '';
                $imgRows = NoxtrStore::sqlQueryPrepared(
                    "SELECT FILE_NAME FROM {$pfx}_{$tbn}_FILES WHERE {$tbn}_ID = ? AND MAIN = '1' ORDER BY ID DESC LIMIT 1",
                    [$articleId]
                );
                if ($imgRows) {
                    $image = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/media/' . $tbn . '/files/' . $articleId . '/' . $imgRows[0]['FILE_NAME'];
                }

                $result['data'] = [
                    'title'   => $art[$pfx.'_TITLE'],
                    'text'    => $text,
                    'excerpt' => $excerpt,
                    'url'     => $url,
                    'image'   => $image,
                    'tags'    => $tags
                ];
                break;

            case 'translate':
                $text = trim($_ARGS['text'] ?? '');
                if (!$text) { $result = ['error' => 1, 'msg' => 'No text']; break; }

                $ollamaKey   = CFG::$vars['ai']['ollama']['api_key'] ?? 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
                $ollamaModel = CFG::$vars['ai']['ollama']['model']   ?? 'gpt-oss:20b-cloud';
                $apiUrl      = 'https://ollama.com/api/chat';

                $payload = [
                    'model'    => $ollamaModel,
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are a translation assistant. Translate the following text to Spanish. Return ONLY the translated text, no explanations, no quotes.'],
                        ['role' => 'user',   'content' => $text]
                    ],
                    'stream' => false
                ];

                $headers = ['Content-Type: application/json'];
                if ($ollamaKey) $headers[] = 'Authorization: Bearer ' . $ollamaKey;

                $ch = curl_init($apiUrl);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_HTTPHEADER     => $headers,
                    CURLOPT_POST           => true,
                    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
                    CURLOPT_TIMEOUT        => 60,
                ]);
                $raw      = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlErr  = curl_errno($ch) ? curl_error($ch) : null;
                curl_close($ch);

                if ($curlErr)        { $result = ['error' => 1, 'msg' => 'cURL: ' . $curlErr]; break; }
                if ($httpCode !== 200) { $result = ['error' => 1, 'msg' => 'HTTP ' . $httpCode . ': ' . $raw]; break; }

                $data       = json_decode($raw, true);
                $translated = trim($data['message']['content'] ?? '');
                if (!$translated) { $result = ['error' => 1, 'msg' => 'Empty response from Ollama']; break; }

                $result['translated'] = $translated;
                break;

            // ---- CACHE NOSTR PROFILE IMAGES LOCALLY ----
            case 'cache_nostr_images':
                $avatarUrl = trim($_ARGS['avatar_url'] ?? '');
                $bannerUrl = trim($_ARGS['banner_url'] ?? '');
                $saved = [];

                $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];

                $downloadImage = function($url) use ($allowedMimes, $extMap) {
                    if (!preg_match('#^https?://#i', $url)) return null;
                    // Anti-SSRF (auditoría 2026-08-17, H-03): validar que el host no sea
                    // interno ANTES de pedirlo. FOLLOWLOCATION off para que un redirect no
                    // salte a una IP interna tras pasar el chequeo.
                    if (!noxtr_url_is_safe($url)) return null;

                    $maxBytes = 5 * 1024 * 1024; // 5 MB tope duro
                    $ch = curl_init($url);
                    curl_setopt_array($ch, [
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_FOLLOWLOCATION => false,   // era true — anti-SSRF
                        CURLOPT_TIMEOUT        => 10,
                        CURLOPT_CONNECTTIMEOUT => 5,
                        CURLOPT_USERAGENT      => 'Mozilla/5.0',
                        // Abortar la descarga si supera el tope, sin bufferizar de más.
                        CURLOPT_NOPROGRESS     => false,
                        CURLOPT_BUFFERSIZE     => 16384,
                        CURLOPT_PROGRESSFUNCTION => function($ch, $dlTotal, $dlNow) use ($maxBytes) {
                            // Devolver !=0 aborta la transferencia.
                            if ($dlTotal > $maxBytes || $dlNow > $maxBytes) return 1;
                            return 0;
                        },
                    ]);
                    $data = curl_exec($ch);
                    $mime = strtolower(explode(';', (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]);
                    curl_close($ch);
                    if (!$data || strlen($data) > $maxBytes) return null;
                    if (!in_array(trim($mime), $allowedMimes)) return null;
                    return ['data' => $data, 'ext' => $extMap[$mime] ?? 'jpg'];
                };

                // Avatar
                if ($avatarUrl) {
                    $existing = glob($_SERVER['DOCUMENT_ROOT'] . '/' . SCRIPT_DIR_MEDIA . '/avatars/' . $userId . '.*');
                    if (!$existing) {
                        $img = $downloadImage($avatarUrl);
                        if ($img) {
                            $destPath = $_SERVER['DOCUMENT_ROOT'] . '/' . SCRIPT_DIR_MEDIA . '/avatars/' . $userId . '.' . $img['ext'];
                            if (file_put_contents($destPath, $img['data']) !== false) {
                                $saved[] = 'avatar';
                                NoxtrStore::sqlQueryPrepared(
                                    "UPDATE CLI_USER SET user_url_avatar = ? WHERE USER_ID = ?",
                                    [$userId . '.' . $img['ext'], $userId]
                                );
                            }
                        }
                    }
                }

                // Banner
                if ($bannerUrl) {
                    $existing = glob($_SERVER['DOCUMENT_ROOT'] . '/' . SCRIPT_DIR_MEDIA . '/nostr/banners/banner_' . $userId . '.*');
                    if (!$existing) {
                        $img = $downloadImage($bannerUrl);
                        if ($img) {
                            $dir = $_SERVER['DOCUMENT_ROOT'] . '/' . SCRIPT_DIR_MEDIA . '/nostr/banners';
                            if (!is_dir($dir)) mkdir($dir, 0755, true);
                            $destPath = $dir . '/banner_' . $userId . '.' . $img['ext'];
                            if (file_put_contents($destPath, $img['data']) !== false) {
                                $saved[] = 'banner';
                                NoxtrStore::sqlQueryPrepared(
                                    "UPDATE CLI_USER SET NOSTR_BANNER = ? WHERE USER_ID = ?",
                                    ['banner_' . $userId . '.' . $img['ext'], $userId]
                                );
                            }
                        }
                    }
                }

                $result['saved'] = $saved;
                break;

            // ---- BACKUP EXPORT / IMPORT ----
            case 'export_data':
                $contacts  = NoxtrStore::sqlQueryPrepared("SELECT pubkey, petname, relay_url, active FROM NSTR_CONTACTS WHERE user_id = ?", [$userId]);
                $topics    = NoxtrStore::sqlQueryPrepared("SELECT topic, sort_order FROM NSTR_TOPICS WHERE user_id = ? AND active = 1", [$userId]);
                $channels  = NoxtrStore::sqlQueryPrepared("SELECT channel_id, name, about, picture, creator_pubkey, relay_url, pinned FROM NSTR_CHANNELS WHERE user_id = ?", [$userId]);
                $relays    = NoxtrStore::sqlQueryPrepared("SELECT url, active FROM NSTR_RELAYS WHERE user_id = ?", [$userId]);
                $bookmarks = NoxtrStore::sqlQueryPrepared("SELECT event_id, event_pubkey, event_content, event_created_at FROM NSTR_BOOKMARKS WHERE user_id = ?", [$userId]);
                $muted     = NoxtrStore::sqlQueryPrepared("SELECT pubkey FROM NSTR_MUTED WHERE user_id = ?", [$userId]);
                $userRow   = NoxtrStore::sqlQueryPrepared("SELECT username FROM CLI_USER WHERE USER_ID = ? LIMIT 1", [$userId]);
                $result['data'] = [
                    'username'  => $userRow[0]['username'] ?? '',
                    'contacts'  => $contacts  ?: [],
                    'topics'    => $topics    ?: [],
                    'channels'  => $channels  ?: [],
                    'relays'    => $relays    ?: [],
                    'bookmarks' => $bookmarks ?: [],
                    'muted'     => $muted     ?: [],
                ];
                break;

            case 'import_data':
                $raw = trim($_ARGS['data'] ?? '');
                if (!$raw) { $result = ['error' => 1, 'msg' => 'No data']; break; }
                $data = json_decode($raw, true);
                if (!$data) { $result = ['error' => 1, 'msg' => 'Invalid JSON']; break; }

                // Contacts
                if (!empty($data['contacts'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_CONTACTS WHERE user_id = ?", [$userId]);
                    foreach ($data['contacts'] as $c) {
                        $pk = preg_replace('/[^a-f0-9]/', '', strtolower($c['pubkey'] ?? ''));
                        if (strlen($pk) !== 64) continue;
                        NoxtrStore::addContact($userId, $pk, $c['petname'] ?? '', $c['relay_url'] ?? '');
                        if (isset($c['active']) && !(int)$c['active']) {
                            NoxtrStore::sqlQueryPrepared("UPDATE NSTR_CONTACTS SET active = 0 WHERE user_id = ? AND pubkey = ?", [$userId, $pk]);
                        }
                    }
                }
                // Topics
                if (!empty($data['topics'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_TOPICS WHERE user_id = ?", [$userId]);
                    foreach ($data['topics'] as $t) {
                        $topic = preg_replace('/[^a-z0-9_\-]/i', '', $t['topic'] ?? '');
                        if (!$topic) continue;
                        NoxtrStore::addTopic($userId, $topic);
                    }
                }
                // Channels
                if (!empty($data['channels'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_CHANNELS WHERE user_id = ?", [$userId]);
                    foreach ($data['channels'] as $ch) {
                        $chId = preg_replace('/[^a-f0-9]/', '', strtolower($ch['channel_id'] ?? ''));
                        if (strlen($chId) !== 64) continue;
                        NoxtrStore::addChannel($userId, $chId, $ch['name'] ?? '', $ch['about'] ?? '', $ch['picture'] ?? '', $ch['creator_pubkey'] ?? '', $ch['relay_url'] ?? '');
                        if (!empty($ch['pinned'])) {
                            NoxtrStore::sqlQueryPrepared("UPDATE NSTR_CHANNELS SET pinned = 1 WHERE user_id = ? AND channel_id = ?", [$userId, $chId]);
                        }
                    }
                }
                // Relays
                if (!empty($data['relays'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_RELAYS WHERE user_id = ?", [$userId]);
                    foreach ($data['relays'] as $r) {
                        $url = filter_var($r['url'] ?? '', FILTER_VALIDATE_URL);
                        if (!$url) continue;
                        NoxtrStore::addRelay($userId, $url);
                        if (isset($r['active']) && !$r['active']) {
                            NoxtrStore::sqlQueryPrepared("UPDATE NSTR_RELAYS SET active = 0 WHERE user_id = ? AND url = ?", [$userId, $url]);
                        }
                    }
                }
                // Bookmarks
                if (!empty($data['bookmarks'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_BOOKMARKS WHERE user_id = ?", [$userId]);
                    foreach ($data['bookmarks'] as $b) {
                        $eid = preg_replace('/[^a-f0-9]/', '', strtolower($b['event_id'] ?? ''));
                        if (strlen($eid) !== 64) continue;
                        NoxtrStore::addBookmark($userId, $eid, $b['event_pubkey'] ?? '', $b['event_content'] ?? '', (int)($b['event_created_at'] ?? 0));
                    }
                }
                // Muted
                if (!empty($data['muted'])) {
                    NoxtrStore::sqlQueryPrepared("DELETE FROM NSTR_MUTED WHERE user_id = ?", [$userId]);
                    foreach ($data['muted'] as $m) {
                        $pk = preg_replace('/[^a-f0-9]/', '', strtolower($m['pubkey'] ?? ''));
                        if (strlen($pk) !== 64) continue;
                        NoxtrStore::addMuted($userId, $pk);
                    }
                }
                $result['data'] = ['imported' => true];
                break;

            // ---- MOSTRO TRADES ----

            case 'mostro_trade_add':
                $fiatCode = strtoupper(preg_replace('/[^A-Za-z]/', '', $_ARGS['fiat_code'] ?? ''));
                $tradeKind = in_array($_ARGS['trade_kind'] ?? '', ['buy','sell']) ? $_ARGS['trade_kind'] : 'sell';
                $tradeRole = in_array($_ARGS['trade_role'] ?? '', ['created','taken']) ? $_ARGS['trade_role'] : 'created';
                $tradePrivkey = preg_replace('/[^a-f0-9]/', '', strtolower($_ARGS['trade_privkey'] ?? ''));
                $tradePub = preg_replace('/[^a-f0-9]/', '', strtolower($_ARGS['trade_key_pub'] ?? ''));
                $robotPub = preg_replace('/[^a-f0-9]/', '', strtolower($_ARGS['robot_pubkey'] ?? ''));
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? ('tmp-'.uniqid('',true)));
                $isSeller = (int)($_ARGS['is_seller'] ?? 0);
                $tradeIndex = max(0, (int)($_ARGS['trade_index'] ?? 0));
                $seedIndex = max(0, (int)($_ARGS['seed_index'] ?? 0));
                $identityFingerprint = strtolower(trim((string)($_ARGS['identity_fingerprint'] ?? '')));
                if ($identityFingerprint !== 'privacy') {
                    $identityFingerprint = preg_replace('/[^a-f0-9]/', '', $identityFingerprint);
                    if (strlen($identityFingerprint) !== 64) $identityFingerprint = '';
                }
                $satAmount = (int)($_ARGS['sat_amount'] ?? 0);
                $fiatAmount = substr(preg_replace('/[^0-9\-\.]/', '', $_ARGS['fiat_amount'] ?? ''), 0, 20);
                $paymentMethod = substr(strip_tags($_ARGS['payment_method'] ?? ''), 0, 255);
                $intStatus = in_array($_ARGS['internal_status'] ?? '', ['creado','enviando','publicado','esperando_hold_invoice','tomado','esperando_pago_vendedor','activo','fiat_enviado','completado','cancelado','disputado','archivado']) ? $_ARGS['internal_status'] : 'creado';
                if (!$fiatCode || strlen($tradePrivkey) !== 64 || strlen($tradePub) !== 64) {
                    $result = ['error' => 1, 'msg' => 'Datos incompletos o inválidos'];
                    break;
                }
                // Si ya hay una fila para este order_id (p.ej. una toma anterior que se canceló y
                // desapareció de "Mis trades"), se REUSA esa fila al re-tomar, sea cual sea su estado.
                // La fila solo se pierde si el usuario la borra explícitamente.
                $existingTrade = NoxtrStore::getTrade($userId, $orderId);
                if ($existingTrade) {
                    NoxtrStore::updateTrade($userId, $orderId, [
                        'request_id' => 0,
                        'robot_pubkey' => $robotPub,
                        'trade_kind' => $tradeKind,
                        'trade_role' => $tradeRole,
                        'trade_privkey' => $tradePrivkey,
                        'trade_key_pub' => $tradePub,
                        'trade_index' => $tradeIndex,
                        'seed_index' => $seedIndex,
                        'identity_fingerprint' => $identityFingerprint,
                        'trade_action' => '',
                        'status' => $intStatus,
                        'internal_status' => $intStatus,
                        'is_seller' => $isSeller,
                        'fiat_amount' => $fiatAmount,
                        'fiat_code' => $fiatCode,
                        'sat_amount' => $satAmount,
                        'payment_method' => $paymentMethod,
                        'peer_pubkey' => '',
                        'dispute_id' => '',
                        'solver_pubkey' => '',
                        'trade_json' => '',
                        'my_rating' => 0,
                        'archived' => 0,
                    ]);
                    $result = ['ok' => 1, 'id' => (int)($existingTrade['id'] ?? 0), 'order_id' => $orderId, 'reused' => 1];
                    break;
                }
                $newId = NoxtrStore::addTrade($userId, [
                    'order_id' => $orderId, 'robot_pubkey' => $robotPub,
                    'trade_kind' => $tradeKind, 'trade_role' => $tradeRole,
                    'trade_privkey' => $tradePrivkey, 'trade_key_pub' => $tradePub,
                    'seed_index' => $seedIndex, 'identity_fingerprint' => $identityFingerprint,
                    'internal_status' => $intStatus, 'status' => $intStatus,
                    'is_seller' => $isSeller, 'fiat_amount' => $fiatAmount,
                    'fiat_code' => $fiatCode, 'sat_amount' => $satAmount,
                        'payment_method' => $paymentMethod, 'trade_index' => $tradeIndex, 'archived' => 0,
                ]);
                $result = $newId ? ['ok' => 1, 'id' => $newId, 'order_id' => $orderId] : ['error' => 1, 'msg' => 'Error al guardar'];
                break;

            case 'mostro_trade_update':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                $fields = $_ARGS['fields'] ?? [];
                if (!$orderId || !is_array($fields) || !$fields) { $result = ['error' => 1, 'msg' => 'Parámetros inválidos']; break; }
                $currentTrade = NoxtrStore::getTrade($userId, $orderId);
                if (($currentTrade['method'] ?? '') === 'onchain' &&
                    !empty($fields['trade_privkey'])) {
                    $result = ['error' => 1, 'msg' => 'Una clave privada on-chain no puede guardarse en el servidor'];
                    break;
                }
                $clean = [];
                $strFields = ['robot_pubkey','trade_kind','trade_role','trade_action','status','internal_status','fiat_amount','fiat_code','payment_method','peer_pubkey','dispute_id','arbitrators','taproot_address','funding_txid'];
                $hexFields = ['trade_privkey','trade_key_pub','solver_pubkey'];
                $intFields = ['is_seller','sat_amount','trade_index','seed_index','my_rating','archived','bond_paid','funding_vout','funding_block','confirmations'];
                foreach ($strFields as $f) { if (isset($fields[$f])) $clean[$f] = substr(strip_tags((string)$fields[$f]), 0, 512); }
                if (isset($fields['trade_json'])) $clean['trade_json'] = substr((string)$fields['trade_json'], 0, 8192);
                foreach ($hexFields as $f) { if (isset($fields[$f])) { $v = preg_replace('/[^a-f0-9]/','',$fields[$f]); if (strlen($v)===64||$v==='') $clean[$f]=$v; } }
                foreach ($intFields as $f) { if (isset($fields[$f])) $clean[$f] = (int)$fields[$f]; }
                if (isset($fields['identity_fingerprint'])) {
                    $v = strtolower(trim((string)$fields['identity_fingerprint']));
                    if ($v === 'privacy' || preg_match('/^[a-f0-9]{64}$/', $v)) $clean['identity_fingerprint'] = $v;
                }
                // A-4: `order_id` sigue siendo actualizable, pero SOLO para el único caso legítimo:
                // el renombrado de la fila temporal `tmp-...` al UUID real cuando la instancia
                // confirma el `new-order` (script.mostro.js, `updates.order_id = realId`). Quitarlo
                // del todo rompería la creación de órdenes: la fila se quedaría bajo `tmp-...` para
                // siempre y dejaría de reconocerse como propia en el order book.
                // Acotado a tmp→no-tmp, deja de ser una primitiva de renombrado arbitrario: no
                // permite pisar la clave de un trade ya consolidado ni apuntar a otro `tmp-`.
                if (isset($fields['order_id'])) {
                    $newOrderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $fields['order_id']);
                    if ($newOrderId !== '' && strpos($orderId, 'tmp-') === 0 && strpos($newOrderId, 'tmp-') !== 0) {
                        $clean['order_id'] = $newOrderId;
                    }
                }
                $updated = NoxtrStore::updateTrade($userId, $orderId, $clean);
                // Web-side email notifications are intentionally disabled.
                // The real email channel now belongs to server_monitor.php, which
                // keeps working even when the browser is closed.
                //
                // If these frontend trade transitions become useful again, they
                // should drive in-browser / desktop notifications instead of
                // sending emails from the web request cycle.
                $result = ['ok' => 1];
                break;

            case 'mostro_trade_list':
                $limit = min(500, max(1, (int)($_ARGS['limit'] ?? 200)));
                $trades = NoxtrStore::loadTrades($userId, $limit);
                $result = [
                    'ok' => 1,
                    'trades' => $trades,
                    'max_derivation_index' => NoxtrStore::getMaxMostroDerivationIndex($userId),
                ];
                break;

            case 'mostro_trade_get':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                if (!$orderId) { $result = ['error' => 1, 'msg' => 'order_id requerido']; break; }
                // Consulta directa e indexada: cargar y recorrer hasta 500 trades por cada evento
                // de relay degradaba rapidamente cuando crecia el historial del usuario.
                $trade = NoxtrStore::getTrade($userId, $orderId);
                $result = $trade ? ['ok' => 1, 'trade' => $trade] : ['error' => 1, 'msg' => 'No encontrado'];
                break;

            case 'reserve_mostro_derivation_index':
                $minimum = max(1, (int)($_ARGS['minimum'] ?? 1));
                $index = NoxtrStore::reserveMostroDerivationIndex($userId, $minimum);
                $result = $index > 0
                    ? ['ok' => 1, 'index' => $index]
                    : ['error' => 1, 'msg' => 'No se pudo reservar el índice Mostro'];
                break;

            case 'mostro_trade_delete':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                if (!$orderId) { $result = ['error' => 1, 'msg' => 'order_id requerido']; break; }
                NoxtrStore::deleteTrade($userId, $orderId);
                $result = ['ok' => 1];
                break;

            // Filtro de monedas per-usuario (chip 💱). El cliente lo sincroniza al guardarlo
            // en el dialog para que server_monitor.php filtre los avisos de nuevas ofertas.
            case 'save_fiat_filter':
                $codes = [];
                foreach (explode(',', (string)($_ARGS['codes'] ?? '')) as $c) {
                    $c = strtoupper(preg_replace('/[^A-Za-z]/', '', $c));
                    if ($c !== '' && strlen($c) <= 8) $codes[] = $c;
                }
                NoxtrStore::setUserCfg($userId, 'noxtr.fiat_filter', json_encode(array_values(array_unique($codes))));
                $result = ['ok' => 1];
                break;

            // Devuelve el filtro de monedas guardado en CLI_USER_CFG. Fuente de verdad
            // per-usuario: el cliente lo carga al abrir para que sea el mismo en cualquier PC.
            case 'get_fiat_filter':
                $raw = NoxtrStore::getUserCfg($userId, 'noxtr.fiat_filter', '[]');
                $codes = json_decode($raw, true);
                $result = ['codes' => is_array($codes) ? array_values($codes) : []];
                break;

            // Semilla Mostro propia (auditoría 2026-08-22, punto 7: derivación NIP-06 de trade
            // keys). Guardada en CLI_USER_CFG cifrada en reposo con las mismas
            // enc/decTradePrivkey() de NoxtrStore (genéricas pese al nombre: cifran/descifran un
            // string cualquiera, no algo específico de trade_privkey). El cliente cachea la
            // semilla derivada solo en memoria, nunca en localStorage.
            case 'get_mostro_seed':
                if ($userId <= 0) { $result = ['mnemonic' => '']; break; }
                $stored = NoxtrStore::getUserCfg($userId, 'noxtr.mostro_seed', '');
                $result = ['mnemonic' => $stored !== '' ? NoxtrStore::decTradePrivkey($stored) : ''];
                break;

            // No sobreescribe una semilla ya guardada: si el cliente llama a esto dos veces (p.ej.
            // dos pestañas generando en paralelo la primera vez), la primera en escribir gana y la
            // segunda debe seguir usando esa — de lo contrario un usuario podría acabar con trade
            // keys derivadas de dos semillas distintas sin darse cuenta.
            case 'save_mostro_seed':
                if ($userId <= 0) { $result = ['error' => 1, 'msg' => 'Sesión requerida']; break; }
                $existing = NoxtrStore::getUserCfg($userId, 'noxtr.mostro_seed', '');
                if ($existing !== '') {
                    $result = ['ok' => 1, 'mnemonic' => NoxtrStore::decTradePrivkey($existing)];
                    break;
                }
                $mnemonic = trim((string)($_ARGS['mnemonic'] ?? ''));
                if (count(explode(' ', $mnemonic)) !== 12) { $result = ['error' => 1, 'msg' => 'Semilla inválida']; break; }
                $stored = NoxtrStore::setUserCfgIfAbsent(
                    $userId,
                    'noxtr.mostro_seed',
                    NoxtrStore::encTradePrivkey($mnemonic)
                );
                if ($stored === '') { $result = ['error' => 1, 'msg' => 'No se pudo guardar la semilla']; break; }
                // Si otra pestaña ganó la carrera, devolver SU semilla para que ninguna derive
                // una identidad/trade key desde un valor que no quedó persistido.
                $result = ['ok' => 1, 'mnemonic' => NoxtrStore::decTradePrivkey($stored)];
                break;

            case 'get_bitfinex_rates':
                // Proxy mínimo para el ticker público de Bitfinex: el endpoint no expone
                // Access-Control-Allow-Origin y el navegador no puede consultarlo directamente.
                $allowed = ['USD', 'EUR', 'GBP', 'JPY'];
                $requested = array_values(array_unique(array_filter(array_map(function ($c) {
                    return strtoupper(preg_replace('/[^A-Za-z]/', '', $c));
                }, explode(',', (string)($_ARGS['codes'] ?? ''))), function ($c) use ($allowed) {
                    return in_array($c, $allowed, true);
                })));
                if (!$requested) {
                    $result = ['rates' => []];
                    break;
                }
                $symbols = array_map(function ($c) { return 'tBTC' . $c; }, $requested);
                $url = 'https://api-pub.bitfinex.com/v2/tickers?symbols=' . rawurlencode(implode(',', $symbols));
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 8,
                    CURLOPT_CONNECTTIMEOUT => 4,
                    CURLOPT_HTTPHEADER => ['Accept: application/json']
                ]);
                $rawResponse = curl_exec($ch);
                $curlError = curl_error($ch);
                $httpStatus = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($rawResponse === false || $curlError || $httpStatus < 200 || $httpStatus >= 300) {
                    $result = ['error' => 1, 'msg' => 'Bitfinex rate unavailable'];
                    break;
                }
                $rows = json_decode($rawResponse, true);
                $rates = [];
                if (is_array($rows)) {
                    foreach ($rows as $row) {
                        if (!is_array($row) || count($row) < 8) continue;
                        $symbol = (string)($row[0] ?? '');
                        $code = substr($symbol, 4);
                        $last = is_numeric($row[7]) ? (float)$row[7] : 0;
                        if (in_array($code, $requested, true) && $last > 0) $rates[$code] = $last;
                    }
                }
                $result = ['rates' => $rates];
                break;

            // Log de eventos Mostro (gift wrap, rumor desempaquetado, mensaje saliente).
            // El cliente llama a esto desde script.mostro.js tras recibir/enviar cada mensaje.
            // Dedup por event_id (INSERT IGNORE).
            case 'log_mostro_event':
                $eventId  = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['event_id'] ?? '');
                if (!$eventId) { $result = ['error' => 1, 'msg' => 'event_id requerido']; break; }
                $kind     = (int)($_ARGS['kind'] ?? 0);
                $orderId  = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                $createdAt = (int)($_ARGS['event_created_at'] ?? 0);
                $source   = in_array($_ARGS['source'] ?? '', ['client_in','client_out','client_out_plain','client_rumor'])
                    ? $_ARGS['source'] : 'client';
                $status   = substr((string)($_ARGS['status'] ?? ''), 0, 32);
                $rawJson  = (string)($_ARGS['raw_json'] ?? '');
                NoxtrStore::storeMonitorEvent([
                    'event_id'         => $eventId,
                    'kind'             => $kind,
                    'order_id'         => $orderId,
                    'user_id'          => $userId,
                    'event_created_at' => $createdAt,
                    'source'           => $source,
                    'status'           => $status,
                    'raw_json'         => $rawJson,
                ]);
                $result = ['ok' => 1];
                break;

            // Historial cifrado del chat de disputa. Solo se llama DESPUÉS de que el navegador
            // compruebe outer/inner, firmas, autores, tags y timestamps. El id sintético evita
            // colisionar con el log crudo client_in del mismo evento.
            case 'mostro_dispute_chat_store':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                $direction = ($_ARGS['direction'] ?? '') === 'out' ? 'out' : 'in';
                $rawJson = (string)($_ARGS['raw_json'] ?? '');
                $event = json_decode($rawJson, true);
                $trade = $orderId !== '' ? NoxtrStore::getTrade((int)$userId, $orderId) : null;
                $eventId = is_array($event) ? preg_replace('/[^a-fA-F0-9]/', '', (string)($event['id'] ?? '')) : '';
                if (!$trade || strlen($eventId) !== 64 || (int)($event['kind'] ?? 0) !== 14 || strlen($rawJson) > 131072) {
                    $result = ['error' => 1, 'msg' => 'evento de chat no válido'];
                    break;
                }
                NoxtrStore::storeMonitorEvent([
                    'event_id' => 'dchat-' . $direction . '-' . strtolower($eventId),
                    'kind' => 14,
                    'order_id' => $orderId,
                    'user_id' => (int)$userId,
                    'event_created_at' => (int)($event['created_at'] ?? 0),
                    'source' => 'dispute_chat_' . $direction,
                    'status' => 'accepted',
                    'raw_json' => $rawJson,
                ]);
                $result = ['ok' => 1];
                break;

            case 'mostro_dispute_chat_history':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                if (!$orderId || !NoxtrStore::getTrade((int)$userId, $orderId)) {
                    $result = ['error' => 1, 'msg' => 'trade no encontrado'];
                    break;
                }
                $result = ['ok' => 1, 'events' => NoxtrStore::getDisputeChatHistory((int)$userId, $orderId)];
                break;

            // Recupera rumores ya descifrados de un trade propio (log de NSTR_EVENTS). Se usa para
            // volver a sacar la hold invoice de un `pay-invoice` cuando el vendedor cerro el QR sin
            // pagar: el relay puede haber dejado de reenviar el evento, pero el rumor en claro sigue
            // en la BD del usuario. Acotado a acciones concretas y a trades del propio usuario.
            case 'mostro_get_rumors':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                $action  = preg_replace('/[^a-z\-]/', '', strtolower($_ARGS['rumor_action'] ?? ''));
                if (!$orderId || !$action) { $result = ['error' => 1, 'msg' => 'order_id y rumor_action requeridos']; break; }
                if (!in_array($action, ['pay-invoice', 'pay-bond-invoice'], true)) {
                    $result = ['error' => 1, 'msg' => 'accion no permitida'];
                    break;
                }
                $result = ['ok' => 1, 'data' => NoxtrStore::getTradeRumors((int)$userId, $orderId, $action)];
                break;

            // Poda de higiene, SOBRE TODOS LOS USUARIOS. Solo administradores.
            //
            // Dos podas independientes (ver sus docblocks en NoxtrStore):
            //  - pruneClosedTrades(null, $days): borra el log de eventos de trades cerrados hace más
            //    de $days y vacía su trade_privkey, para que un volcado de la BD no contenga a la vez
            //    el ciphertext y la clave que lo descifra.
            //  - pruneOrderBookEvents($obDays, $maxRows): retención del log de avisos del order book
            //    público (órdenes de terceros), que ninguna otra cosa limpia.
            //  - pruneUnlinkedEvents($obDays, $maxRows): eventos sin trade conocido — order_id vacío
            //    (los `client_in` con el ciphertext, y el canal de control) y huérfanos de trades ya
            //    desaparecidos. Es la mayor parte de la tabla y la que ninguna otra poda alcanza.
            //
            // Es DESTRUCTIVO e irreversible. El suelo de 15 días no se puede bajar desde aquí: por
            // debajo se rompen casos legítimos (valoración tardía del peer, reapertura de disputa).
            // `max_rows` acota la primera pasada sobre un log antiguo, que puede abarcar decenas de
            // miles de filas; si devuelve justo ese tope, quedan más y conviene volver a llamar.
            case 'mostro_prune':
                // Fail closed: si por lo que sea Administrador() no estuviera cargada, se deniega.
                if (!function_exists('Administrador') || !Administrador()) {
                    $result = ['error' => 1, 'code' => 'forbidden', 'msg' => 'Solo administradores'];
                    break;
                }
                $pruneDays   = max(15, (int)($_ARGS['days'] ?? 15));
                $obDays      = max(7,  (int)($_ARGS['orderbook_days'] ?? 30));
                $obMaxRows   = max(0,  (int)($_ARGS['max_rows'] ?? 5000));

                $pruned        = NoxtrStore::pruneClosedTrades(null, $pruneDays);
                $obDeleted     = NoxtrStore::pruneOrderBookEvents($obDays, $obMaxRows);
                $unlinkedDeleted = NoxtrStore::pruneUnlinkedEvents($obDays, $obMaxRows);

                // Acción destructiva de administrador: queda traza en el log del servidor.
                error_log(sprintf(
                    '[noxtr] mostro_prune por user_id=%d: trades=%d events=%d keys=%d orderbook_events=%d unlinked_events=%d (days=%d, orderbook_days=%d)',
                    (int)$userId, $pruned['trades'], $pruned['events'], $pruned['keys'],
                    $obDeleted, $unlinkedDeleted, $pruneDays, $obDays
                ));

                $result = [
                    'ok'               => 1,
                    'trades'           => $pruned['trades'],
                    'events'           => $pruned['events'],
                    'keys'             => $pruned['keys'],
                    'orderbook_events' => $obDeleted,
                    'unlinked_events'  => $unlinkedDeleted,
                    'days'             => $pruneDays,
                    'orderbook_days'   => $obDays,
                    // true = alguna poda acotada llegó a su tope: quedan filas, volver a llamar.
                    'more'             => ($obMaxRows > 0
                                           && ($obDeleted >= $obMaxRows || $unlinkedDeleted >= $obMaxRows)),
                ];
                break;
            /*
            Uso, desde la consola de un administrador:
            MostroTrader._ajax('mostro_prune', {}).then(r => console.log(r));
            Con parámetros, todos opcionales:


            MostroTrader._ajax('mostro_prune', {
            days: 15,             // trades cerrados hace más de N días (suelo 15)
            orderbook_days: 30,   // avisos del order book más antiguos que N días (suelo 7)
            max_rows: 5000        // tope de filas del order book por pasada; 0 = sin tope
            });
            Devuelve {ok, trades, events, keys, orderbook_events, days, orderbook_days, more}.  
            */

            // ---- ON-CHAIN ESCROW (NostrEscrow) ----
            // Persistencia y proxies de cadena/PoW/broadcast. La criptografía y las claves privadas
            // Bitcoin permanecen en el navegador; estos endpoints nunca deben custodiar esa clave.

            case 'onchain_trade_add':
                // Persiste un trade on-chain en NSTR_TRADES con method='onchain'.
                // Llamado desde Onchain.Trader.createOrder() / takeOrder() antes de publicar/enviar.
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                $tradeKind = in_array($_ARGS['trade_kind'] ?? '', ['buy','sell']) ? $_ARGS['trade_kind'] : 'sell';
                $tradeRole = in_array($_ARGS['trade_role'] ?? '', ['created','taken']) ? $_ARGS['trade_role'] : 'created';
                $tradePrivkey = preg_replace('/[^a-f0-9]/', '', strtolower($_ARGS['trade_privkey'] ?? ''));
                $tradePub = preg_replace('/[^a-f0-9]/', '', strtolower($_ARGS['trade_key_pub'] ?? ''));
                $isSeller = (int)($_ARGS['is_seller'] ?? 0);
                $tradeIndex = max(0, (int)($_ARGS['trade_index'] ?? 0));
                $satAmount = (int)($_ARGS['sat_amount'] ?? 0);
                $fiatCode = strtoupper(preg_replace('/[^A-Za-z]/', '', $_ARGS['fiat_code'] ?? ''));
                $fiatAmount = substr(preg_replace('/[^0-9\-\.]/', '', $_ARGS['fiat_amount'] ?? ''), 0, 20);
                $paymentMethod = substr(strip_tags($_ARGS['payment_method'] ?? ''), 0, 255);
                $arbitrators = substr(strip_tags($_ARGS['arbitrators'] ?? ''), 0, 1024);
                $taprootAddress = preg_replace('/[^a-zA-Z0-9]/', '', $_ARGS['taproot_address'] ?? '');
                $tradeJson = substr((string)($_ARGS['trade_json'] ?? ''), 0, 8192);
                $validStatus = ['creado','pendiente_aceptacion','aceptado','funded','fiat_sent','fiat_received','completado','cancelado','disputado','archivado'];
                $intStatus = in_array($_ARGS['internal_status'] ?? '', $validStatus) ? $_ARGS['internal_status'] : 'creado';

                // On-chain es client-custody: la privada no debe cruzar ni guardarse en el servidor.
                // Las filas legacy existentes se pueden leer/migrar, pero ningún alta nueva la acepta.
                if (!$orderId || !$fiatCode || $tradePrivkey !== '' || strlen($tradePub) !== 64) {
                    $result = ['error' => 1, 'msg' => 'Datos incompletos o inválidos'];
                    break;
                }
                $existingTrade = NoxtrStore::getTrade($userId, $orderId);
                if ($existingTrade) {
                    $update = [
                        'method'          => 'onchain',
                        'trade_kind'      => $tradeKind,
                        'trade_role'      => $tradeRole,
                        'trade_privkey'   => $tradePrivkey,
                        'trade_key_pub'   => $tradePub,
                        'trade_index'     => $tradeIndex,
                        'is_seller'       => $isSeller,
                        'sat_amount'      => $satAmount,
                        'fiat_code'       => $fiatCode,
                        'fiat_amount'     => $fiatAmount,
                        'payment_method'  => $paymentMethod,
                        'internal_status' => $intStatus,
                        'status'          => $intStatus,
                        'archived'        => 0,
                    ];
                    if ($arbitrators !== '') $update['arbitrators'] = $arbitrators;
                    if ($taprootAddress !== '') $update['taproot_address'] = $taprootAddress;
                    if ($tradeJson !== '') $update['trade_json'] = $tradeJson;
                    NoxtrStore::updateTrade($userId, $orderId, $update);
                    $result = ['ok' => 1, 'id' => (int)($existingTrade['id'] ?? 0), 'order_id' => $orderId, 'reused' => 1];
                    break;
                }
                $newId = NoxtrStore::addTrade($userId, [
                    'method'          => 'onchain',
                    'order_id'        => $orderId,
                    'trade_kind'      => $tradeKind,
                    'trade_role'      => $tradeRole,
                    'trade_privkey'   => $tradePrivkey,
                    'trade_key_pub'   => $tradePub,
                    'trade_index'     => $tradeIndex,
                    'is_seller'       => $isSeller,
                    'sat_amount'      => $satAmount,
                    'fiat_code'       => $fiatCode,
                    'fiat_amount'     => $fiatAmount,
                    'payment_method'  => $paymentMethod,
                    'arbitrators'     => $arbitrators,
                    'taproot_address' => $taprootAddress,
                    'trade_json'      => $tradeJson,
                    'internal_status' => $intStatus,
                    'status'          => $intStatus,
                ]);
                $result = $newId
                    ? ['ok' => 1, 'id' => $newId, 'order_id' => $orderId]
                    : ['error' => 1, 'msg' => 'Error al guardar'];
                break;

            case 'mine_pow':
                // POST: event_json='<json>' difficulty='16'
                // Returns: { event: {...with nonce tag added...}, id: '<hex>', iterations: N }
                // Optimización para móviles débiles. El navegador puede minar 16 bits PoW solo en ~100-1000ms.
                // Server cap a difficulty <= 24 para evitar runaway (16M iter promedio = ~16s).
                $diff = max(0, min(24, (int)($_ARGS['difficulty'] ?? 16)));
                $eventJson = (string)($_ARGS['event_json'] ?? '');
                $event = json_decode($eventJson, true);
                if (!is_array($event) || !isset($event['pubkey'], $event['kind'], $event['created_at'])) {
                    $result = ['error' => 1, 'msg' => 'event_json inválido o incompleto'];
                    break;
                }
                // Validación pubkey: 64 hex chars
                if (!is_string($event['pubkey']) || !preg_match('/^[a-f0-9]{64}$/', strtolower($event['pubkey']))) {
                    $result = ['error' => 1, 'msg' => 'pubkey debe ser 64 hex chars'];
                    break;
                }
                $event['pubkey'] = strtolower($event['pubkey']);
                $event['kind'] = (int)$event['kind'];
                $event['created_at'] = (int)$event['created_at'];
                $event['content'] = (string)($event['content'] ?? '');
                $event['tags'] = is_array($event['tags'] ?? null) ? $event['tags'] : [];
                $tStart = microtime(true);
                try {
                    $mined = noxtr_pow_mine($event, $diff);
                    $result = [
                        'ok'         => 1,
                        'event'      => $mined['event'],
                        'id'         => $mined['id'],
                        'iterations' => $mined['iterations'],
                        'ms'         => (int)((microtime(true) - $tStart) * 1000)
                    ];
                } catch (Exception $e) {
                    $result = ['error' => 1, 'msg' => $e->getMessage()];
                }
                break;

            case 'verify_funding':
                // Input:  { address, expected_sats }
                // Output (3 casos):
                //   - match: { ok, found:1, txid, vout, value_sats, confirmations, block_height, source }
                //   - amount mismatch: { ok, found:0, amount_mismatch:1, received_sats, expected_sats, outputs[] }
                //   - sin deposito: { ok, found:0 }
                // Estrategia:
                //   1. Si hay RPC configurada, scantxoutset sobre la direccion (no requiere watch-only).
                //   2. Si RPC no esta o no devuelve nada, fallback a mempool.space /address/<addr>/txs.
                $addr        = trim((string)($_ARGS['address'] ?? ''));
                $expectedSat = (int)($_ARGS['expected_sats'] ?? 0);
                $expectedTxid = preg_replace('/[^a-f0-9]/', '', strtolower((string)($_ARGS['expected_txid'] ?? '')));
                $expectedVout = array_key_exists('expected_vout', $_ARGS) ? (int)$_ARGS['expected_vout'] : null;
                if ($expectedTxid !== '' && strlen($expectedTxid) !== 64) {
                    $result = ['error' => 1, 'msg' => 'expected_txid inválido'];
                    break;
                }
                if ($expectedVout !== null && $expectedVout < 0) {
                    $result = ['error' => 1, 'msg' => 'expected_vout inválido'];
                    break;
                }
                $network     = strtolower((string)($_ARGS['network'] ?? 'mainnet'));
                if (!in_array($network, ['mainnet','testnet','signet'], true)) {
                    $result = ['error' => 1, 'msg' => 'network inválida'];
                    break;
                }
                if ($addr === '' || $expectedSat <= 0) {
                    $result = ['error' => 1, 'msg' => 'address y expected_sats requeridos'];
                    break;
                }
                // El HRP debe corresponder a la red: mainnet->bc1p, testnet/signet->tb1p. Sin esto
                // se podria consultar una bc1p en testnet/signet (o al reves) contra el backend
                // equivocado, leyendo una cadena distinta.
                $hrpOk = ($network === 'mainnet')
                    ? (bool)preg_match('/^bc1p[0-9a-z]{39,87}$/', $addr)
                    : (bool)preg_match('/^tb1p[0-9a-z]{39,87}$/', $addr);
                if (!$hrpOk) {
                    $result = ['error' => 1, 'msg' => 'address no corresponde a la red ' . $network];
                    break;
                }
                // Seleccionar backend mempool segun red. mainnet usa el base configurado; testnet/signet
                // usan override CFG si existe, o el patron publico mempool.space/<net>/api.
                if ($network !== 'mainnet') {
                    $netOverride = ($network === 'signet')
                        ? (string)(CFG::$vars['btcpay']['mempool_api_url_signet'] ?? '')
                        : (string)(CFG::$vars['btcpay']['mempool_api_url_testnet'] ?? '');
                    MempoolApi::setBase($netOverride !== '' ? $netOverride : ('https://mempool.space/' . $network . '/api'));
                }
                // RPC solo para la red para la que esta configurado (default mainnet). En otras redes,
                // se ignora RPC y se usa solo mempool.space para no leer la cadena equivocada.
                $rpcNetwork = strtolower((string)(CFG::$vars['btcpay']['rpc_network'] ?? 'mainnet'));
                $useRpc = BitcoinRpc::isConfigured() && ($rpcNetwork === $network);

                // Recolectamos TODOS los outputs que paguen a esta direccion (no solo el que matchea
                // expected_sats). Asi distinguimos "no hay deposito" de "deposito con cantidad incorrecta".
                $allOutputs = [];

                // 1) Bitcoin Core RPC (scantxoutset). El descriptor addr() acepta bech32m.
                if ($useRpc) {
                    $scan = BitcoinRpc::call('scantxoutset', ['start', [['desc' => 'addr(' . $addr . ')']]]);
                    if (!$scan['error'] && is_array($scan['result']) && !empty($scan['result']['unspents'])) {
                        $tipHeight = (int)($scan['result']['height'] ?? 0);
                        foreach ($scan['result']['unspents'] as $u) {
                            $valueSats     = (int)round(((float)($u['amount'] ?? 0)) * 1e8);
                            $txBlockHeight = (int)($u['height'] ?? 0);
                            $confs         = ($txBlockHeight > 0 && $tipHeight > 0) ? max(0, $tipHeight - $txBlockHeight + 1) : 0;
                            $allOutputs[]  = [
                                'txid'          => (string)($u['txid'] ?? ''),
                                'vout'          => (int)($u['vout'] ?? 0),
                                'value_sats'    => $valueSats,
                                'confirmations' => $confs,
                                'block_height'  => $txBlockHeight,
                                'source'        => 'rpc',
                            ];
                        }
                    }
                }

                // 2) Fallback mempool.space si RPC no devolvio nada.
                if (empty($allOutputs)) {
                    $tipResp   = MempoolApi::get('blocks/tip/height');
                    $tipHeight = ($tipResp['code'] === 200) ? (int)trim($tipResp['body']) : 0;
                    $txsResp   = MempoolApi::get('address/' . rawurlencode($addr) . '/txs');
                    if ($txsResp['code'] === 200 && is_array($txsResp['json'])) {
                        foreach ($txsResp['json'] as $tx) {
                            $vouts = $tx['vout'] ?? [];
                            if (!is_array($vouts)) continue;
                            $hasCandidate = false;
                            foreach ($vouts as $vo) {
                                if (((string)($vo['scriptpubkey_address'] ?? '')) === $addr) {
                                    $hasCandidate = true;
                                    break;
                                }
                            }
                            if (!$hasCandidate) continue;
                            $outspends = null;
                            $outTxid = (string)($tx['txid'] ?? '');
                            if (preg_match('/^[a-f0-9]{64}$/', $outTxid)) {
                                $os = MempoolApi::get('tx/' . $outTxid . '/outspends');
                                if ($os['code'] === 200 && is_array($os['json'])) $outspends = $os['json'];
                            }
                            foreach ($vouts as $i => $vo) {
                                if (((string)($vo['scriptpubkey_address'] ?? '')) !== $addr) continue;
                                // El historial de una dirección incluye UTXOs ya gastados. Si no
                                // podemos demostrar que este output sigue libre, no es funding válido.
                                if (!is_array($outspends) || !isset($outspends[$i]) || !empty($outspends[$i]['spent'])) continue;
                                $valueSats    = (int)($vo['value'] ?? 0);
                                $confirmed    = (bool)($tx['status']['confirmed'] ?? false);
                                $blockH       = (int)($tx['status']['block_height'] ?? 0);
                                $confs        = ($confirmed && $blockH > 0 && $tipHeight > 0) ? max(0, $tipHeight - $blockH + 1) : 0;
                                $allOutputs[] = [
                                    'txid'          => (string)($tx['txid'] ?? ''),
                                    'vout'          => (int)$i,
                                    'value_sats'    => $valueSats,
                                    'confirmations' => $confs,
                                    'block_height'  => $blockH,
                                    'source'        => 'mempool.space',
                                ];
                            }
                        }
                    }
                }

                // Buscar match exacto del expected_sats. Si lo hay, devolvemos eso.
                $matched = null;
                foreach ($allOutputs as $o) {
                    if ($o['value_sats'] !== $expectedSat) continue;
                    if ($expectedTxid !== '' && strtolower((string)$o['txid']) !== $expectedTxid) continue;
                    if ($expectedVout !== null && (int)$o['vout'] !== $expectedVout) continue;
                    $matched = $o;
                    break;
                }
                if ($matched) {
                    $result = array_merge(['ok' => 1, 'found' => 1, 'network' => $network], $matched);
                    break;
                }
                if (!empty($allOutputs)) {
                    // Hay outputs pero ninguno coincide → mismatch. La UI mostrara aviso explicito.
                    $totalReceived = 0;
                    foreach ($allOutputs as $o) $totalReceived += $o['value_sats'];
                    $result = [
                        'ok'              => 1,
                        'found'           => 0,
                        'amount_mismatch' => 1,
                        'received_sats'   => $totalReceived,
                        'expected_sats'   => $expectedSat,
                        'network'         => $network,
                        'outputs'         => $allOutputs,
                    ];
                    break;
                }
                $result = ['ok' => 1, 'found' => 0, 'network' => $network];
                break;

            case 'tx_status':
                // POST: { txid, network }. Devuelve el estado de confirmacion de una TX (la de
                // liberacion cooperativa). { ok, found, confirmed, confirmations, network }.
                $txid    = strtolower(trim((string)($_ARGS['txid'] ?? '')));
                $network = strtolower((string)($_ARGS['network'] ?? 'mainnet'));
                if (!in_array($network, ['mainnet','testnet','signet'], true)) {
                    $result = ['error' => 1, 'msg' => 'network inválida'];
                    break;
                }
                if (!preg_match('/^[0-9a-f]{64}$/', $txid)) { $result = ['error' => 1, 'msg' => 'txid invalido']; break; }
                if ($network !== 'mainnet') {
                    $netOverride = ($network === 'signet')
                        ? (string)(CFG::$vars['btcpay']['mempool_api_url_signet'] ?? '')
                        : (string)(CFG::$vars['btcpay']['mempool_api_url_testnet'] ?? '');
                    MempoolApi::setBase($netOverride !== '' ? $netOverride : ('https://mempool.space/' . $network . '/api'));
                }
                $rpcNetwork = strtolower((string)(CFG::$vars['btcpay']['rpc_network'] ?? 'mainnet'));
                if (BitcoinRpc::isConfigured() && $rpcNetwork === $network) {
                    $r = BitcoinRpc::call('getrawtransaction', [$txid, true]);
                    if ($r['error'] === null && is_array($r['result'])) {
                        $confs = (int)($r['result']['confirmations'] ?? 0);
                        $result = ['ok' => 1, 'found' => 1, 'confirmed' => ($confs > 0), 'confirmations' => $confs, 'network' => $network, 'source' => 'rpc'];
                        break;
                    }
                    // RPC no lo encuentra: caemos a mempool (read-only; la base ya esta fijada a la red correcta).
                }
                $st = MempoolApi::get('tx/' . $txid . '/status');
                if ((int)($st['code'] ?? 0) === 200 && is_array($st['json'])) {
                    $confirmed = (bool)($st['json']['confirmed'] ?? false);
                    $bh        = (int)($st['json']['block_height'] ?? 0);
                    $confs     = 0;
                    if ($confirmed && $bh > 0) {
                        $tip  = MempoolApi::get('blocks/tip/height');
                        $tipH = ((int)($tip['code'] ?? 0) === 200) ? (int)trim((string)$tip['body']) : 0;
                        $confs = ($tipH > 0) ? max(1, $tipH - $bh + 1) : 1;
                    }
                    $result = ['ok' => 1, 'found' => 1, 'confirmed' => $confirmed, 'confirmations' => $confs, 'block_height' => $bh, 'network' => $network, 'source' => 'mempool.space'];
                    break;
                }
                // No encontrada todavia (propagando) o error transitorio.
                $result = ['ok' => 1, 'found' => 0, 'confirmed' => false, 'confirmations' => 0, 'network' => $network];
                break;

            case 'recommended_fees':
                // POST: { network }. Devuelve fees recomendadas en sat/vB para que el cliente pre-rellene
                // el prompt de fee de los spends Taproot (coop/arb/recovery). Intenta Bitcoin Core RPC
                // (estimatesmartfee) si la red coincide; si no, mempool.space /v1/fees/recommended.
                // { ok, fastestFee, halfHourFee, hourFee, economyFee, minimumFee, network, source }.
                $network = strtolower((string)($_ARGS['network'] ?? 'mainnet'));
                if (!in_array($network, ['mainnet','testnet','signet'], true)) {
                    $result = ['error' => 1, 'msg' => 'network inválida'];
                    break;
                }
                $fees = ['fastestFee' => 0, 'halfHourFee' => 0, 'hourFee' => 0, 'economyFee' => 0, 'minimumFee' => 1];
                $source = '';
                $rpcNetwork = strtolower((string)(CFG::$vars['btcpay']['rpc_network'] ?? 'mainnet'));
                if (BitcoinRpc::isConfigured() && $rpcNetwork === $network) {
                    // estimatesmartfee devuelve BTC/kvB; * 100000 = sat/vB. Si el nodo no tiene datos
                    // suficientes (testnet recien sincronizado) devuelve errors; mantenemos los 0 y
                    // dejamos que el fallback mempool.space cubra el hueco.
                    $f1 = BitcoinRpc::call('estimatesmartfee', [1]);
                    $f3 = BitcoinRpc::call('estimatesmartfee', [3]);
                    $f6 = BitcoinRpc::call('estimatesmartfee', [6]);
                    $f144 = BitcoinRpc::call('estimatesmartfee', [144]);
                    if ($f1['error'] === null && isset($f1['result']['feerate']))   $fees['fastestFee']  = max(1, (int)round($f1['result']['feerate']  * 100000));
                    if ($f3['error'] === null && isset($f3['result']['feerate']))   $fees['halfHourFee'] = max(1, (int)round($f3['result']['feerate']  * 100000));
                    if ($f6['error'] === null && isset($f6['result']['feerate']))   $fees['hourFee']     = max(1, (int)round($f6['result']['feerate']  * 100000));
                    if ($f144['error'] === null && isset($f144['result']['feerate'])) $fees['economyFee']  = max(1, (int)round($f144['result']['feerate'] * 100000));
                    if ($fees['halfHourFee'] > 0) $source = 'rpc';
                }
                if ($source === '') {
                    if ($network !== 'mainnet') {
                        $netOverride = ($network === 'signet')
                            ? (string)(CFG::$vars['btcpay']['mempool_api_url_signet'] ?? '')
                            : (string)(CFG::$vars['btcpay']['mempool_api_url_testnet'] ?? '');
                        MempoolApi::setBase($netOverride !== '' ? $netOverride : ('https://mempool.space/' . $network . '/api'));
                    }
                    $r = MempoolApi::get('v1/fees/recommended');
                    if ((int)($r['code'] ?? 0) === 200 && is_array($r['json'])) {
                        $j = $r['json'];
                        foreach (['fastestFee','halfHourFee','hourFee','economyFee','minimumFee'] as $k) {
                            if (isset($j[$k])) $fees[$k] = max(1, (int)$j[$k]);
                        }
                        $source = 'mempool.space';
                    }
                }
                // Defaults conservadores si nada respondio (signet/testnet con relay min ~1 sat/vB).
                if ($source === '') {
                    $fees = ['fastestFee' => 5, 'halfHourFee' => 3, 'hourFee' => 2, 'economyFee' => 1, 'minimumFee' => 1];
                    $source = 'default';
                }
                $result = array_merge(['ok' => 1, 'network' => $network, 'source' => $source], $fees);
                break;

            case 'prepare_trade':
                // POST: { trade_id, alice_pubkey, bob_pubkey, arbitrators[], amount, buyer_address }
                // Returns: { internal_key, taproot_address, leaves[], merkle_root, unsigned_tx_hex }
                // Pre-compute del taptree. El browser MUST verificar la dirección antes de usarla.
                $result = ['error' => 1, 'msg' => 'prepare_trade: not implemented yet (Phase 2)'];
                break;

            case 'broadcast_tx':
                // POST: { tx_hex, network }
                // Returns: { ok, txid, network, source } o { error, msg }.
                // Proxy a bitcoind sendrawtransaction (si hay RPC para esa red) o mempool.space POST /tx.
                $txHex   = strtolower(trim((string)($_ARGS['tx_hex'] ?? '')));
                $network = strtolower((string)($_ARGS['network'] ?? 'mainnet'));
                if (!in_array($network, ['mainnet','testnet','signet'], true)) {
                    $result = ['error' => 1, 'msg' => 'network inválida'];
                    break;
                }
                if ($txHex === '' || !preg_match('/^[0-9a-f]+$/', $txHex) || strlen($txHex) % 2 !== 0) {
                    $result = ['error' => 1, 'msg' => 'tx_hex invalido'];
                    break;
                }
                if (strlen($txHex) > 200000) { $result = ['error' => 1, 'msg' => 'tx_hex demasiado grande']; break; }
                // Mismo criterio de backend por red que verify_funding: no difundir contra otra cadena.
                if ($network !== 'mainnet') {
                    $netOverride = ($network === 'signet')
                        ? (string)(CFG::$vars['btcpay']['mempool_api_url_signet'] ?? '')
                        : (string)(CFG::$vars['btcpay']['mempool_api_url_testnet'] ?? '');
                    MempoolApi::setBase($netOverride !== '' ? $netOverride : ('https://mempool.space/' . $network . '/api'));
                }
                $rpcNetwork = strtolower((string)(CFG::$vars['btcpay']['rpc_network'] ?? 'mainnet'));
                if (BitcoinRpc::isConfigured() && $rpcNetwork === $network) {
                    $rpc = BitcoinRpc::call('sendrawtransaction', [$txHex]);
                    if ($rpc['error'] === null && is_string($rpc['result']) && preg_match('/^[0-9a-f]{64}$/', $rpc['result'])) {
                        $result = ['ok' => 1, 'txid' => $rpc['result'], 'network' => $network, 'source' => 'rpc'];
                        break;
                    }
                    // No hacemos fallback a mempool: el RPC es la red configurada y su error es informativo.
                    $errMsg = is_array($rpc['error']) ? json_encode($rpc['error']) : (string)$rpc['error'];
                    $result = ['error' => 1, 'msg' => 'RPC: ' . $errMsg, 'network' => $network];
                    break;
                }
                $resp = MempoolApi::post('tx', $txHex);
                $bodyTrim = trim((string)($resp['body'] ?? ''));
                if (($resp['code'] ?? 0) === 200 && preg_match('/^[0-9a-f]{64}$/', $bodyTrim)) {
                    $result = ['ok' => 1, 'txid' => $bodyTrim, 'network' => $network, 'source' => 'mempool.space'];
                    break;
                }
                $result = ['error' => 1, 'network' => $network,
                    'msg' => $bodyTrim !== '' ? $bodyTrim : ('broadcast fallo (HTTP ' . (int)($resp['code'] ?? 0) . ')')];
                break;

            case 'set_site_arbitrator':
                // Designa (o borra) la pubkey_btc del arbitro del sitio (arb1 por defecto, tier site_admin).
                // SOLO Root/Administradores: la confianza site_admin la sirve el servidor a todos los clientes
                // via footer.php, asi que quien escribe esta CFG debe ser el operador del sitio.
                if (!($_ACL->userHasRoleName('Root') || $_ACL->userHasRoleName('Administradores'))) {
                    $result = ['error' => 1, 'msg' => 'Solo Root/Administradores pueden designar el arbitro del sitio.'];
                    break;
                }
                $pk = strtolower(preg_replace('/[^a-f0-9]/', '', (string)($_ARGS['pubkey_btc'] ?? '')));
                if ($pk !== '' && strlen($pk) !== 64) {
                    $result = ['error' => 1, 'msg' => 'pubkey_btc debe ser 64 hex x-only (o vacio para quitar).'];
                    break;
                }
                NoxtrStore::setCfgValue('modules.noxtr.onchain_site_arbitrator', $pk,
                    'Pubkey BTC x-only del arbitro del sitio (arb1 por defecto on-chain)', 1);
                $result = ['ok' => 1, 'pubkey_btc' => $pk];
                break;

            case 'set_arbitrator_block':
                // Bloquea (o desbloquea) una identidad Nostr de arbitro para TODA esta web: deja de
                // aparecer en el selector de arbitros de todos los usuarios. No borra el anuncio en los
                // relays (Nostr es descentralizado), solo lo oculta en esta instancia. SOLO Root/Admins:
                // es la web del operador. La lista se sirve a los clientes via footer.php.
                if (!($_ACL->userHasRoleName('Root') || $_ACL->userHasRoleName('Administradores'))) {
                    $result = ['error' => 1, 'msg' => 'Solo Root/Administradores pueden quitar arbitros del sitio.'];
                    break;
                }
                $npub = strtolower(preg_replace('/[^a-f0-9]/', '', (string)($_ARGS['nostr_pubkey'] ?? '')));
                if (strlen($npub) !== 64) {
                    $result = ['error' => 1, 'msg' => 'nostr_pubkey debe ser 64 hex.'];
                    break;
                }
                $blocked = (int)($_ARGS['blocked'] ?? 1) === 1;
                $raw = (string)(CFG::$vars['modules']['noxtr']['onchain_blocked_arbitrators']
                    ?? NoxtrStore::getCfgValue('modules.noxtr.onchain_blocked_arbitrators', ''));
                $list = array_values(array_filter(array_map('trim', explode(',', strtolower($raw)))));
                $list = array_values(array_filter($list, function ($h) { return preg_match('/^[a-f0-9]{64}$/', $h); }));
                $list = array_values(array_diff($list, [$npub]));
                if ($blocked) $list[] = $npub;
                $list = array_values(array_unique($list));
                NoxtrStore::setCfgValue('modules.noxtr.onchain_blocked_arbitrators', implode(',', $list),
                    'Identidades Nostr de arbitros ocultadas en este sitio (CSV de pubkeys hex)', 1);
                $result = ['ok' => 1, 'nostr_pubkey' => $npub, 'blocked' => $blocked ? 1 : 0, 'list' => $list];
                break;

            default:
                $result = ['error' => 1, 'msg' => 'Unknown action: ' . $action];
        }
       
        echo json_encode($result);
    
    }else{

        include(SCRIPT_DIR_CLASSES.'/scaffold/ajax.php');

    }
    
