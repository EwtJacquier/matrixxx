import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { initStore } from "@/server/data/store";
import { createToken, SESSION_COOKIE } from "@/server/auth/session";
import { createAccount } from "@/server/auth/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await initStore();
  const { email, password } = (await req.json()) as {
    email: string;
    password: string;
  };
  // O cadastro só cria Jogador. O GM é definido editando data/users.json.
  const result = await createAccount(email, password, "player");
  if (!result.ok || !result.user) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  cookies().set(SESSION_COOKIE, createToken(result.user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ user: result.user });
}
