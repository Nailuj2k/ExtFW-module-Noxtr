<?php

// test cli server functionality

$seconds = 20;

echo 'i am a test server script' . PHP_EOL;
echo 'running for ' . $seconds . ' seconds...' . PHP_EOL;

for ($i = 1; $i <= $seconds; $i++) {
    echo 'tick ' . $i . '/' . $seconds . PHP_EOL;
    sleep(1);
}

echo 'test finished' . PHP_EOL;
