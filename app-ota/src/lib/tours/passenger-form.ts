// Lee las filas de pasajeros que envía el formulario de venta (campos repetidos: pName, pType, pBirth, pRoom).
// No valida las reglas del negocio (eso lo hace validatePassengers): solo arma la lista y descarta las filas vacías.
// Los valores raros se dejan tal cual para que la validación los rechace con un mensaje claro.

import type { PassengerInput } from "./passengers";

const MAX_ROWS = 20; // el formulario muestra 9; el resto es defensa contra entradas absurdas

function lista(formData: FormData, campo: string): string[] {
  return formData.getAll(campo).map((v) => (typeof v === "string" ? v : ""));
}

export function parsePassengerRows(formData: FormData): PassengerInput[] {
  const nombres = lista(formData, "pName");
  const tipos = lista(formData, "pType");
  const nacimientos = lista(formData, "pBirth");
  const habitaciones = lista(formData, "pRoom");

  const filas: PassengerInput[] = [];
  for (let i = 0; i < Math.min(nombres.length, MAX_ROWS); i++) {
    const name = nombres[i].trim();
    const birth = (nacimientos[i] ?? "").trim();
    // Una fila sin nombre ni fecha es una fila que el agente no usó
    if (!name && !birth) continue;
    filas.push({
      name,
      type: (tipos[i] ?? "ADULT") as PassengerInput["type"],
      birthDate: birth || null,
      room: (habitaciones[i] ?? "DOUBLE") as PassengerInput["room"],
    });
  }
  return filas;
}
