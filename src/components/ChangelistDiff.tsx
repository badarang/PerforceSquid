import { useState, useEffect } from 'react'
import { getUserStyle } from '../utils/userIcon'

interface BlameLine {
  lineNumber: number
  changelist: number
  user: string
  date: string
  content: string
}

interface P4Changelist {
  number: number
  status: 'pending' | 'submitted'
  description: string
  user: string
  client: string
  date?: string
}

interface ChangelistFile {
  depotFile: string
  action: string
  revision: number
}

interface ChangelistDiffProps {
  changelist: number | null
}

interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'hunk' | 'file-header'
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
  const pairedMinus = new Set<number>()
  const pairedPlus = new Set<number>()

  const comparable = (value: string) => value.replace(/\r$/, '').trimEnd()
  const braceOnly = (value: string) => /^[\s{}]+\s*$/.test(value)
  const isEquivalentChangeLine = (left: string, right: string) => {
    const a = comparable(left)
    const b = comparable(right)
    if (a === b) return true
    if (braceOnly(a) && braceOnly(b) && a.trim() === b.trim()) return true
    return false
  }
  const resetBoundary = (line: string) =>
    line.startsWith('@@') || line.startsWith('====') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('Differences')

  // Pair brace-only add/delete lines within the same hunk even when not
  // adjacent, to avoid false add/delete coloring on closing braces.
  {
    const pendingBraceMinus = new Map<string, number[]>()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (resetBoundary(line)) {
        pendingBraceMinus.clear()
        continue
      }
      if (line.startsWith('-')) {
        const raw = line.slice(1)
        const key = comparable(raw).trim()
        if (braceOnly(raw) && key) {
          const list = pendingBraceMinus.get(key) || []
          list.push(i)
          pendingBraceMinus.set(key, list)
        }
        continue
      }
      if (line.startsWith('+')) {
        const raw = line.slice(1)
        const key = comparable(raw).trim()
        if (!braceOnly(raw) || !key) continue
        const list = pendingBraceMinus.get(key)
        if (list && list.length > 0) {
          const minusIndex = list.shift()!
          pairedMinus.add(minusIndex)
          pairedPlus.add(i)
          if (list.length === 0) pendingBraceMinus.delete(key)
        }
      }
    }
  }

  // Pair equal -/+ lines within nearby change blocks so unchanged lines are
  // shown as context, not add/delete noise.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('-') || lines[i].startsWith('---')) continue
    const minusContent = comparable(lines[i].slice(1))
    if (!minusContent) continue

    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      const candidate = lines[j]
      if (candidate.startsWith('@@') || candidate.startsWith('====') || candidate.startsWith('---') || candidate.startsWith('+++') || candidate.startsWith('Differences')) {
        break
      }
      if (!(candidate.startsWith('+') || candidate.startsWith('-'))) {
        break
      }
      if (candidate.startsWith('+') && !pairedPlus.has(j) && isEquivalentChangeLine(lines[i].slice(1), candidate.slice(1))) {
        pairedMinus.add(i)
        pairedPlus.add(j)
        break
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip the "Differences ..." header
    if (line.startsWith('Differences')) {
      continue
    }

    // File header: ==== //depot/path/file#rev (text) ====
    if (line.startsWith('====')) {
      result.push({
        type: 'file-header',
        content: line
      })
      continue
    }

    // Hunk header: @@ -1,5 +1,7 @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLineNum = parseInt(match[1], 10)
        newLineNum = parseInt(match[2], 10)
        result.push({
          type: 'hunk',
          content: line
        })
      }
      continue
    }

    // Context line (starts with space)
    if (line.startsWith(' ')) {
      result.push({
        type: 'context',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++
      })
    }
    // Deleted line (coalesce exact -/+ pairs into context)
    else if (line.startsWith('-')) {
      if (pairedMinus.has(i)) {
        result.push({
          type: 'context',
          content: line.slice(1),
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++
        })
      } else if (braceOnly(line.slice(1))) {
        oldLineNum++
      } else {
        result.push({
          type: 'delete',
          content: line.slice(1),
          oldLineNum: oldLineNum++
        })
      }
    }
    // Added line
    else if (line.startsWith('+')) {
      if (pairedPlus.has(i)) {
        continue
      }
      if (braceOnly(line.slice(1))) {
        newLineNum++
        continue
      }
      result.push({
        type: 'add',
        content: line.slice(1),
        newLineNum: newLineNum++
      })
    }
  }

  return result
}

const actionColors: Record<string, string> = {
  add: 'text-p4-green',
  edit: 'text-p4-yellow',
  delete: 'text-p4-red',
  branch: 'text-p4-blue',
  integrate: 'text-purple-400'
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

export function ChangelistDiff({ changelist }: ChangelistDiffProps) {
  const [info, setInfo] = useState<P4Changelist | null>(null)
  const [files, setFiles] = useState<ChangelistFile[]>([])
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Blame state
  const [selectedFileForBlame, setSelectedFileForBlame] = useState<string | null>(null)
  const [blameData, setBlameData] = useState<BlameLine[]>([])
  const [blameLoading, setBlameLoading] = useState(false)
  const [blameError, setBlameError] = useState<string | null>(null)

  useEffect(() => {
    if (changelist) {
      loadChangelist()
      // Reset blame state when changelist changes
      setSelectedFileForBlame(null)
      setBlameData([])
      setBlameError(null)
    } else {
      setInfo(null)
      setFiles([])
      setDiff('')
      setSelectedFileForBlame(null)
      setBlameData([])
    }
  }, [changelist])

  const loadChangelist = async () => {
    if (!changelist) return

    try {
      setLoading(true)
      setError(null)
      const result = await window.p4.describeChangelist(changelist)
      setInfo(result.info)
      setFiles(result.files)
      setDiff(result.diff)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadBlameForFile = async (depotFile: string) => {
    // Toggle off if clicking the same file
    if (selectedFileForBlame === depotFile) {
      setSelectedFileForBlame(null)
      setBlameData([])
      setBlameError(null)
      return
    }

    setSelectedFileForBlame(depotFile)
    setBlameLoading(true)
    setBlameError(null)
    setBlameData([])

    try {
      const result = await window.p4.annotate(depotFile)
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

  if (!changelist) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">←</div>
          <div>Select a changelist to view diff</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="animate-pulse">Loading changelist #{changelist}...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-red-400 mb-2">Error loading changelist</div>
          <div className="text-xs mb-4">{error}</div>
          <button
            onClick={loadChangelist}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const diffLines = parseDiff(diff)
  const userStyle = info ? getUserStyle(info.user) : null

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-p4-border bg-p4-darker min-w-0">
        {info && (
          <div className="text-lg font-semibold text-white mb-3 break-words" style={{ overflowWrap: 'anywhere' }}>
            {info.description || '(no description)'}
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-mono text-p4-blue">
            #{changelist}
          </span>
          <span className="text-sm text-gray-400">
            {info?.date}
          </span>
          {info && userStyle && (
            <div className="flex items-center gap-2">
              <span
                className={`w-6 h-6 rounded-full ${userStyle.color} flex items-center justify-center text-sm`}
                title={info.user}
              >
                {userStyle.icon}
              </span>
              <span className="text-sm text-gray-300">{info.user}</span>
            </div>
          )}
        </div>
      </div>

      {/* Affected Files */}
      {files.length > 0 && (
        <div className="p-3 border-b border-p4-border bg-p4-darker min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-400">
              Affected Files ({files.length}) - Click to view Blame
            </div>
            {selectedFileForBlame && (
              <button
                onClick={() => {
                  setSelectedFileForBlame(null)
                  setBlameData([])
                  setBlameError(null)
                }}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
              >
                Back to Diff
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto min-w-0">
            {files.map((file, idx) => {
              const fileName = file.depotFile.split('/').pop()
              const isSelected = selectedFileForBlame === file.depotFile
              return (
                <button
                  key={idx}
                  onClick={() => loadBlameForFile(file.depotFile)}
                  className={`text-xs px-1.5 py-0.5 rounded ${actionColors[file.action] || 'text-gray-400'} break-all transition-colors
                    ${isSelected
                      ? 'bg-p4-blue ring-1 ring-p4-blue'
                      : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  title={`${file.depotFile} - Click for Blame`}
                >
                  {fileName} ({file.action})
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Diff or Blame View */}
      <div className="flex-1 overflow-auto font-mono text-sm">
        {selectedFileForBlame ? (
          // Blame View
          blameLoading ? (
            <div className="p-4 text-center text-gray-500 animate-pulse">
              Loading blame for {selectedFileForBlame.split('/').pop()}...
            </div>
          ) : blameError ? (
            <div className="p-4 text-center">
              <div className="text-red-400 mb-2">Failed to load blame</div>
              <div className="text-xs text-gray-500 mb-4">{blameError}</div>
              <button
                onClick={() => loadBlameForFile(selectedFileForBlame)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              >
                Retry
              </button>
            </div>
          ) : blameData.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No blame data available for this file
            </div>
          ) : (
            <div style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace", fontSize: '13px' }}>
              {/* File header */}
              <div className="bg-gray-800 text-gray-300 px-3 py-2 font-semibold border-b border-p4-border sticky top-0 z-10">
                {selectedFileForBlame}
              </div>
              {(() => {
                let lastCL: number | null = null
                return blameData.map((line, index) => {
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
                      {/* Annotation column */}
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
                })
              })()}
            </div>
          )
        ) : (
          // Diff View
          diffLines.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No diff available (binary file or no changes)
            </div>
          ) : (
            <div className="diff-view">
              {diffLines.map((line, index) => {
                if (line.type === 'file-header') {
                  return (
                    <div key={index} className="bg-gray-800 text-gray-300 px-3 py-2 font-semibold border-t border-b border-p4-border mt-2">
                      {line.content}
                    </div>
                  )
                }

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
        )}
      </div>
    </div>
  )
}
