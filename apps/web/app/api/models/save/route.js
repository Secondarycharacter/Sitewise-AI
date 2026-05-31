import { NextResponse } from 'next/server'
import path from 'path'
import {
  copyModelIfAvailable,
  safePathPart,
  saveSummary,
  SAVED_MODEL_ROOT,
  writeSaveFile,
} from '../_storage'

export async function POST(request) {
  try {
    const body = await request.json()
    const state = { ...(body.state || {}) }
    const folder = safePathPart(
      body.parcelKey || state.parcel?.address || state.address,
      'unknown-parcel',
    )
    const savedAt = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '_')
    const folderPath = path.join(SAVED_MODEL_ROOT, folder)
    const modelUrl = await copyModelIfAvailable(state.modelUrl, folderPath, folder, savedAt)
    if (modelUrl) state.modelUrl = modelUrl

    const filename = `${savedAt}.json`
    const payload = {
      version: 1,
      savedAt,
      parcelKey: folder,
      state,
    }
    await writeSaveFile(folder, savedAt, payload)

    return NextResponse.json({
      success: true,
      save: saveSummary(folder, filename, payload),
    })
  } catch (error) {
    return NextResponse.json(
      { detail: error.message || '저장에 실패했습니다.' },
      { status: 500 },
    )
  }
}
