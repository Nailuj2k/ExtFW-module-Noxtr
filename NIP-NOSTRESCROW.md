NIP-XX
======

On-chain Peer-to-Peer Trading with Taproot Escrow (NostrEscrow)
---------------------------------------------------------------

`draft` `optional`

> Status: **draft, not submitted**. Distilled from the canonical implementation spec
> (`NOSTR_ONCHAIN.md`, v2.7) of the reference implementation (noxtr). Kind numbers
> `39383-39389` are provisional pending a collision check against the kinds registry.
> This document describes only the interoperable core; implementation details of the
> reference client are intentionally omitted.

## Abstract

This NIP defines events and flows for **non-custodial on-chain Bitcoin/fiat trading**
coordinated over Nostr. Funds are held in a Taproot output whose script tree encodes a
cooperative 2-of-2 path, a cascading arbitration scheme (three arbitrators with
increasing relative timelocks) and a unilateral seller recovery path. No party ever
custodies the counterparty's funds; Nostr is used for discovery, negotiation, state
signaling, dispute handling and reputation.

It complements [NIP-69](69.md) (Lightning P2P orders, e.g. Mostro): same client can
offer both settlement layers. This protocol uses the `393xx` kind range and does not
collide with NIP-69's `38383`.

## Conventions

- MUST / SHOULD / MAY per RFC 2119.
- "Schnorr" = BIP-340 over secp256k1, 32-byte x-only pubkeys. "Taproot" = BIP-341/342,
  leaf version `0xc0`.
- Hex is lowercase without `0x`. Timestamps are UNIX seconds. Amounts are integer sats.
- All protocol events MUST carry the tag `["y", "nostrescrow"]`; clients filter with
  `{"#y": ["nostrescrow"]}`.
- All protocol events MUST carry NIP-13 proof of work (`["nonce", "<n>", "<difficulty>"]`)
  with at least the minimum difficulty listed per kind below. Events without valid PoW
  MUST be discarded.

## Identifiers

- **`order_id`** — chosen freely by the order creator (UUIDv4 without dashes
  recommended). It is the `d` tag of the order event.
- **`trade_id`** — deterministic, computed by both parties without negotiation:
  `lowercase(hex(sha256(order_id || ":" || taker_pubkey))[0:32])`.
- **`trade_index`** — per-trade unsigned 31-bit index, chosen with a CSPRNG and checked
  against the user's local trades; used in Bitcoin key derivation. It MUST NOT be
  reused with the same Bitcoin root key.

## Key architecture

Two independent key roots:

| Material | Use | Derivation |
|---|---|---|
| Nostr key | Sign Nostr events, NIP-04/44 encryption | NIP-06 or any |
| Bitcoin `xprv` | Escrow keys | BIP-32 from its own BIP-39 seed |

The Nostr key MUST NOT sign Bitcoin transactions and vice versa. Per trade, an
ephemeral Bitcoin key is derived at `m/86'/0'/0'/0/<trade_index>` (BIP-86) and MUST NOT
be reused. The maker publishes their trade pubkey in the `accept` event; the taker
sends theirs in the `take_request` DM.

## Event kinds

| Kind  | Name                     | Min PoW |
|-------|--------------------------|---------|
| 39383 | Order                    | 16 bits |
| 39384 | Rating                   | 8 (opt) |
| 39385 | Trade State              | 12 bits |
| 39386 | Dispute                  | 12 bits |
| 39387 | Arbitration              | 12 bits |
| 39388 | Arbitrator Advertisement | 16 bits |
| 39389 | Funding Commitment       | 12 bits |

All are addressable (parameterized replaceable) events.

## Anti-griefing handshake

All encrypted protocol DMs use kind `4` and MUST include both `["p", "<recipient>"]`
and `["y", "nostrescrow"]` tags. The `y` tag lets clients subscribe only to
NostrEscrow traffic instead of asking a remote NIP-46 signer to decrypt unrelated
NIP-04 history.

1. Maker publishes the order (kind 39383). The order stays visible and unreserved.
2. Taker sends the maker an encrypted DM (NIP-04):

```json
{
  "type": "take_request",
  "order_id": "<id>",
  "trade_pubkey": "<64 hex>",
  "trade_index": 1,
  "fiat_amount": 100
}
```

3. Maker evaluates the taker (reputation) and, if accepting, publishes
   `accept` (kind 39385), which reserves the order and fixes `trade_id`.
   Only then does the on-chain phase begin. Abandoning before `accept` does not
   affect order availability.

## Events

### Order (kind 39383)

`d` = `order_id`. Required tags:

```
["d", "<order_id>"], ["y", "nostrescrow"],
["k", "buy" | "sell"],
["amount", "<sats>"],                      0 = market price (with "premium")
["fiat_code", "<ISO 4217>"],
["fiat_amount", "<min>"] | ["fiat_amount", "<min>", "<max>"],
["nonce", "<n>", "16"]
```

Optional: `payment_method` (comma-separated), `premium` (percent), `expires_at`,
`arbitrators` (`"<pk1>,<pk2>,<pk3>"`), `network` (`mainnet|testnet|signet`, default
`mainnet`). `content` is a free-form description.

Clients MUST NOT allow taking an order whose `network` differs from the active chain.
Note: testnet and signet share the `tb` bech32m HRP and thus the same address for the
same keys — the `network` tag is the only guard; it is not cryptographically enforced.

### Trade State (kind 39385)

Because kind 39385 is parameterized replaceable, each action needs its own `d` value:
`<order_id>:<action>`. Every event also carries `["order_id", "<order_id>"]` as the
stable lookup key. This prevents a later action from replacing the earlier contract
history. Required tags: `d`, `order_id`, `y`, `["action", ...]`,
`["network", ...]` (post-accept), `nonce` (12 bits).

| action          | additional tags |
|-----------------|-----------------|
| `accept`        | `["taker", pk]`, `["maker_trade_pubkey", pk]`, `["trade_id", id]`, `["arbitrators", "pk1,pk2,pk3"]`, `["sat_amount", sats]`, `["fiat_amount", n]`, `["arb_fee", sats]` |
| `arbitrators`   | `["arbitrators", "pk1,pk2,pk3"]` — only before the escrow address exists |
| `address_check` | `["address", "<bech32m P2TR>"]` — bilateral verification, see below |
| `fiat_sent`     | — (published by buyer) |
| `fiat_received` | — (published by seller; unlocks cooperative signing) |
| `buyer_payout`  | `["payout_address", "<on-chain address>"]` (published by buyer) |
| `complete`      | `["txid", "<64 hex>"]` |
| `cancel`        | `["reason", "<text>"]` |

`accept` freezes the monetary contract: `sat_amount` (computed from market rate +
premium if the order was market-priced) and the concrete `fiat_amount` from the
`take_request`. Both parties treat them as immutable afterwards.

**`address_check`**: since the Taproot address is a deterministic function of
`(seller_trade_pubkey, buyer_trade_pubkey, arbitrators[3])`, each party derives it
locally and publishes it; on receiving the peer's event the client compares byte by
byte. Match → verified (and reply with own `address_check` if not yet sent). Mismatch
→ MUST NOT fund; reconcile arbitrators first. The seller MUST only broadcast funding
after verification. Once verified, `arbitrators` changes are rejected.

### Funding Commitment (kind 39389)

Published by the seller after depositing into the escrow address:

```
["d", "<order_id>:funding"], ["order_id", "<order_id>"], ["y", "nostrescrow"],
["txid", "<64 hex>"], ["vout", "<int>"], ["amount", "<sats>"],
["address", "<bech32m P2TR>"], ["block", "<height>"]?, ["nonce", "<n>", "12"]
```

The buyer MUST verify the tx on-chain (output pays `amount` to the derived address)
and wait for confirmations (recommended: 1 up to 100k sats, 3 up to 1M, 6 above)
before sending fiat.

### Dispute (kind 39386)

`["d", "<order_id>:dispute"]`, `["order_id", order_id]`, `["reason", text]`,
`["initiator", "buyer"|"seller"]`. `content`:
details and evidence references.

### Arbitration (kind 39387)

`["d", "<order_id>:arbitration:<arb_index>"]`, `["order_id", order_id]`,
`["winner", "seller"|"buyer"]`, `["arb_index", "1"|"2"|"3"]`.
`content`: public justification. Additionally the arbitrator MUST DM the winner their
Schnorr signature for the corresponding leaf spend (see *Dispute spend*); the public
event alone is declarative.

### Rating (kind 39384)

`["d", "<order_id>:<rated_pubkey>"]`, `["order_id", order_id]`, `["p", rated_pubkey]`,
`["rating", "positive"|"neutral"|"negative"]`,
`["role", "buyer"|"seller"|"arbitrator"]`, `["amount", sats]`. Verifiers SHOULD only
count a rating if **both** rater and rated have signed some 39385 event of that
`order_id` (cryptographic proof they were the two real counterparties). Including
`funding_txid` is RECOMMENDED for on-chain auditability.

### Arbitrator Advertisement (kind 39388)

`d` = the arbitrator's Bitcoin pubkey. Required:

```
["d", pubkey_btc], ["y", "nostrescrow"], ["pubkey_btc", "<64 hex x-only>"],
["tier", "site_admin" | "regular" | "professional"],
["status", "active" | "unavailable"],
["max_amount", "<sats>"], ["nonce", "<n>", "16"]
```

Fees: `["fee_min_sats", sats]` (MUST be ≥ 546, see *Arbitrator fee*) and
`["fee_rate", percent]`. Tier `professional` additionally publishes an on-chain bond:
`bond_txid`, `bond_vout`, `bond_amount`. Optional: `["languages", "es,en"]`,
`["mostro_admin", robot_pubkey]` (informational badge, not a tier). Withdrawal:
republish with `status=unavailable` or delete via NIP-09.

## Taproot settlement

### Internal key

Script-path only. The internal key MUST be the BIP-341 NUMS point
`0x50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` (no known
private key), so every spend goes through a leaf.

### Script tree (8 leaves)

| # | Leaf          | CSV (blocks) | Spendable by            |
|---|---------------|--------------|-------------------------|
| 1 | cooperative   | 0            | seller + buyer (2-of-2) |
| 2 | recovery      | 4320 (~30d)  | seller alone            |
| 3 | arb1 → seller | 0            | arbitrator 1 + seller   |
| 4 | arb1 → buyer  | 0            | arbitrator 1 + buyer    |
| 5 | arb2 → seller | 288 (~48h)   | arbitrator 2 + seller   |
| 6 | arb2 → buyer  | 288 (~48h)   | arbitrator 2 + buyer    |
| 7 | arb3 → seller | 576 (~96h)   | arbitrator 3 + seller   |
| 8 | arb3 → buyer  | 576 (~96h)   | arbitrator 3 + buyer    |

Cooperative leaf: `<seller_pk> OP_CHECKSIGVERIFY <buyer_pk> OP_CHECKSIG`.
Recovery leaf: `<4320> OP_CSV OP_DROP <seller_pk> OP_CHECKSIG`.
Arbitration leaves: `<csv> OP_CSV OP_DROP <arb_pk> OP_CHECKSIGVERIFY <winner_pk>
OP_CHECKSIG` (leaves with `csv = 0` omit the first two ops). The tree is built
balanced (3 levels) with BIP-341 lexicographic ordering of leaf hashes.

Both parties derive the address independently from
`(seller_trade_pubkey, buyer_trade_pubkey, [arb1, arb2, arb3])` and cross-check via
`address_check` before funding.

### Cooperative spend

After `fiat_received`, each party independently builds the same unsigned tx —
input: the escrow UTXO; output 1: `amount - miner_fee` to the buyer's
`payout_address`; output 2 (if `arb_fee > 0`): `arb_fee` to arb1's fee output — and
exchanges a complete Schnorr signature over the cooperative-leaf sighash
(`SIGHASH_DEFAULT`) via encrypted DM:

```json
{ "type": "coop_sign", "trade_id": "<32 hex>", "tx_hex": "<unsigned tx>",
  "fee_sats": 300, "sig": "<128 hex>" }
```

If the received `tx_hex` differs from the locally built one, abort. Witness:
`[<buyer_sig>, <seller_sig>, <leaf_script>, <control_block>]`. No MuSig2 rounds:
plain independent signatures. Clients MUST NOT mark the trade complete until the
release tx has ≥ 1 on-chain confirmation.

### Dispute spend

The winner receives from the deciding arbitrator, via encrypted DM:

```json
{ "type": "arb_signature", "order_id": "...", "trade_id": "...", "network": "mainnet",
  "arb_index": 1, "winner_side": "buyer", "fee_sats": 300,
  "tx_hex": "<unsigned tx>", "arb_sig": "<128 hex>",
  "winner_payout_address": "<addr>" }
```

The winner verifies `arb_sig` against `arbitrators[arb_index-1]`, co-signs the same
sighash and broadcasts with witness `[<winner_sig>, <arb_sig>, <leaf_script>,
<control_block>]`.

### Recovery

If no arbitrator acts within 4320 blocks after funding confirmation, the seller may
spend unilaterally through leaf 2 (witness `[<seller_sig>, <recovery_script>,
<control_block>]`), recovering the full escrow (including the prefunded arbitrator
fee). Nodes reject the broadcast as `non-BIP68-final` until the CSV matures.

## Arbitration

**Tiers**: `site_admin` (instance operator; default arb1; social/operational trust,
no bond), `professional` (on-chain slashable bond; eligible for deterministic
auto-selection), `regular` (social trust; manual selection only).

**Selection** (priority order): (a) explicit `arbitrators` tag in the order;
(b) instance default: the site admin's key prefilled as arb1; (c) deterministic
selection from the professional pool: filter kind 39388 by `status=active`, bond
verified, `max_amount >= amount`, then sort by `sha256(arb_pubkey || trade_id)` and
take the first three. With fewer than 3 eligible professionals, parties MUST agree
manually. Bootstrap mode: a single arbitrator MAY occupy all three slots
(`[pk, pk, pk]`) if both parties explicitly accept.

**Temporal cascade**: arb1 acts in 0-48h (CSV 0), arb2 in 48-96h (CSV 288), arb3 in
96-144h (CSV 576), recovery after 30 days (CSV 4320). The Nostr-level schedule is the
source of truth; the CSVs enforce it on-chain only for disputes opened shortly after
funding. Out-of-turn decisions remain attributable via `arb_index` and are punished
reputationally / via bond.

**Bond & slashing** (professional tier only): the bond sits in a Taproot output with
a recovery path (arbitrator, CSV 4320) and a slashing path requiring 3-of-5 senior
arbitrators (`<pk1> OP_CHECKSIG <pk2> OP_CHECKSIGADD ... <3> OP_NUMEQUAL`).
Confiscation is never unilateral.

The current noxtr reference client does not yet verify this bond script on-chain.
Until that verification exists, an advertised `professional` tier MUST be treated as
`regular` and MUST NOT receive automatic-selection or trust privileges.

## Arbitrator fee

`arb_fee = max(fee_min_sats, round(amount * fee_rate / 100))`, computed at `accept`
and frozen in the `arb_fee` tag. The **seller prefunds it**: the funding target is
`amount + arb_fee`. In a cooperative spend arb1 receives the fee; in a dispute the
arbitrator whose leaf resolves the trade receives it. The fee is exactly `arb_fee`
as a separate output paying the key-path P2TR of that arbitrator's advertised
`pubkey_btc` (`OP_1 || taproot_tweak(pubkey_btc)`), and the payout output is always
`amount - miner_fee`. The arbitrator earns the same regardless of who wins — removing
any economic incentive to favor a side. In recovery nobody collects (no service was
rendered; unenforceable without covenants anyway). Since the fee is a separate
output, `arb_fee` MUST be ≥ 546 sats (dust), which sets a practical minimum trade
size; smaller amounts belong on Lightning (NIP-69).

## Reputation

Computed client-side from kinds 39384 (with the both-parties-signed-39385
verification above), 39387 (arbitrator track record) and 39385/39386 history. New
pubkeys SHOULD be distrusted; critical roles (arbitrators) anchor reputation to an
on-chain bond. Suggested score: `(positive - 2*negative) / max(1, total)`, dispute
penalties, `log(days_active)` seniority bonus.

## Reference flow (happy path)

```
 1. Maker  → relays: 39383 order
 2. Taker  → maker:  DM take_request (trade_pubkey)
 3. Maker  → relays: 39385 accept (maker_trade_pubkey, arbitrators, sat/fiat/arb_fee)
 4. Both   derive the Taproot address independently
 5. Both   → relays: 39385 address_check; byte-compare; mismatch → abort
 6. Seller broadcasts funding tx (amount + arb_fee)
 7. Seller → relays: 39389 funding commitment
 8. Buyer  verifies on-chain, waits N confirmations
 9. Buyer  sends fiat; → relays: 39385 fiat_sent; → relays: 39385 buyer_payout
10. Seller confirms;   → relays: 39385 fiat_received
11. Both   exchange coop_sign DMs; either broadcasts the release tx
12. Seller → relays: 39385 complete (txid); clients wait ≥1 confirmation
```

## Security considerations

- **Script-path only**: the NUMS internal key removes key-path spending; addresses
  and txids are already public in 39389/39387, so the key-path privacy loss is
  marginal.
- **`network` tag is advisory**: testnet/signet share the `tb` HRP; a client ignoring
  the tag could fund on the wrong tb-chain. Not cryptographically enforceable.
- **Arbitration front-running**: CSVs only gate early disputes; later, cascade order
  is enforced socially/reputationally (`arb_index` makes violations attributable).
- **Fee-bump**: stuck cooperative txs are re-signed with a new `coop_sign` (higher
  `fee_sats`); old signatures are not reusable across sighashes.
- **Self-trading**: reputation farming between own identities is made expensive (real
  on-chain trades required), not impossible.

## Reference implementation

noxtr (`_modules_/noxtr/script.onchain.js`), validated end-to-end on testnet3/signet:
cooperative release, arbitration spend and CSV-enforced recovery.
