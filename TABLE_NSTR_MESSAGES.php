<?php
/* Auto created */

$tabla = new TableMysql('NSTR_MESSAGES');

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

$peer_pubkey = new Field();
$peer_pubkey->type      = 'varchar';
$peer_pubkey->len       = 64;
$peer_pubkey->fieldname = 'peer_pubkey';
$peer_pubkey->label     = 'Peer pubkey';
$peer_pubkey->editable  = false ;
$peer_pubkey->sortable  = true;
$peer_pubkey->searchable  = true;
$tabla->addCol($peer_pubkey);

$sender_pubkey = new Field();
$sender_pubkey->type      = 'varchar';
$sender_pubkey->len       = 64;
$sender_pubkey->fieldname = 'sender_pubkey';
$sender_pubkey->label     = 'Sender pubkey';
$sender_pubkey->editable  = false ;
$sender_pubkey->sortable  = true;
$sender_pubkey->searchable  = true;
$tabla->addCol($sender_pubkey);

$content_encrypted = new Field();
$content_encrypted->type      = 'textarea';
$content_encrypted->fieldname = 'content_encrypted';
$content_encrypted->label     = 'Content encrypted';
$content_encrypted->editable  = false ;
$content_encrypted->sortable  = true;
$content_encrypted->searchable  = true;
$tabla->addCol($content_encrypted);

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

$nip_version = new Field();
$nip_version->type      = 'int';
$nip_version->len       = 4;
$nip_version->fieldname = 'nip_version';
$nip_version->label     = 'Nip version';
$nip_version->editable  = false ;
$nip_version->sortable  = true;
$nip_version->searchable  = true;
$tabla->addCol($nip_version);

$tabla->name = 'NSTR_MESSAGES';
$tabla->title = 'NSTRMESSAGES';
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


class NSTR_MESSAGESEvents extends defaultTableEvents implements iEvents{
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
$tabla->events = New NSTR_MESSAGESEvents();



