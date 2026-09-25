import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { bootSkeletonViolation, paintsBootState, rootContent } from './bootSkeleton';

// Resolved from the project root (vitest's cwd), NOT from `import.meta.url`: under
// the jsdom environment `import.meta.url` is not a `file:` URL and `new URL(...)`
// throws at COLLECTION time — which fails the file without running a single case,
// and the run still prints the other files' total as though nothing were missing.
const projectRoot = process.cwd();
const REAL_HTML = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
const REAL_MANIFEST = JSON.parse(
  readFileSync(resolve(projectRoot, 'block.manifest.json'), 'utf8')
) as { bootSkeleton?: unknown };

describe('the shipped files satisfy the contract', () => {
  /**
   * 🔴 THIS IS THE CASE THAT FAILED IN PRODUCTION. 0.1.1 was approved and its
   * build was refused by the platform's `boot-skeleton-gate` with exactly this
   * disagreement. Asserted against the REAL files, not a fixture.
   */
  it('index.html and block.manifest.json agree', () => {
    expect(bootSkeletonViolation(REAL_HTML, REAL_MANIFEST)).toBeNull();
  });

  it('and the agreement is the FILLED one, not a matching pair of absences', () => {
    // Without this, deleting BOTH the flag and the skeleton passes the test above
    // while silently giving up the fast first paint the app was built to have.
    expect(REAL_MANIFEST.bootSkeleton).toBe(true);
    expect(paintsBootState(REAL_HTML)).toBe(true);
  });
});

describe('bootSkeletonViolation pins BOTH directions', () => {
  const filled = '<div id="root"><div class="boot"></div></div>';
  const empty = '<div id="root"></div>';

  it('catches a true flag over an empty #root — the production failure', () => {
    const v = bootSkeletonViolation(empty, { bootSkeleton: true });
    expect(v).not.toBeNull();
    expect(v!.message).toContain('blank iframe');
  });

  it('catches the mirror image: markup with no flag', () => {
    const v = bootSkeletonViolation(filled, { bootSkeleton: false });
    expect(v).not.toBeNull();
    expect(v!.message).toContain('two stacked loading states');
  });

  it('accepts both consistent states', () => {
    expect(bootSkeletonViolation(filled, { bootSkeleton: true })).toBeNull();
    expect(bootSkeletonViolation(empty, { bootSkeleton: false })).toBeNull();
  });

  it('treats an absent flag as false rather than as declared', () => {
    expect(bootSkeletonViolation(empty, {})).toBeNull();
    expect(bootSkeletonViolation(filled, {})).not.toBeNull();
  });
});

describe('paintsBootState', () => {
  /**
   * The exact residue an author leaves when they delete a skeleton. If a comment
   * counted as content, the guard would read as satisfied by the deletion itself.
   */
  it('does not count comments or whitespace as painted content', () => {
    expect(paintsBootState('<div id="root">\n  <!-- skeleton removed -->\n</div>')).toBe(false);
    expect(paintsBootState('<div id="root">   \n\t </div>')).toBe(false);
  });

  it('counts real markup, and text', () => {
    expect(paintsBootState('<div id="root"><span>x</span></div>')).toBe(true);
    expect(paintsBootState('<div id="root">Loading…</div>')).toBe(true);
  });

  it('is false when there is no #root at all, rather than throwing', () => {
    expect(paintsBootState('<body></body>')).toBe(false);
  });
});

describe('rootContent walks nested divs', () => {
  /**
   * A skeleton is nested markup. A naive scan to the first `</div>` would stop
   * inside it and, for a skeleton whose first child is an empty div, report the
   * content as empty — passing the guard while the real file was fine, or worse,
   * failing it for a file that was correct.
   */
  it('does not stop at the first closing tag of a nested element', () => {
    const html = '<div id="root"><div class="a"><div class="b"></div></div></div><footer/>';
    expect(rootContent(html)).toBe('<div class="a"><div class="b"></div></div>');
  });

  it('returns null when #root is never closed', () => {
    expect(rootContent('<div id="root"><span>')).toBeNull();
  });

  it('finds the real file\'s skeleton, so the parser works on the shipped shape', () => {
    const inner = rootContent(REAL_HTML);
    expect(inner).not.toBeNull();
    expect(inner).toContain('boot__bar');
  });
});
