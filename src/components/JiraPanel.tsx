import { useEffect, useState } from 'react'

interface JiraPanelProps {
  isOpen: boolean
  onClose: () => void
}

interface JiraPanelStatus {
  configuredPath: string
  exists: boolean
  hasMainScript: boolean
  pythonAvailable: boolean
  jiraBaseUrl?: string
  message: string
}

function linkifyLine(line: string, jiraBaseUrl?: string): Array<{ text: string; href?: string }> {
  const tokenRegex = /(https?:\/\/[^\s]+)|([A-Z][A-Z0-9]+-\d+)/g
  const parts: Array<{ text: string; href?: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: line.slice(lastIndex, match.index) })
    }

    const url = match[1]
    const ticketKey = match[2]

    if (url) {
      parts.push({ text: url, href: url })
    } else if (ticketKey && jiraBaseUrl) {
      const base = jiraBaseUrl.replace(/\/+$/, '')
      parts.push({ text: ticketKey, href: `${base}/browse/${ticketKey}` })
    } else {
      parts.push({ text: match[0] })
    }

    lastIndex = tokenRegex.lastIndex
  }

  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex) })
  }

  if (parts.length === 0) {
    parts.push({ text: line })
  }

  return parts
}

export function JiraPanel({ isOpen, onClose }: JiraPanelProps) {
  const [pathValue, setPathValue] = useState('')
  const [status, setStatus] = useState<JiraPanelStatus | null>(null)
  const [projectKey, setProjectKey] = useState('JJRHB-829')
  const [trackAssignee, setTrackAssignee] = useState('Haein Oh')
  const [trackProjectKey, setTrackProjectKey] = useState('JJRHB-829')
  const [limit, setLimit] = useState(5)
  const [trackLimit, setTrackLimit] = useState(20)
  const [ticketValue, setTicketValue] = useState('')
  const [threshold, setThreshold] = useState(0.2)
  const [output, setOutput] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadStatus()
    }
  }, [isOpen])

  const loadStatus = async () => {
    setIsBusy(true)
    try {
      const [pathResult, statusResult] = await Promise.all([
        window.jira.getPath(),
        window.jira.getStatus(),
      ])
      setPathValue(pathResult)
      setStatus(statusResult)
    } finally {
      setIsBusy(false)
    }
  }

  const handleBrowsePath = async () => {
    const selected = await window.dialog.openDirectory()
    if (selected) {
      setPathValue(selected)
    }
  }

  const handleSavePath = async () => {
    setIsBusy(true)
    try {
      await window.jira.setPath(pathValue)
      await loadStatus()
    } finally {
      setIsBusy(false)
    }
  }

  const runRecommend = async () => {
    setIsBusy(true)
    try {
      const result = await window.jira.recommend(projectKey.trim(), limit)
      setOutput(result.success ? result.output : `${result.error || 'Failed'}\n${result.output || ''}`)
    } finally {
      setIsBusy(false)
    }
  }

  const runTrack = async () => {
    setIsBusy(true)
    try {
      const result = await window.jira.track(trackProjectKey.trim(), trackAssignee.trim(), trackLimit)
      setOutput(result.success ? result.output : `${result.error || 'Failed'}\n${result.output || ''}`)
    } finally {
      setIsBusy(false)
    }
  }

  const runSimilar = async () => {
    setIsBusy(true)
    try {
      const result = await window.jira.similar(ticketValue.trim(), threshold)
      setOutput(result.success ? result.output : `${result.error || 'Failed'}\n${result.output || ''}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleOpenLink = async (targetUrl: string) => {
    try {
      await window.jira.openInChrome(targetUrl)
    } catch {
      // Ignore link open failures in UI
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-p4-darker border border-p4-border rounded-lg w-[900px] max-w-[95vw] max-h-[85vh] shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-p4-border">
          <h2 className="text-lg font-medium text-white">Unified Status: Perforce + JiraBot</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <section className="border border-p4-border rounded p-3 bg-p4-dark/40">
            <div className="text-xs text-gray-400 mb-2">JiraBot Path</div>
            <div className="flex gap-2">
              <input
                value={pathValue}
                onChange={(e) => setPathValue(e.target.value)}
                className="flex-1 bg-p4-dark border border-p4-border rounded px-3 py-2 text-sm text-white"
              />
              <button onClick={handleBrowsePath} className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">Browse</button>
              <button onClick={handleSavePath} disabled={isBusy} className="px-3 py-2 text-sm bg-p4-blue hover:bg-blue-600 rounded disabled:opacity-50">Save</button>
            </div>
            <div className="mt-2 text-sm">
              <span className="text-gray-400">Status: </span>
              <span className={status?.pythonAvailable ? 'text-green-300' : 'text-yellow-300'}>
                {status?.message || 'Not checked'}
              </span>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-p4-border rounded p-3 bg-p4-dark/40 space-y-3">
              <div className="text-sm text-white font-medium">Recommend</div>
              <div className="flex gap-2">
                <input
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value)}
                  placeholder="Project or Ticket (e.g. JJRHB-829)"
                  className="min-w-0 flex-1 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value || 10))}
                  className="w-16 min-w-0 shrink-0 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
              </div>
              <button onClick={runRecommend} disabled={isBusy || !projectKey.trim()} className="w-full px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50">
                Run /recommend
              </button>
            </div>

            <div className="border border-p4-border rounded p-3 bg-p4-dark/40 space-y-3">
              <div className="text-sm text-white font-medium">Track</div>
              <div className="flex gap-2">
                <input
                  value={trackProjectKey}
                  onChange={(e) => setTrackProjectKey(e.target.value)}
                  placeholder="Project or Ticket (e.g. JJRHB-829)"
                  className="min-w-0 flex-1 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={trackAssignee}
                  onChange={(e) => setTrackAssignee(e.target.value)}
                  placeholder='Assignee (e.g. Haein Oh)'
                  className="min-w-0 flex-1 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={trackLimit}
                  onChange={(e) => setTrackLimit(Number(e.target.value || 20))}
                  className="w-16 min-w-0 shrink-0 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
              </div>
              <button onClick={runTrack} disabled={isBusy || !trackProjectKey.trim() || !trackAssignee.trim()} className="w-full px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50">
                Run /track
              </button>
            </div>

            <div className="border border-p4-border rounded p-3 bg-p4-dark/40 space-y-3">
              <div className="text-sm text-white font-medium">Similar</div>
              <div className="flex gap-2">
                <input
                  value={ticketValue}
                  onChange={(e) => setTicketValue(e.target.value)}
                  placeholder="Ticket key or URL"
                  className="min-w-0 flex-1 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value || 0.2))}
                  className="w-16 min-w-0 shrink-0 bg-p4-dark border border-p4-border rounded px-2 py-2 text-sm text-white"
                />
              </div>
              <button onClick={runSimilar} disabled={isBusy || !ticketValue.trim()} className="w-full px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50">
                Run /similar
              </button>
            </div>
          </section>

          <section className="border border-p4-border rounded p-3 bg-black/30">
            <div className="text-xs text-gray-400 mb-2">JiraBot Output</div>
            <div className="text-xs text-gray-100 whitespace-pre-wrap break-words max-h-[320px] overflow-auto font-mono">
              {(output || 'No output yet.').split('\n').map((line, lineIndex) => (
                <div key={`line-${lineIndex}`}>
                  {linkifyLine(line, status?.jiraBaseUrl).map((part, partIndex) => (
                    part.href ? (
                      <button
                        key={`part-${lineIndex}-${partIndex}`}
                        type="button"
                        onClick={() => handleOpenLink(part.href!)}
                        className="text-p4-blue hover:underline"
                      >
                        {part.text}
                      </button>
                    ) : (
                      <span key={`part-${lineIndex}-${partIndex}`}>{part.text}</span>
                    )
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
