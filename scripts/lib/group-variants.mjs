/**
 * Group raw file stems into base icons + light/dark variants.
 * Returns Map<rawStem, {variants: {light?, dark?}, fromVariant?: true}>.
 * `knownBases` = names the upstream metadata lists: when only "<x>-light|dark" files exist for a listed "<x>",
 * "<x>" is synthesized as a base icon (fromVariant; its image = the light variant, else dark) so the listed name resolves.
 */
export function groupVariants(stems, knownBases = new Set()) {
  const all = new Set(stems);
  const bases = new Map();
  const variantOf = new Map();
  for (const s of stems) {
    const m = /^(.+)-(light|dark)$/.exec(s);
    if (m && (all.has(m[1]) || knownBases.has(m[1]))) variantOf.set(s, [m[1], m[2]]);
  }
  for (const s of stems) if (!variantOf.has(s)) bases.set(s, { variants: {} });
  for (const [s, [base, kind]] of variantOf) {
    if (!bases.has(base)) bases.set(base, { variants: {}, fromVariant: true });
    bases.get(base).variants[kind] = s;
  }
  return bases;
}
