const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1050 -> "R$ 10,50" */
export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

/** 2.5 -> "2.50x" */
export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(2)}x`;
}

/** 1050 -> "10,50" (para o campo de texto) */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** "10,5" ou "10.50" -> 1050. Retorna null se não for um valor válido. */
export function parseInputToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+([.,]\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed.replace(",", ".")) * 100);
}
