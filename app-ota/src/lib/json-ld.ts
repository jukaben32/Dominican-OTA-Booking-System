// Serializa datos estructurados (JSON-LD) para incrustarlos en una etiqueta <script>.
// Un texto del catálogo con "</script>" cerraría la etiqueta y permitiría inyectar código: por eso se escapan
// los caracteres "<", ">" y "&" y los dos separadores de línea especiales de Unicode (U+2028 y U+2029).

const SEPARADOR_LINEA = String.fromCharCode(0x2028);
const SEPARADOR_PARRAFO = String.fromCharCode(0x2029);
const BARRA = String.fromCharCode(92); // el carácter "\"

export function serializeJsonLd(datos: unknown): string {
  return JSON.stringify(datos)
    .replace(/</g, `${BARRA}u003c`)
    .replace(/>/g, `${BARRA}u003e`)
    .replace(/&/g, `${BARRA}u0026`)
    .split(SEPARADOR_LINEA).join(`${BARRA}u2028`)
    .split(SEPARADOR_PARRAFO).join(`${BARRA}u2029`);
}
