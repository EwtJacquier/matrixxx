"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./GameProvider";
import {
  HP_BY_LEVEL,
  SLOTS_BY_LEVEL,
  STATES,
  type CatalogItem,
  type Character,
  type CharState,
} from "@/game/types";
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
    hacks: [],
    items: [],
    state: "Disposto",
  };
}

/** Descrição completa de um item para mostrar ao jogador. */
function itemDesc(it: CatalogItem): string {
  const parts: string[] = [];
  if (it.category === "weapon") {
    const band = it.minRange && it.minRange > 1 ? `${it.minRange}-${it.range ?? 1}` : `${it.range ?? 1}`;
    let w = `Arma · dano ${it.damage ?? "—"} · alcance ${band}`;
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
  const [tab, setTab] = useState<"disfarce" | "profissoes" | "hacks" | "itens">("disfarce");
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

  const slots = SLOTS_BY_LEVEL[draft.level];

  // mv/df derivados dos acessórios equipados (entre os itens do inventário).
  const ownedIds = new Set(draft.items.map((s) => s.id));
  const accessories = state.items.filter(
    (i) => i.category === "accessory" && ownedIds.has(i.id),
  );
  const derivedMv = 2 + accessories.reduce((s, a) => s + (a.mvBonus ?? 0), 0);
  const derivedDf = 0 + accessories.reduce((s, a) => s + (a.dfBonus ?? 0), 0);

  // Auto-save: sem botão. Persiste ~500ms após a última mudança.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      emit("character:save", { ...draft, mv: derivedMv, df: derivedDf });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, derivedMv, derivedDf]);

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
      roles: d.roles.slice(0, SLOTS_BY_LEVEL[level]),
      hacks: d.hacks.slice(0, SLOTS_BY_LEVEL[level]),
    }));
  }

  function toggleInList(key: "roles" | "hacks", id: string, max: number) {
    setDraft((d) => {
      const cur = d[key];
      if (cur.includes(id)) return { ...d, [key]: cur.filter((x) => x !== id) };
      if (cur.length >= max) return d;
      return { ...d, [key]: [...cur, id] };
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
            {draft.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.picture} alt="foto" />
            ) : (
              <span>+ foto</span>
            )}
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
              <b>{draft.maxHp}</b>
            </div>
            <div>
              <span>MV</span>
              <b>{derivedMv}</b>
            </div>
            <div>
              <span>DF</span>
              <b>{derivedDf}</b>
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
                max={draft.maxHp}
                onChange={(e) => set("hp", Number(e.target.value))}
              />
            </label>
          </div>

          {/* Disfarce, profissões, hacks e itens em abas (evita scroll gigante). */}
          <div className={styles.tabs}>
            {([
              ["disfarce", `Disfarce`],
              ["profissoes", `Profissões ${draft.roles.length}/${slots}`],
              ["hacks", `Hacks ${draft.hacks.length}/${slots}`],
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
            <SelectList
              title="Profissões"
              hint={`${draft.roles.length}/${slots}`}
              options={state.professions.map((p) => ({
                id: p.id,
                name: p.name,
                desc: p.description + (p.hack_found ? " (hack disponível)" : ""),
              }))}
              selected={draft.roles}
              onToggle={(id) => toggleInList("roles", id, slots)}
            />
          )}

          {tab === "hacks" && (
            <SelectList
              title="Hacks"
              hint={`${draft.hacks.length}/${slots}`}
              options={state.hacks.map((h) => ({ id: h.id, name: h.name, desc: h.description }))}
              selected={draft.hacks}
              onToggle={(id) => toggleInList("hacks", id, slots)}
            />
          )}

          {tab === "itens" && (
            <QuantityList
              title="Itens"
              hint={`${draft.items.length}/10 tipos`}
              options={state.items.map((i) => ({
                id: i.id,
                name: i.name,
                desc: itemDesc(i),
                // armas e acessórios são únicos (máx 1); consumíveis até 9.
                max: i.category === "item" ? 9 : 1,
              }))}
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
          const qty = qtyOf(o.id);
          return (
            <div key={o.id} className={`${styles.optRow} ${qty > 0 ? styles.optOn : ""}`}>
              <span className={styles.qtyStepper}>
                <button
                  type="button"
                  disabled={qty <= 0}
                  onClick={() => onSet(o.id, qty - 1)}
                >
                  −
                </button>
                <b>{qty}</b>
                <button
                  type="button"
                  disabled={qty >= o.max}
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
                <span className={styles.optName}>{o.name}</span>
                <span className={styles.optDesc}>{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
