'use client'

const PROJECT_TYPE_LABELS = {
  general_building: '일반건축물',
  officetel: '오피스텔',
  mixed_use_officetel: '오피스텔+일반건축용도',
  neighborhood_house: '상가주택',
  multi_family_house: '다가구주택',
  apartment: '공동주택/아파트',
  mixed_use_residential: '주상복합/복합주거',
  mixed_use_general: '복합 일반건축물',
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatNumber(value, digits = 1) {
  const number = toNumber(value)
  if (number <= 0) return '-'
  return number.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatArea(value) {
  const number = toNumber(value)
  return number > 0 ? `${formatNumber(number, 1)}㎡` : '-'
}

function formatPercent(value) {
  const number = toNumber(value)
  return number > 0 ? `${formatNumber(number, 2)}%` : '-'
}

function formatCount(value) {
  const number = toNumber(value)
  return number > 0 ? `${formatNumber(number, 0)}대` : '-'
}

function formatPermitValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('ko-KR') : formatNumber(value, 3)
  if (typeof value === 'boolean') return value ? '예' : '아니오'
  return String(value)
}

function uniqueText(values) {
  const unique = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
  return unique.length ? unique.join(', ') : '-'
}

function areaComponentsByFloor(buildingProgram) {
  const grouped = {}
  for (const component of buildingProgram?.areaComponents || []) {
    const floorId = component.floorId || component.id
    if (!floorId) continue
    grouped[floorId] = grouped[floorId] || []
    grouped[floorId].push(component)
  }
  return grouped
}

function unitSummaryFromSettings(settingsProgram) {
  const units = Array.isArray(settingsProgram?.units) ? settingsProgram.units : []
  const unitCount = units.reduce((sum, unit) => sum + Math.max(1, Math.round(toNumber(unit.count, 1))), 0)
  const totalExclusiveAreaM2 = units.reduce((sum, unit) => {
    const count = Math.max(1, Math.round(toNumber(unit.count, 1)))
    return sum + count * toNumber(unit.unitExclusiveAreaM2 || unit.exclusiveAreaM2)
  }, 0)
  return {
    unitCount,
    totalExclusiveAreaM2,
    units,
    hasExplicitUnits: units.length > 0,
  }
}

function floorAreaBreakdown(plan, componentsByFloor) {
  const components = componentsByFloor[plan.id] || []
  if (!components.length) {
    const area = toNumber(plan.areaM2)
    return { exclusiveArea: area, commonArea: 0, subtotal: area }
  }
  const exclusiveArea = components
    .filter((component) => component.areaKind === 'exclusive')
    .reduce((sum, component) => sum + toNumber(component.areaM2), 0)
  const commonArea = components
    .filter((component) => ['common', 'mechanical', 'service_common'].includes(component.areaKind))
    .reduce((sum, component) => sum + toNumber(component.areaM2), 0)
  const subtotal = components.reduce((sum, component) => sum + toNumber(component.areaM2), 0)
  return {
    exclusiveArea: exclusiveArea || toNumber(plan.areaM2),
    commonArea,
    subtotal: subtotal || toNumber(plan.areaM2),
  }
}

function createOverviewData({ parcel, regulations, floorPlans, modelSettings }) {
  const permitSections = regulations?.buildingPermitOverview?.sections || {}
  const permitBasic = permitSections.basicOverview || {}
  const permitParking = permitSections.parking || {}
  const plans = floorPlans || []
  const abovePlans = plans.filter((plan) => plan.type === 'above')
  const basementPlans = plans.filter((plan) => plan.type === 'basement')
  const analysisProgram = regulations?.buildingProgram || {}
  const settingsProgram = modelSettings?.buildingProgram || {}
  const settingsUnitSummary = unitSummaryFromSettings(settingsProgram)
  const buildingProgram = {
    ...analysisProgram,
    ...settingsProgram,
    areaComponents: settingsProgram.areaComponents?.length
      ? settingsProgram.areaComponents
      : analysisProgram.areaComponents || [],
    unitSummary: analysisProgram.unitSummary?.hasExplicitUnits ? analysisProgram.unitSummary : settingsUnitSummary,
    projectType: analysisProgram.projectType || settingsProgram.declaredProjectType || '',
    projectTypeLabel: analysisProgram.projectTypeLabel || PROJECT_TYPE_LABELS[settingsProgram.declaredProjectType],
  }
  const componentsByFloor = areaComponentsByFloor(buildingProgram)
  const computed = regulations?.computed || {}
  const limits = regulations?.limits || {}
  const zone = regulations?.zone || {}
  const parking = regulations?.parkingCalculation || {}

  const siteArea = toNumber(computed.site_area_m2 || parcel?.area_m2)
  const buildingArea = Math.max(0, ...abovePlans.map((plan) => toNumber(plan.areaM2)))
  const aboveArea = abovePlans.reduce((sum, plan) => sum + toNumber(plan.areaM2), 0)
  const basementArea = basementPlans.reduce((sum, plan) => sum + toNumber(plan.areaM2), 0)
  const grossArea = plans.reduce((sum, plan) => sum + toNumber(plan.areaM2), 0)
  const farArea = aboveArea
  const bcr = siteArea > 0 ? (buildingArea / siteArea) * 100 : 0
  const far = siteArea > 0 ? (farArea / siteArea) * 100 : 0
  const height = abovePlans.reduce((sum, plan) => sum + toNumber(plan.heightM), 0)

  const floorRows = plans.map((plan) => {
    const breakdown = floorAreaBreakdown(plan, componentsByFloor)
    return {
      group: plan.type === 'basement' ? '지하층' : '지상층',
      label: plan.label || plan.id,
      use: plan.use || '-',
      exclusiveArea: breakdown.exclusiveArea,
      commonArea: breakdown.commonArea,
      subtotal: breakdown.subtotal,
      ratio: grossArea > 0 ? (breakdown.subtotal / grossArea) * 100 : 0,
      note: plan.type === 'basement' ? '용적률 제외 후보' : '',
    }
  })

  const parkingRows = Array.isArray(parking.rows) ? parking.rows : []
  const legalParking = parking.available
    ? parking.requiredCount
    : parking.partialRequiredCount ?? parking.requiredCount

  return {
    projectName: permitBasic.platPlc || parcel?.address || '-',
    zoneText: uniqueText([zone.matched, zone.primary, zone.secondary]),
    siteArea: permitBasic.platArea || siteArea,
    mainUses: uniqueText(abovePlans.map((plan) => plan.use)),
    buildingArea: permitBasic.archArea || buildingArea,
    aboveArea,
    basementArea,
    grossArea: permitBasic.totArea || grossArea,
    farArea: permitBasic.vlRatEstmTotArea || farArea,
    bcr: permitBasic.bcRat || bcr,
    far: permitBasic.vlRat || far,
    legalBcr: permitBasic.legalBcRat || limits.bcr_percent,
    legalFar: permitBasic.legalVlRat || limits.far_percent,
    legalParking: permitParking.requiredPkngCnt || legalParking,
    plannedParking: permitParking.plannedPkngCnt || modelSettings?.parkingCount,
    parkingRows,
    landscapeLegalArea: modelSettings?.landscapeLegalArea,
    landscapeInstalledArea: modelSettings?.landscapeInstalledArea,
    scaleText: `지하 ${basementPlans.length}층 / 지상 ${abovePlans.length}층`,
    height,
    structure: modelSettings?.buildingStructure || '-',
    projectType: buildingProgram.projectType || buildingProgram.declaredProjectType || '',
    projectTypeLabel: buildingProgram.projectTypeLabel || PROJECT_TYPE_LABELS[buildingProgram.declaredProjectType] || '-',
    unitSummary: buildingProgram.unitSummary || {},
    floorRows,
    basementSubtotal: basementArea,
    aboveSubtotal: aboveArea,
  }
}

function OverviewCell({ label, value, note, highlight = false }) {
  return (
    <tr>
      <th>{label}</th>
      <td className={highlight ? 'value highlight' : 'value'}>{value || '-'}</td>
      <td className="note">{note || ''}</td>
    </tr>
  )
}

function PermitSectionTable({ title, schema, rows }) {
  const normalizedRows = Array.isArray(rows) ? rows : rows ? [rows] : []
  if (!normalizedRows.length) {
    return (
      <div className="permit-section">
        <div className="permit-section-title">{title}</div>
        <div className="permit-empty">자동 기입된 데이터가 없습니다.</div>
      </div>
    )
  }

  return (
    <div className="permit-section">
      <div className="permit-section-title">{title}</div>
      <div className="permit-table-wrap">
        <table className="permit-table">
          <thead>
            <tr>
              {(schema || []).map((field) => (
                <th key={field.field}>{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {normalizedRows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`}>
                {(schema || []).map((field) => (
                  <td key={field.field}>{formatPermitValue(row[field.field])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeumteoPanel({ title, note, children, actions }) {
  return (
    <section className="seumteo-panel">
      <div className="seumteo-panel-title">
        <span>{title}</span>
        <span className="seumteo-collapse">⌃</span>
      </div>
      {note && <div className="seumteo-note">{note}</div>}
      <div className="seumteo-panel-body">{children}</div>
      {actions && <div className="seumteo-actions">{actions}</div>}
    </section>
  )
}

function SeumteoValue({ value, unit, muted = false }) {
  return (
    <span className={muted ? 'seumteo-value muted' : 'seumteo-value'}>
      {value || '-'}
      {unit && <span className="seumteo-unit">{unit}</span>}
    </span>
  )
}

function SeumteoField({ label, value, unit, children, wide = false, required = false }) {
  return (
    <div className={wide ? 'seumteo-field wide' : 'seumteo-field'}>
      <div className="seumteo-label">
        {required && <span className="required">*</span>}
        {label}
      </div>
      <div className="seumteo-control">
        {children || <SeumteoValue value={value} unit={unit} />}
      </div>
    </div>
  )
}

function SeumteoSelectLike({ value = '선택', disabled = false }) {
  return (
    <span className={disabled ? 'seumteo-select disabled' : 'seumteo-select'}>
      {value || '선택'}
      <span>▾</span>
    </span>
  )
}

function SeumteoButton({ children, primary = false, onClick }) {
  return (
    <button type="button" onClick={onClick} className={primary ? 'seumteo-button primary' : 'seumteo-button'}>
      {children}
    </button>
  )
}

function SeumteoTable({ columns, rows, emptyText = '입력된 항목이 없습니다.' }) {
  return (
    <table className="seumteo-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
          <th className="check-col">□</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((row, rowIndex) => (
            <tr key={`seumteo-row-${rowIndex}`}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key] || '-'}</td>
              ))}
              <td className="check-col">□</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={columns.length + 1} className="empty-cell">{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export default function BuildingOverviewSheet({
  open,
  onClose,
  parcel,
  regulations,
  floorPlans,
  modelSettings,
  presets,
  onApplyPreset,
  onModelSettingChange,
  onBuildingProgramChange,
  onAddProgramUnit,
  onUpdateProgramUnit,
  onRemoveProgramUnit,
}) {
  if (!open) return null

  const buildingProgramSettings = modelSettings?.buildingProgram || {}
  const units = Array.isArray(buildingProgramSettings.units) ? buildingProgramSettings.units : []
  const data = createOverviewData({ parcel, regulations, floorPlans, modelSettings })
  const permitOverview = regulations?.buildingPermitOverview || null
  const permitSchemas = permitOverview?.schemas || {}
  const permitSections = permitOverview?.sections || {}
  const basicOverview = permitSections.basicOverview || {}
  const dongOverview = permitSections.dongOverviews?.[0] || {}
  const zoningDistrict = permitSections.zoningDistricts?.[0] || {}
  const parkingOverview = permitSections.parking || {}
  const floorOverviewRows = Array.isArray(permitSections.floorOverviews) ? permitSections.floorOverviews : []
  const unitOverviewRows = Array.isArray(permitSections.unitOverviews) ? permitSections.unitOverviews : []
  const seumteoFloorRows = floorOverviewRows.map((row) => ({
    floor: row.flrNoNm,
    structure: dongOverview.mainStrctCdNm,
    mainUse: row.mainPurpsCdNm,
    subUse: '',
    area: formatArea(row.area),
    order: row.flrNo,
  }))
  const seumteoUnitRows = unitOverviewRows.map((row) => ({
    type: row.mainPurpsCdNm,
    count: row.unitCnt,
    area: formatArea(row.exposPubuseArea),
  }))

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.42)',
        zIndex: 45,
        overflowY: 'auto',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(1280px, 96vw)',
          margin: '0 auto',
          background: 'white',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 24px 80px rgba(15,23,42,0.28)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800 }}>건축개요</h2>
            <p style={{ marginTop: 6, color: '#666', fontSize: 13, lineHeight: 1.5 }}>
              세움터 입력 항목과 가장 가까운 건축HUB 건축인허가정보 구조를 기준으로, 기본개요·동별개요·층별개요·
              호별개요·주차장 섹션을 자동 기입합니다. 아래 기존 일반건축물 개요표는 같은 데이터를 실무표 형태로 보여줍니다.
            </p>
            {permitOverview?.standardName && (
              <div style={{ marginTop: 6, color: '#5b21b6', fontSize: 12 }}>
                기준 스키마: {permitOverview.standardName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ border: 0, background: 'transparent', fontSize: 24, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <section className="seumteo-toolbar">
          <div>
            <strong>세움터식 개요 입력 화면</strong>
            <p>
              파란 섹션 헤더, 회색 라벨 셀, 입력칸형 값 표시를 기준으로 재구성했습니다.
              자동 산정값은 3D 모델과 규제분석 결과에서 채워집니다.
            </p>
          </div>
          <span className={permitOverview ? 'status-pill ready' : 'status-pill'}>
            {permitOverview ? '자동기입됨' : '분석 후 생성'}
          </span>
        </section>

        <section className="preset-strip">
          {(presets || []).map((preset) => (
            <button key={preset.id} type="button" onClick={() => onApplyPreset?.(preset)}>
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </section>

        <SeumteoPanel title="대지조건">
          <div className="seumteo-grid">
            <SeumteoField label="대지위치" wide>
              <div className="address-row">
                <SeumteoButton>주소검색</SeumteoButton>
                <SeumteoValue value={permitSections.siteLocation?.platPlc || data.projectName} />
              </div>
            </SeumteoField>
            <SeumteoField label="특수지명" value="-" wide />
            <SeumteoField label="지목">
              <SeumteoSelectLike value={basicOverview.jimokNm || '대'} />
            </SeumteoField>
            <SeumteoField label="대표여부" value="대표" />
          </div>
          <div className="seumteo-sub-actions">
            <SeumteoButton>지역지구구역정보가져오기</SeumteoButton>
            <SeumteoButton>작성방법보기</SeumteoButton>
          </div>
          <div className="mini-region-grid">
            <div><strong>지역</strong> {zoningDistrict.zoneNm || '-'}</div>
            <div><strong>지구</strong> {zoningDistrict.districtNm || '-'}</div>
            <div><strong>구역</strong> {zoningDistrict.areaNm || '-'}</div>
          </div>
        </SeumteoPanel>

        <SeumteoPanel title="전체개요">
          <div className="seumteo-grid">
            <SeumteoField label="대지면적" value={formatNumber(data.siteArea, 2)} unit="㎡" />
            <SeumteoField label="건축면적" value={formatNumber(data.buildingArea, 2)} unit="㎡" />
            <SeumteoField label="건폐율" value={formatNumber(data.bcr, 4)} unit="%" />
            <SeumteoField label="연면적" value={formatNumber(data.grossArea, 2)} unit="㎡" />
            <SeumteoField label="용적률산정용연면적" value={formatNumber(data.farArea, 2)} unit="㎡" />
            <SeumteoField label="용적률" value={formatNumber(data.far, 4)} unit="%" />
            <SeumteoField label="주건축물수" value={basicOverview.mainBldCnt || 1} unit="동" />
            <SeumteoField label="부속건축물수" value={basicOverview.atchBldDongCnt || '-'} unit="동" />
            <SeumteoField label="주용도" wide>
              <span className="inline-plus">＋</span>
              <SeumteoValue value={basicOverview.mainPurpsCdNm || data.mainUses} />
              <SeumteoValue value={data.projectTypeLabel} muted />
            </SeumteoField>
            <SeumteoField label="건물명칭" value={basicOverview.bldNm || modelSettings?.buildingName || '-'} wide />
            <SeumteoField label="세대 / 호 / 가구" value={`${basicOverview.hhldCnt || 0} / ${basicOverview.hoCnt || 0} / ${basicOverview.fmlyCnt || 0}`} />
            <SeumteoField label="주택 평균전용면적" value={formatNumber(data.unitSummary?.totalExclusiveAreaM2, 2)} unit="㎡" />
          </div>
        </SeumteoPanel>

        <div className="seumteo-two-col">
          <SeumteoPanel title="준주택, 도시형 생활주택 개요(기존건축물)">
            <div className="seumteo-grid compact">
              <SeumteoField label="유형"><SeumteoSelectLike disabled /></SeumteoField>
              <SeumteoField label="실/호/세대수" value="-" />
              <SeumteoField label="실/호/세대별면적" value="-" unit="㎡" />
            </div>
            <SeumteoTable
              columns={[
                { key: 'type', label: '유형' },
                { key: 'count', label: '실/호/세대수' },
                { key: 'area', label: '실/호/세대별 면적(㎡)' },
              ]}
              rows={[]}
            />
          </SeumteoPanel>

          <SeumteoPanel title="준주택, 도시형 생활주택(허가신청 건축물)">
            <div className="seumteo-grid compact">
              <SeumteoField label="유형">
                <SeumteoSelectLike value={data.projectTypeLabel || '선택'} />
              </SeumteoField>
              <SeumteoField label="실/호/세대수" value={data.unitSummary?.unitCount || '-'} />
              <SeumteoField label="실/호/세대별면적" value={formatNumber(data.unitSummary?.totalExclusiveAreaM2, 2)} unit="㎡" />
            </div>
            <SeumteoTable
              columns={[
                { key: 'type', label: '유형' },
                { key: 'count', label: '실/호/세대수' },
                { key: 'area', label: '실/호/세대별 면적(㎡)' },
              ]}
              rows={seumteoUnitRows}
            />
          </SeumteoPanel>
        </div>

        <SeumteoPanel
          title="동별개요"
          note="아래의 '*' 표시는 총괄개요 정보를 입력하신 후 값이 자동으로 계산되는 항목입니다."
          actions={<><SeumteoButton>동+층복사</SeumteoButton><SeumteoButton>+추가</SeumteoButton><SeumteoButton>-삭제</SeumteoButton></>}
        >
          <div className="seumteo-grid">
            <SeumteoField label="주/부구분"><SeumteoSelectLike value="주건축물" /></SeumteoField>
            <SeumteoField label="동 명칭 및 번호" value={dongOverview.dongNm || '주건축물제1동'} />
            <SeumteoField label="세대 / 호 / 가구" value={`${basicOverview.hhldCnt || 0} / ${basicOverview.hoCnt || 0} / ${basicOverview.fmlyCnt || 0}`} />
            <SeumteoField label="* 주용도" value={dongOverview.mainPurpsCdNm || basicOverview.mainPurpsCdNm} />
            <SeumteoField label="* 주구조" value={dongOverview.mainStrctCdNm || modelSettings?.buildingStructure} />
            <SeumteoField label="지붕구조" value={dongOverview.roofCdNm || '기타지붕'} />
            <SeumteoField label="건축면적" value={formatNumber(dongOverview.archArea || data.buildingArea, 2)} unit="㎡" />
            <SeumteoField label="연면적" value={formatNumber(dongOverview.totArea || data.grossArea, 2)} unit="㎡" />
            <SeumteoField label="* 용적률산정용 연면적" value={formatNumber(data.farArea, 2)} unit="㎡" />
            <SeumteoField label="* 지하층수/지상층수" value={`${dongOverview.ugrndFlrCnt || 0}층 / ${dongOverview.grndFlrCnt || 0}층`} />
            <SeumteoField label="높이" value={formatNumber(dongOverview.heit || data.height, 1)} unit="m" />
            <SeumteoField label="승용/비상용 승강기" value="- 대 / - 대" />
          </div>
          <SeumteoTable
            columns={[
              { key: 'dongNm', label: '동명칭및번호' },
              { key: 'mainPurpsCdNm', label: '주용도' },
              { key: 'mainStrctCdNm', label: '주구조' },
              { key: 'archArea', label: '건축면적(㎡)' },
              { key: 'totArea', label: '연면적(㎡)' },
            ]}
            rows={(permitSections.dongOverviews || []).map((row) => ({
              ...row,
              archArea: formatNumber(row.archArea, 2),
              totArea: formatNumber(row.totArea, 2),
            }))}
          />
        </SeumteoPanel>

        <SeumteoPanel title="층별개요" actions={<><SeumteoButton>+층복사</SeumteoButton><SeumteoButton>+추가</SeumteoButton><SeumteoButton>-삭제</SeumteoButton></>}>
          <div className="seumteo-grid">
            <SeumteoField label="동명칭및번호" value={dongOverview.dongNm || '주건축물제1동'} wide />
            <SeumteoField label="층 면적 합" value={formatNumber(data.grossArea, 2)} unit="㎡" />
            <SeumteoField label="지상 층 합" value={formatNumber(data.aboveArea, 2)} unit="㎡" />
            <SeumteoField label="지하 층 합" value={formatNumber(data.basementArea, 2)} unit="㎡" />
            <SeumteoField label="용적률산정용연면적" value={formatNumber(data.farArea, 2)} unit="㎡" />
          </div>
          <SeumteoTable
            columns={[
              { key: 'floor', label: '층수' },
              { key: 'structure', label: '주구조' },
              { key: 'mainUse', label: '주용도' },
              { key: 'subUse', label: '기타용도' },
              { key: 'area', label: '면적(㎡)' },
              { key: 'order', label: '정렬순서' },
            ]}
            rows={seumteoFloorRows}
          />
        </SeumteoPanel>

        <SeumteoPanel title="주차장" note="총 주차 수는 면제 주차 수를 제외한 옥내/옥외 자주식, 기계식, 전기자동차 수의 합입니다.">
          <table className="seumteo-parking-table">
            <thead>
              <tr>
                <th />
                <th>자주식</th>
                <th>기계식</th>
                <th>전기자동차</th>
              </tr>
            </thead>
            <tbody>
              {['옥내', '옥외', '인근'].map((label, index) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td><SeumteoValue value={index === 1 ? formatNumber(parkingOverview.oudrAutoUtcnt || parkingOverview.totPkngCnt, 0) : '0'} unit="대" /></td>
                  <td><SeumteoValue value="0" unit="대" /></td>
                  <td><SeumteoValue value="0" unit="대" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="seumteo-grid compact">
            <SeumteoField label="면제" value="-" unit="대" />
            <SeumteoField label="총주차수" value={formatNumber(parkingOverview.totPkngCnt || data.plannedParking || data.legalParking, 0)} unit="대" />
            <SeumteoField label="법정주차수" value={formatNumber(parkingOverview.requiredPkngCnt || data.legalParking, 0)} unit="대" />
          </div>
        </SeumteoPanel>

        <SeumteoPanel title="공적공간" note="공개공지 면적, 조경면적, 건축선후퇴 면적, 건축선후퇴 거리 항목은 기타시설탭에서 입력하시는 형식입니다.">
          <div className="seumteo-grid">
            <SeumteoField label="공개공지면적" value="-" unit="㎡" />
            <SeumteoField label="조경면적" value={formatNumber(data.landscapeInstalledArea, 2)} unit="㎡" />
            <SeumteoField label="건축선후퇴면적" value="-" unit="㎡" />
            <SeumteoField label="건축선후퇴거리" value="-" unit="m" />
          </div>
        </SeumteoPanel>

        <SeumteoPanel
          title="호(실)/가구별 면적"
          note="다가구주택, 임대형기숙사, 오피스텔 등은 호/실/가구별 전용면적을 입력하면 주차 산정과 대장 접수용 개요에 반영합니다."
          actions={<><SeumteoButton onClick={onAddProgramUnit}>+추가</SeumteoButton><SeumteoButton>-삭제</SeumteoButton></>}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            {units.length ? units.map((unit, index) => (
              <div key={`overview-unit-${index}`} className="unit-edit-row">
                <input
                  placeholder="용도"
                  value={unit.use || ''}
                  onChange={(event) => onUpdateProgramUnit?.(index, 'use', event.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="호/세대"
                  value={unit.count ?? ''}
                  onChange={(event) => onUpdateProgramUnit?.(index, 'count', event.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="전용㎡/호"
                  value={unit.unitExclusiveAreaM2 ?? ''}
                  onChange={(event) => onUpdateProgramUnit?.(index, 'unitExclusiveAreaM2', event.target.value)}
                />
                <button type="button" onClick={() => onRemoveProgramUnit?.(index)}>삭제</button>
              </div>
            )) : (
              <div className="empty-cell">주택계 또는 오피스텔 계획이면 호/실/가구별 전용면적을 추가하세요.</div>
            )}
          </div>
        </SeumteoPanel>

        <details className="raw-hub-details">
          <summary>건축HUB 원시 섹션 보기</summary>
          <div className="permit-section-grid">
            <PermitSectionTable title="기본개요" schema={permitSchemas.basicOverview} rows={permitSections.basicOverview} />
            <PermitSectionTable title="동별개요" schema={permitSchemas.dongOverview} rows={permitSections.dongOverviews} />
            <PermitSectionTable title="지역지구구역" schema={permitSchemas.zoningDistrict} rows={permitSections.zoningDistricts} />
            <PermitSectionTable title="주차장" schema={permitSchemas.parking} rows={permitSections.parking} />
          </div>
        </details>

        <section style={{ marginTop: 18, overflowX: 'auto' }}>
          <div className="overview-sheet">
            <div className="overview-left">
              <table>
                <tbody>
                  <tr className="title-row">
                    <th colSpan={3}>■ 설 계 개 요</th>
                  </tr>
                  <OverviewCell label="사 업 명" value={data.projectName} />
                  <OverviewCell label="지역지구" value={data.zoneText} />
                  <OverviewCell label="대지면적" value={formatArea(data.siteArea)} highlight />
                  <OverviewCell label="용     도" value={data.mainUses} note={data.projectTypeLabel} />
                  <OverviewCell label="건축면적" value={formatArea(data.buildingArea)} />
                  <tr className="section-row">
                    <th rowSpan={3}>연 면 적</th>
                    <td>지상층 {formatArea(data.aboveArea)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td>지하층 {formatArea(data.basementArea)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td className="highlight">합계 {formatArea(data.grossArea)}</td>
                    <td />
                  </tr>
                  <OverviewCell label="용적률산정면적" value={formatArea(data.farArea)} />
                  <OverviewCell
                    label="건 폐 율"
                    value={formatPercent(data.bcr)}
                    note={`법정: ${formatPercent(data.legalBcr)} 이하`}
                  />
                  <OverviewCell
                    label="용 적 률"
                    value={formatPercent(data.far)}
                    note={`법정: ${formatPercent(data.legalFar)} 이하`}
                  />
                  <tr className="section-row">
                    <th rowSpan={4}>주차대수</th>
                    <td>법정 {formatCount(data.legalParking)}</td>
                    <td>계획 {formatCount(data.plannedParking)}</td>
                  </tr>
                  {data.parkingRows.slice(0, 2).map((row, index) => (
                    <tr key={`${row.use}-${index}`}>
                      <td>{row.use || '-'}</td>
                      <td>{row.requiredCount != null ? formatCount(row.requiredCount) : row.unresolvedReason || row.formula || '-'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>합계</td>
                    <td>{formatCount(data.legalParking)}</td>
                  </tr>
                  <tr className="section-row">
                    <th rowSpan={3}>조경면적</th>
                    <td>법정 {formatArea(data.landscapeLegalArea)}</td>
                    <td>계획 {formatArea(data.landscapeInstalledArea)}</td>
                  </tr>
                  <tr>
                    <td>자연지반면적률</td>
                    <td>-</td>
                  </tr>
                  <tr>
                    <td>생태면적률</td>
                    <td>-</td>
                  </tr>
                  <OverviewCell label="규  모" value={data.scaleText} note={`높이 ${formatNumber(data.height, 1)}m`} />
                  <OverviewCell label="구  조" value={data.structure} />
                  <OverviewCell label="난방설비" value="-" />
                </tbody>
              </table>
            </div>

            <div className="overview-right">
              <table>
                <tbody>
                  <tr className="title-row">
                    <th colSpan={7}>■ 층별 용도개요</th>
                  </tr>
                  <tr className="header-row">
                    <th>구분</th>
                    <th>층</th>
                    <th>세부용도</th>
                    <th>전용면적</th>
                    <th>공용면적</th>
                    <th>비율</th>
                    <th>소계/비고</th>
                  </tr>
                  {data.floorRows.length ? (
                    data.floorRows.map((row, index) => (
                      <tr key={`${row.label}-${index}`}>
                        <td>{row.group}</td>
                        <td>{row.label}</td>
                        <td>{row.use}</td>
                        <td>{formatArea(row.exclusiveArea)}</td>
                        <td>{formatArea(row.commonArea)}</td>
                        <td>{formatPercent(row.ratio)}</td>
                        <td>{formatArea(row.subtotal)} {row.note}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ color: '#777' }}>분석 후 층별 용도와 면적이 자동 기입됩니다.</td>
                    </tr>
                  )}
                  <tr className="subtotal-row">
                    <td colSpan={3}>지하층 소계</td>
                    <td colSpan={4}>{formatArea(data.basementSubtotal)}</td>
                  </tr>
                  <tr className="subtotal-row">
                    <td colSpan={3}>지상층 소계</td>
                    <td colSpan={4}>{formatArea(data.aboveSubtotal)}</td>
                  </tr>
                  <tr className="subtotal-row total">
                    <td colSpan={3}>합계</td>
                    <td colSpan={4}>{formatArea(data.grossArea)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <SeumteoPanel title="개요 설정">
          <div className="seumteo-grid">
            <SeumteoField label="개요 유형">
              <select
                value={buildingProgramSettings.declaredProjectType || ''}
                onChange={(event) => onBuildingProgramChange?.('declaredProjectType', event.target.value)}
              >
                <option value="">자동분류</option>
                <option value="general_building">일반건축물</option>
                <option value="officetel">오피스텔</option>
                <option value="mixed_use_officetel">오피스텔+일반건축용도</option>
                <option value="neighborhood_house">상가주택</option>
                <option value="multi_family_house">다가구주택</option>
                <option value="apartment">공동주택/아파트</option>
                <option value="mixed_use_residential">주상복합/복합주거</option>
              </select>
            </SeumteoField>
            <SeumteoField label="공용면적 배분">
              <select
                value={buildingProgramSettings.commonAreaAllocationMethod || 'exclusive_area_ratio'}
                onChange={(event) => onBuildingProgramChange?.('commonAreaAllocationMethod', event.target.value)}
              >
                <option value="exclusive_area_ratio">전용면적 비율</option>
                <option value="manual">수동 배분</option>
                <option value="direct">용도별 직접 지정</option>
              </select>
            </SeumteoField>
          </div>
        </SeumteoPanel>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button
            onClick={onClose}
            style={{ padding: '11px 18px', border: '1px solid #ccc', background: 'white' }}
          >
            닫기
          </button>
        </div>

        <style jsx>{`
          .overview-input-label {
            display: grid;
            gap: 5px;
            font-size: 12px;
            color: #374151;
          }

          .overview-input-label input,
          .overview-input-label select,
          section input,
          section select {
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            padding: 9px 10px;
            background: white;
          }

          .seumteo-toolbar {
            margin-top: 18px;
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: center;
            padding: 12px;
            border: 1px solid #cfd8e3;
            background: #f8fafc;
          }

          .seumteo-toolbar p {
            margin: 4px 0 0;
            color: #55606e;
            font-size: 12px;
            line-height: 1.5;
          }

          .status-pill {
            padding: 5px 10px;
            border-radius: 999px;
            background: #f3f4f6;
            color: #6b7280;
            font-size: 12px;
            font-weight: 800;
            white-space: nowrap;
          }

          .status-pill.ready {
            background: #dbeafe;
            color: #1d4ed8;
          }

          .preset-strip {
            margin-top: 10px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }

          .preset-strip button {
            text-align: left;
            padding: 9px 10px;
            border: 1px solid #b8c7d6;
            background: white;
            cursor: pointer;
          }

          .preset-strip span {
            display: block;
            margin-top: 3px;
            color: #666;
            font-size: 11px;
            line-height: 1.35;
          }

          .seumteo-panel {
            margin-top: 14px;
            border: 1px solid #8fa2b4;
            background: #fff;
          }

          .seumteo-panel-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 9px 12px;
            background: #d9e6f0;
            color: #253647;
            font-size: 14px;
            font-weight: 800;
          }

          .seumteo-collapse {
            font-size: 20px;
            color: #66788a;
          }

          .seumteo-note {
            padding: 10px 14px 0;
            color: #4b5563;
            font-size: 12px;
            line-height: 1.5;
          }

          .seumteo-panel-body {
            padding: 12px 20px 16px;
          }

          .seumteo-actions,
          .seumteo-sub-actions {
            display: flex;
            justify-content: flex-end;
            gap: 6px;
            padding: 0 20px 12px;
          }

          .seumteo-sub-actions {
            padding: 10px 0 0;
          }

          .seumteo-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            border-top: 1px solid #cfd3d8;
            border-left: 1px solid #cfd3d8;
          }

          .seumteo-grid.compact {
            grid-template-columns: 1fr;
          }

          .seumteo-field {
            display: grid;
            grid-template-columns: 150px 1fr;
            min-height: 42px;
            border-right: 1px solid #cfd3d8;
            border-bottom: 1px solid #cfd3d8;
          }

          .seumteo-field.wide {
            grid-column: span 2;
          }

          .seumteo-label {
            display: flex;
            align-items: center;
            gap: 3px;
            padding: 8px 10px;
            background: #e6e8ed;
            color: #27313c;
            font-weight: 700;
            font-size: 12px;
          }

          .required {
            color: #2563eb;
          }

          .seumteo-control {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 7px;
            min-width: 0;
          }

          .seumteo-value,
          .seumteo-select {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            min-height: 28px;
            min-width: 120px;
            padding: 4px 8px;
            border: 1px solid #d6d9de;
            background: #fff;
            color: #111827;
            font-size: 12px;
          }

          .seumteo-value.muted,
          .seumteo-select.disabled {
            background: #f1f3f5;
            color: #6b7280;
          }

          .seumteo-unit {
            margin-left: 4px;
            color: #374151;
          }

          .inline-plus {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border: 1px solid #9ca3af;
            font-weight: 800;
          }

          .address-row {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
          }

          .address-row .seumteo-value {
            flex: 1;
          }

          .seumteo-button {
            border: 1px solid #9ca3af;
            background: #fff;
            padding: 5px 9px;
            font-size: 12px;
            cursor: pointer;
          }

          .seumteo-button.primary {
            background: #0f3b63;
            color: #fff;
            border-color: #0f3b63;
          }

          .mini-region-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 10px;
            color: #374151;
            font-size: 12px;
          }

          .mini-region-grid > div {
            border: 1px solid #d6d9de;
            padding: 8px;
            background: #fbfdff;
          }

          .seumteo-two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .seumteo-table,
          .seumteo-parking-table {
            width: 100%;
            margin-top: 12px;
            border-collapse: collapse;
            font-size: 12px;
          }

          .seumteo-table th,
          .seumteo-table td,
          .seumteo-parking-table th,
          .seumteo-parking-table td {
            border: 1px solid #d2d6dc;
            padding: 8px;
            height: 32px;
            text-align: center;
          }

          .seumteo-table th,
          .seumteo-parking-table th {
            background: #f1f3f7;
            font-weight: 700;
          }

          .check-col {
            width: 34px;
          }

          .empty-cell {
            color: #777;
            text-align: center;
            padding: 14px;
          }

          .unit-edit-row {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr 1fr auto;
            gap: 8px;
          }

          .unit-edit-row button {
            border: 1px solid #d1d5db;
            background: white;
          }

          .raw-hub-details {
            margin-top: 14px;
            border: 1px solid #e5e7eb;
            padding: 10px;
            background: #fafafa;
          }

          .raw-hub-details summary {
            cursor: pointer;
            font-weight: 800;
            font-size: 12px;
            color: #374151;
          }

          .overview-sheet {
            min-width: 1100px;
            display: grid;
            grid-template-columns: 0.9fr 1.1fr;
            gap: 16px;
            font-size: 12px;
          }

          .permit-section-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .permit-section {
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            overflow: hidden;
            background: #fff;
          }

          .permit-section-title {
            padding: 9px 10px;
            background: #eef2ff;
            color: #3730a3;
            font-weight: 800;
            font-size: 12px;
          }

          .permit-empty {
            padding: 12px;
            color: #777;
            font-size: 12px;
          }

          .permit-table-wrap {
            overflow-x: auto;
          }

          .permit-table {
            min-width: 640px;
            font-size: 11px;
          }

          .permit-table th,
          .permit-table td {
            border-color: #e5e7eb;
            height: 28px;
            padding: 6px 7px;
            white-space: nowrap;
          }

          .permit-table th {
            background: #f8fafc;
            color: #374151;
          }

          @media (max-width: 900px) {
            .permit-section-grid {
              grid-template-columns: 1fr;
            }
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          th,
          td {
            border: 1px solid #111827;
            padding: 7px 8px;
            height: 32px;
            vertical-align: middle;
            word-break: keep-all;
          }

          th {
            background: #f3f4f6;
            font-weight: 800;
            text-align: center;
          }

          td {
            background: #fff;
          }

          .title-row th {
            background: #111827;
            color: white;
            text-align: left;
            font-size: 14px;
            letter-spacing: 0.02em;
          }

          .header-row th {
            background: #e5e7eb;
          }

          .section-row th {
            background: #f8fafc;
          }

          .value {
            font-weight: 700;
          }

          .highlight {
            color: #1d4ed8;
          }

          .note {
            color: #555;
            font-size: 11px;
          }

          .subtotal-row td {
            background: #f8fafc;
            font-weight: 700;
          }

          .subtotal-row.total td {
            background: #eef2ff;
            color: #3730a3;
          }
        `}</style>
      </div>
    </div>
  )
}
