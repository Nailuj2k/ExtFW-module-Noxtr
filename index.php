<?php    


    // .well-known endpoints (NIP-05, LNURL-pay) must be publicly accessible
    $isWellknown = (OUTPUT === 'raw' && ($_ARGS[2] ?? '') === 'wellknown');

    //   if($isWellknown || $_SESSION['valid_user']) {

        $_SESSION['backurl']=false;

        if (OUTPUT=='ajax'){

            include(SCRIPT_DIR_MODULE.'/ajax.php');

        }else if (OUTPUT=='file'){
    
            include(SCRIPT_DIR_MODULE.'/file.php');               

        }else if (OUTPUT=='html'){

            include(SCRIPT_DIR_MODULE.'/html.php'); 
        
        }else if (OUTPUT=='json'){

            include(SCRIPT_DIR_MODULE.'/json.php');

        }else if (OUTPUT=='md'){

            include(SCRIPT_DIR_MODULE.'/md.php');

        }else if (OUTPUT=='server'){

            include(SCRIPT_DIR_MODULE.'/server.php');

        }else if (OUTPUT=='raw'){

            if (!empty($_ARGS['action']) && strncmp((string)$_ARGS['action'], 'monitor_', 8) === 0) {
                include(SCRIPT_DIR_MODULE.'/api.php');
            } else {
                include(SCRIPT_DIR_MODULE.'/raw.php');
            }

        }else if (OUTPUT=='api'){

            include(SCRIPT_DIR_MODULE.'/api.php');

        }else if (OUTPUT=='pdf'){

            include(SCRIPT_DIR_MODULE.'/pdf.php');

        }else  if($_ARGS[1]=='trades' && Usuario()){

            include(SCRIPT_DIR_MODULE.'/trades.php');

        }else  if($_ARGS[1]=='disputes' && Usuario()){

            include(SCRIPT_DIR_MODULE.'/disputes.php');

        }else  if($_ARGS[1]=='admin' && Administrador()){
            
            include(SCRIPT_DIR_MODULE.'/admin.php');

        }else if($_ARGS[1]=='install' && Administrador()){
            
            include(SCRIPT_DIR_MODULE.'/install.php');

        }else{

            include(SCRIPT_DIR_MODULE.'/run.php');

        }

/*
    } else {

           $_SESSION['backurl']=MODULE;

           $message_error = '<b>'.t('ACCESS_DENIED').'</b><br />'.t('NEED_TO_BE_LOGGED_IN_TO_USE_THIS_APP');
           echo '<div class="alert"  style="margin:80px 20px 80px 20px;"><p style="margin:20px auto;">'.$message_error.'</p></div>';
           echo '<div style="text-align:center;margin:60px 0 100px 0;"><a class="btn btn-large btn-primary" style="color:white;" href="login"> &nbsp; login <i class="fa fa-chevron-right fa-inverse"></i> &nbsp; </a></div>';

    }    
*/