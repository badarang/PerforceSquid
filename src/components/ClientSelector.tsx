import { useState, useEffect } from 'react'

interface P4Client {
  name: string
  root: string
  description: string
}

interface ClientSelectorProps {
  onClientSelected: (client: string) => void
}

export function ClientSelector({ onClientSelected }: ClientSelectorProps) {
  const [clients, setClients] = useState<P4Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      setLoading(true)
      const clientList = await window.p4.getClients()
      setClients(clientList)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectClient = async (clientName: string) => {
    await window.p4.setClient(clientName)
    onClientSelected(clientName)
  }

  if (loading) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-300 mb-2">Loading workspaces...</div>
          <div className="text-sm text-gray-500">Please wait</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-xl text-red-400 mb-2">Error Loading Workspaces</div>
          <div className="text-sm text-gray-400 mb-4">{error}</div>
          <button
            onClick={loadClients}
            className="px-4 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (clients.length === 0) {
    return (
      <div className="h-screen bg-p4-dark flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-xl text-yellow-400 mb-2">No Workspaces Found</div>
          <div className="text-sm text-gray-400 mb-4">
            No Perforce workspaces found for your user. Please create a workspace using P4V or the p4 command line.
          </div>
          <button
            onClick={loadClients}
            className="px-4 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-p4-dark flex items-center justify-center">
      <div className="w-[500px]">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">P4 Desktop</h1>
          <p className="text-gray-400">Select a workspace to continue</p>
        </div>

        <div className="bg-p4-darker border border-p4-border rounded-lg overflow-hidden">
          {clients.map((client) => (
            <div
              key={client.name}
              onClick={() => selectClient(client.name)}
              className="p-4 border-b border-p4-border last:border-b-0 cursor-pointer hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200">{client.name}</div>
                  <div className="text-xs text-gray-500 truncate mt-1">{client.root}</div>
                </div>
                <span className="text-gray-600 text-xl ml-4">→</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
