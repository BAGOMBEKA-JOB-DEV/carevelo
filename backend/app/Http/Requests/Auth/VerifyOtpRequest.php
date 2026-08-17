<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Auth\Concerns\ResolvesPhoneNumber;
use App\Models\OtpCode;
use Illuminate\Foundation\Http\FormRequest;

class VerifyOtpRequest extends FormRequest
{
    use ResolvesPhoneNumber;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return $this->phoneRules() + [
            'code' => ['required', 'string', 'digits:'.OtpCode::LENGTH],
        ];
    }

    public function code(): string
    {
        return (string) $this->validated('code');
    }
}
