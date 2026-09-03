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
        <h2 class="noxtr-logo"><img src="media/images/logo.png"></h2>
        <div id="relay-dots" class="noxtr-dots"></div>
        <!--<a id="btn-relays" class="btn btn-sm">Relays</a>-->
        <!--<a id="btn-blog" href="/tag" class="btn btn-sm">Blog</a>-->
        <!--<a id="btn-blog" href="/timextamping" title="timextamping" class="btn btn-sm">TT</a>-->
        <a id="pv-btn-follow" class="btn btn-sm btn-primary" style="display:none"></a>
        <a id="pv-btn-share" class="btn btn-sm" style="padding-left: 4px;line-height:29px;" title="<?= t('NOXTR_SHARE_PROFILE') ?>"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></a>
<?php
        // Enlace al repositorio del modulo (codigo abierto).
        $noxtrRepoUrl = 'https://github.com/Nailuj2k/ExtFW-module-Noxtr';
?>
        <a id="btn-noxtr-repo" class="btn btn-sm" href="<?= htmlspecialchars($noxtrRepoUrl, ENT_QUOTES) ?>" target="_blank" rel="noopener noreferrer" style="padding-left:4px;line-height:29px;" title="<?= t('NOXTR_REPO_TITLE') ?>"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>
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

    <!-- Welcome panel: only for non-logged-in visitors, auto-shown on /noxtr -->
    <?php if (empty($_SESSION['valid_user'])): ?>
    <div id="welcome-panel" style="display:none;"><div class="noxtr-info">
        <?php include(__DIR__.'/doc/welcome_'.($_SESSION['lang'] ?? 'en').'.php'); ?>
    </div></div>
    <?php endif; ?>

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
            <label class="btn btn-sm" title="<?= t('NOXTR_LOAD_IDENTITY_BACKUP') ?>" style="cursor:pointer;margin:0">
                ⬆ Backup
                <input type="file" id="backup-login-file" accept=".json" style="display:none">
            </label>
        </div>

        <div id="identity-info"></div>

        <a id="btn-edit-profile" class="btn btn-sm btn-primary" style="display:none" title="<?= t('NOXTR_EDIT_PROFILE') ?>"><?= t('PROFILE') ?></a>

        <a id="btn-nip46-disconnect" class="btn btn-sm" style="display:none" title="<?= t('NOXTR_DISCONNECT_NOSTR_CONNECT') ?>"><?= t('DISCONNECT') ?></a>
        <a id="btn-bunker-open" class="btn btn-sm btn-bunker" style="display:none" title="<?= t('NOXTR_NIP46_SIGNER_HINT') ?>">NIP46</a>
        <?php if (Usuario()): ?>
        <a id="btn-nwc" class="btn btn-sm" title="<?= t('NOXTR_NWC_CONNECT_HINT') ?>">&#9889; NWC</a>
        <?php endif; ?>
        <div id="nsec-login" style="display:none">
            <input type="text" id="nsec-input" placeholder="<?= t('NOXTR_NPUB_OR_NSEC') ?>">
            <a id="btn-nsec-login" class="btn btn-sm">Login</a>
            <span class="nsec-safe-hint">🔒 <?= t('NOXTR_NEVER_LEAVES_BROWSER') ?></span>
        </div>

        <a id="btn-toggle-compose" class="btn btn-sm btn-compose-toggle" style="display:none;"><?= t('COMPOSE') ?> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></a>
    </div>

    <!-- Profile edit -->
    <div id="profile-edit" class="noxtr-panel" style="display:none">
        <div class="profile-fields">
            <label><span class="profile-field-label"><?= t('USERNAME') ?></span> <input type="text" id="profile-username" placeholder="usuario"></label>
            <div class="profile-field-hint" id="profile-username-hint"></div>
            <label><span class="profile-field-label"><?= t('EMAIL') ?></span> <input type="email" id="profile-user-email" placeholder="tu@email.com"></label>
            <div class="profile-field-hint"><?= t('NOXTR_ACCOUNT_EMAIL_HINT') ?></div>
            <label><span class="profile-field-label"><?= t('NAME') ?></span> <input type="text" id="profile-name" placeholder="<?= t('NOXTR_YOUR_DISPLAY_NAME') ?>"></label>
            <label><span class="profile-field-label"><?= t('ABOUT') ?></span> <input type="text" id="profile-about" placeholder="<?= t('NOXTR_SHORT_BIO') ?>"></label>
            <label><span class="profile-field-label"><?= t('PICTURE') ?></span> <input type="text" id="profile-picture" placeholder="<?= t('NOXTR_AVATAR_URL') ?>"></label>
            <label><span class="profile-field-label">NIP-05</span> <input type="text" id="profile-nip05" placeholder="you@domain.com"></label>
            <div class="profile-field-hint"><?= t('NOXTR_NIP05_HINT') ?></div>
        </div>
        <div class="profile-actions">
            <a id="btn-save-profile" class="btn btn-sm btn-primary"><?= t('SAVE') ?></a>
            <a id="btn-cancel-profile" class="btn btn-sm"><?= t('CANCEL') ?></a>
            <a id="btn-export-profile" class="btn btn-sm" title="<?= t('NOXTR_EXPORT_IDENTITY_BACKUP') ?>">⬇ <?= t('EXPORT') ?></a>
            <label id="btn-import-profile" class="btn btn-sm" title="<?= t('NOXTR_IMPORT_IDENTITY_BACKUP') ?>" style="cursor:pointer;margin:0">
                ⬆ <?= t('IMPORT') ?><input type="file" id="import-profile-file" accept=".json" style="display:none">
            </label>
            <a id="btn-show-nsec" class="btn btn-sm" title="<?= t('NOXTR_SHOW_PRIVATE_NSEC') ?>">🔑 nsec</a>
            <a id="btn-arbitrator-profile" class="btn btn-sm" title="<?= t('NOXTR_PUBLISH_ONCHAIN_ARBITRATOR_PROFILE') ?>"><?= t('NOXTR_ONCHAIN_ARBITRATOR') ?></a>
        </div>
    </div>

    <!-- Tabs -->
    <div class="noxtr-tabs">
        <a class="noxtr-tab active" data-tab="topics" title="<?= t('NOXTR_POSTS_BY_TOPIC') ?>"><?= t('TOPICS') ?></a>
        <a class="noxtr-tab" data-tab="following" title="<?= t('NOXTR_POSTS_FROM_FOLLOWING') ?>"><?= t('FOLLOWING') ?> <span class="tab-badge" id="badge-following"></span></a>
        <a class="noxtr-tab" data-tab="followers" title="<?= t('NOXTR_YOUR_FOLLOWERS') ?>"><?= t('FOLLOWERS') ?> <span class="tab-badge" id="badge-followers"></span></a>
        <a class="noxtr-tab" data-tab="messages" title="<?= t('NOXTR_ENCRYPTED_PRIVATE_MESSAGES') ?>"><?= t('MESSAGES') ?></a>
        <a class="noxtr-tab" data-tab="channels" title="<?= t('NOXTR_PUBLIC_CHAT_CHANNELS') ?>"><?= t('CHANNELS') ?></a>
        <a class="noxtr-tab" data-tab="bookmarks" title="<?= t('NOXTR_SAVED_NOTES') ?>"><?= t('BOOKMARKS') ?></a>
        <a class="noxtr-tab" data-tab="relays" title="<?= t('NOXTR_RELAY_MANAGEMENT') ?>"><?= t('RELAYS') ?></a>
        <a class="noxtr-tab" data-tab="mostro" title="<?= t('NOXTR_DECENTRALIZED_P2P_BITCOIN_MARKET') ?>"><?= t('MARKET') ?></a>
        <a id="btn-search" class="noxtr-tab noxtr-tab-search" title="<?= t('SEARCH') ?>"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></a>
    </div>

    <!-- Aviso de notificaciones de escritorio (lo rellena/oculta NoxtrNotify.renderBanner) -->
    <div id="noxtr-notif-banner" class="noxtr-notif-banner" style="display:none;"></div>

    <!-- Aviso "completa tu perfil" para cuentas con username autogenerado (n_xxxxxxxx) -->
    <div id="noxtr-profile-nudge-banner" class="noxtr-notif-banner" style="display:none;"></div>

    <!-- Thread view -->
    <div id="thread-view" style="display:none">
        <div class="thread-header">
            <a id="thread-back" class="btn btn-sm thread-back">&larr; <?= t('BACK') ?></a>
            <span class="thread-title"><?= t('THREAD') ?></span>
            <a id="thread-reply-btn" class="btn btn-sm btn-primary thread-reply-btn"><?= t('REPLY') ?></a>
        </div>
        <div id="thread-feed" class="noxtr-feed"></div>
        <div id="thread-compose" class="noxtr-compose" style="display:none">
            <textarea id="thread-compose-text" placeholder="<?= t('REPLY_ELLIPSIS') ?>" rows="2"></textarea>
            <div class="compose-footer">
                <span class="compose-hint">Ctrl+Enter</span>
                <a id="btn-thread-reply" class="btn btn-primary"><?= t('REPLY') ?></a>
            </div>
        </div>
    </div>

    <!-- Following panel (visible when Following tab active) -->
    <div id="panel-following" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="following-list"></div>
            <a class="collapsible-toggle" title="<?= t('EXPAND_COLLAPSE') ?>">&#9662;</a>
        </div>
        <div class="panel-add-row">
            <input type="text" id="follow-input" placeholder="<?= t('NOXTR_NPUB_OR_HEX_PUBKEY') ?>">
            <a id="btn-add-follow" class="btn btn-noxtr btn-primary">+</a>
        </div>
    </div>

    <!-- Topics panel (visible when Topics tab active) -->
    <div id="panel-topics" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="topics-list"></div>
            <a class="collapsible-toggle" title="<?= t('EXPAND_COLLAPSE') ?>">&#9662;</a>
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
            <p>🔒 <?= t('NOXTR_ENTER_NSEC_FOR_DMS') ?></p>
        </div>
        <div id="dm-conv-list"></div>
        <div id="dm-thread" style="display:none">
            <div class="dm-thread-header">
                <a id="dm-back" class="btn btn-noxtr">&larr;</a>
                <div id="dm-thread-avatar" class="dm-conv-avatar"></div>
                <strong id="dm-thread-name"></strong>
            </div>
            <div id="dm-messages" class="dm-messages"></div>
            <div class="dm-compose">
                <input type="text" id="dm-text" placeholder="<?= t('WRITE_A_MESSAGE_ELLIPSIS') ?>">
                <a id="btn-dm-send" class="btn btn-noxtr btn-primary"><?= t('SEND') ?></a>
            </div>
        </div>
        <div id="dm-new" class="panel-add-row">
            <select id="dm-contact-select">
                <option value="">-- <?= t('SELECT_CONTACT') ?> --</option>
            </select>
            <input type="text" id="dm-new-pubkey" placeholder="<?= t('NOXTR_OR_PASTE_NPUB_HEX') ?>">
            <a id="btn-dm-new" class="btn btn-noxtr"><?= t('CHAT') ?></a>
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
                <a id="channel-invite" class="btn btn-sm channel-header-btn" title="<?= t('INVITE_TO_CHANNEL') ?>"><i class="fa fa-share-alt"></i></a>
                <a id="channel-edit" class="btn btn-sm channel-header-btn" title="<?= t('EDIT_CHANNEL') ?>" style="display:none"><i class="fa fa-pencil"></i></a>
                <a id="channel-delete" class="btn btn-sm channel-header-btn" title="<?= t('DELETE_CHANNEL') ?>" style="display:none;color:#e53e3e;"><i class="fa fa-trash"></i></a>
            </div>
            <div id="channel-messages" class="dm-messages"></div>
            <div class="dm-compose" id="channel-compose" style="display:none">
                <input type="text" id="channel-text" placeholder="<?= t('WRITE_A_MESSAGE_ELLIPSIS') ?>">
                <a id="btn-channel-send" class="btn btn-noxtr btn-primary"><?= t('SEND') ?></a>
            </div>
        </div>
        <div id="channel-actions" class="panel-add-row">
            <input type="text" id="channel-id-input" placeholder="<?= t('NOXTR_CHANNEL_ID_OR_NOTE') ?>">
            <a id="btn-join-channel" class="btn btn-noxtr btn-primary"><?= t('JOIN') ?></a>
            <a id="btn-create-channel" class="btn btn-noxtr"><?= t('CREATE') ?></a>
        </div>
    </div>

    <!-- Followers panel (visible when Followers tab active) -->
    <div id="panel-followers" class="noxtr-sidepanel" style="display:none">
        <div class="collapsible-wrap">
            <div id="followers-list"></div>
            <a class="collapsible-toggle" title="<?= t('EXPAND_COLLAPSE') ?>">&#9662;</a>
        </div>
    </div>

    <!-- Relays panel (visible when Relays tab active) -->
    <div id="panel-relays" class="noxtr-sidepanel" style="display:none">
        <div id="relay-list"></div>
        <div class="panel-add-row">
            <input type="text" id="relay-input" placeholder="wss://relay.example.com">
            <a id="btn-add-relay" class="btn btn-noxtr btn-primary">+</a>
        </div>
        <!-- NIP-96 file storage servers section -->
        <div id="nip96-section" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e1e1e1;">
            <div style="font-size:0.85em; font-weight:600; color:#666; margin-bottom:6px;" title="<?= t('NOXTR_NIP96_SERVERS_HINT') ?>"><?= t('NOXTR_FILE_STORAGE_SERVERS') ?></div>
            <div id="nip96-list"></div>
            <div class="panel-add-row">
                <input type="text" id="nip96-input" placeholder="https://nostr.build">
                <a id="btn-add-nip96" class="btn btn-noxtr btn-primary">+</a>
            </div>
        </div>
        <!-- Muted users section (inside relays panel) -->
        <div id="muted-section" style="display:none; margin-top: 16px; padding-top: 12px; border-top: 1px solid #e1e1e1;">
            <div style="font-size:0.85em; font-weight:600; color:#666; margin-bottom:6px;"><?= t('MUTED_USERS') ?></div>
            <div id="muted-list" style="display:flex; flex-wrap:wrap; gap:6px;"></div>
        </div>
    </div>

    <!-- Mostro P2P panel -->
    <div id="panel-mostro" style="display:none">
        <div class="mostro-header-bar">
            <strong>&#8383; P2P</strong>
            <span class="mostro-info-link" title="<?= t('NOXTR_MOSTRO_INFO_TITLE') ?>">
                <?= t('NOXTR_MOSTRO_INFO_TEXT') ?>
                <a id="btn-mostro-my-trades" target="_blank" title="<?= t('NOXTR_VIEW_ARCHIVED_TRADES') ?>" href="/<?= MODULE ?>/mostro/trades"><?= t('NOXTR_ARCHIVED_TRADES') ?></a></span>
            <button id="btn-mostro-create-order"><?= t('CREATE_OFFER') ?></button>
        </div>
        <!-- Aviso "en pruebas" (dismissible, ver MostroTrader._renderBetaBanner en script.mostro.js) -->
        <div id="mostro-beta-banner" class="noxtr-notif-banner" style="display:none;"></div>
        <!-- Active trades (one card per trade) -->
        <div id="mostro-trades"></div>
        <!-- Communities (robot instances) -->
        <div id="mostro-communities"></div>
        <!-- External BTC/fiat reference price (visual only) -->
        <div id="mostro-price-reference"></div>
        <!-- Payment method filter chips -->
        <div id="mostro-pm-filters"></div>
        <!-- New orders banner -->
        <div id="mostro-new-banner" class="mostro-new-banner" style="display:none"></div>
        <!-- Order list -->
        <div id="mostro-orders">
            <div class="noxtr-empty"><?= t('NOXTR_SEARCHING_ORDERS') ?></div>
        </div>
    </div>

    <!-- Search panel (visible when search mode active) -->
    <div id="panel-search" class="noxtr-sidepanel" style="display:none">
        <div class="panel-add-row">
            <input type="text" id="search-input" placeholder="<?= t('SEARCH_NOTES_ELLIPSIS') ?>">
            <a id="btn-do-search" class="btn btn-noxtr btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></a>
        </div>
    </div>

    <!-- Article full view (NIP-23 long-form content) -->
    <div id="article-view" style="display:none">
        <div class="article-view-header">
            <a id="article-back" class="btn btn-noxtr">&larr; <?= t('BACK') ?></a>
        </div>
        <div id="article-view-content"></div>
        <div id="article-view-actions" class="note-actions" style="padding:12px 0"></div>
        <div class="article-replies-header" style="margin-top:16px;padding-top:12px;border-top:2px solid #e1e1e1">
            <strong><?= t('COMMENTS') ?></strong>
        </div>
        <div id="article-reply-compose" class="noxtr-compose" style="display:none">
            <textarea id="article-reply-text" placeholder="<?= t('COMMENT_ELLIPSIS') ?>" rows="2"></textarea>
            <div class="compose-footer">
                <span class="compose-hint">Ctrl+Enter</span>
                <a id="btn-article-reply" class="btn btn-primary"><?= t('COMMENT') ?></a>
            </div>
        </div>
        <div id="article-replies" class="noxtr-feed"></div>
    </div>

    <!-- Compose (visible in Topics, Following, and Reads) -->
    <div id="compose-area" class="noxtr-compose" style="display:none">
        <div id="reply-info" class="reply-info" style="display:none">
            <?= t('REPLYING_TO') ?> <strong class="reply-to-name"></strong>
            <a id="btn-cancel-reply" class="reply-cancel">&times;</a>
        </div>
        <div class="compose-mode-toggle">
            <a class="compose-mode active" data-mode="note"><?= t('NOTE') ?></a>
            <a class="compose-mode" data-mode="article"><?= t('ARTICLE') ?></a>
            <a class="compose-mode" data-mode="highlight"><?= t('NOXTR_HIGHLIGHT') ?></a>
        </div>
        <div id="compose-article-fields" style="display:none">
            <input type="text" id="article-title" class="ar-form-input" placeholder="<?= t('TITLE') ?>">
            <input type="text" id="article-summary" class="ar-form-input" placeholder="<?= t('SUMMARY_OPTIONAL') ?>">
            <input type="text" id="article-image" class="ar-form-input" placeholder="<?= t('FEATURED_IMAGE_URL_OPTIONAL') ?>">
            <input type="hidden" id="article-dtag" value="">
        </div>
        <div id="compose-highlight-fields" style="display:none">
            <div class="highlight-submode-toggle">
                <a class="highlight-submode active" data-submode="comment"><?= t('NOXTR_HIGHLIGHT_WITH_COMMENT') ?></a>
                <a class="highlight-submode" data-submode="context"><?= t('NOXTR_HIGHLIGHT_WITH_CONTEXT') ?></a>
            </div>
            <textarea id="highlight-quote" class="ar-form-input" rows="2" placeholder="<?= t('NOXTR_HIGHLIGHT_QUOTE_PH') ?>"></textarea>
            <textarea id="highlight-context" class="ar-form-input" rows="3" style="display:none" placeholder="<?= t('NOXTR_HIGHLIGHT_CONTEXT_PH') ?>"></textarea>
            <input type="text" id="highlight-source" class="ar-form-input" placeholder="<?= t('NOXTR_HIGHLIGHT_SOURCE_PH') ?>">
        </div>
        <textarea id="compose-text" placeholder="<?= t('WHATS_ON_YOUR_MIND') ?>" rows="3"></textarea>
        <div id="compose-image-preview" style="display:none"></div>
        <div class="compose-footer">
            <span class="compose-hint">Ctrl+Enter</span>
            <input type="text" id="compose-tags" class="compose-tags-input" placeholder="<?= t('TAGS_COMMA_SEPARATED') ?>">
            <span class="compose-toolbar">
                <a class="compose-fmt" data-fmt="bold" title="<?= t('BOLD') ?>"><i class="fa fa-bold"></i></a>
                <a class="compose-fmt" data-fmt="italic" title="<?= t('ITALIC') ?>"><i class="fa fa-italic"></i></a>
                <a class="compose-fmt" data-fmt="code" title="<?= t('CODE') ?>"><i class="fa fa-code"></i></a>
                <a class="compose-fmt" data-fmt="h1" title="<?= t('HEADING_1') ?>">H1</a>
                <a class="compose-fmt" data-fmt="h2" title="<?= t('HEADING_2') ?>">H2</a>
                <a class="compose-fmt" data-fmt="link" title="<?= t('LINK') ?>"><i class="fa fa-link"></i></a>
                <a class="compose-fmt" data-fmt="video" title="<?= t('VIDEO') ?>"><i class="fa fa-film"></i></a>
                <a class="compose-fmt" data-fmt="nowplaying" title="<?= t('NOW_PLAYING_SPOTIFY') ?>"><i class="fa fa-music"></i></a>
            </span>
            <input type="file" id="compose-image-input" accept="image/jpeg,image/png,image/gif,image/webp,audio/*,video/*,.mkv,application/pdf,.pdf,application/epub+zip,.epub" style="display:none">
            <a id="btn-attach-image" class="compose-attach-btn" title="<?= t('ATTACH_FILE') ?>"><i class="fa fa-paperclip"></i></a>
            <a id="btn-ar-profile" class="compose-attach-btn" title="<?= t('CREATE_AR_PROFILE') ?>"><i class="fa fa-id-card"></i></a>
            <a id="btn-publish" class="btn btn-noxtr btn-primary"><?= t('PUBLISH') ?></a>
        </div>
    </div>

    <div id="feed-type-filter" class="feed-type-filter" style="display:none">
        <a class="feed-type active" data-type="all"><?= t('ALL') ?> <span class="feed-type-count" id="filter-count-all">0</span></a>
        <a class="feed-type" data-type="notes" title="<?= t('NOXTR_FEED_NOTES_HINT') ?>"><?= t('NOXTR_FEED_NOTES') ?> <span class="feed-type-count" id="filter-count-notes">0</span></a>
        <a class="feed-type" data-type="reads" title="<?= t('NOXTR_FEED_READS_HINT') ?>"><?= t('NOXTR_FEED_READS') ?> <span class="feed-type-count" id="filter-count-reads">0</span></a>
        <a class="feed-type" data-type="quotes" title="<?= t('NOXTR_FEED_QUOTES_HINT') ?>"><?= t('NOXTR_FEED_QUOTES') ?> <span class="feed-type-count" id="filter-count-quotes">0</span></a>
    </div>
    <div id="feed-new" class="noxtr-feed-new" style="display:none;"></div>
    <div id="feed" class="noxtr-feed"></div>
    <div id="feed-loading" class="noxtr-loading"><?= t('CONNECTING_TO_RELAYS') ?></div>

<?php
    // Bloque de apoyo: software libre + boton de propina Lightning ([zap]).
    // La LN address se lee de CFG_CFG -> modules.noxtr.donate_lnaddress. Si esta vacia, no se muestra.
    $donateLnAddr = trim((string)(CFG::$vars['modules']['noxtr']['donate_lnaddress'] ?? NoxtrStore::getCfgValue('modules.noxtr.donate_lnaddress', '')));
    if ($donateLnAddr !== '') {
        echo '<div class="noxtr-support mostro-new-banner">';
        echo '<p style="margin:0 0 12px;font-size:14px;line-height:1.5;opacity:.85;">'
           . t('NOXTR_SUPPORT_TEXT')
           . '</p>';
        echo APP::$shortcodes->do_shortcode('[zap lnaddress="' . htmlspecialchars($donateLnAddr, ENT_QUOTES)
           . '" text="' . t('NOXTR_SUPPORT_BTN') . '"]');
        echo '</div>';
    }
?>

    <!-- AR Profile Modal -->
    <div id="ar-profile-modal" class="noxtr-modal" style="display:none">
        <div class="noxtr-modal-content ar-modal-wide">
            <div class="noxtr-modal-header">
                <span><i class="fa fa-id-card"></i> <?= t('CREATE_AR_PROFILE') ?></span>
                <a id="ar-modal-close" class="noxtr-modal-close">&times;</a>
            </div>
            <div class="noxtr-modal-body ar-form-body">
                <div class="ar-form-row">
                    <div class="ar-form-avatar-wrap">
                        <div id="ar-form-avatar-preview" class="ar-form-avatar-preview"></div>
                        <label class="ar-form-avatar-btn"><i class="fa fa-camera"></i> <?= t('PHOTO') ?><input type="file" id="ar-form-avatar" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
                    </div>
                    <div class="ar-form-fields">
                        <input type="text" id="ar-form-name" class="ar-form-input" placeholder="<?= t('NAME') ?>">
                        <input type="text" id="ar-form-bio" class="ar-form-input" placeholder="<?= t('SHORT_BIO') ?>">
                    </div>
                </div>
                <input type="text" id="ar-form-headline" class="ar-form-input" placeholder="<?= t('HEADLINE_STATUS') ?>">
                <input type="text" id="ar-form-tags" class="ar-form-input" placeholder="<?= t('TAGS_COMMA_SEPARATED') ?>">
                <div class="ar-form-links" id="ar-form-links">
                    <div class="ar-form-link-row">
                        <input type="text" class="ar-form-input ar-link-label" placeholder="<?= t('LABEL') ?>">
                        <input type="text" class="ar-form-input ar-link-url" placeholder="URL">
                    </div>
                </div>
                <a id="ar-form-add-link" class="ar-form-add-link"><i class="fa fa-plus"></i> <?= t('ADD_LINK') ?></a>
                <label class="ar-form-check"><input type="checkbox" id="ar-form-location"> <i class="fa fa-map-marker"></i> <?= t('INCLUDE_LOCATION') ?></label>
                <div class="ar-form-location-warn" style="display:none"><i class="fa fa-exclamation-triangle"></i> <?= t('NOXTR_LOCATION_WARNING') ?></div>
                <div class="ar-form-actions">
                    <a id="ar-form-preview" class="btn btn-noxtr"><?= t('PREVIEW') ?></a>
                    <a id="ar-form-publish" class="btn btn-noxtr btn-primary"><?= t('PUBLISH') ?></a>
                </div>
                <div id="ar-form-preview-area" style="display:none"></div>
            </div>
        </div>
    </div>

    <!-- Bunker Modal: pegar URI nostrconnect:// de la app externa -->
    <div id="bunker-modal" class="noxtr-modal" style="display:none">
        <div class="noxtr-modal-content">
            <div class="noxtr-modal-header">
                <span><?= t('NOXTR_CONNECT_AS_SIGNER') ?></span>
                <a id="bunker-modal-close" class="noxtr-modal-close">&times;</a>
            </div>
            <div class="noxtr-modal-body">
                <p><?= t('NOXTR_PASTE_NOSTRCONNECT_LINK') ?></p>
                <textarea id="bunker-uri-input" class="bunker-uri-input" placeholder="nostrconnect://..." rows="3"></textarea>
                <div class="bunker-actions">
                    <a id="btn-bunker-connect" class="btn btn-sm btn-primary"><?= t('CONNECT') ?></a>
                    <a id="btn-bunker-scan" class="btn btn-sm">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01M18 14h.01M14 18h.01M18 18h.01M21 14v.01M14 21v.01M21 21v.01"/></svg><?= t('SCAN_QR') ?></a>
                </div>
                <!-- Escáner QR con cámara (Html5Qrcode inyecta el video aquí) -->
                <div id="bunker-qr-scanner" style="display:none">
                    <div id="bunker-scan-video" class="bunker-scanner-wrap"></div>
                    <div id="bunker-scan-status" class="bunker-scan-status"></div>
                    <a id="btn-bunker-scan-stop" class="btn btn-sm"><?= t('CANCEL') ?></a>
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
                <p><?= t('NOXTR_SCAN_WITH_SIGNER_APP') ?></p>
                <div id="nip46-qr" class="nip46-qr"></div>
                <div id="nip46-uri" class="nip46-uri"></div>
                <a id="btn-nip46-copy" class="btn btn-noxtr"><?= t('COPY_URI') ?></a>
                <div id="nip46-status" class="nip46-status"><?= t('WAITING_FOR_CONNECTION') ?></div>
            </div>
        </div>
    </div>

<div id="noxtr-version">Noxtr v<?= $version ?></div>











<?php if(THEME!=='noxtr'){?>
</div>
<?php } ?>

<?php if(1==2){?>

    <nav id="noxtr-bottom-nav" class="noxtr-bottom-nav">
        <button class="noxtr-nav-btn active" data-nav="home" type="button" title="Inicio" aria-label="Inicio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"></path></svg>
        </button>
        <button class="noxtr-nav-btn" data-nav="search" type="button" title="Buscar" aria-label="Buscar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>
        <button class="noxtr-nav-btn" data-nav="market" type="button" title="Mercado" aria-label="Mercado">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"></path></svg>
        </button>
        <button class="noxtr-nav-btn" data-nav="messages" type="button" title="Mensajes" aria-label="Mensajes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><polyline points="22,6 12,13 2,6"></polyline></svg>
        </button>
        <button class="noxtr-nav-btn" data-nav="profile" type="button" title="Perfil" aria-label="Perfil">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        </button>
    </nav>

<?php } ?>
