<?php

namespace App\Services\Documents;

use Illuminate\Container\Attributes\Bind;

/**
 * Turns a prescription record into document bytes.
 *
 * The seam exists for one reason beyond swapping engines: a renderer that is
 * PURE AND DETERMINISTIC is what makes document_hash a verification of the
 * document against the record. Re-render the record, hash the bytes, compare.
 * A renderer that stamped the current time, a build number or a random
 * identifier into its output would reduce the hash to a checksum of whatever
 * the engine happened to paint that afternoon.
 *
 * Implementations must therefore derive every byte from the record, and never
 * from the clock or the environment.
 */
#[Bind(MinimalPdfRenderer::class)]
interface PrescriptionRenderer
{
    /**
     * Render the document. The same record must always produce the same bytes.
     */
    public function render(PrescriptionDocument $document): string;

    /** File extension, without the dot. */
    public function extension(): string;
}
