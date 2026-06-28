// Regras puras de combate: aplicação de dano, piora de estado, distorção.
// Defaults marcados como "a discutir" no brief — ajustáveis aqui.

import { STATES, type CharState } from "./types";

/**
 * Penalidades por estado avançado, INTERCALADAS a cada passo acima de "Disposto":
 *   Machucado       → -2 dano
 *   Incapacitado    → -1 movimento
 *   Perto da Morte  → -2 dano
 *   (Morto)         → -1 movimento (terminal, sem ações)
 * Acumulativas: os passos de dano somam -2 e os de movimento somam -1.
 * A penalidade de dano afeta SÓ o dano dos dados (nunca < 0); o dano fixo da arma
 * é preservado, para o personagem ferido não ficar fraco demais.
 */
export const STATE_DAMAGE_PENALTY = 2;
export const STATE_MOVE_PENALTY = 1;

export function stateIndex(state: CharState): number {
  return STATES.indexOf(state);
}

/** Penalidade de dano acumulada do atacante (passos ímpares: Machucado, Perto da Morte). */
export function stateDamagePenalty(state: CharState): number {
  return Math.ceil(stateIndex(state) / 2) * STATE_DAMAGE_PENALTY;
}

/** Penalidade de movimento acumulada (passos pares: Incapacitado, Morto). */
export function stateMovePenalty(state: CharState): number {
  return Math.floor(stateIndex(state) / 2) * STATE_MOVE_PENALTY;
}

/**
 * Aplica a penalidade de estado do atacante ao dano dos dados (nunca < 0).
 * `dieSum` é só a soma dos dados (sem o dano fixo da arma).
 */
export function dieDamageAfterState(dieSum: number, attackerState: CharState): number {
  return Math.max(0, dieSum - stateDamagePenalty(attackerState));
}

export function nextState(state: CharState): CharState {
  const i = stateIndex(state);
  return STATES[Math.min(i + 1, STATES.length - 1)];
}

export function isDead(state: CharState): boolean {
  return state === "Morto";
}

/** Melhora o estado em `steps` passos rumo a "Disposto" (Morto é terminal). */
export function improveState(state: CharState, steps = 1): CharState {
  if (isDead(state)) return state; // morto não volta com cura
  const i = stateIndex(state);
  return STATES[Math.max(0, i - steps)];
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
 * - quando o HP chega a 0, o estado piora e o HP volta a 100% do máximo,
 *   até atingir "Morto" (terminal).
 *
 * A penalidade por estado NÃO é aplicada aqui — ela incide no dano dos dados do
 * ATACANTE (ver `dieDamageAfterState`), antes de chegar como `rawDamage`.
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

  const applied = Math.max(0, rawDamage - Math.max(0, df));

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
 * - no início do seu turno, recupera SEMPRE 1 carga (independente do nível),
 *   limitada ao máximo do nível.
 * Cada carga pode ser gasta para +1 casa de movimento OU +DMG no ataque.
 */
export function maxCharges(level: number): number {
  return level + 1;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function chargeRegen(_level: number): number {
  return 1;
}

/** Dano extra por carga gasta no ataque. */
export const DISTORTION_DMG_PER_CHARGE = 3;

export function clampDistortion(v: number): number {
  return Math.max(0, Math.min(10, Math.round(v)));
}
