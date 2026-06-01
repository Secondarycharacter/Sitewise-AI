'use client'

import { useEffect, useState } from 'react'

function Row({ label, value, highlight }) {
  const display =
    value === null || value === undefined || value === ''
      ? '-'
      : value

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid #eee',
        fontWeight: highlight ? 600 : 400,
      }}
    >
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ textAlign: 'right', maxWidth: '60%' }}>{display}</span>
    </div>
  )
}

const SOURCE_LABEL = {
  cadastral: '실제 필지 경계',
  approximate: '좌표 기준 근사',
  demo: '데모 데이터',
}

function regulationSourceLabel(source) {
  if (!source) return '-'
  if (typeof source === 'string') {
    if (source === 'national_default_table') return 'fallback 기본 규정표'
    return source
  }
  return source.label || source.status || source.type || '-'
}

function lawStatusLabel(source, needsManualReview) {
  const status = typeof source === 'object' ? source?.status : source
  if (status === 'law-document-indexed') return '원문/별표 검색 가능'
  if (status === 'law-openapi-referenced') return '법제처 조회됨'
  if (status === 'fallback' || status === 'error' || status === 'skipped') return 'fallback 사용'
  if (needsManualReview) return '수동확인 필요'
  return '출처 확인'
}

function badgeStyle(source, needsManualReview) {
  const status = typeof source === 'object' ? source?.status : source
  if (status === 'law-document-indexed' || status === 'law-openapi-referenced') {
    return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
  }
  if (needsManualReview) {
    return { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }
  }
  return { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }
}

const CHECK_STATUS_LABEL = {
  pass: '충족',
  fail: '불충족',
  needs_review: '확인필요',
  needs_input: '입력필요',
  data_missing: '자료필요',
  not_applicable: '해당없음',
}

function checkStatusStyle(status) {
  if (status === 'pass') return { color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0' }
  if (status === 'fail') return { color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca' }
  if (status === 'needs_input') return { color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe' }
  if (status === 'data_missing' || status === 'needs_review') {
    return { color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a' }
  }
  return { color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb' }
}

function ocrStatusLabel(status) {
  if (status === 'succeeded') return 'OCR 완료'
  if (status === 'empty') return 'OCR 결과 없음'
  if (status === 'not_configured') return 'OCR 설정 필요'
  if (status === 'unsupported') return 'OCR 미지원 형식'
  if (status === 'failed') return 'OCR 실패'
  if (status === 'timeout') return 'OCR 시간초과'
  if (status === 'unsupported_provider') return 'OCR 설정 오류'
  return status || 'OCR 미시도'
}

export default function RegulationPanel({ parcel, regulations, setback, onApplyOverrides }) {
  const [bcrInput, setBcrInput] = useState('')
  const [farInput, setFarInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  const [districtDocResult, setDistrictDocResult] = useState(null)
  const [districtDocHistory, setDistrictDocHistory] = useState([])
  const [districtDocError, setDistrictDocError] = useState('')
  const [districtDocTextTitle, setDistrictDocTextTitle] = useState('붙여넣은 지구단위계획 문서')
  const [districtDocText, setDistrictDocText] = useState('')
  const [districtDocExpanded, setDistrictDocExpanded] = useState({
    history: true,
    rules: false,
    snippets: false,
    risks: false,
  })
  const [isUploadingDistrictDoc, setIsUploadingDistrictDoc] = useState(false)
  const [isAnalyzingDistrictDocText, setIsAnalyzingDistrictDocText] = useState(false)
  const [isLoadingDistrictDocHistory, setIsLoadingDistrictDocHistory] = useState(false)

  useEffect(() => {
    const limits = regulations?.limits
    if (!limits) return
    setBcrInput(String(limits.bcr_percent ?? ''))
    setFarInput(String(limits.far_percent ?? ''))
    setHeightInput(String(limits.max_height_m ?? ''))
  }, [regulations?.limits?.bcr_percent, regulations?.limits?.far_percent, regulations?.limits?.max_height_m])

  useEffect(() => {
    const parcelKey = parcel?.pnu || parcel?.address
    if (!parcelKey) {
      setDistrictDocHistory([])
      setDistrictDocResult(null)
      return
    }

    let cancelled = false
    setDistrictDocResult(null)
    async function loadHistory() {
      setIsLoadingDistrictDocHistory(true)
      setDistrictDocError('')
      try {
        const response = await fetch(`/api/district-plan/analyze?parcelKey=${encodeURIComponent(parcelKey)}`)
        const result = await response.json()
        if (!response.ok || result.success === false) {
          throw new Error(result.detail || '문서 분석 이력 조회에 실패했습니다.')
        }
        if (cancelled) return
        const history = Array.isArray(result.history) ? result.history : []
        setDistrictDocHistory(history)
        setDistrictDocResult((current) => current || (history[0] ? { success: true, ...history[0] } : null))
      } catch (error) {
        if (!cancelled) setDistrictDocError(error.message || '문서 분석 이력 조회에 실패했습니다.')
      } finally {
        if (!cancelled) setIsLoadingDistrictDocHistory(false)
      }
    }

    loadHistory()
    return () => {
      cancelled = true
    }
  }, [parcel?.pnu, parcel?.address])

  async function handleDistrictDocUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setIsUploadingDistrictDoc(true)
    setDistrictDocError('')
    const form = new FormData()
    form.append('file', file)
    form.append('parcelKey', parcel?.pnu || parcel?.address || 'unknown-parcel')
    try {
      const response = await fetch('/api/district-plan/analyze', {
        method: 'POST',
        body: form,
      })
      const result = await response.json()
      if (!response.ok || result.success === false) {
        throw new Error(result.detail || '문서 분석에 실패했습니다.')
      }
      setDistrictDocResult(result)
      setDistrictDocHistory(Array.isArray(result.history) ? result.history : [])
    } catch (error) {
      setDistrictDocError(error.message || '문서 분석에 실패했습니다.')
      setDistrictDocResult(null)
    } finally {
      setIsUploadingDistrictDoc(false)
      event.target.value = ''
    }
  }

  async function handleDistrictDocTextAnalyze() {
    const text = districtDocText.trim()
    if (!text) {
      setDistrictDocError('분석할 문서 텍스트를 입력해주세요.')
      return
    }

    setIsAnalyzingDistrictDocText(true)
    setDistrictDocError('')
    try {
      const response = await fetch('/api/district-plan/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcelKey: parcel?.pnu || parcel?.address || 'unknown-parcel',
          title: districtDocTextTitle || '붙여넣은 지구단위계획 문서',
          text,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.success === false) {
        throw new Error(result.detail || '문서 텍스트 분석에 실패했습니다.')
      }
      setDistrictDocResult(result)
      setDistrictDocHistory(Array.isArray(result.history) ? result.history : [])
      setDistrictDocText('')
    } catch (error) {
      setDistrictDocError(error.message || '문서 텍스트 분석에 실패했습니다.')
      setDistrictDocResult(null)
    } finally {
      setIsAnalyzingDistrictDocText(false)
    }
  }

  function selectDistrictDocHistory(entry) {
    setDistrictDocResult({ success: true, ...entry })
    setDistrictDocError('')
  }

  function toggleDistrictDocSection(key) {
    setDistrictDocExpanded((current) => ({ ...current, [key]: !current[key] }))
  }

  async function deleteDistrictDocHistory(id = null) {
    const parcelKey = parcel?.pnu || parcel?.address || 'unknown-parcel'
    setDistrictDocError('')
    try {
      const response = await fetch('/api/district-plan/analyze', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { parcelKey, id } : { parcelKey, all: true }),
      })
      const result = await response.json()
      if (!response.ok || result.success === false) {
        throw new Error(result.detail || '문서 분석 이력 삭제에 실패했습니다.')
      }
      const history = Array.isArray(result.history) ? result.history : []
      setDistrictDocHistory(history)
      setDistrictDocResult((current) => {
        if (!id) return null
        return current?.id === id ? (history[0] ? { success: true, ...history[0] } : null) : current
      })
    } catch (error) {
      setDistrictDocError(error.message || '문서 분석 이력 삭제에 실패했습니다.')
    }
  }

  function fillManualInputsFromDistrictDocSummary() {
    const summary = districtDocResult?.analysis?.documentSummary
    if (!summary) return
    if (summary.density?.bcrPercent != null) setBcrInput(String(summary.density.bcrPercent))
    if (summary.density?.farPercent != null) setFarInput(String(summary.density.farPercent))
    if (summary.height?.value != null) setHeightInput(String(summary.height.value))
  }

  if (!regulations) return null

  const zone = regulations.zone || {}
  const limits = regulations.limits
  const computed = regulations.computed || {}
  const land = regulations.land || {}
  const available = regulations.available !== false
  const source = regulations.source
  const lawReferences = Array.isArray(regulations.lawReferences) ? regulations.lawReferences : []
  const articleReferences = Array.isArray(regulations.articleReferences) ? regulations.articleReferences : []
  const appendixReferences = Array.isArray(regulations.appendixReferences) ? regulations.appendixReferences : []
  const lawDocumentStatus = regulations.lawDocumentStatus || {}
  const lawDocumentSummaries = Array.isArray(regulations.lawDocumentSummaries)
    ? regulations.lawDocumentSummaries
    : []
  const lawSearchResults = Array.isArray(regulations.lawSearchResults)
    ? regulations.lawSearchResults
    : []
  const articleAppendixLinks = Array.isArray(regulations.articleAppendixLinks)
    ? regulations.articleAppendixLinks
    : []
  const buildingUseTaxonomy = regulations.buildingUseTaxonomy || null
  const buildingProgram = regulations.buildingProgram || null
  const parkingRuleTables = Array.isArray(regulations.parkingRuleTables)
    ? regulations.parkingRuleTables
    : []
  const parkingCalculation = regulations.parkingCalculation || null
  const siteCompliance = regulations.siteCompliance || null
  const eum = regulations.eum || null
  const districtPlan = regulations.districtPlan || null
  const visibleComplianceChecks = Array.isArray(siteCompliance?.checks)
    ? siteCompliance.checks.slice(0, 10)
    : []
  const visibleEvidencePlan = Array.isArray(siteCompliance?.evidenceCollectionPlan)
    ? siteCompliance.evidenceCollectionPlan.slice(0, 8)
    : []
  const needsManualReview = regulations.needsManualReview === true
  const jurisdiction = regulations.jurisdiction || {}
  const visibleLawReferences = lawReferences.slice(0, 8)
  const visibleLawDocumentSummaries = lawDocumentSummaries.slice(0, 5)
  const visibleArticleAppendixLinks = articleAppendixLinks.slice(0, 3)
  const visibleBuildingUseCategories = Array.isArray(buildingUseTaxonomy?.categories)
    ? buildingUseTaxonomy.categories.slice(0, 6)
    : []
  const buildingProgramMissingInputs = Array.isArray(buildingProgram?.parkingReadiness?.missingInputs)
    ? buildingProgram.parkingReadiness.missingInputs.slice(0, 5)
    : []
  const visibleBuildingProgramUseGroups = Array.isArray(buildingProgram?.useGroups)
    ? buildingProgram.useGroups.slice(0, 4)
    : []
  const visibleParkingRules = parkingRuleTables.flatMap((table) => table.rules || []).slice(0, 6)
  const visibleParkingRows = Array.isArray(parkingCalculation?.rows)
    ? parkingCalculation.rows.slice(0, 6)
    : []
  const visibleEumDistricts = Array.isArray(eum?.districts) ? eum.districts.slice(0, 8) : []
  const visibleEumRestrictions = Array.isArray(eum?.restrictionItems)
    ? eum.restrictionItems.slice(0, 6)
    : []
  const districtDocSummary = districtDocResult?.analysis?.documentSummary || null

  return (
    <aside
      style={{
        width: 340,
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 20,
        background: '#fafafa',
        maxHeight: 700,
        overflowY: 'auto',
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        건축규제 분석
      </h2>

      <Row label="검색 지번" value={parcel?.address} highlight />
      {parcel?.pnu && <Row label="PNU" value={parcel.pnu} />}
      <Row
        label="형상 출처"
        value={SOURCE_LABEL[parcel?.geometry_source] || parcel?.geometry_source}
      />
      <Row
        label="대지면적"
        value={
          computed.site_area_m2 != null && computed.site_area_m2 > 0
            ? `${computed.site_area_m2} ㎡`
            : '조회 불가'
        }
        highlight
      />
      <Row label="적용 용도지역" value={zone.matched} highlight />
      <Row label="용도지역(1)" value={zone.primary} />
      <Row label="용도지역(2)" value={zone.secondary} />
      <div
        style={{
          marginTop: 14,
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: 'white',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>법규 출처</strong>
          <span
            style={{
              ...badgeStyle(source, needsManualReview),
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {lawStatusLabel(source, needsManualReview)}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#555', lineHeight: 1.5 }}>
          <div>적용 상태: {regulationSourceLabel(source)}</div>
          {jurisdiction.displayName && <div>관할: {jurisdiction.displayName}</div>}
          {needsManualReview && (
            <div style={{ color: '#b45309' }}>
              원문/별표 수치의 최종 적용 여부는 수동확인이 필요합니다.
            </div>
          )}
        </div>
        {visibleLawReferences.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              법제처 조회 후보
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.5 }}>
              {visibleLawReferences.map((reference, index) => (
                <li key={`${reference.target || 'law'}-${reference.id || reference.title}-${index}`}>
                  {reference.url ? (
                    <a
                      href={reference.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#2563eb', textDecoration: 'none' }}
                    >
                      {reference.title}
                    </a>
                  ) : (
                    reference.title
                  )}
                  {reference.effectiveDate ? ` · 시행 ${reference.effectiveDate}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: '#777' }}>
            법제처 조회 후보가 아직 없습니다. `LAW_OC` 설정 또는 조회 결과를 확인하세요.
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid #f0f0f0',
            fontSize: 12,
            color: '#555',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>본문 조문 + 연결 별표 색인 상태</div>
          <div>
            색인 문서: {lawDocumentStatus.indexed || 0} / {lawDocumentStatus.requested || 0}
            {lawDocumentStatus.hasAppendices ? ' · 별표 후보 확인됨' : ''}
          </div>
          <div>
            본문 후보: {articleReferences.length} · 별표 후보: {appendixReferences.length} · 색인 조문:{' '}
            {lawDocumentStatus.articleIndexed || 0} · 색인 별표: {lawDocumentStatus.appendixIndexed || 0}
          </div>
          {visibleLawDocumentSummaries.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {visibleLawDocumentSummaries.map((document, index) => (
                <li key={`${document.title}-${index}`}>
                  {document.title} · 조문 {document.articleCount || 0} · 별표 {document.appendixCount || 0}
                </li>
              ))}
            </ul>
          )}
        </div>
        {lawSearchResults.some((group) => (group.results || []).length > 0) && (
          <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>조문/별표 검색 결과</div>
            {lawSearchResults.map((group, groupIndex) => {
              const results = Array.isArray(group.results) ? group.results.slice(0, 2) : []
              if (results.length === 0) return null
              return (
                <div
                  key={`${group.query}-${groupIndex}`}
                  style={{
                    marginTop: 8,
                    padding: 8,
                    border: '1px solid #eef2ff',
                    borderRadius: 6,
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#374151' }}>{group.query}</div>
                  {results.map((result, resultIndex) => (
                    <div key={`${result.lawTitle}-${result.sectionId}-${resultIndex}`} style={{ marginTop: 6 }}>
                      <div style={{ color: '#2563eb', fontWeight: 600 }}>
                        {result.lawTitle} · {result.sectionTitle}
                        {result.sectionType === 'appendix' ? ' · 별표' : ''}
                      </div>
                      <div style={{ color: '#555' }}>{result.snippet}</div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        {visibleArticleAppendixLinks.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>본문-별표 연결</div>
            {visibleArticleAppendixLinks.map((link, index) => (
              <div key={`${link.appendixNumber || 'appendix'}-${index}`} style={{ marginTop: 6 }}>
                <div style={{ color: '#374151' }}>
                  {link.article?.sectionTitle || '본문 조문'} → 별표 {link.appendixNumber || '-'}
                </div>
                <div style={{ color: '#2563eb' }}>{link.appendix?.sectionTitle}</div>
              </div>
            ))}
          </div>
        )}
        {buildingUseTaxonomy && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #dcfce7',
              borderRadius: 8,
              background: '#f0fdf4',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>건축물 용도 분류 기준</strong>
              <span
                style={{
                  fontWeight: 700,
                  color: buildingUseTaxonomy.status === 'parsed' ? '#047857' : '#b45309',
                }}
              >
                {buildingUseTaxonomy.authoritative ? 'API 원문' : 'API 미확인'}
              </span>
            </div>
            <div style={{ color: '#555', marginTop: 4 }}>
              {buildingUseTaxonomy.sourceLabel || '건축법 시행령 별표 1'} · 분류{' '}
              {buildingUseTaxonomy.categoryCount ?? visibleBuildingUseCategories.length}개
            </div>
            {buildingUseTaxonomy.source?.lawTitle && (
              <div style={{ color: '#2563eb' }}>
                {buildingUseTaxonomy.source.lawTitle} · {buildingUseTaxonomy.source.sectionTitle || '별표'}
              </div>
            )}
            {buildingUseTaxonomy.message && (
              <div style={{ color: '#b45309' }}>{buildingUseTaxonomy.message}</div>
            )}
            {!buildingUseTaxonomy.authoritative && (
              <div style={{ color: '#b45309' }}>
                법적 용도 판단은 법제처 원문 확인 전까지 확정하지 않습니다.
              </div>
            )}
            {buildingUseTaxonomy.seedCoverage && (
              <div style={{ color: '#555' }}>
                Seed 대조: {buildingUseTaxonomy.seedCoverage.matchedCount || 0}/
                {buildingUseTaxonomy.seedCoverage.seedCount || 0}
              </div>
            )}
            {visibleBuildingUseCategories.length > 0 && (
              <div style={{ marginTop: 6, color: '#374151' }}>
                예: {visibleBuildingUseCategories.map((item) => item.name).join(', ')}
              </div>
            )}
          </div>
        )}
        {visibleParkingRules.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>주차 산정 규칙 초안</div>
            {visibleParkingRules.map((rule, index) => (
              <div
                key={`${rule.number}-${index}`}
                style={{
                  marginTop: 6,
                  padding: 8,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: '#fff',
                }}
              >
                <div style={{ fontWeight: 700, color: '#374151' }}>
                  {rule.number}. {rule.facility}
                </div>
                <div style={{ color: '#555' }}>{rule.standard}</div>
                <div style={{ color: rule.needsManualReview ? '#b45309' : '#047857' }}>
                  {rule.calculation?.method || 'manual_review_required'}
                  {rule.calculation?.divisorM2 ? ` · ${rule.calculation.divisorM2}㎡당 1대` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
        {buildingProgram && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #e9d5ff',
              borderRadius: 8,
              background: '#faf5ff',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>건축개요/면적 구성</strong>
              <span style={{ fontWeight: 700, color: buildingProgram.needsInput ? '#b45309' : '#6d28d9' }}>
                {buildingProgram.projectTypeLabel || '미분류'}
              </span>
            </div>
            <div style={{ marginTop: 4, color: '#555' }}>
              연면적 {buildingProgram.areaSummary?.grossAreaM2 ?? 0}㎡ · 전용{' '}
              {buildingProgram.areaSummary?.exclusiveAreaM2 ?? 0}㎡ · 공용{' '}
              {buildingProgram.areaSummary?.commonAreaM2 ?? 0}㎡
            </div>
            {buildingProgram.unitSummary?.unitCount > 0 && (
              <div style={{ color: '#555' }}>
                세대/호실 {buildingProgram.unitSummary.unitCount}개 · 전용면적 합계{' '}
                {buildingProgram.unitSummary.totalExclusiveAreaM2
                  ?? buildingProgram.unitSummary.unitExclusiveAreaM2
                  ?? 0}㎡
              </div>
            )}
            {visibleBuildingProgramUseGroups.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {visibleBuildingProgramUseGroups.map((group) => (
                  <div key={group.key} style={{ color: '#555' }}>
                    {group.label}: 전용 {group.exclusiveAreaM2 ?? 0}㎡ / 공용 {group.commonAreaM2 ?? 0}㎡
                  </div>
                ))}
              </div>
            )}
            {buildingProgram.commonAreaAllocation?.status === 'candidate' && (
              <div style={{ color: '#6d28d9' }}>
                공용면적 배분 후보: {buildingProgram.commonAreaAllocation.method}
              </div>
            )}
            {buildingProgramMissingInputs.length > 0 && (
              <div style={{ marginTop: 6, color: '#b45309' }}>
                추가 입력 필요: {buildingProgramMissingInputs.join(', ')}
              </div>
            )}
            {buildingProgram.parkingReadiness?.housingCalculationReady && (
              <div style={{ marginTop: 6, color: '#047857' }}>
                주택/오피스텔 세대·호실 입력 확인됨
              </div>
            )}
          </div>
        )}
        {parkingCalculation && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #dbeafe',
              borderRadius: 8,
              background: '#eff6ff',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>필요 주차대수 산정</strong>
              <span style={{ fontWeight: 700 }}>
                {parkingCalculation.available
                  ? `${parkingCalculation.requiredCount ?? '-'}대`
                  : parkingCalculation.partialRequiredCount != null
                    ? `부분 ${parkingCalculation.partialRequiredCount}대`
                    : '산정 불가'}
              </span>
            </div>
            {parkingCalculation.rawCount != null && (
              <div style={{ color: '#555' }}>원 산정값: {parkingCalculation.rawCount}대</div>
            )}
            {parkingCalculation.message && (
              <div style={{ color: parkingCalculation.available ? '#1d4ed8' : '#b45309' }}>
                {parkingCalculation.message}
              </div>
            )}
            {parkingCalculation.buildingUseTaxonomyStatus && (
              <div style={{ color: parkingCalculation.buildingUseTaxonomyAuthoritative ? '#047857' : '#b45309' }}>
                용도분류 근거:{' '}
                {parkingCalculation.buildingUseTaxonomyAuthoritative
                  ? '법제처 원문'
                  : 'API 원문 미확인'}
              </div>
            )}
            {visibleParkingRows.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {visibleParkingRows.map((row, index) => (
                  <div key={`${row.floorId || index}-${row.use}`} style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 700 }}>
                      {row.floorLabel || row.floorId} · {row.use}
                    </div>
                    <div style={{ color: '#555' }}>
                      {row.rule?.facility || row.formula || '매칭 규칙 없음'}
                      {row.requiredCount != null ? ` · ${row.requiredCount}대` : ''}
                    </div>
                    {row.unresolvedReason && (
                      <div style={{ color: '#b45309' }}>
                        {row.unresolvedReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {districtPlan && districtPlan.detected && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #fed7aa',
              borderRadius: 8,
              background: '#fff7ed',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>지구단위계획 규모 보정</strong>
              <span style={{ fontWeight: 700 }}>확인필요</span>
            </div>
            <div style={{ color: '#9a3412' }}>{districtPlan.summary}</div>
            <div style={{ marginTop: 6, color: '#555' }}>
              기본 건폐율 {districtPlan.baseLimits?.bcrPercent ?? '-'}% / 기본 용적률{' '}
              {districtPlan.baseLimits?.farPercent ?? '-'}%
            </div>
            <div style={{ color: '#555' }}>
              현재는 보정값 미확인으로 기본 기준을 임시 적용합니다.
            </div>
            {districtPlan.districts?.length > 0 && (
              <div style={{ marginTop: 6, color: '#555' }}>
                감지 구역: {districtPlan.districts.join(', ')}
              </div>
            )}
            {districtPlan.evidencePlan?.length > 0 && (
              <div style={{ marginTop: 6, color: '#9a3412' }}>
                추가 자동수집: {districtPlan.evidencePlan.map((item) => item.label).slice(0, 2).join(', ')}
              </div>
            )}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: '1px solid #e9d5ff',
            borderRadius: 8,
            background: '#faf5ff',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>지구단위계획 문서 첨부</strong>
            <span style={{ color: '#7e22ce', fontWeight: 700 }}>
              {isUploadingDistrictDoc || isAnalyzingDistrictDocText
                ? '분석중'
                : isLoadingDistrictDocHistory ? '이력조회' : 'PDF/JPG'}
            </span>
          </div>
          <div style={{ marginTop: 6, color: '#555' }}>
            결정도서·시행지침 파일을 첨부하면 건폐율/용적률/높이/용도 관련 후보 문구를 우선 추출합니다.
          </div>
          <label
            style={{
              display: 'block',
              marginTop: 8,
              padding: '8px 10px',
              border: '1px dashed #c084fc',
              borderRadius: 6,
              background: 'white',
              color: '#6b21a8',
              textAlign: 'center',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {isUploadingDistrictDoc ? '업로드 및 분석 중...' : '문서 업로드'}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.html,.htm,.md"
              onChange={handleDistrictDocUpload}
              disabled={isUploadingDistrictDoc}
              style={{ display: 'none' }}
            />
          </label>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, color: '#4c1d95' }}>문서 텍스트 직접 분석</div>
            <input
              type="text"
              value={districtDocTextTitle}
              onChange={(event) => setDistrictDocTextTitle(event.target.value)}
              placeholder="분석 이력 제목"
              disabled={isAnalyzingDistrictDocText}
              style={{
                width: '100%',
                marginTop: 6,
                padding: 8,
                border: '1px solid #e9d5ff',
                borderRadius: 6,
                boxSizing: 'border-box',
                fontSize: 12,
              }}
            />
            <textarea
              value={districtDocText}
              onChange={(event) => setDistrictDocText(event.target.value)}
              placeholder="PDF에서 복사한 텍스트 또는 외부 OCR 결과를 붙여넣으세요."
              rows={5}
              disabled={isAnalyzingDistrictDocText}
              style={{
                width: '100%',
                marginTop: 6,
                padding: 8,
                border: '1px solid #e9d5ff',
                borderRadius: 6,
                boxSizing: 'border-box',
                resize: 'vertical',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <button
              type="button"
              onClick={handleDistrictDocTextAnalyze}
              disabled={isAnalyzingDistrictDocText || !districtDocText.trim()}
              style={{
                width: '100%',
                marginTop: 6,
                padding: '8px 10px',
                border: 0,
                borderRadius: 6,
                background: districtDocText.trim() ? '#6d28d9' : '#d1d5db',
                color: 'white',
                cursor: districtDocText.trim() ? 'pointer' : 'default',
                fontWeight: 700,
              }}
            >
              {isAnalyzingDistrictDocText ? '텍스트 분석 중...' : '붙여넣은 텍스트 분석'}
            </button>
          </div>
          {districtDocError && (
            <div style={{ marginTop: 8, color: '#b91c1c' }}>{districtDocError}</div>
          )}
          {districtDocHistory.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => toggleDistrictDocSection('history')}
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: '#4c1d95',
                    fontWeight: 700,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  최근 분석 이력 {districtDocExpanded.history ? '접기' : '펼치기'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteDistrictDocHistory()}
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: '#b91c1c',
                    fontWeight: 700,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  전체 삭제
                </button>
              </div>
              {districtDocExpanded.history && districtDocHistory.slice(0, 3).map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    width: '100%',
                    marginTop: 6,
                    padding: 8,
                    border: entry.id === districtDocResult?.id ? '1px solid #7c3aed' : '1px solid #e9d5ff',
                    borderRadius: 6,
                    background: entry.id === districtDocResult?.id ? '#f5f3ff' : 'white',
                    color: '#4b5563',
                    textAlign: 'left',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => selectDistrictDocHistory(entry)}
                    style={{
                      width: '100%',
                      border: 0,
                      background: 'transparent',
                      padding: 0,
                      color: '#4b5563',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#4c1d95' }}>
                      {entry.document?.originalName || entry.document?.filename || '첨부문서'}
                    </div>
                    <div>
                      {entry.savedAt || '-'} · {entry.extractionMode || '-'} · 텍스트 {entry.textLength || 0}자
                    </div>
                    {entry.analysis?.documentSummary?.density && (
                      <div>
                        요약 후보: 건폐율 {entry.analysis.documentSummary.density.bcrPercent ?? '-'}% / 용적률{' '}
                        {entry.analysis.documentSummary.density.farPercent ?? '-'}%
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDistrictDocHistory(entry.id)}
                    style={{
                      marginTop: 4,
                      border: 0,
                      background: 'transparent',
                      color: '#b91c1c',
                      fontWeight: 700,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    이 분석 삭제
                  </button>
                </div>
              ))}
            </div>
          )}
          {districtDocResult && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#374151', fontWeight: 700 }}>
                {districtDocResult.document?.originalName}
              </div>
              <div style={{ color: '#555' }}>
                추출 방식: {districtDocResult.analysis?.extractionMode || '-'} · 텍스트{' '}
                {districtDocResult.analysis?.textLength || 0}자
              </div>
              {districtDocResult.analysis?.ocrRequired && (
                <div style={{ color: '#b45309' }}>
                  이미지 또는 텍스트 없는 PDF입니다. OCR 연동 후 본문 분석이 필요합니다.
                </div>
              )}
              {districtDocResult.analysis?.ocr && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    border: '1px solid #f3e8ff',
                    borderRadius: 6,
                    background: 'white',
                    color: districtDocResult.analysis.ocr.status === 'succeeded' ? '#047857' : '#7e22ce',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {ocrStatusLabel(districtDocResult.analysis.ocr.status)}
                    {' · '}
                    {districtDocResult.analysis.ocr.provider}
                  </div>
                  <div style={{ color: '#555' }}>{districtDocResult.analysis.ocr.message}</div>
                  {districtDocResult.analysis.ocr.conversion && (
                    <div style={{ color: '#555' }}>
                      PDF 변환: {ocrStatusLabel(districtDocResult.analysis.ocr.conversion.status)} ·{' '}
                      {districtDocResult.analysis.ocr.conversion.provider}
                      {districtDocResult.analysis.ocr.conversion.maxPages
                        ? ` · 최대 ${districtDocResult.analysis.ocr.conversion.maxPages}페이지`
                        : ''}
                    </div>
                  )}
                  {districtDocResult.analysis.ocr.pageCount > 0 && (
                    <div style={{ color: '#555' }}>
                      OCR 페이지: {districtDocResult.analysis.ocr.pageCount}페이지
                    </div>
                  )}
                  {districtDocResult.analysis.ocr.pages?.length > 0 && (
                    <div style={{ marginTop: 4, color: '#555' }}>
                      {districtDocResult.analysis.ocr.pages.slice(0, 3).map((page) => (
                        <div key={page.page}>
                          {page.page}p · {ocrStatusLabel(page.status)} · {page.textLength || 0}자
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {districtDocSummary && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>첨부문서 요약 후보</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                    {[
                      ['건폐율', districtDocSummary.density?.bcrPercent != null ? `${districtDocSummary.density.bcrPercent}%` : '-'],
                      ['용적률', districtDocSummary.density?.farPercent != null ? `${districtDocSummary.density.farPercent}%` : '-'],
                      ['높이', districtDocSummary.height?.value != null ? `${districtDocSummary.height.value}${districtDocSummary.height.unit || ''}` : '-'],
                      ['인센티브표', districtDocSummary.incentives?.available ? '수동검토' : '미감지'],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        style={{
                          padding: 8,
                          border: '1px solid #ddd6fe',
                          borderRadius: 6,
                          background: '#f5f3ff',
                          color: '#4c1d95',
                        }}
                      >
                        <div style={{ fontSize: 11, color: '#6d28d9' }}>{label}</div>
                        <div style={{ fontWeight: 700 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      border: '1px solid #ddd6fe',
                      borderRadius: 6,
                      background: 'white',
                      color: '#555',
                    }}
                  >
                    최종 건폐율·용적률·높이는 이 요약을 참고해 아래 수동 입력란에 직접 입력합니다.
                  </div>
                  <button
                    type="button"
                    onClick={fillManualInputsFromDistrictDocSummary}
                    style={{
                      width: '100%',
                      marginTop: 8,
                      padding: '7px 8px',
                      border: '1px solid #c084fc',
                      borderRadius: 6,
                      background: 'white',
                      color: '#6b21a8',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    요약 후보를 수동 입력란에 채우기
                  </button>
                  {districtDocResult.analysis.densityCandidates.slice(0, 4).map((hint, index) => (
                    <div key={`${hint.type}-${hint.raw}-${index}`} style={{ color: '#555' }}>
                      {hint.label} 후보: {hint.value}% · {hint.raw}
                    </div>
                  ))}
                  {districtDocSummary.incentives?.available && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        border: '1px solid #fed7aa',
                        borderRadius: 6,
                        background: '#fff7ed',
                        color: '#9a3412',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>인센티브표/완화 요약</div>
                      <div>{districtDocSummary.incentives.note}</div>
                      {districtDocSummary.incentives.snippets?.slice(0, 3).map((item, index) => (
                        <div key={`${item.keyword}-${index}`} style={{ marginTop: 4 }}>
                          {item.snippet}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {districtDocResult.analysis?.ruleCandidates?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => toggleDistrictDocSection('rules')}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#4c1d95',
                      fontWeight: 700,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    문서 규칙 후보 {districtDocExpanded.rules ? '접기' : '펼치기'} · {districtDocResult.analysis.ruleCandidates.length}개
                  </button>
                  {districtDocExpanded.rules && districtDocResult.analysis.ruleCandidates.slice(0, 8).map((rule, index) => (
                    <div key={`${rule.category}-${index}`} style={{ marginTop: 4, color: '#555' }}>
                      {rule.label}: {rule.text}
                    </div>
                  ))}
                </div>
              )}
              {districtDocResult.analysis?.matchedKeywords?.length > 0 && (
                <div style={{ marginTop: 8, color: '#555' }}>
                  감지 키워드: {districtDocResult.analysis.matchedKeywords.slice(0, 8).join(', ')}
                </div>
              )}
              {districtDocResult.analysis?.riskNotes?.length > 0 && (
                <div style={{ marginTop: 8, color: '#b45309' }}>
                  <button
                    type="button"
                    onClick={() => toggleDistrictDocSection('risks')}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#b45309',
                      fontWeight: 700,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    확인 필요 {districtDocExpanded.risks ? '접기' : '펼치기'} · {districtDocResult.analysis.riskNotes.length}개
                  </button>
                  {districtDocExpanded.risks && districtDocResult.analysis.riskNotes.slice(0, 6).map((note, index) => (
                    <div key={`${note}-${index}`}>확인 필요: {note}</div>
                  ))}
                </div>
              )}
              {districtDocResult.analysis?.snippets?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => toggleDistrictDocSection('snippets')}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#4c1d95',
                      fontWeight: 700,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    후보 문구 {districtDocExpanded.snippets ? '접기' : '펼치기'} · {districtDocResult.analysis.snippets.length}개
                  </button>
                  {districtDocExpanded.snippets && districtDocResult.analysis.snippets.slice(0, 8).map((item, index) => (
                    <div key={`${item.keyword}-${index}`} style={{ marginTop: 4, color: '#555' }}>
                      {item.snippet}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {eum && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #dcfce7',
              borderRadius: 8,
              background: '#f0fdf4',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>토지이음 행위제한 검토</strong>
              <span style={{ fontWeight: 700 }}>{eum.status || '-'}</span>
            </div>
            {eum.apiResponse?.message && (
              <div style={{ color: '#b45309' }}>{eum.apiResponse.message}</div>
            )}
            {visibleEumDistricts.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700 }}>지역·지구 후보</div>
                {visibleEumDistricts.map((district, index) => (
                  <div key={`${district.name}-${index}`} style={{ color: '#555' }}>
                    {district.name} · {district.kind || district.source}
                  </div>
                ))}
              </div>
            )}
            {visibleEumRestrictions.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700 }}>행위제한 검토 항목</div>
                {visibleEumRestrictions.map((item, index) => (
                  <div key={`${item.category}-${item.district || index}`} style={{ color: '#555' }}>
                    {item.summary}
                  </div>
                ))}
              </div>
            )}
            {eum.evidencePlan?.length > 0 && (
              <div style={{ marginTop: 8, color: '#166534' }}>
                다음 자동수집: {eum.evidencePlan.map((item) => item.label).slice(0, 2).join(', ')}
              </div>
            )}
          </div>
        )}
        {siteCompliance && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#fff',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>대지별 자동 법규 체크리스트</div>
            {siteCompliance.summary && (
              <div style={{ color: '#555', marginBottom: 8 }}>{siteCompliance.summary}</div>
            )}
            {visibleComplianceChecks.map((check) => (
              <div
                key={check.key}
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid #f3f4f6',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{check.label}</strong>
                  <span
                    style={{
                      ...checkStatusStyle(check.status),
                      borderRadius: 999,
                      padding: '2px 7px',
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {CHECK_STATUS_LABEL[check.status] || check.status}
                  </span>
                </div>
                <div style={{ color: '#555' }}>{check.summary}</div>
                {check.blockingChecks?.length > 0 && (
                  <div style={{ color: '#b45309' }}>
                    추가 자동확인: {check.blockingChecks.slice(0, 2).join(', ')}
                  </div>
                )}
              </div>
            ))}
            {visibleEvidencePlan.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>추가 자동확인 계획</div>
                {visibleEvidencePlan.map((item, index) => (
                  <div key={`${item.source}-${item.target}-${item.query || item.label}-${index}`} style={{ marginTop: 6 }}>
                    <div style={{ color: '#374151', fontWeight: 600 }}>
                      {item.source} · {item.label}
                    </div>
                    <div style={{ color: '#555' }}>
                      {item.query ? `검색어: ${item.query}` : item.target}
                      {item.required ? ' · 필수' : ' · 보조'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {available && limits ? (
        <>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginTop: 16,
              marginBottom: 4,
            }}
          >
            법정 규모
          </h3>
          <Row label="건폐율" value={`${limits.bcr_percent}%`} highlight />
          <Row label="용적률" value={`${limits.far_percent}%`} highlight />
          <Row
            label="높이 제한"
            value={limits.max_height_m != null ? `${limits.max_height_m} m` : '수동입력 필요'}
            highlight
          />
          <div
            style={{
              marginTop: 10,
              padding: 10,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: 'white',
            }}
          >
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              지구단위계획 요약을 참고해 최종 기준값을 수동 입력 후 모델링에 반영
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#444' }}>
              건폐율(%)
              <input
                type="number"
                min="0"
                step="0.1"
                value={bcrInput}
                onChange={(event) => setBcrInput(event.target.value)}
                style={{
                  width: '100%',
                  marginTop: 4,
                  marginBottom: 8,
                  border: '1px solid #ccc',
                  padding: 8,
                  boxSizing: 'border-box',
                }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 12, color: '#444' }}>
              용적률(%)
              <input
                type="number"
                min="0"
                step="0.1"
                value={farInput}
                onChange={(event) => setFarInput(event.target.value)}
                style={{
                  width: '100%',
                  marginTop: 4,
                  border: '1px solid #ccc',
                  padding: 8,
                  boxSizing: 'border-box',
                }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 12, color: '#444', marginTop: 8 }}>
              높이 제한(m)
              <input
                type="number"
                min="0"
                step="0.1"
                value={heightInput}
                onChange={(event) => setHeightInput(event.target.value)}
                style={{
                  width: '100%',
                  marginTop: 4,
                  border: '1px solid #ccc',
                  padding: 8,
                  boxSizing: 'border-box',
                }}
              />
            </label>
            <button
              onClick={() => onApplyOverrides?.({
                bcrPercent: bcrInput,
                farPercent: farInput,
                maxHeightM: heightInput,
              })}
              style={{
                width: '100%',
                marginTop: 10,
                padding: '9px 10px',
                border: 0,
                borderRadius: 6,
                background: '#111827',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              모델링에 반영
            </button>
          </div>
          <Row
            label="최대 건축면적"
            value={
              computed.max_building_area_m2 != null
                ? `${computed.max_building_area_m2} ㎡`
                : '-'
            }
          />
          <Row
            label="최대 연면적"
            value={
              computed.max_gross_floor_area_m2 != null
                ? `${computed.max_gross_floor_area_m2} ㎡`
                : '-'
            }
          />
        </>
      ) : (
        <p style={{ marginTop: 16, fontSize: 13, color: '#b45309' }}>
          용도지역·건폐율·용적률은 VWorld 토지특성 API 권한이 필요합니다.
          위치(PNU·좌표)는 주소 검색 결과를 사용합니다.
        </p>
      )}

      <Row label="지목" value={land.jimok} />
      <Row label="도로접면" value={land.road_side} />

      {setback && (
        <>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginTop: 16,
              marginBottom: 4,
            }}
          >
            대지안의 공지
          </h3>
          <Row label="적용 용도" value={setback.label} highlight />
          <Row label="이격거리" value={`${setback.distance_m} m`} highlight />
          <p style={{ marginTop: 8, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
            {setback.source}
          </p>
        </>
      )}

      {regulations.notes?.length > 0 && (
        <ul
          style={{
            marginTop: 16,
            paddingLeft: 18,
            fontSize: 12,
            color: '#666',
            lineHeight: 1.5,
          }}
        >
          {regulations.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </aside>
  )
}
