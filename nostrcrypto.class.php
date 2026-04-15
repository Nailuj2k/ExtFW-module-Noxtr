<?php
/**
 * Minimal Nostr server-side crypto: BIP-340 Schnorr signatures on secp256k1
 * Requires PHP GMP extension
 */

class NostrCrypto {
    private static $p, $n, $Gx, $Gy;
    private static $chachaConst = null;

    private static function init() {
        if (self::$p) return;
        self::$p  = gmp_init('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F', 16);
        self::$n  = gmp_init('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16);
        self::$Gx = gmp_init('79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798', 16);
        self::$Gy = gmp_init('483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8', 16);
    }

    // --- Elliptic curve point operations ---

    private static function pointAdd($x1, $y1, $x2, $y2) {
        self::init();
        if (is_null($x1)) return [$x2, $y2];
        if (is_null($x2)) return [$x1, $y1];
        if (gmp_cmp($x1, $x2) === 0 && gmp_cmp($y1, $y2) === 0) return self::pointDouble($x1, $y1);
        if (gmp_cmp($x1, $x2) === 0) return [null, null];
        $s = gmp_mod(gmp_mul(gmp_sub($y2, $y1), gmp_invert(gmp_sub($x2, $x1), self::$p)), self::$p);
        $x3 = gmp_mod(gmp_sub(gmp_sub(gmp_mul($s, $s), $x1), $x2), self::$p);
        $y3 = gmp_mod(gmp_sub(gmp_mul($s, gmp_sub($x1, $x3)), $y1), self::$p);
        if (gmp_cmp($x3, 0) < 0) $x3 = gmp_add($x3, self::$p);
        if (gmp_cmp($y3, 0) < 0) $y3 = gmp_add($y3, self::$p);
        return [$x3, $y3];
    }

    private static function pointDouble($x, $y) {
        self::init();
        if (is_null($x)) return [null, null];
        $s = gmp_mod(gmp_mul(gmp_mul(gmp_init(3), gmp_mul($x, $x)), gmp_invert(gmp_mul(gmp_init(2), $y), self::$p)), self::$p);
        $x3 = gmp_mod(gmp_sub(gmp_mul($s, $s), gmp_mul(gmp_init(2), $x)), self::$p);
        $y3 = gmp_mod(gmp_sub(gmp_mul($s, gmp_sub($x, $x3)), $y), self::$p);
        if (gmp_cmp($x3, 0) < 0) $x3 = gmp_add($x3, self::$p);
        if (gmp_cmp($y3, 0) < 0) $y3 = gmp_add($y3, self::$p);
        return [$x3, $y3];
    }

    private static function pointMul($k, $x, $y) {
        $rx = null; $ry = null;
        $bits = gmp_strval($k, 2);
        for ($i = 0; $i < strlen($bits); $i++) {
            [$rx, $ry] = self::pointDouble($rx, $ry);
            if ($bits[$i] === '1') [$rx, $ry] = self::pointAdd($rx, $ry, $x, $y);
        }
        return [$rx, $ry];
    }

    // --- Helpers ---

    private static function gmpTo32Bytes($v) {
        $hex = gmp_strval($v, 16);
        return hex2bin(str_pad($hex, 64, '0', STR_PAD_LEFT));
    }

    private static function liftX($x) {
        self::init();
        $x3 = gmp_powm($x, 3, self::$p);
        $y2 = gmp_mod(gmp_add($x3, 7), self::$p);
        $exp = gmp_div(gmp_add(self::$p, 1), 4);
        $y = gmp_powm($y2, $exp, self::$p);

        if (gmp_cmp(gmp_powm($y, 2, self::$p), $y2) !== 0) {
            return null;
        }

        if (!self::hasEvenY($y)) {
            $y = gmp_sub(self::$p, $y);
        }

        return [$x, $y];
    }

    private static function taggedHash($tag, $msg) {
        $th = hash('sha256', $tag, true);
        return hash('sha256', $th . $th . $msg, true);
    }

    private static function hasEvenY($y) {
        return gmp_cmp(gmp_mod($y, gmp_init(2)), 0) === 0;
    }

    private static function hmacSha256($key, $data) {
        return hash_hmac('sha256', $data, $key, true);
    }

    private static function hkdfExpand($prk, $info, $len) {
        $okm = '';
        $t = '';
        $counter = 1;

        while (strlen($okm) < $len) {
            $t = self::hmacSha256($prk, $t . $info . chr($counter));
            $okm .= $t;
            $counter++;
        }

        return substr($okm, 0, $len);
    }

    private static function calcPadding($len) {
        if ($len <= 32) {
            return 32;
        }

        $nextPow2 = 1;
        while ($nextPow2 < $len) {
            $nextPow2 <<= 1;
        }

        $chunk = $nextPow2 <= 256 ? 32 : (int)($nextPow2 / 8);
        return $chunk * ((int)floor(($len - 1) / $chunk) + 1);
    }

    private static function nip44Unpad($padded) {
        if (!is_string($padded) || strlen($padded) < 2) {
            throw new Exception('Invalid NIP-44 padded payload');
        }

        $len = unpack('nlen', substr($padded, 0, 2));
        $len = (int)$len['len'];

        if ($len < 1 || (2 + $len) > strlen($padded)) {
            throw new Exception('Invalid NIP-44 padding');
        }

        return substr($padded, 2, $len);
    }

    private static function nip44Pad($plaintext) {
        if (!is_string($plaintext) || $plaintext === '') {
            throw new Exception('Invalid NIP-44 plaintext');
        }

        $len = strlen($plaintext);
        $targetLen = self::calcPadding($len);
        $prefix = pack('n', $len);

        return $prefix . $plaintext . str_repeat("\x00", max(0, $targetLen - $len));
    }

    private static function leToInt32($bytes) {
        $unpacked = unpack('Vn', $bytes);
        return (int)$unpacked['n'];
    }

    private static function int32ToLe($value) {
        return pack('V', $value & 0xffffffff);
    }

    private static function rotl32($value, $count) {
        $value &= 0xffffffff;
        return (($value << $count) | (($value & 0xffffffff) >> (32 - $count))) & 0xffffffff;
    }

    private static function quarterRound(array &$x, $a, $b, $c, $d) {
        $x[$a] = ($x[$a] + $x[$b]) & 0xffffffff; $x[$d] ^= $x[$a]; $x[$d] = self::rotl32($x[$d], 16);
        $x[$c] = ($x[$c] + $x[$d]) & 0xffffffff; $x[$b] ^= $x[$c]; $x[$b] = self::rotl32($x[$b], 12);
        $x[$a] = ($x[$a] + $x[$b]) & 0xffffffff; $x[$d] ^= $x[$a]; $x[$d] = self::rotl32($x[$d], 8);
        $x[$c] = ($x[$c] + $x[$d]) & 0xffffffff; $x[$b] ^= $x[$c]; $x[$b] = self::rotl32($x[$b], 7);
    }

    private static function getChachaConst() {
        if (self::$chachaConst === null) {
            self::$chachaConst = [
                self::leToInt32("expa"),
                self::leToInt32("nd 3"),
                self::leToInt32("2-by"),
                self::leToInt32("te k"),
            ];
        }
        return self::$chachaConst;
    }

    private static function chacha20Block($key, $nonce, $counter) {
        if (strlen($key) !== 32) {
            throw new Exception('ChaCha20 key must be 32 bytes');
        }
        if (strlen($nonce) !== 12) {
            throw new Exception('ChaCha20 nonce must be 12 bytes');
        }

        $state = self::getChachaConst();

        for ($i = 0; $i < 8; $i++) {
            $state[] = self::leToInt32(substr($key, $i * 4, 4));
        }

        $state[] = $counter & 0xffffffff;
        $state[] = self::leToInt32(substr($nonce, 0, 4));
        $state[] = self::leToInt32(substr($nonce, 4, 4));
        $state[] = self::leToInt32(substr($nonce, 8, 4));

        $working = $state;
        for ($i = 0; $i < 10; $i++) {
            self::quarterRound($working, 0, 4, 8, 12);
            self::quarterRound($working, 1, 5, 9, 13);
            self::quarterRound($working, 2, 6, 10, 14);
            self::quarterRound($working, 3, 7, 11, 15);
            self::quarterRound($working, 0, 5, 10, 15);
            self::quarterRound($working, 1, 6, 11, 12);
            self::quarterRound($working, 2, 7, 8, 13);
            self::quarterRound($working, 3, 4, 9, 14);
        }

        $out = '';
        for ($i = 0; $i < 16; $i++) {
            $word = ($working[$i] + $state[$i]) & 0xffffffff;
            $out .= self::int32ToLe($word);
        }

        return $out;
    }

    private static function chacha20Xor($key, $nonce, $data) {
        $out = '';
        $counter = 0;
        $len = strlen($data);

        for ($offset = 0; $offset < $len; $offset += 64) {
            $block = self::chacha20Block($key, $nonce, $counter++);
            $chunk = substr($data, $offset, 64);
            $chunkLen = strlen($chunk);
            $xor = '';

            for ($i = 0; $i < $chunkLen; $i++) {
                $xor .= $chunk[$i] ^ $block[$i];
            }

            $out .= $xor;
        }

        return $out;
    }

    // --- Public API ---

    /** Get public key (32-byte x-only hex) from private key (32-byte hex) */
    public static function getPublicKey($privkeyHex) {
        self::init();
        $d = gmp_init($privkeyHex, 16);
        [$px, $py] = self::pointMul($d, self::$Gx, self::$Gy);
        return str_pad(gmp_strval($px, 16), 64, '0', STR_PAD_LEFT);
    }

    /** Generate a new keypair: returns ['privkey' => hex, 'pubkey' => hex] */
    public static function generateKeypair() {
        $privkey = bin2hex(random_bytes(32));
        $pubkey = self::getPublicKey($privkey);
        return ['privkey' => $privkey, 'pubkey' => $pubkey];
    }

    /** Get ECDH shared X coordinate (32 bytes binary) from privkey hex and x-only pubkey hex. */
    public static function getSharedSecretX($privkeyHex, $pubkeyHex) {
        self::init();

        $d = gmp_init($privkeyHex, 16);
        $px = gmp_init($pubkeyHex, 16);
        $point = self::liftX($px);
        if ($point === null) {
            throw new Exception('Invalid secp256k1 x-only pubkey');
        }

        list($pubX, $pubY) = $point;
        list($sx, $sy) = self::pointMul($d, $pubX, $pubY);
        if ($sx === null) {
            throw new Exception('Invalid shared secret point');
        }

        return self::gmpTo32Bytes($sx);
    }

    /** NIP-44 v2 conversation key (32 bytes binary). */
    public static function nip44GetConversationKey($privkeyHex, $pubkeyHex) {
        $sharedX = self::getSharedSecretX($privkeyHex, $pubkeyHex);
        return self::hmacSha256('nip44-v2', $sharedX);
    }

    /** NIP-44 v2 decrypt. Returns plaintext string. */
    public static function nip44Decrypt($payload, $conversationKey) {
        $raw = base64_decode((string)$payload, true);
        if ($raw === false || strlen($raw) < 65) {
            throw new Exception('Invalid NIP-44 payload');
        }

        if (ord($raw[0]) !== 0x02) {
            throw new Exception('Unsupported NIP-44 version');
        }

        $nonce = substr($raw, 1, 32);
        $mac = substr($raw, -32);
        $ciphertext = substr($raw, 33, -32);
        $mk = self::hkdfExpand($conversationKey, $nonce, 76);
        $chachaKey = substr($mk, 0, 32);
        $chachaNonce = substr($mk, 32, 12);
        $hmacKey = substr($mk, 44, 32);
        $expectedMac = self::hmacSha256($hmacKey, $nonce . $ciphertext);

        if (!hash_equals($expectedMac, $mac)) {
            throw new Exception('Invalid NIP-44 MAC');
        }

        $padded = self::chacha20Xor($chachaKey, $chachaNonce, $ciphertext);
        return self::nip44Unpad($padded);
    }

    /** NIP-44 v2 encrypt. Returns base64 payload string. */
    public static function nip44Encrypt($plaintext, $conversationKey) {
        $nonce = random_bytes(32);
        $padded = self::nip44Pad((string)$plaintext);
        $mk = self::hkdfExpand($conversationKey, $nonce, 76);
        $chachaKey = substr($mk, 0, 32);
        $chachaNonce = substr($mk, 32, 12);
        $hmacKey = substr($mk, 44, 32);
        $ciphertext = self::chacha20Xor($chachaKey, $chachaNonce, $padded);
        $mac = self::hmacSha256($hmacKey, $nonce . $ciphertext);

        return base64_encode("\x02" . $nonce . $ciphertext . $mac);
    }

    /**
     * Unwrap Mostro gift wrap (kind 1059 -> seal kind 13 -> rumor).
     *
     * @param array $giftWrapEvent Nostr event array
     * @return array|null Decoded rumor event array
     */
    public static function unwrapGiftWrap($giftWrapEvent, $ourPrivkeyHex) {
        try {
            $wrapConvKey = self::nip44GetConversationKey($ourPrivkeyHex, (string)$giftWrapEvent['pubkey']);
            $sealJson = self::nip44Decrypt((string)$giftWrapEvent['content'], $wrapConvKey);
            $seal = json_decode($sealJson, true);
            if (!is_array($seal) || empty($seal['pubkey']) || !isset($seal['content'])) {
                return null;
            }

            $sealConvKey = self::nip44GetConversationKey($ourPrivkeyHex, (string)$seal['pubkey']);
            $rumorJson = self::nip44Decrypt((string)$seal['content'], $sealConvKey);
            $rumor = json_decode($rumorJson, true);

            return is_array($rumor) ? $rumor : null;
        } catch (Exception $e) {
            return null;
        }
    }

    /**
     * Build a Mostro/NIP-59 gift wrap.
     *
     * Rumor and seal are signed with the trade key, mirroring the browser client.
     *
     * @param string $rumorContent JSON string, typically [msgObj, null]
     * @return array<string,mixed>
     */
    public static function createMostroGiftWrap($rumorContent, $recipientPubkeyHex, $tradePrivkeyHex) {
        $rumor = self::createEvent(
            $tradePrivkeyHex,
            1,
            (string)$rumorContent,
            [['p', $recipientPubkeyHex]],
            time()
        );

        $sealConvKey = self::nip44GetConversationKey($tradePrivkeyHex, $recipientPubkeyHex);
        $seal = self::createEvent(
            $tradePrivkeyHex,
            13,
            self::nip44Encrypt(json_encode($rumor, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $sealConvKey),
            [],
            time() - random_int(0, 7200)
        );

        $eph = self::generateKeypair();
        $wrapConvKey = self::nip44GetConversationKey($eph['privkey'], $recipientPubkeyHex);

        return self::createEvent(
            $eph['privkey'],
            1059,
            self::nip44Encrypt(json_encode($seal, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $wrapConvKey),
            [['p', $recipientPubkeyHex]],
            time()
        );
    }

    /** BIP-340 Schnorr sign: returns 64-byte hex signature */
    public static function sign($privkeyHex, $messageBytes) {
        self::init();
        $d0 = gmp_init($privkeyHex, 16);
        [$px, $py] = self::pointMul($d0, self::$Gx, self::$Gy);
        $d = self::hasEvenY($py) ? $d0 : gmp_sub(self::$n, $d0);
        $pBytes = self::gmpTo32Bytes($px);

        $aux = random_bytes(32);
        $t = self::gmpTo32Bytes($d) ^ self::taggedHash('BIP0340/aux', $aux);
        $rand = self::taggedHash('BIP0340/nonce', $t . $pBytes . $messageBytes);
        $k0 = gmp_mod(gmp_init(bin2hex($rand), 16), self::$n);
        if (gmp_cmp($k0, 0) === 0) throw new \Exception('Nonce is zero');

        [$rx, $ry] = self::pointMul($k0, self::$Gx, self::$Gy);
        $k = self::hasEvenY($ry) ? $k0 : gmp_sub(self::$n, $k0);
        $rBytes = self::gmpTo32Bytes($rx);

        $eHash = self::taggedHash('BIP0340/challenge', $rBytes . $pBytes . $messageBytes);
        $e = gmp_mod(gmp_init(bin2hex($eHash), 16), self::$n);
        $sig = gmp_mod(gmp_add($k, gmp_mul($e, $d)), self::$n);

        return bin2hex($rBytes) . str_pad(gmp_strval($sig, 16), 64, '0', STR_PAD_LEFT);
    }

    /** Create and sign a Nostr event. Returns the full event with id and sig */
    public static function createEvent($privkeyHex, $kind, $content, $tags = [], $createdAt = null) {
        $pubkey = self::getPublicKey($privkeyHex);
        $createdAt = $createdAt ?: time();
        $serialized = json_encode([0, $pubkey, $createdAt, $kind, $tags, $content], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $id = hash('sha256', $serialized);
        $sig = self::sign($privkeyHex, hex2bin($id));

        return [
            'id'         => $id,
            'pubkey'     => $pubkey,
            'created_at' => $createdAt,
            'kind'       => $kind,
            'tags'       => $tags,
            'content'    => $content,
            'sig'        => $sig
        ];
    }

    /** Publish an event to a relay via WebSocket */
    public static function publishToRelay($relayUrl, $event, $timeout = 5) {
        $parsed = parse_url($relayUrl);
        $host = $parsed['host'] ?? '';
        $port = ($parsed['scheme'] ?? '') === 'wss' ? 443 : 80;
        $path = $parsed['path'] ?? '/';
        $ssl = $port === 443;

        $ctx = stream_context_create();
        if ($ssl) {
            stream_context_set_option($ctx, 'ssl', 'verify_peer', false);
            stream_context_set_option($ctx, 'ssl', 'verify_peer_name', false);
        }

        $prefix = $ssl ? 'ssl://' : 'tcp://';
        $sock = @stream_socket_client($prefix . $host . ':' . $port, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$sock) return false;

        stream_set_timeout($sock, $timeout);

        // WebSocket handshake
        $key = base64_encode(random_bytes(16));
        $headers = "GET $path HTTP/1.1\r\n" .
            "Host: $host\r\n" .
            "Upgrade: websocket\r\n" .
            "Connection: Upgrade\r\n" .
            "Sec-WebSocket-Key: $key\r\n" .
            "Sec-WebSocket-Version: 13\r\n\r\n";
        fwrite($sock, $headers);

        $response = '';
        while (($line = fgets($sock)) !== false) {
            $response .= $line;
            if (trim($line) === '') break;
        }
        if (strpos($response, '101') === false) { fclose($sock); return false; }

        // Send EVENT message
        $payload = json_encode(['EVENT', $event], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $len = strlen($payload);
        if ($len < 126) {
            $frame = chr(0x81) . chr(0x80 | $len);
        } elseif ($len < 65536) {
            $frame = chr(0x81) . chr(0x80 | 126) . pack('n', $len);
        } else {
            $frame = chr(0x81) . chr(0x80 | 127) . pack('J', $len);
        }
        $mask = random_bytes(4);
        $frame .= $mask;
        for ($i = 0; $i < $len; $i++) $frame .= $payload[$i] ^ $mask[$i % 4];
        fwrite($sock, $frame);

        // Wait briefly for OK response
        usleep(500000);

        // Close
        fwrite($sock, chr(0x88) . chr(0x80) . random_bytes(4));
        fclose($sock);
        return true;
    }

    /** Publish event to multiple relays */
    public static function publishToRelays($relayUrls, $event, $timeout = 5) {
        $ok = 0;
        foreach ($relayUrls as $url) {
            if (self::publishToRelay($url, $event, $timeout)) $ok++;
        }
        return $ok;
    }
}
