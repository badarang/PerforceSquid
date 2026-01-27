import { useEffect, useState, createContext, useContext } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
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
import iconSvg from './assets/icon.svg'

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

    // Refresh on window focus to catch external changes
    const handleFocus = () => {
      if (useP4Store.getState().isLoading) return
      refresh()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
    }
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

  const handleStreamChange = async (newStreamPath: string) => {
    setDepotPath(newStreamPath)
    setSelectedHistoryChangelist(null)
    // Refresh to load new stream's data
    await refresh()
  }

  if (checkingClient) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="flex flex-col items-center">
          <img 
            src={iconSvg} 
            className="w-12 h-12 mb-4 block animate-doom-chit" 
            alt="Loading..." 
          />
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
        <div className="flex flex-col items-center">
          <img 
            src={iconSvg} 
            className="w-12 h-12 mb-4 block animate-doom-chit" 
            alt="Loading..." 
          />
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
        <Toolbar
          currentStream={depotPath}
          onStreamChange={handleStreamChange}
        />

        {/* Main Content - 3 Panel Layout */}
        <PanelGroup direction="horizontal" autoSaveId="main-layout" className="flex-1 flex overflow-hidden">
          {/* Left Panel: My Changes (Pending Changelists) */}
          <Panel defaultSize={15} minSize={10} className="border-r border-p4-border flex-shrink-0 flex flex-col">
            <Sidebar onSelectChangelist={() => setSelectedHistoryChangelist(null)} />
          </Panel>
          <PanelResizeHandle className='resize-handle-outer'>
            <div className='resize-handle-inner' />
          </PanelResizeHandle>

          {/* Middle Panel: History + Graph */}
          <Panel defaultSize={25} minSize={15} className="border-r border-p4-border flex-shrink-0">
            <CommitGraph
              depotPath={depotPath}
              onSelectChangelist={setSelectedHistoryChangelist}
              selectedChangelist={selectedHistoryChangelist}
            />
          </Panel>
          <PanelResizeHandle className='resize-handle-outer'>
            <div className='resize-handle-inner' />
          </PanelResizeHandle>

          {/* Right Panel: Detail View */}
          <Panel defaultSize={60} minSize={30} className="flex-1 flex flex-col min-w-0">
            {selectedHistoryChangelist !== null ? (
              /* Show submitted changelist diff when history is selected */
              <ChangelistDiff changelist={selectedHistoryChangelist} />
            ) : selectedChangelist !== null ? (
              /* Show pending changelist details when My Changes is selected */
              <PanelGroup direction="vertical" autoSaveId="details-layout">
                <Panel defaultSize={40} minSize={20} className="border-b border-p4-border flex-shrink-0 overflow-hidden">
                  <FileList />
                </Panel>
                <PanelResizeHandle className='resize-handle-outer'>
                    <div className='resize-handle-inner' />
                </PanelResizeHandle>
                <Panel collapsible={true} defaultSize={25} minSize={15} className="flex-shrink-0">
                  <SubmitPanel />
                </Panel>
                <PanelResizeHandle className='resize-handle-outer'>
                    <div className='resize-handle-inner' />
                </PanelResizeHandle>
                <Panel minSize={20} className="flex-1 overflow-hidden">
                  <DiffViewer />
                </Panel>
              </PanelGroup>
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
          </Panel>
        </PanelGroup>

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
