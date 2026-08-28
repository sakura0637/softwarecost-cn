import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { extractText } from '../../../utils/extract'
import { readMultipartFormData, createError } from 'h3'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = user.role === 'admin'
    ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    : await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const parts = await readMultipartFormData(event).catch(() => null)

  if (parts && parts.length) {
    const file = parts[0]
    const filename = file.filename || 'upload.bin'
    const ext = extname(filename)

    const uploadDir = join(process.cwd(), 'data', 'uploads')
    await mkdir(uploadDir, { recursive: true })
    const safeName = `${id}_${Date.now()}${ext}`
    const fullPath = join(uploadDir, safeName)
    await writeFile(fullPath, file.data)

    let rawText = ''
    try {
      rawText = await extractText(fullPath, ext)
    } catch {
      rawText = ''
    }

    await db.prepare(
      "UPDATE projects SET document_path = ?, raw_text = ?, updated_at = now() WHERE id = ?"
    ).run(fullPath, rawText, id)

    return {
      ok: true,
      document_path: fullPath,
      rawTextLength: rawText.length,
      rawTextPreview: rawText
    }
  }

  // 无文件：接受直接粘贴的需求文本
  const body = (await readBody(event).catch(() => ({})) as any)
  const text = String(body.text || '').trim()
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: '未收到文件或文本' })
  }
  await db.prepare("UPDATE projects SET raw_text = ?, updated_at = now() WHERE id = ?").run(text, id)
  return {
    ok: true,
    rawTextLength: text.length,
    rawTextPreview: text
  }
})
