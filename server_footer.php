

<script type="text/javascript">
	    
    $("#panel-mostro-monitor .button").click(function(){
        
        var params = {};
        var button = $(this);
        var socket_connected = false;
        params["action"] = 'server';
        params["option"] = $(this).attr('op');
    
        $.ajax({
            method: "POST",
            url: "<?=MODULE?>/ajax",    // La url de entrada para ajax, q en este caso sería tienda.extralab.net/socket/ajax/parametros ...
            data: params,
            timeout:5000, 
            dataType: 'json',
            type: 'post',
            beforeSend: function( xhr, settings ) {
                button.addClass('waiting');//.closest('table').prop("disabled",true);
            }
        }).done(function( data ) {

            $('#ajax-result').html(data.content).fadeIn();

            if( /^[0-9]{4,10}$/.test(data.content) ){                    // Asi se ve si deviuelve un PID
                socket_connected = /^[0-9]{4,10}$/.test(data.content);   // si es un PID está activo el server, :)
            }

        }).fail(function(jqXHR, textStatus) {
            //showMessageError( "error" );
            if(textStatus === 'timeout') $('#ajax-result').html('El dispositivo remoto no parece estar conectado o tarda demasiado en responder').fadeIn();
                                    else $('#ajax-result').html(textStatus).fadeIn();

        }).always(function() {

            button.removeClass('waiting');

        });
        
    });
    
    $(document).ready(function(){ 
        // $('#btn-status').click();    
    });
            
 </script>