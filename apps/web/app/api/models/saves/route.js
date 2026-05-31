import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { safePathPart, saveSummary, SAVED_MODEL_ROOT } from '../_storage'

async function readJsonIfPossible(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'))
  } catch {
    return null
  }
}

async function listFolder(folder) {
  const folderPath = path.join(SAVED_MODEL_ROOT, folder)
  try {
    const entries = await readdir(folderPath, { withFileTypes: true })
    const saves = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const payload = await readJsonIfPossible(path.join(folderPath, entry.name))
          return saveSummary(folder, entry.name, payload)
        }),
    )
    return saves
  } catch {
    return []
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const parcelKey = searchParams.get('parcelKey')

  if (parcelKey) {
    const saves = await listFolder(safePathPart(parcelKey))
    return NextResponse.json({ success: true, saves: saves.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) })
  }

  try {
    const folders = await readdir(SAVED_MODEL_ROOT, { withFileTypes: true })
    const nested = await Promise.all(
      folders
        .filter((entry) => entry.isDirectory())
        .map((entry) => listFolder(entry.name)),
    )
    const saves = nested.flat().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    return NextResponse.json({ success: true, saves })
  } catch {
    return NextResponse.json({ success: true, saves: [] })
  }
}
