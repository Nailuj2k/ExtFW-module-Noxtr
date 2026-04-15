<?php

    if (!isset($_SESSION['valid_user']) || !$_SESSION['valid_user']) {
        echo json_encode(['error' => 1, 'msg' => 'Not logged in']);
        exit;
    }



    // Merge POST data into $_ARGS (framework only populates $_ARGS from URL path)
    //if (!empty($_POST)) $_ARGS = array_merge($_ARGS ?? [], $_POST);

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


                    if(CFG::$vars['modules']['noxtr']['monitor_relays']==false){
                        $result['error'] = 1;
                        $result['msg'] = 'modules.noxtr.monitor_relays not configured. Set in control_panel/configuration.';
                        echo json_encode($result);
                        exit;                  
                    }

                    /* 
                    define('BOT_START'  , 'DISPLAY=:0 php '.$_SERVER['DOCUMENT_ROOT'].'/index.php noxtr/server/action=monitor > /dev/null &');
                  //define('BOT_START'  , 'php '.$_SERVER['DOCUMENT_ROOT'].'/index.php noxtr/server/action=monitor');
                    define('BOT_STATUS' , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}'");     
                    define('BOT_STOP'   , "ps -ef | grep 'noxtr/server' | grep -v 'grep' | awk '{print  $2}' | xargs kill -9");

                    define('BOT_HOST',CFG::$vars['server']['ssh']['host'] ?? false );
                    define('BOT_USER',CFG::$vars['server']['ssh']['username'] ?? false );     // Estos datos se quitrñan de aqui para ponerlo en la confoguración !!!
                    define('BOT_PASS',CFG::$vars['server']['ssh']['password'] ?? false );  // Ahora estñan aqui solo para probar
                    define('BOT_PORT',CFG::$vars['server']['ssh']['port'] ?? '22');
                    */ 
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
                if (strlen($eventId) === 64 && ctype_xdigit($eventId)) {
                    NoxtrStore::saveMessage($userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, $eventCreatedAt);
                } else {
                    $result = ['error' => 1, 'msg' => 'Invalid event'];
                }
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
                    "SELECT NOSTR_USER, BIO, USER_URL_AVATAR, AUTH_PROVIDER, AUTH_PICTURE FROM CLI_USER WHERE USER_ID = ?",
                    [$userId]
                );
                if ($rows && $rows[0]) {
                    $u = $rows[0];
                    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                    $avatar = '';
                    $img = $u['USER_URL_AVATAR'] ?? '';
                    if ($u['AUTH_PROVIDER'] && $u['AUTH_PICTURE']) {
                        $avatar = $u['AUTH_PICTURE'];
                    } elseif ($img) {
                        if (preg_match('#^https?://#i', $img)) {
                            $avatar = $img;
                        } else {
                            $avatar = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/media/avatars/' . $img;
                        }
                    }
                    $result['data'] = [
                        'name' => $u['NOSTR_USER'] ?? '',
                        'about' => $u['BIO'] ?? '',
                        'picture' => $avatar
                    ];
                } else {
                    $result = ['error' => 1, 'msg' => 'User not found'];
                }
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
                // Patrón auto-generado: empieza por npub1/nsec1 o es una cadena hexadecimal larga
                $isAutoGenerated = (bool) preg_match('/^n(?:pub|sec)1[a-z0-9]+$/i', $currentUsername)
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
            //$picture = trim($_ARGS['picture'] ?? '');
                $pubkey = trim($_ARGS['pubkey'] ?? '');
                if ($pubkey && preg_match('/^[0-9a-f]{64}$/', $pubkey)) {
                    NoxtrStore::sqlQueryPrepared(
                        "UPDATE CLI_USER SET NOSTR_USER = ?, BIO = ?, nostr_pubkey = ? WHERE USER_ID = ?",  // , user_url_avatar = ?
                        [$name, $about, $pubkey, $userId]            //          [$name, $about, $picture, $pubkey, $userId]
                    );
                } else {
                    NoxtrStore::sqlQueryPrepared(
                        "UPDATE CLI_USER SET NOSTR_USER = ?, BIO = ? WHERE USER_ID = ?",  // , user_url_avatar = ?
                        [$name, $about, $userId]                 //       [$name, $about, $picture, $userId]
                    );
                }
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

                // Check if recipient is a registered user (by nostr_pubkey)
                $recipientRow = NoxtrStore::sqlQueryPrepared(
                    "SELECT user_id, balance_sats FROM CLI_USER WHERE nostr_pubkey = ? LIMIT 1",
                    [$notePubkey]
                );
                $recipientUserId = ($recipientRow && $recipientRow[0]) ? (int)$recipientRow[0]['user_id'] : 0;

                // Internal transfer: recipient is registered, sender has enough balance
                if ($recipientUserId) {
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

                // For external payment, lnAddress is required
                if (!$lnAddress || strpos($lnAddress, '@') === false) {
                    if (!$recipientUserId) {
                        // Not registered and no LN address — cannot zap
                        $result = ['error' => 1, 'msg' => 'No Lightning Address', 'noLnAddress' => true];
                    } else {
                        // Registered but not enough balance
                        $result = ['error' => 1, 'msg' => 'Not enough balance (' . $senderBalance . ' sats)'];
                    }
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

            // ---- IMAGE UPLOAD ----
            case 'upload_image':
                if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
                    $result = ['error' => 1, 'msg' => 'No image uploaded'];
                    break;
                }

                $file = $_FILES['image'];
                $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                $finfo = finfo_open(FILEINFO_MIME_TYPE);
                $mime = finfo_file($finfo, $file['tmp_name']);
                finfo_close($finfo);

                if (!in_array($mime, $allowedTypes)) {
                    $result = ['error' => 1, 'msg' => 'Invalid image type'];
                    break;
                }

                if ($file['size'] > 5 * 1024 * 1024) {
                    $result = ['error' => 1, 'msg' => 'Image too large (max 5MB)'];
                    break;
                }

                $extMap = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];
                $ext = $extMap[$mime] ?? 'jpg';
                $filename = time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
                $uploadDir = $_SERVER['DOCUMENT_ROOT'] . '/media/noxtr/' . $userId;

                if (!is_dir($uploadDir)) {
                    mkdir($uploadDir, 0755, true);
                }

                $destPath = $uploadDir . '/' . $filename;
                if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                    $result = ['error' => 1, 'msg' => 'Failed to save image'];
                    break;
                }

                // Resize if wider than 2000px
                $imgInfo = getimagesize($destPath);
                if ($imgInfo && $imgInfo[0] > 2000) {
                    require_once $_SERVER['DOCUMENT_ROOT'] . '/' . SCRIPT_DIR_CLASSES . '/images.class.php';
                    smart_resize_image($destPath, 2000, 0, true, 'file', true, false);
                }

                $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                $url = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/media/noxtr/' . $userId . '/' . $filename;
                $result['url'] = $url;
                break;

            case 'translate':
                $text = trim($_ARGS['text'] ?? '');
                if (!$text) { $result = ['error' => 1, 'msg' => 'No text']; break; }

                $ollamaKey   = CFG::$vars['ai']['ollama']['api_key'] ?? '052715d1d1e94f6e859b6b3e31a88fe9.1uxCp2CMs78Vlh15CCinrgdI';
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
                    $ch = curl_init($url);
                    curl_setopt_array($ch, [
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_FOLLOWLOCATION => true,
                        CURLOPT_MAXREDIRS      => 3,
                        CURLOPT_TIMEOUT        => 10,
                        CURLOPT_USERAGENT      => 'Mozilla/5.0',
                    ]);
                    $data = curl_exec($ch);
                    $mime = strtolower(explode(';', curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]);
                    curl_close($ch);
                    if (!$data || !in_array(trim($mime), $allowedMimes)) return null;
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
                $satAmount = (int)($_ARGS['sat_amount'] ?? 0);
                $fiatAmount = substr(preg_replace('/[^0-9\-\.]/', '', $_ARGS['fiat_amount'] ?? ''), 0, 20);
                $paymentMethod = substr(strip_tags($_ARGS['payment_method'] ?? ''), 0, 255);
                $intStatus = in_array($_ARGS['internal_status'] ?? '', ['creado','enviando','publicado','esperando_hold_invoice','tomado','esperando_pago_vendedor','activo','fiat_enviado','completado','cancelado','disputado','archivado']) ? $_ARGS['internal_status'] : 'creado';
                if (!$fiatCode || strlen($tradePrivkey) !== 64 || strlen($tradePub) !== 64) {
                    $result = ['error' => 1, 'msg' => 'Datos incompletos o inválidos'];
                    break;
                }
                // Never auto-delete local trades. If a terminal row already exists for this order_id,
                // reuse that same row so the user only loses it when deleting it explicitly.
                $terminalStates = ['cancelado', 'completado', 'disputado', 'archivado'];
                $existingTrade = NoxtrStore::getTrade($userId, $orderId);
                if ($existingTrade) {
                    if (!in_array($existingTrade['internal_status'], $terminalStates, true)) {
                        $result = ['error' => 1, 'msg' => 'Ya existe un trade local para esta orden'];
                        break;
                    }
                    NoxtrStore::updateTrade($userId, $orderId, [
                        'request_id' => 0,
                        'robot_pubkey' => $robotPub,
                        'trade_kind' => $tradeKind,
                        'trade_role' => $tradeRole,
                        'trade_privkey' => $tradePrivkey,
                        'trade_key_pub' => $tradePub,
                        'trade_index' => $tradeIndex,
                        'identity_fingerprint' => '',
                        'trade_action' => '',
                        'status' => $intStatus,
                        'internal_status' => $intStatus,
                        'is_seller' => $isSeller,
                        'fiat_amount' => $fiatAmount,
                        'fiat_code' => $fiatCode,
                        'sat_amount' => $satAmount,
                        'payment_method' => $paymentMethod,
                        'peer_pubkey' => '',
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
                $existingTrade = NoxtrStore::getTrade($userId, $orderId);
                $clean = [];
                $strFields = ['robot_pubkey','trade_kind','trade_role','trade_action','status','internal_status','fiat_amount','fiat_code','payment_method','peer_pubkey'];
                $hexFields = ['trade_privkey','trade_key_pub'];
                $intFields = ['is_seller','sat_amount','trade_index','my_rating','archived'];
                foreach ($strFields as $f) { if (isset($fields[$f])) $clean[$f] = substr(strip_tags((string)$fields[$f]), 0, 512); }
                if (isset($fields['trade_json'])) $clean['trade_json'] = substr((string)$fields['trade_json'], 0, 8192);
                foreach ($hexFields as $f) { if (isset($fields[$f])) { $v = preg_replace('/[^a-f0-9]/','',$fields[$f]); if (strlen($v)===64||$v==='') $clean[$f]=$v; } }
                foreach ($intFields as $f) { if (isset($fields[$f])) $clean[$f] = (int)$fields[$f]; }
                if (isset($fields['order_id'])) $clean['order_id'] = preg_replace('/[^a-zA-Z0-9\-_]/', '', $fields['order_id']);
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
                $result = ['ok' => 1, 'trades' => $trades];
                break;

            case 'mostro_trade_get':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                if (!$orderId) { $result = ['error' => 1, 'msg' => 'order_id requerido']; break; }
                $trades = NoxtrStore::loadTrades($userId, 500);
                $trade = null;
                foreach ($trades as $t) { if ($t['order_id'] === $orderId) { $trade = $t; break; } }
                $result = $trade ? ['ok' => 1, 'trade' => $trade] : ['error' => 1, 'msg' => 'No encontrado'];
                break;

            case 'mostro_trade_delete':
                $orderId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $_ARGS['order_id'] ?? '');
                if (!$orderId) { $result = ['error' => 1, 'msg' => 'order_id requerido']; break; }
                NoxtrStore::deleteTrade($userId, $orderId);
                $result = ['ok' => 1];
                break;

            default:
                $result = ['error' => 1, 'msg' => 'Unknown action: ' . $action];
        }
       
        echo json_encode($result);
    
    }else{

        include(SCRIPT_DIR_CLASSES.'/scaffold/ajax.php');

    }
    
