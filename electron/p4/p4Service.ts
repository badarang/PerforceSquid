import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import type { P4Info, P4File, P4Changelist, P4DiffResult, P4Stream, P4Workspace, P4Depot, StreamRelation, StreamType } from './types'

const execAsync = promisify(exec)

// Helper: Limit concurrency for async operations to avoid spawning too many processes
async function pMap<T, R>(
  array: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results = new Array<R>(array.length)
  const iterator = array.entries()
  const workers = new Array(Math.min(array.length, concurrency)).fill(null).map(async () => {
    for (const [i, item] of iterator) {
      results[i] = await mapper(item, i)
    }
  })
  await Promise.all(workers)
  return results
}

export interface P4Client {
  name: string
  root: string
  description: string
}

interface ReconcileResult {
  success: boolean
  message: string
  mode: 'smart' | 'full'
  files: string[]
}

export class P4Service {
  private currentClient: string | null = null
  private cachedInfo: P4Info | null = null

  setClient(clientName: string) {
    if (this.currentClient !== clientName) {
      this.currentClient = clientName
      // Invalidate cache if client changes
      this.cachedInfo = null
    }
  }

  getClient(): string | null {
    return this.currentClient
  }

  private async runCommand(args: string[], stdinInput?: string): Promise<string> {
    try {
      const clientArgs = this.currentClient ? ['-c', this.currentClient] : []
      const allArgs = [...clientArgs, ...args]

      return new Promise((resolve, reject) => {
        // Use spawn for all commands to avoid maxBuffer limits
        const proc = spawn('p4', allArgs, { shell: true })
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => { stdout += data.toString() })
        proc.stderr.on('data', (data) => { stderr += data.toString() })

        proc.on('close', (code) => {
          if (code === 0 || stdout) {
            resolve(stdout)
          } else {
            reject(new Error(stderr || `Command failed with code ${code}`))
          }
        })

        if (stdinInput) {
          proc.stdin.write(stdinInput)
          proc.stdin.end()
        }
      })
    } catch (error: any) {
      if (error.stdout) {
        return error.stdout
      }
      throw error
    }
  }

  // Create a new client workspace
  async createClient(client: {
    name: string
    root: string
    options: string
    submitOptions: string
    stream?: string
    description?: string
    backup?: boolean 
  }): Promise<{ success: boolean; message: string }> {
    try {
      const defaultSpec = await this.runCommand(['client', '-o', client.name])
      const lines = defaultSpec.split('\n')
      const newLines: string[] = []
      let skipView = false

      for (const line of lines) {
        if (line.startsWith('Root:')) {
          newLines.push(`Root:\t${client.root}`)
        } else if (line.startsWith('Options:')) {
          newLines.push(`Options:\t${client.options}`)
        } else if (line.startsWith('SubmitOptions:')) {
          newLines.push(`SubmitOptions:\t${client.submitOptions}`)
        } else if (line.startsWith('Stream:')) {
           if (client.stream) {
             newLines.push(`Stream:\t${client.stream}`)
             skipView = true
           }
        } else if (line.startsWith('View:')) {
           if (skipView) {
             // Skip the View header
           } else {
             newLines.push(line)
           }
        } else if (line.startsWith('Description:')) {
            newLines.push('Description:')
            newLines.push(`\t${client.description || 'Created by PerforceSquid'}`)
        } else if (line.startsWith('\t') && newLines[newLines.length - 2]?.startsWith('Description:')) {
            // Skipping old description lines
        } else {
            if (skipView && line.startsWith('\t') && !line.trim().startsWith('Options:') && !line.trim().startsWith('Root:')) {
              continue
            }
            newLines.push(line)
        }
      }
      
      if (!newLines.some(l => l.startsWith('Root:'))) newLines.splice(newLines.findIndex(l => l.startsWith('View:')), 0, `Root:\t${client.root}`)
      if (!newLines.some(l => l.startsWith('Options:'))) newLines.splice(newLines.findIndex(l => l.startsWith('View:')), 0, `Options:\t${client.options}`)
      if (!newLines.some(l => l.startsWith('SubmitOptions:'))) newLines.splice(newLines.findIndex(l => l.startsWith('View:')), 0, `SubmitOptions:\t${client.submitOptions}`)
      if (client.stream && !newLines.some(l => l.startsWith('Stream:'))) newLines.splice(newLines.findIndex(l => l.startsWith('View:')), 0, `Stream:\t${client.stream}`)

      const spec = newLines.join('\n')
      const output = await this.runCommand(['client', '-i'], spec)
      
      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async getClients(): Promise<P4Client[]> {
    try {
      // Use cached info if available to get userName
      const info = await this.getInfo()
      const userName = info.userName

      if (!userName) {
        return []
      }

      const output = await execAsync(`p4 clients -u ${userName}`, {
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      })

      const clients: P4Client[] = []
      const lines = output.stdout.trim().split('\n')

      for (const line of lines) {
        const match = line.match(/^Client\s+(\S+)\s+\S+\s+root\s+(\S+)\s+'(.+)'/)
        if (match) {
          clients.push({
            name: match[1],
            root: match[2],
            description: match[3]
          })
        }
      }

      return clients
    } catch (error) {
      return []
    }
  }

  async getUsers(): Promise<string[]> {
    try {
      const users = await this.runCommandJson<any[]>(['users'])
      return users.map(u => u.User).filter(Boolean).sort()
    } catch (error) {
      console.error('getUsers failed:', error)
      return []
    }
  }

  private async runCommandJson<T>(args: string[]): Promise<T> {
    const output = await this.runCommand(['-ztag', '-Mj', ...args])
    const lines = output.trim().split('\n').filter(line => line.trim())
    return lines.map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean) as T
  }

  async getInfo(): Promise<P4Info> {
    if (this.cachedInfo) {
      return this.cachedInfo
    }

    const output = await this.runCommand(['info'])
    const lines = output.split('\n')
    const info: Partial<P4Info> = {}

    for (const line of lines) {
      if (line.startsWith('User name:')) {
        info.userName = line.replace('User name:', '').trim()
      } else if (line.startsWith('Client name:')) {
        info.clientName = line.replace('Client name:', '').trim()
      } else if (line.startsWith('Client root:')) {
        info.clientRoot = line.replace('Client root:', '').trim()
      } else if (line.startsWith('Server address:')) {
        info.serverAddress = line.replace('Server address:', '').trim()
      } else if (line.startsWith('Server version:')) {
        info.serverVersion = line.replace('Server version:', '').trim()
      }
    }

    this.cachedInfo = info as P4Info
    return this.cachedInfo
  }

  async getOpenedFiles(): Promise<P4File[]> {
    const fileMap = new Map<string, P4File>()

    const parseOutput = (output: string, status: 'open' | 'shelved') => {
      const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      let currentFile: any = {}

      const pushCurrentFile = () => {
        if (currentFile.depotFile) {
          const file = this.mapZtagToFile(currentFile)
          file.status = status
          if (!fileMap.has(file.depotFile)) {
            fileMap.set(file.depotFile, file)
          }
        }
        currentFile = {}
      }

      for (const line of lines) {
        const match = line.match(/^\.\.\.\s+(\w+)\s+(.*)$/)
        if (!match) {
          if (line.trim() === '') pushCurrentFile()
          continue
        }

        const [, key, value] = match
        const trimmedValue = value.trim()

        if (key === 'depotFile' && currentFile.depotFile) {
          pushCurrentFile()
        }

        currentFile[key] = trimmedValue
      }
      pushCurrentFile()
    }

    try {
      const openedTask = this.runCommand(['-ztag', 'fstat', '-Ro', '//...'])
        .catch(err => {
          if (err.message?.includes('not opened') || err.message?.includes('no such file')) return ''
          throw err
        })

      const [openedOutput, changelists] = await Promise.all([
        openedTask,
        this.getChangelists()
      ])

      if (openedOutput) {
        parseOutput(openedOutput, 'open')
      }

      const numberedChangelists = changelists.filter(c => c.number > 0)
      if (numberedChangelists.length > 0) {
        await pMap(numberedChangelists, async (cl) => {
          try {
            const shelfOutput = await this.runCommand(['-ztag', 'fstat', '-Rs', '-e', String(cl.number), '//...'])
            if (shelfOutput) {
              parseOutput(shelfOutput, 'shelved')
            }
          } catch (e) {
            // Ignore errors
          }
        }, 5)
      }

      return Array.from(fileMap.values())
    } catch (error: any) {
      if (error.message?.includes('not opened') || error.message?.includes('no such file')) return []
      throw error
    }
  }

  private mapZtagToFile(data: any): P4File {
    const changelist = data.change === 'default' ? 'default' : parseInt(data.change, 10)
    return {
      depotFile: data.depotFile,
      clientFile: data.clientFile || '',
      action: (data.action || 'edit') as P4File['action'],
      changelist: isNaN(changelist as number) && changelist !== 'default' ? 'default' : changelist,
      type: data.type || data.headType || 'text'
    }
  }

  async getDiff(file: P4File | string): Promise<P4DiffResult> {
    const depotPath = typeof file === 'string' ? file : file.depotFile
    const clientPath = typeof file === 'string' ? null : file.clientFile

    try {
      const [diffOutput, oldContent, newContent] = await Promise.all([
        this.runCommand(['diff', '-du', `"${depotPath}"`]),
        this.runCommand(['print', '-q', `"${depotPath}#have"`]).catch(() => ''),
        (async () => {
          try {
            if (clientPath && clientPath.trim() !== '') {
              const fs = await import('fs/promises')
              const normalizedPath = clientPath.replace(/\//g, '\\')
              return await fs.readFile(normalizedPath, 'utf8')
            }
          } catch (err) {
            console.error('Local file read failed, falling back to P4 print:', err)
          }
          return await this.runCommand(['print', '-q', `"${depotPath}"`])
        })()
      ])

      return {
        filePath: depotPath,
        oldContent,
        newContent,
        hunks: this.normalizeDiffOutput(diffOutput)
      }
    } catch (error: any) {
      if (error.message?.includes('not opened') || error.message?.includes('no differing files')) {
        return {
          filePath: depotPath,
          oldContent: '',
          newContent: '',
          hunks: ''
        }
      }
      throw error
    }
  }

  private normalizeDiffOutput(raw: string): string {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const withoutPreamble = normalized
      .split('\n')
      .filter((line) => line.trim() !== 'Differences ...')
      .join('\n')
    const trimmed = withoutPreamble.trim()
    if (!trimmed) return ''

    // Guard against accidental full duplication: [A][A]
    if (trimmed.length % 2 === 0) {
      const half = trimmed.length / 2
      const first = trimmed.slice(0, half).trim()
      const second = trimmed.slice(half).trim()
      if (first && first === second) {
        return first
      }
    }

    // Guard against duplicated repeated block sequences (e.g. A,B,A,B)
    const blocks = this.splitDiffBlocks(trimmed)
    if (blocks.length > 1) {
      // 1) Remove adjacent duplicates first
      const dedupedAdjacent: string[] = []
      for (const block of blocks) {
        const prev = dedupedAdjacent[dedupedAdjacent.length - 1]
        if (prev !== block) {
          dedupedAdjacent.push(block)
        }
      }
      if (dedupedAdjacent.length < blocks.length) {
        return dedupedAdjacent.join('\n\n')
      }

      // 2) Collapse repeated sequence patterns (A,B,A,B) -> (A,B)
      const n = blocks.length
      for (let period = 1; period <= Math.floor(n / 2); period++) {
        if (n % period !== 0) continue
        let repeated = true
        for (let i = period; i < n; i++) {
          if (blocks[i] !== blocks[i % period]) {
            repeated = false
            break
          }
        }
        if (repeated) {
          const reduced = blocks.slice(0, period)
          if (reduced.length < blocks.length) {
            return reduced.join('\n\n')
          }
        }
      }
    }

    return trimmed
  }

  private splitDiffBlocks(diffText: string): string[] {
    const lines = diffText.split('\n')
    const blocks: string[] = []
    let current: string[] = []

    const flush = () => {
      const block = current.join('\n').trim()
      if (block) blocks.push(block)
      current = []
    }

    for (const line of lines) {
      if (line.startsWith('==== ') && current.length > 0) {
        flush()
      }
      current.push(line)
    }
    flush()

    return blocks
  }

  private async enrichWithSwarmReviews(changelists: P4Changelist[]): Promise<P4Changelist[]> {
    try {
      const pendingIds = changelists
        .filter(c => c.status === 'pending' && c.number > 0)
        .map(c => c.number)
      
      if (pendingIds.length === 0) return changelists

      const swarmUrl = await this.getSwarmUrl()
      if (!swarmUrl) return changelists

      const info = await this.getInfo()
      const user = info.userName
      const ticket = await this.getTicket()

      if (!user || !ticket) return changelists

      // Fetch reviews for these changes
      const query = new URLSearchParams()
      query.append('max', String(pendingIds.length * 2)) // Fetch enough
      pendingIds.forEach(id => query.append('change[]', String(id)))
      
      const cleanUrl = swarmUrl.replace(/\/$/, '')
      const apiUrl = `${cleanUrl}/api/v9/reviews?${query.toString()}`

      const auth = Buffer.from(`${user}:${ticket}`).toString('base64')
      
      // 2 second timeout to keep UI snappy
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)

      const response = await fetch(apiUrl, {
        headers: { 'Authorization': `Basic ${auth}` },
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!response.ok) return changelists

      const data = await response.json()
      const reviews = data.reviews || []
      
      // Map change ID to review
      const changeReviewMap = new Map<number, { id: number, state: string }>()
      
      for (const review of reviews) {
        if (review.changes) {
          for (const changeId of review.changes) {
            // We want the review where this change is the active one or part of it
            changeReviewMap.set(Number(changeId), { id: review.id, state: review.state })
          }
        }
      }

      return changelists.map(cl => {
        const review = changeReviewMap.get(cl.number)
        if (review) {
          return { ...cl, reviewId: review.id, reviewStatus: review.state }
        }
        return cl
      })
    } catch (error) {
      // Swarm enrichment is optional, don't fail operation
      return changelists
    }
  }

  async getChangelists(): Promise<P4Changelist[]> {
    try {
      const info = await this.getInfo()
      // Use -l for long output to get full descriptions
      const output = await this.runCommand(['changes', '-l', '-s', 'pending', '-c', info.clientName])

      let changelists: P4Changelist[] = []

      if (!output.trim()) {
        changelists = [{
          number: 0,
          status: 'pending',
          description: 'Default changelist',
          user: info.userName,
          client: info.clientName
        }]
      } else {
        changelists = [{
          number: 0,
          status: 'pending',
          description: 'Default changelist',
          user: info.userName,
          client: info.clientName
        }]

        const changeHeaderRegex = /^Change (\d+) on (\S+) by (\S+)@(\S+) \*pending\*/
        
        const entries = output.split(/(?=^Change \d+ on)/m).filter(e => e.trim())

        for (const entry of entries) {
          const lines = entry.trim().split('\n')
          const header = lines[0]
          const match = header.match(changeHeaderRegex)
          
          if (match) {
            const [, number, date, user, client] = match
            // Description is everything after the first line
            const description = lines.slice(1).join('\n').trim()
            
            changelists.push({
              number: parseInt(number, 10),
              status: 'pending',
              description: description,
              user,
              client,
              date
            })
          }
        }
      }
      
      // Enrich with Swarm Data
      return await this.enrichWithSwarmReviews(changelists)

    } catch (error) {
      return [{
        number: 0,
        status: 'pending',
        description: 'Default changelist',
        user: 'unknown',
        client: 'unknown'
      }]
    }
  }

  async submit(changelist: number, description: string): Promise<{ success: boolean; message: string }> {
    try {
      let output: string
      if (changelist === 0) {
        output = await this.runCommand(['submit', '-d', `"${description}"`])
      } else {
        output = await this.runCommand(['submit', '-c', String(changelist)])
      }
      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async createChangelist(description: string): Promise<{ success: boolean; changelistNumber: number; message: string }> {
    try {
      const spec = `Change: new\nDescription: ${description}\n`
      const output = await this.runCommand(['change', '-i'], spec)

      const match = output.match(/Change (\d+) created/)
      if (match) {
        return {
          success: true,
          changelistNumber: parseInt(match[1], 10),
          message: output
        }
      }
      return { success: false, changelistNumber: 0, message: 'Failed to parse changelist number' }
    } catch (error: any) {
      return { success: false, changelistNumber: 0, message: error.message }
    }
  }

  async editChangelist(changelist: number, description: string): Promise<{ success: boolean; message: string }> {
    try {
      const spec = await this.runCommand(['change', '-o', String(changelist)])
      
      const lines = spec.split('\n')
      const newLines: string[] = []
      let skip = false
      
      for (const line of lines) {
        if (line.startsWith('Description:')) {
          newLines.push('Description:')
          const descLines = description.replace(/\r\n/g, '\n').trim().split('\n')
          for (const d of descLines) {
            newLines.push(`\t${d}`)
          }
          skip = true
        } else if (line.startsWith('Files:') || line.startsWith('Jobs:') || (skip && /^[^\t]/.test(line) && line.trim() !== '')) {
          skip = false
          newLines.push(line)
        } else if (!skip) {
          newLines.push(line)
        }
      }
      
      const newSpec = newLines.join('\n')
      const output = await this.runCommand(['change', '-i'], newSpec)
      
      if (output.includes('updated')) {
        return { success: true, message: output }
      }
      return { success: false, message: `Failed to update changelist: ${output}` }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async getOrCreateJunkChangelist(): Promise<{ success: boolean; changelistNumber: number; message: string }> {
    try {
      const changelists = await this.getChangelists()

      const junkCL = changelists.find(cl =>
        cl.description.toLowerCase().includes('junk') ||
        cl.description.toLowerCase().includes('do not submit') ||
        cl.description.toLowerCase().includes('temp')
      )

      if (junkCL && junkCL.number !== 0) {
        return {
          success: true,
          changelistNumber: junkCL.number,
          message: 'Found existing junk changelist'
        }
      }
      return await this.createChangelist('[JUNK - Do Not Submit]')
    } catch (error: any) {
      return { success: false, changelistNumber: 0, message: error.message }
    }
  }

  async sync(filePath?: string): Promise<{ success: boolean; message: string }> {
    try {
      const args = ['sync']
      if (filePath) {
        args.push(`"${filePath}"`)
      }
      const output = await this.runCommand(args)
      return { success: true, message: output || 'Already up to date' }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  private quotePath(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`
  }

  async reconcileOfflineSmart(): Promise<ReconcileResult> {
    try {
      const info = await this.getInfo()
      const clientRoot = info.clientRoot
      if (!clientRoot) {
        return {
          success: false,
          message: 'Client root not found.',
          mode: 'smart',
          files: []
        }
      }

      const scriptsRoot = `${clientRoot}\\Assets\\Scripts`
      const scriptsPattern = `${scriptsRoot}\\...`
      const args = ['reconcile', '-e', '-a', '-d', this.quotePath(scriptsPattern)]
      const output = await this.runCommand(args)
      return {
        success: true,
        message: output || 'Reconciled Assets/Scripts.',
        mode: 'smart',
        files: [scriptsPattern]
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Smart reconcile failed.',
        mode: 'smart',
        files: []
      }
    }
  }

  async reconcileOfflineAll(): Promise<ReconcileResult> {
    try {
      const output = await this.runCommand(['reconcile', '-e', '-a', '-d', '//...'])
      return {
        success: true,
        message: output || 'Reconcile completed for entire workspace.',
        mode: 'full',
        files: ['//...']
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Full reconcile failed.',
        mode: 'full',
        files: ['//...']
      }
    }
  }

  async revert(files: string[]): Promise<{ success: boolean; message: string }> {
    try {
      const quotedFiles = files.map(f => `"${f}"`)
      const filesToDelete: string[] = []
      
      try {
        const fstatOutput = await this.runCommand(['fstat', '-T', 'clientFile,action', ...quotedFiles])
        const lines = fstatOutput.replace(/\r/g, '').split('\n')
        let currentBlock: { clientFile?: string, action?: string } = {}
        
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) {
            if (currentBlock.clientFile && currentBlock.action === 'add') {
              filesToDelete.push(currentBlock.clientFile)
            }
            currentBlock = {}
            continue
          }
          if (trimmed.startsWith('... clientFile ')) {
            currentBlock.clientFile = trimmed.substring(15).trim()
          } else if (trimmed.startsWith('... action ')) {
            currentBlock.action = trimmed.substring(11).trim()
          }
        }
        if (currentBlock.clientFile && currentBlock.action === 'add') {
          filesToDelete.push(currentBlock.clientFile)
        }
      } catch (err) {
        console.warn('fstat failed during revert check:', err)
      }

      const output = await this.runCommand(['revert', ...quotedFiles])

      if (filesToDelete.length > 0) {
        // Parallel deletion attempt
        await Promise.all(filesToDelete.map(async (file) => {
          const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
          for (let i = 0; i < 5; i++) {
            try {
              await fs.unlink(file)
              break
            } catch (e: any) {
              if (e.code === 'ENOENT') break
              await sleep(100 * (i + 1))
            }
          }
          if (!file.endsWith('.meta')) {
            try { await fs.unlink(file + '.meta') } catch {}
          }
        }))
      }

      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async revertUnchanged(): Promise<{ success: boolean; message: string; revertedCount: number }> {
    try {
      let totalReverted = 0
      const messages: string[] = []

      // 1. Revert unchanged edit files (p4 revert -a)
      try {
        const editOutput = await this.runCommand(['revert', '-a', '//...'])
        const editLines = editOutput.trim().split('\n').filter(l => l.trim() && l.includes('#'))
        totalReverted += editLines.length
        if (editLines.length > 0) messages.push(`Reverted ${editLines.length} unchanged edit file(s)`)
      } catch (err: any) {
        if (!err.message?.includes('not opened')) {
          console.error('Error reverting unchanged edits:', err.message)
        }
      }

      // 2. Find files that can be reverted (delete, move/delete, integrate, branch, etc.)
      try {
        const openedOutput = await this.runCommand(['opened', '//...'])
        const filesToRevert: string[] = []
        const addFiles: string[] = []

        const autoRevertActions = ['delete', 'move/delete', 'branch', 'integrate']

        for (const line of openedOutput.split('\n')) {
          if (!line.trim()) continue
          const match = line.match(/^(.+?)#\d+/)
          if (!match) continue
          const depotFile = match[1]

          let matched = false
          for (const action of autoRevertActions) {
            if (line.includes(` - ${action} `)) {
              filesToRevert.push(depotFile)
              matched = true
              break
            }
          }
          if (!matched && (line.includes(' - add ') || line.includes(' - move/add '))) {
            addFiles.push(depotFile)
          }
        }

        // Check addFiles in parallel
        if (addFiles.length > 0) {
            const results = await pMap(addFiles, async (file) => {
                try {
                    await this.runCommand(['files', file])
                    return file // Exists, so revert
                } catch {
                    return null // Doesn't exist, keep
                }
            }, 10)
            filesToRevert.push(...results.filter((f): f is string => f !== null))
        }

        if (filesToRevert.length > 0) {
          let revertedInBatch = 0
          const batchSize = 50
          for (let i = 0; i < filesToRevert.length; i += batchSize) {
            const batch = filesToRevert.slice(i, i + batchSize)
            try {
              await this.runCommand(['revert', ...batch])
              revertedInBatch += batch.length
            } catch (err: any) {
              // Try one by one if batch fails
              for (const file of batch) {
                try {
                  await this.runCommand(['revert', file])
                  revertedInBatch++
                } catch {}
              }
            }
          }
          totalReverted += revertedInBatch
          if (revertedInBatch > 0) messages.push(`Reverted ${revertedInBatch} other file(s)`)
        }
      } catch (err: any) {
        console.error('Error finding files to revert:', err.message)
      }

      return {
        success: true,
        message: messages.join('\n') || 'No unchanged files to revert',
        revertedCount: totalReverted
      }
    } catch (error: any) {
      if (error.message?.includes('not opened')) {
        return { success: true, message: 'No unchanged files to revert', revertedCount: 0 }
      }
      return { success: false, message: error.message, revertedCount: 0 }
    }
  }

  async shelve(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['shelve', '-c', String(changelist)])
      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async unshelve(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['unshelve', '-s', String(changelist)])
      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async deleteChangelist(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['change', '-d', String(changelist)])
      return { success: true, message: output || `Changelist ${changelist} deleted` }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async revertAndDeleteChangelist(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      try {
        await this.runCommand(['revert', '-c', String(changelist), '//...'])
      } catch (err: any) {
        if (!err.message?.includes('not opened')) throw err
      }
      const output = await this.runCommand(['change', '-d', String(changelist)])
      return { success: true, message: output || `Changelist ${changelist} deleted` }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async reopenFiles(files: string[], changelist: number | 'default'): Promise<{ success: boolean; message: string }> {
    try {
      const clArg = changelist === 'default' || changelist === 0 ? 'default' : String(changelist)
      const quotedFiles = files.map(f => `"${f}"`)
      const output = await this.runCommand(['reopen', '-c', clArg, ...quotedFiles])
      return { success: true, message: output }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async getSubmittedChanges(depotPath: string, maxChanges: number = 50): Promise<P4Changelist[]> {
    try {
      const output = await this.runCommand([
        'changes', '-s', 'submitted', '-m', String(maxChanges), '-l', '-t', depotPath
      ])

      if (!output.trim()) return []

      const changelists: P4Changelist[] = []
      const blocks = output.split(/\n(?=Change \d+)/)

      for (const block of blocks) {
        if (!block.trim()) continue
        const headerMatch = block.match(/^Change (\d+) on (\S+)(?: (\S+))? by (\S+)@(\S+)/)
        if (headerMatch) {
          const [, number, date, time, user, client] = headerMatch
          const fullDate = time ? `${date} ${time}` : date
          const descStart = block.indexOf('\n')
          const description = descStart > -1
            ? block.slice(descStart + 1).trim().split('\n')[0]
            : ''

          changelists.push({
            number: parseInt(number, 10),
            status: 'submitted',
            description: description,
            user,
            client,
            date: fullDate
          })
        }
      }
      return changelists
    } catch (error) {
      return []
    }
  }

  async describeChangelist(changelist: number): Promise<{
    info: P4Changelist | null
    files: Array<{ depotFile: string; action: string; revision: number }>
    diff: string
  }> {
    const parseDescribeOutput = (output: string) => {
      if (!output.trim()) return { info: null, files: [], diff: '' }

      const normalizedOutput = output.replace(/\r\n/g, '\n')
      const headerMatch = normalizedOutput.match(/^Change (\d+) by (\S+)@(\S+) on (\S+)(?: (\S+))?/)
      let info: P4Changelist | null = null

      if (headerMatch) {
        const [, number, user, client, date, time] = headerMatch
        const fullDate = time ? `${date} ${time}` : date
        
        let description = ''
        const affectedIndex = normalizedOutput.indexOf('Affected files')
        const shelvedIndex = normalizedOutput.indexOf('Shelved files')
        
        let sectionStart = -1
        if (affectedIndex > -1 && shelvedIndex > -1) sectionStart = Math.min(affectedIndex, shelvedIndex)
        else if (affectedIndex > -1) sectionStart = affectedIndex
        else if (shelvedIndex > -1) sectionStart = shelvedIndex
        
        if (sectionStart > -1) {
          const headerEnd = normalizedOutput.indexOf('\n')
          const descSection = normalizedOutput.slice(headerEnd, sectionStart)
          description = descSection.split('\n')
            .map(line => line.replace(/^\t+/, '').trim())
            .filter(line => line.length > 0)
            .join(' ')
        } else {
             const headerEnd = normalizedOutput.indexOf('\n')
             if (headerEnd > -1) {
                 description = normalizedOutput.slice(headerEnd).trim()
             }
        }

        info = {
          number: parseInt(number, 10),
          status: 'submitted',
          description,
          user,
          client,
          date: fullDate
        }
      }

      const files: Array<{ depotFile: string; action: string; revision: number }> = []
      
      const extractFiles = (regex: RegExp) => {
          const match = normalizedOutput.match(regex)
          if (match) {
            const fileLines = match[1].trim().split('\n')
            for (const line of fileLines) {
              const fileMatch = line.match(/^\.\.\. (.+)#(\d+) (\w+)/)
              if (fileMatch) {
                files.push({
                  depotFile: fileMatch[1],
                  action: fileMatch[3],
                  revision: parseInt(fileMatch[2], 10)
                })
              }
            }
          }
      }

      extractFiles(/Affected files \.\.\.\n\n([\s\S]*?)(?=\nDifferences|$|Shelved files)/)
      extractFiles(/Shelved files \.\.\.\n\n([\s\S]*?)(?=\nDifferences|$|Affected files)/)

      const diffStart = normalizedOutput.indexOf('Differences ...')
      let diff = diffStart > -1 ? normalizedOutput.slice(diffStart) : ''

      return { info, files, diff }
    }

    try {
      const [stdOutput, shelvedOutput] = await Promise.all([
        this.runCommand(['describe', '-du', String(changelist)]).catch(() => ''),
        this.runCommand(['describe', '-S', '-du', String(changelist)]).catch(() => '')
      ])

      const stdResult = parseDescribeOutput(stdOutput)
      const shelvedResult = parseDescribeOutput(shelvedOutput)

      const info = stdResult.info || shelvedResult.info
      
      const fileMap = new Map<string, { depotFile: string; action: string; revision: number }>()
      stdResult.files.forEach(f => fileMap.set(f.depotFile, f))
      shelvedResult.files.forEach(f => fileMap.set(f.depotFile, f))
      const files = Array.from(fileMap.values())

      let diff = stdResult.diff
      if (shelvedResult.diff) {
        if (diff) {
             const shelvedDiffContent = shelvedResult.diff.replace('Differences ...\n', '')
             diff += '\n' + shelvedDiffContent
        } else {
            diff = shelvedResult.diff
        }
      }

      const filesWithDiff = new Set<string>()
      const diffFileRegex = /==== (.+?)#\d+/g
      let match
      while ((match = diffFileRegex.exec(diff)) !== null) {
        filesWithDiff.add(match[1])
      }

      const missingDiffFiles = files.filter(f =>
        !filesWithDiff.has(f.depotFile) &&
        f.action !== 'delete' &&
        f.action !== 'branch' &&
        f.action !== 'integrate' &&
        f.action !== 'move/delete'
      )

      if (missingDiffFiles.length > 0) {
        const additionalDiffs = await pMap(missingDiffFiles, async (file) => {
          try {
            if (file.action === 'add') {
              const content = await this.runCommand(['print', '-q', `${file.depotFile}#${file.revision}`])
              if (content.trim()) {
                const lines = content.replace(/\r\n/g, '\n').split('\n')
                const diffContent = lines.map(line => `+${line}`).join('\n')
                return `\n==== ${file.depotFile}#${file.revision} (${file.action}) ====\n@@ -0,0 +1,${lines.length} @@\n${diffContent}`
              }
            } else if (file.revision > 1) {
              const diff2Output = await this.runCommand([
                'diff2', '-du',
                `${file.depotFile}#${file.revision - 1}`,
                `${file.depotFile}#${file.revision}`
              ])
              if (diff2Output.trim()) {
                return `\n==== ${file.depotFile}#${file.revision} (${file.action}) ====\n${diff2Output.replace(/\r\n/g, '\n')}`
              }
            }
          } catch (err) {
            return null
          }
          return null
        }, 5)

        const validDiffs = additionalDiffs.filter((d): d is string => d !== null)
        if (validDiffs.length > 0) {
          if (!diff) diff = 'Differences ...\n'
          diff += validDiffs.join('\n')
        }
      }

      const normalizedDiff = this.normalizeDiffOutput(diff)
      return { info, files, diff: normalizedDiff }
    } catch (error) {
      return { info: null, files: [], diff: '' }
    }
  }

  async getClientStream(): Promise<string | null> {
    try {
      if (!this.currentClient) return null
      const output = await this.runCommand(['client', '-o', this.currentClient])
      const streamMatch = output.match(/^Stream:\s*(\S+)/m)
      if (streamMatch) return streamMatch[1] + '/...'
      const viewMatch = output.match(/^View:\s*\n\s*(\S+)/m)
      if (viewMatch) return viewMatch[1]
      return null
    } catch (error) {
      return null
    }
  }

  async switchStream(streamPath: string): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.currentClient) return { success: false, message: 'No workspace selected' }
      const output = await this.runCommand(['client', '-f', '-s', '-S', streamPath, this.currentClient])
      await this.sync()
      return { success: true, message: output || `Switched to ${streamPath}` }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to switch stream' }
    }
  }

  async getCurrentDepot(): Promise<string | null> {
    try {
      const stream = await this.getClientStream()
      if (stream) {
        const match = stream.match(/^\/\/([^/]+)/)
        return match ? match[1] : null
      }
      return null
    } catch {
      return null
    }
  }

  async getSwarmUrl(): Promise<string | null> {
    try {
      const output = await this.runCommand(['property', '-l', '-n', 'P4.Swarm.URL'])
      const match = output.match(/P4\.Swarm\.URL\s*=\s*(\S+)/)
      if (match) return match[1]
      return null
    } catch (error) {
      return null
    }
  }

  async getTicket(): Promise<string | null> {
    try {
      // Read ticket from 'p4 tickets' - this just reads the ticket file without auth attempts
      const output = await this.runCommand(['tickets'])
      if (!output.trim()) return null

      // Parse ticket output format: "serverAddress (user) = ticketValue"
      // Example: "ssl:perforce.example.com:1666 (hoh) = 5A4B3C2D1E0F..."
      const lines = output.trim().split('\n')
      for (const line of lines) {
        const match = line.match(/=\s*([A-F0-9]+)\s*$/i)
        if (match) {
          return match[1]
        }
      }
      return null
    } catch (error) {
      return null
    }
  }

  async createSwarmReview(changelist: number, reviewers: string[] = []): Promise<{ success: boolean; review?: any; message?: string }> {
    try {
      const swarmUrl = await this.getSwarmUrl()
      if (!swarmUrl) {
        return { success: false, message: 'Swarm URL not configured (P4.Swarm.URL)' }
      }

      const info = await this.getInfo()
      const user = info.userName
      const ticket = await this.getTicket()

      if (!user || !ticket) {
        return { success: false, message: 'Authentication failed: User or ticket not found' }
      }

      // Format reviewers: Swarm API expects array of strings, or object with 'users' and 'groups'
      // But typically just a list of IDs for the 'reviewers' field works for users.
      // If we have groups, we might need to handle them.
      // The user provided list might contain groups with @@ prefix if they followed the UI hint,
      // but usually the API expects separate fields or simple strings.
      // Let's assume passed reviewers are user IDs for now or handle basic formatting.
      
      const formData = new URLSearchParams()
      formData.append('change', String(changelist))
      formData.append('description', 'Review from PerforceSquid') // Optional, Swarm uses CL desc if omitted
      
      reviewers.forEach(r => formData.append('reviewers[]', r))

      // Clean URL
      const cleanUrl = swarmUrl.replace(/\/$/, '')
      const apiUrl = `${cleanUrl}/api/v9/reviews`
      
      const auth = Buffer.from(`${user}:${ticket}`).toString('base64')

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      })

      if (!response.ok) {
        const text = await response.text()
        return { success: false, message: `Swarm API Error: ${response.status} ${text}` }
      }

      const data = await response.json()
      // Swarm v9 returns { review: { id: 123, ... } }
      
      return { success: true, review: data.review }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  async annotate(filePath: string): Promise<{
    success: boolean
    lines: Array<{
      lineNumber: number
      changelist: number
      user: string
      date: string
      content: string
    }>
    message?: string
  }> {
    try {
      const output = await this.runCommand(['annotate', '-c', '-u', `"${filePath}"`])

      if (!output.trim()) {
        return { success: true, lines: [] }
      }

      const lines: Array<{
        lineNumber: number
        changelist: number
        user: string
        date: string
        content: string
      }> = []

      const outputLines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      let lineNumber = 1
      let lastMatch: { changelist: number; user: string; date: string } | null = null

      for (const rawLine of outputLines) {
        const line = rawLine.replace(/\s+$/, '')
        if (line.startsWith('//')) continue
        if (!line && !lastMatch) continue

        const match = line.match(/^(\d+):\s+(\S+)\s+(\d{4}\/\d{2}\/\d{2})(?:\s(.*))?$/)

        if (match) {
          const [, changelist, user, date, content = ''] = match
          lastMatch = {
            changelist: parseInt(changelist, 10),
            user,
            date
          }
          lines.push({
            lineNumber,
            changelist: lastMatch.changelist,
            user: lastMatch.user,
            date: lastMatch.date,
            content
          })
          lineNumber++
        }
      }
      return { success: true, lines }
    } catch (error: any) {
      return { success: false, lines: [], message: error.message }
    }
  }

  // ============================================
  // Stream Graph Related Methods
  // ============================================

  async getDepots(): Promise<P4Depot[]> {
    try {
      const depotsData = await this.runCommandJson<any[]>(['depots'])
      return depotsData.map(d => ({
        depot: d.Depot || d.name,
        type: d.Type || d.type,
        map: d.Map || d.map,
        description: d.Desc || d.desc || ''
      }))
    } catch (error) {
      return []
    }
  }

  async getStreams(depot?: string): Promise<P4Stream[]> {
    try {
      if (!depot) return []
      const depots = await this.getDepots()
      const currentDepotInfo = depots.find(d => d.depot === depot)
      const isStreamDepot = currentDepotInfo?.type?.toLowerCase() === 'stream'

      if (isStreamDepot) {
        const depotPattern = `//${depot}/...`
        const streamsData = await this.runCommandJson<any[]>(['streams', depotPattern])
        return streamsData.map(s => {
          const streamPath = s.Stream || s.stream
          const streamName = s.Name || (streamPath ? streamPath.split('/').pop() : '') || streamPath
          return {
            stream: streamPath,
            name: streamName,
            parent: (s.Parent || s.parent) === 'none' ? 'none' : (s.Parent || s.parent),
            type: (s.Type || s.type) as StreamType,
            owner: s.Owner || s.owner || '',
            description: s.Desc || s.desc || '',
            options: s.Options || s.options || '',
            depotName: depot
          }
        })
      } else {
        const depotPattern = `//${depot}/*`
        const output = await this.runCommand(['dirs', depotPattern])
        if (!output.trim()) return []
        const streams: P4Stream[] = []
        const lines = output.trim().split('\n')
        for (const line of lines) {
          const streamPath = line.trim()
          if (streamPath && streamPath.startsWith('//')) {
            const streamName = streamPath.split('/').pop() || streamPath
            streams.push({
              stream: streamPath,
              name: streamName,
              parent: 'none',
              type: 'development',
              owner: '',
              description: 'Classic depot virtual stream',
              options: '',
              depotName: depot
            })
          }
        }
        return streams
      }
    } catch (error) {
      console.error('getStreams error:', error)
      return []
    }
  }

  async getStreamSpec(streamPath: string): Promise<P4Stream | null> {
    try {
      const output = await this.runCommand(['stream', '-o', streamPath])
      const stream: Partial<P4Stream> = {
        stream: streamPath,
        name: streamPath.split('/').pop() || streamPath,
        depotName: streamPath.split('/')[2] || ''
      }
      const lines = output.split('\n')
      for (const line of lines) {
        if (line.startsWith('Parent:')) {
          stream.parent = line.replace('Parent:', '').trim() || 'none'
        } else if (line.startsWith('Type:')) {
          stream.type = line.replace('Type:', '').trim() as StreamType
        } else if (line.startsWith('Owner:')) {
          stream.owner = line.replace('Owner:', '').trim()
        } else if (line.startsWith('Description:')) {
          stream.description = line.replace('Description:', '').trim()
        } else if (line.startsWith('Options:')) {
          stream.options = line.replace('Options:', '').trim()
        }
      }
      return stream as P4Stream
    } catch (error) {
      return null
    }
  }

  async getAllWorkspaces(): Promise<P4Workspace[]> {
    try {
      const output = await this.runCommand(['clients'])
      return this.parseWorkspacesOutput(output)
    } catch (error) {
      return []
    }
  }

  async getWorkspacesByStream(streamPath: string): Promise<P4Workspace[]> {
    try {
      const output = await this.runCommand(['clients', '-S', streamPath])
      return this.parseWorkspacesOutput(output)
    } catch (error) {
      return []
    }
  }

  private parseWorkspacesOutput(output: string): P4Workspace[] {
    const workspaces: P4Workspace[] = []
    const lines = output.trim().split('\n')
    for (const line of lines) {
      const match = line.match(/^Client\s+(\S+)\s+(\S+)\s+root\s+(\S+)\s+'(.*)'/)
      if (match) {
        const [, client, update, root, description] = match
        workspaces.push({
          client,
          owner: '',
          stream: '',
          root,
          host: '',
          description,
          access: '',
          update
        })
      }
    }
    return workspaces
  }

  async getWorkspaceDetails(clientName: string): Promise<P4Workspace | null> {
    try {
      const output = await this.runCommand(['client', '-o', clientName])
      const workspace: Partial<P4Workspace> = { client: clientName }
      const lines = output.split('\n')
      for (const line of lines) {
        if (line.startsWith('Owner:')) {
          workspace.owner = line.replace('Owner:', '').trim()
        } else if (line.startsWith('Root:')) {
          workspace.root = line.replace('Root:', '').trim()
        } else if (line.startsWith('Host:')) {
          workspace.host = line.replace('Host:', '').trim()
        } else if (line.startsWith('Stream:')) {
          workspace.stream = line.replace('Stream:', '').trim()
        } else if (line.startsWith('Description:')) {
          workspace.description = line.replace('Description:', '').trim()
        } else if (line.startsWith('Access:')) {
          workspace.access = line.replace('Access:', '').trim()
        } else if (line.startsWith('Update:')) {
          workspace.update = line.replace('Update:', '').trim()
        } else if (line.startsWith('Options:')) {
          workspace.options = line.replace('Options:', '').trim()
        } else if (line.startsWith('SubmitOptions:')) {
          workspace.submitOptions = line.replace('SubmitOptions:', '').trim()
        }
      }
      return workspace as P4Workspace
    } catch (error) {
      return null
    }
  }

  async getInterchanges(fromStream: string, toStream: string): Promise<StreamRelation> {
    try {
      const output = await this.runCommand(['interchanges', '-S', fromStream, toStream])
      const lines = output.trim().split('\n').filter(l => l.trim() && l.startsWith('Change'))
      return {
        fromStream,
        toStream,
        direction: 'merge',
        pendingChanges: lines.length
      }
    } catch (error: any) {
      return {
        fromStream,
        toStream,
        direction: 'merge',
        pendingChanges: 0
      }
    }
  }

  async getCopyChanges(fromStream: string, toStream: string): Promise<StreamRelation> {
    try {
      const output = await this.runCommand(['interchanges', '-S', '-r', fromStream, toStream])
      const lines = output.trim().split('\n').filter(l => l.trim() && l.startsWith('Change'))
      return {
        fromStream,
        toStream,
        direction: 'copy',
        pendingChanges: lines.length
      }
    } catch (error: any) {
      return {
        fromStream,
        toStream,
        direction: 'copy',
        pendingChanges: 0
      }
    }
  }

  async getStreamRelations(streams: P4Stream[]): Promise<StreamRelation[]> {
    // Parallel processing with limit
    const results = await pMap(streams, async (stream) => {
      const relations: StreamRelation[] = []
      if (stream.parent && stream.parent !== 'none') {
        const [merge, copy] = await Promise.all([
          this.getInterchanges(stream.parent, stream.stream),
          this.getCopyChanges(stream.stream, stream.parent)
        ])
        if (merge.pendingChanges > 0) relations.push(merge)
        if (copy.pendingChanges > 0) relations.push(copy)
      }
      return relations
    }, 5) // Concurrency limit 5
    return results.flat()
  }

  async getStreamGraphData(depot: string): Promise<{
    streams: P4Stream[]
    workspaces: P4Workspace[]
    relations: StreamRelation[]
  }> {
    try {
      const streams = await this.getStreams(depot)

      // Parallel fetch workspaces
      const workspaceGroups = await pMap(streams, async (stream) => {
        const wsForStream = await this.getWorkspacesByStream(stream.stream)
        // Parallel fetch workspace details
        const detailedWorkspaces = await pMap(wsForStream, async (ws) => {
          const details = await this.getWorkspaceDetails(ws.client)
          return details || ws
        }, 5)
        return detailedWorkspaces
      }, 5)

      const allWorkspaces = workspaceGroups.flat()
      const relations = await this.getStreamRelations(streams)

      return { streams, workspaces: allWorkspaces, relations }
    } catch (error) {
      return { streams: [], workspaces: [], relations: [] }
    }
  }
}
