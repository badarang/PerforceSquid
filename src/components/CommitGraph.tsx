import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { getUserColor, getUserInitials } from '../utils/userIcon'

interface SubmittedChangelist {
  number: number
  description: string
  user: string
  date?: string
  stream?: string  // Which stream this commit belongs to
}

interface StreamInfo {
  stream: string
  name: string
  parent: string
  type: string
}

interface CommitGraphProps {
  depotPath: string | null
  onSelectChangelist: (cl: number) => void
  selectedChangelist: number | null
}

// Graph constants
const GRAPH_WIDTH = 100
const NODE_RADIUS = 5
const ROW_HEIGHT = 56
const LANE_WIDTH = 20
const LANE_OFFSET = 24

// Stream type colors
const STREAM_COLORS: Record<string, string> = {
  mainline: '#22c55e',   // green
  main: '#22c55e',
  development: '#3b82f6', // blue
  dev: '#3b82f6',
  release: '#a855f7',    // purple
  feature: '#eab308',    // yellow
  task: '#f97316',       // orange
  hotfix: '#ef4444',     // red
  virtual: '#06b6d4',    // cyan
  default: '#6b7280',    // gray
}

function getStreamColor(streamType: string, streamName: string): string {
  const type = streamType?.toLowerCase() || ''
  const name = streamName?.toLowerCase() || ''

  if (STREAM_COLORS[type]) return STREAM_COLORS[type]

  // Infer from name
  if (name.includes('main') || name.includes('trunk')) return STREAM_COLORS.mainline
  if (name.includes('dev')) return STREAM_COLORS.development
  if (name.includes('release') || name.includes('rel')) return STREAM_COLORS.release
  if (name.includes('feature') || name.includes('feat')) return STREAM_COLORS.feature
  if (name.includes('hotfix') || name.includes('fix')) return STREAM_COLORS.hotfix

  return STREAM_COLORS.default
}

function formatRelativeDate(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const parts = dateStr.split(' ')
  const datePart = parts[0]
  const [year, month, day] = datePart.split('/')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

function parseDate(dateStr: string | undefined): number {
  if (!dateStr) return 0
  const parts = dateStr.split(' ')
  const datePart = parts[0]
  const timePart = parts[1] || '00:00:00'
  const [year, month, day] = datePart.split('/')
  const [hour, min, sec] = timePart.split(':')
  return new Date(
    parseInt(year), parseInt(month) - 1, parseInt(day),
    parseInt(hour) || 0, parseInt(min) || 0, parseInt(sec) || 0
  ).getTime()
}

interface GraphNode {
  commit: SubmittedChangelist
  lane: number
  color: string
  streamName: string
  // Connection info
  connectToNext: boolean
  connectToPrev: boolean
  // Lane change (for curved connections)
  prevLane?: number
  nextLane?: number
}

interface LaneInfo {
  stream: string
  color: string
  name: string
  active: boolean
}

// Author colors for virtual lanes
const AUTHOR_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#eab308', // yellow
  '#ef4444', // red
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
  '#14b8a6', // teal
]

function getAuthorColor(authorIndex: number): string {
  return AUTHOR_COLORS[authorIndex % AUTHOR_COLORS.length]
}

// Build graph for stream depots (topology-based)
function buildStreamGraph(
  commits: SubmittedChangelist[],
  streams: StreamInfo[],
  currentStreamPath: string | null
): { nodes: GraphNode[], lanes: LaneInfo[], maxLane: number, isVirtual: false } {
  if (commits.length === 0) {
    return { nodes: [], lanes: [], maxLane: 0, isVirtual: false }
  }

  // Build stream hierarchy map
  const streamMap = new Map<string, StreamInfo>()
  const childrenMap = new Map<string, string[]>()

  for (const s of streams) {
    streamMap.set(s.stream, s)
    if (s.parent && s.parent !== 'none') {
      const children = childrenMap.get(s.parent) || []
      children.push(s.stream)
      childrenMap.set(s.parent, children)
    }
  }

  // Assign lanes to streams based on hierarchy
  const streamLanes = new Map<string, number>()
  const laneInfos: LaneInfo[] = []

  const currentStream = currentStreamPath?.replace('/...', '')
  const currentStreamInfo = currentStream ? streamMap.get(currentStream) : null

  // Determine lane 0 - prefer mainline parent
  let mainStream = currentStream
  if (currentStreamInfo?.parent && currentStreamInfo.parent !== 'none') {
    let parent = currentStreamInfo.parent
    while (parent && parent !== 'none') {
      const parentInfo = streamMap.get(parent)
      if (parentInfo?.type === 'mainline' || !parentInfo?.parent || parentInfo.parent === 'none') {
        mainStream = parent
        break
      }
      parent = parentInfo.parent
    }
  }

  if (mainStream) {
    const info = streamMap.get(mainStream)
    streamLanes.set(mainStream, 0)
    laneInfos.push({
      stream: mainStream,
      color: getStreamColor(info?.type || '', info?.name || mainStream),
      name: info?.name || mainStream.split('/').pop() || 'main',
      active: true
    })
  }

  const streamsWithCommits = new Set(commits.map(c => c.stream).filter(Boolean))
  let nextLane = 1

  for (const streamPath of streamsWithCommits) {
    if (streamPath && !streamLanes.has(streamPath)) {
      const info = streamMap.get(streamPath)
      streamLanes.set(streamPath, nextLane)
      laneInfos.push({
        stream: streamPath,
        color: getStreamColor(info?.type || '', info?.name || streamPath),
        name: info?.name || streamPath.split('/').pop() || `stream-${nextLane}`,
        active: true
      })
      nextLane++
    }
  }

  const nodes: GraphNode[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const streamPath = commit.stream || currentStream || ''
    const lane = streamLanes.get(streamPath) ?? 0
    const streamInfo = streamMap.get(streamPath)
    const color = getStreamColor(streamInfo?.type || '', streamInfo?.name || streamPath)

    const prevCommit = i > 0 ? commits[i - 1] : null
    const nextCommit = i < commits.length - 1 ? commits[i + 1] : null

    const prevStream = prevCommit?.stream || currentStream
    const nextStream = nextCommit?.stream || currentStream

    const prevLane = prevStream ? (streamLanes.get(prevStream) ?? 0) : lane
    const nextLaneVal = nextStream ? (streamLanes.get(nextStream) ?? 0) : lane

    nodes.push({
      commit,
      lane,
      color,
      streamName: streamInfo?.name || streamPath.split('/').pop() || 'unknown',
      connectToNext: i < commits.length - 1,
      connectToPrev: i > 0,
      prevLane: prevLane !== lane ? prevLane : undefined,
      nextLane: nextLaneVal !== lane ? nextLaneVal : undefined,
    })
  }

  return {
    nodes,
    lanes: laneInfos,
    maxLane: Math.max(0, nextLane - 1),
    isVirtual: false
  }
}

// Build graph for classic depots (author-based virtual lanes)
function buildVirtualGraph(
  commits: SubmittedChangelist[],
  _currentStreamPath: string | null
): { nodes: GraphNode[], lanes: LaneInfo[], maxLane: number, isVirtual: true } {
  if (commits.length === 0) {
    return { nodes: [], lanes: [], maxLane: 0, isVirtual: true }
  }

  // Group authors by their commit frequency (most active authors get lower lane numbers)
  const authorCommitCounts = new Map<string, number>()
  for (const commit of commits) {
    const count = authorCommitCounts.get(commit.user) || 0
    authorCommitCounts.set(commit.user, count + 1)
  }

  // Sort authors by commit count (descending) - most active gets lane 0
  const sortedAuthors = Array.from(authorCommitCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([author]) => author)

  // Limit to 5 lanes max for readability, group remaining into "Others"
  const MAX_LANES = 5
  const authorToLane = new Map<string, number>()
  const laneInfos: LaneInfo[] = []

  for (let i = 0; i < sortedAuthors.length; i++) {
    const author = sortedAuthors[i]
    const lane = Math.min(i, MAX_LANES - 1)
    authorToLane.set(author, lane)

    // Only create lane info for unique lanes
    if (i < MAX_LANES) {
      const displayName = i === MAX_LANES - 1 && sortedAuthors.length > MAX_LANES
        ? `${author} + ${sortedAuthors.length - MAX_LANES} others`
        : author
      laneInfos.push({
        stream: author,
        color: getAuthorColor(i),
        name: displayName,
        active: true
      })
    }
  }

  // If only one author, still create the lane
  if (laneInfos.length === 0 && commits.length > 0) {
    const author = commits[0].user
    authorToLane.set(author, 0)
    laneInfos.push({
      stream: author,
      color: getAuthorColor(0),
      name: author,
      active: true
    })
  }

  const maxLane = Math.min(sortedAuthors.length - 1, MAX_LANES - 1)

  // Build nodes
  const nodes: GraphNode[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const lane = authorToLane.get(commit.user) ?? 0
    const color = getAuthorColor(lane)

    const prevCommit = i > 0 ? commits[i - 1] : null
    const nextCommit = i < commits.length - 1 ? commits[i + 1] : null

    const prevLane = prevCommit ? (authorToLane.get(prevCommit.user) ?? 0) : lane
    const nextLaneVal = nextCommit ? (authorToLane.get(nextCommit.user) ?? 0) : lane

    nodes.push({
      commit,
      lane,
      color,
      streamName: commit.user,
      connectToNext: i < commits.length - 1,
      connectToPrev: i > 0,
      prevLane: prevLane !== lane ? prevLane : undefined,
      nextLane: nextLaneVal !== lane ? nextLaneVal : undefined,
    })
  }

  return {
    nodes,
    lanes: laneInfos,
    maxLane: Math.max(0, maxLane),
    isVirtual: true
  }
}

// Main build function that chooses the appropriate strategy
function buildGraph(
  commits: SubmittedChangelist[],
  streams: StreamInfo[],
  currentStreamPath: string | null,
  isClassicDepot: boolean
): { nodes: GraphNode[], lanes: LaneInfo[], maxLane: number, isVirtual: boolean } {
  if (commits.length === 0) {
    return { nodes: [], lanes: [], maxLane: 0, isVirtual: false }
  }

  // Use virtual lanes for classic depots or when no stream topology is available
  if (isClassicDepot || streams.length === 0) {
    return buildVirtualGraph(commits, currentStreamPath)
  }

  // Check if we actually have multi-stream commits
  const uniqueStreams = new Set(commits.map(c => c.stream).filter(Boolean))
  if (uniqueStreams.size <= 1) {
    // Even in a stream depot, if all commits are from one stream,
    // fall back to virtual lanes for better visualization
    return buildVirtualGraph(commits, currentStreamPath)
  }

  return buildStreamGraph(commits, streams, currentStreamPath)
}

// Canvas graph renderer
function GraphCanvas({
  nodes,
  lanes,
  maxLane,
  selectedIdx
}: {
  nodes: GraphNode[]
  lanes: LaneInfo[]
  maxLane: number
  selectedIdx: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = nodes.length * ROW_HEIGHT

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = GRAPH_WIDTH * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, GRAPH_WIDTH, height)

    const getLaneX = (lane: number) => LANE_OFFSET + lane * LANE_WIDTH
    const getY = (index: number) => index * ROW_HEIGHT + ROW_HEIGHT / 2

    // Track which lanes are active at each row
    const activeLanesPerRow: Set<number>[] = []
    for (let i = 0; i < nodes.length; i++) {
      activeLanesPerRow.push(new Set())
    }

    // First pass: determine active lanes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      activeLanesPerRow[i].add(node.lane)

      // If there's a lane change, both lanes are active in this region
      if (node.prevLane !== undefined) {
        // Mark lanes active from prev to current
        for (let j = Math.max(0, i - 1); j <= i; j++) {
          activeLanesPerRow[j].add(node.lane)
          activeLanesPerRow[j].add(node.prevLane)
        }
      }
      if (node.nextLane !== undefined) {
        for (let j = i; j <= Math.min(nodes.length - 1, i + 1); j++) {
          activeLanesPerRow[j].add(node.lane)
          activeLanesPerRow[j].add(node.nextLane)
        }
      }
    }

    // Draw lane lines (vertical lines for each active lane segment)
    for (let laneIdx = 0; laneIdx <= maxLane; laneIdx++) {
      const laneInfo = lanes[laneIdx]
      if (!laneInfo) continue

      const x = getLaneX(laneIdx)
      const color = laneInfo.color

      // Find continuous segments where this lane is active
      let segmentStart = -1
      for (let i = 0; i <= nodes.length; i++) {
        const isActive = i < nodes.length && activeLanesPerRow[i].has(laneIdx)

        if (isActive && segmentStart === -1) {
          segmentStart = i
        } else if (!isActive && segmentStart !== -1) {
          // Draw segment
          const startY = getY(segmentStart) - ROW_HEIGHT / 2
          const endY = getY(i - 1) + ROW_HEIGHT / 2

          ctx.beginPath()
          ctx.strokeStyle = color + '50'
          ctx.lineWidth = 2
          ctx.lineCap = 'round'
          ctx.moveTo(x, startY)
          ctx.lineTo(x, endY)
          ctx.stroke()

          segmentStart = -1
        }
      }
    }

    // Draw curved connections between lanes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const x = getLaneX(node.lane)
      const y = getY(i)

      // Draw curve from previous lane to current
      if (node.prevLane !== undefined && i > 0) {
        const prevX = getLaneX(node.prevLane)
        const prevY = getY(i - 1)

        // Bezier curve from prev node to current
        ctx.beginPath()
        ctx.strokeStyle = node.color + 'cc'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'

        // S-curve between lanes
        const midY = (prevY + y) / 2
        ctx.moveTo(prevX, prevY)
        ctx.bezierCurveTo(
          prevX, midY + (y - prevY) * 0.2,
          x, midY - (y - prevY) * 0.2,
          x, y
        )
        ctx.stroke()
      }

      // Draw curve to next lane
      if (node.nextLane !== undefined && i < nodes.length - 1) {
        const nextX = getLaneX(node.nextLane)
        const nextY = getY(i + 1)

        ctx.beginPath()
        ctx.strokeStyle = nodes[i + 1].color + 'cc'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'

        const midY = (y + nextY) / 2
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(
          x, midY + (nextY - y) * 0.2,
          nextX, midY - (nextY - y) * 0.2,
          nextX, nextY
        )
        ctx.stroke()
      }
    }

    // Draw nodes on top
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const x = getLaneX(node.lane)
      const y = getY(i)
      const isSelected = i === selectedIdx

      // Glow for selected
      if (isSelected) {
        ctx.beginPath()
        ctx.fillStyle = '#3b82f640'
        ctx.arc(x, y, NODE_RADIUS + 6, 0, Math.PI * 2)
        ctx.fill()
      }

      // Outer ring
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : node.color
      ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2)
      ctx.fill()

      // Inner dark
      ctx.beginPath()
      ctx.fillStyle = '#1e1e1e'
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      // Center
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : node.color
      ctx.arc(x, y, NODE_RADIUS - 2, 0, Math.PI * 2)
      ctx.fill()
    }

  }, [nodes, lanes, maxLane, height, selectedIdx])

  if (nodes.length === 0) return null

  return (
    <canvas
      ref={canvasRef}
      style={{ width: GRAPH_WIDTH, height }}
      className="flex-shrink-0"
    />
  )
}

// Debug info interface
interface DebugInfo {
  depotName: string | null
  currentStreamPath: string | null
  streamsFound: number
  streamsList: string[]
  relatedStreams: string[]
  commitsPerStream: Record<string, number>
  lanesAssigned: number
  isClassicDepot: boolean
}

export function CommitGraph({
  depotPath,
  onSelectChangelist,
  selectedChangelist
}: CommitGraphProps) {
  const [commits, setCommits] = useState<SubmittedChangelist[]>([])
  const [streams, setStreams] = useState<StreamInfo[]>([])
  const [isClassicDepot, setIsClassicDepot] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)
  const [showDebug, setShowDebug] = useState(false) // Hidden by default now
  const scrollRef = useRef<HTMLDivElement>(null)

  // Extract depot name from path
  const depotName = useMemo(() => {
    if (!depotPath) return null
    const match = depotPath.match(/^\/\/([^/]+)/)
    return match ? match[1] : null
  }, [depotPath])

  const currentStreamPath = depotPath?.replace('/...', '') || null

  // Load stream hierarchy and commits
  const loadData = useCallback(async () => {
    if (!depotPath || !depotName) return

    setLoading(true)
    setError(null)

    const debug: DebugInfo = {
      depotName,
      currentStreamPath,
      streamsFound: 0,
      streamsList: [],
      relatedStreams: [],
      commitsPerStream: {},
      lanesAssigned: 0,
      isClassicDepot: false
    }

    try {
      // Fetch streams in parallel with current stream's commits
      console.log('[CommitGraph] Fetching streams for depot:', depotName)
      const [streamsData, currentCommits] = await Promise.all([
        window.p4.getStreams(depotName).catch((err) => {
          console.log('[CommitGraph] getStreams failed:', err)
          return []
        }),
        window.p4.getSubmittedChanges(depotPath, 50)
      ])

      console.log('[CommitGraph] Streams returned:', streamsData)
      console.log('[CommitGraph] Current commits count:', currentCommits.length)

      // Map streams to our format
      const streamInfos: StreamInfo[] = streamsData.map((s: any) => ({
        stream: s.stream,
        name: s.name || s.stream.split('/').pop(),
        parent: s.parent || 'none',
        type: s.type || 'development'
      }))

      debug.streamsFound = streamInfos.length
      debug.streamsList = streamInfos.map(s => `${s.name} (${s.type}, parent: ${s.parent})`)

      // Determine if this is a classic depot (no streams found)
      const isClassic = streamInfos.length === 0
      debug.isClassicDepot = isClassic
      setIsClassicDepot(isClassic)
      setStreams(streamInfos)

      // Tag commits with their stream
      const taggedCommits = currentCommits.map((c: SubmittedChangelist) => ({
        ...c,
        stream: currentStreamPath || undefined
      }))

      debug.commitsPerStream[currentStreamPath || 'current'] = taggedCommits.length

      // Find related streams (parent and siblings)
      const currentStreamInfo = streamInfos.find(s => s.stream === currentStreamPath)
      console.log('[CommitGraph] Current stream info:', currentStreamInfo)

      const relatedStreams: string[] = []

      if (currentStreamInfo?.parent && currentStreamInfo.parent !== 'none') {
        relatedStreams.push(currentStreamInfo.parent)
        console.log('[CommitGraph] Added parent stream:', currentStreamInfo.parent)

        // Also get sibling streams (same parent)
        for (const s of streamInfos) {
          if (s.parent === currentStreamInfo.parent && s.stream !== currentStreamPath) {
            relatedStreams.push(s.stream)
            console.log('[CommitGraph] Added sibling stream:', s.stream)
          }
        }
      } else {
        console.log('[CommitGraph] No parent stream found. Current stream path:', currentStreamPath)
        console.log('[CommitGraph] Available streams:', streamInfos.map(s => s.stream))
      }

      // Also get child streams
      for (const s of streamInfos) {
        if (s.parent === currentStreamPath) {
          relatedStreams.push(s.stream)
          console.log('[CommitGraph] Added child stream:', s.stream)
        }
      }

      debug.relatedStreams = relatedStreams

      // Fetch commits from related streams (limit to prevent too many requests)
      const relatedCommitPromises = relatedStreams.slice(0, 3).map(async (streamPath) => {
        try {
          const commits = await window.p4.getSubmittedChanges(streamPath + '/...', 20)
          console.log(`[CommitGraph] Fetched ${commits.length} commits from ${streamPath}`)
          debug.commitsPerStream[streamPath] = commits.length
          return commits.map((c: SubmittedChangelist) => ({ ...c, stream: streamPath }))
        } catch (err) {
          console.log(`[CommitGraph] Failed to fetch commits from ${streamPath}:`, err)
          debug.commitsPerStream[streamPath] = 0
          return []
        }
      })

      const relatedCommitsArrays = await Promise.all(relatedCommitPromises)
      const allRelatedCommits = relatedCommitsArrays.flat()

      console.log('[CommitGraph] Total related commits:', allRelatedCommits.length)

      // Merge and sort all commits by date
      const allCommits = [...taggedCommits, ...allRelatedCommits]
      allCommits.sort((a, b) => parseDate(b.date) - parseDate(a.date))

      // Remove duplicates (same changelist number)
      const seen = new Set<number>()
      const uniqueCommits = allCommits.filter(c => {
        if (seen.has(c.number)) return false
        seen.add(c.number)
        return true
      })

      // Count unique streams in final commits
      const uniqueStreams = new Set(uniqueCommits.map(c => c.stream))
      debug.lanesAssigned = uniqueStreams.size
      console.log('[CommitGraph] Unique streams in final commits:', Array.from(uniqueStreams))

      setCommits(uniqueCommits.slice(0, 100))
      setDebugInfo(debug)
    } catch (err: any) {
      console.error('Failed to load graph data:', err)
      setError(err.message || 'Failed to load data')
      debug.isClassicDepot = true
      setDebugInfo(debug)
      setIsClassicDepot(true) // Assume classic on error

      // Fallback: just load current stream commits
      try {
        const changes = await window.p4.getSubmittedChanges(depotPath, 100)
        setCommits(changes.map((c: SubmittedChangelist) => ({ ...c, stream: currentStreamPath || undefined })))
      } catch {
        setCommits([])
      }
    } finally {
      setLoading(false)
    }
  }, [depotPath, depotName, currentStreamPath])

  useEffect(() => {
    if (depotPath) {
      loadData()
    }
  }, [depotPath, loadData])

  // Build graph structure
  const { nodes, lanes, maxLane, isVirtual } = useMemo(
    () => buildGraph(commits, streams, currentStreamPath, isClassicDepot),
    [commits, streams, currentStreamPath, isClassicDepot]
  )

  const selectedIdx = commits.findIndex(c => c.number === selectedChangelist)
  const totalHeight = commits.length * ROW_HEIGHT

  // Current stream display name
  const streamName = currentStreamPath?.split('/').filter(p => p).pop() || 'stream'

  return (
    <div className="h-full flex flex-col bg-p4-dark">
      {/* Header */}
      <div className="p-3 border-b border-p4-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: lanes[0]?.color || '#6b7280' }}
            />
            <span className="text-sm font-medium text-white">{streamName}</span>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="text-gray-500 hover:text-gray-300 p-1 disabled:opacity-50"
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Virtual lanes indicator */}
        {isVirtual && lanes.length > 1 && (
          <div className="flex items-center gap-1 mt-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              Inferred lanes by author
            </span>
            <span className="text-[10px] text-gray-500">
              (classic depot)
            </span>
          </div>
        )}

        {/* Stream/Lane legend */}
        {lanes.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
            {lanes.map((lane, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: lane.color }}
                />
                <span className="text-gray-400 truncate max-w-[80px]" title={lane.name}>
                  {lane.name}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-gray-500">
            {commits.length} commits
            {lanes.length > 1 && (isVirtual
              ? ` by ${lanes.length} authors`
              : ` across ${lanes.length} streams`
            )}
          </div>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {showDebug ? 'Hide' : 'Show'} Debug
          </button>
        </div>
      </div>

      {/* Debug Panel */}
      {showDebug && debugInfo && (
        <div className="p-2 border-b border-p4-border bg-gray-900 text-xs font-mono overflow-auto max-h-48">
          <div className="text-yellow-400 mb-1">Debug Info:</div>
          <div className="text-gray-400">
            <div>Depot: <span className="text-white">{debugInfo.depotName || 'null'}</span></div>
            <div>Current Stream: <span className="text-white">{debugInfo.currentStreamPath || 'null'}</span></div>
            <div>Depot Type: <span className={debugInfo.isClassicDepot ? 'text-yellow-400' : 'text-green-400'}>
              {debugInfo.isClassicDepot ? 'Classic (using virtual lanes)' : 'Stream depot'}
            </span></div>
            <div>Streams Found: <span className="text-white">{debugInfo.streamsFound}</span></div>
            {debugInfo.streamsList.length > 0 && (
              <div className="mt-1">
                <div className="text-yellow-400">Streams in depot:</div>
                {debugInfo.streamsList.map((s, i) => (
                  <div key={i} className="ml-2 text-green-400">{s}</div>
                ))}
              </div>
            )}
            {debugInfo.relatedStreams.length > 0 ? (
              <div className="mt-1">
                <div className="text-yellow-400">Related streams (parent/sibling/child):</div>
                {debugInfo.relatedStreams.map((s, i) => (
                  <div key={i} className="ml-2 text-blue-400">{s}</div>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-red-400">No related streams found</div>
            )}
            <div className="mt-1">
              <div className="text-yellow-400">Commits per stream:</div>
              {Object.entries(debugInfo.commitsPerStream).map(([stream, count]) => (
                <div key={stream} className="ml-2">
                  <span className="text-purple-400">{stream}</span>: <span className="text-white">{count}</span>
                </div>
              ))}
            </div>
            <div className="mt-1">Lanes assigned: <span className="text-white">{debugInfo.lanesAssigned}</span></div>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            Loading history...
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-400 text-center">
            {error}
          </div>
        ) : commits.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            {depotPath ? 'No commits found' : 'Select a workspace'}
          </div>
        ) : (
          <div className="flex" style={{ minHeight: totalHeight }}>
            {/* Graph column */}
            <div className="flex-shrink-0 bg-p4-darker">
              <GraphCanvas
                nodes={nodes}
                lanes={lanes}
                maxLane={maxLane}
                selectedIdx={selectedIdx}
              />
            </div>

            {/* Commit rows */}
            <div className="flex-1 min-w-0">
              {commits.map((item, index) => {
                const isSelected = selectedChangelist === item.number
                const node = nodes[index]
                const isCurrentStream = item.stream === currentStreamPath
                // Show stream badge for non-current streams, or author badge in virtual mode
                const showBadge = isVirtual
                  ? (lanes.length > 1) // In virtual mode, show badge if multiple authors
                  : (!isCurrentStream && node) // In stream mode, show if different stream

                return (
                  <div
                    key={item.number}
                    onClick={() => onSelectChangelist(item.number)}
                    style={{ height: ROW_HEIGHT }}
                    className={`
                      flex items-center px-3 cursor-pointer border-b border-p4-border/30
                      transition-colors select-none
                      ${isSelected ? 'bg-p4-blue/20 border-l-2 border-l-p4-blue' : 'hover:bg-gray-800/50'}
                    `}
                  >
                    {/* User Avatar */}
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: isVirtual && node ? node.color : getUserColor(item.user) }}
                      title={item.user}
                    >
                      {getUserInitials(item.user)}
                    </div>

                    <div className="flex-1 min-w-0 ml-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white truncate">
                          {item.description || '(no description)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs">
                        <span className="font-mono text-gray-400">@{item.number}</span>
                        <span className="text-gray-500">{item.user}</span>
                        {showBadge && node && !isVirtual && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px]"
                            style={{
                              backgroundColor: node.color + '20',
                              color: node.color
                            }}
                          >
                            {node.streamName}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 flex-shrink-0 ml-2">
                      {formatRelativeDate(item.date)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
