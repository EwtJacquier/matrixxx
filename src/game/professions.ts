// Bônus de combate concedidos pelas profissões de combate do personagem.

import type { Profession, WeaponType } from "./types";

export const MAX_COMBAT_ROLES = 2;
export const MAX_RP_ROLES = 2;

export interface CombatBonuses {
  mv: number;
  df: number;
  dmg: number;
  hp: number;
}

/** Soma os bônus das profissões de COMBATE entre os ids escolhidos. */
export function combatBonuses(roleIds: string[], professions: Profession[]): CombatBonuses {
  const b: CombatBonuses = { mv: 0, df: 0, dmg: 0, hp: 0 };
  for (const id of roleIds) {
    const p = professions.find((x) => x.id === id);
    if (!p || p.kind !== "combat") continue;
    b.mv += p.mvBonus ?? 0;
    b.df += p.dfBonus ?? 0;
    b.dmg += p.dmgBonus ?? 0;
    b.hp += p.hpBonus ?? 0;
  }
  return b;
}

/** Rótulo curto do tipo de arma. */
export function weaponTypeLabel(t: WeaponType): string {
  return t === "firearm" ? "arma de fogo" : "corpo a corpo";
}

/**
 * Dano extra das profissões de combate para um TIPO de arma específico.
 * O +dano só conta se o `dmgType` da profissão casar com a arma usada.
 */
export function professionDamageFor(
  roleIds: string[],
  professions: Profession[],
  weaponType: WeaponType,
): number {
  let dmg = 0;
  for (const id of roleIds) {
    const p = professions.find((x) => x.id === id);
    if (!p || p.kind !== "combat" || !p.dmgBonus) continue;
    if ((p.dmgType ?? "melee") === weaponType) dmg += p.dmgBonus;
  }
  return dmg;
}

/** Texto curto dos bônus de uma profissão de combate (ex.: "+2 dano corpo a corpo · +1 MV"). */
export function combatBonusLabel(p: Profession): string {
  const parts: string[] = [];
  if (p.dmgBonus) parts.push(`+${p.dmgBonus} dano ${weaponTypeLabel(p.dmgType ?? "melee")}`);
  if (p.mvBonus) parts.push(`${p.mvBonus > 0 ? "+" : ""}${p.mvBonus} MV`);
  if (p.dfBonus) parts.push(`+${p.dfBonus} DF`);
  if (p.hpBonus) parts.push(`+${p.hpBonus} HP`);
  return parts.join(" · ");
}
