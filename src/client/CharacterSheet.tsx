"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./GameProvider";
import {
  HP_BY_LEVEL,
  STATES,
  type CatalogItem,
  type Character,
  type CharState,
} from "@/game/types";
import {
  MAX_COMBAT_ROLES,
  MAX_RP_ROLES,
  combatBonuses,
  combatBonusLabel,
} from "@/game/professions";
import { FREE_HANDS, weaponTypeOf } from "@/game/weapons";
import { AssetImage } from "./AssetImage";
import { cropToSquareDataUrl } from "./image";
import styles from "./CharacterSheet.module.css";

function emptyCharacter(userId: string): Character {
  return {
    id: `chr_${userId}`,
    userId,
    name: "",
    level: 1,
    hp: HP_BY_LEVEL[1],
    maxHp: HP_BY_LEVEL[1],
    mv: 2,
    df: 0,
    picture: "",
    costume: "",
    roles: [],
    items: [],
    state: "Disposto",
  };
}

/** Descrição completa de um item para mostrar ao jogador. */
function itemDesc(it: CatalogItem): string {
  const parts: string[] = [];
  if (it.category === "weapon") {
    const band = it.minRange && it.minRange > 1 ? `${it.minRange}-${it.range ?? 1}` : `${it.range ?? 1}`;
    const type = weaponTypeOf(it) === "firearm" ? "arma de fogo" : "corpo a corpo";
    let w = `Arma (${type}) · dano ${it.damage ?? "—"} · alcance ${band}`;
    if (it.area) w += ` · área ${it.area}`;
    if (it.maxAmmo) w += ` · munição ${it.maxAmmo}`;
    parts.push(w);
  }
  if (it.category === "accessory") {
    const bd: string[] = [];
    if (it.dfBonus) bd.push(`+${it.dfBonus} DF`);
    if (it.mvBonus) bd.push(`${it.mvBonus > 0 ? "+" : ""}${it.mvBonus} MV`);
    parts.push(`Acessório${bd.length ? ` · ${bd.join(", ")}` : ""}`);
  }
  if (it.category === "item") {
    if (it.heal) parts.push(`Cura +${it.heal} HP${it.improveState ? " · melhora estado" : ""}`);
    else if (it.ammo) parts.push(`Munição +${it.ammo}`);
    else parts.push("Item");
  }
  if (it.description) parts.push(it.description);
  return parts.join(" — ");
}

export function CharacterSheet() {
  const { state, session, emit } = useGame();
  const userId = session!.id;
  const existing = useMemo(
    () => state?.characters.find((c) => c.userId === userId) ?? null,
    [state, userId],
  );
  const [draft, setDraft] = useState<Character>(existing ?? emptyCharacter(userId));
  const [tab, setTab] = useState<"disfarce" | "profissoes" | "itens">("disfarce");
  const fileRef = useRef<HTMLInputElement>(null);

  // Inicializa o rascunho uma vez a partir do que existe; depois o estado local
  // é a fonte de verdade (evita o servidor sobrescrever enquanto se edita).
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    if (existing) setDraft(existing);
    initRef.current = true;
  }, [existing]);

  if (!state) return null;

  const professions = state.professions;
  const combatProfs = professions.filter((p) => p.kind === "combat");
  const rpProfs = professions.filter((p) => p.kind === "rp");
  const combatCount = draft.roles.filter(
    (r) => professions.find((p) => p.id === r)?.kind === "combat",
  ).length;
  const rpCount = draft.roles.filter(
    (r) => professions.find((p) => p.id === r)?.kind === "rp",
  ).length;

  // mv/df/hp derivados dos acessórios equipados + profissões de combate.
  const ownedIds = new Set(draft.items.map((s) => s.id));
  const accessories = state.items.filter(
    (i) => i.category === "accessory" && ownedIds.has(i.id),
  );
  const bonus = combatBonuses(draft.roles, professions);
  const derivedMv =
    2 + accessories.reduce((s, a) => s + (a.mvBonus ?? 0), 0) + bonus.mv;
  const derivedDf =
    0 + accessories.reduce((s, a) => s + (a.dfBonus ?? 0), 0) + bonus.df;
  const derivedMaxHp = HP_BY_LEVEL[draft.level] + bonus.hp;

  // Auto-save: sem botão. Persiste ~500ms após a última mudança.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      emit("character:save", {
        ...draft,
        mv: Math.max(0, derivedMv),
        df: Math.max(0, derivedDf),
        maxHp: derivedMaxHp,
        hp: Math.min(draft.hp, derivedMaxHp),
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, derivedMv, derivedDf, derivedMaxHp]);

  function set<K extends keyof Character>(key: K, value: Character[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLevel(level: 0 | 1 | 2 | 3) {
    const maxHp = HP_BY_LEVEL[level];
    setDraft((d) => ({
      ...d,
      level,
      maxHp,
      hp: Math.min(d.hp, maxHp) || maxHp,
    }));
  }

  // Liga/desliga uma profissão, respeitando o limite por tipo (2 combate, 2 RP).
  function toggleRole(id: string) {
    const prof = professions.find((p) => p.id === id);
    if (!prof) return;
    setDraft((d) => {
      if (d.roles.includes(id)) {
        return { ...d, roles: d.roles.filter((x) => x !== id) };
      }
      const sameKind = d.roles.filter(
        (r) => professions.find((p) => p.id === r)?.kind === prof.kind,
      ).length;
      const max = prof.kind === "combat" ? MAX_COMBAT_ROLES : MAX_RP_ROLES;
      if (sameKind >= max) return d;
      return { ...d, roles: [...d.roles, id] };
    });
  }

  // Inventário com quantidade. Acessórios/armas: máx 1. Consumíveis: até 9.
  function setItemQty(id: string, qty: number) {
    setDraft((d) => {
      const others = d.items.filter((s) => s.id !== id);
      if (qty <= 0) return { ...d, items: others };
      // limite de 10 tipos distintos
      if (!d.items.some((s) => s.id === id) && d.items.length >= 10) return d;
      return { ...d, items: [...others, { id, qty }] };
    });
  }

  async function onPicture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await cropToSquareDataUrl(file, 256);
    set("picture", dataUrl);
  }

  return (
    <div className={styles.sheet}>
      <div className={styles.head}>
        <h2>Ficha de Personagem</h2>
        <span className={styles.autosave}>● salvo automaticamente</span>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <div className={styles.avatar} onClick={() => fileRef.current?.click()}>
            <AssetImage
              kind="characters"
              id={draft.id}
              ver={draft.pictureVer}
              inline={draft.picture || undefined}
              alt="foto"
              fallback={<span>+ foto</span>}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onPicture}
          />
          <div className={styles.derived}>
            <div>
              <span>HP</span>
              <b>{derivedMaxHp}</b>
            </div>
            <div>
              <span>MV</span>
              <b>{Math.max(0, derivedMv)}</b>
            </div>
            <div>
              <span>DF</span>
              <b>{Math.max(0, derivedDf)}</b>
            </div>
          </div>
        </div>

        <div className={styles.fields}>
          <label>
            Nome
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </label>

          <div className={styles.row}>
            <label>
              Nível
              <select
                value={draft.level}
                onChange={(e) => setLevel(Number(e.target.value) as 0 | 1 | 2 | 3)}
              >
                {[0, 1, 2, 3].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select
                value={draft.state}
                onChange={(e) => set("state", e.target.value as CharState)}
              >
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              HP atual
              <input
                type="number"
                value={draft.hp}
                min={0}
                max={derivedMaxHp}
                onChange={(e) => set("hp", Number(e.target.value))}
              />
            </label>
          </div>

          {/* Disfarce, profissões e itens em abas (evita scroll gigante). */}
          <div className={styles.tabs}>
            {([
              ["disfarce", `Disfarce`],
              ["profissoes", `Profissões ${combatCount + rpCount}`],
              ["itens", `Itens ${draft.items.length}`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? styles.tabOn : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "disfarce" && (
            <SelectList
              title="Disfarce"
              hint="escolha 1"
              options={state.disguises.map((d) => ({ id: d.name, name: d.name, desc: d.description }))}
              selected={draft.costume ? [draft.costume] : []}
              onToggle={(name) => set("costume", draft.costume === name ? "" : name)}
            />
          )}

          {tab === "profissoes" && (
            <>
              <SelectList
                title="Combate"
                hint={`${combatCount}/${MAX_COMBAT_ROLES} · dão vantagem em batalha`}
                options={combatProfs.map((p) => ({
                  id: p.id,
                  name: p.name,
                  hack: p.hack_found,
                  desc:
                    (combatBonusLabel(p) ? `[${combatBonusLabel(p)}] ` : "") + p.description,
                }))}
                selected={draft.roles}
                onToggle={toggleRole}
              />
              <SelectList
                title="RP"
                hint={`${rpCount}/${MAX_RP_ROLES} · narrativa`}
                options={rpProfs.map((p) => ({
                  id: p.id,
                  name: p.name,
                  hack: p.hack_found,
                  desc: p.description,
                }))}
                selected={draft.roles}
                onToggle={toggleRole}
              />
            </>
          )}

          {tab === "itens" && (
            <QuantityList
              title="Itens"
              hint={`${draft.items.length}/10 tipos`}
              options={[
                // Mãos Livres é embutida e sempre disponível — fixa, não editável.
                {
                  id: FREE_HANDS.id,
                  name: FREE_HANDS.name,
                  desc: itemDesc(FREE_HANDS),
                  max: 1,
                  locked: true,
                },
                ...state.items.map((i) => ({
                  id: i.id,
                  name: i.name,
                  desc: itemDesc(i),
                  // armas e acessórios são únicos (máx 1); consumíveis até 9.
                  max: i.category === "item" ? 9 : 1,
                })),
              ]}
              qtyOf={(id) => draft.items.find((s) => s.id === id)?.qty ?? 0}
              onSet={setItemQty}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface QtyOption {
  id: string;
  name: string;
  desc: string;
  max: number;
  usable?: boolean;
  /** item fixo (ex.: Mãos Livres): sempre 1, não dá pra aumentar/diminuir. */
  locked?: boolean;
}

/** Lista de itens com stepper de quantidade. */
function QuantityList({
  title,
  hint,
  options,
  qtyOf,
  onSet,
  onUse,
}: {
  title: string;
  hint?: string;
  options: QtyOption[];
  qtyOf: (id: string) => number;
  onSet: (id: string, qty: number) => void;
  onUse?: (id: string) => void;
}) {
  return (
    <div className={styles.list}>
      <div className={styles.listHead}>
        <span className={styles.listTitle}>{title}</span>
        {hint && <span className={styles.listHint}>{hint}</span>}
      </div>
      <div className={styles.rows}>
        {options.length === 0 && <p className="muted">Nada cadastrado.</p>}
        {options.map((o) => {
          const qty = o.locked ? 1 : qtyOf(o.id);
          return (
            <div key={o.id} className={`${styles.optRow} ${qty > 0 ? styles.optOn : ""}`}>
              <span className={styles.qtyStepper}>
                <button
                  type="button"
                  disabled={o.locked || qty <= 0}
                  onClick={() => onSet(o.id, qty - 1)}
                >
                  −
                </button>
                <b>{qty}</b>
                <button
                  type="button"
                  disabled={o.locked || qty >= o.max}
                  onClick={() => onSet(o.id, qty + 1)}
                >
                  +
                </button>
              </span>
              <span className={styles.optBody}>
                <span className={styles.optName}>{o.name}</span>
                <span className={styles.optDesc}>{o.desc}</span>
              </span>
              {o.usable && qty > 0 && onUse && (
                <button type="button" className={styles.useBtn} onClick={() => onUse(o.id)}>
                  usar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Option {
  id: string;
  name: string;
  desc: string;
  /** undefined = não mostra badge; true/false = HACK ✓ / SEM HACK. */
  hack?: boolean;
}

/** Lista em tabela: nome + descrição completa, um por linha (o jogador não vê os cadastros). */
function SelectList({
  title,
  hint,
  options,
  selected,
  onToggle,
}: {
  title: string;
  hint?: string;
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className={styles.list}>
      <div className={styles.listHead}>
        <span className={styles.listTitle}>{title}</span>
        {hint && <span className={styles.listHint}>{hint}</span>}
      </div>
      <div className={styles.rows}>
        {options.length === 0 && <p className="muted">Nada cadastrado.</p>}
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              className={`${styles.optRow} ${on ? styles.optOn : ""}`}
              onClick={() => onToggle(o.id)}
            >
              <span className={styles.mark}>{on ? "▣" : "▢"}</span>
              <span className={styles.optBody}>
                <span className={styles.optName}>
                  {o.name}
                  {o.hack !== undefined && (
                    <span className={o.hack ? styles.tagHack : styles.tagNoHack}>
                      {o.hack ? "HACK ✓" : "SEM HACK"}
                    </span>
                  )}
                </span>
                <span className={styles.optDesc}>{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
