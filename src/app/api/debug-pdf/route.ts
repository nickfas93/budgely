import { NextResponse } from 'next/server'
import { extractPdfText } from '@/lib/pdf/extract-text'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('file') as Blob
  const buffer = Buffer.from(await file.arrayBuffer())
  const text = await extractPdfText(buffer)
  return NextResponse.json({ text })
}
