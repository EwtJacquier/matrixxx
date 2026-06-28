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
  MusicTrack,
  Npc,
  Profession,
  Roll,
  Scenario,
  Token,
} from "@/game/types";
import { adjacencyMods, ruleOf } from "@/game/objects";
import { canTarget } from "@/game/faction";
import { FLANK_BONUS, isFlanked } from "@/game/flank";
import { FREE_HANDS, inBand, resolveItem, weaponBand, weaponTypeOf } from "@/game/weapons";
import { professionDamageFor } from "@/game/professions";
import { adjustItem, itemQty } from "@/game/inventory";
import { canReachCell } from "@/game/path";
import { roll } from "@/game/dice";
import { DISTORTION_DMG_PER_CHARGE, applyDamage, clampDistortion, dieDamageAfterState, improveState, stateMovePenalty } from "@/game/rules";
import { SESSION_COOKIE, verifyToken } from "../auth/session";
import { getUserById } from "../auth/users";
import {
  getAsset,
  getCharacters,
  getGame,
  getItems,
  getMusic,
  getNpcs,
  getProfessions,
  refreshUsers,
  remove,
  saveGame,
  upsert,
} from "../data/store";
import {
  advanceTurn,
  appendLog,
  buildPublicState,
  addEnemyToken,
  addInitiativeEntry,
  bumpTurnTimer,
  endBattle,
  playTrack,
  resumeBattle,
  setDistortion,
  setMusicLoop,
  stopMusic,
  dropFromInitiative,
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
    const g = getGame();
    const b = g.battle;
    // Só corre o cronômetro com a batalha ativa (não quando pausada no cenário).
    if (g.mode !== "battle" || !b || b.initiative.length === 0 || !b.turnEndsAt) return;
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

    // Sincronização de relógio: o cliente compara com o seu para corrigir o skew
    // do timer (ecoa t0 para o cliente medir o RTT).
    socket.on("time:sync", ({ t0 }: { t0: number }) => {
      socket.emit("time:pong", { serverNow: Date.now(), t0 });
    });

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

    socket.on("gm:resumeBattle", async () => {
      if (!isGM) return fail("Apenas o GM pode resumir a batalha.");
      await resumeBattle();
      broadcast();
    });

    socket.on(
      "gm:addEnemy",
      async ({ npcId, pos }: { npcId: string; pos: { x: number; y: number } }) => {
        if (!isGM) return fail("Apenas o GM pode adicionar inimigos.");
        await addEnemyToken(npcId, pos);
        broadcast();
      },
    );

    socket.on("gm:removeToken", async ({ tokenId }: { tokenId: string }) => {
      if (!isGM) return fail("Apenas o GM pode remover tokens.");
      const b = getGame().battle;
      if (!b) return fail("Sem batalha ativa.");
      const t = b.tokens.find((x) => x.id === tokenId);
      if (t) await appendLog(`GM removeu ${t.label}.`);
      const keep = b.initiative[b.turnIndex]?.tokenId ?? "";
      await removeTokens([tokenId], keep);
      broadcast();
    });

    socket.on("gm:updateTokens", async ({ tokens }: { tokens: Token[] }) => {
      if (!isGM) return fail("Apenas o GM pode reposicionar tokens.");
      await updateTokens(tokens);
      broadcast();
    });

    // GM edita HP/estado de um token diretamente (pelo inspetor).
    socket.on(
      "gm:editToken",
      async ({ tokenId, hp, state: st }: { tokenId: string; hp?: number; state?: string }) => {
        if (!isGM) return fail("Apenas o GM pode editar tokens.");
        const b = getGame().battle;
        if (!b) return fail("Sem batalha ativa.");
        const tok = b.tokens.find((t) => t.id === tokenId);
        if (!tok) return fail("Token inexistente.");
        const wasDead = tok.state === "Morto";
        if (hp !== undefined && tok.maxHp !== undefined) {
          tok.hp = Math.max(0, Math.min(tok.maxHp, hp));
        } else if (hp !== undefined) {
          tok.hp = Math.max(0, hp);
        }
        if (st !== undefined) tok.state = st as Token["state"];
        const nowDead = tok.state === "Morto";
        const isUnit = tok.kind === "player" || tok.kind === "enemy";
        const keep = b.initiative[b.turnIndex]?.tokenId ?? "";

        // Reviver (Morto → vivo): rola iniciativa e reentra na ordem de turnos.
        const reviving =
          isUnit && wasDead && !nowDead && !b.initiative.some((i) => i.tokenId === tok.id);
        let reviveRoll: Roll | null = null;
        if (reviving) {
          // Sem HP definido, volta com a vida cheia (não fica um "corpo" com 0 HP).
          if (hp === undefined && (tok.hp ?? 0) <= 0 && tok.maxHp) tok.hp = tok.maxHp;
          reviveRoll = roll("1d100", tok.label, `Iniciativa ${tok.label}`);
        }

        await updateTokens(b.tokens);
        if (reviveRoll) {
          await addInitiativeEntry(tok.id, reviveRoll.total, tok.label);
          await emitRoll(reviveRoll);
          await appendLog(`${tok.label} voltou ao combate (iniciativa ${reviveRoll.total}).`);
        }
        // Morrer (vivo → Morto, via edição): vira corpo e sai da ordem de turnos.
        if (isUnit && !wasDead && nowDead) {
          await appendLog(`${tok.label} foi derrotado.`);
          await dropFromInitiative([tok.id], keep);
        }
        broadcast();
      },
    );

    socket.on("gm:advanceTurn", async ({ dir }: { dir: 1 | -1 }) => {
      if (!isGM) return fail("Apenas o GM controla os turnos.");
      await advanceTurn(dir);
      broadcast();
    });

    // GM concede iniciativa (1d100) a um token que não está na ordem de turnos.
    socket.on("gm:grantInitiative", async ({ tokenId }: { tokenId: string }) => {
      if (!isGM) return fail("Apenas o GM controla os turnos.");
      const b = getGame().battle;
      if (!b) return fail("Sem batalha ativa.");
      const tok = b.tokens.find((t) => t.id === tokenId);
      if (!tok) return fail("Token inexistente.");
      if (tok.kind !== "player" && tok.kind !== "enemy") {
        return fail("Só combatentes entram na iniciativa.");
      }
      if (tok.state === "Morto") return fail("Token morto não entra na iniciativa.");
      if (b.initiative.some((i) => i.tokenId === tokenId)) {
        return fail("Esse token já está na ordem de turnos.");
      }
      const r = roll("1d100", tok.label, `Iniciativa ${tok.label}`);
      const ok = await addInitiativeEntry(tokenId, r.total, tok.label);
      if (ok) {
        await emitRoll(r);
        await appendLog(`${tok.label} entrou no combate (iniciativa ${r.total}).`);
      }
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
        // Caminho contornando tokens não aliados (não atravessa bloqueados).
        if (!canReachCell(tok, pos, b.tokens, b.grid, mv)) {
          return fail("Fora do alcance de movimento.");
        }
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

    // Feedback visual de planejamento (movimento/alvos) — relê para os demais.
    // Cada interação do jogador da vez reinicia o cronômetro do turno (30s).
    socket.on("battle:intent", async (payload: unknown) => {
      socket.broadcast.emit("battle:intent", payload);
      const b = getGame().battle;
      const entry = b?.initiative[b.turnIndex];
      const actor = b?.tokens.find((t) => t.id === entry?.tokenId);
      if (actor && canControl(actor)) {
        await bumpTurnTimer();
        // Propaga o novo prazo a TODOS (evento leve, sem rebroadcast de estado).
        io.emit("battle:timer", { turnEndsAt: getGame().battle?.turnEndsAt ?? 0 });
      }
    });

    socket.on("player:confirmAction", async (action: ConfirmedAction) => {
      const g = getGame();
      const b = g.battle;
      if (!b) return fail("Sem batalha ativa.");
      const actor = b.tokens.find((t) => t.id === action.tokenId);
      if (!actor) return fail("Token inexistente.");
      if (!canControl(actor)) return fail("Você não controla esse token.");
      if (actor.actedThisTurn) return fail("Você já usou sua ação principal neste turno.");

      // Posição de onde a ação é resolvida (encenada pelo cliente); o token NÃO é
      // movido aqui — o movimento é confirmado à parte (e é reversível).
      const actPos = action.fromPos ?? actor.pos;

      let r: Roll | null = null;
      const damages: { tokenId: string; amount: number; pos: { x: number; y: number }; notes?: string[] }[] = [];
      // Cargas de distorção gastas no ataque (+dano), limitadas ao disponível.
      // Corpo a corpo (inclui mãos livres) é liberado; arma de fogo só aceita +1.
      let chargeCap = actor.charges ?? 0;
      if (action.kind === "attack") {
        const w = resolveItem(getItems(), action.detail);
        if (weaponTypeOf(w) === "firearm") chargeCap = Math.min(chargeCap, 1);
      }
      const charges = Math.max(0, Math.min(action.attackCharges ?? 0, chargeCap));
      const distBonus = charges * DISTORTION_DMG_PER_CHARGE;

      // Modificador de ATAQUE do ator por objetos adjacentes, a partir de actPos.
      const atkMod = adjacencyMods({ ...actor, pos: actPos }, b.tokens).attack;

      const damageToken = (target: Token, base: number, extraNotes: string[] = []) => {
        // Objeto destrutível (com HP): dano direto, sem defesa/estado.
        if (target.kind === "object") {
          if ((target.hp ?? 0) <= 0) return null;
          const dmg = Math.max(0, base);
          target.hp = Math.max(0, (target.hp ?? 0) - dmg);
          damages.push({ tokenId: target.id, amount: dmg, pos: { ...target.pos } });
          return dmg;
        }
        if (target.kind !== "enemy" && target.kind !== "player") return null;
        // Defesa do alvo: acessórios equipados (ficha) + objetos adjacentes (Cobertura).
        const gearDf = tokenDf(target);
        const adjDef = adjacencyMods(target, b.tokens).defense;
        const totalDf = gearDf + adjDef;
        // applyDamage subtrai o df antes de aplicar; passamos a defesa total.
        const res = applyDamage(
          target.hp ?? 0,
          target.maxHp ?? 1,
          target.state ?? "Disposto",
          base,
          totalDf,
        );
        const dmg = res.applied; // dano real após defesa e penalidade de estado
        target.hp = res.hp;
        target.state = res.state;
        const notes: string[] = [...extraNotes];
        if (atkMod) notes.push(`ATK ${atkMod > 0 ? "+" : ""}${atkMod}`);
        if (totalDf) notes.push(`DEF ${totalDf}`);
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
        const weaponId = action.detail;
        const weapon = resolveItem(getItems(), weaponId);
        // Munição: se a arma tem capacidade, precisa de munição carregada.
        if (weapon?.maxAmmo && weaponId) {
          const left = actor.ammo?.[weaponId] ?? 0;
          if (left <= 0) {
            return fail(`${weapon.name} sem munição — recarregue com um item de munição.`);
          }
        }
        const target = b.tokens.find((t) => t.id === action.targetId);
        // Valida a banda de alcance da arma (a partir de actPos).
        if (target && !inBand(manhattanT(actPos, target.pos), weaponBand(weapon))) {
          return fail("Alvo fora do alcance da arma.");
        }
        const formula = resolveWeaponFormula(actor, action.detail);
        r = roll(formula, actor.label, "Ataque");
        if (target && canTarget(actor, target)) {
          // consome 1 de munição
          if (weapon?.maxAmmo && weaponId) {
            actor.ammo = { ...(actor.ammo ?? {}), [weaponId]: (actor.ammo?.[weaponId] ?? 0) - 1 };
          }
          const prof = professionDamageBonus(actor, weapon);
          // Flanqueamento: +3 se houver aliado do atacante atrás do alvo.
          const flanked = isFlanked({ ...actor, pos: actPos }, target, b.tokens);
          const flankBonus = flanked ? FLANK_BONUS : 0;
          // Penalidade de estado do atacante: incide SÓ no dano dos dados (mín. 0);
          // o dano fixo da arma (r.flat) é preservado.
          const dieAfter = dieDamageAfterState(r.total - r.flat, actor.state ?? "Disposto");
          const statePenalty = r.total - r.flat - dieAfter;
          const base = Math.max(0, dieAfter + r.flat + distBonus + atkMod + prof.bonus + flankBonus);
          const area = weapon?.area ?? 0;
          const affected = area
            ? b.tokens.filter(
                (t) =>
                  t.id !== actor.id &&
                  canTarget(actor, t) &&
                  manhattanT(target.pos, t.pos) <= area,
              )
            : [target];
          // Penalidade de estado afeta todos os atingidos; flanqueamento só o alvo.
          const stateNote = statePenalty > 0 ? [`ESTADO -${statePenalty}`] : [];
          for (const t of affected) {
            const notes = [...stateNote];
            if (t.id === target.id && flanked) notes.push(`FLANCO +${FLANK_BONUS}`);
            damageToken(t, base, notes);
          }
          await appendLog(
            `${actor.label} atacou ${target.label}: ${base} de dano base` +
              (area ? ` (área ${area}, ${affected.length} alvos)` : "") +
              (atkMod ? ` [ataque ${atkMod > 0 ? "+" : ""}${atkMod}]` : "") +
              (flanked ? ` [flanqueado +${FLANK_BONUS}]` : "") +
              (statePenalty ? ` [estado -${statePenalty}]` : "") +
              (prof.note ? ` [${prof.note}]` : ""),
          );
        }
      } else if (action.kind === "special" && action.objectId) {
        // Ação especial usando um objeto adjacente.
        const objTok = b.tokens.find((t) => t.id === action.objectId && t.kind === "object");
        const rule = objTok ? ruleOf(objTok) : null;
        const adjacent = !!objTok && manhattanT(actPos, objTok.pos) <= 1;
        // Verifica usos restantes do objeto (cargas).
        const usesOk = !objTok || objTok.usesLeft === undefined || objTok.usesLeft > 0;
        let used = false;

        if (objTok && rule && adjacent && usesOk) {
          if (rule.kind === "action" && rule.damage) {
            const target = b.tokens.find((t) => t.id === action.targetId);
            if (target) {
              r = roll(rule.damage, actor.label, objTok.label);
              // Penalidade de estado do atacante só nos dados (preserva o fixo).
              const dieAfter = dieDamageAfterState(r.total - r.flat, actor.state ?? "Disposto");
              const base = Math.max(0, dieAfter + r.flat + distBonus + atkMod);
              const dmg = damageToken(target, base);
              await appendLog(`${actor.label} usou ${objTok.label} em ${target.label}: ${dmg} de dano`);
              used = true;
            }
          } else if (rule.kind === "reload" && action.reloadWeaponId) {
            const w = getItems().find((i) => i.id === action.reloadWeaponId);
            const amount = objTok.reloadAmount ?? 2;
            const cap = w?.maxAmmo ?? 0;
            const cur = actor.ammo?.[action.reloadWeaponId] ?? 0;
            const next = cap ? Math.min(cap, cur + amount) : cur + amount;
            actor.ammo = { ...(actor.ammo ?? {}), [action.reloadWeaponId]: next };
            await appendLog(`${actor.label} recarregou ${w?.name ?? "arma"} em ${objTok.label} (+${next - cur}).`);
            used = true;
          } else if (rule.kind === "chest") {
            const ch = actor.characterId
              ? getCharacters().find((c) => c.id === actor.characterId)
              : null;
            if (ch && objTok.grant?.length) {
              let items = ch.items;
              for (const g of objTok.grant) items = adjustItem(items, g.id, g.qty);
              await upsert("characters", { ...ch, items });
              const names = objTok.grant
                .map((g) => `${getItems().find((i) => i.id === g.id)?.name ?? g.id} ×${g.qty}`)
                .join(", ");
              await appendLog(`${actor.label} abriu ${objTok.label}: recebeu ${names}.`);
              used = true;
            }
          }
        }

        // Consome um uso; remove o objeto se zerou ou é de uso único.
        if (used && objTok) {
          if (objTok.usesLeft !== undefined) objTok.usesLeft -= 1;
          if (objTok.destroyOnUse || (objTok.usesLeft !== undefined && objTok.usesLeft <= 0)) {
            consumed.push(objTok.id);
            await appendLog(`${objTok.label} foi consumido.`);
          }
        }
      } else if (action.kind === "useItem" && action.useItemId) {
        // Usar consumível: cura restaura HP do token; munição recarrega uma arma.
        const item = getItems().find((i) => i.id === action.useItemId);
        const ch = actor.characterId
          ? getCharacters().find((c) => c.id === actor.characterId)
          : null;
        const have = ch ? itemQty(ch.items, action.useItemId) : 0;
        if (item && ch && have > 0) {
          if (item.heal) {
            const before = actor.hp ?? 0;
            actor.hp = Math.min(actor.maxHp ?? before, before + item.heal);
            let note = `+${actor.hp - before} HP`;
            // Cura também pode melhorar o estado (ex.: Kit Médico).
            if (item.improveState && actor.state) {
              const improved = improveState(actor.state, item.improveState);
              if (improved !== actor.state) {
                actor.state = improved;
                note += ` → ${improved}`;
              }
            }
            await appendLog(`${actor.label} usou ${item.name}: ${note}.`);
          } else if (item.ammo && action.reloadWeaponId) {
            const w = getItems().find((i) => i.id === action.reloadWeaponId);
            const cap = w?.maxAmmo ?? 0;
            const cur = actor.ammo?.[action.reloadWeaponId] ?? 0;
            const next = cap ? Math.min(cap, cur + item.ammo) : cur + item.ammo;
            actor.ammo = { ...(actor.ammo ?? {}), [action.reloadWeaponId]: next };
            await appendLog(`${actor.label} recarregou ${w?.name ?? "arma"} (+${next - cur}).`);
          }
          // consome 1 do inventário da ficha
          await upsert("characters", { ...ch, items: adjustItem(ch.items, action.useItemId, -1) });
        }
      }

      // Unidades mortas viram "corpos": continuam no mapa (ocupando a casa) mas
      // saem da ordem de iniciativa. Objetos destruídos somem de vez.
      const deadUnits = b.tokens
        .filter((t) => (t.kind === "enemy" || t.kind === "player") && t.state === "Morto")
        .map((t) => t.id);
      const deadObjects = b.tokens
        .filter((t) => t.kind === "object" && t.hp !== undefined && t.hp <= 0)
        .map((t) => t.id);
      for (const id of [...deadUnits, ...deadObjects]) {
        const t = b.tokens.find((x) => x.id === id);
        if (t) await appendLog(`${t.label} foi derrotado.`);
      }

      // Cargas gastas no ataque: consome do ator e sobe a distorção do cenário.
      if (charges > 0) {
        actor.charges = (actor.charges ?? 0) - charges;
        g.distortion = clampDistortion(g.distortion + charges);
        await appendLog(`${actor.label} gastou ${charges} carga(s) de distorção (+${distBonus} dano).`);
      }

      // Marca a ação principal como usada (não pode repetir; o ataque é final).
      actor.actedThisTurn = true;

      await updateTokens(b.tokens);
      if (r) {
        action.rollId = r.id;
        await emitRoll(r);
      }
      await saveGame(g);
      if (damages.length > 0) io.emit("battle:damage", { events: damages });
      io.emit("action:confirmed", action);
      // Objetos consumidos/destruídos somem; mortos só saem da iniciativa.
      await removeTokens([...deadObjects, ...consumed], actor.id);
      await dropFromInitiative(deadUnits, actor.id);

      // Movimento + encerramento do turno ATÔMICOS (no mesmo evento da ação), para
      // não correr com player:moveToken/player:endTurn. O advanceTurn roda por
      // último → o turno avança de fato (não "volta" ao ator).
      if (action.endTurn) {
        const p = action.commitPos;
        if (p) {
          const occupied = b.tokens.some(
            (t) => t.id !== actor.id && t.pos.x === p.x && t.pos.y === p.y,
          );
          const spend = Math.max(0, Math.min(action.moveCharges ?? 0, actor.charges ?? 0));
          const mv = baseMv(actor) + spend;
          if (!occupied && canReachCell(actor, p, b.tokens, b.grid, mv)) {
            actor.pos = p;
            if (spend > 0) {
              actor.charges = (actor.charges ?? 0) - spend;
              g.distortion = clampDistortion(g.distortion + spend);
            }
            await updateTokens(b.tokens);
          }
        }
        await appendLog(`${actor.label} encerrou o turno.`);
        await advanceTurn(1);
      }
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

    // Resultado já rolado no cliente (dados 3D do scenarioBox): o valor exibido no
    // dado É o resultado. O servidor só registra e transmite a todos.
    socket.on(
      "dice:result",
      async ({
        formula,
        total,
        results,
        reason,
      }: {
        formula: string;
        total: number;
        results: number[];
        reason?: string;
      }) => {
        const vals = Array.isArray(results) ? results.map((n) => Number(n) || 0) : [];
        const r: Roll = {
          id: `roll_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          formula: String(formula ?? ""),
          flat: 0,
          results: vals,
          total: Number(total) || vals.reduce((a, b) => a + b, 0),
          author: user.email,
          reason: reason || "Rolagem",
          at: Date.now(),
        };
        await emitRoll(r);
      },
    );

    // --- Imagens sob demanda (fora do estado, para não inflar o broadcast) ---
    socket.on(
      "asset:get",
      ({ kind, id }: { kind: "scenarios" | "characters" | "npcs"; id: string }) => {
        if (kind !== "scenarios" && kind !== "characters" && kind !== "npcs") return;
        const a = getAsset(kind, id);
        if (a) socket.emit("asset:data", { key: `${kind}:${id}:${a.ver}`, data: a.data });
      },
    );

    // --- Música compartilhada ---

    // Qualquer cliente pede o áudio (data URL) de uma faixa sob demanda.
    socket.on("music:track", ({ trackId }: { trackId: string }) => {
      const t = getMusic().find((m) => m.id === trackId);
      if (t) socket.emit("music:data", { id: t.id, src: t.src });
    });

    socket.on("gm:music:play", async ({ trackId }: { trackId: string }) => {
      if (!isGM) return fail("Apenas o GM controla a música.");
      await playTrack(trackId);
      broadcast();
    });

    socket.on("gm:music:loop", async ({ loop }: { loop: boolean }) => {
      if (!isGM) return fail("Apenas o GM controla a música.");
      await setMusicLoop(loop);
      broadcast();
    });

    socket.on("gm:music:stop", async () => {
      if (!isGM) return fail("Apenas o GM controla a música.");
      await stopMusic();
      broadcast();
    });

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
        // Remover a faixa que está tocando agora também para a música.
        if (kind === "music" && getGame().nowPlaying?.trackId === id) {
          await stopMusic();
        }
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

    // Usar consumível FORA de combate (só cura faz efeito; consome do inventário).
    socket.on("item:use", async ({ characterId, itemId }: { characterId: string; itemId: string }) => {
      const ch = getCharacters().find((c) => c.id === characterId);
      if (!ch) return fail("Ficha não encontrada.");
      if (!isGM && ch.userId !== user.id) return fail("Não é a sua ficha.");
      if (getGame().mode === "battle") return fail("Use itens pelo painel de batalha.");
      const item = getItems().find((i) => i.id === itemId);
      if (!item || itemQty(ch.items, itemId) <= 0) return fail("Item indisponível.");
      let hp = ch.hp;
      let st = ch.state;
      if (item.heal) hp = Math.min(ch.maxHp, ch.hp + item.heal);
      if (item.improveState) st = improveState(ch.state, item.improveState);
      await upsert("characters", { ...ch, hp, state: st, items: adjustItem(ch.items, itemId, -1) });
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
  | "battleTemplates"
  | "music";
type AnyEntity =
  | Scenario
  | Profession
  | CatalogItem
  | Hack
  | Disguise
  | Npc
  | GameObject
  | BattleTemplate
  | MusicTrack;

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
  let raw = 2;
  if (token.characterId) {
    const ch = getCharacters().find((c) => c.id === token.characterId);
    if (ch) raw = ch.mv;
  }
  // Penalidade de movimento por estado (intercalada com a de dano).
  return Math.max(0, raw - stateMovePenalty(token.state ?? "Disposto"));
}

/** Defesa do token: vinda dos acessórios equipados na ficha do jogador. */
function tokenDf(token: Token): number {
  if (token.characterId) {
    const ch = getCharacters().find((c) => c.id === token.characterId);
    if (ch) return Math.max(0, ch.df);
  }
  return 0;
}

/**
 * Bônus de dano das profissões de COMBATE do atacante, conforme o TIPO da arma
 * (o +dano só conta se casar com corpo a corpo / arma de fogo). Retorna { bonus, note }.
 */
function professionDamageBonus(
  actor: Token,
  weapon: ReturnType<typeof getItems>[number] | null,
): { bonus: number; note?: string } {
  if (!actor.characterId) return { bonus: 0 };
  const ch = getCharacters().find((c) => c.id === actor.characterId);
  if (!ch) return { bonus: 0 };
  const bonus = professionDamageFor(ch.roles, getProfessions(), weaponTypeOf(weapon));
  return bonus ? { bonus, note: `profissão +${bonus}` } : { bonus: 0 };
}

function resolveWeaponFormula(actor: Token, detail?: string): string {
  // detail pode ser o id de um item/arma (inclui Mãos Livres embutido).
  if (detail) {
    const item = resolveItem(getItems(), detail);
    if (item?.damage) return item.damage;
  }
  // Inimigo do catálogo: usa a primeira arma cadastrada (ou dano legado).
  if (actor.kind === "enemy" && actor.npcId) {
    const npc = getNpcs().find((n) => n.id === actor.npcId);
    const firstWeaponId = npc?.weapons?.[0];
    if (firstWeaponId) {
      const w = resolveItem(getItems(), firstWeaponId);
      if (w?.damage) return w.damage;
    }
    if (npc?.damage) return npc.damage;
  }
  // Sem arma (mãos livres) → dano embutido fixo.
  return FREE_HANDS.damage ?? "1d4+2";
}

