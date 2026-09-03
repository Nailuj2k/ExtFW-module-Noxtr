<?php
    // Noxtr module init
    $after_init = true;

    $_SESSION['translate']=false; // Disable translation for this module (it has its own i18n system)
    include(SCRIPT_DIR_MODULE.'/i18n/'.$_SESSION['lang'].'.php');

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
    
    // Monedas fiat seleccionables en el filtro del order book (chip 💱).
    // Editar esta lista en nuevas versiones de noxtr. Clave = código ISO usado en las ofertas, valor = nombre mostrado.
    $coins = [
        'USD' => 'US Dollar',
        'EUR' => 'Euro',
        'GBP' => 'British Pound',
        'CHF' => 'Swiss Franc',
        'CAD' => 'Canadian Dollar',
        'AUD' => 'Australian Dollar',
        'JPY' => 'Japanese Yen',
        'CNY' => 'Chinese Yuan',
        'ARS' => 'Argentine Peso',
        'BRL' => 'Brazilian Real',
        'MXN' => 'Mexican Peso',
        'COP' => 'Colombian Peso',
        'CLP' => 'Chilean Peso',
        'PEN' => 'Peruvian Sol',
        'VES' => 'Venezuelan Bolivar',
        'UYU' => 'Uruguayan Peso',
        'BOB' => 'Bolivian Boliviano',
        'CRC' => 'Costa Rican Colon',
        'DOP' => 'Dominican Peso',
        'GTQ' => 'Guatemalan Quetzal',
        'RUB' => 'Russian Ruble',
        'UAH' => 'Ukrainian Hryvnia',
        'TRY' => 'Turkish Lira',
        'INR' => 'Indian Rupee',
        'NGN' => 'Nigerian Naira',
        'ZAR' => 'South African Rand',
        'USDT' => 'Tether',
        'USDC' => 'USD Coin',
    ];

   // if($_ARGS[1]=='admin' && Administrador())
       $db_engine = 'scaffold';