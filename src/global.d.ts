import type { P4Info, P4File, P4Changelist, P4DiffResult, P4Stream, P4Workspace, P4Depot, StreamRelation, StreamGraphData } from '../electron/p4/types'

interface P4Client {
  name: string
  root: string
  description: string
}

interface P4Api {
  getClients: () => Promise<P4Client[]>
  createClient: (client: {
    name: string
    root: string
    options: string
    submitOptions: string
    stream?: string
    description?: string
  }) => Promise<{ success: boolean; message: string }>
  setClient: (clientName: string) => Promise<{ success: boolean }>
  getClient: () => Promise<string | null>
  getInfo: () => Promise<P4Info>
  getOpenedFiles: () => Promise<P4File[]>
  getDiff: (filePath: string) => Promise<P4DiffResult>
  getChangelists: () => Promise<P4Changelist[]>
  submit: (changelist: number, description: string) => Promise<{ success: boolean; message: string }>
  sync: (filePath?: string) => Promise<{ success: boolean; message: string }>
  revert: (files: string[]) => Promise<{ success: boolean; message: string }>
  revertUnchanged: () => Promise<{ success: boolean; message: string; revertedCount: number }>
  shelve: (changelist: number) => Promise<{ success: boolean; message: string }>
  unshelve: (changelist: number) => Promise<{ success: boolean; message: string }>
  getSubmittedChanges: (depotPath: string, maxChanges?: number) => Promise<P4Changelist[]>
  describeChangelist: (changelist: number) => Promise<{
    info: P4Changelist | null
    files: Array<{ depotFile: string; action: string; revision: number }>
    diff: string
  }>
  getClientStream: () => Promise<string | null>
  switchStream: (streamPath: string) => Promise<{ success: boolean; message: string }>
  getCurrentDepot: () => Promise<string | null>
  reopenFiles: (files: string[], changelist: number | 'default') => Promise<{ success: boolean; message: string }>
  createChangelist: (description: string) => Promise<{ success: boolean; changelistNumber: number; message: string }>
  deleteChangelist: (changelist: number) => Promise<{ success: boolean; message: string }>
  revertAndDeleteChangelist: (changelist: number) => Promise<{ success: boolean; message: string }>
  getOrCreateJunkChangelist: () => Promise<{ success: boolean; changelistNumber: number; message: string }>
  annotate: (filePath: string) => Promise<{
    success: boolean
    lines: Array<{
      lineNumber: number
      changelist: number
      user: string
      date: string
      content: string
    }>
    message?: string
  }>
  // Stream Graph APIs
  getDepots: () => Promise<P4Depot[]>
  getStreams: (depot?: string) => Promise<P4Stream[]>
  getStreamSpec: (streamPath: string) => Promise<P4Stream | null>
  getAllWorkspaces: () => Promise<P4Workspace[]>
  getWorkspacesByStream: (streamPath: string) => Promise<P4Workspace[]>
  getWorkspaceDetails: (clientName: string) => Promise<P4Workspace | null>
  getStreamGraphData: (depot: string) => Promise<StreamGraphData>
  getInterchanges: (fromStream: string, toStream: string) => Promise<StreamRelation>
}

interface SettingsApi {
  getAutoLaunch: () => Promise<boolean>
  setAutoLaunch: (enabled: boolean) => Promise<{ success: boolean }>
}

interface DialogApi {
  openDirectory: () => Promise<string | null>
}

declare global {
  interface Window {
    p4: P4Api
    settings: SettingsApi
    dialog: DialogApi
  }
}

export {}
