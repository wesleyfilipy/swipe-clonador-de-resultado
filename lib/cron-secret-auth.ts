import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Autoriza rotas de cron/diagnóstico com CRON_SECRET (Authorization: Bearer ou ?secret=). */
export function authorizeCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

/** Resposta quando a rota protegida falha: distingue segredo não configurado no deploy vs. requisição inválida. */
export function cronUnauthorizedResponse(): NextResponse {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      {
        error: "cron_secret_not_configured",
        message:
          "CRON_SECRET não está definido nas Environment Variables deste deploy (Vercel → Settings → Environment Variables → Production). Salve e faça Redeploy.",
      },
      { status: 503 }
    );
  }
  return NextResponse.json(
    {
      error: "forbidden_bad_or_missing_secret",
      message:
        "O segredo enviado não confere com CRON_SECRET. Confira o valor exato na Vercel. Se o segredo contém *, &, #, +, espaço ou outros caracteres especiais, use o header Authorization: Bearer <segredo> (curl, Postman, Thunder Client) em vez de ?secret= na URL, que pode truncar ou alterar o valor.",
    },
    { status: 401 }
  );
}
