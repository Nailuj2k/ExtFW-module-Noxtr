<?php
declare(strict_types=1);

/**
 * Noxtr / Mostro Monitor
 *
 * Propuesta de arquitectura para un proceso CLI independiente del framework web.
 *
 * Objetivo:
 * - Conectarse por WebSocket a relays Nostr
 * - Suscribirse a eventos Mostro (kind 1059)
 * - Resolver a qué trade/user corresponde cada evento
 * - Descifrar el gift wrap con la trade_privkey adecuada
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
 * - NSTR_MOSTRO_TRADES : trades y claves del trade
 * - NSTR_RELAYS        : relays
 * - CFG_CFG            : configuración del módulo
 * - CLI_USER           : email del user
 * - configuration.php  : credenciales de BD
 *
 * Siguiente paso real después de este esquema:
 * 1. Implementar FrameworkDbDataSource con PDO
 * 2. Implementar EventStore sobre NSTR_EVENTS
 * 3. Implementar RelayClient con un cliente WebSocket CLI
 * 4. Portar a PHP las rutinas de unwrap NIP-59 / Mostro
 *
 * Nota de compatibilidad:
 * - Este archivo se mantiene en sintaxis PHP 7.3 porque el CLI del servidor
 *   todavía usa esa versión.
 * - PHP 8.4 migration: cuando el CLI suba de versión, conviene recuperar
 *   typed properties, readonly, constructor property promotion y match.
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
}

interface MonitorDataSourceInterface
{
    /**
     * @return MonitoredTrade[]
     */
    public function loadActiveTrades(): array;

    /**
     * @return string[]
     */
    public function findUserEmail(int $userId): ?string;

    public function findUserEmailByPubkey(string $pubkey): ?string;

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
        $sql = "SELECT user_id, order_id, robot_pubkey, trade_key_pub, trade_privkey,
                       trade_role, trade_kind, is_seller, internal_status, peer_pubkey
                FROM NSTR_MOSTRO_TRADES
                WHERE COALESCE(archived, 0) = 0
                  AND COALESCE(trade_key_pub, '') <> ''
                  AND COALESCE(trade_privkey, '') <> ''
                  AND LOWER(COALESCE(internal_status, '')) NOT IN ('cancelado', 'completado', 'disputado', 'archivado')
                ORDER BY updated_at DESC";

        $rows = $this->fetchAll($sql);
        $trades = [];

        foreach ($rows as $row) {
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

        $this->execute($sql, [
            $eventId !== '' ? $eventId : ('notify-' . $orderId . '-' . $type . '-' . $now),
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
        if (!$this->enabled) {
            if ($this->verbose) {
                echo "[monitor] email disabled -> {$to} | {$subject}\n";
            }
            return false;
        }

        $sent = NoxtrStore::sendEmail($subject, $html, $to);
        if ($this->verbose) {
            echo '[monitor] email ' . ($sent ? 'sent' : 'failed') . " -> {$to} | {$subject}\n";
        }
        return $sent;
    }
}

final class NostrMonitor
{
    const VERSION = '1.0.8';

    /** @var array<string,MonitoredTrade> */
    private $tradeIndex = [];
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
    /** @var string[] */
    private $monitorRelays = [];
    /** @var int */
    private $startedAt = 0;
    /** @var bool */
    private $startupDmSent = false;
    /** @var bool */
    private $monitorProfilePublished = false;
    /** @var array<int,array<string,mixed>> */
    private $autoTakeFilters = [];
    /** @var array<string,int> */
    private $seenOrderBookEventIds = [];
    /** @var array<string,int> */
    private $autoTakenOrderIds = [];
    /** @var int */
    private $autoTakeRequestId = 0;

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
        $this->loadAutoTakeFilters();

        foreach ($this->dataSource->loadActiveTrades() as $trade) {
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
            if ($this->autoTakeFilters !== []) {
                echo '[filter] active=' . count($this->autoTakeFilters) . "\n";
            }
        }
    }

    private function loadAutoTakeFilters(): void
    {
        $cfgKey = 'modules.noxtr.monitor_take_filters';
        $raw = trim((string)(CFG::$vars['modules']['noxtr']['monitor_take_filters'] ?? NoxtrStore::getCfgValue($cfgKey, '')));
        $rules = [];

        if ($raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                foreach ($decoded as $row) {
                    if (!is_array($row)) {
                        continue;
                    }

                    $type = strtolower(trim((string)($row['type'] ?? '')));
                    if ($type === 'amount') {
                        $amount = $this->normalizeNumericValue($row['value'] ?? null);
                        if ($amount === null) {
                            continue;
                        }

                        $rule = [
                            'type' => 'amount',
                            'value' => $amount,
                        ];

                        $fiatCode = strtoupper(trim((string)($row['fiat_code'] ?? '')));
                        if ($fiatCode !== '') {
                            $rule['fiat_code'] = preg_replace('/[^A-Z]/', '', $fiatCode);
                        }

                        $rules[] = $rule;
                        continue;
                    }

                    if ($type === 'days') {
                        $days = $this->normalizeNonNegativeInt($row['value'] ?? null);
                        if ($days === null) {
                            continue;
                        }

                        $rules[] = [
                            'type' => 'days',
                            'value' => (string)$days,
                        ];
                        continue;
                    }

                    if ($type === 'days_missing') {
                        $rules[] = [
                            'type' => 'days_missing',
                            'value' => 'missing',
                        ];
                    }
                }
            }
        }

        $this->autoTakeFilters = $rules;
        CFG::$vars['modules']['noxtr']['monitor_take_filters'] = $raw;
    }

    /**
     * Filtro mínimo viable para Mostro:
     * - kind 1059
     * - #p contra todos los trade_key_pub activos
     *
     * @return array<int,array<string,mixed>>
     */
    private function buildFilters(): array
    {
        $pubs = array_keys($this->tradeIndex);
        $filters = [];

        if ($pubs !== []) {
            $filters[] = [
                'kinds' => [1059],
                '#p' => array_values($pubs),
                // Mirror the frontend Mostro subscription window so we don't miss
                // recent trade events while the monitor is restarted or reconnecting.
                'since' => time() - 86400 * 7,
            ];
        }

        $controlFilter = $this->buildControlFilter();
        if ($controlFilter !== null) {
            $filters[] = $controlFilter;
        }

        $autoTakeFilter = $this->buildAutoTakeOrderFilter();
        if ($autoTakeFilter !== null) {
            $filters[] = $autoTakeFilter;
        }

        if ($this->options->debugWide) {
            $filters[] = [
                'kinds' => [1059],
                'since' => time() - 600,
                'limit' => 50,
            ];
        }

        return $filters;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function buildAutoTakeOrderFilter()
    {
        // Siempre suscribirse al order book: para notificar por DM cada orden nueva
        // y, si hay reglas configuradas, para auto-take.
        return [
            'kinds' => [38383],
            '#s' => ['pending'],
            '#y' => ['mostro'],
            'since' => time() - 86400 * 2,
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
        static $lastFiltersCount = null;

        $tradesCount = count($this->tradeIndex);
        $filtersCount = count($this->autoTakeFilters);
        if ($printed && $lastTradesCount === $tradesCount && $lastFiltersCount === $filtersCount) {
            return;
        }

        echo "NoxtrMonitor bootstrap\n";
        echo "- source   : {$this->options->source}\n";
        echo "- trades   : " . $tradesCount . "\n";
        echo "- relays   : " . count($this->monitorRelays) . "\n";
        echo "- dry-run  : " . ($this->options->dryRun ? 'yes' : 'no') . "\n";
        echo "- filters  : " . count($this->autoTakeFilters) . "\n";
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
        $lastFiltersCount = $filtersCount;
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
            'Monitor Mostro arrancado correctamente.',
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
            $this->handleControlDm($event);
            return;
        }

        if ($event->kind === 38383) {
            $this->handleOrderBookEvent($event);
            return;
        }

        if ($event->kind !== 1059 || $event->eventId === '') {
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

        $rumor = NostrCrypto::unwrapGiftWrap($event->raw, $trade->tradePrivkey);
        if (!is_array($rumor) || empty($rumor['content'])) {
            if ($this->options->verbose) {
                echo '[mostro] unwrap failed for order=' . $trade->orderId . ' event=' . substr($event->eventId, 0, 12) . "\n";
            }
            return;
        }

        $msg = json_decode((string)$rumor['content'], true);
        if (!is_array($msg)) {
            if ($this->options->verbose) {
                echo '[mostro] invalid rumor content for order=' . $trade->orderId . ' event=' . substr($event->eventId, 0, 12) . "\n";
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

        $order = $this->parseOrderBookEvent($event->raw);
        if ($order === null) {
            return;
        }

        if ($this->dataSource->isEventProcessed($event->eventId)) {
            return;
        }

        // Notificar toda orden nueva por DM a los admins
        $this->notifyNewOrderViaDm($order);

        // Auto-take (solo si hay filtros configurados)
        if ($this->autoTakeFilters === []) {
            return;
        }

        $orderId = (string)$order['id'];
        if ($orderId === '' || isset($this->autoTakenOrderIds[$orderId])) {
            return;
        }

        $matchedRule = $this->findMatchingAutoTakeRule($order);
        if ($matchedRule === null) {
            return;
        }

        $sent = $this->sendEphemeralTakeForOrder($order);
        if (!$sent) {
            if ($this->options->verbose) {
                echo '[filter] auto-take failed order=' . $orderId . "\n";
            }
            return;
        }

        $this->autoTakenOrderIds[$orderId] = time();
        $this->trimAssocMap($this->autoTakenOrderIds, 2000);

        $label = (string)$order['fiat_amount'] . ' ' . (string)$order['fiat_code'];
        $action = (string)$order['take_action'];
        echo '[filter] auto-take ' . $action
            . ' order=' . substr($orderId, 0, 12)
            . ' amount=' . $label
            . ' robot=' . substr((string)$order['robot_pubkey'], 0, 12) . "\n";

        $this->notifyAutoTakeTriggered($order, $matchedRule, $event->eventId);
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
        // Ignorar órdenes anteriores al arranque del proceso
        $orderCreatedAt = (int)($order['created_at'] ?? 0);
        if ($orderCreatedAt > 0 && $orderCreatedAt < $this->startedAt) {
            return;
        }

        $text = $this->buildNewOrderDmText($order);

        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            $this->sendControlDm($recipientPubkey, $text);
        }

        $this->notifyNewOrderViaEmail($order, $text);

        if ($this->options->verbose) {
            echo '[order] new order notified: ' . $text . "\n";
        }
    }

    /**
     * @param array<string,mixed> $order
     */
    private function notifyNewOrderViaEmail(array $order, string $text): void
    {
        $recipients = $this->resolveAutoTakeAlertEmails();
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
     * @param array<string,mixed> $order
     */
    private function findMatchingAutoTakeRule(array $order): ?array
    {
        $amount = (string)($order['fiat_amount_norm'] ?? '');
        $fiatCode = strtoupper(trim((string)($order['fiat_code'] ?? '')));
        if ($amount === '') {
            return null;
        }

        foreach ($this->autoTakeFilters as $rule) {
            $ruleType = strtolower(trim((string)($rule['type'] ?? '')));
            if ($ruleType === 'amount') {
                if ((string)($rule['value'] ?? '') !== $amount) {
                    continue;
                }

                $ruleFiat = strtoupper(trim((string)($rule['fiat_code'] ?? '')));
                if ($ruleFiat !== '' && $ruleFiat !== $fiatCode) {
                    continue;
                }

                return $rule;
            }

            if ($ruleType === 'days') {
                $orderDays = $this->normalizeNonNegativeInt($order['account_days'] ?? null);
                if ($orderDays === null) {
                    continue;
                }
                if ((string)($rule['value'] ?? '') !== (string)$orderDays) {
                    continue;
                }

                return $rule;
            }

            if ($ruleType === 'days_missing') {
                $orderDays = $this->normalizeNonNegativeInt($order['account_days'] ?? null);
                if ($orderDays !== null) {
                    continue;
                }

                return $rule;
            }
        }

        return null;
    }

    /**
     * @param array<string,mixed> $order
     */
    private function sendEphemeralTakeForOrder(array $order): bool
    {
        $robotPubkey = trim((string)($order['robot_pubkey'] ?? ''));
        $orderId = trim((string)($order['id'] ?? ''));
        $action = trim((string)($order['take_action'] ?? ''));
        if ($robotPubkey === '' || $orderId === '' || $action === '') {
            return false;
        }

        if ($this->options->dryRun) {
            return true;
        }

        try {
            $tradeKeypair = NostrCrypto::generateKeypair();
            $message = [
                [
                    'order' => [
                        'version' => 1,
                        'id' => $orderId,
                        'action' => $action,
                        'payload' => null,
                        'request_id' => ++$this->autoTakeRequestId,
                        'trade_index' => 1,
                    ],
                ],
                null,
            ];

            $rumorContent = json_encode($message, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($rumorContent) || $rumorContent === '') {
                return false;
            }

            $wrap = NostrCrypto::createMostroGiftWrap($rumorContent, $robotPubkey, (string)$tradeKeypair['privkey']);
            return $this->publishMonitorEvent($wrap) > 0;
        } catch (Exception $e) {
            if ($this->options->verbose) {
                echo '[filter] sendEphemeralTakeForOrder exception: ' . $e->getMessage() . "\n";
            }
            return false;
        }
    }

    /**
     * @param array<string,mixed> $order
     * @param array<string,mixed> $rule
     */
    private function notifyAutoTakeTriggered(array $order, array $rule, string $eventId): void
    {
        $this->dataSource->storeEvent([
            'event_id' => $eventId,
            'kind' => 38383,
            'order_id' => (string)($order['id'] ?? ''),
            'user_id' => 0,
            'event_created_at' => (int)($order['created_at'] ?? time()),
            'source' => 'filter',
            'status' => 'auto-take',
            'raw_json' => json_encode([
                'order' => $order,
                'rule' => $rule,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'processed_at' => time(),
        ]);

        $this->notifyAutoTakeViaDm($order, $rule);
        $this->notifyAutoTakeViaEmail($order, $rule);
    }

    /**
     * @param array<string,mixed> $order
     * @param array<string,mixed> $rule
     */
    private function notifyAutoTakeViaDm(array $order, array $rule): void
    {
        if ($this->controlAdminPubkeys === []) {
            return;
        }

        $text = $this->buildAutoTakeDmText($order, $rule);
        foreach ($this->controlAdminPubkeys as $recipientPubkey) {
            $this->sendControlDm($recipientPubkey, $text);
        }
    }

    /**
     * @param array<string,mixed> $order
     * @param array<string,mixed> $rule
     */
    private function notifyAutoTakeViaEmail(array $order, array $rule): void
    {
        $recipients = $this->resolveAutoTakeAlertEmails();
        if ($recipients === []) {
            return;
        }

        [$subject, $html] = $this->buildAutoTakeEmail($order, $rule);
        foreach ($recipients as $to) {
            $this->notifier->sendEmail($to, $subject, $html);
        }
    }

    /**
     * @return string[]
     */
    private function resolveAutoTakeAlertEmails(): array
    {
        $emails = [];

        foreach ($this->controlAdminPubkeys as $pubkey) {
            $email = $this->dataSource->findUserEmailByPubkey($pubkey);
            if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $emails[] = strtolower(trim($email));
            }
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
     * @param array<string,mixed> $order
     * @param array<string,mixed> $rule
     */
    private function buildAutoTakeDmText(array $order, array $rule): string
    {
        $parts = [
            'Monitor Mostro: filtro disparado.',
            'order=' . (string)($order['id'] ?? ''),
            'action=' . (string)($order['take_action'] ?? ''),
            'amount=' . trim((string)($order['fiat_amount'] ?? '') . ' ' . (string)($order['fiat_code'] ?? '')),
            'rule=' . $this->formatAutoTakeRule($rule),
            'modo=ephemeral-no-local-trade',
        ];

        return implode(' | ', $parts);
    }

    /**
     * @param array<string,mixed> $order
     * @param array<string,mixed> $rule
     * @return array{0:string,1:string}
     */
    private function buildAutoTakeEmail(array $order, array $rule): array
    {
        $orderId = (string)($order['id'] ?? '');
        $shortId = substr($orderId, 0, 8);
        $amount = trim((string)($order['fiat_amount'] ?? '') . ' ' . (string)($order['fiat_code'] ?? ''));
        $action = (string)($order['take_action'] ?? '');
        $robot = (string)($order['robot_pubkey'] ?? '');
        $ruleText = $this->formatAutoTakeRule($rule);

        $subject = 'Monitor Mostro: filtro auto-take activado #' . $shortId;
        $html = "<p><strong>El monitor Mostro ha disparado un filtro auto-take.</strong></p>"
            . "<p><strong>Orden:</strong> #" . htmlspecialchars($shortId, ENT_QUOTES, 'UTF-8') . "</p>"
            . "<p><strong>Order ID:</strong> <code>" . htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8') . "</code></p>"
            . "<p><strong>Acción enviada:</strong> <code>" . htmlspecialchars($action, ENT_QUOTES, 'UTF-8') . "</code></p>"
            . "<p><strong>Importe:</strong> " . htmlspecialchars($amount, ENT_QUOTES, 'UTF-8') . "</p>"
            . "<p><strong>Regla que ha coincidido:</strong> <code>" . htmlspecialchars($ruleText, ENT_QUOTES, 'UTF-8') . "</code></p>"
            . "<p><strong>Robot:</strong> <code>" . htmlspecialchars($robot, ENT_QUOTES, 'UTF-8') . "</code></p>"
            . "<p>Modo aplicado: auto-take efímero. No se ha guardado trade local en la base de datos.</p>";

        return [$subject, $html];
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

            case 'profile':
            case 'publish-profile':
                if ($this->options->verbose) {
                    echo "[control] profile from={$shortSender}\n";
                }
                return [$this->publishMonitorProfileCommand(), true];

            case 'filter_trade':
            case 'filter-trade':
            case 'filters':
                if ($this->options->verbose) {
                    echo "[control] filter_trade from={$shortSender}\n";
                }
                return [$this->executeAutoTakeFilterCommand($args), true];

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
                    'commands: status, ping, trades, relays, email [destino], profile, filter_trade, reload, restart, stop, close, shutdown, help',
                    'usa: help trades | help filter_trade | help status | help relays | help email | help profile',
                ]);

            case 'trades':
            case 'trade':
                return $this->buildTradesHelp();

            case 'filter_trade':
            case 'filter-trade':
            case 'filters':
                return $this->buildAutoTakeFiltersHelp();

            case 'status':
                return 'status: muestra version, trades monitorizados, filtros activos, uptime y admins.';

            case 'relays':
                return 'relays: muestra relays configurados y, si aplica, los conectados en esta sesion.';

            case 'email':
            case 'test-email':
            case 'email-test':
                return 'email [destino@example.com]: envia un email de prueba al destino indicado o al fallback configurado.';

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
        }

        return 'unknown help topic: ' . $topic;
    }

    private function buildStatusReply(): string
    {
        $uptime = max(0, time() - $this->startedAt);
        $parts = [
            'monitor v' . self::VERSION . ' running',
            'trades=' . count($this->tradeIndex),
            'filters=' . count($this->autoTakeFilters),
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
        ];

        if ($args === []) {
            return $out;
        }

        $keywords = ['status', 'amount', 'age', 'help', '?', 'all'];
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

        // Kind 38383 es un evento replaceable: el robot lo re-publica periódicamente
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

    private function publishMonitorProfileCommand(): string
    {
        return $this->publishMonitorProfile(true)
            ? 'monitor profile published'
            : 'monitor profile publish failed';
    }

    /**
     * @param string[] $args
     */
    private function executeAutoTakeFilterCommand(array $args): string
    {
        if ($args === []) {
            return $this->buildAutoTakeFiltersHelp();
        }

        $verb = strtolower(trim((string)($args[0] ?? '')));

        if (in_array($verb, ['list', 'show', 'status'], true)) {
            return $this->buildAutoTakeFiltersReply();
        }

        if (in_array($verb, ['clear', 'off', 'disable'], true)) {
            $this->persistAutoTakeFilters([]);
            $this->shouldReload = true;
            return 'filter_trade: all rules cleared | reloading relay session';
        }

        if ($verb === 'amount') {
            return $this->addAmountAutoTakeFilter(array_slice($args, 1));
        }

        if ($verb === 'days') {
            return $this->addDaysAutoTakeFilter(array_slice($args, 1));
        }

        if (in_array($verb, ['remove', 'delete', 'del', 'rm'], true)) {
            $rest = array_slice($args, 1);
            $removeType = strtolower(trim((string)($rest[0] ?? '')));
            if (in_array($removeType, ['amount', 'days'], true)) {
                $rest = array_slice($rest, 1);
            }
            if ($removeType === 'days') {
                return $this->removeDaysAutoTakeFilter($rest);
            }
            return $this->removeAmountAutoTakeFilter($rest);
        }

        return 'usage: filter_trade list | filter_trade amount 88 [EUR] | filter_trade days 0 | filter_trade days missing | filter_trade remove amount 88 [EUR] | filter_trade remove days 0 | filter_trade remove days missing | filter_trade clear';
    }

    private function buildAutoTakeFiltersHelp(): string
    {
        $help = [
            'filter_trade: auto-take efimero de ofertas Mostro del order book.',
            'funcionamiento: si una orden pending fija coincide con la regla, el monitor envia take-sell/take-buy y no guarda trade local.',
            'limites: solo ordenes de importe fijo; las ordenes por rango se ignoran.',
            'sintaxis:',
            '- filter_trade amount 88',
            '- filter_trade amount 88 EUR',
            '- filter_trade days 0',
            '- filter_trade days missing',
            '- filter_trade days none',
            '- filter_trade days null',
            '- filter_trade remove amount 88 EUR',
            '- filter_trade remove amount 88',
            '- filter_trade remove days 0',
            '- filter_trade remove days missing',
            '- filter_trade remove days none',
            '- filter_trade list',
            '- filter_trade show',
            '- filter_trade status',
            '- filter_trade clear',
            '- filter_trade off',
            '- filter_trade disable',
            'ejemplos:',
            '- filter_trade amount 88 EUR',
            '- filter_trade days 0',
            '- filter_trade days missing',
            '- filter_trade amount 100',
            '- filter_trade remove amount 88 EUR',
            'aliases:',
            '- remove = delete | del | rm',
            '- days missing = days none | days null | days nodays | days no_days',
            '- list = show | status',
            '- clear = off | disable',
            'alertas: cuando el filtro se dispara, el monitor envia DM a los admins configurados y email si encuentra destinatario.',
        ];

        if ($this->autoTakeFilters !== []) {
            $help[] = 'activas: ' . $this->buildAutoTakeFiltersReply();
        }

        return implode("\n", $help);
    }

    private function buildAutoTakeFiltersReply(): string
    {
        $count = count($this->autoTakeFilters);
        if ($count === 0) {
            return 'filters=0';
        }

        $items = [];
        foreach ($this->autoTakeFilters as $rule) {
            $items[] = $this->formatAutoTakeRule($rule);
        }

        return 'filters=' . $count . ' | ' . implode(' | ', $items);
    }

    /**
     * @param string[] $args
     */
    private function addAmountAutoTakeFilter(array $args): string
    {
        $amount = $this->normalizeNumericValue($args[0] ?? null);
        if ($amount === null) {
            return 'usage: filter_trade amount 88 [EUR]';
        }

        $rule = [
            'type' => 'amount',
            'value' => $amount,
        ];

        $fiatCode = strtoupper(preg_replace('/[^A-Za-z]/', '', (string)($args[1] ?? '')));
        if ($fiatCode !== '') {
            $rule['fiat_code'] = $fiatCode;
        }

        $rules = $this->autoTakeFilters;
        $key = $this->autoTakeRuleKey($rule);
        foreach ($rules as $existing) {
            if ($this->autoTakeRuleKey($existing) === $key) {
                return 'filter_trade: rule already active | ' . $this->buildAutoTakeFiltersReply();
            }
        }

        $rules[] = $rule;
        $this->persistAutoTakeFilters($rules);
        $this->shouldReload = true;

        return 'filter_trade: added ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
    }

    /**
     * @param string[] $args
     */
    private function removeAmountAutoTakeFilter(array $args): string
    {
        $amount = $this->normalizeNumericValue($args[0] ?? null);
        if ($amount === null) {
            return 'usage: filter_trade remove amount 88 [EUR]';
        }

        $rule = [
            'type' => 'amount',
            'value' => $amount,
        ];

        $fiatCode = strtoupper(preg_replace('/[^A-Za-z]/', '', (string)($args[1] ?? '')));
        if ($fiatCode !== '') {
            $rule['fiat_code'] = $fiatCode;
        }

        $targetKey = $this->autoTakeRuleKey($rule);
        $before = count($this->autoTakeFilters);
        $rules = [];
        foreach ($this->autoTakeFilters as $existing) {
            if ($this->autoTakeRuleKey($existing) !== $targetKey) {
                $rules[] = $existing;
            }
        }

        if (count($rules) === $before) {
            return 'filter_trade: rule not found';
        }

        $this->persistAutoTakeFilters($rules);
        $this->shouldReload = true;

        return 'filter_trade: removed ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
    }

    /**
     * @param string[] $args
     */
    private function addDaysAutoTakeFilter(array $args): string
    {
        $raw = strtolower(trim((string)($args[0] ?? '')));
        if (in_array($raw, ['missing', 'none', 'null', 'nodays', 'no_days'], true)) {
            $rule = [
                'type' => 'days_missing',
                'value' => 'missing',
            ];

            $rules = $this->autoTakeFilters;
            $key = $this->autoTakeRuleKey($rule);
            foreach ($rules as $existing) {
                if ($this->autoTakeRuleKey($existing) === $key) {
                    return 'filter_trade: rule already active | ' . $this->buildAutoTakeFiltersReply();
                }
            }

            $rules[] = $rule;
            $this->persistAutoTakeFilters($rules);
            $this->shouldReload = true;

            return 'filter_trade: added ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
        }

        $days = $this->normalizeNonNegativeInt($args[0] ?? null);
        if ($days === null) {
            return 'usage: filter_trade days 0 | filter_trade days missing';
        }

        $rule = [
            'type' => 'days',
            'value' => (string)$days,
        ];

        $rules = $this->autoTakeFilters;
        $key = $this->autoTakeRuleKey($rule);
        foreach ($rules as $existing) {
            if ($this->autoTakeRuleKey($existing) === $key) {
                return 'filter_trade: rule already active | ' . $this->buildAutoTakeFiltersReply();
            }
        }

        $rules[] = $rule;
        $this->persistAutoTakeFilters($rules);
        $this->shouldReload = true;

        return 'filter_trade: added ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
    }

    /**
     * @param string[] $args
     */
    private function removeDaysAutoTakeFilter(array $args): string
    {
        $raw = strtolower(trim((string)($args[0] ?? '')));
        if (in_array($raw, ['missing', 'none', 'null', 'nodays', 'no_days'], true)) {
            $rule = [
                'type' => 'days_missing',
                'value' => 'missing',
            ];

            $targetKey = $this->autoTakeRuleKey($rule);
            $before = count($this->autoTakeFilters);
            $rules = [];
            foreach ($this->autoTakeFilters as $existing) {
                if ($this->autoTakeRuleKey($existing) !== $targetKey) {
                    $rules[] = $existing;
                }
            }

            if (count($rules) === $before) {
                return 'filter_trade: rule not found';
            }

            $this->persistAutoTakeFilters($rules);
            $this->shouldReload = true;

            return 'filter_trade: removed ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
        }

        $days = $this->normalizeNonNegativeInt($args[0] ?? null);
        if ($days === null) {
            return 'usage: filter_trade remove days 0 | filter_trade remove days missing';
        }

        $rule = [
            'type' => 'days',
            'value' => (string)$days,
        ];

        $targetKey = $this->autoTakeRuleKey($rule);
        $before = count($this->autoTakeFilters);
        $rules = [];
        foreach ($this->autoTakeFilters as $existing) {
            if ($this->autoTakeRuleKey($existing) !== $targetKey) {
                $rules[] = $existing;
            }
        }

        if (count($rules) === $before) {
            return 'filter_trade: rule not found';
        }

        $this->persistAutoTakeFilters($rules);
        $this->shouldReload = true;

        return 'filter_trade: removed ' . $this->formatAutoTakeRule($rule) . ' | reloading relay session';
    }

    /**
     * @param array<int,array<string,mixed>> $rules
     */
    private function persistAutoTakeFilters(array $rules): void
    {
        $cfgKey = 'modules.noxtr.monitor_take_filters';
        $rules = array_values($rules);
        $json = $rules === []
            ? ''
            : json_encode($rules, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if (!is_string($json)) {
            $json = '';
        }

        NoxtrStore::setCfgValue(
            $cfgKey,
            $json,
            'JSON rules for ephemeral Mostro auto-take filters handled by server_monitor',
            1
        );
        CFG::$vars['modules']['noxtr']['monitor_take_filters'] = $json;
        $this->autoTakeFilters = $rules;
    }

    /**
     * @param array<string,mixed> $rule
     */
    private function autoTakeRuleKey(array $rule): string
    {
        return strtolower(trim((string)($rule['type'] ?? '')))
            . '|'
            . trim((string)($rule['value'] ?? ''))
            . '|'
            . strtoupper(trim((string)($rule['fiat_code'] ?? '')));
    }

    /**
     * @param array<string,mixed> $rule
     */
    private function formatAutoTakeRule(array $rule): string
    {
        $type = strtolower(trim((string)($rule['type'] ?? '')));
        if ($type === 'days_missing') {
            return 'days=missing';
        }

        $label = $type . '=' . trim((string)($rule['value'] ?? '?'));
        $fiatCode = strtoupper(trim((string)($rule['fiat_code'] ?? '')));
        if ($type === 'amount' && $fiatCode !== '') {
            $label .= ' ' . $fiatCode;
        }
        return $label;
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
        $monitorNote = '<p><small>Este correo de prueba ha sido enviado por el monitor Mostro del servidor de noxtr.</small></p>';
        $html = "<p><strong>Prueba de envio de email del monitor Mostro.</strong></p>"
            . "<p>Destinatario: <strong>" . htmlspecialchars($to, ENT_QUOTES, 'UTF-8') . "</strong></p>"
            . "<p>Hora del servidor: <strong>" . date('Y-m-d H:i:s') . "</strong></p>"
            . "<p>Trades monitorizados ahora mismo: <strong>" . count($this->tradeIndex) . "</strong></p>"
            . ($npub !== '' ? "<p>npub del monitor: <code>" . htmlspecialchars($npub, ENT_QUOTES, 'UTF-8') . "</code></p>" : '')
            . $monitorNote;

        return ['Monitor Mostro: prueba de email', $html];
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

        $name = trim((string)($cfg['monitor_profile_name'] ?? 'MostroMonitor'));
        if ($name === '') {
            $name = 'MostroMonitor';
        }

        $about = trim((string)($cfg['monitor_profile_about'] ?? ''));
        if ($about === '') {
            $about = 'Monitor automatico de Mostro / noxtr. Envia avisos y admite control por DM de admins autorizados.';
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
            echo '[control] reply ' . ($sent ? 'sent' : 'failed') . ' -> ' . substr($recipientPubkey, 0, 12) . "\n";
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
        if ($this->dataSource->wasNotificationSent($trade->orderId, $type)) {
            return;
        }

        $email = $this->dataSource->findUserEmail($trade->userId);
        if ($email === null || $email === '') {
            return;
        }

        [$subject, $html] = $this->buildEmail($trade, $type);
        if ($this->notifier->sendEmail($email, $subject, $html)) {
            $this->dataSource->markNotificationSent($trade->orderId, $type, $eventId);
        }
    }

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
        $monitorNote = '<p><small>Este aviso automático ha sido enviado por el monitor Mostro del servidor de noxtr. Puede llegar aunque no tengas la web abierta.</small></p>';

        // PHP 8.4 migration: este switch puede volver a ser un match.
        switch ($type) {
            case 'order_taken':
                return [
                    'Monitor Mostro: han tomado tu orden',
                    "<p><strong>Aviso automático del monitor Mostro.</strong></p>"
                    . "<p>Han tomado tu orden <strong>#{$shortId}</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para revisar el trade y seguir el siguiente paso del proceso.</p>"
                    . $monitorNote,
                ];

            case 'pay_invoice':
                return [
                    'Monitor Mostro: debes pagar la hold invoice',
                    "<p><strong>Aviso automático del monitor Mostro.</strong></p>"
                    . "<p>Tu trade <strong>#{$shortId}</strong> requiere pagar una <strong>hold invoice</strong>.</p>"
                    . "<p>Qué hacer ahora: entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>, abre el trade y paga la invoice para que la operación pueda continuar.</p>"
                    . $monitorNote,
                ];

            case 'fiat_sent':
                return [
                    'Monitor Mostro: el comprador ha enviado el fiat',
                    "<p><strong>Aviso automático del monitor Mostro.</strong></p>"
                    . "<p>En el trade <strong>#{$shortId}</strong> el comprador ha marcado el fiat como enviado.</p>"
                    . "<p>Qué hacer ahora: comprueba que has recibido el pago y, si todo está correcto, entra en <a href=\"{$tradesUrl}\">{$tradesUrl}</a> para liberar los sats.</p>"
                    . $monitorNote,
                ];

            case 'trade_completed':
                return [
                    'Monitor Mostro: trade completado',
                    "<p><strong>Aviso automático del monitor Mostro.</strong></p>"
                    . "<p>El trade <strong>#{$shortId}</strong> se ha completado correctamente.</p>"
                    . "<p>Si quieres revisarlo o archivarlo, lo tienes disponible en <a href=\"{$tradesUrl}\">{$tradesUrl}</a>.</p>"
                    . $monitorNote,
                ];
        }

        return ['Monitor Mostro', '<p>Aviso automático del monitor Mostro.</p>' . $monitorNote];
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
        $dataSource = new FrameworkDbDataSource([]);
    } else {
        throw new InvalidArgumentException('Unknown source: ' . $options->source);
    }

    $emailEnabled = in_array(
        strtolower(trim((string)(CFG::$vars['modules']['noxtr']['trade_notification_email'] ?? ''))),
        ['1', 'true', 'yes', 'on'],
        true
    );

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
