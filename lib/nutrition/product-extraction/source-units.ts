import { sourceNumberMatches, sourceNumbers } from '@/lib/ai/source-evidence';

/** A single explicit per-quantity is deterministic reference information. */
export function explicitCorrectionReference(source: { text: string }) {
  const references = sourceNumberMatches(source.text).flatMap((match, index) => {
    const before = source.text.slice(0, match.index ?? 0);
    const unit = sourcePhysicalUnit(source, index);
    return /(?:\bper(?:\s+(?:serving|portion|portie|piece|stuk|blokje)(?:\s+(?:van|of))?)?|\/)\s*\(?\s*$/i.test(
      before
    ) &&
      (unit === 'G' || unit === 'ML')
      ? [{ index, unit: unit as 'G' | 'ML' }]
      : [];
  });
  return references.length === 1 ? references[0] : null;
}

export function sourcePhysicalUnit(cell: { text: string }, index: number | null) {
  if (index === null) {
    return null;
  }
  const match = sourceNumberMatches(cell.text)[index];
  if (!match) {
    return null;
  }
  const after = cell.text.slice((match.index ?? 0) + match[0].length);
  const literal = after
    .match(
      /^\s*(kilogram(?:me)?s?|kg|millilit(?:er|re)s?|ml|gram(?:me)?s?|g|lit(?:er|re)s?|l)(?![a-z])/i
    )?.[1]
    ?.toLowerCase();
  return !literal
    ? null
    : literal === 'kg' || literal.startsWith('kilo')
      ? 'KG'
      : literal === 'ml' || literal.startsWith('milli')
        ? 'ML'
        : literal === 'g' || literal.startsWith('gram')
          ? 'G'
          : 'L';
}
export function sourceAmountUnit(cell: { text: string }, index: number | null, rowLabel = '') {
  if (index === null) {
    return null;
  }
  const match = sourceNumberMatches(cell.text)[index];
  if (!match) {
    return null;
  }
  const after = cell.text.slice((match.index ?? 0) + match[0].length);
  const explicit = after.match(
    /^\s*(kilocalories?|kcal|kilojoules?|kJ|milligrams?|mg|gram(?:me)?s?|g|%)(?![a-z])/i
  )?.[1];
  const preceding = cell.text
    .slice(0, match.index ?? 0)
    .match(
      /(?:^|[^a-z])(kilocalories?|kcal|kilojoules?|kJ|milligrams?|mg|gram(?:me)?s?|g|%)\s*$/i
    )?.[1];
  const canonical = (unit: string) => {
    const lower = unit.toLowerCase();
    return lower === 'kj' || lower.startsWith('kilojoule')
      ? 'kJ'
      : lower === 'kcal' || lower.startsWith('kilocalor')
        ? 'kcal'
        : lower === 'mg' || lower.startsWith('milligram')
          ? 'mg'
          : lower === 'g' || lower.startsWith('gram')
            ? 'g'
            : '%';
  };
  if (explicit) {
    if (preceding && canonical(preceding) !== canonical(explicit)) {
      return null;
    }
    return canonical(explicit);
  }
  if (preceding) {
    return canonical(preceding);
  }
  const labelUnits = [
    ...rowLabel.matchAll(
      /(?:^|[^a-z])(kilocalories?|kcal|kilojoules?|kJ|milligrams?|mg|gram(?:me)?s?|g|%)(?![a-z])/gi
    ),
  ].map((item) => canonical(item[1]));
  const distinct = [...new Set(labelUnits)];
  return distinct.length === 1
    ? distinct[0]
    : distinct.length === sourceNumbers(cell.text).length
      ? distinct[index]
      : null;
}
