import { useState } from 'react'
import { useP4Store } from '../stores/p4Store'
import { useToastContext } from '../App'

export function SubmitPanel() {
  const {
    files,
    selectedChangelist,
    checkedFiles,
    submitDescription,
    setSubmitDescription,
    refresh
  } = useP4Store()
  const toast = useToastContext()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const filteredFiles = files.filter(file => {
    if (selectedChangelist === 'default') {
      return file.changelist === 'default' || file.changelist === 0
    }
    return file.changelist === selectedChangelist
  })

  const checkedCount = filteredFiles.filter(f => checkedFiles.has(f.depotFile)).length

  const handleSubmit = async () => {
    if (!submitDescription.trim()) {
      toast?.showToast({
        type: 'error',
        title: 'Please enter a description',
        duration: 3000
      })
      return
    }

    if (checkedCount === 0) {
      toast?.showToast({
        type: 'error',
        title: 'No files selected',
        duration: 3000
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Get checked files for this changelist
      const filesToSubmit = filteredFiles
        .filter(f => checkedFiles.has(f.depotFile))
        .map(f => f.clientFile || f.depotFile)

      // If not all files are checked, we need to move unchecked files to another changelist first
      const uncheckedFiles = filteredFiles
        .filter(f => !checkedFiles.has(f.depotFile))
        .map(f => f.clientFile || f.depotFile)

      if (uncheckedFiles.length > 0) {
        // Move unchecked files to default changelist temporarily
        await window.p4.reopenFiles(uncheckedFiles, 'default')
      }

      // Submit the changelist
      const cl = selectedChangelist === 'default' ? 0 : selectedChangelist
      const result = await window.p4.submit(cl as number, submitDescription)

      if (result.success) {
        toast?.showToast({
          type: 'success',
          title: 'Submit successful',
          message: `Submitted ${filesToSubmit.length} file(s)`,
          duration: 5000
        })
        setSubmitDescription('')
        await refresh()
      } else {
        // If submit failed and we moved files, try to move them back
        if (uncheckedFiles.length > 0) {
          try {
            await window.p4.reopenFiles(uncheckedFiles, selectedChangelist === 'default' ? 0 : selectedChangelist as number)
          } catch {
            // Best effort to restore
          }
        }
        toast?.showToast({
          type: 'error',
          title: 'Submit failed',
          message: result.message,
          duration: 6000
        })
      }
    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Submit failed',
        message: err.message,
        duration: 6000
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="border-t border-p4-border bg-p4-darker p-3">
      <div className="mb-2">
        <textarea
          value={submitDescription}
          onChange={(e) => setSubmitDescription(e.target.value)}
          placeholder="Enter changelist description..."
          className="w-full h-20 bg-p4-dark border border-p4-border rounded p-2 text-sm resize-none focus:outline-none focus:border-p4-blue"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {checkedCount} file(s) selected
        </span>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || checkedCount === 0 || !submitDescription.trim()}
          className="px-4 py-1.5 text-sm bg-p4-blue hover:bg-blue-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Submitting...' : `Submit (${checkedCount})`}
        </button>
      </div>
    </div>
  )
}
