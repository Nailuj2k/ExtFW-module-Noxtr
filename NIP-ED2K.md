# NIP-ED2K: eDonkey2000 (eMule) over Nostr

`draft` `optional`

---

## Abstract

Defines two event kinds for publishing and discovering eDonkey2000/eMule content over Nostr:

- **kind 2010** — ed2k server listing
- **kind 2011** — ed2k file link

Together they allow a decentralized, censorship-resistant directory of eMule servers and shared files, replacing centralized web indexes that are prone to takedowns and disappearance.

---

## Motivation

The eDonkey2000/eMule network has no decentralized discovery layer. Server lists and file indexes rely on centralized websites (server-met.de, etc.) that appear and disappear over time. Nostr is a natural fit: any user can publish servers or files, reputation is tied to pubkeys, and relays provide redundancy without a central authority.

---

## Kind 2010 — ed2k Server

Publishes an eMule/eDonkey server entry.

### Event structure

```json
{
  "kind": 2010,
  "content": "<optional description or notes about this server>",
  "tags": [
    ["name",    "<server display name>"],
    ["addr",    "<ip or hostname>", "<port>"],
    ["country", "<ISO 3166-1 alpha-2 country code>"],
    ["d",       "<addr:port>"]
  ]
}
```

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `name` | yes | Human-readable server name |
| `addr` | yes | IP or hostname (index 1) and TCP port (index 2) |
| `country` | no | ISO country code, e.g. `DE`, `FR`, `US` |
| `d` | yes | Unique identifier: `<addr>:<port>`. Enables replaceable events (users can update their own server entry) |
| `t` | no | Freeform tags, e.g. `emule`, `ed2k`, `highid` |

### Server rating

Clients SHOULD display reaction counts (kind 7) on server events as a trust signal. A `+` reaction means the server is reachable and well-behaved; `-` means it is unreliable or malicious.

### Example

```json
{
  "kind": 2010,
  "content": "Stable, high-ID friendly. Uptime > 99%.",
  "tags": [
    ["name",    "eMule Security No.1"],
    ["addr",    "51.89.87.104", "4661"],
    ["country", "FR"],
    ["d",       "51.89.87.104:4661"],
    ["t",       "emule"],
    ["t",       "highid"]
  ]
}
```

---

## Kind 2011 — ed2k File Link

Publishes an ed2k file link with structured metadata.

### Event structure

```json
{
  "kind": 2011,
  "content": "<optional description>",
  "tags": [
    ["ed2k",  "ed2k://|file|<name>|<size>|<hash>|/"],
    ["name",  "<filename>"],
    ["size",  "<size in bytes>"],
    ["hash",  "<ed2k hash (MD4, 32 hex chars)>"],
    ["m",     "<MIME type>"],
    ["t",     "<category tag>"]
  ]
}
```

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `ed2k` | yes | Full ed2k URI: `ed2k://\|file\|<name>\|<size>\|<hash>\|/` |
| `name` | yes | Filename as it appears in the network |
| `size` | yes | File size in bytes (string) |
| `hash` | yes | ed2k hash — MD4 of the file, 32 hex characters |
| `m` | no | MIME type, e.g. `video/x-matroska`, `application/zip` |
| `t` | no | Category tags: `video`, `audio`, `software`, `book`, `image`, etc. |
| `x` | no | SHA-256 of the file for cross-network verification |

### Example

```json
{
  "kind": 2011,
  "content": "Bruno Walter conducting the New York Philharmonic. Lossless FLAC, 24-bit/96kHz.",
  "tags": [
    ["ed2k",  "ed2k://|file|Mahler_Symphony_No4_BrunoWalter_NYP.flac|734003200|4C1B24B8E5BA5CBB4B5D4E0D9A6C3A1F|/"],
    ["name",  "Mahler_Symphony_No4_BrunoWalter_NYP.flac"],
    ["size",  "734003200"],
    ["hash",  "4C1B24B8E5BA5CBB4B5D4E0D9A6C3A1F"],
    ["m",     "audio/flac"],
    ["t",     "audio"],
    ["t",     "classical"]
  ]
}
```

---

## Client behavior

### Discovering servers (kind 2010)

- Subscribe to `{ kinds: [2010], limit: 100 }` on known relays
- Display results sorted by reaction score (kind 7 +/-) and recency
- Allow users to test connectivity and publish their own reaction
- Export as `server.met` file for direct import into eMule/aMule clients (optional but highly useful)

### Discovering files (kind 2011)

- Subscribe to `{ kinds: [2011], "#t": ["video"] }` (or other categories)
- Display with filename, size, MIME type and a clickable `ed2k://` link
- Allow users to publish file links and tag them
- Search by `t` tags, author pubkey, or freeform `content` text

### Trust model

Both kinds benefit from pubkey reputation: a well-known pubkey that consistently publishes working servers or valid file links builds trust over time. Clients MAY choose to show only results from followed pubkeys or from pubkeys with a minimum reaction score.

---

## Relay behavior

No special relay behavior required. Standard NIP-01 event storage and querying is sufficient.

Relays MAY choose to index kind 2010 and 2011 events specifically and offer search endpoints, but this is not required.

---

## Relation to NIP-35 (Torrents)p

NIP-35 defines kind 2003 for BitTorrent/magnet links. NIP-ED2K is intentionally parallel in structure to allow clients to implement both in a unified "file sharing" tab or section. The `t` tag categories are compatible between the two kinds.

---

## Reference

- [eDonkey2000 on Wikipedia](https://en.wikipedia.org/wiki/EDonkey_network)
- [ed2k URI scheme](https://en.wikipedia.org/wiki/Ed2k_URI_scheme)
- [NIP-35 (Torrents)](https://github.com/nostr-protocol/nostr/blob/master/35.md)
