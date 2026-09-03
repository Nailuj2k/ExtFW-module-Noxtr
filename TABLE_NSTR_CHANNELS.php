<?php
/* Auto created */

$tabla = new TableMysql('NSTR_CHANNELS');

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

$channel_id = new Field();
$channel_id->type      = 'varchar';
$channel_id->len       = 64;
$channel_id->fieldname = 'channel_id';
$channel_id->label     = 'Channel';
$channel_id->editable  = false ;
$channel_id->sortable  = true;
$channel_id->searchable  = true;
$tabla->addCol($channel_id);

$name = new Field();
$name->type      = 'varchar';
$name->len       = 255;
$name->fieldname = 'name';
$name->label     = 'Name';
$name->editable  = false ;
$name->sortable  = true;
$name->searchable  = true;
$tabla->addCol($name);

$about = new Field();
$about->type      = 'textarea';
$about->fieldname = 'about';
$about->label     = 'About';
$about->editable  = false ;
$about->sortable  = true;
$about->searchable  = true;
$tabla->addCol($about);

$picture = new Field();
$picture->type      = 'varchar';
$picture->len       = 512;
$picture->fieldname = 'picture';
$picture->label     = 'Picture';
$picture->editable  = false ;
$picture->sortable  = true;
$picture->searchable  = true;
$tabla->addCol($picture);

$creator_pubkey = new Field();
$creator_pubkey->type      = 'varchar';
$creator_pubkey->len       = 64;
$creator_pubkey->fieldname = 'creator_pubkey';
$creator_pubkey->label     = 'Creator pubkey';
$creator_pubkey->editable  = false ;
$creator_pubkey->sortable  = true;
$creator_pubkey->searchable  = true;
$tabla->addCol($creator_pubkey);

$relay_url = new Field();
$relay_url->type      = 'varchar';
$relay_url->len       = 512;
$relay_url->fieldname = 'relay_url';
$relay_url->label     = 'Relay url';
$relay_url->editable  = false ;
$relay_url->sortable  = true;
$relay_url->searchable  = true;
$tabla->addCol($relay_url);

$pinned = new Field();
$pinned->type      = 'int';
$pinned->len       = 1;
$pinned->fieldname = 'pinned';
$pinned->label     = 'Pinned';
$pinned->editable  = false ;
$pinned->sortable  = true;
$pinned->searchable  = true;
$tabla->addCol($pinned);

$created_at = new Field();
$created_at->type      = 'int';
$created_at->len       = 11;
$created_at->fieldname = 'created_at';
$created_at->label     = 'Created at';
$created_at->editable  = false ;
$created_at->sortable  = true;
$created_at->searchable  = true;
$tabla->addCol($created_at);

$tabla->name = 'NSTR_CHANNELS';
$tabla->title = 'NSTRCHANNELS';
$tabla->verbose=false;
$tabla->output='table';
$tabla->page = $page;
$tabla->page_num_items = 10;
$tabla->show_empty_rows = true;
$tabla->show_inputsearch =true;

$tabla->perms['delete'] = Administrador();
$tabla->perms['edit']   = Administrador();
$tabla->perms['add']    = Administrador();
$tabla->perms['setup']  = Root();
$tabla->perms['reload'] = true;
$tabla->perms['filter'] = true;
$tabla->perms['view']   = true;


class NSTR_CHANNELSEvents extends defaultTableEvents implements iEvents{
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
$tabla->events = New NSTR_CHANNELSEvents();



