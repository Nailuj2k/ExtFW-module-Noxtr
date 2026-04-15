<?php

    $tabla = new TableMysql( 'NSTR_MOSTRO_TRADES' );

    $tabla->addCols([
        $tabla->field(              'id',       'int')->len(  5)->editable(false)->hide(false),
        $tabla->field(      'created_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(      'updated_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(         'user_id',       'int')->len( 11)->editable(true)->filtrable(true)->label('User'),
        $tabla->field(        'order_id',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Order ID'),
        $tabla->field(      'request_id',       'int')->len( 11)->editable(true)->filtrable(true)->label('Request ID')->hide(true),
        $tabla->field(    'robot_pubkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Robot')->hide(true),
        $tabla->field(      'trade_kind',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label('Kind'),
        $tabla->field(      'trade_role',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label('Role'),
        $tabla->field(    'trade_action',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label('Action'),
        $tabla->field(          'status',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label('Status'),
        $tabla->field( 'internal_status',   'varchar')->len( 32)->editable(true)->searchable(true)->filtrable(true)->label('Internal status'),
        $tabla->field(       'is_seller',   'bool')->editable(true)->filtrable(true)->label('Seller'),
        $tabla->field(     'fiat_amount',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label('Fiat'),
        $tabla->field(       'fiat_code',   'varchar')->len( 10)->editable(true)->searchable(true)->filtrable(true)->label('Fiat code'),
        $tabla->field(      'sat_amount',   'varchar')->len( 20)->editable(true)->searchable(true)->filtrable(true)->label('Sats'),
        $tabla->field(  'payment_method',   'varchar')->len(255)->editable(true)->searchable(true)->filtrable(true)->label('Payment method'),
        $tabla->field('identity_fingerprint', 'varchar')->len(128)->editable(true)->searchable(true)->filtrable(true)->label('Identity fp')->hide(true),
        $tabla->field(    'trade_key_pub',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Trade pub')->hide(true),
        $tabla->field(    'trade_privkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Trade priv')->hide(true),
        $tabla->field(      'trade_index',       'int')->len( 11)->editable(true)->filtrable(true)->label('Trade index')->hide(true),
        $tabla->field(      'peer_pubkey',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Peer pub')->hide(true),
        $tabla->field(       'my_rating',       'int')->len(  2)->editable(true)->filtrable(true)->label('My rating'),
        $tabla->field(        'archived',      'bool')->editable(true)->filtrable(true)->label('Archived'),
        $tabla->field(      'trade_json',   'textarea')->wysiwyg( false)->editable(true)->searchable(true)->label('trade json')->hide(true)->fieldset('trade_json'),
    ]);

    $tabla->showtitle = true;
    $tabla->title     = 'Trades';
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

