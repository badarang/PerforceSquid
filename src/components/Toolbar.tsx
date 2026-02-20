import { useEffect, useState } from 'react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'
import { Settings } from './Settings'
import { StreamSelector } from './StreamSelector'
import { JiraPanel } from './JiraPanel'
import iconSvg from '../assets/icon.svg'

interface ReconcileProgressState {
  mode: 'smart' | 'full'
  phase: 'scanning' | 'reconciling' | 'done'
  completed: number
  total: number
  message?: string
}

// Loading overlay component
function LoadingOverlay({ message, reconcileProgress }: { message: string; reconcileProgress?: ReconcileProgressState | null }) {
  const hasProgress = !!reconcileProgress
  const completed = reconcileProgress?.completed ?? 0
  const total = reconcileProgress?.total ?? 0
  const hasDeterminateProgress = hasProgress && total > 0
  const percent = hasDeterminateProgress
    ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    : 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg p-6 shadow-xl">
        <div className="flex items-center gap-4 mb-3">
          <img src={iconSvg} className="w-8 h-8 animate-spin" alt="Loading..." />
          <div className="text-white">{message}</div>
        </div>
        {reconcileProgress?.phase === 'scanning' && (
          <div className="text-xs text-gray-300">{reconcileProgress.message || 'Scanning changed files...'}</div>
        )}
        {hasProgress && (
          <div>
            <div className="flex justify-between text-xs text-gray-300 mb-1">
              <span>{reconcileProgress?.mode === 'smart' ? 'Reconcile Code' : 'Reconcile All'}</span>
              <span>{hasDeterminateProgress ? `${completed}/${total} (${percent}%)` : 'Scanning...'}</span>
            </div>
            <div className="w-[360px] max-w-[70vw] h-2 bg-gray-700 rounded overflow-hidden">
              <div
                className={hasDeterminateProgress ? 'h-full bg-p4-blue transition-all duration-150' : 'h-full bg-p4-blue/0'}
                style={{ width: hasDeterminateProgress ? `${percent}%` : '0%' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ToolbarProps {
  currentStream: string | null
  onStreamChange: (streamPath: string) => void
}

export function Toolbar({ currentStream, onStreamChange }: ToolbarProps) {
  const { refresh, isLoading } = useP4Store()
  const toast = useToastContext()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [isReconcilingSmart, setIsReconcilingSmart] = useState(false)
  const [isReconcilingAll, setIsReconcilingAll] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showJiraPanel, setShowJiraPanel] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [reconcileProgress, setReconcileProgress] = useState<ReconcileProgressState | null>(null)

  useEffect(() => {
    const unsubscribe = window.p4.onReconcileProgress((progress) => {
      setReconcileProgress(progress)
    })
    return () => {
      unsubscribe()
    }
  }, [])

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

  const handleReconcileSmart = async () => {
    setIsReconcilingSmart(true)
    setLoadingMessage('Reconciling code files in workspace...')
    setReconcileProgress({ mode: 'smart', phase: 'scanning', completed: 0, total: 0, message: 'Scanning changed files...' })
    try {
      const result = await window.p4.reconcileOfflineSmart()
      await refresh()
      toast?.showToast({
        type: result.success ? 'success' : 'error',
        title: result.success ? 'Reconcile Code finished' : 'Reconcile Code failed',
        message: result.success
          ? (result.files.length > 0
            ? `${result.files.length} file(s) processed`
            : 'No changed code files found')
          : result.message,
        duration: result.success ? 4000 : 6000
      })
    } finally {
      setIsReconcilingSmart(false)
      setLoadingMessage('')
      setReconcileProgress(null)
    }
  }

  const handleReconcileAll = async () => {
    const confirmed = confirm('Run Reconcile Offline Work for entire workspace? This can take a long time.')
    if (!confirmed) return

    setIsReconcilingAll(true)
    setLoadingMessage('Reconciling entire workspace (this may take time)...')
    setReconcileProgress({ mode: 'full', phase: 'scanning', completed: 0, total: 0, message: 'Scanning changed files...' })
    try {
      const result = await window.p4.reconcileOfflineAll()
      await refresh()
      toast?.showToast({
        type: result.success ? 'success' : 'error',
        title: result.success ? 'Full Reconcile finished' : 'Full Reconcile failed',
        message: result.success
          ? (result.files.length > 0
            ? `${result.files.length} file(s) processed`
            : 'No changed files found in workspace')
          : result.message,
        duration: result.success ? 4000 : 7000
      })
    } finally {
      setIsReconcilingAll(false)
      setLoadingMessage('')
      setReconcileProgress(null)
    }
  }

  return (
    <>
    {loadingMessage && <LoadingOverlay message={loadingMessage} reconcileProgress={reconcileProgress} />}
    <div className="h-12 bg-p4-darker border-b border-p4-border overflow-x-auto overflow-y-hidden">
    <div className="h-full min-w-max flex flex-nowrap items-center px-4 gap-2">
      <button
        onClick={handleRevertUnchanged}
        disabled={isReverting}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Revert files with no actual changes (p4 revert -a)"
      >
        {isReverting ? '...' : '↩'} Revert Unchanged
      </button>

      <button
        onClick={() => refresh()}
        disabled={isLoading}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Refresh"
      >
        {isLoading ? '...' : '↻'} Refresh
      </button>

      <button
        onClick={handleSync}
        disabled={isSyncing}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Sync (Get Latest)"
      >
        {isSyncing ? '...' : '↓'} Sync
      </button>

      <button
        onClick={handleReconcileSmart}
        disabled={isReconcilingSmart}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Reconcile changed code files in workspace"
      >
        {isReconcilingSmart ? '...' : '⚡'} Reconcile Code
      </button>

      <button
        onClick={handleReconcileAll}
        disabled={isReconcilingAll}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
        title="Reconcile entire workspace"
      >
        {isReconcilingAll ? '...' : '◎'} Reconcile All
      </button>

      {/* Stream Selector */}
      <div className="shrink-0 mx-2 border-l border-p4-border pl-4">
        <StreamSelector
          currentStream={currentStream}
          onStreamChange={onStreamChange}
        />
      </div>

      <div className="flex-1" />

      <div className="shrink-0 whitespace-nowrap text-xs text-gray-500 mr-2">
        Right-click files to revert
      </div>

      <button
        onClick={() => setShowJiraPanel(true)}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Unified Jira status panel"
      >
        Jira
      </button>

      <button
        onClick={() => setShowSettings(true)}
        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Settings"
      >
        ⚙ Settings
      </button>

      <Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <JiraPanel isOpen={showJiraPanel} onClose={() => setShowJiraPanel(false)} />
    </div>
    </div>
    </>
  )
}
