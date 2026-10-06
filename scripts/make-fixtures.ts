// Generates fixtures/*.pptx and fixtures/sample.pdf used by the PowerPoint COM integration test.
// Run: npx tsx scripts/make-fixtures.ts
import PptxGenJS from 'pptxgenjs'
import path from 'node:path'
import fs from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const outDir = path.resolve(__dirname, '..', 'fixtures')
fs.mkdirSync(outDir, { recursive: true })

async function make(file: string, count: number, notesOn: number[]): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'FOUR_THREE', width: 10, height: 7.5 })
  pptx.layout = 'FOUR_THREE'
  for (let i = 1; i <= count; i++) {
    const slide = pptx.addSlide()
    slide.background = { color: i % 2 ? 'FFFFFF' : 'E8F0FE' }
    slide.addText(`Slide ${i}`, { x: 1, y: 2.5, w: 8, h: 2, fontSize: 48, align: 'center' })
    if (notesOn.includes(i)) slide.addNotes(`Catatan slide ${i}`)
  }
  await pptx.writeFile({ fileName: path.join(outDir, file) })
}

async function makePdf(file: string, count: number): Promise<void> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= count; i++) {
    const page = pdf.addPage([960, 540])
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      color: i % 2 ? rgb(1, 1, 1) : rgb(0.91, 0.94, 1)
    })
    page.drawText(`Halaman ${i}`, { x: 300, y: 250, size: 64, font, color: rgb(0.1, 0.1, 0.1) })
  }
  fs.writeFileSync(path.join(outDir, file), await pdf.save())
}

async function main(): Promise<void> {
  await make('sample-4x3.pptx', 3, [2])
  await make('sample-12.pptx', 12, [2, 10])
  await makePdf('sample.pdf', 3)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
