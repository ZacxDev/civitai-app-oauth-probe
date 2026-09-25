/**
 * The `bootSkeleton` contract, as one predicate both the test and CI call.
 *
 * 🔴 IT PINS A RELATIONSHIP, NOT A SIDE. The hazard is not "index.html has no
 * skeleton" and not "the manifest sets a flag" — either alone is fine. It is the
 * two DISAGREEING: `bootSkeleton: true` tells the run host to stand down its own
 * loading veil, so a true flag over an empty `#root` shows the viewer a blank
 * iframe for the whole load. The platform's own `boot-skeleton-gate` refuses the
 * build for it, and it refused 0.1.1.
 *
 * So both directions are violations and both are checked:
 *   flag true  + empty  #root  -> blank iframe (what happened)
 *   flag false + filled #root  -> two loading states stacked
 */

/** Everything between the opening `<div id="root">` and its matching `</div>`. */
export function rootContent(html: string): string | null {
  const open = /<div\s+id=["']root["']\s*>/i.exec(html);
  if (!open) return null;
  const rest = html.slice(open.index + open[0].length);
  // Walk nested <div>s so the FIRST `</div>` of a nested skeleton does not end it.
  let depth = 1;
  let i = 0;
  const tag = /<(\/?)div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(rest)) !== null) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) {
      i = m.index;
      return rest.slice(0, i);
    }
  }
  return null;
}

/**
 * Is there real painted content in `#root`? Comments and whitespace are NOT
 * content — an HTML comment is exactly what an author leaves behind when they
 * delete a skeleton, and it would otherwise read as "filled".
 */
export function paintsBootState(html: string): boolean {
  const inner = rootContent(html);
  if (inner === null) return false;
  return inner.replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
}

export interface BootSkeletonViolation {
  declared: boolean;
  paints: boolean;
  message: string;
}

/** `null` when the two agree; a described violation when they do not. */
export function bootSkeletonViolation(
  html: string,
  manifest: { bootSkeleton?: unknown }
): BootSkeletonViolation | null {
  const declared = manifest.bootSkeleton === true;
  const paints = paintsBootState(html);
  if (declared === paints) return null;
  return {
    declared,
    paints,
    message: declared
      ? 'block.manifest.json declares bootSkeleton: true but #root paints nothing. ' +
        'The run host stands down its loading veil for this app, so the viewer would ' +
        'see a blank iframe for the whole load. Paint a boot state inside #root, or ' +
        'remove bootSkeleton from the manifest.'
      : 'index.html paints a boot state inside #root but block.manifest.json does not ' +
        'declare bootSkeleton: true, so the host shows its own loading veil too and the ' +
        'viewer sees two stacked loading states. Declare the flag, or drop the markup.',
  };
}
