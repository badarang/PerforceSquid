import { useState, useEffect } from 'react'
import { useP4Store } from '../stores/p4Store'

interface BlameLine {
  lineNumber: number
  changelist: number
  user: string
  date: string
  content: string
}

interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'hunk'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

function parseDiff(diffText: string): DiffLine[] {
  if (!diffText.trim()) {
    return []
  }

  const lines = diffText.split('\n')
  const result: DiffLine[] = []
  let oldLineNum = 0
  let newLineNum = 0

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
      continue
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (match) {
        oldLineNum = parseInt(match[1], 10)
        newLineNum = parseInt(match[2], 10)
        result.push({ type: 'hunk', content: line })
      }
      continue
    }

    if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLineNum: newLineNum++ })
    } else if (line.startsWith('-')) {
      result.push({ type: 'delete', content: line.slice(1), oldLineNum: oldLineNum++ })
    } else if (line.startsWith(' ') || line === '') {
      result.push({
        type: 'context',
        content: line.slice(1) || '',
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++
      })
    }
  }

  return result
}

// Generate consistent colors for a user (text and background)
function getUserColors(user: string): { text: string; bg: string } {
  const colorPairs = [
    { text: 'rgb(96, 165, 250)', bg: 'rgba(96, 165, 250, 0.08)' },   // blue
    { text: 'rgb(74, 222, 128)', bg: 'rgba(74, 222, 128, 0.08)' },   // green
    { text: 'rgb(250, 204, 21)', bg: 'rgba(250, 204, 21, 0.08)' },   // yellow
    { text: 'rgb(192, 132, 252)', bg: 'rgba(192, 132, 252, 0.08)' }, // purple
    { text: 'rgb(244, 114, 182)', bg: 'rgba(244, 114, 182, 0.08)' }, // pink
    { text: 'rgb(34, 211, 238)', bg: 'rgba(34, 211, 238, 0.08)' },   // cyan
    { text: 'rgb(251, 146, 60)', bg: 'rgba(251, 146, 60, 0.08)' },   // orange
    { text: 'rgb(45, 212, 191)', bg: 'rgba(45, 212, 191, 0.08)' },   // teal
  ]
  let hash = 0
  for (let i = 0; i < user.length; i++) {
    hash = user.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colorPairs[Math.abs(hash) % colorPairs.length]
}

export function DiffViewer() {
  const { selectedFile, currentDiff, isLoading } = useP4Store()
  const [viewMode, setViewMode] = useState<'diff' | 'blame'>('diff')
  const [blameData, setBlameData] = useState<BlameLine[]>([])
  const [blameLoading, setBlameLoading] = useState(false)
  const [blameError, setBlameError] = useState<string | null>(null)

  // Reset when file changes
  useEffect(() => {
    setViewMode('diff')
    setBlameData([])
    setBlameError(null)
  }, [selectedFile?.depotFile])

  // Load blame when switching to blame mode
  useEffect(() => {
    if (viewMode === 'blame' && selectedFile && blameData.length === 0 && !blameLoading) {
      loadBlameData()
    }
  }, [viewMode, selectedFile])

  const loadBlameData = async () => {
    if (!selectedFile) return

    setBlameLoading(true)
    setBlameError(null)

    try {
      const result = await window.p4.annotate(selectedFile.depotFile)
      if (result.success) {
        setBlameData(result.lines)
      } else {
        setBlameError(result.message || 'Failed to load blame data')
      }
    } catch (err: any) {
      setBlameError(err.message || 'Failed to load blame data')
    } finally {
      setBlameLoading(false)
    }
  }

  if (!selectedFile) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">{'<-'}</div>
          <div>Select a file to view changes</div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="animate-pulse">Loading diff...</div>
      </div>
    )
  }

  const fileName = selectedFile.clientFile || selectedFile.depotFile
  const shortName = fileName.split(/[/\\]/).pop()

  // Render Blame View (Rider Git Annotation style)
  const renderBlameView = () => {
    if (blameLoading) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <div className="animate-pulse">Loading annotation...</div>
        </div>
      )
    }

    if (blameError) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-xl mb-2">Failed to load annotation</div>
            <div className="text-sm text-red-400 mb-4">{blameError}</div>
            <button
              onClick={loadBlameData}
              className="px-4 py-2 bg-p4-blue text-white rounded hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }

    if (blameData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-xl mb-2">No annotation data</div>
            <div className="text-sm">This file cannot be annotated</div>
          </div>
        </div>
      )
    }

    let lastCL: number | null = null

    return (
      <div style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace", fontSize: '13px' }}>
        {blameData.map((line, index) => {
          const showMeta = line.changelist !== lastCL
          lastCL = line.changelist
          const colors = getUserColors(line.user)

          return (
            <div
              key={index}
              style={{
                display: 'flex',
                backgroundColor: colors.bg,
                height: '20px',
                lineHeight: '20px',
              }}
              className="hover:brightness-125"
            >
              {/* Annotation column - Rider style */}
              <div
                style={{
                  width: '176px',
                  flexShrink: 0,
                  padding: '0 8px',
                  fontSize: '11px',
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  borderRight: '1px solid rgba(75,85,99,0.5)',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={`CL #${line.changelist} by ${line.user} on ${line.date}`}
              >
                {showMeta ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '8px' }}>
                    <span
                      style={{ color: colors.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {line.user}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: '10px', whiteSpace: 'nowrap' }}>
                      {line.date}
                    </span>
                  </div>
                ) : (
                  <div style={{ width: '100%', textAlign: 'center', color: '#4b5563' }}>│</div>
                )}
              </div>
              {/* Line number */}
              <div
                style={{
                  width: '40px',
                  flexShrink: 0,
                  padding: '0 4px',
                  textAlign: 'right',
                  color: '#6b7280',
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  userSelect: 'none',
                }}
              >
                {line.lineNumber}
              </div>
              {/* Code content */}
              <span
                style={{
                  flex: 1,
                  paddingLeft: '12px',
                  paddingRight: '8px',
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                }}
              >
                {line.content}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  // Render Diff View
  const renderDiffView = () => {
    if (!currentDiff || !currentDiff.hunks) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-xl mb-2">No changes</div>
            <div className="text-sm">This file has no differences from the depot version</div>
          </div>
        </div>
      )
    }

    const diffLines = parseDiff(currentDiff.hunks)

    if (diffLines.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-xl mb-2">No changes</div>
            <div className="text-sm">This file has no differences from the depot version</div>
          </div>
        </div>
      )
    }

    return (
      <div className="diff-view">
        {diffLines.map((line, index) => {
          if (line.type === 'hunk') {
            return (
              <div key={index} className="diff-hunk-header">
                {line.content}
              </div>
            )
          }

          const lineClass = line.type === 'add' ? 'diff-line-add' :
                            line.type === 'delete' ? 'diff-line-delete' :
                            'diff-line-context'

          return (
            <div key={index} className={`diff-line ${lineClass}`}>
              <span className="diff-line-number">
                {line.type === 'add' ? '' : line.oldLineNum || ''}
              </span>
              <span className="diff-line-number">
                {line.type === 'delete' ? '' : line.newLineNum || ''}
              </span>
              <span className="diff-line-content">
                {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                {line.content}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-p4-border flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-200 truncate">{shortName}</h2>
          <p className="text-xs text-gray-500 truncate">{fileName}</p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 ml-4">
          <div className="flex rounded overflow-hidden border border-p4-border">
            <button
              onClick={() => setViewMode('diff')}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'diff'
                  ? 'bg-p4-blue text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Diff
            </button>
            <button
              onClick={() => setViewMode('blame')}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'blame'
                  ? 'bg-p4-blue text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              Annotate
            </button>
          </div>

          <span className={`px-2 py-1 rounded text-xs font-medium ${
            selectedFile.action === 'add' ? 'bg-green-900 text-green-300' :
            selectedFile.action === 'edit' ? 'bg-yellow-900 text-yellow-300' :
            selectedFile.action === 'delete' ? 'bg-red-900 text-red-300' :
            'bg-gray-700 text-gray-300'
          }`}>
            {selectedFile.action.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'diff' ? renderDiffView() : renderBlameView()}
      </div>
    </div>
  )
}
