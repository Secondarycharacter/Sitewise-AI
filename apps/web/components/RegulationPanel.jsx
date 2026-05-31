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
  if (status === 'law-openapi-referenced') return '법제처 조회됨'
  if (status === 'fallback' || status === 'error' || status === 'skipped') return 'fallback 사용'
  if (needsManualReview) return '수동확인 필요'
  return '출처 확인'
}

function badgeStyle(source, needsManualReview) {
  const status = typeof source === 'object' ? source?.status : source
  if (status === 'law-openapi-referenced') {
    return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
  }
  if (needsManualReview) {
    return { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }
  }
  return { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }
}

export default function RegulationPanel({ parcel, regulations, setback, onApplyOverrides }) {
  const [bcrInput, setBcrInput] = useState('')
  const [farInput, setFarInput] = useState('')

  useEffect(() => {
    const limits = regulations?.limits
    if (!limits) return
    setBcrInput(String(limits.bcr_percent ?? ''))
    setFarInput(String(limits.far_percent ?? ''))
  }, [regulations?.limits?.bcr_percent, regulations?.limits?.far_percent])

  if (!regulations) return null

  const zone = regulations.zone || {}
  const limits = regulations.limits
  const computed = regulations.computed || {}
  const land = regulations.land || {}
  const available = regulations.available !== false
  const source = regulations.source
  const lawReferences = Array.isArray(regulations.lawReferences) ? regulations.lawReferences : []
  const needsManualReview = regulations.needsManualReview === true
  const jurisdiction = regulations.jurisdiction || {}
  const visibleLawReferences = lawReferences.slice(0, 8)

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
              법규 기준값을 임의 조정 후 모델링에 반영
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
            <button
              onClick={() => onApplyOverrides?.({
                bcrPercent: bcrInput,
                farPercent: farInput,
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
