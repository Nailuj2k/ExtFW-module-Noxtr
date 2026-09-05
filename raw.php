<?php

    require_once SCRIPT_DIR_CLASSES . '/btcpay_lightning.class.php';

    // Redirección de .well-known a noxtr/raw para manejar endpoints especiales sin cargar todo el entorno visual del theme.
    // No borramos estos comentarios por si acaso, para futuras comprobaciones.
    // 
    // si la url es
    //    .well-known/nostr.json?name=pepe
    //       ExtFW la convierte en
    //    noxtr/raw/wellknown/action=nostr.json/name=pepe
    // si la url es
    //    .well-known/lnurlp/pepe
    //        ExtFW la convierte en
    //    noxtr/raw/wellknown/action=lnurlp/name=pepe


    // y aqui tendremos en $_ARGS algo así como

    // $_ARGS[0] = 'noxtr'
    // $_ARGS[1]       = 'raw'
    // $_ARGS[2]       = 'wellknown'

    // $_ARGS[3]        = 'action=nostr.json'
    // $_ARGS[4]        = 'name=pepe'
    // $_ARGS['action'] = 'nostr.json'
    // $_ARGS['name']   = 'pepe'

    // o también

    // $_ARGS[3] = 'action=lnurlp'
    // $_ARGS[4] = 'name=pepe'
    // $_ARGS['action'] = 'lnurlp'
    // $_ARGS['name']   = 'pepe'

    // EN este punto tendremos cargados los archivos de configuración, funciones
    // y clases de ExtFW, pero no se habrá cargado el html del theme ni nada de
    // eso, porque el output es "raw", lo que es perfecto para generar respuestas
    // a estas urls especiales sin necesidad de cargar todo el entorno visual del
    // theme, que no es necesario para este tipo de endpoints.

    // Antes de nada comprobamos que funciona la redirección y que recibimos los parámetros correctamente:
    // echo '<pre>';
    // print_r($_ARGS);
    // echo '</pre>';
    // die(__LINE__);
    
    // Comprobado:
    // con la url https://queesbitcoin.net/.well-known/lnurlp/pepe print_r($_ARGS) imprime:
    // Array ( [0] => noxtr [1] => raw [2] => wellknown [output] => raw [action] => lnurlp [name] => pepe )

    // y .well-known/nostr.json?name=pepe imprime:
    // Array ( [0] => noxtr [1] => raw [2] => wellknown [output] => raw [action] => nostr.json [name] => pepe )

    // Perfecto, ya tenemos la redirección funcionando y los parámetros en $_ARGS. (No borrar estos comentarios!!)

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

/*
 * OLD:
 * @file_put_contents(SCRIPT_DIR_LOG.'/lnurlp_.log', date('Y-m-d H:i:s') . ' REQUEST: ' . $_SERVER['REQUEST_URI'] . "\n" . print_r($_ARGS, true) . "\n---\n", FILE_APPEND);
 *
 * NEW:
 * Logging de debug controlado por flag para evitar escritura continua en producción.
 */
$enableRawDebugLog = true;
if ($enableRawDebugLog) {
    @file_put_contents(SCRIPT_DIR_LOG.'/lnurlp_.log', date('Y-m-d H:i:s') . ' REQUEST: ' . $_SERVER['REQUEST_URI'] . "\n" . print_r($_ARGS, true) . "\n---\n", FILE_APPEND);
}

$action = $_ARGS['action'] ?? '';
$name   = $_ARGS['name'] ?? $_GET['name'] ?? '';

switch ($action) {

    // ======================== NIP-05 ========================
    case 'nostr.json':
        if (!$name || !preg_match('/^[a-zA-Z0-9._-]+$/', $name)) {
            echo json_encode(['names' => new stdClass()]);
            exit;
        }

        $rows = NoxtrStore::sqlQueryPrepared(
            "SELECT username, nostr_pubkey FROM CLI_USER WHERE username = ? AND user_active = 1 AND nostr_pubkey != '' LIMIT 1",
            [$name]
        );
        $user = $rows[0] ?? null;

        if (!$user) {
            echo json_encode(['names' => new stdClass()]);
            exit;
        }

        echo json_encode([
            'names' => [$user['username'] => $user['nostr_pubkey']]
        ]);
        exit;

    // ======================== LNURL-pay ========================
    case 'lnurlp':
        if (!$name || !preg_match('/^[a-zA-Z0-9._-]+$/', $name)) {
            http_response_code(404);
            echo json_encode(['status' => 'ERROR', 'reason' => 'Not found']);
            exit;
        }

        // Find user
        $rows = NoxtrStore::sqlQueryPrepared(
            "SELECT user_id, username, nostr_pubkey FROM CLI_USER WHERE username = ? AND user_active = 1 LIMIT 1",
            [$name]
        );
        $user = $rows[0] ?? null;

        if (!$user) {
            http_response_code(404);
            echo json_encode(['status' => 'ERROR', 'reason' => 'User not found']);
            exit;
        }

        // Load server Nostr keypair and BTCPay config from CFG_CFG
        $cfgRows = NoxtrStore::sqlQueryPrepared(
            "SELECT V, K FROM CFG_CFG WHERE K LIKE ? OR K LIKE ?",
            ['modules.noxtr.%', 'btcpay.%']
        );
        $cfgAll = [];
        foreach ($cfgRows ?: [] as $row) {
            $cfgAll[$row['K']] = $row['V'];
        }

        $lightningStatus = BtcpayLightning::status([
            'url' => $cfgAll['btcpay.url'] ?? '',
            'store_id' => $cfgAll['btcpay.store_id'] ?? '',
            'api_key' => $cfgAll['btcpay.api_key'] ?? '',
            'lightning_active' => NoxtrStore::getCfgValue('btcpay.lightning_active', ''),
        ]);
        if (!$lightningStatus['available']) {
            echo json_encode([
                'status' => 'ERROR',
                'reason' => BtcpayLightning::unavailableMessage($lightningStatus),
                'code' => 'LIGHTNING_UNAVAILABLE',
            ]);
            exit;
        }

        $serverPrivkey = $cfgAll['modules.noxtr.server_privkey'] ?? '';
        $serverPubkey  = $cfgAll['modules.noxtr.server_pubkey'] ?? '';

        // Auto-generate server keypair if missing
        if (!$serverPrivkey && extension_loaded('gmp')) {
            ///////////////////////. require_once __DIR__ . '/nostr_crypto.php';
            $kp = NostrCrypto::generateKeypair();
            $serverPrivkey = $kp['privkey'];
            $serverPubkey  = $kp['pubkey'];

            $isSQLite = CFG::$vars['db']['type'] === 'sqlite';
            if ($isSQLite) {
                NoxtrStore::sqlQueryPrepared(
                    "INSERT INTO CFG_CFG (K, V) VALUES (?, ?) ON CONFLICT(K) DO UPDATE SET V = excluded.V",
                    ['modules.noxtr.server_privkey', $serverPrivkey]
                );
                NoxtrStore::sqlQueryPrepared(
                    "INSERT INTO CFG_CFG (K, V) VALUES (?, ?) ON CONFLICT(K) DO UPDATE SET V = excluded.V",
                    ['modules.noxtr.server_pubkey', $serverPubkey]
                );
            } else {
                NoxtrStore::sqlQueryPrepared(
                    "INSERT INTO CFG_CFG (K, V) VALUES (?, ?) ON DUPLICATE KEY UPDATE V = VALUES(V)",
                    ['modules.noxtr.server_privkey', $serverPrivkey]
                );
                NoxtrStore::sqlQueryPrepared(
                    "INSERT INTO CFG_CFG (K, V) VALUES (?, ?) ON DUPLICATE KEY UPDATE V = VALUES(V)",
                    ['modules.noxtr.server_pubkey', $serverPubkey]
                );
            }
        }

        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host   = $_SERVER['HTTP_HOST'];
        $amount = (int)(isset($_ARGS['amount']) ? $_ARGS['amount'] : ($_GET['amount'] ?? 0));

        // ---------- DISCOVERY (no amount) ----------
        if ($amount === 0) {
            $callbackUrl = $scheme . '://' . $host . '/.well-known/lnurlp/' . urlencode($name);
            $metadata = json_encode([
                ['text/identifier', $name . '@' . $host],
                ['text/plain', 'Sats for ' . $name]
            ]);

            $response = [
                'tag'            => 'payRequest',
                'callback'       => $callbackUrl,
                'minSendable'    => 1000,
                'maxSendable'    => 10000000000,
                'metadata'       => $metadata,
                'commentAllowed' => 255
            ];

            if ($serverPubkey) {
                $response['allowsNostr'] = true;
                $response['nostrPubkey'] = $serverPubkey;
            }

            echo json_encode($response);
            exit;
        }

        // ---------- CALLBACK (create invoice) ----------
        /*
         * OLD:
         * @file_put_contents(SCRIPT_DIR_LOG.'/lnurlp_.log', date('Y-m-d H:i:s') . "\n" . print_r($_ARGS, true) . "\n---\n", FILE_APPEND);
         *
         * NEW:
         * Reutiliza el mismo flag de debug.
         */
        if ($enableRawDebugLog) {
            @file_put_contents(SCRIPT_DIR_LOG.'/lnurlp_.log', date('Y-m-d H:i:s') . "\n" . print_r($_ARGS, true) . "\n---\n", FILE_APPEND);
        }

        $amountSats = (int)floor($amount / 1000);

        if ($amountSats < 1 || $amountSats > 10000000) {
            echo json_encode(['status' => 'ERROR', 'reason' => 'Amount out of range (1-10,000,000 sats)']);
            exit;
        }

        // Validate NIP-57 zap request if present
        $nostrParam = $_ARGS['nostr'] ?? $_GET['nostr'] ?? '';
        $zapRequest = null;
        if ($nostrParam) {
            $nostrParam = urldecode($nostrParam);
            $zapRequest = json_decode($nostrParam, true);

            /*
             * OLD:
             * if (!$zapRequest || ($zapRequest['kind'] ?? 0) !== 9734) { ... }
             *
             * NEW:
             * Añade validación estructural mínima (id/pubkey/sig) + recomputo de event id.
             * La verificación criptográfica de firma se hace más abajo con
             * NostrAuth::verifySchnorr (H-05).
             */
            if (
                !$zapRequest ||
                !is_array($zapRequest) ||
                ($zapRequest['kind'] ?? 0) !== 9734 ||
                !preg_match('/^[0-9a-f]{64}$/', (string)($zapRequest['id'] ?? '')) ||
                !preg_match('/^[0-9a-f]{64}$/', (string)($zapRequest['pubkey'] ?? '')) ||
                !preg_match('/^[0-9a-f]{128}$/', (string)($zapRequest['sig'] ?? '')) ||
                !is_int($zapRequest['created_at'] ?? null) ||
                !is_array($zapRequest['tags'] ?? null)
            ) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Invalid zap request']);
                exit;
            }

            if (!noxtr_validate_event_id($zapRequest)) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Invalid zap event id']);
                exit;
            }

            // H-05: verificar la firma Schnorr del zap request. Reutiliza la
            // verificación BIP-340 del framework (la misma que el monitor usa
            // para los eventos del daemon Mostro). Sin esto, cualquiera puede
            // falsificar un zap request con un pubkey ajeno y una sig de relleno.
            if (!class_exists('NostrAuth')) {
                require_once SCRIPT_DIR_CLASSES . '/nostrauth.class.php';
            }
            if (!NostrAuth::verifySchnorr(
                    (string)$zapRequest['sig'],
                    (string)$zapRequest['id'],
                    (string)$zapRequest['pubkey']
                )) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Invalid zap signature']);
                exit;
            }

            $now = time();
            if (($zapRequest['created_at'] ?? 0) < ($now - 86400) || ($zapRequest['created_at'] ?? 0) > ($now + 300)) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Zap request timestamp out of range']);
                exit;
            }

            $zapAmount = 0;
            $zapRecipient = '';
            foreach ($zapRequest['tags'] ?? [] as $tag) {
                if ($tag[0] === 'amount') $zapAmount = (int)($tag[1] ?? 0);
                if ($tag[0] === 'p') $zapRecipient = $tag[1] ?? '';
            }
            if ($zapAmount && $zapAmount !== $amount) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Amount mismatch']);
                exit;
            }
            if ($zapRecipient && $zapRecipient !== $user['nostr_pubkey']) {
                echo json_encode(['status' => 'ERROR', 'reason' => 'Recipient mismatch']);
                exit;
            }
        }

        // Load BTCPay config
        $btcpayUrl = rtrim($cfgAll['btcpay.url'] ?? '', '/');
        $storeId   = $cfgAll['btcpay.store_id'] ?? '';
        $apiKey    = $cfgAll['btcpay.api_key'] ?? '';

        if (!$btcpayUrl || !$storeId || !$apiKey) {
            echo json_encode(['status' => 'ERROR', 'reason' => 'Payment service not configured']);
            exit;
        }

        $btcAmount  = number_format($amountSats / 100000000, 8, '.', '');
        $webhookUrl = $scheme . '://' . $host . '/page/checkout/bitcoin/callback/raw/';
        $comment    = substr($_ARGS['comment'] ?? $_GET['comment'] ?? '', 0, 255);

        $metadata = [
            'userId'     => 0,
            'authorId'   => (int)$user['user_id'],
            'moduleId'   => 5,
            'articleId'  => 0,
            'amountSats' => $amountSats,
            'lnurlp'     => true,
            'comment'    => $comment,
            'webhook'    => $webhookUrl
        ];

        if ($zapRequest) {
            $metadata['zapRequest'] = json_encode($zapRequest);
        }

        // Create BTCPay invoice
        $invoiceData = noxtr_btcpay_api($btcpayUrl, $apiKey, "stores/$storeId/invoices", 'POST', [
            'amount'   => $btcAmount,
            'currency' => 'BTC',
            'metadata' => $metadata
        ]);

        $invoiceId = $invoiceData['id'] ?? '';
        if (!$invoiceId) {
            echo json_encode(['status' => 'ERROR', 'reason' => 'Could not create invoice']);
            exit;
        }

        // Get bolt11 from payment methods
        $payMethods = noxtr_btcpay_api($btcpayUrl, $apiKey, "stores/$storeId/invoices/$invoiceId/payment-methods");

        $bolt11 = '';
        if (is_array($payMethods)) {
            foreach ($payMethods as $pm) {
                $pmId = $pm['paymentMethodId'] ?? ($pm['paymentMethod'] ?? '');
                if (strpos($pmId, 'LN') !== false || strpos($pmId, 'Lightning') !== false) {
                    $bolt11 = $pm['destination'] ?? '';
                    break;
                }
            }
        }

        if (!$bolt11) {
            echo json_encode(['status' => 'ERROR', 'reason' => 'Could not get Lightning invoice']);
            exit;
        }

        // _paymentStatusUrl es campo no estandar (LUD-16 lo ignora). Lo lee el JS del shortcode [zap] para hacer polling.
        $pollUrl = $scheme . '://' . $host . '/noxtr/raw?action=invoice_status&id=' . urlencode($invoiceId);
        echo json_encode(['pr' => $bolt11, 'routes' => [], '_paymentStatusUrl' => $pollUrl]);
        exit;

    // ======================== INVOICE STATUS (polling) ========================
    case 'invoice_status':
        $invoiceId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($_ARGS['id'] ?? $_GET['id'] ?? ''));
        if ($invoiceId === '') {
            echo json_encode(['error' => 'missing id']);
            exit;
        }
        $cfgRows = NoxtrStore::sqlQueryPrepared(
            "SELECT V, K FROM CFG_CFG WHERE K IN (?, ?, ?)",
            ['btcpay.url', 'btcpay.store_id', 'btcpay.api_key']
        );
        $cfgAll = [];
        foreach ($cfgRows ?: [] as $row) { $cfgAll[$row['K']] = $row['V']; }
        $btcpayUrl = rtrim($cfgAll['btcpay.url'] ?? '', '/');
        $storeId   = $cfgAll['btcpay.store_id'] ?? '';
        $apiKey    = $cfgAll['btcpay.api_key'] ?? '';
        if (!$btcpayUrl || !$storeId || !$apiKey) {
            echo json_encode(['error' => 'payment service not configured']);
            exit;
        }
        $info = noxtr_btcpay_api($btcpayUrl, $apiKey, "stores/$storeId/invoices/$invoiceId");
        $status = strtolower((string)($info['status'] ?? ''));
        // BTCPay statuses: New, Processing, Settled, Invalid, Expired
        // Para Lightning, "Settled" o "Processing" ya significa pagado (Processing = recibido, esperando confirmaciones - irrelevante en LN).
        $paid = in_array($status, ['settled', 'processing', 'complete'], true);
        echo json_encode(['paid' => $paid, 'status' => $status ?: 'unknown']);
        exit;

    // ======================== BTCPAY DIRECT PAY (shortcode [btcpay]) ========================
    // Wrapper server-side: crea la invoice con el api_key de CFG_CFG y redirige al checkout.
    // Evita tener que activar "Allow anyone to create invoice" en BTCPay y no expone storeId al cliente.
    case 'btcpay_pay':
        // Rate limit anti-spam de facturas (H-04). Endpoint público (donación
        // anónima), no protegible con auth. RateLimiter del framework por IP,
        // storage SQLite en fichero de cache propio (separado de la BD de la app).
        $storage = new SQLiteStorage(CFG::$vars['db']['name'] . '-cache.sqlite');
        $rateLimiter = new RateLimiter([
            'prefix'       => 'btcpay_pay_' . $_SERVER['REMOTE_ADDR'] . '_',
            'maxCapacity'  => 5,
            'refillPeriod' => 60
        ], $storage);
        if (!$rateLimiter->check('')) {
            http_response_code(429);
            header('Retry-After: 60');
            echo json_encode(['error' => 'rate limit exceeded']);
            exit;
        }

        $amount = preg_replace('/[^0-9.,]/', '', (string)($_ARGS['amount'] ?? $_GET['amount'] ?? ''));
        $amount = str_replace(',', '.', $amount); // normaliza decimales (1,5 → 1.5)
        $currency = strtoupper(preg_replace('/[^A-Za-z]/', '', (string)($_ARGS['currency'] ?? $_GET['currency'] ?? 'EUR')));
        $method   = preg_replace('/[^A-Za-z0-9\-]/', '', (string)($_ARGS['method'] ?? $_GET['method'] ?? ''));
        $redirect = (string)($_ARGS['redirect'] ?? $_GET['redirect'] ?? '');
        if ($redirect !== '') {
            // Anti open-redirect (H-04): solo permitir redirect al propio host.
            $rHost   = parse_url($redirect, PHP_URL_HOST);
            $rScheme = strtolower((string)parse_url($redirect, PHP_URL_SCHEME));
            $selfHost = $_SERVER['HTTP_HOST'] ?? '';
            if (!$rHost || !in_array($rScheme, ['http','https'], true) || strcasecmp($rHost, $selfHost) !== 0) {
                $redirect = '';
            }
        }

        $cfgRows = NoxtrStore::sqlQueryPrepared(
            "SELECT V, K FROM CFG_CFG WHERE K IN (?, ?, ?)",
            ['btcpay.url', 'btcpay.store_id', 'btcpay.api_key']
        );
        $cfgAll = [];
        foreach ($cfgRows ?: [] as $row) { $cfgAll[$row['K']] = $row['V']; }
        $btcpayUrl = rtrim($cfgAll['btcpay.url'] ?? '', '/');
        $storeId   = $cfgAll['btcpay.store_id'] ?? '';
        $apiKey    = $cfgAll['btcpay.api_key'] ?? '';
        if (!$btcpayUrl || !$storeId || !$apiKey) {
            http_response_code(500);
            echo json_encode(['error' => 'payment service not configured']);
            exit;
        }

        // [btcpay] puede continuar cobrando on-chain. Solo se bloquea cuando
        // el shortcode fuerza expresamente el metodo Lightning.
        if (stripos($method, 'lightning') !== false) {
            $lightningStatus = BtcpayLightning::status([
                'url' => $btcpayUrl,
                'store_id' => $storeId,
                'api_key' => $apiKey,
                'lightning_active' => NoxtrStore::getCfgValue('btcpay.lightning_active', ''),
            ]);
            if (!$lightningStatus['available']) {
                http_response_code(503);
                echo json_encode([
                    'error' => 'lightning unavailable',
                    'message' => BtcpayLightning::unavailableMessage($lightningStatus),
                ]);
                exit;
            }
        }

        $payload = ['currency' => $currency ?: 'EUR'];
        if ($amount !== '' && (float)$amount > 0) {
            $payload['amount'] = $amount;
        }
        // BTCPay acepta checkout.{redirectURL,defaultPaymentMethod} para configurar la pagina de pago.
        $checkout = [];
        if ($method !== '')   $checkout['defaultPaymentMethod'] = $method;
        if ($redirect !== '') $checkout['redirectURL'] = $redirect;
        if ($checkout)        $payload['checkout'] = $checkout;

        $invoice = noxtr_btcpay_api($btcpayUrl, $apiKey, "stores/$storeId/invoices", 'POST', $payload);
        $invoiceId = $invoice['id'] ?? '';
        if (!$invoiceId) {
            http_response_code(502);
            echo json_encode(['error' => 'could not create invoice', 'btcpay_response' => $invoice]);
            exit;
        }
        header('Location: ' . $btcpayUrl . '/i/' . $invoiceId, true, 302);
        exit;

    // ======================== TRENDING TOPICS (hashtags "de moda", cache TTL 1h) ========================
    // Enriquece los DEFAULT_TOPICS del visitante anónimo con hashtags de moda.
    // La URL del servicio externo NO está hardcodeada (no asumimos un endpoint sin verificar):
    // se lee de CFG 'modules.noxtr.trending_api_url'. Si está vacía, devuelve [] y el cliente
    // cae a los DEFAULT_TOPICS estáticos (sin regresión). La URL puede contener {lang}.
    case 'trending_topics':
        $lang = preg_replace('/[^a-z]/', '', strtolower((string)($_ARGS['lang'] ?? $_GET['lang'] ?? '')));
        $lang = substr($lang, 0, 5);

        $apiUrl = trim((string)NoxtrStore::getCfgValue('modules.noxtr.trending_api_url', ''));
        if ($apiUrl === '') { echo json_encode(['topics' => []]); exit; }

        $cacheFile = SCRIPT_DIR_LOG . '/noxtr_trending_' . ($lang !== '' ? $lang : 'all') . '.json';
        $ttl = 3600;
        if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
            $cached = json_decode((string)@file_get_contents($cacheFile), true);
            if (is_array($cached)) { echo json_encode(['topics' => array_values($cached), 'cached' => true]); exit; }
        }

        $fetchUrl = str_replace('{lang}', urlencode($lang), $apiUrl);
        $topics = noxtr_fetch_trending($fetchUrl);

        if ($topics) {
            @file_put_contents($cacheFile, json_encode(array_values($topics)));
        } elseif (is_file($cacheFile)) {
            // La API falló pero hay cache viejo: reúsalo en vez de devolver vacío.
            $stale = json_decode((string)@file_get_contents($cacheFile), true);
            if (is_array($stale)) $topics = $stale;
        }
        echo json_encode(['topics' => array_values($topics ?: [])]);
        exit;

    // ======================== DEFAULT ========================
    default:
        http_response_code(404);
        echo json_encode(['status' => 'ERROR', 'reason' => 'Unknown endpoint']);
        exit;
}

// Descarga y normaliza una lista de hashtags "trending" desde un servicio externo.
// Acepta varias formas de respuesta: array de strings, array de objetos con
// hashtag/tag/name/t/topic, o una de esas listas envuelta en una clave conocida.
// Devuelve array de strings (sin '#'), máx 20, deduplicado.
function noxtr_fetch_trending($url) {
    if (!filter_var($url, FILTER_VALIDATE_URL)) return [];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'noxtr/1.0');
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code < 200 || $code >= 300 || !$body) return [];

    $data = json_decode($body, true);
    if (!is_array($data)) return [];

    // Desenvolver si viene como { hashtags: [...] } o similar.
    if (!array_is_list($data)) {
        foreach (['hashtags', 'topics', 'trending', 'tags', 'data', 'result'] as $k) {
            if (isset($data[$k]) && is_array($data[$k])) { $data = $data[$k]; break; }
        }
    }
    if (!array_is_list($data)) return [];

    $out = [];
    foreach ($data as $item) {
        $tag = null;
        if (is_string($item)) {
            $tag = $item;
        } elseif (is_array($item)) {
            foreach (['hashtag', 'tag', 'name', 't', 'topic'] as $k) {
                if (isset($item[$k]) && is_string($item[$k])) { $tag = $item[$k]; break; }
            }
        }
        if ($tag === null) continue;
        $tag = ltrim(trim($tag), '#');
        // Solo hashtags simples (letras/números/_): evita ruido y cualquier inyección.
        if ($tag !== '' && preg_match('/^[\p{L}\p{N}_]{1,50}$/u', $tag)) {
            $out[mb_strtolower($tag)] = $tag;
        }
        if (count($out) >= 20) break;
    }
    return array_values($out);
}

// --- BTCPay API helper ---
function noxtr_btcpay_api($baseUrl, $apiKey, $endpoint, $method = 'GET', $data = null) {
    $url = $baseUrl . '/api/v1/' . $endpoint;
    $ch  = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: token ' . $apiKey,
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($data) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

    $response = curl_exec($ch);
    curl_close($ch);

    return json_decode($response, true) ?: [];
}

// Recompute Nostr event id and compare with provided id
function noxtr_validate_event_id($event) {
    $serialized = json_encode([
        0,
        (string)$event['pubkey'],
        (int)$event['created_at'],
        (int)$event['kind'],
        $event['tags'],
        (string)($event['content'] ?? '')
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    if ($serialized === false) return false;
    return hash('sha256', $serialized) === (string)$event['id'];
}
