// Utilidades de texto para PDF. Las fuentes estándar de PDF solo dibujan el alfabeto "WinAnsi" (el de Windows
// en español/inglés): sirven tildes, ñ, ¿ ¡, comillas y guiones largos, pero NO emojis ni otros alfabetos.
// Un solo carácter no soportado haría fallar la generación de todo el documento, por eso se reemplaza por "?".

// Caracteres de la zona 0x80-0x9F de WinAnsi que sí existen (además de 0x20-0x7E y 0xA0-0xFF)
const WINANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!),
);

function codificable(codigo: number): boolean {
  return (codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff) || WINANSI_EXTRA.has(codigo);
}

export function toWinAnsi(texto: string): string {
  let salida = "";
  for (const simbolo of texto.replace(/\r\n?/g, "\n")) {
    const codigo = simbolo.codePointAt(0)!;
    if (simbolo === "\n") salida += "\n";
    else if (simbolo === "\t") salida += " ";
    else if (codigo < 0x20 || (codigo >= 0x7f && codigo < 0xa0)) continue; // controles invisibles
    else salida += codificable(codigo) ? simbolo : "?";
  }
  return salida;
}

// Parte un texto en líneas que quepan en "ancho" puntos. "medir" dice cuánto mide un texto con la fuente en uso.
export function wrapText(texto: string, ancho: number, medir: (s: string) => number): string[] {
  if (!(ancho > 0)) throw new Error("El ancho debe ser mayor que cero");

  const lineas: string[] = [];
  for (const parrafo of texto.split("\n")) {
    if (parrafo.trim() === "") {
      lineas.push("");
      continue;
    }
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const candidata = actual ? `${actual} ${palabra}` : palabra;
      if (medir(candidata) <= ancho) {
        actual = candidata;
        continue;
      }
      if (actual) lineas.push(actual);
      // Palabra más larga que la línea: se parte en pedazos que quepan
      let resto = palabra;
      while (medir(resto) > ancho) {
        let corte = resto.length - 1;
        while (corte > 1 && medir(resto.slice(0, corte)) > ancho) corte--;
        lineas.push(resto.slice(0, corte));
        resto = resto.slice(corte);
      }
      actual = resto;
    }
    lineas.push(actual);
  }
  return lineas;
}
