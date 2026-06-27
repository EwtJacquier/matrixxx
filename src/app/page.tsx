"use client";

import { useCallback, useEffect, useState } from "react";
import { GameProvider } from "@/client/GameProvider";
import { Login } from "@/client/Login";
import { Table } from "@/client/Table";

interface Session {
  id: string;
  email: string;
  role: "gm" | "player";
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState({ gm: true, player: true });

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
    return <Login roles={roles} onAuth={refresh} />;
  }

  return (
    <GameProvider session={session}>
      <Table />
    </GameProvider>
  );
}
