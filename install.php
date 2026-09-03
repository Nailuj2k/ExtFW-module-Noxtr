<?php


    // setCfgValue hace SELECT + UPDATE/INSERT, así que es seguro ejecutar el install
    // varias veces sin crear filas duplicadas en CFG_CFG.
    $defaults = [
        'modules.noxtr.trade_notification_email' => ['true',                                           'If true, trade notifications will be sent via email'],
        'modules.noxtr.monitor_privkey'           => ['',                                              'Private key HEX for the Noxtr monitor identity'],
        'modules.noxtr.monitor_pubkey'            => ['',                                              'Public key HEX for the Noxtr monitor identity'],
        'modules.noxtr.monitor_admin_pubkeys'     => ['',                                              'Comma-separated HEX pubkeys allowed to control the monitor via Nostr'],
        'modules.noxtr.monitor_command_max_age'   => ['300',                                           'Maximum age in seconds for control DMs accepted by the monitor'],
        'modules.noxtr.monitor_profile_name'      => ['NoxtrMonitor',                                  'Display name for the Noxtr monitor Nostr profile'],
        'modules.noxtr.monitor_profile_about'     => ['Monitor automatico de Mostro / noxtr.',        'About/bio for the Noxtr monitor Nostr profile'],
        'modules.noxtr.monitor_profile_picture'   => [SCRIPT_HOST . '/media/images/logo.png',         'Absolute picture URL for the Noxtr monitor Nostr profile'],
        // monitor_relays se eliminó: los relays del monitor se derivan de NSTR_RELAYS
        // (los mismos que usa noxtr), con fallback en NoxtrStore::DEFAULT_MONITOR_RELAYS.
        'modules.noxtr.monitor_dm_ttl_hours'      => ['24',                                            'Hide and purge monitor DMs older than this number of hours; 0 disables the TTL'],
        'modules.noxtr.donate_lnaddress'          => ['',                                              'Lightning Address (LUD-16) for the support/donate [zap] button shown at the bottom of the module. Empty hides the support block'],
        'modules.noxtr.mostro_instances_url'      => ['https://noxtr.net/json',                        'URL returning the curated JSON list of Mostro instances ({name, hex|npub, active}). Fetched by the client to refresh its instance list. Empty disables remote refresh (falls back to the JS-embedded defaults)'],
        'modules.noxtr.trending_api_url'          => ['',                                              'Optional external API returning trending hashtags (JSON) to enrich anonymous default topics. May contain {lang}. Empty disables it (falls back to NOXTR_DEFAULT_TOPICS_CSV). Response: array of strings or objects with hashtag/tag/name/t/topic'],
        'btcpay.self_hosts'                       => [SCRIPT_HOST,'URL base of the self-hosted BTCPay server, used to generate invoices for donations. Empty disables it'],
    ];

    foreach ($defaults as $key => [$defaultValue, $description]) {
        // Solo inserta si la clave no existe todavía; no sobreescribe valores ya configurados
        $existing = NoxtrStore::getCfgValue($key);
        if ($existing === '') {
            NoxtrStore::setCfgValue($key, $defaultValue, $description);
        }
    }
    
    echo '<h1>'.t('NOXTR_MODULE_INSTALLED').'</h1><pre>';
    print_r(CFG::$vars['modules']['noxtr']);
    echo '</pre>';


?>

<p>

<?=t('RETURN_TO')?> <a href="/<?= MODULE ?>"><?= MODULE ?></a>

</p>
