import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPolicies } from "@/lib/supabase/tours-repo";
import { createTourAction } from "../actions";
import { TourFields } from "../tour-fields";

export default async function NuevoTourPage() {
  await requireAdmin();
  const policies = await listPolicies(createAdminClient());

  return (
    <>
      <Link href="/panel/tours" className="text-sm font-semibold text-sea underline underline-offset-4">← Volver a tours</Link>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Nuevo tour</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Después de crearlo podrás subir las fotos, agregar sus salidas con fecha y cupo, y cargar los costos.
      </p>
      <ActionForm action={createTourAction} submitLabel="Crear tour" className="mt-8 max-w-3xl">
        <TourFields policies={policies} />
      </ActionForm>
    </>
  );
}
