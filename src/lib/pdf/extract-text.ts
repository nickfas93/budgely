import { PDFParse } from 'pdf-parse'

/**
 * Extrai texto bruto de um PDF usando pdf-parse (PDF.js).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}
