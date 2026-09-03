

<script>
document.addEventListener('DOMContentLoaded', function() {
    if (typeof tooltip === 'function') {
        // Static elements with title: identity bar, tabs, header, profile edit panel
        tooltip('.noxtr-identity [title], .noxtr-tabs [title], .noxtr-header [title], #profile-edit [title]', { theme: 'default', delay: 350 });
    }

    Noxtr.init({
        pubkey: '<?= (($_SESSION["auth_provider"] ?? "") === "nostr" && !empty($_SESSION["auth_id"])) ? htmlspecialchars($_SESSION["auth_id"], ENT_QUOTES) : "" ?>',
        ajaxUrl: '<?= Vars::mkUrl(MODULE, "ajax") ?>',
        userId: <?= (int)($_SESSION['userid'] ?? 0) ?>,
        username: '<?= htmlspecialchars($_SESSION["username"] ?? "", ENT_QUOTES) ?>',
        // Para el aviso "completa tu perfil" (banner #noxtr-profile-nudge). Lee directo de
        // TGRAM_CHATS (tabla del módulo telegram, ver su CLAUDE.md) sin pasar por la clase
        // TelegramBot -- no está autocargada aquí y el módulo telegram puede no estar instalado
        // en todos los sitios, así que se guarda en try/catch y se asume false si falla.
        telegramLinked: <?php
            $tgLinked = false;
            try {
                $tgRows = NoxtrStore::sqlQueryPrepared(
                    "SELECT chat_id FROM TGRAM_CHATS WHERE user_id = ? AND active = 1 LIMIT 1",
                    [(int)($_SESSION['userid'] ?? 0)]
                );
                $tgLinked = !empty($tgRows);
            } catch (\Throwable $e) {}
            echo $tgLinked ? 'true' : 'false';
        ?>,
        noteId: '<?= (($_ARGS[1] ?? '') === 'note' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        articleId: '<?= (($_ARGS[1] ?? '') === 'article' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        profileId: '<?= (($_ARGS[1] ?? '') === 'profile' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        tabId: '<?= in_array(($_ARGS[1] ?? ''), ['topics','following','followers','messages','channels','bookmarks','relays','search','mostro']) ? htmlspecialchars($_ARGS[1], ENT_QUOTES) : "" ?>',
        channelId: '<?= (($_ARGS[1] ?? '') === 'channels' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        orderId: '<?= (($_ARGS[1] ?? '') === 'mostro' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        peerId: '<?= (($_ARGS[1] ?? '') === 'messages' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        lang: '<?= htmlspecialchars($_SESSION["lang"] ?? "en", ENT_QUOTES) ?>',
        loginAjaxUrl: '<?= Vars::mkUrl("login", "ajax") ?>',
        // Relays del canal NIP-46 (peticiones al firmador, kind 24133). CFG modules.noxtr.nip46_relays
        // = lista separada por comas. Vacío => noxtr usa sus defaults hardcoded. Debe(n) aceptar 24133.
        nip46Relays: <?= json_encode(array_values(array_filter(array_map('trim', explode(',',
            (string)(CFG::$vars['modules']['noxtr']['nip46_relays']
                ?? NoxtrStore::getCfgValue('modules.noxtr.nip46_relays', ''))))))) ?>
    });

    // NostrEscrow on-chain extension (independiente de Noxtr Mostro).
    // Phase 1: stub sin subscripciones ni UI. Reusa Pool/Nip04/Events/Profiles del Noxtr core.
    if (typeof Onchain !== 'undefined' && Onchain.init) {
        Onchain.init({
            pubkey:   '<?= (($_SESSION["auth_provider"] ?? "") === "nostr" && !empty($_SESSION["auth_id"])) ? htmlspecialchars($_SESSION["auth_id"], ENT_QUOTES) : "" ?>',
            ajaxUrl:  '<?= Vars::mkUrl(MODULE, "ajax") ?>',
            userId:   <?= (int)($_SESSION['userid'] ?? 0) ?>,
            // Pubkey Bitcoin (x-only, 64 hex) del ADMIN DE LA WEB, usada por defecto como arb1 (tier
            // site_admin) en las órdenes on-chain creadas en este Noxtr. Es el operador del sitio, NO el
            // admin de Mostro. null = sin default; se cae a selección determinista del pool profesional.
            // CFG: modules.noxtr.onchain_site_arbitrator (fallback a onchain_default_arbitrator).
            defaultSiteArbitrator: <?= json_encode(
                (string)(CFG::$vars['modules']['noxtr']['onchain_site_arbitrator']
                    ?? NoxtrStore::getCfgValue('modules.noxtr.onchain_site_arbitrator',
                        (string)(CFG::$vars['modules']['noxtr']['onchain_default_arbitrator']
                            ?? NoxtrStore::getCfgValue('modules.noxtr.onchain_default_arbitrator', ''))))
            ) ?: 'null' ?>,
            // ¿Puede el usuario actual designar el árbitro del sitio? Solo Root/Administradores.
            // El botón "Usar como árbitro del sitio" del diálogo de árbitro se muestra con esto;
            // el endpoint set_site_arbitrator re-verifica el rol server-side igualmente.
            onchainIsAdmin: <?= (Root() || Administrador()) ? 'true' : 'false' ?>,
            // Identidades Nostr de árbitros ocultadas por el operador del sitio (CSV de pubkeys hex).
            // El cliente las filtra del selector. CFG: modules.noxtr.onchain_blocked_arbitrators.
            blockedArbitrators: <?= json_encode(array_values(array_filter(array_map('trim', explode(',', strtolower(
                (string)(CFG::$vars['modules']['noxtr']['onchain_blocked_arbitrators']
                    ?? NoxtrStore::getCfgValue('modules.noxtr.onchain_blocked_arbitrators', ''))
            )))))) ?>
        });
    }


    <?php if($_SESSION['userid']) {  ?>
        
 
        function OnUploadSuccessCallback(src, imageId){
            if (window.NOXTR_DEBUG === true || localStorage.getItem('noxtr_debug') === '1') console.log('OnUploadSuccessCallback',src,imageId);
            document.body.querySelectorAll(`img[src='./${src}']`).forEach(img => img.src = src);

            // Sync uploaded image to Nostr profile (kind 0)
            if (typeof Noxtr !== 'undefined' && Noxtr.Events && Noxtr.Events.canSign()) {
                var absUrl = location.origin + '/' + src.replace(/^\.?\//, '');
                var existing = (Noxtr.Profiles && Noxtr.Profiles.get(Noxtr.Events.pubkey)) || {};

                var profile = {
                    name: existing.name || existing.display_name || '',
                    display_name: existing.display_name || existing.name || '',
                    about: existing.about || '',
                    picture: existing.picture || '',
                    banner: existing.banner || '',
                    nip05: existing.nip05 || '',
                    lud16: existing.lud16 || '',
                    lud06: existing.lud06 || ''
                };
                if (imageId === 'noxtr-banner') {
                    profile.banner = absUrl;
                } else if (imageId === 'noxtr-avatar') {
                    profile.picture = absUrl;
                }
                if (window.NOXTR_DEBUG === true || localStorage.getItem('noxtr_debug') === '1') console.log('Noxtr: syncing', imageId, 'to Nostr profile');
                Noxtr.Events.publishProfile(profile).then(function() {
                    if (window.NOXTR_DEBUG === true || localStorage.getItem('noxtr_debug') === '1') console.log('Noxtr: profile synced to relays (' + imageId + ')');
                    if (Noxtr.UI) Noxtr.UI.updateIdentity();
                }).catch(function(e) { console.warn('Noxtr: failed to publish profile:', e); });
            }
        }

        ImageEditor.editable_images('.editable-banner','/control_panel/ajax/op=function/function=imagereceive/type=banner/table=<?=TB_USER?>/id=<?=$_SESSION['userid']?>',OnUploadSuccessCallback);         
        ImageEditor.editable_images('.editable-avatar','/control_panel/ajax/op=function/function=imagereceive/type=avatar/table=<?=TB_USER?>/id=<?=$_SESSION['userid']?>',OnUploadSuccessCallback);         
 
    <?php } ?>
 
});
</script>


<?php
    if($_ACL->userHasRoleName('Root')) 
        include_once(SCRIPT_DIR_MODULE.'/server_footer.php');
?>

<script>
// PWA: registrar Service Worker (habilita "Añadir a pantalla de inicio")
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/_js_/sw.js').catch(function(err) {
        console.warn('SW registration failed:', err);
    });
}
</script>
