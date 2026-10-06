// Generates fixtures/*.pptx used by the PowerPoint COM integration test.
// Run: npx tsx scripts/make-fixtures.ts
import PptxGenJS from 'pptxgenjs'
import path from 'node:path'
import fs from 'node:fs'

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

async function main(): Promise<void> {
  await make('sample-4x3.pptx', 3, [2])
  await make('sample-12.pptx', 12, [2, 10])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
