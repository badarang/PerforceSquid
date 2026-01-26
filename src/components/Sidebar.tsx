import { useP4Store } from '../stores/p4Store'
import iconSvg from '../assets/icon.svg'

interface SidebarProps {
  onSelectChangelist?: () => void
}

export function Sidebar({ onSelectChangelist }: SidebarProps) {
  const {
    changelists,
    files,
    selectedChangelist,
    setSelectedChangelist,
    isLoading
  } = useP4Store()

  const handleSelectChangelist = (cl: number | 'default') => {
    setSelectedChangelist(cl)
    onSelectChangelist?.()
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

              return (
                <li
                  key={cl.number}
                  onClick={() => handleSelectChangelist(cl.number === 0 ? 'default' : cl.number)}
                  className={`
                    px-3 py-2 cursor-pointer border-l-2 transition-colors
                    ${isSelected
                      ? 'bg-p4-dark border-l-p4-blue text-white'
                      : 'border-l-transparent hover:bg-p4-dark/50 text-gray-400'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono">
                      {clLabel}
                    </span>
                    {fileCount > 0 && (
                      <span className={`
                        text-xs px-1.5 py-0.5 rounded
                        ${isSelected ? 'bg-p4-blue/30 text-p4-blue' : 'bg-gray-700 text-gray-400'}
                      `}>
                        {fileCount}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-1">
                    {cl.description || '(no description)'}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
