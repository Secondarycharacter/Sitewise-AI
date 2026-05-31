'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import DesignAssistantPanel, { addAssistantMark } from './DesignAssistantPanel'

const GRID_SIZE_M = 0.1
const AREA_EXCLUDED_CELL_TYPES = new Set(['exclude', 'landscape', 'parking'])

const GRID_TOOLS = [
  { id: 'main', label: '기본층색', color: '#7db7ff', description: '전용면적' },
  { id: 'exclude', label: '빨강', color: '#ef4444', description: '제외면적' },
  { id: 'removeExclude', label: '주황', color: '#f97316', description: '제외면적 복원' },
  { id: 'landscape', label: '초록', color: '#22c55e', description: '조경' },
  { id: 'corridor', label: '파랑', color: '#3b82f6', description: '복도' },
  { id: 'parking', label: '남색', color: '#1e3a8a', description: '주차장' },
  { id: 'toilet', label: '보라', color: '#a855f7', description: '화장실' },
  { id: 'core', label: '다크그레이', color: '#374151', description: 'CORE' },
  { id: 'eraser', label: '지우개', color: '#f9fafb', description: '지우개' },
]

const CELL_COLORS = Object.fromEntries(GRID_TOOLS.map((tool) => [tool.id, tool.color]))
const REMOVED_CELL_TYPE = 'void'

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

function boundsOfPoints(pointsList) {
  const points = collectPoints(pointsList)
  if (!points.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }

  const xs = points.map(([x]) => toNumber(x))
  const ys = points.map(([, y]) => toNumber(y))
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function cellsEqual(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const key of keys) {
    if ((a || {})[key] !== (b || {})[key]) return false
  }
  return true
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

function signedPolygonArea2d(points) {
  if (!points?.length) return 0
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

function distancePointToSegment(point, start, end) {
  const [px, py] = point
  const [x1, y1] = start
  const [x2, y2] = end
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function lineIntersection(a1, a2, b1, b2) {
  const x1 = a1[0]
  const y1 = a1[1]
  const x2 = a2[0]
  const y2 = a2[1]
  const x3 = b1[0]
  const y3 = b1[1]
  const x4 = b2[0]
  const y4 = b2[1]
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-9) return null
  return [
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator,
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator,
  ]
}

function normalizePolygonPoints(points) {
  const normalized = []
  ;(points || []).forEach((point) => {
    const next = [toNumber(point?.[0]), toNumber(point?.[1])]
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) return
    const previous = normalized[normalized.length - 1]
    if (previous && Math.hypot(previous[0] - next[0], previous[1] - next[1]) < 1e-6) return
    normalized.push(next)
  })

  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  if (first && last && normalized.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
    normalized.pop()
  }

  return normalized
}

function isRoadEdge(edgeStart, edgeEnd, parcelSurfaces) {
  const midpoint = [
    (edgeStart[0] + edgeEnd[0]) / 2,
    (edgeStart[1] + edgeEnd[1]) / 2,
  ]
  const roadParcels = (parcelSurfaces || []).filter((parcel) => parcel.isRoad || parcel.landCode === 'lc_14')
  return roadParcels.some((parcel) => (parcel.parts || []).some((part) => {
    if (pointInPolygon(midpoint, part)) return true
    for (let index = 0; index < part.length; index += 1) {
      const start = part[index]
      const end = part[(index + 1) % part.length]
      if (distancePointToSegment(midpoint, start, end) <= 0.25) return true
    }
    return false
  }))
}

function analysisSitePoints(parcelSurfaces) {
  const analysis = (parcelSurfaces || []).find((parcel) => parcel.role === 'analysis')
  return (analysis?.parts?.[0] || []).map(([x, y]) => [x, y])
}

function gridKey(ix, iy) {
  return `${ix}:${iy}`
}

function parseGridKey(key) {
  const [ix, iy] = key.split(':').map(Number)
  return { ix, iy }
}

function cellCenter(ix, iy) {
  return [(ix + 0.5) * GRID_SIZE_M, (iy + 0.5) * GRID_SIZE_M]
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
      if (edgeMap.has(key)) edgeMap.delete(key)
      else edgeMap.set(key, [a, b])
    })
  })

  return [...edgeMap.values()].map(([start, end]) => ({
    start: [start[0] * GRID_SIZE_M, start[1] * GRID_SIZE_M],
    end: [end[0] * GRID_SIZE_M, end[1] * GRID_SIZE_M],
  }))
}

function polygonCentroid2d(points) {
  if (!points?.length) return [0, 0]
  const sums = points.reduce(
    (acc, [x, y]) => [acc[0] + toNumber(x), acc[1] + toNumber(y)],
    [0, 0],
  )
  return [sums[0] / points.length, sums[1] / points.length]
}

function createSiteSetbackPolygon(sitePoints, parcelSurfaces, modelSettings) {
  const polygonPoints = normalizePolygonPoints(sitePoints)
  if (polygonPoints.length < 3) return []
  const adjacentDistance = Math.max(0, toNumber(modelSettings?.siteSetbackAdjacentM, 0.5))
  const buildingLineDistance = Math.max(0, toNumber(modelSettings?.siteSetbackBuildingLineM, 0.5))
  const isCcw = signedPolygonArea2d(polygonPoints) > 0
  const offsetLines = polygonPoints.map((start, index) => {
    const end = polygonPoints[(index + 1) % polygonPoints.length]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy) || 1
    const inward = isCcw
      ? [-dy / length, dx / length]
      : [dy / length, -dx / length]
    const distance = isRoadEdge(start, end, parcelSurfaces) ? buildingLineDistance : adjacentDistance
    return {
      start: [start[0] + inward[0] * distance, start[1] + inward[1] * distance],
      end: [end[0] + inward[0] * distance, end[1] + inward[1] * distance],
    }
  })

  return offsetLines.map((line, index) => {
    const previous = offsetLines[(index - 1 + offsetLines.length) % offsetLines.length]
    const intersection = lineIntersection(previous.start, previous.end, line.start, line.end)
    const point = intersection || line.start
    return [Number(point[0].toFixed(3)), Number(point[1].toFixed(3))]
  })
}

function lowerFloorForPlan(floorPlans, selectedPlan) {
  if (!floorPlans?.length || !selectedPlan) return null
  const selectedZMin = Number(selectedPlan.zMin)
  if (Number.isFinite(selectedZMin)) {
    const lowerByElevation = floorPlans
      .filter((plan) => {
        if (plan.id === selectedPlan.id) return false
        const zMax = Number(plan.zMax)
        return Number.isFinite(zMax) && zMax <= selectedZMin + 0.12
      })
      .sort((a, b) => Number(b.zMax) - Number(a.zMax))[0]
    if (lowerByElevation) return lowerByElevation
  }

  const selectedIndex = floorPlans.findIndex((plan) => plan.id === selectedPlan.id)
  return selectedIndex > 0 ? floorPlans[selectedIndex - 1] : null
}

function formatArea(value) {
  return `${toNumber(value).toFixed(2)}㎡`
}

function MiniModel({ url, rotation = 0 }) {
  const gltf = useGLTF(url)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])

  useEffect(() => {
    scene.traverse((child) => {
      if (!child.isMesh) return
      child.material = child.material.clone()
      child.material.side = THREE.DoubleSide
      child.material.transparent = child.material.transparent || false
      child.material.needsUpdate = true
    })
  }, [scene])

  return (
    <group rotation={[0, 0, (-rotation * Math.PI) / 180]}>
      <primitive object={scene} />
    </group>
  )
}

export default function GridPlanEditor({
  open,
  modelUrl,
  floorPlans,
  parcelSurfaces,
  modelSettings,
  maxBuildingAreaM2,
  gridState,
  assistantState,
  initialFloorId,
  planView,
  onAssistantStateChange,
  onAssistantSubmit,
  onPlanViewChange,
  onClose,
  onFloorChange,
  onCellsChange,
  onFloorSettingChange,
  onApplyAllFloors,
  onApplyUpperFloors,
}) {
  const canvasRef = useRef(null)
  const interactionRef = useRef(null)
  const escapeRef = useRef({ count: 0, timer: null })
  const [activeTool, setActiveTool] = useState('main')
  const [interactionMode, setInteractionMode] = useState('paint')
  const [selectedFloorId, setSelectedFloorId] = useState(initialFloorId || '')
  const [rotationLocked, setRotationLocked] = useState(true)
  const [view, setView] = useState({ scale: 1, rotation: 0, x: 0, y: 0 })
  const [selectionRect, setSelectionRect] = useState(null)
  const [boldGrid, setBoldGrid] = useState({ halfMeter: true, oneMeter: true })
  const [isPanning, setIsPanning] = useState(false)
  const [eraserMode, setEraserMode] = useState('rect')
  const [lassoPoints, setLassoPoints] = useState([])
  const [undoSnapshot, setUndoSnapshot] = useState(null)
  const [assistantDraftMark, setAssistantDraftMark] = useState([])

  const selectedPlan = useMemo(() => {
    if (!floorPlans?.length) return null
    return floorPlans.find((plan) => plan.id === selectedFloorId) || floorPlans[0]
  }, [floorPlans, selectedFloorId])
  const lowerFloorPlan = useMemo(
    () => lowerFloorForPlan(floorPlans, selectedPlan),
    [floorPlans, selectedPlan],
  )
  const sitePoints = useMemo(() => analysisSitePoints(parcelSurfaces), [parcelSurfaces])
  const setbackPoints = useMemo(
    () => createSiteSetbackPolygon(sitePoints, parcelSurfaces, modelSettings),
    [modelSettings, parcelSurfaces, sitePoints],
  )
  const floorGrid = gridState?.floors?.[selectedPlan?.id] || {}
  const floorCells = floorGrid.cells || {}
  const replaceDefault = Boolean(floorGrid.replaceDefault)
  const gridRotation = toNumber(planView?.rotation, toNumber(floorGrid.gridRotation))
  const bounds = useMemo(() => {
    const raw = boundsOfPoints([sitePoints, selectedPlan?.points || []])
    const padding = Math.max(raw.maxX - raw.minX, raw.maxY - raw.minY, 1) * 0.08
    return {
      minX: raw.minX - padding,
      maxX: raw.maxX + padding,
      minY: raw.minY - padding,
      maxY: raw.maxY + padding,
    }
  }, [selectedPlan, sitePoints])
  const rotationCenter = useMemo(() => [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  ], [bounds])
  const gridSearchBounds = useMemo(() => {
    if (!selectedPlan || !sitePoints.length) return bounds
    const rotatedReferencePoints = [
      ...sitePoints.map((point) => rotatePoint2d(point, rotationCenter, -view.rotation)),
      ...(selectedPlan.points || []).map((point) => rotatePoint2d(point, rotationCenter, -view.rotation)),
      ...Object.keys(floorCells || {}).flatMap((key) => {
        const { ix, iy } = parseGridKey(key)
        return [
          [ix * GRID_SIZE_M, iy * GRID_SIZE_M],
          [(ix + 1) * GRID_SIZE_M, iy * GRID_SIZE_M],
          [(ix + 1) * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
          [ix * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
        ]
      }),
    ]
    return boundsOfPoints(rotatedReferencePoints) || bounds
  }, [bounds, floorCells, rotationCenter, selectedPlan, sitePoints, view.rotation])
  const gridPointInsideRotatedSite = (point) => {
    const sitePoint = rotatePoint2d(point, rotationCenter, view.rotation)
    return pointInPolygon(sitePoint, sitePoints)
  }
  const gridPointToCurrentSite = (point) => rotatePoint2d(point, rotationCenter, view.rotation)
  const assistantAnswering = Boolean(assistantState?.activeQuestionId)
  const assistantMarks = useMemo(() => (
    (assistantState?.questions || [])
      .flatMap((question) => (question.marks || []).map((mark) => ({ ...mark, questionId: question.id })))
      .filter((mark) => mark.view === 'gridPlan' && (!selectedPlan?.id || mark.floorId === selectedPlan.id))
  ), [assistantState, selectedPlan])
  const commitAssistantMark = (points) => {
    if (!assistantAnswering || points.length < 2) {
      setAssistantDraftMark([])
      return
    }
    onAssistantStateChange?.((current) => addAssistantMark(current, {
      view: 'gridPlan',
      floorId: selectedPlan?.id || '',
      type: 'pen',
      points,
      note: '확대 평면 편집 영역 표시',
    }))
    setAssistantDraftMark([])
  }
  const lowerFloorOutline = useMemo(() => {
    if (!lowerFloorPlan || !sitePoints.length) return { points: [], segments: [] }

    const lowerGrid = gridState?.floors?.[lowerFloorPlan.id] || {}
    const lowerCells = lowerGrid.cells || {}
    if (!Object.keys(lowerCells).length) {
      return lowerGrid.replaceDefault
        ? { points: [], segments: [] }
        : { points: lowerFloorPlan.points || [], segments: [] }
    }

    const siteBounds = boundsOfPoints(sitePoints)
    const lowerPlanBounds = boundsOfPoints(lowerFloorPlan.points || [])
    const combinedBounds = {
      minX: Math.min(siteBounds.minX, lowerPlanBounds?.minX ?? siteBounds.minX),
      maxX: Math.max(siteBounds.maxX, lowerPlanBounds?.maxX ?? siteBounds.maxX),
      minY: Math.min(siteBounds.minY, lowerPlanBounds?.minY ?? siteBounds.minY),
      maxY: Math.max(siteBounds.maxY, lowerPlanBounds?.maxY ?? siteBounds.maxY),
    }
    const lowerGridBounds = lowerGrid.gridBounds || combinedBounds
    const lowerGridRotation = toNumber(lowerGrid.gridRotation)
    const lowerRotationCenter = [
      (lowerGridBounds.minX + lowerGridBounds.maxX) / 2,
      (lowerGridBounds.minY + lowerGridBounds.maxY) / 2,
    ]
    const searchBounds = boundsOfPoints([
      ...sitePoints.map((point) => rotatePoint2d(point, lowerRotationCenter, -lowerGridRotation)),
      ...(lowerFloorPlan.points || []).map((point) => rotatePoint2d(point, lowerRotationCenter, -lowerGridRotation)),
      ...Object.keys(lowerCells).flatMap((key) => {
        const { ix, iy } = parseGridKey(key)
        return gridCellPolygon(ix, iy)
      }),
    ]) || combinedBounds
    const activeCells = []

    for (let ix = Math.floor(searchBounds.minX / GRID_SIZE_M); ix <= Math.ceil(searchBounds.maxX / GRID_SIZE_M); ix += 1) {
      for (let iy = Math.floor(searchBounds.minY / GRID_SIZE_M); iy <= Math.ceil(searchBounds.maxY / GRID_SIZE_M); iy += 1) {
        const center = cellCenter(ix, iy)
        const siteCenter = rotatePoint2d(center, lowerRotationCenter, lowerGridRotation)
        if (!pointInPolygon(siteCenter, sitePoints)) continue

        const overrideType = lowerCells[gridKey(ix, iy)]
        const effectiveType = overrideType === REMOVED_CELL_TYPE
          ? ''
          : overrideType || (!lowerGrid.replaceDefault && pointInPolygon(siteCenter, lowerFloorPlan.points || []) ? 'main' : '')
        if (!effectiveType || AREA_EXCLUDED_CELL_TYPES.has(effectiveType)) continue
        activeCells.push({ ix, iy })
      }
    }

    const segments = gridBoundarySegmentsFromActiveCells(activeCells).map((segment) => ({
      start: rotatePoint2d(segment.start, lowerRotationCenter, lowerGridRotation),
      end: rotatePoint2d(segment.end, lowerRotationCenter, lowerGridRotation),
    }))
    return segments.length
      ? { points: [], segments }
      : { points: lowerGrid.replaceDefault ? [] : lowerFloorPlan.points || [], segments: [] }
  }, [gridState, lowerFloorPlan, sitePoints])
  const areaSummary = useMemo(() => {
    if (!selectedPlan || !sitePoints.length) {
      return { areaM2: 0, maxAreaM2: toNumber(maxBuildingAreaM2), exceeded: false }
    }

    const startX = Math.floor(gridSearchBounds.minX / GRID_SIZE_M)
    const endX = Math.ceil(gridSearchBounds.maxX / GRID_SIZE_M)
    const startY = Math.floor(gridSearchBounds.minY / GRID_SIZE_M)
    const endY = Math.ceil(gridSearchBounds.maxY / GRID_SIZE_M)
    let activeCellCount = 0

    for (let ix = startX; ix <= endX; ix += 1) {
      for (let iy = startY; iy <= endY; iy += 1) {
        const center = cellCenter(ix, iy)
        const siteCenter = gridPointToCurrentSite(center)
        if (!pointInPolygon(siteCenter, sitePoints)) continue
        const overrideType = floorCells[gridKey(ix, iy)]
        if (overrideType === REMOVED_CELL_TYPE) continue
        const isDefaultFloor = pointInPolygon(siteCenter, selectedPlan.points || [])
        const effectiveType = overrideType || (!replaceDefault && isDefaultFloor ? 'main' : '')
        if (!effectiveType || AREA_EXCLUDED_CELL_TYPES.has(effectiveType)) continue
        activeCellCount += 1
      }
    }

    const areaM2 = activeCellCount * GRID_SIZE_M * GRID_SIZE_M
    const maxAreaM2 = toNumber(maxBuildingAreaM2)
    return {
      areaM2,
      maxAreaM2,
      exceeded: maxAreaM2 > 0 && areaM2 > maxAreaM2 + 0.01,
    }
  }, [floorCells, gridPointToCurrentSite, gridSearchBounds, maxBuildingAreaM2, replaceDefault, selectedPlan, sitePoints])

  useEffect(() => {
    if (!open) return
    setSelectedFloorId(initialFloorId || floorPlans?.[0]?.id || '')
  }, [open, initialFloorId, floorPlans])

  useEffect(() => {
    setUndoSnapshot(null)
  }, [open, selectedFloorId])

  useEffect(() => {
    if (!open || !selectedPlan) return
    setView((current) => ({
      ...current,
      rotation: gridRotation,
    }))
  }, [gridRotation, open, selectedPlan])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase()
      const isTypingTarget = tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (isTypingTarget || !undoSnapshot) return
        event.preventDefault()
        event.stopPropagation()
        onCellsChange(undoSnapshot.floorId, { ...undoSnapshot.cells })
        setUndoSnapshot(null)
        return
      }

      if (event.key.toLowerCase() === 'a' && activeTool === 'eraser') {
        event.preventDefault()
        setEraserMode((current) => {
          const next = current === 'lasso' ? 'rect' : 'lasso'
          if (next === 'rect') setLassoPoints([])
          return next
        })
        setInteractionMode('paint')
        return
      }

      if (event.key !== 'Escape') return
      escapeRef.current.count += 1
      if (escapeRef.current.timer) {
        window.clearTimeout(escapeRef.current.timer)
      }
      escapeRef.current.timer = window.setTimeout(() => {
        escapeRef.current.count = 0
        escapeRef.current.timer = null
      }, 750)
      if (escapeRef.current.count >= 2) {
        setInteractionMode('pan')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (escapeRef.current.timer) {
        window.clearTimeout(escapeRef.current.timer)
      }
      escapeRef.current = { count: 0, timer: null }
    }
  }, [activeTool, onCellsChange, open, undoSnapshot])

  const baseWorldToCanvas = (x, y, canvas) => {
    const width = bounds.maxX - bounds.minX || 1
    const height = bounds.maxY - bounds.minY || 1
    const scale = Math.min(canvas.width / width, canvas.height / height)
    const offsetX = (canvas.width - width * scale) / 2
    const offsetY = (canvas.height - height * scale) / 2
    return [
      offsetX + (x - bounds.minX) * scale,
      canvas.height - (offsetY + (y - bounds.minY) * scale),
    ]
  }

  const worldToCanvas = (x, y, canvas) => {
    const [baseX, baseY] = baseWorldToCanvas(x, y, canvas)
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const dx = baseX - centerX
    const dy = baseY - centerY
    const radians = (view.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return [
      centerX + view.x + (dx * cos - dy * sin) * view.scale,
      centerY + view.y + (dx * sin + dy * cos) * view.scale,
    ]
  }

  const gridWorldToCanvas = (x, y, canvas) => {
    const [baseX, baseY] = baseWorldToCanvas(x, y, canvas)
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    return [
      centerX + view.x + (baseX - centerX) * view.scale,
      centerY + view.y + (baseY - centerY) * view.scale,
    ]
  }

  const canvasPointToWorld = (canvasX, canvasY, canvas) => {
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radians = (-view.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const dx = (canvasX - centerX - view.x) / view.scale
    const dy = (canvasY - centerY - view.y) / view.scale
    const baseX = centerX + dx * cos - dy * sin
    const baseY = centerY + dx * sin + dy * cos
    const width = bounds.maxX - bounds.minX || 1
    const height = bounds.maxY - bounds.minY || 1
    const scale = Math.min(canvas.width / width, canvas.height / height)
    const offsetX = (canvas.width - width * scale) / 2
    const offsetY = (canvas.height - height * scale) / 2
    return [
      bounds.minX + (baseX - offsetX) / scale,
      bounds.minY + (canvas.height - baseY - offsetY) / scale,
    ]
  }

  const canvasPointToGridWorld = (canvasX, canvasY, canvas) => {
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const baseX = centerX + (canvasX - centerX - view.x) / view.scale
    const baseY = centerY + (canvasY - centerY - view.y) / view.scale
    const width = bounds.maxX - bounds.minX || 1
    const height = bounds.maxY - bounds.minY || 1
    const scale = Math.min(canvas.width / width, canvas.height / height)
    const offsetX = (canvas.width - width * scale) / 2
    const offsetY = (canvas.height - height * scale) / 2
    return [
      bounds.minX + (baseX - offsetX) / scale,
      bounds.minY + (canvas.height - baseY - offsetY) / scale,
    ]
  }

  const eventToCanvasPoint = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return [
      (clientX - rect.left) * (canvas.width / rect.width),
      (clientY - rect.top) * (canvas.height / rect.height),
    ]
  }

  const canvasToWorld = (clientX, clientY) => {
    const canvas = canvasRef.current
    const point = eventToCanvasPoint(clientX, clientY)
    if (!canvas || !point) return null
    return canvasPointToWorld(point[0], point[1], canvas)
  }

  const canvasToGridWorld = (clientX, clientY) => {
    const canvas = canvasRef.current
    const point = eventToCanvasPoint(clientX, clientY)
    if (!canvas || !point) return null
    return canvasPointToGridWorld(point[0], point[1], canvas)
  }

  const cellCornerToCanvas = (x, y, canvas) => gridWorldToCanvas(x, y, canvas)

  const applyRectPaint = (startGridWorld, endGridWorld) => {
    if (!selectedPlan || !sitePoints.length) return
    if (!startGridWorld || !endGridWorld) return
    const minX = Math.min(startGridWorld[0], endGridWorld[0])
    const maxX = Math.max(startGridWorld[0], endGridWorld[0])
    const minY = Math.min(startGridWorld[1], endGridWorld[1])
    const maxY = Math.max(startGridWorld[1], endGridWorld[1])
    const startIx = Math.floor(minX / GRID_SIZE_M)
    const endIx = Math.floor(maxX / GRID_SIZE_M)
    const startIy = Math.floor(minY / GRID_SIZE_M)
    const endIy = Math.floor(maxY / GRID_SIZE_M)

    const previousCells = { ...(floorCells || {}) }
    const nextCells = { ...previousCells }
    for (let ix = startIx; ix <= endIx; ix += 1) {
      for (let iy = startIy; iy <= endIy; iy += 1) {
        const center = cellCenter(ix, iy)
        const siteWorld = gridPointToCurrentSite(center)
        if (!pointInPolygon(siteWorld, sitePoints)) continue
        const key = gridKey(ix, iy)
        if (activeTool === 'eraser') {
          nextCells[key] = REMOVED_CELL_TYPE
        } else if (activeTool === 'removeExclude') {
          if (nextCells[key] === 'exclude') delete nextCells[key]
        } else {
          nextCells[key] = activeTool
        }
      }
    }
    if (cellsEqual(previousCells, nextCells)) return
    setUndoSnapshot({ floorId: selectedPlan.id, cells: previousCells })
    onCellsChange(selectedPlan.id, nextCells)
  }

  const applyLassoErase = (points) => {
    if (!selectedPlan || !sitePoints.length || points.length < 3) return
    const lassoBounds = boundsOfPoints(points)
    const startIx = Math.floor(lassoBounds.minX / GRID_SIZE_M)
    const endIx = Math.ceil(lassoBounds.maxX / GRID_SIZE_M)
    const startIy = Math.floor(lassoBounds.minY / GRID_SIZE_M)
    const endIy = Math.ceil(lassoBounds.maxY / GRID_SIZE_M)

    const previousCells = { ...(floorCells || {}) }
    const nextCells = { ...previousCells }
    for (let ix = startIx; ix <= endIx; ix += 1) {
      for (let iy = startIy; iy <= endIy; iy += 1) {
        const center = cellCenter(ix, iy)
        if (!pointInPolygon(center, points)) continue
        const siteWorld = gridPointToCurrentSite(center)
        if (!pointInPolygon(siteWorld, sitePoints)) continue
        nextCells[gridKey(ix, iy)] = REMOVED_CELL_TYPE
      }
    }
    if (cellsEqual(previousCells, nextCells)) return
    setUndoSnapshot({ floorId: selectedPlan.id, cells: previousCells })
    onCellsChange(selectedPlan.id, nextCells)
  }

  const closeLasso = (points) => {
    applyLassoErase(points)
    setLassoPoints([])
    setEraserMode('rect')
  }

  const materializeVisibleCellsForApply = () => {
    if (!selectedPlan || !sitePoints.length) return { ...(floorCells || {}) }
    const shouldIncludeDefaultFloor = !replaceDefault
    const startX = Math.floor(gridSearchBounds.minX / GRID_SIZE_M)
    const endX = Math.ceil(gridSearchBounds.maxX / GRID_SIZE_M)
    const startY = Math.floor(gridSearchBounds.minY / GRID_SIZE_M)
    const endY = Math.ceil(gridSearchBounds.maxY / GRID_SIZE_M)
    const nextCells = {}

    Object.entries(floorCells || {}).forEach(([key, type]) => {
      if (!type || type === REMOVED_CELL_TYPE) return
      const { ix, iy } = parseGridKey(key)
      if (!gridPointInsideRotatedSite(cellCenter(ix, iy))) return
      nextCells[key] = type
    })

    for (let ix = startX; ix <= endX; ix += 1) {
      for (let iy = startY; iy <= endY; iy += 1) {
        const key = gridKey(ix, iy)
        const overrideType = floorCells[key]
        if (overrideType === REMOVED_CELL_TYPE) continue
        if (nextCells[key]) continue

        const center = cellCenter(ix, iy)
        const siteCenter = gridPointToCurrentSite(center)
        if (!pointInPolygon(siteCenter, sitePoints)) continue

        if (overrideType) {
          nextCells[key] = overrideType
        } else if (shouldIncludeDefaultFloor && pointInPolygon(siteCenter, selectedPlan.points || [])) {
          nextCells[key] = 'main'
        }
      }
    }

    return nextCells
  }

  useEffect(() => {
    if (!open) return undefined
    const handleDeleteLasso = (event) => {
      const tagName = event.target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (activeTool !== 'eraser' || eraserMode !== 'lasso' || lassoPoints.length < 3) return

      event.preventDefault()
      event.stopPropagation()
      closeLasso(lassoPoints)
    }

    window.addEventListener('keydown', handleDeleteLasso)
    return () => window.removeEventListener('keydown', handleDeleteLasso)
  }, [activeTool, eraserMode, lassoPoints, open])

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas || !selectedPlan) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * window.devicePixelRatio))
      canvas.height = Math.max(1, Math.floor(rect.height * window.devicePixelRatio))
      draw()
    }

    const drawPolygon = (ctx, points, options) => {
      if (!points?.length) return
      ctx.beginPath()
      points.forEach(([x, y], index) => {
        const [sx, sy] = worldToCanvas(x, y, canvas)
        if (index === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      ctx.closePath()
      if (options.fill) {
        ctx.fillStyle = options.fill
        ctx.fill()
      }
      if (options.stroke) {
        ctx.strokeStyle = options.stroke
        ctx.lineWidth = options.lineWidth || 1
        ctx.setLineDash(options.dash || [])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    const drawLineSegments = (ctx, segments, options) => {
      if (!segments?.length) return
      ctx.strokeStyle = options.stroke
      ctx.lineWidth = options.lineWidth || 1
      ctx.setLineDash(options.dash || [])
      segments.forEach((segment) => {
        const [x1, y1] = worldToCanvas(segment.start[0], segment.start[1], canvas)
        const [x2, y2] = worldToCanvas(segment.end[0], segment.end[1], canvas)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      })
      ctx.setLineDash([])
    }

    const drawAssistantMark = (ctx, points, color = '#2563eb') => {
      if (!points?.length) return
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([])
      ctx.beginPath()
      points.forEach(([x, y], index) => {
        const [sx, sy] = gridWorldToCanvas(x, y, canvas)
        if (index === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      ctx.stroke()
      ctx.restore()
    }

    const clipToSite = (ctx) => {
      if (!sitePoints.length) return
      ctx.beginPath()
      sitePoints.forEach(([x, y], index) => {
        const [sx, sy] = worldToCanvas(x, y, canvas)
        if (index === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      ctx.closePath()
      ctx.clip()
    }

    const drawGridLine = (ctx, from, to, meterValue) => {
      const isOneMeter = Math.abs(meterValue - Math.round(meterValue)) < 0.0001
      const isHalfMeter = Math.abs(meterValue * 2 - Math.round(meterValue * 2)) < 0.0001
      if (isOneMeter && boldGrid.oneMeter) {
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.42)'
        ctx.lineWidth = 1.6
      } else if (isHalfMeter && boldGrid.halfMeter) {
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.30)'
        ctx.lineWidth = 1.2
      } else {
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.12)'
        ctx.lineWidth = 1
      }
      ctx.beginPath()
      ctx.moveTo(from[0], from[1])
      ctx.lineTo(to[0], to[1])
      ctx.stroke()
    }

    const drawCellBoundary = (ctx, visibleCells) => {
      const typeByKey = new Map(visibleCells.map((cell) => [gridKey(cell.ix, cell.iy), cell.type]))
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)'
      ctx.lineWidth = 0.8
      visibleCells.forEach(({ ix, iy, type }) => {
        const edges = [
          {
            neighbor: gridKey(ix, iy - 1),
            from: [ix * GRID_SIZE_M, iy * GRID_SIZE_M],
            to: [(ix + 1) * GRID_SIZE_M, iy * GRID_SIZE_M],
          },
          {
            neighbor: gridKey(ix + 1, iy),
            from: [(ix + 1) * GRID_SIZE_M, iy * GRID_SIZE_M],
            to: [(ix + 1) * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
          },
          {
            neighbor: gridKey(ix, iy + 1),
            from: [(ix + 1) * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
            to: [ix * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
          },
          {
            neighbor: gridKey(ix - 1, iy),
            from: [ix * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M],
            to: [ix * GRID_SIZE_M, iy * GRID_SIZE_M],
          },
        ]
        edges.forEach((edge) => {
          if (typeByKey.get(edge.neighbor) === type) return
          const from = cellCornerToCanvas(edge.from[0], edge.from[1], canvas)
          const to = cellCornerToCanvas(edge.to[0], edge.to[1], canvas)
          ctx.beginPath()
          ctx.moveTo(from[0], from[1])
          ctx.lineTo(to[0], to[1])
          ctx.stroke()
        })
      })
    }

    const draw = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      drawPolygon(ctx, sitePoints, { fill: 'rgba(250, 204, 21, 0.10)', stroke: '#ef4444', lineWidth: 2 })
      ctx.save()
      clipToSite(ctx)
      if (!replaceDefault) {
        drawPolygon(ctx, selectedPlan.points || [], {
          fill: 'rgba(125, 183, 255, 0.34)',
          stroke: '#1f2937',
          lineWidth: 2,
        })
      }

      const startX = Math.floor(bounds.minX / GRID_SIZE_M)
      const endX = Math.ceil(bounds.maxX / GRID_SIZE_M)
      const startY = Math.floor(bounds.minY / GRID_SIZE_M)
      const endY = Math.ceil(bounds.maxY / GRID_SIZE_M)
      const visibleCellMap = Object.fromEntries(
        Object.entries(floorCells || {}).filter(([, type]) => type && type !== REMOVED_CELL_TYPE),
      )
      const visibleCells = Object.entries(visibleCellMap).map(([key, type]) => ({
        ...parseGridKey(key),
        type,
      }))

      visibleCells.forEach(({ ix, iy, type }) => {
        const p1 = cellCornerToCanvas(ix * GRID_SIZE_M, iy * GRID_SIZE_M, canvas)
        const p2 = cellCornerToCanvas((ix + 1) * GRID_SIZE_M, iy * GRID_SIZE_M, canvas)
        const p3 = cellCornerToCanvas((ix + 1) * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M, canvas)
        const p4 = cellCornerToCanvas(ix * GRID_SIZE_M, (iy + 1) * GRID_SIZE_M, canvas)
        const xs = [p1[0], p2[0], p3[0], p4[0]]
        const ys = [p1[1], p2[1], p3[1], p4[1]]
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const width = Math.max(...xs) - x
        const height = Math.max(...ys) - y
        ctx.fillStyle = CELL_COLORS[type] || '#7db7ff'
        ctx.beginPath()
        ;[p1, p2, p3, p4].forEach(([px, py], index) => {
          if (index === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
        ctx.fill()
        if (type === 'exclude') {
          ctx.fillStyle = '#ffffff'
          ctx.font = `${Math.max(10, height * 0.8)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('@', x + width / 2, y + height / 2)
        }
      })
      for (let ix = startX; ix <= endX; ix += 1) {
        const [x1, y1] = gridWorldToCanvas(ix * GRID_SIZE_M, bounds.minY, canvas)
        const [x2, y2] = gridWorldToCanvas(ix * GRID_SIZE_M, bounds.maxY, canvas)
        drawGridLine(ctx, [x1, y1], [x2, y2], ix * GRID_SIZE_M)
      }
      for (let iy = startY; iy <= endY; iy += 1) {
        const [x1, y1] = gridWorldToCanvas(bounds.minX, iy * GRID_SIZE_M, canvas)
        const [x2, y2] = gridWorldToCanvas(bounds.maxX, iy * GRID_SIZE_M, canvas)
        drawGridLine(ctx, [x1, y1], [x2, y2], iy * GRID_SIZE_M)
      }
      drawCellBoundary(ctx, visibleCells)

      ctx.restore()

      if (lowerFloorOutline.points.length > 0) {
        drawPolygon(ctx, lowerFloorOutline.points, {
          stroke: 'rgba(249, 115, 22, 0.50)',
          lineWidth: 3,
          dash: [10, 6],
        })
      }
      if (lowerFloorOutline.segments.length > 0) {
        drawLineSegments(ctx, lowerFloorOutline.segments, {
          stroke: 'rgba(249, 115, 22, 0.50)',
          lineWidth: 3,
          dash: [10, 6],
        })
      }

      if (setbackPoints.length > 0) {
        drawPolygon(ctx, setbackPoints, {
          stroke: '#ef4444',
          lineWidth: 1.8,
          dash: [8, 6],
        })
      }

      if (selectionRect) {
        const [sx1, sy1] = gridWorldToCanvas(selectionRect.start[0], selectionRect.start[1], canvas)
        const [sx2, sy2] = gridWorldToCanvas(selectionRect.end[0], selectionRect.end[1], canvas)
        ctx.fillStyle = 'rgba(37, 99, 235, 0.12)'
        ctx.strokeStyle = '#2563eb'
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        ctx.fillRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1))
        ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1))
        ctx.setLineDash([])
      }

      if (lassoPoints.length > 0) {
        ctx.strokeStyle = '#dc2626'
        ctx.fillStyle = 'rgba(220, 38, 38, 0.10)'
        ctx.lineWidth = 1.7
        ctx.setLineDash([7, 5])
        ctx.beginPath()
        lassoPoints.forEach((point, index) => {
          const [sx, sy] = gridWorldToCanvas(point[0], point[1], canvas)
          if (index === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        })
        if (lassoPoints.length > 2) {
          ctx.closePath()
          ctx.fill()
        }
        ctx.stroke()
        ctx.setLineDash([])
        lassoPoints.forEach((point, index) => {
          const [sx, sy] = gridWorldToCanvas(point[0], point[1], canvas)
          ctx.beginPath()
          ctx.arc(sx, sy, index === 0 ? 5 : 3.5, 0, Math.PI * 2)
          ctx.fillStyle = index === 0 ? '#dc2626' : '#ffffff'
          ctx.fill()
          ctx.strokeStyle = '#dc2626'
          ctx.stroke()
        })
      }

      assistantMarks.forEach((mark) => {
        drawAssistantMark(
          ctx,
          mark.points || [],
          mark.questionId === assistantState?.activeQuestionId ? '#f97316' : '#2563eb',
        )
      })
      drawAssistantMark(ctx, assistantDraftMark, '#f97316')

      drawPolygon(ctx, sitePoints, { stroke: '#ef4444', lineWidth: 2 })
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [assistantDraftMark, assistantMarks, assistantState?.activeQuestionId, boldGrid, bounds, floorCells, lassoPoints, lowerFloorOutline, open, replaceDefault, selectedPlan, selectionRect, setbackPoints, sitePoints, view])

  if (!open) return null

  return (
    <div className="grid-editor">
      <canvas
        ref={canvasRef}
        className={`grid-editor-canvas ${interactionMode === 'pan' ? 'pan-mode' : 'paint-mode'} ${isPanning ? 'is-panning' : ''}`}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          event.preventDefault()
          if (event.shiftKey && !rotationLocked) {
            const direction = event.deltaY > 0 ? -1 : 1
            const nextRotation = view.rotation + direction * 0.5
            setView((current) => ({
              ...current,
              rotation: nextRotation,
            }))
            onFloorSettingChange?.(selectedPlan?.id, 'gridRotation', nextRotation)
            onPlanViewChange?.({ ...(planView || {}), rotation: nextRotation })
            return
          }

          const direction = event.deltaY > 0 ? -1 : 1
          setView((current) => ({
            ...current,
            scale: Math.min(4, Math.max(0.35, current.scale + direction * 0.08)),
          }))
        }}
        onPointerDown={(event) => {
          const canvasPoint = eventToCanvasPoint(event.clientX, event.clientY)
          const gridWorldPoint = canvasToGridWorld(event.clientX, event.clientY)
          if (!canvasPoint || !gridWorldPoint) return
          event.currentTarget.setPointerCapture(event.pointerId)

          if (assistantAnswering && event.button === 0) {
            interactionRef.current = {
              type: 'assistantMark',
              points: [gridWorldPoint],
            }
            setAssistantDraftMark([gridWorldPoint])
            return
          }

          if (interactionMode === 'pan' || event.button === 1 || event.button === 2) {
            interactionRef.current = {
              type: 'pan',
              startX: canvasPoint[0],
              startY: canvasPoint[1],
              baseX: view.x,
              baseY: view.y,
            }
            setIsPanning(true)
            return
          }

          if (activeTool === 'eraser' && eraserMode === 'lasso') {
            if (lassoPoints.length >= 3) {
              const firstCanvas = gridWorldToCanvas(lassoPoints[0][0], lassoPoints[0][1], canvasRef.current)
              const distanceToFirst = Math.hypot(canvasPoint[0] - firstCanvas[0], canvasPoint[1] - firstCanvas[1])
              if (distanceToFirst <= 12 || event.detail >= 2) {
                closeLasso(lassoPoints)
                return
              }
            }
            setLassoPoints((current) => [...current, gridWorldPoint])
            return
          }

          interactionRef.current = {
            type: 'paint',
            startWorld: gridWorldPoint,
            endWorld: gridWorldPoint,
          }
          setSelectionRect({ start: gridWorldPoint, end: gridWorldPoint })
        }}
        onPointerMove={(event) => {
          const interaction = interactionRef.current
          if (!interaction) return

          if (interaction.type === 'pan') {
            const canvasPoint = eventToCanvasPoint(event.clientX, event.clientY)
            if (!canvasPoint) return
            setView((current) => ({
              ...current,
              x: interaction.baseX + (canvasPoint[0] - interaction.startX),
              y: interaction.baseY + (canvasPoint[1] - interaction.startY),
            }))
            return
          }

          if (interaction.type === 'assistantMark') {
            const gridWorldPoint = canvasToGridWorld(event.clientX, event.clientY)
            if (!gridWorldPoint) return
            const previous = interaction.points[interaction.points.length - 1]
            if (Math.hypot(gridWorldPoint[0] - previous[0], gridWorldPoint[1] - previous[1]) < 0.08) return
            const nextPoints = [...interaction.points, gridWorldPoint]
            interactionRef.current = {
              ...interaction,
              points: nextPoints,
            }
            setAssistantDraftMark(nextPoints)
            return
          }

          const gridWorldPoint = canvasToGridWorld(event.clientX, event.clientY)
          if (!gridWorldPoint) return
          interactionRef.current = {
            ...interaction,
            endWorld: gridWorldPoint,
          }
          setSelectionRect({ start: interaction.startWorld, end: gridWorldPoint })
        }}
        onPointerUp={(event) => {
          const interaction = interactionRef.current
          if (interaction?.type === 'paint') {
            applyRectPaint(interaction.startWorld, interaction.endWorld)
          } else if (interaction?.type === 'assistantMark') {
            commitAssistantMark(interaction.points || [])
          }
          interactionRef.current = null
          setSelectionRect(null)
          setIsPanning(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerLeave={() => {
          if (interactionRef.current?.type === 'assistantMark') {
            commitAssistantMark(interactionRef.current.points || [])
          }
          interactionRef.current = null
          setSelectionRect(null)
          setIsPanning(false)
        }}
      />

      <div className="grid-mini-model">
        {modelUrl ? (
          <Canvas camera={{ position: [18, -28, 22], up: [0, 0, 1] }}>
            <ambientLight intensity={1} />
            <directionalLight position={[10, 10, 10]} />
            <Environment preset="city" />
            <MiniModel url={modelUrl} rotation={view.rotation} />
            <OrbitControls enableDamping />
          </Canvas>
        ) : (
          <div className="grid-mini-empty">3D</div>
        )}
      </div>

      <DesignAssistantPanel
        assistantState={assistantState}
        onAssistantStateChange={onAssistantStateChange}
        onSubmit={onAssistantSubmit}
        title="AI 평면 어시스턴트"
        viewLabel={`확대 평면 편집 · ${selectedPlan?.label || ''}`}
      />

      <div className="grid-toolbar">
        <div className="grid-toolbar-header">
          <strong>그리드 평면 편집</strong>
          <button onClick={onClose}>닫기</button>
        </div>
        <label className="grid-field">
          편집층
          <select
            value={selectedPlan?.id || ''}
            onChange={(event) => {
              setSelectedFloorId(event.target.value)
              onFloorChange?.(event.target.value)
            }}
          >
            {(floorPlans || []).map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.label}</option>
            ))}
          </select>
        </label>
        <label className="grid-lock">
          <input
            type="checkbox"
            checked={rotationLocked}
            onChange={(event) => setRotationLocked(event.target.checked)}
          />
          도면 회전 잠금
        </label>
        <div className="grid-mode">
          <button
            className={interactionMode === 'paint' ? 'active' : ''}
            onClick={() => setInteractionMode('paint')}
          >
            색칠 모드
          </button>
          <button
            className={interactionMode === 'pan' ? 'active' : ''}
            onClick={() => setInteractionMode('pan')}
          >
            이동 모드
          </button>
        </div>
        <div className="grid-options">
          <label>
            <input
              type="checkbox"
              checked={boldGrid.halfMeter}
              onChange={(event) => setBoldGrid((current) => ({ ...current, halfMeter: event.target.checked }))}
            />
            0.5m 선 진하게
          </label>
          <label>
            <input
              type="checkbox"
              checked={boldGrid.oneMeter}
              onChange={(event) => setBoldGrid((current) => ({ ...current, oneMeter: event.target.checked }))}
            />
            1m 선 진하게
          </label>
        </div>
        <div className="grid-palette">
          {GRID_TOOLS.map((tool) => (
            <button
              key={tool.id}
              className={activeTool === tool.id ? 'active' : ''}
              onClick={() => {
                setActiveTool(tool.id)
                setInteractionMode('paint')
                if (tool.id === 'eraser') {
                  setEraserMode('rect')
                  setLassoPoints([])
                }
              }}
              title={tool.description}
            >
              <span style={{ background: tool.color }} />
              <strong>{tool.label}</strong>
              <em>{tool.description}</em>
            </button>
          ))}
        </div>
        <div className="grid-actions">
          <button
            onClick={() => {
              if (!selectedPlan) return
              onFloorSettingChange?.(selectedPlan.id, 'gridRotation', view.rotation)
              onFloorSettingChange?.(selectedPlan.id, 'gridBounds', bounds)
              onPlanViewChange?.({ ...(planView || {}), rotation: view.rotation })
              onApplyAllFloors(selectedPlan.id, {
                gridRotation: view.rotation,
                gridBounds: bounds,
                sourceCells: materializeVisibleCellsForApply(),
              })
              window.alert('전층에 그리드 계획안을 적용했습니다.')
            }}
          >
            전층 적용
          </button>
          <button
            onClick={() => {
              if (!selectedPlan) return
              onFloorSettingChange?.(selectedPlan.id, 'gridRotation', view.rotation)
              onFloorSettingChange?.(selectedPlan.id, 'gridBounds', bounds)
              onPlanViewChange?.({ ...(planView || {}), rotation: view.rotation })
              onApplyUpperFloors(selectedPlan.id, {
                gridRotation: view.rotation,
                gridBounds: bounds,
                sourceCells: materializeVisibleCellsForApply(),
              })
              window.alert('현재층 이상 상부층에 그리드 계획안을 적용했습니다.')
            }}
          >
            상부층 전층 반영
          </button>
        </div>
        <p className="grid-help">
          색칠 모드에서는 드래그 사각형 영역을 한 번에 칠합니다. 이동 모드는 드래그 이동,
          휠은 확대, Shift+휠은 회전입니다. 회전 잠금 시 회전만 제한됩니다.
          지우개 선택 후 A키를 누르면 다각형 올가미 삭제로 전환됩니다.
        </p>
      </div>

      <div className="grid-area-summary">
        <div>
          <span>실시간 바닥면적</span>
          <strong className={areaSummary.exceeded ? 'exceeded' : ''}>
            {formatArea(areaSummary.areaM2)}
          </strong>
        </div>
        <div>
          <span>최대 건축면적</span>
          <strong>{areaSummary.maxAreaM2 > 0 ? formatArea(areaSummary.maxAreaM2) : '-'}</strong>
        </div>
      </div>

      <style jsx>{`
        .grid-editor {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: #f8fafc;
        }

        .grid-editor-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          touch-action: none;
        }

        .grid-editor-canvas.paint-mode {
          cursor: crosshair;
        }

        .grid-editor-canvas.pan-mode {
          cursor: grab;
        }

        .grid-editor-canvas.pan-mode.is-panning {
          cursor: grabbing;
        }

        .grid-mini-model {
          position: absolute;
          top: 14px;
          left: 14px;
          z-index: 2;
          width: min(240px, 15vw);
          height: min(240px, 15vw);
          min-width: 150px;
          min-height: 150px;
          border: 1px solid rgba(15, 23, 42, 0.25);
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.72);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
        }

        .grid-mini-empty {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          font-weight: 700;
        }

        .grid-toolbar {
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 3;
          width: 230px;
          box-sizing: border-box;
          padding: 14px;
          border: 1px solid rgba(15, 23, 42, 0.16);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
          color: #111827;
        }

        .grid-area-summary {
          position: absolute;
          right: 14px;
          bottom: 14px;
          z-index: 3;
          display: grid;
          gap: 6px;
          min-width: 190px;
          box-sizing: border-box;
          padding: 12px 14px;
          border: 1px solid rgba(15, 23, 42, 0.16);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
          color: #111827;
        }

        .grid-area-summary div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .grid-area-summary span {
          color: #4b5563;
          font-size: 12px;
        }

        .grid-area-summary strong {
          font-size: 14px;
          white-space: nowrap;
        }

        .grid-area-summary strong.exceeded {
          color: #dc2626;
        }

        .grid-toolbar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .grid-toolbar-header button,
        .grid-actions button,
        .grid-palette button {
          cursor: pointer;
        }

        .grid-field {
          display: grid;
          gap: 5px;
          margin-top: 12px;
          font-size: 12px;
          color: #4b5563;
        }

        .grid-field select {
          padding: 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
        }

        .grid-lock {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          font-size: 12px;
          color: #4b5563;
        }

        .grid-mode {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-top: 10px;
        }

        .grid-mode button {
          padding: 7px 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #ffffff;
          color: #374151;
          cursor: pointer;
          font-size: 12px;
        }

        .grid-mode button.active {
          border-color: #111827;
          background: #111827;
          color: #ffffff;
        }

        .grid-options {
          display: grid;
          gap: 5px;
          margin-top: 10px;
          font-size: 12px;
          color: #4b5563;
        }

        .grid-options label {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .grid-palette {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
          margin-top: 12px;
        }

        .grid-palette button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #ffffff;
          font-size: 12px;
          text-align: left;
        }

        .grid-palette strong {
          min-width: 56px;
          font-size: 11px;
        }

        .grid-palette em {
          min-width: 0;
          overflow: hidden;
          color: #4b5563;
          font-size: 11px;
          font-style: normal;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .grid-palette button.active {
          border-color: #111827;
          box-shadow: inset 0 0 0 1px #111827;
        }

        .grid-palette span {
          width: 14px;
          height: 14px;
          border: 1px solid rgba(15, 23, 42, 0.25);
          border-radius: 3px;
          flex: 0 0 auto;
        }

        .grid-actions {
          display: grid;
          gap: 6px;
          margin-top: 12px;
        }

        .grid-actions button {
          padding: 9px 10px;
          border: 1px solid #111827;
          border-radius: 6px;
          background: #111827;
          color: #ffffff;
          font-size: 12px;
        }

        .grid-actions button:active {
          transform: translateY(1px) scale(0.98);
          filter: brightness(0.9);
        }

        .grid-help {
          margin: 12px 0 0;
          color: #64748b;
          font-size: 11px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  )
}
