import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { analyzeDistrictPlanText } from '../../../../lib/districtPlanDocumentAnalysis'
import { extractTextWithOcr } from '../../../../lib/ocrAdapter'

const UPLOAD_ROOT = path.join(process.cwd(), '..', '..', '.fam-cache', 'district_plan_documents')
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_TEXT_CHARS = 300000
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.html', '.htm', '.md'])

function safeName(value, fallback = 'district-plan-document') {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120) || fallback
}

function decodeText(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
}

function extractPdfText(buffer) {
  const latin = Buffer.from(buffer).toString('latin1')
  const strings = []
  const pattern = /\(([^()]{2,300})\)\s*Tj/g
  let match = pattern.exec(latin)
  while (match) {
    strings.push(match[1].replace(/\\([()\\])/g, '$1'))
    match = pattern.exec(latin)
  }
  return strings.join(' ').replace(/\s+/g, ' ').trim()
}

function resultSummary(result) {
  const legacyLimits = result.analysis?.effectiveLimits
  const documentSummary = result.analysis?.documentSummary || (legacyLimits ? {
    density: {
      bcrPercent: legacyLimits.bcrPercent ?? null,
      farPercent: legacyLimits.farPercent ?? null,
      basis: legacyLimits.basis || [],
      candidateCounts: legacyLimits.candidateCounts || {},
    },
    height: { value: null, unit: null, basis: [], candidateCount: 0 },
    incentives: {
      available: false,
      autoCalculationSupported: false,
      note: '기존 분석 이력입니다. 인센티브표 요약은 새로 업로드한 문서부터 표시됩니다.',
    },
    confidence: legacyLimits.confidence || 0,
    finalValuesRequireManualInput: true,
    needsManualReview: true,
    riskNotes: legacyLimits.riskNotes || [],
  } : null)
  const analysis = result.analysis ? {
    ...result.analysis,
    documentSummary,
    effectiveLimits: null,
  } : null
  return {
    id: result.id,
    savedAt: result.savedAt,
    parcelKey: result.parcelKey,
    document: result.document,
    status: analysis?.status,
    extractionMode: analysis?.extractionMode,
    textLength: analysis?.textLength || 0,
    ocrRequired: analysis?.ocrRequired === true,
    matchedKeywords: analysis?.matchedKeywords || [],
    documentSummary,
    effectiveLimits: null,
    riskNotes: analysis?.riskNotes || [],
    analysis,
  }
}

async function loadAnalysisHistory(parcelKey) {
  const folder = path.join(UPLOAD_ROOT, parcelKey)
  let files = []
  try {
    files = await readdir(folder)
  } catch {
    return []
  }

  const jsonFiles = files
    .filter((file) => file.endsWith('.analysis.json'))
    .sort()
    .reverse()
    .slice(0, 10)

  const results = []
  for (const file of jsonFiles) {
    try {
      const payload = JSON.parse(await readFile(path.join(folder, file), 'utf-8'))
      results.push(resultSummary(payload))
    } catch {
      // Ignore unreadable cache entries; they should not block the UI.
    }
  }
  return results
}

async function deleteAnalysisEntry(parcelKey, id) {
  const folder = path.join(UPLOAD_ROOT, parcelKey)
  const savedAt = safeName(String(id || '').split('/').pop(), '')
  if (!savedAt) return false
  const analysisPath = path.join(folder, `${savedAt}.analysis.json`)
  try {
    const payload = JSON.parse(await readFile(analysisPath, 'utf-8'))
    const filename = safeName(payload?.document?.filename, '')
    if (filename) {
      await unlink(path.join(folder, filename)).catch(() => {})
    }
    await unlink(analysisPath)
    return true
  } catch {
    return false
  }
}

async function deleteAllAnalysisEntries(parcelKey) {
  const folder = path.join(UPLOAD_ROOT, parcelKey)
  let files = []
  try {
    files = await readdir(folder)
  } catch {
    return 0
  }
  let deleted = 0
  for (const file of files) {
    await unlink(path.join(folder, file)).then(() => {
      deleted += 1
    }).catch(() => {})
  }
  return deleted
}

async function saveAnalysisResult(folder, savedAt, result) {
  await writeFile(
    path.join(folder, `${savedAt}.analysis.json`),
    JSON.stringify(result, null, 2),
    'utf-8',
  )
}

async function analyzePastedText(request) {
  const body = await request.json()
  const parcelKey = safeName(body.parcelKey, 'unknown-parcel')
  const text = String(body.text || '').trim()
  if (!text) {
    return NextResponse.json({ success: false, detail: '분석할 문서 텍스트가 없습니다.' }, { status: 400 })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { success: false, detail: '붙여넣기 텍스트는 30만자 이하로 입력해주세요.' },
      { status: 413 },
    )
  }

  const savedAt = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')
  const originalName = `${safeName(body.title, 'pasted-district-plan-text')}.txt`
  const filename = `${savedAt}_${originalName}`
  const folder = path.join(UPLOAD_ROOT, parcelKey)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, filename), text, 'utf-8')

  const analysis = analyzeDistrictPlanText(text, {
    filename: originalName,
    contentType: 'text/plain',
  })
  const result = {
    id: `${parcelKey}/${savedAt}`,
    savedAt,
    parcelKey,
    success: true,
    document: {
      filename,
      originalName,
      contentType: 'text/plain',
      source: 'pasted-text',
      size: Buffer.byteLength(text, 'utf-8'),
      storageKey: `${parcelKey}/${filename}`,
      extractionMode: 'pasted-text',
      ocrRequired: false,
    },
    analysis: {
      ...analysis,
      ocrRequired: false,
      extractionMode: 'pasted-text',
      ocr: null,
    },
  }
  await saveAnalysisResult(folder, savedAt, result)

  return NextResponse.json({
    ...result,
    history: await loadAnalysisHistory(parcelKey),
  })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const parcelKey = safeName(searchParams.get('parcelKey'), 'unknown-parcel')
    const history = await loadAnalysisHistory(parcelKey)
    return NextResponse.json({
      success: true,
      parcelKey,
      history,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, detail: error.message || '지구단위계획 문서 분석 이력 조회에 실패했습니다.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const parcelKey = safeName(body.parcelKey, 'unknown-parcel')
    let deleted = 0
    if (body.all === true) {
      deleted = await deleteAllAnalysisEntries(parcelKey)
    } else if (body.id) {
      deleted = await deleteAnalysisEntry(parcelKey, body.id) ? 1 : 0
    } else {
      return NextResponse.json({ success: false, detail: '삭제할 분석 이력이 지정되지 않았습니다.' }, { status: 400 })
    }
    return NextResponse.json({
      success: true,
      parcelKey,
      deleted,
      history: await loadAnalysisHistory(parcelKey),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, detail: error.message || '지구단위계획 문서 분석 이력 삭제에 실패했습니다.' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const contentTypeHeader = request.headers.get('content-type') || ''
    if (contentTypeHeader.includes('application/json')) {
      return analyzePastedText(request)
    }

    const form = await request.formData()
    const file = form.get('file')
    const parcelKey = safeName(form.get('parcelKey'), 'unknown-parcel')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, detail: '업로드 파일이 없습니다.' }, { status: 400 })
    }

    const originalName = safeName(file.name || 'document')
    const extension = path.extname(originalName).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { success: false, detail: 'PDF, JPG/PNG/WEBP, TXT/HTML/MD 파일만 업로드할 수 있습니다.' },
        { status: 415 },
      )
    }
    const savedAt = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')
    const filename = `${savedAt}_${originalName}`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, detail: '25MB 이하의 문서만 업로드할 수 있습니다.' },
        { status: 413 },
      )
    }
    const folder = path.join(UPLOAD_ROOT, parcelKey)
    await mkdir(folder, { recursive: true })
    const filePath = path.join(folder, filename)
    await writeFile(filePath, buffer)

    const contentType = file.type || ''
    let extractedText = ''
    let extractionMode = 'unsupported'
    let ocrRequired = false
    let ocr = null
    if (contentType.startsWith('text/') || ['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(extension)) {
      extractedText = decodeText(arrayBuffer)
      extractionMode = 'text'
    } else if (contentType === 'application/pdf' || extension === '.pdf') {
      extractedText = extractPdfText(arrayBuffer)
      extractionMode = extractedText ? 'pdf-text-layer' : 'pdf-ocr-required'
      ocrRequired = !extractedText
    } else if (contentType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      extractionMode = 'image-ocr-required'
      ocrRequired = true
    }

    if (ocrRequired) {
      ocr = await extractTextWithOcr({ filePath, extension, contentType })
      if (ocr.text) {
        extractedText = ocr.text
        extractionMode = `ocr-${ocr.provider}`
        ocrRequired = false
      }
    }

    const analysis = analyzeDistrictPlanText(extractedText, {
      filename: originalName,
      contentType,
    })

    const result = {
      id: `${parcelKey}/${savedAt}`,
      savedAt,
      parcelKey,
      success: true,
      document: {
        filename,
        originalName,
        contentType,
        size: buffer.length,
        storageKey: `${parcelKey}/${filename}`,
        extractionMode,
        ocrRequired,
      },
      analysis: {
        ...analysis,
        ocrRequired,
        extractionMode,
        ocr,
      },
    }
    await saveAnalysisResult(folder, savedAt, result)

    return NextResponse.json({
      ...result,
      history: await loadAnalysisHistory(parcelKey),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, detail: error.message || '지구단위계획 문서 분석에 실패했습니다.' },
      { status: 500 },
    )
  }
}
