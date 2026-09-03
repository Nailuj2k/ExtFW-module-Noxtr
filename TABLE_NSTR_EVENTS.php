<?php

    $tabla = new TableMysql( 'NSTR_EVENTS' );

    $tabla->addCols([
        $tabla->field(                  'id',       'int')->len(  8)->editable(false)->hide(true),
        $tabla->field(            'event_id',   'varchar')->len(128)->editable(false)->searchable(true)->filtrable(true)->label(t('EVENT_ID')),
        $tabla->field(                'kind',       'int')->len(  6)->editable(false)->filtrable(true)->label(t('KIND')),
        $tabla->field(            'order_id',   'varchar')->len(128)->editable(false)->searchable(true)->filtrable(true)->label(t('ORDER_ID')),
        $tabla->field(             'user_id',       'int')->len( 11)->editable(false)->filtrable(true)->label(t('USER')),
        $tabla->field(    'event_created_at',  'unixtime')->readonly(true)->label(t('EVENT_TIME')),
        $tabla->field(              'source',   'varchar')->len( 32)->editable(false)->filtrable(true)->label(t('SOURCE')),
        $tabla->field(              'status',   'varchar')->len( 32)->editable(false)->filtrable(true)->label(t('STATUS')),
        $tabla->field(   'notification_type',   'varchar')->len( 64)->editable(false)->filtrable(true)->label(t('NOTIF_TYPE')),
        $tabla->field('notification_sent_at',  'unixtime')->readonly(true)->label(t('NOTIF_SENT')),
        $tabla->field(        'processed_at',  'unixtime')->readonly(true)->label(t('PROCESSED')),
        $tabla->field(          'created_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(          'updated_at',  'unixtime')->readonly(true),
        $tabla->field(            'raw_json',  'textarea')->wysiwyg(false)->readonly(true)->fieldset('raw_json')->hide(true)->label(t('RAW_JSON')),
    ]);

    $tabla->showtitle = true;
    $tabla->title     = t('EVENTS');
    $tabla->page      = $page;
    $tabla->orderby   = 'id DESC';

    $tabla->perms['delete'] = Administrador();
    $tabla->perms['edit']   = Administrador();
    $tabla->perms['add']    = false;          // las filas las inserta el monitor automáticamente
    $tabla->perms['setup']  = Root();
    $tabla->perms['reload'] = true;
    $tabla->perms['filter'] = true;
    $tabla->perms['view']   = true;
