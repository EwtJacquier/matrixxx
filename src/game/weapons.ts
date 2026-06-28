// Banda de alcance das armas: [minRange, maxRange]. Armas de longo alcance têm
// mínimo > 1 (não atiram coladinho), incentivando combate corpo a corpo de perto.

import type { CatalogItem } from "./types";

/**
 * Mãos Livres: arma EMBUTIDA (não é item do catálogo), sempre disponível para
 * todos — jogadores e inimigos. Dano fixo 1d4+2, alcance 1. Tratada como item.
 */
export const FREE_HANDS_ID = "wpn_maos_livres";
export const FREE_HANDS: CatalogItem = {
  id: FREE_HANDS_ID,
  category: "weapon",
  name: "Mãos Livres",
  damage: "1d4+2",
  range: 1,
};

/** Resolve um item por id, com Mãos Livres embutido (fonte única da verdade). */
export function resolveItem(
  items: CatalogItem[],
  id: string | null | undefined,
): CatalogItem | null {
  if (!id) return null;
  if (id === FREE_HANDS_ID) return FREE_HANDS;
  return items.find((i) => i.id === id) ?? null;
}

export interface RangeBand {
  min: number;
  max: number;
}

export function weaponBand(weapon: CatalogItem | null | undefined): RangeBand {
  if (!weapon) return { min: 1, max: 1 }; // mãos livres
  return { min: Math.max(1, weapon.minRange ?? 1), max: Math.max(1, weapon.range ?? 1) };
}

export function inBand(dist: number, band: RangeBand): boolean {
  return dist >= band.min && dist <= band.max;
}

/** Texto curto do alcance: "1" ou "3-4". */
export function bandLabel(band: RangeBand): string {
  return band.min === band.max ? `${band.max}` : `${band.min}-${band.max}`;
}
