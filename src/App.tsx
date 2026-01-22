import { useEffect, useState, createContext, useContext } from 'react'
import { useP4Store } from './stores/p4Store'
import { Sidebar } from './components/Sidebar'
import { FileList } from './components/FileList'
import { DiffViewer } from './components/DiffViewer'
import { Toolbar } from './components/Toolbar'
import { ClientSelector } from './components/ClientSelector'
import { ChangelistDiff } from './components/ChangelistDiff'
import { ToastContainer, ToastMessage } from './components/Toast'
import { SubmitPanel } from './components/SubmitPanel'
import { CommitGraph } from './components/CommitGraph'

// Toast Context
interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void
}
export const ToastContext = createContext<ToastContextType | null>(null)
export const useToastContext = () => useContext(ToastContext)

let toastIdCounter = 0

function App() {
  const { refresh, error, isLoading, info, selectedChangelist } = useP4Store()
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [checkingClient, setCheckingClient] = useState(true)
  const [depotPath, setDepotPath] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [selectedHistoryChangelist, setSelectedHistoryChangelist] = useState<number | null>(null)

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

    const loadDepotPath = async () => {
      const stream = await window.p4.getClientStream()
      setDepotPath(stream)
    }
    loadDepotPath()
  }, [selectedClient])

  const handleClientSelected = (client: string) => {
    setSelectedClient(client)
    setSelectedHistoryChangelist(null)
  }

  const handleChangeWorkspace = () => {
    setSelectedClient(null)
    setDepotPath(null)
    setSelectedHistoryChangelist(null)
  }

  if (checkingClient) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-300 mb-2">Starting PerforceSquid...</div>
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

        {/* Main Content - 3 Panel Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: My Changes (Pending Changelists) */}
          <div className="w-48 border-r border-p4-border flex-shrink-0 flex flex-col">
            <Sidebar onSelectChangelist={() => setSelectedHistoryChangelist(null)} />
          </div>

          {/* Middle Panel: History + Graph */}
          <div className="w-80 border-r border-p4-border flex-shrink-0">
            <CommitGraph
              depotPath={depotPath}
              onSelectChangelist={setSelectedHistoryChangelist}
              selectedChangelist={selectedHistoryChangelist}
            />
          </div>

          {/* Right Panel: Detail View */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedHistoryChangelist !== null ? (
              /* Show submitted changelist diff when history is selected */
              <ChangelistDiff changelist={selectedHistoryChangelist} />
            ) : selectedChangelist !== null ? (
              /* Show pending changelist details when My Changes is selected */
              <>
                {/* File List */}
                <div className="h-48 border-b border-p4-border flex-shrink-0 overflow-hidden">
                  <FileList />
                </div>
                {/* Submit Panel */}
                <div className="flex-shrink-0">
                  <SubmitPanel />
                </div>
                {/* Diff Viewer */}
                <div className="flex-1 overflow-hidden">
                  <DiffViewer />
                </div>
              </>
            ) : (
              /* Empty state */
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-lg mb-2">Select a changelist</div>
                  <div className="text-sm text-gray-600">
                    Choose from My Changes or History
                  </div>
                </div>
              </div>
            )}
          </div>
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
          {depotPath && (
            <>
              <span className="opacity-60">|</span>
              <span className="opacity-80 truncate">{depotPath}</span>
            </>
          )}
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
