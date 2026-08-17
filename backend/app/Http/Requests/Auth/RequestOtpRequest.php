<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Auth\Concerns\ResolvesPhoneNumber;
use Illuminate\Foundation\Http\FormRequest;

/**
 * "Send a code to this number."
 *
 * Public by necessity, and it takes nothing but the number. In particular it
 * takes no tenant: the clinic comes from the request host, because a
 * client-supplied tenant would be a client-controlled authorisation decision.
 */
class RequestOtpRequest extends FormRequest
{
    use ResolvesPhoneNumber;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return $this->phoneRules();
    }
}
