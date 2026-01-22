import { useState, useEffect, useRef } from 'react'
import { getUserColor, getUserInitials } from '../utils/userIcon'

interface P4Changelist {
  number: number
  status: 'pending' | 'submitted'
  description: string
  user: string
  client: string
  date?: string
}

interface HistoryProps {
  depotPath: string | null
  onChangelistSelect: (changelist: number) => void
  selectedChangelist: number | null
  selectedChangelists: number[]
  onMultiSelect: (changelists: number[]) => void
}

// Graph constants
const GRAPH_WIDTH = 40
const NODE_RADIUS = 5
const ROW_HEIGHT = 72

// Stream color based on path
function getStreamColor(path: string | null): string {
  if (!path) return '#6b7280'
  const lowerPath = path.toLowerCase()
  if (lowerPath.includes('main') || lowerPath.includes('trunk')) return '#22c55e'
  if (lowerPath.includes('dev') || lowerPath.includes('development')) return '#3b82f6'
  if (lowerPath.includes('release') || lowerPath.includes('rel')) return '#a855f7'
  if (lowerPath.includes('feature')) return '#eab308'
  if (lowerPath.includes('hotfix') || lowerPath.includes('fix')) return '#ef4444'
  return '#6b7280'
}

// Format relative date
function formatRelativeDate(dateStr: string | undefined): string {
  if (!dateStr) return ''

  // Parse P4 date format: "2024/01/01" or "2024/01/01 12:34:56"
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

// Graph canvas component
function GraphCanvas({
  count,
  color,
  selectedIndices
}: {
  count: number
  color: string
  selectedIndices: Set<number>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = count * ROW_HEIGHT

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1
    canvas.width = GRAPH_WIDTH * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear
    ctx.clearRect(0, 0, GRAPH_WIDTH, height)

    const centerX = GRAPH_WIDTH / 2

    // Draw vertical line
    ctx.beginPath()
    ctx.strokeStyle = color + '60'
    ctx.lineWidth = 2
    ctx.moveTo(centerX, 0)
    ctx.lineTo(centerX, height)
    ctx.stroke()

    // Draw nodes
    for (let i = 0; i < count; i++) {
      const y = i * ROW_HEIGHT + ROW_HEIGHT / 2
      const isSelected = selectedIndices.has(i)

      // Outer circle
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : color
      ctx.arc(centerX, y, NODE_RADIUS + 2, 0, Math.PI * 2)
      ctx.fill()

      // Inner circle (dark)
      ctx.beginPath()
      ctx.fillStyle = '#1e1e1e'
      ctx.arc(centerX, y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      // Center dot
      ctx.beginPath()
      ctx.fillStyle = isSelected ? '#3b82f6' : color
      ctx.arc(centerX, y, NODE_RADIUS - 2, 0, Math.PI * 2)
      ctx.fill()
    }

  }, [count, color, height, selectedIndices])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: GRAPH_WIDTH, height }}
      className="flex-shrink-0"
    />
  )
}

export function History({
  depotPath,
  onChangelistSelect,
  selectedChangelist,
  selectedChangelists,
  onMultiSelect
}: HistoryProps) {
  const [changelists, setChangelists] = useState<P4Changelist[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [copying, setCopying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const streamColor = getStreamColor(depotPath)
  const streamName = depotPath ? depotPath.split('/').filter(p => p && p !== '...').pop() || 'stream' : 'stream'

  useEffect(() => {
    if (depotPath) {
      loadHistory()
    }
  }, [depotPath])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  const loadHistory = async () => {
    if (!depotPath) return

    try {
      setLoading(true)
      setError(null)
      const changes = await window.p4.getSubmittedChanges(depotPath, 100)
      setChangelists(changes)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClick = (cl: P4Changelist, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangeNumbers = changelists.slice(start, end + 1).map(c => c.number)
      onMultiSelect(rangeNumbers)
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle selection
      if (selectedChangelists.includes(cl.number)) {
        onMultiSelect(selectedChangelists.filter(n => n !== cl.number))
      } else {
        onMultiSelect([...selectedChangelists, cl.number])
      }
      setLastClickedIndex(index)
    } else {
      // Normal click: single select
      onMultiSelect([cl.number])
      onChangelistSelect(cl.number)
      setLastClickedIndex(index)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (selectedChangelists.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }

  const generateLLMSummary = async () => {
    if (selectedChangelists.length === 0) return

    setCopying(true)
    setContextMenu(null)

    try {
      const summaries: string[] = []
      const sortedCLs = [...selectedChangelists].sort((a, b) => a - b)

      for (const clNumber of sortedCLs) {
        const result = await window.p4.describeChangelist(clNumber)

        if (result.info) {
          let clSummary = `## Changelist #${clNumber}\n`
          clSummary += `- **Author**: ${result.info.user}\n`
          clSummary += `- **Date**: ${result.info.date}\n`
          clSummary += `- **Description**: ${result.info.description}\n\n`

          if (result.files.length > 0) {
            clSummary += `### Changed Files (${result.files.length})\n`
            for (const file of result.files) {
              const fileName = file.depotFile.split('/').pop()
              clSummary += `- \`${fileName}\` (${file.action})\n`
            }
            clSummary += '\n'
          }

          if (result.diff) {
            clSummary += `### Diff\n\`\`\`diff\n${result.diff}\n\`\`\`\n`
          }

          summaries.push(clSummary)
        }
      }

      const fullText = `# Perforce Changelist Summary

Please analyze the following ${selectedChangelists.length} changelist(s) and explain:
1. What changes were made in each file
2. The purpose/intent of these changes
3. Any potential issues or improvements

---

${summaries.join('\n---\n\n')}
`

      await navigator.clipboard.writeText(fullText)
      alert(`Copied ${selectedChangelists.length} changelist(s) summary to clipboard!\n\nYou can now paste this into ChatGPT, Claude, or any LLM.`)
    } catch (err: any) {
      alert(`Error generating summary: ${err.message}`)
    } finally {
      setCopying(false)
    }
  }

  const copyChangelistNumbers = async () => {
    const numbers = [...selectedChangelists].sort((a, b) => a - b).join(', ')
    await navigator.clipboard.writeText(numbers)
    setContextMenu(null)
  }

  // Calculate selected indices for graph highlighting
  const selectedIndices = new Set(
    changelists
      .map((cl, idx) => selectedChangelists.includes(cl.number) ? idx : -1)
      .filter(idx => idx !== -1)
  )

  if (!depotPath) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Select a workspace to view history
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
          Loading history...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm p-4">
        <div className="text-red-400 mb-2">Error loading history</div>
        <div className="text-xs mb-4">{error}</div>
        <button
          onClick={loadHistory}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" onContextMenu={handleContextMenu}>
      {/* Header */}
      <div className="p-3 border-b border-p4-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: streamColor }}
          />
          <span className="text-sm font-medium text-white">{streamName}</span>
          <span className="text-xs text-gray-500">
            {changelists.length} commits
          </span>
        </div>
        <button
          onClick={loadHistory}
          className="text-gray-500 hover:text-gray-300 p-1"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Selection hint */}
      {selectedChangelists.length > 1 && (
        <div className="px-3 py-2 bg-p4-blue/10 border-b border-p4-border text-xs text-p4-blue flex-shrink-0">
          {selectedChangelists.length} selected - Right-click for options
        </div>
      )}

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {changelists.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No submitted changes found
          </div>
        ) : (
          <div className="flex">
            {/* Graph column */}
            <div className="flex-shrink-0 bg-p4-darker">
              <GraphCanvas
                count={changelists.length}
                color={streamColor}
                selectedIndices={selectedIndices}
              />
            </div>

            {/* Changelist rows */}
            <div className="flex-1 min-w-0">
              {changelists.map((cl, index) => {
                const isSelected = selectedChangelists.includes(cl.number)
                const isCurrent = selectedChangelist === cl.number

                return (
                  <div
                    key={cl.number}
                    onClick={(e) => handleClick(cl, index, e)}
                    style={{ height: ROW_HEIGHT }}
                    className={`
                      flex items-center px-3 cursor-pointer border-b border-p4-border/30
                      transition-colors select-none
                      ${isSelected ? 'bg-p4-blue/20' : 'hover:bg-gray-800/50'}
                      ${isCurrent && !isSelected ? 'bg-gray-800/30' : ''}
                    `}
                  >
                    {/* User Avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                      style={{ backgroundColor: getUserColor(cl.user) }}
                      title={cl.user}
                    >
                      {getUserInitials(cl.user)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 ml-3">
                      <div className="text-sm text-white truncate">
                        {cl.description || '(no description)'}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="font-mono text-gray-400">@{cl.number}</span>
                        <span>{cl.user}</span>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="text-xs text-gray-500 flex-shrink-0 ml-2">
                      {formatRelativeDate(cl.date)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-p4-darker border border-p4-border rounded shadow-xl z-50 py-1 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={generateLLMSummary}
            disabled={copying}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          >
            <span>📋</span>
            <span>{copying ? 'Generating...' : 'Copy for LLM Analysis'}</span>
          </button>
          <button
            onClick={copyChangelistNumbers}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            <span>#</span>
            <span>Copy Changelist Numbers</span>
          </button>
          <div className="border-t border-p4-border my-1" />
          <button
            onClick={() => {
              onMultiSelect([])
              setContextMenu(null)
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 text-gray-400"
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  )
}
