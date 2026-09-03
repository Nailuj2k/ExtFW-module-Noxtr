<?php


$data = [
            [ 'name' => 'Mostro 🤖',    'hex'  => '82fa8cb978b43c79b2156585bac2c011176a21d2aead6d9f7c575c005be88390', 'active' => true, 'verified' => true ],
            [ 'name' => 'NostroMostro 🇪🇸',     'npub' => 'npub1qqqvcqssrmpfa65uuc3jtp6jh8ta5ekz0pz76f5ydhgtplrnddqqrqe7xr', 'active' => true, 'verified' => true ],
            [ 'name' => 'Kmbalache 🇨🇺',        'hex'  => '00000235a3e904cfe1213a8a54d6f1ec1bef7cc6bfaabd6193e82931ccf1366a', 'active' => true, 'verified' => true ],
            [ 'name' => 'MostroVzla 🇻🇪',  'npub' => 'npub1qqqqnms7fvwu0tw3n2esunhc2ntm2chzpzmzdphajqpt2zeym2asr7ata2', 'active' => true, 'verified' => true ],
            [ 'name' => 'MostroEuropa 🇪🇺', 'npub' => 'npub1mg36x8t42usn32upfxg35ppzfqf2xj76v7w2hf7trqj0ma79jtkqrj3q9m', 'active' => true, 'verified' => false ],
            [ 'name' => 'MostroColomBia 🇨🇴',   'npub' => 'npub1qqqqj79vck2v2p5hd3j4km0vhuk54ujllk4xdq8j49tgkz5ggsdsvgn7vr', 'active' => true, 'verified' => true ],
            [ 'name' => 'Mostro ₿oliviano 🇧🇴',  'npub' => 'npub1qqq8evest7uh9awvs0ur4rau58nyay7f6ymf3q9fl43wl9wj87gsrk6xv3', 'active' => true, 'verified' => true ],
            [ 'name' => 'Sovereign Mostro VgWs 🇲🇽', 'hex'  => 'ef7d11a2c9b1d916a02b330db952d2eb4e5a3cd2b1f9e795a42bce2e4725aa04', 'active' => true, 'verified' => false ],
            [ 'name' => 'Brasil 🇧🇷', 'hex'  => '00037abd44e7a846689e230d5446abcd0d56a344fa81fff85c09d1929feda486', 'active' => true, 'verified' => true ],
            [ 'name' => 'MostrAR 🇦🇷', 'hex'  => 'b3626fe91b602bdbca3673bec0855221f41dc8f6d0e4027e51eaa525d68d87f2', 'active' => true, 'verified' => true ],
            [ 'name' => 'Italia 🇮🇹', 'hex'  => 'acf3c926f37102b03a5ff8a83fa4480af59452e47d84e15513e5adfa6c2aac83', 'active' => true, 'verified' => false ],
            [ 'name' => 'CharroNegro 🇲🇽', 'hex'  => '000018b160c81819d864aa994003b29cdacd6027def22bb5c5002c6a68a3df4b', 'active' => true, 'verified' => false ],
            [ 'name' => 'Mostro Mexico 🇲🇽', 'hex'  => '00003f6be51b51a1a0cf9c94232ab1bba1f5c1bfd5a0e8687e9647558536b791', 'active' => true, 'verified' => false ],
            [ 'name' => 'TestingMostro 🇲🇽', 'hex'  => '00000018c1ae3147f9010b5d768ec2b121acf1a67f238be8e2bdd7c1f9eef705', 'active' => true, 'verified' => false ],
            [ 'name' => 'SamuraiX 🇯🇵', 'hex'  => '560795c6b0d0549a6a61797c0c59726f7159163cf68c4ff20e3a7e086ac0cf35', 'active' => true, 'verified' => false ],
        ];

echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
