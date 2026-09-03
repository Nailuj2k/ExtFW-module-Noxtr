<?php

    $tabla = new TableMysql( 'NSTR_TRADES' );

    $tabla->addCols([
        $tabla->field(              'id',       'int')->len(  5)->editable(false)->hide(false),
        $tabla->field(      'created_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(      'updated_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(         'user_id',       'int')->len( 11)->editable(true)->filtrable(true)->label(t('USER')),
        $tabla->field(        'order_id',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('ORDER_ID')),
        $tabla->field(          'method',    'select')->len( 10)->editable(true)->filtrable(true)->label(t('METHOD'))->values([
            'lightning' => 'Lightning',
            'onchain'   => 'On-chain'
        ]),
        $tabla->field(      'request_id',       'int')->len( 11)->editable(true)->filtrable(true)->label(t('REQUEST_ID'))->hide(true),
        $tabla->field(    'robot_pubkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('ROBOT'))->hide(true),
        $tabla->field(      'trade_kind',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label(t('KIND')),
        $tabla->field(      'trade_role',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label(t('ROLE')),
        $tabla->field(    'trade_action',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label(t('ACTION')),
        $tabla->field(          'status',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label(t('STATUS')),
        $tabla->field( 'internal_status',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label(t('INTERNAL_STATUS')),
        $tabla->field(       'is_seller',   'bool')->editable(true)->filtrable(true)->label(t('SELLER')),
        $tabla->field(     'fiat_amount',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label(t('FIAT')),
        $tabla->field(       'fiat_code',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label(t('FIAT_CODE')),
        $tabla->field(      'sat_amount',   'varchar')->len( 20)->editable(true)->searchable(true)->filtrable(true)->label(t('SATS')),
        $tabla->field(  'payment_method',   'varchar')->len(255)->editable(true)->searchable(true)->filtrable(true)->label(t('PAYMENT_METHOD')),
        $tabla->field('identity_fingerprint', 'varchar')->len(128)->editable(true)->searchable(true)->filtrable(true)->label(t('IDENTITY_FP'))->hide(true),
        $tabla->field(    'trade_key_pub',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('TRADE_PUB'))->hide(true),
        $tabla->field(    'trade_privkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('TRADE_PRIV'))->hide(true),
        $tabla->field(      'trade_index',       'int')->len( 11)->editable(true)->filtrable(true)->label(t('TRADE_INDEX'))->hide(true),
        $tabla->field(      'peer_pubkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('PEER_PUB'))->hide(true),
        $tabla->field(       'dispute_id',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('DISPUTE_ID')),
        $tabla->field(    'solver_pubkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('SOLVER_PUB'))->hide(true),
        // ---- On-chain (NostrEscrow, NULL/0 en lightning) ----
        $tabla->field(     'arbitrators',  'textarea')->wysiwyg(false)->editable(true)->searchable(true)->label(t('ARBITRATORS_JSON'))->hide(true)->fieldset('onchain'),
        $tabla->field( 'taproot_address',   'varchar')->len( 80)->editable(true)->searchable(true)->filtrable(true)->label(t('TAPROOT_ADDR'))->hide(true)->fieldset('onchain'),
        $tabla->field(    'funding_txid',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label(t('FUNDING_TXID'))->hide(true)->fieldset('onchain'),
        $tabla->field(    'funding_vout',       'int')->len(  5)->editable(true)->filtrable(true)->label(t('VOUT'))->hide(true)->fieldset('onchain'),
        $tabla->field(   'funding_block',       'int')->len( 11)->editable(true)->filtrable(true)->label(t('BLOCK'))->hide(true)->fieldset('onchain'),
        $tabla->field(   'confirmations',       'int')->len(  5)->editable(true)->filtrable(true)->label(t('CONFIRMS'))->hide(true)->fieldset('onchain'),
        // ---- Tail ----
        $tabla->field(       'my_rating',       'int')->len(  2)->editable(true)->filtrable(true)->label(t('MY_RATING')),
        $tabla->field(        'archived',      'bool')->editable(true)->filtrable(true)->label(t('ARCHIVED')),
        $tabla->field(      'trade_json',   'textarea')->wysiwyg( false)->editable(true)->searchable(true)->label(t('TRADE_JSON'))->hide(true)->fieldset('trade_json'),
    ]);

    $tabla->showtitle = true;
    $tabla->title     = t('TRADES');
    $tabla->page      = $page;
    $tabla->orderby   = 'id DESC';

    $tabla->where = 'user_id = '.$_SESSION['userid'];

    $tabla->perms['delete'] = Administrador();
    $tabla->perms['edit']   = Administrador();
    $tabla->perms['add']    = Administrador();
    $tabla->perms['setup']  = Root();
    $tabla->perms['reload'] = true;
    $tabla->perms['filter'] = true;
    $tabla->perms['view']   = true;
