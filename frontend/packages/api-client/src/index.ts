/**
 * The public surface of the API client.
 *
 * `paths` and `components` come from src/generated/schema.d.ts, which is GENERATED
 * from docs/40-api/openapi.yaml and committed. Do not edit it, and do not hand-write
 * request or response types anywhere in this workspace — frontend-nextjs.md forbids
 * it, because a hand-written type is a second, silently-drifting copy of the contract.
 */
export { ApiClient, type ClientOptions, type RequestOptions } from './client'
export { ApiError, humanise, type Problem } from './problem'
export type { components, operations, paths } from './generated/schema'
