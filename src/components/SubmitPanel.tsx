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

  const prefixes = [
    { label: 'Feat', value: 'feat: ' },
    { label: 'Fix', value: 'fix: ' },
    { label: 'Chore', value: 'chore: ' },
    { label: 'Refactor', value: 'refactor: ' },
    { label: 'Docs', value: 'docs: ' },
  ]
  const [issueLink, setIssueLink] = useState('')

  const handlePrefixClick = (prefix: string) => {
    // If description already starts with a prefix, replace it
    // Regex matches common conventional commits prefixes: start of string, word, colon, space
    const prefixRegex = /^(feat|fix|chore|refactor|docs|style|test|perf|ci|build|revert)(\(.*\))?: /i
    
    if (prefixRegex.test(submitDescription)) {
      setSubmitDescription(submitDescription.replace(prefixRegex, prefix))
    } else {
      setSubmitDescription(prefix + submitDescription)
    }
  }

  const handleIssueLinkChange = (link: string) => {
    setIssueLink(link)
    // Remove existing Fixes footer if present to avoid duplicates during editing?
    // Actually, real-time update of description might be tricky if user is also editing manually.
    // Better to append it when submitting or just provide a button "Add Link"
    // Let's go with "Add to Description" button approach for safety, or auto-append if it's not there.
  }

  const addIssueLinkToDescription = () => {
    if (!issueLink.trim()) return
    
    // Check if it's a URL or just an ID
    const isUrl = issueLink.startsWith('http')
    const footerText = isUrl ? `\n\nFixes: ${issueLink}` : `\n\nFixes: ${issueLink}`
    
    if (!submitDescription.includes(issueLink)) {
      setSubmitDescription(submitDescription.trimEnd() + footerText)
      toast?.showToast({ type: 'success', title: 'Link added to description', duration: 2000 })
    }
  }

  const openIssueLink = () => {
    if (!issueLink) return
    let url = issueLink
    if (!url.startsWith('http')) {
      // If just an ID, we can't really open it without a base URL setting.
      // For now assume it might be a full URL if they want to test it.
      toast?.showToast({ type: 'error', title: 'Please enter a full URL to test', duration: 3000 })
      return
    }
    // Open in browser
    window.open(url, '_blank')
  }

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

  const handleRequestReview = async () => {
    if (!submitDescription.trim()) {
      toast?.showToast({
        type: 'error',
        title: 'Please enter a description for the review',
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
      let targetChangelistId = selectedChangelist === 'default' ? 0 : selectedChangelist

      // If Default CL: Create new CL and move files
      if (targetChangelistId === 0) {
        const createResult = await window.p4.createChangelist(submitDescription)
        if (!createResult.success) {
          throw new Error(createResult.message)
        }
        targetChangelistId = createResult.changelistNumber
        
        // Move checked files to this new CL
        const filesToReview = filteredFiles
          .filter(f => checkedFiles.has(f.depotFile))
          .map(f => f.depotFile)
          
        await window.p4.reopenFiles(filesToReview, targetChangelistId)
      } else {
        // If Numbered CL: Move unchecked files away, update description
        const uncheckedFiles = filteredFiles
          .filter(f => !checkedFiles.has(f.depotFile))
          .map(f => f.depotFile)
          
        if (uncheckedFiles.length > 0) {
          await window.p4.reopenFiles(uncheckedFiles, 'default')
        }
        
        await window.p4.editChangelist(targetChangelistId as number, submitDescription)
      }

      // Shelve
      const shelveResult = await window.p4.shelve(targetChangelistId as number)
      
      if (shelveResult.success) {
        // Try to get Swarm URL
        const swarmUrl = await window.p4.getSwarmUrl()
        let message = `Shelved files in CL ${targetChangelistId}`
        
        if (swarmUrl) {
          // Construct Swarm link (standard format: URL/changes/CL)
          // Ensure swarmUrl doesn't end with / and append path
          const cleanSwarmUrl = swarmUrl.replace(/\/$/, '')
          const reviewLink = `${cleanSwarmUrl}/changes/${targetChangelistId}`
          message = `Review created: ${reviewLink}`
          
          // Allow user to click (we'll rely on the toast implementation or just show text for now)
          // Ideally we would have a clickable action, but message is fine.
          // We can also log it to console for easy access
          console.log('Swarm Review Link:', reviewLink)
        }

        toast?.showToast({
          type: 'success',
          title: 'Review Requested',
          message: message,
          duration: 8000 // Longer duration to read link
        })
        setSubmitDescription('')
        await refresh()
      } else {
        throw new Error(shelveResult.message)
      }

    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Request Review failed',
        message: err.message,
        duration: 6000
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="border-t border-p4-border bg-p4-darker p-3">
      {/* Description Helper Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1">
          {prefixes.map(p => (
            <button
              key={p.label}
              onClick={() => handlePrefixClick(p.value)}
              className="px-2 py-0.5 text-xs bg-p4-border hover:bg-gray-600 rounded text-gray-300 transition-colors"
              title={`Add ${p.label} prefix`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-p4-border mx-1"></div>
        <div className="flex flex-1 items-center gap-1 min-w-[200px]">
          <input
            type="text"
            value={issueLink}
            onChange={(e) => handleIssueLinkChange(e.target.value)}
            placeholder="Issue URL or ID"
            className="flex-1 bg-p4-dark border border-p4-border rounded px-2 py-0.5 text-xs focus:outline-none focus:border-p4-blue"
          />
          <button
            onClick={addIssueLinkToDescription}
            disabled={!issueLink.trim()}
            className="px-2 py-0.5 text-xs bg-p4-border hover:bg-gray-600 rounded text-gray-300 disabled:opacity-50"
            title="Append to description"
          >
            Add
          </button>
          <button
            onClick={openIssueLink}
            disabled={!issueLink.trim() || !issueLink.startsWith('http')}
            className="px-2 py-0.5 text-xs bg-p4-border hover:bg-gray-600 rounded text-gray-300 disabled:opacity-50"
            title="Test Link"
          >
            ↗
          </button>
        </div>
      </div>

      <div className="mb-2">
        <textarea
          value={submitDescription}
          onChange={(e) => setSubmitDescription(e.target.value)}
          placeholder="Enter changelist description..."
          className="w-full h-20 bg-p4-dark border border-p4-border rounded p-2 text-sm resize-none focus:outline-none focus:border-p4-blue"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {checkedCount} file(s) selected
        </span>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={handleRequestReview}
            disabled={isSubmitting || checkedCount === 0 || !submitDescription.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Request Review
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || checkedCount === 0 || !submitDescription.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-p4-blue hover:bg-blue-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isSubmitting ? 'Submitting...' : `Submit (${checkedCount})`}
          </button>
        </div>
      </div>
    </div>
  )
}
