<?php
    // Noxtr module init
    $after_init = true;

    //$_SESSION['noxtr_tables_v'] = 1;

    // require_once(__DIR__ . '/noxtrstore.class.php');  //movido al autoloader
    NoxtrStore::ensureTables();

    function Administrador() {
        global $_ACL; 
        return ( $_ACL->userHasRoleName('Administradores') ); 
    }
    
    function Root() {
        global $_ACL; 
        return ( $_ACL->userHasRoleName('Root') ); 
        //    return ( $_SESSION['userid']<3);  //FIX add superadmin or 'Root' role
    }

    function Cliente() {
        global $_ACL; 
        return ( $_SESSION['userid']>1);
    }

    function Usuario() {
        global $_ACL; 
        return ( $_SESSION['userid']>0 );
    }  
    
   // if($_ARGS[1]=='admin' && Administrador()) 
       $db_engine = 'scaffold';