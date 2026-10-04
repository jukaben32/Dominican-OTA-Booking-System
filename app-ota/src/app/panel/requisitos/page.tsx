import { ActionForm, Field, inputClass } from "@/components/action-form";
import { Etiqueta, formatDay } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listRequirements } from "@/lib/supabase/tours-repo";
import { saveRequirementAction } from "./actions";

const VISA: Record<string, string> = {
  UNKNOWN: "Por confirmar", NOT_REQUIRED: "No se requiere visa", REQUIRED: "Se requiere visa", ON_ARRIVAL: "Visa a la llegada", E_VISA: "Visa electrónica",
};

export default async function RequisitosPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdmin();
  const { guardado, pais } = await searchParams;
  const requisitos = await listRequirements(createAdminClient());
  const editando = typeof pais === "string" ? requisitos.find((r) => r.country_code === pais.toUpperCase()) : undefined;

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Requisitos de entrada por país</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Pasaporte, visa y vacunas <strong>para quien viaja con pasaporte dominicano</strong>. En la web y en los documentos solo se muestra lo que
        tiene <strong>fuente oficial y fecha de verificación</strong>; si no, el cliente ve &quot;consulta con nosotros&quot;. Los requisitos cambian:
        vuelve a verificarlos antes de cada temporada.
      </p>
      {guardado && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">Guardado.</p>}

      <ul className="mt-8 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]">
        {requisitos.map((r) => (
          <li key={r.country_code} className="grid gap-2 px-6 py-4 md:grid-cols-[1fr_1.4fr_auto] md:items-center">
            <p className="font-bold">{r.country_name} <span className="text-sm font-normal text-muted">({r.country_code})</span></p>
            <p className="text-sm text-muted">
              {VISA[r.visa_status]}
              {r.verified_at ? ` · verificado el ${formatDay(r.verified_at)}` : ""}
            </p>
            <div className="flex items-center gap-3">
              <Etiqueta tono={r.visa_status !== "UNKNOWN" && r.verified_at ? "ok" : "aviso"}>{r.visa_status !== "UNKNOWN" && r.verified_at ? "Verificado" : "Por verificar"}</Etiqueta>
              <a href={`/panel/requisitos?pais=${r.country_code}#formulario`} className="text-sm font-semibold text-sea underline underline-offset-4">Editar</a>
            </div>
          </li>
        ))}
        {requisitos.length === 0 && <li className="px-6 py-10 text-center text-muted">Todavía no hay países cargados.</li>}
      </ul>

      <section id="formulario" aria-labelledby="t-form" className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6">
        <h2 id="t-form" className="font-display text-xl font-semibold">{editando ? `Editar ${editando.country_name}` : "Agregar o actualizar un país"}</h2>
        <ActionForm key={editando?.country_code ?? "nuevo"} action={saveRequirementAction} submitLabel="Guardar requisitos" className="mt-4 max-w-3xl">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="País (código de 2 letras)" name="countryCode"><input id="countryCode" name="countryCode" required maxLength={2} defaultValue={editando?.country_code} className={`${inputClass} uppercase`} /></Field>
            <Field label="Nombre del país" name="countryName"><input id="countryName" name="countryName" required maxLength={80} defaultValue={editando?.country_name} className={inputClass} /></Field>
            <Field label="Visa para pasaporte dominicano" name="visaStatus" hint="Si eliges algo distinto de 'Por confirmar', la fuente y la fecha son obligatorias">
              <select id="visaStatus" name="visaStatus" defaultValue={editando?.visa_status ?? "UNKNOWN"} className={inputClass}>
                {Object.entries(VISA).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-3 self-end pb-3 text-sm">
              <input type="checkbox" name="passportRequired" defaultChecked={editando?.passport_required ?? true} className="mt-1 h-5 w-5 accent-[var(--coral)]" />
              <span>Se exige pasaporte (con vigencia suficiente)</span>
            </label>
            <Field label="Fuente oficial (enlace)" name="sourceUrl" hint="Ej. la página de la embajada, migración o cancillería del país">
              <input id="sourceUrl" name="sourceUrl" type="url" maxLength={500} defaultValue={editando?.source_url ?? ""} className={inputClass} />
            </Field>
            <Field label="Fecha en que lo verificaste" name="verifiedAt"><input id="verifiedAt" name="verifiedAt" type="date" defaultValue={editando?.verified_at ?? ""} className={inputClass} /></Field>
            <Field label="Vacunas" name="vaccines" className="md:col-span-2"><input id="vaccines" name="vaccines" maxLength={500} defaultValue={editando?.vaccines ?? ""} className={inputClass} /></Field>
            <Field label="Notas" name="notes" className="md:col-span-2"><input id="notes" name="notes" maxLength={1000} defaultValue={editando?.notes ?? ""} className={inputClass} /></Field>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
