import { useState, useEffect, useRef, useMemo } from 'react'

interface Stream {
  stream: string
  name: string
  parent: string
  type: string
}

interface StreamSelectorProps {
  currentStream: string | null
  onStreamChange: (streamPath: string) => void
}

// Stream type colors and icons
const STREAM_TYPE_STYLES: Record<string, { color: string; icon: string }> = {
  mainline: { color: '#22c55e', icon: 'M' },
  main: { color: '#22c55e', icon: 'M' },
  development: { color: '#3b82f6', icon: 'D' },
  dev: { color: '#3b82f6', icon: 'D' },
  release: { color: '#a855f7', icon: 'R' },
  feature: { color: '#eab308', icon: 'F' },
  task: { color: '#f97316', icon: 'T' },
  virtual: { color: '#06b6d4', icon: 'V' },
}

function getStreamStyle(type: string): { color: string; icon: string } {
  return STREAM_TYPE_STYLES[type?.toLowerCase()] || { color: '#6b7280', icon: '?' }
}

export function StreamSelector({ currentStream, onStreamChange }: StreamSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [streams, setStreams] = useState<Stream[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [depot, setDepot] = useState<string | null>(null)
  const [favoriteStreams, setFavoriteStreams] = useState<string[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Extract current stream name for display
  const currentStreamName = currentStream
    ?.replace('/...', '')
    .split('/')
    .pop() || 'Select Stream'

  const currentStreamPath = currentStream?.replace('/...', '') || null

  // Load favorites from local storage on mount
  useEffect(() => {
    try {
      const savedFavorites = localStorage.getItem('favoriteStreams')
      if (savedFavorites) {
        setFavoriteStreams(JSON.parse(savedFavorites))
      }
    } catch (e) {
      console.error("Failed to parse favorite streams from localStorage", e)
      setFavoriteStreams([])
    }
  }, [])

  // Load streams when dropdown opens
  useEffect(() => {
    if (isOpen && streams.length === 0) {
      loadStreams()
    }
  }, [isOpen])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadStreams = async () => {
    setLoading(true)
    setError(null)
    try {
      const currentDepot = await window.p4.getCurrentDepot()
      setDepot(currentDepot)
      if (!currentDepot) {
        setError('Could not determine depot')
        return
      }

      const streamsData = await window.p4.getStreams(currentDepot)
      const mappedStreams: Stream[] = streamsData.map((s: any) => ({
        stream: s.stream,
        name: s.stream.split('/').pop() || s.name,
        parent: s.parent || 'none',
        type: s.type || 'development'
      }))

      mappedStreams.sort((a, b) => a.name.localeCompare(b.name))
      setStreams(mappedStreams)
    } catch (err: any) {
      setError(err.message || 'Failed to load streams')
    } finally {
      setLoading(false)
    }
  }

  const handleStreamSelect = async (stream: Stream) => {
    if (stream.stream === currentStreamPath) {
      setIsOpen(false)
      return
    }
    setSwitching(true)
    setError(null)
    try {
      const result = await window.p4.switchStream(stream.stream)
      if (result.success) {
        onStreamChange(stream.stream + '/...')
        setIsOpen(false)
      } else {
        setError(result.message)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to switch stream')
    } finally {
      setSwitching(false)
    }
  }

  const toggleFavorite = (streamPath: string) => {
    const newFavorites = favoriteStreams.includes(streamPath)
      ? favoriteStreams.filter(s => s !== streamPath)
      : [...favoriteStreams, streamPath]
    setFavoriteStreams(newFavorites)
    localStorage.setItem('favoriteStreams', JSON.stringify(newFavorites))
  }

  const { favoriteItems, otherItems } = useMemo(() => {
    const favorites = streams.filter(s => favoriteStreams.includes(s.stream))
    const others = streams.filter(s => !favoriteStreams.includes(s.stream))
    return { favoriteItems: favorites, otherItems: others }
  }, [streams, favoriteStreams])

  const otherGroupedStreams = useMemo(() => {
    return otherItems.reduce((acc, stream) => {
      const parentKey = stream.parent === 'none' ? '__root__' : stream.parent
      if (!acc[parentKey]) acc[parentKey] = []
      acc[parentKey].push(stream)
      return acc
    }, {} as Record<string, Stream[]>)
  }, [otherItems])

  const renderStreamItem = (stream: Stream, depth: number = 0, isFavorite: boolean = false) => {
    const style = getStreamStyle(stream.type)
    const isCurrent = stream.stream === currentStreamPath

    return (
      <div
        key={stream.stream}
        onClick={() => handleStreamSelect(stream)}
        className={`
          w-full text-left px-3 py-2 flex items-center gap-2 group
          transition-colors disabled:opacity-50 cursor-pointer
          ${isCurrent
            ? 'bg-p4-blue/20 text-white'
            : 'hover:bg-gray-700 text-gray-300'
          }
        `}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <span
          className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: style.color + '30', color: style.color }}
        >
          {style.icon}
        </span>

        <span className="flex-1 truncate">{stream.name}</span>

        {isCurrent && <span className="text-xs text-p4-blue">current</span>}

        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleFavorite(stream.stream)
          }}
          className={`p-1 rounded-full transition-colors ${isFavorite ? 'text-yellow-400' : 'text-gray-600 group-hover:text-yellow-500'}`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.96a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.448a1 1 0 00-.364 1.118l1.287 3.96c.3.921-.755 1.688-1.54 1.118l-3.368-2.448a1 1 0 00-1.175 0l-3.368 2.448c-.784.57-1.838-.197-1.54-1.118l1.287-3.96a1 1 0 00-.364-1.118L2.25 9.387c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.96z" />
          </svg>
        </button>
      </div>
    )
  }

  const renderHierarchicalStreams = (stream: Stream, depth: number = 0) => {
    const children = otherGroupedStreams[stream.stream] || []
    return (
      <div key={stream.stream}>
        {renderStreamItem(stream, depth)}
        {children.map(child => renderHierarchicalStreams(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors text-sm text-white"
      >
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>
        <span className="max-w-[120px] truncate">{currentStreamName}</span>
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-p4-darker border border-p4-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-p4-border bg-gray-800/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{depot ? `//${depot}` : 'Streams'}</span>
              <button onClick={loadStreams} disabled={loading} className="text-xs text-gray-500 hover:text-gray-300">{loading ? 'Loading...' : 'Refresh'}</button>
            </div>
          </div>

          {error && <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10">{error}</div>}
          {switching && <div className="px-3 py-2 text-xs text-yellow-400 bg-yellow-500/10 flex items-center gap-2"><div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />Switching stream...</div>}

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">Loading streams...</div>
            ) : streams.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">No streams found<div className="text-xs mt-1">(Classic depot?)</div></div>
            ) : (
              <>
                {favoriteItems.length > 0 && (
                  <div className="pt-2">
                    <div className="px-3 pb-1 text-xs font-semibold text-gray-500">Favorites</div>
                    {favoriteItems.map(stream => renderStreamItem(stream, 0, true))}
                    <div className="my-2 border-t border-p4-border/50"></div>
                  </div>
                )}
                
                <div className="px-3 pb-1 text-xs font-semibold text-gray-500">Streams</div>
                {(otherGroupedStreams['__root__'] || []).map(stream => renderHierarchicalStreams(stream, 0))}
                {otherItems
                  .filter(s => s.parent !== 'none' && !otherItems.some(p => p.stream === s.parent))
                  .map(stream => renderHierarchicalStreams(stream, 0))
                }
              </>
            )}
          </div>

          <div className="px-3 py-2 border-t border-p4-border bg-gray-800/50">
            <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
              {Object.entries(STREAM_TYPE_STYLES).slice(0, 5).map(([type, style]) => (
                <span key={type} className="flex items-center gap-1">
                  <span
                    className="w-3 h-3 rounded text-[8px] font-bold flex items-center justify-center"
                    style={{ backgroundColor: style.color + '30', color: style.color }}
                  >
                    {style.icon}
                  </span>
                  {type}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
