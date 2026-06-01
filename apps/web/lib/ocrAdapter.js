import { spawn } from 'child_process'
import { mkdtemp, readdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_PDF_MAX_PAGES = 5

function providerName() {
  return String(process.env.FAM_OCR_PROVIDER || '').trim().toLowerCase()
}

function isImageExtension(extension) {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(String(extension || '').toLowerCase())
}

function isPdfExtension(extension) {
  return String(extension || '').toLowerCase() === '.pdf'
}

function runCommand(command, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({
        ok: false,
        stdout,
        stderr: stderr || 'OCR 명령 시간이 초과되었습니다.',
        exitCode: null,
        timedOut: true,
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        stdout,
        stderr: error.message,
        exitCode: null,
        timedOut: false,
      })
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        exitCode,
        timedOut: false,
      })
    })
  })
}

async function runTesseractForImage(filePath) {
  const command = process.env.TESSERACT_CMD || 'tesseract'
  const language = process.env.FAM_OCR_LANG || 'kor+eng'
  const timeoutMs = Number(process.env.FAM_OCR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const result = await runCommand(command, [filePath, 'stdout', '-l', language, '--psm', '6'], timeoutMs)
  const text = String(result.stdout || '').replace(/\s+/g, ' ').trim()
  if (!result.ok) {
    return {
      provider: 'local-tesseract',
      text: '',
      status: result.timedOut ? 'timeout' : 'failed',
      message: result.stderr || '로컬 Tesseract OCR 실행에 실패했습니다.',
    }
  }

  return {
    provider: 'local-tesseract',
    text,
    status: text ? 'succeeded' : 'empty',
    message: text ? '로컬 Tesseract OCR로 텍스트를 추출했습니다.' : 'OCR은 실행됐지만 추출된 텍스트가 없습니다.',
  }
}

async function convertPdfToImages(filePath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'fam-pdf-ocr-'))
  const command = process.env.PDF_TO_IMAGE_CMD || 'pdftoppm'
  const dpi = String(process.env.FAM_OCR_PDF_DPI || '200')
  const maxPages = Math.max(1, Number(process.env.FAM_OCR_PDF_MAX_PAGES || DEFAULT_PDF_MAX_PAGES))
  const outputPrefix = path.join(tempDir, 'page')
  const result = await runCommand(
    command,
    ['-png', '-r', dpi, '-f', '1', '-l', String(maxPages), filePath, outputPrefix],
    Number(process.env.FAM_OCR_PDF_CONVERT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  )
  if (!result.ok) {
    return {
      ok: false,
      tempDir,
      images: [],
      provider: 'pdftoppm',
      status: result.timedOut ? 'timeout' : 'failed',
      message: result.stderr
        ? `PDF 페이지 이미지 변환에 실패했습니다. Poppler(pdftoppm) 설치 또는 PDF_TO_IMAGE_CMD 설정이 필요합니다. (${result.stderr})`
        : 'PDF 페이지 이미지 변환에 실패했습니다. Poppler(pdftoppm) 설치 또는 PDF_TO_IMAGE_CMD 설정이 필요합니다.',
      maxPages,
    }
  }

  const files = await readdir(tempDir)
  const images = files
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort()
    .map((file) => path.join(tempDir, file))
  return {
    ok: images.length > 0,
    tempDir,
    images,
    provider: 'pdftoppm',
    status: images.length > 0 ? 'succeeded' : 'empty',
    message: images.length > 0
      ? `PDF ${images.length}페이지를 OCR용 이미지로 변환했습니다.`
      : 'PDF 변환은 실행됐지만 생성된 페이지 이미지가 없습니다.',
    maxPages,
  }
}

async function runLocalTesseractForPdf(filePath) {
  let conversion = null
  try {
    conversion = await convertPdfToImages(filePath)
    if (!conversion.ok) {
      return {
        status: 'pdf_conversion_failed',
        provider: 'local-tesseract',
        text: '',
        message: conversion.message,
        conversion: {
          provider: conversion.provider,
          status: conversion.status,
          maxPages: conversion.maxPages,
        },
        pages: [],
        pageCount: 0,
      }
    }

    const pages = []
    for (const [index, imagePath] of conversion.images.entries()) {
      const pageResult = await runTesseractForImage(imagePath)
      pages.push({
        page: index + 1,
        status: pageResult.status,
        textLength: pageResult.text.length,
        message: pageResult.message,
      })
      if (pageResult.text) {
        pages[pages.length - 1].text = pageResult.text
      }
    }
    const text = pages.map((page) => page.text || '').filter(Boolean).join('\n\n')
    const failedPages = pages.filter((page) => page.status === 'failed' || page.status === 'timeout')
    const status = text ? 'succeeded' : failedPages.length === pages.length ? 'failed' : 'empty'
    return {
      status,
      provider: 'local-tesseract',
      text,
      message: text
        ? `스캔 PDF ${pages.length}페이지에서 OCR 텍스트를 추출했습니다.`
        : 'PDF 페이지 OCR을 실행했지만 추출된 텍스트가 없습니다.',
      conversion: {
        provider: conversion.provider,
        status: conversion.status,
        maxPages: conversion.maxPages,
      },
      pages: pages.map(({ text: _text, ...page }) => page),
      pageCount: pages.length,
    }
  } finally {
    if (conversion?.tempDir) {
      await rm(conversion.tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function runLocalTesseract({ filePath, extension }) {
  if (isImageExtension(extension)) {
    return runTesseractForImage(filePath)
  }

  if (isPdfExtension(extension)) {
    return runLocalTesseractForPdf(filePath)
  }

  return {
    status: 'unsupported',
    provider: 'local-tesseract',
    text: '',
    message: '현재 로컬 OCR은 이미지 파일과 스캔 PDF만 처리합니다.',
  }
}

export async function extractTextWithOcr({ filePath, extension, contentType }) {
  const provider = providerName()
  if (!provider || provider === 'none') {
    return {
      status: 'not_configured',
      provider: provider || 'none',
      text: '',
      message: 'FAM_OCR_PROVIDER가 설정되지 않았습니다. 이미지/스캔 PDF 문서 분석에는 OCR 설정이 필요합니다.',
    }
  }

  if (provider === 'local-tesseract') {
    return runLocalTesseract({ filePath, extension, contentType })
  }

  return {
    status: 'unsupported_provider',
    provider,
    text: '',
    message: `지원하지 않는 OCR provider입니다: ${provider}`,
  }
}
