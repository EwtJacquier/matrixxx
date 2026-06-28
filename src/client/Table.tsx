"use client";

import { useState } from "react";
import { useGame } from "./GameProvider";
import { ScenarioView } from "./ScenarioView";
import { BattleView } from "./BattleView";
import { CatalogAdmin } from "./CatalogAdmin";
import { CharacterSheet } from "./CharacterSheet";
import { MusicPlayer } from "./MusicPlayer";
import styles from "./Table.module.css";

type View = "table" | "catalog" | "sheet";

export function Table() {
  const { state, session, connected, error, authExpired } = useGame();
  const [view, setView] = useState<View>("table");
  const [spectate, setSpectate] = useState(false);

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
  // Há uma batalha guardada (ativa ou pausada) que pode ser resumida/revisitada.
  const hasBattle = !!state.game.battle;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}>MATRIX // mesa</span>
        <nav className={styles.nav}>
          {/* Ao "ver último combate", o voltar fica aqui, antes da Mesa. */}
          {spectate && (
            <button onClick={() => setSpectate(false)}>◀ Voltar</button>
          )}
          {/* GM tem Mesa + Cadastros. */}
          {isGM && (
            <>
              <button
                className={view === "table" && !spectate ? styles.active : ""}
                onClick={() => { setSpectate(false); setView("table"); }}
              >
                Mesa
              </button>
              <button
                className={view === "catalog" ? styles.active : ""}
                onClick={() => { setSpectate(false); setView("catalog"); }}
              >
                Cadastros
              </button>
            </>
          )}
          {/* Jogador alterna entre Mesa e a própria ficha (mesmo sem ter criado
              o personagem ainda — a ficha cria um em branco para editar). */}
          {!isGM && (
            <>
              <button
                className={view === "table" && !spectate ? styles.active : ""}
                onClick={() => { setSpectate(false); setView("table"); }}
              >
                Mesa
              </button>
              <button
                className={view === "sheet" ? styles.active : ""}
                onClick={() => { setSpectate(false); setView("sheet"); }}
              >
                Minha Ficha
              </button>
            </>
          )}
        </nav>
        <MusicPlayer />
        <span className={styles.status}>
          <span className={connected ? styles.on : styles.off}>●</span>{" "}
          <span className={styles.userEmail}>
            {session?.email} [{session?.role}]
          </span>
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
          (inBattle ? (
            <BattleView />
          ) : spectate && hasBattle ? (
            <BattleView spectate />
          ) : (
            <ScenarioView
              onOpenSheet={() => setView("sheet")}
              battleActive={hasBattle}
              onSpectate={hasBattle ? () => setSpectate(true) : undefined}
            />
          ))}
      </main>
    </div>
  );
}
