import { useState } from 'react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'

const actionColors: Record<string, string> = {
  add: 'text-p4-green',
  edit: 'text-p4-yellow',
  delete: 'text-p4-red',
  branch: 'text-p4-blue',
  'move/add': 'text-p4-green',
  'move/delete': 'text-p4-red',
  integrate: 'text-purple-400'
}

const actionIcons: Record<string, string> = {
  add: '+',
  edit: 'M',
  delete: '-',
  branch: 'B',
  'move/add': 'R',
  'move/delete': 'D',
  integrate: 'I'
}

export function FileList() {
  const {
    files,
    selectedFile,
    selectedChangelist,
    changelists,
    fetchDiff,
    checkedFiles,
    toggleFileCheck,
    setAllFilesChecked,
    refresh,
    clearSelection
  } = useP4Store()
  const toast = useToastContext()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: typeof files[0] } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showMoveToMenu, setShowMoveToMenu] = useState(false)

  const filteredFiles = files.filter(file => {
    if (selectedChangelist === 'default') {
      return file.changelist === 'default' || file.changelist === 0
    }
    return file.changelist === selectedChangelist
  })

  const checkedCount = filteredFiles.filter(f => checkedFiles.has(f.depotFile)).length
  const allChecked = filteredFiles.length > 0 && checkedCount === filteredFiles.length
  const someChecked = checkedCount > 0 && checkedCount < filteredFiles.length

  const getFileName = (path: string) => {
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1]
  }

  const getFilePath = (file: typeof files[0]) => {
    return file.clientFile || file.depotFile
  }

  const handleDragStart = (e: React.DragEvent, file: typeof files[0]) => {
    // If the dragged file is checked, drag all checked files
    // Otherwise, drag only this file
    const filesToDrag = checkedFiles.has(file.depotFile)
      ? filteredFiles.filter(f => checkedFiles.has(f.depotFile))
      : [file]

    const dragData = {
      files: filesToDrag.map(f => f.clientFile || f.depotFile),
      depotFiles: filesToDrag.map(f => f.depotFile)
    }
    e.dataTransfer.setData('application/json', JSON.stringify(dragData))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleContextMenu = (e: React.MouseEvent, file: typeof files[0]) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const handleRevert = async () => {
    if (!contextMenu) return

    const file = contextMenu.file
    const filePath = file.clientFile || file.depotFile

    if (!confirm(`Revert "${getFileName(filePath)}"? This cannot be undone.`)) {
      setContextMenu(null)
      return
    }

    setIsProcessing(true)
    setContextMenu(null)

    try {
      const result = await window.p4.revert([filePath])
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'File reverted',
          message: getFileName(filePath),
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Revert failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Revert failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRevertSelected = async () => {
    const selectedFiles = filteredFiles
      .filter(f => checkedFiles.has(f.depotFile))
      .map(f => f.clientFile || f.depotFile)

    if (selectedFiles.length === 0) {
      toast?.showToast({
        type: 'info',
        title: 'No files selected',
        duration: 3000
      })
      setContextMenu(null)
      return
    }

    if (!confirm(`Revert ${selectedFiles.length} file(s)? This cannot be undone.`)) {
      setContextMenu(null)
      return
    }

    setIsProcessing(true)
    setContextMenu(null)

    try {
      const result = await window.p4.revert(selectedFiles)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Reverted ${selectedFiles.length} file(s)`,
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Revert failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Revert failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMoveToJunk = async () => {
    if (!contextMenu) return

    const file = contextMenu.file
    // If the clicked file is checked, move all checked files; otherwise move just this file
    const filesToMove = checkedFiles.has(file.depotFile)
      ? filteredFiles.filter(f => checkedFiles.has(f.depotFile)).map(f => f.clientFile || f.depotFile)
      : [file.clientFile || file.depotFile]

    setIsProcessing(true)
    setContextMenu(null)
    setShowMoveToMenu(false)

    try {
      // Get or create junk changelist
      const junkResult = await window.p4.getOrCreateJunkChangelist()
      if (!junkResult.success) {
        toast?.showToast({
          type: 'error',
          title: 'Failed to create Junk changelist',
          message: junkResult.message,
          duration: 5000
        })
        return
      }

      // Move files to junk changelist
      const moveResult = await window.p4.reopenFiles(filesToMove, junkResult.changelistNumber)
      if (moveResult.success) {
        toast?.showToast({
          type: 'success',
          title: 'Moved to Junk',
          message: `${filesToMove.length} file(s) → CL #${junkResult.changelistNumber}`,
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Move failed',
          message: moveResult.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Move failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleMoveTo = async (targetChangelist: number | 'default') => {
    if (!contextMenu) return

    const file = contextMenu.file
    // If the clicked file is checked, move all checked files; otherwise move just this file
    const filesToMove = checkedFiles.has(file.depotFile)
      ? filteredFiles.filter(f => checkedFiles.has(f.depotFile)).map(f => f.clientFile || f.depotFile)
      : [file.clientFile || file.depotFile]

    const clNumber = targetChangelist === 'default' ? 0 : targetChangelist

    setIsProcessing(true)
    setContextMenu(null)
    setShowMoveToMenu(false)

    try {
      const moveResult = await window.p4.reopenFiles(filesToMove, clNumber)
      if (moveResult.success) {
        const targetName = targetChangelist === 'default' ? 'Default' : `#${targetChangelist}`
        toast?.showToast({
          type: 'success',
          title: filesToMove.length > 1 ? 'Files moved' : 'File moved',
          message: `${filesToMove.length} file(s) → ${targetName}`,
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Move failed',
          message: moveResult.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Move failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
    }
  }

  // Close context menu on click outside
  const handleClick = () => {
    setContextMenu(null)
    setShowMoveToMenu(false)
  }

  return (
    <div className="h-full flex flex-col" onClick={handleClick}>
      <div className="p-3 border-b border-p4-border flex items-center gap-2">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => {
              if (el) el.indeterminate = someChecked
            }}
            onChange={(e) => setAllFilesChecked(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-p4-blue focus:ring-offset-0"
          />
        </label>
        <h2 className="text-sm font-semibold text-gray-300">
          {checkedCount} / {filteredFiles.length} files
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No changed files
          </div>
        ) : (
          <ul>
            {filteredFiles.map((file, index) => {
              const isSelected = selectedFile?.depotFile === file.depotFile
              const isChecked = checkedFiles.has(file.depotFile)
              return (
                <li
                  key={file.depotFile + index}
                  draggable
                  onDragStart={(e) => handleDragStart(e, file)}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                  className={`
                    flex items-center gap-2 px-3 py-2 cursor-pointer
                    hover:bg-gray-800 transition-colors
                    ${isSelected ? 'bg-gray-700' : ''}
                  `}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      e.stopPropagation()
                      toggleFileCheck(file.depotFile)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-p4-blue focus:ring-offset-0"
                  />
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0"
                    onClick={() => fetchDiff(file)}
                  >
                    <span className={`font-mono text-sm ${actionColors[file.action] || 'text-gray-400'}`}>
                      {actionIcons[file.action] || '?'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">
                        {getFileName(getFilePath(file))}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {getFilePath(file)}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-p4-darker border border-p4-border rounded shadow-xl z-50 py-1 min-w-[220px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Move to... submenu */}
          <div className="relative">
            <button
              onClick={() => setShowMoveToMenu(!showMoveToMenu)}
              disabled={isProcessing}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between text-gray-200 disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <span>→</span>
                <span>
                  Move {checkedFiles.has(contextMenu.file.depotFile) && checkedCount > 1
                    ? `${checkedCount} files`
                    : 'to'}...
                </span>
              </span>
              <span className="text-gray-500">▶</span>
            </button>

            {/* Submenu */}
            {showMoveToMenu && (
              <div
                className="absolute left-full top-0 bg-p4-darker border border-p4-border rounded shadow-xl py-1 min-w-[180px] ml-1"
              >
                {changelists
                  .filter(cl => {
                    // Hide current changelist from the list
                    const currentCL = contextMenu.file.changelist
                    if (cl.number === 0) {
                      return currentCL !== 'default' && currentCL !== 0
                    }
                    return cl.number !== currentCL
                  })
                  .map(cl => (
                    <button
                      key={cl.number}
                      onClick={() => handleMoveTo(cl.number === 0 ? 'default' : cl.number)}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 text-gray-200 truncate"
                    >
                      {cl.number === 0 ? 'Default' : `#${cl.number}`}
                      <span className="text-gray-500 ml-2 text-xs truncate">
                        {cl.description.slice(0, 20)}{cl.description.length > 20 ? '...' : ''}
                      </span>
                    </button>
                  ))}
                <div className="border-t border-p4-border my-1" />
                <button
                  onClick={handleMoveToJunk}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 text-yellow-400"
                >
                  + New Junk Changelist
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-p4-border my-1" />

          {/* Revert */}
          <button
            onClick={handleRevert}
            disabled={isProcessing}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 text-red-400 disabled:opacity-50"
          >
            <span>↩</span>
            <span>Revert This File</span>
          </button>
          {checkedCount > 1 && (
            <button
              onClick={handleRevertSelected}
              disabled={isProcessing}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 text-red-400 disabled:opacity-50"
            >
              <span>↩</span>
              <span>Revert Selected ({checkedCount})</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
