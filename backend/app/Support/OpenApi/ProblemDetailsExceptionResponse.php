<?php

namespace App\Support\OpenApi;

use Dedoc\Scramble\Extensions\ExceptionToResponseExtension;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types as OpenApiTypes;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Documents thrown exceptions as the problem details this API actually returns.
 *
 * ============================================================
 * WHY THIS EXISTS
 * ============================================================
 *
 * Scramble ships extensions that document a thrown AuthorizationException as
 * `application/json {"message": string}`, and the same for AuthenticationException,
 * ValidationException and the not-found family. That is Laravel's DEFAULT shape,
 * and it has never been this API's shape: bootstrap/app.php renders every one of
 * them as RFC 9457 problem details, which docs/40-api/api-conventions.md states as
 * the contract.
 *
 * So the committed contract described four statuses wrongly, and the generated
 * frontend client typed them wrongly with it -- a TypeScript consumer reading
 * `error.message` off a 403 would have found undefined, because the field it was
 * promised does not exist in the response.
 *
 * That went unnoticed because it agreed with a real bug: the 403 render callback
 * in bootstrap/app.php was typed to AuthorizationException and never fired, so 403
 * genuinely WAS `{"message": ...}` at runtime. Fixing the callback left the
 * document as the last place the old shape survived.
 *
 * ============================================================
 * WHY IT IS A GENERATOR EXTENSION AND NOT AN EDIT TO THE YAML
 * ============================================================
 *
 * docs/40-api/openapi.yaml is generated and `api:contract --check` is a CI gate,
 * so a hand-edit would be reverted by the next regeneration and would fail the
 * build in between. The contract is derived from the code by design -- see
 * ExportApiContractCommand -- and this is the code it has to be derived from.
 *
 * Scramble consults later-registered extensions first (see TypeTransformer), so
 * registering this in `config/scramble.php` overrides the built-ins without
 * removing them; anything not in the table below still falls through to Scramble.
 *
 * ============================================================
 * KEEPING IT TRUE
 * ============================================================
 *
 * The table below must say exactly what the matching render callback in
 * bootstrap/app.php returns. It is a second statement of the same fact, which is
 * the one thing that can drift here. If you change a status, `code` or `title`
 * there, change it here in the same commit -- the contract is not a comment, it is
 * what the frontend client is built from.
 */
class ProblemDetailsExceptionResponse extends ExceptionToResponseExtension
{
    /**
     * Exception class => the problem details bootstrap/app.php renders for it.
     *
     * @var array<class-string<\Throwable>, array{status: int, code: string, title: string, errors: bool}>
     */
    private const RENDERED_AS = [
        ValidationException::class => [
            'status' => 422,
            'code' => 'validation_failed',
            'title' => 'The request is invalid',
            'errors' => true,
        ],
        AuthenticationException::class => [
            'status' => 401,
            'code' => 'unauthenticated',
            'title' => 'Sign in to continue',
            'errors' => false,
        ],
        AuthorizationException::class => [
            'status' => 403,
            'code' => 'forbidden',
            'title' => 'You do not have permission to do that',
            'errors' => false,
        ],
        AccessDeniedHttpException::class => [
            'status' => 403,
            'code' => 'forbidden',
            'title' => 'You do not have permission to do that',
            'errors' => false,
        ],
        // A resource in another tenant is a 404, never a 403. The document has to
        // say so as plainly as the code does, or a client author reading only the
        // contract will build a "you do not have access" screen for a status that
        // deliberately refuses to confirm the resource exists at all.
        ModelNotFoundException::class => [
            'status' => 404,
            'code' => 'not_found',
            'title' => 'Not found',
            'errors' => false,
        ],
        NotFoundHttpException::class => [
            'status' => 404,
            'code' => 'not_found',
            'title' => 'Not found',
            'errors' => false,
        ],
    ];

    public function shouldHandle(Type $type): bool
    {
        return $type instanceof ObjectType && $this->problemFor($type) !== null;
    }

    public function toResponse(Type $type): ?Response
    {
        if (! $type instanceof ObjectType) {
            return null;
        }

        $problem = $this->problemFor($type);

        if ($problem === null) {
            return null;
        }

        $body = (new OpenApiTypes\ObjectType)
            ->addProperty(
                'type',
                (new OpenApiTypes\StringType)
                    ->const('https://docs.carevelo.app/errors/'.$problem['code'])
                    ->setDescription('Stable documentation URI for this error.')
            )
            ->addProperty(
                'title',
                (new OpenApiTypes\StringType)
                    ->const($problem['title'])
                    ->setDescription('Written for a human and safe to show. May be reworded; do not key on it.')
            )
            ->addProperty(
                'status',
                (new OpenApiTypes\IntegerType)
                    ->const($problem['status'])
                    ->setDescription('Repeats the HTTP status.')
            )
            ->addProperty(
                'code',
                (new OpenApiTypes\StringType)
                    ->const($problem['code'])
                    ->setDescription('Stable and machine-readable. Key on this.')
            );

        $required = ['type', 'title', 'status', 'code'];

        if ($problem['errors']) {
            $body->addProperty(
                'errors',
                (new OpenApiTypes\ObjectType)
                    ->additionalProperties(
                        (new OpenApiTypes\ArrayType)->setItems(new OpenApiTypes\StringType)
                    )
                    ->setDescription('Per-field messages, keyed by field name.')
            );

            $required[] = 'errors';
        }

        return Response::make($problem['status'])
            ->setDescription($problem['title'])
            ->setContent(
                'application/problem+json',
                Schema::fromType($body->setRequired($required)),
            );
    }

    public function reference(ObjectType $type): Reference
    {
        // The same component name the built-in extensions use, so overriding the
        // shape does not also rewrite every `$ref` in the document.
        return new Reference('responses', Str::start($type->name, '\\'), $this->components);
    }

    /**
     * @return array{status: int, code: string, title: string, errors: bool}|null
     */
    private function problemFor(ObjectType $type): ?array
    {
        foreach (self::RENDERED_AS as $exception => $problem) {
            if ($type->isInstanceOf($exception)) {
                return $problem;
            }
        }

        return null;
    }
}
