<?php
declare(strict_types=1);

namespace Acme\OrderSync\Controller\Webhook;

class Receive
{
    public function isTrusted(string $payload, string $signature, string $secret): bool
    {
        $expected = hash_hmac('sha256', $payload, $secret);

        return hash_equals($expected, $signature);
    }
}
