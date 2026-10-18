const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

// Display only: calculations and persisted values remain decimal strings.
export function formatNutritionAmount(value: string) {
  return amountFormatter.format(Number(value));
}
