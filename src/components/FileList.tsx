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
    setCheckedList,
    refresh,
    clearSelection
  } = useP4Store()

  const toast = useToastContext()

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    file: typeof files[0]
  } | null>(null)

  const [isProcessing, setIsProcessing] = useState(false)
  const [showMoveToMenu, setShowMoveToMenu] = useState(false)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  const filteredFiles = files.filter(file => {
    if (selectedChangelist === 'default') {
      return file.changelist === 'default' || file.changelist === 0
    }
    return file.changelist === selectedChangelist
  })

  const checkedCount = filteredFiles.filter(f => checkedFiles.has(f.depotFile)).length
  const allChecked = filteredFiles.length > 0 && checkedCount === filteredFiles.length
  const someChecked = checkedCount > 0 && checkedCount < filteredFiles.length

  // 🔧 clientFile 우선 경로
  const getClientPath = (file: typeof files[0]) => {
    return file.clientFile && file.clientFile.trim() !== ''
      ? file.clientFile
      : null
  }

  const getDisplayPath = (file: typeof files[0]) => {
    return getClientPath(file) ?? file.depotFile
  }

  const getFileName = (path: string) => {
    const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  const handleDragStart = (e: React.DragEvent, file: typeof files[0]) => {
    const filesToDrag = checkedFiles.has(file.depotFile)
      ? filteredFiles.filter(f => checkedFiles.has(f.depotFile))
      : [file]

    const clientFiles = filesToDrag
      .map(f => getClientPath(f))
      .filter(Boolean)

    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ files: clientFiles })
    )
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleFileClick = (
    e: React.MouseEvent,
    file: typeof files[0],
    index: number
  ) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const range = filteredFiles.slice(start, end + 1)
      setCheckedList(range.map(f => f.depotFile))
      return
    }

    setLastClickedIndex(index)

    // 🔧 diff는 clientFile로만
    const clientPath = getClientPath(file)
    if (clientPath) {
      fetchDiff({ ...file, diffPath: clientPath })
    } else {
      console.warn('No clientFile for diff', file)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, file: typeof files[0]) => {
    e.preventDefault()

    if (!checkedFiles.has(file.depotFile)) {
      setCheckedList([file.depotFile])

      const clientPath = getClientPath(file)
      if (clientPath) {
        fetchDiff({ ...file, diffPath: clientPath })
      }
    }

    const index = filteredFiles.findIndex(f => f.depotFile === file.depotFile)
    if (index !== -1) setLastClickedIndex(index)

    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const handleRevert = async () => {
    if (!contextMenu) return

    const file = contextMenu.file
    const depotPath = file.depotFile

    if (!confirm(`Revert "${getFileName(depotPath)}"? This cannot be undone.`)) {
      setContextMenu(null)
      return
    }

    setIsProcessing(true)
    setContextMenu(null)

    try {
      const result = await window.p4.revert([depotPath])
      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'File reverted',
          message: getFileName(depotPath),
          duration: 3000
        })
        clearSelection()
        await refresh()
      } else {
        throw new Error(result.message)
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

  const handleClickOutside = () => {
    setContextMenu(null)
    setShowMoveToMenu(false)
  }

  return (
    <div className="h-full flex flex-col" onClick={handleClickOutside}>
      <div className="p-3 border-b border-p4-border flex items-center gap-2">
        <input
          type="checkbox"
          checked={allChecked}
          ref={el => el && (el.indeterminate = someChecked)}
          onChange={e => setAllFilesChecked(e.target.checked)}
        />
        <span className="text-sm text-gray-300">
          {checkedCount} / {filteredFiles.length} files
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul>
          {filteredFiles.map((file, index) => {
            const isSelected = selectedFile?.depotFile === file.depotFile
            const isChecked = checkedFiles.has(file.depotFile)

            return (
              <li
                key={file.depotFile}
                draggable
                onDragStart={e => handleDragStart(e, file)}
                onContextMenu={e => handleContextMenu(e, file)}
                onClick={e => handleFileClick(e, file, index)}
                className={`
                  flex gap-2 px-3 py-2 cursor-pointer
                  ${isSelected ? 'bg-gray-700' : isChecked ? 'bg-gray-800' : ''}
                `}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={e => {
                    e.stopPropagation()
                    toggleFileCheck(file.depotFile)
                    setLastClickedIndex(index)
                  }}
                />

                <span
                  className={`font-mono ${actionColors[file.action]}`}
                >
                  {actionIcons[file.action]}
                </span>

                <div className="min-w-0">
                  <div className="truncate text-gray-200">
                    {getFileName(getDisplayPath(file))}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {getDisplayPath(file)}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
