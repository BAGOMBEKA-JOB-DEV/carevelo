<?php

namespace App\Services\Documents;

/**
 * A dependency-free, byte-for-byte deterministic PDF writer.
 *
 * TODO: production renders through a headless browser (Chromium via
 * spatie/browsershot) behind this same interface, so the clinic's own colours,
 * logo and typography appear on the document. That renderer needs a browser
 * binary in the image and is therefore not something a test may depend on --
 * hence this one, which needs nothing and always produces identical bytes for
 * identical input. When the browser renderer lands it must stay deterministic:
 * no CreationDate, no ModDate, no /Producer, or document_hash stops meaning
 * anything.
 *
 * Deliberately absent: any /Info dictionary. That is where a producer or
 * creator name would go, and no supplier's name belongs on a prescription
 * issued by somebody else.
 */
final class MinimalPdfRenderer implements PrescriptionRenderer
{
    private const FONT_SIZE = 10;

    private const LEADING = 14;

    public function extension(): string
    {
        return 'pdf';
    }

    public function render(PrescriptionDocument $document): string
    {
        $content = $this->contentStream($this->lines($document));

        $objects = [
            '<</Type/Catalog/Pages 2 0 R>>',
            '<</Type/Pages/Kids[3 0 R]/Count 1>>',
            '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]'
                .'/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
            '<</Length '.strlen($content).'>>'."\n".'stream'."\n".$content."\n".'endstream',
            '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
        ];

        $pdf = '%PDF-1.4'."\n";

        // Byte offsets have to be measured, not guessed, so the cross-reference
        // table is built as the body is assembled.
        $offsets = [];

        foreach ($objects as $index => $body) {
            $offsets[] = strlen($pdf);
            $pdf .= ($index + 1).' 0 obj'."\n".$body."\n".'endobj'."\n";
        }

        $startXref = strlen($pdf);
        $size = count($objects) + 1;

        $pdf .= 'xref'."\n".'0 '.$size."\n";
        $pdf .= sprintf("%010d %05d f \n", 0, 65535);

        foreach ($offsets as $offset) {
            $pdf .= sprintf("%010d %05d n \n", $offset, 0);
        }

        $pdf .= 'trailer'."\n".'<</Size '.$size.'/Root 1 0 R>>'."\n";

        return $pdf.'startxref'."\n".$startXref."\n".'%%EOF'."\n";
    }

    /**
     * The document, as laid-out lines.
     *
     * The clinic heads it and the clinician signs it. Read top to bottom, the
     * page answers "who prescribed this, under whose licence, at which clinic"
     * without naming anyone else.
     *
     * @return list<string>
     */
    private function lines(PrescriptionDocument $document): array
    {
        $header = array_filter([
            strtoupper($document->clinicName),
            $document->clinicAddress,
            $document->clinicDistrict,
            $document->clinicPhone === null ? null : 'Tel '.$document->clinicPhone,
            $document->clinicFacilityReference === null
                ? null
                : 'UMDPC facility reference '.$document->clinicFacilityReference,
        ]);

        $lines = [...$header, '', 'PRESCRIPTION', 'Reference '.$document->reference];

        if ($document->issuedAt !== '') {
            $lines[] = 'Issued '.$document->issuedAt;
        }

        $lines[] = '';

        foreach ($document->items as $position => $item) {
            $lines[] = sprintf(
                '%d. %s%s',
                $position + 1,
                $item['medicine'],
                $item['strength'] === null ? '' : ' '.$item['strength'],
            );
            $lines[] = sprintf(
                '   %s%s',
                $item['form'] === null ? 'Quantity' : ucfirst($item['form']).', quantity',
                sprintf(' %d%s', $item['quantity'], $item['unit'] === null ? '' : ' '.$item['unit']),
            );
            $lines[] = '   '.$item['directions'];

            if ($item['is_controlled']) {
                // Flagged on the page because a controlled item must be handed
                // over in person; it never enters the delivery flow.
                $lines[] = '   CONTROLLED - collection in person only';
            }

            $lines[] = '';
        }

        return [
            ...$lines,
            'Prescribed by '.$document->clinicianName,
            $document->registrationBody.' registration '.$document->registrationNumber,
            'Issued by the above clinician of '.$document->clinicName.'.',
        ];
    }

    /**
     * @param  list<string>  $lines
     */
    private function contentStream(array $lines): string
    {
        $stream = 'BT'."\n"
            .'/F1 '.self::FONT_SIZE.' Tf'."\n"
            .self::LEADING.' TL'."\n"
            .'40 800 Td'."\n";

        foreach ($lines as $line) {
            $stream .= '('.$this->escape($line).') Tj T*'."\n";
        }

        return $stream.'ET';
    }

    /**
     * Escape a string for a PDF literal.
     *
     * Backslash first: escaping it after the parentheses would escape the
     * escapes. Control characters are dropped rather than encoded, because a
     * newline inside a literal would break the stream.
     */
    private function escape(string $text): string
    {
        $text = (string) preg_replace('/[\x00-\x1f\x7f]/', ' ', $text);

        return strtr($text, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)']);
    }
}
