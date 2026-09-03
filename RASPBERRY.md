
# sudo apt upgrade
# sudo apt full-upgrade
# sudo apt update
# sudo apt install openssh-server unzip wget
# sudo /etc/init.d/ssh start
# sudo apt install php php-{cli,fpm,gd,zip,xml,bz2,curl,mbstring,intl,soap,bcmath}
# echo '<?php phpinfo();' /var/www/html/test.php
# sudo service php8.4-fpm start
# sudo apt install nginx
# sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/nginx-selfsigned.key -out /etc/ssl/certs/nginx-selfsigned.crt
Country Name (2 letter code) [AU]:<country_code>
State or Province Name (full name) [Some-State]:<provincia>
Locality Name (eg, city) []:<ciudad>
Organization Name (eg, company) [Internet Widgits Pty Ltd]:<lo_que_sea>
Organizational Unit Name (eg, section) []:<lo_que_sea>
Common Name (e.g. server FQDN or YOUR name) []:<localhost>
Email Address []: <tu@ema.il>
# sudo openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048
# sudo vi /etc/nginx/snippets/self-signed.conf
ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;
# sudo vi /etc/nginx/snippets/ssl-params.conf
ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
ssl_prefer_server_ciphers on;
ssl_ciphers "EECDH+AESGCM:EDH+AESGCM:AES256+EECDH:AES256+EDH";
ssl_ecdh_curve secp384r1;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
#add_header Strict-Transport-Security "max-age=63072000; includeSubdomains; preload";
add_header Strict-Transport-Security "max-age=63072000; includeSubdomains";
add_header X-Frame-Options SAMEORIGIN;
add_header X-Content-Type-Options nosniff;
ssl_dhparam /etc/ssl/certs/dhparam.pem;
# sudo vi /etc/nginx/sites-available/default
server {
        listen 443 ssl default_server;
        listen [::]:443 ssl default_server;
        include snippets/self-signed.conf;
        include snippets/ssl-params.conf;
        root /var/www/html;
        index index.php index.html index.htm index.nginx-debian.html;
        server_name _;
        location / {
                try_files $uri $uri/ @ci_index;
        }
        location @ci_index{
                rewrite ^(.*) /index.php?$1 last;
        }
        location ~ \.php$ {
                include snippets/fastcgi-php.conf;
                fastcgi_pass unix:/run/php/php8.4-fpm.sock;
                # With php-cgi (or other tcp sockets):
                # fastcgi_pass 127.0.0.1:9000;
        }
}
# sudo service php8.4-fpm stop
# sudo service php8.4-fpm start
# sudo nginx -t