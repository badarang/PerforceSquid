import { useState, useEffect, useRef } from 'react'
import { getUserStyle } from '../utils/userIcon'
import { PerforceDiffView } from './PerforceDiffView'

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
  const AUTO_LOAD_DIFF_FILE_LIMIT = 200
  const [info, setInfo] = useState<P4Changelist | null>(null)
  const [files, setFiles] = useState<ChangelistFile[]>([])
  const [diff, setDiff] = useState<string>('')
  const [ignoreFormattingNoise, setIgnoreFormattingNoise] = useState(true)
  const [loading, setLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualDiffRequired, setManualDiffRequired] = useState(false)
  const requestIdRef = useRef(0)

  // Blame state
  const [selectedFileForBlame, setSelectedFileForBlame] = useState<string | null>(null)
  const [blameData, setBlameData] = useState<BlameLine[]>([])
  const [blameLoading, setBlameLoading] = useState(false)
  const [blameError, setBlameError] = useState<string | null>(null)

  useEffect(() => {
    requestIdRef.current += 1
    const currentRequestId = requestIdRef.current
    if (changelist) {
      loadChangelist(currentRequestId)
      // Reset blame state when changelist changes
      setSelectedFileForBlame(null)
      setBlameData([])
      setBlameError(null)
    } else {
      setInfo(null)
      setFiles([])
      setDiff('')
      setManualDiffRequired(false)
      setDiffLoading(false)
      setSelectedFileForBlame(null)
      setBlameData([])
    }
  }, [changelist])

  const loadChangelist = async (requestId: number) => {
    if (!changelist) return

    try {
      setLoading(true)
      setError(null)
      setDiff('')
      setManualDiffRequired(false)
      setDiffLoading(false)

      const result = await window.p4.describeChangelist(changelist, { includeDiff: false })
      if (requestId !== requestIdRef.current) return
      setInfo(result.info)
      setFiles(result.files)

      if (result.files.length <= AUTO_LOAD_DIFF_FILE_LIMIT) {
        setDiffLoading(true)
        const withDiff = await window.p4.describeChangelist(changelist, { includeDiff: true })
        if (requestId !== requestIdRef.current) return
        setDiff(withDiff.diff)
      } else {
        setManualDiffRequired(true)
      }
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return
      setError(err.message)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setDiffLoading(false)
      }
    }
  }

  const loadFullDiff = async () => {
    if (!changelist) return
    const requestId = requestIdRef.current
    try {
      setDiffLoading(true)
      const result = await window.p4.describeChangelist(changelist, { includeDiff: true })
      if (requestId !== requestIdRef.current) return
      setDiff(result.diff)
      setManualDiffRequired(false)
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return
      setError(err.message)
    } finally {
      if (requestId === requestIdRef.current) {
        setDiffLoading(false)
      }
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
      <div className="h-full p-4 space-y-2 animate-pulse">
        {Array.from({ length: 10 }).map((_, idx) => (
          <div key={idx} className="h-5 rounded bg-gray-700/50" />
        ))}
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
            onClick={() => loadChangelist(requestIdRef.current)}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

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
        <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none hover:text-white">
          <input
            type="checkbox"
            checked={ignoreFormattingNoise}
            onChange={(e) => setIgnoreFormattingNoise(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-offset-gray-800"
          />
          Ignore formatting noise
        </label>
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
            <div className="p-4 space-y-2 animate-pulse">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div key={idx} className="h-5 rounded bg-gray-700/50" />
              ))}
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
          manualDiffRequired ? (
            <div className="p-4 text-center text-gray-400">
              <div className="mb-3">
                Large changelist detected ({files.length} files). Diff is deferred to keep UI responsive.
              </div>
              <button
                onClick={loadFullDiff}
                className="px-3 py-1.5 bg-p4-blue hover:bg-blue-600 rounded text-xs text-white"
                disabled={diffLoading}
              >
                {diffLoading ? <span className="inline-block h-3 w-20 rounded bg-white/30 animate-pulse" /> : 'Load Full Diff'}
              </button>
            </div>
          ) : diffLoading ? (
            <div className="p-4 space-y-2 animate-pulse">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div key={idx} className="h-5 rounded bg-gray-700/50" />
              ))}
            </div>
          ) : !diff.trim() ? (
            <div className="p-4 text-center text-gray-500">
              No diff available (binary file or no changes)
            </div>
          ) : (
            <PerforceDiffView
              diffText={diff}
              ignoreFormattingNoise={ignoreFormattingNoise}
            />
          )
        )}
      </div>
    </div>
  )
}
