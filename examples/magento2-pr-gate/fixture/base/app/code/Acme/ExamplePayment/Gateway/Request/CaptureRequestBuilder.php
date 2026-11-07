<?php
declare(strict_types=1);

namespace Acme\ExamplePayment\Gateway\Request;

class CaptureRequestBuilder
{
    public function build(string $orderId, float $amount): array
    {
        return [
            'order_id' => $orderId,
            'amount' => round($amount, 2),
            'idempotency_key' => 'capture-' . $orderId,
        ];
    }
}
