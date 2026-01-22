import { useState, useEffect, useRef, useMemo } from 'react'
import { getUserColor, getUserInitials } from '../utils/userIcon'

interface SubmittedChangelist {
  number: number
  description: string
  user: string
  date?: string
}

interface CommitGraphProps {
  depotPath: string | null
  onSelectChangelist: (cl: number) => void
  selectedChangelist: number | null
}

// Graph constants
const GRAPH_WIDTH = 80
const NODE_RADIUS = 5
const ROW_HEIGHT = 60
const LANE_WIDTH = 16
const LANE_OFFSET = 20

// Lane colors
const LANE_COLORS = [
  '#22c55e', // green - main
  '#3b82f6', // blue - dev
  '#a855f7', // purple - feature
  '#eab308', // yellow - release
  '#ef4444', // red - hotfix
  '#06b6d4', // cyan
  '#f97316', // orange
]

// Detect if a commit is a merge/integrate
function isMergeCommit(description: string): { isMerge: boolean; fromBranch?: string } {
  const lower = description.toLowerCase()

  // Common merge patterns
  const mergePatterns = [
    /integrat(e|ed|ing)/i,
    /merg(e|ed|ing)/i,
    /copy from/i,
    /branch from/i,
    /pull from/i,
  ]

  const isMerge = mergePatterns.some(p => p.test(lower))

  // Try to extract source branch
  const branchMatch = description.match(/from\s+\/\/[^/]+\/([^\s/]+)/i) ||
                     description.match(/from\s+([^\s]+)/i)

  return {
    isMerge,
    fromBranch: branchMatch ? branchMatch[1] : undefined
  }
}

// Stream color based on path
function getStreamColor(path: string | null): string {
  if (!path) return '#6b7280'
  const lowerPath = path.toLowerCase()
  if (lowerPath.includes('main') || lowerPath.includes('trunk')) return LANE_COLORS[0]
  if (lowerPath.includes('dev') || lowerPath.includes('development')) return LANE_COLORS[1]
  if (lowerPath.includes('release') || lowerPath.includes('rel')) return LANE_COLORS[3]
  if (lowerPath.includes('feature')) return LANE_COLORS[2]
  if (lowerPath.includes('hotfix') || lowerPath.includes('fix')) return LANE_COLORS[4]
  return '#6b7280'
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

interface CommitNode {
  index: number
  lane: number
  isMerge: boolean
  mergeFromLane?: number
  color: string
}

// Calculate lane assignments for commits
function calculateLanes(changelists: SubmittedChangelist[], mainColor: string): CommitNode[] {
  const nodes: CommitNode[] = []
  let activeMergeLane = -1
  let mergeLaneEndIndex = -1

  for (let i = 0; i < changelists.length; i++) {
    const cl = changelists[i]
    const { isMerge } = isMergeCommit(cl.description)

    if (isMerge) {
      // Merge commit - place on main lane but show incoming merge
      const mergeFromLane = 1 // Show merge coming from lane 1

      // Start a merge lane that will show for a few commits
      if (activeMergeLane === -1) {
        activeMergeLane = 1
        mergeLaneEndIndex = Math.min(i + 3, changelists.length - 1)
      }

      nodes.push({
        index: i,
        lane: 0,
        isMerge: true,
        mergeFromLane,
        color: mainColor
      })
    } else {
      nodes.push({
        index: i,
        lane: 0,
        isMerge: false,
        color: mainColor
      })
    }

    // Reset merge lane after it ends
    if (i >= mergeLaneEndIndex) {
      activeMergeLane = -1
    }
  }

  return nodes
}

// Draw a curved bezier line
function drawCurvedLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  lineWidth: number = 2
) {
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'

  const midY = (y1 + y2) / 2

  // Control points for smooth S-curve
  ctx.moveTo(x1, y1)
  ctx.bezierCurveTo(
    x1, midY,      // First control point
    x2, midY,      // Second control point
    x2, y2         // End point
  )
  ctx.stroke()
}

// Graph canvas with curved lines
function GraphCanvas({
  nodes,
  mainColor,
  selectedIdx
}: {
  nodes: CommitNode[]
  mainColor: string
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

    // Find merge regions for secondary lane visualization
    const mergeRegions: { start: number; end: number }[] = []
    let currentRegionStart = -1

    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].isMerge) {
        if (currentRegionStart === -1) {
          currentRegionStart = Math.max(0, i - 2)
        }
      } else if (currentRegionStart !== -1) {
        mergeRegions.push({ start: currentRegionStart, end: i })
        currentRegionStart = -1
      }
    }
    if (currentRegionStart !== -1) {
      mergeRegions.push({ start: currentRegionStart, end: nodes.length - 1 })
    }

    // Draw secondary lane lines (for merge visualization)
    const secondaryColor = LANE_COLORS[1]
    for (const region of mergeRegions) {
      const startY = getY(region.start)
      const endY = getY(region.end)
      const laneX = getLaneX(1)

      // Draw curved entry from top
      ctx.beginPath()
      ctx.strokeStyle = secondaryColor + '60'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'

      // Entry curve from outside
      const entryStartX = GRAPH_WIDTH
      const entryStartY = startY - ROW_HEIGHT
      ctx.moveTo(entryStartX, entryStartY)
      ctx.bezierCurveTo(
        laneX + 20, entryStartY,
        laneX, startY - 20,
        laneX, startY
      )
      ctx.stroke()

      // Vertical line for secondary lane
      ctx.beginPath()
      ctx.strokeStyle = secondaryColor + '60'
      ctx.lineWidth = 2
      ctx.moveTo(laneX, startY)
      ctx.lineTo(laneX, endY)
      ctx.stroke()

      // Exit curve
      ctx.beginPath()
      ctx.strokeStyle = secondaryColor + '60'
      ctx.lineWidth = 2
      ctx.moveTo(laneX, endY)
      ctx.bezierCurveTo(
        laneX, endY + 20,
        laneX + 20, endY + ROW_HEIGHT,
        entryStartX, endY + ROW_HEIGHT
      )
      ctx.stroke()
    }

    // Draw main lane vertical line
    const mainLaneX = getLaneX(0)
    ctx.beginPath()
    ctx.strokeStyle = mainColor + '40'
    ctx.lineWidth = 2
    ctx.moveTo(mainLaneX, 0)
    ctx.lineTo(mainLaneX, height)
    ctx.stroke()

    // Draw merge curves and nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const x = getLaneX(node.lane)
      const y = getY(i)
      const isSelected = i === selectedIdx

      // Draw merge curve if this is a merge commit
      if (node.isMerge && node.mergeFromLane !== undefined) {
        const mergeX = getLaneX(node.mergeFromLane)

        // Draw curved merge line
        ctx.beginPath()
        ctx.strokeStyle = LANE_COLORS[1] + 'aa'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'

        // Smooth curve from merge lane to main lane
        ctx.moveTo(mergeX, y - ROW_HEIGHT * 0.3)
        ctx.bezierCurveTo(
          mergeX, y,
          x + 10, y,
          x, y
        )
        ctx.stroke()

        // Small dot on merge lane
        ctx.beginPath()
        ctx.fillStyle = LANE_COLORS[1]
        ctx.arc(mergeX, y - ROW_HEIGHT * 0.3, 3, 0, Math.PI * 2)
        ctx.fill()
      }

      // Draw node
      // Outer glow for selected
      if (isSelected) {
        ctx.beginPath()
        ctx.fillStyle = '#3b82f6' + '40'
        ctx.arc(x, y, NODE_RADIUS + 6, 0, Math.PI * 2)
        ctx.fill()
      }

      // Outer ring
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : node.color
      ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2)
      ctx.fill()

      // Inner dark circle
      ctx.beginPath()
      ctx.fillStyle = '#1e1e1e'
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      // Center dot
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : node.color
      ctx.arc(x, y, NODE_RADIUS - 2, 0, Math.PI * 2)
      ctx.fill()

      // Merge indicator diamond
      if (node.isMerge) {
        ctx.beginPath()
        ctx.fillStyle = LANE_COLORS[1]
        const size = 4
        ctx.moveTo(x + NODE_RADIUS + 6, y)
        ctx.lineTo(x + NODE_RADIUS + 6 + size, y - size)
        ctx.lineTo(x + NODE_RADIUS + 6 + size * 2, y)
        ctx.lineTo(x + NODE_RADIUS + 6 + size, y + size)
        ctx.closePath()
        ctx.fill()
      }
    }

  }, [nodes, mainColor, height, selectedIdx])

  if (nodes.length === 0) return null

  return (
    <canvas
      ref={canvasRef}
      style={{ width: GRAPH_WIDTH, height }}
      className="flex-shrink-0"
    />
  )
}

export function CommitGraph({
  depotPath,
  onSelectChangelist,
  selectedChangelist
}: CommitGraphProps) {
  const [changelists, setChangelists] = useState<SubmittedChangelist[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const streamColor = getStreamColor(depotPath)
  const streamName = depotPath ? depotPath.split('/').filter(p => p && p !== '...').pop() || 'stream' : 'stream'

  useEffect(() => {
    if (depotPath) {
      loadHistory()
    }
  }, [depotPath])

  const loadHistory = async () => {
    if (!depotPath) return
    try {
      setLoading(true)
      const changes = await window.p4.getSubmittedChanges(depotPath, 100)
      setChangelists(changes)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }

  // Calculate lane assignments
  const nodes = useMemo(() =>
    calculateLanes(changelists, streamColor),
    [changelists, streamColor]
  )

  const selectedIdx = changelists.findIndex(c => c.number === selectedChangelist)
  const totalHeight = changelists.length * ROW_HEIGHT

  // Count merges for display
  const mergeCount = nodes.filter(n => n.isMerge).length

  return (
    <div className="h-full flex flex-col bg-p4-dark">
      {/* Header */}
      <div className="p-3 border-b border-p4-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: streamColor }} />
          <span className="text-sm font-medium text-white">{streamName}</span>
          <span className="text-xs text-gray-500">
            {changelists.length} commits
            {mergeCount > 0 && ` (${mergeCount} merges)`}
          </span>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="text-gray-500 hover:text-gray-300 p-1 disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            Loading history...
          </div>
        ) : changelists.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            {depotPath ? 'No commits found' : 'Select a workspace'}
          </div>
        ) : (
          <div className="flex" style={{ minHeight: totalHeight }}>
            {/* Graph column */}
            <div className="flex-shrink-0 bg-p4-darker">
              <GraphCanvas
                nodes={nodes}
                mainColor={streamColor}
                selectedIdx={selectedIdx}
              />
            </div>

            {/* Commit rows */}
            <div className="flex-1 min-w-0">
              {changelists.map((item, index) => {
                const isSelected = selectedChangelist === item.number
                const node = nodes[index]
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
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: getUserColor(item.user) }}
                      title={item.user}
                    >
                      {getUserInitials(item.user)}
                    </div>

                    <div className="flex-1 min-w-0 ml-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white truncate flex-1">
                          {item.description || '(no description)'}
                        </span>
                        {node?.isMerge && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 flex-shrink-0">
                            merge
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="font-mono text-gray-400">@{item.number}</span>
                        <span>{item.user}</span>
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
