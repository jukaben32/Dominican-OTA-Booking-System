// Constructor sencillo de documentos PDF (tamaño Carta) con pdf-lib.
// Solo sabe lo necesario: títulos, párrafos, listas, filas clave-valor, tablas y pie de página con numeración.
// Salta de página solo cuando hace falta. Todo el texto pasa por toWinAnsi para no romper el documento.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { toWinAnsi, wrapText } from "./text";

const PAGE_WIDTH = 612; // Carta, en puntos
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 66;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

// Colores de la marca (los mismos de la web)
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const COLORES = {
  tinta: hex("#10242b"),
  suave: hex("#566a70"),
  mar: hex("#0b6e7a"),
  coral: hex("#e2552b"),
  linea: hex("#dccfb8"),
  fondo: hex("#f5efe4"),
  ok: hex("#1f7a4d"),
};

interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
  indent?: number;
  lineGap?: number;
}

export class PdfBuilder {
  private page: PDFPage;
  private y: number;

  private constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly footerText: string,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  static async create(opts: { title: string; author: string; footer: string }): Promise<PdfBuilder> {
    const doc = await PDFDocument.create();
    doc.setTitle(toWinAnsi(opts.title));
    doc.setAuthor(toWinAnsi(opts.author));
    doc.setCreationDate(new Date());
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new PdfBuilder(doc, regular, bold, toWinAnsi(opts.footer));
  }

  private fontFor(negrita?: boolean): PDFFont {
    return negrita ? this.bold : this.regular;
  }

  private nuevaPagina(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  // Si no queda espacio para "alto" puntos, pasa a una página nueva
  private asegurarEspacio(alto: number): void {
    if (this.y - alto < MARGIN_BOTTOM) this.nuevaPagina();
  }

  space(puntos: number): this {
    this.y -= puntos;
    return this;
  }

  rule(color: RGB = COLORES.linea): this {
    this.asegurarEspacio(10);
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: PAGE_WIDTH - MARGIN_X, y: this.y }, thickness: 0.8, color });
    this.y -= 10;
    return this;
  }

  // Escribe texto con salto automático de línea y de página
  text(contenido: string, opts: TextOptions = {}): this {
    const size = opts.size ?? 10;
    const font = this.fontFor(opts.bold);
    const sangria = opts.indent ?? 0;
    const interlinea = size * (opts.lineGap ?? 1.35);
    const ancho = CONTENT_WIDTH - sangria;
    const lineas = wrapText(toWinAnsi(contenido), ancho, (s) => font.widthOfTextAtSize(s, size));

    for (const linea of lineas) {
      this.asegurarEspacio(interlinea);
      if (linea) {
        this.page.drawText(linea, { x: MARGIN_X + sangria, y: this.y - size, size, font, color: opts.color ?? COLORES.tinta });
      }
      this.y -= interlinea;
    }
    return this;
  }

  heading(contenido: string): this {
    this.space(10);
    this.asegurarEspacio(40);
    this.text(contenido, { size: 13, bold: true, color: COLORES.mar });
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y + 2 }, end: { x: MARGIN_X + 36, y: this.y + 2 }, thickness: 2, color: COLORES.coral });
    this.y -= 6;
    return this;
  }

  bullets(items: readonly string[], opts: { color?: RGB } = {}): this {
    for (const item of items) {
      const lineas = wrapText(toWinAnsi(item), CONTENT_WIDTH - 14, (s) => this.regular.widthOfTextAtSize(s, 10));
      this.asegurarEspacio(13.5);
      this.page.drawCircle({ x: MARGIN_X + 3, y: this.y - 6, size: 1.6, color: COLORES.coral });
      lineas.forEach((linea, i) => {
        if (i > 0) this.asegurarEspacio(13.5);
        this.page.drawText(linea, { x: MARGIN_X + 14, y: this.y - 10, size: 10, font: this.regular, color: opts.color ?? COLORES.tinta });
        this.y -= 13.5;
      });
    }
    return this;
  }

  // Pares "etiqueta: valor" en dos columnas
  keyValues(filas: readonly (readonly [string, string])[], anchoEtiqueta = 130): this {
    for (const [etiqueta, valor] of filas) {
      const lineas = wrapText(toWinAnsi(valor), CONTENT_WIDTH - anchoEtiqueta, (s) => this.bold.widthOfTextAtSize(s, 10));
      this.asegurarEspacio(lineas.length * 13.5);
      this.page.drawText(toWinAnsi(etiqueta), { x: MARGIN_X, y: this.y - 10, size: 9.5, font: this.regular, color: COLORES.suave });
      lineas.forEach((linea) => {
        this.page.drawText(linea, { x: MARGIN_X + anchoEtiqueta, y: this.y - 10, size: 10, font: this.bold, color: COLORES.tinta });
        this.y -= 13.5;
      });
    }
    return this;
  }

  // Tabla simple con encabezado; "alineadasDerecha" indica columnas numéricas
  table(opts: { headers: string[]; rows: string[][]; widths: number[]; rightAligned?: number[] }): this {
    const derecha = new Set(opts.rightAligned ?? []);
    const dibujarFila = (celdas: string[], negrita: boolean, fondo?: RGB) => {
      const font = this.fontFor(negrita);
      const lineasPorCelda = celdas.map((c, i) => wrapText(toWinAnsi(c), opts.widths[i] - 8, (s) => font.widthOfTextAtSize(s, 9.5)));
      const alto = Math.max(...lineasPorCelda.map((l) => l.length)) * 12.5 + 6;
      this.asegurarEspacio(alto);
      if (fondo) this.page.drawRectangle({ x: MARGIN_X, y: this.y - alto, width: CONTENT_WIDTH, height: alto, color: fondo });
      let x = MARGIN_X;
      lineasPorCelda.forEach((lineas, i) => {
        lineas.forEach((linea, j) => {
          const ancho = font.widthOfTextAtSize(linea, 9.5);
          const px = derecha.has(i) ? x + opts.widths[i] - 4 - ancho : x + 4;
          this.page.drawText(linea, { x: px, y: this.y - 12 - j * 12.5, size: 9.5, font, color: COLORES.tinta });
        });
        x += opts.widths[i];
      });
      this.y -= alto;
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: PAGE_WIDTH - MARGIN_X, y: this.y }, thickness: 0.5, color: COLORES.linea });
    };

    dibujarFila(opts.headers, true, COLORES.fondo);
    for (const fila of opts.rows) dibujarFila(fila, false);
    this.y -= 6;
    return this;
  }

  // Recuadro destacado (por ejemplo: "CONFIRMADA")
  callout(titulo: string, detalle: string, color: RGB = COLORES.mar): this {
    const lineas = wrapText(toWinAnsi(detalle), CONTENT_WIDTH - 24, (s) => this.regular.widthOfTextAtSize(s, 10));
    const alto = 30 + lineas.length * 13.5;
    this.asegurarEspacio(alto + 8);
    this.page.drawRectangle({ x: MARGIN_X, y: this.y - alto, width: CONTENT_WIDTH, height: alto, borderColor: color, borderWidth: 1.2, color: COLORES.fondo });
    this.page.drawText(toWinAnsi(titulo), { x: MARGIN_X + 12, y: this.y - 20, size: 12, font: this.bold, color });
    lineas.forEach((linea, i) => {
      this.page.drawText(linea, { x: MARGIN_X + 12, y: this.y - 36 - i * 13.5, size: 10, font: this.regular, color: COLORES.tinta });
    });
    this.y -= alto + 8;
    return this;
  }

  // Cabecera de marca en la primera página
  masthead(marca: string, subtitulo: string): this {
    const pagina = this.page;
    pagina.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: COLORES.coral });
    pagina.drawText(toWinAnsi(marca), { x: MARGIN_X, y: PAGE_HEIGHT - 44, size: 18, font: this.bold, color: COLORES.tinta });
    pagina.drawText(toWinAnsi(subtitulo), { x: MARGIN_X, y: PAGE_HEIGHT - 60, size: 9.5, font: this.regular, color: COLORES.suave });
    this.y = PAGE_HEIGHT - 84;
    return this;
  }

  // Pie con numeración "Página 1 de N" en todas las páginas, y devuelve los bytes del PDF
  async build(): Promise<Uint8Array> {
    const paginas = this.doc.getPages();
    paginas.forEach((pagina, i) => {
      pagina.drawLine({ start: { x: MARGIN_X, y: 44 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 44 }, thickness: 0.5, color: COLORES.linea });
      pagina.drawText(this.footerText, { x: MARGIN_X, y: 30, size: 8, font: this.regular, color: COLORES.suave });
      const numero = `Página ${i + 1} de ${paginas.length}`;
      pagina.drawText(numero, {
        x: PAGE_WIDTH - MARGIN_X - this.regular.widthOfTextAtSize(numero, 8),
        y: 30, size: 8, font: this.regular, color: COLORES.suave,
      });
    });
    return this.doc.save();
  }
}
