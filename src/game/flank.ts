// Flanqueamento: se o atacante e o alvo estão em linha reta e há um ALIADO do
// atacante imediatamente atrás do alvo (na mesma linha), o ataque ganha +3.

import type { Token } from "./types";
import { faction } from "./faction";

export const FLANK_BONUS = 3;

function alive(t: Token): boolean {
  return (t.kind === "player" || t.kind === "enemy") && t.state !== "Morto";
}

/** O alvo está flanqueado pelo atacante (aliado do atacante logo atrás)? */
export function isFlanked(attacker: Token, target: Token, tokens: Token[]): boolean {
  if (!alive(target)) return false;
  if (attacker.kind !== "player" && attacker.kind !== "enemy") return false;
  if (faction(attacker) === faction(target)) return false; // só inimigos

  const ax = attacker.pos.x,
    ay = attacker.pos.y,
    tx = target.pos.x,
    ty = target.pos.y;
  // Linha reta (mesma linha ou coluna), atacante atrás do alvo na direção do disparo.
  const sameRow = ay === ty && ax !== tx;
  const sameCol = ax === tx && ay !== ty;
  if (!sameRow && !sameCol) return false;

  const dx = sameRow ? Math.sign(tx - ax) : 0;
  const dy = sameCol ? Math.sign(ty - ay) : 0;
  // Casa imediatamente atrás do alvo (oposta ao atacante).
  const bx = tx + dx,
    by = ty + dy;
  const behind = tokens.find((t) => t.pos.x === bx && t.pos.y === by && alive(t));
  if (!behind) return false;

  // O que está atrás precisa ser aliado do atacante (e inimigo do alvo).
  return faction(behind) === faction(attacker);
}
