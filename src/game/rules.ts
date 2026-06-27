// Regras puras de combate: aplicação de dano, piora de estado, distorção.
// Defaults marcados como "a discutir" no brief — ajustáveis aqui.

import { STATES, type CharState } from "./types";

/**
 * Penalidade FLAT de dano recebido por estado avançado: +2 de dano para cada
 * passo de estado acima de "Disposto" (Machucado +2, Incapacitado +4, …).
 */
export const STATE_DAMAGE_PENALTY = 2;

export function stateIndex(state: CharState): number {
  return STATES.indexOf(state);
}

export function nextState(state: CharState): CharState {
  const i = stateIndex(state);
  return STATES[Math.min(i + 1, STATES.length - 1)];
}

export function isDead(state: CharState): boolean {
  return state === "Morto";
}

export interface DamageResult {
  hp: number;
  maxHp: number;
  state: CharState;
  /** quantos estados pioraram nesta aplicação. */
  worsened: number;
  applied: number; // dano efetivo após df e multiplicador
}

/**
 * Aplica dano a um alvo.
 * - `df` ignora X pontos de dano (defesa do acessório).
 * - dano é multiplicado pelo estado atual.
 * - quando o HP chega a 0, o estado piora e o HP volta a 100% do máximo,
 *   até atingir "Morto" (terminal).
 */
export function applyDamage(
  hp: number,
  maxHp: number,
  state: CharState,
  rawDamage: number,
  df: number,
): DamageResult {
  if (isDead(state)) {
    return { hp: 0, maxHp, state, worsened: 0, applied: 0 };
  }

  const mitigated = Math.max(0, rawDamage - Math.max(0, df));
  // Penalidade flat conforme o estado atual (+2 por estado avançado).
  const penalty = STATE_DAMAGE_PENALTY * stateIndex(state);
  const applied = mitigated + penalty;

  let curHp = hp;
  let curState = state;
  let remaining = applied;
  let worsened = 0;

  while (remaining > 0 && !isDead(curState)) {
    if (remaining >= curHp) {
      remaining -= curHp;
      const adv = nextState(curState);
      worsened += 1;
      curState = adv;
      if (isDead(curState)) {
        curHp = 0;
        break;
      }
      // HP volta a 100% do máximo ao piorar de estado.
      curHp = maxHp;
    } else {
      curHp -= remaining;
      remaining = 0;
    }
  }

  return { hp: curHp, maxHp, state: curState, worsened, applied };
}

/**
 * Distorção por CARGA (recurso do personagem em batalha):
 * - máximo de cargas = nível + 1 (lvl0=1, lvl1=2, lvl2=3, lvl3=4).
 * - no início do seu turno, recupera `nível` cargas (lvl0=0, lvl1=1, lvl2=2, lvl3=3).
 * Cada carga pode ser gasta para +1 casa de movimento OU +DMG no ataque.
 */
export function maxCharges(level: number): number {
  return level + 1;
}

export function chargeRegen(level: number): number {
  return level;
}

/** Dano extra por carga gasta no ataque. */
export const DISTORTION_DMG_PER_CHARGE = 3;

export function clampDistortion(v: number): number {
  return Math.max(0, Math.min(10, Math.round(v)));
}
