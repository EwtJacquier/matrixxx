// Facções de combate, para alvos e bloqueio de movimento.
// - player: jogadores (aliados entre si).
// - enemy: inimigos hostis (aliados entre si).
// - npc: inimigos neutros/brancos (facção própria).
// Inimigos hostis NÃO atacam outros hostis; inimigos e NPCs PODEM se atacar.

import type { Token } from "./types";

export type Faction = "player" | "enemy" | "npc" | "object";

export function faction(token: Token): Faction {
  if (token.kind === "player") return "player";
  if (token.kind === "object") return "object";
  // kind === "enemy"
  return token.neutral ? "npc" : "enemy";
}

/** Mesma facção = aliados (passam um pelo outro no movimento, não se atacam). */
export function sameFaction(a: Token, b: Token): boolean {
  return faction(a) === faction(b);
}

/** O atacante pode mirar o alvo? Combatentes de facções diferentes, ou objetos
 * destrutíveis (com HP > 0), que qualquer um pode atacar. */
export function canTarget(attacker: Token, target: Token): boolean {
  if (attacker.kind !== "player" && attacker.kind !== "enemy") return false;
  // Objeto com HP é destrutível e pode ser atacado por qualquer combatente.
  if (target.kind === "object") return (target.hp ?? 0) > 0;
  if (target.kind !== "player" && target.kind !== "enemy") return false;
  // Corpos (mortos) não podem ser alvo.
  if (target.state === "Morto") return false;
  return faction(attacker) !== faction(target);
}
