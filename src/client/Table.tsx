"use client";

import { useState } from "react";
import { useGame } from "./GameProvider";
import { ScenarioView } from "./ScenarioView";
import { BattleView } from "./BattleView";
import { CatalogAdmin } from "./CatalogAdmin";
import { CharacterSheet } from "./CharacterSheet";
import styles from "./Table.module.css";

type View = "table" | "catalog" | "sheet";

export function Table() {
  const { state, session, connected, error, authExpired } = useGame();
  const [view, setView] = useState<View>("table");

  async function relogin() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (authExpired) {
    return (
      <div className={styles.loading}>
        <p className="danger">Sessão inválida ou expirada.</p>
        <button onClick={relogin}>Entrar novamente</button>
      </div>
    );
  }

  if (!state) {
    return <div className={styles.loading}>conectando à mesa…</div>;
  }

  const isGM = session?.role === "gm";
  const inBattle = state.game.mode === "battle";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}>MATRIX // mesa</span>
        <nav className={styles.nav}>
          <button
            className={view === "table" ? styles.active : ""}
            onClick={() => setView("table")}
          >
            Mesa
          </button>
          {!isGM && (
            <button
              className={view === "sheet" ? styles.active : ""}
              onClick={() => setView("sheet")}
            >
              Ficha
            </button>
          )}
          {isGM && (
            <button
              className={view === "catalog" ? styles.active : ""}
              onClick={() => setView("catalog")}
            >
              Cadastros
            </button>
          )}
        </nav>
        <span className={styles.status}>
          <span className={connected ? styles.on : styles.off}>●</span>{" "}
          {session?.email} [{session?.role}]
          <button className={styles.logout} onClick={logout}>
            sair
          </button>
        </span>
      </header>

      {error && <div className={styles.error}>⚠ {error}</div>}

      <main className={styles.main}>
        {view === "catalog" && isGM && <CatalogAdmin />}
        {view === "sheet" && !isGM && <CharacterSheet />}
        {view === "table" &&
          (inBattle ? <BattleView /> : <ScenarioView />)}
      </main>
    </div>
  );
}
