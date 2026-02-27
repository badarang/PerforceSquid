import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'
import iconSvg from '../assets/icon.svg'
import { useState, useRef, useEffect } from 'react'

interface SidebarProps {
  onSelectChangelist?: () => void
}

export function Sidebar({ onSelectChangelist }: SidebarProps) {
  const {
    changelists,
    files,
    selectedChangelist,
    setSelectedChangelist,
    isLoading,
    deleteChangelist
  } = useP4Store()
  const toast = useToastContext()
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, clNumber: number, reviewUrl?: string | null } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleSelectChangelist = (cl: number | 'default') => {
    setSelectedChangelist(cl)
    onSelectChangelist?.()
  }

  const handleDeleteChangelist = async (e: React.MouseEvent, clNumber: number) => {
    e.stopPropagation()
    if (!confirm(`Are you sure you want to delete changelist ${clNumber}?`)) {
      return
    }

    const result = await deleteChangelist(clNumber)
    if (result.success) {
      toast?.showToast({
        type: 'success',
        title: 'Changelist deleted',
        message: `Changelist ${clNumber} deleted successfully`,
        duration: 3000
      })
    } else {
      toast?.showToast({
        type: 'error',
        title: 'Delete failed',
        message: result.message,
        duration: 4000
      })
    }
  }

  const handleContextMenu = async (e: React.MouseEvent, clNumber: number) => {
    e.preventDefault()
    e.stopPropagation()
    const x = e.clientX
    const y = e.clientY

    let reviewUrl: string | null = null
    const changelist = changelists.find((cl) => cl.number === clNumber)
    if (changelist?.reviewId) {
      const swarmUrl = await window.p4.getSwarmUrl()
      if (swarmUrl) {
        reviewUrl = `${swarmUrl.replace(/\/$/, '')}/reviews/${changelist.reviewId}`
      }
    }
    if (!reviewUrl && clNumber > 0) {
      reviewUrl = await window.settings.getReviewLink(clNumber)
    }

    setContextMenu({ x, y, clNumber, reviewUrl })
  }

  const handleOpenReview = () => {
    if (!contextMenu?.reviewUrl) return
    const target = contextMenu.reviewUrl
    setContextMenu(null)
    window.open(target, '_blank')
  }

  const handleCopyForLLM = async () => {
    if (!contextMenu) return
    const clNumber = contextMenu.clNumber
    setContextMenu(null)

    toast?.showToast({
      type: 'info',
      title: 'Generating Diff',
      message: 'Generating diff...',
      duration: 2000
    })

    // Unity 바이너리/직렬화 파일 확장자
    const unityBinaryExts = ['.unity', '.prefab', '.asset', '.mat', '.controller', '.anim', '.meta']

    const cleanDiff = (text: string) => {
      if (!text) return ''
      const lines = text.split('\n')
      const result: string[] = []
      let currentFile = ''
      let currentFileChanges: string[] = []
      let isUnityFile = false

      const flushFile = () => {
        if (!currentFile) return
        if (result.length > 0) result.push('')

        if (isUnityFile && currentFileChanges.length > 10) {
          // Unity 파일은 변경 라인 수만 요약
          const adds = currentFileChanges.filter(l => l.startsWith('+')).length
          const dels = currentFileChanges.filter(l => l.startsWith('-')).length
          result.push(currentFile)
          result.push(`  (Unity asset: +${adds} -${dels} lines)`)
        } else {
          result.push(currentFile)
          result.push(...currentFileChanges)
        }
        currentFileChanges = []
      }

      for (const line of lines) {
        const l = line.trimEnd()

        // 파일 헤더: ==== //depot/path#rev (action) ==== 형태를 간결하게 변환
        const fileMatch = l.match(/^==== (.+?)#\d+ \((\w+(?:\/\w+)?)\)/)
        if (fileMatch) {
          flushFile()
          const filePath = fileMatch[1]
          currentFile = `--- ${filePath} (${fileMatch[2]}) ---`
          isUnityFile = unityBinaryExts.some(ext => filePath.toLowerCase().endsWith(ext))
          continue
        }

        // 스킵할 라인들
        if (l === 'Differences ...') continue
        if (l.startsWith('@@')) continue
        if (l.match(/^---\s+\/\//)) continue
        if (l.match(/^\+\+\+\s+\/\//)) continue

        // 변경 라인만 유지 (+/-)
        if (l.startsWith('+') || l.startsWith('-')) {
          currentFileChanges.push(l)
        }
      }
      flushFile()

      return result.join('\n')
    }

    try {
      let textToCopy = ''

      if (clNumber === 0) {
        textToCopy += `# Changelist: Default\n\n`
        const openedFiles = await window.p4.getOpenedFiles()
        const defaultFiles = openedFiles.filter(f => f.changelist === 'default' || f.changelist === 0)

        for (const file of defaultFiles) {
          const diffResult = await window.p4.getDiff(file.depotFile)
          if (diffResult.hunks) {
            const cleaned = cleanDiff(`==== ${file.depotFile}#0 (${file.action}) ====\n${diffResult.hunks}`)
            if (cleaned.trim()) {
              textToCopy += cleaned + '\n'
            }
          }
        }
      } else {
        const result = await window.p4.describeChangelist(clNumber)
        if (result.info) {
          textToCopy += `# CL ${result.info.number}: ${result.info.description}\n\n`
        }
        textToCopy += cleanDiff(result.diff || '')
      }

      await navigator.clipboard.writeText(textToCopy)
      
      toast?.showToast({
        type: 'success',
        title: 'Copied!',
        message: 'Changelist diff copied to clipboard',
        duration: 3000
      })
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Error',
        message: 'Failed to copy diff: ' + err.message,
        duration: 4000
      })
    }
  }

  // Count files per changelist
  const getFileCount = (clNumber: number | 'default') => {
    return files.filter(f => {
      if (clNumber === 'default' || clNumber === 0) {
        return f.changelist === 'default' || f.changelist === 0
      }
      return f.changelist === clNumber
    }).length
  }

  return (
    <div className="h-full flex flex-col bg-p4-darker">
      <div className="p-3 border-b border-p4-border">
        <h2 className="text-sm font-semibold text-gray-300">My Changes</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <img src={iconSvg} className="w-8 h-8 mb-2 animate-doom-chit" alt="Loading..." />
            <div className="text-sm text-gray-500">Loading changes...</div>
          </div>
        ) : changelists.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">
            No pending changelists
          </div>
        ) : (
          <ul>
            {changelists.map(cl => {
              const fileCount = getFileCount(cl.number === 0 ? 'default' : cl.number)
              const isSelected = selectedChangelist === (cl.number === 0 ? 'default' : cl.number)
              const clLabel = cl.number === 0 ? 'default' : cl.number
              const isReviewRequested = !!cl.reviewId || !!cl.reviewStatus || cl.description.includes('#review')

              return (
                <li
                  key={cl.number}
                  onClick={() => handleSelectChangelist(cl.number === 0 ? 'default' : cl.number)}
                  onContextMenu={(e) => handleContextMenu(e, cl.number)}
                  className={`
                    group px-3 py-2 cursor-pointer border-l-2 transition-colors relative
                    ${isSelected
                      ? (isReviewRequested
                        ? 'bg-purple-950/30 border-l-purple-400 text-white'
                        : 'bg-p4-dark border-l-p4-blue text-white')
                      : (isReviewRequested
                        ? 'border-l-transparent bg-purple-950/15 hover:bg-purple-900/25 text-gray-300'
                        : 'border-l-transparent hover:bg-p4-dark/50 text-gray-400')
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono">
                      {clLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      {cl.number !== 0 && fileCount === 0 && (
                        <button
                          onClick={(e) => handleDeleteChangelist(e, cl.number)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-900/50 rounded text-gray-500 hover:text-red-400 transition-all"
                          title="Delete empty changelist"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      {fileCount > 0 && (
                        <span className={`
                          text-xs px-1.5 py-0.5 rounded
                          ${isSelected ? 'bg-p4-blue/30 text-p4-blue' : 'bg-gray-700 text-gray-400'}
                        `}>
                          {fileCount}
                        </span>
                      )}
                      {cl.reviewId && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${isSelected ? 'bg-purple-500/30 text-purple-200' : 'bg-purple-800/40 text-purple-300'}`}
                          title={`Review #${cl.reviewId}${cl.reviewStatus ? ` (${cl.reviewStatus})` : ''}`}
                        >
                          R#{cl.reviewId}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-3 whitespace-pre-wrap mt-1">
                    {cl.description || '(no description)'}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      
      {contextMenu && (
        <div 
          ref={menuRef}
          className="fixed bg-p4-dark border border-p4-border shadow-lg rounded z-50 py-1 min-w-[150px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-p4-blue/20 hover:text-p4-blue"
            onClick={handleCopyForLLM}
          >
            Copy Diff
          </button>
          {contextMenu.reviewUrl && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-p4-blue/20 hover:text-p4-blue"
              onClick={handleOpenReview}
            >
              Open Review
            </button>
          )}
        </div>
      )}
    </div>
  )
}
