<?php
declare(strict_types=1);

namespace Acme\FreightShipping\Model\Carrier;

class Freight
{
    private const FREE_SHIPPING_THRESHOLD = 15.0;

    public function rate(float $subtotal, float $weightKg): float
    {
        if ($subtotal >= self::FREE_SHIPPING_THRESHOLD) {
            return 0.0;
        }

        return 5.0 + $weightKg * 1.25;
    }
}
