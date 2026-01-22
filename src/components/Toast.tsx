import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info'
  title: string
  message?: string
  duration?: number
}

interface ToastProps {
  toasts: ToastMessage[]
  onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: () => void }) {
  useEffect(() => {
    const duration = toast.duration || 4000
    const timer = setTimeout(onRemove, duration)
    return () => clearTimeout(timer)
  }, [toast.duration, onRemove])

  const bgColor = toast.type === 'success' ? 'bg-green-600' :
                  toast.type === 'error' ? 'bg-red-600' :
                  'bg-p4-blue'

  const icon = toast.type === 'success' ? '✓' :
               toast.type === 'error' ? '✕' :
               'ℹ'

  return (
    <div
      className={`${bgColor} text-white rounded-lg shadow-lg p-4 min-w-[300px] max-w-[400px] flex items-start gap-3 animate-slide-in`}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1">
        <div className="font-medium">{toast.title}</div>
        {toast.message && (
          <div className="text-sm opacity-90 mt-1">{toast.message}</div>
        )}
      </div>
      <button
        onClick={onRemove}
        className="opacity-60 hover:opacity-100 text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, onRemove }: ToastProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => onRemove(toast.id)}
        />
      ))}
    </div>
  )
}

// Toast hook for easy usage
let toastIdCounter = 0
let addToastFn: ((toast: Omit<ToastMessage, 'id'>) => void) | null = null

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${++toastIdCounter}`
    setToasts(prev => [...prev, { ...toast, id }])
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // Expose addToast globally
  useEffect(() => {
    addToastFn = addToast
    return () => { addToastFn = null }
  }, [])

  return { toasts, addToast, removeToast }
}

// Global toast function
export function showToast(toast: Omit<ToastMessage, 'id'>) {
  if (addToastFn) {
    addToastFn(toast)
  }
}
