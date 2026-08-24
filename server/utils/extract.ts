import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'

// 从上传的需求文档中提取纯文本，供 AI 识别功能点
export async function extractText(filePath: string, ext: string): Promise<string> {
  const lower = ext.toLowerCase()

  if (lower === '.txt' || lower === '.md' || lower === '.csv') {
    return (await readFile(filePath, 'utf-8')).trim()
  }

  if (lower === '.docx') {
    const buf = await readFile(filePath)
    const res = await mammoth.extractRawText({ buffer: buf })
    return res.value.trim()
  }

  if (lower === '.xlsx' || lower === '.xls') {
    const buf = await readFile(filePath)
    const wb = XLSX.read(buf, { type: 'buffer' })
    let text = ''
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      text += `【${sheetName}】\n`
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      for (const row of rows) {
        text += (row as unknown as string[]).join('\t') + '\n'
      }
    }
    return text.trim()
  }

  throw new Error('不支持的文件类型: ' + ext)
}
