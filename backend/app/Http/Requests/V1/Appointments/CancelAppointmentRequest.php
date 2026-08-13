<?php

namespace App\Http\Requests\V1\Appointments;

/**
 * Cancels an appointment and releases the slot.
 *
 * A reason is REQUIRED. Cancellation is the transition a clinic asks about
 * most often after the fact -- "why did this patient not come?" -- and an
 * unexplained one is unanswerable. It is also what separates a cancellation
 * from an expiry: expiry is the system releasing an unpaid slot, cancellation
 * is a human decision, and the clinic owner reads those differently.
 *
 * @see docs/20-domain/state-machines.md
 */
class CancelAppointmentRequest extends BookingRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'Say why this appointment is being cancelled.',
        ];
    }

    public function reason(): string
    {
        return $this->string('reason')->trim()->toString();
    }
}
