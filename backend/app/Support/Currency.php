<?php

namespace App\Support;

/**
 * Currencies the platform handles.
 *
 * Uganda only. Multi-country expansion is explicitly not planned — the
 * regulatory model is baked deep into this system, deliberately.
 *
 * @see docs/10-product/non-goals.md
 */
enum Currency: string
{
    case UGX = 'UGX';

    /**
     * Whether the subunit is used in everyday practice.
     *
     * UGX technically has cents; nobody uses them. Minor units are still
     * STORED so the type never has to change, but they are not displayed.
     */
    public function hasSubunitInPractice(): bool
    {
        return match ($this) {
            self::UGX => false,
        };
    }
}
