# NIP-28 Public Chat Channels — Implementation Guide

> This document is a complete, self-contained blueprint for adding NIP-28 public chat channels to the Noxtr module.
> Any AI agent can follow these instructions without prior context. Read `CLAUDE.md` first for general project architecture.

---

## 1. NIP-28 Protocol Summary

NIP-28 defines public chat channels on Nostr using three event kinds:

| Kind | Name | Purpose | Tags |
|------|------|---------|------|
| **40** | Channel Create | Creates a new channel | Content = JSON `{"name":"...","about":"...","picture":"..."}` |
| **41** | Channel Metadata | Updates channel metadata (replaceable by author) | `["e", <channel_create_event_id>, <relay_url>]` + Content = JSON metadata |
| **42** | Channel Message | A message in a channel | `["e", <channel_create_event_id>, <relay_url>, "root"]` + optional `["e", <reply_msg_id>, <relay_url>, "reply"]` for threading |

### Key Rules
- The **channel ID** is the `id` of the kind 40 event that created it
- Only the original creator (kind 40 author) can publish kind 41 metadata updates
- Kind 42 messages MUST have an `e` tag pointing to the kind 40 channel creation event with marker `"root"`
- Kind 42 messages MAY have additional `e` tags with marker `"reply"` for threading within a channel
- Messages are **public** (not encrypted) — anyone can read them
- Channel metadata is taken from the most recent kind 41 event by the channel creator, falling back to kind 40 content

### Relay Recommendations
For discovery, use relays that support NIP-28. These are known to work:
- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`

---

## 2. Architecture Overview

The implementation follows the existing **DMs module** pattern exactly. The DMs module (`script.js` lines 739-938) is the template.

### Parallel with DMs

| DMs (NIP-04) | Channels (NIP-28) |
|---|---|
| `var DMs = { ... }` | `var Channels = { ... }` |
| `DMs.convos = {}` (keyed by peer pubkey) | `Channels.rooms = {}` (keyed by channel_id) |
| `DMs.subscribe()` — kinds [4] | `Channels.subscribe()` — kinds [42] |
| `DMs.handleEvent(ev)` | `Channels.handleEvent(ev)` |
| `DMs.sendMessage(pk, text)` — encrypt + kind 4 | `Channels.sendMessage(channelId, text)` — plaintext kind 42 |
| `DMs.renderConvos()` → `#dm-conv-list` | `Channels.renderList()` → `#channel-list` |
| `DMs.openThread(pk)` | `Channels.openRoom(channelId)` |
| `DMs.renderThread(pk)` → `#dm-messages` | `Channels.renderMessages(channelId)` → `#channel-messages` |
| `DMs.closeThread()` | `Channels.closeRoom()` |
| `#panel-messages` | `#panel-channels` |
| Tab `messages` | Tab `channels` |

### Key Differences from DMs
1. **No encryption** — messages are plaintext (kind 42 content is plain text, not NIP-04 encrypted)
2. **Channel discovery** — need to fetch kind 40/41 events for channel metadata
3. **Many-to-many** — all users in a channel see all messages (vs. 1-to-1 in DMs)
4. **Channel creation** — users can create new channels (kind 40)
5. **No `peer_pubkey`** — messages are grouped by channel_id, not by peer

---

## 3. Database Changes

### New Table: `NSTR_CHANNELS`

Add to `NoxtrStore::ensureTables()` (after the `NSTR_MUTED` table creation).

**SQLite version:**
```sql
CREATE TABLE IF NOT EXISTS NSTR_CHANNELS (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel_id TEXT NOT NULL,        -- hex id of the kind 40 event
    name TEXT DEFAULT '',
    about TEXT DEFAULT '',
    picture TEXT DEFAULT '',
    creator_pubkey TEXT DEFAULT '',
    relay_url TEXT DEFAULT '',
    pinned INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_nstr_channels_user ON NSTR_CHANNELS(user_id);
```

**MySQL version:**
```sql
CREATE TABLE IF NOT EXISTS NSTR_CHANNELS (
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
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
```

### Bump version
Change `$_SESSION['noxtr_tables_v']` check from `>= 2` to `>= 3` and set it to `3` at the end of `ensureTables()`.

### NoxtrStore Methods

Add these static methods to `noxtrstore.class.php`:

```php
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
```

---

## 4. AJAX Endpoints

Add to `ajax.php` after the `save_message` case block (around line 148):

```php
// ---- CHANNELS (NIP-28) ----
case 'get_channels':
    $result['data'] = NoxtrStore::getChannels($userId);
    break;

case 'add_channel':
    $channelId = $_ARGS['channel_id'] ?? '';
    $name = trim($_ARGS['name'] ?? '');
    $about = trim($_ARGS['about'] ?? '');
    $picture = trim($_ARGS['picture'] ?? '');
    $creatorPubkey = $_ARGS['creator_pubkey'] ?? '';
    $relayUrl = $_ARGS['relay_url'] ?? '';
    if (strlen($channelId) === 64 && ctype_xdigit($channelId) && $name !== '') {
        NoxtrStore::addChannel($userId, $channelId, $name, $about, $picture, $creatorPubkey, $relayUrl);
    } else {
        $result = ['error' => 1, 'msg' => 'Invalid channel'];
    }
    break;

case 'remove_channel':
    $channelId = $_ARGS['channel_id'] ?? '';
    if (strlen($channelId) === 64 && ctype_xdigit($channelId)) {
        NoxtrStore::removeChannel($userId, $channelId);
    } else {
        $result = ['error' => 1, 'msg' => 'Invalid channel_id'];
    }
    break;

case 'toggle_channel_pin':
    $channelId = $_ARGS['channel_id'] ?? '';
    if (strlen($channelId) === 64 && ctype_xdigit($channelId)) {
        NoxtrStore::toggleChannelPin($userId, $channelId);
    } else {
        $result = ['error' => 1, 'msg' => 'Invalid channel_id'];
    }
    break;
```

---

## 5. HTML Panel (run.php)

Add a new tab in the tabs bar and a new panel. Insert the tab link **after the `messages` tab** and the panel **after `#panel-messages`**.

### Tab Link
In the `.noxtr-tabs` div (around line 78), add:
```php
<a class="noxtr-tab" data-tab="channels">Channels</a>
```

### Panel HTML
After the closing `</div>` of `#panel-messages` (around line 155), add:
```php
<!-- Channels panel (NIP-28 public chat) -->
<div id="panel-channels" style="display:none">
    <div id="channel-list"></div>
    <div id="channel-room" style="display:none">
        <div class="channel-room-header">
            <a id="channel-back" class="btn btn-sm">&larr;</a>
            <strong id="channel-room-name"></strong>
            <span id="channel-room-about" style="color:#999;font-size:0.85em;margin-left:8px;"></span>
            <a id="channel-invite" class="channel-header-btn" title="Invite link"><i class="fa fa-share-alt"></i></a>
            <a id="channel-edit" class="channel-header-btn" title="Edit channel" style="display:none"><i class="fa fa-pencil"></i></a>
        </div>
        <div id="channel-messages" class="dm-messages"></div>
        <div class="dm-compose" id="channel-compose" style="display:none">
            <input type="text" id="channel-text" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Escribe un mensaje...' : 'Write a message...' ?>">
            <a id="btn-channel-send" class="btn btn-sm btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Enviar' : 'Send' ?></a>
        </div>
    </div>
    <div id="channel-actions" class="panel-add-row">
        <input type="text" id="channel-id-input" placeholder="<?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'ID del canal (hex) o buscar...' : 'Channel ID (hex) or search...' ?>">
        <a id="btn-join-channel" class="btn btn-sm btn-primary"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Unirse' : 'Join' ?></a>
        <a id="btn-create-channel" class="btn btn-sm"><?= ($_SESSION['lang'] ?? 'en') === 'es' ? 'Crear' : 'Create' ?></a>
    </div>
</div>
```

---

## 6. JavaScript Module (script.js)

Insert the `Channels` module **after the DMs module** (after line ~938, before the `Stats` module). Follow the exact same code style — `var` declarations, no arrow functions, `function` keyword, same patterns.

### Complete `Channels` Module

```javascript
// ==================== CHANNELS (NIP-28 Public Chat) ====================

var Channels = {
    rooms: {},        // { channelId: { name, about, picture, creator, messages: [] } }
    joined: [],       // array of { channel_id, name, about, picture, creator_pubkey, relay_url, pinned }
    subId: null,
    metaSubId: null,
    currentRoom: null,
    _seen: {},        // dedup message events

    // Load joined channels from DB
    loadFromDb: async function() {
        var r = await Api.call('get_channels');
        if (r.error || !r.data) return;
        this.joined = r.data;
        for (var i = 0; i < this.joined.length; i++) {
            var ch = this.joined[i];
            if (!this.rooms[ch.channel_id]) {
                this.rooms[ch.channel_id] = {
                    name: ch.name, about: ch.about, picture: ch.picture,
                    creator: ch.creator_pubkey, messages: []
                };
            }
        }
    },

    // Save channel to DB
    saveToDb: function(channelId, name, about, picture, creatorPubkey, relayUrl) {
        Api.call('add_channel', {
            channel_id: channelId, name: name, about: about || '',
            picture: picture || '', creator_pubkey: creatorPubkey || '',
            relay_url: relayUrl || ''
        });
    },

    // Subscribe to messages in all joined channels
    subscribe: function() {
        if (!this.joined.length) return;
        if (this.subId) Pool.unsubscribe(this.subId);
        var channelIds = this.joined.map(function(ch) { return ch.channel_id; });
        var self = this;
        // Subscribe to kind 42 messages in joined channels
        this.subId = Pool.subscribe(
            [{ kinds: [42], '#e': channelIds, limit: 200 }],
            function(ev) { self.handleMessage(ev); },
            function() {
                // On EOSE, render the current room if open
                if (self.currentRoom) self.renderMessages(self.currentRoom);
            }
        );
    },

    // Subscribe to a single channel's messages (when opening a room)
    subscribeRoom: function(channelId) {
        if (this.subId) Pool.unsubscribe(this.subId);
        var self = this;
        this.subId = Pool.subscribe(
            [{ kinds: [42], '#e': [channelId], limit: 200 }],
            function(ev) { self.handleMessage(ev); },
            function() { self.renderMessages(channelId); }
        );
    },

    // Fetch channel metadata (kind 40 + 41)
    fetchMeta: function(channelId) {
        if (this.metaSubId) Pool.unsubscribe(this.metaSubId);
        var self = this;
        this.metaSubId = Pool.subscribe(
            [{ ids: [channelId], kinds: [40] }, { kinds: [41], '#e': [channelId] }],
            function(ev) {
                try {
                    var meta = JSON.parse(ev.content);
                    var room = self.rooms[channelId];
                    if (!room) {
                        self.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
                        room = self.rooms[channelId];
                    }
                    if (ev.kind === 40) {
                        room.creator = ev.pubkey;
                        // Set initial metadata from creation event
                        if (!room.name && meta.name) room.name = meta.name;
                        if (!room.about && meta.about) room.about = meta.about;
                        if (!room.picture && meta.picture) room.picture = meta.picture;
                    } else if (ev.kind === 41 && ev.pubkey === room.creator) {
                        // Only the creator can update metadata
                        if (meta.name) room.name = meta.name;
                        if (meta.about) room.about = meta.about;
                        if (meta.picture !== undefined) room.picture = meta.picture;
                    }
                } catch(e) { /* invalid JSON metadata */ }
            },
            function() {
                // After EOSE, update header if room is open
                if (self.currentRoom === channelId) {
                    var room = self.rooms[channelId];
                    if (room) {
                        var nameEl = document.getElementById('channel-room-name');
                        var aboutEl = document.getElementById('channel-room-about');
                        if (nameEl) nameEl.textContent = room.name || channelId.slice(0, 12) + '...';
                        if (aboutEl) aboutEl.textContent = room.about || '';
                    }
                }
            }
        );
    },

    // Handle incoming kind 42 message event
    handleMessage: function(ev) {
        if (ev.kind !== 42) return;
        if (this._seen[ev.id]) return;
        this._seen[ev.id] = true;

        // Check muted
        if (typeof Muted !== 'undefined' && Muted.has && Muted.has(ev.pubkey)) return;

        // Find channel_id from e-tag with "root" marker
        var channelId = null;
        for (var i = 0; i < ev.tags.length; i++) {
            if (ev.tags[i][0] === 'e') {
                if (ev.tags[i][3] === 'root') { channelId = ev.tags[i][1]; break; }
                if (!channelId) channelId = ev.tags[i][1]; // fallback: first e-tag
            }
        }
        if (!channelId) return;

        // Initialize room if not exists
        if (!this.rooms[channelId]) {
            this.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
        }

        var room = this.rooms[channelId];
        // Dedup within room
        for (var j = 0; j < room.messages.length; j++) {
            if (room.messages[j].id === ev.id) return;
        }

        room.messages.push({
            id: ev.id,
            pubkey: ev.pubkey,
            content: ev.content,
            created_at: ev.created_at,
            mine: ev.pubkey === Events.pubkey
        });
        room.messages.sort(function(a, b) { return a.created_at - b.created_at; });

        // Request profile for message author
        Profiles.request(ev.pubkey);

        // If this room is currently open, re-render
        if (this.currentRoom === channelId) {
            this.renderMessages(channelId);
        }
    },

    // Send a message to a channel (kind 42)
    sendMessage: async function(channelId, text) {
        if (!text.trim()) return;
        var tags = [['e', channelId, '', 'root']];
        var ev = await Events.create(42, text, tags);
        var signed = await Events.sign(ev);
        Pool.publish(signed);
        // Add locally for instant feedback
        if (!this.rooms[channelId]) {
            this.rooms[channelId] = { name: '', about: '', picture: '', creator: '', messages: [] };
        }
        var room = this.rooms[channelId];
        var exists = false;
        for (var i = 0; i < room.messages.length; i++) {
            if (room.messages[i].id === signed.id) { exists = true; break; }
        }
        if (!exists) {
            room.messages.push({
                id: signed.id, pubkey: signed.pubkey,
                content: text, created_at: signed.created_at, mine: true
            });
            room.messages.sort(function(a, b) { return a.created_at - b.created_at; });
            if (this.currentRoom === channelId) this.renderMessages(channelId);
        }
        return signed;
    },

    // Create a new channel (kind 40)
    createChannel: async function(name, about, picture) {
        var meta = { name: name };
        if (about) meta.about = about;
        if (picture) meta.picture = picture;
        var ev = await Events.create(40, JSON.stringify(meta), []);
        var signed = await Events.sign(ev);
        Pool.publish(signed);
        // Auto-join
        var channelId = signed.id;
        this.rooms[channelId] = {
            name: name, about: about || '', picture: picture || '',
            creator: signed.pubkey, messages: []
        };
        this.saveToDb(channelId, name, about, picture, signed.pubkey, '');
        this.joined.push({
            channel_id: channelId, name: name, about: about || '',
            picture: picture || '', creator_pubkey: signed.pubkey, relay_url: '', pinned: 0
        });
        this.renderList();
        return signed;
    },

    // Join an existing channel by ID
    joinChannel: async function(channelId) {
        // Check if already joined
        for (var i = 0; i < this.joined.length; i++) {
            if (this.joined[i].channel_id === channelId) return;
        }
        // Fetch metadata first
        var self = this;
        return new Promise(function(resolve) {
            var tempSubId = Pool.subscribe(
                [{ ids: [channelId], kinds: [40] }],
                function(ev) {
                    try {
                        var meta = JSON.parse(ev.content);
                        var name = meta.name || channelId.slice(0, 12);
                        var about = meta.about || '';
                        var picture = meta.picture || '';
                        self.rooms[channelId] = {
                            name: name, about: about, picture: picture,
                            creator: ev.pubkey, messages: []
                        };
                        self.saveToDb(channelId, name, about, picture, ev.pubkey, '');
                        self.joined.push({
                            channel_id: channelId, name: name, about: about,
                            picture: picture, creator_pubkey: ev.pubkey, relay_url: '', pinned: 0
                        });
                    } catch(e) {
                        // Channel exists but has invalid metadata
                        self.rooms[channelId] = { name: channelId.slice(0, 12), about: '', picture: '', creator: ev.pubkey, messages: [] };
                        self.saveToDb(channelId, channelId.slice(0, 12), '', '', ev.pubkey, '');
                        self.joined.push({
                            channel_id: channelId, name: channelId.slice(0, 12), about: '',
                            picture: '', creator_pubkey: ev.pubkey, relay_url: '', pinned: 0
                        });
                    }
                },
                function() {
                    Pool.unsubscribe(tempSubId);
                    self.renderList();
                    self.subscribe(); // re-subscribe including new channel
                    resolve();
                }
            );
            // Timeout: if channel not found after 5s
            setTimeout(function() {
                Pool.unsubscribe(tempSubId);
                if (!self.rooms[channelId]) {
                    // Channel not found on relays
                    console.warn('Channel not found:', channelId);
                }
                resolve();
            }, 5000);
        });
    },

    // Leave a channel
    leaveChannel: async function(channelId) {
        Api.call('remove_channel', { channel_id: channelId });
        this.joined = this.joined.filter(function(ch) { return ch.channel_id !== channelId; });
        delete this.rooms[channelId];
        if (this.currentRoom === channelId) this.closeRoom();
        this.renderList();
        this.subscribe(); // re-subscribe without removed channel
    },

    // Render list of joined channels
    renderList: function() {
        var el = document.getElementById('channel-list'); if (!el) return;
        if (!this.joined.length) {
            el.innerHTML = '<div class="noxtr-empty">' +
                (Api.lang === 'es' ? 'No estás en ningún canal. Únete a uno o crea uno nuevo.' : 'Not in any channels. Join one or create a new one.') +
                '</div>';
            return;
        }
        var self = this;
        el.innerHTML = this.joined.map(function(ch) {
            var room = self.rooms[ch.channel_id] || {};
            var name = room.name || ch.name || ch.channel_id.slice(0, 12) + '...';
            var about = room.about || ch.about || '';
            var msgCount = (room.messages || []).length;
            var pic = room.picture || ch.picture;
            var avatarHtml = pic
                ? '<img src="' + escapeHtml(pic) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">'
                : '<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:#7c3aed;color:#fff;font-weight:700;">' + (name[0] || '#').toUpperCase() + '</span>';
            return '<div class="dm-conv channel-item" data-channel="' + ch.channel_id + '">' +
                '<div class="dm-conv-avatar">' + avatarHtml + '</div>' +
                '<div class="dm-conv-body"><strong>' + escapeHtml(name) + '</strong>' +
                (msgCount ? '<span class="dm-conv-time">' + msgCount + ' msgs</span>' : '') +
                (about ? '<p class="dm-conv-preview">' + escapeHtml(about.slice(0, 60)) + '</p>' : '') +
                '</div>' +
                '<a class="channel-leave" data-channel="' + ch.channel_id + '" title="Leave" style="margin-left:auto;color:#999;cursor:pointer;padding:4px;">&times;</a>' +
                '</div>';
        }).join('');
        el.querySelectorAll('.channel-item').forEach(function(c) {
            c.onclick = function(e) {
                if (e.target.classList.contains('channel-leave')) return;
                self.openRoom(c.dataset.channel);
            };
        });
        el.querySelectorAll('.channel-leave').forEach(function(a) {
            a.onclick = async function(e) {
                e.stopPropagation();
                var ok = await confirm(Api.lang === 'es' ? '¿Salir de este canal?' : 'Leave this channel?');
                if (ok) self.leaveChannel(a.dataset.channel);
            };
        });
    },

    // Open a channel room
    openRoom: function(channelId) {
        this.currentRoom = channelId;
        document.getElementById('channel-list').style.display = 'none';
        document.getElementById('channel-actions').style.display = 'none';
        document.getElementById('channel-room').style.display = '';
        var room = this.rooms[channelId] || {};
        document.getElementById('channel-room-name').textContent = room.name || channelId.slice(0, 12) + '...';
        document.getElementById('channel-room-about').textContent = room.about || '';
        // Show compose if user can sign
        var composeEl = document.getElementById('channel-compose');
        if (composeEl) composeEl.style.display = Events.canSign() ? '' : 'none';
        // Subscribe and fetch metadata
        this.subscribeRoom(channelId);
        this.fetchMeta(channelId);
        this.renderMessages(channelId);
        // Push history state
        history.pushState({ noxtr: 'channel', channelId: channelId }, '');
    },

    // Render messages in current room
    renderMessages: function(channelId) {
        var el = document.getElementById('channel-messages'); if (!el) return;
        var room = this.rooms[channelId];
        if (!room || !room.messages.length) {
            el.innerHTML = '<div class="noxtr-empty">' +
                (Api.lang === 'es' ? 'No hay mensajes aún.' : 'No messages yet.') + '</div>';
            return;
        }
        var myPk = Events.pubkey;
        el.innerHTML = room.messages.map(function(m) {
            var name = Profiles.displayName(m.pubkey);
            var av = Profiles.avatar(m.pubkey);
            var col = Profiles.color(m.pubkey);
            var ini = (name[0] || '?').toUpperCase();
            var isOwn = myPk && m.pubkey === myPk;
            var delBtn = isOwn ? '<a class="ch-msg-del" data-action="del-channel-msg" data-id="' + m.id + '" title="' + (Api.lang === 'es' ? 'Eliminar' : 'Delete') + '" style="cursor:pointer;opacity:0.5;margin-left:4px;line-height:1;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></a>' : '';
            return '<div class="dm-msg ' + (m.mine ? 'dm-mine' : 'dm-theirs') + '" data-msg-id="' + m.id + '" style="flex-direction:column;align-items:' + (m.mine ? 'flex-end' : 'flex-start') + '">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                '<div class="dm-conv-avatar" style="width:24px;height:24px;min-width:24px;background:' + col + '">' +
                (av ? '<img src="' + escapeHtml(av) + '" style="width:24px;height:24px;border-radius:50%;">' : '<span style="font-size:0.7em">' + ini + '</span>') +
                '</div>' +
                '<strong style="font-size:0.8em;color:#7c3aed">' + escapeHtml(name) + '</strong>' +
                '<span class="dm-msg-time">' + timeAgo(m.created_at) + '</span>' +
                delBtn +
                '</div>' +
                '<div class="dm-msg-text">' + escapeHtml(m.content) + '</div>' +
                '</div>';
        }).join('');
        el.scrollTop = el.scrollHeight;
    },

    // Close room view
    closeRoom: function() {
        this.currentRoom = null;
        if (this.metaSubId) { Pool.unsubscribe(this.metaSubId); this.metaSubId = null; }
        document.getElementById('channel-room').style.display = 'none';
        document.getElementById('channel-list').style.display = '';
        document.getElementById('channel-actions').style.display = '';
        // Re-subscribe to all joined channels
        this.subscribe();
    },

    // Update channel metadata (kind 41, creator only)
    updateMeta: async function(channelId, name, about, picture) {
        var room = this.rooms[channelId];
        if (!room) return;
        var meta = { name: name };
        if (about) meta.about = about;
        if (picture) meta.picture = picture;
        var tags = [['e', channelId, '']];
        var ev = await Events.create(41, JSON.stringify(meta), tags);
        var signed = await Events.sign(ev);
        Pool.publish(signed);
        // Update local state + DB
        room.name = name;
        room.about = about || '';
        room.picture = picture || '';
        this.saveToDb(channelId, name, about || '', picture || '', room.creator, '');
        // Update joined array
        for (var i = 0; i < this.joined.length; i++) {
            if (this.joined[i].channel_id === channelId) {
                this.joined[i].name = name;
                this.joined[i].about = about || '';
                this.joined[i].picture = picture || '';
                break;
            }
        }
        // Update room header
        document.getElementById('channel-room-name').textContent = name;
        document.getElementById('channel-room-about').textContent = about || '';
    },

    // Open edit dialog (wquery dialog, creator only)
    openEditDialog: function(channelId) {
        var room = this.rooms[channelId];
        if (!room) return;
        var self = this;
        var previewHtml = room.picture
            ? '<div style="margin-bottom:8px"><img src="' + escapeHtml(room.picture) + '" style="max-width:80px;max-height:80px;border-radius:8px;"></div>'
            : '';
        var content = previewHtml +
            '<label>Name</label><input type="text" id="ch-edit-name" value="' + escapeHtml(room.name) + '" style="width:100%;margin-bottom:8px;">' +
            '<label>About</label><input type="text" id="ch-edit-about" value="' + escapeHtml(room.about || '') + '" style="width:100%;margin-bottom:8px;">' +
            '<label>Picture URL</label><input type="text" id="ch-edit-picture" value="' + escapeHtml(room.picture || '') + '" style="width:100%;">';
        $("body").dialog({
            title: Api.lang === 'es' ? 'Editar canal' : 'Edit channel',
            type: 'html',
            width: 380,
            content: content,
            buttons: [
                {
                    text: Api.lang === 'es' ? 'Guardar' : 'Save',
                    class: 'btn btn-primary',
                    action: function(e, overlay) {
                        var n = document.getElementById('ch-edit-name').value.trim();
                        if (!n) return;
                        var a = document.getElementById('ch-edit-about').value.trim();
                        var p = document.getElementById('ch-edit-picture').value.trim();
                        self.updateMeta(channelId, n, a, p);
                        document.body.removeChild(overlay);
                    }
                },
                {
                    text: Api.lang === 'es' ? 'Cancelar' : 'Cancel',
                    class: 'btn',
                    action: function(e, overlay) { document.body.removeChild(overlay); }
                }
            ],
            openAnimation: 'fadeInDown',
            closeAnimation: 'fadeOutUp'
        });
    },

    // Open create dialog (wquery dialog, replaces prompt-based flow)
    openCreateDialog: function() {
        var self = this;
        var content =
            '<label>Name</label><input type="text" id="ch-create-name" style="width:100%;margin-bottom:8px;" placeholder="' + (Api.lang === 'es' ? 'Nombre del canal' : 'Channel name') + '">' +
            '<label>About</label><input type="text" id="ch-create-about" style="width:100%;margin-bottom:8px;" placeholder="' + (Api.lang === 'es' ? 'Descripción (opcional)' : 'Description (optional)') + '">' +
            '<label>Picture URL</label><input type="text" id="ch-create-picture" style="width:100%;" placeholder="https://...">';
        $("body").dialog({
            title: Api.lang === 'es' ? 'Crear canal' : 'Create channel',
            type: 'html',
            width: 380,
            content: content,
            buttons: [
                {
                    text: Api.lang === 'es' ? 'Crear' : 'Create',
                    class: 'btn btn-primary',
                    action: function(e, overlay) {
                        var n = document.getElementById('ch-create-name').value.trim();
                        if (!n) return;
                        var a = document.getElementById('ch-create-about').value.trim();
                        var p = document.getElementById('ch-create-picture').value.trim();
                        self.createChannel(n, a, p);
                        document.body.removeChild(overlay);
                    }
                },
                {
                    text: Api.lang === 'es' ? 'Cancelar' : 'Cancel',
                    class: 'btn',
                    action: function(e, overlay) { document.body.removeChild(overlay); }
                }
            ],
            openAnimation: 'fadeInDown',
            closeAnimation: 'fadeOutUp'
        });
    },

    // Copy invite link to clipboard
    copyInviteLink: function(channelId) {
        var note1 = noteEncode(channelId);
        var url = location.origin + '/noxtr/channel/' + note1;
        navigator.clipboard.writeText(url);
        // Green check feedback on the invite icon
        var btn = document.getElementById('channel-invite');
        if (btn) {
            var orig = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-check" style="color:#22c55e"></i>';
            setTimeout(function() { btn.innerHTML = orig; }, 1500);
        }
    }
};
```

---

## 7. UI Integration (script.js modifications)

### 7.1 switchTab — Add `channels` case

In the `switchTab` function (around line 1997), add a new case in the `switch (tab)` block, after the `messages` case:

```javascript
case 'channels':
    Feed.clear();
    feedEl.style.display = 'none';
    if (loadEl) loadEl.style.display = 'none';
    if (compEl) compEl.style.display = 'none';
    document.getElementById('panel-channels').style.display = '';
    if (Api.userId) {
        Channels.loadFromDb().then(function() {
            Channels.renderList();
            Channels.subscribe();
        });
    } else {
        Channels.renderList();
    }
    break;
```

### 7.2 Hide panel-channels in switchTab

Add `'panel-channels'` to every `style.display = 'none'` list for panels. There are two places:

1. **In `switchTab`** — around line 2009, where panels are hidden:
```javascript
document.getElementById('panel-channels').style.display = 'none';
```

2. **In `Threads.open()`** — around line 1313, where side panels are hidden:
```javascript
['panel-following', 'panel-topics', 'panel-messages', 'panel-followers', 'panel-channels'].forEach(...)
```

### 7.3 Event wiring (in `init` or at bottom of IIFE)

Wire up the channel panel buttons. Add this in the section where DM buttons are wired (search for `btn-dm-send`):

```javascript
// ---- Channels ----
var btnChannelSend = document.getElementById('btn-channel-send');
if (btnChannelSend) btnChannelSend.onclick = async function() {
    var input = document.getElementById('channel-text');
    if (!input || !input.value.trim() || !Channels.currentRoom) return;
    await Channels.sendMessage(Channels.currentRoom, input.value.trim());
    input.value = '';
};
var channelTextInput = document.getElementById('channel-text');
if (channelTextInput) channelTextInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnChannelSend.click(); }
});

var btnChannelBack = document.getElementById('channel-back');
if (btnChannelBack) btnChannelBack.onclick = function() { history.back(); };

var btnJoinChannel = document.getElementById('btn-join-channel');
if (btnJoinChannel) btnJoinChannel.onclick = async function() {
    var input = document.getElementById('channel-id-input');
    if (!input || !input.value.trim()) return;
    var channelId = input.value.trim();
    // Accept hex (64 chars) or note1... bech32 of the channel creation event
    if (channelId.startsWith('note1')) {
        try { channelId = noteDecode(channelId); } catch(e) { return; }
    }
    if (channelId.length !== 64 || !/^[0-9a-f]+$/.test(channelId)) return;
    await Channels.joinChannel(channelId);
    input.value = '';
};

var btnCreateChannel = document.getElementById('btn-create-channel');
if (btnCreateChannel) btnCreateChannel.onclick = function() {
    Channels.openCreateDialog();
};

var btnChannelInvite = document.getElementById('channel-invite');
if (btnChannelInvite) btnChannelInvite.onclick = function() {
    if (Channels.currentRoom) Channels.copyInviteLink(Channels.currentRoom);
};

var btnChannelEdit = document.getElementById('channel-edit');
if (btnChannelEdit) btnChannelEdit.onclick = function() {
    if (Channels.currentRoom) Channels.openEditDialog(Channels.currentRoom);
};

// Delete individual channel message (kind 5 / NIP-09)
var channelMsgsEl = document.getElementById('channel-messages');
if (channelMsgsEl) channelMsgsEl.addEventListener('click', async function(e) {
    var btn = e.target.closest('[data-action="del-channel-msg"]');
    if (!btn) return;
    var msgId = btn.dataset.id;
    if (!msgId) return;
    if (!await confirm(Api.lang === 'es' ? '¿Eliminar este mensaje? Los relays pueden tardar en procesarlo.' : 'Delete this message? Relays may take a moment to process.')) return;
    try {
        await Events.deleteNote(msgId);
        var msgEl = btn.closest('.dm-msg');
        if (msgEl) msgEl.remove();
        if (Channels.currentRoom && Channels.rooms[Channels.currentRoom]) {
            var msgs = Channels.rooms[Channels.currentRoom].messages;
            var idx = msgs.findIndex(function(m) { return m.id === msgId; });
            if (idx !== -1) msgs.splice(idx, 1);
        }
    } catch(err) { alert('Error: ' + err.message); }
});
```

> **Note**: `openCreateDialog()` uses wquery's `$("body").dialog({...})` to show a proper modal with name/about/picture fields, replacing the earlier `prompt()`-based flow.

> **Edit button visibility**: `#channel-edit` is `display:none` by default. It becomes visible in two places:
> 1. In `openRoom()` — if the cached `room.creator` matches the current pubkey
> 2. In `fetchMeta()` EOSE callback — once the relay confirms the creator pubkey

### 7.4 Browser History (popstate)

In the existing `popstate` handler, add a case for channel navigation:

```javascript
if (state && state.noxtr === 'channel') {
    Channels.openRoom(state.channelId);
}
```

And in `Channels.closeRoom()`, if triggered by back button (not programmatic), the popstate handler handles it. When triggered programmatically (e.g. by the `×` leave button), no extra pushState is needed since `leaveChannel` calls `closeRoom` which doesn't push history.

### 7.5 Channels.closeRoom from back button

The back button in the channel header (`#channel-back`) should use `history.back()` — the popstate handler then calls `Channels.closeRoom()` + re-renders the channel list. In the popstate handler, when going back from a channel room to the channels tab:

```javascript
// In the existing popstate handler, add:
if (state && state.noxtr === 'tab' && state.tab === 'channels') {
    Channels.closeRoom();
    UI.switchTab('channels');
}
```

This is already handled by the existing popstate tab logic if the previous state was `{noxtr:'tab', tab:'channels'}`.

---

## 8. CSS (style.css)

Reuse existing DM styles (`.dm-conv`, `.dm-messages`, `.dm-msg`, etc.). Add minimal channel-specific styles:

```css
/* ---- Channels (NIP-28) ---- */
.channel-room-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #e1e1e1;
    background: #fafafa;
}
.channel-item {
    position: relative;
}
.channel-item .channel-leave {
    font-size: 1.2em;
    opacity: 0.5;
    transition: opacity 0.2s;
}
.channel-item:hover .channel-leave {
    opacity: 1;
}
.channel-header-btn {
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.2s;
    padding: 4px;
    margin-left: 4px;
}
.channel-header-btn:hover {
    opacity: 1;
}
```

Dark mode (if applicable — check existing `.dm-` dark mode rules and duplicate for `.channel-`).

---

## 9. Implementation Order (Step by Step)

Follow this order to build incrementally and test each step:

### Step 1: Database + PHP backend
1. Add `NSTR_CHANNELS` table to `NoxtrStore::ensureTables()` (both SQLite and MySQL blocks)
2. Bump version check to `>= 3`
3. Add `getChannels()`, `addChannel()`, `removeChannel()`, `toggleChannelPin()` to `noxtrstore.class.php`
4. Add `get_channels`, `add_channel`, `remove_channel`, `toggle_channel_pin` cases to `ajax.php`
5. **Test**: call ajax.php manually to verify CRUD works

### Step 2: HTML panel
1. Add `<a class="noxtr-tab" data-tab="channels">Channels</a>` to tabs bar in `run.php`
2. Add `#panel-channels` HTML after `#panel-messages` in `run.php`
3. **Test**: click Channels tab — panel should appear (empty, but visible)

### Step 3: JavaScript Channels module
1. Add the full `var Channels = { ... }` module to `script.js` after the DMs module
2. Add `panel-channels` to the hide-panels lists in `switchTab()` and `Threads.open()`
3. Add the `channels` case to the `switch(tab)` in `switchTab()`
4. Wire up button event listeners (send, back, join, create)
5. Add `channel` case to popstate handler
6. **Test**: create a channel, send messages, leave, rejoin

### Step 4: CSS
1. Add channel-specific styles to `style.css`
2. **Test**: visual polish, ensure it looks consistent with DMs

### Step 5: Dialogs (invite, edit, create)
1. Add `openEditDialog()`, `openCreateDialog()`, `copyInviteLink()`, `updateMeta()` to Channels module
2. Add invite (`#channel-invite`) and edit (`#channel-edit`) icon buttons to `channel-room-header` in `run.php`
3. Wire `channel-invite` → `copyInviteLink()`, `channel-edit` → `openEditDialog()`, `btn-create-channel` → `openCreateDialog()`
4. Edit button visibility: show only when logged-in user is the channel creator (check in `openRoom` + `fetchMeta` EOSE)
5. **Requires**: `_js_/wquery/wquery.dialog.js` (already loaded by the theme). Dialog API: `$("body").dialog({ title, type:'html', width, content, buttons:[{text,class,action(e,overlay)}], openAnimation, closeAnimation })`
6. **Test**: create channel via dialog (with picture), edit name/about/picture, copy invite link, verify edit only visible to creator

### Step 6: Discovery (optional enhancement)
1. Add a "Browse" button that subscribes to `{ kinds: [40], limit: 50 }` to discover public channels
2. Show results in a modal or inline list with "Join" buttons
3. This is optional — users can join by pasting channel IDs initially

### Step 7: Update CLAUDE.md
1. Add "NIP-28" to the NIPs list
2. Add `NSTR_CHANNELS` to the DB tables section
3. Add `Channels` to the JS modules section
4. Add `channels` to the Tab System list

---

## 10. Known Channels for Testing

These are well-known NIP-28 channels on mainnet relays:

- **nostrchat.io** channels can be discovered by browsing `https://nostrchat.io` and copying channel IDs from URLs
- To find channels programmatically: `Pool.subscribe([{ kinds: [40], limit: 50 }], handler, eose)`
- For testing, create a channel on your own relays first

### Test Flow
1. Open Noxtr → Channels tab
2. Click "Create" → enter name → channel appears in list
3. Click channel → room opens → type message → appears instantly
4. Copy channel ID → open in another browser/session → "Join" with that ID → see the message
5. Back button → returns to channel list
6. Leave channel → channel removed from list and DB

---

## 11. Edge Cases and Notes

- **Muted users**: Filter kind 42 events from muted pubkeys (already in `handleMessage`)
- **No encryption**: Unlike DMs, channel messages are plaintext. No `encrypt()`/`decrypt()` needed
- **Event signing**: Requires nsec, NIP-07 extension, or NIP-46 — same as DMs (`Events.canSign()`)
- **Channel not found**: If `joinChannel()` doesn't receive a kind 40 event within 5s timeout, ignore silently
- **`confirm()` and `prompt()` are async**: Always use `await` (wquery overrides them to return Promises)
- **No jQuery**: Use `fetch()` for HTTP, `document.getElementById()` / `querySelectorAll()` for DOM
- **DB dual-compatible SQL**: Use `self::isSQLite()` branches where syntax differs
- **Pool relay management**: All relay interactions go through `Pool.subscribe()`, `Pool.unsubscribe()`, `Pool.publish()` — never raw WebSocket
- **Message deletion**: NIP-09 (kind 5) is a *request* to relays — compliant relays will delete the event, but not all do. The UI removes the message optimistically (from DOM + `room.messages[]`) regardless. Deletion is only available for own messages (`m.pubkey === Events.pubkey`). The trash icon is rendered in `renderMessages()` only for those messages, via delegated click listener on `#channel-messages`

---

## 12. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `noxtrstore.class.php` | EDIT | Add `NSTR_CHANNELS` table + 4 methods, bump version |
| `ajax.php` | EDIT | Add 4 cases: `get_channels`, `add_channel`, `remove_channel`, `toggle_channel_pin` |
| `run.php` | EDIT | Add `channels` tab link + `#panel-channels` HTML block. Channel room header includes `#channel-invite` (share-alt icon) and `#channel-edit` (pencil icon, hidden by default, shown for creator only) |
| `script.js` | EDIT | Add `var Channels = {...}` module (incl. `updateMeta`, `openEditDialog`, `openCreateDialog`, `copyInviteLink`), `channels` case in `switchTab`, panel hiding, button wiring, popstate. Uses wquery dialog (`$("body").dialog({...})`) from `_js_/wquery/wquery.dialog.js` |
| `style.css` | EDIT | Add `.channel-room-header`, `.channel-item`, `.channel-leave` styles |
| `CLAUDE.md` | EDIT | Add NIP-28, NSTR_CHANNELS, Channels module references |
