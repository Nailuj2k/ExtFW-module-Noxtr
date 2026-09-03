<?php
/* Auto created */

$tabla = new TableMysql('NSTR_CONTACTS');

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

$pubkey = new Field();
$pubkey->type      = 'varchar';
$pubkey->len       = 64;
$pubkey->fieldname = 'pubkey';
$pubkey->label     = 'Pubkey';
$pubkey->editable  = false ;
$pubkey->sortable  = true;
$pubkey->searchable  = true;
$tabla->addCol($pubkey);

$petname = new Field();
$petname->type      = 'varchar';
$petname->len       = 255;
$petname->fieldname = 'petname';
$petname->label     = 'Petname';
$petname->editable  = false ;
$petname->sortable  = true;
$petname->searchable  = true;
$tabla->addCol($petname);

$relay_url = new Field();
$relay_url->type      = 'varchar';
$relay_url->len       = 512;
$relay_url->fieldname = 'relay_url';
$relay_url->label     = 'Relay url';
$relay_url->editable  = false ;
$relay_url->sortable  = true;
$relay_url->searchable  = true;
$tabla->addCol($relay_url);

$created_at = new Field();
$created_at->type      = 'int';
$created_at->len       = 11;
$created_at->fieldname = 'created_at';
$created_at->label     = 'Created at';
$created_at->editable  = false ;
$created_at->sortable  = true;
$created_at->searchable  = true;
$tabla->addCol($created_at);

$tabla->name = 'NSTR_CONTACTS';
$tabla->title = 'NSTRCONTACTS';
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


class NSTR_CONTACTSEvents extends defaultTableEvents implements iEvents{
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
$tabla->events = New NSTR_CONTACTSEvents();



