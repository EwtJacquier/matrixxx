// Banda de alcance das armas: [minRange, maxRange]. Armas de longo alcance têm
// mínimo > 1 (não atiram coladinho), incentivando combate corpo a corpo de perto.

import type { CatalogItem } from "./types";

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
