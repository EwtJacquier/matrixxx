"use client";

import { useState } from "react";
import { unlockSfx } from "./sfx";
import styles from "./Login.module.css";

interface Roles {
  gm: boolean;
  player: boolean;
}

export function Login({ roles, onAuth }: { roles: Roles; onAuth: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Destrava o AudioContext ainda dentro do gesto do usuário (clique/submit).
    unlockSfx();
    setBusy(true);
    setError(null);
    const url = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
    // Cadastro cria sempre Jogador. O GM é definido editando data/users.json.
    const body = { email, password };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha na autenticação.");
      } else {
        onAuth();
      }
    } catch {
      setError("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.box}>
        <pre className={styles.logo}>{`
  __  __    _  _____ ____  ___ __  __
 |  \\/  |  / \\|_   _|  _ \\|_ _|\\ \\/ /
 | |\\/| | / _ \\ | | | |_) || |  \\  /
 | |  | |/ ___ \\| | |  _ < | |  /  \\
 |_|  |_/_/   \\_\\_| |_| \\_\\___//_/\\_\\
        `}</pre>
        <p className={styles.sub}>// acesso à mesa</p>

        <div className={styles.tabs}>
          <button
            className={mode === "login" ? styles.active : ""}
            onClick={() => setMode("login")}
            type="button"
          >
            Entrar
          </button>
          <button
            className={mode === "signup" ? styles.active : ""}
            onClick={() => setMode("signup")}
            type="button"
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {mode === "signup" && (
            <p className={styles.note}>
              {roles.player
                ? "Você entrará como Jogador. O GM é definido direto no banco."
                : "Mesa cheia (máx. 4 jogadores)."}
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" disabled={busy}>
            {busy ? "..." : mode === "login" ? "Conectar" : "Registrar"}
          </button>
        </form>
        <p className={styles.note}>sem recuperação de senha — anote a sua.</p>
      </div>
    </div>
  );
}
