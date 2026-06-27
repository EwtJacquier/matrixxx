// Pathfinding de movimento em batalha. O movimento é ortogonal (diagonal custa 2,
// equivalente a dois passos), com custo 1 por casa. Tokens NÃO aliados bloqueiam a
// passagem — é preciso contorná-los. Aliados podem ser atravessados, mas não se pode
// parar em cima de nenhum token.

import type { Token } from "./types";
import { sameFaction } from "./faction";

function sameSide(a: Token, b: Token): boolean {
  return sameFaction(a, b);
}

/** Conjunto de casas (vazias) alcançáveis pelo ator em até `mv` passos. */
export function reachableCells(
  actor: Token,
  tokens: Token[],
  grid: number,
  mv: number,
): Set<string> {
  const reachable = new Set<string>();
  if (mv < 0) return reachable;

  // Mapa de bloqueios: casa -> token nela (exceto o próprio ator).
  const occupants = new Map<string, Token>();
  for (const t of tokens) {
    if (t.id === actor.id) continue;
    occupants.set(`${t.pos.x},${t.pos.y}`, t);
  }

  const start = `${actor.pos.x},${actor.pos.y}`;
  const dist = new Map<string, number>([[start, 0]]);
  const queue: { x: number; y: number }[] = [{ x: actor.pos.x, y: actor.pos.y }];

  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(`${cur.x},${cur.y}`)!;
    if (d >= mv) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
      const key = `${nx},${ny}`;
      if (dist.has(key)) continue;
      const tok = occupants.get(key);
      // Token não aliado bloqueia totalmente a passagem.
      if (tok && !sameSide(actor, tok)) continue;
      dist.set(key, d + 1);
      // Só casas vazias são destinos válidos; aliados servem só de passagem.
      if (!tok) reachable.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return reachable;
}

/** O ator consegue chegar (contornando bloqueios) à casa `dest` em até `mv` passos? */
export function canReachCell(
  actor: Token,
  dest: { x: number; y: number },
  tokens: Token[],
  grid: number,
  mv: number,
): boolean {
  if (dest.x === actor.pos.x && dest.y === actor.pos.y) return true; // ficar parado
  return reachableCells(actor, tokens, grid, mv).has(`${dest.x},${dest.y}`);
}
