<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\Tenant;
use App\Rules\UgandanPhone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Provisioning a clinic.
 *
 * Note what is absent: `status`. A tenant is created in `provisioning` and
 * moves on only through TenantStatus, so a client cannot post an already-active
 * clinic into existence.
 *
 * Note also what the subdomain is checked against. It appears in patient-facing
 * URLs, in the aggregator's webhook configuration and on printed materials, and
 * it is immutable afterwards — so a clinic that claims `api` or `admin` does not
 * merely have an awkward name, it shadows a platform host.
 *
 * @see docs/20-domain/identifiers-and-numbering.md
 */
class StoreTenantRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** TenantPolicy holds the default-deny answer; the controller consults it. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Case is not the clinic's to choose.
     *
     * Hosts are compared lowercased when a request arrives, so storing `API`
     * would produce a subdomain that passes a reserved-word check written in
     * lowercase and then resolves as the reserved host anyway.
     */
    protected function prepareForValidation(): void
    {
        $subdomain = $this->input('subdomain');

        if (is_string($subdomain)) {
            $this->merge(['subdomain' => strtolower(trim($subdomain))]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'legal_name' => ['required', 'string', 'max:255'],
            'trading_name' => ['nullable', 'string', 'max:255'],

            'subdomain' => [
                'required',
                'string',
                'max:63',
                // A DNS label: lowercase alphanumerics and inner hyphens.
                'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/',
                Rule::notIn(Tenant::RESERVED_SLUGS),
                Rule::unique('tenants', 'subdomain'),
                Rule::unique('tenants', 'slug'),
            ],

            'contact_phone' => ['nullable', 'string', new UgandanPhone],
            'contact_email' => ['nullable', 'email:rfc', 'max:255'],
            'physical_address' => ['nullable', 'string', 'max:255'],
            'district' => ['nullable', 'string', 'max:100'],

            // The clinic's OWN attestation. Carevelo has no access to the UMDPC
            // or NDA registers and never presents these as verified.
            'umdpc_facility_reference' => ['nullable', 'string', 'max:100'],
            'nda_licence_reference' => ['nullable', 'string', 'max:100'],

            'trial_ends_at' => ['nullable', 'date', 'after:now'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'subdomain.not_in' => 'That subdomain is reserved for the platform and cannot be assigned to a clinic.',
            'subdomain.regex' => 'A subdomain may contain lowercase letters, digits and inner hyphens only.',
        ];
    }
}
