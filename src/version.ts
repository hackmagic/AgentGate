/** Keep in sync with package.json; tests/contract.test.ts asserts equality. */
export const ENGINE_VERSION = '0.10.0';

/**
 * Compiler format version, independent of the package version.
 *
 * Bump this whenever a target's *rendered shape* changes in a way that an
 * already-shipped agent would read differently. Consumers (and the `gate
 * verify` command) can then tell "same policies, new format" from "same
 * policies, older compiler", which the source hash alone cannot express.
 *
 * Contract: docs/06-compiler-spec.md.
 */
export const COMPILE_FORMAT_VERSION = '3';
