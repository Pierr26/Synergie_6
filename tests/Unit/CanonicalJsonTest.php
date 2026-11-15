<?php

namespace Tests\Unit;

use App\Support\CanonicalJson;
use PHPUnit\Framework\TestCase;

class CanonicalJsonTest extends TestCase
{
    public function test_key_order_does_not_change_the_fingerprint(): void
    {
        $first = ['b' => 1, 'a' => ['y' => 'é', 'x' => [3, 1, 2]]];
        $second = ['a' => ['x' => [3, 1, 2], 'y' => 'é'], 'b' => 1];

        $this->assertSame(CanonicalJson::sha256($first), CanonicalJson::sha256($second));
        $this->assertSame('{"a":{"x":[3,1,2],"y":"é"},"b":1}', CanonicalJson::encode($second));
    }

    public function test_list_order_and_values_change_the_fingerprint(): void
    {
        $this->assertNotSame(CanonicalJson::sha256(['x' => [1, 2]]), CanonicalJson::sha256(['x' => [2, 1]]));
        $this->assertNotSame(CanonicalJson::sha256(['x' => 1]), CanonicalJson::sha256(['x' => 1.0]));
    }
}
