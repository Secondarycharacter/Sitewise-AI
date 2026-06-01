'use client'

import { useMemo, useState } from 'react'
import Viewer from '../components/Viewer'
import RegulationPanel from '../components/RegulationPanel'
import GridPlanEditor from '../components/GridPlanEditor'
import BuildingOverviewSheet from '../components/BuildingOverviewSheet'

const DEFAULT_FLOOR_HEIGHT_M = 4
const API_BASE_URL = 'http://localhost:8002'
const DEFAULT_BUILDING_STRUCTURE = '철근콘크리트 라멘조'
const GRID_SIZE_M = 0.1
const AREA_EXCLUDED_GRID_TYPES = new Set(['exclude', 'landscape', 'parking'])
const AREA_REMOVED_GRID_TYPES = new Set(['void'])
const GROUND_ONLY_GRID_TYPES = new Set(['landscape', 'parking'])
const DEFAULT_FLOOR_EDIT = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
}
const DEFAULT_PLAN_VIEW = { scale: 1, rotation: 0, x: 0, y: 0 }
const DEFAULT_MODEL_EDIT_STATE = {
  editMode: false,
  gridSizeM: 0.5,
  selectedFloorId: '',
  tool: 'rect',
  selectedCells: [],
  lassoPoints: [],
  draftHeightM: 1,
  roofHeightM: 1.5,
  roofType: 'flat',
  additions: [],
  roofs: [],
}
const DEFAULT_ASSISTANT_QUESTIONS = [
  {
    id: 'question_01',
    title: '질문 1',
    prompt: '수정하고 싶은 영역과 설계 의도를 표시하고 설명해주세요. 하나의 질문 안 답변 요구사항은 3개 이하로 구분합니다.',
    status: 'pending',
    answerText: '',
    marks: [],
  },
  {
    id: 'question_02',
    title: '질문 2',
    prompt: '배치 기준, 법규 기준, 치수 조건이 있다면 표시하고 설명해주세요. 요구사항이 3개를 넘으면 질문을 나눕니다.',
    status: 'pending',
    answerText: '',
    marks: [],
  },
]
const DEFAULT_ASSISTANT_STATE = {
  open: false,
  activeQuestionId: null,
  questions: DEFAULT_ASSISTANT_QUESTIONS,
  draftCommand: '',
  resultPreview: null,
  loading: false,
  error: '',
}
const BUILDING_PROGRAM_TEST_PRESETS = [
  {
    id: 'officetel',
    label: '오피스텔+근생',
    description: '1층 근생, 상부 오피스텔. 세대 전용면적 입력과 외부 주택기준 미해결 표시를 확인합니다.',
    floorUses: ['제1종 근린생활시설', '오피스텔', '오피스텔'],
    parkingCount: '8',
    buildingProgram: {
      declaredProjectType: 'mixed_use_officetel',
      commonAreaAllocationMethod: 'exclusive_area_ratio',
      areaComponents: [
        { id: 'retail_exclusive', use: '제1종 근린생활시설', areaKind: 'exclusive', areaM2: 120 },
        { id: 'officetel_exclusive', use: '오피스텔', areaKind: 'exclusive', areaM2: 280 },
        { id: 'officetel_common', use: '오피스텔 공용 복도/코어', areaKind: 'common', areaM2: 80 },
      ],
      units: [{ use: '오피스텔', count: 8, unitExclusiveAreaM2: 35 }],
    },
  },
  {
    id: 'neighborhood-house',
    label: '상가주택',
    description: '1층 근생, 상부 다가구주택. 주거/비주거 공용면적 배분 확인용입니다.',
    floorUses: ['제2종 근린생활시설', '다가구주택', '다가구주택'],
    parkingCount: '6',
    buildingProgram: {
      declaredProjectType: 'neighborhood_house',
      commonAreaAllocationMethod: 'exclusive_area_ratio',
      areaComponents: [
        { id: 'retail_exclusive', use: '제2종 근린생활시설', areaKind: 'exclusive', areaM2: 90 },
        { id: 'house_exclusive', use: '다가구주택', areaKind: 'exclusive', areaM2: 180 },
        { id: 'shared_core', use: '공용 계단실/복도', areaKind: 'common', areaM2: 45 },
      ],
      units: [{ use: '다가구주택', count: 4, unitExclusiveAreaM2: 45 }],
    },
  },
  {
    id: 'mixed-use-residential',
    label: '주상복합',
    description: '저층 판매시설, 상부 공동주택. 주택계 세대 입력과 복합용도 분류 확인용입니다.',
    floorUses: ['판매시설', '판매시설', '아파트', '아파트', '아파트'],
    parkingCount: '18',
    buildingProgram: {
      declaredProjectType: 'mixed_use_residential',
      commonAreaAllocationMethod: 'exclusive_area_ratio',
      areaComponents: [
        { id: 'retail_exclusive', use: '판매시설', areaKind: 'exclusive', areaM2: 260 },
        { id: 'apartment_exclusive', use: '아파트', areaKind: 'exclusive', areaM2: 720 },
        { id: 'shared_residential_core', use: '주거 공용 복도/코어', areaKind: 'common', areaM2: 180 },
      ],
      units: [{ use: '아파트', count: 12, unitExclusiveAreaM2: 60 }],
    },
  },
]

function defaultBuildingProgram() {
  return {
    declaredProjectType: '',
    commonAreaAllocationMethod: 'exclusive_area_ratio',
    areaComponents: [],
    units: [],
  }
}

function defaultModelSettings() {
  return {
    floorHeights: [],
    floorUses: [],
    basementFloors: 0,
    basementFloorHeights: [],
    basementFloorUses: [],
    buildingStructure: DEFAULT_BUILDING_STRUCTURE,
    parkingCount: '',
    landscapeInstalledArea: '',
    landscapeLegalArea: '',
    siteSetbackAdjacentM: 0.5,
    siteSetbackBuildingLineM: 0.5,
    buildingProgram: defaultBuildingProgram(),
  }
}

function normalizedBuildingProgram(program) {
  return {
    ...defaultBuildingProgram(),
    ...(program || {}),
    areaComponents: Array.isArray(program?.areaComponents) ? program.areaComponents : [],
    units: Array.isArray(program?.units) ? program.units : [],
  }
}

function normalizedModelSettings(settings) {
  return {
    ...defaultModelSettings(),
    ...(settings || {}),
    buildingProgram: normalizedBuildingProgram(settings?.buildingProgram),
  }
}

function defaultRegulationOverrides() {
  return {
    bcrPercent: '',
    farPercent: '',
    maxHeightM: '',
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function isPoint2d(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function collectPoints(value) {
  if (isPoint2d(value)) return [[toNumber(value[0]), toNumber(value[1])]]
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => collectPoints(item))
}

function polygonArea2d(points) {
  if (!points?.length) return 0
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}

function polygonCentroid2d(points) {
  if (!points?.length) return [0, 0]
  const openPoints = points.length > 1
    && points[0][0] === points[points.length - 1][0]
    && points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1)
    : points
  const sums = openPoints.reduce(
    (acc, [x, y]) => [acc[0] + toNumber(x), acc[1] + toNumber(y)],
    [0, 0],
  )
  return [sums[0] / openPoints.length, sums[1] / openPoints.length]
}

function pointInPolygon(point, polygon) {
  if (!polygon?.length) return false
  const [x, y] = point
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index]
    const [xj, yj] = polygon[previous]
    const intersects = ((yi > y) !== (yj > y))
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function analysisSitePoints(parcelSurfaces) {
  const analysis = (parcelSurfaces || []).find((parcelSurface) => parcelSurface.role === 'analysis')
  return (analysis?.parts?.[0] || []).map(([x, y]) => [x, y])
}

function boundsOfPoints(points) {
  const validPoints = collectPoints(points)
  if (!validPoints.length) return null
  const xs = validPoints.map(([x]) => toNumber(x))
  const ys = validPoints.map(([, y]) => toNumber(y))
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function parseGridKey(key) {
  const [ix, iy] = key.split(':').map(Number)
  return { ix, iy }
}

function planLevelIndex(plan) {
  const match = String(plan?.id || '').match(/(\d+)/)
  return match ? Math.max(Number(match[1]) - 1, 0) : 0
}

function isGroundFloorPlan(plan) {
  return plan?.type === 'above' && planLevelIndex(plan) === 0
}

function normalizedModelEditState(state) {
  return {
    ...DEFAULT_MODEL_EDIT_STATE,
    ...(state || {}),
    gridSizeM: Math.max(0.1, toNumber(state?.gridSizeM, DEFAULT_MODEL_EDIT_STATE.gridSizeM)),
    draftHeightM: Math.max(0.1, toNumber(state?.draftHeightM, DEFAULT_MODEL_EDIT_STATE.draftHeightM)),
    roofHeightM: Math.max(0.1, toNumber(state?.roofHeightM, DEFAULT_MODEL_EDIT_STATE.roofHeightM)),
    selectedCells: Array.isArray(state?.selectedCells) ? state.selectedCells : [],
    lassoPoints: Array.isArray(state?.lassoPoints) ? state.lassoPoints : [],
    additions: Array.isArray(state?.additions) ? state.additions : [],
    roofs: Array.isArray(state?.roofs) ? state.roofs : [],
  }
}

function normalizedAssistantQuestion(question, index) {
  return {
    id: question?.id || `question_${String(index + 1).padStart(2, '0')}`,
    title: question?.title || `질문 ${index + 1}`,
    prompt: question?.prompt || '',
    status: ['pending', 'answering', 'completed'].includes(question?.status) ? question.status : 'pending',
    answerText: question?.answerText || '',
    marks: Array.isArray(question?.marks) ? question.marks : [],
  }
}

function normalizedAssistantState(state) {
  const questions = Array.isArray(state?.questions) && state.questions.length
    ? state.questions.map((question, index) => normalizedAssistantQuestion(question, index))
    : DEFAULT_ASSISTANT_QUESTIONS.map((question, index) => normalizedAssistantQuestion(question, index))
  const activeQuestionId = questions.some((question) => question.id === state?.activeQuestionId)
    ? state.activeQuestionId
    : null
  return {
    ...DEFAULT_ASSISTANT_STATE,
    ...(state || {}),
    activeQuestionId,
    questions,
    resultPreview: state?.resultPreview || null,
    loading: Boolean(state?.loading),
    error: state?.error || '',
  }
}

function pruneAssistantState(state, nextFloorIds) {
  const normalized = normalizedAssistantState(state)
  return {
    ...normalized,
    questions: normalized.questions.map((question) => ({
      ...question,
      marks: (question.marks || []).filter((mark) => !mark.floorId || nextFloorIds.has(mark.floorId)),
    })),
  }
}

function pruneModelEditState(state, nextFloorIds) {
  const normalized = normalizedModelEditState(state)
  return {
    ...normalized,
    selectedFloorId: nextFloorIds.has(normalized.selectedFloorId) ? normalized.selectedFloorId : '',
    selectedCells: [],
    lassoPoints: [],
    additions: normalized.additions.filter((item) => nextFloorIds.has(item.floorId)),
    roofs: normalized.roofs.filter((item) => nextFloorIds.has(item.floorId)),
  }
}

function gridCellsForTargetFloor(sourceCells, targetPlan) {
  if (isGroundFloorPlan(targetPlan)) return { ...sourceCells }
  return Object.fromEntries(
    Object.entries(sourceCells || {}).filter(([, type]) => !GROUND_ONLY_GRID_TYPES.has(type)),
  )
}

function gridCellCenter(ix, iy) {
  return [(ix + 0.5) * GRID_SIZE_M, (iy + 0.5) * GRID_SIZE_M]
}

function rotatePoint2d(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point[0] - center[0]
  const dy = point[1] - center[1]
  return [
    center[0] + dx * cos - dy * sin,
    center[1] + dx * sin + dy * cos,
  ]
}

function gridCellPolygon(ix, iy) {
  const x = ix * GRID_SIZE_M
  const y = iy * GRID_SIZE_M
  return [
    [x, y],
    [x + GRID_SIZE_M, y],
    [x + GRID_SIZE_M, y + GRID_SIZE_M],
    [x, y + GRID_SIZE_M],
  ]
}

function gridBoundarySegmentsFromActiveCells(activeCells) {
  const edgeMap = new Map()
  const edgeKey = (a, b) => {
    const keyA = `${a[0]}:${a[1]}`
    const keyB = `${b[0]}:${b[1]}`
    return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
  }

  activeCells.forEach(({ ix, iy }) => {
    const corners = [
      [ix, iy],
      [ix + 1, iy],
      [ix + 1, iy + 1],
      [ix, iy + 1],
    ]
    const edges = [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
      [corners[2], corners[3]],
      [corners[3], corners[0]],
    ]
    edges.forEach(([a, b]) => {
      const key = edgeKey(a, b)
      if (edgeMap.has(key)) {
        edgeMap.delete(key)
      } else {
        edgeMap.set(key, [a, b])
      }
    })
  })

  return [...edgeMap.values()].map(([start, end]) => ({
    start: [
      Number((start[0] * GRID_SIZE_M).toFixed(3)),
      Number((start[1] * GRID_SIZE_M).toFixed(3)),
    ],
    end: [
      Number((end[0] * GRID_SIZE_M).toFixed(3)),
      Number((end[1] * GRID_SIZE_M).toFixed(3)),
    ],
  }))
}

function transformGridPointToSite(point, bounds, rotation) {
  const rotationCenter = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  ]
  return rotatePoint2d(point, rotationCenter, rotation)
}

function gridOutlineFromActiveCells(activeCells) {
  if (!activeCells.length) return []
  const edgeMap = new Map()
  const edgeKey = (a, b) => {
    const keyA = `${a[0]}:${a[1]}`
    const keyB = `${b[0]}:${b[1]}`
    return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
  }

  activeCells.forEach(({ ix, iy }) => {
    const corners = [
      [ix, iy],
      [ix + 1, iy],
      [ix + 1, iy + 1],
      [ix, iy + 1],
    ]
    const edges = [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
      [corners[2], corners[3]],
      [corners[3], corners[0]],
    ]
    edges.forEach(([a, b]) => {
      const key = edgeKey(a, b)
      if (edgeMap.has(key)) {
        edgeMap.delete(key)
      } else {
        edgeMap.set(key, [a, b])
      }
    })
  })

  const adjacency = new Map()
  edgeMap.forEach(([a, b]) => {
    const keyA = `${a[0]}:${a[1]}`
    const keyB = `${b[0]}:${b[1]}`
    adjacency.set(keyA, [...(adjacency.get(keyA) || []), b])
    adjacency.set(keyB, [...(adjacency.get(keyB) || []), a])
  })

  const startKey = [...adjacency.keys()].sort((a, b) => {
    const [ax, ay] = a.split(':').map(Number)
    const [bx, by] = b.split(':').map(Number)
    return ay === by ? ax - bx : ay - by
  })[0]
  if (!startKey) return []

  const start = startKey.split(':').map(Number)
  const loop = [start]
  let current = start
  let previous = null
  const maxSteps = edgeMap.size + 2

  for (let step = 0; step < maxSteps; step += 1) {
    const currentKey = `${current[0]}:${current[1]}`
    const neighbors = adjacency.get(currentKey) || []
    const next = neighbors.find((neighbor) => !previous || neighbor[0] !== previous[0] || neighbor[1] !== previous[1])
      || neighbors[0]
    if (!next) break
    if (next[0] === start[0] && next[1] === start[1]) break
    loop.push(next)
    previous = current
    current = next
  }

  return loop.map(([x, y]) => [
    Number((x * GRID_SIZE_M).toFixed(3)),
    Number((y * GRID_SIZE_M).toFixed(3)),
  ])
}

function normalizedFloorEdit(edit) {
  return {
    offsetX: toNumber(edit?.offsetX, DEFAULT_FLOOR_EDIT.offsetX),
    offsetY: toNumber(edit?.offsetY, DEFAULT_FLOOR_EDIT.offsetY),
    scaleX: Math.max(0.1, toNumber(edit?.scaleX, DEFAULT_FLOOR_EDIT.scaleX)),
    scaleY: Math.max(0.1, toNumber(edit?.scaleY, DEFAULT_FLOOR_EDIT.scaleY)),
    rotation: toNumber(edit?.rotation, DEFAULT_FLOOR_EDIT.rotation),
  }
}

function hasFloorEdit(edit) {
  const normalized = normalizedFloorEdit(edit)
  return Math.abs(normalized.offsetX) > 0.001
    || Math.abs(normalized.offsetY) > 0.001
    || Math.abs(normalized.scaleX - 1) > 0.001
    || Math.abs(normalized.scaleY - 1) > 0.001
    || Math.abs(normalized.rotation) > 0.001
}

function transformFloorPoints(points, edit) {
  if (!points?.length) return []
  const normalized = normalizedFloorEdit(edit)
  const [cx, cy] = polygonCentroid2d(points)
  const radians = (normalized.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return points.map(([x, y]) => {
    const localX = (toNumber(x) - cx) * normalized.scaleX
    const localY = (toNumber(y) - cy) * normalized.scaleY
    const rotatedX = localX * cos - localY * sin
    const rotatedY = localX * sin + localY * cos
    return [
      Number((cx + rotatedX + normalized.offsetX).toFixed(3)),
      Number((cy + rotatedY + normalized.offsetY).toFixed(3)),
    ]
  })
}

function applyDesignStateToFloorPlans(floorPlans, designState) {
  const floorEdits = designState?.floorEdits || {}
  return (floorPlans || []).map((plan) => {
    const edit = floorEdits[plan.id]
    if (!hasFloorEdit(edit)) return plan

    const points = transformFloorPoints(plan.points || [], edit)
    return {
      ...plan,
      points,
      areaM2: Number(polygonArea2d(points).toFixed(1)),
      originalAreaM2: plan.originalAreaM2 ?? plan.areaM2,
      designPreview: true,
      designEdit: normalizedFloorEdit(edit),
    }
  })
}

function applyGridStateToFloorPlans(floorPlans, gridState, parcelSurfaces) {
  const sitePoints = analysisSitePoints(parcelSurfaces)
  if (!floorPlans?.length || !sitePoints.length) return floorPlans || []

  const siteBounds = boundsOfPoints(sitePoints)
  if (!siteBounds) return floorPlans

  return floorPlans.map((plan) => {
    const floorGrid = gridState?.floors?.[plan.id] || {}
    const cells = floorGrid.cells || {}
    const replaceDefault = Boolean(floorGrid.replaceDefault)
    if (!Object.keys(cells).length) {
      return replaceDefault
        ? {
          ...plan,
          points: [],
          areaM2: 0,
          originalAreaM2: plan.originalAreaM2 ?? plan.areaM2,
          gridPreview: true,
          gridReplacesDefault: true,
          gridCells: [],
          gridBoundarySegments: [],
          gridStats: {
            editedCellCount: 0,
            activeCellCount: 0,
            excludedAreaM2: 0,
          },
        }
        : plan
    }
    const gridRotation = toNumber(floorGrid.gridRotation)

    const planBounds = boundsOfPoints(plan.points || [])
    const combinedBounds = {
      minX: Math.min(siteBounds.minX, planBounds?.minX ?? siteBounds.minX),
      maxX: Math.max(siteBounds.maxX, planBounds?.maxX ?? siteBounds.maxX),
      minY: Math.min(siteBounds.minY, planBounds?.minY ?? siteBounds.minY),
      maxY: Math.max(siteBounds.maxY, planBounds?.maxY ?? siteBounds.maxY),
    }
    const gridBounds = floorGrid.gridBounds || combinedBounds
    const rotationCenter = [
      (gridBounds.minX + gridBounds.maxX) / 2,
      (gridBounds.minY + gridBounds.maxY) / 2,
    ]
    const gridSearchBounds = boundsOfPoints([
      ...sitePoints.map((point) => rotatePoint2d(point, rotationCenter, -gridRotation)),
      ...(plan.points || []).map((point) => rotatePoint2d(point, rotationCenter, -gridRotation)),
    ]) || combinedBounds
    const minX = Math.floor(gridSearchBounds.minX / GRID_SIZE_M)
    const maxX = Math.ceil(gridSearchBounds.maxX / GRID_SIZE_M)
    const minY = Math.floor(gridSearchBounds.minY / GRID_SIZE_M)
    const maxY = Math.ceil(gridSearchBounds.maxY / GRID_SIZE_M)
    const activeCells = []
    const displayCells = []

    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        const center = gridCellCenter(ix, iy)
        const siteCenter = rotatePoint2d(center, rotationCenter, gridRotation)
        if (!pointInPolygon(siteCenter, sitePoints)) continue

        const key = `${ix}:${iy}`
        const overrideType = cells[key]
        const isDefaultFloor = pointInPolygon(siteCenter, plan.points || [])
        const effectiveType = AREA_REMOVED_GRID_TYPES.has(overrideType)
          ? ''
          : overrideType || (!replaceDefault && isDefaultFloor ? 'main' : '')
        if (!effectiveType) continue

        displayCells.push({ ix, iy, type: effectiveType })
        if (!AREA_EXCLUDED_GRID_TYPES.has(effectiveType)) {
          activeCells.push({ ix, iy, type: effectiveType })
        }
      }
    }

    const outlinePoints = gridOutlineFromActiveCells(activeCells)
      .map((point) => rotatePoint2d(point, rotationCenter, gridRotation))
    const boundarySegments = gridBoundarySegmentsFromActiveCells(activeCells)
      .map((segment) => ({
        start: rotatePoint2d(segment.start, rotationCenter, gridRotation),
        end: rotatePoint2d(segment.end, rotationCenter, gridRotation),
      }))
    const activeArea = activeCells.length * GRID_SIZE_M * GRID_SIZE_M
    const excludedArea = Object.entries(cells).reduce((sum, [key, type]) => {
      if (!AREA_EXCLUDED_GRID_TYPES.has(type)) return sum
      const { ix, iy } = parseGridKey(key)
      const center = gridCellCenter(ix, iy)
      const siteCenter = rotatePoint2d(center, rotationCenter, gridRotation)
      return pointInPolygon(siteCenter, sitePoints) ? sum + GRID_SIZE_M * GRID_SIZE_M : sum
    }, 0)

    return {
      ...plan,
      points: outlinePoints.length ? outlinePoints : (replaceDefault ? [] : plan.points),
      areaM2: Number(activeArea.toFixed(1)),
      originalAreaM2: plan.originalAreaM2 ?? plan.areaM2,
      gridPreview: true,
      gridResolutionM: GRID_SIZE_M,
      gridReplacesDefault: replaceDefault,
      gridBounds,
      gridRotation,
      gridBoundarySegments: boundarySegments,
      gridCells: displayCells.map(({ ix, iy, type }) => ({
        ix,
        iy,
        type,
        points: gridCellPolygon(ix, iy).map((point) => transformGridPointToSite(point, gridBounds, gridRotation)),
      })),
      gridStats: {
        editedCellCount: Object.keys(cells).length,
        activeCellCount: activeCells.length,
        excludedAreaM2: Number(excludedArea.toFixed(2)),
      },
    }
  })
}

function materializeGridFloorCells(plan, floorGrid, sitePoints, fallbackBounds, gridRotation, gridBounds) {
  const sourceCells = floorGrid?.cells || {}
  const bounds = gridBounds || fallbackBounds
  if (!plan || !sitePoints.length || !bounds) return { ...sourceCells }
  const shouldPreserveDefaultFloor = !floorGrid?.replaceDefault

  const rotationCenter = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  ]
  const searchBounds = boundsOfPoints([
    ...sitePoints.map((point) => rotatePoint2d(point, rotationCenter, -gridRotation)),
    ...(plan.points || []).map((point) => rotatePoint2d(point, rotationCenter, -gridRotation)),
  ]) || fallbackBounds
  const minX = Math.floor(searchBounds.minX / GRID_SIZE_M)
  const maxX = Math.ceil(searchBounds.maxX / GRID_SIZE_M)
  const minY = Math.floor(searchBounds.minY / GRID_SIZE_M)
  const maxY = Math.ceil(searchBounds.maxY / GRID_SIZE_M)
  const nextCells = {}

  for (let ix = minX; ix <= maxX; ix += 1) {
    for (let iy = minY; iy <= maxY; iy += 1) {
      const key = `${ix}:${iy}`
      const overrideType = sourceCells[key]
      if (AREA_REMOVED_GRID_TYPES.has(overrideType)) continue

      const center = gridCellCenter(ix, iy)
      const siteCenter = rotatePoint2d(center, rotationCenter, gridRotation)
      if (!pointInPolygon(siteCenter, sitePoints)) continue

      if (overrideType) {
        nextCells[key] = overrideType
      } else if (shouldPreserveDefaultFloor && pointInPolygon(siteCenter, plan.points || [])) {
        nextCells[key] = 'main'
      }
    }
  }

  return nextCells
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [modelUrl, setModelUrl] = useState('')
  const [boundaryLines, setBoundaryLines] = useState(null)
  const [parcelSurfaces, setParcelSurfaces] = useState([])
  const [floorPlans, setFloorPlans] = useState([])
  const [parcel, setParcel] = useState(null)
  const [regulations, setRegulations] = useState(null)
  const [regulationOverrides, setRegulationOverrides] = useState(defaultRegulationOverrides)
  const [modelSettings, setModelSettings] = useState(defaultModelSettings)
  const [designState, setDesignState] = useState({ floorEdits: {} })
  const [gridState, setGridState] = useState({ floors: {} })
  const [modelEditState, setModelEditState] = useState(DEFAULT_MODEL_EDIT_STATE)
  const [assistantState, setAssistantState] = useState(DEFAULT_ASSISTANT_STATE)
  const [lastAnalysisAddress, setLastAnalysisAddress] = useState('')
  const [designOpen, setDesignOpen] = useState(false)
  const [gridEditorOpen, setGridEditorOpen] = useState(false)
  const [selectedDesignFloorId, setSelectedDesignFloorId] = useState('')
  const [selectedGridFloorId, setSelectedGridFloorId] = useState('')
  const [planView, setPlanView] = useState(DEFAULT_PLAN_VIEW)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [savedModels, setSavedModels] = useState([])
  const [selectedSaveId, setSelectedSaveId] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const designPreviewFloorPlans = useMemo(
    () => applyDesignStateToFloorPlans(floorPlans, designState),
    [floorPlans, designState],
  )
  const previewFloorPlans = useMemo(
    () => applyGridStateToFloorPlans(designPreviewFloorPlans, gridState, parcelSurfaces),
    [designPreviewFloorPlans, gridState, parcelSurfaces],
  )
  const activeDesignFloorId = selectedDesignFloorId
    && floorPlans.some((plan) => plan.id === selectedDesignFloorId)
    ? selectedDesignFloorId
    : floorPlans[0]?.id || ''
  const selectedDesignPlan = floorPlans.find((plan) => plan.id === activeDesignFloorId)
  const selectedPreviewPlan = previewFloorPlans.find((plan) => plan.id === activeDesignFloorId)
  const selectedDesignEdit = normalizedFloorEdit(designState.floorEdits?.[activeDesignFloorId])
  const editedFloorCount = Object.values(designState.floorEdits || {}).filter(hasFloorEdit).length
  const gridEditedFloorCount = Object.values(gridState.floors || {})
    .filter((floorGrid) => Object.keys(floorGrid?.cells || {}).length > 0)
    .length

  const generate = async (settings = modelSettings, overrides = regulationOverrides, options = {}) => {
    const requestedAddress = address.trim()
    if (!requestedAddress) {
      setError('주소를 입력한 후 분석을 실행해주세요.')
      return
    }
    const isNewAddressAnalysis = !options.preserveDesignState
      && lastAnalysisAddress
      && requestedAddress !== lastAnalysisAddress
    const requestSettings = isNewAddressAnalysis ? defaultModelSettings() : normalizedModelSettings(settings)
    const requestOverrides = isNewAddressAnalysis ? defaultRegulationOverrides() : overrides

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${API_BASE_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: requestedAddress,
          modelSettings: requestSettings,
          regulationOverrides: requestOverrides,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || '생성에 실패했습니다.')
      }

      setModelUrl(data.modelUrl)
      setBoundaryLines(data.boundaryLines || null)
      setParcelSurfaces(data.parcelSurfaces || [])
      setFloorPlans(data.floorPlans || [])
      const nextFloorIds = new Set((data.floorPlans || []).map((plan) => plan.id))
      if (!options.preserveDesignState) {
        setDesignState({ floorEdits: {} })
        setGridState({ floors: {} })
        setModelEditState(DEFAULT_MODEL_EDIT_STATE)
        setAssistantState(DEFAULT_ASSISTANT_STATE)
        setPlanView(DEFAULT_PLAN_VIEW)
      } else {
        setDesignState((current) => ({
          ...current,
          floorEdits: Object.fromEntries(
            Object.entries(current.floorEdits || {}).filter(([floorId]) => nextFloorIds.has(floorId)),
          ),
        }))
        setGridState((current) => ({
          ...current,
          floors: Object.fromEntries(
            Object.entries(current.floors || {}).filter(([floorId]) => nextFloorIds.has(floorId)),
          ),
        }))
        setModelEditState((current) => pruneModelEditState(current, nextFloorIds))
        setAssistantState((current) => pruneAssistantState(current, nextFloorIds))
      }
      setSelectedDesignFloorId((current) => (
        nextFloorIds.has(current) ? current : data.floorPlans?.[0]?.id || ''
      ))
      setSelectedGridFloorId((current) => (
        nextFloorIds.has(current)
          ? current
          : data.floorPlans?.find((plan) => plan.type === 'above')?.id || data.floorPlans?.[0]?.id || ''
      ))
      setParcel(data.parcel)
      setRegulations(data.regulations)
      if (isNewAddressAnalysis) {
        setRegulationOverrides(requestOverrides)
      }
      setLastAnalysisAddress(requestedAddress)
      if (data.modelSettings) {
        setModelSettings(normalizedModelSettings(data.modelSettings))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const updateFloorHeight = (index, value) => {
    setModelSettings((current) => {
      const floorHeights = [...current.floorHeights]
      floorHeights[index] = value
      return { ...current, floorHeights }
    })
  }

  const updateFloorUse = (index, value) => {
    setModelSettings((current) => {
      const floorUses = [...(current.floorUses || [])]
      floorUses[index] = value
      return { ...current, floorUses }
    })
  }

  const addFloor = () => {
    setModelSettings((current) => ({
      ...current,
      floorHeights: [...current.floorHeights, DEFAULT_FLOOR_HEIGHT_M],
      floorUses: [...(current.floorUses || []), ''],
    }))
  }

  const removeFloor = (index) => {
    setModelSettings((current) => ({
      ...current,
      floorHeights: current.floorHeights.filter((_height, itemIndex) => itemIndex !== index),
      floorUses: (current.floorUses || []).filter((_use, itemIndex) => itemIndex !== index),
    }))
  }

  const updateBasementFloors = (value) => {
    const basementFloors = Math.max(0, Number.parseInt(value || '0', 10) || 0)
    setModelSettings((current) => {
      const basementFloorHeights = current.basementFloorHeights.slice(0, basementFloors)
      const basementFloorUses = (current.basementFloorUses || []).slice(0, basementFloors)
      while (basementFloorHeights.length < basementFloors) {
        basementFloorHeights.push(DEFAULT_FLOOR_HEIGHT_M)
      }
      while (basementFloorUses.length < basementFloors) {
        basementFloorUses.push('')
      }
      return {
        ...current,
        basementFloors,
        basementFloorHeights,
        basementFloorUses,
      }
    })
  }

  const updateBasementHeight = (index, value) => {
    setModelSettings((current) => {
      const basementFloorHeights = [...current.basementFloorHeights]
      basementFloorHeights[index] = value
      return { ...current, basementFloorHeights }
    })
  }

  const updateBasementUse = (index, value) => {
    setModelSettings((current) => {
      const basementFloorUses = [...(current.basementFloorUses || [])]
      basementFloorUses[index] = value
      return { ...current, basementFloorUses }
    })
  }

  const updateModelSetting = (key, value) => {
    setModelSettings((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const updateBuildingProgramSetting = (key, value) => {
    setModelSettings((current) => ({
      ...current,
      buildingProgram: {
        ...normalizedBuildingProgram(current.buildingProgram),
        [key]: value,
      },
    }))
  }

  const addProgramUnit = () => {
    setModelSettings((current) => {
      const buildingProgram = normalizedBuildingProgram(current.buildingProgram)
      return {
        ...current,
        buildingProgram: {
          ...buildingProgram,
          units: [
            ...buildingProgram.units,
            {
              use: '오피스텔',
              count: 1,
              unitExclusiveAreaM2: '',
            },
          ],
        },
      }
    })
  }

  const updateProgramUnit = (index, key, value) => {
    setModelSettings((current) => {
      const buildingProgram = normalizedBuildingProgram(current.buildingProgram)
      const units = [...buildingProgram.units]
      units[index] = {
        ...(units[index] || {}),
        [key]: value,
      }
      return {
        ...current,
        buildingProgram: {
          ...buildingProgram,
          units,
        },
      }
    })
  }

  const removeProgramUnit = (index) => {
    setModelSettings((current) => {
      const buildingProgram = normalizedBuildingProgram(current.buildingProgram)
      return {
        ...current,
        buildingProgram: {
          ...buildingProgram,
          units: buildingProgram.units.filter((_unit, itemIndex) => itemIndex !== index),
        },
      }
    })
  }

  const applyBuildingProgramPreset = (preset) => {
    setModelSettings((current) => {
      const floorUses = [...preset.floorUses]
      return normalizedModelSettings({
        ...current,
        floorHeights: floorUses.map((_use, index) => current.floorHeights?.[index] || DEFAULT_FLOOR_HEIGHT_M),
        floorUses,
        parkingCount: preset.parkingCount,
        buildingProgram: preset.buildingProgram,
      })
    })
    setOverviewOpen(true)
  }

  const updateDesignFloorEdit = (floorId, key, value) => {
    if (!floorId) return
    setDesignState((current) => {
      const currentEdit = normalizedFloorEdit(current.floorEdits?.[floorId])
      const nextEdit = {
        ...currentEdit,
        [key]: key === 'scaleX' || key === 'scaleY'
          ? Math.max(0.1, toNumber(value, currentEdit[key]))
          : toNumber(value, currentEdit[key]),
      }
      return {
        ...current,
        floorEdits: {
          ...(current.floorEdits || {}),
          [floorId]: nextEdit,
        },
      }
    })
  }

  const resetDesignFloorEdit = (floorId) => {
    if (!floorId) return
    setDesignState((current) => {
      const nextFloorEdits = { ...(current.floorEdits || {}) }
      delete nextFloorEdits[floorId]
      return { ...current, floorEdits: nextFloorEdits }
    })
  }

  const resetAllDesignEdits = () => {
    setDesignState({ floorEdits: {} })
  }

  const copyDesignEditToAboveFloors = () => {
    if (!activeDesignFloorId) return
    const sourceEdit = normalizedFloorEdit(designState.floorEdits?.[activeDesignFloorId])
    setDesignState((current) => {
      const nextFloorEdits = { ...(current.floorEdits || {}) }
      floorPlans
        .filter((plan) => plan.type === 'above' && plan.id !== activeDesignFloorId)
        .forEach((plan) => {
          nextFloorEdits[plan.id] = sourceEdit
        })
      return { ...current, floorEdits: nextFloorEdits }
    })
  }

  const updateGridCells = (floorId, updater) => {
    if (!floorId) return
    setGridState((current) => {
      const currentFloor = current.floors?.[floorId] || { cells: {} }
      const nextCells = typeof updater === 'function'
        ? updater(currentFloor.cells || {})
        : updater || {}
      return {
        ...current,
        floors: {
          ...(current.floors || {}),
          [floorId]: {
            ...currentFloor,
            cells: nextCells,
          },
        },
      }
    })
  }

  const updateGridFloorSetting = (floorId, key, value) => {
    if (!floorId) return
    setGridState((current) => {
      const currentFloor = current.floors?.[floorId] || { cells: {} }
      return {
        ...current,
        floors: {
          ...(current.floors || {}),
          [floorId]: {
            ...currentFloor,
            [key]: value,
          },
        },
      }
    })
  }

  const copyGridPlanToAllFloors = (sourceFloorId, options = {}) => {
    const sourcePlan = designPreviewFloorPlans.find((plan) => plan.id === sourceFloorId)
    const sitePoints = analysisSitePoints(parcelSurfaces)
    const siteBounds = boundsOfPoints(sitePoints)
    setGridState((current) => {
      const sourceFloor = current.floors?.[sourceFloorId]
      if (!sourceFloor) return current
      const gridRotation = options.gridRotation ?? sourceFloor.gridRotation ?? 0
      const gridBounds = options.gridBounds ?? sourceFloor.gridBounds
      const sourceCells = options.sourceCells
        ? { ...options.sourceCells }
        : materializeGridFloorCells(
          sourcePlan,
          sourceFloor,
          sitePoints,
          siteBounds,
          gridRotation,
          gridBounds,
        )
      const nextFloors = { ...(current.floors || {}) }
      floorPlans.forEach((plan) => {
        const targetCells = gridCellsForTargetFloor(sourceCells, plan)
        nextFloors[plan.id] = {
          ...sourceFloor,
          cells: targetCells,
          copiedFrom: sourceFloorId,
          replaceDefault: true,
          gridRotation,
          gridBounds,
        }
      })
      return { ...current, floors: nextFloors }
    })
  }

  const copyGridPlanToUpperFloors = (sourceFloorId, options = {}) => {
    const sourcePlan = designPreviewFloorPlans.find((plan) => plan.id === sourceFloorId)
    const sitePoints = analysisSitePoints(parcelSurfaces)
    const siteBounds = boundsOfPoints(sitePoints)
    const abovePlans = floorPlans.filter((plan) => plan.type === 'above')
    const sourceIndex = abovePlans.findIndex((plan) => plan.id === sourceFloorId)
    if (sourceIndex < 0) return

    setGridState((current) => {
      const sourceFloor = current.floors?.[sourceFloorId]
      if (!sourceFloor) return current
      const gridRotation = options.gridRotation ?? sourceFloor.gridRotation ?? 0
      const gridBounds = options.gridBounds ?? sourceFloor.gridBounds
      const sourceCells = options.sourceCells
        ? { ...options.sourceCells }
        : materializeGridFloorCells(
          sourcePlan,
          sourceFloor,
          sitePoints,
          siteBounds,
          gridRotation,
          gridBounds,
        )
      const nextFloors = { ...(current.floors || {}) }
      abovePlans.slice(sourceIndex).forEach((plan) => {
        const targetCells = gridCellsForTargetFloor(sourceCells, plan)
        nextFloors[plan.id] = {
          ...sourceFloor,
          cells: targetCells,
          copiedFrom: sourceFloorId,
          replaceDefault: true,
          gridRotation,
          gridBounds,
        }
      })
      return { ...current, floors: nextFloors }
    })
  }

  const regenerateWithSettings = () => {
    setSettingsOpen(false)
    if (address.trim()) {
      generate(modelSettings, regulationOverrides, { preserveDesignState: true })
    }
  }

  const applyRegulationOverrides = (nextOverrides) => {
    setRegulationOverrides(nextOverrides)
    if (address.trim()) {
      generate(modelSettings, nextOverrides, { preserveDesignState: true })
    }
  }

  const currentParcelKey = () => String(parcel?.address || address || '').trim()

  const currentModelSnapshot = () => ({
    address,
    modelUrl,
    boundaryLines,
    parcelSurfaces,
    floorPlans,
    parcel,
    regulations,
    regulationOverrides,
    modelSettings,
    designState,
    gridState,
    modelEditState,
    assistantState,
    planView,
    selectedDesignFloorId,
    selectedGridFloorId,
  })

  const submitAssistantAnswers = async (sourceView = 'main') => {
    setAssistantState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const payload = {
        sourceView,
        assistantState: normalizedAssistantState(assistantState),
        context: {
          address,
          parcel,
          regulations,
          modelSettings,
          floorPlans: previewFloorPlans,
          gridState,
          designState,
          modelEditState,
        },
      }
      const res = await fetch('/api/assistant/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'AI 설계 제안 생성에 실패했습니다.')
      setAssistantState((current) => ({
        ...current,
        loading: false,
        error: '',
        resultPreview: data.result || null,
      }))
    } catch (err) {
      setAssistantState((current) => ({
        ...current,
        loading: false,
        error: err.message,
      }))
    }
  }

  const loadSavedModelList = async () => {
    setSaveMessage('')
    const parcelKey = currentParcelKey()
    const url = parcelKey
      ? `/api/models/saves?parcelKey=${encodeURIComponent(parcelKey)}`
      : '/api/models/saves'
    try {
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '저장 목록을 불러오지 못했습니다.')
      setSavedModels(data.saves || [])
      setSelectedSaveId((current) => current || data.saves?.[0]?.id || '')
      setSaveMessage((data.saves || []).length ? '저장 목록을 불러왔습니다.' : '저장된 모델이 없습니다.')
    } catch (err) {
      setSaveMessage(err.message)
    }
  }

  const saveCurrentModel = async () => {
    if (!modelUrl || !floorPlans.length) {
      setSaveMessage('저장할 모델링 결과가 없습니다.')
      return
    }

    setSaveMessage('저장 중…')
    try {
      const res = await fetch('/api/models/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcelKey: currentParcelKey(),
          state: currentModelSnapshot(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '저장에 실패했습니다.')
      const nextSave = data.save
      setSavedModels((current) => [nextSave, ...current.filter((save) => save.id !== nextSave.id)])
      setSelectedSaveId(nextSave.id)
      setSaveMessage(`저장 완료: ${nextSave.parcelKey}/${nextSave.filename}`)
    } catch (err) {
      setSaveMessage(err.message)
    }
  }

  const applyLoadedModelState = (state) => {
    const nextFloorPlans = state.floorPlans || []
    const nextFloorIds = new Set(nextFloorPlans.map((plan) => plan.id))
    setAddress(state.address || '')
    setModelUrl(state.modelUrl || '')
    setBoundaryLines(state.boundaryLines || null)
    setParcelSurfaces(state.parcelSurfaces || [])
    setFloorPlans(nextFloorPlans)
    setParcel(state.parcel || null)
    setRegulations(state.regulations || null)
    setRegulationOverrides(state.regulationOverrides || defaultRegulationOverrides())
    setModelSettings(normalizedModelSettings(state.modelSettings))
    setLastAnalysisAddress(String(state.address || state.parcel?.address || '').trim())
    setDesignState(state.designState || { floorEdits: {} })
    setGridState(state.gridState || { floors: {} })
    setModelEditState(normalizedModelEditState(state.modelEditState))
    setAssistantState(normalizedAssistantState(state.assistantState))
    setPlanView(state.planView || DEFAULT_PLAN_VIEW)
    setSelectedDesignFloorId(
      nextFloorIds.has(state.selectedDesignFloorId) ? state.selectedDesignFloorId : nextFloorPlans[0]?.id || '',
    )
    setSelectedGridFloorId(
      nextFloorIds.has(state.selectedGridFloorId)
        ? state.selectedGridFloorId
        : nextFloorPlans.find((plan) => plan.type === 'above')?.id || nextFloorPlans[0]?.id || '',
    )
    setDesignOpen(false)
    setGridEditorOpen(false)
    setSettingsOpen(false)
    setOverviewOpen(false)
  }

  const loadSelectedModel = async () => {
    if (!selectedSaveId) {
      setSaveMessage('불러올 저장 항목을 선택해주세요.')
      return
    }
    const [folder, filename] = selectedSaveId.split('/')
    setSaveMessage('불러오는 중…')
    try {
      const res = await fetch(
        `/api/models/saves/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '저장 모델을 불러오지 못했습니다.')
      applyLoadedModelState(data.state || {})
      setSaveMessage(`불러오기 완료: ${data.parcelKey || folder}/${filename}`)
    } catch (err) {
      setSaveMessage(err.message)
    }
  }

  const deleteSelectedModel = async () => {
    if (!selectedSaveId) {
      setSaveMessage('삭제할 저장 항목을 선택해주세요.')
      return
    }
    const selectedSave = savedModels.find((save) => save.id === selectedSaveId)
    const label = selectedSave
      ? `${selectedSave.parcelKey}/${selectedSave.filename}`
      : selectedSaveId
    if (!window.confirm(`${label} 저장 항목을 삭제할까요?`)) return

    const [folder, filename] = selectedSaveId.split('/')
    setSaveMessage('삭제 중…')
    try {
      const res = await fetch(
        `/api/models/saves/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
        { method: 'DELETE' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '저장 모델 삭제에 실패했습니다.')
      const nextSaves = savedModels.filter((save) => save.id !== selectedSaveId)
      setSavedModels(nextSaves)
      setSelectedSaveId(nextSaves[0]?.id || '')
      setSaveMessage(`삭제 완료: ${label}`)
    } catch (err) {
      setSaveMessage(err.message)
    }
  }

  return (
    <main style={{ padding: 40 }}>
      <h1 style={{ fontSize: 32, fontWeight: 'bold' }}>
        Phase3: 규제 기반 3D 설계 편집 MVP
      </h1>
      <p style={{ marginTop: 8, color: '#666' }}>
        지번 입력 → 규제 분석 → 층별 평면 편집 → 3D 모델 반영
      </p>

      <div
        style={{
          marginTop: 20,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          style={{
            border: '1px solid #ccc',
            padding: 12,
            width: 400,
          }}
          placeholder="예) 서울특별시 강남구 역삼동 737"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
        />
        <button
          onClick={() => generate()}
          disabled={loading}
          style={{
            background: loading ? '#999' : 'black',
            color: 'white',
            padding: '12px 24px',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '분석 중…' : '분석'}
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            background: 'white',
            border: '1px solid #111',
            color: '#111',
            padding: '12px 24px',
            cursor: 'pointer',
          }}
        >
          모델 설정
        </button>
        <button
          onClick={() => setOverviewOpen(true)}
          style={{
            background: 'white',
            border: '1px solid #6d28d9',
            color: '#5b21b6',
            padding: '12px 24px',
            cursor: 'pointer',
          }}
        >
          건축개요
        </button>
        <button
          onClick={() => setDesignOpen(true)}
          disabled={!floorPlans.length}
          title={floorPlans.length ? '층별 footprint를 실시간으로 편집합니다.' : '분석 후 사용할 수 있습니다.'}
          style={{
            background: floorPlans.length ? '#111827' : '#e5e7eb',
            border: '1px solid #111827',
            color: floorPlans.length ? 'white' : '#9ca3af',
            padding: '12px 24px',
            cursor: floorPlans.length ? 'pointer' : 'not-allowed',
          }}
        >
          설계 옵션
        </button>
        {editedFloorCount > 0 && (
          <span style={{ color: '#2563eb', fontSize: 13 }}>
            미리보기 편집 {editedFloorCount}개층 적용 중
          </span>
        )}
        {gridEditedFloorCount > 0 && (
          <span style={{ color: '#16a34a', fontSize: 13 }}>
            그리드 계획 {gridEditedFloorCount}개층 적용 중
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: 10,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
        }}
      >
        <strong style={{ fontSize: 13 }}>모델 저장/불러오기</strong>
        <button
          onClick={saveCurrentModel}
          disabled={!modelUrl || loading}
          style={{
            padding: '8px 12px',
            border: 0,
            borderRadius: 6,
            background: modelUrl && !loading ? '#111827' : '#d1d5db',
            color: 'white',
            cursor: modelUrl && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          저장
        </button>
        <button
          onClick={loadSavedModelList}
          disabled={loading}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            background: 'white',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          저장목록
        </button>
        <select
          value={selectedSaveId}
          onChange={(event) => setSelectedSaveId(event.target.value)}
          style={{
            minWidth: 280,
            maxWidth: 520,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
          <option value="">저장 항목 선택</option>
          {savedModels.map((save) => (
            <option key={save.id} value={save.id}>
              {save.parcelKey} · {save.savedAt}
            </option>
          ))}
        </select>
        <button
          onClick={loadSelectedModel}
          disabled={!selectedSaveId || loading}
          style={{
            padding: '8px 12px',
            border: 0,
            borderRadius: 6,
            background: selectedSaveId && !loading ? '#2563eb' : '#d1d5db',
            color: 'white',
            cursor: selectedSaveId && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          불러오기
        </button>
        <button
          onClick={deleteSelectedModel}
          disabled={!selectedSaveId || loading}
          style={{
            padding: '8px 12px',
            border: '1px solid #dc2626',
            borderRadius: 6,
            background: selectedSaveId && !loading ? '#fff1f2' : '#f3f4f6',
            color: selectedSaveId && !loading ? '#b91c1c' : '#9ca3af',
            cursor: selectedSaveId && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          삭제
        </button>
        {saveMessage && (
          <span style={{ color: saveMessage.includes('실패') || saveMessage.includes('없습니다') ? '#b91c1c' : '#4b5563', fontSize: 12 }}>
            {saveMessage}
          </span>
        )}
      </div>

      <BuildingOverviewSheet
        open={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        parcel={parcel}
        regulations={regulations}
        floorPlans={previewFloorPlans}
        modelSettings={modelSettings}
        presets={BUILDING_PROGRAM_TEST_PRESETS}
        onApplyPreset={applyBuildingProgramPreset}
        onModelSettingChange={updateModelSetting}
        onBuildingProgramChange={updateBuildingProgramSetting}
        onAddProgramUnit={addProgramUnit}
        onUpdateProgramUnit={updateProgramUnit}
        onRemoveProgramUnit={removeProgramUnit}
      />

      {settingsOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: 520,
              maxHeight: '85vh',
              overflow: 'auto',
              background: 'white',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 'bold' }}>모델 설정</h2>
                <p style={{ marginTop: 6, color: '#666', fontSize: 13 }}>
                  기본 층고는 4m입니다. 층별 높이를 바꾸면 모델을 다시 생성합니다.
                </p>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            <section style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 'bold' }}>지상층 층고</h3>
                <button
                  onClick={addFloor}
                  style={{ padding: '8px 12px', border: '1px solid #ccc', background: '#fafafa' }}
                >
                  지상층 추가
                </button>
              </div>
              {modelSettings.floorHeights.length === 0 && (
                <p style={{ marginTop: 10, color: '#777', fontSize: 13 }}>
                  아직 생성된 층 정보가 없습니다. 분석하면 기본 4m 층고로 자동 산정됩니다.
                </p>
              )}
              {modelSettings.floorHeights.map((height, index) => (
                <div
                  key={`floor-${index}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}
                >
                  <label style={{ width: 70 }}>{index + 1}층</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={height}
                    onChange={(e) => updateFloorHeight(index, e.target.value)}
                    style={{ flex: 1, border: '1px solid #ccc', padding: 10 }}
                  />
                  <span>m</span>
                  <input
                    placeholder="용도: 소매점"
                    value={(modelSettings.floorUses || [])[index] || ''}
                    onChange={(e) => updateFloorUse(index, e.target.value)}
                    style={{ flex: 1.2, border: '1px solid #ccc', padding: 10 }}
                  />
                  <button
                    onClick={() => removeFloor(index)}
                    style={{ padding: '8px 10px', border: '1px solid #ddd', background: 'white' }}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </section>

            <section style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 'bold' }}>지하층 설정</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <label style={{ width: 100 }}>지하층 수</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={modelSettings.basementFloors}
                  onChange={(e) => updateBasementFloors(e.target.value)}
                  style={{ flex: 1, border: '1px solid #ccc', padding: 10 }}
                />
                <span>개층</span>
              </div>
              {modelSettings.basementFloorHeights.map((height, index) => (
                <div
                  key={`basement-${index}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}
                >
                  <label style={{ width: 100 }}>지하 {index + 1}층</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={height}
                    onChange={(e) => updateBasementHeight(index, e.target.value)}
                    style={{ flex: 1, border: '1px solid #ccc', padding: 10 }}
                  />
                  <span>m</span>
                  <input
                    placeholder="용도: 주차장"
                    value={(modelSettings.basementFloorUses || [])[index] || ''}
                    onChange={(e) => updateBasementUse(index, e.target.value)}
                    style={{ flex: 1.2, border: '1px solid #ccc', padding: 10 }}
                  />
                </div>
              ))}
            </section>

            <section style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 'bold' }}>대지안의 공지</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                  인접대지
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={modelSettings.siteSetbackAdjacentM ?? 0.5}
                    onChange={(e) => updateModelSetting('siteSetbackAdjacentM', e.target.value)}
                    style={{ border: '1px solid #ccc', padding: 10 }}
                  />
                  <span style={{ color: '#777', fontSize: 12 }}>m</span>
                </label>
                <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                  건축선
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={modelSettings.siteSetbackBuildingLineM ?? 0.5}
                    onChange={(e) => updateModelSetting('siteSetbackBuildingLineM', e.target.value)}
                    style={{ border: '1px solid #ccc', padding: 10 }}
                  />
                  <span style={{ color: '#777', fontSize: 12 }}>m</span>
                </label>
              </div>
              <p style={{ marginTop: 8, marginBottom: 0, color: '#777', fontSize: 12, lineHeight: 1.5 }}>
                현재 평면도에는 두 값 중 큰 값을 기준으로 분석대지 안쪽에 RED 점선 공지선을 표시하고,
                평면 footprint가 공지선을 넘으면 평면도 기준으로 자동 축소합니다.
              </p>
            </section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 }}>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ padding: '11px 18px', border: '1px solid #ccc', background: 'white' }}
              >
                닫기
              </button>
              <button
                onClick={regenerateWithSettings}
                disabled={loading || !address.trim()}
                style={{
                  padding: '11px 18px',
                  border: 0,
                  background: loading || !address.trim() ? '#999' : '#111',
                  color: 'white',
                }}
              >
                설정 저장 후 모델 재생성
              </button>
            </div>
          </div>
        </div>
      )}

      {designOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              width: 580,
              maxHeight: '85vh',
              overflow: 'auto',
              background: 'white',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 'bold' }}>설계 옵션</h2>
                <p style={{ marginTop: 6, color: '#666', fontSize: 13, lineHeight: 1.5 }}>
                  층별 footprint를 프론트에서 즉시 미리보기합니다.
                  평면도, 건축개요, 초과 경고는 바로 갱신되며 API는 다시 호출하지 않습니다.
                </p>
              </div>
              <button
                onClick={() => setDesignOpen(false)}
                style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {floorPlans.length ? (
              <>
                <section style={{ marginTop: 22 }}>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                    편집할 층
                    <select
                      value={activeDesignFloorId}
                      onChange={(event) => setSelectedDesignFloorId(event.target.value)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    >
                      {floorPlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.label} · {plan.type === 'basement' ? '지하층' : '지상층'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
                    기준 면적 {Number(selectedDesignPlan?.areaM2 || 0).toFixed(1)}㎡
                    {' → '}
                    미리보기 면적 {Number(selectedPreviewPlan?.areaM2 || 0).toFixed(1)}㎡
                  </div>
                </section>

                <section
                  style={{
                    marginTop: 18,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    X 이동(m)
                    <input
                      type="number"
                      step="0.1"
                      value={selectedDesignEdit.offsetX}
                      onChange={(event) => updateDesignFloorEdit(activeDesignFloorId, 'offsetX', event.target.value)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Y 이동(m)
                    <input
                      type="number"
                      step="0.1"
                      value={selectedDesignEdit.offsetY}
                      onChange={(event) => updateDesignFloorEdit(activeDesignFloorId, 'offsetY', event.target.value)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    X 크기(%)
                    <input
                      type="number"
                      min="10"
                      step="1"
                      value={Number((selectedDesignEdit.scaleX * 100).toFixed(1))}
                      onChange={(event) => updateDesignFloorEdit(activeDesignFloorId, 'scaleX', toNumber(event.target.value, 100) / 100)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    Y 크기(%)
                    <input
                      type="number"
                      min="10"
                      step="1"
                      value={Number((selectedDesignEdit.scaleY * 100).toFixed(1))}
                      onChange={(event) => updateDesignFloorEdit(activeDesignFloorId, 'scaleY', toNumber(event.target.value, 100) / 100)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                    회전각(도)
                    <input
                      type="number"
                      step="0.5"
                      value={selectedDesignEdit.rotation}
                      onChange={(event) => updateDesignFloorEdit(activeDesignFloorId, 'rotation', event.target.value)}
                      style={{ border: '1px solid #ccc', padding: 10 }}
                    />
                  </label>
                </section>

                <section style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    onClick={copyDesignEditToAboveFloors}
                    disabled={!activeDesignFloorId}
                    style={{ padding: '9px 12px', border: '1px solid #ccc', background: '#fafafa' }}
                  >
                    기준층 값 지상층 복사
                  </button>
                  <button
                    onClick={() => resetDesignFloorEdit(activeDesignFloorId)}
                    disabled={!activeDesignFloorId}
                    style={{ padding: '9px 12px', border: '1px solid #ccc', background: 'white' }}
                  >
                    선택층 초기화
                  </button>
                  <button
                    onClick={resetAllDesignEdits}
                    style={{ padding: '9px 12px', border: '1px solid #ccc', background: 'white' }}
                  >
                    전체 초기화
                  </button>
                </section>

                <div
                  style={{
                    marginTop: 18,
                    padding: 12,
                    borderRadius: 8,
                    background: '#f3f4f6',
                    color: '#4b5563',
                    fontSize: 12,
                    lineHeight: 1.55,
                  }}
                >
                  현재 1차 구현은 실시간 미리보기 단계입니다. 3D GLB 재생성은 후속 단계에서
                  아래 연결 지점에 붙일 예정입니다.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
                  <button
                    onClick={() => setDesignOpen(false)}
                    style={{ padding: '11px 18px', border: '1px solid #ccc', background: 'white' }}
                  >
                    닫기
                  </button>
                  <button
                    disabled
                    title="후속 단계에서 백엔드 GLB 재생성과 연결합니다."
                    style={{
                      padding: '11px 18px',
                      border: 0,
                      background: '#9ca3af',
                      color: 'white',
                      cursor: 'not-allowed',
                    }}
                  >
                    모델링에 반영
                  </button>
                </div>
              </>
            ) : (
              <p style={{ marginTop: 20, color: '#777', fontSize: 13 }}>
                분석 후 층별 평면 정보가 생성되면 설계 옵션을 사용할 수 있습니다.
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: 'crimson', marginTop: 12 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 24, marginTop: 30 }}>
        <div
          style={{
            flex: 1,
            height: 700,
            border: '1px solid #ccc',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {modelUrl ? (
            <Viewer
              url={modelUrl}
              parcelSurfaces={parcelSurfaces}
              boundaryLines={boundaryLines}
              floorPlans={previewFloorPlans}
              parcel={parcel}
              regulations={regulations}
              modelSettings={modelSettings}
              modelEditState={modelEditState}
              assistantState={assistantState}
              planView={planView}
              onModelEditStateChange={setModelEditState}
              onAssistantStateChange={setAssistantState}
              onAssistantSubmit={() => submitAssistantAnswers('3d')}
              onPlanViewChange={setPlanView}
              onOpenGridEditor={(floorId) => {
                setSelectedGridFloorId(floorId)
                setGridEditorOpen(true)
              }}
            />
          ) : (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#aaa',
              }}
            >
              3D 뷰어
            </div>
          )}
        </div>

        <RegulationPanel
          parcel={parcel}
          regulations={regulations}
          onApplyOverrides={applyRegulationOverrides}
        />
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
        필지: 지목별 색상 · 도로: 회색 · 빨간선: 분석대상 대지 경계
      </p>
      <GridPlanEditor
        open={gridEditorOpen}
        modelUrl={modelUrl}
        floorPlans={designPreviewFloorPlans}
        parcelSurfaces={parcelSurfaces}
        modelSettings={modelSettings}
        maxBuildingAreaM2={regulations?.computed?.max_building_area_m2}
        gridState={gridState}
        assistantState={assistantState}
        initialFloorId={selectedGridFloorId}
        planView={planView}
        onAssistantStateChange={setAssistantState}
        onAssistantSubmit={() => submitAssistantAnswers('gridPlan')}
        onPlanViewChange={setPlanView}
        onClose={() => setGridEditorOpen(false)}
        onFloorChange={setSelectedGridFloorId}
        onCellsChange={updateGridCells}
        onFloorSettingChange={updateGridFloorSetting}
        onApplyAllFloors={copyGridPlanToAllFloors}
        onApplyUpperFloors={copyGridPlanToUpperFloors}
      />
    </main>
  )
}
