<?php
declare(strict_types=1);

/**
 * Noxtr Monitor
 *
 * Propuesta de arquitectura para un proceso CLI independiente del framework web.
 *
 * Objetivo:
 * - Conectarse por WebSocket a relays Nostr
 * - Suscribirse a mensajes Mostro v2 NIP-44 (kind 14) dirigidos a las trade keys
 * - Resolver a qué trade/user corresponde cada evento
 * - Descifrar el mensaje NIP-44 con la trade_privkey adecuada
 * - Detectar acciones relevantes
 * - Enviar emails u otras notificaciones
 * - Registrar eventos/notificaciones para no duplicar
 *
 * Diseño:
 * - NostrMonitor: orquestador principal
 * - MonitorDataSourceInterface: origen de datos desacoplado
 * - FrameworkDbDataSource: implementación para MySQL/SQLite + tablas del proyecto
 * - JsonFileDataSource: ejemplo de alternativa simple
 * - MonitorNotifierInterface: salida de notificaciones (email, webhook, log...)
 * - RelayClientInterface: cliente WebSocket Nostr
 *
 * Alcance inicial sugerido:
 * - buyer-took-order                           => "han tomado tu orden"
 * - pay-invoice                                => "debes pagar hold invoice"
 * - fiat-sent / fiat-sent-ok                   => "han enviado fiat"
 * - success / purchase-completed / hold-invoice-payment-settled => informativa opcional
 *
 * Fuentes de datos previstas en vuestra instalación:
 * - NSTR_TRADES : trades y claves del trade
 * - NSTR_RELAYS        : relays
 * - CFG_CFG            : configuración del módulo
 * - CLI_USER           : email del user
 * - configuration.php  : credenciales de BD
 *
 * Siguiente paso real después de este esquema:
 * 1. Implementar FrameworkDbDataSource con PDO
 * 2. Implementar EventStore sobre NSTR_EVENTS
 * 3. Implementar RelayClient con un cliente WebSocket CLI
 * 4. Mantener alineadas las rutinas PHP de descifrado NIP-44 v2
 *
 * Nota de compatibilidad:
 * - El CLI del servidor ya corre PHP 8.4 (8.4.22). El código sigue escrito en
 *   sintaxis compatible con 7.3 (props sin tipar, switch en vez de match); las
 *   marcas "PHP 8.4 migration" señalan dónde se puede modernizar cuando se quiera
 *   (typed properties, readonly, constructor property promotion, match).
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Este monitor está pensado para ejecutarse por CLI.\n");
    exit(1);
}

if (PHP_VERSION_ID < 70300) {
    fwrite(STDERR, "Este monitor requiere PHP 7.3 o superior.\n");
    exit(1);
}

// Compatibilidad temporal con el PHP CLI actual del servidor.
// PHP 8.4 migration:
// - recuperar typed properties
// - recuperar readonly
// - recuperar constructor property promotion
// - recuperar match
if (!function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle)
    {
        if ($needle === '') {
            return true;
        }
        return strpos($haystack, $needle) === 0;
    }
}

final class MonitorOptions
{
    /** @var string */
    public $source = 'db';
    /** @var bool */
    public $dryRun = false;
    /** @var bool */
    public $once = false;
    /** @var bool */
    public $verbose = false;
    /** @var string|null */
    public $jsonFile = null;
    /** @var int */
    public $idleSleepSeconds = 10;
    /** @var int */
    public $refreshIntervalSeconds = 30;
    /** @var int */
    public $reconnectDelaySeconds = 5;
    /** @var bool */
    public $debugWide = false;
    /** @var bool */
    public $debugRelays = false;
    /** @var bool */
    public $startupDm = true;
    /** @var string|null */
    public $startupDmText = null;

    public static function fromArgv(array $argv): self
    {
        $opt = new self();

        foreach ($argv as $arg) {
            if ($arg === '--dry-run') {
                $opt->dryRun = true;
            } elseif ($arg === '--once') {
                $opt->once = true;
            } elseif ($arg === '--verbose') {
                $opt->verbose = true;
            } elseif ($arg === '--debug-wide') {
                $opt->debugWide = true;
            } elseif ($arg === '--debug-relays') {
                $opt->debugRelays = true;
            } elseif ($arg === '--startup-dm') {
                $opt->startupDm = true;
            } elseif ($arg === '--no-startup-dm') {
                $opt->startupDm = false;
            } elseif (str_starts_with($arg, '--source=')) {
                $opt->source = substr($arg, 9);
            } elseif (str_starts_with($arg, '--startup-dm=')) {
                $opt->startupDm = true;
                $opt->startupDmText = trim(substr($arg, 13));
            } elseif (str_starts_with($arg, '--json=')) {
                $opt->jsonFile = substr($arg, 7);
                $opt->source = 'json';
            } elseif (str_starts_with($arg, '--idle=')) {
                $opt->idleSleepSeconds = max(1, (int)substr($arg, 7));
            } elseif (str_starts_with($arg, '--refresh=')) {
                $opt->refreshIntervalSeconds = max(5, (int)substr($arg, 10));
            } elseif (str_starts_with($arg, '--reconnect=')) {
                $opt->reconnectDelaySeconds = max(1, (int)substr($arg, 12));
            }
        }

        return $opt;
    }
}

final class MonitoredTrade
{
    // PHP 8.4 migration: convertir estas props a typed properties.
    /** @var int */
    public $userId;
    /** @var string */
    public $orderId;
    /** @var string */
    public $robotPubkey;
    /** @var string */
    public $tradeKeyPub;
    /** @var string */
    public $tradePrivkey;
    /** @var string */
    public $tradeRole;
    /** @var string */
    public $tradeKind;
    /** @var int */
    public $isSeller;
    /** @var string */
    public $internalStatus;
    /** @var string|null */
    public $peerPubkey;
    /** @var string 'lightning' | 'onchain' */
    public $method;
    /** @var string nostr identity pubkey (lowercase) del dueño del trade, de CLI_USER.nostr_pubkey */
    public $ownerPubkey;
    /** @var string nostr identity pubkey (lowercase) de la contraparte on-chain */
    public $peerNostrPubkey;
    /** @var string */
    public $tradeId;
    /** @var string */
    public $network;

    /**
     * @param array<string,mixed> $row
     */
    public function __construct(array $row)
    {
        $this->userId = (int)($row['user_id'] ?? 0);
        $this->orderId = (string)($row['order_id'] ?? '');
        $this->robotPubkey = (string)($row['robot_pubkey'] ?? '');
        $this->tradeKeyPub = (string)($row['trade_key_pub'] ?? '');
        $this->tradePrivkey = (string)($row['trade_privkey'] ?? '');
        $this->tradeRole = (string)($row['trade_role'] ?? 'created');
        $this->tradeKind = (string)($row['trade_kind'] ?? 'sell');
        $this->isSeller = (int)($row['is_seller'] ?? 0);
        $this->internalStatus = (string)($row['internal_status'] ?? 'creado');
        $this->peerPubkey = isset($row['peer_pubkey']) && $row['peer_pubkey'] !== ''
            ? (string)$row['peer_pubkey']
            : null;
        $this->method = (string)($row['method'] ?? 'lightning');
        // Identidad Nostr del dueño: primero CLI_USER.nostr_pubkey; si está vacío (el usuario no
        // guardó su perfil), se deriva de trade_json (el flujo on-chain guarda ahí maker/taker
        // nostr pubkey). El propio lado depende del rol: maker si 'created', taker si 'taken'.
        $meta = json_decode((string)($row['trade_json'] ?? ''), true);
        if (!is_array($meta)) {
            $meta = [];
        }
        $owner = strtolower(trim((string)($row['owner_pubkey'] ?? '')));
        if ($owner === '') {
            $key = ($this->tradeRole === 'created') ? 'maker_nostr_pubkey' : 'taker_nostr_pubkey';
            $owner = strtolower(trim((string)($meta[$key] ?? '')));
        }
        $this->ownerPubkey = $owner;
        $peerKey = ($this->tradeRole === 'created') ? 'taker_nostr_pubkey' : 'maker_nostr_pubkey';
        $this->peerNostrPubkey = strtolower(trim((string)($meta[$peerKey] ?? '')));
        $this->tradeId = strtolower(trim((string)($meta['trade_id'] ?? '')));
        $this->network = strtolower(trim((string)($meta['network'] ?? 'mainnet')));
    }
}

final class MonitorEvent
{
    // PHP 8.4 migration: volver estas props readonly + typed.
    /** @var string */
    public $eventId;
    /** @var int */
    public $kind;
    /** @var int */
    public $createdAt;
    /** @var string */
    public $pubkey;
    /** @var array<int,array<int,string>> */
    public $tags;
    /** @var string */
    public $content;
    /** @var array<string,mixed> */
    public $raw;

    /**
     * @param array<string,mixed> $event
     */
    public function __construct(array $event)
    {
        $this->eventId = (string)($event['id'] ?? '');
        $this->kind = (int)($event['kind'] ?? 0);
        $this->createdAt = (int)($event['created_at'] ?? 0);
        $this->pubkey = (string)($event['pubkey'] ?? '');
        $this->tags = is_array($event['tags'] ?? null) ? $event['tags'] : [];
        $this->content = (string)($event['content'] ?? '');
        $this->raw = $event;
    }

    /**
     * @return string[]
     */
    public function pTags(): array
    {
        $out = [];
        foreach ($this->tags as $tag) {
            if (($tag[0] ?? null) === 'p' && !empty($tag[1])) {
                $out[] = (string)$tag[1];
            }
        }
        return $out;
    }

    /**
     * Primer valor del tag con el nombre dado (ej. 'd', 'y', 'action'), o '' si no existe.
     */
    public function firstTag(string $name): string
    {
        foreach ($this->tags as $tag) {
            if (($tag[0] ?? null) === $name && isset($tag[1])) {
                return (string)$tag[1];
            }
        }
        return '';
    }
}

interface MonitorDataSourceInterface
{
    /**
     * @return MonitoredTrade[]
     */
    public function loadActiveTrades(): array;

    public function findUserEmail(int $userId): ?string;

    public function findUserEmailByPubkey(string $pubkey): ?string;

    /**
     * Filtro de monedas del usuario (chip 💱 de noxtr, sincronizado via ajax save_fiat_filter
     * a CLI_USER_CFG con K='noxtr.fiat_filter'). Códigos fiat en mayúsculas; [] = sin filtro.
     *
     * @return string[]
     */
    public function findUserFiatFilterByPubkey(string $pubkey): array;

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Para desactivar: eliminar esta línea y sus implementaciones en
    // FrameworkDbDataSource y JsonFileDataSource, y el bloque en maybeNotify().
    public function findUserTelegramChatId(int $userId): ?string;

    /**
     * Devuelve todos los chats vinculados activos.
     * Cada elemento: ['chat_id' => string, 'user_id' => int, 'username' => string, 'first_name' => string]
     *
     * @return array<int,array<string,mixed>>
     */
    public function findAllTelegramChats(): array;

    /**
     * Devuelve el chat_id vinculado a un @username de Telegram, o null si no existe.
     * La búsqueda es case-insensitive y acepta el username con o sin @.
     */
    public function findTelegramChatByUsername(string $username): ?string;

    /**
     * Devuelve los usuarios que tienen a la vez nostr_pubkey y Telegram vinculado.
     * Cada elemento: ['nostr_pubkey' => string, 'chat_id' => string]
     * Usado para suscribirse a kind:4 y notificar DMs por Telegram.
     *
     * @return array<int,array<string,string>>
     */
    public function loadTelegramLinkedUsersWithPubkey(): array;
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────

    public function isEventProcessed(string $eventId): bool;

    /**
     * @param array<string,mixed> $row
     */
    public function storeEvent(array $row): void;

    public function wasNotificationSent(string $orderId, string $type): bool;

    public function markNotificationSent(string $orderId, string $type, string $eventId): void;
}

interface MonitorNotifierInterface
{
    public function sendEmail(string $to, string $subject, string $html): bool;

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Para desactivar: eliminar este método y sus implementaciones en
    // NullNotifier y FrameworkEmailNotifier.
    public function sendTelegram(string $chatId, string $text): bool;
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────
}

interface RelayClientInterface
{
    /**
     * @param string[] $relayUrls
     */
    public function connect(array $relayUrls): void;

    /**
     * @param array<int,array<string,mixed>> $filters
     */
    public function subscribe(array $filters): void;

    /**
     * @param callable(array):void $onMessage
     * @param callable():bool|null $shouldStop
     */
    public function run(callable $onMessage, ?callable $shouldStop = null): void;

    /**
     * @param array<string,mixed> $event
     */
    public function publishEvent(array $event): int;

    /**
     * @return string[]
     */
    public function getConnectedRelayUrls(): array;

    public function disconnect(): void;
}

final class FrameworkDbDataSource implements MonitorDataSourceInterface
{
    /** @var array<string,mixed> */
    private $config;
    /** @var PDO */
    private $pdo;
    /** @var bool */
    private $isSQLite = false;
    /** @var string */
    private $eventsTable = 'NSTR_EVENTS';

    /**
     * @param array<string,mixed> $config
     */
    public function __construct(array $config)
    {
        $this->config = $config;
        $this->pdo = $this->connectPdo();
        $this->isSQLite = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $this->ensureEventsTable();
    }

    public function loadActiveTrades(): array
    {
        // 'disputado' SÍ se mantiene porque el ciclo de vida de la disputa sigue después
        // (admin-took-dispute, mensajes del solver, etc.). Solo se descarta cuando termine.
        // owner_pubkey = identidad Nostr del dueño (de CLI_USER). Se usa para los trades on-chain:
        // los eventos públicos (kind 39385/86/87/89) se dirigen al peer via tag `p`, así que para
        // saber a quién avisar casamos `p` contra la identidad del usuario local.
        $sql = "SELECT t.user_id, t.order_id, t.robot_pubkey, t.trade_key_pub, t.trade_privkey,
                       t.trade_role, t.trade_kind, t.is_seller, t.internal_status, t.peer_pubkey,
                       t.trade_json,
                       COALESCE(t.method, 'lightning') AS method,
                       LOWER(COALESCE(u.nostr_pubkey, '')) AS owner_pubkey
                FROM NSTR_TRADES t
                LEFT JOIN CLI_USER u ON u.USER_ID = t.user_id
                WHERE COALESCE(t.archived, 0) = 0
                  AND COALESCE(t.trade_key_pub, '') <> ''
                  AND (LOWER(COALESCE(t.method, 'lightning')) = 'onchain'
                       OR COALESCE(t.trade_privkey, '') <> '')
                  AND LOWER(COALESCE(t.internal_status, '')) NOT IN ('cancelado', 'completado', 'archivado')
                ORDER BY t.updated_at DESC";

        $rows = $this->fetchAll($sql);
        $trades = [];

        foreach ($rows as $row) {
            // Descifrado transparente (auditoría 2026-08-22, ver NoxtrStore::decTradePrivkey): filas
            // viejas en hex plano pasan sin cambios, filas ya migradas se descifran aquí.
            $row['trade_privkey'] = NoxtrStore::decTradePrivkey($row['trade_privkey'] ?? '');
            $trades[] = new MonitoredTrade($row);
        }

        return $trades;
    }

    public function findUserEmail(int $userId): ?string
    {
        $row = $this->fetchOne(
            'SELECT user_email FROM ' . TB_USER . ' WHERE user_id = ? LIMIT 1',
            [$userId]
        );

        $email = is_array($row) ? ($row['user_email'] ?? null) : null;
        return is_string($email) && $email !== '' ? $email : null;
    }

    public function findUserEmailByPubkey(string $pubkey): ?string
    {
        $pubkey = strtolower(trim($pubkey));
        if ($pubkey === '') {
            return null;
        }

        $row = $this->fetchOne(
            'SELECT user_email FROM ' . TB_USER . ' WHERE LOWER(COALESCE(nostr_pubkey, \'\')) = ? LIMIT 1',
            [$pubkey]
        );

        $email = is_array($row) ? ($row['user_email'] ?? null) : null;
        return is_string($email) && $email !== '' ? $email : null;
    }

    public function findUserFiatFilterByPubkey(string $pubkey): array
    {
        $pubkey = strtolower(trim($pubkey));
        if ($pubkey === '') {
            return [];
        }

        try {
            $row = $this->fetchOne(
                'SELECT c.V FROM CLI_USER_CFG c'
                . ' JOIN ' . TB_USER . ' u ON u.user_id = c.user_id'
                . ' WHERE LOWER(COALESCE(u.nostr_pubkey, \'\')) = ? AND c.K = ? LIMIT 1',
                [$pubkey, 'noxtr.fiat_filter']
            );
        } catch (Throwable $e) {
            return []; // tabla aún no creada en este site
        }

        $codes = json_decode(is_array($row) ? (string)($row['V'] ?? '') : '', true);
        if (!is_array($codes)) {
            return [];
        }

        $out = [];
        foreach ($codes as $code) {
            $code = strtoupper(trim((string)$code));
            if ($code !== '') {
                $out[] = $code;
            }
        }
        return $out;
    }

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Devuelve el chat_id de Telegram vinculado al usuario, o null si no tiene.
    // Consulta la tabla TGRAM_CHATS del módulo telegram.
    // Para desactivar: eliminar este método (y el bloque en maybeNotify).
    public function findUserTelegramChatId(int $userId): ?string
    {
        $row = $this->fetchOne(
            'SELECT chat_id FROM TGRAM_CHATS WHERE user_id = ? AND active = 1 LIMIT 1',
            [$userId]
        );
        $chatId = is_array($row) ? ($row['chat_id'] ?? null) : null;
        return is_string($chatId) && $chatId !== '' ? $chatId : null;
    }

    public function findAllTelegramChats(): array
    {
        $rows = $this->fetchAll(
            'SELECT chat_id, user_id, username, first_name FROM TGRAM_CHATS WHERE active = 1 ORDER BY user_id ASC'
        );
        return is_array($rows) ? $rows : [];
    }

    public function findTelegramChatByUsername(string $username): ?string
    {
        $username = ltrim(trim($username), '@');
        if ($username === '') {
            return null;
        }
        $row = $this->fetchOne(
            'SELECT chat_id FROM TGRAM_CHATS WHERE active = 1 AND LOWER(username) = LOWER(?) LIMIT 1',
            [$username]
        );
        $chatId = is_array($row) ? ($row['chat_id'] ?? null) : null;
        return is_string($chatId) && $chatId !== '' ? $chatId : null;
    }

    public function loadTelegramLinkedUsersWithPubkey(): array
    {
        $rows = $this->fetchAll(
            'SELECT LOWER(u.nostr_pubkey) AS nostr_pubkey, t.chat_id
             FROM CLI_USER u
             INNER JOIN TGRAM_CHATS t ON t.user_id = u.USER_ID AND t.active = 1
             WHERE u.nostr_pubkey IS NOT NULL AND u.nostr_pubkey <> \'\'
             ORDER BY u.USER_ID ASC'
        );
        return is_array($rows) ? $rows : [];
    }
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────

    public function isEventProcessed(string $eventId): bool
    {
        $row = $this->fetchOne(
            'SELECT event_id FROM ' . $this->eventsTable . ' WHERE event_id = ? LIMIT 1',
            [$eventId]
        );

        return is_array($row) && !empty($row['event_id']);
    }

    public function storeEvent(array $row): void
    {
        $eventId = (string)($row['event_id'] ?? '');
        if ($eventId === '' || $this->isEventProcessed($eventId)) {
            return;
        }

        $now = time();
        $sql = $this->insertIgnorePrefix() . ' INTO ' . $this->eventsTable . ' (
                    event_id, kind, order_id, user_id, event_created_at, source, status,
                    raw_json, notification_type, notification_sent_at, processed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

        $this->execute($sql, [
            $eventId,
            (int)($row['kind'] ?? 0),
            (string)($row['order_id'] ?? ''),
            (int)($row['user_id'] ?? 0),
            (int)($row['event_created_at'] ?? 0),
            (string)($row['source'] ?? 'mostro'),
            (string)($row['status'] ?? 'received'),
            (string)($row['raw_json'] ?? ''),
            (string)($row['notification_type'] ?? ''),
            isset($row['notification_sent_at']) ? (int)$row['notification_sent_at'] : null,
            (int)($row['processed_at'] ?? $now),
            (int)($row['created_at'] ?? $now),
            (int)($row['updated_at'] ?? $now),
        ]);
    }

    public function wasNotificationSent(string $orderId, string $type): bool
    {
        $row = $this->fetchOne(
            'SELECT id FROM ' . $this->eventsTable . ' WHERE order_id = ? AND notification_type = ? AND notification_sent_at IS NOT NULL LIMIT 1',
            [$orderId, $type]
        );

        return is_array($row) && !empty($row['id']);
    }

    public function markNotificationSent(string $orderId, string $type, string $eventId): void
    {
        $now = time();

        if ($eventId !== '' && $this->isEventProcessed($eventId)) {
            $this->execute(
                'UPDATE ' . $this->eventsTable . ' SET notification_type = ?, notification_sent_at = ?, updated_at = ? WHERE event_id = ?',
                [$type, $now, $now, $eventId]
            );
            return;
        }

        $sql = $this->insertIgnorePrefix() . ' INTO ' . $this->eventsTable . ' (
                    event_id, kind, order_id, user_id, event_created_at, source, status,
                    raw_json, notification_type, notification_sent_at, processed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

        // Sin event_id real se fabrica uno sintético. Va HASHEADO: concatenar order id, tipo y hora
        // dejaba en la columna `event_id`, en claro y de forma permanente, qué orden, qué le pasó y
        // cuándo. Lo único que esta columna necesita del id sintético es ser único (UNIQUE(event_id))
        // — nadie lo reconstruye ni lo busca: wasNotificationSent() consulta por order_id +
        // notification_type, y la rama de arriba usa el event_id real cuando existe.
        $this->execute($sql, [
            $eventId !== '' ? $eventId : ('notify-' . substr(hash('sha256', $orderId . '|' . $type . '|' . $now), 0, 40)),
            0,
            $orderId,
            0,
            0,
            'monitor',
            'notified',
            '',
            $type,
            $now,
            $now,
            $now,
            $now,
        ]);
    }

    private function connectPdo()
    {
        $dbType = strtolower((string)(CFG::$vars['db']['type'] ?? 'mysql'));

        if ($dbType === 'sqlite') {
            $pdo = SQLite_PDO::singleton();
        } else {
            $pdo = MySql_PDO::singleton();
        }

        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

        return $pdo;
    }

    private function ensureEventsTable(): void
    {
        if ($this->isSQLite) {
            $sql = "CREATE TABLE IF NOT EXISTS {$this->eventsTable} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                kind INTEGER DEFAULT 0,
                order_id TEXT DEFAULT '',
                user_id INTEGER DEFAULT 0,
                event_created_at INTEGER DEFAULT 0,
                source TEXT DEFAULT '',
                status TEXT DEFAULT '',
                raw_json TEXT DEFAULT '',
                notification_type TEXT DEFAULT '',
                notification_sent_at INTEGER DEFAULT NULL,
                processed_at INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT 0,
                updated_at INTEGER DEFAULT 0,
                UNIQUE(event_id)
            )";
        } else {
            $sql = "CREATE TABLE IF NOT EXISTS {$this->eventsTable} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_id VARCHAR(128) NOT NULL,
                kind INT DEFAULT 0,
                order_id VARCHAR(128) DEFAULT '',
                user_id INT DEFAULT 0,
                event_created_at INT DEFAULT 0,
                source VARCHAR(32) DEFAULT '',
                status VARCHAR(32) DEFAULT '',
                raw_json MEDIUMTEXT DEFAULT NULL,
                notification_type VARCHAR(64) DEFAULT '',
                notification_sent_at INT DEFAULT NULL,
                processed_at INT DEFAULT 0,
                created_at INT DEFAULT 0,
                updated_at INT DEFAULT 0,
                UNIQUE KEY uq_event_id (event_id),
                KEY idx_order_type (order_id, notification_type)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4";
        }

        $this->pdo->exec($sql);
    }

    private function insertIgnorePrefix()
    {
        return $this->isSQLite ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
    }

    private function fetchAll($sql, array $params = [])
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    private function fetchOne($sql, array $params = [])
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
    }

    private function execute($sql, array $params = [])
    {
        $stmt = $this->pdo->prepare($sql);
        return $stmt->execute($params);
    }
}

final class JsonFileDataSource implements MonitorDataSourceInterface
{
    /**
     * Alternativa para pruebas.
     *
     * Estructura sugerida del JSON:
     * {
     *   "relays": ["wss://relay.mostro.network"],
     *   "users": { "12": {"email":"a@b.com"} },
     *   "trades": [
     *      {
     *        "user_id": 12,
     *        "order_id": "...",
     *        "robot_pubkey": "...",
     *        "trade_key_pub": "...",
     *        "trade_privkey": "...",
     *        "trade_role": "created",
     *        "trade_kind": "sell",
     *        "is_seller": 1,
     *        "internal_status": "publicado"
     *      }
     *   ],
     *   "events": []
     * }
     *
     * @var array<string,mixed>
     */
    private $data = [];
    /** @var string */
    private $jsonFile;

    public function __construct(string $jsonFile)
    {
        $this->jsonFile = $jsonFile;

        if (!is_file($jsonFile)) {
            return;
        }

        $raw = file_get_contents($jsonFile);
        $decoded = json_decode((string)$raw, true);
        $this->data = is_array($decoded) ? $decoded : [];
    }

    public function loadActiveTrades(): array
    {
        $rows = is_array($this->data['trades'] ?? null) ? $this->data['trades'] : [];
        $trades = [];

        foreach (array_values(array_filter($rows, 'is_array')) as $row) {
            $trades[] = new MonitoredTrade($row);
        }

        return $trades;
    }

    public function findUserEmail(int $userId): ?string
    {
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        $row = $users[(string)$userId] ?? null;
        $email = is_array($row) ? ($row['email'] ?? null) : null;
        return is_string($email) && $email !== '' ? $email : null;
    }

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Stub para JsonFileDataSource. Leer chat_id desde users[N]["telegram_chat_id"].
    public function findUserTelegramChatId(int $userId): ?string
    {
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        $row = $users[(string)$userId] ?? null;
        $chatId = is_array($row) ? ($row['telegram_chat_id'] ?? null) : null;
        return is_string($chatId) && $chatId !== '' ? $chatId : null;
    }

    public function findAllTelegramChats(): array
    {
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        $out = [];
        foreach ($users as $userId => $row) {
            if (!is_array($row)) {
                continue;
            }
            $chatId = $row['telegram_chat_id'] ?? null;
            if (!is_string($chatId) || $chatId === '') {
                continue;
            }
            $out[] = [
                'chat_id'    => $chatId,
                'user_id'    => (int)$userId,
                'username'   => (string)($row['telegram_username'] ?? ''),
                'first_name' => (string)($row['telegram_first_name'] ?? ''),
            ];
        }
        return $out;
    }

    public function findTelegramChatByUsername(string $username): ?string
    {
        $username = strtolower(ltrim(trim($username), '@'));
        if ($username === '') {
            return null;
        }
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        foreach ($users as $row) {
            if (!is_array($row)) {
                continue;
            }
            $rowUser = strtolower(ltrim(trim((string)($row['telegram_username'] ?? '')), '@'));
            if ($rowUser === $username) {
                $chatId = $row['telegram_chat_id'] ?? null;
                return is_string($chatId) && $chatId !== '' ? $chatId : null;
            }
        }
        return null;
    }

    public function loadTelegramLinkedUsersWithPubkey(): array
    {
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        $out = [];
        foreach ($users as $row) {
            if (!is_array($row)) {
                continue;
            }
            $pubkey = strtolower(trim((string)($row['nostr_pubkey'] ?? '')));
            $chatId = (string)($row['telegram_chat_id'] ?? '');
            if ($pubkey === '' || $chatId === '') {
                continue;
            }
            $out[] = ['nostr_pubkey' => $pubkey, 'chat_id' => $chatId];
        }
        return $out;
    }
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────

    public function findUserEmailByPubkey(string $pubkey): ?string
    {
        $users = is_array($this->data['users'] ?? null) ? $this->data['users'] : [];
        $pubkey = strtolower(trim($pubkey));
        if ($pubkey === '') {
            return null;
        }

        foreach ($users as $row) {
            if (!is_array($row)) {
                continue;
            }
            $rowPubkey = strtolower(trim((string)($row['pubkey'] ?? $row['nostr_pubkey'] ?? '')));
            if ($rowPubkey === $pubkey) {
                $email = $row['email'] ?? null;
                return is_string($email) && $email !== '' ? $email : null;
            }
        }

        return null;
    }

    public function findUserFiatFilterByPubkey(string $pubkey): array
    {
        return []; // sin filtro en fuente JSON
    }

    public function isEventProcessed(string $eventId): bool
    {
        foreach ((array)($this->data['events'] ?? []) as $row) {
            if (($row['event_id'] ?? null) === $eventId) {
                return true;
            }
        }
        return false;
    }

    public function storeEvent(array $row): void
    {
        $this->data['events'][] = $row;
        $this->flush();
    }

    public function wasNotificationSent(string $orderId, string $type): bool
    {
        foreach ((array)($this->data['events'] ?? []) as $row) {
            if (
                ($row['order_id'] ?? null) === $orderId &&
                ($row['notification_type'] ?? null) === $type &&
                !empty($row['notification_sent_at'])
            ) {
                return true;
            }
        }
        return false;
    }

    public function markNotificationSent(string $orderId, string $type, string $eventId): void
    {
        $this->data['events'][] = [
            'event_id' => $eventId,
            'order_id' => $orderId,
            'notification_type' => $type,
            'notification_sent_at' => time(),
        ];
        $this->flush();
    }

    private function flush(): void
    {
        file_put_contents($this->jsonFile, json_encode($this->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }
}

// ── FEATURE: MULTI-SITE MONITOR ───────────────────────────────────────────────

/**
 * Fuente de datos remota — llama a /noxtr/api/* en un sitio externo.
 * Nunca almacena datos localmente; cada llamada es una petición HTTP.
 */
final class RemoteSiteDataSource implements MonitorDataSourceInterface
{
    /** @var string */
    private $siteUrl;
    /** @var string */
    private $apiKey;
    /** @var int Offset aplicado a userId para distinguir sitios en MultiSiteDataSource */
    private $userIdOffset;

    public function __construct(string $siteUrl, string $apiKey, int $userIdOffset = 0)
    {
        $this->siteUrl      = rtrim($siteUrl, '/');
        $this->apiKey       = $apiKey;
        $this->userIdOffset = $userIdOffset;
    }

    public function loadActiveTrades(): array
    {
        $data = $this->get('monitor_trades');
        if (!is_array($data) || !isset($data['trades'])) {
            return [];
        }
        $trades = [];
        foreach ($data['trades'] as $row) {
            if (!is_array($row)) {
                continue;
            }
            $trade = new MonitoredTrade($row);
            // Aplicar offset para que el userId sea único en MultiSiteDataSource
            if ($this->userIdOffset > 0) {
                $trade->userId += $this->userIdOffset;
            }
            $trades[] = $trade;
        }
        return $trades;
    }

    public function findUserEmail(int $userId): ?string
    {
        $realId = $userId - $this->userIdOffset;
        $data   = $this->get('monitor_user', ['user_id' => $realId]);
        return $this->extractFromUser($data, 'email');
    }

    public function findUserEmailByPubkey(string $pubkey): ?string
    {
        $data = $this->get('monitor_user', ['pubkey' => $pubkey]);
        return $this->extractFromUser($data, 'email');
    }

    public function findUserFiatFilterByPubkey(string $pubkey): array
    {
        return []; // el endpoint remoto no expone el filtro; sin filtro
    }

    public function findUserTelegramChatId(int $userId): ?string
    {
        $realId = $userId - $this->userIdOffset;
        $data   = $this->get('monitor_user', ['user_id' => $realId]);
        $chatId = $this->extractFromUser($data, 'telegram_chat_id');
        return ($chatId !== null && $chatId !== '') ? $chatId : null;
    }

    public function findAllTelegramChats(): array
    {
        // No usado en contexto multi-site (se usa loadTelegramLinkedUsersWithPubkey)
        return [];
    }

    public function findTelegramChatByUsername(string $username): ?string
    {
        // No necesario en multi-site — resolucion por pubkey
        return null;
    }

    public function loadTelegramLinkedUsersWithPubkey(): array
    {
        $data = $this->get('monitor_telegram_users');
        if (!is_array($data) || !isset($data['users'])) {
            return [];
        }
        return is_array($data['users']) ? $data['users'] : [];
    }

    public function isEventProcessed(string $eventId): bool
    {
        $data = $this->get('monitor_event_check', ['event_id' => $eventId]);
        return !empty($data['processed']);
    }

    public function storeEvent(array $row): void
    {
        if ($this->userIdOffset > 0 && isset($row['user_id'])) {
            $row['user_id'] = (int)$row['user_id'] - $this->userIdOffset;
        }
        $this->post('monitor_event_store', $row);
    }

    public function wasNotificationSent(string $orderId, string $type): bool
    {
        $data = $this->get('monitor_event_check', ['order_id' => $orderId, 'type' => $type]);
        return !empty($data['sent']);
    }

    public function markNotificationSent(string $orderId, string $type, string $eventId): void
    {
        $this->post('monitor_notification', [
            'order_id' => $orderId,
            'type'     => $type,
            'event_id' => $eventId,
        ]);
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>|null
     */
    private function get(string $action, array $params = [])
    {
        $path = '/noxtr/raw/action=' . urlencode($action);
        foreach ($params as $k => $v) {
            $path .= '/' . urlencode((string)$k) . '=' . urlencode((string)$v);
        }
        return $this->curl($this->siteUrl . $path, 'GET', null);
    }

    /**
     * @param array<string,mixed> $body
     * @return array<string,mixed>|null
     */
    private function post(string $action, array $body)
    {
        $url = $this->siteUrl . '/noxtr/raw/action=' . urlencode($action);
        return $this->curl($url, 'POST', $body);
    }

    /**
     * @param array<string,mixed>|null $body
     * @return array<string,mixed>|null
     */
    private function curl(string $url, string $method, $body)
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => [
                'X-Monitor-Key: ' . $this->apiKey,
                'Content-Type: application/json',
            ],
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = json_encode($body);
        }
        curl_setopt_array($ch, $opts);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!is_string($response) || $response === '') {
            return null;
        }
        $decoded = json_decode($response, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @param array<string,mixed>|null $data
     */
    private function extractFromUser($data, string $field): ?string
    {
        if (!is_array($data) || !isset($data['user']) || !is_array($data['user'])) {
            return null;
        }
        $val = $data['user'][$field] ?? null;
        return (is_string($val) && $val !== '') ? $val : null;
    }
}

/**
 * Agrega un DataSource local y N DataSources remotos.
 * Usa un offset de userId (SITE_OFFSET) para distinguir usuarios de distintos sitios.
 */
final class MultiSiteDataSource implements MonitorDataSourceInterface
{
    const SITE_OFFSET = 1000000000; // 1 billion — suficiente para cualquier instalación real

    /** @var MonitorDataSourceInterface[] */
    private $sources;

    /** @var array<string,int> orderId → sourceIndex */
    private $orderToSource = [];

    /**
     * @param MonitorDataSourceInterface[] $sources  Índice 0 = local, 1..N = remotos
     */
    public function __construct(array $sources)
    {
        $this->sources = $sources;
    }

    public function loadActiveTrades(): array
    {
        $this->orderToSource = [];
        $all = [];
        foreach ($this->sources as $idx => $source) {
            foreach ($source->loadActiveTrades() as $trade) {
                // Los remotos ya llevan el offset aplicado en RemoteSiteDataSource
                $this->orderToSource[$trade->orderId] = $idx;
                $all[] = $trade;
            }
        }
        return $all;
    }

    public function findUserEmail(int $userId): ?string
    {
        $idx    = intdiv($userId, self::SITE_OFFSET);
        $source = $this->sources[$idx] ?? $this->sources[0];
        return $source->findUserEmail($userId);
    }

    public function findUserEmailByPubkey(string $pubkey): ?string
    {
        foreach ($this->sources as $source) {
            $email = $source->findUserEmailByPubkey($pubkey);
            if ($email !== null) {
                return $email;
            }
        }
        return null;
    }

    public function findUserFiatFilterByPubkey(string $pubkey): array
    {
        foreach ($this->sources as $source) {
            $filter = $source->findUserFiatFilterByPubkey($pubkey);
            if ($filter !== []) {
                return $filter;
            }
        }
        return [];
    }

    public function findUserTelegramChatId(int $userId): ?string
    {
        $idx    = intdiv($userId, self::SITE_OFFSET);
        $source = $this->sources[$idx] ?? $this->sources[0];
        return $source->findUserTelegramChatId($userId);
    }

    public function findAllTelegramChats(): array
    {
        $all = [];
        foreach ($this->sources as $source) {
            foreach ($source->findAllTelegramChats() as $row) {
                $all[] = $row;
            }
        }
        return $all;
    }

    public function findTelegramChatByUsername(string $username): ?string
    {
        foreach ($this->sources as $source) {
            $chatId = $source->findTelegramChatByUsername($username);
            if ($chatId !== null) {
                return $chatId;
            }
        }
        return null;
    }

    public function loadTelegramLinkedUsersWithPubkey(): array
    {
        $all = [];
        foreach ($this->sources as $source) {
            foreach ($source->loadTelegramLinkedUsersWithPubkey() as $row) {
                $all[] = $row;
            }
        }
        return $all;
    }

    public function isEventProcessed(string $eventId): bool
    {
        foreach ($this->sources as $source) {
            if ($source->isEventProcessed($eventId)) {
                return true;
            }
        }
        return false;
    }

    public function storeEvent(array $row): void
    {
        $orderId = (string)($row['order_id'] ?? '');
        $source  = $this->resolveSourceByOrderId($orderId);
        $source->storeEvent($row);
    }

    public function wasNotificationSent(string $orderId, string $type): bool
    {
        $source = $this->resolveSourceByOrderId($orderId);
        return $source->wasNotificationSent($orderId, $type);
    }

    public function markNotificationSent(string $orderId, string $type, string $eventId): void
    {
        $source = $this->resolveSourceByOrderId($orderId);
        $source->markNotificationSent($orderId, $type, $eventId);
    }

    private function resolveSourceByOrderId(string $orderId): MonitorDataSourceInterface
    {
        if ($orderId !== '' && isset($this->orderToSource[$orderId])) {
            $idx = $this->orderToSource[$orderId];
            if (isset($this->sources[$idx])) {
                return $this->sources[$idx];
            }
        }
        return $this->sources[0]; // fallback: local
    }
}

// ── END FEATURE: MULTI-SITE MONITOR ──────────────────────────────────────────

final class NullNotifier implements MonitorNotifierInterface
{
    /** @var bool */
    private $verbose;

    public function __construct(bool $verbose = false)
    {
        $this->verbose = $verbose;
    }

    public function sendEmail(string $to, string $subject, string $html): bool
    {
        if ($this->verbose) {
            echo "[dry-run] email -> {$to} | {$subject}\n";
        }
        return true;
    }

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    public function sendTelegram(string $chatId, string $text): bool
    {
        if ($this->verbose) {
            echo '[dry-run] telegram -> ' . $chatId . ' | ' . substr($text, 0, 60) . "\n";
        }
        return true;
    }
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────
}

final class FrameworkEmailNotifier implements MonitorNotifierInterface
{
    /** @var bool */
    private $enabled;
    /** @var bool */
    private $verbose;

    public function __construct(bool $enabled, bool $verbose = false)
    {
        $this->enabled = $enabled;
        $this->verbose = $verbose;
    }

    public function sendEmail(string $to, string $subject, string $html): bool
    {
        // Los fallos se logean SIEMPRE (no solo en verbose): "no llegan emails" era
        // indepurable porque message_mail() se traga el ErrorInfo de PHPMailer.
        if (!$this->enabled) {
            echo "[monitor][email] DESACTIVADO (CFG modules.noxtr.trade_notification_email) -> {$to} | {$subject}\n";
            return false;
        }

        $to = trim($to);
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            echo "[monitor][email] destinatario invalido: '{$to}' | {$subject}\n";
            return false;
        }

        try {
            $m = new Mailer();
            if ($this->verbose) {
                // Volcado de la conversacion SMTP completa al shell
                $m->SMTPDebug = 2;
            }
            $from = (string)(CFG::$vars['site']['from_email'] ?? '');
            $m->SetFrom($from, $from);
            $m->AddAddress($to, $to);
            $m->Subject = $subject;
            $m->body = $html;
            $sent = (bool)$m->Send();
            if (!$sent) {
                echo '[monitor][email] FALLO -> ' . $to . ' | ' . $subject
                    . ' | ' . (string)($m->ErrorInfo !== '' ? $m->ErrorInfo : 'sin detalle') . "\n";
            } elseif ($this->verbose) {
                echo "[monitor][email] enviado -> {$to} | {$subject}\n";
            }
            return $sent;
        } catch (Throwable $e) {
            echo '[monitor][email] EXCEPCION -> ' . $to . ' | ' . $subject . ' | ' . $e->getMessage() . "\n";
            return false;
        }
    }

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Lee el bot_token de CFG::$vars (mismo origen que TelegramBot::getToken()).
    // Envía el mensaje via API de Telegram con curl.
    // Para desactivar: eliminar este método (y el bloque en maybeNotify).
    public function sendTelegram(string $chatId, string $text): bool
    {
        $token = trim((string)(CFG::$vars['modules']['telegram']['bot_token'] ?? ''));
        if ($token === '' || $chatId === '' || $text === '') {
            if ($this->verbose) {
                echo "[monitor] telegram skipped: no token or empty chatId/text\n";
            }
            return false;
        }

        $url = 'https://api.telegram.org/bot' . $token . '/sendMessage';
        $params = ['chat_id' => $chatId, 'text' => $text, 'disable_web_page_preview' => true];

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($params),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!is_string($response) || $response === '') {
            if ($this->verbose) {
                echo "[monitor] telegram curl error -> {$chatId}\n";
            }
            return false;
        }

        $decoded = json_decode($response, true);
        $ok = !empty($decoded['ok']);

        if ($this->verbose) {
            echo '[monitor] telegram ' . ($ok ? 'sent' : 'failed') . " -> {$chatId}\n";
        }
        return $ok;
    }
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────
}


final class NostrMonitor
{
    const VERSION = '1.1.1';

    /** @var array<string,MonitoredTrade> */
    private $tradeIndex = [];
    /** @var array<string,array<int,MonitoredTrade>> order_id → trades on-chain (puede haber 2 si maker y taker son locales) */
    private $onchainOrderIndex = [];
    /** @var array<string,string> nostr_pubkey(lowercase) → telegram chat_id */
    private $dmNotifyIndex = [];
    /** @var MonitorDataSourceInterface */
    private $dataSource;
    /** @var MonitorNotifierInterface */
    private $notifier;
    /** @var RelayClientInterface|null */
    private $relayClient;
    /** @var MonitorOptions */
    private $options;
    /** @var bool */
    private $shouldStop = false;
    /** @var bool */
    private $shouldReload = false;
    /** @var bool */
    private $waitingForTrades = false;
    /** @var string */
    private $lastFilterHash = '';
    /** @var array<string,mixed> */
    private $monitorIdentity = [];
    /** @var string[] */
    private $controlAdminPubkeys = [];
    /** @var array<string,array{at:int,filter:string[]}> cache 5 min del filtro de monedas por admin */
    private $adminFiatFilterCache = [];
    /** @var string[] */
    private $monitorRelays = [];
    /** @var int */
    private $startedAt = 0;
    /** @var bool */
    private $startupDmSent = false;
    /** @var bool */
    private $monitorProfilePublished = false;
    /** @var array<string,int> */
    private $seenOrderBookEventIds = [];
    /** @var array<string,int> */
    private $seenNotifiedOrderIds = [];
    /** @var array<string,int> robotPubkey → protocol_version del transporte (kind 38385; tag ausente = 1) */
    private $robotProtocolVersion = [];
    /** @var array<string,int> robotPubkey → created_at del último 38385 procesado (descarta rancios) */
    private $robotStatusAt = [];
    /** @var bool ON por defecto: avisa a los admins de toda nueva oferta (Mostro 38383 + on-chain 39383). */
    private $notifyNewOffers = true;

    public function __construct(
        MonitorDataSourceInterface $dataSource,
        MonitorNotifierInterface $notifier,
        ?RelayClientInterface $relayClient,
        MonitorOptions $options,
        array $monitorIdentity = []
    ) {
        $this->dataSource = $dataSource;
        $this->notifier = $notifier;
        $this->relayClient = $relayClient;
        $this->options = $options;
        $this->monitorIdentity = $monitorIdentity;
        $this->controlAdminPubkeys = $this->normalizeAdminPubkeys($monitorIdentity['admin_pubkeys'] ?? []);
        $this->monitorRelays = array_values(array_filter(array_map('trim', (array)($monitorIdentity['relays'] ?? []))));
        $this->startedAt = time();
    }

    public function run(): void
    {
        if ($this->options->once) {
            $this->refreshState();
            $this->printBootstrapSummary();
            echo "Modo propuesta/esqueleto: run --once no abre todavía WebSocket real.\n";
            return;
        }

        if ($this->relayClient === null) {
            echo "RelayClient no implementado todavía.\n";
            return;
        }

        $this->installSignalHandlers();

        while (!$this->shouldStop) {
            $this->dispatchSignals();
            $this->refreshState();
            $this->printBootstrapSummary();

            $filters = $this->buildFilters();
            if ($filters === []) {
                if (!$this->waitingForTrades) {
                    echo "No hay trades activos monitorizables. Monitor en espera.\n";
                    $this->waitingForTrades = true;
                }
                sleep($this->options->idleSleepSeconds);
                continue;
            }

            $this->waitingForTrades = false;
            $relays = $this->monitorRelays;

            try {
                $filterHash = md5((string)json_encode($filters));
                if ($this->options->debugRelays && $filterHash !== $this->lastFilterHash) {
                    echo "[monitor] filters updated\n";
                    $this->lastFilterHash = $filterHash;
                }

                $this->relayClient->connect($relays);
                $this->maybePublishMonitorProfile();
                $this->maybeSendStartupDm();
                $this->relayClient->subscribe($filters);

                $sessionStart = time();
                $this->relayClient->run(function (array $message): void {
                    $this->handleRelayMessage($message);
                }, function () use ($sessionStart): bool {
                    $this->dispatchSignals();

                    if ($this->shouldStop) {
                        return true;
                    }

                    if ($this->shouldReload) {
                        return true;
                    }

                    return (time() - $sessionStart) >= $this->options->refreshIntervalSeconds;
                });
            } catch (Exception $e) {
                fwrite(STDERR, "[monitor] relay session error: " . $e->getMessage() . "\n");
            }

            $this->relayClient->disconnect();

            if ($this->shouldReload) {
                if ($this->options->verbose) {
                    echo "[control] relay session reload requested\n";
                }
                $this->shouldReload = false;
                continue;
            }

            if (!$this->shouldStop) {
                sleep($this->options->reconnectDelaySeconds);
            }
        }

        echo "NoxtrMonitor stopped.\n";
    }

    private function refreshState(): void
    {
        $this->tradeIndex = [];
        $this->onchainOrderIndex = [];

        // ── FEATURE: DM TELEGRAM NOTIFICATIONS ──────────────────────────────
        $this->dmNotifyIndex = [];
        foreach ($this->dataSource->loadTelegramLinkedUsersWithPubkey() as $row) {
            $pubkey = strtolower(trim((string)($row['nostr_pubkey'] ?? '')));
            $chatId = (string)($row['chat_id'] ?? '');
            if ($pubkey !== '' && $chatId !== '') {
                $this->dmNotifyIndex[$pubkey] = $chatId;
            }
        }
        // ── END FEATURE: DM TELEGRAM NOTIFICATIONS ───────────────────────────

        foreach ($this->dataSource->loadActiveTrades() as $trade) {
            // NostrEscrow no entrega la private key Bitcoin al servidor. Sus eventos públicos se
            // monitorizan por order_id y no necesitan material secreto.
            if ($trade->method === 'onchain' && $trade->orderId !== '') {
                $this->onchainOrderIndex[$trade->orderId][] = $trade;
            }
            if ($trade->tradeKeyPub === '' || $trade->tradePrivkey === '') {
                continue;
            }
            $this->tradeIndex[$trade->tradeKeyPub] = $trade;
        }

        if ($this->options->debugRelays) {
            foreach ($this->tradeIndex as $pubkey => $trade) {
                echo '[monitor] trade order=' . $trade->orderId
                    . ' status=' . $trade->internalStatus
                    . ' role=' . $trade->tradeRole
                    . ' kind=' . $trade->tradeKind
                    . ' p=' . $pubkey . "\n";
            }
        }
    }

    /**
     * Filtros de suscripción del monitor. El mínimo viable:
     * - mensajes del nodo Mostro (transporte v2: kind 14 NIP-44 directo) con #p contra todas las
     *   trade_key_pub activas. Peer chat y chat de disputa también son kind 14 (protocol/chat.html +
     *   dispute_chat.html), pero van dirigidos a pub(K_conv)/authors=pub(K_sign) — claves derivadas
     *   distintas de la trade_key_pub — así que no coinciden con este filtro y no llegan aquí.
     * (además: eventos on-chain, order book y canal de control NIP-04, según configuración)
     *
     * @return array<int,array<string,mixed>>
     */
    private function buildFilters(): array
    {
        $pubs = array_keys($this->tradeIndex);
        $filters = [];

        if ($pubs !== []) {
            $filters[] = [
                'kinds' => [14],
                '#p' => array_values($pubs),
                // Mirror the frontend's subscription window so we don't miss recent trade events
                // while the monitor is restarted or reconnecting.
                'since' => time() - 86400 * 7,
            ];
        }

        // On-chain (NostrEscrow): eventos públicos en claro. Trade State (39385), Dispute (39386),
        // Arbitration (39387), Funding (39389). Se filtran por #order_id de trades on-chain
        // activos; el casado fino a usuario se hace luego por el tag `p` en handleOnchainTradeEvent.
        $onchainOrderIds = array_keys($this->onchainOrderIndex);
        if ($onchainOrderIds !== []) {
            $filters[] = [
                'kinds' => [39385, 39386, 39387, 39389],
                '#y'    => ['nostrescrow'],
                '#order_id' => array_values($onchainOrderIds),
                'since' => time() - 86400 * 365,
            ];
        }

        // Order book on-chain (NostrEscrow, kind 39383 con #y=nostrescrow): para notificar a los
        // admins cada nueva oferta on-chain. Sin restricción por #d (cualquier oferta, no solo las
        // de trades ya en curso). El filtrado de canceladas/expiradas se hace al recibir.
        $filters[] = [
            'kinds' => [39383],
            '#y'    => ['nostrescrow'],
            'since' => time() - 86400 * 2,
        ];

        $controlFilter = $this->buildControlFilter();
        if ($controlFilter !== null) {
            $filters[] = $controlFilter;
        }

        // ── FEATURE: DM TELEGRAM NOTIFICATIONS ──────────────────────────────
        $dmFilter = $this->buildDmNotifyFilter();
        if ($dmFilter !== null) {
            $filters[] = $dmFilter;
        }
        // ── END FEATURE: DM TELEGRAM NOTIFICATIONS ───────────────────────────

        $orderBookFilter = $this->buildOrderBookFilter();
        if ($orderBookFilter !== null) {
            $filters[] = $orderBookFilter;
        }

        // Kind 38386: disputas públicas de instancias Mostro v2. Notificar a los admins cada
        // disputa nueva (auditoría 2026-08-22, punto que faltaba: el cliente ya lo procesa,
        // el monitor no).
        $filters[] = [
            'kinds' => [38386],
            '#z'    => ['dispute'],
            'since' => time() - 86400 * 2,
        ];

        $filters[] = $this->buildRobotStatusFilter();

        if ($this->options->debugWide) {
            $filters[] = [
                'kinds' => [14, 1059],
                'since' => time() - 600,
                'limit' => 50,
            ];
        }

        return $filters;
    }

    /**
     * @return array<string,mixed>|null
     */
    // ── FEATURE: DM TELEGRAM NOTIFICATIONS ──────────────────────────────────
    /**
     * @return array<string,mixed>|null
     */
    private function buildDmNotifyFilter()
    {
        if ($this->dmNotifyIndex === []) {
            return null;
        }
        return [
            'kinds' => [4],
            '#p'    => array_keys($this->dmNotifyIndex),
            'since' => time() - 3600 * 6,
        ];
    }
    // ── END FEATURE: DM TELEGRAM NOTIFICATIONS ───────────────────────────────

    private function buildOrderBookFilter()
    {
        // Suscripción al order book Mostro: para notificar por DM/email/telegram cada orden nueva.
        return [
            'kinds' => [38383],
            '#s' => ['pending'],
            '#y' => ['mostro'],
            'since' => time() - 86400 * 2,
        ];
    }

    private function buildRobotStatusFilter()
    {
        // Estado de las instancias Mostro (kind 38385, heartbeat ~5 min): se usa para conocer
        // el protocol_version de cada instancia y notificar SOLO ofertas de instancias v2
        // (transporte kind 14, las únicas operables desde noxtr). Tag ausente = daemon v1.
        return [
            'kinds' => [38385],
            'since' => time() - 86400,
        ];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function buildControlFilter()
    {
        $monitorPubkey = trim((string)($this->monitorIdentity['pubkey'] ?? ''));
        if ($monitorPubkey === '' || $this->controlAdminPubkeys === []) {
            return null;
        }

        return [
            'kinds' => [4],
            '#p' => [$monitorPubkey],
            'authors' => array_values($this->controlAdminPubkeys),
            'since' => time() - $this->getControlCommandMaxAgeSeconds(),
        ];
    }

    private function printBootstrapSummary(): void
    {
        static $printed = false;
        static $lastTradesCount = null;

        $tradesCount = count($this->tradeIndex);
        if ($printed && $lastTradesCount === $tradesCount) {
            return;
        }

        echo "NoxtrMonitor bootstrap\n";
        echo "- source   : {$this->options->source}\n";
        echo "- trades   : " . $tradesCount . "\n";
        echo "- relays   : " . count($this->monitorRelays) . "\n";
        echo "- dry-run  : " . ($this->options->dryRun ? 'yes' : 'no') . "\n";
        echo "- new-offer notif: " . ($this->notifyNewOffers ? 'yes' : 'no') . "\n";
        if (!empty($this->monitorIdentity['pubkey'])) {
            echo "- monitor  : " . substr((string)$this->monitorIdentity['pubkey'], 0, 16) . "...\n";
        }
        if (!empty($this->monitorIdentity['npub'])) {
            echo "- npub     : " . (string)$this->monitorIdentity['npub'] . "\n";
        }
        if (isset($this->monitorIdentity['admin_pubkeys']) && is_array($this->monitorIdentity['admin_pubkeys'])) {
            echo "- admins   : " . count($this->controlAdminPubkeys) . "\n";
        }

        $printed = true;
        $lastTradesCount = $tradesCount;
    }

    private function maybeSendStartupDm(): void
    {
        if ($this->startupDmSent || !$this->options->startupDm) {
            return;
        }

        $this->startupDmSent = true;

        if ($this->controlAdminPubkeys === []) {
            if ($this->options->verbose) {
                echo "[control] startup DM skipped: no admins configured\n";
            }
            return;
        }

        $text = $this->buildStartupDmText();
        $sent = 0;

        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            if ($this->sendControlDm($recipientPubkey, $text)) {
                $sent++;
            }
        }

        if ($this->options->verbose) {
            echo '[control] startup DM ' . ($sent > 0 ? 'sent' : 'failed')
                . ' -> ' . $sent . '/' . count($this->controlAdminPubkeys) . "\n";
        }
    }

    private function buildStartupDmText(): string
    {
        $custom = trim((string)$this->options->startupDmText);
        if ($custom !== '') {
            return $custom;
        }

        $parts = [
            'NoxtrMonitor arrancado correctamente.',
            'Mensaje automático de prueba del canal DM.',
            'trades=' . count($this->tradeIndex),
        ];

        if (!empty($this->monitorIdentity['npub'])) {
            $parts[] = 'npub=' . (string)$this->monitorIdentity['npub'];
        }

        $parts[] = 'hora=' . date('Y-m-d H:i:s');

        return implode(' | ', $parts);
    }

    /**
     * @param array<int,mixed> $message
     */
    private function handleRelayMessage(array $message): void
    {
        /**
         * Forma Nostr esperada:
         * ["EVENT", "<subid>", { ...event... }]
         * ["EOSE",  "<subid>"]
         * ["OK", "...", true, ""]
         * ["NOTICE", "..."]
         */
        $type = $message[0] ?? null;
        if ($type !== 'EVENT' || !isset($message[2]) || !is_array($message[2])) {
            return;
        }

        $event = new MonitorEvent($message[2]);
        if ($event->kind === 4) {
            $monitorPubkey = strtolower(trim((string)($this->monitorIdentity['pubkey'] ?? '')));
            $pTags = array_map('strtolower', $event->pTags());
            if ($monitorPubkey !== '' && in_array($monitorPubkey, $pTags, true)) {
                $this->handleControlDm($event);
            } else {
                // ── FEATURE: DM TELEGRAM NOTIFICATIONS ──────────────────────
                $this->handleUserDm($event, $pTags);
                // ── END FEATURE ───────────────────────────────────────────────
            }
            return;
        }

        if ($event->kind === 38385) {
            $this->handleRobotStatusEvent($event);
            return;
        }

        if ($event->kind === 38386) {
            $this->handleMostroDisputeEvent($event);
            return;
        }

        if ($event->kind === 38383) {
            $this->handleOrderBookEvent($event);
            return;
        }

        if ($event->kind === 39383) {
            $this->handleOnchainOfferEvent($event);
            return;
        }

        if (in_array($event->kind, [39385, 39386, 39387, 39389], true)) {
            $this->handleOnchainTradeEvent($event);
            return;
        }

        // Canal instancia v2: los mensajes del nodo Mostro llegan en kind 14 (NIP-44 directo).
        if ($event->kind !== 14 || $event->eventId === '') {
            if ($this->options->debugRelays) {
                echo '[mostro] ignored event kind=' . $event->kind . ' id=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }
        if ($this->dataSource->isEventProcessed($event->eventId)) {
            if ($this->options->debugRelays) {
                echo '[mostro] already processed id=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        $pTags = $event->pTags();
        if ($this->options->debugRelays) {
            echo '[mostro] event id=' . substr($event->eventId, 0, 12)
                . ' p-tags=' . implode(',', $pTags) . "\n";
        }

        $trade = $this->matchTradeByPTags($pTags);
        if ($trade === null) {
            if ($this->options->debugRelays) {
                echo '[mostro] no matching trade for event id=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        // Transporte v2: descifrar el kind 14 en una sola capa NIP-44 (convKey = tradePriv ↔ nodo).
        // El contenido es el 3-tuple [msgObj, tradeSig, identityProof]; solo nos interesa msgObj.
        // nip44Decrypt lanza excepción si el payload/MAC no cuadra: se captura para no tumbar el loop.
        try {
            $convKey = NostrCrypto::nip44GetConversationKey($trade->tradePrivkey, $event->pubkey);
            $tupleJson = NostrCrypto::nip44Decrypt($event->content, $convKey);
        } catch (\Throwable $e) {
            $tupleJson = null;
        }
        if (!is_string($tupleJson) || $tupleJson === '') {
            if ($this->options->verbose) {
                echo '[mostro] nip44 decrypt failed for order=' . $trade->orderId . ' event=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        $msg = json_decode($tupleJson, true);
        if (!is_array($msg)) {
            if ($this->options->verbose) {
                echo '[mostro] invalid tuple content for order=' . $trade->orderId . ' event=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        $msgObj = is_array($msg[0] ?? null) ? $msg[0] : $msg;
        $order = is_array($msgObj['order'] ?? null) ? $msgObj['order'] : [];
        $action = trim((string)($order['action'] ?? ''));
        $payload = $order['payload'] ?? null;

        if ($action === '') {
            if ($this->options->verbose) {
                echo '[mostro] no action in rumor for order=' . $trade->orderId . ' event=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        $this->dataSource->storeEvent([
            'event_id' => $event->eventId,
            'kind' => $event->kind,
            'order_id' => $trade->orderId,
            'user_id' => $trade->userId,
            'event_created_at' => $event->createdAt,
            'source' => 'mostro',
            'status' => $action,
            'raw_json' => json_encode($event->raw),
            'processed_at' => time(),
        ]);

        if ($this->options->verbose) {
            echo '[mostro] action=' . $action
                . ' order=' . $trade->orderId
                . ' trade_index=' . (string)($order['trade_index'] ?? '')
                . "\n";
        }

        $this->maybeNotify($trade, $action, $event->eventId);
    }

    /**
     * @param string[] $pTags
     */
    private function matchTradeByPTags(array $pTags): ?MonitoredTrade
    {
        foreach ($pTags as $pubkey) {
            if (isset($this->tradeIndex[$pubkey])) {
                return $this->tradeIndex[$pubkey];
            }
        }

        return null;
    }

    /**
     * Estado de instancia Mostro (kind 38385): registra el protocol_version del transporte.
     * Es addressable: se descartan generaciones más viejas que la ya procesada.
     */
    private function handleRobotStatusEvent(MonitorEvent $event): void
    {
        $pubkey = strtolower($event->pubkey);
        if ($pubkey === '') {
            return;
        }
        if ($event->createdAt < ($this->robotStatusAt[$pubkey] ?? 0)) {
            return;
        }
        $this->robotStatusAt[$pubkey] = $event->createdAt;

        $version = 1; // tag ausente = daemon previo al tag = transporte v1
        foreach ($event->tags as $tag) {
            if (($tag[0] ?? '') === 'protocol_version') {
                $version = (int)($tag[1] ?? 1);
                break;
            }
        }
        $prev = $this->robotProtocolVersion[$pubkey] ?? null;
        $this->robotProtocolVersion[$pubkey] = $version;
        if ($this->options->verbose && $prev !== $version) {
            echo '[status] robot ' . substr($pubkey, 0, 12) . ' protocol_version=' . $version . "\n";
        }
    }

    private function handleOrderBookEvent(MonitorEvent $event): void
    {
        if ($event->eventId === '') {
            return;
        }

        if (isset($this->seenOrderBookEventIds[$event->eventId])) {
            return;
        }
        $this->seenOrderBookEventIds[$event->eventId] = time();
        $this->trimAssocMap($this->seenOrderBookEventIds, 4000);

        // Solo instancias con transporte v2 (kind 14): v1 está obsoleto y se ignora en
        // silencio, como si no existiera. Instancia sin 38385 conocido aún → se asume v1
        // (su heartbeat llega cada ~5 min, así que la ventana de duda es corta).
        $robotPubkey = strtolower($event->pubkey);
        if (($this->robotProtocolVersion[$robotPubkey] ?? 1) !== 2) {
            return;
        }

        $order = $this->parseOrderBookEvent($event->raw);
        if ($order === null) {
            return;
        }

        if ($this->dataSource->isEventProcessed($event->eventId)) {
            return;
        }

        // Notificar toda orden nueva por DM a los admins (una sola vez por order UUID)
        $orderUuid = (string)($order['id'] ?? '');
        $alreadyNotified = ($orderUuid !== '' && isset($this->seenNotifiedOrderIds[$orderUuid]))
            || ($orderUuid !== '' && $this->dataSource->wasNotificationSent($orderUuid, 'new-order'));
        if (!$alreadyNotified) {
            if ($orderUuid !== '') {
                $this->seenNotifiedOrderIds[$orderUuid] = time();
                $this->trimAssocMap($this->seenNotifiedOrderIds, 2000);
            }
            $this->notifyNewOrderViaDm($order);
            if ($orderUuid !== '') {
                $this->dataSource->markNotificationSent($orderUuid, 'new-order', $event->eventId);
            }
        }
    }

    /**
     * Notifica por DM y email cada nueva orden del order book.
     * Solo notifica órdenes creadas después del arranque del monitor para evitar
     * inundar el chat con el histórico de las últimas 48h al reconectar.
     *
     * @param array<string,mixed> $order
     */
    private function notifyNewOrderViaDm(array $order): void
    {
        if (!$this->notifyNewOffers) {
            return;
        }

        // Ignorar órdenes anteriores al arranque del proceso
        $orderCreatedAt = (int)($order['created_at'] ?? 0);
        if ($orderCreatedAt > 0 && $orderCreatedAt < $this->startedAt) {
            return;
        }

        $text = $this->buildNewOrderDmText($order);
        $fiatCode = (string)($order['fiat_code'] ?? '');

        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            if (!$this->adminWantsFiat($recipientPubkey, $fiatCode)) {
                continue;
            }
            $this->sendControlDm($recipientPubkey, $text);
        }

        $this->notifyNewOrderViaEmail($order, $text);
        $this->notifyNewOrderViaTelegram($order);

        if ($this->options->verbose) {
            echo '[order] new order notified: ' . $text . "\n";
        }
    }

    /**
     * @param array<string,mixed> $order
     */
    private function notifyNewOrderViaEmail(array $order, string $text): void
    {
        $recipients = $this->resolveAdminAlertEmails((string)($order['fiat_code'] ?? ''));
        if ($recipients === []) {
            return;
        }

        $orderId  = (string)($order['id'] ?? '');
        $shortId  = substr($orderId, 0, 8);
        $type     = strtoupper((string)($order['order_type'] ?? '?'));
        $amount   = trim((string)($order['fiat_amount'] ?? '?') . ' ' . (string)($order['fiat_code'] ?? ''));
        $pm       = trim((string)($order['payment_method'] ?? ''));
        $days     = $order['account_days'] ?? null;
        $dLabel   = $days === null ? 'sin days' : $days . ' días';
        $robot    = (string)($order['robot_pubkey'] ?? '');

        $subject = 'Nueva orden Mostro #' . $shortId . ' · ' . $type . ' · ' . $amount;
        $html = '<p><strong>Nueva orden en el order book Mostro.</strong></p>'
            . '<p><strong>ID:</strong> <code>' . htmlspecialchars($shortId, ENT_QUOTES, 'UTF-8') . '</code></p>'
            . '<p><strong>Tipo:</strong> ' . htmlspecialchars($type, ENT_QUOTES, 'UTF-8') . '</p>'
            . '<p><strong>Importe:</strong> ' . htmlspecialchars($amount, ENT_QUOTES, 'UTF-8') . '</p>'
            . ($pm !== '' ? '<p><strong>Método de pago:</strong> ' . htmlspecialchars($pm, ENT_QUOTES, 'UTF-8') . '</p>' : '')
            . '<p><strong>Antigüedad cuenta robot:</strong> ' . htmlspecialchars($dLabel, ENT_QUOTES, 'UTF-8') . '</p>'
            . '<p><strong>Robot:</strong> <code>' . htmlspecialchars($robot, ENT_QUOTES, 'UTF-8') . '</code></p>';

        foreach ($recipients as $to) {
            $this->notifier->sendEmail($to, $subject, $html);
        }
    }

    /**
     * @param array<string,mixed> $order
     */
    private function notifyNewOrderViaTelegram(array $order): void
    {
        if ($this->dmNotifyIndex === []) {
            return;
        }

        $shortId = substr((string)($order['id'] ?? ''), 0, 8);
        $type    = strtoupper((string)($order['order_type'] ?? '?'));
        $amount  = trim((string)($order['fiat_amount'] ?? '?') . ' ' . (string)($order['fiat_code'] ?? ''));
        $pm      = trim((string)($order['payment_method'] ?? ''));
        $days    = $order['account_days'] ?? null;
        $dLabel  = $days === null ? 'sin days' : $days . ' días';
        $robot   = substr((string)($order['robot_pubkey'] ?? ''), 0, 16) . '...';

        $msg = "🆕 Nueva orden Mostro\n"
            . "#" . $shortId . " · " . $type . " · " . $amount . "\n"
            . ($pm !== '' ? "💳 " . $pm . "\n" : '')
            . "🤖 " . $robot . " · " . $dLabel;

        $sentIds = [];
        foreach ($this->controlAdminPubkeys as $pubkey) {
            $chatId = $this->dmNotifyIndex[$pubkey] ?? null;
            if ($chatId === null || in_array($chatId, $sentIds, true)) {
                continue;
            }
            if (!$this->adminWantsFiat($pubkey, (string)($order['fiat_code'] ?? ''))) {
                continue;
            }
            $sent = $this->notifier->sendTelegram($chatId, $msg);
            if ($sent) {
                $sentIds[] = $chatId;
            }
            if ($this->options->verbose) {
                echo '[order] new-order telegram ' . ($sent ? 'sent' : 'failed') . " -> {$chatId}\n";
            }
        }
    }

    /**
     * @param array<string,mixed> $order
     */
    private function buildNewOrderDmText(array $order): string
    {
        $id      = '#' . substr((string)($order['id'] ?? ''), 0, 8);
        $type    = strtoupper((string)($order['order_type'] ?? '?'));
        $amount  = trim((string)($order['fiat_amount'] ?? '?') . ' ' . (string)($order['fiat_code'] ?? ''));
        $pm      = $this->truncateTradeField(trim((string)($order['payment_method'] ?? '')), 24);
        $days    = $order['account_days'] ?? null;
        $dLabel  = $days === null ? 'no-days' : $days . 'd';
        $robot   = substr((string)($order['robot_pubkey'] ?? ''), 0, 8) . '...';

        $parts = ['orden', $id, $type, $amount, $pm !== '' ? $pm : '?', $dLabel, 'robot=' . $robot];

        return implode(' | ', $parts);
    }

    /**
     * Nueva oferta on-chain (NostrEscrow, kind 39383). Avisa a los admins igual que las Mostro.
     * Descarta canceladas/expiradas (expires_at 0/1 o pasado) y republicaciones ya notificadas
     * (dedup por order id, que es replaceable via el tag `d`).
     */
    private function handleOnchainOfferEvent(MonitorEvent $event): void
    {
        if ($event->eventId === '' || !$this->notifyNewOffers) {
            return;
        }
        if (strtolower($event->firstTag('y')) !== 'nostrescrow') {
            return;
        }
        if (isset($this->seenOrderBookEventIds[$event->eventId])) {
            return;
        }
        $this->seenOrderBookEventIds[$event->eventId] = time();
        $this->trimAssocMap($this->seenOrderBookEventIds, 4000);

        $orderId = trim($event->firstTag('d'));
        $type = strtolower(trim($event->firstTag('k')));
        if ($orderId === '' || !in_array($type, ['buy', 'sell'], true)) {
            return;
        }

        // Cancelada (expires_at 0/1) o ya expirada → no es una oferta viva.
        // Tag ausente = sin caducidad (expires_at es opcional en la spec y createOrder no lo pone).
        $expiresTag = trim($event->firstTag('expires_at'));
        if ($expiresTag !== '') {
            $expiresAt = (int)$expiresTag;
            if ($expiresAt <= 1 || $expiresAt < time()) {
                return;
            }
        }

        // Ignorar histórico anterior al arranque del proceso (evita inundar al reconectar).
        if ($event->createdAt > 0 && $event->createdAt < $this->startedAt) {
            return;
        }

        if (isset($this->seenNotifiedOrderIds[$orderId])
            || $this->dataSource->wasNotificationSent($orderId, 'new-onchain-offer')) {
            return;
        }
        $this->seenNotifiedOrderIds[$orderId] = time();
        $this->trimAssocMap($this->seenNotifiedOrderIds, 2000);

        // fiat_amount puede ser rango: [fiat_amount, min, max].
        $faMin = ''; $faMax = '';
        foreach ($event->tags as $tag) {
            if (($tag[0] ?? '') === 'fiat_amount') {
                $faMin = trim((string)($tag[1] ?? ''));
                $faMax = trim((string)($tag[2] ?? ''));
                break;
            }
        }
        $fiatLabel = ($faMax !== '' ? $faMin . '-' . $faMax : $faMin) . ' ' . trim($event->firstTag('fiat_code'));

        $offer = [
            'id'             => $orderId,
            'order_type'     => $type,
            'fiat_code'      => strtoupper(trim($event->firstTag('fiat_code'))),
            'fiat_label'     => trim($fiatLabel),
            'amount_sats'    => (int)$event->firstTag('amount'),
            'payment_method' => trim($event->firstTag('payment_method')),
            'network'        => trim($event->firstTag('network')) ?: 'mainnet',
            'maker_pubkey'   => $event->pubkey,
        ];

        $this->notifyNewOnchainOffer($offer);
        $this->dataSource->markNotificationSent($orderId, 'new-onchain-offer', $event->eventId);

        if ($this->options->verbose) {
            echo '[onchain-offer] new offer notified: #' . substr($orderId, 0, 8)
                . ' ' . $type . ' ' . $offer['fiat_label'] . "\n";
        }
    }

    /**
     * @param array<string,mixed> $offer
     */
    private function notifyNewOnchainOffer(array $offer): void
    {
        $short = substr((string)$offer['id'], 0, 8);
        $type  = strtoupper((string)$offer['order_type']);
        $net   = (string)$offer['network'];
        $fiat  = (string)$offer['fiat_label'];
        $pm    = (string)$offer['payment_method'];

        // DM de control (NIP-04, kind 4) a los admins.
        $fiatCode = (string)($offer['fiat_code'] ?? '');
        $dmText = implode(' | ', ['oferta on-chain', '#' . $short, $type, $fiat !== '' ? $fiat : '?',
            $pm !== '' ? $this->truncateTradeField($pm, 24) : '?', 'net=' . $net]);
        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            if (!$this->adminWantsFiat($recipientPubkey, $fiatCode)) {
                continue;
            }
            $this->sendControlDm($recipientPubkey, $dmText);
        }

        // Email a los admins.
        $recipients = $this->resolveAdminAlertEmails($fiatCode);
        if ($recipients !== []) {
            $subject = 'Nueva oferta on-chain #' . $short . ' · ' . $type . ' · ' . $fiat;
            $html = '<p><strong>Nueva oferta on-chain (NostrEscrow).</strong></p>'
                . '<p><strong>ID:</strong> <code>' . htmlspecialchars($short, ENT_QUOTES, 'UTF-8') . '</code></p>'
                . '<p><strong>Tipo:</strong> ' . htmlspecialchars($type, ENT_QUOTES, 'UTF-8') . '</p>'
                . '<p><strong>Importe:</strong> ' . htmlspecialchars($fiat, ENT_QUOTES, 'UTF-8') . '</p>'
                . ($pm !== '' ? '<p><strong>Método de pago:</strong> ' . htmlspecialchars($pm, ENT_QUOTES, 'UTF-8') . '</p>' : '')
                . '<p><strong>Red:</strong> ' . htmlspecialchars($net, ENT_QUOTES, 'UTF-8') . '</p>'
                . '<p><strong>Maker:</strong> <code>' . htmlspecialchars((string)$offer['maker_pubkey'], ENT_QUOTES, 'UTF-8') . '</code></p>';
            foreach ($recipients as $to) {
                $this->notifier->sendEmail($to, $subject, $html);
            }
        }

        // Telegram a los admins vinculados.
        if ($this->dmNotifyIndex !== []) {
            $msg = "🆕 Nueva oferta on-chain\n"
                . "#" . $short . " · " . $type . " · " . ($fiat !== '' ? $fiat : '?') . "\n"
                . ($pm !== '' ? "💳 " . $pm . "\n" : '')
                . "⛓️ " . $net;
            $sentIds = [];
            foreach ($this->controlAdminPubkeys as $pubkey) {
                $chatId = $this->dmNotifyIndex[$pubkey] ?? null;
                if ($chatId === null || in_array($chatId, $sentIds, true)) {
                    continue;
                }
                if (!$this->adminWantsFiat($pubkey, $fiatCode)) {
                    continue;
                }
                if ($this->notifier->sendTelegram($chatId, $msg)) {
                    $sentIds[] = $chatId;
                }
            }
        }
    }

    /**
     * Kind 38386 (disputas públicas de instancias Mostro v2, #z=dispute). Notifica a los admins
     * cuando aparece una disputa NUEVA (status=initiated). Auditoría 2026-08-22: el cliente ya
     * procesa este kind (script.mostro.js), el monitor no lo suscribía.
     */
    private function handleMostroDisputeEvent(MonitorEvent $event): void
    {
        if ($event->eventId === '' || !$this->notifyNewOffers) {
            return;
        }
        if (isset($this->seenOrderBookEventIds[$event->eventId])) {
            return;
        }
        $this->seenOrderBookEventIds[$event->eventId] = time();
        $this->trimAssocMap($this->seenOrderBookEventIds, 4000);

        $disputeId = trim($event->firstTag('d'));
        $status = strtolower(trim($event->firstTag('s')));
        $initiator = strtolower(trim($event->firstTag('initiator')));
        if ($disputeId === '' || $status !== 'initiated') {
            return;
        }

        // Ignorar histórico anterior al arranque del proceso (evita inundar al reconectar).
        if ($event->createdAt > 0 && $event->createdAt < $this->startedAt) {
            return;
        }

        if ($this->dataSource->wasNotificationSent($disputeId, 'new-mostro-dispute')) {
            return;
        }

        $info = [
            'dispute_id'   => $disputeId,
            'initiator'    => $initiator,
            'robot_pubkey' => $event->pubkey,
        ];

        $this->notifyNewMostroDispute($info);
        $this->dataSource->markNotificationSent($disputeId, 'new-mostro-dispute', $event->eventId);

        if ($this->options->verbose) {
            echo '[mostro-dispute] new dispute notified: #' . substr($disputeId, 0, 8)
                . ' initiator=' . $initiator . "\n";
        }
    }

    /**
     * @param array<string,mixed> $info
     */
    private function notifyNewMostroDispute(array $info): void
    {
        $this->notifyNewMostroDisputeViaDm($info);
        $this->notifyNewMostroDisputeViaEmail($info);
        $this->notifyNewMostroDisputeViaTelegram($info);
    }

    /**
     * @param array<string,mixed> $info
     */
    private function notifyNewMostroDisputeViaDm(array $info): void
    {
        $text = $this->buildMostroDisputeText($info);
        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            $this->sendControlDm($recipientPubkey, $text);
        }
    }

    /**
     * @param array<string,mixed> $info
     */
    private function notifyNewMostroDisputeViaEmail(array $info): void
    {
        $recipients = $this->resolveAdminAlertEmails();
        if ($recipients === []) {
            return;
        }

        $robotShort = substr((string)$info['robot_pubkey'], 0, 12) . '…';
        $disputeShort = substr((string)$info['dispute_id'], 0, 8);
        $initiator = (string)$info['initiator'];

        $subject = 'NoxtrMonitor: disputa iniciada #' . $disputeShort;
        $html = '<p><strong>⚠️ Disputa iniciada en una instancia Mostro.</strong></p>'
            . '<p><strong>Instancia:</strong> <code>' . htmlspecialchars($robotShort, ENT_QUOTES, 'UTF-8') . '</code></p>'
            . '<p><strong>Dispute ID:</strong> <code>#' . htmlspecialchars($disputeShort, ENT_QUOTES, 'UTF-8') . '</code></p>'
            . '<p><strong>Iniciada por:</strong> ' . htmlspecialchars($initiator, ENT_QUOTES, 'UTF-8') . '</p>';

        foreach ($recipients as $to) {
            $this->notifier->sendEmail($to, $subject, $html);
        }
    }

    /**
     * @param array<string,mixed> $info
     */
    private function notifyNewMostroDisputeViaTelegram(array $info): void
    {
        if ($this->dmNotifyIndex === []) {
            return;
        }

        $msg = $this->buildMostroDisputeText($info);
        $sentIds = [];
        foreach ($this->controlAdminPubkeys as $pubkey) {
            $chatId = $this->dmNotifyIndex[$pubkey] ?? null;
            if ($chatId === null || in_array($chatId, $sentIds, true)) {
                continue;
            }
            if ($this->notifier->sendTelegram($chatId, $msg)) {
                $sentIds[] = $chatId;
            }
        }
    }

    /**
     * @param array<string,mixed> $info
     */
    private function buildMostroDisputeText(array $info): string
    {
        $robotShort = substr((string)$info['robot_pubkey'], 0, 12) . '…';
        $disputeShort = substr((string)$info['dispute_id'], 0, 8);
        $initiator = (string)$info['initiator'];

        return '⚠️ NoxtrMonitor: disputa iniciada en la instancia ' . $robotShort
            . '. Dispute ID #' . $disputeShort . '. Iniciada por: ' . $initiator . '.';
    }

    /**
     * @param array<string,mixed> $event
     * @return array<string,mixed>|null
     */
    private function parseOrderBookEvent(array $event)
    {
        $tags = is_array($event['tags'] ?? null) ? $event['tags'] : [];
        $flat = [];
        $paymentMethods = [];
        $faTag = null;

        foreach ($tags as $tag) {
            if (!is_array($tag) || !isset($tag[0])) {
                continue;
            }

            $name = (string)$tag[0];
            if ($name === 'pm') {
                for ($i = 1; $i < count($tag); $i++) {
                    $value = trim((string)($tag[$i] ?? ''));
                    if ($value !== '') {
                        $paymentMethods[] = $value;
                    }
                }
                continue;
            }

            if ($name === 'fa') {
                $faTag = $tag;
            }

            $flat[$name] = isset($tag[1]) ? (string)$tag[1] : '';
        }

        $orderId = trim((string)($flat['d'] ?? $flat['name'] ?? ''));
        $orderType = strtolower(trim((string)($flat['k'] ?? '')));
        $daemon = strtolower(trim((string)($flat['y'] ?? 'mostro')));
        $status = strtolower(trim((string)($flat['s'] ?? 'pending')));

        if ($orderId === '' || !in_array($orderType, ['buy', 'sell'], true)) {
            return null;
        }
        if ($daemon !== 'mostro' || $status !== 'pending') {
            return null;
        }

        $isRange = is_array($faTag)
            && array_key_exists(2, $faTag)
            && trim((string)($faTag[2] ?? '')) !== '';
        if ($isRange) {
            return null;
        }

        $fiatAmount = is_array($faTag) && isset($faTag[1])
            ? trim((string)$faTag[1])
            : trim((string)($flat['fa'] ?? ''));
        $normalizedAmount = $this->normalizeNumericValue($fiatAmount);
        if ($normalizedAmount === null) {
            return null;
        }

        $createdAt = (int)($event['created_at'] ?? 0);
        $expiration = max(0, (int)($flat['expiration'] ?? 0));
        $orderExpiry = 0;
        if ($createdAt > 0) {
            $defaultWindow = 86400;
            if ($expiration > 0 && ($expiration - $createdAt) > ($defaultWindow * 2)) {
                $orderExpiry = $createdAt + $defaultWindow;
            } else {
                $orderExpiry = $expiration > 0 ? $expiration : ($createdAt + $defaultWindow);
            }
        }
        if ($orderExpiry > 0 && $orderExpiry <= time()) {
            return null;
        }

        $robotPubkey = strtolower(trim((string)($event['pubkey'] ?? '')));
        if (!preg_match('/^[0-9a-f]{64}$/', $robotPubkey)) {
            return null;
        }

        $ratingDays = null;
        $ratingRaw = trim((string)($flat['rating'] ?? ''));
        if ($ratingRaw !== '') {
            $decodedRating = json_decode($ratingRaw, true);
            if (is_array($decodedRating)) {
                $ratingObj = is_array($decodedRating[1] ?? null) ? $decodedRating[1] : $decodedRating;
                $days = $this->normalizeNonNegativeInt(is_array($ratingObj) ? ($ratingObj['days'] ?? null) : null);
                if ($days !== null) {
                    $ratingDays = $days;
                }
            }
        }

        return [
            'id' => $orderId,
            'order_type' => $orderType,
            'take_action' => $orderType === 'sell' ? 'take-sell' : 'take-buy',
            'fiat_amount' => $fiatAmount,
            'fiat_amount_norm' => $normalizedAmount,
            'fiat_code' => strtoupper(trim((string)($flat['f'] ?? ''))),
            'payment_method' => implode(', ', array_values(array_unique($paymentMethods))),
            'sat_amount' => (int)($flat['amt'] ?? 0),
            'robot_pubkey' => $robotPubkey,
            'account_days' => $ratingDays,
            'created_at' => $createdAt,
        ];
    }

    /**
     * @return string[]
     */
    private function resolveAdminAlertEmails(?string $fiatCode = null): array
    {
        $emails = [];
        $anyAdminEmail = false;

        foreach ($this->controlAdminPubkeys as $pubkey) {
            $email = $this->dataSource->findUserEmailByPubkey($pubkey);
            if ($email === null || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }
            $anyAdminEmail = true;
            if ($fiatCode !== null && !$this->adminWantsFiat($pubkey, $fiatCode)) {
                continue;
            }
            $emails[] = strtolower(trim($email));
        }

        // Si algún admin tiene email pero todos filtraron esta moneda, no usar fallbacks
        if ($anyAdminEmail) {
            return array_values(array_unique($emails));
        }

        if ($emails === []) {
            $siteEmail = trim((string)(CFG::$vars['site']['email'] ?? ''));
            if ($siteEmail !== '' && filter_var($siteEmail, FILTER_VALIDATE_EMAIL)) {
                $emails[] = strtolower($siteEmail);
            }
        }

        if ($emails === []) {
            $fromEmail = trim((string)(CFG::$vars['smtp']['from_email'] ?? ''));
            if ($fromEmail !== '' && filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
                $emails[] = strtolower($fromEmail);
            }
        }

        return array_values(array_unique($emails));
    }

    /**
     * ¿Este admin quiere avisos de ofertas en esta moneda? Usa su filtro del chip 💱
     * (CLI_USER_CFG via DataSource), cacheado 5 min. Filtro vacío o moneda desconocida = sí.
     */
    private function adminWantsFiat(string $pubkey, string $fiatCode): bool
    {
        $fiatCode = strtoupper(trim($fiatCode));
        if ($fiatCode === '') {
            return true;
        }

        $cached = $this->adminFiatFilterCache[$pubkey] ?? null;
        if ($cached === null || (time() - $cached['at']) > 300) {
            $cached = ['at' => time(), 'filter' => $this->dataSource->findUserFiatFilterByPubkey($pubkey)];
            $this->adminFiatFilterCache[$pubkey] = $cached;
        }

        return $cached['filter'] === [] || in_array($fiatCode, $cached['filter'], true);
    }

    /**
     * @param mixed $value
     */
    private function normalizeNumericValue($value): ?string
    {
        $raw = trim((string)$value);
        if ($raw === '') {
            return null;
        }

        $raw = str_replace(',', '.', $raw);
        $raw = preg_replace('/[^0-9.\-]/', '', $raw);
        if (!is_string($raw) || $raw === '' || $raw === '-' || !is_numeric($raw)) {
            return null;
        }

        $number = (float)$raw;
        if (!is_finite($number)) {
            return null;
        }

        $normalized = rtrim(rtrim(sprintf('%.8F', $number), '0'), '.');
        if ($normalized === '' || $normalized === '-0') {
            return '0';
        }

        return $normalized;
    }

    /**
     * @param mixed $value
     */
    private function normalizeNonNegativeInt($value): ?int
    {
        $raw = trim((string)$value);
        if ($raw === '' || !preg_match('/^\d+$/', $raw)) {
            return null;
        }

        return (int)$raw;
    }

    /**
     * @param array<string,int> $map
     */
    private function trimAssocMap(array &$map, int $maxItems): void
    {
        if (count($map) <= $maxItems) {
            return;
        }

        asort($map, SORT_NUMERIC);
        while (count($map) > $maxItems) {
            array_shift($map);
        }
    }

    // ── FEATURE: DM TELEGRAM NOTIFICATIONS ──────────────────────────────────
    /**
     * @param string[] $pTags  p-tags del evento ya en lowercase
     */
    private function handleUserDm(MonitorEvent $event, array $pTags): void
    {
        if ($event->eventId === '') {
            return;
        }
        if ($this->dataSource->isEventProcessed($event->eventId)) {
            return;
        }
        // Ignorar DMs enviados por el propio monitor (p.ej. startup DMs que vuelven del relay)
        $monitorPubkey = strtolower(trim((string)($this->monitorIdentity['pubkey'] ?? '')));
        if ($monitorPubkey !== '' && strtolower($event->pubkey) === $monitorPubkey) {
            return;
        }

        $chatId = null;
        foreach ($pTags as $pubkey) {
            if (isset($this->dmNotifyIndex[$pubkey])) {
                $chatId = $this->dmNotifyIndex[$pubkey];
                break;
            }
        }

        if ($chatId === null) {
            return;
        }

        $siteUrl = rtrim(SCRIPT_HOST, '/');
        $text = "Tienes un mensaje privado nuevo en {$siteUrl}/noxtr";

        $sent = $this->notifier->sendTelegram($chatId, $text);

        if ($this->options->verbose) {
            echo '[monitor] dm-notify telegram ' . ($sent ? 'sent' : 'failed') . " -> {$chatId}\n";
        }

        $this->dataSource->storeEvent([
            'event_id'            => $event->eventId,
            'kind'                => $event->kind,
            'order_id'            => '',
            'user_id'             => 0,
            'event_created_at'    => $event->createdAt,
            'source'              => 'dm',
            'status'              => 'notified',
            'raw_json'            => '',
            'notification_type'   => 'dm',
            'notification_sent_at'=> $sent ? time() : null,
        ]);
    }
    // ── END FEATURE: DM TELEGRAM NOTIFICATIONS ───────────────────────────────

    private function handleControlDm(MonitorEvent $event): void
    {
        if ($event->eventId === '') {
            return;
        }
        if ($this->dataSource->isEventProcessed($event->eventId)) {
            return;
        }
        if (!$this->isAuthorizedControlSender($event->pubkey)) {
            return;
        }
        if (!$this->verifyControlEvent($event)) {
            if ($this->options->verbose) {
                echo '[control] invalid signed event from=' . substr($event->pubkey, 0, 12) . "\n";
            }
            return;
        }
        if ($this->isStaleControlEvent($event)) {
            if ($this->options->verbose) {
                echo '[control] stale command ignored from=' . substr($event->pubkey, 0, 12)
                    . ' age=' . max(0, time() - (int)$event->createdAt) . "s\n";
            }
            $this->dataSource->storeEvent([
                'event_id' => $event->eventId,
                'kind' => $event->kind,
                'order_id' => '',
                'user_id' => 0,
                'event_created_at' => $event->createdAt,
                'source' => 'control',
                'status' => 'stale',
                'raw_json' => json_encode($event->raw),
                'processed_at' => time(),
            ]);
            return;
        }

        $plaintext = $this->decryptControlDm($event);
        if ($plaintext === null || trim($plaintext) === '') {
            if ($this->options->verbose) {
                echo '[control] unable to decrypt DM from=' . substr($event->pubkey, 0, 12) . "\n";
            }
            return;
        }

        $command = $this->parseControlCommand($plaintext);
        if ($command === null) {
            if ($this->options->verbose) {
                echo '[control] invalid command from=' . substr($event->pubkey, 0, 12) . ' text=' . trim($plaintext) . "\n";
            }
            return;
        }

        [$name, $args] = $command;
        [$reply, $processed] = $this->executeControlCommand($name, $args, $event->pubkey);
        if ($processed) {
            $this->dataSource->storeEvent([
                'event_id' => $event->eventId,
                'kind' => $event->kind,
                'order_id' => '',
                'user_id' => 0,
                'event_created_at' => $event->createdAt,
                'source' => 'control',
                'status' => $name,
                'raw_json' => json_encode($event->raw),
                'processed_at' => time(),
            ]);
        }

        if ($reply !== '') {
            $this->sendControlReply($event->pubkey, $reply, (int)$event->createdAt);
        }
    }

    private function isAuthorizedControlSender(string $pubkey): bool
    {
        $pubkey = strtolower(trim($pubkey));
        if ($pubkey === '' || $this->controlAdminPubkeys === []) {
            return false;
        }

        return in_array($pubkey, $this->controlAdminPubkeys, true);
    }

    private function isStaleControlEvent(MonitorEvent $event): bool
    {
        $createdAt = (int)$event->createdAt;
        if ($createdAt <= 0) {
            return true;
        }

        return (time() - $createdAt) > $this->getControlCommandMaxAgeSeconds();
    }

    private function getControlCommandMaxAgeSeconds(): int
    {
        $cfg = CFG::$vars['modules']['noxtr'] ?? [];
        $seconds = (int)($cfg['monitor_command_max_age'] ?? 300);
        return max(30, $seconds);
    }

    private function verifyControlEvent(MonitorEvent $event): bool
    {
        if (empty($event->raw['sig']) || empty($event->raw['id']) || empty($event->raw['pubkey'])) {
            return false;
        }

        $verified = NostrAuth::verifyEvent($event->raw, null);
        return !empty($verified['valid']);
    }

    private function decryptControlDm(MonitorEvent $event): ?string
    {
        $monitorPrivkey = trim((string)($this->monitorIdentity['privkey'] ?? ''));
        if ($monitorPrivkey === '') {
            return null;
        }

        $content = (string)$event->content;
        $parts = explode('?iv=', $content, 2);
        if (count($parts) !== 2) {
            return null;
        }

        $ciphertext = base64_decode($parts[0], true);
        $iv = base64_decode($parts[1], true);
        if ($ciphertext === false || $iv === false || strlen($iv) !== 16) {
            return null;
        }

        try {
            $key = NostrCrypto::getSharedSecretX($monitorPrivkey, $event->pubkey);
        } catch (Exception $e) {
            return null;
        }

        if (!function_exists('openssl_decrypt')) {
            return null;
        }

        $plaintext = openssl_decrypt($ciphertext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        return is_string($plaintext) ? $plaintext : null;
    }

    /**
     * @return array{0:string,1:array<int,string>}|null
     */
    private function parseControlCommand(string $plaintext): ?array
    {
        $plaintext = trim($plaintext);
        if ($plaintext === '') {
            return null;
        }

        $json = json_decode($plaintext, true);
        if (is_array($json)) {
            $cmd = strtolower(trim((string)($json['cmd'] ?? $json['command'] ?? '')));
            $args = isset($json['args']) && is_array($json['args']) ? array_values(array_map('strval', $json['args'])) : [];
            if ($cmd !== '') {
                return [$cmd, $args];
            }
        }

        $parts = preg_split('/\s+/', $plaintext);
        if (!is_array($parts) || !$parts) {
            return null;
        }

        $cmd = strtolower(trim((string)array_shift($parts)));
        if ($cmd === '') {
            return null;
        }

        return [$cmd, array_values(array_map('strval', $parts))];
    }

    /**
     * @param string[] $args
     * @return array{0:string,1:bool}
     */
    private function executeControlCommand(string $name, array $args, string $senderPubkey): array
    {
        $shortSender = substr($senderPubkey, 0, 12);

        switch ($name) {
            case 'ping':
                if ($this->options->verbose) {
                    echo "[control] ping from={$shortSender}\n";
                }
                return ['pong', true];

            case 'status':
                if ($this->options->verbose) {
                    echo "[control] status from={$shortSender}\n";
                }
                return [$this->buildStatusReply(), true];

            case 'trades':
                if ($this->options->verbose) {
                    echo "[control] trades from={$shortSender}\n";
                }
                return [$this->buildTradesReply($args), true];

            case 'relays':
                if ($this->options->verbose) {
                    echo "[control] relays from={$shortSender}\n";
                }
                return [$this->buildRelaysReply(), true];

            case 'email':
            case 'test-email':
            case 'email-test':
                if ($this->options->verbose) {
                    echo "[control] email from={$shortSender}\n";
                }
                return [$this->sendTestEmailCommand($args, $senderPubkey), true];

            case 'telegram':
            case 'tg':
                if ($this->options->verbose) {
                    echo "[control] telegram from={$shortSender}\n";
                }
                return [$this->executeTelegramCommand($args, $senderPubkey), true];

            case 'profile':
            case 'publish-profile':
                if ($this->options->verbose) {
                    echo "[control] profile from={$shortSender}\n";
                }
                return [$this->publishMonitorProfileCommand(), true];

            case 'stop':
            case 'close':
            case 'shutdown':
                if ($this->options->verbose) {
                    echo "[control] stop from={$shortSender}\n";
                }
                $this->shouldStop = true;
                return ['stopping monitor', true];

            case 'reload':
            case 'restart':
                if ($this->options->verbose) {
                    echo "[control] reload from={$shortSender}\n";
                }
                $this->shouldReload = true;
                return ['reloading relay session', true];

            case 'notify-new-offers':
            case 'notify_new_offers':
                if ($this->options->verbose) {
                    echo "[control] notify-new-offers from={$shortSender}\n";
                }
                return [$this->executeNotifyNewOffersCommand($args), true];

            case 'help':
                return [$this->buildHelpReply($args), true];
        }

        if ($this->options->verbose) {
            echo "[control] unknown command={$name} from={$shortSender}\n";
        }

        return ['unknown command: ' . $name, true];
    }

    /**
     * @param string[] $args
     */
    private function buildHelpReply(array $args = []): string
    {
        $topic = strtolower(trim((string)($args[0] ?? '')));

        switch ($topic) {
            case '':
                return implode("\n", [
                    'server_monitor v' . self::VERSION,
                    'commands: status, ping, trades, relays, email [destino], telegram, profile, notify-new-offers, reload, restart, stop, close, shutdown, help',
                    'usa: help trades | help status | help relays | help email | help telegram | help profile | help notify-new-offers',
                ]);

            case 'trades':
            case 'trade':
                return $this->buildTradesHelp();

            case 'status':
                return 'status: muestra version, trades monitorizados, uptime y admins.';

            case 'relays':
                return 'relays: muestra relays configurados y, si aplica, los conectados en esta sesion.';

            case 'email':
            case 'test-email':
            case 'email-test':
                return 'email [destino@example.com]: envia un email de prueba al destino indicado o al fallback configurado.';

            case 'telegram':
            case 'tg':
                return implode("\n", [
                    'telegram: comandos para Telegram.',
                    '  telegram list              — lista usuarios vinculados a Telegram',
                    '  telegram test [chat_id]    — envia mensaje de prueba al chat_id indicado o al propio usuario',
                    '  telegram send <chat_id> <texto> — envia texto libre al chat_id indicado',
                    'alias: tg',
                ]);

            case 'profile':
            case 'publish-profile':
                return 'profile: publica el perfil Nostr del monitor.';

            case 'reload':
            case 'restart':
                return 'reload: reinicia la sesion de relays del proceso actual. No recarga el codigo PHP del monitor.';

            case 'stop':
            case 'close':
            case 'shutdown':
                return 'stop: detiene el proceso del monitor.';

            case 'ping':
                return 'ping: comprueba que el canal de control responde.';

            case 'notify-new-offers':
            case 'notify_new_offers':
                return 'notify-new-offers on|off: activa o desactiva notificaciones (email + telegram) de nuevas ofertas del order book (Mostro + on-chain). Por defecto activado.';
        }

        return 'unknown help topic: ' . $topic;
    }

    private function buildStatusReply(): string
    {
        $uptime = max(0, time() - $this->startedAt);
        $parts = [
            'monitor v' . self::VERSION . ' running',
            'trades=' . count($this->tradeIndex),
            'uptime=' . $uptime . 's',
            'admins=' . count($this->controlAdminPubkeys),
        ];

        if (!empty($this->monitorIdentity['npub'])) {
            $parts[] = 'npub=' . (string)$this->monitorIdentity['npub'];
        }

        return implode(' | ', $parts);
    }

    private function maybePublishMonitorProfile(): void
    {
        if ($this->monitorProfilePublished) {
            return;
        }

        $this->monitorProfilePublished = true;
        $this->publishMonitorProfile(false);
    }

    /**
     * @param string[] $args
     */
    private function buildTradesReply(array $args = []): string
    {
        $query = $this->parseTradesCommandArgs($args);
        if (isset($query['error']) && $query['error'] !== '') {
            return (string)$query['error'];
        }

        $orders = $this->fetchLiveMostroTrades();
        $orders = $this->filterTradesForReply($orders, $query);

        usort($orders, static function (array $a, array $b): int {
            return ((int)($b['created_at'] ?? 0)) <=> ((int)($a['created_at'] ?? 0));
        });

        $orders = array_slice($orders, 0, 20);

        $summary = [];
        if (!empty($query['age_label'])) {
            $summary[] = 'age<=' . (string)$query['age_label'];
        }
        if (!empty($query['status'])) {
            $summary[] = 'status=' . (string)$query['status'];
        }
        if (!empty($query['amount_label'])) {
            $summary[] = 'amount=' . (string)$query['amount_label'];
        }
        if (!empty($query['pm'])) {
            $summary[] = 'pm=' . (string)$query['pm'];
        }
        if (!empty($query['pmi'])) {
            $summary[] = 'pmi=' . (string)$query['pmi'];
        }

        $header = 'trades=' . count($orders);
        if ($summary !== []) {
            $header .= ' | ' . implode(' | ', $summary);
        }

        if ($orders === []) {
            return $header;
        }

        $lines = [$header];
        foreach ($orders as $order) {
            $amount = (string)($order['amount_label'] ?? '?');
            $paymentMethod = trim((string)($order['payment_method'] ?? ''));
            $premiumValue = trim((string)($order['premium'] ?? '0'));
            $premiumLabel = $this->formatTradePremiumLabel($premiumValue);
            $accountDaysLabel = $this->formatTradeAccountDaysLabel($order['account_days'] ?? null);
            $daemon = trim((string)($order['daemon'] ?? ''));
            $robotPubkey = trim((string)($order['robot_pubkey'] ?? ''));
            $robotShort = $robotPubkey !== '' ? substr($robotPubkey, 0, 6) . '...' : '?';
            $paymentMethod = $this->truncateTradeField($paymentMethod, 20);
            $leftCols = [
                $this->padTradeColumn('#' . substr((string)($order['id'] ?? ''), 0, 8), 9, 'left'),
                $this->padTradeColumn((string)($order['order_type'] ?? '?'), 4, 'left'),
                $this->padTradeColumn($this->formatTradeStatusShort((string)($order['status'] ?? '?')), 11, 'left'),
                $this->padTradeColumn($amount, 12, 'right'),
                $this->padTradeColumn($premiumLabel, 6, 'right'),
                $this->padTradeColumn($this->formatOrderAge((int)($order['created_at'] ?? 0)), 7, 'right'),
                $this->padTradeColumn($accountDaysLabel, 4, 'right'),
            ];
            $rightCols = [
                $this->padTradeColumn($this->formatTradeDaemonShort($daemon), 5, 'left'),
                $this->padTradeColumn($robotShort, 9, 'left'),
                $this->padTradeColumn($paymentMethod, 23, 'left'),
            ];

            $lines[] = rtrim(implode(' ', $leftCols) . ' | ' . implode(' ', $rightCols));
        }

        return implode("\n", $lines);
    }

    private function formatTradePremiumLabel(string $premiumValue): string
    {
        $premiumValue = trim($premiumValue);
        if ($premiumValue === '' || $premiumValue === '0' || $premiumValue === '0.0' || $premiumValue === '0.00') {
            return '';
        }

        $number = (float)str_replace(',', '.', $premiumValue);
        if (!is_finite($number)) {
            return $premiumValue . '%';
        }

        $normalized = rtrim(rtrim(sprintf('%.2F', $number), '0'), '.');
        return ($number > 0 ? '+' : '') . $normalized . '%';
    }

    private function formatTradeStatusShort(string $status): string
    {
        $status = strtolower(trim($status));
        return $status !== '' ? $status : '?';
    }

    private function padTradeColumn(string $value, int $width, string $align = 'left'): string
    {
        $value = trim($value);
        if ($width < 1 || strlen($value) >= $width) {
            return $value;
        }

        return $align === 'right'
            ? str_pad($value, $width, ' ', STR_PAD_LEFT)
            : str_pad($value, $width, ' ', STR_PAD_RIGHT);
    }

    /**
     * @param mixed $days
     */
    private function formatTradeAccountDaysLabel($days): string
    {
        $normalized = $this->normalizeNonNegativeInt($days);
        return 'd=' . ($normalized !== null ? (string)$normalized : '?');
    }

    private function formatTradeDaemonShort(string $daemon): string
    {
        $daemon = strtolower(trim($daemon));

        switch ($daemon) {
            case 'mostro':
                return 'mstr';
            case 'lnp2pbot':
                return 'lnp2p';
        }

        return $daemon !== '' ? $daemon : '?';
    }


    private function truncateTradeField(string $text, int $maxLen): string
    {
        $text = trim($text);
        if ($text === '' || $maxLen < 4) {
            return $text;
        }

        if (strlen($text) <= $maxLen) {
            return $text;
        }

        return substr($text, 0, $maxLen) . '...';
    }

    /**
     * @param string[] $args
     * @return array<string,mixed>
     */
    private function parseTradesCommandArgs(array $args): array
    {
        $out = [
            'status' => '',
            'amount_norm' => '',
            'amount_label' => '',
            'fiat_code' => '',
            'age_seconds' => 8 * 3600,
            'age_label' => '8h',
            'pm' => '',
            'pmi' => '',
        ];

        if ($args === []) {
            return $out;
        }

        $keywords = ['status', 'amount', 'age', 'pm', 'pmi', 'help', '?', 'all'];
        $i = 0;
        while ($i < count($args)) {
            $verb = strtolower(trim((string)$args[$i]));
            if ($verb === '') {
                $i++;
                continue;
            }

            if (in_array($verb, ['help', '?'], true)) {
                return ['error' => $this->buildTradesHelp()];
            }

            if ($verb === 'all') {
                $out['age_seconds'] = 0;
                $out['age_label'] = 'all';
                $i++;
                continue;
            }

            if ($verb === 'status') {
                $value = strtolower(trim((string)($args[$i + 1] ?? '')));
                if ($value === '') {
                    return ['error' => $this->buildTradesHelp()];
                }
                $out['status'] = $value;
                $i += 2;
                continue;
            }

            if ($verb === 'amount') {
                $amountNorm = $this->normalizeNumericValue($args[$i + 1] ?? null);
                if ($amountNorm === null) {
                    return ['error' => $this->buildTradesHelp()];
                }

                $out['amount_norm'] = $amountNorm;
                $out['amount_label'] = $amountNorm;

                $next = strtoupper(trim((string)($args[$i + 2] ?? '')));
                if ($next !== '' && !in_array(strtolower($next), $keywords, true) && preg_match('/^[A-Z]{3,8}$/', $next)) {
                    $out['fiat_code'] = preg_replace('/[^A-Z]/', '', $next);
                    $out['amount_label'] .= ' ' . $out['fiat_code'];
                    $i += 3;
                } else {
                    $i += 2;
                }
                continue;
            }

            if ($verb === 'age') {
                $value = trim((string)($args[$i + 1] ?? ''));
                $seconds = $this->parseTradesAgeToSeconds($value);
                if ($seconds === null) {
                    return ['error' => $this->buildTradesHelp()];
                }
                $out['age_seconds'] = $seconds;
                $out['age_label'] = $seconds > 0 ? strtolower($value) : 'all';
                $i += 2;
                continue;
            }

            if ($verb === 'pm' || $verb === 'pmi') {
                $value = trim((string)($args[$i + 1] ?? ''));
                if ($value === '') {
                    return ['error' => $this->buildTradesHelp()];
                }
                $out[$verb] = $value;
                $i += 2;
                continue;
            }

            return ['error' => $this->buildTradesHelp()];
        }

        return $out;
    }

    private function buildTradesHelp(): string
    {
        return implode("\n", [
            'trades: consulta viva del order book Mostro en los relays del monitor.',
            'por defecto: trades age 8h',
            'sintaxis:',
            '- trades',
            '- help trades',
            '- trades age 8h',
            '- trades age all',
            '- trades status pending',
            '- trades amount 44',
            '- trades amount 44 EUR',
            '- trades status pending amount 44 EUR age 8h',
            '- trades pm Halcash          (case-sensitive: solo "Halcash")',
            '- trades pmi HalCash         (case-insensitive: "Halcash", "HALCASH"...)',
            '- trades pmi revolut age 24h',
            '- trades pmi transferencia status pending',
        ]);
    }

    /**
     * @param array<int,array<string,mixed>> $orders
     * @param array<string,mixed> $query
     * @return array<int,array<string,mixed>>
     */
    private function filterTradesForReply(array $orders, array $query): array
    {
        $now = time();
        $statusFilter = strtolower(trim((string)($query['status'] ?? '')));
        $amountFilter = trim((string)($query['amount_norm'] ?? ''));
        $fiatFilter = strtoupper(trim((string)($query['fiat_code'] ?? '')));
        $pmFilter  = trim((string)($query['pm']  ?? ''));
        $pmiFilter = trim((string)($query['pmi'] ?? ''));
        $ageSeconds = max(0, (int)($query['age_seconds'] ?? 0));
        $filtered = [];

        foreach ($orders as $order) {
            $createdAt = (int)($order['created_at'] ?? 0);
            if ($ageSeconds > 0 && ($createdAt <= 0 || ($now - $createdAt) > $ageSeconds)) {
                continue;
            }

            if ($statusFilter !== '' && strtolower(trim((string)($order['status'] ?? ''))) !== $statusFilter) {
                continue;
            }

            if (!$this->orderMatchesTradesAmountFilter($order, $amountFilter, $fiatFilter)) {
                continue;
            }

            $orderPm = (string)($order['payment_method'] ?? '');
            if ($pmFilter !== '' && strpos($orderPm, $pmFilter) === false) {
                continue;
            }
            if ($pmiFilter !== '' && stripos($orderPm, $pmiFilter) === false) {
                continue;
            }

            $filtered[] = $order;
        }

        return $filtered;
    }

    private function parseTradesAgeToSeconds(string $value): ?int
    {
        $value = strtolower(trim($value));
        if ($value === '') {
            return null;
        }

        if (in_array($value, ['all', '0', 'off', 'none'], true)) {
            return 0;
        }

        if (!preg_match('/^(\d+)([smhd]?)$/', $value, $m)) {
            return null;
        }

        $amount = (int)$m[1];
        $unit = $m[2] !== '' ? $m[2] : 'h';
        if ($amount < 0) {
            return null;
        }

        switch ($unit) {
            case 's':
                return $amount;
            case 'm':
                return $amount * 60;
            case 'h':
                return $amount * 3600;
            case 'd':
                return $amount * 86400;
        }

        return null;
    }

    /**
     * @param array<string,mixed> $order
     */
    private function orderMatchesTradesAmountFilter(array $order, string $amountNorm, string $fiatCode): bool
    {
        if ($amountNorm === '') {
            return true;
        }

        $orderFiat = strtoupper(trim((string)($order['fiat_code'] ?? '')));
        if ($fiatCode !== '' && $orderFiat !== $fiatCode) {
            return false;
        }

        $fixed = trim((string)($order['fiat_amount_norm'] ?? ''));
        if ($fixed !== '') {
            return $fixed === $amountNorm;
        }

        $min = trim((string)($order['fiat_min_norm'] ?? ''));
        $max = trim((string)($order['fiat_max_norm'] ?? ''));
        if ($min === '' || $max === '') {
            return false;
        }

        $amount = (float)$amountNorm;
        return $amount >= (float)$min && $amount <= (float)$max;
    }

    /**
     * Consulta puntual al order book en los relays del monitor.
     *
     * - No usa caché, memoria persistente ni BD.
     * - Pide kind 38383 sin filtros adicionales para depuración.
     * - Conserva el evento más reciente por order id.
     *
     * @return array<int,array<string,mixed>>
     */
    private function fetchLiveMostroTrades(): array
    {
        $relayUrls = array_values(array_unique(array_filter(array_map('trim', $this->monitorRelays))));
        if ($relayUrls === []) {
            return [];
        }

        $subscriptionId = 'noxtr_trades_' . substr(md5(uniqid('', true)), 0, 12);
        $request = json_encode(['REQ', $subscriptionId, ['kinds' => [38383]]], JSON_UNESCAPED_SLASHES);
        if (!is_string($request) || $request === '') {
            return [];
        }

        $connections = [];
        foreach ($relayUrls as $relayUrl) {
            try {
                $client = new WebSocketClient($relayUrl, [
                    'connect_timeout' => 10,
                    'read_timeout' => 1,
                    'read_timeout_usec' => 0,
                    'verify_peer' => true,
                    'verify_peer_name' => true,
                ]);
                $client->connect();
                $stream = $client->getStream();
                if (!is_resource($stream)) {
                    $client->close();
                    continue;
                }

                $client->sendText($request);
                $connections[] = [
                    'url' => $relayUrl,
                    'client' => $client,
                    'stream' => $stream,
                    'eose' => false,
                ];
            } catch (Exception $e) {
                if ($this->options->verbose) {
                    echo '[trades] connect failed -> ' . $relayUrl . ' | ' . $e->getMessage() . "\n";
                }
            }
        }

        if ($connections === []) {
            return [];
        }

        $latestByOrderId = [];
        $deadline = time() + 12;

        try {
            while (time() < $deadline) {
                $allEose = true;
                $read = [];

                foreach ($connections as $entry) {
                    if (empty($entry['eose'])) {
                        $allEose = false;
                    }
                    if (is_resource($entry['stream'])) {
                        $read[] = $entry['stream'];
                    }
                }

                if ($read === [] || $allEose) {
                    break;
                }

                $write = null;
                $except = null;
                $selected = @stream_select($read, $write, $except, 1, 0);
                if ($selected === false) {
                    break;
                }
                if ($selected === 0) {
                    continue;
                }

                foreach ($read as $readyStream) {
                    foreach ($connections as $index => $entry) {
                        if ($entry['stream'] !== $readyStream) {
                            continue;
                        }

                        /** @var WebSocketClient $client */
                        $client = $entry['client'];
                        $payload = $client->receiveText();
                        if ($payload === null || trim($payload) === '') {
                            break;
                        }

                        foreach ($this->decodeRelayPayloadMessages($payload) as $decoded) {
                            $type = $decoded[0] ?? null;
                            if ($type === 'EOSE' && ($decoded[1] ?? null) === $subscriptionId) {
                                $connections[$index]['eose'] = true;
                                continue;
                            }

                            if ($type !== 'EVENT' || !isset($decoded[2]) || !is_array($decoded[2])) {
                                continue;
                            }

                            $order = $this->parseLiveTradeEvent($decoded[2]);
                            if ($order === null) {
                                continue;
                            }

                            $orderId = (string)($order['id'] ?? '');
                            if ($orderId === '') {
                                continue;
                            }

                            $existing = $latestByOrderId[$orderId] ?? null;
                            $existingCreatedAt = is_array($existing) ? (int)($existing['created_at'] ?? 0) : 0;
                            $createdAt = (int)($order['created_at'] ?? 0);
                            if ($existingCreatedAt > $createdAt) {
                                continue;
                            }

                            $latestByOrderId[$orderId] = $order;
                        }

                        break;
                    }
                }
            }
        } finally {
            $closePayload = json_encode(['CLOSE', $subscriptionId], JSON_UNESCAPED_SLASHES);
            foreach ($connections as $entry) {
                try {
                    if (is_string($closePayload) && $closePayload !== '') {
                        /** @var WebSocketClient $client */
                        $client = $entry['client'];
                        $client->sendText($closePayload);
                    }
                } catch (Exception $e) {
                }

                try {
                    /** @var WebSocketClient $client */
                    $client = $entry['client'];
                    $client->close();
                } catch (Exception $e) {
                }
            }
        }

        return array_values($latestByOrderId);
    }

    /**
     * @param array<string,mixed> $event
     * @return array<string,mixed>|null
     */
    private function parseLiveTradeEvent(array $event)
    {
        $tags = is_array($event['tags'] ?? null) ? $event['tags'] : [];
        $flat = [];
        $paymentMethods = [];
        $faTag = null;

        foreach ($tags as $tag) {
            if (!is_array($tag) || !isset($tag[0])) {
                continue;
            }

            $name = (string)$tag[0];
            if ($name === 'pm') {
                for ($i = 1; $i < count($tag); $i++) {
                    $value = trim((string)($tag[$i] ?? ''));
                    if ($value !== '') {
                        $paymentMethods[] = $value;
                    }
                }
                continue;
            }

            if ($name === 'fa') {
                $faTag = $tag;
            }

            if (isset($tag[1])) {
                $flat[$name] = (string)$tag[1];
            }
        }

        $orderId = trim((string)($flat['d'] ?? $flat['name'] ?? ''));
        $orderType = strtolower(trim((string)($flat['k'] ?? '')));
        if ($orderId === '' || !in_array($orderType, ['buy', 'sell'], true)) {
            return null;
        }

        $fiatCode = strtoupper(trim((string)($flat['f'] ?? '')));
        $amountLabel = '?';
        $fiatAmountNorm = '';
        $fiatMinNorm = '';
        $fiatMaxNorm = '';
        if (is_array($faTag) && isset($faTag[1]) && trim((string)$faTag[1]) !== '') {
            $firstAmount = trim((string)$faTag[1]);
            $secondAmount = trim((string)($faTag[2] ?? ''));
            $amountLabel = $firstAmount;
            if ($secondAmount !== '') {
                $amountLabel .= '-' . $secondAmount;
                $fiatMinNorm = (string)($this->normalizeNumericValue($firstAmount) ?? '');
                $fiatMaxNorm = (string)($this->normalizeNumericValue($secondAmount) ?? '');
            } else {
                $fiatAmountNorm = (string)($this->normalizeNumericValue($firstAmount) ?? '');
            }
        } elseif (isset($flat['fa']) && trim((string)$flat['fa']) !== '') {
            $rawAmount = trim((string)$flat['fa']);
            $amountLabel = $rawAmount;
            if (preg_match('/^\s*([0-9]+(?:[.,][0-9]+)?)\s*-\s*([0-9]+(?:[.,][0-9]+)?)\s*$/', $rawAmount, $m)) {
                $fiatMinNorm = (string)($this->normalizeNumericValue($m[1]) ?? '');
                $fiatMaxNorm = (string)($this->normalizeNumericValue($m[2]) ?? '');
            } else {
                $fiatAmountNorm = (string)($this->normalizeNumericValue($rawAmount) ?? '');
            }
        }
        if ($fiatCode !== '') {
            $amountLabel .= ' ' . $fiatCode;
        }

        $ratingDays = null;
        $ratingRaw = trim((string)($flat['rating'] ?? ''));
        if ($ratingRaw !== '') {
            $decodedRating = json_decode($ratingRaw, true);
            if (is_array($decodedRating)) {
                $ratingObj = is_array($decodedRating[1] ?? null) ? $decodedRating[1] : $decodedRating;
                $days = $this->normalizeNonNegativeInt(is_array($ratingObj) ? ($ratingObj['days'] ?? null) : null);
                if ($days !== null) {
                    $ratingDays = $days;
                }
            }
        }

        // Kind 38383 es un evento replaceable: la instancia lo re-publica periódicamente
        // actualizando created_at, por lo que ese campo siempre parece reciente.
        // El tag expiration sí es estable (fijado al crear la orden).
        // Las órdenes Mostro tienen vida de 24h → created_at real ≈ expiration - 86400.
        $expiration = (int)($flat['expiration'] ?? 0);
        $eventCreatedAt = (int)($event['created_at'] ?? 0);
        $createdAt = ($expiration > 86400) ? ($expiration - 86400) : $eventCreatedAt;

        return [
            'id' => $orderId,
            'order_type' => $orderType,
            'status' => strtolower(trim((string)($flat['s'] ?? 'pending'))),
            'amount_label' => $amountLabel,
            'fiat_code' => $fiatCode,
            'fiat_amount_norm' => $fiatAmountNorm,
            'fiat_min_norm' => $fiatMinNorm,
            'fiat_max_norm' => $fiatMaxNorm,
            'payment_method' => implode(', ', array_values(array_unique($paymentMethods))),
            'premium' => trim((string)($flat['premium'] ?? $flat['p'] ?? '0')),
            'daemon' => strtolower(trim((string)($flat['y'] ?? ''))),
            'robot_pubkey' => strtolower(trim((string)($event['pubkey'] ?? ''))),
            'maker_pubkey' => preg_match('/^[0-9a-fA-F]{64}$/', trim((string)($flat['p'] ?? '')))
                ? strtolower(trim((string)$flat['p']))
                : '',
            'account_days' => $ratingDays,
            'created_at' => $createdAt,
            'expiration' => $expiration,
        ];
    }

    /**
     * @return array<int,array<int|string,mixed>>
     */
    private function decodeRelayPayloadMessages(string $payload): array
    {
        $messages = [];

        $decoded = json_decode($payload, true);
        if (is_array($decoded)) {
            $messages[] = $decoded;
            return $messages;
        }

        $chunks = preg_split("/\r\n|\n|\r/", $payload);
        if (!is_array($chunks)) {
            return [];
        }

        foreach ($chunks as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            $decoded = json_decode($chunk, true);
            if (is_array($decoded)) {
                $messages[] = $decoded;
            }
        }

        return $messages;
    }

    private function formatOrderAge(int $createdAt): string
    {
        if ($createdAt <= 0) {
            return '?';
        }

        $age = max(0, time() - $createdAt);
        if ($age >= 86400) {
            $days = (int)floor($age / 86400);
            $hours = (int)floor(($age % 86400) / 3600);
            return $days . 'd' . ($hours > 0 ? $hours . 'h' : '');
        }
        if ($age >= 3600) {
            $hours = (int)floor($age / 3600);
            $minutes = (int)floor(($age % 3600) / 60);
            return $hours . 'h' . ($minutes > 0 ? $minutes . 'm' : '');
        }
        if ($age >= 60) {
            $minutes = (int)floor($age / 60);
            $seconds = $age % 60;
            return $minutes . 'm' . ($seconds > 0 ? $seconds . 's' : '');
        }

        return $age . 's';
    }

    private function buildRelaysReply(): string
    {
        $configured = $this->monitorRelays;
        $connected = [];

        if (is_object($this->relayClient) && method_exists($this->relayClient, 'getConnectedRelayUrls')) {
            $connected = (array)$this->relayClient->getConnectedRelayUrls();
        }

        $parts = ['configured=' . count($configured)];
        if ($connected !== []) {
            $parts[] = 'connected=' . count($connected);
        }

        $display = $connected !== [] ? $connected : $configured;
        if ($display !== []) {
            $labels = array_map([$this, 'shortRelayLabel'], $display);
            $parts[] = implode(', ', $labels);
        }

        return implode(' | ', $parts);
    }

    private function shortRelayLabel(string $url): string
    {
        $host = parse_url($url, PHP_URL_HOST);
        if (is_string($host) && $host !== '') {
            return $host;
        }
        return $url;
    }

    /**
     * @param string[] $args
     */
    private function executeNotifyNewOffersCommand(array $args): string
    {
        $sub = strtolower(trim((string)($args[0] ?? '')));
        if ($sub === 'on' || $sub === '1' || $sub === 'true') {
            $this->notifyNewOffers = true;
            return 'notify-new-offers: activado (email + telegram para nuevas ofertas del order book)';
        }
        if ($sub === 'off' || $sub === '0' || $sub === 'false') {
            $this->notifyNewOffers = false;
            return 'notify-new-offers: desactivado';
        }
        $current = $this->notifyNewOffers ? 'on' : 'off';
        return "notify-new-offers: estado actual={$current} | uso: notify-new-offers on|off";
    }

    private function sendTestEmailCommand(array $args, string $senderPubkey): string
    {
        $to = $this->resolveTestEmailRecipient($args, $senderPubkey);
        if ($to === null) {
            return 'usage: email [destino@example.com] | no default recipient found';
        }

        [$subject, $html] = $this->buildTestEmail($to);
        $ok = $this->notifier->sendEmail($to, $subject, $html);

        return ($ok ? 'test email sent -> ' : 'test email failed -> ') . $to;
    }

    // ── FEATURE: TELEGRAM COMMANDS ───────────────────────────────────────────
    /**
     * @param string[] $args
     */
    private function executeTelegramCommand(array $args, string $senderPubkey): string
    {
        $verb = strtolower(trim((string)($args[0] ?? '')));

        if ($verb === '' || $verb === 'list') {
            return $this->telegramListCommand();
        }

        if ($verb === 'test') {
            $chatId = trim((string)($args[1] ?? ''));
            return $this->telegramTestCommand($chatId);
        }

        if ($verb === 'send') {
            $chatId = trim((string)($args[1] ?? ''));
            $text   = trim(implode(' ', array_slice($args, 2)));
            return $this->telegramSendCommand($chatId, $text);
        }

        return implode("\n", [
            'uso: telegram list | telegram test [chat_id] | telegram send <chat_id> <texto>',
            'alias: tg',
        ]);
    }

    private function telegramListCommand(): string
    {
        $chats = $this->dataSource->findAllTelegramChats();
        if (empty($chats)) {
            return 'telegram: no hay usuarios vinculados';
        }
        $lines = ['telegram: usuarios vinculados (' . count($chats) . ')'];
        foreach ($chats as $row) {
            $userId = (int)($row['user_id'] ?? 0);
            $name   = trim((string)($row['first_name'] ?? ''));
            $user   = trim((string)($row['username'] ?? ''));
            $email  = (string)($this->dataSource->findUserEmail($userId) ?? '');

            $label = $name !== '' ? $name : '(sin nombre)';
            if ($user !== '') {
                $label .= ' (@' . $user . ')';
            }
            if ($email !== '') {
                $label .= ' <' . $email . '>';
            }
            $lines[] = '  user_id=' . $userId
                . ' chat_id=' . (string)($row['chat_id'] ?? '')
                . ' ' . $label;
        }
        return implode("\n", $lines);
    }

    /**
     * Resuelve un argumento a chat_id numérico.
     * Acepta: chat_id numérico directo, @username o username sin @.
     * Devuelve null si no se encuentra.
     */
    private function resolveTelegramTarget(string $arg): ?string
    {
        $arg = trim($arg);
        if ($arg === '') {
            return null;
        }
        // Si es numérico (o negativo, los grupos tienen chat_id negativo), es un chat_id directo
        if (preg_match('/^-?\d+$/', $arg)) {
            return $arg;
        }
        // Es un @username o username sin @
        return $this->dataSource->findTelegramChatByUsername($arg);
    }

    private function telegramTestCommand(string $arg): string
    {
        if ($arg === '') {
            return 'telegram test: indica un chat_id o @username (usa "telegram list" para verlos)';
        }

        $chatId = $this->resolveTelegramTarget($arg);
        if ($chatId === null) {
            return 'telegram test: no se encontro chat_id para "' . $arg . '"';
        }

        $text = implode("\n", [
            'NoxtrMonitor: prueba de Telegram.',
            'Hora del servidor: ' . date('Y-m-d H:i:s'),
            'Trades monitorizados: ' . count($this->tradeIndex),
        ]);

        $ok = $this->notifier->sendTelegram($chatId, $text);
        return ($ok ? 'telegram test sent -> ' : 'telegram test failed -> ') . $chatId;
    }

    private function telegramSendCommand(string $arg, string $text): string
    {
        if ($arg === '' || $text === '') {
            return 'uso: telegram send <chat_id|@username> <texto>';
        }

        $chatId = $this->resolveTelegramTarget($arg);
        if ($chatId === null) {
            return 'telegram send: no se encontro chat_id para "' . $arg . '"';
        }

        $ok = $this->notifier->sendTelegram($chatId, $text);
        return ($ok ? 'telegram sent -> ' : 'telegram failed -> ') . $chatId;
    }
    // ── END FEATURE: TELEGRAM COMMANDS ───────────────────────────────────────

    private function publishMonitorProfileCommand(): string
    {
        return $this->publishMonitorProfile(true)
            ? 'monitor profile published'
            : 'monitor profile publish failed';
    }

    /**
     * @param string[] $args
     */
    private function resolveTestEmailRecipient(array $args, string $senderPubkey): ?string
    {
        $candidate = trim((string)($args[0] ?? ''));
        if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
            return $candidate;
        }

        $senderEmail = $this->dataSource->findUserEmailByPubkey($senderPubkey);
        if ($senderEmail !== null && filter_var($senderEmail, FILTER_VALIDATE_EMAIL)) {
            return $senderEmail;
        }

        $siteEmail = trim((string)(CFG::$vars['site']['email'] ?? ''));
        if ($siteEmail !== '' && filter_var($siteEmail, FILTER_VALIDATE_EMAIL)) {
            return $siteEmail;
        }

        $fromEmail = trim((string)(CFG::$vars['smtp']['from_email'] ?? ''));
        if ($fromEmail !== '' && filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            return $fromEmail;
        }

        return null;
    }

    /**
     * @return array{0:string,1:string}
     */
    private function buildTestEmail(string $to): array
    {
        $npub = trim((string)($this->monitorIdentity['npub'] ?? ''));
        $monitorNote = '<p><small>Este correo de prueba ha sido enviado por el monitor del servidor de noxtr.</small></p>';
        $html = "<p><strong>Prueba de envio de email del NoxtrMonitor.</strong></p>"
            . "<p>Destinatario: <strong>" . htmlspecialchars($to, ENT_QUOTES, 'UTF-8') . "</strong></p>"
            . "<p>Hora del servidor: <strong>" . date('Y-m-d H:i:s') . "</strong></p>"
            . "<p>Trades monitorizados ahora mismo: <strong>" . count($this->tradeIndex) . "</strong></p>"
            . ($npub !== '' ? "<p>npub del monitor: <code>" . htmlspecialchars($npub, ENT_QUOTES, 'UTF-8') . "</code></p>" : '')
            . $monitorNote;

        return ['NoxtrMonitor: prueba de email', $html];
    }

    private function publishMonitorProfile(bool $forceLog): bool
    {
        $monitorPrivkey = trim((string)($this->monitorIdentity['privkey'] ?? ''));
        if ($monitorPrivkey === '') {
            return false;
        }

        $metadata = $this->buildMonitorProfileMetadata();
        $content = json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($content) || $content === '') {
            return false;
        }

        $event = NostrCrypto::createEvent($monitorPrivkey, 0, $content, []);
        $sent = $this->publishMonitorEvent($event) > 0;

        if ($this->options->verbose || $forceLog) {
            echo '[monitor] profile ' . ($sent ? 'published' : 'publish failed') . "\n";
        }

        return $sent;
    }

    /**
     * @return array<string,string>
     */
    private function buildMonitorProfileMetadata(): array
    {
        $cfg = CFG::$vars['modules']['noxtr'] ?? [];

        $name = trim((string)($cfg['monitor_profile_name'] ?? 'NoxtrMonitor'));
        if ($name === '') {
            $name = 'NoxtrMonitor';
        }

        $about = trim((string)($cfg['monitor_profile_about'] ?? ''));
        if ($about === '') {
            $about = 'Monitor automatico de noxtr. Envia avisos de trades y admite control por DM de admins autorizados.';
        }

        $picture = trim((string)($cfg['monitor_profile_picture'] ?? ''));
        if ($picture === '') {
            $picture = rtrim(SCRIPT_HOST, '/') . '/media/images/logo.png';
        }

        return [
            'name' => $name,
            'display_name' => $name,
            'about' => $about,
            'picture' => $picture,
        ];
    }

    private function sendControlReply(string $recipientPubkey, string $plaintext, int $requestCreatedAt = 0): void
    {
        $sent = $this->sendControlDm($recipientPubkey, $plaintext, $requestCreatedAt);
        if ($this->options->verbose) {
            echo '[control] reply ' . ($sent ? 'sent' : 'failed')
                . ' -> ' . substr($recipientPubkey, 0, 12)
                . " nip04\n";
        }
    }

    private function sendControlDm(string $recipientPubkey, string $plaintext, int $requestCreatedAt = 0): bool
    {
        $monitorPrivkey = trim((string)($this->monitorIdentity['privkey'] ?? ''));
        if ($monitorPrivkey === '' || $plaintext === '') {
            return false;
        }

        $content = $this->encryptControlDm($recipientPubkey, $plaintext);
        if ($content === null) {
            if ($this->options->verbose) {
                echo '[control] DM encrypt failed -> ' . substr($recipientPubkey, 0, 12) . "\n";
            }
            return false;
        }

        $replyCreatedAt = $requestCreatedAt > 0 ? max($requestCreatedAt + 1, time()) : null;
        $event = NostrCrypto::createEvent($monitorPrivkey, 4, $content, [['p', $recipientPubkey]], $replyCreatedAt);
        return $this->publishMonitorEvent($event) > 0;
    }

    private function encryptControlDm(string $recipientPubkey, string $plaintext): ?string
    {
        $monitorPrivkey = trim((string)($this->monitorIdentity['privkey'] ?? ''));
        if ($monitorPrivkey === '' || !function_exists('openssl_encrypt')) {
            return null;
        }

        try {
            $key = NostrCrypto::getSharedSecretX($monitorPrivkey, $recipientPubkey);
        } catch (Exception $e) {
            return null;
        }

        $iv = random_bytes(16);
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        if (!is_string($ciphertext)) {
            return null;
        }

        return base64_encode($ciphertext) . '?iv=' . base64_encode($iv);
    }

    /**
     * @param array<string,mixed> $event
     */
    private function publishMonitorEvent(array $event): int
    {
        if ($this->relayClient !== null) {
            try {
                $sent = $this->relayClient->publishEvent($event);
                if ($sent > 0) {
                    return $sent;
                }
            } catch (Exception $e) {
                if ($this->options->verbose) {
                    echo '[monitor] live publish failed, falling back -> ' . $e->getMessage() . "\n";
                }
            }
        }

        $urls = (is_object($this->relayClient) && method_exists($this->relayClient, 'getConnectedRelayUrls'))
            ? $this->relayClient->getConnectedRelayUrls()
            : $this->monitorRelays;
        return NostrCrypto::publishToRelays($urls, $event, 3);
    }

    /**
     * @param array<int|string,mixed> $items
     * @return string[]
     */
    private function normalizeAdminPubkeys(array $items): array
    {
        $out = [];

        foreach ($items as $item) {
            $value = strtolower(trim((string)$item));
            if ($value === '') {
                continue;
            }

            if (strpos($value, 'npub1') === 0) {
                $hex = NostrAuth::npubToHex($value);
                if (is_string($hex) && preg_match('/^[0-9a-f]{64}$/', $hex)) {
                    $out[] = strtolower($hex);
                }
                continue;
            }

            if (preg_match('/^[0-9a-f]{64}$/', $value)) {
                $out[] = $value;
            }
        }

        return array_values(array_unique($out));
    }

    private function maybeNotify(MonitoredTrade $trade, string $action, string $eventId): void
    {
        $type = $this->mapMostroActionToNotificationType($trade, $action);
        if ($type === null) {
            return;
        }
        $this->dispatchNotification($trade, $type, $eventId);
    }

    /**
     * Envía la notificación (email + Telegram) de un tipo ya resuelto y marca como enviada.
     * $dedupeKey permite separar el control de duplicados del nombre de la plantilla; por defecto
     * usa el propio $type (comportamiento Lightning). On-chain le añade el user_id para no colisionar
     * cuando maker y taker son dos usuarios locales del mismo order_id.
     */
    private function dispatchNotification(MonitoredTrade $trade, string $type, string $eventId, ?string $dedupeKey = null): void
    {
        $dedupeKey = $dedupeKey ?? $type;
        if ($this->dataSource->wasNotificationSent($trade->orderId, $dedupeKey)) {
            return;
        }

        $notified = false;

        $email = $this->dataSource->findUserEmail($trade->userId);
        if ($email !== null && $email !== '') {
            [$subject, $html] = $this->buildEmail($trade, $type);
            if ($this->notifier->sendEmail($email, $subject, $html)) {
                $notified = true;
            }
        }

        // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────
        // Notifica por Telegram si el usuario tiene un chat vinculado en TGRAM_CHATS.
        // Se envía ADEMÁS del email (no en lugar de él).
        // Para desactivar: eliminar este bloque hasta // ── END FEATURE.
        $chatId = $this->dataSource->findUserTelegramChatId($trade->userId);
        if ($chatId !== null) {
            $text = $this->buildTelegramText($trade, $type);
            if ($this->notifier->sendTelegram($chatId, $text)) {
                $notified = true;
            }
        }
        // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────

        if ($notified) {
            $this->dataSource->markNotificationSent($trade->orderId, $dedupeKey, $eventId);
        }
    }

    /**
     * Procesa un evento público on-chain (NostrEscrow): kinds 39385 (Trade State), 39386 (Dispute),
     * 39387 (Arbitration), 39389 (Funding). Son eventos en claro: la acción está en el tag `action`
     * (39385) o se deriva del kind. El emisor (`pubkey`) es la identidad Nostr del que actúa y el
     * destinatario va en el tag `p`. Avisamos al trade local cuya identidad (`ownerPubkey`) coincide
     * con un `p`: eso garantiza que (a) el evento va dirigido a nuestro usuario y (b) lo firmó la
     * contraparte, no él mismo.
     */
    private function handleOnchainTradeEvent(MonitorEvent $event): void
    {
        if ($event->eventId === '' || $event->firstTag('y') !== 'nostrescrow') {
            return;
        }
        $orderId = $event->firstTag('order_id');
        if ($orderId === '') {
            // Compatibilidad de lectura con eventos anteriores a v2.8.
            $orderId = explode(':', $event->firstTag('d'), 2)[0];
        }
        if ($orderId === '' || !isset($this->onchainOrderIndex[$orderId])) {
            return;
        }

        $action = strtolower(trim($event->firstTag('action')));
        if ($action === '') {
            // Dispute / Arbitration / Funding no traen tag `action`: se deriva del kind.
            if ($event->kind === 39386)      { $action = 'dispute'; }
            elseif ($event->kind === 39387)  { $action = 'arbitration'; }
            elseif ($event->kind === 39389)  { $action = 'funding'; }
            else { return; }
        }

        $recipients = array_map('strtolower', $event->pTags());
        if ($recipients === []) {
            return;
        }

        foreach ($this->onchainOrderIndex[$orderId] as $trade) {
            if ($trade->ownerPubkey === '' || !in_array($trade->ownerPubkey, $recipients, true)) {
                continue;
            }
            $eventNetwork = strtolower(trim($event->firstTag('network')));
            $eventTradeId = strtolower(trim($event->firstTag('trade_id')));
            if ($eventNetwork === '' || $eventNetwork !== $trade->network ||
                ($trade->tradeId !== '' && $eventTradeId !== $trade->tradeId)) {
                continue;
            }
            // Los estados de las partes solo son notificables si los firma la contraparte
            // congelada. Las decisiones de arbitraje se validan completamente en el navegador.
            if ($event->kind !== 39387 &&
                ($trade->peerNostrPubkey === '' || strtolower($event->pubkey) !== $trade->peerNostrPubkey)) {
                continue;
            }
            $type = $this->mapOnchainActionToNotificationType($trade, $action);
            if ($type === null) {
                continue;
            }

            $this->dataSource->storeEvent([
                'event_id' => $event->eventId,
                'kind' => $event->kind,
                'order_id' => $trade->orderId,
                'user_id' => $trade->userId,
                'event_created_at' => $event->createdAt,
                'source' => 'onchain',
                'status' => $action,
                'raw_json' => json_encode($event->raw),
                'processed_at' => time(),
            ]);

            if ($this->options->verbose) {
                echo '[onchain] action=' . $action
                    . ' order=' . $trade->orderId
                    . ' user=' . $trade->userId
                    . ' type=' . $type . "\n";
            }

            // dedupe por (order_id, type, user): si maker y taker son ambos locales no se pisan.
            $this->dispatchNotification($trade, $type, $event->eventId, $type . ':' . $trade->userId);
        }
    }

    private function mapOnchainActionToNotificationType(MonitoredTrade $trade, string $action): ?string
    {
        switch ($action) {
            case 'accept':        return 'onchain_taken';
            case 'funding':       return 'onchain_funded';
            case 'fiat_sent':     return 'onchain_fiat_sent';
            case 'fiat_received': return 'onchain_fiat_received';
            case 'buyer_payout':  return 'onchain_buyer_payout';
            case 'complete':      return 'onchain_complete';
            case 'dispute':       return 'onchain_dispute_by_peer';
            case 'arbitration':   return 'onchain_arbitration';
            // address_check / arbitrators: sincronización interna, no se notifican.
        }
        return null;
    }

    // ── FEATURE: TELEGRAM NOTIFICATIONS ─────────────────────────────────────
    // Versión en texto plano de buildEmail() para enviar por Telegram.
    // Para desactivar: eliminar este método y el bloque en maybeNotify().
    private function buildTelegramText(MonitoredTrade $trade, string $type): string
    {
        $shortId = substr($trade->orderId, 0, 8);
        $tradesUrl = rtrim(SCRIPT_HOST, '/') . '/noxtr/mostro/trades';

        // PHP 8.4 migration: este switch puede volver a ser un match.
        switch ($type) {
            case 'order_taken':
                return "NoxtrMonitor: han tomado tu orden #{$shortId}.\n"
                    . "Entra en {$tradesUrl} para ver el siguiente paso.";
            case 'pay_invoice':
                return "NoxtrMonitor: debes pagar la hold invoice del trade #{$shortId}.\n"
                    . "Entra en {$tradesUrl} para pagarla.";
            case 'fiat_sent':
                return "NoxtrMonitor: el comprador ha marcado el fiat como enviado en #{$shortId}.\n"
                    . "Comprueba el pago y libera en {$tradesUrl}";
            case 'trade_completed':
                return "NoxtrMonitor: trade #{$shortId} completado correctamente.";
            case 'dispute_started_by_you':
                return "NoxtrMonitor: has iniciado una disputa en el trade #{$shortId}.\n"
                    . "Espera a que un admin la tome. Verás el aviso aquí cuando ocurra.";
            case 'dispute_started_by_peer':
                return "⚠️ NoxtrMonitor: la contraparte ha iniciado una disputa en el trade #{$shortId}.\n"
                    . "Entra en {$tradesUrl} para ver el estado y cuando un admin tome la disputa podrás chatear con él.";
            case 'dispute_admin_assigned':
                return "🛡️ NoxtrMonitor: un admin ha tomado la disputa del trade #{$shortId}.\n"
                    . "Entra en {$tradesUrl} para chatear con el admin.";
            case 'dispute_resolved_settled':
                return "⚖️ NoxtrMonitor: el admin ha resuelto la disputa del trade #{$shortId} liberando los sats al comprador.\n"
                    . "Entra en {$tradesUrl} para ver el detalle.";
            case 'dispute_resolved_canceled':
                return "⚖️ NoxtrMonitor: el admin ha resuelto la disputa del trade #{$shortId} cancelando el trade (fondos devueltos al vendedor).\n"
                    . "Entra en {$tradesUrl} para ver el detalle.";

            // ── On-chain (NostrEscrow) ──────────────────────────────────────
            case 'onchain_taken':
                return "NoxtrMonitor (on-chain): han aceptado tu solicitud para tomar la orden #{$shortId}. El trade está activo.\n"
                    . "Sigue el proceso en {$tradesUrl}";
            case 'onchain_funded':
                return "NoxtrMonitor (on-chain): el vendedor ha fondeado el escrow del trade #{$shortId}.\n"
                    . "Verifícalo y continúa en {$tradesUrl}";
            case 'onchain_fiat_sent':
                return "NoxtrMonitor (on-chain): el comprador ha marcado el fiat como enviado en #{$shortId}.\n"
                    . "Comprueba el pago y firma la liberación en {$tradesUrl}";
            case 'onchain_fiat_received':
                return "NoxtrMonitor (on-chain): el vendedor ha confirmado la recepción del fiat en #{$shortId}.\n"
                    . "Indica tu dirección de cobro en {$tradesUrl}";
            case 'onchain_buyer_payout':
                return "NoxtrMonitor (on-chain): el comprador ha indicado su dirección de cobro en #{$shortId}.\n"
                    . "Firma y difunde la liberación en {$tradesUrl}";
            case 'onchain_complete':
                return "NoxtrMonitor (on-chain): trade #{$shortId} completado, transacción difundida.";
            case 'onchain_dispute_by_peer':
                return "⚠️ NoxtrMonitor (on-chain): la contraparte ha abierto una disputa en el trade #{$shortId}.\n"
                    . "Revisa el trade y aporta pruebas en {$tradesUrl}";
            case 'onchain_arbitration':
                return "🛡️ NoxtrMonitor (on-chain): novedades de arbitraje en el trade #{$shortId}.\n"
                    . "Mira el estado en {$tradesUrl}";
        }
        return "NoxtrMonitor: aviso del trade #{$shortId}.";
    }
    // ── END FEATURE: TELEGRAM NOTIFICATIONS ──────────────────────────────────

    private function mapMostroActionToNotificationType(MonitoredTrade $trade, string $action): ?string
    {
        $action = strtolower(trim($action));

        if ($trade->tradeRole === 'created' && $action === 'buyer-took-order') {
            // In real Mostro flows this action can arrive late, after a stronger
            // actionable event like `pay-invoice`. In that case "han tomado tu
            // orden" is stale and just creates noise.
            if ($this->dataSource->wasNotificationSent($trade->orderId, 'pay_invoice')) {
                return null;
            }
            if ($this->dataSource->wasNotificationSent($trade->orderId, 'fiat_sent')) {
                return null;
            }
            if ($this->dataSource->wasNotificationSent($trade->orderId, 'trade_completed')) {
                return null;
            }
            return 'order_taken';
        }
        if ($trade->isSeller === 1 && $action === 'pay-invoice') {
            return 'pay_invoice';
        }
        if ($trade->isSeller === 1 && in_array($action, ['fiat-sent', 'fiat-sent-ok'], true)) {
            return 'fiat_sent';
        }
        if (in_array($action, ['success', 'purchase-completed', 'hold-invoice-payment-settled'], true)) {
            return 'trade_completed';
        }

        // Dispute lifecycle notifications (Mostro protocol /protocol/dispute.html).
        if ($action === 'dispute-initiated-by-you') {
            return 'dispute_started_by_you';
        }
        if ($action === 'dispute-initiated-by-peer') {
            return 'dispute_started_by_peer';
        }
        if ($action === 'admin-took-dispute') {
            return 'dispute_admin_assigned';
        }
        // Resolución de la disputa por el admin (mostro-core Action::AdminSettled/AdminCanceled,
        // admin_settle.rs/admin_cancel.rs — mismo hallazgo ya corregido en el cliente el 2026-08-21,
        // ver CLAUDE.md). El monitor no lo notificaba: auditoría 2026-08-22, hallazgo menor.
        if ($action === 'admin-settled') {
            return 'dispute_resolved_settled';
        }
        if ($action === 'admin-canceled') {
            return 'dispute_resolved_canceled';
        }

        return null;
    }

    /**
     * @return array{0:string,1:string}
     */
    /** @return array{0: string, 1: string} */
    private function buildEmail(MonitoredTrade $trade, string $type): array
    {
        $shortId = substr($trade->orderId, 0, 8);
        $tradesUrl = rtrim(SCRIPT_HOST, '/') . '/noxtr/mostro/trades';
        $monitorNote = '<p><small>Este aviso automático ha sido enviado por el monitor del servidor de noxtr. Puede llegar aunque no tengas la web abierta.</small></p>';

        // PHP 8.4 migration: este switch puede volver a ser un match.
        switch ($type) {
            case 'order_taken':
                return [
                    'NoxtrMonitor: han tomado tu orden',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>Han tomado tu orden <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para revisar el trade y seguir el siguiente paso del proceso.</p>"
                    . $monitorNote,
                ];

            case 'pay_invoice':
                return [
                    'NoxtrMonitor: debes pagar la hold invoice',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>Tu trade <strong>#{$shortId}</strong> requiere pagar una <strong>hold invoice</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>, abre el trade y paga la invoice para que la operación pueda continuar.</p>"
                    . $monitorNote,
                ];

            case 'fiat_sent':
                return [
                    'NoxtrMonitor: el comprador ha enviado el fiat',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>En el trade <strong>#{$shortId}</strong> el comprador ha marcado el fiat como enviado.</p>"
                    . "<p>Qué hacer ahora: comprueba que has recibido el pago y, si todo está correcto, entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para liberar los sats.</p>"
                    . $monitorNote,
                ];

            case 'trade_completed':
                return [
                    'NoxtrMonitor: trade completado',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>El trade <strong>#{$shortId}</strong> se ha completado correctamente.</p>"
                    . "<p>Si quieres revisarlo o archivarlo, lo tienes disponible en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>.</p>"
                    . $monitorNote,
                ];

            case 'dispute_started_by_you':
                return [
                    'NoxtrMonitor: has iniciado una disputa',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>Has iniciado una disputa en el trade <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué pasa ahora: la instancia ha publicado la disputa. Espera a que un admin la tome — recibirás otro aviso cuando ocurra.</p>"
                    . $monitorNote,
                ];

            case 'dispute_started_by_peer':
                return [
                    '⚠️ NoxtrMonitor: la contraparte ha iniciado una disputa',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>La contraparte ha iniciado una disputa en el trade <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para revisar el trade. Cuando un admin tome la disputa podrás chatear con él directamente desde la ficha del trade.</p>"
                    . $monitorNote,
                ];

            case 'dispute_admin_assigned':
                return [
                    '🛡️ NoxtrMonitor: un admin ha tomado la disputa',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>Un admin ha tomado la disputa del trade <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>. En la ficha del trade verás un nuevo recuadro de chat con el admin para resolver la disputa.</p>"
                    . $monitorNote,
                ];

            case 'dispute_resolved_settled':
                return [
                    '⚖️ NoxtrMonitor: disputa resuelta — sats liberados',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>El admin ha resuelto la disputa del trade <strong>#{$shortId}</strong>: los sats se han liberado al comprador.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para ver el detalle.</p>"
                    . $monitorNote,
                ];

            case 'dispute_resolved_canceled':
                return [
                    '⚖️ NoxtrMonitor: disputa resuelta — trade cancelado',
                    "<p><strong>Aviso automático del NoxtrMonitor.</strong></p>"
                    . "<p>El admin ha resuelto la disputa del trade <strong>#{$shortId}</strong> cancelando el trade (los fondos vuelven al vendedor).</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para ver el detalle.</p>"
                    . $monitorNote,
                ];

            // ── On-chain (NostrEscrow) ──────────────────────────────────────
            case 'onchain_taken':
                return [
                    'NoxtrMonitor: han aceptado tu solicitud (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>Tu solicitud para tomar la orden on-chain <strong>#{$shortId}</strong> ha sido aceptada. El trade está activo.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para seguir el proceso (fondeo del escrow, etc.).</p>"
                    . $monitorNote,
                ];
            case 'onchain_funded':
                return [
                    'NoxtrMonitor: escrow fondeado (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>El vendedor ha fondeado el escrow del trade on-chain <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>, verifica el fondeo y continúa con el pago del fiat.</p>"
                    . $monitorNote,
                ];
            case 'onchain_fiat_sent':
                return [
                    'NoxtrMonitor: el comprador ha enviado el fiat (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>En el trade on-chain <strong>#{$shortId}</strong> el comprador ha marcado el fiat como enviado.</p>"
                    . "<p>Qué hacer ahora: comprueba que has recibido el pago y, si es correcto, entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para firmar la liberación de los fondos.</p>"
                    . $monitorNote,
                ];
            case 'onchain_fiat_received':
                return [
                    'NoxtrMonitor: el vendedor confirma recepción del fiat (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>En el trade on-chain <strong>#{$shortId}</strong> el vendedor ha confirmado que recibió el fiat.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para indicar tu dirección de cobro y completar el trade.</p>"
                    . $monitorNote,
                ];
            case 'onchain_buyer_payout':
                return [
                    'NoxtrMonitor: el comprador indicó su dirección de cobro (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>En el trade on-chain <strong>#{$shortId}</strong> el comprador ha indicado su dirección de cobro.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para firmar y difundir la transacción de liberación.</p>"
                    . $monitorNote,
                ];
            case 'onchain_complete':
                return [
                    'NoxtrMonitor: trade on-chain completado',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>El trade on-chain <strong>#{$shortId}</strong> se ha completado: la transacción de liberación se ha difundido.</p>"
                    . "<p>Puedes revisarlo en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>.</p>"
                    . $monitorNote,
                ];
            case 'onchain_dispute_by_peer':
                return [
                    '⚠️ NoxtrMonitor: la contraparte ha abierto una disputa (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>La contraparte ha abierto una disputa en el trade on-chain <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para revisar el trade y aportar tus pruebas al arbitraje.</p>"
                    . $monitorNote,
                ];
            case 'onchain_arbitration':
                return [
                    '🛡️ NoxtrMonitor: novedades de arbitraje (on-chain)',
                    "<p><strong>Aviso automático del NoxtrMonitor (on-chain).</strong></p>"
                    . "<p>Hay novedades de arbitraje en el trade on-chain <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para ver el estado de la disputa.</p>"
                    . $monitorNote,
                ];
        }

        return ['NoxtrMonitor', '<p>Aviso automático del NoxtrMonitor.</p>' . $monitorNote];
    }

    private function installSignalHandlers(): void
    {
        if (!function_exists('pcntl_signal')) {
            return;
        }

        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
        }

        pcntl_signal(SIGTERM, [$this, 'handleSignal']);
        pcntl_signal(SIGINT, [$this, 'handleSignal']);

        if (defined('SIGHUP')) {
            pcntl_signal(SIGHUP, [$this, 'handleSignal']);
        }
    }

    public function handleSignal($signal): void
    {
        $this->shouldStop = true;
        fwrite(STDOUT, "[monitor] signal received: {$signal}\n");
    }

    private function dispatchSignals(): void
    {
        if (function_exists('pcntl_signal_dispatch')) {
            pcntl_signal_dispatch();
        }
    }
}

/**
 * Entrada CLI mínima.
 *
 * Ahora mismo:
 * - monta el esqueleto
 * - imprime resumen
 * - deja claro qué pieza falta
 */
function main(array $argv): int
{
    $options = MonitorOptions::fromArgv($argv);

    // PHP 8.4 migration: este bloque puede volver a ser un match.
    if ($options->source === 'json') {
        $dataSource = new JsonFileDataSource($options->jsonFile ?: __DIR__ . '/monitor.sample.json');
    } elseif ($options->source === 'db') {
        $localSource  = new FrameworkDbDataSource([]);
        $remoteSites  = NoxtrStore::loadNoxtrSites();
        if (empty($remoteSites)) {
            $dataSource = $localSource;
        } else {
            $sources = [$localSource];
            foreach ($remoteSites as $i => $site) {
                // siteIndex empieza en 1 (0 = local)
                $offset    = ($i + 1) * MultiSiteDataSource::SITE_OFFSET;
                $sources[] = new RemoteSiteDataSource(
                    (string)($site['site_url'] ?? ''),
                    (string)($site['api_key']  ?? ''),
                    $offset
                );
            }
            $dataSource = new MultiSiteDataSource($sources);
            if ($options->verbose) {
                echo '[monitor] multi-site: ' . count($remoteSites) . ' remote site(s) loaded' . "\n";
            }
        }
    } else {
        throw new InvalidArgumentException('Unknown source: ' . $options->source);
    }

    $emailEnabled = in_array(
        strtolower(trim((string)(CFG::$vars['modules']['noxtr']['trade_notification_email'] ?? ''))),
        ['1', 'true', 'yes', 'on'],
        true
    );
    echo '[monitor] server_monitor v' . NostrMonitor::VERSION . "\n";
    // Estado del email SIEMPRE visible al arrancar: es la causa mas comun de "no llegan emails"
    echo '[monitor] emails: ' . ($emailEnabled ? 'ON' : 'OFF (CFG modules.noxtr.trade_notification_email='
        . var_export(CFG::$vars['modules']['noxtr']['trade_notification_email'] ?? null, true) . ')')
        . ' | smtp: ' . (string)(CFG::$vars['smtp']['server'] ?? '(no definido)')
        . ':' . (string)(CFG::$vars['smtp']['port'] ?? '?')
        . (empty(CFG::$vars['smtp']['anonymous']) ? ' auth' : ' anon')
        . ' | from: ' . (string)(CFG::$vars['site']['from_email'] ?? '(no definido)') . "\n";

    $notifier = $options->dryRun
        ? new NullNotifier($options->verbose || $options->dryRun)
        : new FrameworkEmailNotifier($emailEnabled, $options->verbose);
    $relayClient = new NostrRelayClient($options->debugRelays);
    $monitorIdentity = NoxtrStore::ensureMonitorIdentity();

    $monitor = new NostrMonitor($dataSource, $notifier, $relayClient, $options, $monitorIdentity);
    $monitor->run();

    return 0;
}

exit(main($argv));
