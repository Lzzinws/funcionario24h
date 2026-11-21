import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/", "/entrar", "/cadastrar", "/recuperar-senha", "/auth", "/api/webhooks", "/api/worker", "/planos"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")));
}

/** Renova a sessão do Supabase a cada requisição e protege rotas privadas. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Banco ainda não conectado: áreas privadas redirecionam para o login (que exibe o aviso).
    if (isPublic(request.nextUrl.pathname)) return response;
    const to = request.nextUrl.clone();
    to.pathname = "/entrar";
    to.search = "";
    return NextResponse.redirect(to);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() valida o JWT no servidor do Supabase (não confia só no cookie).
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = "/entrar";
    to.searchParams.set("next", pathname);
    return NextResponse.redirect(to);
  }
  if (user && (pathname === "/entrar" || pathname === "/cadastrar")) {
    const to = request.nextUrl.clone();
    to.pathname = "/painel";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}
