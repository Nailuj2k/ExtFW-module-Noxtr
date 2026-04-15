

## Crear Orden Venta en MM. (no hay q meter lnaddress en MM)

1. se toma en noxtr, dando a COMPRAR
2. noxtr pide lnddres
3. MM muestra qrcode
4. pago holdinvoice lnbc
5. MM detecta pago holdinvoice y cierra qrcode y muestra CONTACTAR
6. CHAT funciona perfectamente en los dos sentidos
7. en Noxtr aparece 'Enviar Fiat'. se eenvia fiat
8. MM aparec 'Liberar', y libero. 
  Nota No Importante: ahora el chat noxtr pone 'sin mensajes', pero si escribes 
                      desde mm funciona perfecto, en los dos sentidos
9. Calificar funciona perfecto


## Crear orden Compra en MM                
1. Creo orden compra en MM
2. NOXTR aparece en Order book. le doy a 'Vender'. Apatrece qrcode, Pago con WOS
3. desparece qrcode en NOXTR
4. En MM parece button 'Fiat enviado'
5. En NOXTR aparece 'Librera sats'
6. CHAT funciona PEFECTO!!!! 
7. Pulsamos Fiat enviado en MM
8. En Noxtr y MM sale para calificar


## Crear orden de Compra en NOXTR y tomar con NOXTR             *
1. NOXTR0  le ponemos lnaddess en el form
2. NOXTR1 tomamos orden, ùlsando en Vender, sale qrcode y pagamos
3. NOXTR1. sale msg 'esperando fiat'
4. NOXTR0. sale Btn 'Fiat enviado'
5. NOXTR0 y NOXTR1 CHAT funciona perfecto
6. Enviamos  fiat y liberamos sats,TODO PERFECTO


## Crear orden de Venta en Noxtr.

0. Cremaos orden de Venta en NOXTR0 (tienda)
1. se topma en NOXTR1 (noxtr), dando a COMPRAR. 
2. NOXTR1 Pide lnaddress 
3. en NOXTR0 sale qrcode y pago invoice con WOS
4. en NOXTR1 sale btn 'Fiat enviado'
5. en NOXTR1 pulso 'fiat enviado' y en NOXTR0 sale boton 'Loiberrar Sats' libero y todo termina bien
6. PERFECTO

## bugs conocidos pendientes:

Echo en chat — mensajes propios aparecen con "Contraparte:"          ARREGLADO!!!
Card desaparece al recargar (flujo noxtr↔noxtr, NOXTR1 step 4)
"Tomada por ti" incorrecto en NOXTR0 hasta recargar