import { contextBridge, ipcRenderer } from 'electron'

const p4Api = {
  getClients: () => ipcRenderer.invoke('p4:clients'),
  createClient: (client: any) => ipcRenderer.invoke('p4:createClient', client),
  setClient: (clientName: string) => ipcRenderer.invoke('p4:setClient', clientName),
  getClient: () => ipcRenderer.invoke('p4:getClient'),
  getInfo: () => ipcRenderer.invoke('p4:info'),
  getOpenedFiles: () => ipcRenderer.invoke('p4:opened'),
  getDiff: (filePath: string) => ipcRenderer.invoke('p4:diff', filePath),
  getChangelists: () => ipcRenderer.invoke('p4:changelists'),
  submit: (changelist: number, description: string) =>
    ipcRenderer.invoke('p4:submit', changelist, description),
  sync: (filePath?: string) => ipcRenderer.invoke('p4:sync', filePath),
  reconcileOfflineSmart: () => ipcRenderer.invoke('p4:reconcileOfflineSmart'),
  reconcileOfflineAll: () => ipcRenderer.invoke('p4:reconcileOfflineAll'),
  onReconcileProgress: (
    callback: (progress: { mode: 'smart' | 'full'; phase: 'scanning' | 'reconciling' | 'done'; completed: number; total: number; message?: string }) => void
  ) => {
    const listener = (_event: unknown, progress: { mode: 'smart' | 'full'; phase: 'scanning' | 'reconciling' | 'done'; completed: number; total: number; message?: string }) => {
      callback(progress)
    }
    ipcRenderer.on('p4:reconcileProgress', listener)
    return () => ipcRenderer.removeListener('p4:reconcileProgress', listener)
  },
  revert: (files: string[]) => ipcRenderer.invoke('p4:revert', files),
  revertUnchanged: () => ipcRenderer.invoke('p4:revertUnchanged'),
  shelve: (changelist: number) => ipcRenderer.invoke('p4:shelve', changelist),
  unshelve: (changelist: number, files?: string[]) => ipcRenderer.invoke('p4:unshelve', changelist, files),
  getSubmittedChanges: (depotPath: string, maxChanges?: number) =>
    ipcRenderer.invoke('p4:submittedChanges', depotPath, maxChanges),
  describeChangelist: (changelist: number, options?: { includeDiff?: boolean }) =>
    ipcRenderer.invoke('p4:describeChangelist', changelist, options),
  getClientStream: () => ipcRenderer.invoke('p4:getClientStream'),
  switchStream: (streamPath: string) => ipcRenderer.invoke('p4:switchStream', streamPath),
  getCurrentDepot: () => ipcRenderer.invoke('p4:getCurrentDepot'),
  getSwarmUrl: () => ipcRenderer.invoke('p4:getSwarmUrl'),
  createSwarmReview: (changelist: number, reviewers: string[], description?: string) =>
    ipcRenderer.invoke('p4:createSwarmReview', changelist, reviewers, description),
  getUsers: () => ipcRenderer.invoke('p4:users'),
  reopenFiles: (files: string[], changelist: number | 'default') =>
    ipcRenderer.invoke('p4:reopenFiles', files, changelist),
  createChangelist: (description: string) =>
    ipcRenderer.invoke('p4:createChangelist', description),
  editChangelist: (changelist: number, description: string) =>
    ipcRenderer.invoke('p4:editChangelist', changelist, description),
  deleteChangelist: (changelist: number) =>
    ipcRenderer.invoke('p4:deleteChangelist', changelist),
  revertAndDeleteChangelist: (changelist: number) =>
    ipcRenderer.invoke('p4:revertAndDeleteChangelist', changelist),
  getOrCreateJunkChangelist: () =>
    ipcRenderer.invoke('p4:getOrCreateJunkChangelist'),
  annotate: (filePath: string) =>
    ipcRenderer.invoke('p4:annotate', filePath),
  readFile: (filePath: string) => ipcRenderer.invoke('p4:readFile', filePath),
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('p4:saveFile', filePath, content),
  // Stream Graph APIs
  getDepots: () => ipcRenderer.invoke('p4:getDepots'),
  getStreams: (depot?: string) => ipcRenderer.invoke('p4:getStreams', depot),
  getStreamSpec: (streamPath: string) => ipcRenderer.invoke('p4:getStreamSpec', streamPath),
  getAllWorkspaces: () => ipcRenderer.invoke('p4:getAllWorkspaces'),
  getWorkspacesByStream: (streamPath: string) => ipcRenderer.invoke('p4:getWorkspacesByStream', streamPath),
  getWorkspaceDetails: (clientName: string) => ipcRenderer.invoke('p4:getWorkspaceDetails', clientName),
  getStreamGraphData: (depot: string) => ipcRenderer.invoke('p4:getStreamGraphData', depot),
  getInterchanges: (fromStream: string, toStream: string) => ipcRenderer.invoke('p4:getInterchanges', fromStream, toStream),
  openDiffWindow: (file: any, mode?: 'diff' | 'edit') => ipcRenderer.invoke('window:openDiffWindow', file, mode),
}

const settingsApi = {
  getAutoLaunch: () => ipcRenderer.invoke('settings:getAutoLaunch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('settings:setAutoLaunch', enabled),
  getDefaultReviewers: () => ipcRenderer.invoke('settings:getDefaultReviewers'),
  setDefaultReviewers: (reviewers: string[]) => ipcRenderer.invoke('settings:setDefaultReviewers', reviewers),
  getReviewLink: (changelist: number) => ipcRenderer.invoke('settings:getReviewLink', changelist),
  setReviewLink: (changelist: number, reviewUrl: string) => ipcRenderer.invoke('settings:setReviewLink', changelist, reviewUrl),
}

const dialogApi = {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
}

const jiraApi = {
  getPath: () => ipcRenderer.invoke('jira:getPath'),
  setPath: (targetPath: string) => ipcRenderer.invoke('jira:setPath', targetPath),
  getStatus: () => ipcRenderer.invoke('jira:getStatus'),
  recommend: (project: string, limit?: number) => ipcRenderer.invoke('jira:recommend', project, limit),
  track: (project: string, assignee: string, limit?: number) => ipcRenderer.invoke('jira:track', project, assignee, limit),
  similar: (ticketOrUrl: string, threshold?: number) => ipcRenderer.invoke('jira:similar', ticketOrUrl, threshold),
  openInChrome: (targetUrl: string) => ipcRenderer.invoke('jira:openInChrome', targetUrl),
}

contextBridge.exposeInMainWorld('p4', p4Api)
contextBridge.exposeInMainWorld('settings', settingsApi)
contextBridge.exposeInMainWorld('dialog', dialogApi)
contextBridge.exposeInMainWorld('jira', jiraApi)

// Type declaration for renderer
export type P4Api = typeof p4Api
export type SettingsApi = typeof settingsApi
export type DialogApi = typeof dialogApi
export type JiraApi = typeof jiraApi
