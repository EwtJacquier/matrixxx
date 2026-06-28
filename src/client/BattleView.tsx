"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame, type DamagePopup } from "./GameProvider";
import { STATES, type ActionKind, type Token } from "@/game/types";
import { adjacencyMods, isActionRule, objectBadge, ruleOf } from "@/game/objects";
import { FREE_HANDS, FREE_HANDS_ID, bandLabel, inBand, resolveItem, weaponBand } from "@/game/weapons";
import { canTarget } from "@/game/faction";
import { isFlanked } from "@/game/flank";
import { reachableCells } from "@/game/path";
import { DISTORTION_DMG_PER_CHARGE, stateMovePenalty } from "@/game/rules";
import { playSfx } from "./sfx";
import styles from "./BattleView.module.css";

/** Distância em casas: diagonal não é adjacente (custa +1). */
function manhattan(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type Phase = "move" | "action";

export function BattleView() {
  const { state, session, emit, damagePopups, battleIntent, turnEndsAt } = useGame();
  const battle = state?.game.battle ?? null;
  const isGM = session?.role === "gm";

  // Tick de 1s para o contador regressivo do turno.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const currentActor = useMemo<Token | null>(() => {
    if (!battle || battle.initiative.length === 0) return null;
    const entry = battle.initiative[battle.turnIndex];
    return battle.tokens.find((t) => t.id === entry?.tokenId) ?? null;
  }, [battle]);

  const myCharIds = useMemo(
    () => new Set(state?.characters.filter((c) => c.userId === session?.id).map((c) => c.id)),
    [state, session],
  );

  // Jogador controla só o próprio token; GM controla só inimigos/monstros.
  const controlsActor =
    !!currentActor &&
    (currentActor.kind === "player"
      ? myCharIds.has(currentActor.characterId ?? "")
      : currentActor.kind === "enemy"
        ? isGM
        : false);

  // Planejamento compartilhado: para quem NÃO controla, espelha o intent recebido.
  const intentForActor =
    battleIntent && currentActor && battleIntent.actorId === currentActor.id
      ? battleIntent
      : null;
  const showHighlights = controlsActor || !!intentForActor;

  // Fluxo do turno: primeiro mover (e confirmar), depois atacar.
  const [phase, setPhase] = useState<Phase>("move");
  const [stagedPos, setStagedPos] = useState<{ x: number; y: number } | null>(null);
  const [actionKind, setActionKind] = useState<ActionKind>("attack");
  const [targetId, setTargetId] = useState<string>("");
  const [weaponId, setWeaponId] = useState<string>("");
  const [actionObjectId, setActionObjectId] = useState<string>("");
  const [moveCharges, setMoveCharges] = useState(0); // cargas gastas no movimento
  const [attackCharges, setAttackCharges] = useState(0); // cargas gastas no ataque
  const [useItemId, setUseItemId] = useState<string>(""); // consumível escolhido
  const [reloadWeaponId, setReloadWeaponId] = useState<string>(""); // arma a recarregar
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"objects" | "log">("objects");
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // O que mostrar em cima dos cubos no tabuleiro isométrico.
  // Menu de comando estilo FFT Tactics + navegação por controle/teclado.
  type Nav =
    | "root"
    | "move"
    | "act"
    | "weapon"
    | "items"
    | "reload"
    | "object"
    | "target"
    | "inspect"
    | "confirmAttack"
    | "confirmEndTurn"
    | "confirmEndBattle"
    | "confirmAddEnemy"
    | "confirmRemoveEnemy";
  const [nav, setNav] = useState<Nav>("root");
  // GM: NPC selecionado para adicionar no inspecionar (casa vazia).
  const [addNpcId, setAddNpcId] = useState<string>("");
  const [menuIndex, setMenuIndex] = useState(0);
  // Evita encerrar o turno duas vezes (vários caminhos podem chamar endTurn).
  const endedRef = useRef(false);
  // Câmera do tabuleiro: zoom (1..1.5) e pan (px, 0 = centralizado).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;
  const clampZoom = (z: number) => Math.max(1, Math.min(1.5, z));

  // Recomeça o fluxo quando muda o ator/turno.
  useEffect(() => {
    setPhase("move");
    setStagedPos(null);
    setActionKind("attack");
    setTargetId("");
    // weaponId NÃO é resetado: mantém a arma escolhida para a próxima ação.
    setActionObjectId("");
    setUseItemId("");
    setReloadWeaponId("");
    setMoveCharges(0);
    setAttackCharges(0);
    setNav("root");
    setMenuIndex(0);
    endedRef.current = false;
    // Ao iniciar/trocar o turno, reseta o inspetor.
    setInspectId(null);
    setCursor(currentActor?.pos ?? { x: 0, y: 0 });
    // Dispara só em transição real de turno (turnSeq), não quando turnIndex muda
    // por morte/remoção de um token no meio do turno do ator atual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.turnSeq]);

  // nav controla a fase: ações/alvo = "action"; menu raiz/mover = "move".
  // Também zera o índice do menu ao trocar de tela.
  useEffect(() => {
    const actionNav =
      nav === "act" ||
      nav === "weapon" ||
      nav === "items" ||
      nav === "reload" ||
      nav === "object" ||
      nav === "target" ||
      nav === "confirmAttack";
    setPhase(actionNav ? "action" : "move");
    setMenuIndex(0);
  }, [nav]);

  // Após usar a ação principal, volta ao menu (só falta o movimento, opcional).
  const acted = !!currentActor?.actedThisTurn;
  useEffect(() => {
    if (acted) setNav("root");
  }, [acted]);

  if (!battle || !state) return null;

  const grid = battle.grid;
  // Prazo do turno: o maior entre o estado e o evento leve de reset (battle:timer).
  const endsAt = Math.max(battle.turnEndsAt ?? 0, turnEndsAt);
  const actorPos = currentActor?.pos ?? { x: 0, y: 0 };

  const baseMv = (() => {
    const raw = currentActor?.characterId
      ? state.characters.find((c) => c.id === currentActor.characterId)?.mv ?? 2
      : 2;
    // Penalidade de movimento por estado (intercalada com a de dano).
    return Math.max(0, raw - stateMovePenalty(currentActor?.state ?? "Disposto"));
  })();
  const availableCharges = currentActor?.charges ?? 0;

  // Valores "efetivos": locais para quem controla; espelham o intent para os demais.
  const effStaged = controlsActor ? stagedPos : intentForActor?.staged ?? null;
  const effMode = controlsActor ? nav : intentForActor?.mode ?? "root";
  const effMoveCharges = controlsActor ? moveCharges : intentForActor?.moveCharges ?? 0;
  const effAttackCharges = controlsActor ? attackCharges : intentForActor?.attackCharges ?? 0;
  const effActionMode =
    effMode === "act" ||
    effMode === "weapon" ||
    effMode === "items" ||
    effMode === "reload" ||
    effMode === "object" ||
    effMode === "target" ||
    effMode === "confirmAttack";

  // Movimento efetivo = base + cargas de distorção alocadas ao movimento.
  const actorMv = baseMv + effMoveCharges;

  const actorChar = currentActor?.characterId
    ? state.characters.find((c) => c.id === currentActor.characterId)
    : null;

  const myWeapons = (() => {
    if (!currentActor) return [];
    // Jogador: armas da ficha. Inimigo: armas do NPC do catálogo.
    let ids: string[] = [];
    if (actorChar) {
      ids = actorChar.items.map((s) => s.id);
    } else if (currentActor.npcId) {
      const npc = state.npcs.find((n) => n.id === currentActor.npcId);
      ids = npc?.weapons ?? [];
    }
    // Mãos Livres é a opção padrão (valor vazio); não repetir na lista.
    const uniq = Array.from(new Set(ids));
    return state.items.filter(
      (i) => i.category === "weapon" && i.id !== FREE_HANDS_ID && uniq.includes(i.id),
    );
  })();

  // Consumíveis do ator (cura/munição) com quantidade.
  const myConsumables = (actorChar?.items ?? [])
    .map((s) => ({ item: state.items.find((i) => i.id === s.id), qty: s.qty }))
    .filter(
      (c): c is { item: NonNullable<typeof c.item>; qty: number } =>
        !!c.item && c.item.category === "item" && (!!c.item.heal || !!c.item.ammo),
    );

  // A arma persiste entre turnos; se o ator atual não a possui, cai em mãos livres.
  const effectiveWeaponId = myWeapons.some((w) => w.id === weaponId) ? weaponId : "";
  const selectedWeapon = state.items.find((i) => i.id === effectiveWeaponId) ?? null;
  const weaponRangeBand = weaponBand(selectedWeapon);
  // Distorção no ATAQUE: armas aceitam só +1 carga; Mãos Livres (id vazio) é liberado.
  const attackChargeMax = effectiveWeaponId ? 1 : availableCharges;
  // Distorção de ataque só fica disponível APÓS escolher a arma (alvo/confirmação),
  // não durante a seleção de arma.
  const inAttackFlow = nav === "target" || nav === "confirmAttack";

  // Posição "de onde o ator vai agir": a casa encenada (staging local) ou a real.
  // O movimento NÃO é enviado ao servidor até confirmar a ação/encerrar o turno,
  // então mover e agir são independentes e dá para voltar atrás na movimentação.
  const fromPos = effStaged ?? actorPos;

  // Objetos em campo e os adjacentes ao ator (a partir de fromPos).
  const objectsOnBoard = battle.tokens.filter((t) => t.kind === "object");
  const adjObjects = objectsOnBoard.filter((o) => manhattan(fromPos, o.pos) <= 1);
  // Modificador de ATAQUE que o ator recebe por adjacência a objetos.
  const adjMod = adjacencyMods({ ...currentActor!, pos: fromPos }, battle.tokens).attack;
  // Objetos com ação especial adjacentes ao ator (ex.: chutar a mesa).
  // Objetos acionáveis (chute/recarga/baú) adjacentes, com usos restantes.
  const adjActionObjects = adjObjects.filter(
    (o) => isActionRule(ruleOf(o)?.kind) && (o.usesLeft === undefined || o.usesLeft > 0),
  );
  const hasActionObject = adjActionObjects.length > 0;
  const actionObject = adjActionObjects.find((o) => o.id === actionObjectId) ?? null;
  const actionObjectRule = actionObject ? ruleOf(actionObject) : null;

  // Casas alcançáveis no passo de movimento (BFS). Visível a TODOS quando o ator
  // está planejando o movimento (controlador local ou intent compartilhado).
  const movePlanning = showHighlights && !effActionMode && effMode !== "inspect";
  const reachableSet =
    movePlanning && currentActor
      ? reachableCells(currentActor, battle.tokens, grid, actorMv)
      : null;
  const reachable = (x: number, y: number) =>
    !!reachableSet &&
    (reachableSet.has(`${x},${y}`) ||
      (!!currentActor && actorPos.x === x && actorPos.y === y));

  // Alvos no passo de ação — NUNCA objetos, apenas jogadores/inimigos.
  // Só a ação de objeto que causa dano (chute) precisa de alvo.
  const isObjectAction = actionKind === "special" && !!actionObject;
  const objectNeedsTarget = actionObjectRule?.kind === "action";
  const targets =
    phase !== "action" || !controlsActor || !currentActor
      ? []
      : isObjectAction
        ? // Objeto: só o chute (action) precisa de alvo, em linha reta.
          objectNeedsTarget && actionObject
          ? battle.tokens.filter(
              (t) =>
                t.id !== currentActor.id &&
                canTarget(currentActor, t) &&
                (t.pos.x === actionObject.pos.x || t.pos.y === actionObject.pos.y),
            )
          : []
        : actionKind === "attack"
          ? // Ataque: alvos inimigos (facção diferente) dentro da banda de alcance.
            battle.tokens.filter(
              (t) =>
                t.id !== currentActor.id &&
                canTarget(currentActor, t) &&
                inBand(manhattan(fromPos, t.pos), weaponRangeBand),
            )
          : [];

  // Se o alvo escolhido sumiu da lista (ou não há), assume o primeiro automaticamente.
  const effectiveTargetId = targets.some((t) => t.id === targetId)
    ? targetId
    : targets[0]?.id ?? "";

  // Tokens que o ator pode mirar (inimigos/objetos com HP) a partir de fromPos.
  const targetable =
    currentActor
      ? battle.tokens.filter((t) => t.id !== currentActor.id && canTarget(currentActor, t))
      : [];
  const weaponById = (id: string) => state.items.find((i) => i.id === id) ?? null;
  // Alvos de uma arma específica (dentro da banda).
  const weaponTargets = (w: typeof myWeapons[number] | null) => {
    const band = weaponBand(w);
    return targetable.filter((t) => inBand(manhattan(fromPos, t.pos), band));
  };
  // Opções de arma que TÊM ao menos um alvo (mãos livres + armas em posse).
  const weaponOptions: { id: string; weapon: typeof myWeapons[number] | null }[] = [
    { id: "", weapon: null },
    ...myWeapons
      .filter((w) => !(w.maxAmmo && (currentActor?.ammo?.[w.id] ?? 0) <= 0))
      .map((w) => ({ id: w.id, weapon: w })),
  ].filter((o) => weaponTargets(o.weapon).length > 0);
  const canAttack = weaponOptions.length > 0;

  // Guia de movimentação: alvos atingíveis por QUALQUER arma (banda) a partir de fromPos.
  // Armas sem munição não marcam alvo (são inúteis até recarregar). Mãos livres sempre.
  const usableWeapons = myWeapons.filter(
    (w) => !w.maxAmmo || (currentActor?.ammo?.[w.id] ?? 0) > 0,
  );
  const myBands = [weaponBand(null), ...usableWeapons.map((w) => weaponBand(w))];
  const moveGuideTargetIds =
    movePlanning && currentActor
      ? new Set(
          battle.tokens
            .filter((t) => {
              if (t.id === currentActor.id || !canTarget(currentActor, t)) return false;
              const d = manhattan(fromPos, t.pos);
              return myBands.some((b) => inBand(d, b));
            })
            .map((t) => t.id),
        )
      : new Set<string>();

  // Arma/alvo efetivos (controlador: ao vivo; demais: do intent).
  const effWeaponId = controlsActor
    ? effMode === "weapon"
      ? weaponOptions[menuIndex]?.id ?? ""
      : effectiveWeaponId
    : intentForActor?.weaponId ?? "";
  const effTargetId = controlsActor ? effectiveTargetId : intentForActor?.targetId ?? "";

  // Alvos destacados no grid (visível a todos): prévia da arma (weapon) ou alvo (target).
  const highlightTargetIds = !showHighlights
    ? new Set<string>()
    : effMode === "weapon"
      ? new Set(weaponTargets(weaponById(effWeaponId)).map((t) => t.id))
      : (effMode === "target" || effMode === "confirmAttack") && effTargetId
        ? new Set([effTargetId])
        : new Set<string>();

  // Posição de exibição: o ator aparece na casa encenada para TODOS durante o
  // planejamento (controlador local ou intent compartilhado).
  const displayPos = (t: Token) =>
    effStaged && t.id === currentActor?.id ? effStaged : t.pos;

  const tokenAt = (x: number, y: number) =>
    battle.tokens.find((t) => {
      const p = displayPos(t);
      return p.x === x && p.y === y;
    });

  // Flanqueamento (visível a TODOS): a partir da posição encenada do ator atual,
  // quais alvos atingíveis por uma arma usável estão flanqueados (aliado atrás).
  // Aparece imediatamente ao mover, mesmo durante o planejamento.
  const flankedIds = (() => {
    if (!currentActor) return new Set<string>();
    const aPos = displayPos(currentActor);
    const attacker = { ...currentActor, pos: aPos } as Token;
    return new Set(
      battle.tokens
        .filter((t) => {
          if (t.id === currentActor.id || !canTarget(currentActor, t)) return false;
          const d = manhattan(aPos, t.pos);
          if (!myBands.some((b) => inBand(d, b))) return false; // precisa de arma válida
          return isFlanked(attacker, { ...t, pos: t.pos }, battle.tokens);
        })
        .map((t) => t.id),
    );
  })();

  const inspected = inspectId ? battle.tokens.find((t) => t.id === inspectId) ?? null : null;
  // Inspetor: no modo inspecionar segue o cursor; ao mirar, mostra o alvo;
  // senão o token clicado, ou o ator do turno atual.
  const inspectShown =
    nav === "inspect"
      ? battle.tokens.find((t) => t.pos.x === cursor.x && t.pos.y === cursor.y) ?? null
      : nav === "target" || nav === "confirmAttack"
        ? battle.tokens.find((t) => t.id === effectiveTargetId) ?? inspected ?? currentActor
        : inspected ?? currentActor;

  function clickCell(x: number, y: number) {
    if (phase !== "move" || !controlsActor) return;
    if (!(reachable(x, y) || (x === actorPos.x && y === actorPos.y))) return;
    const cur = stagedPos ?? actorPos;
    if (x === cur.x && y === cur.y) return;
    setStagedPos({ x, y });
    playSfx("move");
  }

  // Envia o movimento ao servidor (commit) se o ator saiu do lugar.
  function commitMove(posOverride?: { x: number; y: number }) {
    if (!currentActor) return;
    const pos = posOverride ?? stagedPos;
    if (pos && (pos.x !== actorPos.x || pos.y !== actorPos.y)) {
      emit("player:moveToken", { tokenId: currentActor.id, pos, moveCharges });
    }
  }

  function endTurn(posOverride?: { x: number; y: number }) {
    if (endedRef.current) return;
    endedRef.current = true;
    commitMove(posOverride);
    emit("player:endTurn");
  }

  // Sair do passo de movimento: se o ator JÁ AGIU e se afastou da casa inicial,
  // o movimento pós-ação é único e encerra o turno (só dá pra movimentar a partir
  // da casa onde o turno começou). Senão, volta ao menu.
  function exitMove() {
    if (acted && hasMoved) endTurn();
    else setNav("root");
  }

  // Passo 1 → Passo 2 (não envia o movimento ainda; só vai no commit da ação).
  function confirmMove() {
    if (!currentActor || !state) return;
    const dest = fromPos;

    const enemiesAndAllies = battle!.tokens.filter(
      (t) => t.id !== currentActor.id && (t.kind === "enemy" || t.kind === "player"),
    );
    // Objetos acionáveis adjacentes ao destino (com usos restantes).
    const adjAction = battle!.tokens.filter(
      (o) =>
        isActionRule(ruleOf(o)?.kind) &&
        manhattan(dest, o.pos) <= 1 &&
        (o.usesLeft === undefined || o.usesLeft > 0),
    );
    const usableAction = adjAction.find((o) => {
      const k = ruleOf(o)?.kind;
      if (k === "action") {
        return enemiesAndAllies.some((t) => t.pos.x === o.pos.x || t.pos.y === o.pos.y);
      }
      return true; // reload/chest
    });

    if (usableAction) {
      setActionKind("special");
      setActionObjectId(usableAction.id);
    } else {
      setActionKind("attack");
    }
    setPhase("action");
  }

  // O ator já se movimentou (há um destino encenado diferente da casa atual)?
  const hasMoved = !!stagedPos && (stagedPos.x !== actorPos.x || stagedPos.y !== actorPos.y);

  function confirmAction() {
    if (!currentActor) return;
    // A ação resolve a partir da casa encenada (fromPos) SEM mover o token; o
    // movimento é confirmado à parte (e continua reversível até encerrar o turno).
    emit("player:confirmAction", {
      tokenId: currentActor.id,
      kind: actionKind,
      fromPos,
      targetId: effectiveTargetId || undefined,
      detail: actionKind === "attack" ? effectiveWeaponId || undefined : undefined,
      objectId: isObjectAction ? actionObjectId : undefined,
      useItemId: actionKind === "useItem" ? useItemId || undefined : undefined,
      // recarga: tanto via item de munição (useItem) quanto via objeto de recarga (special)
      reloadWeaponId: reloadWeaponId || undefined,
      attackCharges,
    });
    // Só encerra automático se o ator REALMENTE saiu da casa inicial (posição
    // encenada != posição de início). Se voltou para a casa de origem, hasMoved é
    // falso e ele pode continuar se movimentando após atacar.
    if (hasMoved) endTurn();
  }

  // --- Menu de comando estilo FFT (árvore navegável) ---
  type MenuItem = { key: string; label: string; meta?: string; disabled?: boolean; run: () => void };
  const goTarget = () => {
    setMenuIndex(0);
    setNav("target");
  };
  const backItem = (run: () => void): MenuItem => ({ key: "__back", label: "◀ Voltar", run });
  // "Agir" só fica disponível se houver ataque, item ou ação especial.
  const canAct = canAttack || myConsumables.length > 0 || adjActionObjects.length > 0;

  function buildMenu(): { title: string; note?: string; items: MenuItem[]; back?: () => void } {
    switch (nav) {
      case "act": {
        const back = () => setNav("root");
        return {
          title: "Agir",
          back,
          items: [
            { key: "attack", label: "Atacar", disabled: !canAttack, run: () => { setActionKind("attack"); setMenuIndex(0); setNav("weapon"); } },
            { key: "item", label: "Usar item", disabled: myConsumables.length === 0, run: () => { setActionKind("useItem"); setMenuIndex(0); setNav("items"); } },
            ...(adjActionObjects.length
              ? [{ key: "special", label: "Ação especial", run: () => { setActionKind("special"); setMenuIndex(0); setNav("object"); } }]
              : []),
            backItem(back),
          ],
        };
      }
      case "weapon": {
        const back = () => setNav("act");
        return {
          title: "Arma",
          back,
          items: [
            ...weaponOptions.map((o) => {
              const w = o.weapon;
              const ammoLeft = w?.maxAmmo ? currentActor!.ammo?.[w.id] ?? 0 : null;
              return {
                key: o.id || "maos",
                label: w ? w.name : FREE_HANDS.name,
                meta: w
                  ? `${w.damage} · alc ${bandLabel(weaponBand(w))}${w.area ? ` · área ${w.area}` : ""}${ammoLeft !== null ? ` · ⦿${ammoLeft}/${w.maxAmmo}` : ""}`
                  : `${FREE_HANDS.damage} · alc ${bandLabel(weaponBand(FREE_HANDS))}`,
                run: () => {
                  setWeaponId(o.id);
                  setTargetId("");
                  // Arma limita a distorção de ataque a 1; mãos livres não.
                  setAttackCharges((c) => Math.min(c, o.id ? 1 : availableCharges));
                  goTarget();
                },
              };
            }),
            backItem(back),
          ],
        };
      }
      case "items": {
        const back = () => setNav("act");
        return {
          title: "Itens",
          back,
          items: [
            ...myConsumables.map(({ item, qty }) => ({
              key: item.id,
              label: `${item.name} ×${qty}`,
              meta: item.heal ? `cura +${item.heal}` : item.ammo ? `munição +${item.ammo}` : "",
              run: () => { setUseItemId(item.id); if (item.ammo) { setMenuIndex(0); setNav("reload"); } else confirmAction(); },
            })),
            backItem(back),
          ],
        };
      }
      case "reload": {
        const back = () => setNav(actionKind === "special" ? "object" : "items");
        return {
          title: "Recarregar",
          back,
          items: [
            ...myWeapons.filter((w) => w.maxAmmo).map((w) => ({
              key: w.id,
              label: w.name,
              meta: `⦿${currentActor!.ammo?.[w.id] ?? 0}/${w.maxAmmo}`,
              run: () => { setReloadWeaponId(w.id); confirmAction(); },
            })),
            backItem(back),
          ],
        };
      }
      case "object": {
        const back = () => setNav("act");
        return {
          title: "Objeto",
          back,
          items: [
            ...adjActionObjects.map((o) => {
              const k = ruleOf(o)?.kind;
              return {
                key: o.id,
                label: o.label,
                meta: ruleOf(o)?.badge,
                run: () => {
                  setActionObjectId(o.id);
                  if (k === "reload") { setMenuIndex(0); setNav("reload"); }
                  else if (k === "chest") confirmAction();
                  else { setTargetId(""); goTarget(); }
                },
              };
            }),
            backItem(back),
          ],
        };
      }
      case "target": {
        // Voltar: para ataque, se só havia 1 arma (auto-skip) volta direto ao "Agir".
        const back = () =>
          setNav(
            actionKind === "special"
              ? "object"
              : weaponOptions.length > 1
                ? "weapon"
                : "act",
          );
        // Detalhes completos da arma/ação usada, exibidos no menu de alvo.
        let note = "";
        if (actionKind === "attack") {
          const w = weaponById(effectiveWeaponId);
          if (w) {
            const parts = [
              `dano ${w.damage ?? "—"}`,
              `alcance ${bandLabel(weaponBand(w))}`,
            ];
            if (w.area) parts.push(`área ${w.area}`);
            if (w.maxAmmo) parts.push(`munição ⦿${currentActor!.ammo?.[w.id] ?? 0}/${w.maxAmmo}`);
            note = `${w.name} — ${parts.join(" · ")}`;
          } else {
            note = `${FREE_HANDS.name} — dano ${FREE_HANDS.damage} · alcance ${bandLabel(weaponBand(FREE_HANDS))}`;
          }
        } else if (actionKind === "special" && actionObject) {
          const rl = ruleOf(actionObject);
          note = `${actionObject.label}${rl?.damage ? ` — dano ${rl.damage}` : ""}`;
        }
        return {
          title: "Alvo",
          note,
          back,
          items: [
            ...(targets.length
              ? targets.map((t) => ({
                  key: t.id,
                  label: t.label,
                  meta: `${t.hp}/${t.maxHp} HP${t.kind === "object" ? " · objeto" : ` · ${t.state}`}`,
                  run: () => { setTargetId(t.id); setMenuIndex(0); setNav("confirmAttack"); },
                }))
              : [{ key: "none", label: "(sem alvo)", disabled: true, run: () => {} }]),
            backItem(back),
          ],
        };
      }
      case "confirmAttack": {
        const tgt = battle!.tokens.find((t) => t.id === effectiveTargetId);
        return {
          title: "Confirmar ataque",
          note: tgt
            ? `${tgt.label} (${tgt.hp}/${tgt.maxHp} HP)${attackCharges ? ` · +${attackCharges * DISTORTION_DMG_PER_CHARGE} dano` : ""}`
            : undefined,
          back: () => setNav("target"),
          items: [
            { key: "yes", label: "Sim, atacar", run: () => confirmAction() },
            { key: "no", label: "Não", run: () => setNav("target") },
          ],
        };
      }
      case "confirmEndTurn":
        return {
          title: "Encerrar turno?",
          back: () => setNav("root"),
          items: [
            { key: "yes", label: "Sim, encerrar", run: () => endTurn() },
            { key: "no", label: "Não", run: () => setNav("root") },
          ],
        };
      case "confirmEndBattle":
        return {
          title: "Encerrar combate?",
          note: "A batalha fica pausada e pode ser resumida.",
          back: () => setNav("root"),
          items: [
            { key: "yes", label: "Sim, encerrar", run: () => emit("gm:endBattle") },
            { key: "no", label: "Não", run: () => setNav("root") },
          ],
        };
      case "confirmAddEnemy": {
        const npcId = addNpcId || state!.npcs[0]?.id || "";
        const npc = state!.npcs.find((n) => n.id === npcId);
        return {
          title: "Adicionar inimigo?",
          note: npc
            ? `${npc.name} na casa (${cursor.x + 1}, ${cursor.y + 1})`
            : undefined,
          back: () => setNav("inspect"),
          items: [
            {
              key: "yes",
              label: "Sim, adicionar",
              run: () => {
                if (npcId) emit("gm:addEnemy", { npcId, pos: { x: cursor.x, y: cursor.y } });
                setNav("inspect");
              },
            },
            { key: "no", label: "Não", run: () => setNav("inspect") },
          ],
        };
      }
      case "confirmRemoveEnemy": {
        const rt = battle!.tokens.find((t) => t.pos.x === cursor.x && t.pos.y === cursor.y);
        return {
          title: "Remover do mapa?",
          note: rt ? `${rt.label} na casa (${cursor.x + 1}, ${cursor.y + 1})` : undefined,
          back: () => setNav("inspect"),
          items: [
            {
              key: "yes",
              label: "Sim, remover",
              disabled: !rt,
              run: () => {
                if (rt) emit("gm:removeToken", { tokenId: rt.id });
                setNav("inspect");
              },
            },
            { key: "no", label: "Não", run: () => setNav("inspect") },
          ],
        };
      }
      case "root":
      default:
        return {
          title: "Turno",
          items: [
            // Já agiu E já saiu da casa inicial: o movimento foi consumido (só dá
            // pra movimentar a partir da casa onde o turno começou).
            { key: "move", label: "Mover", disabled: acted && hasMoved, run: () => { setMenuIndex(0); setNav("move"); } },
            { key: "act", label: "Agir", disabled: acted || !canAct, run: () => { setMenuIndex(0); setNav("act"); } },
            { key: "inspect", label: "Inspecionar", run: () => { setCursor(stagedPos ?? actorPos); setNav("inspect"); } },
            { key: "end", label: "Encerrar", run: () => { setMenuIndex(0); setNav("confirmEndTurn"); } },
            ...(isGM
              ? [{ key: "endbattle", label: "Encerrar combate (pausa)", run: () => { setMenuIndex(0); setNav("confirmEndBattle"); } }]
              : []),
          ],
        };
    }
  }
  const menu = buildMenu();

  // Auto-skip: se só há UMA arma com alvo, pula direto para a seleção de alvo.
  useEffect(() => {
    if (nav === "weapon" && weaponOptions.length === 1) {
      setWeaponId(weaponOptions[0].id);
      setTargetId("");
      setNav("target");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, weaponOptions.length]);

  // Move o token DIRETO 1 casa na direção (recalcula alvos ao vivo).
  // Retorna true se a casa encenada mudou (para o efeito sonoro de movimento).
  function stepMove(dx: number, dy: number): boolean {
    const p = stagedPos ?? actorPos;
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) return false;
    if (!(reachable(nx, ny) || (nx === actorPos.x && ny === actorPos.y))) return false;
    if (nx === p.x && ny === p.y) return false;
    setStagedPos({ x: nx, y: ny });
    return true;
  }

  // Cargas mínimas de movimento para a casa encenada continuar alcançável
  // (evita reduzir a carga e deixar o token "preso" fora do alcance).
  function minMoveCharges(): number {
    if (!stagedPos || !currentActor) return 0;
    if (stagedPos.x === actorPos.x && stagedPos.y === actorPos.y) return 0;
    for (let c = 0; c <= availableCharges; c++) {
      const set = reachableCells(currentActor, battle!.tokens, grid, baseMv + c);
      if (set.has(`${stagedPos.x},${stagedPos.y}`)) return c;
    }
    return availableCharges;
  }

  // Cargas formam um POOL único: movimento + ataque <= disponível.
  function adjustDist(delta: number) {
    if (nav === "move") {
      const floor = minMoveCharges();
      const cap = availableCharges - attackCharges; // sobra após o que já vai no ataque
      setMoveCharges((c) => Math.max(floor, Math.min(cap, c + delta)));
    } else {
      const cap = Math.min(attackChargeMax, availableCharges - moveCharges);
      setAttackCharges((c) => Math.max(0, Math.min(cap, c + delta)));
    }
  }

  // Som ao ativar um item do menu: voltar/recusar = cancel; o resto = confirm.
  // "Encerrar" (turno) e seu "Sim" tocam confirm (é uma confirmação, não um voltar).
  function activateItemSfx(it: MenuItem) {
    const k = it.key;
    if (k === "__back" || k === "no") {
      playSfx("cancel");
    } else {
      playSfx("confirm");
    }
  }

  type InputAction = "up" | "down" | "left" | "right" | "confirm" | "cancel" | "distMinus" | "distPlus";
  const inputRef = useRef<(a: InputAction) => void>(() => {});
  inputRef.current = (a) => {
    if (!controlsActor) return;
    // L1/R1 ajustam a distorção em qualquer contexto (movimento ou ataque).
    if (a === "distMinus") { playSfx("distortion"); return adjustDist(-1); }
    if (a === "distPlus") { playSfx("distortion"); return adjustDist(1); }
    if (nav === "move") {
      if (a === "up") { if (stepMove(0, -1)) playSfx("move"); }
      else if (a === "down") { if (stepMove(0, 1)) playSfx("move"); }
      else if (a === "left") { if (stepMove(-1, 0)) playSfx("move"); }
      else if (a === "right") { if (stepMove(1, 0)) playSfx("move"); }
      else if (a === "confirm" || a === "cancel") { playSfx("confirm"); exitMove(); }
      return;
    }
    if (nav === "inspect") {
      if (a === "confirm" || a === "cancel") {
        playSfx("cancel");
        setNav("root");
        return;
      }
      const clamp = (v: number) => Math.max(0, Math.min(grid - 1, v));
      const nx = clamp(cursor.x + (a === "right" ? 1 : a === "left" ? -1 : 0));
      const ny = clamp(cursor.y + (a === "down" ? 1 : a === "up" ? -1 : 0));
      if (nx !== cursor.x || ny !== cursor.y) {
        setCursor({ x: nx, y: ny });
        playSfx("move");
      }
      return;
    }
    // ← → ajustam a distorção de ataque (quando no fluxo de ataque).
    if (a === "left" || a === "right") {
      if (inAttackFlow) {
        playSfx("distortion");
        adjustDist(a === "right" ? 1 : -1);
      }
      return;
    }
    const items = menu.items;
    if (a === "up") {
      setMenuIndex((i) => (i - 1 + items.length) % items.length);
      playSfx("navigate");
    } else if (a === "down") {
      setMenuIndex((i) => (i + 1) % items.length);
      playSfx("navigate");
    } else if (a === "confirm") {
      const it = items[menuIndex];
      if (!it) return;
      if (it.disabled) {
        playSfx("error");
        return;
      }
      activateItemSfx(it);
      it.run();
    } else if (a === "cancel") {
      playSfx("cancel");
      menu.back?.();
    }
  };

  // No modo "target", o alvo destacado segue o item selecionado.
  useEffect(() => {
    if (nav === "target") setTargetId(targets[menuIndex]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, menuIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      const map: Record<string, InputAction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        Enter: "confirm",
        " ": "confirm",
        Escape: "cancel",
        Backspace: "cancel",
      };
      const action = map[e.key];
      if (action) {
        e.preventDefault();
        inputRef.current(action);
      }
    }
    window.addEventListener("keydown", onKey);

    let raf = 0;
    const prev: Record<number, boolean> = {};
    const REPEAT = 170;
    const lastDir: Record<string, number> = {};
    function poll() {
      const pads = navigator.getGamepads?.() ?? [];
      const gp = pads.find((p) => p);
      if (gp) {
        const now = performance.now();
        const press = (i: number) => {
          const down = !!gp.buttons[i]?.pressed;
          const was = prev[i] ?? false;
          prev[i] = down;
          return down && !was;
        };
        if (press(0)) inputRef.current("confirm"); // A
        if (press(1)) inputRef.current("cancel"); // B
        if (press(4)) inputRef.current("distMinus"); // L1
        if (press(5)) inputRef.current("distPlus"); // R1
        // Navegação só no D-PAD (analógico esquerdo é reservado para o pan).
        const dir = (i: number, a: InputAction) => {
          const dpad = !!gp.buttons[i]?.pressed;
          if (dpad) {
            if (now - (lastDir[a] ?? 0) > REPEAT) {
              lastDir[a] = now;
              inputRef.current(a);
            }
          } else {
            lastDir[a] = 0;
          }
        };
        dir(12, "up");
        dir(13, "down");
        dir(14, "left");
        dir(15, "right");

        // Câmera: analógico ESQUERDO faz pan; analógico DIREITO (eixo Y) faz zoom.
        const dz = 0.16; // zona morta
        const lx = gp.axes[0] ?? 0;
        const ly = gp.axes[1] ?? 0;
        if (Math.abs(lx) > dz || Math.abs(ly) > dz) {
          const cur = panRef.current;
          setPan({ x: cur.x - lx * 8, y: cur.y - ly * 8 });
        }
        const ry = gp.axes[3] ?? 0;
        if (Math.abs(ry) > dz) {
          setZoom(clampZoom(zoomRef.current - ry * 0.02));
        }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Sons de movimento do PERSONAGEM tocados também para os espectadores (quem
  // não controla o ator): o token se move / muda a distorção de movimento na tela
  // deles via intent compartilhado. O controlador já toca localmente; aqui só os
  // demais. Sons de interação de menu permanecem locais.
  const specTurnRef = useRef(-1);
  const specStagedRef = useRef("none");
  const specMoveChargesRef = useRef(0);
  const intentStagedKey = intentForActor?.staged
    ? `${intentForActor.staged.x},${intentForActor.staged.y}`
    : "none";
  const intentMoveCharges = intentForActor?.moveCharges ?? 0;
  useEffect(() => {
    const seq = battle?.turnSeq ?? 0;
    // Em novo turno ou quando ESTE cliente controla o ator: só sincroniza (sem tocar).
    if (controlsActor || seq !== specTurnRef.current) {
      specTurnRef.current = seq;
      specStagedRef.current = intentStagedKey;
      specMoveChargesRef.current = intentMoveCharges;
      return;
    }
    if (intentStagedKey !== specStagedRef.current) {
      specStagedRef.current = intentStagedKey;
      if (intentStagedKey !== "none") playSfx("move");
    }
    if (intentMoveCharges !== specMoveChargesRef.current) {
      specMoveChargesRef.current = intentMoveCharges;
      playSfx("distortion");
    }
  }, [controlsActor, battle?.turnSeq, intentStagedKey, intentMoveCharges]);

  // Transmite o planejamento (movimento/arma/alvo) para todos verem em tempo real.
  useEffect(() => {
    if (!controlsActor || !currentActor) return;
    emit("battle:intent", {
      actorId: currentActor.id,
      staged: stagedPos,
      mode: nav,
      moveCharges,
      attackCharges,
      weaponId: nav === "weapon" ? weaponOptions[menuIndex]?.id ?? "" : effectiveWeaponId,
      targetId: nav === "target" || nav === "confirmAttack" ? effectiveTargetId : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controlsActor,
    currentActor?.id,
    stagedPos,
    nav,
    menuIndex,
    moveCharges,
    attackCharges,
    effectiveWeaponId,
    effectiveTargetId,
  ]);

  return (
    <div className={styles.layout}>
      <section className={styles.arena}>
        <div className={styles.topBar}>
          {endsAt > 0 && (
            <span
              className={`${styles.timer} ${endsAt - now < 10000 ? styles.timerLow : ""}`}
            >
              ⏱ {formatRemaining(endsAt - now)}
            </span>
          )}
          <span className={styles.dist}>distorção {state.game.distortion}/10</span>
          <button
            type="button"
            className={styles.camReset}
            title="Centralizar câmera"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            ⟳ câmera
          </button>
        </div>

        <div
          className={styles.scene}
          onWheel={(e) => {
            setZoom((z) => clampZoom(z - e.deltaY * 0.001));
          }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            // Botão direito arrasta (pan) o tabuleiro.
            if (e.button !== 2) return;
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const start = { x: e.clientX, y: e.clientY };
            const base = { ...panRef.current };
            const move = (ev: PointerEvent) => {
              setPan({ x: base.x + (ev.clientX - start.x), y: base.y + (ev.clientY - start.y) });
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        >
        <div
          className={styles.board}
          style={{
            gridTemplateColumns: `repeat(${grid}, var(--cell))`,
            gridTemplateRows: `repeat(${grid}, var(--cell))`,
            ["--zoom" as string]: zoom,
            ["--pan-x" as string]: `${pan.x}px`,
            ["--pan-y" as string]: `${pan.y}px`,
          }}
        >
          {Array.from({ length: grid * grid }).map((_, idx) => {
            const x = idx % grid;
            const y = Math.floor(idx / grid);
            const tok = tokenAt(x, y);
            const canReach = reachable(x, y);
            // Casa onde o ator está exibido agora (real ou encenada).
            const isActorCell = fromPos.x === x && fromPos.y === y && !!currentActor;
            // Borda animada vermelha: alvo selecionado / prévia da arma (todos veem).
            const isTarget = !!tok && highlightTargetIds.has(tok.id);
            // Guia laranja: alvos atingíveis durante o planejamento de movimento.
            const isGuide = movePlanning && !!tok && moveGuideTargetIds.has(tok.id);
            // Anéis de distorção empilhados (sobem em Z): verde no movimento do
            // ator, vermelho no alvo do ataque. Visível a todos.
            const targetingAttack = effMode === "target" || effMode === "confirmAttack";
            const ring =
              movePlanning && isActorCell && effMoveCharges > 0
                ? { n: effMoveCharges, color: styles.ringGreen }
                : targetingAttack && !!tok && tok.id === effTargetId && effAttackCharges > 0
                  ? { n: effAttackCharges, color: styles.ringRed }
                  : null;
            // Cursor branco do modo Inspecionar.
            const isCursor = nav === "inspect" && cursor.x === x && cursor.y === y;
            return (
              <div
                key={idx}
                className={[
                  styles.cell,
                  canReach && !tok ? styles.reach : "",
                  isTarget ? styles.target : "",
                  isGuide ? styles.guide : "",
                  isActorCell ? styles.actorCell : "",
                  isCursor ? styles.cursor : "",
                ].join(" ")}
                onClick={() => {
                  if (nav === "inspect") {
                    if (cursor.x !== x || cursor.y !== y) {
                      setCursor({ x, y });
                      playSfx("move");
                    }
                  } else clickCell(x, y);
                }}
              >
                {tok && (
                  <Cube
                    token={tok}
                    atPos={displayPos(tok)}
                    tokens={battle.tokens}
                    active={tok.id === currentActor?.id}
                    damage={damagePopups.find((d) => d.tokenId === tok.id)}
                    flanked={flankedIds.has(tok.id)}
                    onInspect={
                      // Todos podem inspecionar clicando — exceto a própria casa do
                      // ator durante o movimento (lá o clique serve para mover).
                      !(phase === "move" && controlsActor && tok.id === currentActor?.id)
                        ? () => setInspectId(tok.id)
                        : undefined
                    }
                  />
                )}
                {ring &&
                  Array.from({ length: ring.n }).map((_, i) => (
                    <span
                      key={i}
                      className={`${styles.ring} ${ring.color}`}
                      style={{
                        transform: `translateZ(calc(var(--cell) * ${0.22 * (i + 1)}))`,
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
        </div>
      </section>

      <aside className={styles.side}>
        {controlsActor && currentActor && (
          <div className={styles.actionPanel}>
            <h3>Turno: {currentActor.label}</h3>

            {/* Menu de comando estilo FFT Tactics (mouse, teclado e controle). */}
            {nav === "inspect" ? (
              <>
                <p className="muted">
                  Inspecionar — mova o cursor branco (direcionais/clique). Os dados
                  aparecem no painel inferior esquerdo.
                </p>
                {isGM &&
                  (inspectShown ? (
                    <>
                      {(inspectShown.kind === "player" || inspectShown.kind === "enemy") &&
                        inspectShown.state !== "Morto" &&
                        !battle.initiative.some((i) => i.tokenId === inspectShown.id) && (
                          <button
                            className={styles.confirm}
                            onClick={() => {
                              playSfx("confirm");
                              emit("gm:grantInitiative", { tokenId: inspectShown.id });
                            }}
                          >
                            ⚄ Conceder iniciativa a “{inspectShown.label}”
                          </button>
                        )}
                      <button
                        className={styles.confirm}
                        onClick={() => { playSfx("confirm"); setMenuIndex(0); setNav("confirmRemoveEnemy"); }}
                      >
                        ✖ Remover “{inspectShown.label}” do mapa
                      </button>
                    </>
                  ) : (
                    <div className={styles.charges}>
                      <div className={styles.chargeHead}>
                        <span>Adicionar inimigo nesta casa</span>
                      </div>
                      <select
                        className={styles.npcSelect}
                        value={addNpcId || state.npcs[0]?.id || ""}
                        onChange={(e) => setAddNpcId(e.target.value)}
                      >
                        {state.npcs.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name} (HP {n.hp})
                          </option>
                        ))}
                      </select>
                      <button
                        className={styles.confirm}
                        disabled={state.npcs.length === 0}
                        onClick={() => { playSfx("confirm"); setMenuIndex(0); setNav("confirmAddEnemy"); }}
                      >
                        ＋ Adicionar inimigo
                      </button>
                    </div>
                  ))}
                <button className={styles.confirm} onClick={() => { playSfx("cancel"); setNav("root"); }}>
                  ◀ Voltar ao menu
                </button>
              </>
            ) : nav === "move" ? (
              <>
                <p className="muted">
                  Mover (mv {actorMv}) — direcionais ou clique movem o token direto.
                  {acted ? " Ação já usada." : ""}
                </p>
                <div className={styles.charges}>
                  <div className={styles.chargeHead}>
                    <span>Distorção: movimento (L1/R1)</span>
                    <span className={styles.chargeCount}>
                      {availableCharges - moveCharges - attackCharges}/{availableCharges} livres
                    </span>
                  </div>
                  <div className={styles.stepper}>
                    <button
                      type="button"
                      disabled={moveCharges <= minMoveCharges()}
                      onClick={() => {
                        playSfx("distortion");
                        setMoveCharges((c) => Math.max(minMoveCharges(), c - 1));
                      }}
                    >
                      L1
                    </button>
                    <span>
                      +{moveCharges} casa{moveCharges === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      disabled={moveCharges + attackCharges >= availableCharges}
                      onClick={() => { playSfx("distortion"); setMoveCharges((c) => c + 1); }}
                    >
                      R1
                    </button>
                  </div>
                </div>
                <button className={styles.confirm} onClick={() => { playSfx("confirm"); exitMove(); }}>
                  {acted && hasMoved ? "✓ Confirmar movimento e encerrar" : "◀ Voltar ao menu"}
                </button>
              </>
            ) : (
              <div className={styles.cmdMenu}>
                <p className={styles.menuTitle}>{menu.title}</p>
                {menu.note && <p className={styles.menuNote}>{menu.note}</p>}
                {adjMod !== 0 && nav !== "root" && (
                  <p className={styles.cmdHint}>
                    adjacência: {adjMod > 0 ? "+" : ""}
                    {adjMod} no ataque
                  </p>
                )}
                {/* Distorção primeiro — ajustada por L1/R1 (e ← → no teclado). */}
                {inAttackFlow && (
                  <div className={styles.charges}>
                    <div className={styles.chargeHead}>
                      <span>Distorção: ataque (L1/R1)</span>
                      <span className={styles.chargeCount}>
                        {availableCharges - moveCharges - attackCharges}/{availableCharges} livres
                      </span>
                    </div>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        disabled={attackCharges <= 0}
                        onClick={() => { playSfx("distortion"); setAttackCharges((c) => Math.max(0, c - 1)); }}
                      >
                        L1
                      </button>
                      <span className={styles.dmgPlus}>
                        +{attackCharges * DISTORTION_DMG_PER_CHARGE} dano
                      </span>
                      <button
                        type="button"
                        disabled={
                          attackCharges >= attackChargeMax ||
                          moveCharges + attackCharges >= availableCharges
                        }
                        onClick={() => {
                          playSfx("distortion");
                          setAttackCharges((c) => Math.min(attackChargeMax, c + 1));
                        }}
                      >
                        R1
                      </button>
                    </div>
                  </div>
                )}
                {menu.items.map((it, i) => (
                  <button
                    key={it.key}
                    type="button"
                    disabled={it.disabled}
                    className={`${styles.cmdItem} ${i === menuIndex ? styles.cmdOn : ""}`}
                    onMouseEnter={() => {
                      if (i !== menuIndex) {
                        setMenuIndex(i);
                        playSfx("navigate");
                      }
                    }}
                    onClick={() => {
                      setMenuIndex(i);
                      if (!it.disabled) {
                        activateItemSfx(it);
                        it.run();
                      }
                    }}
                  >
                    <span className={styles.cmdRow}>
                      <span className={styles.cmdArrow}>▸</span>
                      <span className={styles.cmdText}>
                        {it.label}
                        {it.key === "act" && acted ? " ✓" : ""}
                      </span>
                    </span>
                    {it.meta && <span className={styles.cmdMeta}>{it.meta}</span>}
                  </button>
                ))}
                <p className={styles.cmdHint}>
                  ↕ navega · A/Enter confirma · B/Esc volta
                  {inAttackFlow ? " · L1/R1 distorção" : ""}
                </p>
              </div>
            )}
          </div>
        )}

      </aside>

      {/* Iniciativa no topo-esquerdo. */}
      <div className={`${styles.initiative} ${styles.initPanel}`}>
        <h3>Iniciativa</h3>
        <ol>
          {battle.initiative.map((i, idx) => {
            const cur = idx === battle.turnIndex;
            return (
              <li key={i.tokenId} className={cur ? styles.curTurn : ""}>
                <span>
                  {cur && <span className={styles.turnArrow}>▶ </span>}
                  {i.label}
                </span>
                <b>{i.value}</b>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Topo-direito: Objetos + Histórico em abas. */}
      <div className={`${styles.objects} ${styles.objPanel}`}>
        <div className={styles.panelTabs}>
          <button
            type="button"
            className={rightTab === "objects" ? styles.panelTabOn : ""}
            onClick={() => setRightTab("objects")}
          >
            Objetos ({objectsOnBoard.length})
          </button>
          <button
            type="button"
            className={rightTab === "log" ? styles.panelTabOn : ""}
            onClick={() => setRightTab("log")}
          >
            Histórico
          </button>
          {isGM && (
            <span className={styles.logActions}>
              <button className={styles.logLink} onClick={() => emit("gm:advanceTurn", { dir: -1 })}>
                ◀
              </button>
              <button className={styles.logLink} onClick={() => emit("gm:advanceTurn", { dir: 1 })}>
                ▶
              </button>
            </span>
          )}
        </div>
        {rightTab === "objects" ? (
          objectsOnBoard.length === 0 ? (
            <p className="muted">Nenhum objeto em campo.</p>
          ) : (
            <ul>
              {objectsOnBoard.map((o) => {
                const rule = ruleOf(o);
                const near = adjObjects.some((a) => a.id === o.id);
                return (
                  <li key={o.id} className={near ? styles.objNear : ""}>
                    <span className={styles.objName}>
                      {o.label}
                      {rule ? ` · ${objectBadge(o)}` : ""}
                      {o.hp !== undefined ? ` · ${o.hp} HP` : ""}
                      {near ? " ◀ adjacente" : ""}
                    </span>
                    <span className={styles.objEffect}>{rule?.description}</span>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <div className={styles.logBody}>
            {battle.log.slice(-20).map((l, i) => (
              <div key={i} className={styles.logLine}>
                &gt; {l}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inferior-esquerdo: inspetor (sempre visível; se nada selecionado, o ator atual). */}
      {inspectShown && (
        <div className={styles.inspectPanel}>
          <TokenInspector
            token={inspectShown}
            state={state}
            showHp={isGM}
            onClose={inspected ? () => setInspectId(null) : undefined}
            onEdit={
              isGM
                ? (patch) => emit("gm:editToken", { tokenId: inspectShown.id, ...patch })
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

function Cube({
  token,
  atPos,
  tokens,
  active,
  damage,
  flanked,
  onInspect,
}: {
  token: Token;
  atPos: { x: number; y: number };
  tokens: Token[];
  active?: boolean;
  damage?: DamagePopup;
  flanked?: boolean;
  onInspect?: () => void;
}) {
  const rule = ruleOf(token);
  const isNeutral = token.kind === "enemy" && token.neutral;
  const kindClass = isNeutral ? "npc" : token.kind;
  const isUnit = token.kind === "player" || token.kind === "enemy";
  const isDead = isUnit && token.state === "Morto";
  const hasHp = token.hp !== undefined;
  const dt = token.charges ?? 0;
  // Bônus/desvantagens por adjacência — a partir da posição EXIBIDA (encenada),
  // para sumir assim que o token sai de perto do objeto durante o movimento.
  // Corpos não recebem mais bônus.
  const adjBadges =
    token.kind === "object" || isDead
      ? []
      : adjacencyMods({ ...token, pos: atPos }, tokens).badges;
  return (
    <div
      className={`${styles.cube} ${styles["cube_" + kindClass]} ${
        active ? styles.cubeActive : ""
      } ${isDead ? styles.cubeDead : ""}`}
      title={token.label}
      onClick={
        onInspect
          ? (e) => {
              e.stopPropagation();
              onInspect();
            }
          : undefined
      }
    >
      {/* corpo 3D: topo + duas paredes */}
      <span className={styles.cubeBody}>
        <span className={`${styles.cubeFace} ${styles.cubeTop}`} />
        <span className={`${styles.cubeFace} ${styles.cubeFront}`} />
        <span className={`${styles.cubeFace} ${styles.cubeSide}`} />
      </span>

      {/* rótulos (billboard) acima do cubo — sempre visíveis */}
      <span className={styles.cubeLabel}>
        {damage && (
          <span className={styles.cubeDmg}>
            -{damage.amount}
            {damage.notes?.map((n, i) => (
              <span key={i} className={styles.dmgNote}>
                {n}
              </span>
            ))}
          </span>
        )}
        <span className={styles.cubeName}>{token.label}</span>
        {hasHp && !isDead && (
          <span className={styles.cubeHp}>
            {token.hp}/{token.maxHp}
            {isUnit && dt > 0 ? (
              <span className={styles.cubeDt}> ◆ {dt}</span>
            ) : null}
          </span>
        )}
        {isUnit && token.state && (
          <span className={styles.cubeStateLabel}>{token.state}</span>
        )}
        {token.kind === "object" && rule && (
          <span className={styles.cubeBadgeLabel}>{objectBadge(token)}</span>
        )}
        {flanked && !isDead && (
          <span className={styles.cubeFlanked}>FLANQUEADO</span>
        )}
        {adjBadges.length > 0 && (
          <span className={styles.cubeMods}>
            {adjBadges.map((b, i) => (
              <span
                key={i}
                className={b.kind === "bonus" ? styles.cubeBonus : styles.cubeMalus}
              >
                {b.badge}
              </span>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

function TokenInspector({
  token,
  state,
  showHp,
  onClose,
  onEdit,
}: {
  token: Token;
  state: NonNullable<ReturnType<typeof useGame>["state"]>;
  showHp?: boolean;
  onClose?: () => void;
  onEdit?: (patch: { hp?: number; state?: string }) => void;
}) {
  const rule = ruleOf(token);
  const npc = token.npcId ? state.npcs.find((n) => n.id === token.npcId) : null;
  const ch = token.characterId
    ? state.characters.find((c) => c.id === token.characterId)
    : null;
  const isUnit = token.kind === "enemy" || token.kind === "player";
  const item = (id: string) => state.items.find((i) => i.id === id) ?? null;

  // Armas (com munição em campo) e consumíveis com quantidade.
  const weaponIds = ch ? ch.items.map((s) => s.id) : npc?.weapons ?? [];
  const weapons = weaponIds
    .map((id) => resolveItem(state.items, id)) // resolve Mãos Livres embutido
    .filter((w): w is NonNullable<typeof w> => !!w && w.category === "weapon");
  const consumables = ch
    ? ch.items
        .map((s) => ({ it: item(s.id), qty: s.qty }))
        .filter((e): e is { it: NonNullable<typeof e.it>; qty: number } =>
          !!e.it && e.it.category === "item",
        )
    : [];

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectHead}>
        <h3>{token.label}</h3>
        {onClose && <button onClick={onClose}>x</button>}
      </div>
      <dl className={styles.inspectBody}>
        {/* HP só para o GM (showHp). Jogadores veem apenas o estado. */}
        {isUnit && showHp &&
          (onEdit ? (
            <div>
              <dt>HP</dt>
              <dd>
                <input
                  type="number"
                  className={styles.inspectInput}
                  value={token.hp ?? 0}
                  min={0}
                  max={token.maxHp ?? 999}
                  onChange={(e) => onEdit({ hp: Number(e.target.value) })}
                />{" "}
                / {token.maxHp}
              </dd>
            </div>
          ) : (
            <div>
              <dt>HP</dt>
              <dd>
                {token.hp}/{token.maxHp}
              </dd>
            </div>
          ))}
        {isUnit && (
          <div>
            <dt>estado</dt>
            <dd>
              {onEdit ? (
                <select
                  className={styles.inspectInput}
                  value={token.state ?? "Disposto"}
                  onChange={(e) => onEdit({ state: e.target.value })}
                >
                  {STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                token.state
              )}
            </dd>
          </div>
        )}
        {token.kind === "player" && (
          <div>
            <dt>distorção</dt>
            <dd>{token.charges ?? 0} carga(s)</dd>
          </div>
        )}
        {ch && (
          <div>
            <dt>nível</dt>
            <dd>
              {ch.level} · MV {ch.mv} · DF {ch.df}
            </dd>
          </div>
        )}
        {npc?.description && (
          <div>
            <dt>nota</dt>
            <dd>{npc.description}</dd>
          </div>
        )}
        {rule && (
          <div>
            <dt>regra</dt>
            <dd>
              {rule.badge} — {rule.description}
            </dd>
          </div>
        )}
      </dl>

      {weapons.length > 0 && (
        <div className={styles.inspectList}>
          <span className={styles.inspectListTitle}>Armas</span>
          {weapons.map((w) => {
            const ammo = w.maxAmmo ? token.ammo?.[w.id] ?? 0 : null;
            return (
              <div key={w.id} className={styles.inspectItem}>
                <span className={styles.inspectItemName}>{w.name}</span>
                <span className={styles.inspectItemMeta}>
                  {w.damage} · alc {bandLabel(weaponBand(w))}
                  {w.area ? ` · área ${w.area}` : ""}
                  {ammo !== null ? ` · ⦿ ${ammo}/${w.maxAmmo}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {consumables.length > 0 && (
        <div className={styles.inspectList}>
          <span className={styles.inspectListTitle}>Itens</span>
          {consumables.map(({ it, qty }) => (
            <div key={it.id} className={styles.inspectItem}>
              <span className={styles.inspectItemName}>
                {it.name} <b>×{qty}</b>
              </span>
              <span className={styles.inspectItemMeta}>
                {it.heal ? `cura +${it.heal} HP` : it.ammo ? `munição +${it.ammo}` : "item"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
