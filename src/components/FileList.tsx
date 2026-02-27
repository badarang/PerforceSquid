import { useEffect, useState } from 'react'
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
    setCheckedList,
    setSelectedChangelist,
    refresh,
    clearSelection,
    setLoading,
    setFiles
  } = useP4Store()
  const toast = useToastContext()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: typeof files[0] } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showMoveToMenu, setShowMoveToMenu] = useState(false)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  
  // Grouping state
  const [isShelvedExpanded, setShelvedExpanded] = useState(true)
  const [lastClickedSource, setLastClickedSource] = useState<'shelved' | 'opened' | null>(null)
  const [hasCachedReviewLink, setHasCachedReviewLink] = useState(false)

  const filteredFiles = files.filter(file => {
    if (selectedChangelist === 'default') {
      return file.changelist === 'default' || file.changelist === 0
    }
    return file.changelist === selectedChangelist
  })
  
  const shelvedFiles = filteredFiles.filter(f => f.status === 'shelved')
  const openedFiles = filteredFiles.filter(f => f.status !== 'shelved')

  const checkedCount = filteredFiles.filter(f => checkedFiles.has(f.depotFile)).length
  const allChecked = filteredFiles.length > 0 && checkedCount === filteredFiles.length
  const someChecked = checkedCount > 0 && checkedCount < filteredFiles.length

  const currentChangelistObj = changelists.find(c => 
    (selectedChangelist === 'default' && c.number === 0) || c.number === selectedChangelist
  )
  useEffect(() => {
    let disposed = false
    const loadCachedReviewLink = async () => {
      const clNumber = selectedChangelist === 'default' ? 0 : selectedChangelist
      if (typeof clNumber !== 'number' || clNumber <= 0) {
        setHasCachedReviewLink(false)
        return
      }
      try {
        const url = await window.settings.getReviewLink(clNumber)
        if (!disposed) setHasCachedReviewLink(!!url)
      } catch {
        if (!disposed) setHasCachedReviewLink(false)
      }
    }
    loadCachedReviewLink()
    return () => {
      disposed = true
    }
  }, [selectedChangelist, changelists.length])

  const isReviewRequested =
    !!currentChangelistObj?.reviewId ||
    !!currentChangelistObj?.reviewStatus ||
    !!currentChangelistObj?.description?.includes('#review') ||
    hasCachedReviewLink

  const getFileName = (path: string) => {
    // Strip trailing separators and split
    const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
    return parts[parts.length - 1] || path
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

  const handleFileClick = (e: React.MouseEvent, file: typeof files[0], index: number, source: 'shelved' | 'opened') => {
    if (e.shiftKey && lastClickedIndex !== null && lastClickedSource === source) {
      // Range selection within same group
      const sourceList = source === 'shelved' ? shelvedFiles : openedFiles
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      
      const filesInRange = sourceList.slice(start, end + 1)
      const newCheckedPaths = filesInRange.map(f => f.depotFile)
      
      setCheckedList(newCheckedPaths)
    } else {
      // Single click
      setLastClickedIndex(index)
      setLastClickedSource(source)
      // Single-click selects only this file.
      setCheckedList([file.depotFile])
      fetchDiff(file)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, file: typeof files[0]) => {
    e.preventDefault()
    
    // If right-clicked file is NOT in the checked set, select it exclusively
    if (!checkedFiles.has(file.depotFile)) {
      setCheckedList([file.depotFile])
      fetchDiff(file) // Also view it
      
      const source = file.status === 'shelved' ? 'shelved' : 'opened'
      const sourceList = source === 'shelved' ? shelvedFiles : openedFiles
      const index = sourceList.findIndex(f => f.depotFile === file.depotFile)
      if (index !== -1) {
        setLastClickedIndex(index)
        setLastClickedSource(source)
      }
    }
    
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const handleRevert = async () => {
    if (!contextMenu) return

    const file = contextMenu.file
    const filePath = file.depotFile

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
      .map(f => f.depotFile)

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

  const handleMoveToNewChangelist = async () => {
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
      const createResult = await window.p4.createChangelist('New changelist')
      if (!createResult.success) {
        toast?.showToast({
          type: 'error',
          title: 'Failed to create changelist',
          message: createResult.message,
          duration: 5000
        })
        return
      }

      const moveResult = await window.p4.reopenFiles(filesToMove, createResult.changelistNumber)
      if (moveResult.success) {
        toast?.showToast({
          type: 'success',
          title: 'Moved to New Changelist',
          message: `${filesToMove.length} file(s) → CL #${createResult.changelistNumber}`,
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

  const handleShelve = async () => {
    if (!contextMenu) return

    const selectedFiles = filteredFiles
      .filter(f => checkedFiles.has(f.depotFile) && f.status !== 'shelved')
      .map(f => f.depotFile)

    if (selectedFiles.length === 0) return

    // Clear selection immediately to hide the "revert" process from DiffViewer
    clearSelection()
    setIsProcessing(true)
    setLoading(true)
    setContextMenu(null)

    try {
      let clNumber = contextMenu.file.changelist === 'default' ? 0 : contextMenu.file.changelist
      
      // If trying to shelve to default changelist (0), we must create a new changelist first
      if (clNumber === 0) {
        if (!confirm('Cannot shelve to Default changelist. Create a new changelist and shelve?')) {
          setIsProcessing(false)
          setLoading(false)
          return
        }

        const createResult = await window.p4.createChangelist('Shelved files')
        if (!createResult.success) {
          throw new Error(createResult.message)
        }
        
        clNumber = createResult.changelistNumber
        
        // Move files to the new changelist
        const moveResult = await window.p4.reopenFiles(selectedFiles, clNumber)
        if (!moveResult.success) {
          throw new Error('Failed to move files to new changelist: ' + moveResult.message)
        }

        // Switch view to the new changelist
        setSelectedChangelist(clNumber)
      }

      if (typeof clNumber !== 'number') return 

      const result = await window.p4.shelve(clNumber, selectedFiles)
      if (result.success) {
        // Revert files after shelving to "move" them to shelf (prevent duplication)
        try {
          await window.p4.revert(selectedFiles)
          
          // Optimistic Update: Update local state immediately to avoid UI flickering
          const newFiles = files.filter(f => {
            // Remove existing shelved copies of the selected files (they are being overwritten)
            if (selectedFiles.includes(f.depotFile) && f.status === 'shelved') {
              return false
            }
            return true
          }).map(f => {
            // Convert open files to shelved
            if (selectedFiles.includes(f.depotFile) && f.status !== 'shelved') {
              return { ...f, status: 'shelved' as const }
            }
            return f
          })
          setFiles(newFiles)

          toast?.showToast({
            type: 'success',
            title: 'Shelve Successful',
            message: `${selectedFiles.length} file(s) moved to shelf`,
            duration: 3000
          })
          refresh()
        } catch (revertErr: any) {
           toast?.showToast({
            type: 'info',
            title: 'Shelved with warning',
            message: 'Files shelved but failed to revert: ' + revertErr.message,
            duration: 5000
          })
          await refresh()
        }
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Shelve failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Shelve failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
      setLoading(false)
    }
  }

  const handleUnshelve = async () => {
    if (!contextMenu) return

    const selectedFiles = filteredFiles
      .filter(f => checkedFiles.has(f.depotFile) && f.status === 'shelved')
      .map(f => f.depotFile)

    if (selectedFiles.length === 0) return

    // Clear selection immediately to hide intermediate states
    clearSelection()
    setIsProcessing(true)
    setLoading(true)
    setContextMenu(null)

    try {
      const clNumber = contextMenu.file.changelist === 'default' ? 0 : contextMenu.file.changelist
      if (typeof clNumber !== 'number') return

      // Unshelve only: keep files on shelf (do not delete shelved copies).
      const result = await window.p4.unshelve(clNumber, selectedFiles)
      
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'Unshelve Successful',
          message: `${selectedFiles.length} file(s) restored to workspace (shelf kept)`,
          duration: 3000
        })
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Unshelve failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Unshelve failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
      setLoading(false)
    }
  }

  const handleDeleteShelve = async () => {
    if (!contextMenu) return

    const selectedFiles = filteredFiles
      .filter(f => checkedFiles.has(f.depotFile) && f.status === 'shelved')
      .map(f => f.depotFile)

    if (selectedFiles.length === 0) return

    if (!confirm(`Delete shelved files? This cannot be undone.`)) {
      setContextMenu(null)
      return
    }

    setIsProcessing(true)
    setLoading(true)
    setContextMenu(null)

    try {
      const clNumber = contextMenu.file.changelist === 'default' ? 0 : contextMenu.file.changelist
      if (typeof clNumber !== 'number') return

      const result = await window.p4.deleteShelve(clNumber, selectedFiles)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'Deleted shelved files',
          message: `${selectedFiles.length} file(s) deleted from shelf`,
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Delete shelve failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Delete shelve failed',
        message: err.message,
        duration: 5000
      })
    } finally {
      setIsProcessing(false)
      setLoading(false)
    }
  }

  // Close context menu on click outside
  const handleClick = () => {
    setContextMenu(null)
    setShowMoveToMenu(false)
  }

  const renderFileItem = (file: typeof files[0], index: number, source: 'shelved' | 'opened') => {
    const isSelected = selectedFile?.depotFile === file.depotFile
    const isChecked = checkedFiles.has(file.depotFile)
    const paddingClass = source === 'shelved' ? 'pl-9 pr-3' : 'px-3'
    
    return (
      <li
        key={file.depotFile}
        draggable
        onDragStart={(e) => handleDragStart(e, file)}
        onContextMenu={(e) => handleContextMenu(e, file)}
        onClick={(e) => handleFileClick(e, file, index, source)}
        onDoubleClick={() => window.p4.openDiffWindow(file)}
        className={`
          flex items-center gap-2 ${paddingClass} py-2 cursor-pointer
          hover:bg-gray-800 transition-colors
          ${isSelected ? 'bg-gray-700' : isChecked ? 'bg-gray-800' : ''}
        `}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation()
            toggleFileCheck(file.depotFile)
            setLastClickedIndex(index)
            setLastClickedSource(source)
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-p4-blue focus:ring-p4-blue focus:ring-offset-0"
        />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`font-mono text-sm ${actionColors[file.action] || 'text-gray-400'}`}>
            {actionIcons[file.action] || '?'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div 
                className="text-sm text-gray-200 truncate" 
                title={getFileName(getFilePath(file))}
              >
                {getFileName(getFilePath(file))}
              </div>
            </div>
            <div className="text-xs text-gray-500 truncate" title={getFilePath(file)}>
              {getFilePath(file)}
            </div>
          </div>
        </div>
      </li>
    )
  }

  const isShelved = contextMenu?.file.status === 'shelved'

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
          <>
            {/* Shelved Files Section */}
            {shelvedFiles.length > 0 && (
              <div className="border-b border-p4-border/50">
                <div 
                  className="px-3 py-1.5 bg-p4-darker hover:bg-gray-800 cursor-pointer flex items-center gap-2 select-none"
                  onClick={(e) => { e.stopPropagation(); setShelvedExpanded(!isShelvedExpanded); }}
                >
                  <span className={`text-xs ${isReviewRequested ? 'text-purple-300' : 'text-gray-400'}`}>
                    {isShelvedExpanded ? '▼' : '▶'}
                  </span>
                  <span className={`text-xs ${isReviewRequested ? 'text-purple-300' : 'text-yellow-500/80'}`}>
                    {isReviewRequested ? '🟣' : '📦'}
                  </span>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isReviewRequested ? 'text-purple-300' : 'text-yellow-500/80'}`}>
                    {isReviewRequested ? 'Shelved Files (PR Requested)' : 'Shelved Files'}
                  </span>
                  <span className={`text-xs px-1.5 rounded-full ${isReviewRequested ? 'text-purple-200 bg-purple-900/40' : 'text-gray-500 bg-gray-800'}`}>
                    {shelvedFiles.length}
                  </span>
                </div>
                {isShelvedExpanded && (
                  <ul>
                    {shelvedFiles.map((file, index) => renderFileItem(file, index, 'shelved'))}
                  </ul>
                )}
              </div>
            )}

            {/* Opened Files Section */}
            {openedFiles.length > 0 && (
              <ul>
                {openedFiles.map((file, index) => renderFileItem(file, index, 'opened'))}
              </ul>
            )}
          </>
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
                  onClick={handleMoveToNewChangelist}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 text-p4-blue"
                >
                  + New Changelist
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-p4-border my-1" />

          {/* Shelve Actions */}
          {!isShelved && (
            <button
              onClick={handleShelve}
              disabled={isProcessing}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-200 disabled:opacity-50"
            >
              <span>☁</span>
              <span>Shelve Files</span>
            </button>
          )}

          {isShelved && (
            <>
              <button
                onClick={handleUnshelve}
                disabled={isProcessing}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-200 disabled:opacity-50"
              >
                <span>▼</span>
                <span>Unshelve Files</span>
              </button>
              <button
                onClick={handleDeleteShelve}
                disabled={isProcessing}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 text-red-400 disabled:opacity-50"
              >
                <span>✕</span>
                <span>Delete Shelve</span>
              </button>
            </>
          )}

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
