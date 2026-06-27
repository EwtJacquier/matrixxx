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
  Npc,
  Profession,
  Scenario,
} from "@/game/types";
import { cropToSquareDataUrl, fileToDataUrl } from "./image";
import styles from "./CatalogAdmin.module.css";

type Kind =
  | "scenarios"
  | "items"
  | "hacks"
  | "disguises"
  | "professions"
  | "npcs"
  | "objects"
  | "battleTemplates";

const TABS: { kind: Kind; label: string }[] = [
  { kind: "scenarios", label: "Cenários" },
  { kind: "npcs", label: "Inimigos/NPCs" },
  { kind: "objects", label: "Objetos" },
  { kind: "battleTemplates", label: "Modelos de Batalha" },
  { kind: "items", label: "Itens/Armas" },
  { kind: "professions", label: "Profissões" },
  { kind: "hacks", label: "Hacks" },
  { kind: "disguises", label: "Disfarces" },
];

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
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
        <NpcForm items={state.npcs} onSave={upsert} onRemove={remove} />
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
          <div className={styles.row2}>
            <label>
              Dano (ex.: 2d6+2)
              <input
                value={draft.damage ?? ""}
                onChange={(e) => setDraft({ ...draft, damage: e.target.value })}
              />
            </label>
            <label>
              Alcance (casas)
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
          </div>
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
            onClick={() => {
              if (!draft.name) return;
              onSave(draft);
              setDraft({ ...blank, id: uid("itm") });
            }}
          >
            Salvar
          </button>
          <button onClick={() => setDraft({ ...blank, id: uid("itm") })}>Limpar</button>
        </div>
      </div>
      <List>
        {items.map((it) => (
          <Row
            key={it.id}
            title={it.name}
            subtitle={`${it.category}${it.damage ? ` · ${it.damage}` : ""}`}
            onEdit={() => setDraft(it)}
            onRemove={() => onRemove(it.id)}
          />
        ))}
      </List>
    </div>
  );
}

// --- Inimigos / NPCs ---
function NpcForm({
  items,
  onSave,
  onRemove,
}: {
  items: Npc[];
  onSave: (e: Npc) => void;
  onRemove: (id: string) => void;
}) {
  const blank: Npc = { id: uid("npc"), name: "", hp: 10, damage: "1d6", description: "" };
  const [draft, setDraft] = useState<Npc>(blank);

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
            Dano (ex.: 2d6+2)
            <input
              value={draft.damage ?? ""}
              onChange={(e) => setDraft({ ...draft, damage: e.target.value })}
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
            subtitle={`HP ${n.hp}${n.damage ? ` · ${n.damage}` : ""}`}
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
            subtitle={`${OBJECT_RULES[o.rule].name} · ${OBJECT_RULES[o.rule].badge}`}
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
