<?php

namespace App\Http\Requests\V1\Deliveries;

use App\Support\PhoneNumber;
use Closure;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Dispatching a dispensed order.
 *
 * The body carries only what a courier needs to find a door: a name, a number,
 * an address. There is deliberately no field here for a medicine, an item list
 * or a note -- a delivery holds no clinical data, so there is nothing for a
 * careless client to send.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */
class StoreDeliveryRequest extends FormRequest
{
    /** Authorisation is the controller's policy call; shaping input is this class's job. */
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
            'dispense_order_id' => ['required', 'string', 'ulid'],
            'recipient_name' => ['required', 'string', 'max:120'],
            'recipient_phone' => ['required', 'string', $this->ugandanPhone()],

            // A Ugandan delivery address is a sentence and a landmark, not a
            // street number. "Opposite Shell Bugolobi" is how riders actually
            // navigate, so the landmark is a first-class field rather than an
            // afterthought appended to the address line.
            'address_text' => ['required', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:60'],
            'landmark' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    public function dispenseOrderId(): string
    {
        return (string) $this->validated('dispense_order_id');
    }

    /**
     * The recipient block, normalised, in the shape Delivery::createFor expects.
     *
     * @return array{recipient_name: string, recipient_phone: string, address_text: string, district: ?string, landmark: ?string}
     */
    public function recipient(): array
    {
        $district = $this->validated('district');
        $landmark = $this->validated('landmark');

        return [
            'recipient_name' => (string) $this->validated('recipient_name'),
            // Normalised to E.164 at the boundary. A rider dialling a number
            // written six different ways is a failed delivery.
            'recipient_phone' => (string) PhoneNumber::parse((string) $this->validated('recipient_phone')),
            'address_text' => (string) $this->validated('address_text'),
            'district' => is_string($district) && $district !== '' ? $district : null,
            'landmark' => is_string($landmark) && $landmark !== '' ? $landmark : null,
        ];
    }

    /**
     * Reject anything the SMS gateway would later reject, while the dispatcher
     * is still looking at the screen.
     */
    private function ugandanPhone(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value) || PhoneNumber::tryParse($value) === null) {
                $fail('Enter a valid Ugandan phone number, for example 0772 123 456.');
            }
        };
    }
}
