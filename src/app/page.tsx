"use client";

import { useCallback, useEffect, useState } from "react";
import { GameProvider } from "@/client/GameProvider";
import { Login } from "@/client/Login";
import { Table } from "@/client/Table";
import { MobileGate } from "@/client/MobileGate";
import { unlockSfx } from "@/client/sfx";
import gate from "@/client/Login.module.css";

interface Session {
  id: string;
  email: string;
  role: "gm" | "player";
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState({ gm: true, player: true });
  // Só entra na mesa após um gesto do usuário — necessário para destravar o
  // AudioContext (efeitos sonoros). Por isso o login/entrada é sempre obrigatório.
  const [entered, setEntered] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setSession(data.user);
      setRoles(data.roles);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return <div style={{ padding: 24 }}>carregando…</div>;
  }

  if (!session) {
    // O clique de login destrava o áudio; ao autenticar já entramos direto.
    return <Login roles={roles} onAuth={() => { setEntered(true); refresh(); }} />;
  }

  if (!entered) {
    return (
      <div className={gate.wrap}>
        <div className={gate.box}>
          <p className={gate.sub}>// mesa pronta</p>
          <p style={{ textAlign: "center", margin: "12px 0" }}>
            conectado como <strong>{session.email}</strong>
          </p>
          <button
            style={{ width: "100%" }}
            onClick={() => {
              unlockSfx();
              setEntered(true);
            }}
          >
            Entrar na mesa
          </button>
        </div>
      </div>
    );
  }

  return (
    <GameProvider session={session}>
      <MobileGate>
        <Table />
      </MobileGate>
    </GameProvider>
  );
}
