import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'
import { PerforceDiffView } from './PerforceDiffView'

interface BlameLine {
  lineNumber: number
  changelist: number
  user: string
  date: string
  content: string
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
  const [ignoreFormattingNoise, setIgnoreFormattingNoise] = useState(true)
  const [blameData, setBlameData] = useState<BlameLine[]>([])
  const [blameLoading, setBlameLoading] = useState(false)
  const [blameError, setBlameError] = useState<string | null>(null)

  // Edit State
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isEditLoading, setIsEditLoading] = useState(false)
  const [usePlainTextEditor, setUsePlainTextEditor] = useState(false)
  const monacoMountedRef = useRef(false)

  // Reset when file changes
  useEffect(() => {
    setViewMode('diff')
    setBlameData([])
    setBlameError(null)
    setIsEditing(false)
    setEditContent('')
    setUsePlainTextEditor(false)
    monacoMountedRef.current = false
  }, [selectedFile?.depotFile])

  // Handle initial mode (e.g. from DiffWindow)
  useEffect(() => {
    if (initialMode === 'edit' && selectedFile && !isEditing) {
       handleEditClick()
    }
  }, [initialMode, selectedFile])

  useEffect(() => {
    if (!isEditing) {
      setUsePlainTextEditor(false)
      monacoMountedRef.current = false
      return
    }

    setUsePlainTextEditor(false)
    monacoMountedRef.current = false

    const timeoutId = window.setTimeout(() => {
      if (!monacoMountedRef.current) {
        setUsePlainTextEditor(true)
      }
    }, 2500)

    return () => window.clearTimeout(timeoutId)
  }, [isEditing, selectedFile?.depotFile])

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

  const exitEditMode = () => {
    setIsEditing(false)
    setUsePlainTextEditor(false)
    monacoMountedRef.current = false

    if (selectedFile && !currentDiff && !isDiffLoading) {
      void fetchDiff(selectedFile)
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

  if (isEditLoading || (isDiffLoading && !isEditing)) {
    return (
      <div className="h-full p-3 space-y-2 animate-pulse">
        {Array.from({ length: 12 }).map((_, idx) => (
          <div key={idx} className="h-5 rounded bg-gray-700/50" />
        ))}
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

    return (
      <PerforceDiffView
        diffText={currentDiff.hunks}
        fallbackPath={selectedFile.depotFile || currentDiff.filePath}
        fallbackAction={selectedFile.action}
        showFileHeaders={false}
        ignoreFormattingNoise={ignoreFormattingNoise}
      />
    )
  }

  // Render Editor
  const renderEditor = () => {
    const filePath = selectedFile.clientFile || selectedFile.depotFile
    const language = getLanguage(filePath)

    if (usePlainTextEditor) {
      return (
        <div className="w-full h-full bg-[#1e1e1e] flex flex-col">
          <div className="px-4 py-2 text-xs text-amber-300 border-b border-amber-900/60 bg-amber-950/20">
            Monaco editor initialization timed out. Using plain text editor for this file.
          </div>
          <textarea
            value={editContent}
            onChange={(event) => setEditContent(event.target.value)}
            spellCheck={false}
            className="flex-1 w-full resize-none border-0 bg-[#1e1e1e] px-4 py-4 text-[13px] leading-6 text-gray-100 outline-none"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
          />
        </div>
      )
    }

    return (
      <div className="w-full h-full bg-[#1e1e1e]">
        <Editor
          height="100%"
          defaultLanguage={language}
          language={language}
          theme="vs-dark"
          value={editContent}
          onChange={(value) => setEditContent(value || '')}
          loading={
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              Loading editor...
            </div>
          }
          onMount={() => {
            monacoMountedRef.current = true
          }}
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
                onClick={exitEditMode}
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

              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none hover:text-white">
                <input
                  type="checkbox"
                  checked={ignoreFormattingNoise}
                  onChange={(e) => setIgnoreFormattingNoise(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-offset-gray-800"
                />
                Ignore formatting noise
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
           <div className="h-full p-3 space-y-2 animate-pulse">
             {Array.from({ length: 10 }).map((_, idx) => (
               <div key={idx} className="h-5 rounded bg-gray-700/50" />
             ))}
           </div>
        ) : (
          renderDiffView()
        )}
      </div>
    </div>
  )
}
