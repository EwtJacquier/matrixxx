// Helpers para o inventário com quantidades (ItemStack[]).

import type { ItemStack } from "./types";

export function itemQty(items: ItemStack[], id: string): number {
  return items.find((s) => s.id === id)?.qty ?? 0;
}

export function hasItem(items: ItemStack[], id: string): boolean {
  return itemQty(items, id) > 0;
}

/** Soma `n` (pode ser negativo) à quantidade de um item; remove a entrada se zerar. */
export function adjustItem(items: ItemStack[], id: string, n: number): ItemStack[] {
  const out = items.map((s) => ({ ...s }));
  const cur = out.find((s) => s.id === id);
  if (cur) {
    cur.qty += n;
  } else if (n > 0) {
    out.push({ id, qty: n });
  }
  return out.filter((s) => s.qty > 0);
}

/** Total de itens (somando quantidades). */
export function totalItems(items: ItemStack[]): number {
  return items.reduce((sum, s) => sum + s.qty, 0);
}
