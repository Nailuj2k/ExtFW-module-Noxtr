<div class="inner">
<?php

    // Esto carga el "panel de start stop status" YEPA

    if($_ACL->userHasRoleName('Root') && BOT_HOST && BOT_USER && BOT_PASS )
           include(SCRIPT_DIR_MODULE.'/server_admin.php');


    Table::init();


    Table::show_tabs( '',
                     ['NSTR_NOXTR_SITES'=>t('SITES')
                    , 'NSTR_EVENTS'=>t('EVENTS')
                    
                    , 'NSTR_CONTACTS'=>'Contacts'
                    , 'NSTR_TOPICS'=>'Topics'
                    , 'NSTR_BOOKMARKS'=>'Bookmarks'
                    , 'NSTR_MESSAGES'=>'Messages'
                    , 'NSTR_RELAYS'=>'Relays'
                    , 'NSTR_MUTED'=>'Muted'
                    , 'NSTR_CHANNELS'=>'Channels'
                    , 'NSTR_TRADES'=>'Trades'
                    , 'NSTR_NOXTR_SITES'=>'Noxtr Sites'
                    , 'NSTR_NIP96_SERVERS'=>'NIP-96 Servers'
                    , 'NSTR_EVENTS'=>'Events'
                     ]);










/**
 * 
 * 
 *             // Seed default relays for current user if none exist
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


        if (!self::tableHasColumn('CLI_USER', 'nwc_uri')) {
            self::sqlExec(self::isSQLite()
                ? "ALTER TABLE CLI_USER ADD COLUMN nwc_uri TEXT DEFAULT NULL"
                : "ALTER TABLE CLI_USER ADD COLUMN nwc_uri VARCHAR(512) DEFAULT NULL"
            );
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
        
 * 
 */






?>
</div>
