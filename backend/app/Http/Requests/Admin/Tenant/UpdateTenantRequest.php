<?php

namespace App\Http\Requests\Admin\Tenant;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Patients\Concerns\NormalisesPhoneNumbers;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The clinic editing its own record during and after onboarding.
 *
 * Two things happen here and both are security boundaries.
 *
 * COLOURS ARE VALIDATED AGAINST A STRICT HEX PATTERN BEFORE STORAGE. Branding
 * is applied as design tokens injected into CSS custom properties, so a stored
 * value reaches a stylesheet; validating on render rather than on entry would
 * leave one careless template between a tenant-supplied string and script
 * execution on a page displaying another patient's dosage instructions. The
 * pattern below admits `#RRGGBB` and nothing else -- not a colour keyword, not
 * a three-digit shorthand, not a `rgb()` function, and certainly not a
 * declaration with a semicolon in it.
 *
 * THE SUBDOMAIN IS IMMUTABLE. It is declared `prohibited` rather than merely
 * omitted so the administrator gets a sentence explaining why instead of a
 * silent discard.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md section 2
 */
class UpdateTenantRequest extends FormRequest
{
    use NormalisesPhoneNumbers;
    use RejectsUnknownFields;

    /**
     * `#RRGGBB`, anchored at both ends, with a hard end anchor.
     *
     * Anchoring is the whole rule: an unanchored pattern matches the valid
     * prefix of `#ff0000; background:url(https://evil/x)` and waves the rest
     * through. The `D` modifier matters for the same reason at the other end --
     * without it PCRE lets `$` match before a trailing newline, so
     * `"#ff0000\n…"` would pass and carry whatever follows the newline into a
     * stylesheet.
     */
    public const HEX_COLOUR = '/^#[0-9a-fA-F]{6}$/D';

    /** Authorisation is the controller's job; shaping input is this class's. */
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalisePhoneFields(['contact_phone']);
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'legal_name' => ['sometimes', 'string', 'max:200'],
            'trading_name' => ['sometimes', 'nullable', 'string', 'max:120'],

            'primary_colour' => ['sometimes', 'nullable', 'string', 'regex:'.self::HEX_COLOUR],
            'secondary_colour' => ['sometimes', 'nullable', 'string', 'regex:'.self::HEX_COLOUR],

            'contact_phone' => ['sometimes', 'nullable', 'string', new UgandanPhone],
            'contact_email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'physical_address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:100'],

            // The clinic's OWN attestation. Carevelo has no access to the UMDPC
            // or NDA registers, performs no lookup against them, and the
            // resource says so in the response.
            'umdpc_facility_reference' => ['sometimes', 'nullable', 'string', 'max:64'],
            'nda_licence_reference' => ['sometimes', 'nullable', 'string', 'max:64'],

            // Not writable here, each for its own reason -- see messages().
            'subdomain' => ['prohibited'],
            'slug' => ['prohibited'],
            'custom_domain' => ['prohibited'],
            'status' => ['prohibited'],
            'logo_path' => ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'primary_colour.regex' => 'Enter a colour as six hexadecimal digits, for example #1B7F5A.',
            'secondary_colour.regex' => 'Enter a colour as six hexadecimal digits, for example #1B7F5A.',
            'subdomain.prohibited' => 'The subdomain is fixed when the clinic is provisioned and cannot be changed. '
                .'It appears in patient-facing links, in the aggregator\'s webhook configuration and on printed '
                .'materials. A clinic that rebrands is given a custom domain instead.',
            'slug.prohibited' => 'The slug is derived from the subdomain and is fixed with it.',
            'custom_domain.prohibited' => 'Custom domains are not yet available. Every clinic is reachable at its '
                .'own subdomain.',
            'status.prohibited' => 'A clinic\'s status follows from onboarding and from support actions. It is never '
                .'set by assigning a field.',
            'logo_path.prohibited' => 'Upload the logo itself; the stored path is not writable directly.',
        ];
    }
}
