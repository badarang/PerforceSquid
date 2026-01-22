import { useState } from 'react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'
import { Settings } from './Settings'

// Loading overlay component
function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg p-6 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-6 h-6 border-2 border-p4-blue border-t-transparent rounded-full animate-spin" />
          <div className="text-white">{message}</div>
        </div>
      </div>
    </div>
  )
}

export function Toolbar() {
  const { refresh, isLoading } = useP4Store()
  const toast = useToastContext()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')

  const handleSync = async () => {
    setIsSyncing(true)
    setLoadingMessage('Syncing files from server...')
    try {
      const result = await window.p4.sync()
      if (result.success) {
        await refresh()

        // Parse sync result to count updated files
        const message = result.message || ''
        const lines = message.trim().split('\n').filter(l => l.trim())

        // Count actual file updates (lines that contain file paths)
        const fileUpdates = lines.filter(line =>
          line.includes('//') && (
            line.includes(' - updating') ||
            line.includes(' - added') ||
            line.includes(' - deleted') ||
            line.includes(' - refreshing') ||
            line.includes('#')
          )
        )

        if (fileUpdates.length > 0) {
          toast?.showToast({
            type: 'success',
            title: `Synced ${fileUpdates.length} file(s)`,
            message: fileUpdates.slice(0, 3).map(f => {
              const match = f.match(/\/([^\/]+)#/)
              return match ? match[1] : f.split('/').pop()?.split('#')[0]
            }).join(', ') + (fileUpdates.length > 3 ? '...' : ''),
            duration: 5000
          })
        } else {
          toast?.showToast({
            type: 'info',
            title: 'Already up to date',
            message: 'No files needed to be updated',
            duration: 3000
          })
        }
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Sync failed',
          message: result.message,
          duration: 6000
        })
      }
    } finally {
      setIsSyncing(false)
      setLoadingMessage('')
    }
  }

  const handleRevertUnchanged = async () => {
    setIsReverting(true)
    setLoadingMessage('Reverting unchanged files...')
    try {
      const result = await window.p4.revertUnchanged()
      if (result.success) {
        await refresh()
        if (result.revertedCount > 0) {
          toast?.showToast({
            type: 'success',
            title: `Reverted ${result.revertedCount} unchanged file(s)`,
            duration: 4000
          })
        } else {
          toast?.showToast({
            type: 'info',
            title: 'No unchanged files',
            message: 'All open files have actual changes',
            duration: 3000
          })
        }
      } else {
        toast?.showToast({
          type: 'error',
          title: 'Revert failed',
          message: result.message,
          duration: 5000
        })
      }
    } finally {
      setIsReverting(false)
      setLoadingMessage('')
    }
  }

  return (
    <>
    {loadingMessage && <LoadingOverlay message={loadingMessage} />}
    <div className="h-12 bg-p4-darker border-b border-p4-border flex items-center px-4 gap-2">
      <button
        onClick={() => refresh()}
        disabled={isLoading}
        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Refresh"
      >
        {isLoading ? '...' : '↻'} Refresh
      </button>

      <button
        onClick={handleSync}
        disabled={isSyncing}
        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Sync (Get Latest)"
      >
        {isSyncing ? '...' : '↓'} Sync
      </button>

      <button
        onClick={handleRevertUnchanged}
        disabled={isReverting}
        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Revert files with no actual changes (p4 revert -a)"
      >
        {isReverting ? '...' : '↩'} Revert Unchanged
      </button>

      <div className="flex-1" />

      <div className="text-xs text-gray-500 mr-2">
        Right-click files to revert
      </div>

      <button
        onClick={() => setShowSettings(true)}
        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Settings"
      >
        ⚙ Settings
      </button>

      <Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
    </>
  )
}
