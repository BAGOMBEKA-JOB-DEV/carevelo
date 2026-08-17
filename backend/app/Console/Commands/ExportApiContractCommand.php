<?php

namespace App\Console\Commands;

use App\Console\Contracts\RunsOnDemand;
use Illuminate\Console\Command;
use Symfony\Component\Yaml\Yaml;

/**
 * Writes docs/40-api/openapi.yaml — the contract the frontend client is built from.
 *
 * The document is DERIVED FROM THE CODE, via Scramble reading routes, form requests
 * and resources, rather than hand-maintained. 79 paths and 93 operations cannot be
 * kept true by hand; the previous hand-written file had drifted to 3 paths against
 * 93 live routes, which is what blocked the frontend from having a generated client
 * at all.
 *
 * The human-facing contract remains docs/40-api/endpoint-catalogue.md. This file is
 * its machine-readable projection.
 *
 * YAML rather than Scramble's JSON because the path is referenced as .yaml across
 * the docs and in the workflow's path filters, and because a contract humans read in
 * review diffs better as YAML. symfony/yaml is already in the tree.
 *
 * `--check` is the CI gate: it regenerates and compares without writing, so a route
 * added without regenerating the contract fails the build. Without that gate a
 * generated-and-committed artefact is just a stale artefact.
 *
 * Requires a database with all migrations applied — Scramble reads column types for
 * model attributes, and silently produces a thinner schema without them.
 */
class ExportApiContractCommand extends Command implements RunsOnDemand
{
    /** @var string */
    protected $signature = 'api:contract {--check : Compare against the committed file instead of writing it}';

    /** @var string */
    protected $description = 'Export the OpenAPI contract to docs/40-api/openapi.yaml';

    public function whyNotScheduled(): string
    {
        return 'Developer and CI tooling. It runs when the API changes, not on a clock; '
            .'the --check mode is what runs in CI, as a gate rather than a sweep.';
    }

    public function handle(): int
    {
        $target = base_path('../docs/40-api/openapi.yaml');
        $scratch = storage_path('app/openapi.export.json');

        $exported = $this->call('scramble:export', ['--path' => $scratch, '--silent' => true]);

        if ($exported !== self::SUCCESS) {
            $this->components->error('Scramble could not export the document.');

            return self::FAILURE;
        }

        $json = file_get_contents($scratch);

        if ($json === false) {
            $this->components->error('Could not read the exported document.');

            return self::FAILURE;
        }

        @unlink($scratch);

        /** @var array<string, mixed> $document */
        $document = json_decode($json, true, 512, JSON_THROW_ON_ERROR);

        // Inline depth high enough that schemas stay block-formatted rather than
        // collapsing into one unreadable line, which would make review pointless.
        $yaml = Yaml::dump($document, 12, 2, Yaml::DUMP_OBJECT_AS_MAP);

        $paths = is_array($document['paths'] ?? null) ? count($document['paths']) : 0;

        if ($this->option('check')) {
            $committed = is_file($target) ? file_get_contents($target) : '';

            if ($committed === $yaml) {
                $this->components->info(sprintf('API contract is in sync (%d paths).', $paths));

                return self::SUCCESS;
            }

            $this->components->error(
                'docs/40-api/openapi.yaml is out of date. The API changed without the '
                .'contract being regenerated: run `php artisan api:contract` and commit the result.'
            );

            return self::FAILURE;
        }

        file_put_contents($target, $yaml);

        $this->components->info(sprintf('Wrote docs/40-api/openapi.yaml (%d paths).', $paths));

        return self::SUCCESS;
    }
}
