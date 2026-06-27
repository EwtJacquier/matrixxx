// Registra os handlers de Socket.IO. Autentica pelo cookie de sessão no handshake.
// Estado de jogo é único e compartilhado; após cada mutação re-emitimos o estado.

import type { Server as IOServer, Socket } from "socket.io";
import cookie from "cookie";
import type {
  BattleTemplate,
  CatalogItem,
  Character,
  ConfirmedAction,
  Disguise,
  GameObject,
  Hack,
  Initiative,
  Npc,
  Profession,
  Roll,
  Scenario,
  Token,
} from "@/game/types";
import { adjacencyMods, ruleOf } from "@/game/objects";
import { roll } from "@/game/dice";
import { DISTORTION_DMG_PER_CHARGE, applyDamage, clampDistortion } from "@/game/rules";
import { SESSION_COOKIE, verifyToken } from "../auth/session";
import { getUserById } from "../auth/users";
import {
  getCharacters,
  getGame,
  getItems,
  getNpcs,
  refreshUsers,
  remove,
  saveGame,
  upsert,
} from "../data/store";
import {
  advanceTurn,
  appendLog,
  buildPublicState,
  endBattle,
  setDistortion,
  removeTokens,
  setInitiative,
  setLastRoll,
  setScenario,
  startBattle,
  updateTokens,
} from "../game/manager";

interface SessionUser {
  id: string;
  email: string;
  role: "gm" | "player";
}

function authFromHandshake(socket: Socket): SessionUser | null {
  const header = socket.handshake.headers.cookie;
  if (process.env.SOCKET_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[auth] cookie header:", header);
  }
  if (!header) return null;
  const parsed = cookie.parse(header);
  const userId = verifyToken(parsed[SESSION_COOKIE]);
  if (process.env.SOCKET_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[auth] token present:", !!parsed[SESSION_COOKIE], "userId:", userId);
  }
  if (!userId) return null;
  return getUserById(userId);
}

export function registerSocket(io: IOServer): void {
  // Relógio do turno: a cada segundo, se o turno estourou (3 min), pula automático.
  setInterval(async () => {
    const b = getGame().battle;
    if (!b || b.initiative.length === 0 || !b.turnEndsAt) return;
    if (Date.now() < b.turnEndsAt) return;
    const entry = b.initiative[b.turnIndex];
    const actor = b.tokens.find((t) => t.id === entry?.tokenId);
    await appendLog(`⏱ Tempo esgotado: ${actor?.label ?? "ator"} perdeu o turno.`);
    await advanceTurn(1);
    io.emit("state", buildPublicState());
  }, 1000);

  io.on("connection", async (socket: Socket) => {
    // Relê usuários do disco: contas criadas pelos route handlers (bundle
    // separado no dev) só ficam visíveis aqui após esta releitura.
    await refreshUsers();

    const user = authFromHandshake(socket);
    if (!user) {
      socket.emit("unauthorized");
      socket.disconnect(true);
      return;
    }

    const isGM = user.role === "gm";
    const fail = (message: string) => socket.emit("game:error", { message });
    const broadcast = () => io.emit("state", buildPublicState());

    // Controle de turno: jogador controla SÓ o próprio token; GM controla SÓ
    // inimigos/monstros (não os tokens dos jogadores).
    const canControl = (token: Token): boolean => {
      if (token.kind === "player") return ownsToken(token, user.id);
      if (token.kind === "enemy") return isGM;
      return false;
    };

    // Estado inicial só para quem conectou.
    socket.emit("session", user);
    socket.emit("state", buildPublicState());
    // Avisa os demais (ex.: novo jogador entrou → atualiza a lista de players).
    socket.broadcast.emit("state", buildPublicState());

    // Guarda como lastRoll, registra no log de batalha e emite o resultado a todos.
    const emitRoll = async (r: Roll) => {
      await setLastRoll(r);
      if (getGame().battle) {
        const dice = r.results.join(", ");
        await appendLog(`${r.reason} (${r.author}): ${r.formula} = ${r.total} [${dice}]`);
      }
      io.emit("dice:roll", r);
    };

    // --- Ações do GM ---

    socket.on("gm:setScenario", async ({ scenarioId }: { scenarioId: string }) => {
      if (!isGM) return fail("Apenas o GM pode trocar o cenário.");
      await setScenario(scenarioId);
      broadcast();
    });

    socket.on("gm:setDistortion", async ({ value }: { value: number }) => {
      if (!isGM) return fail("Apenas o GM pode ajustar a distorção.");
      await setDistortion(value);
      broadcast();
    });

    socket.on(
      "gm:startBattle",
      async ({ grid, tokens }: { grid: number; tokens: Token[] }) => {
        if (!isGM) return fail("Apenas o GM pode iniciar a batalha.");
        if (!tokens.some((t) => t.kind === "player")) {
          return fail("Adicione ao menos 1 jogador para iniciar a batalha.");
        }
        await startBattle(grid, tokens);
        // Iniciativa rolada automaticamente para todos (jogadores + inimigos).
        const b = getGame().battle;
        if (b) {
          const combatants = b.tokens.filter(
            (t) => t.kind === "player" || t.kind === "enemy",
          );
          const init: Initiative[] = combatants.map((t) => {
            const r = roll("1d100", t.label, `Iniciativa ${t.label}`);
            return { tokenId: t.id, value: r.total, label: t.label };
          });
          await setInitiative(init);
          const ordem = [...init]
            .sort((a, b) => b.value - a.value)
            .map((i) => `${i.label} ${i.value}`)
            .join(" › ");
          await appendLog(`Iniciativa: ${ordem}`);
        }
        broadcast();
      },
    );

    socket.on("gm:endBattle", async () => {
      if (!isGM) return fail("Apenas o GM pode encerrar a batalha.");
      await endBattle();
      broadcast();
    });

    socket.on("gm:updateTokens", async ({ tokens }: { tokens: Token[] }) => {
      if (!isGM) return fail("Apenas o GM pode reposicionar tokens.");
      await updateTokens(tokens);
      broadcast();
    });

    socket.on("gm:advanceTurn", async ({ dir }: { dir: 1 | -1 }) => {
      if (!isGM) return fail("Apenas o GM controla os turnos.");
      await advanceTurn(dir);
      broadcast();
    });

    // --- Ações de jogador ---

    socket.on(
      "player:moveToken",
      async ({
        tokenId,
        pos,
        moveCharges = 0,
      }: {
        tokenId: string;
        pos: { x: number; y: number };
        moveCharges?: number;
      }) => {
        const g = getGame();
        const b = g.battle;
        if (!b) return fail("Sem batalha ativa.");
        const tok = b.tokens.find((t) => t.id === tokenId);
        if (!tok) return fail("Token inexistente.");
        if (!canControl(tok)) return fail("Você não controla esse token.");
        // Não pode haver dois tokens na mesma casa.
        const occupied = b.tokens.some(
          (t) => t.id !== tok.id && t.pos.x === pos.x && t.pos.y === pos.y,
        );
        if (occupied) return fail("Casa ocupada.");
        // Cargas de distorção estendem o movimento em +1 casa cada.
        const spend = Math.max(0, Math.min(moveCharges, tok.charges ?? 0));
        const mv = baseMv(tok) + spend;
        if (manhattanT(tok.pos, pos) > mv) return fail("Fora do alcance de movimento.");
        tok.pos = pos;
        if (spend > 0) {
          tok.charges = (tok.charges ?? 0) - spend;
          g.distortion = clampDistortion(g.distortion + spend);
        }
        await updateTokens(b.tokens);
        await saveGame(g);
        broadcast();
      },
    );

    socket.on("player:confirmAction", async (action: ConfirmedAction) => {
      const g = getGame();
      const b = g.battle;
      if (!b) return fail("Sem batalha ativa.");
      const actor = b.tokens.find((t) => t.id === action.tokenId);
      if (!actor) return fail("Token inexistente.");
      if (!canControl(actor)) return fail("Você não controla esse token.");

      let r: Roll | null = null;
      const damages: { tokenId: string; amount: number; pos: { x: number; y: number }; notes?: string[] }[] = [];
      // Cargas de distorção gastas no ataque (+dano), limitadas ao disponível.
      const charges = Math.max(0, Math.min(action.attackCharges ?? 0, actor.charges ?? 0));
      const distBonus = charges * DISTORTION_DMG_PER_CHARGE;

      // Modificador de ATAQUE do ator por objetos adjacentes (ex.: Reforço +1).
      const atkMod = adjacencyMods(actor, b.tokens).attack;

      const damageToken = (target: Token, base: number) => {
        if (target.kind !== "enemy" && target.kind !== "player") return null;
        // Defesa do alvo por objetos adjacentes (ex.: Cobertura +1 → -1 de dano).
        const def = adjacencyMods(target, b.tokens).defense;
        const dmg = Math.max(0, base - def);
        const res = applyDamage(
          target.hp ?? 0,
          target.maxHp ?? 1,
          target.state ?? "Disposto",
          dmg,
          0,
        );
        target.hp = res.hp;
        target.state = res.state;
        const notes: string[] = [];
        if (atkMod) notes.push(`ATK ${atkMod > 0 ? "+" : ""}${atkMod}`);
        if (def) notes.push(`DEF +${def}`);
        damages.push({
          tokenId: target.id,
          amount: dmg,
          pos: { ...target.pos },
          notes: notes.length ? notes : undefined,
        });
        return dmg;
      };

      // Objetos a remover do mapa (uso único).
      const consumed: string[] = [];

      if (action.kind === "attack") {
        const formula = resolveWeaponFormula(actor, action.detail);
        r = roll(formula, actor.label, "Ataque");
        const target = b.tokens.find((t) => t.id === action.targetId);
        if (target) {
          const base = Math.max(0, r.total + distBonus + atkMod);
          const weapon = action.detail ? getItems().find((i) => i.id === action.detail) : null;
          const area = weapon?.area ?? 0;
          const affected = area
            ? b.tokens.filter(
                (t) =>
                  t.id !== actor.id &&
                  (t.kind === "enemy" || t.kind === "player") &&
                  manhattanT(target.pos, t.pos) <= area,
              )
            : [target];
          for (const t of affected) damageToken(t, base);
          await appendLog(
            `${actor.label} atacou ${target.label}: ${base} de dano base` +
              (area ? ` (área ${area}, ${affected.length} alvos)` : "") +
              (atkMod ? ` [ataque ${atkMod > 0 ? "+" : ""}${atkMod}]` : ""),
          );
        }
      } else if (action.kind === "special" && action.objectId) {
        // Ação especial usando um objeto adjacente (ex.: chutar a mesa).
        const objTok = b.tokens.find((t) => t.id === action.objectId && t.kind === "object");
        const rule = objTok ? ruleOf(objTok) : null;
        const target = b.tokens.find((t) => t.id === action.targetId);
        if (objTok && rule?.damage && manhattanT(actor.pos, objTok.pos) <= 1 && target) {
          r = roll(rule.damage, actor.label, objTok.label);
          const base = Math.max(0, r.total + distBonus + atkMod);
          const dmg = damageToken(target, base);
          await appendLog(`${actor.label} usou ${objTok.label} em ${target.label}: ${dmg} de dano`);
          if (objTok.destroyOnUse) {
            consumed.push(objTok.id);
            await appendLog(`${objTok.label} foi destruído.`);
          }
        }
      }

      // Tokens mortos somem do mapa; idem objetos de uso único.
      const dead = b.tokens
        .filter((t) => (t.kind === "enemy" || t.kind === "player") && t.state === "Morto")
        .map((t) => t.id);
      for (const id of dead) {
        const t = b.tokens.find((x) => x.id === id);
        if (t) await appendLog(`${t.label} foi derrotado e saiu do mapa.`);
      }

      // Cargas gastas no ataque: consome do ator e sobe a distorção do cenário.
      if (charges > 0) {
        actor.charges = (actor.charges ?? 0) - charges;
        g.distortion = clampDistortion(g.distortion + charges);
        await appendLog(`${actor.label} gastou ${charges} carga(s) de distorção (+${distBonus} dano).`);
      }

      await updateTokens(b.tokens);
      if (r) {
        action.rollId = r.id;
        await emitRoll(r);
      }
      await saveGame(g);
      if (damages.length > 0) io.emit("battle:damage", { events: damages });
      io.emit("action:confirmed", action);
      // Remove mortos e objetos consumidos (mantém o ator no turno), depois avança.
      await removeTokens([...dead, ...consumed], actor.id);
      // Confirmar a ação encerra o turno do ator: avança para o próximo.
      await advanceTurn(1);
      broadcast();
    });

    socket.on("player:endTurn", async () => {
      const b = getGame().battle;
      if (!b) return fail("Sem batalha ativa.");
      const entry = b.initiative[b.turnIndex];
      const actor = b.tokens.find((t) => t.id === entry?.tokenId);
      if (!actor) return fail("Sem ator no turno.");
      if (!isGM && !ownsToken(actor, user.id)) return fail("Não é o seu turno.");
      await appendLog(`${actor.label} encerrou o turno.`);
      await advanceTurn(1);
      broadcast();
    });

    // --- Rolagem genérica (qualquer um pode pedir; visível a todos) ---

    socket.on(
      "dice:request",
      async ({ formula, reason }: { formula: string; reason: string }) => {
        try {
          const r = roll(formula, user.email, reason || "Rolagem");
          await emitRoll(r);
        } catch (e) {
          fail((e as Error).message);
        }
      },
    );

    // --- Cadastros (GM) ---

    socket.on(
      "catalog:upsert",
      async ({ kind, entity }: { kind: CrudKind; entity: AnyEntity }) => {
        if (!isGM) return fail("Apenas o GM administra os cadastros.");
        await upsert(kind, entity as { id: string });
        broadcast();
      },
    );

    socket.on(
      "catalog:remove",
      async ({ kind, id }: { kind: CrudKind; id: string }) => {
        if (!isGM) return fail("Apenas o GM administra os cadastros.");
        await remove(kind, id);
        broadcast();
      },
    );

    // --- Ficha de personagem ---

    socket.on("character:save", async (character: Character) => {
      if (!isGM && character.userId !== user.id) {
        return fail("Você só pode editar a sua ficha.");
      }
      await upsert("characters", character);
      broadcast();
    });

    socket.on("disconnect", () => {
      // estado é compartilhado; nada a limpar
    });
  });
}

type CrudKind =
  | "scenarios"
  | "professions"
  | "items"
  | "hacks"
  | "disguises"
  | "npcs"
  | "objects"
  | "battleTemplates";
type AnyEntity =
  | Scenario
  | Profession
  | CatalogItem
  | Hack
  | Disguise
  | Npc
  | GameObject
  | BattleTemplate;

function manhattanT(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function ownsToken(token: Token, userId: string): boolean {
  if (!token.characterId) return false;
  const ch = getCharacters().find((c) => c.id === token.characterId);
  return !!ch && ch.userId === userId;
}

/** Movimento base do token (ficha do jogador, ou 2 para inimigos). */
function baseMv(token: Token): number {
  if (token.characterId) {
    const ch = getCharacters().find((c) => c.id === token.characterId);
    if (ch) return ch.mv;
  }
  return 2;
}

function resolveWeaponFormula(actor: Token, detail?: string): string {
  // detail pode ser o id de um item/arma; senão usa mãos livres.
  if (detail) {
    const item = getItems().find((i) => i.id === detail);
    if (item?.damage) return item.damage;
  }
  // Inimigo vindo do catálogo de NPCs usa o dano cadastrado.
  if (actor.kind === "enemy" && actor.npcId) {
    const npc = getNpcs().find((n) => n.id === actor.npcId);
    if (npc?.damage) return npc.damage;
  }
  return "1d4";
}

