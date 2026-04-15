<?php


    $sql_values = array();  

    if  (!isset(CFG::$vars['modules']['noxtr']['trade_notification_email'])) 
        $sql_values[] = "('modules.noxtr.trade_notification_email', 'true', 'If true, trade notifications will be sent via email',  1)"; 

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_privkey']))
        $sql_values[] = "('modules.noxtr.monitor_privkey', '', 'Private key HEX for the Noxtr monitor identity', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_pubkey']))
        $sql_values[] = "('modules.noxtr.monitor_pubkey', '', 'Public key HEX for the Noxtr monitor identity', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_admin_pubkeys']))
        $sql_values[] = "('modules.noxtr.monitor_admin_pubkeys', '', 'Comma-separated HEX pubkeys allowed to control the monitor via Nostr', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_command_max_age']))
        $sql_values[] = "('modules.noxtr.monitor_command_max_age', '300', 'Maximum age in seconds for control DMs accepted by the monitor', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_profile_name']))
        $sql_values[] = "('modules.noxtr.monitor_profile_name', 'MostroMonitor', 'Display name for the Noxtr monitor Nostr profile', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_profile_about']))
        $sql_values[] = "('modules.noxtr.monitor_profile_about', 'Monitor automatico de Mostro / noxtr. Envia avisos y admite control por DM de admins autorizados.', 'About/bio for the Noxtr monitor Nostr profile', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_profile_picture']))
        $sql_values[] = "('modules.noxtr.monitor_profile_picture', '".SCRIPT_HOST."/media/images/logo.png', 'Absolute picture URL for the Noxtr monitor Nostr profile', 1)";
    
    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_relays']))
        $sql_values[] = "('modules.noxtr.monitor_relays', 'wss://relay.mostro.network,wss://relay.kilombino.com', 'Comma-separated list of Nostr relays for the monitor', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_take_filters']))
        $sql_values[] = "('modules.noxtr.monitor_take_filters', '', 'JSON rules for ephemeral Mostro auto-take filters handled by server_monitor', 1)";

    if  (!isset(CFG::$vars['modules']['noxtr']['monitor_dm_ttl_hours']))
        $sql_values[] = "('modules.noxtr.monitor_dm_ttl_hours', '24', 'Hide and purge monitor DMs older than this number of hours; 0 disables the TTL', 1)";
    

    if(count($sql_values)>0){
        foreach ($sql_values as $sql){
            $_sql = "INSERT INTO CFG_CFG (K,V,DESCRIPTION,ACTIVE) VALUES ".$sql;
            Install::runsql($_sql);
        }
    }        
    
    echo '<h1>Noxtr module installed</h1><pre>';
    print_r(CFG::$vars['modules']['noxtr']);
    echo '</pre>';


?>

<p>

Return to <a href="/<?= MODULE ?>"><?= MODULE ?></a>

</p>
