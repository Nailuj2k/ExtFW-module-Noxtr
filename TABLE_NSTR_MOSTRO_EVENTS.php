<?php

    $tabla = new TableMysql( 'NSTR_MOSTRO_EVENTS' );

    $tabla->addCols([
        $tabla->field(           'id',       'int')->len(  5)->editable(false)->hide(true),
        $tabla->field(   'created_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(      'user_id',       'int')->len( 11)->editable(true)->filtrable(true)->label('From'),
        $tabla->field(    'direction',   'varchar')->len(  3)->editable(true)->filtrable(true),
        $tabla->field(        'relay',   'varchar')->len(255)->editable(true)->searchable(true)->filtrable(true)->label('Relay'),
        $tabla->field(     'order_id',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Order ID'),
        $tabla->field(       'action',   'varchar')->len( 64)->editable(true)->searchable(true)->filtrable(true)->label('Action'),
        $tabla->field(         'role',    'select')->len( 10)->editable(true)->filtrable(true)->values([
            'seller' => 'Vendedor',
            'buyer' => 'Comprador'
        ]),
        $tabla->field(      'content', 'textarea' )->fieldset('content')->wysiwyg(false)->readonly(true)->searchable(true)->hide(true)
    ]);

    $tabla->showtitle = true;
    $tabla->page     = $page;
    $tabla->orderby  = 'id DESC';

    $tabla->perms['delete'] = Administrador();
    $tabla->perms['edit']   = Administrador();
    $tabla->perms['add']    = Administrador();
    $tabla->perms['setup']  = Root();
    $tabla->perms['reload'] = true;
    $tabla->perms['filter'] = true;
    $tabla->perms['view']   = true;



    