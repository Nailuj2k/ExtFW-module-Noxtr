<?php
/**
 * NoxtrStore - Data persistence for Noxtr client
 * Tables: NSTR_CONTACTS, NSTR_TOPICS, NSTR_BOOKMARKS, NSTR_MOSTRO_TRADES
 * Compatible with MySQL and SQLite
 */
class NoxtrStore extends DbConnection {

    private static function isSQLite() {
        return CFG::$vars['db']['type'] === 'sqlite';
    }

    private static function tableHasColumn($table, $column) {
        if (self::isSQLite()) {
            $cols = self::sqlQuery("PRAGMA table_info($table)") ?: [];
            foreach ($cols as $col) {
                if (($col['name'] ?? '') === $column) return true;
            }
            return false;
        }
        $rows = self::sqlQueryPrepared("SHOW COLUMNS FROM $table LIKE ?", [$column]) ?: [];
        return !empty($rows);
    }

    static function ensureTables() {
        if (self::isSQLite()) {

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_CONTACTS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                pubkey TEXT NOT NULL,
                petname TEXT DEFAULT '',
                relay_url TEXT DEFAULT '',
                active INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, pubkey)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_TOPICS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, topic)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_BOOKMARKS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                event_id TEXT NOT NULL,
                event_pubkey TEXT NOT NULL,
                event_content TEXT,
                event_kind INTEGER NOT NULL DEFAULT 1,
                event_tags TEXT,
                event_created_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, event_id)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MESSAGES (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                event_id TEXT NOT NULL,
                peer_pubkey TEXT NOT NULL,
                sender_pubkey TEXT NOT NULL,
                content_encrypted TEXT NOT NULL,
                event_created_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, event_id)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_RELAYS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                active INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, url)
            )");

            // Seed default relays for current user if none exist
            $uid = (int)($_SESSION['userid'] ?? 0);
            if ($uid) {
                $existing = self::sqlQueryPrepared("SELECT id FROM NSTR_RELAYS WHERE user_id = ? LIMIT 1", [$uid]);
                if (!$existing) {
                    $now = time();
                    $defaults = ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band','wss://relay.primal.net','wss://relay.snort.social','wss://purplepag.es','wss://relay.noswhere.com','wss://relay.mostro.network'];
                    foreach ($defaults as $url) {
                        self::sqlQueryPrepared("INSERT OR IGNORE INTO NSTR_RELAYS (user_id, url, created_at) VALUES (?, ?, ?)", [$uid, $url, $now]);
                    }
                }
            }

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MUTED (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                pubkey TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(user_id, pubkey)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_CHANNELS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channel_id TEXT NOT NULL,
                name TEXT DEFAULT '',
                about TEXT DEFAULT '',
                picture TEXT DEFAULT '',
                creator_pubkey TEXT DEFAULT '',
                relay_url TEXT DEFAULT '',
                pinned INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, channel_id)
            )");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MOSTRO_TRADES (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                order_id TEXT NOT NULL,
                request_id INTEGER DEFAULT 0,
                robot_pubkey TEXT NOT NULL DEFAULT '',
                trade_kind TEXT NOT NULL DEFAULT 'buy',
                trade_role TEXT NOT NULL DEFAULT 'created',
                trade_privkey TEXT NOT NULL DEFAULT '',
                trade_action TEXT DEFAULT '',
                status TEXT DEFAULT 'in-progress',
                internal_status TEXT NOT NULL DEFAULT 'creado',
                is_seller INTEGER DEFAULT 0,
                fiat_amount TEXT DEFAULT '',
                fiat_code TEXT DEFAULT '',
                sat_amount INTEGER DEFAULT 0,
                payment_method TEXT DEFAULT '',
                identity_fingerprint TEXT DEFAULT '',
                trade_key_pub TEXT DEFAULT '',
                trade_index INTEGER DEFAULT 0,
                peer_pubkey TEXT DEFAULT '',
                trade_json TEXT DEFAULT NULL,
                my_rating INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, order_id)
            )");

            // Indexes for SQLite
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_contacts_user ON NSTR_CONTACTS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_topics_user ON NSTR_TOPICS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_bookmarks_user ON NSTR_BOOKMARKS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_messages_user ON NSTR_MESSAGES(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_messages_peer ON NSTR_MESSAGES(user_id, peer_pubkey)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_relays_user ON NSTR_RELAYS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_muted_user ON NSTR_MUTED(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_channels_user ON NSTR_CHANNELS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_mostro_trades_user ON NSTR_MOSTRO_TRADES(user_id)");

        } else {

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_CONTACTS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                pubkey VARCHAR(64) NOT NULL,
                petname VARCHAR(255) DEFAULT '',
                relay_url VARCHAR(512) DEFAULT '',
                active TINYINT(1) DEFAULT 1,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_contact (user_id, pubkey),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_TOPICS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                topic VARCHAR(100) NOT NULL,
                active TINYINT(1) DEFAULT 1,
                sort_order INT DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_topic (user_id, topic),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_BOOKMARKS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                event_id VARCHAR(64) NOT NULL,
                event_pubkey VARCHAR(64) NOT NULL,
                event_content TEXT,
                event_kind INT NOT NULL DEFAULT 1,
                event_tags TEXT,                
                event_created_at INT NOT NULL DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_bookmark (user_id, event_id),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MESSAGES (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                event_id VARCHAR(64) NOT NULL,
                peer_pubkey VARCHAR(64) NOT NULL,
                sender_pubkey VARCHAR(64) NOT NULL,
                content_encrypted TEXT NOT NULL,
                event_created_at INT NOT NULL DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_message (user_id, event_id),
                KEY idx_user (user_id),
                KEY idx_peer (user_id, peer_pubkey)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_RELAYS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                url VARCHAR(512) NOT NULL,
                active TINYINT(1) DEFAULT 1,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_relay (user_id, url),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MUTED (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                pubkey VARCHAR(64) NOT NULL,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_muted (user_id, pubkey),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_CHANNELS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                channel_id VARCHAR(64) NOT NULL,
                name VARCHAR(255) DEFAULT '',
                about TEXT DEFAULT '',
                picture VARCHAR(512) DEFAULT '',
                creator_pubkey VARCHAR(64) DEFAULT '',
                relay_url VARCHAR(512) DEFAULT '',
                pinned TINYINT(1) DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_channel (user_id, channel_id),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_MOSTRO_TRADES (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                order_id VARCHAR(64) NOT NULL,
                request_id INT DEFAULT 0,
                robot_pubkey VARCHAR(64) NOT NULL DEFAULT '',
                trade_kind VARCHAR(10) NOT NULL DEFAULT 'buy',
                trade_role VARCHAR(10) NOT NULL DEFAULT 'created',
                trade_privkey VARCHAR(64) NOT NULL DEFAULT '',
                trade_action VARCHAR(32) DEFAULT '',
                status VARCHAR(32) DEFAULT 'in-progress',
                internal_status VARCHAR(32) NOT NULL DEFAULT 'creado',
                is_seller TINYINT(1) DEFAULT 0,
                fiat_amount VARCHAR(20) DEFAULT '',
                fiat_code VARCHAR(10) DEFAULT '',
                sat_amount BIGINT DEFAULT 0,
                payment_method VARCHAR(255) DEFAULT '',
                identity_fingerprint VARCHAR(128) DEFAULT '',
                trade_key_pub VARCHAR(64) DEFAULT '',
                trade_index INT DEFAULT 0,
                peer_pubkey VARCHAR(64) DEFAULT '',
                trade_json MEDIUMTEXT DEFAULT NULL,
                my_rating TINYINT DEFAULT 0,
                archived TINYINT(1) DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                updated_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_trade (user_id, order_id),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");

            // Seed default relays for current user if none exist
            $uid = (int)($_SESSION['userid'] ?? 0);
            if ($uid) {
                $existing = self::sqlQueryPrepared("SELECT id FROM NSTR_RELAYS WHERE user_id = ? LIMIT 1", [$uid]);
                if (!$existing) {
                    $now = time();
                    $defaults = ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band','wss://relay.primal.net','wss://relay.snort.social','wss://purplepag.es','wss://relay.noswhere.com','wss://relay.mostro.network'];
                    foreach ($defaults as $url) {
                        self::sqlQueryPrepared("INSERT IGNORE INTO NSTR_RELAYS (user_id, url, created_at) VALUES (?, ?, ?)", [$uid, $url, $now]);
                    }
                }
            }
        }

        // v4 migration: add event_kind and event_tags to NSTR_BOOKMARKS if missing
        if (self::isSQLite()) {
            $cols = self::sqlQuery("PRAGMA table_info(NSTR_BOOKMARKS)") ?: [];
            $colNames = array_column($cols, 'name');
            if (!in_array('event_kind', $colNames)) {
                self::sqlExec("ALTER TABLE NSTR_BOOKMARKS ADD COLUMN event_kind INTEGER NOT NULL DEFAULT 1");
            }
            if (!in_array('event_tags', $colNames)) {
                self::sqlExec("ALTER TABLE NSTR_BOOKMARKS ADD COLUMN event_tags TEXT");
            }
        }

        // v6 migration: add relay.mostro.network to existing users' relay list
        $uid = (int)($_SESSION['userid'] ?? 0);
        if ($uid && (!isset($_SESSION['noxtr_tables_v']) || $_SESSION['noxtr_tables_v'] < 6)) {
            $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
            $insertSql = self::isSQLite()
                ? "INSERT OR IGNORE INTO NSTR_RELAYS (user_id, url, created_at) VALUES (?, ?, ?)"
                : "INSERT IGNORE INTO NSTR_RELAYS (user_id, url, created_at) VALUES (?, ?, ?)";
            self::sqlQueryPrepared($insertSql, [$uid, 'wss://relay.mostro.network', time()]);
        }

        $mostroTradeCols = [
            'request_id' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN request_id INTEGER DEFAULT 0" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN request_id INT DEFAULT 0",
            'identity_fingerprint' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN identity_fingerprint TEXT DEFAULT ''" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN identity_fingerprint VARCHAR(128) DEFAULT ''",
            'trade_key_pub' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_key_pub TEXT DEFAULT ''" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_key_pub VARCHAR(64) DEFAULT ''",
            'trade_index' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_index INTEGER DEFAULT 0" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_index INT DEFAULT 0",
            'peer_pubkey' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN peer_pubkey TEXT DEFAULT ''" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN peer_pubkey VARCHAR(64) DEFAULT ''",
            // UI-only flag: hidden from "Mis trades" but preserved in DB and in /mostro/trades.
            'archived' => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN archived INTEGER DEFAULT 0" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN archived TINYINT(1) DEFAULT 0",
        ];
        foreach ($mostroTradeCols as $colName => $sql) {
            if (!self::tableHasColumn('NSTR_MOSTRO_TRADES', $colName)) self::sqlExec($sql);
        }

        // Backward compatibility for the first archive implementation that used
        // internal_status='archivado' directly instead of a dedicated column.
        if (self::tableHasColumn('NSTR_MOSTRO_TRADES', 'archived')) {
            self::sqlQueryPrepared(
                "UPDATE NSTR_MOSTRO_TRADES SET archived = 1 WHERE LOWER(COALESCE(internal_status, '')) = 'archivado'",
                []
            );
        }

        // Keep this aditive even for fresh recreations after a DROP TABLE.
        $newTradeCols = [
            'trade_role'       => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_role TEXT NOT NULL DEFAULT 'created'"    : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_role VARCHAR(10) NOT NULL DEFAULT 'created'",
            'trade_privkey'    => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_privkey TEXT NOT NULL DEFAULT ''"         : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN trade_privkey VARCHAR(64) NOT NULL DEFAULT ''",
            'internal_status'  => self::isSQLite() ? "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN internal_status TEXT NOT NULL DEFAULT 'creado'" : "ALTER TABLE NSTR_MOSTRO_TRADES ADD COLUMN internal_status VARCHAR(32) NOT NULL DEFAULT 'creado'",
        ];
        foreach ($newTradeCols as $col => $sql) {
            if (!self::tableHasColumn('NSTR_MOSTRO_TRADES', $col)) self::sqlExec($sql);
        }

        $_SESSION['noxtr_tables_v'] = 10;
    }

    // ---- MOSTRO TRADES ----

    static function saveTrade($userId, $orderId, $robotPubkey, $tradeKind, $tradeAction, $status,
                               $isSeller, $fiatAmount, $fiatCode, $satAmount, $paymentMethod, $tradeJson,
                               $requestId = 0, $identityFingerprint = '', $tradeKeyPub = '', $tradeIndex = 0, $peerPubkey = '') {
        $now = time();

        // Máquina de estados: el status solo puede avanzar, nunca retroceder.
        // Usamos rangos explícitos, alineados con el frontend Mostro.
        static $stateRank = [
            'sending' => 5,
            'new-order' => 10,
            'order-published' => 10,
            'order' => 10,
            'pay-invoice' => 20,
            'waiting-seller-to-pay' => 20,
            'waiting-buyer-invoice' => 30,
            'add-invoice' => 30,
            'hold-invoice-payment-accepted' => 40,
            'active' => 40,
            'buyer-took-order' => 40,
            'invoice-updated' => 45,
            'fiat-sent' => 50,
            'fiat-sent-ok' => 50,
            'releasing' => 60,
            'released' => 65,
            'hold-invoice-payment-settled' => 70,
            'purchase-completed' => 70,
            'completed' => 70,
            'rate' => 70,
            'success' => 70,
            'canceled' => 70,
            'cancel' => 70,
            'cooperative-cancel-accepted' => 70,
            'dispute' => 70,
            'done' => 80
        ];
        $existing = self::sqlQueryPrepared(
            "SELECT status FROM NSTR_MOSTRO_TRADES WHERE user_id = ? AND order_id = ?",
            [(int)$userId, $orderId]
        );
        if (!empty($existing)) {
            $curStatus = $existing[0]['status'] ?? '';
            $curRank = $stateRank[$curStatus] ?? 0;
            $newRank = $stateRank[$status] ?? 0;
            if ($curRank > 0 && $newRank > 0 && $newRank < $curRank) {
                $status = $curStatus; // ignorar retroceso
            }
        }

        if (self::isSQLite()) {
            return self::sqlQueryPrepared(
                "INSERT INTO NSTR_MOSTRO_TRADES
                    (user_id, order_id, request_id, robot_pubkey, trade_kind, trade_action, status, is_seller,
                     fiat_amount, fiat_code, sat_amount, payment_method, identity_fingerprint, trade_key_pub, trade_index, peer_pubkey, trade_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, order_id) DO UPDATE SET
                    request_id = excluded.request_id,
                    robot_pubkey = excluded.robot_pubkey,
                    trade_kind = excluded.trade_kind,
                    trade_action = excluded.trade_action,
                    status = excluded.status,
                    is_seller = excluded.is_seller,
                    fiat_amount = excluded.fiat_amount,
                    fiat_code = excluded.fiat_code,
                    sat_amount = excluded.sat_amount,
                    payment_method = excluded.payment_method,
                    identity_fingerprint = excluded.identity_fingerprint,
                    trade_key_pub = excluded.trade_key_pub,
                    trade_index = excluded.trade_index,
                    peer_pubkey = excluded.peer_pubkey,
                    trade_json = excluded.trade_json,
                    updated_at = excluded.updated_at",
                [(int)$userId, $orderId, (int)$requestId, $robotPubkey, $tradeKind, $tradeAction, $status,
                 (int)$isSeller, $fiatAmount, $fiatCode, (int)$satAmount, $paymentMethod,
                 $identityFingerprint, $tradeKeyPub, (int)$tradeIndex, $peerPubkey, $tradeJson, $now, $now]
            );
        }
        return self::sqlQueryPrepared(
            "INSERT INTO NSTR_MOSTRO_TRADES
                (user_id, order_id, request_id, robot_pubkey, trade_kind, trade_action, status, is_seller,
                 fiat_amount, fiat_code, sat_amount, payment_method, identity_fingerprint, trade_key_pub, trade_index, peer_pubkey, trade_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                request_id = VALUES(request_id),
                robot_pubkey = VALUES(robot_pubkey),
                trade_kind = VALUES(trade_kind),
                trade_action = VALUES(trade_action),
                status = VALUES(status),
                is_seller = VALUES(is_seller),
                fiat_amount = VALUES(fiat_amount),
                fiat_code = VALUES(fiat_code),
                sat_amount = VALUES(sat_amount),
                payment_method = VALUES(payment_method),
                identity_fingerprint = VALUES(identity_fingerprint),
                trade_key_pub = VALUES(trade_key_pub),
                trade_index = VALUES(trade_index),
                peer_pubkey = VALUES(peer_pubkey),
                trade_json = VALUES(trade_json),
                updated_at = VALUES(updated_at)",
            [(int)$userId, $orderId, (int)$requestId, $robotPubkey, $tradeKind, $tradeAction, $status,
             (int)$isSeller, $fiatAmount, $fiatCode, (int)$satAmount, $paymentMethod,
             $identityFingerprint, $tradeKeyPub, (int)$tradeIndex, $peerPubkey, $tradeJson, $now, $now]
        );
    }

    static private function normalizeMostroTradeStatus($status) {
        $raw = strtolower(trim((string)$status));
        $valid = [
            'creado', 'enviando', 'publicado', 'esperando_hold_invoice', 'cancelando', 'tomado', 'esperando_pago_vendedor', 'cancelacion_solicitada',
            'activo', 'fiat_enviado', 'liberando', 'completado', 'cancelado', 'disputado', 'archivado',
        ];
        $aliases = [
            'new-order' => 'publicado',
            'new_order' => 'publicado',
            'order' => 'publicado',
            'order-published' => 'publicado',
            'order_published' => 'publicado',
            'buyer-took-order' => 'activo',
            'buyer_took_order' => 'activo',
            'pay-invoice' => 'tomado',
            'pay_invoice' => 'tomado',
            'waiting-seller-to-pay' => 'tomado',
            'waiting_seller_to_pay' => 'tomado',
            'add-invoice' => 'tomado',
            'add_invoice' => 'tomado',
            'waiting-buyer-invoice' => 'activo',
            'waiting_buyer_invoice' => 'activo',
            'hold-invoice-payment-accepted' => 'activo',
            'hold_invoice_payment_accepted' => 'activo',
            'active' => 'activo',
            'fiat-sent' => 'fiat_enviado',
            'fiat_sent' => 'fiat_enviado',
            'fiat-sent-ok' => 'fiat_enviado',
            'fiat_sent_ok' => 'fiat_enviado',
            'releasing' => 'fiat_enviado',
            'release' => 'liberando',
            'success' => 'completado',
            'hold-invoice-payment-settled' => 'completado',
            'hold_invoice_payment_settled' => 'completado',
            'purchase-completed' => 'completado',
            'purchase_completed' => 'completado',
            'completed' => 'completado',
            'canceled' => 'cancelado',
            'cancelled' => 'cancelado',
            'hold-invoice-payment-canceled' => 'cancelado',
            'hold_invoice_payment_canceled' => 'cancelado',
            'hold-invoice-payment-cancelled' => 'cancelado',
            'hold_invoice_payment_cancelled' => 'cancelado',
            'cancel' => 'cancelacion_solicitada',
            'dispute' => 'disputado',
            'dispute-initiated-by-peer' => 'disputado',
            'dispute_initiated_by_peer' => 'disputado',
        ];
        if ($raw === '') return 'creado';
        if (isset($aliases[$raw])) return $aliases[$raw];
        $clean = str_replace(['-', ' '], '_', $raw);
        $clean = preg_replace('/[^a-z_]/', '', $clean);
        if ($clean === '') return 'creado';
        if (in_array($clean, $valid, true)) return $clean;
        if (isset($aliases[$clean])) return $aliases[$clean];
        foreach ($valid as $candidate) {
            if (strpos($clean, $candidate) !== false) return $candidate;
        }
        return $clean;
    }

    static private function normalizeMostroTradeRole($role) {
        $role = strtolower(trim((string)$role));
        if ($role === 'taken' || strpos($role, 'take') !== false) return 'taken';
        return 'created';
    }

    static private function normalizeMostroTradeKind($kind) {
        $kind = strtolower(trim((string)$kind));
        return $kind === 'buy' ? 'buy' : 'sell';
    }

    static private function mostroTradeStatusRank($status) {
        static $rank = [
            'creado' => 0,
            'enviando' => 1,
            'publicado' => 2,
            'esperando_hold_invoice' => 3,
            'cancelando' => 4,
            'tomado' => 5,
            'esperando_pago_vendedor' => 6,
            'cancelacion_solicitada' => 7,
            'activo' => 8,
            'fiat_enviado' => 9,
            'liberando' => 10,
            'completado' => 11,
            'cancelado' => 12,
            'disputado' => 13,
            // `archivado` is a local UI-only state: the row stays in the DB and in /mostro/trades,
            // but it no longer appears in "Mis trades".
            'archivado' => 99,
        ];
        return $rank[$status] ?? -1;
    }

    static private function normalizeMostroTradeRow(array $row) {
        $row['trade_kind'] = self::normalizeMostroTradeKind($row['trade_kind'] ?? '');
        $row['trade_role'] = self::normalizeMostroTradeRole($row['trade_role'] ?? '');
        $rawStatus = str_replace('_', '-', strtolower(trim((string)($row['status'] ?? ''))));
        $rawAction = str_replace('_', '-', strtolower(trim((string)($row['trade_action'] ?? ''))));
        $rawInternalStatus = strtolower(trim((string)($row['internal_status'] ?? '')));
        $isArchived = (int)($row['archived'] ?? 0) === 1 || $rawInternalStatus === 'archivado';
        $isCreatedSellMaker = $row['trade_role'] === 'created' && $row['trade_kind'] === 'sell' && (int)($row['is_seller'] ?? 0) === 1;
        $isTakenSellBuyer = $row['trade_role'] === 'taken' && $row['trade_kind'] === 'sell' && (int)($row['is_seller'] ?? 0) === 0;
        $hasPeerPubkey = trim((string)($row['peer_pubkey'] ?? '')) !== '';
        $buyerTookOrderSeen = ($rawStatus === 'buyer-took-order' || $rawAction === 'buyer-took-order');
        $waitingBuyerInvoiceSeen = ($rawStatus === 'waiting-buyer-invoice' || $rawAction === 'waiting-buyer-invoice');
        $waitingSellerToPaySeen = ($rawStatus === 'waiting-seller-to-pay' || $rawAction === 'waiting-seller-to-pay');
        // If an old row was archived through internal_status='archivado', recover the real
        // trade state from status/trade_action and keep archive as a separate UI flag.
        $internalSource = $rawInternalStatus === 'archivado'
            ? (($row['status'] ?? '') !== '' ? ($row['status'] ?? '') : (($row['trade_action'] ?? '') !== '' ? ($row['trade_action'] ?? '') : 'cancelado'))
            : ($row['internal_status'] ?? '');
        $normalizedInternal = self::normalizeMostroTradeStatus($internalSource);
        $normalizedStatus = self::normalizeMostroTradeStatus($row['status'] ?? '');
        $normalizedAction = self::normalizeMostroTradeStatus($row['trade_action'] ?? '');
        // Flow 4 fix from NOTES.md:
        // for a sell offer created locally, `buyer-took-order` / `waiting-buyer-invoice` still
        // mean "waiting for the robot's hold invoice", not "trade already active".
        if ($isCreatedSellMaker && ($buyerTookOrderSeen || $waitingBuyerInvoiceSeen) && !$hasPeerPubkey) {
            if (in_array($normalizedInternal, ['creado', 'enviando', 'publicado'], true)) {
                $normalizedInternal = 'esperando_hold_invoice';
            }
            if ($normalizedStatus === 'activo') $normalizedStatus = 'esperando_hold_invoice';
            if ($normalizedAction === 'activo') $normalizedAction = 'esperando_hold_invoice';
        }
        // Buyer side of a sell order: after sending the LN invoice and while waiting for the
        // seller to pay the hold invoice, the trade is not active yet.
        if ($isTakenSellBuyer && $waitingSellerToPaySeen) {
            if (in_array($normalizedInternal, ['tomado'], true)) {
                $normalizedInternal = 'esperando_pago_vendedor';
            }
            if ($normalizedStatus === 'tomado') $normalizedStatus = 'esperando_pago_vendedor';
            if ($normalizedAction === 'tomado') $normalizedAction = 'esperando_pago_vendedor';
        }
        $row['internal_status'] = $normalizedInternal;
        if (self::mostroTradeStatusRank($normalizedStatus) > self::mostroTradeStatusRank($row['internal_status'])) {
            $row['internal_status'] = $normalizedStatus;
        }
        if (self::mostroTradeStatusRank($normalizedAction) > self::mostroTradeStatusRank($row['internal_status'])) {
            $row['internal_status'] = $normalizedAction;
        }
        $status = strtolower(trim((string)($row['status'] ?? '')));
        if ($status === '' || $status === 'in-progress') {
            $row['status'] = $row['internal_status'];
        }
        $row['archived'] = $isArchived ? 1 : 0;
        return $row;
    }

    static function loadTrades($userId, $limit = 200) {
        $limit = max(1, (int)$limit);
        $rows = self::sqlQueryPrepared(
            "SELECT order_id, request_id, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_action,
                    status, internal_status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                    trade_key_pub, trade_index, peer_pubkey, trade_json, my_rating, archived, created_at, updated_at
             FROM NSTR_MOSTRO_TRADES WHERE user_id = ?
             ORDER BY CASE
                        WHEN COALESCE(archived, 0) = 1 THEN 2
                        WHEN LOWER(COALESCE(internal_status, '')) IN ('cancelado', 'completado', 'disputado') THEN 1
                        ELSE 0
                      END ASC,
                      updated_at DESC
             LIMIT $limit",
            [(int)$userId]
        ) ?: [];
        foreach ($rows as $idx => $row) {
            $rows[$idx] = self::normalizeMostroTradeRow($row);
        }
        return $rows;
    }

    // Simple insert for new trades (no state machine — fresh rows only)
    static function addTrade($userId, array $d) {
        $now = time();
        $cols = '(user_id, order_id, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_key_pub,
                  trade_index, internal_status, status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                  trade_json, archived, created_at, updated_at)';
        $vals = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
        $p = [
            (int)$userId,
            $d['order_id'] ?? ('tmp-'.uniqid('',true)),
            $d['robot_pubkey'] ?? '',
            $d['trade_kind'] ?? 'sell',
            $d['trade_role'] ?? 'created',
            $d['trade_privkey'] ?? '',
            $d['trade_key_pub'] ?? '',
            (int)($d['trade_index'] ?? 0),
            $d['internal_status'] ?? 'creado',
            $d['status'] ?? 'creado',
            (int)($d['is_seller'] ?? 0),
            $d['fiat_amount'] ?? '',
            $d['fiat_code'] ?? '',
            (int)($d['sat_amount'] ?? 0),
            $d['payment_method'] ?? '',
            $d['trade_json'] ?? null,
            (int)($d['archived'] ?? 0),
            $now, $now,
        ];
        if (self::isSQLite()) {
            self::sqlQueryPrepared("INSERT OR IGNORE INTO NSTR_MOSTRO_TRADES $cols VALUES $vals", $p);
            $row = self::sqlQuery("SELECT last_insert_rowid() AS lid");
            return $row[0]['lid'] ?? 0;
        }
        self::sqlQueryPrepared("INSERT IGNORE INTO NSTR_MOSTRO_TRADES $cols VALUES $vals", $p);
        $row = self::sqlQuery("SELECT LAST_INSERT_ID() AS lid");
        return $row[0]['lid'] ?? 0;
    }

    static function getTrade($userId, $orderId) {
        $rows = self::sqlQueryPrepared(
            "SELECT id, order_id, request_id, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_action,
                    status, internal_status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                    identity_fingerprint, trade_key_pub, trade_index, peer_pubkey, trade_json, my_rating, archived,
                    created_at, updated_at
             FROM NSTR_MOSTRO_TRADES
             WHERE user_id = ? AND order_id = ?
             LIMIT 1",
            [(int)$userId, $orderId]
        ) ?: [];
        if (!$rows) return null;
        return self::normalizeMostroTradeRow($rows[0]);
    }

    // Update arbitrary fields (JS manages state; no machine here)
    static function updateTrade($userId, $orderId, array $fields) {
        $allowed = ['order_id','request_id','robot_pubkey','trade_kind','trade_role','trade_privkey','trade_key_pub',
                    'trade_index','identity_fingerprint','internal_status','status','trade_action','is_seller',
                    'fiat_amount','fiat_code','sat_amount','payment_method','peer_pubkey','trade_json','my_rating','archived'];
        $set = []; $p = [];
        foreach ($fields as $k => $v) {
            if (in_array($k, $allowed, true)) { $set[] = "$k = ?"; $p[] = $v; }
        }
        if (!$set) return false;
        $set[] = 'updated_at = ?'; $p[] = time();
        $p[] = (int)$userId; $p[] = $orderId;
        return self::sqlQueryPrepared('UPDATE NSTR_MOSTRO_TRADES SET '.implode(', ',$set).' WHERE user_id = ? AND order_id = ?', $p);
    }

    static function sendEmail($subject, $message, $toEmail) {
        $toEmail = trim((string)$toEmail);
        if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) return false;
        return message_mail($subject, $message, false, $toEmail);
    }

    // Legacy helper kept for reference.
    // Web-request email sending is disabled in ajax.php; server_monitor.php is
    // now the only component that should send Mostro emails.
    // This logic may still be useful later to derive in-browser / desktop
    // notifications from frontend trade transitions.
    static function sendMostroTradeNotifications($existingTrade, array $fields, $userEmail) {
        if (!$existingTrade) return false;
        if (!self::mostroEmailEnabled()) return false;
        if (!filter_var(trim((string)$userEmail), FILTER_VALIDATE_EMAIL)) return false;

        $sent = false;
        if (self::mostroShouldSendTakenEmail($existingTrade, $fields)) {
            $sent = self::mostroSendTakenEmail($existingTrade, $fields, $userEmail) || $sent;
        }
        if (self::mostroShouldSendFiatSentEmail($existingTrade, $fields)) {
            $sent = self::mostroSendFiatSentEmail($existingTrade, $fields, $userEmail) || $sent;
        }
        return $sent;
    }

    static private function mostroEmailEnabled() {
        $value = CFG::$vars['modules']['noxtr']['trade_notification_email'] ?? false;
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
    }

    static private function mostroInferEmailStatus(array $fields) {
        $internal = strtolower(trim((string)($fields['internal_status'] ?? '')));
        if ($internal !== '') return $internal;

        $raw = strtolower(trim((string)($fields['trade_action'] ?? ($fields['status'] ?? ''))));
        $map = [
            'buyer-took-order' => 'esperando_hold_invoice',
            'waiting-seller-to-pay' => 'tomado',
            'pay-invoice' => 'tomado',
            'add-invoice' => 'tomado',
            'waiting-buyer-invoice' => 'activo',
            'hold-invoice-payment-accepted' => 'activo',
            'active' => 'activo',
            'fiat-sent' => 'fiat_enviado',
            'fiat-sent-ok' => 'fiat_enviado',
            'released' => 'liberando',
            'success' => 'completado',
            'hold-invoice-payment-settled' => 'completado',
            'purchase-completed' => 'completado',
        ];
        return $map[$raw] ?? '';
    }

    static private function mostroShouldSendTakenEmail($existingTrade, array $fields) {
        if (($existingTrade['trade_role'] ?? '') !== 'created') return false;

        $prev = strtolower(trim((string)($existingTrade['internal_status'] ?? '')));
        $next = self::mostroInferEmailStatus($fields);
        if ($next === '' || $next === $prev) return false;

        $publishedStates = ['creado', 'enviando', 'publicado'];
        $takenStates = ['esperando_hold_invoice', 'tomado', 'esperando_pago_vendedor', 'activo', 'fiat_enviado', 'liberando', 'completado'];
        if (!in_array($prev, $publishedStates, true)) return false;
        if (!in_array($next, $takenStates, true)) return false;

        $rawAction = strtolower(trim((string)($fields['trade_action'] ?? ($fields['status'] ?? ''))));
        if (in_array($rawAction, ['cancel', 'canceled', 'dispute', 'hold-invoice-payment-canceled'], true)) return false;

        return true;
    }

    static private function mostroShouldSendFiatSentEmail($existingTrade, array $fields) {
        if ((int)($fields['is_seller'] ?? $existingTrade['is_seller'] ?? 0) !== 1) return false;

        $prev = strtolower(trim((string)($existingTrade['internal_status'] ?? '')));
        $next = self::mostroInferEmailStatus($fields);
        if ($next !== 'fiat_enviado' || $prev === 'fiat_enviado') return false;
        if (!in_array($prev, ['creado', 'enviando', 'publicado', 'esperando_hold_invoice', 'tomado', 'esperando_pago_vendedor', 'activo'], true)) return false;

        $rawAction = strtolower(trim((string)($fields['trade_action'] ?? ($fields['status'] ?? ''))));
        if ($rawAction !== '' && !in_array($rawAction, ['fiat-sent', 'fiat-sent-ok'], true)) return false;

        return true;
    }

    static private function mostroSendTakenEmail($existingTrade, array $fields, $userEmail) {
        $tradeKind = strtolower(trim((string)($fields['trade_kind'] ?? ($existingTrade['trade_kind'] ?? ''))));
        $kindLabel = $tradeKind === 'buy' ? 'compra' : 'venta';
        $fiatAmount = trim((string)($fields['fiat_amount'] ?? ($existingTrade['fiat_amount'] ?? '')));
        $fiatCode = trim((string)($fields['fiat_code'] ?? ($existingTrade['fiat_code'] ?? '')));
        $paymentMethod = trim((string)($fields['payment_method'] ?? ($existingTrade['payment_method'] ?? '')));
        $orderId = trim((string)($existingTrade['order_id'] ?? ''));
        $tradesUrl = '/' . SCRIPT_DIR_MODULE . '/mostro/trades';

        $subject = 'Mostro: han tomado tu orden de ' . $kindLabel;
        $message = '<p>Han tomado tu orden de <strong>' . htmlspecialchars($kindLabel, ENT_QUOTES, 'UTF-8') . '</strong> en Mostro.</p>'
                 . '<p><strong>Orden:</strong> #' . htmlspecialchars(substr($orderId, 0, 8), ENT_QUOTES, 'UTF-8') . '</p>'
                 . ($fiatAmount !== '' || $fiatCode !== ''
                    ? '<p><strong>Importe:</strong> ' . htmlspecialchars(trim($fiatAmount . ' ' . $fiatCode), ENT_QUOTES, 'UTF-8') . '</p>'
                    : '')
                 . ($paymentMethod !== ''
                    ? '<p><strong>Método de pago:</strong> ' . htmlspecialchars($paymentMethod, ENT_QUOTES, 'UTF-8') . '</p>'
                    : '')
                 . '<p>Revisa el trade en <a href="' . htmlspecialchars($tradesUrl, ENT_QUOTES, 'UTF-8') . '">' . htmlspecialchars($tradesUrl, ENT_QUOTES, 'UTF-8') . '</a>.</p>';

        return self::sendEmail($subject, $message, $userEmail);
    }

    static private function mostroSendFiatSentEmail($existingTrade, array $fields, $userEmail) {
        $tradeKind = strtolower(trim((string)($fields['trade_kind'] ?? ($existingTrade['trade_kind'] ?? ''))));
        $kindLabel = $tradeKind === 'buy' ? 'compra' : 'venta';
        $fiatAmount = trim((string)($fields['fiat_amount'] ?? ($existingTrade['fiat_amount'] ?? '')));
        $fiatCode = trim((string)($fields['fiat_code'] ?? ($existingTrade['fiat_code'] ?? '')));
        $paymentMethod = trim((string)($fields['payment_method'] ?? ($existingTrade['payment_method'] ?? '')));
        $orderId = trim((string)($existingTrade['order_id'] ?? ''));
        $tradesUrl = '/' . SCRIPT_DIR_MODULE . '/mostro/trades';

        $subject = 'Mostro: el comprador ha enviado el fiat';
        $message = '<p>El comprador ya ha marcado el pago fiat como enviado en tu trade de <strong>' . htmlspecialchars($kindLabel, ENT_QUOTES, 'UTF-8') . '</strong>.</p>'
                 . '<p><strong>Orden:</strong> #' . htmlspecialchars(substr($orderId, 0, 8), ENT_QUOTES, 'UTF-8') . '</p>'
                 . ($fiatAmount !== '' || $fiatCode !== ''
                    ? '<p><strong>Importe:</strong> ' . htmlspecialchars(trim($fiatAmount . ' ' . $fiatCode), ENT_QUOTES, 'UTF-8') . '</p>'
                    : '')
                 . ($paymentMethod !== ''
                    ? '<p><strong>Método de pago:</strong> ' . htmlspecialchars($paymentMethod, ENT_QUOTES, 'UTF-8') . '</p>'
                    : '')
                 . '<p>Si has recibido el dinero, entra en <a href="' . htmlspecialchars($tradesUrl, ENT_QUOTES, 'UTF-8') . '">' . htmlspecialchars($tradesUrl, ENT_QUOTES, 'UTF-8') . '</a> para revisar el trade y liberar los sats.</p>';

        return self::sendEmail($subject, $message, $userEmail);
    }

    // Hard delete is reserved for the explicit user action "Eliminar de la lista".
    // Automatic flows must keep the row and update/reuse it instead of deleting it.
    static function deleteTrade($userId, $orderId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_MOSTRO_TRADES WHERE user_id = ? AND order_id = ?",
            [(int)$userId, $orderId]
        );
    }

    // ---- CONTACTS ----

    static function getContacts($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, pubkey, petname, relay_url, active FROM NSTR_CONTACTS WHERE user_id = ? ORDER BY petname, pubkey",
            [(int)$userId]
        ) ?: [];
    }

    static function addContact($userId, $pubkey, $petname = '', $relayUrl = '') {
        if (self::isSQLite()) {
            return self::sqlQueryPrepared(
                "INSERT INTO NSTR_CONTACTS (user_id, pubkey, petname, relay_url, created_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, pubkey) DO UPDATE SET petname = excluded.petname, relay_url = excluded.relay_url",
                [(int)$userId, $pubkey, $petname, $relayUrl, time()]
            );
        }
        return self::sqlQueryPrepared(
            "INSERT INTO NSTR_CONTACTS (user_id, pubkey, petname, relay_url, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE petname = VALUES(petname), relay_url = VALUES(relay_url)",
            [(int)$userId, $pubkey, $petname, $relayUrl, time()]
        );
    }

    static function removeContact($userId, $pubkey) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_CONTACTS WHERE user_id = ? AND pubkey = ?",
            [(int)$userId, $pubkey]
        );
    }

    static function toggleContact($userId, $pubkey) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_CONTACTS SET active = 1 - active WHERE user_id = ? AND pubkey = ?",
            [(int)$userId, $pubkey]
        );
    }

    static function setAllContactsActive($userId, $active) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_CONTACTS SET active = ? WHERE user_id = ?",
            [(int)$active, (int)$userId]
        );
    }

    // ---- TOPICS ----

    static function getTopics($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, topic, active FROM NSTR_TOPICS WHERE user_id = ? ORDER BY sort_order, topic",
            [(int)$userId]
        ) ?: [];
    }

    static function addTopic($userId, $topic) {
        $topic = strtolower(trim(ltrim($topic, '#')));
        $topic = preg_replace('/[\s<>"\';&]/', '', $topic);
        if (empty($topic) || strlen($topic) > 100) return false;
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_TOPICS (user_id, topic, created_at) VALUES (?, ?, ?)",
            [(int)$userId, $topic, time()]
        );
    }

    static function removeTopic($userId, $topicId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_TOPICS WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$topicId]
        );
    }

    static function toggleTopic($userId, $topicId) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_TOPICS SET active = 1 - active WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$topicId]
        );
    }

    // ---- BOOKMARKS ----

    static function getBookmarks($userId, $limit = 50, $offset = 0) {
        $limit = (int)$limit;
        $offset = (int)$offset;
        return self::sqlQueryPrepared(
            "SELECT event_id, event_pubkey, event_content, event_created_at, event_kind, event_tags FROM NSTR_BOOKMARKS WHERE user_id = ? ORDER BY created_at DESC LIMIT $limit OFFSET $offset",
            [(int)$userId]
        ) ?: [];
    }

    static function addBookmark($userId, $eventId, $eventPubkey, $eventContent, $eventCreatedAt, $eventKind = 1, $eventTags = null) {
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_BOOKMARKS (user_id, event_id, event_pubkey, event_content, event_created_at, event_kind, event_tags, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(int)$userId, $eventId, $eventPubkey, $eventContent, (int)$eventCreatedAt, (int)$eventKind, $eventTags, time()]
        );
    }

    static function removeBookmark($userId, $eventId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_BOOKMARKS WHERE user_id = ? AND event_id = ?",
            [(int)$userId, $eventId]
        );
    }

    // ---- MESSAGES (DMs) ----

    static private function getMonitorPubkeyForDmTtl() {
        $pubkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? self::getCfgValue('modules.noxtr.monitor_pubkey', '')));
        $pubkey = strtolower($pubkey);
        return preg_match('/^[0-9a-f]{64}$/', $pubkey) ? $pubkey : '';
    }

    static private function getMonitorDmTtlSeconds() {
        $hours = (int)(CFG::$vars['modules']['noxtr']['monitor_dm_ttl_hours'] ?? self::getCfgValue('modules.noxtr.monitor_dm_ttl_hours', '24'));
        return $hours > 0 ? $hours * 3600 : 0;
    }

    static private function isExpiredMonitorDm($peerPubkey, $eventCreatedAt) {
        $ttlSeconds = self::getMonitorDmTtlSeconds();
        if ($ttlSeconds <= 0) return false;

        $monitorPubkey = self::getMonitorPubkeyForDmTtl();
        if ($monitorPubkey === '') return false;

        $peerPubkey = strtolower(trim((string)$peerPubkey));
        $eventCreatedAt = (int)$eventCreatedAt;

        if ($peerPubkey !== $monitorPubkey || $eventCreatedAt <= 0) return false;

        return $eventCreatedAt < (time() - $ttlSeconds);
    }

    static function purgeExpiredMonitorMessages($userId) {
        $ttlSeconds = self::getMonitorDmTtlSeconds();
        $monitorPubkey = self::getMonitorPubkeyForDmTtl();
        if ($ttlSeconds <= 0 || $monitorPubkey === '') return false;

        $cutoff = time() - $ttlSeconds;
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_MESSAGES WHERE user_id = ? AND peer_pubkey = ? AND event_created_at > 0 AND event_created_at < ?",
            [(int)$userId, $monitorPubkey, $cutoff]
        );
    }

    static function getMessages($userId, $limit = 200) {
        $limit = (int)$limit;
        self::purgeExpiredMonitorMessages($userId);
        return self::sqlQueryPrepared(
            "SELECT event_id, peer_pubkey, sender_pubkey, content_encrypted, event_created_at
             FROM NSTR_MESSAGES WHERE user_id = ? ORDER BY event_created_at DESC LIMIT $limit",
            [(int)$userId]
        ) ?: [];
    }

    static function saveMessage($userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, $eventCreatedAt) {
        if (self::isExpiredMonitorDm($peerPubkey, $eventCreatedAt)) {
            return false;
        }
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_MESSAGES (user_id, event_id, peer_pubkey, sender_pubkey, content_encrypted, event_created_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(int)$userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, (int)$eventCreatedAt, time()]
        );
    }

    static function removeMessagesByPeer($userId, $peerPubkey) {
        $peerPubkey = strtolower(trim((string)$peerPubkey));
        if (!preg_match('/^[0-9a-f]{64}$/', $peerPubkey)) return false;

        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_MESSAGES WHERE user_id = ? AND peer_pubkey = ?",
            [(int)$userId, $peerPubkey]
        );
    }

    // ---- RELAYS ----

    static function getRelays($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, url, active FROM NSTR_RELAYS WHERE user_id = ? ORDER BY id",
            [(int)$userId]
        ) ?: [];
    }

    static function addRelay($userId, $url) {
        $url = rtrim(trim($url), '/');
        if (empty($url) || strlen($url) > 512) return false;
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_RELAYS (user_id, url, created_at) VALUES (?, ?, ?)",
            [(int)$userId, $url, time()]
        );
    }

    static function removeRelay($userId, $relayId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_RELAYS WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$relayId]
        );
    }

    static function toggleRelay($userId, $relayId) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_RELAYS SET active = 1 - active WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$relayId]
        );
    }

    // ---- MUTED ----

    static function getMuted($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, pubkey, created_at FROM NSTR_MUTED WHERE user_id = ? ORDER BY created_at DESC",
            [(int)$userId]
        ) ?: [];
    }

    static function addMuted($userId, $pubkey) {
        if (empty($pubkey) || strlen($pubkey) !== 64) return false;
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_MUTED (user_id, pubkey, created_at) VALUES (?, ?, ?)",
            [(int)$userId, $pubkey, time()]
        );
    }

    static function removeMuted($userId, $pubkey) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_MUTED WHERE user_id = ? AND pubkey = ?",
            [(int)$userId, $pubkey]
        );
    }

    // ---- CHANNELS (NIP-28) ----

    static function getChannels($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, channel_id, name, about, picture, creator_pubkey, relay_url, pinned
             FROM NSTR_CHANNELS WHERE user_id = ? ORDER BY pinned DESC, name ASC",
            [(int)$userId]
        ) ?: [];
    }

    static function addChannel($userId, $channelId, $name, $about = '', $picture = '', $creatorPubkey = '', $relayUrl = '') {
        if (self::isSQLite()) {
            return self::sqlQueryPrepared(
                "INSERT INTO NSTR_CHANNELS (user_id, channel_id, name, about, picture, creator_pubkey, relay_url, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, channel_id) DO UPDATE SET name = excluded.name, about = excluded.about, picture = excluded.picture",
                [(int)$userId, $channelId, $name, $about, $picture, $creatorPubkey, $relayUrl, time()]
            );
        }
        return self::sqlQueryPrepared(
            "INSERT INTO NSTR_CHANNELS (user_id, channel_id, name, about, picture, creator_pubkey, relay_url, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), about = VALUES(about), picture = VALUES(picture)",
            [(int)$userId, $channelId, $name, $about, $picture, $creatorPubkey, $relayUrl, time()]
        );
    }

    static function removeChannel($userId, $channelId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_CHANNELS WHERE user_id = ? AND channel_id = ?",
            [(int)$userId, $channelId]
        );
    }

    static function toggleChannelPin($userId, $channelId) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_CHANNELS SET pinned = 1 - pinned WHERE user_id = ? AND channel_id = ?",
            [(int)$userId, $channelId]
        );
    }

    // ---- CFG_CFG / MONITOR ----

    static function getCfgValuesByPrefix($prefix) {
        $rows = self::sqlQueryPrepared(
            "SELECT K, V FROM CFG_CFG WHERE K LIKE ? AND ACTIVE = 1 ORDER BY K",
            [$prefix . '%']
        ) ?: [];

        $out = [];
        foreach ($rows as $row) {
            $key = (string)($row['K'] ?? '');
            if ($key === '') {
                continue;
            }
            $out[$key] = (string)($row['V'] ?? '');
        }

        return $out;
    }

    static function getCfgValue($key, $default = '') {
        $rows = self::sqlQueryPrepared(
            "SELECT V FROM CFG_CFG WHERE K = ? AND ACTIVE = 1 LIMIT 1",
            [$key]
        ) ?: [];

        if (!$rows || !isset($rows[0]['V'])) {
            return $default;
        }

        return (string)$rows[0]['V'];
    }

    static function setCfgValue($key, $value, $description = '', $active = 1) {
        $active = (int)$active;

        if (self::isSQLite()) {
            $existing = self::sqlQueryPrepared(
                "SELECT K FROM CFG_CFG WHERE K = ? LIMIT 1",
                [$key]
            ) ?: [];

            if ($existing) {
                return self::sqlQueryPrepared(
                    "UPDATE CFG_CFG SET V = ?, DESCRIPTION = ?, ACTIVE = ? WHERE K = ?",
                    [(string)$value, (string)$description, $active, (string)$key]
                );
            }

            return self::sqlQueryPrepared(
                "INSERT INTO CFG_CFG (K, V, DESCRIPTION, ACTIVE) VALUES (?, ?, ?, ?)",
                [(string)$key, (string)$value, (string)$description, $active]
            );
        }

        return self::sqlQueryPrepared(
            "INSERT INTO CFG_CFG (K, V, DESCRIPTION, ACTIVE) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE V = VALUES(V), DESCRIPTION = VALUES(DESCRIPTION), ACTIVE = VALUES(ACTIVE)",
            [(string)$key, (string)$value, (string)$description, $active]
        );
    }

    static function ensureMonitorIdentity() {
        $privKeyCfg = 'modules.noxtr.monitor_privkey';
        $pubKeyCfg = 'modules.noxtr.monitor_pubkey';
        $adminCfg = 'modules.noxtr.monitor_admin_pubkeys';
        $relaysCfg = 'modules.noxtr.monitor_relays';

        $privkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_privkey'] ?? self::getCfgValue($privKeyCfg, '')));
        $pubkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? self::getCfgValue($pubKeyCfg, '')));
        $adminsRaw = trim((string)(CFG::$vars['modules']['noxtr']['monitor_admin_pubkeys'] ?? self::getCfgValue($adminCfg, '')));
        $relaysRaw = trim((string)(CFG::$vars['modules']['noxtr']['monitor_relays'] ?? self::getCfgValue($relaysCfg, 'wss://relay.mostro.network,wss://relay.kilombino.com')));

        if ($privkey !== '' && $pubkey === '' && extension_loaded('gmp')) {
            $pubkey = NostrCrypto::getPublicKey($privkey);
            self::setCfgValue($pubKeyCfg, $pubkey, 'Public key HEX for the Noxtr monitor identity', 1);
        }

        if ($privkey === '' && extension_loaded('gmp')) {
            $kp = NostrCrypto::generateKeypair();
            $privkey = $kp['privkey'];
            $pubkey = $kp['pubkey'];

            self::setCfgValue($privKeyCfg, $privkey, 'Private key HEX for the Noxtr monitor identity', 1);
            self::setCfgValue($pubKeyCfg, $pubkey, 'Public key HEX for the Noxtr monitor identity', 1);
        }

        if (!isset(CFG::$vars['modules'])) {
            CFG::$vars['modules'] = [];
        }
        if (!isset(CFG::$vars['modules']['noxtr'])) {
            CFG::$vars['modules']['noxtr'] = [];
        }
        CFG::$vars['modules']['noxtr']['monitor_privkey'] = $privkey;
        CFG::$vars['modules']['noxtr']['monitor_pubkey'] = $pubkey;
        CFG::$vars['modules']['noxtr']['monitor_admin_pubkeys'] = $adminsRaw;

        $npub = '';
        if ($pubkey !== '') {
            $npub = NostrAuth::hexToNpub($pubkey);
        }

        $adminPubkeys = array_values(array_filter(array_map('trim', explode(',', $adminsRaw))));
        $relayUrls = array_values(array_filter(array_map('trim', explode(',', $relaysRaw))));

        return [
            'privkey' => $privkey,
            'pubkey' => $pubkey,
            'npub' => $npub,
            'admin_pubkeys' => $adminPubkeys,
            'relays' => $relayUrls,
        ];
    }
}
