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
