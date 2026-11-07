<?php
declare(strict_types=1);

namespace Acme\CheckoutDiscount\Model\Total;

class Discount
{
    public function calculate(float $subtotal, float $requested): float
    {
        $discount = max(0.0, $requested);

        return min($discount, $subtotal);
    }
}
