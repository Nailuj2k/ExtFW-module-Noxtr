<?php
/* Auto created */

$tabla = new TableMysql('NSTR_BOOKMARKS');

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

$event_id = new Field();
$event_id->type      = 'varchar';
$event_id->len       = 64;
$event_id->fieldname = 'event_id';
$event_id->label     = 'Event';
$event_id->editable  = false ;
$event_id->sortable  = true;
$event_id->searchable  = true;
$tabla->addCol($event_id);

$event_pubkey = new Field();
$event_pubkey->type      = 'varchar';
$event_pubkey->len       = 64;
$event_pubkey->fieldname = 'event_pubkey';
$event_pubkey->label     = 'Event pubkey';
$event_pubkey->editable  = false ;
$event_pubkey->sortable  = true;
$event_pubkey->searchable  = true;
$tabla->addCol($event_pubkey);

$event_content = new Field();
$event_content->type      = 'textarea';
$event_content->fieldname = 'event_content';
$event_content->label     = 'Event content';
$event_content->editable  = false ;
$event_content->sortable  = true;
$event_content->searchable  = true;
$tabla->addCol($event_content);

$event_kind = new Field();
$event_kind->type      = 'int';
$event_kind->len       = 11;
$event_kind->fieldname = 'event_kind';
$event_kind->label     = 'Event kind';
$event_kind->editable  = false ;
$event_kind->sortable  = true;
$event_kind->searchable  = true;
$tabla->addCol($event_kind);

$event_tags = new Field();
$event_tags->type      = 'textarea';
$event_tags->fieldname = 'event_tags';
$event_tags->label     = 'Event tags';
$event_tags->editable  = false ;
$event_tags->sortable  = true;
$event_tags->searchable  = true;
$tabla->addCol($event_tags);

$event_created_at = new Field();
$event_created_at->type      = 'int';
$event_created_at->len       = 11;
$event_created_at->fieldname = 'event_created_at';
$event_created_at->label     = 'Event created at';
$event_created_at->editable  = false ;
$event_created_at->sortable  = true;
$event_created_at->searchable  = true;
$tabla->addCol($event_created_at);

$created_at = new Field();
$created_at->type      = 'int';
$created_at->len       = 11;
$created_at->fieldname = 'created_at';
$created_at->label     = 'Created at';
$created_at->editable  = false ;
$created_at->sortable  = true;
$created_at->searchable  = true;
$tabla->addCol($created_at);

$tabla->name = 'NSTR_BOOKMARKS';
$tabla->title = 'NSTRBOOKMARKS';
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


class NSTR_BOOKMARKSEvents extends defaultTableEvents implements iEvents{
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
$tabla->events = New NSTR_BOOKMARKSEvents();



