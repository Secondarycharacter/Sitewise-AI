import { NextResponse } from 'next/server'
import { deleteSaveFiles, readSaveFile } from '../../../_storage'

export async function GET(_request, { params }) {
  try {
    const payload = await readSaveFile(params.folder, params.filename)
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json(
      { detail: '저장된 모델을 찾을 수 없습니다.' },
      { status: 404 },
    )
  }
}

export async function DELETE(_request, { params }) {
  try {
    await deleteSaveFiles(params.folder, params.filename)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { detail: '삭제할 저장 모델을 찾을 수 없습니다.' },
      { status: 404 },
    )
  }
}
