"use client";

import { useEffect, useMemo, useState } from "react";
import { useGame } from "./GameProvider";
import type { ActionKind, Token } from "@/game/types";
import { STATES } from "@/game/types";
import { adjacencyMods, ruleOf } from "@/game/objects";
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
  const [inspectId, setInspectId] = useState<string | null>(null);

  // Recomeça o fluxo quando muda o ator/turno.
  useEffect(() => {
    setPhase("move");
    setStagedPos(null);
    setActionKind("attack");
    setTargetId("");
    setWeaponId("");
    setActionObjectId("");
    setMoveCharges(0);
    setAttackCharges(0);
  }, [currentActor?.id, battle?.turnIndex]);

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

  const myWeapons = (() => {
    if (!currentActor?.characterId) return [];
    const ch = state.characters.find((c) => c.id === currentActor.characterId);
    if (!ch) return [];
    return state.items.filter((i) => i.category === "weapon" && ch.items.includes(i.id));
  })();

  const selectedWeapon = state.items.find((i) => i.id === weaponId);
  const weaponRange = actionKind === "attack" ? selectedWeapon?.range ?? 1 : 1;

  // Objetos em campo e os adjacentes ao ator (efeitos automáticos e visíveis).
  const objectsOnBoard = battle.tokens.filter((t) => t.kind === "object");
  const adjObjects = objectsOnBoard.filter((o) => manhattan(actorPos, o.pos) <= 1);
  // Modificador de ATAQUE que o ator recebe por adjacência a objetos.
  const adjMod = adjacencyMods({ ...currentActor!, pos: actorPos }, battle.tokens).attack;
  // Objetos com ação especial adjacentes ao ator (ex.: chutar a mesa).
  const adjActionObjects = adjObjects.filter((o) => ruleOf(o)?.kind === "action");
  const hasActionObject = adjActionObjects.length > 0;
  const actionObject = adjActionObjects.find((o) => o.id === actionObjectId) ?? null;

  const occupied = (x: number, y: number) =>
    battle.tokens.some((t) => t.id !== currentActor?.id && t.pos.x === x && t.pos.y === y);

  // Casas alcançáveis no passo de movimento (Manhattan ≤ mv, vazias).
  const reachable = (x: number, y: number) =>
    phase === "move" &&
    controlsActor &&
    manhattan(actorPos, { x, y }) <= actorMv &&
    !occupied(x, y);

  // Alvos no passo de ação — NUNCA objetos, apenas jogadores/inimigos.
  const isObjectAction = actionKind === "special" && !!actionObject;
  const targets =
    phase !== "action" || !controlsActor
      ? []
      : isObjectAction && actionObject
        ? // Ação de objeto (ex.: chutar mesa): alvos em linha reta a partir do objeto.
          battle.tokens.filter(
            (t) =>
              t.id !== currentActor?.id &&
              (t.kind === "enemy" || t.kind === "player") &&
              (t.pos.x === actionObject.pos.x || t.pos.y === actionObject.pos.y),
          )
        : // Ataque/uso: jogadores/inimigos dentro do alcance.
          battle.tokens.filter(
            (t) =>
              t.id !== currentActor?.id &&
              (t.kind === "enemy" || t.kind === "player") &&
              manhattan(actorPos, t.pos) <= weaponRange,
          );

  // Se o alvo escolhido sumiu da lista (ou não há), assume o primeiro automaticamente.
  const effectiveTargetId = targets.some((t) => t.id === targetId)
    ? targetId
    : targets[0]?.id ?? "";

  const tokenAt = (x: number, y: number) =>
    battle.tokens.find((t) => t.pos.x === x && t.pos.y === y);

  const inspected = inspectId ? battle.tokens.find((t) => t.id === inspectId) ?? null : null;

  function clickCell(x: number, y: number) {
    if (phase !== "move" || !controlsActor) return;
    if (reachable(x, y) || (x === actorPos.x && y === actorPos.y)) {
      setStagedPos({ x, y });
    }
  }

  function confirmMove() {
    if (!currentActor || !state) return;
    const dest = stagedPos ?? actorPos;
    if (dest.x !== actorPos.x || dest.y !== actorPos.y) {
      emit("player:moveToken", { tokenId: currentActor.id, pos: dest, moveCharges });
    } else {
      // não saiu do lugar → não gasta carga de movimento
      setMoveCharges(0);
    }

    const enemiesAndAllies = battle!.tokens.filter(
      (t) => t.id !== currentActor.id && (t.kind === "enemy" || t.kind === "player"),
    );

    // Alcance máximo considerando TODAS as armas em posse (+ mãos livres = 1).
    const maxRange = Math.max(1, ...myWeapons.map((w) => w.range ?? 1));
    const hasReachableTarget = enemiesAndAllies.some(
      (t) => manhattan(dest, t.pos) <= maxRange,
    );

    // Objeto de ação adjacente ao destino com algum alvo em linha reta.
    const actionObjAtDest = battle!.tokens.find(
      (o) => ruleOf(o)?.kind === "action" && manhattan(dest, o.pos) <= 1,
    );
    const actionObjHasTarget =
      !!actionObjAtDest &&
      enemiesAndAllies.some(
        (t) => t.pos.x === actionObjAtDest.pos.x || t.pos.y === actionObjAtDest.pos.y,
      );

    // Item usável em posse (categoria "item").
    const actorChar = currentActor.characterId
      ? state.characters.find((c) => c.id === currentActor.characterId)
      : null;
    const hasUsableItem =
      !!actorChar &&
      state.items.some(
        (i) => i.category === "item" && actorChar.items.includes(i.id),
      );

    // Sem alvo para qualquer arma, sem objeto de ação útil e sem item → encerra o turno.
    if (!hasReachableTarget && !actionObjHasTarget && !hasUsableItem) {
      emit("player:endTurn");
      return;
    }

    if (actionObjAtDest && actionObjHasTarget) {
      setActionKind("special");
      setActionObjectId(actionObjAtDest.id);
    } else {
      setActionKind("attack");
    }
    setPhase("action");
  }

  function confirmAction() {
    if (!currentActor) return;
    emit("player:confirmAction", {
      tokenId: currentActor.id,
      kind: actionKind,
      targetId: effectiveTargetId || undefined,
      detail: actionKind === "attack" ? weaponId || undefined : undefined,
      objectId: isObjectAction ? actionObjectId : undefined,
      attackCharges,
    });
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
            const isStaged = stagedPos && stagedPos.x === x && stagedPos.y === y;
            const isActorCell = actorPos.x === x && actorPos.y === y;
            const isTarget = targets.some((t) => t.pos.x === x && t.pos.y === y);
            return (
              <div
                key={idx}
                className={[
                  styles.cell,
                  canReach && !tok ? styles.reach : "",
                  isStaged ? styles.staged : "",
                  isTarget ? styles.target : "",
                  isActorCell && currentActor ? styles.actorCell : "",
                ].join(" ")}
                onClick={() => clickCell(x, y)}
              >
                <span className={styles.coord}>
                  {String.fromCharCode(65 + x)}
                  {y + 1}
                </span>
                {isStaged && phase === "move" && (
                  <span className={styles.moveHere}>se mover pra cá</span>
                )}
                {tok && (
                  <TokenChip
                    token={tok}
                    tokens={battle.tokens}
                    active={tok.id === currentActor?.id}
                    onInspect={isGM ? () => setInspectId(tok.id) : undefined}
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

            {phase === "move" ? (
              <>
                <p className="muted">
                  Passo 1 — mover. Escolha uma casa destacada (mv {actorMv}) e confirme.
                  Diagonal custa 2.
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

                <button className={styles.confirm} onClick={confirmMove}>
                  Confirmar movimento ▶
                </button>
                <button className={styles.endTurn} onClick={() => emit("player:endTurn")}>
                  Encerrar turno sem agir
                </button>
              </>
            ) : (
              <>
                <p className="muted">Passo 2 — escolha sua ação.</p>

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
                  <label>
                    Arma
                    <select
                      value={weaponId}
                      onChange={(e) => {
                        setWeaponId(e.target.value);
                        setTargetId("");
                      }}
                    >
                      <option value="">Mãos Livres (1d4 · alc 1)</option>
                      {myWeapons.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.damage} · alc {w.range ?? 1}
                          {w.area ? ` · área ${w.area}` : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {actionKind === "special" && (
                  <label>
                    Objeto adjacente
                    <select
                      value={actionObjectId}
                      onChange={(e) => {
                        setActionObjectId(e.target.value);
                        setTargetId("");
                      }}
                    >
                      <option value="">— ação livre —</option>
                      {adjActionObjects.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label} ({ruleOf(o)?.damage})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {actionObject && (
                  <p className={styles.staticHint}>{ruleOf(actionObject)?.description}</p>
                )}

                <label>
                  Alvo (alcance {weaponRange})
                  <select
                    value={effectiveTargetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({String.fromCharCode(65 + t.pos.x)}
                        {t.pos.y + 1}) · {t.hp}/{t.maxHp} HP · {t.state}
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

                <button className={styles.confirm} onClick={confirmAction}>
                  Confirmar ação (sem volta)
                </button>
                <button className={styles.endTurn} onClick={() => emit("player:endTurn")}>
                  Encerrar turno sem agir
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
                      {rule ? ` · ${rule.badge}` : ""}
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

        {isGM && (
          <div className={styles.gmControls}>
            <h3>GM</h3>
            <p className="muted">clique num token para inspecionar.</p>
            <div className={styles.turnBtns}>
              <button onClick={() => emit("gm:advanceTurn", { dir: -1 })}>◀ turno</button>
              <button onClick={() => emit("gm:advanceTurn", { dir: 1 })}>turno ▶</button>
            </div>
            <button className="danger" onClick={() => emit("gm:endBattle")}>
              Encerrar batalha
            </button>
          </div>
        )}
      </aside>

      <div className={styles.log}>
        <h3 className={styles.logTitle}>Histórico</h3>
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
      {(token.kind === "enemy" || token.kind === "player") && token.state && (
        <span className={`${styles.chipState} ${styles["st" + stateIdx]}`}>
          {token.state}
        </span>
      )}
      {(token.kind === "player" || token.kind === "enemy") && (token.charges ?? 0) > 0 && (
        <span className={styles.chipCharges}>⚡{token.charges}</span>
      )}
      {token.kind === "object" && rule && (
        <span className={styles.chipBadge}>{rule.badge}</span>
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
                  .map((id) => state.items.find((i) => i.id === id)?.name)
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
