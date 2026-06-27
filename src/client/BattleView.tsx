"use client";

import { useEffect, useMemo, useState } from "react";
import { useGame } from "./GameProvider";
import type { ActionKind, Token } from "@/game/types";
import { STATES } from "@/game/types";
import { adjacencyMods, isActionRule, objectBadge, ruleOf } from "@/game/objects";
import { bandLabel, inBand, weaponBand } from "@/game/weapons";
import { canTarget } from "@/game/faction";
import { reachableCells } from "@/game/path";
import { DISTORTION_DMG_PER_CHARGE } from "@/game/rules";
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
  const { state, session, emit, damagePopups } = useGame();
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
  }, [currentActor?.id, battle?.turnIndex]);

  // Após usar a ação principal, vai direto para a aba de movimento (só falta mover).
  const acted = !!currentActor?.actedThisTurn;
  useEffect(() => {
    if (acted) setPhase("move");
  }, [acted]);

  if (!battle || !state) return null;

  const grid = battle.grid;
  const actorPos = currentActor?.pos ?? { x: 0, y: 0 };

  const baseMv = (() => {
    if (!currentActor?.characterId) return 2;
    const ch = state.characters.find((c) => c.id === currentActor.characterId);
    return ch?.mv ?? 2;
  })();
  const availableCharges = currentActor?.charges ?? 0;
  // Movimento efetivo = base + cargas de distorção alocadas ao movimento.
  const actorMv = baseMv + moveCharges;

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
      (i) => i.category === "weapon" && i.id !== "wpn_maos_livres" && uniq.includes(i.id),
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

  // Posição "de onde o ator vai agir": a casa encenada (staging local) ou a real.
  // O movimento NÃO é enviado ao servidor até confirmar a ação/encerrar o turno,
  // então mover e agir são independentes e dá para voltar atrás na movimentação.
  const fromPos = stagedPos ?? actorPos;

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

  // Casas alcançáveis no passo de movimento: BFS contornando tokens não aliados.
  const reachableSet =
    phase === "move" && controlsActor && currentActor
      ? reachableCells(currentActor, battle.tokens, grid, actorMv)
      : null;
  const reachable = (x: number, y: number) =>
    !!reachableSet &&
    // A casa de origem do ator também é "alcançável" (clicar = voltar/ficar parado).
    (reachableSet.has(`${x},${y}`) ||
      (!!currentActor && phase === "move" && actorPos.x === x && actorPos.y === y));

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

  // Guia de movimentação: alvos atingíveis por QUALQUER arma (banda) a partir de fromPos.
  // Inclui mãos livres (1) e todas as armas em posse.
  const myBands = [weaponBand(null), ...myWeapons.map((w) => weaponBand(w))];
  const moveGuideTargetIds =
    phase === "move" && controlsActor && currentActor
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

  // Posição de exibição: para quem controla, o ator aparece na casa encenada
  // (local) em ambas as fases; os demais só veem após o commit (confirmar ação).
  const displayPos = (t: Token) =>
    controlsActor && stagedPos && t.id === currentActor?.id ? stagedPos : t.pos;

  const tokenAt = (x: number, y: number) =>
    battle.tokens.find((t) => {
      const p = displayPos(t);
      return p.x === x && p.y === y;
    });

  const inspected = inspectId ? battle.tokens.find((t) => t.id === inspectId) ?? null : null;

  function clickCell(x: number, y: number) {
    if (phase !== "move" || !controlsActor) return;
    if (reachable(x, y) || (x === actorPos.x && y === actorPos.y)) {
      setStagedPos({ x, y });
    }
  }

  // Envia o movimento ao servidor (commit) se o ator saiu do lugar.
  function commitMove() {
    if (!currentActor) return;
    if (stagedPos && (stagedPos.x !== actorPos.x || stagedPos.y !== actorPos.y)) {
      emit("player:moveToken", { tokenId: currentActor.id, pos: stagedPos, moveCharges });
    }
  }

  function endTurn() {
    commitMove();
    emit("player:endTurn");
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

  return (
    <div className={styles.layout}>
      <section className={styles.arena}>
        <div className={styles.bannerRow}>
          <h2>Batalha</h2>
          {battle.turnEndsAt > 0 && (
            <span
              className={`${styles.timer} ${
                battle.turnEndsAt - now < 30000 ? styles.timerLow : ""
              }`}
            >
              ⏱ {formatRemaining(battle.turnEndsAt - now)}
            </span>
          )}
          <span className={styles.dist}>distorção {state.game.distortion}/10</span>
        </div>

        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(${grid}, 1fr)` }}
        >
          {Array.from({ length: grid * grid }).map((_, idx) => {
            const x = idx % grid;
            const y = Math.floor(idx / grid);
            const tok = tokenAt(x, y);
            const canReach = reachable(x, y);
            // Casa onde o ator está exibido agora (real ou encenada).
            const isActorCell = fromPos.x === x && fromPos.y === y && !!currentActor;
            // Só o alvo efetivamente escolhido recebe a borda animada (ação).
            const isTarget =
              phase === "action" &&
              !!effectiveTargetId &&
              !!tok &&
              tok.id === effectiveTargetId;
            // Guia laranja: alvo atingível por alguma arma durante o movimento.
            const isGuide =
              phase === "move" && !!tok && moveGuideTargetIds.has(tok.id);
            return (
              <div
                key={idx}
                className={[
                  styles.cell,
                  canReach && !tok ? styles.reach : "",
                  isTarget ? styles.target : "",
                  isGuide ? styles.guide : "",
                  isActorCell ? styles.actorCell : "",
                ].join(" ")}
                onClick={() => clickCell(x, y)}
              >
                <span className={styles.coord}>
                  {String.fromCharCode(65 + x)}
                  {y + 1}
                </span>
                {tok && (
                  <TokenChip
                    token={tok}
                    tokens={battle.tokens}
                    active={tok.id === currentActor?.id}
                    onInspect={
                      // Na fase de mover, clicar no próprio ator escolhe "ficar aqui"
                      // em vez de abrir o inspetor.
                      isGM &&
                      !(phase === "move" && controlsActor && tok.id === currentActor?.id)
                        ? () => setInspectId(tok.id)
                        : undefined
                    }
                  />
                )}
              </div>
            );
          })}

          {/* Popups de dano por posição — aparecem mesmo se o token morreu. */}
          {damagePopups.map((d) => (
            <span
              key={d.key}
              className={styles.dmgPopup}
              style={{
                left: `${((d.pos.x + 0.5) / grid) * 100}%`,
                top: `${((d.pos.y + 0.5) / grid) * 100}%`,
              }}
            >
              -{d.amount}
              {d.notes && d.notes.length > 0 && (
                <span className={styles.dmgNote}>{d.notes.join(" ")}</span>
              )}
            </span>
          ))}
        </div>

      </section>

      <aside className={styles.side}>
        {controlsActor && currentActor && (
          <div className={styles.actionPanel}>
            <h3>Turno: {currentActor.label}</h3>

            {/* Escolha livre entre movimentar e agir (em qualquer ordem). Após usar a
                ação principal, sobra só o movimento (a aba de ação some). */}
            {!acted && (
              <div className={styles.turnTabs}>
                <button
                  type="button"
                  className={phase === "move" ? styles.turnTabOn : ""}
                  onClick={() => setPhase("move")}
                >
                  Movimentar
                </button>
                <button
                  type="button"
                  className={phase === "action" ? styles.turnTabOn : ""}
                  onClick={confirmMove}
                >
                  Ação principal
                </button>
              </div>
            )}

            {phase === "move" ? (
              <>
                <p className="muted">
                  Mover (mv {actorMv}) — escolha uma casa destacada. Você pode mover
                  antes ou depois de agir; o movimento é reversível.
                  {acted ? " Ação já usada." : ""}
                </p>
                <p className={styles.staticHint}>
                  destino:{" "}
                  {stagedPos
                    ? `(${String.fromCharCode(65 + stagedPos.x)}${stagedPos.y + 1})`
                    : `ficar em (${String.fromCharCode(65 + actorPos.x)}${actorPos.y + 1})`}
                </p>

                <div className={styles.charges}>
                  <div className={styles.chargeHead}>
                    <span>Distorção: movimento</span>
                    <span className={styles.chargeCount}>
                      {availableCharges - moveCharges}/{availableCharges} cargas
                    </span>
                  </div>
                  <div className={styles.stepper}>
                    <button
                      type="button"
                      disabled={moveCharges <= 0}
                      onClick={() => {
                        setMoveCharges((c) => Math.max(0, c - 1));
                        setStagedPos(null);
                      }}
                    >
                      −
                    </button>
                    <span>
                      +{moveCharges} casa{moveCharges === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      disabled={moveCharges >= availableCharges}
                      onClick={() => setMoveCharges((c) => c + 1)}
                    >
                      +
                    </button>
                  </div>
                  <p className={styles.chargeNote}>cada carga = +1 casa de movimento</p>
                </div>

                {acted ? (
                  <button className={styles.confirm} onClick={endTurn}>
                    {hasMoved ? "Confirmar movimento e encerrar ▶" : "Encerrar turno ▶"}
                  </button>
                ) : (
                  <>
                    <button className={styles.confirm} onClick={confirmMove}>
                      Ação principal ▶
                    </button>
                    <button className={styles.endTurn} onClick={endTurn}>
                      Encerrar turno
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="muted">
                  {acted
                    ? "Ação já usada — você ainda pode movimentar."
                    : "Escolha sua ação."}
                </p>

                {adjMod !== 0 && (
                  <p className={styles.staticHint}>
                    adjacência: {adjMod > 0 ? "+" : ""}
                    {adjMod} nos ataques
                  </p>
                )}

                <label>
                  Ação
                  <select
                    value={actionKind}
                    onChange={(e) => {
                      setActionKind(e.target.value as ActionKind);
                      setTargetId("");
                      setActionObjectId("");
                    }}
                  >
                    {/* Ação especial só quando há objeto adjacente — e vem primeiro. */}
                    {hasActionObject && <option value="special">Ação especial</option>}
                    <option value="attack">Atacar</option>
                    <option value="useItem">Usar item</option>
                  </select>
                </label>

                {actionKind === "attack" && (
                  <div className={styles.weaponList}>
                    <button
                      type="button"
                      className={`${styles.weaponRow} ${
                        effectiveWeaponId === "" ? styles.weaponOn : ""
                      }`}
                      onClick={() => {
                        setWeaponId("");
                        setTargetId("");
                      }}
                    >
                      <span className={styles.weaponName}>Mãos Livres</span>
                      <span className={styles.weaponMeta}>1d4 · alc 1</span>
                    </button>
                    {myWeapons.map((w) => {
                      const ammoLeft = w.maxAmmo
                        ? currentActor.ammo?.[w.id] ?? 0
                        : null;
                      const empty = ammoLeft !== null && ammoLeft <= 0;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={empty}
                          className={`${styles.weaponRow} ${
                            effectiveWeaponId === w.id ? styles.weaponOn : ""
                          }`}
                          onClick={() => {
                            setWeaponId(w.id);
                            setTargetId("");
                          }}
                        >
                          <span className={styles.weaponName}>{w.name}</span>
                          <span className={styles.weaponMeta}>
                            {w.damage} · alc {bandLabel(weaponBand(w))}
                            {w.area ? ` · área ${w.area}` : ""}
                            {ammoLeft !== null
                              ? ` · ⦿ ${ammoLeft}/${w.maxAmmo}${empty ? " (vazio)" : ""}`
                              : ""}
                          </span>
                          {w.description && (
                            <span className={styles.weaponDesc}>{w.description}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {actionKind === "special" && (
                  <label>
                    Objeto adjacente
                    <select
                      value={actionObjectId}
                      onChange={(e) => {
                        setActionObjectId(e.target.value);
                        setTargetId("");
                        setReloadWeaponId("");
                      }}
                    >
                      <option value="">— escolha o objeto —</option>
                      {adjActionObjects.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label} [{ruleOf(o)?.badge}]
                          {o.usesLeft !== undefined ? ` · ${o.usesLeft} uso(s)` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {actionObject && (
                  <p className={styles.staticHint}>{ruleOf(actionObject)?.description}</p>
                )}
                {/* Recarga via objeto: escolher a arma. */}
                {actionKind === "special" &&
                  actionObjectRule?.kind === "reload" &&
                  myWeapons.some((w) => w.maxAmmo) && (
                    <label>
                      Recarregar
                      <select
                        value={reloadWeaponId}
                        onChange={(e) => setReloadWeaponId(e.target.value)}
                      >
                        <option value="">— escolha a arma —</option>
                        {myWeapons
                          .filter((w) => w.maxAmmo)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name} (⦿ {currentActor.ammo?.[w.id] ?? 0}/{w.maxAmmo})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                {/* Baú: lista o que será recebido. */}
                {actionKind === "special" &&
                  actionObjectRule?.kind === "chest" &&
                  actionObject?.grant?.length && (
                    <p className={styles.staticHint}>
                      Recebe:{" "}
                      {actionObject.grant
                        .map(
                          (g) =>
                            `${state.items.find((i) => i.id === g.id)?.name ?? g.id} ×${g.qty}`,
                        )
                        .join(", ")}
                    </p>
                  )}

                {actionKind === "useItem" ? (
                  <div className={styles.weaponList}>
                    {myConsumables.length === 0 && (
                      <p className={styles.staticHint}>Nenhum consumível.</p>
                    )}
                    {myConsumables.map(({ item, qty }) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`${styles.weaponRow} ${
                          useItemId === item.id ? styles.weaponOn : ""
                        }`}
                        onClick={() => setUseItemId(item.id)}
                      >
                        <span className={styles.weaponName}>
                          {item.name} ×{qty}
                        </span>
                        <span className={styles.weaponMeta}>
                          {item.heal ? `cura +${item.heal} HP` : ""}
                          {item.heal && item.improveState ? " · melhora estado" : ""}
                          {item.ammo ? `munição +${item.ammo}` : ""}
                        </span>
                        {item.description && (
                          <span className={styles.weaponDesc}>{item.description}</span>
                        )}
                      </button>
                    ))}
                    {/* Munição: escolher arma a recarregar. */}
                    {useItemId &&
                      state.items.find((i) => i.id === useItemId)?.ammo &&
                      myWeapons.some((w) => w.maxAmmo) && (
                        <label>
                          Recarregar
                          <select
                            value={reloadWeaponId}
                            onChange={(e) => setReloadWeaponId(e.target.value)}
                          >
                            <option value="">— escolha a arma —</option>
                            {myWeapons
                              .filter((w) => w.maxAmmo)
                              .map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name} (⦿ {currentActor.ammo?.[w.id] ?? 0}/{w.maxAmmo})
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                  </div>
                ) : (
                  <>
                    <label>
                      Alvo (alcance {bandLabel(weaponRangeBand)})
                      <select
                        value={effectiveTargetId}
                        onChange={(e) => setTargetId(e.target.value)}
                      >
                        {targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label} ({String.fromCharCode(65 + t.pos.x)}
                            {t.pos.y + 1}) · {t.hp}/{t.maxHp} HP
                            {t.kind === "object" ? " · objeto" : ` · ${t.state}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    {targets.length === 0 && (
                      <p className={styles.staticHint}>nenhum alvo no alcance</p>
                    )}

                    <div className={styles.charges}>
                      <div className={styles.chargeHead}>
                        <span>Distorção: ataque</span>
                        <span className={styles.chargeCount}>
                          {availableCharges - attackCharges}/{availableCharges} cargas
                        </span>
                      </div>
                      <div className={styles.stepper}>
                        <button
                          type="button"
                          disabled={attackCharges <= 0}
                          onClick={() => setAttackCharges((c) => Math.max(0, c - 1))}
                        >
                          −
                        </button>
                        <span className={styles.dmgPlus}>
                          +{attackCharges * DISTORTION_DMG_PER_CHARGE} dano
                        </span>
                        <button
                          type="button"
                          disabled={attackCharges >= availableCharges}
                          onClick={() => setAttackCharges((c) => c + 1)}
                        >
                          +
                        </button>
                      </div>
                      <p className={styles.chargeNote}>
                        cada carga = +{DISTORTION_DMG_PER_CHARGE} de dano
                      </p>
                    </div>
                  </>
                )}

                <button
                  className={styles.confirm}
                  onClick={confirmAction}
                  disabled={acted}
                >
                  {acted ? "Ação já usada" : "Confirmar ação (sem volta)"}
                </button>
                <button className={styles.endTurn} onClick={endTurn}>
                  Encerrar turno
                </button>
              </>
            )}
          </div>
        )}

        {objectsOnBoard.length > 0 && (
          <div className={styles.objects}>
            <h3>Objetos em campo</h3>
            <ul>
              {objectsOnBoard.map((o) => {
                const rule = ruleOf(o);
                const near = adjObjects.some((a) => a.id === o.id);
                return (
                  <li key={o.id} className={near ? styles.objNear : ""}>
                    <span className={styles.objName}>
                      {o.label} ({String.fromCharCode(65 + o.pos.x)}
                      {o.pos.y + 1})
                      {rule ? ` · ${objectBadge(o)}` : ""}
                      {o.hp !== undefined ? ` · ${o.hp} HP` : ""}
                      {near ? " ◀ adjacente" : ""}
                    </span>
                    <span className={styles.objEffect}>{rule?.description}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {isGM && inspected && <TokenInspector token={inspected} state={state} onClose={() => setInspectId(null)} />}

        <div className={styles.initiative}>
          <h3>Iniciativa</h3>
          <ol>
            {battle.initiative.map((i, idx) => (
              <li key={i.tokenId} className={idx === battle.turnIndex ? styles.curTurn : ""}>
                <span>{i.label}</span>
                <b>{i.value}</b>
              </li>
            ))}
          </ol>
        </div>

      </aside>

      <div className={styles.log}>
        <div className={styles.logHeader}>
          <h3 className={styles.logTitle}>Histórico</h3>
          {isGM && (
            <div className={styles.logActions}>
              <button
                className={styles.logLink}
                onClick={() => emit("gm:advanceTurn", { dir: -1 })}
              >
                ◀ turno
              </button>
              <button
                className={styles.logLink}
                onClick={() => emit("gm:advanceTurn", { dir: 1 })}
              >
                turno ▶
              </button>
              <button
                className={`${styles.logLink} ${styles.logLinkDanger}`}
                onClick={() => emit("gm:endBattle")}
              >
                encerrar combate
              </button>
            </div>
          )}
        </div>
        <div className={styles.logBody}>
          {battle.log.map((l, i) => (
            <div key={i} className={styles.logLine}>
              &gt; {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TokenChip({
  token,
  tokens,
  active,
  onInspect,
}: {
  token: Token;
  tokens: Token[];
  active?: boolean;
  onInspect?: () => void;
}) {
  const stateIdx = token.state ? STATES.indexOf(token.state) : 0;
  const rule = ruleOf(token);
  // Badges de bônus/desvantagem que este token recebe por adjacência.
  const badges =
    token.kind === "object" ? [] : adjacencyMods(token, tokens).badges;
  const isNeutral = token.kind === "enemy" && token.neutral;
  return (
    <div
      className={`${styles.chip} ${styles["chip_" + token.kind]} ${
        isNeutral ? styles.chip_npc : ""
      } ${active ? styles.chipActive : ""}`}
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
      {token.kind === "object" && <span className={styles.chipObj}>◆</span>}
      <span className={styles.chipLabel}>{token.label}</span>
      {(token.kind === "enemy" || token.kind === "player") && (
        <span className={styles.chipHp}>
          {token.hp}/{token.maxHp}
        </span>
      )}
      {token.kind === "object" && token.hp !== undefined && (
        <span className={styles.chipHp}>
          {token.hp}/{token.maxHp} HP
        </span>
      )}
      {(token.kind === "enemy" || token.kind === "player") && token.state && (
        <span className={`${styles.chipState} ${styles["st" + stateIdx]}`}>
          {token.state}
        </span>
      )}
      {(token.kind === "player" || token.kind === "enemy") && (token.charges ?? 0) > 0 && (
        <span className={styles.chipCharges}>⚡{token.charges}</span>
      )}
      {token.kind === "object" && rule && (
        <span className={styles.chipBadge}>{objectBadge(token)}</span>
      )}
      {badges.length > 0 && (
        <span className={styles.chipMods}>
          {badges.map((bdg, i) => (
            <span
              key={i}
              className={bdg.kind === "bonus" ? styles.badgeUp : styles.badgeDown}
            >
              {bdg.badge}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function TokenInspector({
  token,
  state,
  onClose,
}: {
  token: Token;
  state: NonNullable<ReturnType<typeof useGame>["state"]>;
  onClose: () => void;
}) {
  const rule = ruleOf(token);
  const npc = token.npcId ? state.npcs.find((n) => n.id === token.npcId) : null;
  const ch = token.characterId
    ? state.characters.find((c) => c.id === token.characterId)
    : null;
  return (
    <div className={styles.inspector}>
      <div className={styles.inspectHead}>
        <h3>{token.label}</h3>
        <button onClick={onClose}>x</button>
      </div>
      <dl className={styles.inspectBody}>
        <div>
          <dt>tipo</dt>
          <dd>{token.kind}</dd>
        </div>
        <div>
          <dt>posição</dt>
          <dd>
            {String.fromCharCode(65 + token.pos.x)}
            {token.pos.y + 1}
          </dd>
        </div>
        {(token.kind === "enemy" || token.kind === "player") && (
          <>
            <div>
              <dt>HP</dt>
              <dd>
                {token.hp}/{token.maxHp}
              </dd>
            </div>
            <div>
              <dt>estado</dt>
              <dd>{token.state}</dd>
            </div>
          </>
        )}
        {token.kind === "player" && (
          <div>
            <dt>distorção</dt>
            <dd>{token.charges ?? 0} carga(s)</dd>
          </div>
        )}
        {npc && (
          <>
            <div>
              <dt>dano</dt>
              <dd>{npc.damage ?? "—"}</dd>
            </div>
            {npc.description && (
              <div>
                <dt>nota</dt>
                <dd>{npc.description}</dd>
              </div>
            )}
          </>
        )}
        {ch && (
          <>
            <div>
              <dt>nível</dt>
              <dd>{ch.level}</dd>
            </div>
            <div>
              <dt>MV / DF</dt>
              <dd>
                {ch.mv} / {ch.df}
              </dd>
            </div>
            <div>
              <dt>itens</dt>
              <dd>
                {ch.items
                  .map((s) => {
                    const name = state.items.find((i) => i.id === s.id)?.name;
                    return name ? (s.qty > 1 ? `${name} ×${s.qty}` : name) : null;
                  })
                  .filter(Boolean)
                  .join(", ") || "—"}
              </dd>
            </div>
          </>
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
    </div>
  );
}
