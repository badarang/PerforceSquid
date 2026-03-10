import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
  captureLayoutPreset: () => Promise<{ main: number[]; detailsLeft: number[]; window: { width: number; height: number } } | null>
  applyLayoutPreset: (snapshot: { main: number[]; detailsLeft: number[]; window: { width: number; height: number } }) => Promise<void>
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

interface LayoutPreset {
  main: number[]
  detailsLeft: number[]
  window: {
    width: number
    height: number
  }
  updatedAt: string
}

export function Settings({ isOpen, onClose, captureLayoutPreset, applyLayoutPreset }: SettingsProps) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [loading, setLoading] = useState(true)
  const [riderPath, setRiderPath] = useState('')
  const [savedRiderPath, setSavedRiderPath] = useState('')
  const [isSavingRider, setIsSavingRider] = useState(false)
  
  // Workspace Settings
  const [workspace, setWorkspace] = useState<P4Workspace | null>(null)
  const [serverAddress, setServerAddress] = useState('')
  const [userName, setUserName] = useState('')
  const [editedRoot, setEditedRoot] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [layoutPresets, setLayoutPresets] = useState<Record<string, LayoutPreset>>({})
  const [presetName, setPresetName] = useState('')
  const [selectedPresetName, setSelectedPresetName] = useState('')

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    } else {
      // Reset state when closed
      setStatusMessage(null)
      setWorkspace(null)
      setServerAddress('')
      setRiderPath('')
      setSavedRiderPath('')
    }
  }, [isOpen])

  const loadSettings = async () => {
    setLoading(true)
    try {
      // Load app settings
      const enabled = await window.settings.getAutoLaunch()
      setAutoLaunch(enabled)
      const configuredRiderPath = await window.settings.getRiderPath()
      setRiderPath(configuredRiderPath || '')
      setSavedRiderPath(configuredRiderPath || '')

      // Get Info for Server Address
      const info = await window.p4.getInfo()
      if (info) {
        if (info.serverAddress) setServerAddress(info.serverAddress)
        if (info.userName) setUserName(info.userName)
      }

      // Load workspace settings
      const clientName = await window.p4.getClient()
      if (clientName) {
        const details = await window.p4.getWorkspaceDetails(clientName)
        if (details) {
          setWorkspace(details as P4Workspace)
          setEditedRoot(details.root)
        }
      }

      const presets = await window.settings.getLayoutPresets()
      setLayoutPresets(presets || {})
      const names = Object.keys(presets || {}).sort((a, b) => a.localeCompare(b))
      setSelectedPresetName((prev) => (prev && presets?.[prev] ? prev : (names[0] || '')))
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

  const handleBrowseRider = async () => {
    try {
      const selected = await window.dialog.openFile({
        filters: [
          { name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }
        ]
      })
      if (selected) {
        setRiderPath(selected)
      }
    } catch (err) {
      console.error('Failed to browse for Rider executable:', err)
    }
  }

  const handleSaveRiderPath = async () => {
    setIsSavingRider(true)
    setStatusMessage(null)

    try {
      const result = await window.settings.setRiderPath(riderPath)
      if (result.success) {
        const normalizedPath = riderPath.trim()
        setSavedRiderPath(normalizedPath)
        setRiderPath(normalizedPath)
        setStatusMessage({
          type: 'success',
          text: normalizedPath
            ? 'Rider executable path saved.'
            : 'Rider executable path cleared.'
        })
      } else {
        setStatusMessage({ type: 'error', text: result.message || 'Failed to save Rider path.' })
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save Rider path.' })
    } finally {
      setIsSavingRider(false)
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

  const saveLayoutPresets = async (next: Record<string, LayoutPreset>) => {
    await window.settings.setLayoutPresets(next)
    setLayoutPresets(next)
  }

  const handleSaveCurrentLayout = async () => {
    const safeName = presetName.trim()
    if (!safeName) {
      setStatusMessage({ type: 'error', text: 'Preset name is required.' })
      return
    }
    const snapshot = await captureLayoutPreset()
    if (!snapshot) {
      setStatusMessage({ type: 'error', text: 'Current layout is not ready. Try again after loading panels.' })
      return
    }

    const next: Record<string, LayoutPreset> = {
      ...layoutPresets,
      [safeName]: {
        main: snapshot.main,
        detailsLeft: snapshot.detailsLeft,
        window: snapshot.window,
        updatedAt: new Date().toISOString(),
      },
    }

    try {
      await saveLayoutPresets(next)
      setSelectedPresetName(safeName)
      setStatusMessage({ type: 'success', text: `Saved layout preset: ${safeName}` })
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save layout preset.' })
    }
  }

  const handleLoadLayoutPreset = async () => {
    const preset = layoutPresets[selectedPresetName]
    if (!preset) {
      setStatusMessage({ type: 'error', text: 'Select a preset to load.' })
      return
    }
    await applyLayoutPreset({ main: preset.main, detailsLeft: preset.detailsLeft, window: preset.window })
    setStatusMessage({ type: 'success', text: `Loaded layout preset: ${selectedPresetName}` })
  }

  const handleDeleteLayoutPreset = async () => {
    if (!selectedPresetName) {
      setStatusMessage({ type: 'error', text: 'Select a preset to delete.' })
      return
    }
    const next = { ...layoutPresets }
    delete next[selectedPresetName]
    try {
      await saveLayoutPresets(next)
      const names = Object.keys(next).sort((a, b) => a.localeCompare(b))
      setSelectedPresetName(names[0] || '')
      setStatusMessage({ type: 'success', text: `Deleted layout preset: ${selectedPresetName}` })
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to delete layout preset.' })
    }
  }

  if (!isOpen) return null

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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
            <div className="space-y-3 animate-pulse py-2">
              <div className="h-5 w-40 rounded bg-gray-700/70" />
              <div className="h-16 rounded bg-gray-700/50" />
              <div className="h-5 w-36 rounded bg-gray-700/70 mt-4" />
              <div className="h-24 rounded bg-gray-700/50" />
            </div>
          ) : (
            <div className="space-y-8">
              {/* Application Settings Section */}
              <section>
                <h3 className="text-sm font-medium text-p4-blue uppercase tracking-wider mb-4">Application</h3>
                <div className="bg-gray-800/30 rounded border border-gray-700/50 p-4 space-y-4">
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

                  <div className="border-t border-gray-700/50 pt-4">
                    <div className="text-sm font-medium text-gray-200">Rider executable</div>
                    <div className="text-xs text-gray-500 mt-0.5 mb-2">
                      Used by the file list context menu to open the current file in JetBrains Rider.
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={riderPath}
                        onChange={(e) => setRiderPath(e.target.value)}
                        placeholder="C:\\Program Files\\JetBrains\\...\\rider64.exe"
                        className="flex-1 bg-p4-dark border border-p4-border rounded px-3 py-2 text-white focus:outline-none focus:border-p4-blue text-sm"
                      />
                      <button
                        onClick={handleBrowseRider}
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors whitespace-nowrap"
                      >
                        Browse...
                      </button>
                      <button
                        onClick={handleSaveRiderPath}
                        disabled={isSavingRider || riderPath.trim() === savedRiderPath.trim()}
                        className="px-3 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm text-white transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingRider ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Leave blank to disable the Rider context menu action.
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-medium text-p4-blue uppercase tracking-wider mb-4">Layout Presets</h3>
                <div className="bg-gray-800/30 rounded border border-gray-700/50 p-4 space-y-3">
                  <div className="text-xs text-gray-500">
                    Save and load panel size presets.
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name (e.g. Narrow My Changes)"
                      className="flex-1 bg-p4-dark border border-p4-border rounded px-3 py-2 text-white focus:outline-none focus:border-p4-blue text-sm"
                    />
                    <button
                      onClick={handleSaveCurrentLayout}
                      className="px-3 py-2 bg-p4-blue hover:bg-blue-600 rounded text-sm text-white transition-colors whitespace-nowrap"
                    >
                      Save Current
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={selectedPresetName}
                      onChange={(e) => setSelectedPresetName(e.target.value)}
                      className="flex-1 bg-p4-dark border border-p4-border rounded px-3 py-2 text-white focus:outline-none focus:border-p4-blue text-sm"
                    >
                      {Object.keys(layoutPresets).length === 0 ? (
                        <option value="">No presets saved</option>
                      ) : (
                        Object.keys(layoutPresets).sort((a, b) => a.localeCompare(b)).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))
                      )}
                    </select>
                    <button
                      onClick={handleLoadLayoutPreset}
                      disabled={!selectedPresetName}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Load
                    </button>
                    <button
                      onClick={handleDeleteLayoutPreset}
                      disabled={!selectedPresetName}
                      className="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-sm text-white transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </section>

              {/* Workspace Settings Section */}
              {workspace && (
                <section>
                  <h3 className="text-sm font-medium text-p4-blue uppercase tracking-wider mb-4">Current Workspace</h3>
                  <div className="bg-gray-800/30 rounded border border-gray-700/50 p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-400 mb-2">
                       <div>
                         <span className="block text-xs text-gray-500 uppercase">User</span>
                         <span className="text-white">{userName || 'Unknown'}</span>
                       </div>
                       <div className="min-w-0">
                         <span className="block text-xs text-gray-500 uppercase">Server</span>
                         <span className="block text-white truncate" title={serverAddress}>{serverAddress || 'Unknown'}</span>
                       </div>
                       <div>
                         <span className="block text-xs text-gray-500 uppercase">Workspace</span>
                         <span className="text-white">{workspace.client}</span>
                       </div>
                       <div className="min-w-0">
                         <span className="block text-xs text-gray-500 uppercase">Stream</span>
                         <span className="block text-white truncate" title={workspace.stream}>{workspace.stream || 'None'}</span>
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

  return createPortal(modal, document.body)
}
