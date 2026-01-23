export interface P4Info {
  userName: string
  clientName: string
  clientRoot: string
  serverAddress: string
  serverVersion: string
}

export interface P4File {
  depotFile: string
  clientFile: string
  action: 'add' | 'edit' | 'delete' | 'branch' | 'move/add' | 'move/delete' | 'integrate'
  changelist: number | 'default'
  type: string
}

export interface P4Changelist {
  number: number
  status: 'pending' | 'submitted'
  description: string
  user: string
  client: string
  date?: string
  files?: P4File[]
}

export interface P4DiffResult {
  filePath: string
  oldContent: string
  newContent: string
  hunks: string
}

// Stream Types
export type StreamType = 'mainline' | 'development' | 'release' | 'virtual' | 'task'

export interface P4Stream {
  stream: string           // //depot/main
  name: string             // main
  parent: string           // //depot/parent or 'none'
  type: StreamType
  owner: string
  description: string
  options: string
  baseParent?: string
  depotName?: string       // extracted depot name
}

export interface P4Workspace {
  client: string           // workspace name
  owner: string            // owner user
  stream: string           // connected stream path
  root: string             // client root path
  host: string             // hostname
  description: string
  access: string           // last access time
  update: string           // last update time
  options?: string
  submitOptions?: string
}

export interface P4Depot {
  depot: string
  type: string             // stream, local, remote, etc.
  map: string
  description: string
}

export interface StreamRelation {
  fromStream: string
  toStream: string
  direction: 'copy' | 'merge'
  pendingChanges: number
}

export interface StreamGraphData {
  streams: P4Stream[]
  workspaces: P4Workspace[]
  relations: StreamRelation[]
}
