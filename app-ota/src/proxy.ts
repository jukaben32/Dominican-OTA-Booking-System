// Proxy (antes llamado "middleware" en Next.js): refresca la sesión y manda al login a quien no la tenga.
// Es solo una primera barrera: cada página y acción del panel vuelve a verificar el rol con requireStaff().
// Los webhooks (/api/webhooks) y el cron (/api/cron) NO pasan por aquí: se protegen con firmas y secretos.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Al redirigir copiamos las cookies que Supabase pudo haber refrescado; si no, la sesión se perdería
  const redirigir = (destino: string) => {
    const url = request.nextUrl.clone();
    url.pathname = destino;
    url.search = "";
    const redireccion = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redireccion.cookies.set(cookie));
    return redireccion;
  };

  if (!data.user && pathname.startsWith("/panel")) return redirigir("/login");
  if (data.user && pathname === "/login") return redirigir("/panel");

  return response;
}

// Solo se ejecuta donde hace falta (evita una consulta de sesión en la web pública)
export const config = {
  matcher: ["/panel/:path*", "/login"],
};
