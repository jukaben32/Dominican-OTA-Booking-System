import { Field, inputClass } from "@/components/action-form";
import { formatItinerary } from "@/lib/tours/itinerary";
import type { PolicyRow, TourRow } from "@/lib/supabase/tours-repo";

// Campos del formulario de un tour (sirve para crear y para editar)
export function TourFields({ tour, policies }: { tour?: TourRow; policies: PolicyRow[] }) {
  return (
    <div className="space-y-8">
      <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
        <legend className="px-2 font-display text-xl font-semibold">Lo básico</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Título del tour" name="title" className="md:col-span-2">
            <input id="title" name="title" required minLength={3} maxLength={120} defaultValue={tour?.title} className={inputClass} />
          </Field>
          <Field label="Dirección web (opcional)" name="slug" hint="Si la dejas vacía se crea sola a partir del título. Ej. medellin-y-guatape">
            <input id="slug" name="slug" maxLength={80} defaultValue={tour?.slug} className={inputClass} />
          </Field>
          <Field label="Destino" name="destination" hint="Ciudad o región. Ej. Medellín">
            <input id="destination" name="destination" required minLength={2} maxLength={80} defaultValue={tour?.destination} className={inputClass} />
          </Field>
          <Field label="País (código de 2 letras)" name="countryCode" hint="CO Colombia, PE Perú, MX México, PA Panamá…">
            <input id="countryCode" name="countryCode" required maxLength={2} defaultValue={tour?.country_code} className={`${inputClass} uppercase`} />
          </Field>
          <Field label="Duración (días)" name="durationDays">
            <input id="durationDays" name="durationDays" type="number" min={1} max={60} required defaultValue={tour?.duration_days ?? 5} className={inputClass} />
          </Field>
          <Field label="Moneda de venta" name="currency">
            <select id="currency" name="currency" defaultValue={tour?.currency ?? "USD"} className={inputClass}>
              <option value="USD">Dólares (US$)</option>
              <option value="DOP">Pesos (RD$)</option>
            </select>
          </Field>
          <Field label="Política de cancelación" name="policyId" hint="Se copia a cada reserva al venderla">
            <select id="policyId" name="policyId" defaultValue={tour?.cancellation_policy_id ?? ""} className={inputClass}>
              <option value="">Sin política</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Resumen (una o dos frases)" name="summary" className="md:col-span-2">
            <input id="summary" name="summary" required minLength={3} maxLength={300} defaultValue={tour?.summary} className={inputClass} />
          </Field>
          <Field label="Descripción" name="description" className="md:col-span-2">
            <textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={tour?.description} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
        <legend className="px-2 font-display text-xl font-semibold">Qué incluye</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Incluye (uno por línea)" name="includes">
            <textarea id="includes" name="includes" rows={6} defaultValue={tour?.includes.join("\n")} className={inputClass} />
          </Field>
          <Field label="No incluye (uno por línea)" name="excludes">
            <textarea id="excludes" name="excludes" rows={6} defaultValue={tour?.excludes.join("\n")} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
        <legend className="px-2 font-display text-xl font-semibold">Itinerario</legend>
        <Field
          label="Día por día"
          name="itinerary"
          hint={'Un bloque por día, separados por una línea en blanco. Empieza cada bloque con "Día 1: título".'}
        >
          <textarea
            id="itinerary"
            name="itinerary"
            rows={12}
            defaultValue={tour ? formatItinerary(tour.itinerary) : ""}
            placeholder={"Día 1: Llegada\nRecepción en el aeropuerto y traslado al hotel.\n\nDía 2: Ciudad\nTour guiado por el centro."}
            className={`${inputClass} font-mono text-sm`}
          />
        </Field>
      </fieldset>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="published" defaultChecked={tour?.published} className="mt-1 h-5 w-5 accent-[var(--coral)]" />
        <span>
          <strong>Publicar en la web.</strong> Si no la marcas, el tour queda como borrador y solo lo ven los administradores.
        </span>
      </label>
    </div>
  );
}
