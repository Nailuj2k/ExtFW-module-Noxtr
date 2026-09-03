<?php
/**
 * NoxtrStore - Data persistence for Noxtr client
 * Tables: NSTR_CONTACTS, NSTR_TOPICS, NSTR_BOOKMARKS, NSTR_TRADES
 * Compatible with MySQL and SQLite
 */
class NoxtrStore extends DbConnection {

    private static function isSQLite() {
        return CFG::$vars['db']['type'] === 'sqlite';
    }

    private static function tableHasColumn($table, $column) {
        // Defensa en profundidad: $table se usa en un PRAGMA sin placeholder.
        // Hoy siempre es un literal del código, pero validamos el formato de
        // identificador SQL por si algún día llegara de forma dinámica.
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $table)) {
            return false;
        }
        if (self::isSQLite()) {
            // SQL seguro: $table es siempre un literal hardcodeado desde el código
            // (CLI_USER, NSTR_TRADES, NSTR_MESSAGES), nunca entrada de usuario. PRAGMA
            // no admite placeholders. Validación extra de $table arriba.
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

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_TRADES (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                order_id TEXT NOT NULL,
                method TEXT NOT NULL DEFAULT 'lightning',
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
                dispute_id TEXT DEFAULT '',
                solver_pubkey TEXT DEFAULT '',
                arbitrators TEXT DEFAULT '',
                taproot_address TEXT DEFAULT '',
                funding_txid TEXT DEFAULT '',
                funding_vout INTEGER DEFAULT 0,
                funding_block INTEGER DEFAULT 0,
                confirmations INTEGER DEFAULT 0,
                trade_json TEXT DEFAULT NULL,
                my_rating INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                bond_paid INTEGER DEFAULT 0,
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
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_trades_user ON NSTR_TRADES(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_trades_method ON NSTR_TRADES(method)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_trades_funding ON NSTR_TRADES(funding_txid)");

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

            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_TRADES (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                order_id VARCHAR(64) NOT NULL,
                method VARCHAR(10) NOT NULL DEFAULT 'lightning',
                request_id INT DEFAULT 0,
                robot_pubkey VARCHAR(64) NOT NULL DEFAULT '',
                trade_kind VARCHAR(10) NOT NULL DEFAULT 'buy',
                trade_role VARCHAR(10) NOT NULL DEFAULT 'created',
                trade_privkey VARCHAR(160) NOT NULL DEFAULT '',
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
                dispute_id VARCHAR(64) DEFAULT '',
                solver_pubkey VARCHAR(64) DEFAULT '',
                arbitrators TEXT DEFAULT NULL,
                taproot_address VARCHAR(80) DEFAULT '',
                funding_txid VARCHAR(64) DEFAULT '',
                funding_vout INT DEFAULT 0,
                funding_block INT DEFAULT 0,
                confirmations INT DEFAULT 0,
                trade_json MEDIUMTEXT DEFAULT NULL,
                my_rating TINYINT DEFAULT 0,
                archived TINYINT(1) DEFAULT 0,
                bond_paid TINYINT(1) DEFAULT 0,
                created_at INT NOT NULL DEFAULT 0,
                updated_at INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_trade (user_id, order_id),
                KEY idx_user (user_id),
                KEY idx_method (method),
                KEY idx_funding (funding_txid)
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
            // SQL seguro: nombre de tabla literal, sin variables. PRAGMA no admite placeholders.
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
            'request_id' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN request_id INTEGER DEFAULT 0" : "ALTER TABLE NSTR_TRADES ADD COLUMN request_id INT DEFAULT 0",
            'identity_fingerprint' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN identity_fingerprint TEXT DEFAULT ''" : "ALTER TABLE NSTR_TRADES ADD COLUMN identity_fingerprint VARCHAR(128) DEFAULT ''",
            'trade_key_pub' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN trade_key_pub TEXT DEFAULT ''" : "ALTER TABLE NSTR_TRADES ADD COLUMN trade_key_pub VARCHAR(64) DEFAULT ''",
            'trade_index' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN trade_index INTEGER DEFAULT 0" : "ALTER TABLE NSTR_TRADES ADD COLUMN trade_index INT DEFAULT 0",
            'peer_pubkey' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN peer_pubkey TEXT DEFAULT ''" : "ALTER TABLE NSTR_TRADES ADD COLUMN peer_pubkey VARCHAR(64) DEFAULT ''",
            'dispute_id' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN dispute_id TEXT DEFAULT ''" : "ALTER TABLE NSTR_TRADES ADD COLUMN dispute_id VARCHAR(64) DEFAULT ''",
            'solver_pubkey' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN solver_pubkey TEXT DEFAULT ''" : "ALTER TABLE NSTR_TRADES ADD COLUMN solver_pubkey VARCHAR(64) DEFAULT ''",
            // UI-only flag: hidden from "Mis trades" but preserved in DB and in /mostro/trades.
            'archived' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN archived INTEGER DEFAULT 0" : "ALTER TABLE NSTR_TRADES ADD COLUMN archived TINYINT(1) DEFAULT 0",
            // Fianza (bond) pagada. Server-side para que sea consistente entre dispositivos del mismo
            // usuario (antes solo vivia en localStorage por dispositivo).
            'bond_paid' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN bond_paid INTEGER DEFAULT 0" : "ALTER TABLE NSTR_TRADES ADD COLUMN bond_paid TINYINT(1) DEFAULT 0",
            // Índice de derivación NIP-06 (m/44'/1237'/38383'/0/N) usado para la trade key de este
            // trade, cuando se creó a partir de la semilla Mostro propia (auditoría 2026-08-22,
            // punto 7). 0/NULL en trades anteriores a este cambio (clave aleatoria, sin derivar) —
            // esos se quedan como están, esto solo aplica a trades nuevos.
            'seed_index' => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN seed_index INTEGER DEFAULT 0" : "ALTER TABLE NSTR_TRADES ADD COLUMN seed_index INT DEFAULT 0",
        ];
        foreach ($mostroTradeCols as $colName => $sql) {
            if (!self::tableHasColumn('NSTR_TRADES', $colName)) self::sqlExec($sql);
        }

        // Backward compatibility for the first archive implementation that used
        // internal_status='archivado' directly instead of a dedicated column.
        if (self::tableHasColumn('NSTR_TRADES', 'archived')) {
            self::sqlQueryPrepared(
                "UPDATE NSTR_TRADES SET archived = 1 WHERE LOWER(COALESCE(internal_status, '')) = 'archivado'",
                []
            );
        }

        // Keep this aditive even for fresh recreations after a DROP TABLE.
        $newTradeCols = [
            'trade_role'       => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN trade_role TEXT NOT NULL DEFAULT 'created'"    : "ALTER TABLE NSTR_TRADES ADD COLUMN trade_role VARCHAR(10) NOT NULL DEFAULT 'created'",
            'trade_privkey'    => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN trade_privkey TEXT NOT NULL DEFAULT ''"         : "ALTER TABLE NSTR_TRADES ADD COLUMN trade_privkey VARCHAR(160) NOT NULL DEFAULT ''",
            'internal_status'  => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN internal_status TEXT NOT NULL DEFAULT 'creado'" : "ALTER TABLE NSTR_TRADES ADD COLUMN internal_status VARCHAR(32) NOT NULL DEFAULT 'creado'",
            'arbitrators'      => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN arbitrators TEXT DEFAULT ''"                    : "ALTER TABLE NSTR_TRADES ADD COLUMN arbitrators TEXT DEFAULT NULL",
            'taproot_address'  => self::isSQLite() ? "ALTER TABLE NSTR_TRADES ADD COLUMN taproot_address TEXT DEFAULT ''"               : "ALTER TABLE NSTR_TRADES ADD COLUMN taproot_address VARCHAR(80) DEFAULT ''",
        ];
        foreach ($newTradeCols as $col => $sql) {
            if (!self::tableHasColumn('NSTR_TRADES', $col)) self::sqlExec($sql);
        }

        // NSTR_NOXTR_SITES — sitios remotos monitorizados por el monitor multi-site
        if (self::isSQLite()) {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_NOXTR_SITES(
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            site_id VARCHAR(64),
                            site_url VARCHAR(255),
                            api_key VARCHAR(128),
                            created_at INTEGER DEFAULT (unixepoch()),
                            updated_at INTEGER DEFAULT (unixepoch()),
                            active INTEGER)");
        } else {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_NOXTR_SITES (
                id INT AUTO_INCREMENT PRIMARY KEY,
                site_id VARCHAR(64) NOT NULL UNIQUE,
                site_url VARCHAR(255) NOT NULL,
                api_key VARCHAR(128) NOT NULL,
                ACTIVE TINYINT(1) DEFAULT 1,
                created_at INT NOT NULL DEFAULT 0
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");
        }

        if (!self::tableHasColumn('NSTR_MESSAGES', 'nip_version')) {
            self::sqlExec(self::isSQLite()
                ? "ALTER TABLE NSTR_MESSAGES ADD COLUMN nip_version INTEGER NOT NULL DEFAULT 4"
                : "ALTER TABLE NSTR_MESSAGES ADD COLUMN nip_version TINYINT NOT NULL DEFAULT 4"
            );
        }

        if (!self::tableHasColumn('CLI_USER', 'nwc_uri')) {
            self::sqlExec(self::isSQLite()
                ? "ALTER TABLE CLI_USER ADD COLUMN nwc_uri TEXT DEFAULT NULL"
                : "ALTER TABLE CLI_USER ADD COLUMN nwc_uri VARCHAR(512) DEFAULT NULL"
            );
        }

        // NSTR_NIP96_SERVERS — file storage servers (NIP-96)
        if (self::isSQLite()) {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_NIP96_SERVERS (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                UNIQUE(user_id, url)
            )");
        } else {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_NIP96_SERVERS (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                url VARCHAR(512) NOT NULL,
                active TINYINT(1) DEFAULT 1,
                sort_order INT DEFAULT 0,
                UNIQUE KEY uq_nip96 (user_id, url),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");
        }

        // Seed default NIP-96 server (nostr.build) for current user if none exist
        $uid = (int)($_SESSION['userid'] ?? 0);
        if ($uid && (!isset($_SESSION['noxtr_tables_v']) || $_SESSION['noxtr_tables_v'] < 13)) {
            $existing = self::sqlQueryPrepared("SELECT id FROM NSTR_NIP96_SERVERS WHERE user_id = ? LIMIT 1", [$uid]);
            if (!$existing) {
                $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
                self::sqlQueryPrepared(
                    "INSERT $ignore INTO NSTR_NIP96_SERVERS (user_id, url, active, sort_order) VALUES (?, ?, 1, 0)",
                    [$uid, 'https://nostr.build']
                );
            }
        }

        // NSTR_EVENTS — log de eventos Nostr (gift wraps + rumores desempaquetados + mensajes salientes)
        // Mismo schema que el que crea server_monitor.php para que ambos puedan coexistir.
        if (self::isSQLite()) {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_EVENTS (
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
            )");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_events_user ON NSTR_EVENTS(user_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_events_order ON NSTR_EVENTS(order_id)");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_nstr_events_created ON NSTR_EVENTS(event_created_at)");
        } else {
            self::sqlExec("CREATE TABLE IF NOT EXISTS NSTR_EVENTS (
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
                KEY idx_user (user_id),
                KEY idx_order (order_id),
                KEY idx_created (event_created_at)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");
        }

        // CLI_USER_CFG — preferencias per-usuario (K/V como CFG_CFG pero por user_id).
        // Tabla de framework, usable por otros módulos. Noxtr guarda aquí el filtro
        // de monedas del chip 💱 (K='noxtr.fiat_filter') para que el monitor filtre avisos.
        if (self::isSQLite()) {
            self::sqlExec("CREATE TABLE IF NOT EXISTS CLI_USER_CFG (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                K TEXT NOT NULL,
                V TEXT DEFAULT '',
                updated_at INTEGER DEFAULT 0,
                UNIQUE(user_id, K)
            )");
            self::sqlExec("CREATE INDEX IF NOT EXISTS idx_cli_user_cfg_user ON CLI_USER_CFG(user_id)");
        } else {
            self::sqlExec("CREATE TABLE IF NOT EXISTS CLI_USER_CFG (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                K VARCHAR(64) NOT NULL,
                V TEXT DEFAULT NULL,
                updated_at INT DEFAULT 0,
                UNIQUE KEY uq_user_k (user_id, K),
                KEY idx_user (user_id)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4");
        }

        $_SESSION['noxtr_tables_v'] = 16;

        // Backfill de trade_privkey en claro → cifrado (auditoría 2026-08-22). Flag en CFG_CFG (no en
        // sesión: debe correr una sola vez para TODA la instalación, no una vez por sesión de cada
        // usuario) para que este chequeo barato (un SELECT indexado) sea lo único que pague cada
        // request una vez hecho el backfill real.
        if (self::getCfgValue('modules.noxtr.trade_privkey_migrated_v1', '') === '') {
            // 'enc1:' + base64(iv[12] + tag[16] + ciphertext[32]) mide ~85 caracteres — no cabe en el
            // VARCHAR(64) original de instalaciones ya existentes (SQLite TEXT no tiene este problema:
            // sin límite de longitud). Ensanchar ANTES de cifrar, si no, MySQL trunca el valor cifrado
            // y esa clave queda irrecuperable.
            if (!self::isSQLite()) {
                self::sqlExec("ALTER TABLE NSTR_TRADES MODIFY COLUMN trade_privkey VARCHAR(160) NOT NULL DEFAULT ''");
            }
            self::migrateEncryptTradePrivkeys();
            self::setCfgValue('modules.noxtr.trade_privkey_migrated_v1', '1',
                'Backfill de NSTR_TRADES.trade_privkey a cifrado en reposo ya ejecutado', 1);
        }
    }

    // ---- CONFIG PER-USUARIO (CLI_USER_CFG) ----

    static function getUserCfg(int $userId, string $key, string $default = ''): string
    {
        $rows = self::sqlQueryPrepared('SELECT V FROM CLI_USER_CFG WHERE user_id = ? AND K = ? LIMIT 1', [$userId, $key]);
        return (is_array($rows) && isset($rows[0]['V'])) ? (string)$rows[0]['V'] : $default;
    }

    static function setUserCfg(int $userId, string $key, string $value): void
    {
        $now = time();
        $existing = self::sqlQueryPrepared('SELECT id FROM CLI_USER_CFG WHERE user_id = ? AND K = ? LIMIT 1', [$userId, $key]);
        if ($existing) {
            self::sqlQueryPrepared('UPDATE CLI_USER_CFG SET V = ?, updated_at = ? WHERE user_id = ? AND K = ?', [$value, $now, $userId, $key]);
        } else {
            self::sqlQueryPrepared('INSERT INTO CLI_USER_CFG (user_id, K, V, updated_at) VALUES (?, ?, ?, ?)', [$userId, $key, $value, $now]);
        }
    }

    // Escritura de primera inicialización resistente a dos pestañas concurrentes. La restricción
    // UNIQUE(user_id, K) decide cuál gana; ambas peticiones leen después exactamente ese valor.
    static function setUserCfgIfAbsent(int $userId, string $key, string $value): string
    {
        $now = time();
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        self::sqlQueryPrepared(
            "INSERT $ignore INTO CLI_USER_CFG (user_id, K, V, updated_at) VALUES (?, ?, ?, ?)",
            [$userId, $key, $value, $now]
        );
        return self::getUserCfg($userId, $key, '');
    }

    // ---- NOXTR SITES (monitor multi-site) ----

    static function loadNoxtrSites(): array
    {
        $rows = self::sqlQueryPrepared(
            'SELECT id, site_id, site_url, api_key FROM NSTR_NOXTR_SITES WHERE active = 1 ORDER BY id ASC',
            []
        );
        return is_array($rows) ? $rows : [];
    }

    /**
     * Valida una api_key recibida en el endpoint /noxtr/api/*.
     * Devuelve la fila del site si es válida, o null si no lo es.
     *
     * @return array<string,mixed>|null
     */
    static function validateMonitorApiKey(string $key): ?array
    {
        if ($key === '') {
            return null;
        }
        $row = self::sqlQueryPrepared(
            'SELECT id, site_id, site_url FROM NSTR_NOXTR_SITES WHERE api_key = ? AND active = 1 LIMIT 1',
            [$key]
        );
        return is_array($row) && !empty($row) ? (isset($row[0]) ? $row[0] : $row) : null;
    }

    // ---- MONITOR API (multi-site) ----

    /**
     * Trades activos para el endpoint del monitor.
     * Incluye trade_privkey — solo llamar desde api.php con api_key validada.
     *
     * @return array<int,array<string,mixed>>
     */
    static function getMonitorActiveTrades(): array
    {
        // Nota: 'disputado' SÍ se mantiene porque el ciclo de vida de una disputa
        // sigue después (admin-took-dispute, mensajes del solver, settle/cancel, etc.).
        $rows = self::sqlQueryPrepared(
            "SELECT user_id, order_id, robot_pubkey, trade_kind, trade_role, trade_action,
                    status, internal_status, is_seller, fiat_amount, fiat_code, sat_amount,
                    payment_method, trade_key_pub, trade_privkey, trade_index, peer_pubkey,
                    dispute_id, solver_pubkey
             FROM NSTR_TRADES
             WHERE COALESCE(archived, 0) = 0
               AND COALESCE(trade_key_pub, '') <> ''
               AND COALESCE(trade_privkey, '') <> ''
               AND LOWER(COALESCE(internal_status, '')) NOT IN ('cancelado','completado','archivado')
             ORDER BY updated_at DESC",
            []
        );
        $rows = is_array($rows) ? $rows : [];
        foreach ($rows as $idx => $row) {
            $rows[$idx]['trade_privkey'] = self::decTradePrivkey($row['trade_privkey'] ?? '');
        }
        return $rows;
    }

    /**
     * @return array<string,mixed>|null
     */
    static function getMonitorUser(int $userId): ?array
    {
        $row = self::sqlQueryPrepared(
            "SELECT u.USER_ID AS user_id, u.USER_EMAIL AS email,
                    COALESCE(u.nostr_pubkey, '') AS nostr_pubkey,
                    COALESCE(t.chat_id, '') AS telegram_chat_id
             FROM CLI_USER u
             LEFT JOIN TGRAM_CHATS t ON t.user_id = u.USER_ID AND t.active = 1
             WHERE u.USER_ID = ? LIMIT 1",
            [$userId]
        );
        return is_array($row) && !empty($row) ? (isset($row[0]) ? $row[0] : $row) : null;
    }

    /**
     * @return array<string,mixed>|null
     */
    static function getMonitorUserByPubkey(string $pubkey): ?array
    {
        // La columna admite '' (el panel de control la expone como textarea editable y un
        // textarea vacío guarda '', no NULL). Sin esto, una pubkey vacía casa con la primera
        // fila de un usuario sin identidad vinculada y el monitor le manda los avisos de los
        // trades de otro. Mismo criterio que el `<> ''` de getMonitorTelegramUsers, más abajo.
        if (!preg_match('/^[0-9a-f]{64}$/i', $pubkey)) return null;
                
        $row = self::sqlQueryPrepared(
            "SELECT u.USER_ID AS user_id, u.USER_EMAIL AS email,
                    COALESCE(u.nostr_pubkey, '') AS nostr_pubkey,
                    COALESCE(t.chat_id, '') AS telegram_chat_id
             FROM CLI_USER u
             LEFT JOIN TGRAM_CHATS t ON t.user_id = u.USER_ID AND t.active = 1
             WHERE LOWER(u.nostr_pubkey) = LOWER(?) LIMIT 1",
            [$pubkey]
        );
        return is_array($row) && !empty($row) ? (isset($row[0]) ? $row[0] : $row) : null;
    }

    /**
     * Usuarios con nostr_pubkey y Telegram vinculado. Para el filtro kind:4 del monitor.
     *
     * @return array<int,array<string,string>>
     */
    static function getMonitorTelegramUsers(): array
    {
        $rows = self::sqlQueryPrepared(
            "SELECT LOWER(u.nostr_pubkey) AS nostr_pubkey, t.chat_id
             FROM CLI_USER u
             INNER JOIN TGRAM_CHATS t ON t.user_id = u.USER_ID AND t.active = 1
             WHERE u.nostr_pubkey IS NOT NULL AND u.nostr_pubkey <> ''
             ORDER BY u.USER_ID ASC",
            []
        );
        return is_array($rows) ? $rows : [];
    }

    // Aquí vivían isMonitorEventProcessed() y wasMonitorNotificationSent(): copias de las que el
    // monitor tiene en su propio EventStore (server_monitor.php) y que nadie llamaba desde ningún
    // punto del proyecto. Se retiran para que nadie las use por error creyendo que son las buenas:
    // las vivas son EventStore::isEventProcessed() y EventStore::wasNotificationSent().

    /**
     * @param array<string,mixed> $row
     */
    static function storeMonitorEvent(array $row): void
    {
        $eventId = trim((string)($row['event_id'] ?? ''));
        if ($eventId === '') {
            return;
        }
        $now = time();
        $ignore = self::isSQLite() ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        self::sqlQueryPrepared(
            $ignore . ' INTO NSTR_EVENTS
                (event_id, kind, order_id, user_id, event_created_at, source, status,
                 raw_json, notification_type, notification_sent_at, processed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $eventId,
                (int)($row['kind'] ?? 0),
                (string)($row['order_id'] ?? ''),
                (int)($row['user_id'] ?? 0),
                (int)($row['event_created_at'] ?? 0),
                (string)($row['source'] ?? 'remote'),
                (string)($row['status'] ?? 'received'),
                (string)($row['raw_json'] ?? ''),
                (string)($row['notification_type'] ?? ''),
                isset($row['notification_sent_at']) && $row['notification_sent_at'] !== null ? (int)$row['notification_sent_at'] : null,
                (int)($row['processed_at'] ?? $now),
                (int)($row['created_at'] ?? $now),
                (int)($row['updated_at'] ?? $now),
            ]
        );
    }

    /**
     * Rumores ya descifrados de una accion concreta de un trade, mas recientes primero.
     * Los guarda el cliente via log_mostro_event ('client_rumor' lleva el payload en claro),
     * asi que sirven para recuperar datos de un mensaje que el relay ya no reenvia — p.ej. la
     * hold invoice de un `pay-invoice` cuyo QR el vendedor cerro sin pagar.
     *
     * @return array<int,array<string,mixed>>
     */
    static function getTradeRumors(int $userId, string $orderId, string $action, int $limit = 5): array
    {
        $orderId = trim($orderId);
        $action  = trim($action);
        if ($userId <= 0 || $orderId === '' || $action === '') {
            return [];
        }
        $limit = max(1, min(20, $limit));
        $rows = self::sqlQueryPrepared(
            'SELECT event_id, event_created_at, status, raw_json
               FROM NSTR_EVENTS
              WHERE user_id = ? AND order_id = ? AND source = ? AND status = ?
              ORDER BY event_created_at DESC
              LIMIT ' . $limit,
            [$userId, $orderId, 'client_rumor', $action]
        );
        return is_array($rows) ? $rows : [];
    }

    /** Envelopes cifrados de chat de disputa ya validados por el cliente, en orden cronológico. */
    static function getDisputeChatHistory(int $userId, string $orderId, int $limit = 500): array
    {
        if ($userId <= 0 || trim($orderId) === '') return [];
        $limit = max(1, min(1000, $limit));
        $rows = self::sqlQueryPrepared(
            "SELECT event_id, event_created_at, source, raw_json
               FROM NSTR_EVENTS
              WHERE user_id = ? AND order_id = ? AND source IN ('dispute_chat_in','dispute_chat_out')
              ORDER BY event_created_at ASC, id ASC
              LIMIT " . $limit,
            [$userId, $orderId]
        );
        return is_array($rows) ? $rows : [];
    }

    // Aquí vivía markMonitorNotificationSent(), tercera copia muerta sin ningún llamador. La viva
    // es EventStore::markNotificationSent() en server_monitor.php.

    /**
     * Poda de higiene sobre trades ya terminados.
     *
     * POR QUÉ EXISTE: un trade cerrado ya no puede mover dinero — el daemon rechaza cualquier
     * acción sobre él con NotAllowedByStatus —, pero su `trade_privkey` sigue descifrando todo su
     * historial: el chat con la contraparte, el método de pago acordado, las bolt11. Y ese
     * ciphertext vive en NSTR_EVENTS, en la MISMA base de datos que la clave. Un volcado parcial
     * de la BD basta entonces para reconstruir con quién, cuándo y cómo comerció el usuario.
     * La poda rompe ese emparejamiento por los dos lados: borra el log de eventos del trade y
     * vacía su clave. No basta con vaciar `raw_json`: `order_id`, `event_created_at`, `status` y
     * `kind` son por sí solos el rastro de con quién y cuándo se comerció, y los `event_id`
     * sintéticos de las notificaciones del monitor incrustan el propio order id en texto plano
     * (`notif-<order_id>-<tipo>-<timestamp>`, ver markMonitorNotificationSent). Por eso se borra
     * la fila entera.
     *
     * LA VENTANA DE $days NO ES COSMÉTICA: tras 'completado' el chat del trade sigue vivo
     * (subscribeMyTrades lo mantiene), la valoración de la contraparte puede llegar tarde y una
     * disputa puede reabrirse. Por debajo de ~15 días se rompen casos legítimos.
     *
     * @param int|null $userId  Acota a ese usuario; null = todos.
     * @param int      $days    Antigüedad mínima, en días, del último movimiento del trade.
     * @return array{events:int,keys:int,trades:int} Filas de NSTR_EVENTS limpiadas, claves
     *         purgadas, y trades podados en esta pasada.
     */
    static function pruneClosedTrades(?int $userId = null, int $days = 15): array
    {
        $out = ['events' => 0, 'keys' => 0, 'trades' => 0];
        $days   = max(1, $days);
        $cutoff = time() - ($days * 86400);

        // Solo se seleccionan trades a los que AÚN les queda algo que podar. Así una segunda
        // pasada devuelve la selección vacía y sale sin lanzar un solo UPDATE (idempotencia), y
        // además el contador `trades` significa "podados ahora", no "cerrados y antiguos".
        // El EXISTS se apoya en idx_nstr_events_order y funciona igual en MySQL y SQLite.
        $sql = "SELECT t.order_id
                  FROM NSTR_TRADES t
                 WHERE LOWER(COALESCE(t.internal_status, '')) IN ('completado', 'cancelado', 'archivado')
                   AND COALESCE(t.updated_at, 0) > 0
                   AND COALESCE(t.updated_at, 0) < ?
                   AND COALESCE(t.order_id, '') <> ''
                   AND (COALESCE(t.trade_privkey, '') <> ''
                        OR EXISTS (SELECT 1 FROM NSTR_EVENTS e WHERE e.order_id = t.order_id))";
        $params = [$cutoff];
        if ($userId !== null) {
            $sql .= " AND t.user_id = ?";
            $params[] = (int)$userId;
        }

        $rows = self::sqlQueryPrepared($sql, $params);
        if (!is_array($rows) || !$rows) return $out;

        $orderIds = [];
        foreach ($rows as $r) {
            $oid = trim((string)($r['order_id'] ?? ''));
            if ($oid !== '') $orderIds[$oid] = true;
        }
        $orderIds = array_keys($orderIds);
        if (!$orderIds) return $out;

        $out['trades'] = count($orderIds);

        // Lotes de 200: con $userId null la primera pasada puede abarcar miles de trades, y un
        // IN (...) de ese tamaño es un problema en los dos motores (SQLite tiene tope duro de
        // variables por sentencia, MySQL se come el max_allowed_packet). Se procesan todos los
        // trades seleccionados, pero cada UPDATE queda acotado.
        foreach (array_chunk($orderIds, 200) as $chunk) {
            $ph = implode(',', array_fill(0, count($chunk), '?'));

            // 1) NSTR_EVENTS: fila entera. La dedup del monitor que vive en esta tabla no se
            //    pierde de forma relevante: wasNotificationSent() busca por order_id, e
            //    isEventProcessed() solo se consulta sobre eventos que llegan de los relays, y
            //    las suscripciones salen de loadActiveTrades(), que excluye a estos trades DOS
            //    veces (por internal_status y por COALESCE(trade_privkey,'') <> '', que esta
            //    misma poda deja vacío). No puede llegar un evento que consulte esa dedup.
            //    Residuo asumido: un evento viejo reenviado por una suscripción no ligada a
            //    trades (order book 38383) podría reprocesarse una vez → como mucho, un aviso
            //    duplicado sobre una orden rancia. No toca dinero ni estado de trade.
            //
            //    NO se filtra por user_id aquí a propósito, aunque $userId venga informado: las
            //    filas sintéticas de notificación del monitor se insertan con user_id = 0
            //    (markNotificationSent) y son justo las que llevan el order id en el event_id.
            //    Filtrar por usuario las dejaría atrás. El order_id es un UUID de Mostro, único
            //    global, así que casar solo por él no puede alcanzar trades de otro usuario.
            $cnt = self::sqlQueryPrepared(
                "SELECT COUNT(*) AS n FROM NSTR_EVENTS WHERE order_id IN ($ph)",
                $chunk
            );
            $nEvents = is_array($cnt) ? (int)($cnt[0]['n'] ?? 0) : 0;
            if ($nEvents > 0) {
                self::sqlQueryPrepared(
                    "DELETE FROM NSTR_EVENTS WHERE order_id IN ($ph)",
                    $chunk
                );
                $out['events'] += $nEvents;
            }

            // 2) NSTR_TRADES: la clave a cadena vacía, NUNCA a NULL — server_monitor.php filtra
            //    con COALESCE(trade_privkey,'') <> '' y un NULL ahí se comporta distinto en los
            //    dos motores. `updated_at` NO se toca a propósito: es el criterio de selección de
            //    esta misma poda y la base del aviso de trade atascado en la ficha; refrescarlo
            //    falsearía la fecha del último mensaje real de la instancia.
            $kSql    = "SELECT COUNT(*) AS n FROM NSTR_TRADES
                         WHERE order_id IN ($ph) AND COALESCE(trade_privkey, '') <> ''";
            $kParams = $chunk;
            if ($userId !== null) { $kSql .= " AND user_id = ?"; $kParams[] = (int)$userId; }

            $kc = self::sqlQueryPrepared($kSql, $kParams);
            $nKeys = is_array($kc) ? (int)($kc[0]['n'] ?? 0) : 0;
            if ($nKeys > 0) {
                $uSql    = "UPDATE NSTR_TRADES SET trade_privkey = ''
                             WHERE order_id IN ($ph) AND COALESCE(trade_privkey, '') <> ''";
                $uParams = $chunk;
                if ($userId !== null) { $uSql .= " AND user_id = ?"; $uParams[] = (int)$userId; }
                self::sqlQueryPrepared($uSql, $uParams);
                $out['keys'] += $nKeys;
            }
        }

        return $out;
    }

    /**
     * Poda del log de avisos del order book público.
     *
     * DISTINTO DE pruneClosedTrades(): aquello es higiene criptográfica sobre datos propios; esto
     * es retención de un log de eventos PÚBLICOS de Nostr. El monitor avisa de cada orden nueva del
     * book Mostro, cada oferta on-chain y cada disputa pública (server_monitor.php, markNotificationSent
     * desde new-order / new-onchain-offer / new-mostro-dispute), y deja una fila en NSTR_EVENTS por
     * cada aviso. Esas órdenes son de TERCEROS, así que no casan con ningún trade propio y
     * pruneClosedTrades no las alcanza jamás: la tabla crece sin límite y sin propósito.
     *
     * POR QUÉ NO ROMPE LA DEDUPLICACIÓN, que es lo único que estas filas hacen: las tres
     * suscripciones que las generan piden a los relays `since = now - 2 días`
     * (buildOrderBookFilter, order book on-chain y filtro de disputas 38386, todas en
     * server_monitor.php::buildFilters). Un relay no puede entregar un evento más viejo que eso,
     * así que una fila con más de 2 días ya no puede provocar un aviso duplicado. El default de 30
     * días deja un margen de 15× sobre la ventana más ancha. NO bajar de 7 sin volver a mirar esos
     * `since`: si alguien los amplía, esta poda tiene que ampliarse con ellos.
     *
     * Nada de esto lo exige ni lo prohíbe el protocolo Mostro: NSTR_EVENTS es un log local del
     * cliente. La deduplicación que el protocolo sí pide (chat, por `inner.id`) vive en
     * localStorage del navegador, no en esta tabla.
     *
     * @param int $days    Antigüedad mínima de la fila, en días.
     * @param int $maxRows Tope de filas por pasada. La primera ejecución sobre un log antiguo puede
     *                     abarcar decenas de miles; se prefiere converger en varias pasadas a soltar
     *                     un DELETE gigante. 0 = sin tope.
     * @return int Filas borradas en esta pasada.
     */
    static function pruneOrderBookEvents(int $days = 30, int $maxRows = 5000): int
    {
        $days   = max(7, $days);
        $cutoff = time() - ($days * 86400);
        $types  = ['new-order', 'new-onchain-offer', 'new-mostro-dispute'];
        $ph     = implode(',', array_fill(0, count($types), '?'));

        // created_at > 0 exigido a propósito: una fila con created_at 0 o NULL sería "1970", más
        // antigua que cualquier corte, y se borraría por accidente. Mismo criterio que
        // pruneClosedTrades con updated_at.
        $limit = $maxRows > 0 ? ' LIMIT ' . (int)$maxRows : '';
        $rows  = self::sqlQueryPrepared(
            "SELECT id FROM NSTR_EVENTS
              WHERE notification_type IN ($ph)
                AND COALESCE(created_at, 0) > 0
                AND COALESCE(created_at, 0) < ?
              ORDER BY created_at ASC" . $limit,
            array_merge($types, [$cutoff])
        );
        if (!is_array($rows) || !$rows) return 0;

        $ids = [];
        foreach ($rows as $r) {
            $id = (int)($r['id'] ?? 0);
            if ($id > 0) $ids[] = $id;
        }
        if (!$ids) return 0;

        // Se borra por `id` y en lotes, no con el WHERE original: DELETE ... LIMIT no es portable
        // (SQLite solo lo admite compilado con SQLITE_ENABLE_UPDATE_DELETE_LIMIT, que no es el
        // default), y un IN (...) sin acotar chocaría con el tope de variables por sentencia.
        $deleted = 0;
        foreach (array_chunk($ids, 200) as $chunk) {
            $cph = implode(',', array_fill(0, count($chunk), '?'));
            self::sqlQueryPrepared("DELETE FROM NSTR_EVENTS WHERE id IN ($cph)", $chunk);
            $deleted += count($chunk);
        }

        return $deleted;
    }

    /**
     * Poda de eventos que NO están ligados a ningún trade conocido.
     *
     * EL HUECO QUE TAPA: pruneClosedTrades() casa por `order_id` contra NSTR_TRADES, así que solo
     * ve eventos de trades que siguen existiendo. Se le escapan tres familias, y son la mayor parte
     * de la tabla:
     *
     *  1. `order_id` VACÍO. Cada kind 14 entrante que ve el navegador se registra antes de
     *     desempaquetarlo, cuando todavía no se sabe de qué orden es:
     *     _logMostroEv('client_in', ev, '', 'received') en script.mostro.js. Esas filas llevan el
     *     CIPHERTEXT del mensaje. También caen aquí los eventos del canal de control del monitor
     *     (status 'stale' y similares, server_monitor.php), que se guardan con order_id ''.
     *  2. HUÉRFANAS: el `order_id` no casa con ninguna fila de NSTR_TRADES. Restos de trades
     *     borrados, o de eventos registrados bajo un id temporal `tmp-...` antes de que la
     *     confirmación del daemon renombrara la fila al UUID real.
     *  3. Eventos on-chain de trades ya desaparecidos (status 'onchain-*').
     *
     * POR QUÉ ES SEGURO: un trade ABIERTO siempre tiene su fila en NSTR_TRADES, así que ninguna
     * de estas filas puede pertenecer a uno vivo. getTradeRumors() —el único lector de `raw_json`
     * del módulo— busca por user_id + order_id, luego nunca puede necesitarlas. Y la única otra
     * dependencia, la deduplicación por event_id del monitor (EventStore::isEventProcessed), solo
     * se consulta sobre eventos que entregan los relays, cuya ventana más ancha es de 7 días
     * (buildFilters: `since = now - 86400*7`): nada con más de 7 días puede volver a llegar. El
     * default de 30 deja margen de 4×, y el max(8, ...) impide bajar a la zona de riesgo.
     *
     * @param int $days    Antigüedad mínima de la fila (por `created_at`, cuándo se guardó).
     * @param int $maxRows Tope de filas por pasada; 0 = sin tope. Ver pruneOrderBookEvents.
     * @return int Filas borradas en esta pasada.
     */
    static function pruneUnlinkedEvents(int $days = 30, int $maxRows = 5000): int
    {
        $days   = max(8, $days);
        $cutoff = time() - ($days * 86400);

        // created_at > 0 exigido a propósito: una fila con created_at 0 o NULL sería "1970" y se
        // borraría por accidente. Mismo criterio que las otras dos podas.
        $limit = $maxRows > 0 ? ' LIMIT ' . (int)$maxRows : '';
        $rows  = self::sqlQueryPrepared(
            "SELECT e.id FROM NSTR_EVENTS e
              WHERE COALESCE(e.created_at, 0) > 0
                AND COALESCE(e.created_at, 0) < ?
                AND (COALESCE(e.order_id, '') = ''
                     OR NOT EXISTS (SELECT 1 FROM NSTR_TRADES t WHERE t.order_id = e.order_id))
              ORDER BY e.created_at ASC" . $limit,
            [$cutoff]
        );
        if (!is_array($rows) || !$rows) return 0;

        $ids = [];
        foreach ($rows as $r) {
            $id = (int)($r['id'] ?? 0);
            if ($id > 0) $ids[] = $id;
        }
        if (!$ids) return 0;

        $deleted = 0;
        foreach (array_chunk($ids, 200) as $chunk) {
            $cph = implode(',', array_fill(0, count($chunk), '?'));
            self::sqlQueryPrepared("DELETE FROM NSTR_EVENTS WHERE id IN ($cph)", $chunk);
            $deleted += count($chunk);
        }

        return $deleted;
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
            "SELECT status FROM NSTR_TRADES WHERE user_id = ? AND order_id = ?",
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
                "INSERT INTO NSTR_TRADES
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
            "INSERT INTO NSTR_TRADES
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
            'creado', 'pendiente_aceptacion', 'aceptado', 'enviando', 'publicado', 'esperando_hold_invoice', 'cancelando', 'tomado', 'esperando_pago_vendedor', 'cancelacion_solicitada',
            'activo', 'funded', 'fiat_sent', 'fiat_received', 'fiat_enviado', 'liberando', 'completado', 'cancelado', 'disputado', 'archivado',
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
            'pendiente_aceptacion' => 1,
            'aceptado' => 2,
            'enviando' => 3,
            'publicado' => 4,
            'esperando_hold_invoice' => 5,
            'cancelando' => 6,
            'tomado' => 7,
            'esperando_pago_vendedor' => 8,
            'cancelacion_solicitada' => 9,
            'activo' => 10,
            'funded' => 11,
            'fiat_sent' => 12,
            'fiat_received' => 13,
            'fiat_enviado' => 14,
            'liberando' => 15,
            'completado' => 16,
            'cancelado' => 17,
            'disputado' => 18,
            // `archivado` is a local UI-only state: the row stays in the DB and in /mostro/trades,
            // but it no longer appears in "Mis trades".
            'archivado' => 99,
        ];
        return $rank[$status] ?? -1;
    }

    static private function normalizeMostroTradeRow(array $row) {
        // Descifrado transparente (ver "CIFRADO EN REPOSO..." más arriba): filas viejas en hex plano
        // pasan sin cambios por decTradePrivkey(), filas ya migradas se descifran aquí.
        if (array_key_exists('trade_privkey', $row)) {
            $row['trade_privkey'] = self::decTradePrivkey($row['trade_privkey'] ?? '');
        }
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
        // mean "waiting for the instance's hold invoice", not "trade already active".
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
            "SELECT order_id, request_id, method, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_action,
                    status, internal_status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                    identity_fingerprint, trade_key_pub, trade_index, seed_index, peer_pubkey, dispute_id, solver_pubkey,
                    arbitrators, taproot_address, funding_txid, funding_vout, funding_block, confirmations,
                    trade_json, my_rating, archived, bond_paid, created_at, updated_at
             FROM NSTR_TRADES WHERE user_id = ?
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

    // El listado de la UI está paginado, pero los índices NIP-06 no pueden reutilizarse nunca,
    // tampoco cuando el trade antiguo quedó archivado o fuera de las primeras filas cargadas.
    // Devolver ambos máximos evita depender del límite de loadTrades().
    static function getMaxMostroDerivationIndex($userId) {
        $rows = self::sqlQueryPrepared(
            "SELECT MAX(COALESCE(trade_index, 0)) AS max_trade_index,
                    MAX(COALESCE(seed_index, 0)) AS max_seed_index
             FROM NSTR_TRADES
             WHERE user_id = ? AND method = 'lightning'",
            [(int)$userId]
        ) ?: [];
        $row = $rows[0] ?? [];
        $fromTrades = max(0, (int)($row['max_trade_index'] ?? 0), (int)($row['max_seed_index'] ?? 0));
        $stored = (int)self::getUserCfg((int)$userId, 'noxtr.mostro_last_derivation_index', '0');
        return max($fromTrades, $stored);
    }

    // Reserva atómica de un hijo NIP-06. El contador independiente sobrevive aunque se borre o
    // archive todo NSTR_TRADES y la actualización SQL impide que dos pestañas reciban el mismo N.
    static function reserveMostroDerivationIndex($userId, $minimum = 1) {
        $userId = (int)$userId;
        $minimum = max(1, (int)$minimum);
        $historical = self::getMaxMostroDerivationIndex($userId);
        $initial = max($historical, $minimum - 1);
        $key = 'noxtr.mostro_last_derivation_index';
        $now = time();
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        self::sqlQueryPrepared(
            "INSERT $ignore INTO CLI_USER_CFG (user_id, K, V, updated_at) VALUES (?, ?, ?, ?)",
            [$userId, $key, (string)$initial, $now]
        );
        if (self::isSQLite()) {
            self::sqlQueryPrepared(
                'UPDATE CLI_USER_CFG
                 SET V = CAST(MAX(CAST(V AS INTEGER) + 1, ?) AS TEXT), updated_at = ?
                 WHERE user_id = ? AND K = ?',
                [$minimum, $now, $userId, $key]
            );
        } else {
            self::sqlQueryPrepared(
                'UPDATE CLI_USER_CFG
                 SET V = CAST(GREATEST(CAST(V AS UNSIGNED) + 1, ?) AS CHAR), updated_at = ?
                 WHERE user_id = ? AND K = ?',
                [$minimum, $now, $userId, $key]
            );
        }
        $reserved = (int)self::getUserCfg($userId, $key, '0');
        return $reserved >= $minimum ? $reserved : 0;
    }

    // Simple insert for new trades (no state machine — fresh rows only)
    static function addTrade($userId, array $d) {
        $now = time();
        $cols = '(user_id, order_id, method, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_key_pub,
                  trade_index, seed_index, identity_fingerprint, internal_status, status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                  arbitrators, taproot_address, funding_txid, funding_vout, funding_block, confirmations,
                  trade_json, archived, created_at, updated_at)';
        $vals = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
        $method = ($d['method'] ?? 'lightning');
        if (!in_array($method, ['lightning', 'onchain'], true)) $method = 'lightning';
        $p = [
            (int)$userId,
            $d['order_id'] ?? ('tmp-'.uniqid('',true)),
            $method,
            $d['robot_pubkey'] ?? '',
            $d['trade_kind'] ?? 'sell',
            $d['trade_role'] ?? 'created',
            self::encTradePrivkey($d['trade_privkey'] ?? ''),
            $d['trade_key_pub'] ?? '',
            (int)($d['trade_index'] ?? 0),
            (int)($d['seed_index'] ?? 0),
            $d['identity_fingerprint'] ?? '',
            $d['internal_status'] ?? 'creado',
            $d['status'] ?? 'creado',
            (int)($d['is_seller'] ?? 0),
            $d['fiat_amount'] ?? '',
            $d['fiat_code'] ?? '',
            (int)($d['sat_amount'] ?? 0),
            $d['payment_method'] ?? '',
            $d['arbitrators'] ?? '',
            $d['taproot_address'] ?? '',
            $d['funding_txid'] ?? '',
            (int)($d['funding_vout'] ?? 0),
            (int)($d['funding_block'] ?? 0),
            (int)($d['confirmations'] ?? 0),
            $d['trade_json'] ?? null,
            (int)($d['archived'] ?? 0),
            $now, $now,
        ];
        if (self::isSQLite()) {
            self::sqlQueryPrepared("INSERT OR IGNORE INTO NSTR_TRADES $cols VALUES $vals", $p);
            // SQL seguro: literal sin variables (función SQLite, sin entrada de usuario).
            $row = self::sqlQuery("SELECT last_insert_rowid() AS lid");
            return $row[0]['lid'] ?? 0;
        }
        self::sqlQueryPrepared("INSERT IGNORE INTO NSTR_TRADES $cols VALUES $vals", $p);
        // SQL seguro: literal sin variables (función MySQL, sin entrada de usuario).
        $row = self::sqlQuery("SELECT LAST_INSERT_ID() AS lid");
        return $row[0]['lid'] ?? 0;
    }

    static function getTrade($userId, $orderId) {
        $rows = self::sqlQueryPrepared(
            "SELECT id, order_id, request_id, method, robot_pubkey, trade_kind, trade_role, trade_privkey, trade_action,
                    status, internal_status, is_seller, fiat_amount, fiat_code, sat_amount, payment_method,
                    identity_fingerprint, trade_key_pub, trade_index, seed_index, peer_pubkey, dispute_id, solver_pubkey,
                    arbitrators, taproot_address, funding_txid, funding_vout, funding_block, confirmations,
                    trade_json, my_rating, archived, bond_paid, created_at, updated_at
             FROM NSTR_TRADES
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
                    'trade_index','seed_index','identity_fingerprint','internal_status','status','trade_action','is_seller',
                    'method','fiat_amount','fiat_code','sat_amount','payment_method','peer_pubkey','dispute_id','solver_pubkey',
                    'arbitrators','taproot_address','funding_txid','funding_vout','funding_block','confirmations',
                    'trade_json','my_rating','archived','bond_paid'];
        $set = []; $p = [];
        foreach ($fields as $k => $v) {
            if (!in_array($k, $allowed, true)) continue;
            if ($k === 'trade_privkey') $v = self::encTradePrivkey((string)$v);
            $set[] = "$k = ?"; $p[] = $v;
        }
        if (!$set) return false;
        // Honor un updated_at explícito (el cliente lo pasa al re-procesar eventos históricos para no
        // "rejuvenecer" la fila al recargar). Si no viene o es <=0, usar el reloj del servidor.
        $explicitUpd = isset($fields['updated_at']) ? (int)$fields['updated_at'] : 0;
        $set[] = 'updated_at = ?'; $p[] = ($explicitUpd > 0 ? $explicitUpd : time());
        $p[] = (int)$userId; $p[] = $orderId;
        return self::sqlQueryPrepared('UPDATE NSTR_TRADES SET '.implode(', ',$set).' WHERE user_id = ? AND order_id = ?', $p);
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
            "DELETE FROM NSTR_TRADES WHERE user_id = ? AND order_id = ?",
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
        // UPSERT: si el topic ya existía (posiblemente inactivo), lo reactiva.
        $sql = self::isSQLite()
            ? "INSERT INTO NSTR_TOPICS (user_id, topic, created_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id, topic) DO UPDATE SET active = 1"
            : "INSERT INTO NSTR_TOPICS (user_id, topic, created_at) VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE active = 1";
        return self::sqlQueryPrepared($sql, [(int)$userId, $topic, time()]);
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
            "SELECT event_id, peer_pubkey, sender_pubkey, content_encrypted, event_created_at, COALESCE(nip_version, 4) AS nip_version
             FROM NSTR_MESSAGES WHERE user_id = ? ORDER BY event_created_at DESC LIMIT $limit",
            [(int)$userId]
        ) ?: [];
    }

    static function saveMessage($userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, $eventCreatedAt, $nipVersion = 4) {
        if (self::isExpiredMonitorDm($peerPubkey, $eventCreatedAt)) {
            return false;
        }
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_MESSAGES (user_id, event_id, peer_pubkey, sender_pubkey, content_encrypted, event_created_at, nip_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(int)$userId, $eventId, $peerPubkey, $senderPubkey, $contentEncrypted, (int)$eventCreatedAt, (int)$nipVersion, time()]
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

    // ---- NWC (Nostr Wallet Connect) ----

    static function getNwcUri($userId) {
        $row = self::sqlQueryPrepared(
            "SELECT nwc_uri FROM CLI_USER WHERE user_id = ? LIMIT 1",
            [(int)$userId]
        );
        $val = is_array($row) && isset($row[0]['nwc_uri']) ? $row[0]['nwc_uri'] : null;
        return ($val !== null && $val !== '') ? (string)$val : null;
    }

    static function setNwcUri($userId, $uri) {
        $uri = trim((string)$uri);
        self::sqlQueryPrepared(
            "UPDATE CLI_USER SET nwc_uri = ? WHERE user_id = ?",
            [$uri !== '' ? $uri : null, (int)$userId]
        );
    }

    // ---- RELAYS ----

    static function getRelays($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, url, active FROM NSTR_RELAYS WHERE user_id = ? ORDER BY id",
            [(int)$userId]
        ) ?: [];
    }

    /**
     * Relays de seguridad para el monitor cuando NSTR_RELAYS está vacía
     * (instalación nueva sin usuarios todavía). En cuanto haya relays activos
     * de usuarios, estos defaults dejan de usarse.
     */
    const DEFAULT_MONITOR_RELAYS = [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://relay.primal.net',
        'wss://relay.mostro.network',
    ];

    /**
     * Relays activos únicos de TODOS los usuarios (de NSTR_RELAYS).
     * Es la fuente única de relays del monitor: así escucha/publica en los
     * mismos relays a los que se conecta noxtr, sin una clave CFG aparte.
     * Devuelve [] de forma defensiva si la tabla aún no existe (contexto CLI sin web).
     *
     * @return string[]
     */
    static function getAllActiveRelayUrls() {
        try {
            $rows = self::sqlQueryPrepared(
                "SELECT DISTINCT url FROM NSTR_RELAYS WHERE active = 1",
                []
            );
        } catch (\Throwable $e) {
            return [];
        }

        $urls = [];
        if (is_array($rows)) {
            foreach ($rows as $r) {
                $u = rtrim(trim((string)($r['url'] ?? '')), '/');
                if ($u !== '') {
                    $urls[] = $u;
                }
            }
        }
        return $urls;
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

    // ---- NIP-96 FILE STORAGE SERVERS ----

    static function getNip96Servers($userId) {
        return self::sqlQueryPrepared(
            "SELECT id, url, active, sort_order FROM NSTR_NIP96_SERVERS WHERE user_id = ? ORDER BY sort_order, id",
            [(int)$userId]
        ) ?: [];
    }

    static function addNip96Server($userId, $url) {
        $url = rtrim(trim($url), '/');
        if (empty($url) || strlen($url) > 512) return false;
        if (!preg_match('#^https?://#i', $url)) return false;
        $ignore = self::isSQLite() ? 'OR IGNORE' : 'IGNORE';
        return self::sqlQueryPrepared(
            "INSERT $ignore INTO NSTR_NIP96_SERVERS (user_id, url, active, sort_order) VALUES (?, ?, 1, 0)",
            [(int)$userId, $url]
        );
    }

    static function removeNip96Server($userId, $serverId) {
        return self::sqlQueryPrepared(
            "DELETE FROM NSTR_NIP96_SERVERS WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$serverId]
        );
    }

    static function toggleNip96Server($userId, $serverId) {
        return self::sqlQueryPrepared(
            "UPDATE NSTR_NIP96_SERVERS SET active = 1 - active WHERE user_id = ? AND id = ?",
            [(int)$userId, (int)$serverId]
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

        // SELECT + UPDATE/INSERT, valido para MySQL y SQLite. No se usa ON DUPLICATE KEY porque
        // CFG_CFG no tiene indice UNIQUE en K: sin el, ON DUPLICATE KEY no dispara y cada llamada
        // insertaba una fila duplicada. El UPDATE sin LIMIT tambien reconcilia filas duplicadas
        // preexistentes (todas convergen al mismo valor).
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

    // ---- CIFRADO EN REPOSO DE NSTR_TRADES.trade_privkey (auditoría 2026-08-22, hallazgo "custodia") ----
    //
    // trade_privkey vivía en la BD como hex plano (VARCHAR(64)), visible entero ante un dump/backup
    // filtrado o una lectura no autorizada de la tabla. AES-256-GCM con clave del servidor (mismo
    // mecanismo ya usado para monitor_privkey/server_privkey vía CFG_CFG) no protege contra un
    // servidor de aplicación totalmente comprometido (la clave vive en la misma BD), pero sí contra
    // el escenario más común: un dump/backup de la BD que se filtra o se accede sin el resto del
    // stack. Mover la custodia completa al cliente (que el servidor nunca vea la clave) es un cambio
    // de arquitectura mayor — rompería la recuperación de trades entre dispositivos, que hoy depende
    // de que el servidor la guarde — y queda fuera de este arreglo.
    //
    // Prefijo 'enc1:' distingue valores ya cifrados de hex plano legacy: decTradePrivkey() hace
    // fallback transparente al valor tal cual si no lo lleva, así que las filas viejas se siguen
    // leyendo bien sin migración obligatoria previa (ver migrateEncryptTradePrivkeys() más abajo,
    // que además las convierte en segundo plano).
    private static function _tradePrivkeyCipherKey() {
        $b64 = self::getCfgValue('modules.noxtr.trade_privkey_enc_key', '');
        if ($b64 !== '') {
            $key = base64_decode($b64, true);
            if ($key !== false && strlen($key) === 32) return $key;
        }
        $key = random_bytes(32);
        self::setCfgValue('modules.noxtr.trade_privkey_enc_key', base64_encode($key),
            'Clave AES-256-GCM para cifrar NSTR_TRADES.trade_privkey en reposo (auto-generada)', 1);
        return $key;
    }

    static function encTradePrivkey($hex) {
        $hex = (string)$hex;
        if ($hex === '' || !function_exists('openssl_encrypt')) return $hex;
        $key = self::_tradePrivkeyCipherKey();
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($hex, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($ciphertext === false || strlen($tag) !== 16) return $hex; // fail-open: no romper el trade
        return 'enc1:' . base64_encode($iv . $tag . $ciphertext);
    }

    static function decTradePrivkey($stored) {
        $stored = (string)$stored;
        if ($stored === '' || strpos($stored, 'enc1:') !== 0) return $stored; // hex plano legacy, o vacío
        if (!function_exists('openssl_decrypt')) return '';
        $raw = base64_decode(substr($stored, 5), true);
        if ($raw === false || strlen($raw) < 29) return '';
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ciphertext = substr($raw, 28);
        $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', self::_tradePrivkeyCipherKey(), OPENSSL_RAW_DATA, $iv, $tag);
        return $plain === false ? '' : $plain;
    }

    // Backfill de filas preexistentes (hex plano) a cifradas. Idempotente — se puede llamar
    // cualquier número de veces, cada fila ya migrada se salta por el filtro NOT LIKE 'enc1:%'.
    // Disparada una sola vez desde ensureTables() vía el flag CFG modules.noxtr.trade_privkey_migrated_v1.
    static function migrateEncryptTradePrivkeys() {
        // SQL seguro: literal sin variables. El UPDATE de dentro del bucle usa
        // sqlQueryPrepared con parámetros vinculados.
        $rows = self::sqlQuery(
            "SELECT id, trade_privkey FROM NSTR_TRADES WHERE COALESCE(trade_privkey,'') <> '' AND trade_privkey NOT LIKE 'enc1:%'"
        ) ?: [];
        foreach ($rows as $row) {
            $enc = self::encTradePrivkey((string)($row['trade_privkey'] ?? ''));
            self::sqlQueryPrepared("UPDATE NSTR_TRADES SET trade_privkey = ? WHERE id = ?", [$enc, (int)$row['id']]);
        }
        return count($rows);
    }

    static function ensureMonitorIdentity() {
        $privKeyCfg = 'modules.noxtr.monitor_privkey';
        $pubKeyCfg = 'modules.noxtr.monitor_pubkey';
        $adminCfg = 'modules.noxtr.monitor_admin_pubkeys';

        $privkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_privkey'] ?? self::getCfgValue($privKeyCfg, '')));
        $pubkey = trim((string)(CFG::$vars['modules']['noxtr']['monitor_pubkey'] ?? self::getCfgValue($pubKeyCfg, '')));
        $adminsRaw = trim((string)(CFG::$vars['modules']['noxtr']['monitor_admin_pubkeys'] ?? self::getCfgValue($adminCfg, '')));

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

        // Los relays del monitor = los relays activos de los clientes noxtr (NSTR_RELAYS).
        // Config compartida: el monitor escucha/publica en los mismos relays que la web,
        // sin una clave CFG aparte. Solo si la tabla está vacía (instalación nueva sin
        // usuarios) se usan unos defaults de seguridad para poder arrancar.
        $relayUrls = self::getAllActiveRelayUrls();
        if (empty($relayUrls)) {
            $relayUrls = self::DEFAULT_MONITOR_RELAYS;
        }

        return [
            'privkey' => $privkey,
            'pubkey' => $pubkey,
            'npub' => $npub,
            'admin_pubkeys' => $adminPubkeys,
            'relays' => $relayUrls,
        ];
    }
}
