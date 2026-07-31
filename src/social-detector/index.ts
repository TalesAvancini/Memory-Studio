/**
 * Social detector — public barrel.
 *
 * Phase 2 promotion: re-exports `isSocial` from `./social.ts` so future
 * SDK packages (`@memory-studio/sdk`) and the Phase 5a augmenter can
 * import from a single stable path (`./social-detector/index.ts` or
 * `./social-detector/index.js`) without coupling to the internal
 * `social.ts` / `types.ts` layout.
 *
 * Per CALIBRATION-RESIDUE policy: the algorithm itself is preserved
 * verbatim from calibration; only the file location moved.
 */

export { isSocial } from './social.ts';
