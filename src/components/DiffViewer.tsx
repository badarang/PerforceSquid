import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'

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
    line.startsWith('@@') || line.startsWith('====') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')

  // Pair brace-only add/delete lines within the same hunk even when they are
  // not adjacent. This removes common trailing-brace false positives.
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

  // Pair equal -/+ lines within a nearby change block so unchanged lines
  // (reordered by diff alignment) are rendered as context instead of noise.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('-') || lines[i].startsWith('---')) continue
    const minusContent = comparable(lines[i].slice(1))
    if (!minusContent) continue

    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      const candidate = lines[j]
      if (candidate.startsWith('@@') || candidate.startsWith('====') || candidate.startsWith('---') || candidate.startsWith('+++') || candidate.startsWith('diff ')) {
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

    if (line.startsWith('-')) {
      if (pairedMinus.has(i)) {
        result.push({
          type: 'context',
          content: line.slice(1),
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++
        })
        continue
      }
      if (braceOnly(line.slice(1))) {
        oldLineNum++
        continue
      }
      result.push({ type: 'delete', content: line.slice(1), oldLineNum: oldLineNum++ })
      continue
    }

    if (line.startsWith('+')) {
      if (pairedPlus.has(i)) {
        continue
      }
      if (braceOnly(line.slice(1))) {
        newLineNum++
        continue
      }
      result.push({ type: 'add', content: line.slice(1), newLineNum: newLineNum++ })
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

function getLanguage(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': return 'javascript'
    case 'css': return 'css'
    case 'html': return 'html'
    case 'json': return 'json'
    case 'md': return 'markdown'
    case 'py': return 'python'
    case 'cpp': case 'h': case 'c': return 'cpp'
    case 'java': return 'java'
    case 'cs': return 'csharp'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'xml': return 'xml'
    case 'yml': case 'yaml': return 'yaml'
    case 'sql': return 'sql'
    case 'sh': return 'shell'
    default: return 'plaintext'
  }
}

interface DiffViewerProps {
  isStandalone?: boolean
  initialMode?: 'diff' | 'edit'
}

export function DiffViewer({ isStandalone = false, initialMode = 'diff' }: DiffViewerProps) {
  const { selectedFile, currentDiff, isDiffLoading, fetchDiff } = useP4Store()
  const toast = useToastContext()
  const [viewMode, setViewMode] = useState<'diff' | 'blame'>('diff')
  const [blameData, setBlameData] = useState<BlameLine[]>([])
  const [blameLoading, setBlameLoading] = useState(false)
  const [blameError, setBlameError] = useState<string | null>(null)

  // Edit State
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isEditLoading, setIsEditLoading] = useState(false)

  // Reset when file changes
  useEffect(() => {
    setViewMode('diff')
    setBlameData([])
    setBlameError(null)
    setIsEditing(false)
    setEditContent('')
  }, [selectedFile?.depotFile])

  // Handle initial mode (e.g. from DiffWindow)
  useEffect(() => {
    if (initialMode === 'edit' && selectedFile && !isEditing) {
       handleEditClick()
    }
  }, [initialMode, selectedFile])

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

  const handleStatusClick = async () => {
    if (isEditing) return

    if (isStandalone) {
      // In standalone window, toggle edit in-place
      handleEditClick()
    } else {
      // In main window, open new window in edit mode
      window.p4.openDiffWindow(selectedFile, 'edit')
    }
  }

  const handleEditClick = async () => {
    if (!selectedFile) return
    const filePath = selectedFile.clientFile || selectedFile.depotFile
    
    setIsEditLoading(true)
    try {
      const result = await window.p4.readFile(filePath)
      if (result.success && result.content !== undefined) {
        setEditContent(result.content)
        setIsEditing(true)
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Failed to read file',
          message: result.message || 'Unknown error',
          duration: 4000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Error reading file',
        message: err.message,
        duration: 4000
      })
    } finally {
      setIsEditLoading(false)
    }
  }

  const handleSaveClick = async () => {
    if (!selectedFile) return
    const filePath = selectedFile.clientFile || selectedFile.depotFile
    
    setIsSaving(true)
    try {
      const result = await window.p4.saveFile(filePath, editContent)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'File saved',
          message: 'Changes saved successfully',
          duration: 2000
        })
        setIsEditing(false)
        // Refresh diff
        fetchDiff(selectedFile)
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Failed to save',
          message: result.message || 'Unknown error',
          duration: 4000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Error saving file',
        message: err.message,
        duration: 4000
      })
    } finally {
      setIsSaving(false)
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

  if (isDiffLoading || isEditLoading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="animate-pulse">Loading...</div>
      </div>
    )
  }

  const fileName = selectedFile.clientFile || selectedFile.depotFile
  const shortName = fileName.split(/[/\\]/).pop()

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
      <div className="diff-view font-mono text-[13px]">
        {diffLines.map((line, index) => {
          if (line.type === 'hunk') {
            return (
              <div key={index} className="bg-gray-700 text-gray-400 px-4 py-1 text-xs border-y border-gray-600">
                {line.content}
              </div>
            )
          }

          const lineClass = line.type === 'add' ? 'bg-[#1e2a25] text-[#4bb77e]' :
                            line.type === 'delete' ? 'bg-[#2a1e1e] text-[#ef5350]' :
                            'text-gray-300'

          // Blame Info lookup
          let blameInfo = null
          if (viewMode === 'blame' && blameData.length > 0) {
             // For context and delete, we have an old line number which maps to the depot file
             if ((line.type === 'context' || line.type === 'delete') && line.oldLineNum) {
               // oldLineNum is 1-based, blameData is 0-indexed
               const blame = blameData[line.oldLineNum - 1]
               if (blame) {
                 const colors = getUserColors(blame.user)
                 // Check if previous line had same blame to group visually (optional, simple for now)
                 blameInfo = (
                   <div 
                     className="flex items-center gap-2 px-2 overflow-hidden whitespace-nowrap border-r border-gray-700 select-none opacity-80 hover:opacity-100"
                     style={{ width: '160px', backgroundColor: colors.bg, color: colors.text }}
                     title={`CL ${blame.changelist} by ${blame.user} on ${blame.date}`}
                   >
                     <span className="font-medium truncate flex-1">{blame.user}</span>
                     <span className="text-[10px] opacity-70 w-[65px] text-right">{blame.date.split(' ')[0]}</span>
                   </div>
                 )
               }
             } else if (line.type === 'add') {
               // For added lines, it's a local change
               blameInfo = (
                 <div 
                   className="flex items-center px-2 border-r border-gray-700 select-none"
                   style={{ width: '160px', backgroundColor: 'rgba(255,255,255,0.02)' }}
                 >
                   <span className="text-gray-500 italic text-xs">You</span>
                 </div>
               )
             } else {
               // Spacer
                blameInfo = (
                 <div 
                   className="border-r border-gray-700"
                   style={{ width: '160px', backgroundColor: 'rgba(255,255,255,0.02)' }}
                 />
               )
             }
          }

          return (
            <div key={index} className={`flex hover:brightness-110 ${lineClass}`}>
              {/* Blame Gutter */}
              {viewMode === 'blame' && blameInfo}
              
              {/* Line Numbers */}
              <div className="flex select-none text-gray-600 text-[11px] font-mono leading-[20px]">
                 <div className="w-[40px] text-right pr-2 border-r border-gray-800 opacity-60">
                   {line.type === 'add' ? '' : line.oldLineNum || ''}
                 </div>
                 <div className="w-[40px] text-right pr-2 border-r border-gray-700 opacity-60">
                   {line.type === 'delete' ? '' : line.newLineNum || ''}
                 </div>
              </div>

              {/* Content */}
              <div className="flex-1 px-4 leading-[20px] whitespace-pre overflow-hidden">
                <span className="inline-block w-[10px] opacity-50 select-none">
                  {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                </span>
                {line.content}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Render Editor
  const renderEditor = () => {
    const filePath = selectedFile.clientFile || selectedFile.depotFile
    const language = getLanguage(filePath)

    return (
      <div className="w-full h-full bg-[#1e1e1e]">
        <Editor
          height="100%"
          defaultLanguage={language}
          language={language}
          theme="vs-dark"
          value={editContent}
          onChange={(value) => setEditContent(value || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            padding: { top: 16, bottom: 16 }
          }}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-p4-border flex items-center justify-between bg-[#1e1e1e]">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-200 truncate">{shortName}</h2>
          <p className="text-xs text-gray-500 truncate">{fileName}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 ml-4">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveClick}
                disabled={isSaving}
                className="px-3 py-1 text-xs font-medium bg-green-700 text-green-100 rounded hover:bg-green-600 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="px-3 py-1 text-xs font-medium bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="w-px h-4 bg-gray-700 mx-2"></div>

              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none hover:text-white">
                <input 
                  type="checkbox"
                  checked={viewMode === 'blame'}
                  onChange={(e) => setViewMode(e.target.checked ? 'blame' : 'diff')}
                  className="rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-offset-gray-800"
                />
                Show Blame
              </label>

              <div className="w-px h-4 bg-gray-700 mx-2"></div>

              <button 
                onClick={handleStatusClick}
                title={isStandalone ? "Click to Edit" : "Open Edit Window"}
                className={`px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 ${
                selectedFile.action === 'add' ? 'bg-green-900 text-green-300' :
                selectedFile.action === 'edit' ? 'bg-yellow-900 text-yellow-300' :
                selectedFile.action === 'delete' ? 'bg-red-900 text-red-300' :
                'bg-gray-700 text-gray-300'
              }`}>
                {selectedFile.action.toUpperCase()}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-[#1e1e1e]">
        {isEditing ? (
          renderEditor()
        ) : viewMode === 'blame' && blameError ? (
           <div className="h-full flex items-center justify-center text-gray-500">
             <div className="text-center">
               <div className="text-red-400 mb-2">Failed to load annotation</div>
               <div className="text-xs">{blameError}</div>
               <button onClick={loadBlameData} className="mt-2 text-xs text-p4-blue hover:underline">Retry</button>
             </div>
           </div>
        ) : blameLoading && viewMode === 'blame' && blameData.length === 0 ? (
           <div className="h-full flex items-center justify-center text-gray-500">
             <div className="animate-pulse flex flex-col items-center">
               <span className="mb-2">Loading annotation...</span>
               <span className="text-xs">Fetching file history from server</span>
             </div>
           </div>
        ) : (
          renderDiffView()
        )}
      </div>
    </div>
  )
}
