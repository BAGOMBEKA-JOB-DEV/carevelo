/**
 * Fails if the committed client no longer matches docs/40-api/openapi.yaml.
 *
 * The client is committed rather than generated at install time, so that this tree
 * builds knowing nothing about backend/. The cost of that choice is that the
 * committed artefact can go stale, and a stale generated artefact is worse than no
 * artefact — it type-checks, so nothing complains until runtime.
 *
 * This is the second of two gates. The backend's `api:contract --check` proves the
 * YAML matches the live routes; this proves the client matches the YAML. Together
 * they mean a route cannot change without the frontend's types changing in the same
 * commit.
 *
 * Regenerates to a temporary file and compares. Never writes to src/.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const here = import.meta.dirname
const spec = resolve(here, '../../../../docs/40-api/openapi.yaml')
const committed = resolve(here, '../src/generated/schema.d.ts')

const scratch = mkdtempSync(join(tmpdir(), 'carevelo-api-client-'))
const fresh = join(scratch, 'schema.d.ts')

try {
  execFileSync(
    'pnpm',
    ['exec', 'openapi-typescript', spec, '--output', fresh],
    { stdio: 'pipe', cwd: resolve(here, '..') },
  )

  const a = readFileSync(committed, 'utf8')
  const b = readFileSync(fresh, 'utf8')

  if (a === b) {
    console.log('api-client is in sync with docs/40-api/openapi.yaml')
    process.exit(0)
  }

  console.error(
    'packages/api-client is out of date.\n' +
      'The API contract changed without the client being regenerated.\n' +
      'Run `pnpm api-client:generate` and commit the result.',
  )
  process.exit(1)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
