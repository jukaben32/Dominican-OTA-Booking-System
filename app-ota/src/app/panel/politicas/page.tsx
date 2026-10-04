import { ActionForm, Field, inputClass } from "@/components/action-form";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPolicies } from "@/lib/supabase/tours-repo";
import { describePolicy } from "@/lib/tours/cancellation";
import { formatRulesText } from "@/lib/tours/forms";
import { createPolicyAction, updatePolicyAction } from "./actions";

const EJEMPLO = "30 días: 90 %\n15 días: 50 %\n7 días: 25 %";

export default async function PoliticasPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdmin();
  const { guardado } = await searchParams;
  const politicas = await listPolicies(createAdminClient());

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Políticas de cancelación</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Cuánto se reembolsa según los días que falten para la salida. Cada reserva guarda una <strong>copia</strong> de la política con la
        que se vendió: si la cambias aquí, las reservas ya vendidas no cambian.
      </p>
      {guardado && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">Guardado.</p>}

      <ul className="mt-8 space-y-4">
        {politicas.map((p) => (
          <li key={p.id} className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
            <h2 className="font-display text-xl font-semibold">{p.name}</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {describePolicy(p.rules).map((linea) => <li key={linea}>{linea}</li>)}
            </ul>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-sea">Editar</summary>
              <ActionForm action={updatePolicyAction} submitLabel="Guardar" variant="quiet" className="mt-4 max-w-xl">
                <input type="hidden" name="policyId" value={p.id} />
                <div className="grid gap-5">
                  <Field label="Nombre" name={`name-${p.id}`}><input id={`name-${p.id}`} name="name" required defaultValue={p.name} maxLength={80} className={inputClass} /></Field>
                  <Field label="Reglas (una por línea)" name={`rules-${p.id}`} hint='Formato "días de anticipación: % de reembolso"'>
                    <textarea id={`rules-${p.id}`} name="rules" rows={5} required defaultValue={formatRulesText(p.rules)} className={`${inputClass} font-mono text-sm`} />
                  </Field>
                </div>
              </ActionForm>
            </details>
          </li>
        ))}
        {politicas.length === 0 && <li className="rounded-[var(--radius-card)] border border-dashed border-line bg-paper px-6 py-10 text-center text-muted">Todavía no hay políticas. Crea la primera abajo.</li>}
      </ul>

      <section aria-labelledby="t-nueva" className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6">
        <h2 id="t-nueva" className="font-display text-xl font-semibold">Nueva política</h2>
        <ActionForm action={createPolicyAction} submitLabel="Crear política" className="mt-4 max-w-xl">
          <div className="grid gap-5">
            <Field label="Nombre" name="name"><input id="name" name="name" required minLength={2} maxLength={80} placeholder="Estándar 30/15/7" className={inputClass} /></Field>
            <Field label="Reglas (una por línea)" name="rules" hint='El reembolso no puede subir cuando se acerca la salida. Con menos días que la última regla no se devuelve nada.'>
              <textarea id="rules" name="rules" rows={5} required defaultValue={EJEMPLO} className={`${inputClass} font-mono text-sm`} />
            </Field>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
