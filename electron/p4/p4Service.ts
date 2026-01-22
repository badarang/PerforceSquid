import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import type { P4Info, P4File, P4Changelist, P4DiffResult } from './types'

const execAsync = promisify(exec)

export interface P4Client {
  name: string
  root: string
  description: string
}

export class P4Service {
  private currentClient: string | null = null

  setClient(clientName: string) {
    this.currentClient = clientName
  }

  getClient(): string | null {
    return this.currentClient
  }

  private async runCommand(args: string[], stdinInput?: string): Promise<string> {
    try {
      const clientArgs = this.currentClient ? ['-c', this.currentClient] : []

      if (stdinInput) {
        // Use spawn for stdin input
        return new Promise((resolve, reject) => {
          const allArgs = [...clientArgs, ...args]
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

          proc.stdin.write(stdinInput)
          proc.stdin.end()
        })
      }

      const { stdout, stderr } = await execAsync(`p4 ${clientArgs.join(' ')} ${args.join(' ')}`, {
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        encoding: 'utf8'
      })
      if (stderr && !stdout) {
        throw new Error(stderr)
      }
      return stdout
    } catch (error: any) {
      if (error.stdout) {
        return error.stdout
      }
      throw error
    }
  }

  async getClients(): Promise<P4Client[]> {
    try {
      // First get user name
      const { stdout } = await execAsync('p4 info', { encoding: 'utf8' })
      const userMatch = stdout.match(/User name:\s*(\S+)/)
      const userName = userMatch ? userMatch[1] : ''

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
        // Format: Client name date root path 'description'
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

    return info as P4Info
  }

  async getOpenedFiles(): Promise<P4File[]> {
    try {
      // Use //... to get all opened files in the client
      const output = await this.runCommand(['opened', '//...'])
      if (!output.trim()) {
        return []
      }

      const files: P4File[] = []
      const lines = output.trim().split('\n')

      for (const line of lines) {
        // Format for default changelist: //depot/path/file.ext#rev - action default change (type)
        // Format for numbered changelist: //depot/path/file.ext#rev - action change 12345 (type)
        const defaultMatch = line.match(/^(.+?)#(\d+) - (\w+(?:\/\w+)?) default change(?: \((.+?)\))?/)
        const numberedMatch = line.match(/^(.+?)#(\d+) - (\w+(?:\/\w+)?) change (\d+)(?: \((.+?)\))?/)

        if (defaultMatch) {
          const [, depotFile, , action, type] = defaultMatch
          files.push({
            depotFile: depotFile.trim(),
            clientFile: '',
            action: action as P4File['action'],
            changelist: 'default',
            type: type || 'text'
          })
        } else if (numberedMatch) {
          const [, depotFile, , action, changelist, type] = numberedMatch
          files.push({
            depotFile: depotFile.trim(),
            clientFile: '',
            action: action as P4File['action'],
            changelist: parseInt(changelist, 10),
            type: type || 'text'
          })
        }
      }

      // Get client file paths
      if (files.length > 0) {
        try {
          const whereOutput = await this.runCommand(['where', ...files.map(f => f.depotFile)])
          const whereLines = whereOutput.trim().split('\n')

          for (let i = 0; i < whereLines.length && i < files.length; i++) {
            const parts = whereLines[i].split(' ')
            if (parts.length >= 3) {
              files[i].clientFile = parts[2]
            }
          }
        } catch {
          // If where fails, just use depot paths
        }
      }

      return files
    } catch (error: any) {
      if (error.message?.includes('not opened')) {
        return []
      }
      throw error
    }
  }

  async getDiff(filePath: string): Promise<P4DiffResult> {
    try {
      // Get the diff output
      const diffOutput = await this.runCommand(['diff', '-du', filePath])

      // Get the have revision content
      let oldContent = ''
      try {
        oldContent = await this.runCommand(['print', '-q', `${filePath}#have`])
      } catch {
        // File might be newly added
      }

      // Read current file content
      let newContent = ''
      try {
        const fs = await import('fs/promises')
        newContent = await fs.readFile(filePath.replace(/\//g, '\\'), 'utf8')
      } catch {
        // Might be deleted
      }

      return {
        filePath,
        oldContent,
        newContent,
        hunks: diffOutput
      }
    } catch (error: any) {
      // If no diff (file unchanged), return empty
      if (error.message?.includes('not opened') || error.message?.includes('no differing files')) {
        return {
          filePath,
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
        // Format: Change 12345 on 2024/01/01 by user@client *pending* 'description'
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
        // Submit default changelist
        output = await this.runCommand(['submit', '-d', `"${description}"`])
      } else {
        // Update description and submit
        output = await this.runCommand(['submit', '-c', String(changelist)])
      }

      return {
        success: true,
        message: output
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Create a new changelist with given description
  async createChangelist(description: string): Promise<{ success: boolean; changelistNumber: number; message: string }> {
    try {
      // Create changelist spec
      const spec = `Change: new\nDescription: ${description}\n`
      const output = await this.runCommand(['change', '-i'], spec)

      // Parse the changelist number from output like "Change 12345 created."
      const match = output.match(/Change (\d+) created/)
      if (match) {
        return {
          success: true,
          changelistNumber: parseInt(match[1], 10),
          message: output
        }
      }
      return {
        success: false,
        changelistNumber: 0,
        message: 'Failed to parse changelist number'
      }
    } catch (error: any) {
      return {
        success: false,
        changelistNumber: 0,
        message: error.message
      }
    }
  }

  // Find or create a "Junk" changelist
  async getOrCreateJunkChangelist(): Promise<{ success: boolean; changelistNumber: number; message: string }> {
    try {
      const changelists = await this.getChangelists()

      // Look for existing junk changelist
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

      // Create new junk changelist
      return await this.createChangelist('[JUNK - Do Not Submit]')
    } catch (error: any) {
      return {
        success: false,
        changelistNumber: 0,
        message: error.message
      }
    }
  }

  async sync(filePath?: string): Promise<{ success: boolean; message: string }> {
    try {
      const args = ['sync']
      if (filePath) {
        args.push(filePath)
      }
      const output = await this.runCommand(args)
      return {
        success: true,
        message: output || 'Already up to date'
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  async revert(files: string[]): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['revert', ...files])
      return {
        success: true,
        message: output
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Revert files that have not actually changed
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

        // Actions that should always be auto-reverted
        const autoRevertActions = ['delete', 'move/delete', 'branch', 'integrate']

        for (const line of openedOutput.split('\n')) {
          if (!line.trim()) continue

          const match = line.match(/^(.+?)#\d+/)
          if (!match) continue

          const depotFile = match[1]

          // Check for auto-revert actions
          let matched = false
          for (const action of autoRevertActions) {
            if (line.includes(` - ${action} `)) {
              filesToRevert.push(depotFile)
              matched = true
              break
            }
          }

          // Collect add/move-add files separately for special handling
          if (!matched && (line.includes(' - add ') || line.includes(' - move/add '))) {
            addFiles.push(depotFile)
          }
        }

        // For add files, check if they already exist in depot (wrongly opened for add)
        // If depot version exists, revert them
        for (const file of addFiles) {
          try {
            // Check if file exists in depot
            await this.runCommand(['files', file])
            // If no error, file exists in depot - should be reverted
            filesToRevert.push(file)
          } catch (err: any) {
            // File doesn't exist in depot - it's a real new file, don't revert
          }
        }

        if (filesToRevert.length > 0) {
          let revertedInBatch = 0
          // Revert in batches to avoid command line length issues
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
                } catch (e: any) {
                  console.error('Error reverting file:', file, e.message)
                }
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
        return {
          success: true,
          message: 'No unchanged files to revert',
          revertedCount: 0
        }
      }
      return {
        success: false,
        message: error.message,
        revertedCount: 0
      }
    }
  }

  async shelve(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['shelve', '-c', String(changelist)])
      return {
        success: true,
        message: output
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  async unshelve(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['unshelve', '-s', String(changelist)])
      return {
        success: true,
        message: output
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Delete a changelist (must be empty or use revertAndDelete)
  async deleteChangelist(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      const output = await this.runCommand(['change', '-d', String(changelist)])
      return {
        success: true,
        message: output || `Changelist ${changelist} deleted`
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Revert all files in a changelist and delete it
  async revertAndDeleteChangelist(changelist: number): Promise<{ success: boolean; message: string }> {
    try {
      // First revert all files in this changelist
      try {
        await this.runCommand(['revert', '-c', String(changelist), '//...'])
      } catch (err: any) {
        // Ignore "no files" error
        if (!err.message?.includes('not opened')) {
          throw err
        }
      }

      // Then delete the changelist
      const output = await this.runCommand(['change', '-d', String(changelist)])
      return {
        success: true,
        message: output || `Changelist ${changelist} deleted`
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Move files to a different changelist
  async reopenFiles(files: string[], changelist: number | 'default'): Promise<{ success: boolean; message: string }> {
    try {
      const clArg = changelist === 'default' || changelist === 0 ? 'default' : String(changelist)
      const output = await this.runCommand(['reopen', '-c', clArg, ...files])
      return {
        success: true,
        message: output
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  // Get submitted changelists for a depot path (stream)
  async getSubmittedChanges(depotPath: string, maxChanges: number = 50): Promise<P4Changelist[]> {
    try {
      const output = await this.runCommand([
        'changes',
        '-s', 'submitted',
        '-m', String(maxChanges),
        '-l',  // long output with full description
        depotPath
      ])

      if (!output.trim()) {
        return []
      }

      const changelists: P4Changelist[] = []
      const blocks = output.split(/\n(?=Change \d+)/)

      for (const block of blocks) {
        if (!block.trim()) continue

        // Format: Change 12345 on 2024/01/01 12:34:56 by user@client
        //         description (may be multiline)
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

  // Get the diff for a submitted changelist
  async describeChangelist(changelist: number): Promise<{
    info: P4Changelist | null
    files: Array<{ depotFile: string; action: string; revision: number }>
    diff: string
  }> {
    try {
      // Get changelist description with unified diff
      const output = await this.runCommand(['describe', '-du', String(changelist)])

      if (!output.trim()) {
        return { info: null, files: [], diff: '' }
      }

      // Normalize line endings
      const normalizedOutput = output.replace(/\r\n/g, '\n')

      // Parse header - capture date and optional time
      const headerMatch = normalizedOutput.match(/^Change (\d+) by (\S+)@(\S+) on (\S+)(?: (\S+))?/)
      let info: P4Changelist | null = null

      if (headerMatch) {
        const [, number, user, client, date, time] = headerMatch
        const fullDate = time ? `${date} ${time}` : date

        // Get description (between header and "Affected files")
        // Description is typically indented with tabs after a blank line
        const affectedStart = normalizedOutput.indexOf('Affected files')
        let description = ''

        if (affectedStart > -1) {
          // Find first blank line after header
          const headerEnd = normalizedOutput.indexOf('\n')
          const descSection = normalizedOutput.slice(headerEnd, affectedStart)
          // Remove leading/trailing whitespace and empty lines
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

      // Parse affected files
      const files: Array<{ depotFile: string; action: string; revision: number }> = []
      const affectedMatch = normalizedOutput.match(/Affected files \.\.\.\n\n([\s\S]*?)(?=\nDifferences|$)/)
      if (affectedMatch) {
        const fileLines = affectedMatch[1].trim().split('\n')
        for (const line of fileLines) {
          // Format: ... //depot/path/file.ext#rev action
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

      // Extract diff section from describe output
      const diffStart = normalizedOutput.indexOf('Differences ...')
      let diff = diffStart > -1 ? normalizedOutput.slice(diffStart) : ''

      // For files without diff in describe output (binary files, Unity files, etc.),
      // try to get diff using p4 diff2
      const filesWithDiff = new Set<string>()
      const diffFileRegex = /==== (.+?)#\d+/g
      let match
      while ((match = diffFileRegex.exec(diff)) !== null) {
        filesWithDiff.add(match[1])
      }

      // Get diffs for files that don't have diffs yet
      const missingDiffFiles = files.filter(f =>
        !filesWithDiff.has(f.depotFile) &&
        f.action !== 'delete' &&
        f.action !== 'branch' &&
        f.action !== 'integrate'
      )

      if (missingDiffFiles.length > 0) {
        const additionalDiffs: string[] = []

        for (const file of missingDiffFiles) {
          try {
            // Use diff2 to compare previous revision with current
            // For 'add' action, show the entire file content
            if (file.action === 'add') {
              const content = await this.runCommand(['print', '-q', `${file.depotFile}#${file.revision}`])
              if (content.trim()) {
                const lines = content.replace(/\r\n/g, '\n').split('\n')
                const diffContent = lines.map(line => `+${line}`).join('\n')
                additionalDiffs.push(`\n==== ${file.depotFile}#${file.revision} (${file.action}) ====\n@@ -0,0 +1,${lines.length} @@\n${diffContent}`)
              }
            } else if (file.revision > 1) {
              // For edit action, compare with previous revision
              const diff2Output = await this.runCommand([
                'diff2', '-du',
                `${file.depotFile}#${file.revision - 1}`,
                `${file.depotFile}#${file.revision}`
              ])
              if (diff2Output.trim()) {
                additionalDiffs.push(`\n==== ${file.depotFile}#${file.revision} (${file.action}) ====\n${diff2Output.replace(/\r\n/g, '\n')}`)
              }
            }
          } catch (err) {
            // Skip files that can't be diffed (truly binary files)
          }
        }

        if (additionalDiffs.length > 0) {
          if (!diff) {
            diff = 'Differences ...\n'
          }
          diff += additionalDiffs.join('\n')
        }
      }

      return { info, files, diff }
    } catch (error) {
      return { info: null, files: [], diff: '' }
    }
  }

  // Get current client's stream/depot path
  async getClientStream(): Promise<string | null> {
    try {
      if (!this.currentClient) return null

      const output = await this.runCommand(['client', '-o', this.currentClient])

      // Look for Stream: or View: line
      const streamMatch = output.match(/^Stream:\s*(\S+)/m)
      if (streamMatch) {
        return streamMatch[1] + '/...'
      }

      // Fall back to View mapping
      const viewMatch = output.match(/^View:\s*\n\s*(\S+)/m)
      if (viewMatch) {
        return viewMatch[1]
      }

      return null
    } catch (error) {
      return null
    }
  }

  // Get file annotation (blame) - who changed each line
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
      // Use -c for changelist, -u for user
      // Quote the file path to handle spaces in path
      // Output format: "changelist: user date content"
      const output = await this.runCommand(['annotate', '-c', '-u', `"${filePath}"`])

      console.log('[p4 annotate] filePath:', filePath)
      console.log('[p4 annotate] output length:', output.length)
      console.log('[p4 annotate] first 500 chars:', output.substring(0, 500))

      if (!output.trim()) {
        console.log('[p4 annotate] Empty output, returning empty lines')
        return { success: true, lines: [] }
      }

      const lines: Array<{
        lineNumber: number
        changelist: number
        user: string
        date: string
        content: string
      }> = []

      // Handle both Windows (CRLF) and Unix (LF) line endings
      const outputLines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      console.log('[p4 annotate] Number of output lines:', outputLines.length)

      let lineNumber = 1
      let lastMatch: { changelist: number; user: string; date: string } | null = null
      let matchedCount = 0
      let skippedCount = 0

      for (const rawLine of outputLines) {
        // Trim trailing whitespace but preserve leading spaces in content
        const line = rawLine.replace(/\s+$/, '')

        // Skip file header line (starts with //)
        if (line.startsWith('//')) {
          skippedCount++
          continue
        }

        // Skip empty lines at the start (before any content)
        if (!line && !lastMatch) {
          skippedCount++
          continue
        }

        // Try to match annotated line: "changelist: user date content"
        // Example: "836659: asmith 2025/11/20 using System.Collections;"
        // The content after date might be empty for blank source lines
        const match = line.match(/^(\d+):\s+(\S+)\s+(\d{4}\/\d{2}\/\d{2})(?:\s(.*))?$/)

        if (match) {
          matchedCount++
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
        } else if (line) {
          // Log unmatched non-empty lines for debugging
          if (matchedCount < 5) {
            console.log('[p4 annotate] Unmatched line:', JSON.stringify(line))
          }
        }
      }

      console.log('[p4 annotate] Matched lines:', matchedCount, 'Skipped:', skippedCount, 'Total result:', lines.length)
      return { success: true, lines }
    } catch (error: any) {
      return {
        success: false,
        lines: [],
        message: error.message
      }
    }
  }
}
