<?php
/**
 * /noxtr/disputes — listado de trades con disputa abierta o resuelta.
 * Lee directamente NSTR_TRADES filtrando dispute_id != ''.
 */

$userId = (int)($_SESSION['userid'] ?? 0);
if ($userId <= 0) {
    echo '<div class="alert">'.t('NEED_LOGIN').'</div>';
    return;
}

$rows = NoxtrStore::sqlQueryPrepared(
    "SELECT order_id, internal_status, status, trade_action, trade_role, is_seller,
            fiat_amount, fiat_code, payment_method,
            dispute_id, solver_pubkey, peer_pubkey, robot_pubkey,
            created_at, updated_at
     FROM NSTR_TRADES
     WHERE user_id = ?
       AND dispute_id IS NOT NULL
       AND dispute_id <> ''
     ORDER BY updated_at DESC, id DESC",
    [$userId]
) ?: [];

function _shortId($s, $n = 8) {
    $s = (string)$s;
    if (strpos($s, 'tmp-') === 0) $s = preg_replace('/^tmp-[^-]+-/', '', $s);
    return substr($s, 0, $n);
}
?>
<div class="inner" style="margin: 0 -100px; padding: 20px;">
    <h2 style="margin-bottom: 16px;">⚖️ <?=t('MOSTRO_DISPUTES')?></h2>

    <?php if (!$rows): ?>
        <div class="alert alert-info" style="padding: 16px; background: #f0f4f8; border-radius: 6px;">
            <?=t('NOXTR_NO_DISPUTES')?>
        </div>
    <?php else: ?>
        <p style="color: #666; margin-bottom: 16px;">
            <?= count($rows) ?> <?= count($rows) === 1 ? t('REGISTERED_DISPUTE') : t('REGISTERED_DISPUTES') ?>.
        </p>

        <table class="table table-striped" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f0f4f8; border-bottom: 2px solid #ddd;">
                    <th style="padding: 8px; text-align: left;"><?=t('DISPUTE')?></th>
                    <th style="padding: 8px; text-align: left;">Trade</th>
                    <th style="padding: 8px; text-align: left;"><?=t('ROLE')?></th>
                    <th style="padding: 8px; text-align: left;"><?=t('AMOUNT')?></th>
                    <th style="padding: 8px; text-align: left;"><?=t('STATUS')?></th>
                    <th style="padding: 8px; text-align: left;">Admin</th>
                    <th style="padding: 8px; text-align: left;"><?=t('LAST_UPDATE_ABBR')?></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($rows as $r):
                $disputeShort  = _shortId($r['dispute_id']);
                $orderShort    = _shortId($r['order_id']);
                $role          = ($r['trade_role'] ?? '') === 'created' ? t('CREATED_F') : t('TAKEN_F');
                $side          = (int)($r['is_seller'] ?? 0) ? t('SELLING') : t('BUYING');
                $solverShort   = $r['solver_pubkey'] ? substr($r['solver_pubkey'], 0, 12).'…' : '<span style="color:#999;">— '.t('UNASSIGNED').'</span>';
                $statusLabel   = (string)($r['internal_status'] ?? '');
                $action        = (string)($r['trade_action'] ?? '');
                $initiator     = $action === 'dispute-initiated-by-peer' ? t('THE_COUNTERPARTY') : t('YOU');
                $updatedTs     = (int)($r['updated_at'] ?? 0);
                $updatedHuman  = $updatedTs ? date('Y-m-d H:i', $updatedTs) : '—';
            ?>
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px;">
                        <code title="<?= htmlspecialchars($r['dispute_id']) ?>">#<?= htmlspecialchars($disputeShort) ?></code>
                        <div style="font-size: 11px; color: #999;"><?=t('INITIATED_BY')?> <?= htmlspecialchars($initiator) ?></div>
                    </td>
                    <td style="padding: 8px;">
                        <a href="/noxtr" title="<?= htmlspecialchars($r['order_id']) ?>">#<?= htmlspecialchars($orderShort) ?></a>
                    </td>
                    <td style="padding: 8px;">
                        <?= htmlspecialchars($role) ?> · <?= htmlspecialchars($side) ?>
                    </td>
                    <td style="padding: 8px;">
                        <?= htmlspecialchars((string)$r['fiat_amount']) ?> <?= htmlspecialchars((string)$r['fiat_code']) ?>
                        <div style="font-size: 11px; color: #999;"><?= htmlspecialchars((string)$r['payment_method']) ?></div>
                    </td>
                    <td style="padding: 8px;"><?= htmlspecialchars($statusLabel) ?></td>
                    <td style="padding: 8px;"><?= $solverShort ?></td>
                    <td style="padding: 8px;"><?= htmlspecialchars($updatedHuman) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>

    <p style="margin-top: 24px; color: #999; font-size: 12px;">
        <?=t('NOXTR_DISPUTES_DATA_SOURCE')?>
        <code>dispute-initiated-by-you</code>, <code>dispute-initiated-by-peer</code>, <code>admin-took-dispute</code>).
    </p>
</div>
