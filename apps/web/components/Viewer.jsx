'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import {
  OrbitControls,
  Environment,
  Line,
  useGLTF
} from '@react-three/drei'
import DesignAssistantPanel, { addAssistantMark } from './DesignAssistantPanel'

const LAND_COLORS = {
  // RGB table from 지목별 색상 reference.
  lc_01: '#fffacd',
  lc_02: '#b4eb96',
  lc_05: '#64b464',
  lc_08: '#ffeba0',
  lc_09: '#ff96ff',
  lc_10: '#a0aaff',
  lc_14: '#bebebe',
  lc_17: '#aad2ff',
  lc_unknown: '#ffffff',
}

const FLOOR_COLORS = [
  '#7db7ff',
  '#8fd4ff',
  '#9ee6d8',
  '#b7e48f',
  '#f7d774',
  '#f6b26b',
  '#d6a4ff',
  '#f4a6c1',
]

const BASEMENT_COLORS = [
  '#9ca3af',
  '#858c96',
  '#717780',
  '#60666e',
  '#525860',
]

const GRID_CELL_COLORS = {
  main: FLOOR_COLORS[0],
  exclude: '#ef4444',
  landscape: '#22c55e',
  corridor: '#3b82f6',
  parking: '#1e3a8a',
  toilet: '#a855f7',
  core: '#374151',
}

const DEFAULT_PLAN_VIEW = {
  scale: 1,
  rotation: 0,
  x: 0,
  y: 0,
}

const DEFAULT_BUILDING_STRUCTURE = '철근콘크리트 라멘조'
const DEFAULT_SITE_SETBACK_M = 0.5
const GRID_SIZE_M = 0.1
const GRID_THIN_MODEL_HEIGHTS = {
  exclude: 0.04,
  landscape: 0.08,
  parking: 0.16,
}
const GRID_MODEL_TYPES = new Set(['main', 'corridor', 'toilet', 'core', 'parking', 'landscape'])
const MODEL_EDIT_SELECTION_COLOR = '#f97316'
const MODEL_EDIT_ADDITION_COLOR = '#d1d5db'
const MODEL_EDIT_ROOF_COLOR = '#cbd5e1'

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
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

function boundsOfPoints(points) {
  const validPoints = (points || []).filter((point) => (
    Array.isArray(point)
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]))
  ))
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

function transformGridPointToSite(point, bounds, rotation) {
  if (!bounds) return point
  const rotationCenter = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  ]
  return rotatePoint2d(point, rotationCenter, rotation)
}

function gridRegionPolygon(region, plan) {
  const minX = region.ix * GRID_SIZE_M
  const minY = region.iy * GRID_SIZE_M
  const maxX = (region.ix + region.width) * GRID_SIZE_M
  const maxY = (region.iy + region.height) * GRID_SIZE_M
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map((point) => transformGridPointToSite(point, plan.gridBounds, toNumber(plan.gridRotation)))
}

function editCellKey(ix, iy) {
  return `${ix}:${iy}`
}

function parseEditCellKey(key) {
  const [ix, iy] = String(key || '').split(':').map(Number)
  return { ix, iy }
}

function editCellPolygon(ix, iy, gridSizeM) {
  const x = ix * gridSizeM
  const y = iy * gridSizeM
  return [
    [x, y],
    [x + gridSizeM, y],
    [x + gridSizeM, y + gridSizeM],
    [x, y + gridSizeM],
  ]
}

function editCellCenter(ix, iy, gridSizeM) {
  return [(ix + 0.5) * gridSizeM, (iy + 0.5) * gridSizeM]
}

function editFrameForPlan(plan) {
  const points = normalizePolygonPoints(plan?.points || [])
  if (points.length < 2) {
    return {
      origin: [0, 0],
      xAxis: [1, 0],
      yAxis: [0, 1],
    }
  }

  let longest = { start: points[0], end: points[1], length: 0 }
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    if (length > longest.length) longest = { start, end, length }
  })

  const length = longest.length || 1
  const xAxis = [
    (longest.end[0] - longest.start[0]) / length,
    (longest.end[1] - longest.start[1]) / length,
  ]
  const yAxis = [-xAxis[1], xAxis[0]]
  return {
    origin: polygonCentroid2d(points),
    xAxis,
    yAxis,
  }
}

function normalizeEditFrame(frame) {
  const origin = Array.isArray(frame?.origin) ? frame.origin.map((value) => toNumber(value)) : [0, 0]
  const xAxis = Array.isArray(frame?.xAxis) ? frame.xAxis.map((value) => toNumber(value)) : [1, 0]
  const yAxis = Array.isArray(frame?.yAxis) ? frame.yAxis.map((value) => toNumber(value)) : [0, 1]
  const xLength = Math.hypot(xAxis[0], xAxis[1]) || 1
  const yLength = Math.hypot(yAxis[0], yAxis[1]) || 1
  return {
    origin,
    xAxis: [xAxis[0] / xLength, xAxis[1] / xLength],
    yAxis: [yAxis[0] / yLength, yAxis[1] / yLength],
  }
}

function worldPointToEditLocal(point, frame) {
  const nextFrame = normalizeEditFrame(frame)
  const dx = point[0] - nextFrame.origin[0]
  const dy = point[1] - nextFrame.origin[1]
  return [
    dx * nextFrame.xAxis[0] + dy * nextFrame.xAxis[1],
    dx * nextFrame.yAxis[0] + dy * nextFrame.yAxis[1],
  ]
}

function editLocalPointToWorld(point, frame) {
  const nextFrame = normalizeEditFrame(frame)
  return [
    nextFrame.origin[0] + point[0] * nextFrame.xAxis[0] + point[1] * nextFrame.yAxis[0],
    nextFrame.origin[1] + point[0] * nextFrame.xAxis[1] + point[1] * nextFrame.yAxis[1],
  ]
}

function editCellWorldPolygon(ix, iy, gridSizeM, frame) {
  return editCellPolygon(ix, iy, gridSizeM).map((point) => editLocalPointToWorld(point, frame))
}

function editCellsForPlan(plan, gridSizeM) {
  const points = normalizePolygonPoints(plan?.points || [])
  const frame = editFrameForPlan(plan)
  const localPoints = points.map((point) => worldPointToEditLocal(point, frame))
  const bounds = boundsOfPoints(localPoints)
  if (!bounds || points.length < 3) return []
  const cells = []
  for (let ix = Math.floor(bounds.minX / gridSizeM); ix <= Math.ceil(bounds.maxX / gridSizeM); ix += 1) {
    for (let iy = Math.floor(bounds.minY / gridSizeM); iy <= Math.ceil(bounds.maxY / gridSizeM); iy += 1) {
      const localCenter = editCellCenter(ix, iy, gridSizeM)
      const center = editLocalPointToWorld(localCenter, frame)
      if (!pointInPolygon(center, points)) continue
      cells.push({
        ix,
        iy,
        key: editCellKey(ix, iy),
        center,
        localCenter,
        polygon: editCellWorldPolygon(ix, iy, gridSizeM, frame),
      })
    }
  }
  return cells
}

function cellsInRect(startKey, endKey) {
  const start = parseEditCellKey(startKey)
  const end = parseEditCellKey(endKey)
  if (!Number.isFinite(start.ix) || !Number.isFinite(start.iy) || !Number.isFinite(end.ix) || !Number.isFinite(end.iy)) {
    return []
  }
  const cells = []
  for (let ix = Math.min(start.ix, end.ix); ix <= Math.max(start.ix, end.ix); ix += 1) {
    for (let iy = Math.min(start.iy, end.iy); iy <= Math.max(start.iy, end.iy); iy += 1) {
      cells.push(editCellKey(ix, iy))
    }
  }
  return cells
}

function editSelectionBounds(cells, gridSizeM, frame) {
  const points = (cells || []).flatMap((key) => {
    const { ix, iy } = parseEditCellKey(key)
    return Number.isFinite(ix) && Number.isFinite(iy) ? editCellWorldPolygon(ix, iy, gridSizeM, frame) : []
  })
  return boundsOfPoints(points)
}

function mergeGridCellsToRegions(cells, plan) {
  const byType = new Map()
  ;(cells || []).forEach((cell) => {
    if (!cell?.type || !Number.isFinite(cell.ix) || !Number.isFinite(cell.iy)) return
    const key = `${cell.ix}:${cell.iy}`
    if (!byType.has(cell.type)) byType.set(cell.type, new Set())
    byType.get(cell.type).add(key)
  })

  const regions = []
  byType.forEach((remaining, type) => {
    const sortedKeys = [...remaining].sort((a, b) => {
      const [ax, ay] = a.split(':').map(Number)
      const [bx, by] = b.split(':').map(Number)
      return ay === by ? ax - bx : ay - by
    })
    sortedKeys.forEach((firstKey) => {
      if (!remaining.has(firstKey)) return
      const [ix, iy] = firstKey.split(':').map(Number)
      let width = 1
      while (remaining.has(`${ix + width}:${iy}`)) width += 1

      let height = 1
      let canExtend = true
      while (canExtend) {
        for (let dx = 0; dx < width; dx += 1) {
          if (!remaining.has(`${ix + dx}:${iy + height}`)) {
            canExtend = false
            break
          }
        }
        if (canExtend) height += 1
      }

      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          remaining.delete(`${ix + dx}:${iy + dy}`)
        }
      }

      const region = { type, ix, iy, width, height }
      regions.push({ ...region, points: gridRegionPolygon(region, plan) })
    })
  })
  return regions
}

function connectedGridLabelRegions(cells, plan) {
  const byType = new Map()
  ;(cells || []).forEach((cell) => {
    if (!cell?.type || !Number.isFinite(cell.ix) || !Number.isFinite(cell.iy)) return
    const key = `${cell.ix}:${cell.iy}`
    if (!byType.has(cell.type)) byType.set(cell.type, new Set())
    byType.get(cell.type).add(key)
  })

  const labels = []
  byType.forEach((remaining, type) => {
    while (remaining.size) {
      const [startKey] = remaining
      const queue = [startKey]
      const component = []
      remaining.delete(startKey)

      for (let index = 0; index < queue.length; index += 1) {
        const key = queue[index]
        const [ix, iy] = key.split(':').map(Number)
        component.push({ ix, iy })
        ;[
          `${ix + 1}:${iy}`,
          `${ix - 1}:${iy}`,
          `${ix}:${iy + 1}`,
          `${ix}:${iy - 1}`,
        ].forEach((neighborKey) => {
          if (!remaining.has(neighborKey)) return
          remaining.delete(neighborKey)
          queue.push(neighborKey)
        })
      }

      const xs = component.map((cell) => cell.ix)
      const ys = component.map((cell) => cell.iy)
      const center = component.reduce(
        (sum, cell) => [
          sum[0] + (cell.ix + 0.5) * GRID_SIZE_M,
          sum[1] + (cell.iy + 0.5) * GRID_SIZE_M,
        ],
        [0, 0],
      ).map((value) => value / component.length)

      labels.push({
        type,
        point: transformGridPointToSite(center, plan.gridBounds, toNumber(plan.gridRotation)),
        cellCount: component.length,
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      })
    }
  })
  return labels
}

function insetPolygonPoints(points, distanceM) {
  if (!points?.length || distanceM <= 0) return points || []
  const [cx, cy] = polygonCentroid2d(points)
  return points.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const length = Math.hypot(dx, dy)
    if (length <= distanceM || length === 0) {
      return [cx, cy]
    }
    const scale = (length - distanceM) / length
    return [
      Number((cx + dx * scale).toFixed(3)),
      Number((cy + dy * scale).toFixed(3)),
    ]
  })
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

function createSiteSetbackPolygon(sitePoints, parcelSurfaces, modelSettings) {
  const polygonPoints = normalizePolygonPoints(sitePoints)
  if (polygonPoints.length < 3) return []
  const adjacentDistance = Math.max(0, toNumber(modelSettings?.siteSetbackAdjacentM, DEFAULT_SITE_SETBACK_M))
  const buildingLineDistance = Math.max(0, toNumber(modelSettings?.siteSetbackBuildingLineM, DEFAULT_SITE_SETBACK_M))
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

function siteSetbackDistance(modelSettings) {
  return Math.max(
    toNumber(modelSettings?.siteSetbackAdjacentM, DEFAULT_SITE_SETBACK_M),
    toNumber(modelSettings?.siteSetbackBuildingLineM, DEFAULT_SITE_SETBACK_M),
  )
}

function analysisSitePoints(parcelSurfaces) {
  const analysis = (parcelSurfaces || []).find((parcel) => parcel.role === 'analysis')
  const points = analysis?.parts?.[0] || []
  return points.map(([x, y]) => [x, y])
}

function adjustedFloorPlansForSetback(floorPlans, parcelSurfaces, modelSettings) {
  const sitePoints = analysisSitePoints(parcelSurfaces)
  const setbackPoints = createSiteSetbackPolygon(sitePoints, parcelSurfaces, modelSettings)
  const setbackDistance = siteSetbackDistance(modelSettings)
  if (!floorPlans?.length || !sitePoints.length || !setbackPoints.length || setbackDistance <= 0) {
    return floorPlans || []
  }

  return floorPlans.map((plan) => {
    if (plan.gridCells?.length) return plan
    const points = plan.points || []
    const violatesSetback = points.some((point) => !pointInPolygon(point, setbackPoints))
    if (!violatesSetback) return plan

    const adjustedPoints = insetPolygonPoints(points, setbackDistance)
    return {
      ...plan,
      points: adjustedPoints,
      areaM2: Number(polygonArea2d(adjustedPoints).toFixed(1)),
      setbackAdjusted: true,
    }
  })
}

function formatArea(value) {
  return `${toNumber(value).toFixed(2)}m2`
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(2)}%`
}

function autoLandscapeRequirement(siteArea, grossFloorArea) {
  if (siteArea < 200) {
    return { required: false, area: 0, label: '해당없음' }
  }

  let ratio = 0.05
  if (grossFloorArea >= 2000) {
    ratio = 0.15
  } else if (grossFloorArea >= 1000) {
    ratio = 0.1
  }

  return {
    required: true,
    area: siteArea * ratio,
    label: `${(ratio * 100).toFixed(0)}% 기준`,
  }
}

function parkingRuleForUse(use) {
  const text = String(use || '').toLowerCase()
  if (text.includes('주차')) return { label: '주차장', divisor: null }
  if (text.includes('주거') || text.includes('공동주택') || text.includes('주택')) {
    return { label: '주거', divisor: 85 }
  }
  if (text.includes('판매') || text.includes('소매') || text.includes('상가') || text.includes('근린')) {
    return { label: '근린생활/판매', divisor: 134 }
  }
  if (text.includes('업무') || text.includes('사무')) {
    return { label: '업무', divisor: 150 }
  }
  return { label: use || '기타', divisor: 200 }
}

function estimateParking(floorPlans) {
  const rows = (floorPlans || []).map((plan) => {
    const area = toNumber(plan.areaM2)
    const rule = parkingRuleForUse(plan.use)
    const count = rule.divisor ? Math.ceil(area / rule.divisor) : 0
    return {
      label: `${plan.label} ${rule.label}: ${formatArea(area)} / ${rule.divisor || '-'} = ${count}대`,
      count,
    }
  })

  return {
    count: rows.reduce((sum, row) => sum + row.count, 0),
    rows,
  }
}

function createModelSummary(parcel, regulations, floorPlans, modelSettings) {
  const plans = floorPlans || []
  const abovePlans = plans.filter((plan) => plan.type === 'above')
  const basementPlans = plans.filter((plan) => plan.type === 'basement')
  const siteArea = toNumber(regulations?.computed?.site_area_m2 || parcel?.area_m2)
  const buildingArea = Math.max(0, ...abovePlans.map((plan) => toNumber(plan.areaM2)))
  const grossFloorArea = plans.reduce((sum, plan) => sum + toNumber(plan.areaM2), 0)
  const farFloorArea = abovePlans.reduce((sum, plan) => sum + toNumber(plan.areaM2), 0)
  const bcr = siteArea > 0 ? (buildingArea / siteArea) * 100 : 0
  const far = siteArea > 0 ? (farFloorArea / siteArea) * 100 : 0
  const maxBuildingArea = toNumber(regulations?.computed?.max_building_area_m2)
  const maxGrossFloorArea = toNumber(regulations?.computed?.max_gross_floor_area_m2)
  const legalBcr = toNumber(regulations?.limits?.bcr_percent)
  const legalFar = toNumber(regulations?.limits?.far_percent)
  const highestHeight = abovePlans.reduce((sum, plan) => sum + toNumber(plan.heightM), 0)
  const parkingCountOverride = modelSettings?.parkingCount
  const estimatedParking = estimateParking(plans)
  const landscapeRequirement = autoLandscapeRequirement(siteArea, grossFloorArea)
  const landscapeLegalOverride = modelSettings?.landscapeLegalArea
  const landscapeLegalArea = landscapeLegalOverride !== '' && landscapeLegalOverride !== undefined
    ? toNumber(landscapeLegalOverride)
    : landscapeRequirement.area
  const landscapeInstalledArea = modelSettings?.landscapeInstalledArea !== '' && modelSettings?.landscapeInstalledArea !== undefined
    ? toNumber(modelSettings.landscapeInstalledArea)
    : 0

  return {
    address: parcel?.address || '-',
    roadAddress: parcel?.road_address || '',
    buildingArea,
    grossFloorArea,
    farFloorArea,
    bcr,
    far,
    legalBcr,
    legalFar,
    maxBuildingArea,
    maxGrossFloorArea,
    basementCount: basementPlans.length,
    aboveCount: abovePlans.length,
    highestHeight,
    structure: String(modelSettings?.buildingStructure || DEFAULT_BUILDING_STRUCTURE).trim(),
    parking: {
      count: parkingCountOverride !== '' && parkingCountOverride !== undefined
        ? toNumber(parkingCountOverride)
        : estimatedParking.count,
    },
    landscape: {
      installedArea: landscapeInstalledArea,
      legalArea: landscapeLegalArea,
      required: landscapeRequirement.required,
      label: landscapeLegalOverride !== '' && landscapeLegalOverride !== undefined
        ? '수동입력'
        : landscapeRequirement.label,
    },
    buildingAreaExceeded: maxBuildingArea > 0 && buildingArea > maxBuildingArea + 0.01,
    grossFloorAreaExceeded: maxGrossFloorArea > 0 && farFloorArea > maxGrossFloorArea + 0.01,
  }
}

function landColor(name) {
  const matchedCode = name.match(/(?:^|_)lc_(?:unknown|\d{2})(?:_|$)/)?.[0]
  const code = matchedCode
    ? matchedCode.replace(/^_/, '').replace(/_$/, '')
    : undefined
  return LAND_COLORS[code] || LAND_COLORS.lc_unknown
}

function isRoadLand(name) {
  return name.includes('road_parcel') || /(?:^|_)lc_14(?:_|$)/.test(name)
}

function indexedColor(name, prefix, colors) {
  const match = name.match(new RegExp(`${prefix}_(\\d+)`))
  const index = match ? Number(match[1]) - 1 : 0
  return colors[Math.max(index, 0) % colors.length]
}

function paintMaterial(material, color, options = {}) {
  material.color.set(color)
  material.vertexColors = false
  material.transparent = options.transparent || false
  material.opacity = options.opacity ?? 1
  material.roughness = 0.85
  material.metalness = 0
  material.needsUpdate = true
}

function Model({ url, hideGeneratedAboveFloors, hideGeneratedBasementFloors }) {
  const gltf = useGLTF(url)

  gltf.scene.traverse((child) => {
    if (!child.isMesh) return
    const name = `${child.name || ''} ${child.parent?.name || ''}`
    child.visible = true
    child.material = child.material.clone()
    const material = child.material

    if (name.includes('parcel_boundary_lc_14')) {
      child.visible = false
    } else if (name.includes('buildable_floor')) {
      if (hideGeneratedAboveFloors) {
        child.visible = false
        return
      }
      paintMaterial(material, indexedColor(name, 'buildable_floor', FLOOR_COLORS), {
        transparent: true,
        opacity: 0.78,
      })
    } else if (name.includes('basement_floor')) {
      if (hideGeneratedBasementFloors) {
        child.visible = false
        return
      }
      paintMaterial(material, indexedColor(name, 'basement_floor', BASEMENT_COLORS), {
        transparent: true,
        opacity: 0.82,
      })
    } else if (name.includes('buildable_envelope')) {
      paintMaterial(material, '#64b4ff', { transparent: true, opacity: 0.45 })
    } else if (name.includes('site_setback_dashed')) {
      paintMaterial(material, '#ff0000')
    } else if (name.includes('analysis_site_boundary')) {
      paintMaterial(material, '#ff0000')
    } else if (name.includes('north_arrow')) {
      paintMaterial(material, '#00a651')
    } else if (name.includes('visible_radius_boundary')) {
      paintMaterial(material, '#111827')
    } else if (name.includes('parcel_boundary')) {
      paintMaterial(material, '#000000')
    } else if (isRoadLand(name)) {
      paintMaterial(material, LAND_COLORS.lc_14)
    } else if (name.includes('analysis_site')) {
      paintMaterial(material, landColor(name))
    } else if (name.includes('surrounding_parcel')) {
      paintMaterial(material, landColor(name))
    }
  })

  return <primitive object={gltf.scene} />
}

function floorPlanZ(plan) {
  if (plan.type === 'basement') {
    return -Math.max(1, planLevelIndex(plan) + 1) * Math.max(2.7, toNumber(plan.heightM, 3))
  }
  return planLevelIndex(plan) * Math.max(2.7, toNumber(plan.heightM, 4))
}

function EditableFloorMass({ plan }) {
  const points = plan.points || []
  const gridRegions = useMemo(
    () => mergeGridCellsToRegions(plan.gridCells || [], plan),
    [plan],
  )
  const geometry = useMemo(() => {
    if (gridRegions.length || points.length < 3) return null
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    return new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.2, toNumber(plan.heightM, 4)),
      bevelEnabled: false,
    })
  }, [gridRegions.length, points, plan.heightM])

  if (gridRegions.length) {
    const regionsByType = gridRegions.reduce((acc, region) => {
      if (!GRID_MODEL_TYPES.has(region.type)) return acc
      acc[region.type] = [...(acc[region.type] || []), region]
      return acc
    }, {})
    return (
      <group>
        {Object.entries(regionsByType).map(([type, regions]) => (
          <EditableGridRegionMass
            key={`editable-grid-mass-${plan.id}-${type}`}
            plan={plan}
            type={type}
            regions={regions}
          />
        ))}
      </group>
    )
  }

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, floorPlanZ(plan)]} renderOrder={18}>
      <meshStandardMaterial
        color={plan.type === 'basement' ? '#9ca3af' : planFillColor(plan)}
        transparent
        opacity={0.82}
        roughness={0.85}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function EditableGridRegionMass({ plan, type, regions }) {
  const depth = GRID_THIN_MODEL_HEIGHTS[type] || Math.max(0.2, toNumber(plan.heightM, 4))
  const z = floorPlanZ(plan) + (GRID_THIN_MODEL_HEIGHTS[type] ? 0.03 : 0)
  const geometry = useMemo(() => {
    const shapes = regions
      .filter((region) => region.points?.length >= 3)
      .map((region) => {
        const shape = new THREE.Shape()
        region.points.forEach(([x, y], index) => {
          if (index === 0) shape.moveTo(x, y)
          else shape.lineTo(x, y)
        })
        return shape
      })
    if (!shapes.length) return null
    return new THREE.ExtrudeGeometry(shapes, {
      depth,
      bevelEnabled: false,
    })
  }, [depth, regions])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, z]} renderOrder={type === 'landscape' || type === 'parking' ? 19 : 18}>
      <meshStandardMaterial
        color={gridCellFillColor(type, plan)}
        transparent
        opacity={type === 'landscape' ? 0.78 : 0.86}
        roughness={0.85}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function EditableFloorMasses({ floorPlans }) {
  const editablePlans = (floorPlans || []).filter((plan) => (
    plan.gridPreview && ((plan.points || []).length >= 3 || (plan.gridCells || []).length > 0)
  ))
  if (!editablePlans.length) return null
  return (
    <group>
      {editablePlans.map((plan) => (
        <EditableFloorMass key={`editable-mass-${plan.id}`} plan={plan} />
      ))}
    </group>
  )
}

function shapesFromEditCells(cellKeys, gridSizeM, frame) {
  return (cellKeys || [])
    .map((key) => {
      const { ix, iy } = parseEditCellKey(key)
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null
      const shape = new THREE.Shape()
      editCellWorldPolygon(ix, iy, gridSizeM, frame).forEach(([x, y], index) => {
        if (index === 0) shape.moveTo(x, y)
        else shape.lineTo(x, y)
      })
      return shape
    })
    .filter(Boolean)
}

function EditSelectionMesh({ cellKeys, gridSizeM, frame, z }) {
  const geometry = useMemo(() => {
    const shapes = shapesFromEditCells(cellKeys, gridSizeM, frame)
    if (!shapes.length) return null
    return new THREE.ExtrudeGeometry(shapes, {
      depth: 0.035,
      bevelEnabled: false,
    })
  }, [cellKeys, frame, gridSizeM])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, z]} renderOrder={45}>
      <meshBasicMaterial color={MODEL_EDIT_SELECTION_COLOR} transparent opacity={0.42} depthTest={false} />
    </mesh>
  )
}

function ModelEditExtrusions({ additions }) {
  return (
    <group>
      {(additions || []).map((addition) => (
        <ModelEditExtrusion key={addition.id} addition={addition} />
      ))}
    </group>
  )
}

function ModelEditExtrusion({ addition }) {
  const gridSizeM = Math.max(0.1, toNumber(addition.gridSizeM, 0.5))
  const heightM = Math.max(0.1, toNumber(addition.heightM, 1))
  const editFrame = addition.editFrame || addition.frame
  const geometry = useMemo(() => {
    const shapes = shapesFromEditCells(addition.baseCells || [], gridSizeM, editFrame)
    if (!shapes.length) return null
    return new THREE.ExtrudeGeometry(shapes, {
      depth: heightM,
      bevelEnabled: false,
    })
  }, [addition.baseCells, editFrame, gridSizeM, heightM])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, toNumber(addition.zBase)]} renderOrder={24}>
      <meshStandardMaterial
        color={MODEL_EDIT_ADDITION_COLOR}
        transparent
        opacity={0.9}
        roughness={0.86}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function createGableRoofGeometry(roof) {
  const gridSizeM = Math.max(0.1, toNumber(roof.gridSizeM, 0.5))
  const editFrame = roof.editFrame || roof.frame
  const localBounds = boundsOfPoints((roof.baseCells || []).flatMap((key) => {
    const { ix, iy } = parseEditCellKey(key)
    return Number.isFinite(ix) && Number.isFinite(iy) ? editCellPolygon(ix, iy, gridSizeM) : []
  }))
  const bounds = localBounds
  if (!bounds) return null

  const height = Math.max(0.1, toNumber(roof.heightM, 1.5))
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxY - bounds.minY
  const vertices = []
  const faces = []
  const add = (x, y, z) => {
    const [worldX, worldY] = editLocalPointToWorld([x, y], editFrame)
    vertices.push(worldX, worldY, z)
    return vertices.length / 3 - 1
  }

  const v0 = add(bounds.minX, bounds.minY, 0)
  const v1 = add(bounds.maxX, bounds.minY, 0)
  const v2 = add(bounds.maxX, bounds.maxY, 0)
  const v3 = add(bounds.minX, bounds.maxY, 0)

  if (width >= depth) {
    const cy = (bounds.minY + bounds.maxY) / 2
    const r0 = add(bounds.minX, cy, height)
    const r1 = add(bounds.maxX, cy, height)
    faces.push(v0, v1, r1, v0, r1, r0, v3, r0, r1, v3, r1, v2, v0, r0, v3, v1, v2, r1, v0, v3, v2, v0, v2, v1)
  } else {
    const cx = (bounds.minX + bounds.maxX) / 2
    const r0 = add(cx, bounds.minY, height)
    const r1 = add(cx, bounds.maxY, height)
    faces.push(v0, r0, r1, v0, r1, v3, v1, v2, r1, v1, r1, r0, v0, v1, r0, v3, r1, v2, v0, v3, v2, v0, v2, v1)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(faces)
  geometry.computeVertexNormals()
  return geometry
}

function ModelEditRoofs({ roofs }) {
  return (
    <group>
      {(roofs || []).map((roof) => (
        <ModelEditRoof key={roof.id} roof={roof} />
      ))}
    </group>
  )
}

function ModelEditRoof({ roof }) {
  const gridSizeM = Math.max(0.1, toNumber(roof.gridSizeM, 0.5))
  const editFrame = roof.editFrame || roof.frame
  const geometry = useMemo(() => {
    if (roof.roofType === 'gable') return createGableRoofGeometry(roof)
    const shapes = shapesFromEditCells(roof.baseCells || [], gridSizeM, editFrame)
    if (!shapes.length) return null
    return new THREE.ExtrudeGeometry(shapes, {
      depth: Math.min(0.35, Math.max(0.12, toNumber(roof.heightM, 1.5) * 0.15)),
      bevelEnabled: false,
    })
  }, [editFrame, gridSizeM, roof])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} position={[0, 0, toNumber(roof.zBase)]} renderOrder={26}>
      <meshStandardMaterial
        color={MODEL_EDIT_ROOF_COLOR}
        transparent
        opacity={0.94}
        roughness={0.78}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function wallGridLinesForPlan(plan, gridSizeM) {
  const points = normalizePolygonPoints(plan?.points || [])
  if (points.length < 2) return []
  const zMin = floorPlanZ(plan)
  const zMax = zMin + Math.max(0.2, toNumber(plan?.heightM, 4))
  const height = zMax - zMin
  const isCcw = signedPolygonArea2d(points) > 0
  const lines = []

  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy)
    if (length <= 1e-6) return
    const ux = dx / length
    const uy = dy / length
    const outward = isCcw ? [uy, -ux] : [-uy, ux]
    const offset = 0.035
    const wallStart = [start[0] + outward[0] * offset, start[1] + outward[1] * offset]
    const wallEnd = [end[0] + outward[0] * offset, end[1] + outward[1] * offset]

    for (let distance = 0; distance <= length + 1e-6; distance += gridSizeM) {
      const t = Math.min(distance / length, 1)
      const x = wallStart[0] + (wallEnd[0] - wallStart[0]) * t
      const y = wallStart[1] + (wallEnd[1] - wallStart[1]) * t
      lines.push({
        key: `wall-v-${index}-${distance.toFixed(3)}`,
        points: [[x, y, zMin], [x, y, zMax]],
      })
    }

    for (let z = zMin; z <= zMax + 1e-6; z += gridSizeM) {
      const nextZ = Math.min(z, zMax)
      lines.push({
        key: `wall-h-${index}-${z.toFixed(3)}`,
        points: [[wallStart[0], wallStart[1], nextZ], [wallEnd[0], wallEnd[1], nextZ]],
      })
    }

    if (height % gridSizeM > 1e-6) {
      lines.push({
        key: `wall-h-${index}-top`,
        points: [[wallStart[0], wallStart[1], zMax], [wallEnd[0], wallEnd[1], zMax]],
      })
    }
  })

  return lines
}

function ModelEditWallGridOverlay({ plan, gridSizeM }) {
  const lines = useMemo(() => wallGridLinesForPlan(plan, gridSizeM), [gridSizeM, plan])
  if (!lines.length) return null
  return (
    <group>
      {lines.map((line) => (
        <Line
          key={line.key}
          points={line.points}
          color="#f59e0b"
          lineWidth={0.5}
          transparent
          opacity={0.32}
          depthTest={false}
          renderOrder={43}
        />
      ))}
    </group>
  )
}

function ModelEditGridOverlay({ plan, modelEditState, onModelEditStateChange }) {
  const gridSizeM = Math.max(0.1, toNumber(modelEditState?.gridSizeM, 0.5))
  const selectedCells = modelEditState?.selectedCells || []
  const selectedSet = useMemo(() => new Set(selectedCells), [selectedCells])
  const cells = useMemo(() => editCellsForPlan(plan, gridSizeM), [gridSizeM, plan])
  const cellSet = useMemo(() => new Set(cells.map((cell) => cell.key)), [cells])
  const frame = useMemo(() => editFrameForPlan(plan), [plan])
  const planShapeGeometry = useMemo(() => {
    const points = normalizePolygonPoints(plan?.points || [])
    if (points.length < 3) return null
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    return new THREE.ShapeGeometry(shape)
  }, [plan])
  const zTop = floorPlanZ(plan) + Math.max(0.2, toNumber(plan?.heightM, 4)) + 0.08
  const [dragStart, setDragStart] = useState(null)

  useEffect(() => () => planShapeGeometry?.dispose(), [planShapeGeometry])

  const updateEditState = (patcher) => {
    onModelEditStateChange?.((current) => {
      const currentState = current || {}
      return typeof patcher === 'function' ? patcher(currentState) : { ...currentState, ...patcher }
    })
  }
  const cellKeyFromPoint = (point) => {
    const [localX, localY] = worldPointToEditLocal([point.x, point.y], frame)
    return editCellKey(Math.floor(localX / gridSizeM), Math.floor(localY / gridSizeM))
  }
  const applyRectSelection = (startKey, endKey) => {
    const nextCells = cellsInRect(startKey, endKey).filter((key) => cellSet.has(key))
    updateEditState({ selectedCells: nextCells })
  }

  if (!plan || !planShapeGeometry || !cells.length) return null

  return (
    <group>
      <ModelEditWallGridOverlay plan={plan} gridSizeM={gridSizeM} />
      {cells.map(({ key, polygon }) => {
        const points = [...polygon, polygon[0]].map(([x, y]) => [x, y, zTop])
        return (
          <Line
            key={`model-edit-grid-${key}`}
            points={points}
            color={selectedSet.has(key) ? MODEL_EDIT_SELECTION_COLOR : '#f59e0b'}
            lineWidth={selectedSet.has(key) ? 1.1 : 0.45}
            transparent
            opacity={selectedSet.has(key) ? 0.95 : 0.36}
            depthTest={false}
            renderOrder={44}
          />
        )
      })}
      <EditSelectionMesh cellKeys={selectedCells} gridSizeM={gridSizeM} frame={frame} z={zTop + 0.015} />
      {(modelEditState?.lassoPoints || []).length > 0 && (
        <Line
          points={(modelEditState.lassoPoints || []).map(([x, y]) => [x, y, zTop + 0.08])}
          color={MODEL_EDIT_SELECTION_COLOR}
          lineWidth={1.6}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={47}
        />
      )}
      <mesh
        geometry={planShapeGeometry}
        position={[0, 0, zTop + 0.02]}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          const key = cellKeyFromPoint(event.point)
          if (!cellSet.has(key)) return
          if (modelEditState?.tool === 'lasso') {
            updateEditState((current) => ({
              ...current,
              lassoPoints: [...(current.lassoPoints || []), [event.point.x, event.point.y]],
            }))
            return
          }
          setDragStart(key)
          applyRectSelection(key, key)
        }}
        onPointerMove={(event) => {
          if (!dragStart || modelEditState?.tool === 'lasso') return
          event.stopPropagation()
          const key = cellKeyFromPoint(event.point)
          if (!cellSet.has(key)) return
          applyRectSelection(dragStart, key)
        }}
        onPointerUp={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          setDragStart(null)
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

function Assistant3DMarkLayer({ plan, assistantState, onAssistantStateChange }) {
  const answering = Boolean(assistantState?.activeQuestionId)
  const [draftPoints, setDraftPoints] = useState([])
  const points = normalizePolygonPoints(plan?.points || [])
  const zTop = plan ? floorPlanZ(plan) + Math.max(0.2, toNumber(plan?.heightM, 4)) + 0.18 : 0
  const markGeometry = useMemo(() => {
    if (points.length < 3) return null
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    return new THREE.ShapeGeometry(shape)
  }, [points])

  useEffect(() => () => markGeometry?.dispose(), [markGeometry])

  const marks = (assistantState?.questions || [])
    .flatMap((question) => (question.marks || []).map((mark) => ({ ...mark, questionId: question.id })))
    .filter((mark) => mark.view === '3d' && (!plan?.id || mark.floorId === plan.id))
  const commitDraft = () => {
    if (draftPoints.length < 2 || !assistantState?.activeQuestionId) {
      setDraftPoints([])
      return
    }
    onAssistantStateChange?.((current) => addAssistantMark(current, {
      view: '3d',
      floorId: plan?.id || '',
      type: 'pen',
      points: draftPoints,
      note: '3D 모델링 영역 표시',
    }))
    setDraftPoints([])
  }

  if (!plan || !markGeometry) return null

  return (
    <group>
      {marks.map((mark) => (
        <Line
          key={mark.id}
          points={(mark.points || []).map(([x, y, z]) => [x, y, z ?? zTop])}
          color={mark.questionId === assistantState?.activeQuestionId ? '#f97316' : '#2563eb'}
          lineWidth={2.4}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={55}
        />
      ))}
      {draftPoints.length > 1 && (
        <Line
          points={draftPoints}
          color="#f97316"
          lineWidth={2.6}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={56}
        />
      )}
      {answering && (
        <mesh
          geometry={markGeometry}
          position={[0, 0, zTop + 0.01]}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            setDraftPoints([[event.point.x, event.point.y, zTop + 0.08]])
          }}
          onPointerMove={(event) => {
            if (!draftPoints.length) return
            event.stopPropagation()
            const nextPoint = [event.point.x, event.point.y, zTop + 0.08]
            const previous = draftPoints[draftPoints.length - 1]
            if (Math.hypot(nextPoint[0] - previous[0], nextPoint[1] - previous[1]) < 0.08) return
            setDraftPoints((current) => [...current, nextPoint])
          }}
          onPointerUp={(event) => {
            event.stopPropagation()
            commitDraft()
          }}
          onPointerLeave={commitDraft}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function BoundaryLines({ lines }) {
  if (!lines) return null

  return (
    <group renderOrder={20}>
      {(lines.parcels || []).map((points, index) => (
        <Line
          key={`parcel-line-${index}`}
          points={points}
          color="#111111"
          lineWidth={0.75}
          depthTest
          transparent={false}
          renderOrder={20}
        />
      ))}
      {(lines.analysis || []).map((points, index) => (
        <Line
          key={`analysis-line-${index}`}
          points={points}
          color="#ff0000"
          lineWidth={2}
          depthTest={false}
          transparent={false}
          renderOrder={30}
        />
      ))}
    </group>
  )
}

function parcelFillColor(parcel) {
  return parcel.isRoad ? LAND_COLORS.lc_14 : LAND_COLORS[parcel.landCode] || LAND_COLORS.lc_unknown
}

function ParcelSurfacePart({ points, color, renderOrder }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      if (index === 0) {
        shape.moveTo(x, y)
      } else {
        shape.lineTo(x, y)
      }
    })
    return new THREE.ShapeGeometry(shape)
  }, [points])

  const z = points[0]?.[2] ?? 0

  return (
    <mesh geometry={geometry} position={[0, 0, z]} renderOrder={renderOrder}>
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        roughness={0.85}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  )
}

function ParcelSurfaces({ parcels }) {
  if (!parcels?.length) return null

  return (
    <group renderOrder={5}>
      {parcels.flatMap((parcel, parcelIndex) => (
        (parcel.parts || []).map((points, partIndex) => (
          <ParcelSurfacePart
            key={`${parcel.id}-${parcelIndex}-${partIndex}`}
            points={points}
            color={parcelFillColor(parcel)}
            renderOrder={parcel.role === 'analysis' ? 8 : 5}
          />
        ))
      ))}
    </group>
  )
}

function planLevelIndex(plan) {
  const match = String(plan.id || '').match(/_(\d+)$/)
  return match ? Math.max(Number(match[1]) - 1, 0) : 0
}

function planFillColor(plan) {
  const index = planLevelIndex(plan)
  if (plan.type === 'basement') {
    return BASEMENT_COLORS[index % BASEMENT_COLORS.length]
  }
  return FLOOR_COLORS[index % FLOOR_COLORS.length]
}

function createSvgTransform(points) {
  const validPoints = (points || []).filter((point) => Array.isArray(point) && point.length >= 2)
  if (!validPoints.length) {
    return () => '50,50'
  }

  const xs = validPoints.map(([x]) => x)
  const ys = validPoints.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const padding = 8
  const size = 100 - padding * 2
  const scale = size / Math.max(width, height)
  const offsetX = (100 - width * scale) / 2
  const offsetY = (100 - height * scale) / 2

  return ([x, y]) => {
    const sx = offsetX + (x - minX) * scale
    const sy = 100 - (offsetY + (y - minY) * scale)
    return `${sx.toFixed(2)},${sy.toFixed(2)}`
  }
}

function svgPolygonPoints(points, transform) {
  if (!points?.length) return ''

  return points
    .map(transform)
    .join(' ')
}

function gridCellFillColor(type, plan) {
  if (type === 'main') return planFillColor(plan)
  return GRID_CELL_COLORS[type] || planFillColor(plan)
}

function gridCellLabel(type, plan) {
  if (type === 'main') return String(plan.use || '').trim()
  if (type === 'landscape') return ''
  if (type === 'corridor') return '복도'
  if (type === 'parking') return '주차장'
  if (type === 'toilet') return 'W.C'
  if (type === 'core') return 'CORE'
  return ''
}

function gridCellLabelColor(type) {
  return type === 'parking' || type === 'core' ? '#ffffff' : '#111827'
}

function svgPoint(point, transform) {
  return transform(point).split(',').map(Number)
}

function shouldShowParcelsOnPlan(plan) {
  return plan.type === 'above' && planLevelIndex(plan) === 0
}

function svgViewTransform(view, rotationOverride = view.rotation) {
  return [
    `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)})`,
    `rotate(${rotationOverride.toFixed(2)} 50 50)`,
    'translate(50 50)',
    `scale(${view.scale.toFixed(3)})`,
    'translate(-50 -50)',
  ].join(' ')
}

function FloorPlanSvg({
  plan,
  parcelSurfaces,
  modelSettings,
  view,
  editable,
  onViewChange,
}) {
  const showParcels = shouldShowParcelsOnPlan(plan)
  const sitePoints = analysisSitePoints(parcelSurfaces)
  const gridRegions = useMemo(
    () => mergeGridCellsToRegions(plan.gridCells || [], plan),
    [plan],
  )
  const gridLabelRegions = useMemo(
    () => connectedGridLabelRegions(plan.gridCells || [], plan),
    [plan],
  )
  const gridRenderPoints = [
    ...gridRegions.flatMap((region) => region.points || []),
    ...(plan.gridBoundarySegments || []).flatMap((segment) => [segment.start, segment.end]),
  ]
  const transform = createSvgTransform(
    sitePoints.length
      ? [...sitePoints, ...(plan.points || []), ...gridRenderPoints]
      : plan.points || [],
  )
  const setbackPoints = createSiteSetbackPolygon(sitePoints, parcelSurfaces, modelSettings)
  const [drag, setDrag] = useState(null)
  const gridLayerRotation = plan.gridCells?.length
    ? toNumber(plan.gridRotation, view.rotation)
    : view.rotation

  const updateView = (nextView) => {
    if (editable && onViewChange) {
      onViewChange(nextView)
    }
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      onWheel={(event) => {
        if (!editable || (!event.shiftKey && !event.altKey)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.altKey) {
          const direction = event.deltaY > 0 ? -1 : 1
          updateView({
            ...view,
            scale: Math.min(3, Math.max(0.35, view.scale + direction * 0.08)),
          })
          return
        }

        const direction = event.deltaY > 0 ? -1 : 1
        updateView({
          ...view,
          rotation: view.rotation + direction * 0.5,
        })
      }}
      onMouseDown={(event) => {
        if (!editable) return
        setDrag({
          startX: event.clientX,
          startY: event.clientY,
          baseX: view.x,
          baseY: view.y,
        })
      }}
      onMouseMove={(event) => {
        if (!editable) return

        if (drag) {
          updateView({
            ...view,
            x: drag.baseX + (event.clientX - drag.startX) * 0.12,
            y: drag.baseY + (event.clientY - drag.startY) * 0.12,
          })
          return
        }
      }}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => {
        setDrag(null)
      }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        cursor: editable ? (drag ? 'grabbing' : 'grab') : 'default',
        touchAction: 'none',
      }}
    >
      <g transform={svgViewTransform(view)}>
        {showParcels && (parcelSurfaces || []).flatMap((parcel, parcelIndex) => (
          (parcel.parts || []).map((points, partIndex) => (
            <polygon
              key={`plan-parcel-${parcelIndex}-${partIndex}`}
              points={svgPolygonPoints(points, transform)}
              fill={parcelFillColor(parcel)}
              fillOpacity="0.78"
              stroke={parcel.role === 'analysis' ? '#ff0000' : '#111111'}
              strokeWidth={parcel.role === 'analysis' ? '1.6' : '0.8'}
              vectorEffect="non-scaling-stroke"
            />
          ))
        ))}
        {!showParcels && sitePoints.length > 0 && (
          <polygon
            points={svgPolygonPoints(sitePoints, transform)}
            fill="none"
            stroke="#9ca3af"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {setbackPoints.length > 0 && (
          <polygon
            points={svgPolygonPoints(setbackPoints, transform)}
            fill="none"
            stroke="#ff0000"
            strokeWidth="0.9"
            strokeDasharray="2 1.6"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {!plan.gridCells?.length && !plan.gridReplacesDefault && (
          <polygon
            points={svgPolygonPoints(plan.points, transform)}
            fill={planFillColor(plan)}
            fillOpacity={plan.type === 'basement' ? 0.76 : 0.86}
            stroke={plan.type === 'basement' ? '#4b5563' : '#1f2937'}
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
      {plan.gridCells?.length && (
        <g transform={svgViewTransform(view, gridLayerRotation)}>
            {gridRegions.map((region, index) => (
              <polygon
                key={`grid-cell-${plan.id}-${region.type}-${index}`}
                points={svgPolygonPoints(region.points, transform)}
                fill={gridCellFillColor(region.type, plan)}
                fillOpacity={region.type === 'exclude' ? 0.78 : 0.86}
                stroke="rgba(17,24,39,0.42)"
                strokeWidth="0.22"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {gridLabelRegions.map((region, index) => {
              const label = gridCellLabel(region.type, plan)
              if (!label) return null
              const [x, y] = svgPoint(region.point, transform)
              const fontSize = Math.min(2.1, Math.max(1, Math.sqrt(region.cellCount) * 0.225))
              return (
                <text
                  key={`grid-cell-label-${plan.id}-${region.type}-${index}`}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={gridCellLabelColor(region.type)}
                  fontSize={fontSize.toFixed(2)}
                  fontWeight={region.type === 'main' ? 800 : 500}
                  paintOrder="stroke"
                  stroke={region.type === 'parking' || region.type === 'core' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.55)'}
                  strokeWidth="0.25"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  transform={`rotate(${-gridLayerRotation.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`}
                >
                  {label}
                </text>
              )
            })}
            {plan.gridBoundarySegments?.length && (
              plan.gridBoundarySegments.map((segment, index) => {
                const [x1, y1] = svgPoint(segment.start, transform)
                const [x2, y2] = svgPoint(segment.end, transform)
                return (
                  <line
                    key={`grid-boundary-${plan.id}-${index}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={plan.type === 'basement' ? '#4b5563' : '#1f2937'}
                    strokeWidth="1.4"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })
            )}
        </g>
      )}
    </svg>
  )
}

const MemoizedFloorPlanSvg = memo(FloorPlanSvg)

function MouseIcon({ variant }) {
  return (
    <span className={`mouse-icon ${variant || ''}`} aria-hidden="true">
      <span className="mouse-body">
        <span className="mouse-wheel" />
      </span>
    </span>
  )
}

function OverviewRow({ label, children, compact, spaced }) {
  return (
    <div className="model-overview-row">
      <span className={`model-overview-label ${compact ? 'compact' : ''} ${spaced ? 'spaced' : ''}`}>
        <span className="model-overview-label-text">
          {Array.from(label).map((char, index) => (
            <span key={`${label}-${index}`}>{char}</span>
          ))}
        </span>
        <span className="model-overview-label-colon">:</span>
      </span>
      <span className="model-overview-value">{children}</span>
    </div>
  )
}

function BuildingOverview({ summary }) {
  const scaleLabel = summary.basementCount > 0
    ? `지하 ${summary.basementCount}층 / 지상 ${summary.aboveCount}층`
    : `지상 ${summary.aboveCount}층`

  return (
    <div className="model-overview">
      <strong className="model-overview-title">건축개요</strong>
      <OverviewRow label="대지위치">
        <span className="model-overview-address-line">{summary.address}</span>
        {summary.roadAddress && (
          <span className="model-overview-address-line">({summary.roadAddress})</span>
        )}
      </OverviewRow>
      <OverviewRow label="건축면적">{formatArea(summary.buildingArea)}</OverviewRow>
      <OverviewRow label="연면적">{formatArea(summary.grossFloorArea)}</OverviewRow>
      <OverviewRow label="연면적_용">{formatArea(summary.farFloorArea)}</OverviewRow>
      <OverviewRow label="건폐율">{formatPercent(summary.bcr)} (법정 {summary.legalBcr || 0}% 이하)</OverviewRow>
      <OverviewRow label="용적률">{formatPercent(summary.far)} (법정 {summary.legalFar || 0}% 이하)</OverviewRow>
      <OverviewRow label="구조" spaced>{summary.structure || '-'}</OverviewRow>
      <OverviewRow label="규모">{scaleLabel}</OverviewRow>
      <OverviewRow label="주차장">총 {summary.parking.count}대</OverviewRow>
      <OverviewRow label="조경면적">
        설치:{formatArea(summary.landscape.installedArea)} (
        법정:{summary.landscape.required ? `${formatArea(summary.landscape.legalArea)} 이상` : '해당없음'})
      </OverviewRow>
      <OverviewRow label="최고높이">{summary.highestHeight.toFixed(2)}m</OverviewRow>
    </div>
  )
}

function ModelingWarnings({ summary }) {
  return (
    <div className="model-warnings">
      {summary.buildingAreaExceeded && (
        <div className="model-warning">건축면적 초과</div>
      )}
      {summary.grossFloorAreaExceeded && (
        <div className="model-warning">최대 연면적 초과</div>
      )}
    </div>
  )
}

function FloorPlanPanel({
  floorPlans,
  parcelSurfaces,
  modelSettings,
  planView = DEFAULT_PLAN_VIEW,
  onPlanViewChange,
  onOpenGridEditor,
}) {
  const [draftView, setDraftView] = useState(planView)
  const [guideOpen, setGuideOpen] = useState(true)
  const viewUpdateFrameRef = useRef(null)
  const pendingViewRef = useRef(planView || DEFAULT_PLAN_VIEW)
  const activeView = draftView || planView || DEFAULT_PLAN_VIEW
  useEffect(() => {
    setDraftView(planView || DEFAULT_PLAN_VIEW)
    pendingViewRef.current = planView || DEFAULT_PLAN_VIEW
  }, [planView])
  useEffect(() => () => {
    if (viewUpdateFrameRef.current) {
      window.cancelAnimationFrame(viewUpdateFrameRef.current)
    }
  }, [])
  const updateLinkedView = (nextView) => {
    setDraftView(nextView)
    pendingViewRef.current = nextView
    if (viewUpdateFrameRef.current) return
    viewUpdateFrameRef.current = window.requestAnimationFrame(() => {
      viewUpdateFrameRef.current = null
      onPlanViewChange?.(pendingViewRef.current)
    })
  }
  const scrollRef = useRef(null)
  const hasDesignPreview = (floorPlans || []).some((plan) => plan.designPreview)

  const zoomGroundFloorPlan = (deltaY) => {
    const direction = deltaY > 0 ? -1 : 1
    const nextView = {
      ...activeView,
      scale: Math.min(3, Math.max(0.35, activeView.scale + direction * 0.08)),
    }
    updateLinkedView(nextView)
  }

  const handlePlanPanelWheelCapture = (event) => {
    if (event.altKey) {
      const groundPlanCard = event.target?.closest?.('[data-ground-plan="true"]')
      event.preventDefault()
      event.stopPropagation()
      if (groundPlanCard) {
        zoomGroundFloorPlan(event.deltaY)
      }
    }
  }

  return (
    <aside
      style={{
        width: '30%',
        minWidth: 260,
        height: '100%',
        borderLeft: '1px solid #d1d5db',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <strong style={{ fontSize: 13 }}>층별 평면도</strong>
        <div style={{ marginTop: 2, color: '#6b7280', fontSize: 11 }}>
          {hasDesignPreview ? '설계 옵션 미리보기 반영 중' : '스크롤로 지하/지상층 이동'}
        </div>
      </div>
      <div
        ref={scrollRef}
        onWheelCapture={handlePlanPanelWheelCapture}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: 5,
          boxSizing: 'border-box',
          overscrollBehavior: 'contain',
        }}
      >
        {floorPlans?.length ? (
          floorPlans.map((plan) => (
            <div
              key={plan.id}
              data-floor-card="true"
              data-ground-plan={shouldShowParcelsOnPlan(plan) ? 'true' : undefined}
              style={{
                position: 'relative',
                flex: '0 0 calc((100% - 10px) / 3)',
                minHeight: 190,
                boxSizing: 'border-box',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
                background: plan.type === 'basement' ? '#f3f4f6' : '#ffffff',
                transition: 'transform 180ms ease-out',
              }}
            >
              <MemoizedFloorPlanSvg
                plan={plan}
                parcelSurfaces={parcelSurfaces}
                modelSettings={modelSettings}
                view={shouldShowParcelsOnPlan(plan) ? activeView : activeView}
                editable={shouldShowParcelsOnPlan(plan)}
                onViewChange={updateLinkedView}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  zIndex: 2,
                  width: '25%',
                  padding: 10,
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.78)',
                  borderRight: '1px solid rgba(209,213,219,0.9)',
                  fontSize: 12,
                  textAlign: 'left',
                  pointerEvents: 'none',
                }}
              >
                <strong style={{ display: 'block', marginBottom: 8 }}>{plan.label}</strong>
                {plan.designPreview && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginBottom: 6,
                      padding: '2px 5px',
                      borderRadius: 999,
                      background: '#dbeafe',
                      color: '#1d4ed8',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    미리보기
                  </span>
                )}
                <div style={{ color: '#374151', lineHeight: 1.55, fontSize: 11.9 }}>
                  <div>용도: {plan.use || '-'}</div>
                  <div>면적: {Number(plan.areaM2 || 0).toFixed(1)}㎡</div>
                  <div>층고: {Number(plan.heightM || 0).toFixed(1)}m</div>
                  {plan.gridPreview && (
                    <div style={{ color: '#16a34a', fontWeight: 700 }}>
                      그리드: {plan.gridStats?.editedCellCount || 0}칸
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => onOpenGridEditor?.(plan.id)}
                className="plan-expand-trigger"
                title={`${plan.label} 평면을 전체화면 그리드 편집기로 확대`}
              >
                확대
              </button>
              {shouldShowParcelsOnPlan(plan) && (
                <>
                  {guideOpen && (
                    <div className="plan-guide">
                      <div className="plan-guide-title">
                        마우스로 층별 평면 레이아웃을 조정합니다
                      </div>
                      <div className="plan-guide-controls">
                        <span>회전:Shift+휠</span>
                        <span>이동:드래그</span>
                        <span>줌:Alt+휠</span>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => setGuideOpen((value) => !value)}
                    className="plan-guide-trigger"
                    title={guideOpen ? '정보창 숨기기' : '정보창 보이기'}
                  >
                    {guideOpen ? '정보창 숨기기' : '정보창 보이기'}
                  </button>
                </>
              )}
            </div>
          ))
        ) : (
          <div style={{ padding: 14, color: '#6b7280', fontSize: 12 }}>
            분석 후 층별 평면도가 표시됩니다.
          </div>
        )}
      </div>
      <style jsx>{`
        .plan-guide {
          position: absolute;
          left: 50%;
          bottom: 6px;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          width: max-content;
          max-width: calc(75% - 16px);
          padding: 4px 8px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(4px);
          border: 1px solid #d1d5db;
          font-size: 12px;
          line-height: 1.1;
          color: #374151;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
          transform: translateX(-50%);
        }

        .plan-guide-title {
          min-width: 0;
          overflow: hidden;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .plan-guide-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          white-space: nowrap;
        }

        .plan-guide-controls span + span::before {
          content: '   ';
          white-space: pre;
        }

        .plan-guide-trigger {
          position: absolute;
          left: 3px;
          bottom: 3px;
          z-index: 4;
          min-width: 70px;
          height: 20px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(4px);
          color: #111827;
          font-weight: 700;
          font-size: 10px;
          line-height: 18px;
          padding: 0 5px;
          cursor: pointer;
        }

        .plan-expand-trigger {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 4;
          padding: 5px 8px;
          border: 1px solid #111827;
          border-radius: 5px;
          background: rgba(17, 24, 39, 0.88);
          color: #fff;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }

        .mouse-icon {
          position: relative;
          display: inline-flex;
          width: 17px;
          height: 23px;
          align-items: center;
          justify-content: center;
        }

        .mouse-body {
          position: relative;
          width: 13px;
          height: 19px;
          border: 1.6px solid #111827;
          border-radius: 8px;
          background: #fff;
        }

        .mouse-wheel {
          position: absolute;
          top: 3px;
          left: 50%;
          width: 3px;
          height: 5px;
          border-radius: 999px;
          background: #111827;
          transform: translateX(-50%);
        }

        .wheel-blink .mouse-wheel {
          background: #ef4444;
          animation: wheelBlink 0.8s infinite;
        }

        .move-y {
          animation: mouseMoveY 1s ease-in-out infinite;
        }

        @keyframes wheelBlink {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }

        @keyframes mouseMoveY {
          0%, 100% { transform: translateY(-3px); }
          50% { transform: translateY(3px); }
        }
      `}</style>
    </aside>
  )
}

function ModelEditPanel({
  floorPlans,
  modelEditState,
  selectedPlan,
  onModelEditStateChange,
  onCreateExtrusion,
  onCreateRoof,
  onClearSelection,
  onDeleteLast,
}) {
  const editMode = Boolean(modelEditState?.editMode)
  const selectedCount = (modelEditState?.selectedCells || []).length
  const [panelPosition, setPanelPosition] = useState(null)
  const panelDragRef = useRef(null)
  const update = (patch) => {
    onModelEditStateChange?.((current) => ({
      ...(current || {}),
      ...patch,
    }))
  }
  const startPanelDrag = (event) => {
    const panel = event.currentTarget.closest('.model-edit-panel')
    const parent = panel?.parentElement
    if (!panel || !parent) return
    const panelRect = panel.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    panelDragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      parentRect,
    }
    setPanelPosition({
      x: panelRect.left - parentRect.left,
      y: panelRect.top - parentRect.top,
    })
    event.preventDefault()
  }

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!panelDragRef.current) return
      const { offsetX, offsetY, parentRect } = panelDragRef.current
      setPanelPosition({
        x: Math.max(8, Math.min(parentRect.width - 80, event.clientX - parentRect.left - offsetX)),
        y: Math.max(8, Math.min(parentRect.height - 44, event.clientY - parentRect.top - offsetY)),
      })
    }
    const handlePointerUp = () => {
      panelDragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  return (
    <div
      className={`model-edit-panel ${editMode ? 'is-open' : ''}`}
      style={panelPosition ? { left: panelPosition.x, top: panelPosition.y, right: 'auto' } : undefined}
    >
      <button
        className={`model-edit-trigger ${editMode ? 'active' : ''}`}
        onClick={() => update({ editMode: !editMode })}
      >
        EDIT
      </button>
      {editMode && (
        <div className="model-edit-body">
          <strong className="model-edit-title" onPointerDown={startPanelDrag}>3D 편집 모드 · 드래그 이동</strong>
          <label>
            편집층
            <select
              value={selectedPlan?.id || ''}
              onChange={(event) => update({
                selectedFloorId: event.target.value,
                selectedCells: [],
                lassoPoints: [],
              })}
            >
              {(floorPlans || []).map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.label}</option>
              ))}
            </select>
          </label>
          <label>
            그리드 간격(m)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={modelEditState?.gridSizeM ?? 0.5}
              onChange={(event) => update({
                gridSizeM: Math.max(0.1, toNumber(event.target.value, 0.5)),
                selectedCells: [],
                lassoPoints: [],
              })}
            />
          </label>
          <div className="model-edit-tool-row">
            <button
              className={modelEditState?.tool !== 'lasso' ? 'active' : ''}
              onClick={() => update({ tool: 'rect', lassoPoints: [] })}
            >
              드래그
            </button>
            <button
              className={modelEditState?.tool === 'lasso' ? 'active' : ''}
              onClick={() => update({ tool: 'lasso', lassoPoints: [] })}
            >
              갈고리(A)
            </button>
          </div>
          <div className="model-edit-status">
            선택 {selectedCount}칸
            {modelEditState?.tool === 'lasso' && ' · Space로 선택 확정'}
          </div>
          <label>
            돌출 높이(m)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={modelEditState?.draftHeightM ?? 1}
              onChange={(event) => update({ draftHeightM: Math.max(0.1, toNumber(event.target.value, 1)) })}
            />
          </label>
          <button className="model-edit-primary" onClick={onCreateExtrusion}>
            돌출 추가(P)
          </button>
          <label>
            지붕 높이(m)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={modelEditState?.roofHeightM ?? 1.5}
              onChange={(event) => update({ roofHeightM: Math.max(0.1, toNumber(event.target.value, 1.5)) })}
            />
          </label>
          <div className="model-edit-tool-row">
            <button onClick={() => onCreateRoof('flat')}>평지붕</button>
            <button onClick={() => onCreateRoof('gable')}>박공지붕</button>
          </div>
          <div className="model-edit-tool-row">
            <button onClick={onClearSelection}>선택 초기화</button>
            <button onClick={onDeleteLast}>최근 편집 삭제</button>
          </div>
          <p>
            원래 매스는 변경하지 않고, 돌출/지붕은 면적 산정 제외 보조 레이어로 저장됩니다.
          </p>
        </div>
      )}
    </div>
  )
}

export default function Viewer({
  url,
  parcelSurfaces,
  boundaryLines,
  floorPlans,
  parcel,
  regulations,
  modelSettings,
  modelEditState,
  assistantState,
  planView,
  onModelEditStateChange,
  onAssistantStateChange,
  onAssistantSubmit,
  onPlanViewChange,
  onOpenGridEditor,
}) {
  const adjustedFloorPlans = useMemo(
    // Design preview edits arrive through floorPlans; setback fitting should run after them.
    () => adjustedFloorPlansForSetback(floorPlans, parcelSurfaces, modelSettings),
    [floorPlans, parcelSurfaces, modelSettings],
  )
  const summary = useMemo(
    () => createModelSummary(parcel, regulations, adjustedFloorPlans, modelSettings),
    [parcel, regulations, adjustedFloorPlans, modelSettings],
  )
  const hasEditableAboveGridMass = adjustedFloorPlans.some((plan) => plan.gridPreview && plan.type !== 'basement')
  const hasEditableBasementGridMass = adjustedFloorPlans.some((plan) => plan.gridPreview && plan.type === 'basement')
  const selectedEditPlan = adjustedFloorPlans.find((plan) => plan.id === modelEditState?.selectedFloorId)
    || adjustedFloorPlans.find((plan) => plan.type === 'above')
    || adjustedFloorPlans[0]
  const editMode = Boolean(modelEditState?.editMode)

  const updateModelEditState = (patcher) => {
    onModelEditStateChange?.((current) => {
      const currentState = current || {}
      return typeof patcher === 'function' ? patcher(currentState) : { ...currentState, ...patcher }
    })
  }
  const createModelEditItem = (type) => {
    if (!selectedEditPlan || !(modelEditState?.selectedCells || []).length) return null
    const createdAt = Date.now()
    return {
      id: `${type}-${createdAt}-${Math.random().toString(16).slice(2)}`,
      createdAt,
      floorId: selectedEditPlan.id,
      gridSizeM: Math.max(0.1, toNumber(modelEditState?.gridSizeM, 0.5)),
      baseCells: [...(modelEditState?.selectedCells || [])],
      editFrame: editFrameForPlan(selectedEditPlan),
      zBase: Number((floorPlanZ(selectedEditPlan) + Math.max(0.2, toNumber(selectedEditPlan.heightM, 4))).toFixed(3)),
    }
  }
  const createExtrusion = () => {
    const item = createModelEditItem('extrusion')
    if (!item) return
    updateModelEditState((current) => ({
      ...current,
      additions: [
        ...(current.additions || []),
        {
          ...item,
          type: 'extrusion',
          heightM: Math.max(0.1, toNumber(current.draftHeightM, 1)),
          color: 'lightGray',
        },
      ],
    }))
  }
  const createRoof = (roofType) => {
    const item = createModelEditItem(`roof-${roofType}`)
    if (!item) return
    updateModelEditState((current) => ({
      ...current,
      roofs: [
        ...(current.roofs || []),
        {
          ...item,
          roofType,
          heightM: Math.max(0.1, toNumber(current.roofHeightM, 1.5)),
        },
      ],
    }))
  }
  const clearEditSelection = () => updateModelEditState({ selectedCells: [], lassoPoints: [] })
  const deleteLastModelEdit = () => {
    updateModelEditState((current) => {
      const additions = [...(current.additions || [])]
      const roofs = [...(current.roofs || [])]
      const lastAddition = additions[additions.length - 1]
      const lastRoof = roofs[roofs.length - 1]
      if (lastRoof && (!lastAddition || toNumber(lastRoof.createdAt) > toNumber(lastAddition.createdAt))) {
        roofs.pop()
      } else if (lastAddition) {
        additions.pop()
      } else if (lastRoof) {
        roofs.pop()
      }
      return { ...current, additions, roofs }
    })
  }

  useEffect(() => {
    if (!editMode || !selectedEditPlan) return
    if (modelEditState?.selectedFloorId) return
    updateModelEditState({ selectedFloorId: selectedEditPlan.id })
  }, [editMode, modelEditState?.selectedFloorId, selectedEditPlan])

  useEffect(() => {
    if (!editMode) return undefined
    const handleKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable) return
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        updateModelEditState((current) => ({
          ...current,
          tool: current.tool === 'lasso' ? 'rect' : 'lasso',
          lassoPoints: [],
        }))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        clearEditSelection()
        return
      }
      if (event.key === ' ') {
        const lassoPoints = modelEditState?.lassoPoints || []
        if (selectedEditPlan && lassoPoints.length >= 3) {
          event.preventDefault()
          const gridSizeM = Math.max(0.1, toNumber(modelEditState?.gridSizeM, 0.5))
          const selectedCells = editCellsForPlan(selectedEditPlan, gridSizeM)
            .filter(({ center }) => pointInPolygon(center, lassoPoints))
            .map((cell) => cell.key)
          updateModelEditState({ selectedCells, lassoPoints: [], tool: 'rect' })
        }
        return
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        createExtrusion()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editMode, modelEditState, selectedEditPlan])

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ width: '70%', height: '100%', position: 'relative' }}>
        <BuildingOverview summary={summary} />
        <ModelingWarnings summary={summary} />
        <DesignAssistantPanel
          assistantState={assistantState}
          onAssistantStateChange={onAssistantStateChange}
          onSubmit={onAssistantSubmit}
          title="AI 설계 어시스턴트"
          viewLabel="3D 모델링 영역"
        />
        <ModelEditPanel
          floorPlans={adjustedFloorPlans}
          modelEditState={modelEditState}
          selectedPlan={selectedEditPlan}
          onModelEditStateChange={onModelEditStateChange}
          onCreateExtrusion={createExtrusion}
          onCreateRoof={createRoof}
          onClearSelection={clearEditSelection}
          onDeleteLast={deleteLastModelEdit}
        />
        <Canvas camera={{ position: [20, -35, 25], up: [0, 0, 1] }}>

          <ambientLight intensity={1} />

          <directionalLight position={[10, 10, 10]} />

          <Environment preset="city" />

          <ParcelSurfaces parcels={parcelSurfaces} />
          <Model
            key={url}
            url={url}
            hideGeneratedAboveFloors={hasEditableAboveGridMass}
            hideGeneratedBasementFloors={hasEditableBasementGridMass}
          />
          <EditableFloorMasses floorPlans={adjustedFloorPlans} />
          <ModelEditExtrusions additions={modelEditState?.additions || []} />
          <ModelEditRoofs roofs={modelEditState?.roofs || []} />
          {editMode && selectedEditPlan && (
            <ModelEditGridOverlay
              plan={selectedEditPlan}
              modelEditState={modelEditState}
              onModelEditStateChange={onModelEditStateChange}
            />
          )}
          <Assistant3DMarkLayer
            plan={selectedEditPlan}
            assistantState={assistantState}
            onAssistantStateChange={onAssistantStateChange}
          />
          <BoundaryLines lines={boundaryLines} />

          <OrbitControls
            enableDamping
            screenSpacePanning={false}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.ROTATE,
              RIGHT: THREE.MOUSE.PAN,
            }}
          />

        </Canvas>
        <style jsx global>{`
          .model-edit-panel {
            position: absolute;
            top: 12px;
            right: 12px;
            z-index: 9;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            color: #111827;
            font-size: 12px;
          }

          .model-edit-trigger {
            min-width: 72px;
            border: 1px solid rgba(249, 115, 22, 0.8);
            border-radius: 999px;
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.92);
            color: #ea580c;
            font-size: 13px;
            font-weight: 900;
            cursor: pointer;
            box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
          }

          .model-edit-trigger.active {
            background: #f97316;
            color: #ffffff;
          }

          .model-edit-body {
            width: 240px;
            padding: 12px;
            border: 1px solid rgba(249, 115, 22, 0.35);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.94);
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18);
            backdrop-filter: blur(5px);
          }

          .model-edit-title {
            display: block;
            margin-bottom: 8px;
            color: #9a3412;
            font-size: 14px;
            cursor: move;
            user-select: none;
          }

          .model-edit-body label {
            display: grid;
            gap: 4px;
            margin-top: 8px;
            color: #374151;
            font-weight: 700;
          }

          .model-edit-body input,
          .model-edit-body select {
            width: 100%;
            box-sizing: border-box;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 7px 8px;
            background: #ffffff;
            color: #111827;
            font-size: 12px;
          }

          .model-edit-tool-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin-top: 8px;
          }

          .model-edit-body button {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 7px 8px;
            background: #ffffff;
            color: #374151;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
          }

          .model-edit-body button.active,
          .model-edit-body button:hover {
            border-color: #f97316;
            color: #ea580c;
          }

          .model-edit-primary {
            width: 100%;
            margin-top: 8px;
            background: #f97316 !important;
            border-color: #f97316 !important;
            color: #ffffff !important;
          }

          .model-edit-status {
            margin-top: 8px;
            padding: 7px 8px;
            border-radius: 8px;
            background: rgba(249, 115, 22, 0.10);
            color: #9a3412;
            font-weight: 800;
          }

          .model-edit-body p {
            margin: 8px 0 0;
            color: #6b7280;
            font-size: 11px;
            line-height: 1.45;
          }

          .model-overview {
            position: absolute;
            top: 12px;
            left: 12px;
            z-index: 5;
            width: 340px;
            max-height: calc(100% - 24px);
            overflow: auto;
            box-sizing: border-box;
            padding: 12px;
            border: 1px solid rgba(209, 213, 219, 0.9);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(4px);
            color: #111827;
            font-size: 12px;
            line-height: 1.5;
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
          }

          .model-overview-title {
            display: block;
            margin-bottom: 6px;
            font-size: 14px;
          }

          .model-overview-row {
            display: grid;
            grid-template-columns: 84px 1fr;
            column-gap: 8px;
            align-items: start;
            margin-top: 2px;
          }

          .model-overview-label {
            display: inline-flex;
            width: 84px;
            justify-content: flex-start;
            align-items: baseline;
            color: #374151;
            white-space: nowrap;
          }

          .model-overview-label-text {
            display: inline-flex;
            width: 48px;
            justify-content: space-between;
            overflow: hidden;
            white-space: nowrap;
          }

          .model-overview-label-colon {
            display: inline-block;
            margin-left: 1em;
            width: 6px;
            text-align: right;
          }

          .model-overview-label.compact {
            font-size: 8px;
            letter-spacing: -0.1em;
          }

          .model-overview-label.spaced .model-overview-label-text {
            letter-spacing: 0;
          }

          .model-overview-value {
            min-width: 0;
            color: #111827;
            overflow-wrap: anywhere;
          }

          .model-overview-subvalue {
            display: block;
            color: #4b5563;
            font-size: 11px;
            line-height: 1.35;
          }

          .model-overview-address-line {
            display: block;
            line-height: 1.35;
          }

          .model-overview-subrows {
            margin: 2px 0 4px 92px;
            color: #4b5563;
            font-size: 11px;
            line-height: 1.45;
          }

          .model-overview-subrows > div {
            white-space: pre-wrap;
          }

          .model-overview input {
            font-size: 12px;
          }

          .model-warnings {
            position: absolute;
            top: 64px;
            right: 12px;
            z-index: 6;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
          }

          .model-warning {
            padding: 8px 12px;
            border: 1px solid #dc2626;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.92);
            color: #dc2626;
            font-size: 14px;
            font-weight: 800;
            animation: modelWarningBlink 0.85s infinite;
            box-shadow: 0 8px 22px rgba(220, 38, 38, 0.18);
          }

          @keyframes modelWarningBlink {
            0%, 100% { opacity: 0.25; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
      <FloorPlanPanel
        floorPlans={adjustedFloorPlans}
        parcelSurfaces={parcelSurfaces}
        modelSettings={modelSettings}
        planView={planView}
        onPlanViewChange={onPlanViewChange}
        onOpenGridEditor={onOpenGridEditor}
      />
    </div>
  )
}