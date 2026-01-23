import { useState, useEffect } from 'react'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface P4Workspace {
  client: string
  owner: string
  stream: string
  root: string
  host: string
  description: string
  access: string
  update: string
  options?: string
  submitOptions?: string
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // Workspace Settings
  const [workspace, setWorkspace] = useState<P4Workspace | null>(null)
  const [editedRoot, setEditedRoot] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    } else {
      // Reset state when closed
      setStatusMessage(null)
      setWorkspace(null)
    }
  }, [isOpen])

  const loadSettings = async () => {
    setLoading(true)
    try {
      // Load app settings
      const enabled = await window.settings.getAutoLaunch()
      setAutoLaunch(enabled)

      // Load workspace settings
      const clientName = await window.p4.getClient()
      if (clientName) {
        const details = await window.p4.getWorkspaceDetails(clientName)
        if (details) {
          setWorkspace(details as P4Workspace)
          setEditedRoot(details.root)
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAutoLaunchChange = async (enabled: boolean) => {
    setAutoLaunch(enabled)
    try {
      await window.settings.setAutoLaunch(enabled)
    } catch (err) {
      console.error('Failed to save auto-launch setting:', err)
      setAutoLaunch(!enabled) // Revert on error
    }
  }

  const handleBrowseRoot = async () => {
    try {
      const path = await window.dialog.openDirectory()
      if (path) {
        setEditedRoot(path)
      }
    } catch (err) {
      console.error('Failed to open directory dialog', err)
    }
  }

  const handleSaveWorkspace = async () => {
    if (!workspace) return

    setIsSaving(true)
    setStatusMessage(null)

    try {
      const result = await window.p4.createClient({
        name: workspace.client,
        root: editedRoot,
        options: workspace.options || '',
        submitOptions: workspace.submitOptions || '',
        stream: workspace.stream,
        description: workspace.description
      })

      if (result.success) {
        setStatusMessage({ type: 'success', text: 'Workspace settings saved successfully' })
        // Refresh workspace info
        const details = await window.p4.getWorkspaceDetails(workspace.client)
        if (details) {
          setWorkspace(details as P4Workspace)
          setEditedRoot(details.root)
        }
      } else {
        setStatusMessage({ type: 'error', text: result.message })
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message })
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg w-[500px] shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-p4-border">
          <h2 className="text-xl font-medium text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {loading ? (
            <div className="text-gray-400 text-sm text-center py-8">Loading settings...</div>
          ) : (
            <div className="space-y-8">
              {/* Application Settings Section */}
              <section>
                <h3 className="text-sm font-medium text-p4-blue uppercase tracking-wider mb-4">Application</h3>
                <div className="bg-gray-800/30 rounded border border-gray-700/50 p-4">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-sm font-medium text-gray-200">Start at login</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Automatically start P4 Desktop when you log in
                      </div>
                    </div>
                    <div
                      onClick={() => handleAutoLaunchChange(!autoLaunch)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        autoLaunch ? 'bg-p4-blue' : 'bg-gray-600'
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          autoLaunch ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </div>
                  </label>
                </div>
              </section>

              {/* Workspace Settings Section */}
              {workspace && (
                <section>
                  <h3 className="text-sm font-medium text-p4-blue uppercase tracking-wider mb-4">Current Workspace</h3>
                  <div className="bg-gray-800/30 rounded border border-gray-700/50 p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-400 mb-2">
                       <div>
                         <span className="block text-xs text-gray-500 uppercase">Name</span>
                         <span className="text-white">{workspace.client}</span>
                       </div>
                       <div>
                         <span className="block text-xs text-gray-500 uppercase">Stream</span>
                         <span className="text-white truncate" title={workspace.stream}>{workspace.stream || 'None'}</span>
                       </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Client Root</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editedRoot}
                          onChange={(e) => setEditedRoot(e.target.value)}
                          className="flex-1 bg-p4-dark border border-p4-border rounded px-3 py-2 text-white focus:outline-none focus:border-p4-blue text-sm"
                        />
                        <button
                          onClick={handleBrowseRoot}
                          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors whitespace-nowrap"
                        >
                          Browse...
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Local directory where files are stored. Changing this will not move existing files.
                      </p>
                    </div>

                    <div className="pt-2 flex justify-end">
                       <button
                         onClick={handleSaveWorkspace}
                         disabled={isSaving || editedRoot === workspace.root}
                         className="px-4 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         {isSaving ? 'Saving...' : 'Save Changes'}
                       </button>
                    </div>

                    {statusMessage && (
                      <div className={`text-sm p-2 rounded ${
                        statusMessage.type === 'success' ? 'bg-green-900/20 text-green-200' : 'bg-red-900/20 text-red-200'
                      }`}>
                        {statusMessage.text}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}