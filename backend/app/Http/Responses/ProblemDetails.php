<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;

/**
 * RFC 9457 problem details.
 *
 * `title` and `detail` are written for humans and shown to users -- a clinic
 * administrator reading a raw validation payload is a support call. `code` is
 * stable and machine-readable; `title` may be reworded freely.
 *
 * Error responses never contain clinical content, personal identifiers beyond
 * what the caller supplied, or internal detail: no stack traces, no SQL, no
 * class names.
 *
 * @see docs/40-api/api-conventions.md
 */
class ProblemDetails
{
    /**
     * @param  array<string, list<string>>  $errors
     */
    public static function make(
        int $status,
        string $code,
        string $title,
        ?string $detail = null,
        array $errors = [],
    ): JsonResponse {
        $body = [
            'type' => 'https://docs.carevelo.app/errors/'.$code,
            'title' => $title,
            'status' => $status,
            'code' => $code,
        ];

        if ($detail !== null) {
            $body['detail'] = $detail;
        }

        if ($errors !== []) {
            $body['errors'] = $errors;
        }

        return new JsonResponse($body, $status, [
            'Content-Type' => 'application/problem+json',
        ]);
    }
}
