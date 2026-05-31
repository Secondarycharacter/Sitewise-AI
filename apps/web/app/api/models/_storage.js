import { mkdir, readFile, writeFile, copyFile, unlink } from 'fs/promises'
import path from 'path'

export const SAVED_MODEL_ROOT = path.join(process.cwd(), 'public', 'saved_models')

export function safePathPart(value, fallback = 'unknown-parcel') {
  const text = String(value || '').trim() || fallback
  return text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120) || fallback
}

export function publicSavedModelUrl(folder, filename) {
  return `/saved_models/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`
}

export async function copyModelIfAvailable(modelUrl, folderPath, folder, stem) {
  if (!modelUrl) return ''
  try {
    const parsed = new URL(modelUrl, 'http://localhost:3001')
    const sourcePath = decodeURIComponent(parsed.pathname || '')
    const targetFilename = `${stem}.glb`
    const targetPath = path.join(folderPath, targetFilename)

    if (sourcePath.startsWith('/saved_models/')) {
      const localSource = path.join(process.cwd(), 'public', sourcePath.replace(/^\/+/, ''))
      await copyFile(localSource, targetPath)
      return publicSavedModelUrl(folder, targetFilename)
    }

    const response = await fetch(modelUrl)
    if (!response.ok) return modelUrl
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(targetPath, buffer)
    return publicSavedModelUrl(folder, targetFilename)
  } catch {
    return modelUrl
  }
}

export async function writeSaveFile(folder, stem, payload) {
  const folderPath = path.join(SAVED_MODEL_ROOT, folder)
  await mkdir(folderPath, { recursive: true })
  const filePath = path.join(folderPath, `${stem}.json`)
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
  return filePath
}

export async function readSaveFile(folder, filename) {
  const safeFolder = safePathPart(folder)
  const safeFilename = safePathPart(filename, 'unknown.json').endsWith('.json')
    ? safePathPart(filename, 'unknown.json')
    : `${safePathPart(filename, 'unknown')}.json`
  const filePath = path.join(SAVED_MODEL_ROOT, safeFolder, safeFilename)
  return JSON.parse(await readFile(filePath, 'utf-8'))
}

export async function deleteSaveFiles(folder, filename) {
  const safeFolder = safePathPart(folder)
  const safeFilename = safePathPart(filename, 'unknown.json').endsWith('.json')
    ? safePathPart(filename, 'unknown.json')
    : `${safePathPart(filename, 'unknown')}.json`
  const stem = safeFilename.replace(/\.json$/, '')
  const jsonPath = path.join(SAVED_MODEL_ROOT, safeFolder, safeFilename)
  const glbPath = path.join(SAVED_MODEL_ROOT, safeFolder, `${stem}.glb`)
  await unlink(jsonPath)
  await unlink(glbPath).catch(() => {})
}

export function saveSummary(folder, filename, payload) {
  return {
    id: `${folder}/${filename}`,
    parcelKey: folder,
    filename,
    savedAt: payload?.savedAt || filename.replace(/\.json$/, ''),
    address: payload?.state?.address || '',
  }
}
