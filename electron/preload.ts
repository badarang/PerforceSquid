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
  revert: (files: string[]) => ipcRenderer.invoke('p4:revert', files),
  revertUnchanged: () => ipcRenderer.invoke('p4:revertUnchanged'),
  shelve: (changelist: number) => ipcRenderer.invoke('p4:shelve', changelist),
  unshelve: (changelist: number) => ipcRenderer.invoke('p4:unshelve', changelist),
  getSubmittedChanges: (depotPath: string, maxChanges?: number) =>
    ipcRenderer.invoke('p4:submittedChanges', depotPath, maxChanges),
  describeChangelist: (changelist: number) =>
    ipcRenderer.invoke('p4:describeChangelist', changelist),
  getClientStream: () => ipcRenderer.invoke('p4:getClientStream'),
  switchStream: (streamPath: string) => ipcRenderer.invoke('p4:switchStream', streamPath),
  getCurrentDepot: () => ipcRenderer.invoke('p4:getCurrentDepot'),
  getSwarmUrl: () => ipcRenderer.invoke('p4:getSwarmUrl'),
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
  // Stream Graph APIs
  getDepots: () => ipcRenderer.invoke('p4:getDepots'),
  getStreams: (depot?: string) => ipcRenderer.invoke('p4:getStreams', depot),
  getStreamSpec: (streamPath: string) => ipcRenderer.invoke('p4:getStreamSpec', streamPath),
  getAllWorkspaces: () => ipcRenderer.invoke('p4:getAllWorkspaces'),
  getWorkspacesByStream: (streamPath: string) => ipcRenderer.invoke('p4:getWorkspacesByStream', streamPath),
  getWorkspaceDetails: (clientName: string) => ipcRenderer.invoke('p4:getWorkspaceDetails', clientName),
  getStreamGraphData: (depot: string) => ipcRenderer.invoke('p4:getStreamGraphData', depot),
  getInterchanges: (fromStream: string, toStream: string) => ipcRenderer.invoke('p4:getInterchanges', fromStream, toStream),
}

const settingsApi = {
  getAutoLaunch: () => ipcRenderer.invoke('settings:getAutoLaunch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('settings:setAutoLaunch', enabled),
}

const dialogApi = {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
}

contextBridge.exposeInMainWorld('p4', p4Api)
contextBridge.exposeInMainWorld('settings', settingsApi)
contextBridge.exposeInMainWorld('dialog', dialogApi)

// Type declaration for renderer
export type P4Api = typeof p4Api
export type SettingsApi = typeof settingsApi
export type DialogApi = typeof dialogApi
