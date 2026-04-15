

<script>
document.addEventListener('DOMContentLoaded', function() {
    Noxtr.init({
        pubkey: '<?= (($_SESSION["auth_provider"] ?? "") === "nostr" && !empty($_SESSION["auth_id"])) ? htmlspecialchars($_SESSION["auth_id"], ENT_QUOTES) : "" ?>',
        ajaxUrl: '<?= Vars::mkUrl(MODULE, "ajax") ?>',
        userId: <?= (int)($_SESSION['userid'] ?? 0) ?>,
        username: '<?= htmlspecialchars($_SESSION["username"] ?? "", ENT_QUOTES) ?>',
        noteId: '<?= (($_ARGS[1] ?? '') === 'note' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        articleId: '<?= (($_ARGS[1] ?? '') === 'article' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        profileId: '<?= (($_ARGS[1] ?? '') === 'profile' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        tabId: '<?= in_array(($_ARGS[1] ?? ''), ['topics','following','followers','messages','channels','bookmarks','relays','search','mostro']) ? htmlspecialchars($_ARGS[1], ENT_QUOTES) : "" ?>',
        channelId: '<?= (($_ARGS[1] ?? '') === 'channels' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        orderId: '<?= (($_ARGS[1] ?? '') === 'mostro' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        peerId: '<?= (($_ARGS[1] ?? '') === 'messages' && !empty($_ARGS[2])) ? htmlspecialchars($_ARGS[2], ENT_QUOTES) : "" ?>',
        lang: '<?= htmlspecialchars($_SESSION["lang"] ?? "en", ENT_QUOTES) ?>',
        loginAjaxUrl: '<?= Vars::mkUrl("login", "ajax") ?>'
    });


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
