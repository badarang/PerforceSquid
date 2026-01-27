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
        hunks: diffOutput
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

  async getChangelists(): Promise<P4Changelist[]> {
    try {
      const info = await this.getInfo()
      const output = await this.runCommand(['changes', '-s', 'pending', '-c', info.clientName])

      if (!output.trim()) {
        return [{
          number: 0,
          status: 'pending',
          description: 'Default changelist',
          user: info.userName,
          client: info.clientName
        }]
      }

      const changelists: P4Changelist[] = [{
        number: 0,
        status: 'pending',
        description: 'Default changelist',
        user: info.userName,
        client: info.clientName
      }]

      const lines = output.trim().split('\n')
      for (const line of lines) {
        const match = line.match(/^Change (\d+) on (\S+) by (\S+)@(\S+) \*pending\* '(.+)'/)
        if (match) {
          const [, number, date, user, client, description] = match
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

      return changelists
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
          const descLines = description.trim().split('\n')
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
      
      return { success: true, message: output }
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
        'changes', '-s', 'submitted', '-m', String(maxChanges), '-l', depotPath
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
    try {
      const output = await this.runCommand(['describe', '-du', String(changelist)])
      if (!output.trim()) return { info: null, files: [], diff: '' }

      const normalizedOutput = output.replace(/\r\n/g, '\n')
      const headerMatch = normalizedOutput.match(/^Change (\d+) by (\S+)@(\S+) on (\S+)(?: (\S+))?/)
      let info: P4Changelist | null = null

      if (headerMatch) {
        const [, number, user, client, date, time] = headerMatch
        const fullDate = time ? `${date} ${time}` : date
        const affectedStart = normalizedOutput.indexOf('Affected files')
        let description = ''

        if (affectedStart > -1) {
          const headerEnd = normalizedOutput.indexOf('\n')
          const descSection = normalizedOutput.slice(headerEnd, affectedStart)
          description = descSection.split('\n')
            .map(line => line.replace(/^\t+/, '').trim())
            .filter(line => line.length > 0)
            .join(' ')
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
      const affectedMatch = normalizedOutput.match(/Affected files \.\.\.\n\n([\s\S]*?)(?=\nDifferences|$)/)
      if (affectedMatch) {
        const fileLines = affectedMatch[1].trim().split('\n')
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

      const diffStart = normalizedOutput.indexOf('Differences ...')
      let diff = diffStart > -1 ? normalizedOutput.slice(diffStart) : ''

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
        f.action !== 'integrate'
      )

      if (missingDiffFiles.length > 0) {
        // Parallelize fetching missing diffs
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
        }, 5) // Concurrency limit 5

        const validDiffs = additionalDiffs.filter((d): d is string => d !== null)
        if (validDiffs.length > 0) {
          if (!diff) diff = 'Differences ...\n'
          diff += validDiffs.join('\n')
        }
      }

      return { info, files, diff }
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