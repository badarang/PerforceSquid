import { useEffect, useState } from 'react'

interface NotesPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function NotesPanel({ isOpen, onClose }: NotesPanelProps) {
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    if (!isOpen) return

    const loadNotes = async () => {
      setIsLoading(true)
      try {
        const stored = await window.settings.getNotes()
        setNotes(stored || '')
      } finally {
        setIsLoading(false)
      }
    }

    loadNotes()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || isLoading) return

    const timer = setTimeout(async () => {
      setIsSaving(true)
      try {
        await window.settings.setNotes(notes)
        setSaveMessage('Saved')
      } finally {
        setIsSaving(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [notes, isOpen, isLoading])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg w-[900px] max-w-[95vw] max-h-[85vh] shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-p4-border">
          <h2 className="text-lg font-medium text-white">Notes</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-2 min-h-[420px]">
          <textarea
            value={notes}
            onChange={(e) => {
              setSaveMessage('')
              setNotes(e.target.value)
            }}
            placeholder="Type notes here..."
            className="flex-1 min-h-0 resize-none bg-p4-dark border border-p4-border rounded px-3 py-2 text-sm text-white"
          />
          <div className="text-xs text-gray-400">
            {isLoading ? (
              <span className="inline-block h-3 w-20 rounded bg-gray-700/60 animate-pulse" />
            ) : isSaving ? 'Saving...' : saveMessage || 'Autosave enabled'}
          </div>
        </div>
      </div>
    </div>
  )
}
