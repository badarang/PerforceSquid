import { useEffect, useState } from 'react'
import { DiffViewer } from './DiffViewer'
import { useP4Store } from '../stores/p4Store'

export function DiffWindow() {
  const { setSelectedFile, fetchDiff } = useP4Store()

  useEffect(() => {
    // Parse query params from hash
    // URL format: .../#diff?file={...}&mode={...}
    const hash = window.location.hash
    const queryIndex = hash.indexOf('?')
    if (queryIndex === -1) return

    const queryString = hash.slice(queryIndex + 1)
    const searchParams = new URLSearchParams(queryString)
    const fileParam = searchParams.get('file')
    const mode = searchParams.get('mode') as 'diff' | 'edit' || 'diff'
    
    setInitialMode(mode)
    
    if (fileParam) {
      try {
        const file = JSON.parse(decodeURIComponent(fileParam))
        setSelectedFile(file)
        
        // Fetch diff immediately
        const clientPath = file.clientFile && file.clientFile.trim() !== ''
          ? file.clientFile
          : null
          
        if (clientPath) {
          fetchDiff({ ...file, diffPath: clientPath })
        }
      } catch (e) {
        console.error('Failed to parse file param', e)
      }
    }
  }, [])

  const [initialMode, setInitialMode] = useState<'diff' | 'edit'>('diff')

  return (
    <div className="h-screen bg-p4-dark text-white flex flex-col">
      <div className="flex-1 overflow-hidden">
        <DiffViewer isStandalone={true} initialMode={initialMode} />
      </div>
    </div>
  )
}
