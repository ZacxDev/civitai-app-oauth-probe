/**
 * Runs the `bootSkeleton` contract against a BUILT index.html — the artifact the
 * platform's own `boot-skeleton-gate` inspects.
 *
 * 🔴 WHY THIS EXISTS SEPARATELY FROM THE UNIT TEST. `src/bootSkeleton.test.ts`
 * asserts on the SOURCE `index.html`. That is the file an author edits, so it
 * catches the mistake at the moment it is made — but it is not what the platform
 * reads. A build step that dropped or rewrote the container would leave the unit
 * test green and the deploy refused, which is the gap that cost 0.1.1.
 *
 * Same predicate, two artifacts. It imports `src/bootSkeleton.ts` rather than
 * restating the rule, so there is exactly one definition of the contract.
 *
 * Usage: node scripts/check-boot-skeleton.ts [path-to-built-index.html]
 * Node >= 22.18 strips the types natively; `.nvmrc` pins 24.
 */
import { readFileSync } from 'node:fs';

import { bootSkeletonViolation } from '../src/bootSkeleton.ts';

const htmlPath = process.argv[2] ?? 'dist/index.html';
const manifestPath = 'block.manifest.json';

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // A missing built file is a FAILURE, never a silent pass — that is the shape
    // that turns this check into decoration.
    console.error(`boot-skeleton check: cannot read ${path}. Run the build first.`);
    process.exit(2);
  }
}

const html = read(htmlPath);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bootSkeleton?: unknown };
const violation = bootSkeletonViolation(html, manifest);

if (violation) {
  console.error(`boot-skeleton check FAILED on ${htmlPath}`);
  console.error(`  manifest bootSkeleton: ${violation.declared}`);
  console.error(`  #root paints content:  ${violation.paints}`);
  console.error(`  ${violation.message}`);
  process.exit(1);
}

console.log(
  `boot-skeleton check OK on ${htmlPath} ` +
    `(manifest bootSkeleton: ${manifest.bootSkeleton === true}, #root paints content: true)`
);
