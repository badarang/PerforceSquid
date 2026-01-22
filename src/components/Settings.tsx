import { useState, useEffect } from 'react'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
  }, [isOpen])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const enabled = await window.settings.getAutoLaunch()
      setAutoLaunch(enabled)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg w-96 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-p4-border">
          <h2 className="text-lg font-medium">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="text-gray-400 text-sm">Loading...</div>
          ) : (
            <div className="space-y-4">
              {/* Auto Launch Setting */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-sm font-medium">Start at login</div>
                  <div className="text-xs text-gray-500">
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
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-p4-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
