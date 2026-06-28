"use client";

import { useState } from "react";
import { useGame } from "./GameProvider";
import { OBJECT_RULES, OBJECT_RULE_LIST, type ObjectRuleId } from "@/game/objects";
import type {
  BattleTemplate,
  CatalogItem,
  Disguise,
  GameObject,
  Hack,
  MusicMeta,
  MusicTrack,
  Npc,
  Profession,
  Scenario,
} from "@/game/types";
import { cropToSquareDataUrl, fileToDataUrl } from "./image";
import { audioDuration, fmtTime } from "./audio";
import { FREE_HANDS_ID } from "@/game/weapons";
import styles from "./CatalogAdmin.module.css";

type Kind =
  | "scenarios"
  | "items"
  | "hacks"
  | "disguises"
  | "professions"
  | "npcs"
  | "objects"
  | "battleTemplates"
  | "music";

const TABS: { kind: Kind; label: string }[] = [
  { kind: "scenarios", label: "Cenários" },
  { kind: "npcs", label: "Inimigos/NPCs" },
  { kind: "objects", label: "Objetos" },
  { kind: "battleTemplates", label: "Modelos de Batalha" },
  { kind: "items", label: "Itens/Armas" },
  { kind: "professions", label: "Profissões" },
  { kind: "hacks", label: "Hacks" },
  { kind: "disguises", label: "Disfarces" },
  { kind: "music", label: "Músicas" },
];

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

const DIE_RE = /^\s*\d+\s*d\s*\d+\s*$/i;

/** Separa uma fórmula "1d6+2" em dado ("1d6") e dano fixo ("2"). */
function splitDamage(formula?: string): { die: string; flat: string } {
  if (!formula) return { die: "", flat: "" };
  const m = /^\s*(\d+\s*d\s*\d+)\s*([+-]\s*\d+)?\s*$/i.exec(formula);
  if (!m) return { die: formula.trim(), flat: "" };
  const die = m[1].replace(/\s+/g, "");
  const flat = m[2] ? m[2].replace(/\s+/g, "").replace(/^\+/, "") : "";
  return { die, flat };
}

/** Junta dado + dano fixo numa fórmula. Mantém o dado durante a edição. */
function combineDamage(die: string, flat: string): string {
  const d = die.trim();
  if (!d) return "";
  const n = Number(flat);
  if (flat === "" || Number.isNaN(n) || n === 0) return d;
  return `${d}${n > 0 ? "+" : ""}${n}`;
}

/** Arma exige dado válido + dano fixo obrigatório (≥ 1). */
function validWeaponDamage(formula?: string): boolean {
  const { die, flat } = splitDamage(formula);
  return DIE_RE.test(die) && Number(flat) >= 1;
}

export function CatalogAdmin() {
  const { state, emit } = useGame();
  const [tab, setTab] = useState<Kind>("scenarios");
  if (!state) return null;

  const upsert = (entity: { id: string }) =>
    emit("catalog:upsert", { kind: tab, entity });
  const remove = (id: string) => emit("catalog:remove", { kind: tab, id });

  return (
    <div className={styles.admin}>
      <h2>Cadastros</h2>
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.kind}
            className={tab === t.kind ? styles.active : ""}
            onClick={() => setTab(t.kind)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "scenarios" && (
        <ScenarioForm
          items={state.scenarios}
          onSave={upsert}
          onRemove={remove}
        />
      )}
      {tab === "npcs" && (
        <NpcForm
          items={state.npcs}
          catalogItems={state.items}
          onSave={upsert}
          onRemove={remove}
        />
      )}
      {tab === "objects" && (
        <ObjectForm
          items={state.objects}
          catalogItems={state.items}
          onSave={upsert}
          onRemove={remove}
        />
      )}
      {tab === "battleTemplates" && (
        <TemplatesManager items={state.battleTemplates} onSave={upsert} onRemove={remove} />
      )}
      {tab === "items" && (
        <ItemForm items={state.items} onSave={upsert} onRemove={remove} />
      )}
      {tab === "professions" && (
        <ProfessionForm items={state.professions} onSave={upsert} onRemove={remove} />
      )}
      {tab === "hacks" && (
        <NamedForm
          items={state.hacks}
          prefix="hack"
          onSave={upsert}
          onRemove={remove}
        />
      )}
      {tab === "disguises" && (
        <NamedForm
          items={state.disguises}
          prefix="dis"
          onSave={upsert}
          onRemove={remove}
        />
      )}
      {tab === "music" && (
        <MusicForm items={state.music} onSave={upsert} onRemove={remove} />
      )}
    </div>
  );
}

function List({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.list}>{children}</div>;
}

function Row({
  title,
  subtitle,
  onEdit,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className={styles.rowActions}>
        <button onClick={onEdit}>editar</button>
        <button className="danger" onClick={onRemove}>
          x
        </button>
      </div>
    </div>
  );
}

// --- Cenários ---
function ScenarioForm({
  items,
  onSave,
  onRemove,
}: {
  items: Scenario[];
  onSave: (e: Scenario) => void;
  onRemove: (id: string) => void;
}) {
  const blank: Scenario = { id: uid("scn"), name: "", image: "", distortion: 0 };
  const [draft, setDraft] = useState<Scenario>(blank);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const image = await fileToDataUrl(f);
    setDraft((d) => ({ ...d, image }));
  }

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Distorção inicial (0-10)
          <input
            type="number"
            min={0}
            max={10}
            value={draft.distortion}
            onChange={(e) => setDraft({ ...draft, distortion: Number(e.target.value) })}
          />
        </label>
        <label>
          Imagem
          <input type="file" accept="image/*" onChange={pickImage} />
        </label>
        {draft.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.image} alt="" className={styles.preview} />
        )}
        <div className={styles.formBtns}>
          <button
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("scn") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("scn") })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((s) => (
          <Row
            key={s.id}
            title={s.name}
            subtitle={`distorção ${s.distortion}`}
            onEdit={() => setDraft(s)}
            onRemove={() => onRemove(s.id)}
          />
        ))}
      </List>
    </div>
  );
}

// --- Itens/Armas ---
function ItemForm({
  items,
  onSave,
  onRemove,
}: {
  items: CatalogItem[];
  onSave: (e: CatalogItem) => void;
  onRemove: (id: string) => void;
}) {
  const blank: CatalogItem = { id: uid("itm"), category: "weapon", name: "" };
  const [draft, setDraft] = useState<CatalogItem>(blank);
  const [listTab, setListTab] = useState<CatalogItem["category"]>("weapon");

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Categoria
          <select
            value={draft.category}
            onChange={(e) =>
              setDraft({ ...draft, category: e.target.value as CatalogItem["category"] })
            }
          >
            <option value="weapon">Arma</option>
            <option value="accessory">Acessório</option>
            <option value="item">Item</option>
          </select>
        </label>
        {draft.category === "weapon" && (
          <>
            <div className={styles.row2}>
              <label>
                Dado (ex.: 1d6)
                <input
                  value={splitDamage(draft.damage).die}
                  placeholder="1d6"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      damage: combineDamage(e.target.value, splitDamage(draft.damage).flat),
                    })
                  }
                />
              </label>
              <label>
                Dano fixo (obrigatório)
                <input
                  type="number"
                  min={1}
                  value={splitDamage(draft.damage).flat}
                  placeholder="2"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      damage: combineDamage(splitDamage(draft.damage).die, e.target.value),
                    })
                  }
                />
              </label>
            </div>
            {!validWeaponDamage(draft.damage) && (
              <p className="danger">Toda arma precisa de dado + dano fixo (≥ 1). Ex.: 1d6 + 2.</p>
            )}
            <div className={styles.row2}>
              <label>
                Alcance mín.
                <input
                  type="number"
                  min={1}
                  value={draft.minRange ?? 1}
                  onChange={(e) => setDraft({ ...draft, minRange: Number(e.target.value) })}
                />
              </label>
              <label>
                Alcance máx.
                <input
                  type="number"
                  min={1}
                  value={draft.range ?? 1}
                  onChange={(e) => setDraft({ ...draft, range: Number(e.target.value) })}
                />
              </label>
              <label>
                Área (raio)
                <input
                  type="number"
                  min={0}
                  value={draft.area ?? 0}
                  onChange={(e) => setDraft({ ...draft, area: Number(e.target.value) })}
                />
              </label>
              <label>
                Munição
                <input
                  type="number"
                  min={0}
                  value={draft.maxAmmo ?? 0}
                  onChange={(e) => setDraft({ ...draft, maxAmmo: Number(e.target.value) })}
                />
              </label>
            </div>
          </>
        )}
        {draft.category === "accessory" && (
          <div className={styles.row2}>
            <label>
              +DF
              <input
                type="number"
                value={draft.dfBonus ?? 0}
                onChange={(e) => setDraft({ ...draft, dfBonus: Number(e.target.value) })}
              />
            </label>
            <label>
              +MV
              <input
                type="number"
                value={draft.mvBonus ?? 0}
                onChange={(e) => setDraft({ ...draft, mvBonus: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <label>
          Descrição
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <div className={styles.formBtns}>
          <button
            disabled={!draft.name || (draft.category === "weapon" && !validWeaponDamage(draft.damage))}
            onClick={() => {
              if (!draft.name) return;
              if (draft.category === "weapon" && !validWeaponDamage(draft.damage)) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("itm") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("itm") })}>Limpar</button>
        </div>
      </div>
      <div>
        <div className={styles.tabs}>
          {(
            [
              ["weapon", "Armas"],
              ["accessory", "Acessórios"],
              ["item", "Itens"],
            ] as const
          ).map(([cat, label]) => (
            <button
              key={cat}
              className={listTab === cat ? styles.active : ""}
              onClick={() => setListTab(cat)}
            >
              {label} ({items.filter((i) => i.category === cat && i.id !== FREE_HANDS_ID).length})
            </button>
          ))}
        </div>
        <List>
          {items
            .filter((it) => it.category === listTab && it.id !== FREE_HANDS_ID)
            .map((it) => (
              <Row
                key={it.id}
                title={it.name}
                subtitle={
                  it.category === "weapon"
                    ? `${it.damage ?? "—"} · alc ${
                        it.minRange && it.minRange > 1
                          ? `${it.minRange}-${it.range ?? 1}`
                          : it.range ?? 1
                      }${it.maxAmmo ? ` · ⦿${it.maxAmmo}` : ""}`
                    : it.category === "accessory"
                      ? [it.dfBonus ? `+${it.dfBonus} DF` : "", it.mvBonus ? `${it.mvBonus > 0 ? "+" : ""}${it.mvBonus} MV` : ""].filter(Boolean).join(" ") || "acessório"
                      : it.heal
                        ? `cura +${it.heal}`
                        : it.ammo
                          ? `munição +${it.ammo}`
                          : "item"
                }
                onEdit={() => setDraft(it)}
                onRemove={() => onRemove(it.id)}
              />
            ))}
        </List>
      </div>
    </div>
  );
}

// --- Inimigos / NPCs ---
function NpcForm({
  items,
  catalogItems,
  onSave,
  onRemove,
}: {
  items: Npc[];
  catalogItems: CatalogItem[];
  onSave: (e: Npc) => void;
  onRemove: (id: string) => void;
}) {
  const blank: Npc = { id: uid("npc"), name: "", hp: 10, weapons: [], description: "" };
  const [draft, setDraft] = useState<Npc>(blank);
  const weaponList = catalogItems.filter(
    (i) => i.category === "weapon" && i.id !== FREE_HANDS_ID,
  );

  function toggleWeapon(id: string) {
    setDraft((d) => {
      const cur = d.weapons ?? [];
      if (cur.includes(id)) return { ...d, weapons: cur.filter((w) => w !== id) };
      if (cur.length >= 3) return d; // máximo 3 armas
      return { ...d, weapons: [...cur, id] };
    });
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const picture = await cropToSquareDataUrl(f, 256);
    setDraft((d) => ({ ...d, picture }));
  }

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <div className={styles.row2}>
          <label>
            HP
            <input
              type="number"
              min={1}
              value={draft.hp}
              onChange={(e) => setDraft({ ...draft, hp: Number(e.target.value) })}
            />
          </label>
          <label>
            Nível
            <select
              value={draft.level ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, level: Number(e.target.value) as 0 | 1 | 2 | 3 })
              }
            >
              {[0, 1, 2, 3].map((l) => (
                <option key={l} value={l}>
                  {l} ({l + 1} cargas)
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Tipo
          <select
            value={draft.hostile === false ? "npc" : "enemy"}
            onChange={(e) => setDraft({ ...draft, hostile: e.target.value === "enemy" })}
          >
            <option value="enemy">Inimigo (vermelho)</option>
            <option value="npc">NPC neutro (branco)</option>
          </select>
        </label>
        <div className={styles.picker}>
          <span className={styles.pickerTitle}>
            Armas ({(draft.weapons ?? []).length}/3)
          </span>
          <div className={styles.chips}>
            {weaponList.map((w) => (
              <button
                key={w.id}
                type="button"
                title={`${w.damage ?? ""} · alc ${w.range ?? 1}`}
                className={
                  (draft.weapons ?? []).includes(w.id) ? styles.chipOn : styles.chip
                }
                onClick={() => toggleWeapon(w.id)}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>
        <label>
          Descrição
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label>
          Imagem (opcional)
          <input type="file" accept="image/*" onChange={pickImage} />
        </label>
        {draft.picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.picture} alt="" className={styles.preview} />
        )}
        <div className={styles.formBtns}>
          <button
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("npc") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("npc") })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((n) => (
          <Row
            key={n.id}
            title={n.name}
            subtitle={`HP ${n.hp} · ${(n.weapons ?? []).length || (n.damage ? 1 : 0)} arma(s)`}
            onEdit={() => setDraft(n)}
            onRemove={() => onRemove(n.id)}
          />
        ))}
      </List>
    </div>
  );
}

// --- Modelos de Batalha ---
function TemplatesManager({
  items,
  onSave,
  onRemove,
}: {
  items: BattleTemplate[];
  onSave: (e: BattleTemplate) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <p className="muted">
        Modelos são salvos ao montar uma batalha (botão “Salvar modelo”). Aqui você pode
        renomear ou excluir.
      </p>
      <List>
        {items.length === 0 && <p className="muted">Nenhum modelo salvo.</p>}
        {items.map((t) => (
          <div key={t.id} className={styles.row}>
            <input
              className={styles.rowInput}
              value={t.name}
              onChange={(e) => onSave({ ...t, name: e.target.value })}
            />
            <span className={styles.rowMeta}>
              {t.grid}×{t.grid} · {t.tokens.length} tokens
            </span>
            <button className="danger" onClick={() => onRemove(t.id)}>
              x
            </button>
          </div>
        ))}
      </List>
    </div>
  );
}

// --- Objetos (regras fixas) ---
function ObjectForm({
  items,
  catalogItems,
  onSave,
  onRemove,
}: {
  items: GameObject[];
  catalogItems: CatalogItem[];
  onSave: (e: GameObject) => void;
  onRemove: (id: string) => void;
}) {
  const blank: GameObject = { id: uid("obj"), name: "", rule: "cobertura" };
  const [draft, setDraft] = useState<GameObject>(blank);
  const rule = OBJECT_RULES[draft.rule];

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Regra (fixa)
          <select
            value={draft.rule}
            onChange={(e) =>
              setDraft({ ...draft, rule: e.target.value as ObjectRuleId })
            }
          >
            {OBJECT_RULE_LIST.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.badge}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.ruleDesc}>{rule.description}</p>
        <div className={styles.row2}>
          {(rule.kind === "bonus" || rule.kind === "disadvantage") && (
            <label>
              Valor ({rule.target === "defense" ? "DEF" : "ATK"}{" "}
              {rule.kind === "bonus" ? "+" : "-"})
              <input
                type="number"
                min={1}
                value={draft.value ?? rule.value}
                onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
              />
            </label>
          )}
          <label>
            HP (0 = não atacável)
            <input
              type="number"
              min={0}
              value={draft.hp ?? 0}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  hp: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.destroyOnUse ?? false}
            onChange={(e) => setDraft({ ...draft, destroyOnUse: e.target.checked })}
          />
          Destruir após uso (some do mapa)
        </label>
        {draft.rule === "item" && (
          <label>
            Item concedido
            <select
              value={draft.itemId ?? ""}
              onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}
            >
              <option value="">—</option>
              {catalogItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(draft.rule === "reload" || draft.rule === "chest" || draft.rule === "chute") && (
          <label>
            Limite de usos (vazio = ilimitado)
            <input
              type="number"
              min={1}
              value={draft.maxUses ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  maxUses: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
        )}
        {draft.rule === "reload" && (
          <label>
            Munição recarregada
            <input
              type="number"
              min={1}
              value={draft.reloadAmount ?? 2}
              onChange={(e) => setDraft({ ...draft, reloadAmount: Number(e.target.value) })}
            />
          </label>
        )}
        {draft.rule === "chest" && (
          <div className={styles.picker}>
            <span className={styles.pickerTitle}>Itens do baú</span>
            <div className={styles.chips}>
              {catalogItems
                .filter((i) => i.category === "item")
                .map((i) => {
                  const cur = draft.grant?.find((g) => g.id === i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className={cur ? styles.chipOn : styles.chip}
                      onClick={() =>
                        setDraft((d) => {
                          const grant = d.grant ?? [];
                          const has = grant.find((g) => g.id === i.id);
                          return {
                            ...d,
                            grant: has
                              ? grant.filter((g) => g.id !== i.id)
                              : [...grant, { id: i.id, qty: 1 }],
                          };
                        })
                      }
                    >
                      {i.name}
                      {cur ? ` ×${cur.qty}` : ""}
                    </button>
                  );
                })}
            </div>
          </div>
        )}
        <div className={styles.formBtns}>
          <button
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("obj") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("obj") })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((o) => (
          <Row
            key={o.id}
            title={o.name}
            subtitle={`${OBJECT_RULES[o.rule].name}${
              o.value !== undefined ? ` ${o.value}` : ""
            }${o.hp ? ` · ${o.hp} HP` : ""}`}
            onEdit={() => setDraft(o)}
            onRemove={() => onRemove(o.id)}
          />
        ))}
      </List>
    </div>
  );
}

// --- Profissões ---
function ProfessionForm({
  items,
  onSave,
  onRemove,
}: {
  items: Profession[];
  onSave: (e: Profession) => void;
  onRemove: (id: string) => void;
}) {
  const blank: Profession = {
    id: uid("prof"),
    name: "",
    hack_found: false,
    description: "",
  };
  const [draft, setDraft] = useState<Profession>(blank);

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.hack_found}
            onChange={(e) => setDraft({ ...draft, hack_found: e.target.checked })}
          />
          Hack disponível ao entrar na matrix
        </label>
        <label>
          Descrição
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <div className={styles.formBtns}>
          <button
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("prof") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("prof") })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((p) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={p.hack_found ? "hack ✓" : undefined}
            onEdit={() => setDraft(p)}
            onRemove={() => onRemove(p.id)}
          />
        ))}
      </List>
    </div>
  );
}

// --- Músicas (upload de MP3) ---
function MusicForm({
  items,
  onSave,
  onRemove,
}: {
  items: MusicMeta[];
  onSave: (e: MusicTrack) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [src, setSrc] = useState("");
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const dataUrl = await fileToDataUrl(f);
    const d = await audioDuration(dataUrl);
    setSrc(dataUrl);
    setDuration(d);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    setBusy(false);
  }

  function reset() {
    setName("");
    setSrc("");
    setDuration(0);
  }

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Arquivo MP3
          <input type="file" accept="audio/mpeg,audio/mp3,.mp3" onChange={pickFile} />
        </label>
        <label>
          Nome
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nome da faixa"
          />
        </label>
        <p className="muted">
          {busy ? "lendo arquivo…" : src ? `áudio carregado · ${fmtTime(duration)}` : "nenhum arquivo"}
        </p>
        <div className={styles.formBtns}>
          <button
            disabled={!name || !src || busy}
            onClick={() => {
              if (!name || !src) return;
              onSave({ id: uid("mus"), name, duration, src });
              reset();
            }}
          >
            Salvar
          </button>
          <button onClick={reset}>Limpar</button>
        </div>
      </div>
      <List>
        {items.length === 0 && <p className="muted">Nenhuma música cadastrada.</p>}
        {items.map((m) => (
          <div key={m.id} className={styles.row}>
            <div className={styles.rowText}>
              <strong>{m.name}</strong>
              <span>{fmtTime(m.duration)}</span>
            </div>
            <div className={styles.rowActions}>
              <button className="danger" onClick={() => onRemove(m.id)}>
                x
              </button>
            </div>
          </div>
        ))}
      </List>
    </div>
  );
}

// --- Hacks / Disfarces (nome + descrição) ---
function NamedForm({
  items,
  prefix,
  onSave,
  onRemove,
}: {
  items: (Hack | Disguise)[];
  prefix: string;
  onSave: (e: Hack | Disguise) => void;
  onRemove: (id: string) => void;
}) {
  const blank = { id: uid(prefix), name: "", description: "" };
  const [draft, setDraft] = useState(blank);

  return (
    <div className={styles.split}>
      <div className={styles.form}>
        <label>
          Nome
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Descrição
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <div className={styles.formBtns}>
          <button
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid(prefix) });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid(prefix) })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((h) => (
          <Row
            key={h.id}
            title={h.name}
            subtitle={h.description}
            onEdit={() => setDraft(h)}
            onRemove={() => onRemove(h.id)}
          />
        ))}
      </List>
    </div>
  );
}
