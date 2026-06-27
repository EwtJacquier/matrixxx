// Criação de conta e login. GM único + até 4 jogadores.

import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Role, User } from "@/game/types";
import { addUser, getUsers } from "../data/store";

export const MAX_PLAYERS = 4;

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: { id: string; email: string; role: Role };
}

function publicUser(u: User) {
  return { id: u.id, email: u.email, role: u.role };
}

export async function createAccount(
  email: string,
  password: string,
  role: Role,
): Promise<AuthResult> {
  email = email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "E-mail inválido." };
  if (password.length < 4) return { ok: false, error: "Senha muito curta (mín. 4)." };

  const users = getUsers();
  if (users.some((u) => u.email === email)) {
    return { ok: false, error: "Já existe uma conta com esse e-mail." };
  }

  if (role === "gm" && users.some((u) => u.role === "gm")) {
    return { ok: false, error: "Já existe um GM nesta mesa." };
  }
  if (role === "player" && users.filter((u) => u.role === "player").length >= MAX_PLAYERS) {
    return { ok: false, error: "Mesa cheia (máx. 4 jogadores)." };
  }

  const user: User = {
    id: `usr_${crypto.randomUUID()}`,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    createdAt: Date.now(),
  };
  await addUser(user);
  return { ok: true, user: publicUser(user) };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  email = email.trim().toLowerCase();
  const user = getUsers().find((u) => u.email === email);
  if (!user) return { ok: false, error: "Conta não encontrada." };
  // Contas criadas pela UI guardam um hash bcrypt ($2...). Para permitir definir
  // o GM editando data/users.json à mão, aceitamos também senha em texto puro
  // quando passwordHash não for um hash bcrypt.
  const isBcrypt = /^\$2[aby]?\$/.test(user.passwordHash);
  const match = isBcrypt
    ? await bcrypt.compare(password, user.passwordHash)
    : password === user.passwordHash;
  if (!match) return { ok: false, error: "Senha incorreta." };
  return { ok: true, user: publicUser(user) };
}

export function getUserById(id: string): { id: string; email: string; role: Role } | null {
  const u = getUsers().find((x) => x.id === id);
  return u ? publicUser(u) : null;
}

/** Vagas disponíveis para a tela de criação de conta. */
export function availableRoles(): { gm: boolean; player: boolean } {
  const users = getUsers();
  return {
    gm: !users.some((u) => u.role === "gm"),
    player: users.filter((u) => u.role === "player").length < MAX_PLAYERS,
  };
}
