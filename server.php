<?php

$serverAction = $_ARGS['action'] ?? 'test';

if (!$serverAction) {
    return;
}

if ($serverAction === 'test') {
    require SCRIPT_DIR_MODULE . '/server_test.php';
    return;
} else if ($serverAction === 'monitor') {
    require SCRIPT_DIR_MODULE . '/server_monitor.php';
    return;
}

fwrite(STDERR, "Unknown noxtr server action: {$serverAction}\n");
exit(1);
