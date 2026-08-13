<?php

namespace App\Http\Requests\V1\Appointments;

use App\Models\ConsultationMode;
use App\Models\Service;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Books a consultation: patient, clinician, service, slot, mode, fee expectation.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md sections 1-3
 */
class StoreAppointmentRequest extends BookingRequest
{
    /** How the patient is expected to pay. There is no third option. */
    public const PAYMENT_EXPECTATIONS = ['prepaid', 'pay_at_clinic'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The exists rules run through the same connection as everything
            // else, so row-level security has already scoped them to this
            // tenant: an id belonging to another clinic simply does not exist
            // as far as this request is concerned. That is deliberate -- a
            // "belongs to another tenant" error would confirm the record
            // exists somewhere, which is exactly what we do not disclose.
            'patient_id' => ['required', 'string', 'ulid', 'exists:patients,id'],
            'clinician_id' => ['required', 'string', 'ulid', 'exists:clinicians,id'],
            'service_id' => ['required', 'string', 'ulid', 'exists:services,id'],

            'scheduled_start_at' => ['required', 'date', 'after:now'],
            // Optional: when absent the slot length comes from the service, which
            // is where the clinic already maintains it.
            'scheduled_end_at' => ['nullable', 'date', 'after:scheduled_start_at'],

            // Voice and chat are FIRST-CLASS modes, not degraded fallbacks. A
            // patient on a poor connection must be able to choose voice
            // deliberately rather than fight a failing video call.
            'mode_booked' => ['required', Rule::enum(ConsultationMode::class)],

            'payment_expectation' => ['required', Rule::in(self::PAYMENT_EXPECTATIONS)],
        ];
    }

    /**
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $this->rejectUnknownFields($validator);
            },
            function (Validator $validator): void {
                $this->assertServiceOffersMode($validator);
            },
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'scheduled_start_at.after' => 'Choose a time in the future.',
        ];
    }

    public function startsAt(): Carbon
    {
        return Date::parse($this->string('scheduled_start_at')->toString());
    }

    /**
     * The end of the slot, defaulting to the service's own duration.
     */
    public function endsAt(Service $service): Carbon
    {
        $explicit = $this->string('scheduled_end_at')->toString();

        if ($explicit !== '') {
            return Date::parse($explicit);
        }

        return $this->startsAt()->addMinutes((int) $service->duration_minutes);
    }

    public function isPrepaid(): bool
    {
        return $this->string('payment_expectation')->toString() === 'prepaid';
    }

    /**
     * A service the clinic does not offer by video cannot be booked by video.
     *
     * The clinic decides which of its services are safe to deliver remotely and
     * in which mode; that judgement is clinical and belongs to them, so we
     * enforce their configuration rather than second-guess it.
     */
    protected function assertServiceOffersMode(Validator $validator): void
    {
        if ($validator->errors()->isNotEmpty()) {
            return;
        }

        $service = Service::query()->find($this->string('service_id')->toString());

        if ($service === null) {
            return;
        }

        /** @var list<string>|null $modes */
        $modes = $service->modes;

        if ($modes === null || $modes === []) {
            return;
        }

        if (! in_array($this->string('mode_booked')->toString(), $modes, true)) {
            $validator->errors()->add(
                'mode_booked',
                'This clinic does not offer that service in that mode.',
            );
        }
    }
}
