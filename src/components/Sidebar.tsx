import { useState } from 'react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'

interface ContextMenuState {
  x: number
  y: number
  changelist: number
  fileCount: number
}

export function Sidebar() {
  const {
    info,
    changelists,
    selectedChangelist,
    setSelectedChangelist,
    files,
    refresh
  } = useP4Store()
  const toast = useToastContext()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deletingChangelist, setDeletingChangelist] = useState<number | null>(null)
  const [shelvingChangelist, setShelvingChangelist] = useState<number | null>(null)
  const [showNewCLInput, setShowNewCLInput] = useState(false)
  const [newCLDescription, setNewCLDescription] = useState('')
  const [creatingCL, setCreatingCL] = useState(false)
  const [dragOverCL, setDragOverCL] = useState<number | null>(null)

  const getFileCount = (clNumber: number | 'default') => {
    return files.filter(f => {
      if (clNumber === 'default' || clNumber === 0) {
        return f.changelist === 'default' || f.changelist === 0
      }
      return f.changelist === clNumber
    }).length
  }

  const handleContextMenu = (e: React.MouseEvent, clNumber: number, fileCount: number) => {
    if (clNumber === 0) return // Don't show context menu for default changelist
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, changelist: clNumber, fileCount })
  }

  const handleDelete = async () => {
    if (!contextMenu) return
    const { changelist, fileCount } = contextMenu

    if (fileCount > 0) {
      toast?.showToast({
        type: 'error',
        title: 'Cannot delete',
        message: 'Changelist has files. Use "Revert & Delete" instead.',
        duration: 4000
      })
      setContextMenu(null)
      return
    }

    setDeletingChangelist(changelist)
    setContextMenu(null)

    try {
      const result = await window.p4.deleteChangelist(changelist)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Changelist #${changelist} deleted`,
          duration: 3000
        })
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Delete failed',
          message: result.message,
          duration: 5000
        })
      }
    } finally {
      setDeletingChangelist(null)
    }
  }

  const handleRevertAndDelete = async () => {
    if (!contextMenu) return
    const { changelist, fileCount } = contextMenu

    if (!confirm(`Revert ${fileCount} file(s) and delete changelist #${changelist}?`)) {
      setContextMenu(null)
      return
    }

    setDeletingChangelist(changelist)
    setContextMenu(null)

    try {
      const result = await window.p4.revertAndDeleteChangelist(changelist)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Changelist #${changelist} deleted`,
          message: `Reverted ${fileCount} file(s)`,
          duration: 3000
        })
        setSelectedChangelist('default')
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Delete failed',
          message: result.message,
          duration: 5000
        })
      }
    } finally {
      setDeletingChangelist(null)
    }
  }

  const handleShelve = async () => {
    if (!contextMenu) return
    const { changelist, fileCount } = contextMenu

    if (fileCount === 0) {
      toast?.showToast({
        type: 'error',
        title: 'Cannot shelve',
        message: 'No files in changelist to shelve',
        duration: 4000
      })
      setContextMenu(null)
      return
    }

    setShelvingChangelist(changelist)
    setContextMenu(null)

    try {
      const result = await window.p4.shelve(changelist)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Shelved #${changelist}`,
          message: `${fileCount} file(s) saved to server`,
          duration: 3000
        })
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Shelve failed',
          message: result.message,
          duration: 5000
        })
      }
    } finally {
      setShelvingChangelist(null)
    }
  }

  const handleClick = () => setContextMenu(null)

  const handleCreateChangelist = async () => {
    if (!newCLDescription.trim()) {
      toast?.showToast({
        type: 'error',
        title: 'Description required',
        message: 'Please enter a changelist description',
        duration: 3000
      })
      return
    }

    setCreatingCL(true)
    try {
      const result = await window.p4.createChangelist(newCLDescription.trim())
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Changelist #${result.changelistNumber} created`,
          duration: 3000
        })
        setShowNewCLInput(false)
        setNewCLDescription('')
        await refresh()
        setSelectedChangelist(result.changelistNumber)
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Failed to create changelist',
          message: result.message,
          duration: 5000
        })
      }
    } finally {
      setCreatingCL(false)
    }
  }

  const handleUnshelve = async () => {
    if (!contextMenu) return
    const { changelist } = contextMenu

    setShelvingChangelist(changelist)
    setContextMenu(null)

    try {
      const result = await window.p4.unshelve(changelist)
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: `Unshelved #${changelist}`,
          message: 'Files restored to workspace',
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
    } finally {
      setShelvingChangelist(null)
    }
  }

  const handleDragOver = (e: React.DragEvent, clNumber: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCL(clNumber)
  }

  const handleDragLeave = () => {
    setDragOverCL(null)
  }

  const handleDrop = async (e: React.DragEvent, targetCL: number) => {
    e.preventDefault()
    setDragOverCL(null)

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (!data.files || data.files.length === 0) return

      const result = await window.p4.reopenFiles(data.files, targetCL)
      if (result.success) {
        const targetName = targetCL === 0 ? 'Default' : `#${targetCL}`
        toast?.showToast({
          type: 'success',
          title: 'Files moved',
          message: `${data.files.length} file(s) → ${targetName}`,
          duration: 3000
        })
        await refresh()
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Move failed',
          message: result.message,
          duration: 5000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Move failed',
        message: err.message || 'Invalid drag data',
        duration: 5000
      })
    }
  }

  return (
    <div className="h-full flex flex-col bg-p4-darker" onClick={handleClick}>
      {/* Connection Info */}
      <div className="p-3 border-b border-p4-border">
        <div className="text-xs text-gray-500 mb-1">Connected to</div>
        <div className="text-sm font-medium text-gray-200 truncate">
          {info?.serverAddress || 'Not connected'}
        </div>
        <div className="text-xs text-gray-400 truncate mt-1">
          {info?.clientName || '-'}
        </div>
      </div>

      {/* Changelists */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Pending Changelists
          </span>
          <button
            onClick={() => setShowNewCLInput(true)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="New Changelist"
          >
            <span className="text-lg leading-none">+</span>
          </button>
        </div>

        {/* New Changelist Input */}
        {showNewCLInput && (
          <div className="px-3 pb-3">
            <input
              type="text"
              value={newCLDescription}
              onChange={(e) => setNewCLDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateChangelist()
                if (e.key === 'Escape') {
                  setShowNewCLInput(false)
                  setNewCLDescription('')
                }
              }}
              placeholder="Changelist description..."
              className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-p4-border rounded focus:outline-none focus:border-p4-blue"
              autoFocus
              disabled={creatingCL}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleCreateChangelist}
                disabled={creatingCL || !newCLDescription.trim()}
                className="flex-1 px-2 py-1 text-xs bg-p4-blue text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {creatingCL ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowNewCLInput(false)
                  setNewCLDescription('')
                }}
                disabled={creatingCL}
                className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <ul>
          {changelists.map((cl) => {
            const clId = cl.number === 0 ? 'default' : cl.number
            const isSelected = selectedChangelist === clId ||
              (selectedChangelist === 'default' && cl.number === 0)
            const fileCount = getFileCount(cl.number)
            const isDeleting = deletingChangelist === cl.number

            if (isDeleting) {
              return (
                <li
                  key={cl.number}
                  className="px-3 py-2 opacity-40 pointer-events-none"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-gray-400">Deleting #{cl.number}...</span>
                  </div>
                </li>
              )
            }

            const isDragOver = dragOverCL === cl.number

            return (
              <li
                key={cl.number}
                onClick={() => setSelectedChangelist(clId as number | 'default')}
                onContextMenu={(e) => handleContextMenu(e, cl.number, fileCount)}
                onDragOver={(e) => handleDragOver(e, cl.number)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, cl.number)}
                className={`
                  px-3 py-2 cursor-pointer transition-colors
                  ${isSelected ? 'bg-p4-blue text-white' : 'hover:bg-gray-800'}
                  ${isDragOver ? 'ring-2 ring-p4-blue ring-inset bg-p4-blue/20' : ''}
                `}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {cl.number === 0 ? 'Default' : `#${cl.number}`}
                  </span>
                  {fileCount > 0 && (
                    <span className={`
                      text-xs px-1.5 py-0.5 rounded
                      ${isSelected ? 'bg-white/20' : 'bg-gray-700'}
                    `}>
                      {fileCount}
                    </span>
                  )}
                </div>
                <div className={`text-xs truncate mt-0.5 ${isSelected ? 'text-white/70' : 'text-gray-500'}`}>
                  {cl.description}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-p4-darker border border-p4-border rounded shadow-xl z-50 py-1 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-p4-border">
            Changelist #{contextMenu.changelist}
          </div>

          {/* Shelve option - only when there are files */}
          {contextMenu.fileCount > 0 && (
            <button
              onClick={handleShelve}
              disabled={shelvingChangelist !== null || deletingChangelist !== null}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 text-p4-blue disabled:opacity-50 flex items-center gap-2"
            >
              <span className="w-4 text-center">↑</span>
              <span>Shelve ({contextMenu.fileCount} files)</span>
            </button>
          )}

          {/* Unshelve option - always available for numbered changelists */}
          <button
            onClick={handleUnshelve}
            disabled={shelvingChangelist !== null || deletingChangelist !== null}
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 text-green-400 disabled:opacity-50 flex items-center gap-2"
          >
            <span className="w-4 text-center">↓</span>
            <span>Unshelve</span>
          </button>

          <div className="border-t border-p4-border my-1" />

          {/* Delete options */}
          {contextMenu.fileCount === 0 ? (
            <button
              onClick={handleDelete}
              disabled={deletingChangelist !== null || shelvingChangelist !== null}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 text-red-400 disabled:opacity-50"
            >
              Delete Changelist
            </button>
          ) : (
            <button
              onClick={handleRevertAndDelete}
              disabled={deletingChangelist !== null || shelvingChangelist !== null}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 text-red-400 disabled:opacity-50"
            >
              Revert All & Delete ({contextMenu.fileCount} files)
            </button>
          )}
        </div>
      )}

      {/* User Info */}
      <div className="p-3 border-t border-p4-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-p4-blue flex items-center justify-center text-sm font-medium">
            {info?.userName?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-200 truncate">{info?.userName || 'Unknown'}</div>
            <div className="text-xs text-gray-500 truncate">{info?.clientRoot || ''}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
