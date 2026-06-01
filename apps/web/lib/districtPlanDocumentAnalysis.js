function stripHtml(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitStatements(text) {
  return String(text || '')
    .split(/(?<=[.。])|[\n\r;]+|(?=\d+\.\s)|(?=제\s*\d+\s*조)/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
}

function confidenceForCandidate(candidate, candidates) {
  const context = candidate.context || ''
  let score = 0.45
  if (/(이하|상한|최고|허용|기준|적용)/.test(context)) score += 0.25
  if (/(완화|인센티브|상향|별도)/.test(context)) score += 0.15
  if (/(예시|도면|범례|주석|참고)/.test(context)) score -= 0.2
  if (candidates.filter((item) => item.type === candidate.type).length > 1) score -= 0.1
  return Math.max(0.1, Math.min(0.95, Number(score.toFixed(2))))
}

function snippetsFor(text, keywords) {
  const source = String(text || '')
  return keywords.flatMap((keyword) => {
    const index = source.indexOf(keyword)
    if (index < 0) return []
    const start = Math.max(0, index - 60)
    const end = Math.min(source.length, index + 160)
    return [{
      keyword,
      snippet: `${start > 0 ? '...' : ''}${source.slice(start, end)}${end < source.length ? '...' : ''}`,
    }]
  })
}

function extractNumericHints(text) {
  const hints = []
  const source = String(text || '')
  const patterns = [
    { type: 'bcr', category: 'density', label: '건폐율', regex: /건폐율[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*%/g },
    { type: 'far', category: 'density', label: '용적률', regex: /용적률[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*%/g },
    { type: 'height', category: 'height', label: '높이', regex: /높이[^0-9]{0,30}([0-9]+(?:\.[0-9]+)?)\s*m/gi },
    { type: 'floor', label: '층수', regex: /([0-9]+)\s*층\s*(?:이하|이상|허용|권장)?/g },
  ]
  for (const pattern of patterns) {
    let match = pattern.regex.exec(source)
    while (match) {
      const start = Math.max(0, match.index - 80)
      const end = Math.min(source.length, match.index + match[0].length + 120)
      hints.push({
        type: pattern.type,
        category: pattern.category || 'mass',
        label: pattern.label,
        value: Number(match[1]),
        raw: match[0],
        context: source.slice(start, end).trim(),
      })
      match = pattern.regex.exec(source)
    }
  }
  return hints.map((hint) => ({
    ...hint,
    confidence: confidenceForCandidate(hint, hints),
  }))
}

function extractStatementRules(statements) {
  const ruleDefinitions = [
    { category: 'density', label: '규모 기준', keywords: ['건폐율', '용적률', '허용용적률', '상한용적률'] },
    { category: 'height', label: '높이/층수 기준', keywords: ['높이', '층수', '최고높이', '최고층수'] },
    { category: 'use', label: '용도 기준', keywords: ['허용용도', '불허용도', '권장용도', '지정용도', '용도'] },
    { category: 'boundary', label: '한계선/벽면 기준', keywords: ['건축한계선', '벽면한계선', '벽면지정선', '대지안의 공지'] },
    { category: 'open_space', label: '공개공지/조경 기준', keywords: ['공개공지', '조경', '녹지'] },
    { category: 'parking', label: '주차 기준', keywords: ['주차', '차량출입', '주차출입구'] },
  ]
  return statements.flatMap((statement) => {
    const matched = ruleDefinitions.filter((definition) =>
      definition.keywords.some((keyword) => statement.includes(keyword)),
    )
    return matched.map((definition) => ({
      category: definition.category,
      label: definition.label,
      keywords: definition.keywords.filter((keyword) => statement.includes(keyword)),
      text: statement,
      needsManualReview: true,
    }))
  })
}

function buildDocumentSummary({ numericHints, densityCandidates, ruleCandidates, normalized }) {
  const bcrCandidates = densityCandidates.filter((candidate) => candidate.type === 'bcr')
  const farCandidates = densityCandidates.filter((candidate) => candidate.type === 'far')
  const heightCandidates = numericHints.filter((candidate) => candidate.type === 'height' || candidate.type === 'floor')
  const incentiveKeywords = ['인센티브', '완화', '상한', '허용용적률', '상한용적률', '공공기여', '공개공지', '권장용도']
  const incentiveRules = ruleCandidates
    .filter((rule) => incentiveKeywords.some((keyword) => rule.text.includes(keyword)))
    .slice(0, 8)
  const incentiveSnippets = snippetsFor(normalized, incentiveKeywords).slice(0, 8)
  const pick = (candidates) => {
    if (candidates.length === 0) return null
    const sorted = [...candidates].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return b.value - a.value
    })
    return sorted[0]
  }
  const bcr = pick(bcrCandidates)
  const far = pick(farCandidates)
  const height = pick(heightCandidates)
  const riskNotes = []
  if (bcrCandidates.length > 1) riskNotes.push(`건폐율 후보가 ${bcrCandidates.length}개입니다. 획지/용도/블록 조건별 원문 확인이 필요합니다.`)
  if (farCandidates.length > 1) riskNotes.push(`용적률 후보가 ${farCandidates.length}개입니다. 허용/상한/인센티브 조건별 원문 확인이 필요합니다.`)
  if (!bcr) riskNotes.push('건폐율 후보를 문서에서 찾지 못했습니다.')
  if (!far) riskNotes.push('용적률 후보를 문서에서 찾지 못했습니다.')
  if (!height) riskNotes.push('높이 또는 층수 후보를 문서에서 찾지 못했습니다.')
  if (incentiveRules.length > 0 || incentiveSnippets.length > 0) {
    riskNotes.push('인센티브표는 계획 조건과 맞물려 자동 산정하지 않고 원문 요약 및 수동확인 대상으로 분류합니다.')
  }

  const confidenceValues = [bcr?.confidence, far?.confidence, height?.confidence].filter((value) => value != null)
  const confidence = confidenceValues.length
    ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(2))
    : 0

  const toBasis = (candidate) => candidate ? {
    type: candidate.type,
    label: candidate.label,
    value: candidate.value,
    raw: candidate.raw,
    context: candidate.context,
    confidence: candidate.confidence,
  } : null

  return {
    density: {
      bcrPercent: bcr?.value ?? null,
      farPercent: far?.value ?? null,
      basis: [toBasis(bcr), toBasis(far)].filter(Boolean),
      candidateCounts: {
        bcr: bcrCandidates.length,
        far: farCandidates.length,
      },
    },
    height: {
      value: height?.value ?? null,
      unit: height?.type === 'floor' ? '층' : height ? 'm' : null,
      basis: [toBasis(height)].filter(Boolean),
      candidateCount: heightCandidates.length,
    },
    incentives: {
      available: incentiveRules.length > 0 || incentiveSnippets.length > 0,
      rules: incentiveRules,
      snippets: incentiveSnippets,
      autoCalculationSupported: false,
      note: '인센티브표는 공개공지, 권장용도, 공공기여 등 계획 조건과 맞물려 자동 산정하지 않고 수동 검토합니다.',
    },
    confidence,
    source: 'uploaded-district-plan-document',
    finalValuesRequireManualInput: true,
    needsManualReview: true,
    riskNotes,
  }
}

export function analyzeDistrictPlanText(text, metadata = {}) {
  const normalized = stripHtml(text)
  const statements = splitStatements(normalized)
  const keywords = [
    '건폐율',
    '용적률',
    '높이',
    '층수',
    '허용용도',
    '불허용도',
    '권장용도',
    '지정용도',
    '건축한계선',
    '벽면한계선',
    '공개공지',
    '주차',
    '조경',
  ]
  const matched = keywords.filter((keyword) => normalized.includes(keyword))
  const numericHints = extractNumericHints(normalized)
  const ruleCandidates = extractStatementRules(statements)
  const densityCandidates = numericHints.filter((hint) => hint.type === 'bcr' || hint.type === 'far')
  const documentSummary = buildDocumentSummary({
    numericHints,
    densityCandidates,
    ruleCandidates,
    normalized,
  })
  const riskNotes = [
    ...documentSummary.riskNotes,
    '건폐율, 용적률, 높이의 최종 적용값은 첨부문서 요약을 참고해 사용자가 수동 입력해야 합니다.',
    '업로드 문서 분석 결과는 OCR/문맥 해석 오류 가능성이 있어 최종 인허가 기준으로 사용하기 전 원문 대조가 필요합니다.',
  ]
  return {
    status: normalized ? 'text-indexed' : 'text-unavailable',
    filename: metadata.filename,
    contentType: metadata.contentType,
    textLength: normalized.length,
    matchedKeywords: matched,
    snippets: snippetsFor(normalized, matched).slice(0, 12),
    numericHints,
    densityCandidates,
    ruleCandidates: ruleCandidates.slice(0, 20),
    documentSummary,
    effectiveLimits: null,
    useRestrictionCandidates: snippetsFor(normalized, ['허용용도', '불허용도', '권장용도', '지정용도']),
    riskNotes,
    needsManualReview: true,
    message: normalized
      ? '문서 텍스트에서 지구단위계획 관련 후보 기준을 추출했습니다.'
      : '문서에서 텍스트를 추출하지 못했습니다. OCR 또는 수동확인이 필요합니다.',
  }
}
