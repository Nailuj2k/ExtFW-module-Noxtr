<?php if(THEME!=='noxtr'){?>      
   <div id="noxtr" class="noxtr-app">
   <?php
       
       $avatar_image = SCRIPT_DIR_IMAGES.'/avatars/avatar.gif';
       if ($_SESSION['valid_user']) $avatar_image = Login::getUrlAvatar();
      
       $banner_image = SCRIPT_DIR_MEDIA.'/nostr/banners/banner_'.$_SESSION['userid'].'.jpg';
       if (!file_exists($banner_image)) $banner_image = SCRIPT_DIR_MEDIA.'/nostr/banners/banner-default.jpg';

   ?>
 
    <img id="noxtr-banner" class="editable-banner noxtr-banner" src="<?=$banner_image?>" alt="Banner"
         style="position: relative; min-height: 80px; width: 100%;  ">
    <img id="noxtr-avatar" class="editable-avatar"
         style="position: relative;width:100px;height:100px;/*clip-path:circle(50%);*/border-radius:50px;margin-left:10px;margin-top:-55px;outline:4px solid white;" src="<?=$avatar_image?>">

<?php } ?>




    <!-- Header -->
    <div class="noxtr-header" id="noxtr-header">
        <h2 class="noxtr-logo">noxtr</h2>
        <div id="relay-dots" class="noxtr-dots"></div>
        <!--<a id="btn-relays" class="btn btn-sm">Relays</a>-->
        <!--<a id="btn-blog" href="/tag" class="btn btn-sm">Blog</a>-->
        <!--<a id="btn-blog" href="/timextamping" title="timextamping" class="btn btn-sm">TT</a>-->
        <a id="pv-btn-follow" class="btn btn-sm btn-primary" style="display:none"></a>
        <a id="pv-btn-share" class="btn btn-sm" style="padding-left: 4px;line-height:29px;" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Compartir perfil' : 'Share profile' ?>"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>
        <a id="btn-info" class="btn btn-sm">?</a>
    </div>

<?php

    // Esto carga el "panel de start stop status" YEPA

    if($_ACL->userHasRoleName('Root') && BOT_HOST && BOT_USER && BOT_PASS )
           include(SCRIPT_DIR_MODULE.'/server_admin.php');

?>


    <!-- Info panel -->
    <div id="info-panel" style="display:none;"><div class="noxtr-info">
        <?php include(__DIR__.'/doc/info_'.($_SESSION['lang'] ?? 'en').'.php'); ?>
    </div></div>


    <!-- Profile strip (always visible: shows own profile info, or viewed profile info) -->
    <div id="profile-strip">
        <span id="pv-name"></span>
        <span id="pv-nip05" style="display:none"></span>
        <span id="pv-about" style="display:none"></span>
        <span id="pv-stats" style="display:none"></span>
    </div>

    <!-- Identity -->
    <div class="noxtr-identity">
        <div id="nip46-connect" style="display:none;">
            <a id="btn-nip46-connect" class="btn btn-sm" style="margin-left: 0px;">Nostr Connect</a>
            <label class="btn btn-sm" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Cargar backup de identidad Nostr' : 'Load Nostr identity backup' ?>" style="cursor:pointer;margin:0">
                ⬆ Backup
                <input type="file" id="backup-login-file" accept=".json" style="display:none">
            </label>
        </div>

        <div id="identity-info"></div>

        <a id="btn-edit-profile" class="btn btn-sm" style="display:none">Profile</a>

        <a id="btn-nip46-disconnect" class="btn btn-sm" style="display:none">Disconnect</a>
        <a id="btn-bunker-open" class="btn btn-sm btn-bunker" style="display:none" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Usa Noxtr como firmador en otras webs' : 'Use Noxtr as signer for other sites' ?>">NIP-46</a>
        <div id="nsec-login" style="display:none">
            <input type="text" id="nsec-input" placeholder="<?= $_SESSION['lang'] === 'es' ? 'npub o nsec' : 'npub or nsec' ?>">
            <a id="btn-nsec-login" class="btn btn-sm">Login</a>
            <a id="btn-import-mostro-mobile" class="btn btn-sm" title="Importar identidad desde Mostro Mobile (12 palabras)">📲 Mostro Mobile</a>
            <span class="nsec-safe-hint">🔒 <?= $_SESSION['lang'] === 'es' ? 'No sale de tu navegador' : 'Never leaves your browser' ?></span>
        </div>

        <a id="btn-toggle-compose" class="btn btn-sm btn-compose-toggle" style="display:none;"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Escribir' : 'Compose' ?> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></a>
    </div>

    <!-- Profile edit -->
    <div id="profile-edit" class="noxtr-panel" style="display:none">
        <div class="profile-fields">
            <label>Name <input type="text" id="profile-name" placeholder="Your display name"></label>
            <label>About <input type="text" id="profile-about" placeholder="A short bio"></label>
            <label>Picture <input type="text" id="profile-picture" placeholder="https://... avatar URL"></label>
            <label>NIP-05 <input type="text" id="profile-nip05" placeholder="you@domain.com"></label>
        </div>
        <div class="profile-actions">
            <a id="btn-save-profile" class="btn btn-sm btn-primary">Save</a>
            <a id="btn-cancel-profile" class="btn btn-sm">Cancel</a>
            <a id="btn-export-profile" class="btn btn-sm" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Exportar backup de tu identidad Nostr' : 'Export your Nostr identity backup' ?>">⬇ Export</a>
            <label id="btn-import-profile" class="btn btn-sm" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Importar backup de identidad Nostr' : 'Import Nostr identity backup' ?>" style="cursor:pointer;margin:0">
                ⬆ Import<input type="file" id="import-profile-file" accept=".json" style="display:none">
            </label>
            <a id="btn-show-nsec" class="btn btn-sm" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Mostrar clave privada nsec (para importar en otras apps)' : 'Show private key nsec' ?>">🔑 nsec</a>
        </div>
    </div>


    <!-- Tabs -->
    <div class="noxtr-tabs">
        <a class="noxtr-tab active" data-tab="topics">Topics</a>
        <a class="noxtr-tab" data-tab="following">Following <span class="tab-badge" id="badge-following"></span></a>
        <a class="noxtr-tab" data-tab="followers">Followers <span class="tab-badge" id="badge-followers"></span></a>
        <a class="noxtr-tab" data-tab="messages">Messages</a>
        <a class="noxtr-tab" data-tab="channels">Channels</a>
        <a class="noxtr-tab" data-tab="bookmarks">Bookmarks</a>
        <a class="noxtr-tab" data-tab="relays">Relays</a>
        <a class="noxtr-tab" data-tab="mostro" title="Mercado P2P descentralizado de Bitcoin">Mostro</a>
        <a id="btn-search" class="noxtr-tab noxtr-tab-search" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Buscar' : 'Search' ?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></a>
    </div>


    <!-- Thread view -->
    <div id="thread-view" style="display:none">
        <div class="thread-header">
            <!--<a id="thread-back" class="btn btn-sm">&larr; <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Volver' : 'Back' ?></a>-->
            <span class="thread-title">Thread</span>
        </div>
        <div id="thread-feed" class="noxtr-feed"></div>
        <div id="thread-compose" class="noxtr-compose" style="display:none">
            <textarea id="thread-compose-text" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Responder...' : 'Reply...' ?>" rows="2"></textarea>
            <div class="compose-footer">
                <span class="compose-hint">Ctrl+Enter</span>
                <a id="btn-thread-reply" class="btn btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Responder' : 'Reply' ?></a>
            </div>
        </div>
    </div>
    
    <!-- Following panel (visible when Following tab active) -->
    <div id="panel-following" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="following-list"></div>
            <a class="collapsible-toggle" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Expandir / Colapsar' : 'Expand / Collapse' ?>">&#9662;</a>
        </div>
        <div class="panel-add-row">
            <input type="text" id="follow-input" placeholder="npub1... or hex pubkey">
            <a id="btn-add-follow" class="btn btn-noxtr btn-primary">+</a>
        </div>
    </div>

    <!-- Topics panel (visible when Topics tab active) -->
    <div id="panel-topics" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="topics-list"></div>
            <a class="collapsible-toggle" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Expandir / Colapsar' : 'Expand / Collapse' ?>">&#9662;</a>
        </div>
        <div id="topics-suggestions"></div>
        <div class="panel-add-row">
            <input type="text" id="topic-input" placeholder="#hashtag">
            <a id="btn-add-topic" class="btn btn-noxtr btn-primary">+</a>
        </div>
    </div>

    <!-- DM panel (visible when Messages tab active) -->
    <div id="panel-messages" style="display:none">
        <div id="dm-nsec-notice" class="dm-nsec-notice" style="display:none">
            <p><?= $_SESSION['lang'] === 'es'
                ? '🔒 Introduce tu nsec en el campo de Login de arriba para leer y enviar mensajes privados.'
                : '🔒 Enter your nsec in the Login field above to read and send private messages.' ?></p>
        </div>
        <div id="dm-conv-list"></div>
        <div id="dm-thread" style="display:none">
            <div class="dm-thread-header">
                <a id="dm-back" class="btn btn-noxtr">&larr;</a>
                <strong id="dm-thread-name"></strong>
            </div>
            <div id="dm-messages" class="dm-messages"></div>
            <div class="dm-compose">
                <input type="text" id="dm-text" placeholder="Write a message...">
                <a id="btn-dm-send" class="btn btn-noxtr btn-primary">Send</a>
            </div>
        </div>
        <div id="dm-new" class="panel-add-row">
            <select id="dm-contact-select">
                <option value="">-- Select contact --</option>
            </select>
            <input type="text" id="dm-new-pubkey" placeholder="or paste npub/hex">
            <a id="btn-dm-new" class="btn btn-noxtr">Chat</a>
        </div>
    </div>

    <!-- Channels panel (NIP-28 public chat) -->
    <div id="panel-channels" style="display:none">
        <div id="channel-list"></div>
        <div id="channel-room" style="display:none">
            <div class="channel-room-header">
                <a id="channel-back" class="btn btn-sm">&larr;</a>
                <strong id="channel-room-name"></strong>
                <span id="channel-room-about" style="color:#999;font-size:0.85em;margin-left:8px;flex:1;"></span>
                <a id="channel-invite" class="btn btn-sm channel-header-btn" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Invitar al canal' : 'Invite to channel' ?>"><i class="fa fa-share-alt"></i></a>
                <a id="channel-edit" class="btn btn-sm channel-header-btn" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Editar canal' : 'Edit channel' ?>" style="display:none"><i class="fa fa-pencil"></i></a>
                <a id="channel-delete" class="btn btn-sm channel-header-btn" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Borrar canal' : 'Delete channel' ?>" style="display:none;color:#e53e3e;"><i class="fa fa-trash"></i></a>
            </div>
            <div id="channel-messages" class="dm-messages"></div>
            <div class="dm-compose" id="channel-compose" style="display:none">
                <input type="text" id="channel-text" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Escribe un mensaje...' : 'Write a message...' ?>">
                <a id="btn-channel-send" class="btn btn-noxtr btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Enviar' : 'Send' ?></a>
            </div>
        </div>
        <div id="channel-actions" class="panel-add-row">
            <input type="text" id="channel-id-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'ID del canal (hex) o note1...' : 'Channel ID (hex) or note1...' ?>">
            <a id="btn-join-channel" class="btn btn-noxtr btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Unirse' : 'Join' ?></a>
            <a id="btn-create-channel" class="btn btn-noxtr"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Crear' : 'Create' ?></a>
        </div>
    </div>

    <!-- Followers panel (visible when Followers tab active) -->
    <div id="panel-followers" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="followers-list"></div>
            <a class="collapsible-toggle" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Expandir / Colapsar' : 'Expand / Collapse' ?>">&#9662;</a>
        </div>
    </div>

    <!-- Relays panel (visible when Relays tab active) -->
    <div id="panel-relays" class="noxtr-sidepanel" style="display:none">
        <div id="relay-list"></div>
        <div class="panel-add-row">
            <input type="text" id="relay-input" placeholder="wss://relay.example.com">
            <a id="btn-add-relay" class="btn btn-noxtr btn-primary">+</a>
        </div>
        <!-- Muted users section (inside relays panel) -->
        <div id="muted-section" style="display:none; margin-top: 16px; padding-top: 12px; border-top: 1px solid #e1e1e1;">
            <div style="font-size:0.85em; font-weight:600; color:#666; margin-bottom:6px;"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Usuarios silenciados' : 'Muted users' ?></div>
            <div id="muted-list" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
        </div>
    </div>

    <!-- Mostro P2P panel -->
    <div id="panel-mostro" style="display:none">
        <div class="mostro-header-bar">
            <strong>&#8383; Mostro P2P</strong>
            <span class="mostro-info-link" title="Compra o vende Bitcoin P2P a través de Nostr / Mostro">
                Órdenes de compra y venta de Bitcoin P2P. Pulsa "Comprar" o "Vender" en una orden para iniciar el intercambio. O crea una oferta para comprar o vender y espera a que alguien la tome.
                <a id="btn-mostro-my-trades" target="_blank" title="Ver trades archivados" href="/<?= MODULE ?>/mostro/trades">Trades archivados</a></span>
            <button id="btn-mostro-create-order">Crear oferta</button>
        </div>
        <!-- My reputation -->
        <div id="mostro-my-reputation" style="display:none"></div>
        <!-- Active trades (one card per trade) -->
        <div id="mostro-trades"></div>
        <!-- Communities (robot instances) -->
        <div id="mostro-communities"></div>
        <!-- Payment method filter chips -->
        <div id="mostro-pm-filters"></div>
        <!-- New orders banner -->
        <div id="mostro-new-banner" class="mostro-new-banner" style="display:none"></div>
        <!-- Order list -->
        <div id="mostro-orders">
            <div class="noxtr-empty">Buscando órdenes…</div>
        </div>
    </div>

    <!-- Search panel (visible when search mode active) -->
    <div id="panel-search" class="noxtr-sidepanel" style="display:none">
        <div class="panel-add-row">
            <input type="text" id="search-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Buscar notas...' : 'Search notes...' ?>">
            <a id="btn-do-search" class="btn btn-noxtr btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></a>
        </div>
    </div>

    <!-- Article full view (NIP-23 long-form content) -->
    <div id="article-view" style="display:none">
        <div class="article-view-header">
            <a id="article-back" class="btn btn-noxtr">&larr; <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Volver' : 'Back' ?></a>
        </div>
        <div id="article-view-content"></div>
        <div id="article-view-actions" class="note-actions" style="padding:12px 0"></div>
        <div class="article-replies-header" style="margin-top:16px;padding-top:12px;border-top:2px solid #e1e1e1">
            <strong><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Comentarios' : 'Comments' ?></strong>
        </div>
        <div id="article-reply-compose" class="noxtr-compose" style="display:none">
            <textarea id="article-reply-text" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Comentar...' : 'Comment...' ?>" rows="2"></textarea>
            <div class="compose-footer">
                <span class="compose-hint">Ctrl+Enter</span>
                <a id="btn-article-reply" class="btn btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Comentar' : 'Comment' ?></a>
            </div>
        </div>
        <div id="article-replies" class="noxtr-feed"></div>
    </div>

    <!-- Compose (visible in Topics, Following, and Reads) -->
    <div id="compose-area" class="noxtr-compose" style="display:none">
        <div id="reply-info" class="reply-info" style="display:none">
            Replying to <strong class="reply-to-name"></strong>
            <a id="btn-cancel-reply" class="reply-cancel">&times;</a>
        </div>
        <div class="compose-mode-toggle">
            <a class="compose-mode active" data-mode="note"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Nota' : 'Note' ?></a>
            <a class="compose-mode" data-mode="article"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Artículo' : 'Article' ?></a>
        </div>
        <div id="compose-article-fields" style="display:none">
            <input type="text" id="article-title" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Título' : 'Title' ?>">
            <input type="text" id="article-summary" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Resumen (opcional)' : 'Summary (optional)' ?>">
            <input type="text" id="article-image" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'URL de imagen destacada (opcional)' : 'Featured image URL (optional)' ?>">
            <input type="hidden" id="article-dtag" value="">
        </div>
        <textarea id="compose-text" placeholder="What's on your mind?" rows="3"></textarea>
        <div id="compose-image-preview" style="display:none"></div>
        <div class="compose-footer">
            <span class="compose-hint">Ctrl+Enter</span>
            <input type="text" id="compose-tags" class="compose-tags-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Tags (separados por coma)' : 'Tags (comma separated)' ?>">
            <span class="compose-toolbar">
                <a class="compose-fmt" data-fmt="bold" title="Bold"><i class="fa fa-bold"></i></a>
                <a class="compose-fmt" data-fmt="italic" title="Italic"><i class="fa fa-italic"></i></a>
                <a class="compose-fmt" data-fmt="code" title="Code"><i class="fa fa-code"></i></a>
                <a class="compose-fmt" data-fmt="h1" title="Heading 1">H1</a>
                <a class="compose-fmt" data-fmt="h2" title="Heading 2">H2</a>
                <a class="compose-fmt" data-fmt="link" title="Link"><i class="fa fa-link"></i></a>
                <a class="compose-fmt" data-fmt="video" title="Video"><i class="fa fa-film"></i></a>
            </span>
            <input type="file" id="compose-image-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none">
            <a id="btn-attach-image" class="compose-attach-btn" title="Adjuntar imagen"><i class="fa fa-image"></i></a>
            <a id="btn-ar-profile" class="compose-attach-btn" title="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Crear AR Profile' : 'Create AR Profile' ?>"><i class="fa fa-id-card"></i></a>
            <a id="btn-publish" class="btn btn-noxtr btn-primary">Publish</a>
        </div>
    </div>

    <div id="feed-type-filter" class="feed-type-filter" style="display:none">
        <a class="feed-type active" data-type="all"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Todo' : 'All' ?> <span class="feed-type-count" id="filter-count-all">0</span></a>
        <a class="feed-type" data-type="notes"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Notas' : 'Notes' ?> <span class="feed-type-count" id="filter-count-notes">0</span></a>
        <a class="feed-type" data-type="reads">Reads <span class="feed-type-count" id="filter-count-reads">0</span></a>
    </div>
    <div id="feed-new" class="noxtr-feed-new" style="display:none;"></div>
    <div id="feed" class="noxtr-feed"></div>
    <div id="feed-loading" class="noxtr-loading">Connecting to relays...</div>

    <!-- AR Profile Modal -->
    <div id="ar-profile-modal" class="noxtr-modal" style="display:none">
        <div class="noxtr-modal-content ar-modal-wide">
            <div class="noxtr-modal-header">
                <span><i class="fa fa-id-card"></i> <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Crear AR Profile' : 'Create AR Profile' ?></span>
                <a id="ar-modal-close" class="noxtr-modal-close">&times;</a>
            </div>
            <div class="noxtr-modal-body ar-form-body">
                <div class="ar-form-row">
                    <div class="ar-form-avatar-wrap">
                        <div id="ar-form-avatar-preview" class="ar-form-avatar-preview"></div>
                        <label class="ar-form-avatar-btn"><i class="fa fa-camera"></i> <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Foto' : 'Photo' ?><input type="file" id="ar-form-avatar" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
                    </div>
                    <div class="ar-form-fields">
                        <input type="text" id="ar-form-name" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Nombre' : 'Name' ?>">
                        <input type="text" id="ar-form-bio" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Bio corta' : 'Short bio' ?>">
                    </div>
                </div>
                <input type="text" id="ar-form-headline" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Titular / Estado' : 'Headline / Status' ?>">
                <input type="text" id="ar-form-tags" class="ar-form-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Tags (separados por coma)' : 'Tags (comma separated)' ?>">
                <div class="ar-form-links" id="ar-form-links">
                    <div class="ar-form-link-row">
                        <input type="text" class="ar-form-input ar-link-label" placeholder="Label">
                        <input type="text" class="ar-form-input ar-link-url" placeholder="URL">
                    </div>
                </div>
                <a id="ar-form-add-link" class="ar-form-add-link"><i class="fa fa-plus"></i> <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Añadir link' : 'Add link' ?></a>
                <label class="ar-form-check"><input type="checkbox" id="ar-form-location"> <i class="fa fa-map-marker"></i> <?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Incluir ubicación' : 'Include location' ?></label>
                <div class="ar-form-location-warn" style="display:none"><i class="fa fa-exclamation-triangle"></i> <?= ($_SESSION['lang'] ?? 'en') === 'es' ? '¡Cuidado! Cualquiera podrá saber dónde estás.' : 'Warning! Anyone will be able to see your location.' ?></div>
                <div class="ar-form-actions">
                    <a id="ar-form-preview" class="btn btn-noxtr"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Vista previa' : 'Preview' ?></a>
                    <a id="ar-form-publish" class="btn btn-noxtr btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Publicar' : 'Publish' ?></a>
                </div>
                <div id="ar-form-preview-area" style="display:none"></div>
            </div>
        </div>
    </div>

    <!-- Bunker Modal: pegar URI nostrconnect:// de la app externa -->
    <div id="bunker-modal" class="noxtr-modal" style="display:none">
        <div class="noxtr-modal-content">
            <div class="noxtr-modal-header">
                <span><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Autorizar conexiones' : 'Connect as signer' ?></span>
                <a id="bunker-modal-close" class="noxtr-modal-close">&times;</a>
            </div>
            <div class="noxtr-modal-body">
                <p><?= ($_SESSION['lang'] ?? 'en') === 'es'
                    ? 'Pega el enlace <strong>nostrconnect://</strong> que te muestra la web donde quieres entrar'
                    : 'Paste the <strong>nostrconnect://</strong> link shown by the site you want to log into' ?></p>
                <textarea id="bunker-uri-input" class="bunker-uri-input" placeholder="nostrconnect://..." rows="3"></textarea>
                <div class="bunker-actions">
                    <a id="btn-bunker-connect" class="btn btn-sm btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Conectar' : 'Connect' ?></a>
                    <a id="btn-bunker-scan" class="btn btn-sm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M21 14v.01M14 21v.01M21 21v.01"/></svg><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Leer QR' : 'Scan QR' ?></a>
                </div>
                <!-- Escáner QR con cámara (Html5Qrcode inyecta el video aquí) -->
                <div id="bunker-qr-scanner" style="display:none">
                    <div id="bunker-scan-video" class="bunker-scanner-wrap"></div>
                    <div id="bunker-scan-status" class="bunker-scan-status"></div>
                    <a id="btn-bunker-scan-stop" class="btn btn-sm"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Cancelar' : 'Cancel' ?></a>
                </div>
                <div id="bunker-status" class="bunker-status"></div>
                <div id="bunker-clients" style="display:none"></div>
            </div>
        </div>
    </div>

    <!-- NIP-46 Nostr Connect Modal -->
    <div id="nip46-modal" class="noxtr-modal" style="display:none">
        <div class="noxtr-modal-content">
            <div class="noxtr-modal-header">
                <span>Nostr Connect</span>
                <a id="nip46-modal-close" class="noxtr-modal-close">&times;</a>
            </div>
            <div class="noxtr-modal-body">
                <p><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Escanea con tu app firmante (Amber, nsec.app...)' : 'Scan with your signer app (Amber, nsec.app...)' ?></p>
                <div id="nip46-qr" class="nip46-qr"></div>
                <div id="nip46-uri" class="nip46-uri"></div>
                <a id="btn-nip46-copy" class="btn btn-noxtr"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Copiar URI' : 'Copy URI' ?></a>
                <div id="nip46-status" class="nip46-status"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Esperando conexión...' : 'Waiting for connection...' ?></div>
            </div>
        </div>
    </div>

<div style="text-align:right;font-size:0.7em;color:#aaa;padding:4px 8px 2px;opacity:0.8">v<?= $version ?></div>

<?php if(THEME!=='noxtr'){?>
</div>
<?php } ?>
