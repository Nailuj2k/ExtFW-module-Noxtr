<?php

    $tabla = new TableMysql('NSTR_NOXTR_SITES');

    $tabla->addCols([
        $tabla->field(           'id',       'int')->len(  8)->editable(false)->hide(true),
        $tabla->field(      'site_id',   'varchar')->len(64)->editable(false)->searchable(true)->filtrable(true)->label(t('SITE')),
        $tabla->field(     'site_url',   'varchar')->len(255)->editable(false)->searchable(true)->filtrable(true)->label(t('SITE_URL')),
        $tabla->field(      'api_key',   'varchar')->len(128)->editable(false)->searchable(true)->filtrable(true)->label(t('API_KEY')),
        $tabla->field(   'created_at',  'unixtime')->readonly(true)->searchable(true),
        $tabla->field(   'updated_at',  'unixtime')->readonly(true),
        $tabla->field(       'active',      'bool')->editable(true)->filtrable(true)->label(t('ACTIVE')),
    ]);

    $tabla->name = 'NSTR_NOXTR_SITES';
    $tabla->title = t('NOXTR_SITES');
    $tabla->page = $page;
    $tabla->page_num_items = 10;

    $tabla->perms['delete'] = Administrador();
    $tabla->perms['edit']   = Administrador();
    $tabla->perms['add']    = Administrador();
    $tabla->perms['setup']  = Root();
    $tabla->perms['reload'] = true;
    $tabla->perms['filter'] = true;
    $tabla->perms['view']   = true;


