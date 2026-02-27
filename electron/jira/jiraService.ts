import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface JiraCommandResult {
  success: boolean
  output: string
  error?: string
}

export interface JiraStatus {
  configuredPath: string
  exists: boolean
  hasMainScript: boolean
  pythonAvailable: boolean
  jiraBaseUrl?: string
  message: string
}

const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/g

function sanitizeOutput(value: string): string {
  return value.replace(ANSI_ESCAPE, '').trim()
}

function getDefaultJiraBotPath(): string {
  if (process.env.JIRABOT_PATH) {
    return process.env.JIRABOT_PATH
  }
  return path.resolve(process.cwd(), '..', 'jirabot')
}

export class JiraService {
  private jiraBotPath: string

  constructor() {
    this.jiraBotPath = getDefaultJiraBotPath()
  }

  getPath(): string {
    return this.jiraBotPath
  }

  setPath(targetPath: string): void {
    this.jiraBotPath = targetPath
  }

  async getStatus(): Promise<JiraStatus> {
    const configuredPath = this.jiraBotPath
    const exists = fs.existsSync(configuredPath)
    const hasMainScript = fs.existsSync(path.join(configuredPath, 'main.py'))

    if (!exists) {
      return {
        configuredPath,
        exists,
        hasMainScript,
        pythonAvailable: false,
        jiraBaseUrl: this.getJiraBaseUrl(),
        message: 'Configured JiraBot path does not exist.',
      }
    }

    if (!hasMainScript) {
      return {
        configuredPath,
        exists,
        hasMainScript,
        pythonAvailable: false,
        jiraBaseUrl: this.getJiraBaseUrl(),
        message: 'main.py not found in the configured JiraBot path.',
      }
    }
    const probe = await this.probePython()
    return {
      configuredPath,
      exists,
      hasMainScript,
      pythonAvailable: probe.success,
      jiraBaseUrl: this.getJiraBaseUrl(),
      message: probe.success ? 'JiraBot is ready.' : (probe.error || 'Python is not available.'),
    }
  }

  async recommend(project: string, limit = 10): Promise<JiraCommandResult> {
    return this.tryRun(['main.py', '/recommend', '--project', project, '--limit', String(limit)])
  }

  async track(project: string, assignee: string, limit = 20): Promise<JiraCommandResult> {
    return this.tryRun([
      'main.py',
      '/track',
      '--project',
      project,
      '--assignee',
      assignee,
      '--limit',
      String(limit),
    ])
  }

  async similar(ticketOrUrl: string, threshold = 0.3): Promise<JiraCommandResult> {
    return this.tryRun(['main.py', '/similar', ticketOrUrl, '--threshold', String(threshold)])
  }

  private async tryRun(args: string[]): Promise<JiraCommandResult> {
    const attempts: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'python', args },
      { cmd: 'py', args: ['-3', ...args] },
    ]

    let lastError = 'Failed to run JiraBot.'

    for (const attempt of attempts) {
      const result = await this.runProcess(attempt.cmd, attempt.args)
      if (result.success) {
        return result
      }
      lastError = result.error || lastError
    }

    return {
      success: false,
      output: '',
      error: lastError,
    }
  }

  private async probePython(): Promise<JiraCommandResult> {
    const attempts: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'python', args: ['--version'] },
      { cmd: 'py', args: ['-3', '--version'] },
    ]

    for (const attempt of attempts) {
      const result = await this.runProcess(attempt.cmd, attempt.args)
      if (result.success) {
        return result
      }
    }

    return {
      success: false,
      output: '',
      error: 'Python runtime not found. Install Python or add it to PATH.',
    }
  }

  private runProcess(command: string, args: string[]): Promise<JiraCommandResult> {
    return new Promise((resolve) => {
      const cwd = this.jiraBotPath
      if (!fs.existsSync(cwd)) {
        resolve({
          success: false,
          output: '',
          error: `JiraBot path does not exist: ${cwd}`,
        })
        return
      }

      const child = spawn(command, args, {
        cwd,
        shell: false,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          error: error.message,
        })
      })

      child.on('close', (code) => {
        const output = sanitizeOutput(stdout)
        const errorText = sanitizeOutput(stderr)
        if (code === 0) {
          resolve({
            success: true,
            output,
          })
          return
        }
        resolve({
          success: false,
          output,
          error: errorText || `Process exited with code ${code}`,
        })
      })
    })
  }

  private getJiraBaseUrl(): string | undefined {
    const envPath = path.join(this.jiraBotPath, '.env')
    if (!fs.existsSync(envPath)) {
      return process.env.JIRA_BASE_URL
    }

    try {
      const content = fs.readFileSync(envPath, 'utf8')
      const line = content
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((item) => item.startsWith('JIRA_BASE_URL='))

      if (!line) {
        return process.env.JIRA_BASE_URL
      }

      const value = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      return value || process.env.JIRA_BASE_URL
    } catch {
      return process.env.JIRA_BASE_URL
    }
  }
}
