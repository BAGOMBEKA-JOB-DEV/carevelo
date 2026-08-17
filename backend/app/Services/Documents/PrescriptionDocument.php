<?php

namespace App\Services\Documents;

use App\Models\Prescription;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Model;

/**
 * Everything that appears on a prescription document, and nothing else.
 *
 * The clinician's identity comes from the SNAPSHOT on the record, never from
 * the clinician's current row: the document must keep saying what it said on
 * the day it was issued, after they have left the clinic or corrected their
 * registration number.
 *
 * The issuer is the clinician, under the clinic's branding. Carevelo is a
 * software supplier and appears nowhere on it -- the prescription is a clinical
 * act by a licensed clinician of the clinic, and a supplier's name on the
 * document would misstate who is answerable for it.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md section 6
 */
final readonly class PrescriptionDocument
{
    /**
     * @param  array<int, array{medicine: string, form: ?string, strength: ?string, quantity: int, unit: ?string, directions: string, is_controlled: bool}>  $items
     */
    public function __construct(
        public string $reference,
        public string $issuedAt,
        public string $clinicianName,
        public string $registrationBody,
        public string $registrationNumber,
        public string $clinicName,
        public ?string $clinicAddress,
        public ?string $clinicPhone,
        public ?string $clinicDistrict,
        public ?string $clinicFacilityReference,
        public array $items,
    ) {}

    public static function for(Prescription $prescription, Tenant $tenant): self
    {
        // Ordered by id, which is a ULID and therefore in creation order. The
        // ordering has to be stable or the same record would render different
        // bytes on different days and the hash would verify nothing.
        $items = $prescription->items()
            ->orderBy('id')
            ->get()
            ->map(fn ($item): array => [
                'medicine' => (string) $item->medicine_name,
                'form' => $item->form,
                'strength' => $item->strength,
                'quantity' => $item->quantity,
                'unit' => $item->unit,
                'directions' => (string) $item->directions,
                'is_controlled' => $item->is_controlled,
            ])
            ->all();

        return new self(
            reference: $prescription->id,
            issuedAt: $prescription->issued_at?->toIso8601String() ?? '',
            clinicianName: $prescription->clinician_name_snapshot,
            registrationBody: strtoupper($prescription->registration_body_snapshot),
            registrationNumber: $prescription->clinician_registration_snapshot,
            // The trading name is what patients see on the door; the legal name
            // is the fallback because a document with no clinic on it names
            // nobody as issuer.
            clinicName: self::text($tenant, 'trading_name') ?? $tenant->legal_name,
            clinicAddress: self::text($tenant, 'physical_address'),
            clinicPhone: self::text($tenant, 'contact_phone'),
            clinicDistrict: self::text($tenant, 'district'),
            clinicFacilityReference: self::text($tenant, 'umdpc_facility_reference'),
            items: $items,
        );
    }

    /**
     * Read an optional string column, treating empty as absent.
     *
     * Via getAttribute rather than a property so a column the model does not
     * document still reads as the string-or-nothing it is.
     */
    private static function text(Model $model, string $attribute): ?string
    {
        $value = $model->getAttribute($attribute);

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
