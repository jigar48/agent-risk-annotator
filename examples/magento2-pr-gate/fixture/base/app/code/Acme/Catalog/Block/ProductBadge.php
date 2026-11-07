<?php
declare(strict_types=1);

namespace Acme\Catalog\Block;

class ProductBadge
{
    public function label(bool $isNew): string
    {
        return $isNew ? 'New' : '';
    }
}
