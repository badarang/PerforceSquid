import { useState, useEffect } from 'react'
import { getUserStyle } from '../utils/userIcon'

interface P4Changelist {
  number: number
  status: 'pending' | 'submitted'
  description: string
  user: string
  client: string
  date?: string
}

interface HistoryProps {
  depotPath: string | null
  onChangelistSelect: (changelist: number) => void
  selectedChangelist: number | null
  selectedChangelists: number[]
  onMultiSelect: (changelists: number[]) => void
}

export function History({
  depotPath,
  onChangelistSelect,
  selectedChangelist,
  selectedChangelists,
  onMultiSelect
}: HistoryProps) {
  const [changelists, setChangelists] = useState<P4Changelist[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (depotPath) {
      loadHistory()
    }
  }, [depotPath])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  const loadHistory = async () => {
    if (!depotPath) return

    try {
      setLoading(true)
      setError(null)
      const changes = await window.p4.getSubmittedChanges(depotPath, 50)
      setChangelists(changes)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClick = (cl: P4Changelist, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangeNumbers = changelists.slice(start, end + 1).map(c => c.number)
      onMultiSelect(rangeNumbers)
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle selection
      if (selectedChangelists.includes(cl.number)) {
        onMultiSelect(selectedChangelists.filter(n => n !== cl.number))
      } else {
        onMultiSelect([...selectedChangelists, cl.number])
      }
      setLastClickedIndex(index)
    } else {
      // Normal click: single select
      onMultiSelect([cl.number])
      onChangelistSelect(cl.number)
      setLastClickedIndex(index)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (selectedChangelists.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }

  const generateLLMSummary = async () => {
    if (selectedChangelists.length === 0) return

    setCopying(true)
    setContextMenu(null)

    try {
      const summaries: string[] = []

      // Sort changelists by number (oldest first)
      const sortedCLs = [...selectedChangelists].sort((a, b) => a - b)

      for (const clNumber of sortedCLs) {
        const result = await window.p4.describeChangelist(clNumber)

        if (result.info) {
          let clSummary = `## Changelist #${clNumber}\n`
          clSummary += `- **Author**: ${result.info.user}\n`
          clSummary += `- **Date**: ${result.info.date}\n`
          clSummary += `- **Description**: ${result.info.description}\n\n`

          if (result.files.length > 0) {
            clSummary += `### Changed Files (${result.files.length})\n`
            for (const file of result.files) {
              const fileName = file.depotFile.split('/').pop()
              clSummary += `- \`${fileName}\` (${file.action})\n`
            }
            clSummary += '\n'
          }

          if (result.diff) {
            clSummary += `### Diff\n\`\`\`diff\n${result.diff}\n\`\`\`\n`
          }

          summaries.push(clSummary)
        }
      }

      const fullText = `# Perforce Changelist Summary

Please analyze the following ${selectedChangelists.length} changelist(s) and explain:
1. What changes were made in each file
2. The purpose/intent of these changes
3. Any potential issues or improvements

---

${summaries.join('\n---\n\n')}
`

      await navigator.clipboard.writeText(fullText)

      // Show brief success message
      alert(`Copied ${selectedChangelists.length} changelist(s) summary to clipboard!\n\nYou can now paste this into ChatGPT, Claude, or any LLM.`)
    } catch (err: any) {
      alert(`Error generating summary: ${err.message}`)
    } finally {
      setCopying(false)
    }
  }

  const copyChangelistNumbers = async () => {
    const numbers = [...selectedChangelists].sort((a, b) => a - b).join(', ')
    await navigator.clipboard.writeText(numbers)
    setContextMenu(null)
    alert(`Copied: ${numbers}`)
  }

  if (!depotPath) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Select a workspace to view history
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Loading history...
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm p-4">
        <div className="text-red-400 mb-2">Error loading history</div>
        <div className="text-xs mb-4">{error}</div>
        <button
          onClick={loadHistory}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" onContextMenu={handleContextMenu}>
      <div className="p-3 border-b border-p4-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-300">
            Recent Changes ({changelists.length})
          </h2>
          {selectedChangelists.length > 1 && (
            <div className="text-xs text-p4-blue mt-1">
              {selectedChangelists.length} selected (Right-click for options)
            </div>
          )}
        </div>
        <button
          onClick={loadHistory}
          className="text-xs text-gray-500 hover:text-gray-300"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="p-2 border-b border-p4-border bg-p4-darker">
        <div className="text-xs text-gray-500">
          Shift+Click to select range, Ctrl+Click to toggle
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {changelists.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No submitted changes found
          </div>
        ) : (
          <ul>
            {changelists.map((cl, index) => {
              const isSelected = selectedChangelists.includes(cl.number)
              const isCurrent = selectedChangelist === cl.number
              const userStyle = getUserStyle(cl.user)
              return (
                <li
                  key={cl.number}
                  onClick={(e) => handleClick(cl, index, e)}
                  className={`
                    px-3 py-2 cursor-pointer border-b border-p4-border/50
                    transition-colors select-none
                    ${isSelected ? 'bg-p4-blue/20 border-l-2 border-l-p4-blue' : 'hover:bg-gray-800'}
                    ${isCurrent && !isSelected ? 'bg-gray-700' : ''}
                  `}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-mono ${isSelected ? 'text-p4-blue' : 'text-gray-400'}`}>
                      #{cl.number}
                    </span>
                    <span className="text-xs text-gray-500">
                      {cl.date}
                    </span>
                  </div>
                  <div className="text-sm text-gray-200 truncate mb-2">
                    {cl.description || '(no description)'}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-5 h-5 rounded-full ${userStyle.color} flex items-center justify-center text-xs`}
                      title={cl.user}
                    >
                      {userStyle.icon}
                    </span>
                    <span className="text-xs text-gray-400">
                      {cl.user}
                    </span>
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
          className="fixed bg-p4-darker border border-p4-border rounded shadow-xl z-50 py-1 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={generateLLMSummary}
            disabled={copying}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2 disabled:opacity-50"
          >
            <span>📋</span>
            <span>{copying ? 'Generating...' : 'Copy for LLM Analysis'}</span>
          </button>
          <button
            onClick={copyChangelistNumbers}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            <span>#</span>
            <span>Copy Changelist Numbers</span>
          </button>
          <div className="border-t border-p4-border my-1" />
          <button
            onClick={() => {
              onMultiSelect([])
              setContextMenu(null)
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 text-gray-400"
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  )
}
