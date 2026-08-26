<?php

namespace App\Services\Platform;

use App\Models\Appointment;
use App\Models\AuditEvent;
use App\Models\ClinicalNote;
use App\Models\ConsentRecord;
use App\Models\Consultation;
use App\Models\ConsultationMessage;
use App\Models\Delivery;
use App\Models\DeliveryEvent;
use App\Models\DispenseItem;
use App\Models\DispenseOrder;
use App\Models\Patient;
use App\Models\PaymentIntent;
use App\Models\Prescription;
use App\Models\PrescriptionItem;
use App\Models\Substitution;
use App\Models\Tenant;
use App\Tenancy\Tenancy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Date;

/**
 * The offboarding export.
 *
 * A CONTROLLER OBLIGATION we enable, not a courtesy. The clinic controls its
 * patients' data and must leave with it — complete, machine-readable, and
 * provided regardless of any commercial dispute. Withholding it to secure
 * payment would be unlawful and would harm patients, which is stated here
 * because the temptation is foreseeable.
 *
 * Nothing in this class inspects the tenant's status. That absence is the
 * feature.
 *
 * @see docs/50-security-compliance/data-retention-and-deletion.md offboarding
 */
class TenantExport
{
    /**
     * Everything that leaves with the clinic, in dependency order.
     *
     * The list is explicit rather than "every model with a tenant_id": a table
     * added later must be a deliberate decision to include or exclude, and a
     * silent omission from an export is the kind of gap nobody notices until a
     * clinic has already left.
     *
     * @var array<string, class-string<Model>>
     */
    public const CONTENTS = [
        'patients' => Patient::class,
        'consent_records' => ConsentRecord::class,
        'appointments' => Appointment::class,
        'consultations' => Consultation::class,

        /*
         * Chat inside an encounter, between consultations and clinical_notes
         * because that is what it is: text authored within the consultation,
         * ranking with the notes rather than with anything operational.
         *
         * Its inclusion is the reason this list is explicit. A clinic leaving
         * without its transcripts would leave without clinical instructions its
         * clinicians gave and history its patients gave -- and it would not
         * notice, because a chat table reads as messaging infrastructure and
         * messaging infrastructure is exactly the sort of thing an export
         * reasonably omits. That is the silent gap the docblock above warns
         * about, arriving on schedule.
         */
        'consultation_messages' => ConsultationMessage::class,

        'clinical_notes' => ClinicalNote::class,
        'prescriptions' => Prescription::class,
        'prescription_items' => PrescriptionItem::class,
        'dispense_orders' => DispenseOrder::class,
        'dispense_items' => DispenseItem::class,
        'substitutions' => Substitution::class,
        'deliveries' => Delivery::class,
        'delivery_events' => DeliveryEvent::class,
        'payment_intents' => PaymentIntent::class,
        'audit_events' => AuditEvent::class,
    ];

    public function __construct(protected Tenancy $tenancy) {}

    /**
     * Build the export.
     *
     * Row-level security is unbound on the platform routes — no host resolves a
     * tenant there — so every query below would return nothing outside
     * Tenancy::run(). Entering the tenant's context explicitly is what makes
     * this reachable at all, and it is also what guarantees the export contains
     * exactly one clinic's rows.
     *
     * @return array<string, mixed>
     */
    public function for(Tenant $tenant): array
    {
        $sections = $this->tenancy->run($tenant->id, function (): array {
            $sections = [];

            foreach (self::CONTENTS as $name => $model) {
                $sections[$name] = $this->rows($model);
            }

            return $sections;
        });

        return [
            'format' => 'carevelo.tenant-export.v1',
            'exported_at' => Date::now()->toIso8601String(),
            'tenant' => $tenant->only([
                'id', 'slug', 'subdomain', 'legal_name', 'trading_name',
                'contact_phone', 'contact_email', 'physical_address', 'district',
                'umdpc_facility_reference', 'nda_licence_reference',
                'timezone', 'currency', 'status',
            ]),

            /*
             * Named so the clinic knows what it did NOT receive, rather than
             * discovering the gap later.
             *
             * Aggregator credentials are unreadable by every role including this
             * one: they are envelope-encrypted and decrypted only in memory at
             * the moment of an outbound call. The clinic holds them already —
             * they are the clinic's own credentials at the clinic's own
             * aggregator.
             */
            'excluded' => [
                'aggregator_credentials' => 'Write-only and envelope-encrypted; '
                    .'held by the clinic at its own aggregator, never readable here.',
            ],

            'records' => $sections,
            'counts' => array_map(count(...), $sections),
        ];
    }

    /**
     * Raw stored rows for one model, cast but not reshaped.
     *
     * An export is not an API response: it is the clinic's own data, so it is
     * the columns as stored rather than a resource's chosen subset. A resource
     * class exists to withhold, and withholding is exactly wrong here.
     *
     * @param  class-string<Model>  $model
     * @return array<int, array<string, mixed>>
     */
    protected function rows(string $model): array
    {
        return $model::query()
            ->orderBy('id')
            ->get()
            ->map(static fn (Model $row): array => $row->attributesToArray())
            ->values()
            ->all();
    }
}
