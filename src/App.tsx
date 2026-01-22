import { useEffect, useState, createContext, useContext } from 'react'
import { useP4Store } from './stores/p4Store'
import { Sidebar } from './components/Sidebar'
import { FileList } from './components/FileList'
import { DiffViewer } from './components/DiffViewer'
import { Toolbar } from './components/Toolbar'
import { ClientSelector } from './components/ClientSelector'
import { History } from './components/History'
import { ChangelistDiff } from './components/ChangelistDiff'
import { ToastContainer, ToastMessage } from './components/Toast'
import { SubmitPanel } from './components/SubmitPanel'

// Toast Context
interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void
}
export const ToastContext = createContext<ToastContextType | null>(null)
export const useToastContext = () => useContext(ToastContext)

type TabType = 'changes' | 'history'

let toastIdCounter = 0

function App() {
  const { refresh, error, isLoading, info } = useP4Store()
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [checkingClient, setCheckingClient] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('changes')
  const [depotPath, setDepotPath] = useState<string | null>(null)
  const [selectedHistoryChangelist, setSelectedHistoryChangelist] = useState<number | null>(null)
  const [selectedHistoryChangelists, setSelectedHistoryChangelists] = useState<number[]>([])
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const showToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${++toastIdCounter}`
    setToasts(prev => [...prev, { ...toast, id }])
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  useEffect(() => {
    const checkClient = async () => {
      try {
        const client = await window.p4.getClient()
        if (client) {
          setSelectedClient(client)
          refresh()
        }
      } catch (err) {
        // No client set
      } finally {
        setCheckingClient(false)
      }
    }
    checkClient()
  }, [])

  useEffect(() => {
    if (!selectedClient) return

    refresh()

    // Load depot path for history
    const loadDepotPath = async () => {
      const stream = await window.p4.getClientStream()
      setDepotPath(stream)
    }
    loadDepotPath()
  }, [selectedClient])

  const handleClientSelected = (client: string) => {
    setSelectedClient(client)
    setActiveTab('changes')
    setSelectedHistoryChangelist(null)
    setSelectedHistoryChangelists([])
  }

  const handleChangeWorkspace = () => {
    setSelectedClient(null)
    setDepotPath(null)
    setSelectedHistoryChangelist(null)
    setSelectedHistoryChangelists([])
  }

  if (checkingClient) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-300 mb-2">Starting P4 Desktop...</div>
          <div className="text-sm text-gray-500">Please wait</div>
        </div>
      </div>
    )
  }

  if (!selectedClient) {
    return <ClientSelector onClientSelected={handleClientSelected} />
  }

  if (!info && isLoading) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-300 mb-2">Connecting to Perforce...</div>
          <div className="text-sm text-gray-500">Please wait</div>
        </div>
      </div>
    )
  }

  if (!info && error) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-xl text-red-400 mb-2">Connection Error</div>
          <div className="text-sm text-gray-400 mb-4">{error}</div>
          <div className="text-xs text-gray-500 mb-4">
            Make sure you have:
            <ul className="mt-2 text-left list-disc list-inside">
              <li>P4 CLI installed and in PATH</li>
              <li>Valid P4 environment variables set (P4PORT, P4USER, P4CLIENT)</li>
              <li>Access to the Perforce server</li>
            </ul>
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => refresh()}
              className="px-4 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm transition-colors"
            >
              Retry Connection
            </button>
            <button
              onClick={handleChangeWorkspace}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              Change Workspace
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
    <div className="h-screen bg-p4-dark flex flex-col">
      {/* Toolbar */}
      <Toolbar />

      {/* Tab Bar */}
      <div className="h-10 bg-p4-darker border-b border-p4-border flex items-center px-4 gap-1">
        <button
          onClick={() => setActiveTab('changes')}
          className={`px-4 py-1.5 text-sm rounded-t transition-colors ${
            activeTab === 'changes'
              ? 'bg-p4-dark text-white border-t border-l border-r border-p4-border'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          My Changes
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-1.5 text-sm rounded-t transition-colors ${
            activeTab === 'history'
              ? 'bg-p4-dark text-white border-t border-l border-r border-p4-border'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          History
        </button>
        {depotPath && activeTab === 'history' && (
          <span className="ml-4 text-xs text-gray-500 truncate">
            {depotPath}
          </span>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'changes' ? (
          <>
            {/* Sidebar - Changelists */}
            <div className="w-56 border-r border-p4-border flex-shrink-0">
              <Sidebar />
            </div>

            {/* File List + Submit Panel */}
            <div className="w-80 border-r border-p4-border flex-shrink-0 flex flex-col">
              <div className="flex-1 overflow-hidden">
                <FileList />
              </div>
              <SubmitPanel />
            </div>

            {/* Diff Viewer */}
            <div className="flex-1 bg-p4-dark">
              <DiffViewer />
            </div>
          </>
        ) : (
          <>
            {/* History List */}
            <div className="w-80 border-r border-p4-border flex-shrink-0">
              <History
                depotPath={depotPath}
                onChangelistSelect={setSelectedHistoryChangelist}
                selectedChangelist={selectedHistoryChangelist}
                selectedChangelists={selectedHistoryChangelists}
                onMultiSelect={setSelectedHistoryChangelists}
              />
            </div>

            {/* Changelist Diff Viewer */}
            <div className="flex-1 bg-p4-dark min-w-0 overflow-hidden">
              <ChangelistDiff changelist={selectedHistoryChangelist} />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-p4-blue text-white text-xs flex items-center px-3 gap-4">
        <button
          onClick={handleChangeWorkspace}
          className="hover:underline"
          title="Click to change workspace"
        >
          {selectedClient}
        </button>
        <span className="opacity-60">|</span>
        <span>{info?.userName}@{info?.clientName}</span>
        <span className="opacity-60">|</span>
        <span className="opacity-80">{info?.serverAddress}</span>
        {error && (
          <>
            <span className="opacity-60">|</span>
            <span className="text-red-200">{error}</span>
          </>
        )}
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
    </ToastContext.Provider>
  )
}

export default App
