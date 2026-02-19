import { create } from 'zustand'

interface P4Info {
  userName: string
  clientName: string
  clientRoot: string
  serverAddress: string
  serverVersion: string
}

interface P4File {
  depotFile: string
  clientFile: string
  action: 'add' | 'edit' | 'delete' | 'branch' | 'move/add' | 'move/delete' | 'integrate'
  changelist: number | 'default'
  type: string
  status?: 'open' | 'shelved'
}

interface P4Changelist {
  number: number
  status: 'pending' | 'submitted'
  description: string
  user: string
  client: string
  date?: string
  reviewId?: number
  reviewStatus?: string
}

interface P4DiffResult {
  filePath: string
  oldContent: string
  newContent: string
  hunks: string
}

interface P4Store {
  // State
  info: P4Info | null
  files: P4File[]
  changelists: P4Changelist[]
  selectedFile: P4File | null
  selectedChangelist: number | 'default'
  currentDiff: P4DiffResult | null
  isLoading: boolean
  isDiffLoading: boolean
  error: string | null
  checkedFiles: Set<string>  // depot paths of checked files
  submitDescription: string

  // Actions
  setInfo: (info: P4Info) => void
  setFiles: (files: P4File[]) => void
  setChangelists: (changelists: P4Changelist[]) => void
  setSelectedFile: (file: P4File | null) => void
  setSelectedChangelist: (cl: number | 'default') => void
  setCurrentDiff: (diff: P4DiffResult | null) => void
  setLoading: (loading: boolean) => void
  setDiffLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleFileCheck: (depotPath: string) => void
  setAllFilesChecked: (checked: boolean) => void
  setCheckedList: (depotPaths: string[]) => void
  setSubmitDescription: (desc: string) => void
  clearSelection: () => void

  // Async actions
  fetchInfo: () => Promise<void>
  fetchFiles: () => Promise<void>
  fetchChangelists: () => Promise<void>
  fetchDiff: (file: P4File) => Promise<void>
  deleteChangelist: (changelist: number) => Promise<{ success: boolean; message: string }>
  refresh: () => Promise<void>
}

export const useP4Store = create<P4Store>((set, get) => ({
  // Initial state
  info: null,
  files: [],
  changelists: [],
  selectedFile: null,
  selectedChangelist: 'default',
  currentDiff: null,
  isLoading: false,
  isDiffLoading: false,
  error: null,
  checkedFiles: new Set<string>(),
  submitDescription: '',

  // Setters
  setInfo: (info) => set({ info }),
  setFiles: (files) => {
    // When files change, check all files by default
    const newChecked = new Set(files.map(f => f.depotFile))
    set({ files, checkedFiles: newChecked })
  },
  setChangelists: (changelists) => set({ changelists }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setSelectedChangelist: (cl) => {
    const { changelists, files } = get()
    const changelist = changelists.find(c =>
      (cl === 'default' && c.number === 0) || c.number === cl
    )
    // Get files for the new changelist
    const filteredFiles = files.filter(f => {
      if (cl === 'default' || cl === 0) {
        return f.changelist === 'default' || f.changelist === 0
      }
      return f.changelist === cl
    })
    // Reset checked files to only include files in the new changelist
    const newCheckedFiles = new Set(filteredFiles.map(f => f.depotFile))
    set({
      selectedChangelist: cl,
      submitDescription: changelist?.description || '',
      selectedFile: null,
      currentDiff: null,
      checkedFiles: newCheckedFiles
    })
  },
  setCurrentDiff: (diff) => set({ currentDiff: diff }),
  setLoading: (loading) => set({ isLoading: loading }),
  setDiffLoading: (loading) => set({ isDiffLoading: loading }),
  setError: (error) => set({ error }),
  toggleFileCheck: (depotPath) => set((state) => {
    const newChecked = new Set(state.checkedFiles)
    if (newChecked.has(depotPath)) {
      newChecked.delete(depotPath)
    } else {
      newChecked.add(depotPath)
    }
    return { checkedFiles: newChecked }
  }),
  setAllFilesChecked: (checked) => set((state) => {
    if (checked) {
      return { checkedFiles: new Set(state.files.map(f => f.depotFile)) }
    }
    return { checkedFiles: new Set() }
  }),
  setCheckedList: (depotPaths) => set({ checkedFiles: new Set(depotPaths) }),
  setSubmitDescription: (desc) => set({ submitDescription: desc }),
  clearSelection: () => set({ selectedFile: null, currentDiff: null }),

  // Async actions
  fetchInfo: async () => {
    try {
      const info = await window.p4.getInfo()
      set({ info, error: null })
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  fetchFiles: async () => {
    try {
      const files = await window.p4.getOpenedFiles()
      set({ files, error: null })
    } catch (err: any) {
      set({ files: [], error: err.message })
    }
  },

  fetchChangelists: async () => {
    try {
      const changelists = await window.p4.getChangelists()
      set({ changelists, error: null })
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  fetchDiff: async (file) => {
    try {
      set({ isDiffLoading: true, selectedFile: file })
      const filePath = file.clientFile || file.depotFile
      const diff = await window.p4.getDiff(filePath)
      set({ currentDiff: diff, isDiffLoading: false, error: null })
    } catch (err: any) {
      set({ currentDiff: null, isDiffLoading: false, error: err.message })
    }
  },

  deleteChangelist: async (changelist: number) => {
    try {
      set({ isLoading: true })
      const result = await window.p4.deleteChangelist(changelist)
      if (result.success) {
        // Refresh changelists after deletion
        await get().fetchChangelists()
        // If deleted changelist was selected, select default
        if (get().selectedChangelist === changelist) {
          get().setSelectedChangelist('default')
        }
      }
      set({ isLoading: false })
      return result
    } catch (err: any) {
      set({ isLoading: false, error: err.message })
      return { success: false, message: err.message }
    }
  },

  refresh: async () => {
    // Don't set global isLoading to avoid UI flashing/blocking during refresh
    const { fetchInfo, fetchFiles, fetchChangelists } = get()
    await Promise.all([fetchInfo(), fetchFiles(), fetchChangelists()])
  }
}))
