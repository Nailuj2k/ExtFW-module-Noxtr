<?php
/* Auto created */

$tabla = new TableMysql('NSTR_NIP96_SERVERS');

$id = new Field();
$id->type      = 'int';
$id->len       = 11;
$id->fieldname = 'id';
$id->label     = 'Id';
$id->editable  = false ;
$id->sortable  = true;
$id->searchable  = true;
$tabla->addCol($id);

$user_id = new Field();
$user_id->type      = 'int';
$user_id->len       = 11;
$user_id->fieldname = 'user_id';
$user_id->label     = 'User';
$user_id->editable  = false ;
$user_id->sortable  = true;
$user_id->searchable  = true;
$tabla->addCol($user_id);

$url = new Field();
$url->type      = 'varchar';
$url->len       = 512;
$url->fieldname = 'url';
$url->label     = 'Url';
$url->editable  = false ;
$url->sortable  = true;
$url->searchable  = true;
$tabla->addCol($url);

$sort_order = new Field();
$sort_order->type      = 'int';
$sort_order->len       = 11;
$sort_order->fieldname = 'sort_order';
$sort_order->label     = 'Sort order';
$sort_order->editable  = false ;
$sort_order->sortable  = true;
$sort_order->searchable  = true;
$tabla->addCol($sort_order);

$tabla->name = 'NSTR_NIP96_SERVERS';
$tabla->title = 'NSTRNIP96SERVERS';
$tabla->verbose=false;
$tabla->output='table';
$tabla->page = $page;
$tabla->page_num_items = 10;
$tabla->show_empty_rows = true;
$tabla->show_inputsearch =true;
$tabla->addActiveCol();

$tabla->perms['delete'] = Administrador();
$tabla->perms['edit']   = Administrador();
$tabla->perms['add']    = Administrador();
$tabla->perms['setup']  = Root();
$tabla->perms['reload'] = true;
$tabla->perms['filter'] = true;
$tabla->perms['view']   = true;


class NSTR_NIP96_SERVERSEvents extends defaultTableEvents implements iEvents{
  function OnInsert($owner,&$result,&$post) { 
      $result['error'] = 5;
      $result['msg'] = '¡Esto es el evento OnInsert!';
  }
  function OnUpdate($owner,&$result,&$post) { 
      $result['error'] =5;
      $result['msg'] = '¡Esto es el evento OnUpdate! ';
  }
  function OnDelete($owner,&$result,$id)    { 
      $result['error'] =5;
      $result['msg'] = '¡Esto es el evento OnDelete!';
  }
}
$tabla->events = New NSTR_NIP96_SERVERSEvents();



