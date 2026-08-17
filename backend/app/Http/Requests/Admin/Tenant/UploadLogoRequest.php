<?php

namespace App\Http\Requests\Admin\Tenant;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The clinic's logo, which appears on the patient portal, the prescription PDF
 * and every receipt.
 *
 * These rules are the FIRST of two checks. They reject the obvious -- wrong
 * type, too large, too small, absurd dimensions -- on the strength of the
 * declared MIME type and the image headers. The declared type is a claim by
 * the uploader, so the controller then decodes and re-encodes the bytes
 * server-side; a file that survives both is an image and carries no metadata.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
class UploadLogoRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Kilobytes. A clinic logo that needs more than this is a photograph. */
    public const MAX_KILOBYTES = 512;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'logo' => [
                'required',
                'file',
                'image',
                // WebP is included because it is what a phone camera app and
                // most design tools now export by default in this market.
                'mimes:png,jpg,jpeg,webp',
                'max:'.self::MAX_KILOBYTES,
                // A logo smaller than the favicon renders as mush on the
                // prescription PDF; one larger than this is a print asset that
                // nothing in the product can use.
                'dimensions:min_width=64,min_height=64,max_width=2000,max_height=2000',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'logo.max' => 'The logo must be '.self::MAX_KILOBYTES.' KB or smaller.',
            'logo.mimes' => 'Upload the logo as a PNG, JPEG or WebP image.',
            'logo.dimensions' => 'The logo must be between 64 and 2000 pixels on each side.',
        ];
    }
}
