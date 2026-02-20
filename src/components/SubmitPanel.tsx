import { useEffect, useRef, useState } from 'react'
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
  const requestReviewLockRef = useRef(false)
  const [showReviewerPicker, setShowReviewerPicker] = useState(false)
  const [availableUsers, setAvailableUsers] = useState<string[]>([])
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([])
  const [reviewerFilter, setReviewerFilter] = useState('')

  const filteredFiles = files.filter(file => {
    if (selectedChangelist === 'default') {
      return file.changelist === 'default' || file.changelist === 0
    }
    return file.changelist === selectedChangelist
  })

  const checkedCount = filteredFiles.filter(f => checkedFiles.has(f.depotFile)).length

  useEffect(() => {
    const loadReviewerSettings = async () => {
      try {
        const [users, defaults] = await Promise.all([
          window.p4.getUsers(),
          window.settings.getDefaultReviewers()
        ])
        const sortedUsers = [...users].sort((a, b) => a.localeCompare(b))
        const validDefaults = defaults.filter((name) => sortedUsers.includes(name))
        setAvailableUsers(sortedUsers)
        setSelectedReviewers(validDefaults)
      } catch {
        setAvailableUsers([])
      }
    }
    loadReviewerSettings()
  }, [])

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

  const persistDefaultReviewers = async (nextReviewers: string[]) => {
    try {
      await window.settings.setDefaultReviewers(nextReviewers)
    } catch {
      // Ignore persistence failures in UI
    }
  }

  const toggleReviewer = (name: string) => {
    const next = selectedReviewers.includes(name)
      ? selectedReviewers.filter((item) => item !== name)
      : [...selectedReviewers, name]
    setSelectedReviewers(next)
    persistDefaultReviewers(next)
  }

  const clearReviewers = () => {
    setSelectedReviewers([])
    persistDefaultReviewers([])
  }

  const filteredUsers = availableUsers.filter((name) =>
    name.toLowerCase().includes(reviewerFilter.toLowerCase())
  )

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
    if (requestReviewLockRef.current) {
      return
    }

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

    if (selectedReviewers.length === 0) {
      toast?.showToast({
        type: 'error',
        title: 'No reviewers selected',
        message: 'Pick at least one reviewer before requesting review.',
        duration: 4000
      })
      return
    }

    requestReviewLockRef.current = true
    setIsSubmitting(true)

    try {
      const finalDescription = submitDescription.trim()

      const selectedEntries = filteredFiles.filter((f) => checkedFiles.has(f.depotFile))
      const filesToReview = selectedEntries.map((f) => f.depotFile)
      const selectedShelvedEntries = selectedEntries.filter((f: any) => f.status === 'shelved')
      const hasOnlyShelvedSelection = selectedEntries.length > 0 && selectedShelvedEntries.length === selectedEntries.length
      const shelvedChangelists = Array.from(
        new Set(
          selectedShelvedEntries
            .map((f: any) => f.changelist)
            .filter((cl): cl is number => typeof cl === 'number' && cl > 0)
        )
      )

      let targetChangelistId = selectedChangelist === 'default' ? 0 : selectedChangelist
      let usedExistingShelvedCl = false

      if (hasOnlyShelvedSelection) {
        if (shelvedChangelists.length !== 1) {
          throw new Error('Select shelved files from exactly one numbered changelist.')
        }
        targetChangelistId = shelvedChangelists[0]
        usedExistingShelvedCl = true
        await window.p4.editChangelist(targetChangelistId as number, finalDescription)
      } else if (targetChangelistId === 0) {
        const createResult = await window.p4.createChangelist(finalDescription)
        if (!createResult.success) {
          throw new Error(createResult.message)
        }
        targetChangelistId = createResult.changelistNumber
        await window.p4.reopenFiles(filesToReview, targetChangelistId)
      } else {
        // If Numbered CL: Move unchecked files away, update description
        const uncheckedFiles = filteredFiles
          .filter(f => !checkedFiles.has(f.depotFile))
          .map(f => f.depotFile)

        if (uncheckedFiles.length > 0) {
          await window.p4.reopenFiles(uncheckedFiles, 'default')
        }
        await window.p4.editChangelist(targetChangelistId as number, finalDescription)
      }

      if (!usedExistingShelvedCl) {
        const shelveResult = await window.p4.shelve(targetChangelistId as number)
        if (!shelveResult.success) {
          throw new Error(shelveResult.message)
        }
      }

      let reviewResult: { success: boolean; review?: any; reviewUrl?: string; message?: string } = { success: false, message: 'Review request failed.' }
      try {
        reviewResult = await window.p4.createSwarmReview(
          targetChangelistId as number,
          selectedReviewers,
          finalDescription
        )
      } catch (reviewErr: any) {
        reviewResult = { success: false, message: reviewErr?.message || 'Review request failed.' }
      }

      // Revert only when we shelved from opened workspace files.
      if (!usedExistingShelvedCl) {
        await window.p4.revert(filesToReview)
      }

      // Open review page when available (fallback: changelist page)
      if (reviewResult.success && reviewResult.reviewUrl) {
        await window.settings.setReviewLink(targetChangelistId as number, reviewResult.reviewUrl)
        window.open(reviewResult.reviewUrl, '_blank')
      } else {
        const swarmUrl = await window.p4.getSwarmUrl()
        if (swarmUrl) {
          const cleanSwarmUrl = swarmUrl.replace(/\/$/, '')
          const changelistUrl = `${cleanSwarmUrl}/changes/${targetChangelistId}`
          window.open(changelistUrl, '_blank')
        }
      }

      toast?.showToast({
        type: reviewResult.success ? 'success' : 'error',
        title: reviewResult.success ? 'Review Requested' : 'Review Request Failed',
        message: reviewResult.success
          ? `CL ${targetChangelistId} review requested${selectedReviewers.length > 0 ? ` (${selectedReviewers.length} reviewer${selectedReviewers.length > 1 ? 's' : ''})` : ''}.`
          : `CL ${targetChangelistId}${usedExistingShelvedCl ? '' : ' shelved,'} but review request failed: ${reviewResult.message || 'Unknown error'}`,
        duration: 5000
      })
      setSubmitDescription('')
      await refresh()

    } catch (err: any) {
      toast?.showToast({
        type: 'error',
        title: 'Request Review failed',
        message: err.message,
        duration: 6000
      })
    } finally {
      setIsSubmitting(false)
      requestReviewLockRef.current = false
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
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                
                if (selectedChangelist === 'default' || selectedChangelist === 0) {
                  toast?.showToast({
                    type: 'info',
                    title: 'Cannot save to Default Changelist',
                    message: 'Descriptions persist only on numbered changelists. Create a new changelist or request a review to save.',
                    duration: 5000
                  })
                  return
                }

                if (!submitDescription.trim()) return

                try {
                  const result = await window.p4.editChangelist(selectedChangelist as number, submitDescription)
                  if (result.success) {
                    toast?.showToast({
                      type: 'success',
                      title: 'Description Saved',
                      duration: 2000
                    })
                    await refresh()
                  } else {
                    toast?.showToast({
                      type: 'error',
                      title: 'Save Failed',
                      message: result.message,
                      duration: 4000
                    })
                  }
                } catch (err: any) {
                  toast?.showToast({
                    type: 'error',
                    title: 'Error Saving Description',
                    message: err.message,
                    duration: 4000
                  })
                }
              }
            }}
            placeholder="Enter changelist description..."
            className="w-full h-20 bg-p4-dark border border-p4-border rounded p-2 text-sm resize-none focus:outline-none focus:border-p4-blue"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {checkedCount} file(s) selected
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative">
              <button
                onClick={() => setShowReviewerPicker((prev) => !prev)}
                className="px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 rounded transition-colors whitespace-nowrap"
                title="Pick default reviewers for Request Review"
              >
                Reviewers {selectedReviewers.length > 0 ? `(${selectedReviewers.length})` : ''}
              </button>
              {showReviewerPicker && (
                <div className="absolute right-0 bottom-9 w-72 max-h-72 overflow-hidden border border-p4-border rounded bg-p4-darker shadow-lg z-20">
                  <div className="p-2 border-b border-p4-border">
                    <input
                      value={reviewerFilter}
                      onChange={(e) => setReviewerFilter(e.target.value)}
                      placeholder="Filter users..."
                      className="w-full bg-p4-dark border border-p4-border rounded px-2 py-1 text-xs focus:outline-none focus:border-p4-blue"
                    />
                  </div>
                  <div className="max-h-44 overflow-auto p-2 space-y-1">
                    {filteredUsers.length === 0 ? (
                      <div className="text-xs text-gray-400">No matching users</div>
                    ) : (
                      filteredUsers.map((name) => (
                        <label key={name} className="flex items-center gap-2 text-xs text-gray-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedReviewers.includes(name)}
                            onChange={() => toggleReviewer(name)}
                          />
                          <span className="truncate" title={name}>{name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-p4-border flex justify-between">
                    <button
                      onClick={clearReviewers}
                      className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setShowReviewerPicker(false)}
                      className="px-2 py-1 text-xs bg-p4-blue hover:bg-blue-600 rounded"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
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
